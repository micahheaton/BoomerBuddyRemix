import {
  authorizeAutomation,
  canTransitionReferral,
  canTransitionOpportunity,
  evaluateContentForPublication,
  evaluateCustomerHealth,
  evaluateOpportunityHygiene,
  evaluateReferralReward,
  lifecyclePlan,
  routeSupportCase,
  sanitizeAttribution,
  isAutoEligibleAction,
  isAutoPolicyWithinBoundary,
  type AcquisitionMilestone,
  type AutomationPolicy,
  type AutomationRequest,
  type CreditUnionRecord,
  type CustomerHealthSignals,
  type LifecycleTrigger,
  type OpportunityStage,
  type RawAttribution,
  type ReferralRewardPolicy,
  type ReferralState,
} from '@boomerbuddy/business-os';
import { detectRestrictedInput } from '@boomerbuddy/security';

import type { Database, SqlExecutor } from './database';
import { writeAuditAndOutbox, type OperationalEventContext } from './events';
import {
  asDate,
  jsonParameter,
  jsonValue,
  randomIdFactory,
  stringArray,
  type IdFactory,
} from './values';

export interface NcuaImportInput {
  readonly records: readonly CreditUnionRecord[];
  readonly provenance: {
    readonly cycleDate: string;
    readonly downloadedAt: Date;
    readonly sha256: string;
    readonly sourceUrl: string;
  };
  readonly context: OperationalEventContext;
}

export interface NcuaImportResult {
  readonly imported: boolean;
  readonly organizationCount: number;
  readonly snapshotId: string;
}

interface SnapshotRow extends Record<string, unknown> {
  readonly id: string;
  readonly row_count: number;
}

interface CreditUnionRow extends Record<string, unknown> {
  readonly snapshot_id: string;
  readonly charter_number: number;
  readonly internal_join_number: number;
  readonly name: string;
  readonly city: string;
  readonly state: string;
  readonly charter_state: string;
  readonly zip_code: string;
  readonly ncua_region: string;
  readonly source_type_code: string;
  readonly low_income_designation: boolean;
  readonly peer_group: number;
  readonly members: number;
  readonly assets: number;
  readonly loans: number;
  readonly deposits: number;
  readonly member_segment: CreditUnionRecord['memberSegment'];
  readonly fit_score: number;
  readonly fit_reasons: unknown;
}

interface OpportunityRow extends Record<string, unknown> {
  readonly id: string;
  readonly organization_id: string;
  readonly organization_name: string;
  readonly name: string;
  readonly stage: OpportunityStage;
  readonly owner_person_id: string | null;
  readonly next_action: string | null;
  readonly next_action_at: unknown | null;
  readonly last_meaningful_activity_at: unknown;
  readonly snoozed_until: unknown | null;
  readonly suppression_reason: string | null;
}

interface AttentionRow extends Record<string, unknown> {
  readonly id: string;
  readonly attention_kind: string;
  readonly source_type: string;
  readonly source_id: string;
  readonly why_founder_required: string;
  readonly recommended_action: string;
  readonly consequence_of_inaction: string;
  readonly deadline: unknown | null;
  readonly state: 'open' | 'snoozed' | 'resolved' | 'dismissed';
  readonly created_at: unknown;
  readonly updated_at: unknown;
}

export type PrivacyPlanKind =
  'access_summary' | 'export_manifest' | 'deletion_plan' | 'correction_plan' | 'restriction_plan';

export interface PrivacyRequestRecord {
  readonly id: string;
  readonly personId?: string;
  readonly householdId?: string;
  readonly requestKind: 'access' | 'export' | 'delete' | 'correct' | 'restrict';
  readonly identityVerificationState: 'pending' | 'verified' | 'failed';
  readonly state: 'received' | 'verified' | 'in_progress' | 'completed' | 'denied';
  readonly dueAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt?: Date;
  readonly plan?: {
    readonly kind: PrivacyPlanKind;
    readonly dataCategories: readonly string[];
    readonly recordCounts: Readonly<Record<string, number>>;
    readonly requiresProfessionalReview: boolean;
    readonly createdAt: Date;
  };
}

interface PrivacyRequestRow extends Record<string, unknown> {
  readonly id: string;
  readonly person_id: string | null;
  readonly household_id: string | null;
  readonly request_kind: PrivacyRequestRecord['requestKind'];
  readonly identity_verification_state: PrivacyRequestRecord['identityVerificationState'];
  readonly state: PrivacyRequestRecord['state'];
  readonly due_at: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly completed_at: unknown | null;
  readonly plan_kind: PrivacyPlanKind | null;
  readonly data_categories: unknown | null;
  readonly record_counts: unknown | null;
  readonly requires_professional_review: boolean | null;
  readonly plan_created_at: unknown | null;
}

type PrivacyEventContext = OperationalEventContext & {
  readonly actorPersonId: string;
  readonly audience: 'customer' | 'mobile' | 'hq';
};

interface PolicyRow extends Record<string, unknown> {
  readonly id: string;
  readonly action_key: string;
  readonly autonomy_class: AutomationPolicy['autonomy'];
  readonly allowed_data_classes: unknown;
  readonly allowed_tools: unknown;
  readonly max_cost_per_operation_cents: number;
  readonly requires_audit: boolean;
  readonly enabled: boolean;
}

const codePattern = /^[a-z][a-z0-9_.-]{1,79}$/u;

function assertCode(value: string, field: string): void {
  if (!codePattern.test(value)) throw new TypeError(`Invalid ${field}`);
}

async function databaseAuthorityNow(transaction: SqlExecutor): Promise<Date> {
  const result = await transaction.query<{ authority_now: unknown } & Record<string, unknown>>(
    'SELECT clock_timestamp() AS authority_now',
  );
  return asDate(result.rows[0]?.authority_now, 'database authority time');
}

async function lockFounderAutomationAuthority(
  transaction: SqlExecutor,
  configuredFounderPersonId: string | undefined,
  actorPersonId: string,
): Promise<void> {
  if (configuredFounderPersonId === undefined || actorPersonId !== configuredFounderPersonId) {
    throw new TypeError('Automation control mutation requires the configured founder identity');
  }
  const assignment = await transaction.query(
    `SELECT employee.id
     FROM employee_assignments employee
     JOIN organizations organization ON organization.id = employee.organization_id
     WHERE employee.person_id = $1
       AND employee.role = 'hq_owner' AND employee.status = 'active'
       AND organization.kind = 'internal'
     ORDER BY employee.id LIMIT 1
     FOR UPDATE OF employee, organization`,
    [actorPersonId],
  );
  if (assignment.rows[0] === undefined) {
    throw new TypeError('Automation control mutation requires an active founder owner assignment');
  }
}

function mapCreditUnion(row: CreditUnionRow): CreditUnionRecord {
  return {
    assets: Number(row.assets),
    charterNumber: row.charter_number,
    charterState: row.charter_state,
    city: row.city,
    deposits: Number(row.deposits),
    fitReasons: [...stringArray(row.fit_reasons, 'ncua_credit_unions.fit_reasons')],
    fitScore: row.fit_score,
    internalJoinNumber: row.internal_join_number,
    loans: Number(row.loans),
    lowIncomeDesignation: row.low_income_designation,
    memberSegment: row.member_segment,
    members: Number(row.members),
    name: row.name,
    ncuaRegion: row.ncua_region,
    peerGroup: row.peer_group,
    sourceTypeCode: row.source_type_code,
    state: row.state,
    zipCode: row.zip_code,
  };
}

function numericRecord(value: unknown, field: string): Readonly<Record<string, number>> {
  const parsed = jsonValue(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`Invalid ${field}`);
  }
  const result: Record<string, number> = {};
  for (const [key, count] of Object.entries(parsed)) {
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new TypeError(`Invalid ${field}`);
    }
    result[key] = count;
  }
  return result;
}

