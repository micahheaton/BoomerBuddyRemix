import {
  evaluateCustomerHealth,
  lifecyclePlan,
  sanitizeAttribution,
  type AcquisitionMilestone,
  type AttributionChannel,
  type CustomerHealthResult,
  type LifecycleTrigger,
  type RawAttribution,
} from '@boomerbuddy/business-os';

import type { Database, SqlExecutor } from './database';
import { enqueueDurableJobWithExecutor } from './jobs';
import { createNotificationRequestWithExecutor } from './operational-work';
import {
  asDate,
  jsonParameter,
  jsonValue,
  placeholders,
  randomIdFactory,
  type IdFactory,
} from './values';

export const growthProjectionEventTypes = [
  'check.completed.v1',
  'public_check.saved.v1',
  'orientation.started.v1',
  'orientation.step_completed.v1',
  'orientation.verification_aid_updated.v1',
  'family.invitation_created.v1',
  'family.invitation_revoked.v2',
  'family.invitation_withdrawn.v2',
  'family.relationship_activated.v1',
  'family.relationship_withdrawn.v2',
  'family.relationship_relinquished.v2',
  'family.relationship_suspended.v2',
  'family.relationship_revoked.v2',
  'commerce.lifecycle_applied.v1',
] as const;

export type GrowthProjectionEventType = (typeof growthProjectionEventTypes)[number];

const growthEventTypeSet = new Set<string>(growthProjectionEventTypes);
const commerceLifecycles = new Set([
  'pending',
  'trialing',
  'active',
  'grace',
  'delinquent',
  'paused',
  'hold',
  'cancel_at_period_end',
  'canceled',
  'expired',
  'refunded',
  'disputed',
  'restored',
]);

export function isGrowthProjectionEventType(value: string): value is GrowthProjectionEventType {
  return growthEventTypeSet.has(value);
}

interface GrowthEventRow extends Record<string, unknown> {
  readonly id: string;
  readonly event_type: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly household_id: string | null;
  readonly actor_person_id: string | null;
  readonly payload: unknown;
  readonly occurred_at: unknown;
  readonly dead_lettered_at: unknown | null;
}

interface AttributionRow extends Record<string, unknown> {
  readonly channel: AttributionChannel;
  readonly source_token: string | null;
  readonly medium_token: string | null;
  readonly campaign_token: string | null;
  readonly content_token: string | null;
  readonly partner_token: string | null;
  readonly referrer_host: string | null;
}

interface InvitationRow extends Record<string, unknown> {
  readonly household_id: string;
  readonly id: string;
  readonly invited_by_person_id: string;
  readonly protected_person_id: string;
  readonly accepted_by_person_id: string | null;
  readonly state: string;
  readonly created_at: unknown;
}

interface RelationshipRow extends Record<string, unknown> {
  readonly household_id: string;
  readonly protected_person_id: string;
  readonly trusted_person_id: string;
}

interface ReferralLinkRow extends Record<string, unknown> {
  readonly referral_id: string;
  readonly invitation_id: string;
}

interface HealthSignalRow extends Record<string, unknown> {
  readonly cancellation_intent: boolean;
  readonly check_completed: boolean;
  readonly family_participation: boolean;
  readonly last_activity_at: unknown;
  readonly mobile_installed: boolean;
  readonly orientation_complete: boolean;
  readonly payment_failed: boolean;
  readonly support_cases_open: number;
  readonly trusted_circle_established: boolean;
  readonly unresolved_incident: boolean;
}

interface DueLifecycleCandidate {
  readonly householdId: string;
  readonly recipientPersonId?: string;
  readonly trigger: LifecycleTrigger;
  readonly triggerEventId: string;
}

interface ReadyLifecycleNotificationRow extends Record<string, unknown> {
  readonly step_id: string;
  readonly workflow_id: string;
  readonly step_key: string;
  readonly step_order: number;
  readonly household_id: string;
  readonly recipient_person_id: string | null;
  readonly consent_basis: string | null;
}

interface LifecycleNotificationReceiptRow extends Record<string, unknown> {
  readonly request_state: string;
  readonly job_state: string | null;
  readonly evidence_outcome: string | null;
  readonly observed_at: unknown | null;
}

export interface OrientationGrowthMeasurement {
  readonly householdId: string;
  readonly personId: string;
  readonly startedAt?: Date;
  readonly lastStepAt?: Date;
  readonly completedAt?: Date;
  readonly attentionObservedAt?: Date;
  readonly stalledObservedAt?: Date;
  readonly firstCheckAfterStartAt?: Date;
  readonly firstCheckAfterCompletionAt?: Date;
  readonly updatedAt: Date;
}

export interface LifecycleNotificationProgress {
  readonly materialized: number;
  readonly completed: number;
  readonly suppressed: number;
}

const localLifecycleNotificationTemplates: Readonly<Record<string, string>> = {
  orientation_help: 'lifecycle.orientation_stalled.v1',
  payment_recovery: 'lifecycle.payment_recovery.v1',
};

function scalarPayload(value: unknown): Readonly<Record<string, string | number | boolean>> {
  const parsed = jsonValue(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Growth event payload must be an object');
  }
  for (const item of Object.values(parsed)) {
    if (!['string', 'number', 'boolean'].includes(typeof item)) {
      throw new TypeError('Growth event payload must be content-free scalar data');
    }
  }
  return parsed as Readonly<Record<string, string | number | boolean>>;
}

function lifecycleWorkflowKind(trigger: LifecycleTrigger): string {
  if (trigger === 'signup' || trigger === 'incomplete_signup') return 'signup';
  if (trigger.includes('orientation')) return 'orientation';
  if (trigger.includes('trial')) return 'trial';
  if (trigger.includes('payment')) return 'payment_recovery';
  if (trigger === 'renewal') return 'renewal';
  if (trigger.includes('cancel')) return 'cancellation';
  if (trigger === 'win_back_eligible') return 'win_back';
  if (trigger === 'referral_success') return 'referral';
  return 'activation';
}

function publicAttribution(source: string, campaign: string): RawAttribution {
  const channel: AttributionChannel =
    source === 'organic'
      ? 'organic_search'
      : source === 'partner'
        ? 'partner'
        : source === 'campaign'
          ? 'campaign'
          : 'direct';
  return {
    channel,
    ...(campaign === 'none' ? {} : { campaign }),
    source,
  };
}

function rawAttribution(row: AttributionRow | undefined): RawAttribution {
  if (row === undefined) return { channel: 'direct' };
  return {
    channel: row.channel,
    ...(row.source_token === null ? {} : { source: row.source_token }),
    ...(row.medium_token === null ? {} : { medium: row.medium_token }),
    ...(row.campaign_token === null ? {} : { campaign: row.campaign_token }),
    ...(row.content_token === null ? {} : { content: row.content_token }),
    ...(row.partner_token === null ? {} : { partner: row.partner_token }),
    ...(row.referrer_host === null ? {} : { referrerHost: row.referrer_host }),
  };
}

function commerceTrigger(
  lifecycle: string,
  previousLifecycle: string,
  providerEventKind: string,
): LifecycleTrigger | undefined {
  if (lifecycle === 'trialing') return 'trial_started';
  if (lifecycle === 'restored') return 'payment_recovered';
  if (lifecycle === 'active') {
    if (['grace', 'delinquent', 'paused', 'hold'].includes(previousLifecycle)) {
      return 'payment_recovered';
    }
    if (providerEventKind === 'invoice.paid' && previousLifecycle === 'active') return 'renewal';
    return 'converted';
  }
  if (['grace', 'delinquent', 'paused', 'hold', 'refunded', 'disputed'].includes(lifecycle)) {
    return 'failed_payment';
  }
  if (lifecycle === 'cancel_at_period_end') return 'cancellation_intent';
  if (lifecycle === 'canceled' || lifecycle === 'expired') return 'cancelled';
  return undefined;
}

