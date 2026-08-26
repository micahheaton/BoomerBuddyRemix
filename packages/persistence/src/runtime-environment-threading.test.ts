import {
  foundingHouseholdProtectedEnrollmentConsentVersion,
  foundingHouseholdServiceConsentVersion,
} from '@boomerbuddy/domain';
import { createSeededTestDatabase, testArtifactProtection } from '@boomerbuddy/testkit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CheckRepository, type DecisionRecord } from './checks';
import { CommerceOperationsRepository } from './commerce';
import type { Database } from './database';
import { EntitlementRepository, protectedSelfEnrollmentConsent } from './entitlements';
import {
  foundingHouseholdProtectedDocuments,
  FoundingHouseholdRepository,
  foundingHouseholdServiceDocuments,
  type FoundingHouseholdMemberAccess,
} from './founding-households';
import { OrientationRepository } from './orientation';
import { SessionRepository } from './sessions';
import type { IdFactory } from './values';

const now = new Date('2026-08-17T12:00:00.000Z');
const founderPersonId = 'person-hq-heidi';

function labeledIds(label: string): IdFactory {
  let sequence = 0;
  return { next: (prefix) => `${prefix}-${label}-${(sequence += 1)}` };
}

const decision: DecisionRecord = {
  risk: 'unknown',
  evidenceSufficiency: 'limited',
  calibration: 'not_calibrated',
  summary: 'The local runtime-environment regression provider does not determine risk.',
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
  provider: { name: 'local-unknown', state: 'mock', version: 'runtime-environment-test' },
  rulesetVersion: 'runtime-environment-test-v1',
};

