import { afterEach, describe, expect, it } from 'vitest';

import { BusinessOsRepository } from './business-os';
import { createPGliteDatabase, type Database } from './database';
import { runMigrations } from './migrations';
import type { IdFactory } from './values';

function deterministicIds(): IdFactory {
  let sequence = 0;
  return { next: (prefix) => `${prefix}_test_${(sequence += 1)}` };
}

const creditUnion = {
  assets: 1_282_088_093,
  charterNumber: 13,
  charterState: 'LA',
  city: 'Baton Rouge',
  deposits: 1_118_682_828,
  fitReasons: [
    '50,000 to 249,999 reported memberships.',
    '$500 million or more in reported assets.',
  ],
  fitScore: 50,
  internalJoinNumber: 14,
  loans: 1_118_071_276,
  lowIncomeDesignation: true,
  memberSegment: '50k_250k' as const,
  members: 72_182,
  name: 'EFCU FINANCIAL',
  ncuaRegion: '2',
  peerGroup: 6,
  sourceTypeCode: '1',
  state: 'LA',
  zipCode: '70816',
};

describe('Business OS persistence', () => {
  let database: Database | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it('imports a provenance-locked NCUA universe idempotently and creates explainable targets', async () => {
    database = await createPGliteDatabase();
    await runMigrations(database);
    const repository = new BusinessOsRepository(database, deterministicIds());
    const context = { correlationId: 'test-ncua-import', now: new Date('2026-08-16T12:00:00Z') };
    const input = {
      records: [creditUnion],
      provenance: {
        cycleDate: '2026-03-31',
        downloadedAt: new Date('2026-08-16T10:18:17Z'),
        sha256: '6d7fdf1e7eaf9078b33a498be966163e07e368949dbbdf3736527842c51f7567',
        sourceUrl: 'https://ncua.gov/files/publications/analysis/call-report-data-2026-03.zip',
      },
      context,
    };
    const first = await repository.importNcuaSnapshot(input);
    const second = await repository.importNcuaSnapshot(input);
    expect(first).toMatchObject({ imported: true, organizationCount: 1 });
    expect(second).toEqual({ ...first, imported: false });
    expect(await repository.creditUnionTargets()).toEqual([creditUnion]);

    const counts = await database.query<{ organizations: number; snapshots: number }>(
      `SELECT (SELECT count(*)::int FROM crm_organizations) AS organizations,
              (SELECT count(*)::int FROM ncua_snapshots) AS snapshots`,
    );
    expect(counts.rows[0]).toEqual({ organizations: 1, snapshots: 1 });
  }, 20_000);

  it('runs opportunity hygiene, owner attention, health, privacy, and autonomy fail-closed', async () => {
    database = await createPGliteDatabase();
    await runMigrations(database);
    const repository = new BusinessOsRepository(database, deterministicIds());
    const now = new Date('2026-08-16T12:00:00Z');
    const context = { correlationId: 'test-business-os', now };
    await repository.importNcuaSnapshot({
      records: [creditUnion],
      provenance: {
        cycleDate: '2026-03-31',
        downloadedAt: new Date('2026-08-16T10:18:17Z'),
        sha256: '6d7fdf1e7eaf9078b33a498be966163e07e368949dbbdf3736527842c51f7567',
        sourceUrl: 'https://ncua.gov/files/publications/analysis/call-report-data-2026-03.zip',
      },
      context,
    });
    const organization = await database.query<{ id: string }>(
      "SELECT id FROM crm_organizations WHERE source_name = 'ncua'",
    );
    const organizationId = organization.rows[0]?.id;
    expect(organizationId).toBeDefined();
    const opportunityId = await repository.createOpportunity({
      context,
      name: 'Member safety pilot',
      organizationId: organizationId as string,
      useCase: 'Consented member scam-response pilot',
    });
    await repository.transitionOpportunity({
      context,
      nextStage: 'prospecting',
      opportunityId,
      reason: 'Approved internal targeting record',
    });
    await expect(
      repository.transitionOpportunity({
        context,
        nextStage: 'closed_won',
        opportunityId,
        reason: 'Invalid shortcut',
      }),
    ).rejects.toThrow(/Invalid opportunity transition/u);
    const queue = await repository.opportunityQueue(new Date('2026-09-01T12:00:00Z'));
    expect(queue[0]).toMatchObject({ stage: 'prospecting', stale: true });

    const firstAttention = await repository.upsertOwnerAttention({
      attentionKind: 'partner_decision',
      consequenceOfInaction: 'Pilot timing may slip.',
      dedupeKey: 'partner_decision.efcu',
      now,
      recommendedAction: 'Decide whether to sponsor discovery.',
      sourceId: opportunityId,
      sourceType: 'opportunity',
      whyFounderRequired: 'A founder relationship is required.',
    });
    const secondAttention = await repository.upsertOwnerAttention({
      attentionKind: 'partner_decision',
      consequenceOfInaction: 'Pilot timing may slip.',
      dedupeKey: 'partner_decision.efcu',
      now: new Date('2026-08-17T12:00:00Z'),
      recommendedAction: 'Approve or decline discovery.',
      sourceId: opportunityId,
      sourceType: 'opportunity',
      whyFounderRequired: 'A founder relationship is required.',
    });
    expect(secondAttention).toBe(firstAttention);
    expect(await repository.ownerAttention()).toHaveLength(1);

    await database.query(
      "INSERT INTO households(id, name, created_at) VALUES ('household-business-test','Test household',$1)",
      [now.toISOString()],
    );
    await database.query(
      "INSERT INTO persons(id, display_name, created_at) VALUES ('person-business-owner','Business Owner',$1)",
      [now.toISOString()],
    );
    await repository.recordCustomerHealth({
      householdId: 'household-business-test',
      now,
      rulesetVersion: 'run2-v1',
      signals: {
        cancellationIntent: false,
        checkCompleted: false,
        familyParticipation: false,
        mobileInstalled: false,
        orientationComplete: false,
        paymentFailed: true,
        productInactiveDays: 31,
        supportCasesOpen: 1,
        trustedCircleEstablished: false,
        unresolvedIncident: false,
      },
    });
    const privacyRequestId = await repository.createPrivacyRequest({
      dueAt: new Date('2026-09-15T12:00:00Z'),
      householdId: 'household-business-test',
      now,
      requestKind: 'export',
      context: {
        householdId: 'household-business-test',
        actorPersonId: 'person-business-owner',
        audience: 'hq',
        correlationId: 'correlation-privacy-request',
        now,
      },
    });
    await expect(
      repository.advancePrivacyRequest({
        requestId: privacyRequestId,
        action: 'verify_identity',
        evidenceReference: '4242424242424242',
        context: {
          householdId: 'household-business-test',
          actorPersonId: 'person-business-owner',
          audience: 'hq',
          correlationId: 'correlation-privacy-sensitive-evidence',
          now,
        },
      }),
    ).rejects.toThrow('must not contain sensitive values');
    await repository.advancePrivacyRequest({
      requestId: privacyRequestId,
      action: 'verify_identity',
      evidenceReference: 'identity:local-fixture-v1',
      context: {
        householdId: 'household-business-test',
        actorPersonId: 'person-business-owner',
        audience: 'hq',
        correlationId: 'correlation-privacy-verify',
        now,
      },
    });
    await repository.advancePrivacyRequest({
      requestId: privacyRequestId,
      action: 'begin_review',
      evidenceReference: 'review:local-fixture-v1',
      context: {
        householdId: 'household-business-test',
        actorPersonId: 'person-business-owner',
        audience: 'hq',
        correlationId: 'correlation-privacy-review',
        now,
      },
    });
    const plannedPrivacyRequest = await repository.advancePrivacyRequest({
      requestId: privacyRequestId,
      action: 'record_plan',
      evidenceReference: 'plan:local-fixture-v1',
      context: {
        householdId: 'household-business-test',
        actorPersonId: 'person-business-owner',
        audience: 'hq',
        correlationId: 'correlation-privacy-plan',
        now,
      },
    });
    expect(plannedPrivacyRequest).toEqual(
      expect.objectContaining({
        id: privacyRequestId,
        state: 'in_progress',
        identityVerificationState: 'verified',
        plan: expect.objectContaining({
          kind: 'export_manifest',
          requiresProfessionalReview: true,
        }),
      }),
    );
    await expect(
      repository.advancePrivacyRequest({
        requestId: privacyRequestId,
        action: 'record_plan',
        evidenceReference: 'plan:local-fixture-retry-v1',
        context: {
          householdId: 'household-business-test',
          actorPersonId: 'person-business-owner',
          audience: 'hq',
          correlationId: 'correlation-privacy-plan-retry',
          now,
        },
      }),
    ).resolves.toEqual(plannedPrivacyRequest);
    const privacyEvidence = await database.query<{ total: number } & Record<string, unknown>>(
      'SELECT count(*)::int AS total FROM privacy_request_events WHERE request_id = $1',
      [privacyRequestId],
    );
    expect(privacyEvidence.rows[0]?.total).toBe(4);
    await expect(
      database.query('DELETE FROM privacy_request_events WHERE request_id = $1', [
        privacyRequestId,
      ]),
    ).rejects.toThrow('append-only');

    await repository.putAutomationPolicy({
      now,
      policy: {
        action: 'create_internal_task',
        allowedDataClasses: ['public'],
        allowedTools: ['hq'],
        autonomy: 'auto',
        budgetCents: 10,
        enabled: true,
        requiresAudit: true,
      },
    });
    const allowed = await repository.evaluateAutomation({
      globalKillSwitch: false,
      now,
      request: {
        action: 'create_internal_task',
        dataClasses: ['public'],
        estimatedCostCents: 1,
        tool: 'hq',
      },
    });
    const blocked = await repository.evaluateAutomation({
      globalKillSwitch: true,
      now,
      request: {
        action: 'create_internal_task',
        dataClasses: ['public'],
        estimatedCostCents: 1,
        tool: 'hq',
      },
    });
    expect(allowed).toMatchObject({ allowed: true, disposition: 'auto' });
    expect(blocked).toMatchObject({ allowed: false, disposition: 'blocked' });

    expect(await repository.ownerBrief(new Date('2026-09-01T12:00:00Z'))).toMatchObject({
      attention: 1,
      atRiskHouseholds: 1,
      creditUnionUniverse: 1,
      openOpportunities: 1,
      staleOpportunities: 1,
    });

    const contentSourceId = await repository.createContentSource({
      canonicalUrl: 'https://ncua.gov/example',
      capturedAt: now,
      createdByPersonId: 'person-business-owner',
      evidenceState: 'verified',
      freshUntil: new Date('2027-01-01T00:00:00Z'),
      sourceFingerprint: 'source-test-fingerprint',
      sourceKind: 'official',
      title: 'Official source fixture',
    });
    const contentItemId = await repository.createContentItem({
      claimFlags: [],
      contentKind: 'faq',
      createdAt: now,
      createdByPersonId: 'person-business-owner',
      evidence: [{ sourceId: contentSourceId, supportedClaim: 'Supports the fixture answer.' }],
      title: 'Fixture FAQ',
    });
    await repository.submitContentForReview({ contentItemId, founderApproval: true });
    await repository.approveContent({
      approvedAt: now,
      approvedByPersonId: 'person-business-owner',
      contentItemId,
    });

    const referralId = await repository.createReferral({
      createdAt: now,
      referralKind: 'friend',
      referrerPersonId: 'person-business-owner',
    });
    await repository.transitionReferral({ at: now, nextState: 'accepted', referralId });
    await repository.transitionReferral({ at: now, nextState: 'activated', referralId });
    expect(
      await repository.approveReferralReward({
        amountMinor: 500,
        approvedByPersonId: 'person-business-owner',
        createdAt: now,
        currency: 'USD',
        policy: {
          approvedBy: 'person-business-owner',
          enabled: true,
          maximumAwardsPerReferrer: 3,
          rewardCode: 'approved_fixture',
        },
        priorAwards: 0,
        referralId,
        referredHouseholdActivated: true,
      }),
    ).toMatch(/^reward_/u);

    const firstLifecycle = await repository.startLifecycle({
      householdId: 'household-business-test',
      marketingConsented: false,
      now,
      trigger: 'win_back_eligible',
      triggerEventId: 'event-winback-test',
    });
    const replayedLifecycle = await repository.startLifecycle({
      householdId: 'household-business-test',
      marketingConsented: false,
      now,
      trigger: 'win_back_eligible',
      triggerEventId: 'event-winback-test',
    });
    expect(replayedLifecycle).toBe(firstLifecycle);
    await repository.suppressCommunication({
      channel: 'all',
      effectiveAt: now,
      reason: 'Fixture unsubscribe',
      scope: 'all',
      source: 'fixture',
      subjectId: 'person-business-owner',
      subjectKind: 'person',
    });
    await repository.createWorkCase({
      category: 'fraud',
      executiveEscalation: false,
      householdId: 'household-business-test',
      needsArtifactAccess: true,
      now,
      safetySeverity: 'high',
      severity: 'high',
      summary: 'Fixture safety review',
    });
    const workflow = await database.query<{
      state: string;
      steps: number;
      routing_class: string;
      content_state: string;
    }>(
      `SELECT
      (SELECT state FROM lifecycle_workflows WHERE id = $1) AS state,
      (SELECT count(*)::int FROM lifecycle_steps WHERE workflow_id = $1) AS steps,
      (SELECT routing_class FROM hq_work_cases LIMIT 1) AS routing_class,
      (SELECT review_state FROM governed_content_items WHERE id = $2) AS content_state`,
      [firstLifecycle, contentItemId],
    );
    expect(workflow.rows[0]).toEqual({
      content_state: 'approved',
      routing_class: 'trust_safety',
      state: 'suppressed',
      steps: 0,
    });
  }, 20_000);
});