export class GrowthRuntimeRepository {
  constructor(
    private readonly database: Database,
    private readonly ids: IdFactory = randomIdFactory,
  ) {}

  async projectPending(input: { readonly limit: number; readonly now: Date }): Promise<number> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) {
      throw new TypeError('Growth projection batch is invalid');
    }
    const eventPlaceholders = placeholders(1, growthProjectionEventTypes.length);
    let projected = 0;
    let handled = 0;
    while (handled < input.limit) {
      const pending = await this.database.query<{ id: string } & Record<string, unknown>>(
        `SELECT event.id
         FROM outbox_events event
         WHERE event.event_type IN (${eventPlaceholders})
           AND event.dead_lettered_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM growth_event_receipts receipt WHERE receipt.event_id = event.id
           )
           AND NOT EXISTS (
             SELECT 1
             FROM outbox_events prior
             WHERE prior.aggregate_type = event.aggregate_type
               AND prior.aggregate_id = event.aggregate_id
               AND prior.household_id IS NOT DISTINCT FROM event.household_id
               AND prior.event_type IN (${eventPlaceholders})
               AND (prior.dead_lettered_at IS NULL OR prior.replay_resolved_at IS NULL)
               AND prior.causal_order_position < event.causal_order_position
               AND NOT EXISTS (
                 SELECT 1 FROM growth_event_receipts prior_receipt
                 WHERE prior_receipt.event_id = prior.id
               )
           )
         ORDER BY event.causal_order_position
         LIMIT $${growthProjectionEventTypes.length + 1}`,
        [...growthProjectionEventTypes, input.limit - handled],
      );
      if (pending.rowCount === 0) break;
      let batchProgress = 0;
      for (const candidate of pending.rows) {
        const disposition = await this.projectEventById({
          eventId: candidate.id,
          now: input.now,
        });
        if (disposition === 'projected') projected += 1;
        const receipt = await this.database.query(
          'SELECT 1 FROM growth_event_receipts WHERE event_id = $1',
          [candidate.id],
        );
        if (receipt.rowCount > 0) {
          handled += 1;
          batchProgress += 1;
        }
      }
      if (batchProgress === 0) break;
    }
    return projected;
  }

  async projectEventById(input: {
    readonly eventId: string;
    readonly now: Date;
  }): Promise<'projected' | 'ignored' | 'already_projected'> {
    if (input.eventId.trim() === '' || !Number.isFinite(input.now.getTime())) {
      throw new TypeError('Growth event projection input is invalid');
    }
    return this.database.transaction(async (transaction) => {
      const result = await transaction.query<GrowthEventRow>(
        `SELECT id, event_type, aggregate_type, aggregate_id, household_id,
                actor_person_id, payload, occurred_at, dead_lettered_at
         FROM outbox_events WHERE id = $1 FOR UPDATE`,
        [input.eventId],
      );
      const event = result.rows[0];
      if (
        event === undefined ||
        event.dead_lettered_at !== null ||
        !isGrowthProjectionEventType(event.event_type)
      ) {
        return 'ignored';
      }
      const receipt = await transaction.query(
        'SELECT 1 FROM growth_event_receipts WHERE event_id = $1',
        [event.id],
      );
      if (receipt.rowCount > 0) return 'already_projected';
      const predecessorEventPlaceholders = placeholders(2, growthProjectionEventTypes.length);
      const unresolvedPredecessor = await transaction.query(
        `SELECT 1 FROM outbox_events prior
         JOIN outbox_events current ON current.id = $1
         WHERE prior.aggregate_type = current.aggregate_type
           AND prior.aggregate_id = current.aggregate_id
           AND prior.household_id IS NOT DISTINCT FROM current.household_id
           AND prior.event_type IN (${predecessorEventPlaceholders})
           AND (prior.dead_lettered_at IS NULL OR prior.replay_resolved_at IS NULL)
           AND prior.causal_order_position < current.causal_order_position
           AND NOT EXISTS (
             SELECT 1 FROM growth_event_receipts prior_receipt
             WHERE prior_receipt.event_id = prior.id
           )
         LIMIT 1`,
        [event.id, ...growthProjectionEventTypes],
      );
      if (unresolvedPredecessor.rowCount > 0) return 'ignored';
      if (event.household_id !== null) {
        await transaction.query('SELECT id FROM households WHERE id = $1 FOR UPDATE', [
          event.household_id,
        ]);
      }
      const disposition = await this.projectEvent(transaction, event, input.now);
      await transaction.query(
        `INSERT INTO growth_event_receipts(
           event_id, event_type, projection_version, disposition, projected_at
         ) VALUES ($1,$2,'run2-growth-v1',$3,$4)`,
        [event.id, event.event_type, disposition, input.now.toISOString()],
      );
      return disposition;
    });
  }

  private async projectEvent(
    transaction: SqlExecutor,
    event: GrowthEventRow,
    now: Date,
  ): Promise<'projected' | 'ignored'> {
    const householdId = event.household_id;
    if (householdId === null) return 'ignored';
    const occurredAt = asDate(event.occurred_at, 'outbox_events.occurred_at');
    const payload = scalarPayload(event.payload);

    if (event.event_type === 'public_check.saved.v1') {
      const conversion = await transaction.query<
        {
          actor_person_id: string;
          attribution_source: string;
          attribution_campaign: string;
        } & Record<string, unknown>
      >(
        `SELECT actor_person_id, attribution_source, attribution_campaign
         FROM public_check_conversions
         WHERE result_id = $1 AND household_id = $2`,
        [event.aggregate_id, householdId],
      );
      const row = conversion.rows[0];
      if (row === undefined) return 'ignored';
      const attributionId = await this.recordMilestone(transaction, {
        attribution: publicAttribution(row.attribution_source, row.attribution_campaign),
        milestone: 'signup',
        now: occurredAt,
        subjectId: householdId,
        subjectKind: 'household',
      });
      if (attributionId !== undefined) {
        await this.startLifecycle(transaction, {
          householdId,
          recipientPersonId: row.actor_person_id,
          trigger: 'signup',
          triggerEventId: event.id,
          now: occurredAt,
        });
      }
      await this.recordHealth(transaction, householdId, event.id, now);
      return 'projected';
    }

    if (event.event_type === 'check.completed.v1') {
      const attribution = await this.attributionForCheck(
        transaction,
        householdId,
        event.aggregate_id,
      );
      const firstCheckId = await this.recordMilestone(transaction, {
        attribution,
        milestone: 'first_check',
        now: occurredAt,
        subjectId: householdId,
        subjectKind: 'household',
      });
      if (firstCheckId !== undefined) {
        await this.startLifecycle(transaction, {
          householdId,
          ...(event.actor_person_id === null ? {} : { recipientPersonId: event.actor_person_id }),
          trigger: 'first_check',
          triggerEventId: event.id,
          now: occurredAt,
        });
      }
      await this.correlateCheckToOrientation(transaction, householdId, event.actor_person_id, now);
      await this.recordHealth(transaction, householdId, event.id, now);
      return 'projected';
    }

    if (event.event_type.startsWith('orientation.')) {
      await this.measureOrientation(transaction, event, payload, occurredAt, now);
      if (event.event_type === 'orientation.started.v1') {
        await this.recordMilestone(transaction, {
          attribution: await this.latestAttribution(transaction, householdId),
          milestone: 'orientation',
          now: occurredAt,
          subjectId: householdId,
          subjectKind: 'household',
        });
        await this.startLifecycle(transaction, {
          householdId,
          ...(event.actor_person_id === null ? {} : { recipientPersonId: event.actor_person_id }),
          trigger: 'orientation_started',
          triggerEventId: event.id,
          now: occurredAt,
        });
      }
      if (payload.status === 'ready') {
        await this.recordMilestone(transaction, {
          attribution: await this.latestAttribution(transaction, householdId),
          milestone: 'activation',
          now: occurredAt,
          subjectId: householdId,
          subjectKind: 'household',
        });
      }
      await this.recordHealth(transaction, householdId, event.id, now);
      return 'projected';
    }

    if (event.event_type === 'family.invitation_created.v1') {
      await this.createReferralFromInvitation(transaction, event, occurredAt);
      await this.recordHealth(transaction, householdId, event.id, now);
      return 'projected';
    }

    if (
      event.event_type === 'family.invitation_revoked.v2' ||
      event.event_type === 'family.invitation_withdrawn.v2'
    ) {
      await this.revokeReferralForInvitation(transaction, event.aggregate_id);
      await this.recordHealth(transaction, householdId, event.id, now);
      return 'projected';
    }

    if (event.event_type === 'family.relationship_activated.v1') {
      await this.activateReferralFromRelationship(transaction, event, occurredAt);
      await this.startLifecycle(transaction, {
        householdId,
        ...(event.actor_person_id === null ? {} : { recipientPersonId: event.actor_person_id }),
        trigger: 'referral_success',
        triggerEventId: event.id,
        now: occurredAt,
      });
      await this.recordHealth(transaction, householdId, event.id, now);
      return 'projected';
    }

    if (event.event_type.startsWith('family.relationship_')) {
      await this.revokeReferralForRelationship(transaction, householdId, event.aggregate_id);
      await this.recordHealth(transaction, householdId, event.id, now);
      return 'projected';
    }

    if (event.event_type === 'commerce.lifecycle_applied.v1') {
      const lifecycle = typeof payload.lifecycle === 'string' ? payload.lifecycle : '';
      const previousLifecycle =
        typeof payload.previousLifecycle === 'string' ? payload.previousLifecycle : '';
      const providerEventKind =
        typeof payload.providerEventKind === 'string' ? payload.providerEventKind : '';
      if (!commerceLifecycles.has(lifecycle) || !commerceLifecycles.has(previousLifecycle)) {
        throw new TypeError('Commerce growth event lifecycle is invalid');
      }
      const milestone: AcquisitionMilestone | undefined =
        lifecycle === 'trialing'
          ? 'trial'
          : lifecycle === 'active' || lifecycle === 'restored'
            ? 'paid'
            : undefined;
      if (milestone !== undefined) {
        await this.recordMilestone(transaction, {
          attribution: await this.latestAttribution(transaction, householdId),
          milestone,
          now: occurredAt,
          subjectId: householdId,
          subjectKind: 'household',
        });
      }
      const trigger = commerceTrigger(lifecycle, previousLifecycle, providerEventKind);
      if (trigger !== undefined) {
        const payer = await this.activePayer(transaction, householdId);
        await this.startLifecycle(transaction, {
          householdId,
          ...(payer === undefined ? {} : { recipientPersonId: payer }),
          trigger,
          triggerEventId: event.id,
          now: occurredAt,
        });
      }
      await this.recordHealth(transaction, householdId, event.id, now);
      return 'projected';
    }

    return 'ignored';
  }

  private async recordMilestone(
    executor: SqlExecutor,
    input: {
      readonly attribution: RawAttribution;
      readonly milestone: AcquisitionMilestone;
      readonly now: Date;
      readonly subjectId: string;
      readonly subjectKind: 'anonymous_context' | 'person' | 'household';
    },
  ): Promise<string | undefined> {
    const existing = await executor.query<{ id: string } & Record<string, unknown>>(
      `SELECT id FROM acquisition_touchpoints
       WHERE subject_kind = $1 AND subject_id = $2 AND milestone = $3
       ORDER BY occurred_at, id LIMIT 1`,
      [input.subjectKind, input.subjectId, input.milestone],
    );
    if (existing.rows[0] !== undefined) return undefined;
    const attribution = sanitizeAttribution(input.attribution);
    const id = this.ids.next('touch');
    await executor.query(
      `INSERT INTO acquisition_touchpoints(
         id, subject_kind, subject_id, channel, milestone, source_token, medium_token,
         campaign_token, content_token, partner_token, referrer_host, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        input.subjectKind,
        input.subjectId,
        attribution.channel,
        input.milestone,
        attribution.source ?? null,
        attribution.medium ?? null,
        attribution.campaign ?? null,
        attribution.content ?? null,
        attribution.partner ?? null,
        attribution.referrerHost ?? null,
        input.now.toISOString(),
      ],
    );
    return id;
  }

  private async latestAttribution(
    executor: SqlExecutor,
    householdId: string,
  ): Promise<RawAttribution> {
    const result = await executor.query<AttributionRow>(
      `SELECT channel, source_token, medium_token, campaign_token, content_token,
              partner_token, referrer_host
       FROM acquisition_touchpoints
       WHERE subject_kind = 'household' AND subject_id = $1
       ORDER BY occurred_at DESC, id DESC LIMIT 1`,
      [householdId],
    );
    return rawAttribution(result.rows[0]);
  }

  private async attributionForCheck(
    executor: SqlExecutor,
    householdId: string,
    analysisId: string,
  ): Promise<RawAttribution> {
    const conversion = await executor.query<
      { attribution_source: string; attribution_campaign: string } & Record<string, unknown>
    >(
      `SELECT attribution_source, attribution_campaign
       FROM public_check_conversions
       WHERE household_id = $1 AND analysis_id = $2`,
      [householdId, analysisId],
    );
    const row = conversion.rows[0];
    return row === undefined
      ? this.latestAttribution(executor, householdId)
      : publicAttribution(row.attribution_source, row.attribution_campaign);
  }

  private async startLifecycle(
    executor: SqlExecutor,
    input: {
      readonly householdId: string;
      readonly recipientPersonId?: string;
      readonly trigger: LifecycleTrigger;
      readonly triggerEventId: string;
      readonly now: Date;
    },
  ): Promise<boolean> {
    const existing = await executor.query(
      'SELECT 1 FROM lifecycle_workflows WHERE trigger_event_id = $1',
      [input.triggerEventId],
    );
    if (existing.rowCount > 0) return false;
    const suppressed =
      input.recipientPersonId === undefined
        ? false
        : await this.hasLifecycleSuppression(executor, input.recipientPersonId, input.now);
    const plan = lifecyclePlan(input.trigger, true);
    const steps = plan.map((step) => {
      const failureCode = step.requiresMarketingConsent
        ? 'marketing_consent_missing'
        : step.actionKind === 'approved_message' && input.recipientPersonId === undefined
          ? 'recipient_unavailable'
          : step.actionKind === 'approved_message' && suppressed
            ? 'communication_suppressed'
            : undefined;
      return { ...step, failureCode };
    });
    const eligible = steps.filter((step) => step.failureCode === undefined);
    const workflowId = this.ids.next('lifecycle');
    const consentBasis = steps.some((step) => step.requiresMarketingConsent)
      ? 'marketing_opt_in_missing'
      : suppressed
        ? 'communication_suppression'
        : input.recipientPersonId === undefined &&
            steps.some((step) => step.actionKind === 'approved_message')
          ? 'recipient_unavailable'
          : steps.some((step) => step.actionKind === 'approved_message')
            ? 'transactional_lifecycle'
            : 'internal_only';
    await executor.query(
      `INSERT INTO lifecycle_workflows(
         id, household_id, recipient_person_id, workflow_kind, state, trigger_event_id,
         current_step_key, consent_basis, started_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
      [
        workflowId,
        input.householdId,
        input.recipientPersonId ?? null,
        lifecycleWorkflowKind(input.trigger),
        eligible.length === 0 ? 'suppressed' : 'active',
        input.triggerEventId,
        eligible[0]?.key ?? null,
        consentBasis,
        input.now.toISOString(),
      ],
    );
    for (const [index, step] of steps.entries()) {
      const eligibleIndex = eligible.findIndex((candidate) => candidate.key === step.key);
      await executor.query(
        `INSERT INTO lifecycle_steps(
           id, workflow_id, step_key, action_kind, state, scheduled_at,
           failure_code, step_order
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          this.ids.next('lifecycle_step'),
          workflowId,
          step.key,
          step.actionKind,
          step.failureCode === undefined
            ? eligibleIndex === 0
              ? 'ready'
              : 'pending'
            : 'suppressed',
          input.now.toISOString(),
          step.failureCode ?? null,
          index,
        ],
      );
    }
    await this.advanceInternalLifecycle(executor, workflowId, input.now);
    return true;
  }

  private async advanceInternalLifecycle(
    executor: SqlExecutor,
    workflowId: string,
    now: Date,
  ): Promise<void> {
    for (;;) {
      const ready = await executor.query<
        { id: string; action_kind: string; step_order: number } & Record<string, unknown>
      >(
        `SELECT id, action_kind, step_order FROM lifecycle_steps
         WHERE workflow_id = $1 AND state = 'ready'
         ORDER BY step_order LIMIT 1`,
        [workflowId],
      );
      const step = ready.rows[0];
      if (step === undefined || step.action_kind !== 'internal_task') return;
      await executor.query(
        `UPDATE lifecycle_steps SET state = 'completed', completed_at = $2
         WHERE id = $1 AND state = 'ready'`,
        [step.id, now.toISOString()],
      );
      if (!(await this.advanceAfterLifecycleStep(executor, workflowId, step.step_order, now))) {
        return;
      }
    }
  }

  private async advanceAfterLifecycleStep(
    executor: SqlExecutor,
    workflowId: string,
    stepOrder: number,
    now: Date,
  ): Promise<boolean> {
    const next = await executor.query<{ id: string; step_key: string } & Record<string, unknown>>(
      `SELECT id, step_key FROM lifecycle_steps
       WHERE workflow_id = $1 AND state = 'pending' AND step_order > $2
       ORDER BY step_order LIMIT 1`,
      [workflowId, stepOrder],
    );
    const nextStep = next.rows[0];
    if (nextStep === undefined) {
      await executor.query(
        `UPDATE lifecycle_workflows
         SET state = 'completed', current_step_key = NULL, completed_at = $2, updated_at = $2
         WHERE id = $1 AND state = 'active'`,
        [workflowId, now.toISOString()],
      );
      return false;
    }
    await executor.query("UPDATE lifecycle_steps SET state = 'ready' WHERE id = $1", [nextStep.id]);
    await executor.query(
      'UPDATE lifecycle_workflows SET current_step_key = $2, updated_at = $3 WHERE id = $1',
      [workflowId, nextStep.step_key, now.toISOString()],
    );
    return true;
  }

  private async suppressLifecycleNotification(
    executor: SqlExecutor,
    step: ReadyLifecycleNotificationRow,
    failureCode: 'communication_suppressed' | 'recipient_unavailable',
    now: Date,
  ): Promise<void> {
    await executor.query(
      `UPDATE lifecycle_steps SET state = 'suppressed', failure_code = $2
       WHERE id = $1 AND state = 'ready'`,
      [step.step_id, failureCode],
    );
    await executor.query(
      `UPDATE lifecycle_workflows
       SET state = 'suppressed', current_step_key = NULL, updated_at = $2
       WHERE id = $1 AND state = 'active'`,
      [step.workflow_id, now.toISOString()],
    );
  }

  private async hasLifecycleSuppression(
    executor: SqlExecutor,
    personId: string,
    at: Date,
  ): Promise<boolean> {
    const result = await executor.query(
      `SELECT 1 FROM communication_suppressions
       WHERE subject_kind = 'person' AND subject_id = $1
         AND scope IN ('lifecycle','all') AND revoked_at IS NULL AND effective_at <= $2
       LIMIT 1`,
      [personId, at.toISOString()],
    );
    return result.rowCount > 0;
  }

  private async activePayer(
    executor: SqlExecutor,
    householdId: string,
  ): Promise<string | undefined> {
    const result = await executor.query<{ person_id: string } & Record<string, unknown>>(
      `SELECT person_id FROM household_payers
       WHERE household_id = $1 AND status = 'active'
       ORDER BY effective_at DESC, person_id LIMIT 1`,
      [householdId],
    );
    return result.rows[0]?.person_id;
  }

  private async createReferralFromInvitation(
    executor: SqlExecutor,
    event: GrowthEventRow,
    occurredAt: Date,
  ): Promise<string | undefined> {
    const householdId = event.household_id;
    if (householdId === null) return undefined;
    const invitationResult = await executor.query<InvitationRow>(
      `SELECT household_id, id, invited_by_person_id, protected_person_id,
              accepted_by_person_id, state, created_at
       FROM invitations WHERE household_id = $1 AND id = $2`,
      [householdId, event.aggregate_id],
    );
    const invitation = invitationResult.rows[0];
    if (invitation === undefined) return undefined;
    const existing = await executor.query<ReferralLinkRow>(
      'SELECT referral_id, invitation_id FROM growth_referral_links WHERE invitation_id = $1',
      [invitation.id],
    );
    if (existing.rows[0] !== undefined) return existing.rows[0].referral_id;
    const attributionTouchpointId = await this.recordMilestone(executor, {
      attribution: { channel: 'referral', source: 'trusted_circle' },
      milestone: 'referral',
      now: occurredAt,
      subjectId: householdId,
      subjectKind: 'household',
    });
    const referralId = this.ids.next('referral');
    await executor.query(
      `INSERT INTO referrals(
         id, referral_kind, referrer_person_id, referrer_household_id,
         referred_person_id, referred_household_id, attribution_touchpoint_id,
         state, created_at
       ) VALUES ($1,'trusted_circle',$2,$3,NULL,$3,$4,'created',$5)`,
      [
        referralId,
        invitation.invited_by_person_id,
        householdId,
        attributionTouchpointId ?? null,
        occurredAt.toISOString(),
      ],
    );
    await executor.query(
      `INSERT INTO growth_referral_links(
         invitation_id, household_id, referral_id, created_event_id, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$5)`,
      [invitation.id, householdId, referralId, event.id, occurredAt.toISOString()],
    );
    return referralId;
  }

  private async invitationForRelationship(
    executor: SqlExecutor,
    householdId: string,
    relationshipId: string,
  ): Promise<{
    readonly invitation: InvitationRow;
    readonly relationship: RelationshipRow;
  } | null> {
    const relationshipResult = await executor.query<RelationshipRow>(
      `SELECT household_id, protected_person_id, trusted_person_id
       FROM trusted_circle_relationships WHERE household_id = $1 AND id = $2`,
      [householdId, relationshipId],
    );
    const relationship = relationshipResult.rows[0];
    if (relationship === undefined) return null;
    const invitationResult = await executor.query<InvitationRow>(
      `SELECT household_id, id, invited_by_person_id, protected_person_id,
              accepted_by_person_id, state, created_at
       FROM invitations
       WHERE household_id = $1 AND protected_person_id = $2
         AND accepted_by_person_id = $3 AND state = 'accepted'
       ORDER BY accepted_at DESC, id DESC LIMIT 1`,
      [householdId, relationship.protected_person_id, relationship.trusted_person_id],
    );
    const invitation = invitationResult.rows[0];
    return invitation === undefined ? null : { invitation, relationship };
  }

  private async activateReferralFromRelationship(
    executor: SqlExecutor,
    event: GrowthEventRow,
    occurredAt: Date,
  ): Promise<void> {
    const householdId = event.household_id;
    if (householdId === null) return;
    const source = await this.invitationForRelationship(executor, householdId, event.aggregate_id);
    if (source === null) return;
    let link = (
      await executor.query<ReferralLinkRow>(
        'SELECT referral_id, invitation_id FROM growth_referral_links WHERE invitation_id = $1',
        [source.invitation.id],
      )
    ).rows[0];
    if (link === undefined) {
      const referralId = this.ids.next('referral');
      await executor.query(
        `INSERT INTO referrals(
           id, referral_kind, referrer_person_id, referrer_household_id,
           referred_person_id, referred_household_id, state,
           created_at, accepted_at, activated_at
         ) VALUES ($1,'trusted_circle',$2,$3,$4,$3,'activated',$5,$5,$5)`,
        [
          referralId,
          source.invitation.invited_by_person_id,
          householdId,
          source.relationship.trusted_person_id,
          occurredAt.toISOString(),
        ],
      );
      await executor.query(
        `INSERT INTO growth_referral_links(
           invitation_id, household_id, referral_id, created_event_id,
           activated_event_id, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$4,$5,$5)`,
        [source.invitation.id, householdId, referralId, event.id, occurredAt.toISOString()],
      );
      link = { referral_id: referralId, invitation_id: source.invitation.id };
    } else {
      await executor.query(
        `UPDATE referrals
         SET referred_person_id = $2, referred_household_id = $3,
             state = 'activated', accepted_at = COALESCE(accepted_at, $4),
             activated_at = COALESCE(activated_at, $4)
         WHERE id = $1 AND state IN ('created','accepted','activated')`,
        [
          link.referral_id,
          source.relationship.trusted_person_id,
          householdId,
          occurredAt.toISOString(),
        ],
      );
      await executor.query(
        `UPDATE growth_referral_links
         SET activated_event_id = COALESCE(activated_event_id, $2), updated_at = $3
         WHERE invitation_id = $1`,
        [source.invitation.id, event.id, occurredAt.toISOString()],
      );
    }
    await this.recordMilestone(executor, {
      attribution: { channel: 'referral', source: 'trusted_circle' },
      milestone: 'referral',
      now: occurredAt,
      subjectId: source.relationship.trusted_person_id,
      subjectKind: 'person',
    });
  }

  private async revokeReferralForInvitation(
    executor: SqlExecutor,
    invitationId: string,
  ): Promise<void> {
    await executor.query(
      `UPDATE referrals SET state = 'revoked'
       WHERE id = (
         SELECT referral_id FROM growth_referral_links WHERE invitation_id = $1
       ) AND state IN ('created','accepted','activated')`,
      [invitationId],
    );
  }

  private async revokeReferralForRelationship(
    executor: SqlExecutor,
    householdId: string,
    relationshipId: string,
  ): Promise<void> {
    const source = await this.invitationForRelationship(executor, householdId, relationshipId);
    if (source !== null) await this.revokeReferralForInvitation(executor, source.invitation.id);
  }

  private async measureOrientation(
    executor: SqlExecutor,
    event: GrowthEventRow,
    payload: Readonly<Record<string, string | number | boolean>>,
    occurredAt: Date,
    observedAt: Date,
  ): Promise<void> {
    const householdId = event.household_id;
    if (householdId === null) return;
    const state = await executor.query<{ needs_attention: boolean } & Record<string, unknown>>(
      `SELECT needs_attention FROM orientation_states
       WHERE household_id = $1 AND person_id = $2`,
      [householdId, event.aggregate_id],
    );
    if (state.rows[0] === undefined) return;
    const startedAt = event.event_type === 'orientation.started.v1' ? occurredAt : undefined;
    const stepAt = event.event_type === 'orientation.started.v1' ? undefined : occurredAt;
    const completedAt = payload.status === 'ready' ? occurredAt : undefined;
    await executor.query(
      `INSERT INTO growth_orientation_measurements(
         household_id, person_id, started_at, last_step_at, completed_at,
         attention_observed_at, last_event_id, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (household_id, person_id) DO UPDATE SET
         started_at = CASE
           WHEN growth_orientation_measurements.started_at IS NULL THEN EXCLUDED.started_at
           WHEN EXCLUDED.started_at IS NULL THEN growth_orientation_measurements.started_at
           ELSE LEAST(growth_orientation_measurements.started_at, EXCLUDED.started_at) END,
         last_step_at = CASE
           WHEN growth_orientation_measurements.last_step_at IS NULL THEN EXCLUDED.last_step_at
           WHEN EXCLUDED.last_step_at IS NULL THEN growth_orientation_measurements.last_step_at
           ELSE GREATEST(growth_orientation_measurements.last_step_at, EXCLUDED.last_step_at) END,
         completed_at = CASE
           WHEN growth_orientation_measurements.completed_at IS NULL THEN EXCLUDED.completed_at
           WHEN EXCLUDED.completed_at IS NULL THEN growth_orientation_measurements.completed_at
           ELSE LEAST(growth_orientation_measurements.completed_at, EXCLUDED.completed_at) END,
         attention_observed_at = CASE
           WHEN growth_orientation_measurements.attention_observed_at IS NULL
             THEN EXCLUDED.attention_observed_at
           WHEN EXCLUDED.attention_observed_at IS NULL
             THEN growth_orientation_measurements.attention_observed_at
           ELSE LEAST(
             growth_orientation_measurements.attention_observed_at,
             EXCLUDED.attention_observed_at
           ) END,
         last_event_id = EXCLUDED.last_event_id,
         updated_at = GREATEST(growth_orientation_measurements.updated_at, EXCLUDED.updated_at)`,
      [
        householdId,
        event.aggregate_id,
        startedAt?.toISOString() ?? null,
        stepAt?.toISOString() ?? null,
        completedAt?.toISOString() ?? null,
        state.rows[0].needs_attention ? observedAt.toISOString() : null,
        event.id,
        observedAt.toISOString(),
      ],
    );
    await this.refreshOrientationCheckCorrelation(
      executor,
      householdId,
      event.aggregate_id,
      observedAt,
    );
  }

  private async correlateCheckToOrientation(
    executor: SqlExecutor,
    householdId: string,
    personId: string | null,
    observedAt: Date,
  ): Promise<void> {
    if (personId === null) return;
    await this.refreshOrientationCheckCorrelation(executor, householdId, personId, observedAt);
  }

  private async refreshOrientationCheckCorrelation(
    executor: SqlExecutor,
    householdId: string,
    personId: string,
    observedAt: Date,
  ): Promise<void> {
    await executor.query(
      `UPDATE growth_orientation_measurements measurement
       SET first_check_after_start_at = (
             SELECT min(analysis.created_at) FROM analyses analysis
             WHERE analysis.household_id = measurement.household_id
               AND analysis.requested_by = measurement.person_id
               AND analysis.state = 'completed'
               AND measurement.started_at IS NOT NULL
               AND analysis.created_at >= measurement.started_at
           ),
           first_check_after_completion_at = (
             SELECT min(analysis.created_at) FROM analyses analysis
             WHERE analysis.household_id = measurement.household_id
               AND analysis.requested_by = measurement.person_id
               AND analysis.state = 'completed'
               AND measurement.completed_at IS NOT NULL
               AND analysis.created_at >= measurement.completed_at
           ),
           updated_at = GREATEST(measurement.updated_at, $3)
       WHERE measurement.household_id = $1 AND measurement.person_id = $2`,
      [householdId, personId, observedAt.toISOString()],
    );
  }

  private async recordHealth(
    executor: SqlExecutor,
    householdId: string,
    sourceId: string,
    now: Date,
  ): Promise<string> {
    const signals = await executor.query<HealthSignalRow>(
      `SELECT
         EXISTS (
           SELECT 1 FROM orientation_states orientation
           WHERE orientation.household_id = household.id AND orientation.status = 'ready'
         ) AS orientation_complete,
         EXISTS (
           SELECT 1 FROM analyses analysis
           WHERE analysis.household_id = household.id AND analysis.state = 'completed'
         ) AS check_completed,
         EXISTS (
           SELECT 1 FROM trusted_circle_relationships relationship
           JOIN consent_current_projections consent
             ON consent.household_id = relationship.household_id
            AND consent.consent_id = relationship.consent_id
            AND consent.latest_evidence_id = relationship.latest_consent_evidence_id
            AND consent.state = 'active'
           WHERE relationship.household_id = household.id AND relationship.state = 'active'
         ) AS trusted_circle_established,
         (
           SELECT count(*) FROM household_memberships membership
           WHERE membership.household_id = household.id AND membership.status = 'active'
         ) > 1 AS family_participation,
         EXISTS (
           SELECT 1 FROM sessions session
           JOIN household_memberships membership ON membership.person_id = session.person_id
           WHERE membership.household_id = household.id AND membership.status = 'active'
             AND session.audience = 'mobile' AND session.revoked_at IS NULL
         ) AS mobile_installed,
         EXISTS (
           SELECT 1 FROM commerce_subscriptions subscription
           WHERE subscription.household_id = household.id
             AND subscription.lifecycle IN ('grace','delinquent','paused','hold','refunded','disputed')
         ) AS payment_failed,
         EXISTS (
           SELECT 1 FROM commerce_subscriptions subscription
           WHERE subscription.household_id = household.id
             AND subscription.lifecycle = 'cancel_at_period_end'
         ) AS cancellation_intent,
         EXISTS (
           SELECT 1 FROM hq_work_cases work_case
           WHERE work_case.household_id = household.id
             AND work_case.case_kind IN ('fraud','security_privacy')
             AND work_case.severity IN ('high','critical')
             AND work_case.state IN ('open','triaged','in_progress')
         ) AS unresolved_incident,
         (
           SELECT count(*)::int FROM hq_work_cases work_case
           WHERE work_case.household_id = household.id
             AND work_case.case_kind IN ('support','billing')
             AND work_case.state IN ('open','triaged','in_progress')
         ) AS support_cases_open,
         COALESCE(
           (SELECT max(event.occurred_at) FROM outbox_events event WHERE event.household_id = household.id),
           household.created_at
         ) AS last_activity_at
       FROM households household WHERE household.id = $1`,
      [householdId],
    );
    const row = signals.rows[0];
    if (row === undefined) throw new Error('Household is unavailable for health calculation');
    const lastActivity = asDate(row.last_activity_at, 'growth_health.last_activity_at');
    const result = evaluateCustomerHealth({
      cancellationIntent: row.cancellation_intent,
      checkCompleted: row.check_completed,
      familyParticipation: row.family_participation,
      mobileInstalled: row.mobile_installed,
      orientationComplete: row.orientation_complete,
      paymentFailed: row.payment_failed,
      productInactiveDays: Math.max(
        0,
        Math.floor((now.getTime() - lastActivity.getTime()) / (24 * 60 * 60 * 1_000)),
      ),
      supportCasesOpen: row.support_cases_open,
      trustedCircleEstablished: row.trusted_circle_established,
      unresolvedIncident: row.unresolved_incident,
    });
    const snapshotId = this.ids.next('health');
    await executor.query(
      `INSERT INTO customer_health_snapshots(
         id, household_id, state, score, components, calculated_at, ruleset_version
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,'run2-growth-v1')`,
      [
        snapshotId,
        householdId,
        result.state,
        result.score,
        jsonParameter(result.components),
        now.toISOString(),
      ],
    );
    await this.reconcileHealthIntervention(
      executor,
      householdId,
      snapshotId,
      result,
      sourceId,
      now,
    );
    return snapshotId;
  }

  private async reconcileHealthIntervention(
    executor: SqlExecutor,
    householdId: string,
    snapshotId: string,
    health: CustomerHealthResult,
    sourceId: string,
    now: Date,
  ): Promise<void> {
    const existing = await executor.query<
      { work_case_id: string; state: 'open' | 'resolved' } & Record<string, unknown>
    >(
      `SELECT work_case_id, state FROM growth_health_interventions
       WHERE household_id = $1 FOR UPDATE`,
      [householdId],
    );
    const intervention = existing.rows[0];
    if (health.state === 'healthy') {
      if (intervention === undefined) return;
      if (intervention.state === 'resolved') {
        await executor.query(
          `UPDATE growth_health_interventions
           SET latest_snapshot_id = $2, latest_source_id = $3, updated_at = $4
           WHERE household_id = $1`,
          [householdId, snapshotId, sourceId, now.toISOString()],
        );
        return;
      }
      await executor.query(
        `UPDATE hq_work_cases
         SET state = 'resolved', resolved_at = $2, updated_at = $2
         WHERE id = $1 AND state IN ('open','triaged','in_progress')`,
        [intervention.work_case_id, now.toISOString()],
      );
      await executor.query(
        `UPDATE growth_health_interventions
         SET latest_snapshot_id = $2, latest_source_id = $3,
             state = 'resolved', updated_at = $4, resolved_at = $4
         WHERE household_id = $1`,
        [householdId, snapshotId, sourceId, now.toISOString()],
      );
      return;
    }
    const reasons = health.components
      .filter((component) => component.points < 0)
      .map((component) => component.code)
      .sort();
    const summary = `Customer health ${health.state}; signals: ${reasons.join(', ') || 'none'}.`;
    const severity = health.state === 'at_risk' ? 'high' : 'medium';
    const routingClass = health.state === 'at_risk' ? 'l1_human' : 'ai_assisted';
    if (intervention === undefined) {
      const workCaseId = this.ids.next('case');
      await executor.query(
        `INSERT INTO hq_work_cases(
           id, case_kind, household_id, severity, state, routing_class, summary,
           created_at, updated_at
         ) VALUES ($1,'customer_success',$2,$3,'open',$4,$5,$6,$6)`,
        [workCaseId, householdId, severity, routingClass, summary, now.toISOString()],
      );
      await executor.query(
        `INSERT INTO growth_health_interventions(
           household_id, work_case_id, latest_snapshot_id, latest_source_id,
           state, opened_at, updated_at
         ) VALUES ($1,$2,$3,$4,'open',$5,$5)`,
        [householdId, workCaseId, snapshotId, sourceId, now.toISOString()],
      );
      return;
    }
    await executor.query(
      `UPDATE hq_work_cases
       SET severity = $2, state = 'open', routing_class = $3, summary = $4,
           updated_at = $5, resolved_at = NULL
       WHERE id = $1`,
      [intervention.work_case_id, severity, routingClass, summary, now.toISOString()],
    );
    await executor.query(
      `UPDATE growth_health_interventions
       SET latest_snapshot_id = $2, latest_source_id = $3,
           state = 'open', updated_at = $4, resolved_at = NULL
       WHERE household_id = $1`,
      [householdId, snapshotId, sourceId, now.toISOString()],
    );
  }

  async projectDueLifecycle(input: {
    readonly limit: number;
    readonly now: Date;
  }): Promise<number> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) {
      throw new TypeError('Lifecycle projection batch is invalid');
    }
    const abandonedBefore = new Date(input.now.getTime() - 24 * 60 * 60 * 1_000);
    const trialEndingBy = new Date(input.now.getTime() + 3 * 24 * 60 * 60 * 1_000);
    const winBackBefore = new Date(input.now.getTime() - 30 * 24 * 60 * 60 * 1_000);
    const candidates: DueLifecycleCandidate[] = [];
    const abandoned = await this.database.query<
      { household_id: string; person_id: string; version: number } & Record<string, unknown>
    >(
      `SELECT household_id, person_id, version FROM orientation_states
       WHERE status = 'in_progress' AND updated_at <= $1
       ORDER BY updated_at, household_id, person_id LIMIT $2`,
      [abandonedBefore.toISOString(), input.limit],
    );
    for (const row of abandoned.rows) {
      candidates.push({
        householdId: row.household_id,
        recipientPersonId: row.person_id,
        trigger: 'orientation_abandoned',
        triggerEventId: `growth.orientation_abandoned:${row.household_id}:${row.person_id}:v${row.version}`,
      });
    }
    const missingSetup = await this.database.query<
      {
        household_id: string;
        person_id: string;
        missing_circle: boolean;
        missing_check: boolean;
      } & Record<string, unknown>
    >(
      `SELECT orientation.household_id, orientation.person_id,
         NOT EXISTS (
           SELECT 1 FROM trusted_circle_relationships relationship
           JOIN consent_current_projections consent
             ON consent.household_id = relationship.household_id
            AND consent.consent_id = relationship.consent_id
            AND consent.latest_evidence_id = relationship.latest_consent_evidence_id
            AND consent.state = 'active'
           WHERE relationship.household_id = orientation.household_id
             AND relationship.protected_person_id = orientation.person_id
             AND relationship.state = 'active'
         ) AS missing_circle,
         NOT EXISTS (
           SELECT 1 FROM analyses analysis
           WHERE analysis.household_id = orientation.household_id
             AND analysis.requested_by = orientation.person_id
             AND analysis.state = 'completed'
         ) AS missing_check
       FROM orientation_states orientation
       WHERE orientation.status = 'ready'
       ORDER BY orientation.updated_at, orientation.household_id, orientation.person_id
       LIMIT $1`,
      [input.limit],
    );
    for (const row of missingSetup.rows) {
      if (row.missing_circle) {
        candidates.push({
          householdId: row.household_id,
          recipientPersonId: row.person_id,
          trigger: 'trusted_circle_missing',
          triggerEventId: `growth.trusted_circle_missing:${row.household_id}:${row.person_id}:run2-v1`,
        });
      }
      if (row.missing_check) {
        candidates.push({
          householdId: row.household_id,
          recipientPersonId: row.person_id,
          trigger: 'practice_check_missing',
          triggerEventId: `growth.practice_check_missing:${row.household_id}:${row.person_id}:run2-v1`,
        });
      }
    }
    const commerce = await this.database.query<
      {
        household_id: string;
        id: string;
        lifecycle: string;
        current_period_ends_at: unknown | null;
        updated_at: unknown;
        person_id: string | null;
      } & Record<string, unknown>
    >(
      `SELECT subscription.household_id, subscription.id, subscription.lifecycle,
              subscription.current_period_ends_at, subscription.updated_at, payer.person_id
       FROM commerce_subscriptions subscription
       LEFT JOIN household_payers payer
         ON payer.household_id = subscription.household_id AND payer.status = 'active'
       WHERE (
         subscription.lifecycle = 'trialing'
         AND subscription.current_period_ends_at IS NOT NULL
         AND subscription.current_period_ends_at <= $1
       ) OR (
         subscription.lifecycle IN ('canceled','expired') AND subscription.updated_at <= $2
       )
       ORDER BY subscription.updated_at, subscription.household_id, subscription.id
       LIMIT $3`,
      [trialEndingBy.toISOString(), winBackBefore.toISOString(), input.limit],
    );
    for (const row of commerce.rows) {
      const recipient = row.person_id === null ? {} : { recipientPersonId: row.person_id };
      if (row.lifecycle === 'trialing' && row.current_period_ends_at !== null) {
        const periodEnd = asDate(row.current_period_ends_at, 'subscription.current_period_ends_at');
        candidates.push({
          householdId: row.household_id,
          ...recipient,
          trigger: 'trial_ending',
          triggerEventId: `growth.trial_ending:${row.household_id}:${row.id}:${periodEnd.toISOString()}`,
        });
      } else {
        const updatedAt = asDate(row.updated_at, 'subscription.updated_at');
        candidates.push({
          householdId: row.household_id,
          ...recipient,
          trigger: 'win_back_eligible',
          triggerEventId: `growth.win_back:${row.household_id}:${row.id}:${updatedAt.toISOString()}`,
        });
      }
    }
    let created = 0;
    for (const candidate of candidates
      .sort((left, right) => left.triggerEventId.localeCompare(right.triggerEventId))
      .slice(0, input.limit)) {
      const inserted = await this.database.transaction(async (transaction) => {
        await transaction.query('SELECT id FROM households WHERE id = $1 FOR UPDATE', [
          candidate.householdId,
        ]);
        const result = await this.startLifecycle(transaction, {
          householdId: candidate.householdId,
          ...(candidate.recipientPersonId === undefined
            ? {}
            : { recipientPersonId: candidate.recipientPersonId }),
          trigger: candidate.trigger,
          triggerEventId: candidate.triggerEventId,
          now: input.now,
        });
        if (candidate.trigger === 'orientation_abandoned') {
          await transaction.query(
            `UPDATE growth_orientation_measurements
             SET stalled_observed_at = COALESCE(stalled_observed_at, $3),
                 updated_at = GREATEST(updated_at, $3)
             WHERE household_id = $1 AND person_id = $2`,
            [candidate.householdId, candidate.recipientPersonId, input.now.toISOString()],
          );
        }
        return result;
      });
      if (inserted) created += 1;
    }
    return created;
  }

  async processReadyLifecycleNotifications(input: {
    readonly limit: number;
    readonly now: Date;
  }): Promise<LifecycleNotificationProgress> {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 500 ||
      !Number.isFinite(input.now.getTime())
    ) {
      throw new TypeError('Lifecycle notification batch is invalid');
    }
    const stepKeys = Object.keys(localLifecycleNotificationTemplates);
    const keyPlaceholders = placeholders(2, stepKeys.length);
    const candidates = await this.database.query<ReadyLifecycleNotificationRow>(
      `SELECT step.id AS step_id, step.workflow_id, step.step_key, step.step_order,
              workflow.household_id, workflow.recipient_person_id, workflow.consent_basis
       FROM lifecycle_steps step
       JOIN lifecycle_workflows workflow ON workflow.id = step.workflow_id
       WHERE workflow.state = 'active'
         AND step.state = 'ready'
         AND step.action_kind = 'approved_message'
         AND step.failure_code IS NULL
         AND step.scheduled_at <= $1
         AND step.step_key IN (${keyPlaceholders})
       ORDER BY step.scheduled_at, step.workflow_id, step.step_order
       LIMIT $${stepKeys.length + 2}`,
      [input.now.toISOString(), ...stepKeys, input.limit],
    );
    let materialized = 0;
    let completed = 0;
    let suppressed = 0;
    for (const candidate of candidates.rows) {
      const result = await this.database.transaction(async (transaction) => {
        const locked = await transaction.query<ReadyLifecycleNotificationRow>(
          `SELECT step.id AS step_id, step.workflow_id, step.step_key, step.step_order,
                  workflow.household_id, workflow.recipient_person_id, workflow.consent_basis
           FROM lifecycle_steps step
           JOIN lifecycle_workflows workflow ON workflow.id = step.workflow_id
           WHERE step.id = $1 AND workflow.state = 'active' AND step.state = 'ready'
             AND step.action_kind = 'approved_message' AND step.failure_code IS NULL
             AND step.scheduled_at <= $2
           FOR UPDATE OF step, workflow`,
          [candidate.step_id, input.now.toISOString()],
        );
        const step = locked.rows[0];
        if (step === undefined) return { materialized: false, completed: false, suppressed: false };
        const templateKey = localLifecycleNotificationTemplates[step.step_key];
        if (templateKey === undefined || step.consent_basis !== 'transactional_lifecycle') {
          return { materialized: false, completed: false, suppressed: false };
        }
        if (step.recipient_person_id === null) {
          await this.suppressLifecycleNotification(
            transaction,
            step,
            'recipient_unavailable',
            input.now,
          );
          return { materialized: false, completed: false, suppressed: true };
        }
        const activeMembership = await transaction.query(
          `SELECT 1 FROM household_memberships
           WHERE household_id = $1 AND person_id = $2 AND status = 'active'`,
          [step.household_id, step.recipient_person_id],
        );
        if (activeMembership.rowCount !== 1) {
          await this.suppressLifecycleNotification(
            transaction,
            step,
            'recipient_unavailable',
            input.now,
          );
          return { materialized: false, completed: false, suppressed: true };
        }
        if (await this.hasLifecycleSuppression(transaction, step.recipient_person_id, input.now)) {
          await this.suppressLifecycleNotification(
            transaction,
            step,
            'communication_suppressed',
            input.now,
          );
          return { materialized: false, completed: false, suppressed: true };
        }
        const requestId = `lifecycle-notification:${step.step_id}`;
        const request = await createNotificationRequestWithExecutor(transaction, requestId, {
          householdId: step.household_id,
          recipientPersonId: step.recipient_person_id,
          templateKey,
          channel: 'local_test',
          consentBasis: 'transactional_lifecycle',
          now: input.now,
        });
        const jobKey = `notification.dispatch:lifecycle:${step.step_id}`;
        const job = await enqueueDurableJobWithExecutor(transaction, this.ids, {
          type: 'notification.dispatch',
          householdId: step.household_id,
          payload: { requestId },
          idempotencyKey: jobKey,
          scheduledAt: input.now,
          maxAttempts: 8,
          correlationId: jobKey,
          causationId: step.workflow_id,
        });
        const receipt = await transaction.query<LifecycleNotificationReceiptRow>(
          `WITH RECURSIVE notification_jobs AS (
             SELECT job.id, job.state, job.household_id, job.classification,
                    job.payload_hash
             FROM durable_jobs job
             WHERE job.job_type = 'notification.dispatch'
               AND job.idempotency_key = $2
               AND job.household_id = $3
               AND job.causation_id = $4
               AND job.payload ->> 'requestId' = $1
             UNION ALL
             SELECT replay.id, replay.state, replay.household_id, replay.classification,
                    replay.payload_hash
             FROM durable_jobs replay
             JOIN notification_jobs prior ON replay.replay_of_job_id = prior.id
             WHERE replay.job_type = 'notification.dispatch'
               AND replay.household_id = prior.household_id
               AND replay.classification = prior.classification
               AND replay.payload_hash = prior.payload_hash
               AND replay.payload ->> 'requestId' = $1
           ), delivered AS (
             SELECT job.state, evidence.outcome, evidence.observed_at
             FROM notification_jobs job
             JOIN operational_job_evidence evidence
               ON evidence.job_id = job.id AND evidence.evidence_kind = 'notification_dispatch'
             WHERE job.state = 'succeeded' AND evidence.outcome = 'test_delivered'
             ORDER BY evidence.observed_at, job.id
             LIMIT 1
           )
           SELECT request.state AS request_state, delivered.state AS job_state,
                  delivered.outcome AS evidence_outcome, delivered.observed_at
           FROM notification_dispatch_requests request
           LEFT JOIN delivered ON true
           WHERE request.id = $1`,
          [requestId, jobKey, step.household_id, step.workflow_id],
        );
        const delivery = receipt.rows[0];
        const delivered =
          delivery?.request_state === 'test_delivered' &&
          delivery.job_state === 'succeeded' &&
          delivery.evidence_outcome === 'test_delivered';
        if (delivered) {
          const completedAt =
            delivery.observed_at === null
              ? input.now
              : asDate(delivery.observed_at, 'operational_job_evidence.observed_at');
          const updated = await transaction.query(
            `UPDATE lifecycle_steps
             SET state = 'completed', completed_at = $2
             WHERE id = $1 AND state = 'ready'`,
            [step.step_id, completedAt.toISOString()],
          );
          if (updated.rowCount === 1) {
            const hasNext = await this.advanceAfterLifecycleStep(
              transaction,
              step.workflow_id,
              step.step_order,
              completedAt,
            );
            if (hasNext) {
              await this.advanceInternalLifecycle(transaction, step.workflow_id, completedAt);
            }
          }
          return {
            materialized: !request.duplicate || !job.duplicate,
            completed: updated.rowCount === 1,
            suppressed: false,
          };
        }
        return {
          materialized: !request.duplicate || !job.duplicate,
          completed: false,
          suppressed: false,
        };
      });
      if (result.materialized) materialized += 1;
      if (result.completed) completed += 1;
      if (result.suppressed) suppressed += 1;
    }
    return { materialized, completed, suppressed };
  }

  async recalculateStaleHealth(input: {
    readonly limit: number;
    readonly now: Date;
  }): Promise<number> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) {
      throw new TypeError('Health projection batch is invalid');
    }
    const staleBefore = new Date(input.now.getTime() - 24 * 60 * 60 * 1_000);
    const households = await this.database.query<{ id: string } & Record<string, unknown>>(
      `SELECT household.id FROM households household
       LEFT JOIN LATERAL (
         SELECT calculated_at FROM customer_health_snapshots snapshot
         WHERE snapshot.household_id = household.id
         ORDER BY calculated_at DESC LIMIT 1
       ) latest ON true
       WHERE latest.calculated_at IS NULL OR latest.calculated_at <= $1
       ORDER BY latest.calculated_at NULLS FIRST, household.id
       LIMIT $2`,
      [staleBefore.toISOString(), input.limit],
    );
    let calculated = 0;
    for (const household of households.rows) {
      const inserted = await this.database.transaction(async (transaction) => {
        await transaction.query('SELECT id FROM households WHERE id = $1 FOR UPDATE', [
          household.id,
        ]);
        const latest = await transaction.query<
          { calculated_at: unknown } & Record<string, unknown>
        >(
          `SELECT calculated_at FROM customer_health_snapshots
           WHERE household_id = $1 ORDER BY calculated_at DESC LIMIT 1`,
          [household.id],
        );
        const latestAt = latest.rows[0]?.calculated_at;
        if (
          latestAt !== undefined &&
          asDate(latestAt, 'customer_health_snapshots.calculated_at') > staleBefore
        ) {
          return false;
        }
        await this.recordHealth(
          transaction,
          household.id,
          `health-sweep:${input.now.toISOString().slice(0, 10)}`,
          input.now,
        );
        return true;
      });
      if (inserted) calculated += 1;
    }
    return calculated;
  }

  async orientationMeasurements(
    householdId?: string,
  ): Promise<readonly OrientationGrowthMeasurement[]> {
    const result = await this.database.query<
      {
        household_id: string;
        person_id: string;
        started_at: unknown | null;
        last_step_at: unknown | null;
        completed_at: unknown | null;
        attention_observed_at: unknown | null;
        stalled_observed_at: unknown | null;
        first_check_after_start_at: unknown | null;
        first_check_after_completion_at: unknown | null;
        updated_at: unknown;
      } & Record<string, unknown>
    >(
      `SELECT household_id, person_id, started_at, last_step_at, completed_at,
              attention_observed_at, stalled_observed_at, first_check_after_start_at,
              first_check_after_completion_at, updated_at
       FROM growth_orientation_measurements
       WHERE ($1::text IS NULL OR household_id = $1)
       ORDER BY household_id, person_id`,
      [householdId ?? null],
    );
    return result.rows.map((row) => ({
      householdId: row.household_id,
      personId: row.person_id,
      ...(row.started_at === null ? {} : { startedAt: asDate(row.started_at, 'started_at') }),
      ...(row.last_step_at === null
        ? {}
        : { lastStepAt: asDate(row.last_step_at, 'last_step_at') }),
      ...(row.completed_at === null
        ? {}
        : { completedAt: asDate(row.completed_at, 'completed_at') }),
      ...(row.attention_observed_at === null
        ? {}
        : { attentionObservedAt: asDate(row.attention_observed_at, 'attention_observed_at') }),
      ...(row.stalled_observed_at === null
        ? {}
        : { stalledObservedAt: asDate(row.stalled_observed_at, 'stalled_observed_at') }),
      ...(row.first_check_after_start_at === null
        ? {}
        : {
            firstCheckAfterStartAt: asDate(
              row.first_check_after_start_at,
              'first_check_after_start_at',
            ),
          }),
      ...(row.first_check_after_completion_at === null
        ? {}
        : {
            firstCheckAfterCompletionAt: asDate(
              row.first_check_after_completion_at,
              'first_check_after_completion_at',
            ),
          }),
      updatedAt: asDate(row.updated_at, 'updated_at'),
    }));
  }
}