function mapPrivacyRequest(row: PrivacyRequestRow): PrivacyRequestRecord {
  const base: PrivacyRequestRecord = {
    id: row.id,
    ...(row.person_id === null ? {} : { personId: row.person_id }),
    ...(row.household_id === null ? {} : { householdId: row.household_id }),
    requestKind: row.request_kind,
    identityVerificationState: row.identity_verification_state,
    state: row.state,
    dueAt: asDate(row.due_at, 'privacy_requests.due_at'),
    createdAt: asDate(row.created_at, 'privacy_requests.created_at'),
    updatedAt: asDate(row.updated_at, 'privacy_requests.updated_at'),
    ...(row.completed_at === null
      ? {}
      : { completedAt: asDate(row.completed_at, 'privacy_requests.completed_at') }),
  };
  if (
    row.plan_kind === null ||
    row.data_categories === null ||
    row.record_counts === null ||
    row.requires_professional_review === null ||
    row.plan_created_at === null
  ) {
    return base;
  }
  return {
    ...base,
    plan: {
      kind: row.plan_kind,
      dataCategories: stringArray(
        jsonValue(row.data_categories),
        'privacy_request_plans.data_categories',
      ),
      recordCounts: numericRecord(row.record_counts, 'privacy_request_plans.record_counts'),
      requiresProfessionalReview: row.requires_professional_review,
      createdAt: asDate(row.plan_created_at, 'privacy_request_plans.created_at'),
    },
  };
}

export class BusinessOsRepository {
  constructor(
    private readonly database: Database,
    private readonly ids: IdFactory = randomIdFactory,
    private readonly founderPersonId?: string,
  ) {}

  async recordAttribution(input: {
    readonly attribution: RawAttribution;
    readonly milestone: AcquisitionMilestone;
    readonly now: Date;
    readonly subjectId: string;
    readonly subjectKind: 'anonymous_context' | 'person' | 'household';
  }): Promise<string> {
    const sanitized = sanitizeAttribution(input.attribution);
    const id = this.ids.next('touch');
    await this.database.query(
      `INSERT INTO acquisition_touchpoints(
         id, subject_kind, subject_id, channel, milestone, source_token, medium_token,
         campaign_token, content_token, partner_token, referrer_host, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        input.subjectKind,
        input.subjectId,
        sanitized.channel,
        input.milestone,
        sanitized.source ?? null,
        sanitized.medium ?? null,
        sanitized.campaign ?? null,
        sanitized.content ?? null,
        sanitized.partner ?? null,
        sanitized.referrerHost ?? null,
        input.now.toISOString(),
      ],
    );
    return id;
  }

  async createContentSource(input: {
    readonly canonicalUrl?: string;
    readonly capturedAt: Date;
    readonly createdByPersonId?: string;
    readonly evidenceState: 'candidate' | 'verified' | 'rejected' | 'retired';
    readonly freshUntil?: Date;
    readonly sourceFingerprint: string;
    readonly sourceKind: 'official' | 'adjudicated_incident' | 'founder_original' | 'partner';
    readonly title: string;
  }): Promise<string> {
    const id = this.ids.next('content_source');
    await this.database.query(
      `INSERT INTO content_sources(
         id, source_kind, title, canonical_url, source_fingerprint, evidence_state,
         captured_at, fresh_until, created_by_person_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        input.sourceKind,
        input.title,
        input.canonicalUrl ?? null,
        input.sourceFingerprint,
        input.evidenceState,
        input.capturedAt.toISOString(),
        input.freshUntil?.toISOString() ?? null,
        input.createdByPersonId ?? null,
      ],
    );
    return id;
  }

