import { afterEach, describe, expect, it } from 'vitest';
import {
  createSeededTestDatabase,
  fixedTestNow,
  testArtifactProtection,
} from '@boomerbuddy/testkit';

import { BusinessOsRepository } from './business-os';
import { CheckRepository, type DecisionRecord } from './checks';
import type { Database } from './database';
import { FamilyRepository } from './family';
import { GrowthRuntimeRepository } from './growth-runtime';
import { OrientationRepository } from './orientation';
import { SessionRepository } from './sessions';
import type { IdFactory } from './values';

function labeledIds(label: string): IdFactory {
  let sequence = 0;
  return { next: (prefix) => `${prefix}-${label}-${(sequence += 1)}` };
}

async function drainGrowthBackfill(
  database: Database,
  growth: GrowthRuntimeRepository,
  now: Date,
): Promise<void> {
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const before = await database.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM growth_event_receipts',
    );
    await growth.projectPending({ limit: 100, now });
    const after = await database.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM growth_event_receipts',
    );
    if (after.rows[0]?.count === before.rows[0]?.count) return;
  }
  throw new Error('Growth backfill did not converge');
}

const decision: DecisionRecord = {
  risk: 'unknown',
  evidenceSufficiency: 'limited',
  calibration: 'not_calibrated',
  summary: 'The local regression provider does not determine risk.',
  evidence: [],
  actions: [
    {
      key: 'pause',
      priority: 1,
      title: 'Pause',
      detail: 'Verify independently.',
      officialChannelOnly: true,
    },
  ],
  provider: { name: 'local-unknown', state: 'mock', version: 'growth-test' },
  rulesetVersion: 'growth-test-v1',
};