describe('runtime-environment entitlement threading', () => {
  let database: Database;
  let aliceAccess: FoundingHouseholdMemberAccess;

  beforeEach(async () => {
    database = await createSeededTestDatabase(now);
    const sessionId = await new SessionRepository(database, labeledIds('session')).create({
      personId: 'person-owner-alice',
      audience: 'customer',
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 180 * 86_400_000),
    });
    const actorIdentityId = 'identity-owner-alice';
    const actorIdentitySubject = 'owner-alice';
    aliceAccess = {
      actorPersonId: 'person-owner-alice',
      actorIssuer: 'boomerbuddy-dev',
      actorIdentityId,
      actorIdentitySubject,
      sessionId,
      audience: 'customer',
      correlationId: 'correlation:runtime-environment-alice',
    };
    const protectedEnrollment = new EntitlementRepository(
      database,
      labeledIds('protected-consent'),
      'local',
    );
    await protectedEnrollment.withdrawProtectedSelfIdempotent({
      householdId: 'household-sunrise',
      personId: aliceAccess.actorPersonId,
      actorPersonId: aliceAccess.actorPersonId,
      operationKey: 'protected-self-withdraw:00000000-0000-4000-8000-000000000080',
      actorIdentityId,
      actorIssuer: aliceAccess.actorIssuer,
      actorIdentitySubject,
      sessionId: aliceAccess.sessionId,
      audience: aliceAccess.audience,
      correlationId: 'correlation:runtime-environment-consent-withdraw',
      now,
    });
    await protectedEnrollment.enrollProtectedSelfIdempotent({
      householdId: 'household-sunrise',
      personId: aliceAccess.actorPersonId,
      actorPersonId: aliceAccess.actorPersonId,
      consentVersion: protectedSelfEnrollmentConsent.version,
      ...protectedSelfEnrollmentConsent.documents,
      operationKey: 'protected-self-enroll:00000000-0000-4000-8000-000000000081',
      actorIdentityId,
      actorIssuer: aliceAccess.actorIssuer,
      actorIdentitySubject,
      sessionId: aliceAccess.sessionId,
      audience: aliceAccess.audience,
      correlationId: 'correlation:runtime-environment-consent-enroll',
      now,
    });
  });

  afterEach(async () => database.close());

  async function enrollSunriseInLocalFoundingHousehold(): Promise<void> {
    const founding = new FoundingHouseholdRepository(
      database,
      Buffer.alloc(32, 31),
      1,
      founderPersonId,
      'local',
      labeledIds('founding'),
      async (_transaction, observedAt) => new Date(observedAt),
    );
    const founderAccess = {
      actorPersonId: founderPersonId,
      correlationId: 'correlation:runtime-environment-founder',
    } as const;
    await founding.configurePolicy({
      access: founderAccess,
      operationKey: 'founding-policy:00000000-0000-4000-8000-000000000091',
      expectedRevision: 1,
      state: 'active',
      benefitKey: 'family_beta_v1',
      maxHouseholds: 1,
      invitationTtlDays: 7,
      accessDurationDays: 30,
      programEndsAt: new Date('2026-10-01T00:00:00.000Z'),
      now,
    });
    const invitation = await founding.createInvitation({
      access: founderAccess,
      operationKey: 'founding-invite:00000000-0000-4000-8000-000000000092',
      now,
    });
    if (invitation.invitationCredential === undefined) {
      throw new Error('Expected a one-time local invitation credential');
    }
    await founding.acceptInvitation({
      access: aliceAccess,
      householdId: 'household-sunrise',
      invitationId: invitation.invitation.id,
      invitationCredential: invitation.invitationCredential,
      operationKey: 'founding-accept:00000000-0000-4000-8000-000000000093',
      serviceConsentVersion: foundingHouseholdServiceConsentVersion,
      serviceDisclosureDigest: foundingHouseholdServiceDocuments.disclosureDigest,
      servicePolicyDigest: foundingHouseholdServiceDocuments.policyDigest,
      protectedEnrollmentConsentVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
      protectedEnrollmentDisclosureDigest: foundingHouseholdProtectedDocuments.disclosureDigest,
      protectedEnrollmentPolicyDigest: foundingHouseholdProtectedDocuments.policyDigest,
      now,
    });
  }

  function checkInput(label: string) {
    return {
      householdId: 'household-sunrise',
      actorPersonId: 'person-protected-pat',
      audience: 'customer' as const,
      kind: 'text' as const,
      content: `A harmless ${label} runtime-environment authorization check.`,
      decision,
      correlationId: `correlation:runtime-environment-check-${label}`,
      now,
    };
  }

  it('rejects a restored local Founding grant by default while local Check and Orientation remain usable', async () => {
    await enrollSunriseInLocalFoundingHousehold();

    const protectedAllocation = await database.query<
      { readonly entitlement_grant_id: string } & Record<string, unknown>
    >(
      `SELECT entitlement_grant_id FROM commerce_allowance_allocations
       WHERE household_id = 'household-sunrise' AND id = 'allocation-sunrise-pat'`,
    );
    expect(protectedAllocation.rows[0]?.entitlement_grant_id).toMatch(/^founding-grant-founding-/u);

    const productionChecks = new CheckRepository(
      database,
      testArtifactProtection(),
      labeledIds('check-production'),
    );
    await expect(productionChecks.create(checkInput('production-denied'))).rejects.toMatchObject({
      code: 'not_authorized',
    });

    const productionOrientation = new OrientationRepository(
      database,
      Buffer.alloc(32, 17),
      labeledIds('orientation-production'),
    );
    await expect(
      productionOrientation.start({
        householdId: 'household-sunrise',
        subjectPersonId: 'person-protected-pat',
        actorPersonId: 'person-protected-pat',
        audience: 'customer',
        correlationId: 'correlation:runtime-environment-orientation-production',
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });

    const localChecks = new CheckRepository(
      database,
      testArtifactProtection(),
      labeledIds('check-local'),
      'local',
    );
    const localCheck = await localChecks.create(checkInput('local-allowed'));
    expect(localCheck).toMatchObject({
      householdId: 'household-sunrise',
      ownerPersonId: 'person-protected-pat',
    });
    await expect(
      productionChecks.share({
        checkId: localCheck.id,
        householdId: 'household-sunrise',
        ownerPersonId: 'person-protected-pat',
        sharedWithPersonId: 'person-trusted-terry',
        audience: 'customer',
        correlationId: 'correlation:runtime-environment-share-production',
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });

    const localOrientation = new OrientationRepository(
      database,
      Buffer.alloc(32, 17),
      labeledIds('orientation-local'),
      'local',
    );
    await expect(
      localOrientation.start({
        householdId: 'household-sunrise',
        subjectPersonId: 'person-protected-pat',
        actorPersonId: 'person-protected-pat',
        audience: 'customer',
        correlationId: 'correlation:runtime-environment-orientation-local',
        now,
      }),
    ).resolves.toMatchObject({
      householdId: 'household-sunrise',
      personId: 'person-protected-pat',
    });
    for (const step of ['protection_subject', 'trusted_circle'] as const) {
      await localOrientation.completeStep({
        householdId: 'household-sunrise',
        subjectPersonId: 'person-protected-pat',
        actorPersonId: 'person-protected-pat',
        step,
        audience: 'customer',
        correlationId: `correlation:runtime-environment-orientation-${step}`,
        now,
      });
    }
    await expect(
      localOrientation.setSafeWord({
        householdId: 'household-sunrise',
        subjectPersonId: 'person-protected-pat',
        actorPersonId: 'person-protected-pat',
        action: 'defer',
        audience: 'customer',
        correlationId: 'correlation:runtime-environment-safe-word-local',
        now,
      }),
    ).resolves.toMatchObject({
      state: {
        safeWordDisposition: 'informed_deferral',
        completedSteps: expect.arrayContaining(['safe_word']),
      },
    });

    const unrelatedGrant = await database.query<
      { readonly id: string; readonly revoked_at: unknown } & Record<string, unknown>
    >(
      `SELECT id, revoked_at FROM entitlement_grants
       WHERE household_id = 'household-sunrise' AND id = 'grant-local-sunrise'`,
    );
    expect(unrelatedGrant.rows).toEqual([{ id: 'grant-local-sunrise', revoked_at: null }]);
  });

  it('keeps the local Founding allocation locally and restores it to an unrelated eligible grant in production reconciliation', async () => {
    await enrollSunriseInLocalFoundingHousehold();
    const periodEndsAt = new Date(now.getTime() + 365 * 86_400_000);
    await database.query(
      `UPDATE commerce_subscriptions
       SET source = 'web', precedence = 300, updated_at = $1
       WHERE household_id = 'household-sunrise' AND id = 'subscription-local-sunrise'`,
      [now.toISOString()],
    );
    await database.query(
      `UPDATE entitlement_grants SET source = 'web', precedence = 300
       WHERE household_id = 'household-sunrise' AND id = 'grant-local-sunrise'`,
    );
    await database.query(
      `UPDATE commerce_provider_subscription_records
       SET provider = 'stripe', environment = 'test',
           external_subscription_id = 'sub_sunrise_runtime_environment'
       WHERE id = 'provider-record-sunrise'`,
    );

    const applyEvent = async (
      commerce: CommerceOperationsRepository,
      sequence: number,
    ): Promise<void> => {
      const eventAt = new Date(now.getTime() + sequence * 1_000);
      const externalEventId = `evt_sunrise_runtime_environment_${sequence}`;
      const captured = await commerce.captureVerifiedProviderEvent({
        provider: 'stripe',
        environment: 'test',
        externalEventId,
        eventType: 'customer.subscription.updated',
        rawPayload: JSON.stringify({ id: externalEventId, type: 'customer.subscription.updated' }),
        providerApiVersion: '2026-06-30.basil',
        providerObjectId: 'sub_sunrise_runtime_environment',
        providerEventCreatedAt: eventAt,
        normalizedLifecycle: 'active',
        now: eventAt,
      });
      await commerce.applyProviderLifecycle({
        inboxId: captured.id,
        provider: 'stripe',
        environment: 'test',
        externalEventId,
        providerApiVersion: '2026-06-30.basil',
        providerObjectId: 'sub_sunrise_runtime_environment',
        providerEventCreatedAt: eventAt,
        householdId: 'household-sunrise',
        subscriptionId: 'subscription-local-sunrise',
        externalSubscriptionId: 'sub_sunrise_runtime_environment',
        lifecycle: 'active',
        currentPeriodStartsAt: now,
        currentPeriodEndsAt: periodEndsAt,
        accessEvidence: { kind: 'non_payment' },
        now: eventAt,
      });
    };
    const allocationGrantIds = async (): Promise<readonly string[]> => {
      const result = await database.query<
        { readonly entitlement_grant_id: string } & Record<string, unknown>
      >(
        `SELECT entitlement_grant_id FROM commerce_allowance_allocations
         WHERE household_id = 'household-sunrise'
           AND state = 'active'
           AND (
             (allowance_key = 'protected_members'
               AND subject_id IN ('person-owner-alice','person-protected-pat'))
             OR (allowance_key = 'trusted_circle_participants'
               AND subject_id = 'person-trusted-terry')
           )
         ORDER BY subject_id`,
      );
      return result.rows.map((row) => row.entitlement_grant_id);
    };

    const foundingGrantIds = await allocationGrantIds();
    expect(foundingGrantIds).toHaveLength(3);
    expect(new Set(foundingGrantIds).size).toBe(1);
    expect(foundingGrantIds[0]).toMatch(/^founding-grant-founding-/u);
    await applyEvent(
      new CommerceOperationsRepository(
        database,
        Buffer.alloc(32, 23),
        1,
        labeledIds('commerce-local'),
        'local',
      ),
      1,
    );
    await expect(allocationGrantIds()).resolves.toEqual(foundingGrantIds);

    await applyEvent(
      new CommerceOperationsRepository(
        database,
        Buffer.alloc(32, 23),
        1,
        labeledIds('commerce-production'),
      ),
      2,
    );
    await expect(allocationGrantIds()).resolves.toEqual([
      'grant-local-sunrise',
      'grant-local-sunrise',
      'grant-local-sunrise',
    ]);
    const unrelatedGrant = await database.query<
      { readonly source: string; readonly revoked_at: unknown } & Record<string, unknown>
    >(
      `SELECT source, revoked_at FROM entitlement_grants
       WHERE household_id = 'household-sunrise' AND id = 'grant-local-sunrise'`,
    );
    expect(unrelatedGrant.rows).toEqual([{ source: 'web', revoked_at: null }]);
  });
});