  async createContentItem(input: {
    readonly claimFlags: readonly ('unsupported_statistics' | 'unverified_urgency')[];
    readonly contentKind:
      | 'scam_page'
      | 'explainer'
      | 'alert'
      | 'newsletter'
      | 'social_draft'
      | 'faq'
      | 'video_talking_points'
      | 'founder_derivative';
    readonly createdAt: Date;
    readonly createdByPersonId?: string;
    readonly evidence: readonly { readonly sourceId: string; readonly supportedClaim: string }[];
    readonly founderSourceId?: string;
    readonly sourceContentItemId?: string;
    readonly title: string;
  }): Promise<string> {
    const id = this.ids.next('content');
    await this.database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO governed_content_items(
           id, content_kind, title, review_state, source_content_item_id, founder_source_id,
           claim_flags, created_by_person_id, created_at
         ) VALUES ($1,$2,$3,'draft',$4,$5,$6::jsonb,$7,$8)`,
        [
          id,
          input.contentKind,
          input.title,
          input.sourceContentItemId ?? null,
          input.founderSourceId ?? null,
          jsonParameter(input.claimFlags),
          input.createdByPersonId ?? null,
          input.createdAt.toISOString(),
        ],
      );
      for (const evidence of input.evidence) {
        await transaction.query(
          `INSERT INTO governed_content_evidence(content_item_id, source_id, supported_claim)
           VALUES ($1,$2,$3)`,
          [id, evidence.sourceId, evidence.supportedClaim],
        );
      }
    });
    return id;
  }

  async submitContentForReview(input: {
    readonly contentItemId: string;
    readonly founderApproval: boolean;
  }): Promise<void> {
    const state = input.founderApproval ? 'founder_approval' : 'evidence_review';
    const result = await this.database.query(
      `UPDATE governed_content_items SET review_state = $2
       WHERE id = $1 AND review_state = 'draft'`,
      [input.contentItemId, state],
    );
    if (result.rowCount !== 1) throw new Error('Content item is not in draft state');
  }

  async approveContent(input: {
    readonly approvedAt: Date;
    readonly approvedByPersonId: string;
    readonly contentItemId: string;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const item = await transaction.query<
        {
          claim_flags: unknown;
          review_state: 'evidence_review' | 'founder_approval';
        } & Record<string, unknown>
      >(
        `SELECT claim_flags, review_state FROM governed_content_items
         WHERE id = $1 AND review_state IN ('evidence_review','founder_approval')
         FOR UPDATE`,
        [input.contentItemId],
      );
      const itemRow = item.rows[0];
      if (itemRow === undefined) throw new Error('Content item is not ready for approval');
      const evidence = await transaction.query<
        { evidence_count: number; stale_count: number } & Record<string, unknown>
      >(
        `SELECT count(evidence.source_id)::int AS evidence_count,
                count(evidence.source_id) FILTER (
                  WHERE source.evidence_state <> 'verified'
                     OR (source.fresh_until IS NOT NULL AND source.fresh_until <= $2)
                )::int AS stale_count
         FROM governed_content_evidence evidence
         JOIN content_sources source ON source.id = evidence.source_id
         WHERE evidence.content_item_id = $1`,
        [input.contentItemId, input.approvedAt.toISOString()],
      );
      const evidenceRow = evidence.rows[0] ?? { evidence_count: 0, stale_count: 0 };
      const claimFlags = stringArray(itemRow.claim_flags, 'governed_content_items.claim_flags');
      const decision = evaluateContentForPublication({
        evidenceCount: evidenceRow.stale_count > 0 ? 0 : evidenceRow.evidence_count,
        hasUnsupportedStatistics: claimFlags.includes('unsupported_statistics'),
        hasUnverifiedUrgency: claimFlags.includes('unverified_urgency'),
        reviewState: 'approved',
      });
      if (!decision.publishable) throw new Error(decision.reasons.join(' '));
      await transaction.query(
        `UPDATE governed_content_items
         SET review_state = 'approved', approved_by_person_id = $2, approved_at = $3
         WHERE id = $1`,
        [input.contentItemId, input.approvedByPersonId, input.approvedAt.toISOString()],
      );
    });
  }

  async createReferral(input: {
    readonly attributionTouchpointId?: string;
    readonly createdAt: Date;
    readonly referredHouseholdId?: string;
    readonly referredPersonId?: string;
    readonly referralKind: 'family_invitation' | 'trusted_circle' | 'friend' | 'gift_trial';
    readonly referrerHouseholdId?: string;
    readonly referrerPersonId?: string;
  }): Promise<string> {
    if (input.referrerPersonId === undefined && input.referrerHouseholdId === undefined) {
      throw new TypeError('Referral requires a referrer.');
    }
    const id = this.ids.next('referral');
    await this.database.query(
      `INSERT INTO referrals(
         id, referral_kind, referrer_person_id, referrer_household_id,
         referred_person_id, referred_household_id, attribution_touchpoint_id,
         state, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'created',$8)`,
      [
        id,
        input.referralKind,
        input.referrerPersonId ?? null,
        input.referrerHouseholdId ?? null,
        input.referredPersonId ?? null,
        input.referredHouseholdId ?? null,
        input.attributionTouchpointId ?? null,
        input.createdAt.toISOString(),
      ],
    );
    return id;
  }

  async transitionReferral(input: {
    readonly at: Date;
    readonly nextState: ReferralState;
    readonly referralId: string;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const result = await transaction.query<{ state: ReferralState } & Record<string, unknown>>(
        'SELECT state FROM referrals WHERE id = $1 FOR UPDATE',
        [input.referralId],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('Referral not found');
      if (!canTransitionReferral(row.state, input.nextState)) {
        throw new Error(`Invalid referral transition ${row.state} -> ${input.nextState}`);
      }
      const timestampColumn =
        input.nextState === 'accepted'
          ? 'accepted_at'
          : input.nextState === 'activated'
            ? 'activated_at'
            : input.nextState === 'paid'
              ? 'paid_at'
              : undefined;
      if (timestampColumn === undefined) {
        await transaction.query('UPDATE referrals SET state = $2 WHERE id = $1', [
          input.referralId,
          input.nextState,
        ]);
      } else {
        await transaction.query(
          `UPDATE referrals SET state = $2, ${timestampColumn} = $3 WHERE id = $1`,
          [input.referralId, input.nextState, input.at.toISOString()],
        );
      }
    });
  }

  async approveReferralReward(input: {
    readonly amountMinor: number;
    readonly approvedByPersonId: string;
    readonly createdAt: Date;
    readonly currency: string;
    readonly policy: ReferralRewardPolicy;
    readonly priorAwards: number;
    readonly referralId: string;
    readonly referredHouseholdActivated: boolean;
  }): Promise<string | undefined> {
    const decision = evaluateReferralReward(
      input.policy,
      input.priorAwards,
      input.referredHouseholdActivated,
    );
    if (!decision.award || input.policy.rewardCode === undefined) return undefined;
    const id = this.ids.next('reward');
    await this.database.query(
      `INSERT INTO referral_reward_ledger(
         id, referral_id, reward_code, disposition, approved_by_person_id,
         amount_minor, currency, reason, created_at
       ) VALUES ($1,$2,$3,'approved',$4,$5,$6,$7,$8)`,
      [
        id,
        input.referralId,
        input.policy.rewardCode,
        input.approvedByPersonId,
        input.amountMinor,
        input.currency,
        decision.reason,
        input.createdAt.toISOString(),
      ],
    );
    return id;
  }

  async startLifecycle(input: {
    readonly householdId: string;
    readonly marketingConsented: boolean;
    readonly now: Date;
    readonly trigger: LifecycleTrigger;
    readonly triggerEventId?: string;
  }): Promise<string> {
    const workflowKind =
      input.trigger === 'signup' || input.trigger === 'incomplete_signup'
        ? 'signup'
        : input.trigger.includes('orientation')
          ? 'orientation'
          : input.trigger.includes('trial')
            ? 'trial'
            : input.trigger.includes('payment')
              ? 'payment_recovery'
              : input.trigger === 'renewal'
                ? 'renewal'
                : input.trigger.includes('cancel')
                  ? 'cancellation'
                  : input.trigger === 'win_back_eligible'
                    ? 'win_back'
                    : input.trigger === 'referral_success'
                      ? 'referral'
                      : 'activation';
    const steps = lifecyclePlan(input.trigger, input.marketingConsented);
    const workflowId = this.ids.next('lifecycle');
    return this.database.transaction(async (transaction) => {
      if (input.triggerEventId !== undefined) {
        const existing = await transaction.query<{ id: string } & Record<string, unknown>>(
          'SELECT id FROM lifecycle_workflows WHERE trigger_event_id = $1',
          [input.triggerEventId],
        );
        const row = existing.rows[0];
        if (row !== undefined) return row.id;
      }
      await transaction.query(
        `INSERT INTO lifecycle_workflows(
           id, household_id, workflow_kind, state, trigger_event_id, current_step_key,
           consent_basis, started_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
        [
          workflowId,
          input.householdId,
          workflowKind,
          steps.length === 0 ? 'suppressed' : 'active',
          input.triggerEventId ?? null,
          steps[0]?.key ?? null,
          input.marketingConsented ? 'marketing_opt_in' : 'transactional_or_internal_only',
          input.now.toISOString(),
        ],
      );
      for (const [index, step] of steps.entries()) {
        await transaction.query(
          `INSERT INTO lifecycle_steps(
             id, workflow_id, step_key, action_kind, state, scheduled_at
           ) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            this.ids.next('lifecycle_step'),
            workflowId,
            step.key,
            step.actionKind,
            index === 0 ? 'ready' : 'pending',
            input.now.toISOString(),
          ],
        );
      }
      return workflowId;
    });
  }

  async suppressCommunication(input: {
    readonly channel: 'email' | 'sms' | 'phone' | 'all';
    readonly effectiveAt: Date;
    readonly reason: string;
    readonly scope: 'transactional' | 'lifecycle' | 'b2b' | 'all';
    readonly source: string;
    readonly subjectId: string;
    readonly subjectKind: 'person' | 'contact' | 'organization' | 'address';
  }): Promise<string> {
    const id = this.ids.next('suppression');
    await this.database.query(
      `INSERT INTO communication_suppressions(
         id, subject_kind, subject_id, channel, scope, reason, source, effective_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        input.subjectKind,
        input.subjectId,
        input.channel,
        input.scope,
        input.reason,
        input.source,
        input.effectiveAt.toISOString(),
      ],
    );
    return id;
  }

  async createWorkCase(input: {
    readonly assignedPersonId?: string;
    readonly category:
      'account' | 'billing' | 'fraud' | 'navigation' | 'orientation' | 'security_privacy';
    readonly dueAt?: Date;
    readonly executiveEscalation: boolean;
    readonly householdId?: string;
    readonly needsArtifactAccess: boolean;
    readonly now: Date;
    readonly organizationId?: string;
    readonly safetySeverity: 'none' | 'low' | 'high';
    readonly severity: 'low' | 'medium' | 'high' | 'critical';
    readonly summary: string;
  }): Promise<string> {
    const routingClass = routeSupportCase(input);
    const caseKind =
      input.category === 'security_privacy'
        ? 'security_privacy'
        : input.category === 'billing'
          ? 'billing'
          : input.category === 'fraud'
            ? 'fraud'
            : 'support';
    const id = this.ids.next('case');
    await this.database.query(
      `INSERT INTO hq_work_cases(
         id, case_kind, household_id, organization_id, severity, state, routing_class,
         summary, assigned_person_id, due_at, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9,$10,$10)`,
      [
        id,
        caseKind,
        input.householdId ?? null,
        input.organizationId ?? null,
        input.severity,
        routingClass,
        input.summary,
        input.assignedPersonId ?? null,
        input.dueAt?.toISOString() ?? null,
        input.now.toISOString(),
      ],
    );
    return id;
  }

  async importNcuaSnapshot(input: NcuaImportInput): Promise<NcuaImportResult> {
    if (!/^[A-Fa-f0-9]{64}$/u.test(input.provenance.sha256)) {
      throw new TypeError('Invalid NCUA snapshot SHA-256');
    }
    const existing = await this.database.query<SnapshotRow>(
      `SELECT id, row_count FROM ncua_snapshots
       WHERE cycle_date = $1::date AND lower(source_sha256) = lower($2)`,
      [input.provenance.cycleDate, input.provenance.sha256],
    );
    const existingRow = existing.rows[0];
    if (existingRow !== undefined) {
      return {
        imported: false,
        organizationCount: existingRow.row_count,
        snapshotId: existingRow.id,
      };
    }

    const snapshotId = this.ids.next('ncua_snapshot');
    await this.database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO ncua_snapshots(
           id, cycle_date, source_url, source_sha256, downloaded_at, imported_at, row_count, state
         ) VALUES ($1,$2::date,$3,$4,$5,$6,$7,'imported')`,
        [
          snapshotId,
          input.provenance.cycleDate,
          input.provenance.sourceUrl,
          input.provenance.sha256.toLowerCase(),
          input.provenance.downloadedAt.toISOString(),
          input.context.now.toISOString(),
          input.records.length,
        ],
      );
      for (const record of input.records) {
        await transaction.query(
          `INSERT INTO ncua_credit_unions(
             snapshot_id, charter_number, internal_join_number, name, city, state,
             charter_state, zip_code, ncua_region, source_type_code,
             low_income_designation, peer_group, members, assets, loans, deposits,
             member_segment, fit_score, fit_reasons
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)`,
          [
            snapshotId,
            record.charterNumber,
            record.internalJoinNumber,
            record.name,
            record.city,
            record.state,
            record.charterState,
            record.zipCode,
            record.ncuaRegion,
            record.sourceTypeCode,
            record.lowIncomeDesignation,
            record.peerGroup,
            record.members,
            record.assets,
            record.loans,
            record.deposits,
            record.memberSegment,
            record.fitScore,
            jsonParameter(record.fitReasons),
          ],
        );
        const externalId = String(record.charterNumber);
        await transaction.query(
          `INSERT INTO crm_organizations(
             id, name, organization_kind, verification_state, source_name,
             source_external_id, source_snapshot_id, source_charter_number,
             attributes, created_at, updated_at
           ) VALUES ($1,$2,'credit_union','public_source','ncua',$3,$4,$5,$6::jsonb,$7,$7)
           ON CONFLICT (source_name, source_external_id) WHERE source_external_id IS NOT NULL
           DO UPDATE SET name = excluded.name, verification_state = 'public_source',
             source_snapshot_id = excluded.source_snapshot_id,
             source_charter_number = excluded.source_charter_number,
             attributes = excluded.attributes, updated_at = excluded.updated_at`,
          [
            this.ids.next('crm_org'),
            record.name,
            externalId,
            snapshotId,
            record.charterNumber,
            jsonParameter({
              assets: record.assets,
              fitReasons: record.fitReasons,
              fitScore: record.fitScore,
              members: record.members,
              segment: record.memberSegment,
              state: record.state,
            }),
            input.context.now.toISOString(),
          ],
        );
      }
      await writeAuditAndOutbox(
        transaction,
        this.ids,
        input.context,
        {
          action: 'business_os.ncua_snapshot_imported',
          resourceType: 'ncua_snapshot',
          resourceId: snapshotId,
          outcome: 'completed',
          metadata: { rowCount: input.records.length },
        },
        {
          eventType: 'business_os.ncua_snapshot_imported',
          aggregateType: 'ncua_snapshot',
          aggregateId: snapshotId,
          payload: { rowCount: input.records.length },
        },
      );
    });
    return { imported: true, organizationCount: input.records.length, snapshotId };
  }

  async creditUnionTargets(
    input: {
      readonly limit?: number;
      readonly memberSegment?: CreditUnionRecord['memberSegment'];
      readonly minimumFitScore?: number;
    } = {},
  ): Promise<readonly CreditUnionRecord[]> {
    const limit = Math.min(500, Math.max(1, input.limit ?? 100));
    const result = await this.database.query<CreditUnionRow>(
      `SELECT cu.* FROM ncua_credit_unions cu
       JOIN ncua_snapshots snapshot ON snapshot.id = cu.snapshot_id
       WHERE snapshot.state = 'imported'
         AND ($1::text IS NULL OR cu.member_segment = $1)
         AND cu.fit_score >= $2
       ORDER BY snapshot.cycle_date DESC, cu.fit_score DESC, cu.members DESC, cu.charter_number
       LIMIT $3`,
      [input.memberSegment ?? null, input.minimumFitScore ?? 0, limit],
    );
    return result.rows.map(mapCreditUnion);
  }

  async createOpportunity(input: {
    readonly amountMinor?: number;
    readonly context: OperationalEventContext;
    readonly currency?: string;
    readonly name: string;
    readonly organizationId: string;
    readonly ownerPersonId?: string;
    readonly useCase?: string;
  }): Promise<string> {
    const id = this.ids.next('opportunity');
    await this.database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO crm_opportunities(
           id, organization_id, name, stage, owner_person_id, amount_minor, currency,
           forecast_probability, use_case, last_meaningful_activity_at, created_at, updated_at
         ) VALUES ($1,$2,$3,'target',$4,$5,$6,0,$7,$8,$8,$8)`,
        [
          id,
          input.organizationId,
          input.name,
          input.ownerPersonId ?? null,
          input.amountMinor ?? null,
          input.currency ?? null,
          input.useCase ?? null,
          input.context.now.toISOString(),
        ],
      );
      await transaction.query(
        `INSERT INTO crm_opportunity_stage_history(
           id, opportunity_id, from_stage, to_stage, reason, changed_by_person_id, changed_at
         ) VALUES ($1,$2,NULL,'target','Opportunity created',$3,$4)`,
        [
          this.ids.next('stage'),
          id,
          input.context.actorPersonId ?? null,
          input.context.now.toISOString(),
        ],
      );
      await writeAuditAndOutbox(
        transaction,
        this.ids,
        input.context,
        {
          action: 'business_os.opportunity_created',
          resourceType: 'crm_opportunity',
          resourceId: id,
          outcome: 'completed',
        },
        {
          eventType: 'business_os.opportunity_created',
          aggregateType: 'crm_opportunity',
          aggregateId: id,
          payload: { stage: 'target' },
        },
      );
    });
    return id;
  }

  async transitionOpportunity(input: {
    readonly context: OperationalEventContext;
    readonly nextStage: OpportunityStage;
    readonly opportunityId: string;
    readonly reason: string;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const current = await transaction.query<
        { stage: OpportunityStage } & Record<string, unknown>
      >('SELECT stage FROM crm_opportunities WHERE id = $1 FOR UPDATE', [input.opportunityId]);
      const row = current.rows[0];
      if (row === undefined) throw new Error('Opportunity not found');
      if (!canTransitionOpportunity(row.stage, input.nextStage)) {
        throw new Error(`Invalid opportunity transition ${row.stage} -> ${input.nextStage}`);
      }
      await transaction.query(
        `UPDATE crm_opportunities SET stage = $2, updated_at = $3,
           last_meaningful_activity_at = $3
         WHERE id = $1`,
        [input.opportunityId, input.nextStage, input.context.now.toISOString()],
      );
      await transaction.query(
        `INSERT INTO crm_opportunity_stage_history(
           id, opportunity_id, from_stage, to_stage, reason, changed_by_person_id, changed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          this.ids.next('stage'),
          input.opportunityId,
          row.stage,
          input.nextStage,
          input.reason,
          input.context.actorPersonId ?? null,
          input.context.now.toISOString(),
        ],
      );
      await writeAuditAndOutbox(
        transaction,
        this.ids,
        input.context,
        {
          action: 'business_os.opportunity_transitioned',
          resourceType: 'crm_opportunity',
          resourceId: input.opportunityId,
          outcome: 'completed',
          metadata: { fromStage: row.stage, toStage: input.nextStage },
        },
        {
          eventType: 'business_os.opportunity_transitioned',
          aggregateType: 'crm_opportunity',
          aggregateId: input.opportunityId,
          payload: { fromStage: row.stage, toStage: input.nextStage },
        },
      );
    });
  }

  async setOpportunityNextAction(input: {
    readonly context: OperationalEventContext;
    readonly nextAction: string;
    readonly nextActionAt: Date;
    readonly opportunityId: string;
  }): Promise<void> {
    const result = await this.database.query(
      `UPDATE crm_opportunities
       SET next_action = $2, next_action_at = $3, updated_at = $4
       WHERE id = $1`,
      [
        input.opportunityId,
        input.nextAction,
        input.nextActionAt.toISOString(),
        input.context.now.toISOString(),
      ],
    );
    if (result.rowCount !== 1) throw new Error('Opportunity not found');
  }

  async opportunityQueue(now: Date): Promise<
    readonly {
      readonly id: string;
      readonly name: string;
      readonly organizationId: string;
      readonly organizationName: string;
      readonly ownerPersonId?: string;
      readonly stage: OpportunityStage;
      readonly stale: boolean;
      readonly reasons: readonly string[];
      readonly recommendedAction?: string;
    }[]
  > {
    const result = await this.database.query<OpportunityRow>(
      `SELECT opportunity.id, opportunity.organization_id, organization.name AS organization_name,
              opportunity.name, opportunity.stage, opportunity.owner_person_id,
              opportunity.next_action, opportunity.next_action_at,
              opportunity.last_meaningful_activity_at, opportunity.snoozed_until,
              opportunity.suppression_reason
       FROM crm_opportunities opportunity
       JOIN crm_organizations organization ON organization.id = opportunity.organization_id
       ORDER BY opportunity.updated_at DESC
       LIMIT 101`,
    );
    return result.rows.map((row) => {
      const hygiene = evaluateOpportunityHygiene(
        {
          stage: row.stage,
          lastMeaningfulActivityAt: asDate(
            row.last_meaningful_activity_at,
            'crm_opportunities.last_meaningful_activity_at',
          ),
          ...(row.next_action === null ? {} : { nextAction: row.next_action }),
          ...(row.next_action_at === null
            ? {}
            : { nextActionAt: asDate(row.next_action_at, 'crm_opportunities.next_action_at') }),
          ...(row.snoozed_until === null
            ? {}
            : { snoozedUntil: asDate(row.snoozed_until, 'crm_opportunities.snoozed_until') }),
          ...(row.suppression_reason === null ? {} : { suppressionReason: row.suppression_reason }),
        },
        now,
      );
      return {
        id: row.id,
        name: row.name,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        ...(row.owner_person_id === null ? {} : { ownerPersonId: row.owner_person_id }),
        stage: row.stage,
        stale: hygiene.stale,
        reasons: hygiene.reasons,
        ...(hygiene.recommendedAction === undefined
          ? {}
          : { recommendedAction: hygiene.recommendedAction }),
      };
    });
  }

  async recordCustomerHealth(input: {
    readonly householdId: string;
    readonly now: Date;
    readonly rulesetVersion: string;
    readonly signals: CustomerHealthSignals;
  }): Promise<string> {
    const result = evaluateCustomerHealth(input.signals);
    const id = this.ids.next('health');
    await this.database.query(
      `INSERT INTO customer_health_snapshots(
         id, household_id, state, score, components, calculated_at, ruleset_version
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [
        id,
        input.householdId,
        result.state,
        result.score,
        jsonParameter(result.components),
        input.now.toISOString(),
        input.rulesetVersion,
      ],
    );
    return id;
  }

  async upsertOwnerAttention(input: {
    readonly attentionKind: string;
    readonly consequenceOfInaction: string;
    readonly deadline?: Date;
    readonly dedupeKey: string;
    readonly now: Date;
    readonly recommendedAction: string;
    readonly sourceId: string;
    readonly sourceType: string;
    readonly whyFounderRequired: string;
  }): Promise<string> {
    assertCode(input.attentionKind, 'attention kind');
    assertCode(input.sourceType, 'source type');
    assertCode(input.dedupeKey, 'attention dedupe key');
    const id = this.ids.next('attention');
    const result = await this.database.query<{ id: string } & Record<string, unknown>>(
      `INSERT INTO owner_attention_items(
         id, attention_kind, source_type, source_id, dedupe_key, why_founder_required,
         recommended_action, consequence_of_inaction, deadline, state, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10,$10)
       ON CONFLICT (dedupe_key) WHERE state IN ('open', 'snoozed')
       DO UPDATE SET why_founder_required = excluded.why_founder_required,
         recommended_action = excluded.recommended_action,
         consequence_of_inaction = excluded.consequence_of_inaction,
         deadline = excluded.deadline, state = 'open', updated_at = excluded.updated_at
       RETURNING id`,
      [
        id,
        input.attentionKind,
        input.sourceType,
        input.sourceId,
        input.dedupeKey,
        input.whyFounderRequired,
        input.recommendedAction,
        input.consequenceOfInaction,
        input.deadline?.toISOString() ?? null,
        input.now.toISOString(),
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('Unable to create attention item');
    return row.id;
  }

  async ownerAttention(): Promise<
    readonly {
      readonly attentionKind: string;
      readonly consequenceOfInaction: string;
      readonly createdAt: Date;
      readonly deadline?: Date;
      readonly id: string;
      readonly recommendedAction: string;
      readonly sourceId: string;
      readonly sourceType: string;
      readonly state: AttentionRow['state'];
      readonly updatedAt: Date;
      readonly whyFounderRequired: string;
    }[]
  > {
    const result = await this.database.query<AttentionRow>(
      `SELECT id, attention_kind, source_type, source_id, why_founder_required,
              recommended_action, consequence_of_inaction, deadline, state, created_at, updated_at
       FROM owner_attention_items
       WHERE state IN ('open', 'snoozed')
       ORDER BY deadline NULLS LAST, created_at
       LIMIT 101`,
    );
    return result.rows.map((row) => ({
      attentionKind: row.attention_kind,
      consequenceOfInaction: row.consequence_of_inaction,
      createdAt: asDate(row.created_at, 'owner_attention_items.created_at'),
      ...(row.deadline === null
        ? {}
        : { deadline: asDate(row.deadline, 'owner_attention_items.deadline') }),
      id: row.id,
      recommendedAction: row.recommended_action,
      sourceId: row.source_id,
      sourceType: row.source_type,
      state: row.state,
      updatedAt: asDate(row.updated_at, 'owner_attention_items.updated_at'),
      whyFounderRequired: row.why_founder_required,
    }));
  }

  async putAutomationPolicy(input: {
    readonly approvedByPersonId: string;
    readonly correlationId?: string;
    readonly now: Date;
    readonly policy: AutomationPolicy;
  }): Promise<string> {
    assertCode(input.policy.action, 'automation action');
    if (input.policy.autonomy === 'auto' && !isAutoEligibleAction(input.policy.action)) {
      throw new TypeError('Action is not eligible for autonomous execution');
    }
    if (input.policy.autonomy === 'auto' && !isAutoPolicyWithinBoundary(input.policy)) {
      throw new TypeError('Policy exceeds the code-owned autonomous execution boundary');
    }
    const id = this.ids.next('autonomy_policy');
    return this.database.transaction(async (transaction) => {
      await transaction.query(
        `SELECT control_key FROM automation_global_control
         WHERE control_key = 'global' FOR UPDATE`,
      );
      await lockFounderAutomationAuthority(
        transaction,
        this.founderPersonId,
        input.approvedByPersonId,
      );
      const authorityNow = await databaseAuthorityNow(transaction);
      const result = await transaction.query<
        { id: string; version: number } & Record<string, unknown>
      >(
        `INSERT INTO autonomy_policies(
         id, action_key, autonomy_class, allowed_data_classes, allowed_tools,
         max_cost_per_operation_cents, requires_audit, enabled, approved_by_person_id, version,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,1,$10,$10)
       ON CONFLICT (action_key) DO UPDATE SET autonomy_class = excluded.autonomy_class,
         allowed_data_classes = excluded.allowed_data_classes,
         allowed_tools = excluded.allowed_tools,
         max_cost_per_operation_cents = excluded.max_cost_per_operation_cents,
         requires_audit = excluded.requires_audit, enabled = excluded.enabled,
         approved_by_person_id = excluded.approved_by_person_id,
         version = autonomy_policies.version + 1, updated_at = excluded.updated_at
       RETURNING id, version`,
        [
          id,
          input.policy.action,
          input.policy.autonomy,
          jsonParameter(input.policy.allowedDataClasses),
          jsonParameter(input.policy.allowedTools),
          input.policy.maxCostPerOperationCents,
          input.policy.requiresAudit,
          input.policy.enabled,
          input.approvedByPersonId,
          authorityNow.toISOString(),
        ],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('Unable to write autonomy policy');
      await transaction.query(
        `INSERT INTO autonomy_policy_versions(
           id, policy_id, action_key, version, autonomy_class, allowed_data_classes,
           allowed_tools, max_cost_per_operation_cents, requires_audit, enabled,
           approved_by_person_id,
           recorded_at
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12)`,
        [
          this.ids.next('autonomy_policy_version'),
          row.id,
          input.policy.action,
          row.version,
          input.policy.autonomy,
          jsonParameter(input.policy.allowedDataClasses),
          jsonParameter(input.policy.allowedTools),
          input.policy.maxCostPerOperationCents,
          input.policy.requiresAudit,
          input.policy.enabled,
          input.approvedByPersonId,
          authorityNow.toISOString(),
        ],
      );
      await writeAuditAndOutbox(
        transaction,
        this.ids,
        {
          actorPersonId: input.approvedByPersonId,
          audience: 'hq' as const,
          correlationId: input.correlationId ?? `autonomy-policy:${row.id}:${row.version}`,
          now: authorityNow,
        },
        {
          action: 'business_os.autonomy_policy_changed',
          resourceType: 'autonomy_policy',
          resourceId: row.id,
          outcome: 'completed',
          metadata: {
            actionKey: input.policy.action,
            autonomyClass: input.policy.autonomy,
            enabled: input.policy.enabled,
            maxCostPerOperationCents: input.policy.maxCostPerOperationCents,
            version: row.version,
          },
        },
        {
          eventType: 'business_os.autonomy_policy_changed',
          aggregateType: 'autonomy_policy',
          aggregateId: row.id,
          payload: {
            actionKey: input.policy.action,
            autonomyClass: input.policy.autonomy,
            enabled: input.policy.enabled,
            version: row.version,
          },
        },
      );
      return row.id;
    });
  }

  async globalAutomationControl(): Promise<{
    readonly killSwitch: boolean;
    readonly updatedAt: Date;
    readonly updatedByPersonId?: string;
    readonly version: number;
  }> {
    const result = await this.database.query<
      {
        readonly kill_switch: boolean;
        readonly updated_at: unknown;
        readonly updated_by_person_id: string | null;
        readonly version: number;
      } & Record<string, unknown>
    >(
      `SELECT kill_switch, updated_by_person_id, updated_at, version
       FROM automation_global_control WHERE control_key = 'global'`,
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('Global automation control is unavailable');
    return {
      killSwitch: row.kill_switch,
      updatedAt: asDate(row.updated_at, 'automation_global_control.updated_at'),
      ...(row.updated_by_person_id === null ? {} : { updatedByPersonId: row.updated_by_person_id }),
      version: row.version,
    };
  }

  async setGlobalAutomationKillSwitch(input: {
    readonly correlationId?: string;
    readonly killSwitch: boolean;
    readonly now: Date;
    readonly updatedByPersonId: string;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.query(
        `SELECT control_key FROM automation_global_control
         WHERE control_key = 'global' FOR UPDATE`,
      );
      await lockFounderAutomationAuthority(
        transaction,
        this.founderPersonId,
        input.updatedByPersonId,
      );
      const authorityNow = await databaseAuthorityNow(transaction);
      const result = await transaction.query<{ version: number } & Record<string, unknown>>(
        `UPDATE automation_global_control
       SET kill_switch = $1, updated_by_person_id = $2, updated_at = $3,
           version = version + 1
       WHERE control_key = 'global'
       RETURNING version`,
        [input.killSwitch, input.updatedByPersonId, authorityNow.toISOString()],
      );
      if (result.rowCount !== 1) throw new Error('Global automation control is unavailable');
      const controlVersion = result.rows[0]?.version;
      if (controlVersion === undefined) throw new Error('Global automation control is unavailable');
      const historyId = this.ids.next('automation_global_control');
      await transaction.query(
        `INSERT INTO automation_global_control_history(
           id, kill_switch, updated_by_person_id, recorded_at, control_version
         ) VALUES ($1,$2,$3,$4,$5)`,
        [
          historyId,
          input.killSwitch,
          input.updatedByPersonId,
          authorityNow.toISOString(),
          controlVersion,
        ],
      );
      await writeAuditAndOutbox(
        transaction,
        this.ids,
        {
          actorPersonId: input.updatedByPersonId,
          audience: 'hq',
          correlationId: input.correlationId ?? `automation-control:${historyId}`,
          now: authorityNow,
        },
        {
          action: 'business_os.automation_global_control_changed',
          resourceType: 'automation_global_control',
          resourceId: 'global',
          outcome: 'completed',
          metadata: { controlVersion, killSwitch: input.killSwitch },
        },
        {
          eventType: 'business_os.automation_global_control_changed',
          aggregateType: 'automation_global_control',
          aggregateId: 'global',
          payload: { controlVersion, killSwitch: input.killSwitch },
        },
      );
    });
  }

  async evaluateAutomation(input: {
    readonly globalKillSwitch: boolean;
    readonly now: Date;
    readonly request: AutomationRequest;
  }): Promise<{
    readonly allowed: boolean;
    readonly disposition: 'auto' | 'approval' | 'human' | 'professional' | 'blocked';
    readonly reasons: readonly string[];
    readonly runId: string;
  }> {
    const result = await this.database.query<PolicyRow>(
      `SELECT id, action_key, autonomy_class, allowed_data_classes, allowed_tools,
              max_cost_per_operation_cents, requires_audit, enabled
       FROM autonomy_policies WHERE action_key = $1`,
      [input.request.action],
    );
    const row = result.rows[0];
    const policy: AutomationPolicy | undefined =
      row === undefined
        ? undefined
        : {
            action: row.action_key,
            allowedDataClasses: [
              ...stringArray(row.allowed_data_classes, 'autonomy_policies.allowed_data_classes'),
            ],
            allowedTools: [...stringArray(row.allowed_tools, 'autonomy_policies.allowed_tools')],
            autonomy: row.autonomy_class,
            enabled: row.enabled,
            maxCostPerOperationCents: row.max_cost_per_operation_cents,
            requiresAudit: row.requires_audit,
          };
    const decision = authorizeAutomation(policy, input.request, input.globalKillSwitch);
    const runId = this.ids.next('automation_run');
    await this.database.query(
      `INSERT INTO automation_runs(
         id, policy_id, action_key, tool_key, data_classes, estimated_cost_cents,
         state, audit_reference, created_at
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)`,
      [
        runId,
        row?.id ?? null,
        input.request.action,
        input.request.tool,
        jsonParameter(input.request.dataClasses),
        input.request.estimatedCostCents,
        decision.allowed ? 'approved' : decision.disposition === 'approval' ? 'blocked' : 'blocked',
        `automation:${runId}`,
        input.now.toISOString(),
      ],
    );
    return { ...decision, runId };
  }

  async ownerBrief(now: Date): Promise<{
    readonly attention: number;
    readonly atRiskHouseholds: number;
    readonly creditUnionUniverse: number;
    readonly openOpportunities: number;
    readonly staleOpportunities: number;
  }> {
    const counts = await this.database.query<
      {
        attention: number;
        at_risk_households: number;
        credit_unions: number;
        open_opportunities: number;
        stale_opportunities: number;
      } & Record<string, unknown>
    >(
      `SELECT
          (SELECT count(*)::int FROM owner_attention_items WHERE state IN ('open','snoozed')) AS attention,
          (SELECT count(*)::int FROM (
             SELECT DISTINCT ON (household_id) household_id, state
             FROM customer_health_snapshots
             ORDER BY household_id, calculated_at DESC
           ) latest_health WHERE latest_health.state = 'at_risk') AS at_risk_households,
          (SELECT count(*)::int FROM ncua_credit_unions cu JOIN ncua_snapshots s ON s.id = cu.snapshot_id
             WHERE s.state = 'imported') AS credit_unions,
          (SELECT count(*)::int FROM crm_opportunities
             WHERE stage NOT IN ('closed_won','closed_lost')) AS open_opportunities,
          (SELECT count(*)::int FROM crm_opportunities
             WHERE stage NOT IN ('closed_won','closed_lost')
               AND suppression_reason IS NULL
               AND (snoozed_until IS NULL OR snoozed_until <= $1)
               AND (
                 next_action IS NULL OR next_action_at IS NULL OR next_action_at < $1 OR
                 last_meaningful_activity_at <= $1 -
                   CASE stage
                     WHEN 'target' THEN interval '30 days'
                     WHEN 'prospecting' THEN interval '14 days'
                     WHEN 'engaged' THEN interval '10 days'
                     WHEN 'discovery' THEN interval '10 days'
                     WHEN 'qualified' THEN interval '10 days'
                     WHEN 'pilot' THEN interval '7 days'
                     WHEN 'business_case' THEN interval '7 days'
                     WHEN 'contracting' THEN interval '7 days'
                     WHEN 'implementation' THEN interval '14 days'
                     WHEN 'active_partner' THEN interval '30 days'
                     WHEN 'expansion' THEN interval '14 days'
                     ELSE interval '14 days'
                   END
               )) AS stale_opportunities`,
      [now.toISOString()],
    );
    const row = counts.rows[0] ?? {
      attention: 0,
      at_risk_households: 0,
      credit_unions: 0,
      open_opportunities: 0,
      stale_opportunities: 0,
    };
    return {
      attention: row.attention,
      atRiskHouseholds: row.at_risk_households,
      creditUnionUniverse: row.credit_unions,
      openOpportunities: row.open_opportunities,
      staleOpportunities: row.stale_opportunities,
    };
  }

  async createPrivacyRequest(input: {
    readonly dueAt: Date;
    readonly householdId?: string;
    readonly now: Date;
    readonly personId?: string;
    readonly requestKind: 'access' | 'export' | 'delete' | 'correct' | 'restrict';
    readonly context: PrivacyEventContext;
  }): Promise<string> {
    if (input.personId === undefined && input.householdId === undefined) {
      throw new TypeError('Privacy request needs a person or household subject');
    }
    const id = this.ids.next('privacy_request');
    await this.database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO privacy_requests(
           id, person_id, household_id, request_kind, identity_verification_state,
           state, due_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,'pending','received',$5,$6,$6)`,
        [
          id,
          input.personId ?? null,
          input.householdId ?? null,
          input.requestKind,
          input.dueAt.toISOString(),
          input.now.toISOString(),
        ],
      );
      await this.appendPrivacyRequestEvent(transaction, {
        requestId: id,
        eventKind: 'received',
        context: input.context,
        evidence: { requestKind: input.requestKind },
      });
      await writeAuditAndOutbox(
        transaction,
        this.ids,
        input.context,
        {
          action: 'privacy.request_received',
          resourceType: 'privacy_request',
          resourceId: id,
          outcome: 'completed',
          metadata: { requestKind: input.requestKind },
        },
        {
          eventType: 'privacy.request_received.v1',
          aggregateType: 'privacy_request',
          aggregateId: id,
          payload: { requestKind: input.requestKind },
        },
      );
    });
    return id;
  }

  async listPrivacyRequests(
    input: {
      readonly personId?: string;
      readonly limit?: number;
    } = {},
  ): Promise<readonly PrivacyRequestRecord[]> {
    const limit = input.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new TypeError('Privacy request limit must be between 1 and 500');
    }
    const rows = await this.database.query<PrivacyRequestRow>(
      `SELECT request.id, request.person_id, request.household_id, request.request_kind,
              request.identity_verification_state, request.state, request.due_at,
              request.created_at, request.updated_at, request.completed_at,
              plan.plan_kind, plan.data_categories, plan.record_counts,
              plan.requires_professional_review, plan.created_at AS plan_created_at
       FROM privacy_requests AS request
       LEFT JOIN privacy_request_plans AS plan ON plan.request_id = request.id
       WHERE ($1::text IS NULL OR request.person_id = $1)
       ORDER BY request.created_at DESC, request.id DESC
       LIMIT $2`,
      [input.personId ?? null, limit],
    );
    return rows.rows.map(mapPrivacyRequest);
  }

  async getPrivacyRequest(requestId: string): Promise<PrivacyRequestRecord | undefined> {
    const rows = await this.database.query<PrivacyRequestRow>(
      `SELECT request.id, request.person_id, request.household_id, request.request_kind,
              request.identity_verification_state, request.state, request.due_at,
              request.created_at, request.updated_at, request.completed_at,
              plan.plan_kind, plan.data_categories, plan.record_counts,
              plan.requires_professional_review, plan.created_at AS plan_created_at
       FROM privacy_requests AS request
       LEFT JOIN privacy_request_plans AS plan ON plan.request_id = request.id
       WHERE request.id = $1`,
      [requestId],
    );
    const row = rows.rows[0];
    return row === undefined ? undefined : mapPrivacyRequest(row);
  }

  async advancePrivacyRequest(input: {
    readonly requestId: string;
    readonly action: 'verify_identity' | 'begin_review' | 'record_plan' | 'deny';
    readonly evidenceReference: string;
    readonly context: PrivacyEventContext;
  }): Promise<PrivacyRequestRecord> {
    if (!/^[A-Za-z0-9][A-Za-z0-9:._/-]{2,199}$/u.test(input.evidenceReference)) {
      throw new TypeError('Privacy evidence reference must be a bounded opaque reference');
    }
    if (detectRestrictedInput(input.evidenceReference).length > 0) {
      throw new TypeError('Privacy evidence reference must not contain sensitive values');
    }
    await this.database.transaction(async (transaction) => {
      const selected = await transaction.query<PrivacyRequestRow>(
        `SELECT request.id, request.person_id, request.household_id, request.request_kind,
                request.identity_verification_state, request.state, request.due_at,
                request.created_at, request.updated_at, request.completed_at,
                NULL::text AS plan_kind, NULL::jsonb AS data_categories,
                NULL::jsonb AS record_counts, NULL::boolean AS requires_professional_review,
                NULL::timestamptz AS plan_created_at
         FROM privacy_requests AS request WHERE request.id = $1 FOR UPDATE`,
        [input.requestId],
      );
      const current = selected.rows[0];
      if (current === undefined) throw new Error('Privacy request not found');
      let eventKind: 'identity_verified' | 'review_started' | 'plan_recorded' | 'denied';
      let nextState = current.state;
      let nextIdentityState = current.identity_verification_state;
      if (input.action === 'verify_identity') {
        if (current.state !== 'received' || current.identity_verification_state !== 'pending') {
          throw new Error('Privacy request identity transition is unavailable');
        }
        eventKind = 'identity_verified';
        nextState = 'verified';
        nextIdentityState = 'verified';
      } else if (input.action === 'begin_review') {
        if (current.state !== 'verified' || current.identity_verification_state !== 'verified') {
          throw new Error('Privacy request review transition is unavailable');
        }
        eventKind = 'review_started';
        nextState = 'in_progress';
      } else if (input.action === 'record_plan') {
        if (current.state !== 'in_progress' || current.identity_verification_state !== 'verified') {
          throw new Error('Privacy request plan transition is unavailable');
        }
        const existingPlan = await transaction.query(
          'SELECT request_id FROM privacy_request_plans WHERE request_id = $1',
          [input.requestId],
        );
        if (existingPlan.rows[0] !== undefined) return;
        eventKind = 'plan_recorded';
        await this.createPrivacyPlan(transaction, current, input.context);
      } else {
        if (current.state === 'completed' || current.state === 'denied') {
          throw new Error('Privacy request is already terminal');
        }
        eventKind = 'denied';
        nextState = 'denied';
      }
      await transaction.query(
        `UPDATE privacy_requests
         SET state = $2, identity_verification_state = $3, updated_at = $4,
             completed_at = CASE WHEN $2 = 'denied' THEN $4 ELSE completed_at END
         WHERE id = $1`,
        [input.requestId, nextState, nextIdentityState, input.context.now.toISOString()],
      );
      await this.appendPrivacyRequestEvent(transaction, {
        requestId: input.requestId,
        eventKind,
        context: input.context,
        evidenceReference: input.evidenceReference,
        evidence: { requestKind: current.request_kind },
      });
      await writeAuditAndOutbox(
        transaction,
        this.ids,
        input.context,
        {
          action: `privacy.${eventKind}`,
          resourceType: 'privacy_request',
          resourceId: input.requestId,
          outcome: 'completed',
          metadata: { requestKind: current.request_kind },
        },
        {
          eventType: `privacy.${eventKind}.v1`,
          aggregateType: 'privacy_request',
          aggregateId: input.requestId,
          payload: { requestKind: current.request_kind },
        },
      );
    });
    const request = await this.getPrivacyRequest(input.requestId);
    if (request === undefined) throw new Error('Privacy request not found after update');
    return request;
  }

  private async createPrivacyPlan(
    transaction: SqlExecutor,
    request: PrivacyRequestRow,
    context: PrivacyEventContext,
  ): Promise<void> {
    const counts = await transaction.query<
      { readonly record_counts: unknown } & Record<string, unknown>
    >(
      `SELECT jsonb_build_object(
         'account_identity',
           (SELECT count(*)::int FROM identities identity_record
             WHERE $1::text IS NOT NULL AND identity_record.person_id = $1)
           + (SELECT count(*)::int FROM sessions session_record
             WHERE $1::text IS NOT NULL AND session_record.person_id = $1)
           + (SELECT count(*)::int FROM household_memberships membership
             WHERE ($1::text IS NULL OR membership.person_id = $1)
               AND ($2::text IS NULL OR membership.household_id = $2)),
         'submitted_artifacts',
           (SELECT count(*)::int FROM artifacts artifact
             WHERE ($1::text IS NULL OR artifact.owner_person_id = $1)
               AND ($2::text IS NULL OR artifact.household_id = $2)),
         'analysis_results',
           (SELECT count(*)::int FROM analyses analysis
             WHERE ($1::text IS NULL OR analysis.requested_by = $1)
               AND ($2::text IS NULL OR analysis.household_id = $2)),
         'consent_evidence',
           (SELECT count(*)::int FROM consent_evidence evidence
             WHERE ($1::text IS NULL OR $1 IN (
               evidence.actor_person_id, evidence.subject_person_id,
               COALESCE(evidence.recipient_person_id, '')
             )) AND ($2::text IS NULL OR evidence.household_id = $2)),
         'trusted_circle_relationships',
           (SELECT count(*)::int FROM trusted_circle_relationships relationship
             WHERE ($1::text IS NULL OR $1 IN (
               relationship.protected_person_id, relationship.trusted_person_id
             )) AND ($2::text IS NULL OR relationship.household_id = $2)),
         'orientation_state',
           (SELECT count(*)::int FROM orientation_states orientation
             WHERE ($1::text IS NULL OR orientation.person_id = $1)
               AND ($2::text IS NULL OR orientation.household_id = $2)),
         'public_check_conversion_evidence',
           (SELECT count(*)::int FROM public_check_conversions conversion
             WHERE ($1::text IS NULL OR conversion.actor_person_id = $1)
               AND ($2::text IS NULL OR conversion.household_id = $2)),
         'support_evidence',
           (SELECT count(*)::int FROM support_cases support_case
             WHERE $2::text IS NOT NULL AND support_case.household_id = $2),
         'commerce_and_entitlements',
           (SELECT count(*)::int FROM commerce_subscriptions subscription
             WHERE $2::text IS NOT NULL AND subscription.household_id = $2)
           + (SELECT count(*)::int FROM entitlement_grants grant_record
             WHERE $2::text IS NOT NULL AND grant_record.household_id = $2)
           + (SELECT count(*)::int FROM commerce_sponsorship_allocations allocation
             WHERE $2::text IS NOT NULL AND allocation.household_id = $2)
           + (SELECT count(*)::int FROM commerce_allowance_allocations allowance
             WHERE $2::text IS NOT NULL AND allowance.household_id = $2),
         'commerce_provider_evidence',
           (SELECT count(*)::int FROM commerce_provider_subscription_records provider_record
             WHERE $2::text IS NOT NULL AND provider_record.household_id = $2)
           + (SELECT count(*)::int FROM commerce_stripe_session_operations operation
             WHERE $2::text IS NOT NULL AND operation.household_id = $2)
           + (SELECT count(*)::int FROM commerce_stripe_paid_invoice_evidence paid
             WHERE $2::text IS NOT NULL AND paid.household_id = $2)
           + (SELECT count(*)::int FROM commerce_stripe_failed_invoice_evidence failed
             WHERE $2::text IS NOT NULL AND failed.household_id = $2),
         'founding_household_evidence',
           (SELECT count(*)::int FROM founding_household_enrollments enrollment
             WHERE ($1::text IS NULL OR enrollment.accepted_by_person_id = $1)
               AND ($2::text IS NULL OR enrollment.household_id = $2)),
         'feedback_learning_evidence',
           (SELECT count(*)::int FROM feedback_records feedback
             WHERE ($1::text IS NULL OR feedback.actor_person_id = $1)
               AND ($2::text IS NULL OR feedback.household_id = $2)),
         'messaging_evidence',
           (SELECT count(*)::int FROM messaging_destinations destination
             WHERE $1::text IS NOT NULL AND destination.person_id = $1)
           + (SELECT count(*)::int FROM messaging_consent_evidence message_consent
             WHERE $1::text IS NOT NULL AND message_consent.person_id = $1)
           + (SELECT count(*)::int FROM messaging_suppression_evidence suppression
             WHERE $1::text IS NOT NULL AND suppression.person_id = $1)
           + (SELECT count(*)::int FROM messaging_inbound_events inbound
             WHERE ($1::text IS NULL OR inbound.person_id = $1)
               AND ($2::text IS NULL OR inbound.household_id = $2))
           + (SELECT count(*)::int FROM messaging_intents intent
             WHERE ($1::text IS NULL OR intent.recipient_person_id = $1)
               AND ($2::text IS NULL OR intent.household_id = $2)),
         'editorial_preferences',
           (SELECT count(*)::int FROM editorial_preference_events preference
             WHERE $1::text IS NOT NULL AND preference.subject_person_id = $1),
         'referral_evidence',
           (SELECT count(*)::int FROM run3_referral_attributions attribution
             WHERE ($1::text IS NULL OR attribution.referrer_person_id = $1)
               AND ($2::text IS NULL OR attribution.referrer_household_id = $2))
           + (SELECT count(*)::int FROM run3_referral_recipient_events recipient_event
             WHERE ($1::text IS NULL OR recipient_event.recipient_person_id = $1)
               AND ($2::text IS NULL OR recipient_event.recipient_household_id = $2))
           + (SELECT count(*)::int FROM run3_referral_credit_entries credit
             WHERE ($1::text IS NULL OR credit.receiving_person_id = $1)
               AND ($2::text IS NULL OR credit.receiving_household_id = $2)),
         'privacy_request_evidence',
           (SELECT count(*)::int FROM privacy_requests privacy_request
             WHERE ($1::text IS NULL OR privacy_request.person_id = $1)
               AND ($2::text IS NULL OR privacy_request.household_id = $2)),
         'audit_and_outbox_evidence',
           (SELECT count(*)::int FROM audit_events audit
             WHERE ($1::text IS NULL OR audit.actor_person_id = $1)
               AND ($2::text IS NULL OR audit.household_id = $2))
           + (SELECT count(*)::int FROM outbox_events outbox
             WHERE ($1::text IS NULL OR outbox.actor_person_id = $1)
               AND ($2::text IS NULL OR outbox.household_id = $2))
       ) AS record_counts`,
      [request.person_id, request.household_id],
    );
    const recordCounts = numericRecord(
      counts.rows[0]?.record_counts,
      'privacy_inventory.record_counts',
    );
    const planKind: Record<PrivacyRequestRecord['requestKind'], PrivacyPlanKind> = {
      access: 'access_summary',
      export: 'export_manifest',
      delete: 'deletion_plan',
      correct: 'correction_plan',
      restrict: 'restriction_plan',
    };
    await transaction.query(
      `INSERT INTO privacy_request_plans(
         id, request_id, plan_kind, data_categories, record_counts,
         contains_customer_content, requires_professional_review,
         created_by_person_id, created_at
       ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,false,true,$6,$7)`,
      [
        this.ids.next('privacy_plan'),
        request.id,
        planKind[request.request_kind],
        jsonParameter(Object.keys(recordCounts).sort()),
        jsonParameter(recordCounts),
        context.actorPersonId,
        context.now.toISOString(),
      ],
    );
  }

  private async appendPrivacyRequestEvent(
    transaction: SqlExecutor,
    input: {
      readonly requestId: string;
      readonly eventKind:
        | 'received'
        | 'identity_verified'
        | 'review_started'
        | 'plan_recorded'
        | 'completed'
        | 'denied';
      readonly context: PrivacyEventContext;
      readonly evidenceReference?: string;
      readonly evidence: Readonly<Record<string, string | number | boolean>>;
    },
  ): Promise<void> {
    await transaction.query(
      `INSERT INTO privacy_request_events(
         id, request_id, sequence, event_kind, actor_person_id, actor_audience,
         evidence_reference, evidence, created_at
       ) VALUES (
         $1,$2,
         (SELECT COALESCE(max(sequence),0) + 1 FROM privacy_request_events WHERE request_id = $2),
         $3,$4,$5,$6,$7::jsonb,$8
       )`,
      [
        this.ids.next('privacy_event'),
        input.requestId,
        input.eventKind,
        input.context.actorPersonId,
        input.context.audience,
        input.evidenceReference ?? null,
        jsonParameter(input.evidence),
        input.context.now.toISOString(),
      ],
    );
  }

  async rawAutomationPolicy(
    action: string,
  ): Promise<Readonly<Record<string, unknown>> | undefined> {
    const result = await this.database.query<Record<string, unknown>>(
      'SELECT * FROM autonomy_policies WHERE action_key = $1',
      [action],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const parsed: Record<string, unknown> = { ...row };
    for (const key of ['allowed_data_classes', 'allowed_tools'] as const) {
      parsed[key] = jsonValue(row[key]);
    }
    return parsed;
  }
}