describe('growth runtime projection', () => {
  let database: Database | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it('projects Check milestones idempotently, advances internal lifecycle, and queues explainable health intervention', async () => {
    database = await createSeededTestDatabase();
    const growth = new GrowthRuntimeRepository(database, labeledIds('projection'));

    const exactEvent = await database.query<{ id: string }>(
      `SELECT id FROM outbox_events WHERE event_type = 'check.completed.v1'
       ORDER BY id LIMIT 1`,
    );
    await expect(
      growth.projectEventById({ eventId: exactEvent.rows[0]?.id ?? '', now: fixedTestNow }),
    ).resolves.toBe('projected');
    await expect(
      growth.projectEventById({ eventId: exactEvent.rows[0]?.id ?? '', now: fixedTestNow }),
    ).resolves.toBe('already_projected');
    await expect(growth.projectPending({ limit: 100, now: fixedTestNow })).resolves.toBe(2);
    await expect(growth.projectPending({ limit: 100, now: fixedTestNow })).resolves.toBe(0);

    const facts = await database.query<{
      receipts: number;
      first_check_touchpoints: number;
      completed_workflows: number;
      snapshots: number;
      interventions: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM growth_event_receipts) AS receipts,
         (SELECT count(*)::int FROM acquisition_touchpoints
          WHERE milestone = 'first_check') AS first_check_touchpoints,
         (SELECT count(*)::int FROM lifecycle_workflows
          WHERE workflow_kind = 'activation' AND state = 'completed') AS completed_workflows,
         (SELECT count(*)::int FROM customer_health_snapshots
          WHERE ruleset_version = 'run2-growth-v1') AS snapshots,
         (SELECT count(*)::int FROM growth_health_interventions
          WHERE state = 'open') AS interventions`,
    );
    expect(facts.rows[0]).toEqual({
      receipts: 3,
      first_check_touchpoints: 2,
      completed_workflows: 2,
      snapshots: 3,
      interventions: 1,
    });

    const queued = await database.query<{
      household_id: string;
      case_kind: string;
      routing_class: string;
      summary: string;
      components: unknown;
    }>(
      `SELECT work_case.household_id, work_case.case_kind, work_case.routing_class,
              work_case.summary, snapshot.components
       FROM growth_health_interventions intervention
       JOIN hq_work_cases work_case ON work_case.id = intervention.work_case_id
       JOIN customer_health_snapshots snapshot ON snapshot.id = intervention.latest_snapshot_id`,
    );
    expect(queued.rows[0]).toMatchObject({
      household_id: 'household-harbor',
      case_kind: 'customer_success',
      routing_class: 'ai_assisted',
    });
    expect(queued.rows[0]?.summary).toContain('orientation_incomplete');
    expect(JSON.stringify(queued.rows[0])).not.toContain('Synthetic Harbor household message');

    const nextDay = new Date(fixedTestNow.getTime() + 25 * 60 * 60 * 1_000);
    await expect(growth.recalculateStaleHealth({ limit: 100, now: nextDay })).resolves.toBe(2);
    await expect(growth.recalculateStaleHealth({ limit: 100, now: nextDay })).resolves.toBe(0);
    const recalculated = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM customer_health_snapshots
       WHERE ruleset_version = 'run2-growth-v1'`,
    );
    expect(recalculated.rows[0]?.count).toBe(5);
  });

  it('does not bypass an unresolved outbox dead letter during exact or backfill projection', async () => {
    database = await createSeededTestDatabase();
    const growth = new GrowthRuntimeRepository(database, labeledIds('dead-letter'));
    const event = await database.query<{ id: string }>(
      `SELECT id FROM outbox_events WHERE event_type = 'check.completed.v1'
       ORDER BY id LIMIT 1`,
    );
    const eventId = event.rows[0]?.id ?? '';
    await database.query(
      `UPDATE outbox_events
       SET dead_lettered_at = $2, last_error_code = 'growth_test_dead_letter'
       WHERE id = $1`,
      [eventId, fixedTestNow.toISOString()],
    );

    await expect(growth.projectEventById({ eventId, now: fixedTestNow })).resolves.toBe('ignored');
    await expect(growth.projectPending({ limit: 100, now: fixedTestNow })).resolves.toBe(2);
    const receipts = await database.query<{ dead_letter: number; projected: number }>(
      `SELECT
         (SELECT count(*)::int FROM growth_event_receipts WHERE event_id = $1) AS dead_letter,
         (SELECT count(*)::int FROM growth_event_receipts) AS projected`,
      [eventId],
    );
    expect(receipts.rows[0]).toEqual({ dead_letter: 0, projected: 2 });
  });

  it('keeps a same-aggregate successor behind an unresolved poison event by causal position', async () => {
    database = await createSeededTestDatabase();
    const growth = new GrowthRuntimeRepository(database, labeledIds('causal-backfill'));
    await database.query(`UPDATE outbox_events SET processed_at = $1 WHERE processed_at IS NULL`, [
      fixedTestNow.toISOString(),
    ]);
    await database.query(
      `INSERT INTO outbox_events(
         id, event_type, event_version, aggregate_type, aggregate_id, household_id,
         actor_person_id, correlation_id, classification, payload, occurred_at,
         available_at, next_attempt_at, max_attempts
       ) VALUES
         ('event-z-growth-poison','check.completed.v1',1,'analysis','growth-causal-analysis',
          'household-sunrise','person-owner-alice','growth-causal-poison','internal','{}',
          $2,$1,$1,8),
         ('event-a-growth-successor','check.completed.v1',1,'analysis','growth-causal-analysis',
          'household-sunrise','person-owner-alice','growth-causal-successor','internal','{}',
          $1,$1,$1,8)`,
      [fixedTestNow.toISOString(), new Date(fixedTestNow.getTime() + 60_000).toISOString()],
    );
    await database.query(
      `UPDATE outbox_events
       SET dead_lettered_at = $2, last_error_code = 'growth_test_poison'
       WHERE id = $1`,
      ['event-z-growth-poison', fixedTestNow.toISOString()],
    );

    const positions = await database.query<{
      id: string;
      causal_order_position: number;
      occurred_at: unknown;
    }>(
      `SELECT id, causal_order_position, occurred_at FROM outbox_events
       WHERE aggregate_id = 'growth-causal-analysis'
       ORDER BY causal_order_position`,
    );
    expect(positions.rows.map((row) => row.id)).toEqual([
      'event-z-growth-poison',
      'event-a-growth-successor',
    ]);
    expect(new Date(String(positions.rows[0]?.occurred_at)).getTime()).toBeGreaterThan(
      new Date(String(positions.rows[1]?.occurred_at)).getTime(),
    );
    await growth.projectPending({ limit: 100, now: fixedTestNow });
    await expect(
      growth.projectEventById({ eventId: 'event-a-growth-successor', now: fixedTestNow }),
    ).resolves.toBe('ignored');
    const successorReceipt = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM growth_event_receipts
       WHERE event_id = 'event-a-growth-successor'`,
    );
    expect(successorReceipt.rows[0]?.count).toBe(0);
  });

  it('unblocks a reversed-time successor from the committed prior growth receipt', async () => {
    database = await createSeededTestDatabase();
    const growth = new GrowthRuntimeRepository(database, labeledIds('causal-receipt'));
    await database.query('UPDATE outbox_events SET processed_at = $1 WHERE processed_at IS NULL', [
      fixedTestNow.toISOString(),
    ]);
    await database.query(
      `INSERT INTO outbox_events(
         id, event_type, event_version, aggregate_type, aggregate_id, household_id,
         actor_person_id, correlation_id, classification, payload, occurred_at,
         available_at, next_attempt_at, max_attempts
       ) VALUES
         ('event-z-growth-prior','check.completed.v1',1,'analysis','growth-receipt-analysis',
          'household-sunrise','person-owner-alice','growth-receipt-prior','internal','{}',
          $2,$1,$1,8),
         ('event-a-growth-after','check.completed.v1',1,'analysis','growth-receipt-analysis',
          'household-sunrise','person-owner-alice','growth-receipt-after','internal','{}',
          $1,$1,$1,8)`,
      [fixedTestNow.toISOString(), new Date(fixedTestNow.getTime() + 60_000).toISOString()],
    );

    await expect(
      growth.projectEventById({ eventId: 'event-a-growth-after', now: fixedTestNow }),
    ).resolves.toBe('ignored');
    await expect(
      growth.projectEventById({ eventId: 'event-z-growth-prior', now: fixedTestNow }),
    ).resolves.toBe('projected');
    const priorGlobalState = await database.query<{ processed_at: unknown | null }>(
      `SELECT processed_at FROM outbox_events WHERE id = 'event-z-growth-prior'`,
    );
    expect(priorGlobalState.rows[0]?.processed_at).toBeNull();
    await expect(
      growth.projectEventById({ eventId: 'event-a-growth-after', now: fixedTestNow }),
    ).resolves.toBe('projected');
    const receipts = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM growth_event_receipts
       WHERE event_id IN ('event-z-growth-prior','event-a-growth-after')`,
    );
    expect(receipts.rows[0]?.count).toBe(2);
  });

  it('measures actual orientation timestamps, suppresses an abandoned-flow contact, and correlates a later Check', async () => {
    database = await createSeededTestDatabase();
    const growth = new GrowthRuntimeRepository(database, labeledIds('orientation-growth'));
    await drainGrowthBackfill(database, growth, fixedTestNow);
    const orientation = new OrientationRepository(
      database,
      Buffer.alloc(32, 19),
      labeledIds('orientation-events'),
    );
    const businessOs = new BusinessOsRepository(database, labeledIds('suppression'));
    const startedAt = new Date(fixedTestNow.getTime() + 60_000);
    await orientation.start({
      householdId: 'household-sunrise',
      subjectPersonId: 'person-protected-pat',
      actorPersonId: 'person-protected-pat',
      audience: 'customer',
      correlationId: 'growth-orientation-start',
      now: startedAt,
    });
    await businessOs.suppressCommunication({
      channel: 'email',
      effectiveAt: startedAt,
      reason: 'Customer lifecycle opt-out regression',
      scope: 'lifecycle',
      source: 'customer_preference',
      subjectId: 'person-protected-pat',
      subjectKind: 'person',
    });
    await drainGrowthBackfill(database, growth, startedAt);

    const abandonedAt = new Date(startedAt.getTime() + 25 * 60 * 60 * 1_000);
    await expect(growth.projectDueLifecycle({ limit: 100, now: abandonedAt })).resolves.toBe(1);
    await expect(growth.projectDueLifecycle({ limit: 100, now: abandonedAt })).resolves.toBe(0);
    const abandoned = await database.query<{
      workflow_state: string;
      step_state: string;
      failure_code: string | null;
    }>(
      `SELECT workflow.state AS workflow_state, step.state AS step_state, step.failure_code
       FROM lifecycle_workflows workflow
       JOIN lifecycle_steps step ON step.workflow_id = workflow.id
       WHERE workflow.trigger_event_id LIKE 'growth.orientation_abandoned:%'`,
    );
    expect(abandoned.rows[0]).toEqual({
      workflow_state: 'suppressed',
      step_state: 'suppressed',
      failure_code: 'communication_suppressed',
    });
    await expect(
      growth.processReadyLifecycleNotifications({ limit: 100, now: abandonedAt }),
    ).resolves.toEqual({ materialized: 0, completed: 0, suppressed: 0 });
    const suppressedRequests = await database.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM notification_dispatch_requests',
    );
    expect(suppressedRequests.rows[0]?.count).toBe(0);

    const complete = async (
      step:
        | 'protection_subject'
        | 'trusted_circle'
        | 'practice_check'
        | 'capabilities_and_limits'
        | 'review',
      offsetMinutes: number,
    ): Promise<void> => {
      await orientation.completeStep({
        householdId: 'household-sunrise',
        subjectPersonId: 'person-protected-pat',
        actorPersonId: 'person-protected-pat',
        step,
        audience: 'customer',
        correlationId: `growth-orientation-${step}`,
        now: new Date(abandonedAt.getTime() + offsetMinutes * 60_000),
      });
    };
    await complete('protection_subject', 1);
    await complete('trusted_circle', 2);
    await orientation.setSafeWord({
      householdId: 'household-sunrise',
      subjectPersonId: 'person-protected-pat',
      actorPersonId: 'person-protected-pat',
      action: 'defer',
      audience: 'customer',
      correlationId: 'growth-orientation-safe-word',
      now: new Date(abandonedAt.getTime() + 3 * 60_000),
    });
    await complete('practice_check', 4);
    await complete('capabilities_and_limits', 5);
    await complete('review', 6);
    const completedAt = new Date(abandonedAt.getTime() + 6 * 60_000);
    await drainGrowthBackfill(database, growth, completedAt);

    const checks = new CheckRepository(
      database,
      testArtifactProtection(),
      labeledIds('later-check'),
    );
    const checkedAt = new Date(completedAt.getTime() + 60_000);
    await checks.create({
      householdId: 'household-sunrise',
      actorPersonId: 'person-protected-pat',
      audience: 'customer',
      kind: 'text',
      content: 'private regression artifact must never enter growth state',
      decision,
      correlationId: 'growth-check-after-orientation',
      now: checkedAt,
      ids: { artifactId: 'artifact-growth-later', analysisId: 'analysis-growth-later' },
    });
    await drainGrowthBackfill(database, growth, checkedAt);

    const measurements = await growth.orientationMeasurements('household-sunrise');
    expect(measurements).toContainEqual(
      expect.objectContaining({
        personId: 'person-protected-pat',
        startedAt,
        completedAt,
        stalledObservedAt: abandonedAt,
        firstCheckAfterStartAt: checkedAt,
        firstCheckAfterCompletionAt: checkedAt,
      }),
    );
    const milestones = await database.query<{ milestone: string }>(
      `SELECT milestone FROM acquisition_touchpoints
       WHERE subject_kind = 'household' AND subject_id = 'household-sunrise'
         AND milestone IN ('orientation','activation') ORDER BY milestone`,
    );
    expect(milestones.rows.map((row) => row.milestone)).toEqual(['activation', 'orientation']);
    const growthState = await database.query<{ state: string }>(
      `SELECT state FROM lifecycle_workflows
       WHERE trigger_event_id = (
         SELECT event_id FROM growth_event_receipts
         WHERE event_type = 'orientation.started.v1' ORDER BY projected_at DESC LIMIT 1
       )`,
    );
    expect(growthState.rows[0]?.state).toBe('completed');
  });

  it('integrates a real Trusted Circle invitation and acceptance into one referral lifecycle', async () => {
    database = await createSeededTestDatabase();
    const growth = new GrowthRuntimeRepository(database, labeledIds('referral-growth'));
    await drainGrowthBackfill(database, growth, fixedTestNow);
    const family = new FamilyRepository(
      database,
      Buffer.alloc(32, 29),
      1,
      labeledIds('referral-events'),
    );
    const sessions = new SessionRepository(database, labeledIds('referral-sessions'));
    const invitedAt = new Date(fixedTestNow.getTime() + 60_000);
    const protectedSessionId = await sessions.create({
      personId: 'person-protected-pat',
      audience: 'customer',
      issuedAt: fixedTestNow,
      expiresAt: new Date(fixedTestNow.getTime() + 8 * 60 * 60 * 1_000),
    });
    const trustedSessionId = await sessions.create({
      personId: 'person-trusted-jordan',
      audience: 'customer',
      issuedAt: fixedTestNow,
      expiresAt: new Date(fixedTestNow.getTime() + 8 * 60 * 60 * 1_000),
    });
    const created = await family.createInvitation({
      householdId: 'household-sunrise',
      invitedByPersonId: 'person-protected-pat',
      protectedPersonId: 'person-protected-pat',
      inviteeDisplayName: 'Jordan Trusted',
      permissions: ['view_shared_checks'],
      audience: 'customer',
      actorIssuer: 'boomerbuddy-dev',
      sessionId: protectedSessionId,
      correlationId: 'growth-referral-create',
      now: invitedAt,
    });
    const credential = await family.validateInvitationCredential(
      created.invitation.id,
      created.localInviteCode,
      invitedAt,
    );
    expect(credential).not.toBeNull();
    const acceptedAt = new Date(invitedAt.getTime() + 60_000);
    await family.acceptInvitation({
      invitationId: created.invitation.id,
      localInviteCode: created.localInviteCode,
      previewVersion: credential?.consentVersion ?? '',
      acceptingPersonId: 'person-trusted-jordan',
      audience: 'customer',
      actorIssuer: 'boomerbuddy-dev',
      sessionId: trustedSessionId,
      correlationId: 'growth-referral-accept',
      now: acceptedAt,
    });

    await drainGrowthBackfill(database, growth, acceptedAt);
    const referral = await database.query<{
      referral_kind: string;
      state: string;
      referrer_person_id: string;
      referred_person_id: string;
      created_event_id: string;
      activated_event_id: string;
    }>(
      `SELECT referral.referral_kind, referral.state, referral.referrer_person_id,
              referral.referred_person_id, link.created_event_id, link.activated_event_id
       FROM referrals referral
       JOIN growth_referral_links link ON link.referral_id = referral.id
       WHERE link.invitation_id = $1`,
      [created.invitation.id],
    );
    expect(referral.rows[0]).toMatchObject({
      referral_kind: 'trusted_circle',
      state: 'activated',
      referrer_person_id: 'person-protected-pat',
      referred_person_id: 'person-trusted-jordan',
    });
    expect(referral.rows[0]?.created_event_id).not.toBe(referral.rows[0]?.activated_event_id);
    const referralFacts = await database.query<{
      attribution: number;
      completed_lifecycle: number;
      receipts: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM acquisition_touchpoints
          WHERE subject_kind = 'person' AND subject_id = 'person-trusted-jordan'
            AND channel = 'referral' AND milestone = 'referral') AS attribution,
         (SELECT count(*)::int FROM lifecycle_workflows
          WHERE workflow_kind = 'referral' AND state = 'completed') AS completed_lifecycle,
         (SELECT count(*)::int FROM growth_event_receipts
          WHERE event_type IN ('family.invitation_created.v1','family.relationship_activated.v1')) AS receipts`,
    );
    expect(referralFacts.rows[0]).toEqual({
      attribution: 1,
      completed_lifecycle: 1,
      receipts: 2,
    });
  });
});
