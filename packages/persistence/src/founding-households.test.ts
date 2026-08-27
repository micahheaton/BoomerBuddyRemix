import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  foundingHouseholdCohortKey,
  foundingHouseholdProtectedEnrollmentConsentVersion,
  foundingHouseholdProductionServiceConsentVersion,
  foundingHouseholdServiceConsentVersion,
  ids,
  type DomainError,
} from '@boomerbuddy/domain';
import { createSeededTestDatabase } from '@boomerbuddy/testkit';

import type { Database, QueryResult, SqlExecutor } from './database';
import { appendConsentEvidence } from './consent';
import { EntitlementRepository, protectedSelfEnrollmentConsent } from './entitlements';
import { FamilyRepository } from './family';
import { FeedbackRepository, type FeedbackIntakeRequest } from './feedback';
import {
  foundingHouseholdDefinitionDigest,
  foundingHouseholdLegacyDefinitionDigest,
  foundingHouseholdProductionSponsorOrganizationId,
  foundingHouseholdProductionSponsorshipId,
  foundingHouseholdProductionServiceDocuments,
  foundingHouseholdProtectedDocuments,
  FoundingHouseholdRepository,
  foundingHouseholdServiceDocuments,
  type FoundingHouseholdMemberAccess,
} from './founding-households';
import { ProductionIdentityRepository } from './production-identity';
import { SessionRepository } from './sessions';
import { HqRepository } from './hq';
import type { IdFactory } from './values';

const now = new Date('2026-08-17T12:00:00.000Z');
const founderPersonId = 'person-hq-heidi';
const founderAccess = {
  actorPersonId: founderPersonId,
  correlationId: 'correlation:founding-founder',
} as const;

function operation(kind: 'policy' | 'invite' | 'accept' | 'invite-revoke' | 'offboard', n: number) {
  return `founding-${kind}:00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function sequentialIds(): IdFactory {
  let value = 0;
  return { next: (prefix) => `${prefix}-founding-${++value}` };
}

function labeledIds(label: string): IdFactory {
  let value = 0;
  return { next: (prefix) => `${prefix}-founding-${label}-${++value}` };
}

async function refreshExactProtectedSelfConsent(
  database: Database,
  input: {
    readonly personId: string;
    readonly identityId: string;
    readonly identitySubject: string;
    readonly sessionId: string;
    readonly keyNamespace: string;
    readonly correlationLabel: string;
  },
): Promise<void> {
  const entitlements = new EntitlementRepository(
    database,
    labeledIds(input.correlationLabel),
    'local',
  );
  await entitlements.withdrawProtectedSelfIdempotent({
    householdId: 'household-sunrise',
    personId: input.personId,
    actorPersonId: input.personId,
    operationKey: `protected-self-withdraw:${input.keyNamespace}-0000-4000-8000-000000000001`,
    actorIdentityId: input.identityId,
    actorIssuer: 'boomerbuddy-dev',
    actorIdentitySubject: input.identitySubject,
    sessionId: input.sessionId,
    audience: 'customer',
    correlationId: `correlation-founding-${input.correlationLabel}-withdraw`,
    now,
  });
  await entitlements.enrollProtectedSelfIdempotent({
    householdId: 'household-sunrise',
    personId: input.personId,
    actorPersonId: input.personId,
    consentVersion: protectedSelfEnrollmentConsent.version,
    ...protectedSelfEnrollmentConsent.documents,
    operationKey: `protected-self-enroll:${input.keyNamespace}-0000-4000-8000-000000000002`,
    actorIdentityId: input.identityId,
    actorIssuer: 'boomerbuddy-dev',
    actorIdentitySubject: input.identitySubject,
    sessionId: input.sessionId,
    audience: 'customer',
    correlationId: `correlation-founding-${input.correlationLabel}-enroll`,
    now,
  });
}

interface QueryOverride {
  readonly sql?: string;
  readonly parameters?: readonly unknown[];
  readonly result?: QueryResult<Record<string, unknown>>;
}

function withTransactionQueryOverride(
  target: Database,
  override: (sql: string, parameters: readonly unknown[] | undefined) => QueryOverride | undefined,
): Database {
  return {
    kind: target.kind,
    query: <Row extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]) =>
      target.query<Row>(sql, parameters),
    exec: (sql: string) => target.exec(sql),
    transaction: <Result>(work: (transaction: SqlExecutor) => Promise<Result>) =>
      target.transaction((transaction) =>
        work({
          exec: (sql: string) => transaction.exec(sql),
          query: async <Row extends Record<string, unknown>>(
            sql: string,
            parameters?: readonly unknown[],
          ) => {
            const replacement = override(sql, parameters);
            if (replacement?.result !== undefined) {
              return replacement.result as QueryResult<Row>;
            }
            return transaction.query<Row>(
              replacement?.sql ?? sql,
              replacement?.parameters ?? parameters,
            );
          },
        }),
      ),
    close: async () => undefined,
  };
}

function withQueryOverrideEverywhere(
  target: Database,
  override: (sql: string, parameters: readonly unknown[] | undefined) => QueryOverride | undefined,
): Database {
  const queryWithOverride = async <Row extends Record<string, unknown>>(
    executor: SqlExecutor,
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<QueryResult<Row>> => {
    const replacement = override(sql, parameters);
    if (replacement?.result !== undefined) return replacement.result as QueryResult<Row>;
    return executor.query<Row>(replacement?.sql ?? sql, replacement?.parameters ?? parameters);
  };
  return {
    kind: target.kind,
    query: <Row extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]) =>
      queryWithOverride<Row>(target, sql, parameters),
    exec: (sql: string) => target.exec(sql),
    transaction: <Result>(work: (transaction: SqlExecutor) => Promise<Result>) =>
      target.transaction((transaction) =>
        work({
          exec: (sql: string) => transaction.exec(sql),
          query: <Row extends Record<string, unknown>>(
            sql: string,
            parameters?: readonly unknown[],
          ) => queryWithOverride<Row>(transaction, sql, parameters),
        }),
      ),
    close: async () => undefined,
  };
}

function databaseForExecutor(target: Database, executor: SqlExecutor): Database {
  return {
    kind: target.kind,
    query: <Row extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]) =>
      executor.query<Row>(sql, parameters),
    exec: (sql: string) => executor.exec(sql),
    transaction: async <Result>(work: (transaction: SqlExecutor) => Promise<Result>) =>
      work(executor),
    close: async () => undefined,
  };
}

async function insertDirectAuditAndOutbox(
  transaction: SqlExecutor,
  input: {
    readonly suffix: string;
    readonly householdId?: string;
    readonly actorPersonId: string;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly eventType: string;
    readonly aggregateType: string;
    readonly operationKey: string;
    readonly occurredAt: Date;
  },
): Promise<void> {
  const correlationId = `correlation:${input.suffix}`;
  await transaction.query(
    `INSERT INTO audit_events(
       id, household_id, actor_person_id, session_audience, action, resource_type,
       resource_id, outcome, metadata, correlation_id, occurred_at,
       founding_household_operation_key
     ) VALUES ($1,$2,$3,'hq',$4,$5,$6,'completed','{}'::jsonb,$7,$8,$9)`,
    [
      `audit-${input.suffix}`,
      input.householdId ?? null,
      input.actorPersonId,
      input.action,
      input.resourceType,
      input.resourceId,
      correlationId,
      input.occurredAt.toISOString(),
      input.operationKey,
    ],
  );
  await transaction.query(
    `INSERT INTO outbox_events(
       id, event_type, event_version, aggregate_type, aggregate_id, household_id,
       actor_person_id, correlation_id, classification, payload, occurred_at,
       available_at, next_attempt_at, founding_household_operation_key
     ) VALUES ($1,$2,1,$3,$4,$5,$6,$7,'internal','{}'::jsonb,$8,$8,$8,$9)`,
    [
      `event-${input.suffix}`,
      input.eventType,
      input.aggregateType,
      input.resourceId,
      input.householdId ?? null,
      input.actorPersonId,
      correlationId,
      input.occurredAt.toISOString(),
      input.operationKey,
    ],
  );
}

function feedbackRequest(sequence: number, text: string): FeedbackIntakeRequest {
  return {
    operationKey: `feedback:00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    text,
    feedbackType: 'product_feedback',
    source: { surface: 'in_app_contextual', deviceClass: 'desktop' },
    link: { permitted: false },
    followUp: { granted: false },
    researchRetention: { granted: false },
  };
}

function feedbackRepository(database: Database): FeedbackRepository {
  return new FeedbackRepository(
    database,
    {
      encryptionKey: Buffer.alloc(32, 43),
      encryptionKeyVersion: 1,
      fingerprintKey: Buffer.alloc(32, 47),
      fingerprintKeyVersion: 1,
    },
    sequentialIds(),
    async (_transaction, observedAt) => new Date(observedAt),
  );
}

describe('FoundingHouseholdRepository', () => {
  it('pins the additive production definition and consent documents', () => {
    expect({
      definition: foundingHouseholdDefinitionDigest(),
      service: foundingHouseholdProductionServiceDocuments,
    }).toEqual({
      definition: '1iiZgSqZuLNp_M7OEmEEPOglKpy4AjeSjK3y2ILrDd0',
      service: {
        disclosureVersion: 'founding-household-service-beta-v2',
        disclosureDigest: 'b120fec99dab8271bf106c5a44fbff7640f3cb179a72b63957d34978cc41f137',
        policyVersion: 'founding-household-service-beta-v2-policy',
        policyDigest: '815a516d88fef3be88b960c5f12a6b36c7be2f1c020610bfab16f7746ba197df',
      },
    });
  });
  let database: Database;
  let repository: FoundingHouseholdRepository;
  let bobAccess: FoundingHouseholdMemberAccess;
  let overrideRepositorySequence = 0;

  beforeEach(async () => {
    database = await createSeededTestDatabase(now);
    repository = new FoundingHouseholdRepository(
      database,
      Buffer.alloc(32, 31),
      1,
      founderPersonId,
      'local',
      sequentialIds(),
      async (_transaction, observedAt) => new Date(observedAt),
    );
    const sessionId = await new SessionRepository(database, sequentialIds()).create({
      personId: 'person-owner-bob',
      audience: 'customer',
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 180 * 86_400_000),
    });
    bobAccess = {
      actorPersonId: 'person-owner-bob',
      actorIssuer: 'boomerbuddy-dev',
      sessionId,
      audience: 'customer',
      correlationId: 'correlation:founding-bob',
    };
  });

  afterEach(async () => database.close());

  async function withCapturedAuthority<T>(
    capturedAt: Date,
    callback: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    return database.transaction(async (transaction) => {
      await transaction.query(
        `SELECT set_config('boomerbuddy.founding_household_test_now',$1,true) AS configured`,
        [capturedAt.toISOString()],
      );
      await transaction.query('SELECT capture_founding_household_authority_now()');
      return callback(transaction);
    });
  }

  async function provisionProductionFounder(): Promise<void> {
    await database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO identities(id, person_id, issuer, subject, status, created_at)
         VALUES ('identity-founding-production-founder',$1,
                 'https://founder.clerk.test','founder_subject','active',$2)`,
        [founderPersonId, now.toISOString()],
      );
      await transaction.query(
        `INSERT INTO organizations(id, name, kind, verification_state, created_at)
         VALUES ('organization-founding-production-hq','BoomerBuddy HQ',
                 'internal','verified',$1)`,
        [now.toISOString()],
      );
      await transaction.query(
        `INSERT INTO employee_assignments(
           id, person_id, organization_id, role, status, created_at
         ) VALUES ('employee-founding-production-founder',$1,
                   'organization-founding-production-hq','hq_owner','active',$2)`,
        [founderPersonId, now.toISOString()],
      );
      await transaction.query(
        `INSERT INTO production_founder_bootstraps(
           bootstrap_key, identity_id, issuer, subject, person_id,
           organization_id, organization_kind, organization_verification_state,
           employee_assignment_id, employee_role, correlation_id, created_at
         ) VALUES (
           'production-founder-v1','identity-founding-production-founder',
           'https://founder.clerk.test','founder_subject',$1,
           'organization-founding-production-hq','internal','verified',
           'employee-founding-production-founder','hq_owner',
           'correlation:founding-production-founder',$2
         )`,
        [founderPersonId, now.toISOString()],
      );
    });
  }

  async function provisionProductionFounderAndSponsor(): Promise<void> {
    await provisionProductionFounder();
    await database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO organizations(id, name, kind, verification_state, created_at)
         VALUES ('organization-founding-production-sponsor','Founding Household sponsor',
                 'sponsor','verified',$1)`,
        [now.toISOString()],
      );
      await transaction.query(
        `INSERT INTO commerce_sponsorships(
           id, organization_id, plan_version_id, state, privacy_policy_version,
           starts_at, ends_at, created_at
         ) VALUES (
           'founding-sponsorship-family-production-v1',
           'organization-founding-production-sponsor','founding_family_beta_v2','active',
           'founding-household-production-v1',$1,$2,$1
         )`,
        [now.toISOString(), '2026-10-15T00:00:00.000Z'],
      );
      await transaction.query(
        `INSERT INTO founding_household_sponsor_backings(
           cohort_key, environment, benefit_key, organization_id, sponsorship_id,
           plan_version_id, evidence_tier, approved_by_person_id, approved_at
         ) VALUES (
           $1,'production','family_beta_v1','organization-founding-production-sponsor',
           'founding-sponsorship-family-production-v1','founding_family_beta_v2',
           'live_production',$2,$3
         )`,
        [foundingHouseholdCohortKey, founderPersonId, now.toISOString()],
      );
    });
  }

  function productionFoundingRepository(): FoundingHouseholdRepository {
    return new FoundingHouseholdRepository(
      database,
      Buffer.alloc(32, 31),
      1,
      founderPersonId,
      'production',
      sequentialIds(),
      async (_transaction, observedAt) => new Date(observedAt),
    );
  }

  async function productionCustomer(subject: string, suffix: string) {
    let identitySequence = 0;
    const identities = new ProductionIdentityRepository(database, {
      next: (prefix) => `${prefix}-founding-production-${suffix}-${++identitySequence}`,
    });
    const bootstrap = await identities.ensureCustomerBootstrap({
      issuer: 'https://customer.clerk.test',
      subject,
      now,
    });
    if (bootstrap === null) throw new Error('Expected an exact production customer bootstrap');
    const sessions = new SessionRepository(
      database,
      { next: () => `session-founding-production-${suffix}` },
      'production',
    );
    const resolved = await sessions.resolveProviderSession({
      identityId: bootstrap.identityId,
      personId: bootstrap.personId,
      issuer: bootstrap.issuer,
      subject: bootstrap.subject,
      providerSessionId: `provider-session-founding-production-${suffix}`,
      audience: 'customer',
      issuedAt: new Date(now.getTime() - 1_000),
      expiresAt: new Date(now.getTime() + 30 * 86_400_000),
      now,
    });
    if (resolved === null) throw new Error('Expected an exact production customer session');
    return {
      bootstrap,
      access: {
        actorPersonId: bootstrap.personId,
        actorIssuer: resolved.issuer,
        actorIdentityId: resolved.identityId,
        actorIdentitySubject: resolved.identitySubject,
        sessionId: resolved.principal.sessionId,
        audience: 'customer' as const,
        correlationId: `correlation:founding-production-${suffix}`,
      },
    };
  }

  async function activatePolicy(input?: {
    readonly benefitKey?: 'plus_beta_v1' | 'family_beta_v1';
    readonly maxHouseholds?: number;
    readonly invitationTtlDays?: number;
    readonly accessDurationDays?: number;
    readonly programEndsAt?: Date;
    readonly operationSequence?: number;
  }) {
    return repository.configurePolicy({
      access: founderAccess,
      operationKey: operation('policy', input?.operationSequence ?? 1),
      expectedRevision: 1,
      state: 'active',
      benefitKey: input?.benefitKey ?? 'family_beta_v1',
      maxHouseholds: input?.maxHouseholds ?? 2,
      invitationTtlDays: input?.invitationTtlDays ?? 7,
      accessDurationDays: input?.accessDurationDays ?? 30,
      programEndsAt: input?.programEndsAt ?? new Date('2026-10-01T00:00:00.000Z'),
      now,
    });
  }

  async function createInvitation(sequence = 2) {
    const result = await repository.createInvitation({
      access: founderAccess,
      operationKey: operation('invite', sequence),
      now,
    });
    if (result.invitationCredential === undefined) {
      throw new Error('Expected one-time local invitation credential');
    }
    return { ...result, credential: result.invitationCredential };
  }

  async function acceptBobWith(
    target: FoundingHouseholdRepository,
    invitation: Awaited<ReturnType<typeof createInvitation>>,
    sequence = 3,
  ) {
    return target.acceptInvitation({
      access: bobAccess,
      householdId: 'household-harbor',
      invitationId: invitation.invitation.id,
      invitationCredential: invitation.credential,
      operationKey: operation('accept', sequence),
      serviceConsentVersion: foundingHouseholdServiceConsentVersion,
      serviceDisclosureDigest: foundingHouseholdServiceDocuments.disclosureDigest,
      servicePolicyDigest: foundingHouseholdServiceDocuments.policyDigest,
      protectedEnrollmentConsentVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
      protectedEnrollmentDisclosureDigest: foundingHouseholdProtectedDocuments.disclosureDigest,
      protectedEnrollmentPolicyDigest: foundingHouseholdProtectedDocuments.policyDigest,
      now,
    });
  }

  async function acceptBob(invitation: Awaited<ReturnType<typeof createInvitation>>, sequence = 3) {
    return acceptBobWith(repository, invitation, sequence);
  }

  function repositoryWithQueryOverride(
    override: (
      sql: string,
      parameters: readonly unknown[] | undefined,
    ) => QueryOverride | undefined,
  ): FoundingHouseholdRepository {
    const repositorySequence = ++overrideRepositorySequence;
    let idSequence = 0;
    return new FoundingHouseholdRepository(
      withTransactionQueryOverride(database, override),
      Buffer.alloc(32, 31),
      1,
      founderPersonId,
      'local',
      { next: (prefix) => `${prefix}-founding-override-${repositorySequence}-${++idSequence}` },
      async (_transaction, observedAt) => new Date(observedAt),
    );
  }

  async function insertUnrelatedFamilyGrant(suffix: string, startsAt = now): Promise<string> {
    const subscriptionId = `subscription-${suffix}`;
    const grantId = `grant-${suffix}`;
    const endsAt = new Date(startsAt.getTime() + 90 * 86_400_000);
    await database.query(
      `INSERT INTO commerce_subscriptions(
         household_id, id, payer_person_id, plan_version_id, source, lifecycle,
         source_verified, precedence, current_period_starts_at, current_period_ends_at,
         reconciliation_state, created_at, updated_at
       ) VALUES (
         'household-harbor',$1,'person-owner-bob','family_v1','local','active',true,150,
         $2,$3,'not_required',$2,$2
       )`,
      [subscriptionId, startsAt.toISOString(), endsAt.toISOString()],
    );
    await database.query(
      `INSERT INTO commerce_provider_subscription_records(
         id, household_id, subscription_id, provider, environment,
         external_subscription_id, raw_state, provider_version, observed_at, verified_at
       ) VALUES (
         $1,'household-harbor',$2,'local','local',$3,'active','fixture-v1',$4,$4
       )`,
      [`provider-${suffix}`, subscriptionId, `local-${suffix}`, startsAt.toISOString()],
    );
    await database.query(
      `INSERT INTO entitlement_grants(
         household_id, id, source, capabilities, starts_at, ends_at, revoked_at,
         source_verified, precedence, plan_version_id, subscription_id,
         sponsorship_id, created_at
       ) SELECT 'household-harbor',$1,'local',capabilities,$2,$3,NULL,true,150,id,$4,NULL,$2
         FROM commerce_plan_versions WHERE id = 'family_v1'`,
      [grantId, startsAt.toISOString(), endsAt.toISOString(), subscriptionId],
    );
    return grantId;
  }

  function repositoryForDatabase(target: Database): FoundingHouseholdRepository {
    let value = 0;
    return new FoundingHouseholdRepository(
      target,
      Buffer.alloc(32, 31),
      1,
      founderPersonId,
      'local',
      { next: (prefix) => `${prefix}-founding-h5-projection-${++value}` },
      async (_transaction, observedAt) => new Date(observedAt),
    );
  }

  async function insertPostEndFunnelFacts(target: Database, observedAt: Date): Promise<void> {
    const expiresAt = new Date(observedAt.getTime() + 30 * 86_400_000);
    await target.query(
      `INSERT INTO orientation_states(
         household_id, person_id, status, completed_steps, safe_word_disposition,
         needs_attention, version, updated_at
       ) VALUES (
         'household-harbor','person-owner-bob','ready','[]'::jsonb,
         'informed_deferral',false,1,$1
       )`,
      [observedAt.toISOString()],
    );
    await target.query(
      `INSERT INTO artifacts(
         household_id, id, owner_person_id, kind, encrypted_content, input_fingerprint,
         encryption_key_version, fingerprint_key_version, state, delete_after, created_at
       ) VALUES (
         'household-harbor','artifact-founding-canonical-post-end','person-owner-bob','text',
         NULL,NULL,1,1,'active',$2,$1
       )`,
      [observedAt.toISOString(), expiresAt.toISOString()],
    );
    await target.query(
      `INSERT INTO analyses(
         household_id, id, artifact_id, requested_by, risk, evidence_sufficiency,
         calibration, summary, evidence, actions, provider_name, provider_state,
         provider_version, ruleset_version, state, created_at
       ) VALUES (
         'household-harbor','analysis-founding-canonical-post-end',
         'artifact-founding-canonical-post-end','person-owner-bob','unknown','limited',
         'not_calibrated','Synthetic post-window fact','[]'::jsonb,'[]'::jsonb,
         'local-test','mock','local-test-v1','local-test-v1','completed',$1
       )`,
      [observedAt.toISOString()],
    );
    await target.query(
      `INSERT INTO household_memberships(
         household_id, id, person_id, membership_kind, status, created_at
       ) VALUES (
         'household-harbor','membership-harbor-founding-canonical-terry',
         'person-trusted-terry','member','active',$1
       )`,
      [observedAt.toISOString()],
    );
    await target.query(
      `INSERT INTO consents(
         household_id, id, protected_person_id, granted_by_person_id, purpose,
         consent_version, state, granted_at
       ) VALUES (
         'household-harbor','consent-harbor-founding-canonical-terry','person-owner-bob',
         'person-owner-bob','trusted_circle_relationship','founding-canonical-v1','active',$1
       )`,
      [observedAt.toISOString()],
    );
    await target.query(
      `INSERT INTO consent_evidence(
         household_id, id, consent_id, actor_person_id, subject_person_id,
         recipient_person_id, purpose, scope, action, disclosure_version,
         disclosure_digest, policy_version, policy_digest, source_interaction,
         assurance, effective_at, recorded_at
       ) VALUES (
         'household-harbor','evidence-harbor-founding-canonical-terry',
         'consent-harbor-founding-canonical-terry','person-owner-bob','person-owner-bob',
         'person-trusted-terry','trusted_circle_relationship',$2::jsonb,'accept',
         'founding-canonical-v1',repeat('1',64),'founding-canonical-policy-v1',repeat('2',64),
         'founding_canonical_test','development',$1,$1
       )`,
      [observedAt.toISOString(), JSON.stringify({ permissions: ['view_shared_checks'] })],
    );
    await target.query(
      `INSERT INTO consent_current_projections(
         household_id, consent_id, latest_evidence_id, actor_person_id,
         subject_person_id, recipient_person_id, purpose, scope, state,
         effective_at, updated_at
       ) VALUES (
         'household-harbor','consent-harbor-founding-canonical-terry',
         'evidence-harbor-founding-canonical-terry','person-owner-bob','person-owner-bob',
         'person-trusted-terry','trusted_circle_relationship',$2::jsonb,'active',$1,$1
       )`,
      [observedAt.toISOString(), JSON.stringify({ permissions: ['view_shared_checks'] })],
    );
    await target.query(
      `INSERT INTO trusted_circle_relationships(
         household_id, id, protected_person_id, trusted_person_id, permissions,
         consent_id, consent_version, state, created_at, latest_consent_evidence_id
       ) VALUES (
         'household-harbor','relationship-harbor-founding-canonical-terry','person-owner-bob',
         'person-trusted-terry',$2::jsonb,'consent-harbor-founding-canonical-terry',
         'founding-canonical-v1','active',$1,'evidence-harbor-founding-canonical-terry'
       )`,
      [observedAt.toISOString(), JSON.stringify(['view_shared_checks'])],
    );
    await feedbackRepository(target).createAuthenticated({
      householdId: 'household-harbor',
      actorPersonId: 'person-owner-bob',
      request: feedbackRequest(
        501,
        'This synthetic feedback was recorded after canonical Founding access ended.',
      ),
      correlationId: 'correlation:founding-canonical-post-end',
      now: observedAt,
    });
    await new SessionRepository(target, {
      next: () => 'session-founding-canonical-post-end',
    }).create({
      personId: 'person-owner-bob',
      audience: 'customer',
      issuedAt: observedAt,
      expiresAt: new Date(observedAt.getTime() + 86_400_000),
    });
  }

  async function expectCanonicalAttention(input: {
    readonly target: Database;
    readonly targetRepository: FoundingHouseholdRepository;
    readonly enrollmentId: string;
    readonly attentionCode:
      | 'sponsor_backing_invalid'
      | 'subscription_invalid'
      | 'allocation_invalid'
      | 'grant_invalid'
      | 'service_consent_invalid';
    readonly effectiveEndsAt: Date;
    readonly observedAt: Date;
    readonly serviceConsentState?:
      | 'missing'
      | 'proposed'
      | 'active'
      | 'deferred'
      | 'withdrawn'
      | 'relinquished'
      | 'suspended'
      | 'revoked'
      | 'expired';
  }): Promise<void> {
    const status = await input.targetRepository.memberStatus({
      access: bobAccess,
      householdId: 'household-harbor',
      now: input.observedAt,
    });
    expect(status).toMatchObject({
      id: input.enrollmentId,
      state: 'attention',
      ledgerState: 'active',
      accessAttentionCode: input.attentionCode,
      effectiveEndsAt: input.effectiveEndsAt,
      ...(input.serviceConsentState === undefined
        ? {}
        : { serviceConsentState: input.serviceConsentState }),
    });
    for (const stage of [
      'orientation_ready',
      'first_check_completed',
      'trusted_circle_established',
      'feedback_submitted',
      'returned_later',
    ] as const) {
      expect(status?.funnel.find((milestone) => milestone.stage === stage)).toMatchObject({
        state: 'not_observed',
      });
    }

    const foundingGrant = await input.target.query<
      { entitlement_grant_id: string } & Record<string, unknown>
    >(`SELECT entitlement_grant_id FROM founding_household_enrollments WHERE id = $1`, [
      input.enrollmentId,
    ]);
    const foundingGrantId = foundingGrant.rows[0]?.entitlement_grant_id;
    if (foundingGrantId === undefined) throw new Error('Founding grant fixture is missing');
    const entitlements = await new EntitlementRepository(
      input.target,
      undefined,
      'local',
    ).forHousehold('household-harbor', input.observedAt);
    expect(entitlements.portfolio.contributingGrantIds).not.toContain(foundingGrantId);
    expect(entitlements.portfolio.contributingGrantIds).toContain('grant-local-harbor');

    const consoleRecord = await input.targetRepository.founderConsole({
      access: founderAccess,
      now: input.observedAt,
    });
    expect(consoleRecord.capacity).toMatchObject({
      activeHouseholds: 0,
      attentionHouseholds: 1,
      committedHouseholds: 1,
      remaining: 1,
    });
  }

  it('keeps the code-owned programme dormant outside local simulation', async () => {
    const consoleRecord = await repository.founderConsole({ access: founderAccess, now });
    const definitions = await database.query<
      {
        definition_digest: string;
        definition_version: number;
      } & Record<string, unknown>
    >(
      `SELECT definition_version, definition_digest
       FROM founding_household_program_definitions WHERE cohort_key = $1`,
      [foundingHouseholdCohortKey],
    );
    const policies = await database.query<
      {
        environment: string;
        state: string;
      } & Record<string, unknown>
    >(
      `SELECT environment, state FROM founding_household_policy_versions
       WHERE cohort_key = $1 ORDER BY environment`,
      [foundingHouseholdCohortKey],
    );
    const nonlocalBackings = await database.query(
      `SELECT 1 FROM founding_household_sponsor_backings WHERE environment <> 'local'`,
    );
    const providerOffers = await database.query(
      `SELECT 1 FROM commerce_stripe_offer_contracts
       WHERE plan_version_id IN ('founding_plus_beta_v2','founding_family_beta_v2')`,
    );

    expect(consoleRecord).toMatchObject({
      policy: { environment: 'local', revision: 1, state: 'disabled' },
      capacity: { maxHouseholds: 0, activeHouseholds: 0, reservedInvitations: 0, remaining: 0 },
      invitations: [],
      enrollments: [],
    });
    expect(definitions.rows).toEqual([
      { definition_version: 1, definition_digest: foundingHouseholdLegacyDefinitionDigest },
    ]);
    expect(policies.rows).toEqual([
      { environment: 'local', state: 'disabled' },
      { environment: 'production', state: 'disabled' },
      { environment: 'staging', state: 'disabled' },
    ]);
    expect(nonlocalBackings.rows).toHaveLength(0);
    expect(providerOffers.rows).toHaveLength(0);
    await expect(
      new FoundingHouseholdRepository(
        database,
        Buffer.alloc(32, 31),
        1,
        founderPersonId,
        'production',
      ).founderConsole({ access: founderAccess, now }),
    ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);
    await expect(
      database.query(
        `INSERT INTO founding_household_sponsor_backings(
           cohort_key, environment, benefit_key, organization_id, sponsorship_id,
           plan_version_id, evidence_tier, approved_by_person_id, approved_at
         ) VALUES (
           $1,'production','family_beta_v1','organization-founding-households-local',
           'founding-sponsorship-family-local-v1','founding_family_beta_v2',
           'live_production',$2,$3
         )`,
        [foundingHouseholdCohortKey, founderPersonId, now.toISOString()],
      ),
    ).rejects.toThrow('exact active verified founder bootstrap');
  });

  it('atomically bootstraps and exact-replays one audited production sponsor and policy', async () => {
    await provisionProductionFounder();
    const productionRepository = productionFoundingRepository();
    const input = {
      access: founderAccess,
      operationKey: operation('policy', 191),
      benefitKey: 'family_beta_v1' as const,
      maxHouseholds: 3,
      invitationTtlDays: 7,
      accessDurationDays: 30,
      programEndsAt: new Date('2026-10-01T00:00:00.000Z'),
      sponsorshipPrivacyPolicyVersion: 'founding-household-production-v1',
      sponsorshipStartsAt: new Date('2026-08-16T00:00:00.000Z'),
      sponsorshipEndsAt: new Date('2026-10-15T00:00:00.000Z'),
      now,
    };

    const created = await productionRepository.bootstrapProductionProgram(input);
    const replayed = await productionRepository.bootstrapProductionProgram(input);
    expect(created).toMatchObject({
      reused: false,
      sponsorOrganizationId: foundingHouseholdProductionSponsorOrganizationId,
      sponsorshipId: foundingHouseholdProductionSponsorshipId,
      planVersionId: 'founding_family_beta_v2',
      backingEvidenceTier: 'live_production',
      policy: { environment: 'production', revision: 2, state: 'active', maxHouseholds: 3 },
    });
    expect(replayed).toEqual({ ...created, reused: true });

    const evidence = await database.query<
      {
        organizations: number;
        sponsorships: number;
        backings: number;
        policies: number;
        audits: number;
        outbox_events: number;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::integer FROM organizations WHERE id = $1
            AND kind = 'sponsor' AND verification_state = 'verified') AS organizations,
         (SELECT count(*)::integer FROM commerce_sponsorships WHERE id = $2
            AND state = 'active' AND ends_at IS NOT NULL) AS sponsorships,
         (SELECT count(*)::integer FROM founding_household_sponsor_backings
            WHERE cohort_key = $3 AND environment = 'production'
              AND evidence_tier = 'live_production'
              AND approved_by_person_id = $4) AS backings,
         (SELECT count(*)::integer FROM founding_household_policy_versions
            WHERE cohort_key = $3 AND environment = 'production'
              AND revision = 2 AND state = 'active' AND max_households = 3) AS policies,
         (SELECT count(*)::integer FROM audit_events
            WHERE founding_household_operation_key = $5
              AND action = 'founding_household.policy_configured') AS audits,
         (SELECT count(*)::integer FROM outbox_events
            WHERE founding_household_operation_key = $5
              AND event_type = 'founding_household.policy_configured.v1') AS outbox_events`,
      [
        foundingHouseholdProductionSponsorOrganizationId,
        foundingHouseholdProductionSponsorshipId,
        foundingHouseholdCohortKey,
        founderPersonId,
        input.operationKey,
      ],
    );
    expect(evidence.rows).toEqual([
      { organizations: 1, sponsorships: 1, backings: 1, policies: 1, audits: 1, outbox_events: 1 },
    ]);

    await expect(
      productionRepository.bootstrapProductionProgram({ ...input, maxHouseholds: 4 }),
    ).rejects.toMatchObject({ code: 'conflict' } satisfies Partial<DomainError>);
    await expect(
      productionRepository.bootstrapProductionProgram({
        ...input,
        operationKey: operation('policy', 192),
        benefitKey: 'plus_beta_v1',
      }),
    ).rejects.toMatchObject({ code: 'conflict' } satisfies Partial<DomainError>);
  });

  it('rolls sponsor creation back when the production policy cannot start at revision one', async () => {
    await provisionProductionFounder();
    const productionRepository = productionFoundingRepository();
    await productionRepository.configurePolicy({
      access: founderAccess,
      operationKey: operation('policy', 193),
      expectedRevision: 1,
      state: 'disabled',
      now,
    });

    await expect(
      productionRepository.bootstrapProductionProgram({
        access: founderAccess,
        operationKey: operation('policy', 194),
        benefitKey: 'family_beta_v1',
        maxHouseholds: 3,
        invitationTtlDays: 7,
        accessDurationDays: 30,
        programEndsAt: new Date('2026-10-01T00:00:00.000Z'),
        sponsorshipPrivacyPolicyVersion: 'founding-household-production-v1',
        sponsorshipStartsAt: new Date('2026-08-16T00:00:00.000Z'),
        sponsorshipEndsAt: new Date('2026-10-15T00:00:00.000Z'),
        now,
      }),
    ).rejects.toMatchObject({ code: 'conflict' } satisfies Partial<DomainError>);

    const partial = await database.query<
      { organizations: number; sponsorships: number; backings: number } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::integer FROM organizations WHERE id = $1) AS organizations,
         (SELECT count(*)::integer FROM commerce_sponsorships WHERE id = $2) AS sponsorships,
         (SELECT count(*)::integer FROM founding_household_sponsor_backings
            WHERE cohort_key = $3 AND environment = 'production') AS backings`,
      [
        foundingHouseholdProductionSponsorOrganizationId,
        foundingHouseholdProductionSponsorshipId,
        foundingHouseholdCohortKey,
      ],
    );
    expect(partial.rows).toEqual([{ organizations: 0, sponsorships: 0, backings: 0 }]);
  });

  it('refuses the Stage7 repository after a local database is promoted to production config', async () => {
    await activatePolicy();
    const invitation = await createInvitation();
    await acceptBob(invitation);
    const productionRepository = new FoundingHouseholdRepository(
      database,
      Buffer.alloc(32, 31),
      1,
      founderPersonId,
      'production',
      sequentialIds(),
      async (_transaction, observedAt) => new Date(observedAt),
    );

    await expect(
      productionRepository.memberStatus({
        access: bobAccess,
        householdId: 'household-harbor',
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);
    await expect(
      productionRepository.offboard({
        access: bobAccess,
        authority: 'household',
        householdId: 'household-harbor',
        operationKey: operation('offboard', 68),
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);
  });

  it('binds a production invitation and enrollment to one exact customer bootstrap', async () => {
    await provisionProductionFounderAndSponsor();
    const target = await productionCustomer('customer_intended', 'intended');
    const thief = await productionCustomer('customer_thief', 'thief');
    const productionRepository = productionFoundingRepository();
    await productionRepository.configurePolicy({
      access: founderAccess,
      operationKey: operation('policy', 101),
      expectedRevision: 1,
      state: 'active',
      benefitKey: 'family_beta_v1',
      maxHouseholds: 3,
      invitationTtlDays: 7,
      accessDurationDays: 30,
      programEndsAt: new Date('2026-10-01T00:00:00.000Z'),
      now,
    });
    const issued = await productionRepository.createInvitation({
      access: founderAccess,
      intendedIdentity: target.bootstrap,
      operationKey: operation('invite', 102),
      now,
    });
    if (issued.invitationCredential === undefined) {
      throw new Error('Expected one-time production invitation credential');
    }
    expect(issued).toMatchObject({
      delivery: 'founder_manual_only',
      credentialRecoverable: false,
      externalActionExecuted: false,
      invitation: {
        environment: 'production',
        identityBindingState: 'verified_identity',
        intendedCustomerSubject: target.bootstrap.subject,
        householdId: target.bootstrap.householdId,
      },
    });

    const ambiguous = await productionCustomer('customer_ambiguous_admin', 'ambiguous');
    await database.query(
      `INSERT INTO household_memberships(
         household_id, id, person_id, membership_kind, status, created_at
       ) VALUES ('household-harbor','membership-founding-production-ambiguous',$1,
                 'member','active',$2)`,
      [ambiguous.bootstrap.personId, now.toISOString()],
    );
    await database.query(
      `INSERT INTO household_administrator_assignments(
         household_id, person_id, status, granted_by_person_id, granted_at
       ) VALUES ('household-harbor',$1,'active',$1,$2)`,
      [ambiguous.bootstrap.personId, now.toISOString()],
    );
    await expect(
      productionRepository.createInvitation({
        access: founderAccess,
        intendedIdentity: ambiguous.bootstrap,
        operationKey: operation('invite', 104),
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);

    await expect(
      productionRepository.previewInvitation({
        access: thief.access,
        householdId: thief.bootstrap.householdId,
        invitationId: issued.invitation.id,
        invitationCredential: issued.invitationCredential,
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_found' } satisfies Partial<DomainError>);
    await database.query(
      `INSERT INTO identities(id, person_id, issuer, subject, status, created_at)
       VALUES ('identity-founding-production-alternate',$1,$2,
               'customer_alternate','active',$3)`,
      [target.bootstrap.personId, target.bootstrap.issuer, now.toISOString()],
    );
    const alternateSession = await new SessionRepository(
      database,
      { next: () => 'session-founding-production-alternate' },
      'production',
    ).resolveProviderSession({
      identityId: 'identity-founding-production-alternate',
      personId: target.bootstrap.personId,
      issuer: target.bootstrap.issuer,
      subject: 'customer_alternate',
      providerSessionId: 'provider-session-founding-production-alternate',
      audience: 'customer',
      issuedAt: new Date(now.getTime() - 1_000),
      expiresAt: new Date(now.getTime() + 86_400_000),
      now,
    });
    if (alternateSession === null) throw new Error('Expected alternate exact session');
    await expect(
      productionRepository.previewInvitation({
        access: {
          ...target.access,
          sessionId: alternateSession.principal.sessionId,
        },
        householdId: target.bootstrap.householdId,
        invitationId: issued.invitation.id,
        invitationCredential: issued.invitationCredential,
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);
    await expect(
      productionRepository.previewInvitation({
        access: target.access,
        householdId: target.bootstrap.householdId,
        invitationId: issued.invitation.id,
        invitationCredential: `${issued.invitation.id}.${'x'.repeat(43)}`,
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_found' } satisfies Partial<DomainError>);
    const untouched = await database.query<
      {
        state: string;
        credential_fingerprint: string | null;
        enrollment_count: number;
        accept_operation_count: number;
      } & Record<string, unknown>
    >(
      `SELECT invitation.state, invitation.credential_fingerprint,
              (SELECT count(*)::integer FROM founding_household_enrollments) AS enrollment_count,
              (SELECT count(*)::integer FROM founding_household_operations operation
               WHERE operation.environment = 'production'
                 AND operation.operation_kind = 'accept') AS accept_operation_count
       FROM founding_household_invitations invitation WHERE invitation.id = $1`,
      [issued.invitation.id],
    );
    expect(untouched.rows[0]).toMatchObject({
      state: 'pending',
      enrollment_count: 0,
      accept_operation_count: 0,
    });
    expect(untouched.rows[0]?.credential_fingerprint).not.toBeNull();

    const preview = await productionRepository.previewInvitation({
      access: target.access,
      householdId: target.bootstrap.householdId,
      invitationId: issued.invitation.id,
      invitationCredential: issued.invitationCredential,
      now,
    });
    expect(preview.householdId).toBe(target.bootstrap.householdId);
    const accepted = await productionRepository.acceptInvitation({
      access: target.access,
      householdId: target.bootstrap.householdId,
      invitationId: issued.invitation.id,
      invitationCredential: issued.invitationCredential,
      operationKey: operation('accept', 103),
      serviceConsentVersion: foundingHouseholdProductionServiceConsentVersion,
      serviceDisclosureDigest: foundingHouseholdProductionServiceDocuments.disclosureDigest,
      servicePolicyDigest: foundingHouseholdProductionServiceDocuments.policyDigest,
      protectedEnrollmentConsentVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
      protectedEnrollmentDisclosureDigest: foundingHouseholdProtectedDocuments.disclosureDigest,
      protectedEnrollmentPolicyDigest: foundingHouseholdProtectedDocuments.policyDigest,
      now,
    });
    expect(accepted.enrollment).toMatchObject({
      environment: 'production',
      householdId: target.bootstrap.householdId,
      evidenceTier: 'live_production',
      state: 'active',
      paymentState: 'not_paid_sponsored_beta',
    });
    const lineage = await database.query<Record<string, unknown>>(
      `SELECT enrollment.accepted_identity_id, enrollment.accepted_identity_issuer,
              enrollment.accepted_identity_subject, consent.consent_version,
              enrollment.evidence_tier,
              subscription.payer_person_id
       FROM founding_household_enrollments enrollment
       JOIN consents consent
         ON consent.household_id = enrollment.household_id
        AND consent.id = enrollment.service_consent_id
       JOIN commerce_subscriptions subscription
         ON subscription.household_id = enrollment.household_id
        AND subscription.id = enrollment.subscription_id
       WHERE enrollment.id = $1`,
      [accepted.enrollment.id],
    );
    expect(lineage.rows).toEqual([
      {
        accepted_identity_id: target.bootstrap.identityId,
        accepted_identity_issuer: target.bootstrap.issuer,
        accepted_identity_subject: target.bootstrap.subject,
        consent_version: foundingHouseholdProductionServiceConsentVersion,
        evidence_tier: 'live_production',
        payer_person_id: null,
      },
    ]);
    const offboarded = await productionRepository.offboard({
      access: target.access,
      authority: 'household',
      householdId: target.bootstrap.householdId,
      operationKey: operation('offboard', 105),
      now: new Date(now.getTime() + 1_000),
    });
    expect(offboarded).toMatchObject({
      reason: 'household_withdrew',
      unrelatedGrantsChanged: false,
      enrollment: {
        environment: 'production',
        state: 'revoked',
        serviceConsentState: 'withdrawn',
        evidenceTier: 'live_production',
      },
    });
  });

  it('serializes production cohort capacity across exact customer invitations', async () => {
    await provisionProductionFounderAndSponsor();
    const first = await productionCustomer('customer_capacity_one', 'capacity-one');
    const second = await productionCustomer('customer_capacity_two', 'capacity-two');
    const productionRepository = productionFoundingRepository();
    await productionRepository.configurePolicy({
      access: founderAccess,
      operationKey: operation('policy', 111),
      expectedRevision: 1,
      state: 'active',
      benefitKey: 'family_beta_v1',
      maxHouseholds: 1,
      invitationTtlDays: 7,
      accessDurationDays: 30,
      programEndsAt: new Date('2026-10-01T00:00:00.000Z'),
      now,
    });

    const attempts = await Promise.allSettled([
      productionRepository.createInvitation({
        access: founderAccess,
        intendedIdentity: first.bootstrap,
        operationKey: operation('invite', 112),
        now,
      }),
      productionRepository.createInvitation({
        access: founderAccess,
        intendedIdentity: second.bootstrap,
        operationKey: operation('invite', 113),
        now,
      }),
    ]);
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(({ status }) => status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: { code: 'conflict' },
    });
    const stored = await database.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM founding_household_invitations
       WHERE environment = 'production' AND state = 'pending'`,
    );
    expect(stored.rows).toEqual([{ count: 1 }]);
  });

  it('terminally zeroizes revoked and expired production credentials', async () => {
    await provisionProductionFounderAndSponsor();
    const revokedCustomer = await productionCustomer('customer_revoked', 'revoked');
    const expiredCustomer = await productionCustomer('customer_expired', 'expired');
    const productionRepository = productionFoundingRepository();
    await productionRepository.configurePolicy({
      access: founderAccess,
      operationKey: operation('policy', 121),
      expectedRevision: 1,
      state: 'active',
      benefitKey: 'family_beta_v1',
      maxHouseholds: 2,
      invitationTtlDays: 1,
      accessDurationDays: 30,
      programEndsAt: new Date('2026-10-01T00:00:00.000Z'),
      now,
    });
    const revoked = await productionRepository.createInvitation({
      access: founderAccess,
      intendedIdentity: revokedCustomer.bootstrap,
      operationKey: operation('invite', 122),
      now,
    });
    if (revoked.invitationCredential === undefined) throw new Error('Expected credential');
    await productionRepository.revokeInvitation({
      access: founderAccess,
      invitationId: revoked.invitation.id,
      operationKey: operation('invite-revoke', 123),
      now: new Date(now.getTime() + 1_000),
    });
    await expect(
      productionRepository.previewInvitation({
        access: revokedCustomer.access,
        householdId: revokedCustomer.bootstrap.householdId,
        invitationId: revoked.invitation.id,
        invitationCredential: revoked.invitationCredential,
        now: new Date(now.getTime() + 2_000),
      }),
    ).rejects.toMatchObject({ code: 'not_found' } satisfies Partial<DomainError>);

    const expired = await productionRepository.createInvitation({
      access: founderAccess,
      intendedIdentity: expiredCustomer.bootstrap,
      operationKey: operation('invite', 124),
      now: new Date(now.getTime() + 2_000),
    });
    if (expired.invitationCredential === undefined) throw new Error('Expected credential');
    await expect(
      productionRepository.previewInvitation({
        access: expiredCustomer.access,
        householdId: expiredCustomer.bootstrap.householdId,
        invitationId: expired.invitation.id,
        invitationCredential: expired.invitationCredential,
        now: new Date(expired.invitation.expiresAt.getTime() + 1),
      }),
    ).rejects.toMatchObject({ code: 'expired' } satisfies Partial<DomainError>);

    const terminal = await database.query<Record<string, unknown>>(
      `SELECT id, state, credential_fingerprint
       FROM founding_household_invitations
       WHERE id IN ($1,$2) ORDER BY id`,
      [revoked.invitation.id, expired.invitation.id],
    );
    expect(terminal.rows).toEqual(
      [
        { id: revoked.invitation.id, state: 'revoked', credential_fingerprint: null },
        { id: expired.invitation.id, state: 'expired', credential_fingerprint: null },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
    const sideEffects = await database.query<Record<string, unknown>>(
      `SELECT
         (SELECT count(*)::integer FROM founding_household_enrollments
          WHERE environment = 'production') AS enrollments,
         (SELECT count(*)::integer FROM founding_household_operations
          WHERE environment = 'production' AND operation_kind = 'accept') AS accepts`,
    );
    expect(sideEffects.rows).toEqual([{ enrollments: 0, accepts: 0 }]);
  });

  it('excludes restored local Founding access from production entitlement projections only', async () => {
    await activatePolicy();
    const invitation = await createInvitation();
    const accepted = await acceptBob(invitation);
    const foundingGrant = await database.query<
      { entitlement_grant_id: string } & Record<string, unknown>
    >(`SELECT entitlement_grant_id FROM founding_household_enrollments WHERE id = $1`, [
      accepted.enrollment.id,
    ]);
    const foundingGrantId = foundingGrant.rows[0]?.entitlement_grant_id;
    if (foundingGrantId === undefined) throw new Error('Founding grant fixture is missing');
    await database.query(
      `UPDATE entitlement_grants SET revoked_at = $2
       WHERE household_id = 'household-harbor' AND id <> $1 AND revoked_at IS NULL`,
      [foundingGrantId, now.toISOString()],
    );

    const localEntitlements = await new EntitlementRepository(
      database,
      undefined,
      'local',
    ).forHousehold('household-harbor', now);
    const productionEntitlements = await new EntitlementRepository(
      database,
      undefined,
      'production',
    ).forHousehold('household-harbor', now);
    expect(localEntitlements.portfolio.contributingGrantIds).toContain(foundingGrantId);
    expect(localEntitlements.capabilities).toContain('family:manage');
    expect(productionEntitlements.capabilities).not.toContain('family:manage');

    const localSession = await new SessionRepository(database, sequentialIds(), 'local').resolve(
      bobAccess.sessionId,
      'customer',
      now,
    );
    const productionSession = await new SessionRepository(
      database,
      sequentialIds(),
      'production',
    ).resolve(bobAccess.sessionId, 'customer', now);
    expect(
      localSession?.householdCapabilities
        .find(({ householdId }) => householdId === 'household-harbor')
        ?.capabilities.includes('family:manage'),
    ).toBe(true);
    expect(
      productionSession?.householdCapabilities
        .find(({ householdId }) => householdId === 'household-harbor')
        ?.capabilities.includes('family:manage'),
    ).toBe(false);

    const localFamily = await new FamilyRepository(
      database,
      Buffer.alloc(32, 31),
      1,
      sequentialIds(),
      'local',
    ).list('household-harbor', bobAccess.actorPersonId, now);
    const productionFamily = await new FamilyRepository(
      database,
      Buffer.alloc(32, 31),
      1,
      sequentialIds(),
      'production',
    ).list('household-harbor', bobAccess.actorPersonId, now);
    expect(
      localFamily?.members.find(({ personId }) => personId === bobAccess.actorPersonId)
        ?.isProtectedMember,
    ).toBe(true);
    expect(
      productionFamily?.members.find(({ personId }) => personId === bobAccess.actorPersonId)
        ?.isProtectedMember,
    ).toBe(false);

    const projectionAccess = {
      actorPersonId: ids.person(founderPersonId),
      correlationId: ids.correlation('correlation-founding-environment'),
      now,
    };
    const localHouseholds = await new HqRepository(
      database,
      { next: (prefix) => `${prefix}-founding-environment-local` },
      'local',
    ).ownerHouseholds(projectionAccess);
    const productionHouseholds = await new HqRepository(
      database,
      { next: (prefix) => `${prefix}-founding-environment-production` },
      'production',
    ).ownerHouseholds(projectionAccess);
    expect(localHouseholds.find(({ id }) => id === 'household-harbor')?.entitlementState).toBe(
      'active',
    );
    expect(productionHouseholds.find(({ id }) => id === 'household-harbor')?.entitlementState).toBe(
      'inactive',
    );
  });

  it('captures one database authority clock after locks and ignores divergent caller clocks', async () => {
    const authority = new Date('2026-08-17T19:00:00.000Z');
    const callerFuture = new Date('2099-01-01T00:00:00.000Z');
    const fixedClockRepository = new FoundingHouseholdRepository(
      database,
      Buffer.alloc(32, 31),
      1,
      founderPersonId,
      'local',
      sequentialIds(),
      async () => new Date(authority),
    );
    const configured = await fixedClockRepository.configurePolicy({
      access: founderAccess,
      operationKey: operation('policy', 81),
      expectedRevision: 1,
      state: 'active',
      benefitKey: 'family_beta_v1',
      maxHouseholds: 2,
      invitationTtlDays: 7,
      accessDurationDays: 30,
      programEndsAt: new Date(authority.getTime() + 30 * 86_400_000),
      now: callerFuture,
    });
    const invitation = await fixedClockRepository.createInvitation({
      access: founderAccess,
      operationKey: operation('invite', 82),
      now: new Date('2026-08-17T12:00:00.000-07:00'),
    });
    const timestamps = await database.query<
      {
        operation_at: unknown;
        policy_at: unknown;
        invitation_at: unknown;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT created_at FROM founding_household_operations
          WHERE operation_key = $1) AS operation_at,
         (SELECT created_at FROM founding_household_policy_versions
          WHERE environment = 'local' AND revision = 2) AS policy_at,
         (SELECT created_at FROM founding_household_invitations
          WHERE id = $2) AS invitation_at`,
      [operation('policy', 81), invitation.invitation.id],
    );

    expect(configured.policy.changedAt).toEqual(authority);
    expect(invitation.invitation.createdAt).toEqual(authority);
    expect(timestamps.rows).toEqual([
      { operation_at: authority, policy_at: authority, invitation_at: authority },
    ]);
  });

  it('requires the exact configured active internal owner at every founder mutation', async () => {
    const unconfigured = new FoundingHouseholdRepository(
      database,
      Buffer.alloc(32, 31),
      1,
      undefined,
      'local',
      sequentialIds(),
    );
    await expect(unconfigured.founderConsole({ access: founderAccess, now })).rejects.toMatchObject(
      { code: 'not_authorized' } satisfies Partial<DomainError>,
    );

    await database.query(
      `UPDATE employee_assignments SET status = 'suspended'
       WHERE id = 'employee-hq-heidi'`,
    );
    await expect(activatePolicy()).rejects.toMatchObject({
      code: 'not_authorized',
    } satisfies Partial<DomainError>);

    await database.query(
      `UPDATE employee_assignments
       SET status = 'active', organization_id = 'organization-synthetic-sponsor'
       WHERE id = 'employee-hq-heidi'`,
    );
    await expect(activatePolicy()).rejects.toMatchObject({
      code: 'not_authorized',
    } satisfies Partial<DomainError>);

    await database.query(
      `UPDATE employee_assignments SET organization_id = NULL
       WHERE id = 'employee-hq-heidi'`,
    );
    await expect(activatePolicy()).rejects.toMatchObject({
      code: 'not_authorized',
    } satisfies Partial<DomainError>);

    await database.query(
      `UPDATE employee_assignments SET organization_id = 'organization-boomerbuddy'
       WHERE id = 'employee-hq-heidi'`,
    );
    await database.query(
      `UPDATE organizations SET kind = 'sponsor' WHERE id = 'organization-boomerbuddy'`,
    );
    await expect(activatePolicy()).rejects.toMatchObject({
      code: 'not_authorized',
    } satisfies Partial<DomainError>);
  });

  it('serializes founder assignment suspension, repoint, and organization-kind races', async () => {
    const sharedIds = sequentialIds();
    async function runSerializedRace(
      mutation: string,
      action: (racing: FoundingHouseholdRepository) => Promise<unknown>,
    ): Promise<void> {
      let concurrentMutation: Promise<unknown> | undefined;
      const racing = new FoundingHouseholdRepository(
        database,
        Buffer.alloc(32, 31),
        1,
        founderPersonId,
        'local',
        sharedIds,
        async (_transaction, observedAt) => {
          concurrentMutation ??= database.query(mutation);
          return new Date(observedAt);
        },
      );
      await action(racing);
      await concurrentMutation;
    }

    await runSerializedRace(
      `UPDATE employee_assignments SET status = 'suspended'
       WHERE id = 'employee-hq-heidi'`,
      (racing) =>
        racing.configurePolicy({
          access: founderAccess,
          operationKey: operation('policy', 71),
          expectedRevision: 1,
          state: 'active',
          benefitKey: 'family_beta_v1',
          maxHouseholds: 2,
          invitationTtlDays: 7,
          accessDurationDays: 30,
          programEndsAt: new Date('2026-10-01T00:00:00.000Z'),
          now,
        }),
    );
    await expect(
      repository.createInvitation({
        access: founderAccess,
        operationKey: operation('invite', 72),
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);

    await database.query(
      `UPDATE employee_assignments
       SET status = 'active', organization_id = 'organization-boomerbuddy'
       WHERE id = 'employee-hq-heidi'`,
    );
    await runSerializedRace(
      `UPDATE employee_assignments
       SET organization_id = 'organization-synthetic-sponsor'
       WHERE id = 'employee-hq-heidi'`,
      (racing) => racing.founderConsole({ access: founderAccess, now }),
    );
    await expect(
      repository.configurePolicy({
        access: founderAccess,
        operationKey: operation('policy', 73),
        expectedRevision: 2,
        state: 'disabled',
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);

    await database.query(
      `UPDATE employee_assignments SET organization_id = 'organization-boomerbuddy'
       WHERE id = 'employee-hq-heidi'`,
    );
    await runSerializedRace(
      `UPDATE organizations SET kind = 'sponsor' WHERE id = 'organization-boomerbuddy'`,
      (racing) => racing.founderConsole({ access: founderAccess, now }),
    );
    await expect(
      repository.configurePolicy({
        access: founderAccess,
        operationKey: operation('policy', 74),
        expectedRevision: 2,
        state: 'disabled',
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);
  });

  it('bounds and versions policy, preserves exact idempotency, and zeroizes superseded invites', async () => {
    await expect(
      repository.configurePolicy({
        access: founderAccess,
        operationKey: operation('policy', 1),
        expectedRevision: 1,
        state: 'active',
        benefitKey: 'family_beta_v1',
        maxHouseholds: 26,
        invitationTtlDays: 7,
        accessDurationDays: 30,
        programEndsAt: new Date('2026-10-01T00:00:00.000Z'),
        now,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' } satisfies Partial<DomainError>);
    const first = await activatePolicy();
    const retry = await activatePolicy();
    expect(first).toMatchObject({ policy: { revision: 2, state: 'active' }, reused: false });
    expect(retry).toMatchObject({ policy: { revision: 2, state: 'active' }, reused: true });

    const invite = await createInvitation();
    const disabled = await repository.configurePolicy({
      access: founderAccess,
      operationKey: operation('policy', 4),
      expectedRevision: 2,
      state: 'disabled',
      now: new Date(now.getTime() + 1_000),
    });
    const disabledRetry = await repository.configurePolicy({
      access: founderAccess,
      operationKey: operation('policy', 4),
      expectedRevision: 2,
      state: 'disabled',
      now: new Date(now.getTime() + 2_000),
    });
    const stored = await database.query<
      {
        credential_fingerprint: string | null;
        state: string;
      } & Record<string, unknown>
    >(`SELECT state, credential_fingerprint FROM founding_household_invitations WHERE id = $1`, [
      invite.invitation.id,
    ]);
    expect(disabled).toMatchObject({ invalidatedInvitationCount: 1, policy: { revision: 3 } });
    expect(disabledRetry).toMatchObject({
      invalidatedInvitationCount: 1,
      policy: { revision: 3 },
      reused: true,
    });
    expect(stored.rows).toEqual([{ state: 'superseded', credential_fingerprint: null }]);
    await expect(
      repository.previewInvitation({
        access: bobAccess,
        householdId: 'household-harbor',
        invitationId: invite.invitation.id,
        invitationCredential: invite.credential,
        now: new Date(now.getTime() + 2_000),
      }),
    ).rejects.toMatchObject({ code: 'not_found' } satisfies Partial<DomainError>);
  });

  it('issues one-time HMAC-only credentials without leaking or recovering the secret', async () => {
    expect(
      () =>
        new FoundingHouseholdRepository(
          database,
          Buffer.alloc(32, 31),
          0,
          founderPersonId,
          'local',
        ),
    ).toThrow('HMAC configuration is invalid');
    await activatePolicy();
    const first = await createInvitation();
    const retry = await repository.createInvitation({
      access: founderAccess,
      operationKey: operation('invite', 2),
      now: new Date(now.getTime() + 1_000),
    });
    const stored = await database.query<
      {
        credential_fingerprint: string | null;
        fingerprint_key_version: number;
      } & Record<string, unknown>
    >(
      `SELECT credential_fingerprint, fingerprint_key_version
       FROM founding_household_invitations WHERE id = $1`,
      [first.invitation.id],
    );
    const stageRecords = await database.query<Record<string, unknown>>(
      `SELECT action, metadata::text AS body FROM audit_events
       WHERE action LIKE 'founding_household.%'
       UNION ALL
       SELECT event_type AS action, payload::text AS body FROM outbox_events
       WHERE event_type LIKE 'founding_household.%'`,
    );
    const secret = first.credential.slice(first.credential.indexOf('.') + 1);

    expect(first.credential).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u);
    expect(first.invitationCredential).toBe(first.credential);
    expect(retry).toMatchObject({
      invitation: { id: first.invitation.id },
      reused: true,
      credentialRecoverable: false,
    });
    expect(retry.invitationCredential).toBeUndefined();
    expect(stored.rows[0]).toMatchObject({ fingerprint_key_version: 1 });
    expect(stored.rows[0]?.credential_fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(stored.rows[0]?.credential_fingerprint).not.toBe(secret);
    expect(JSON.stringify(stageRecords.rows)).not.toContain(secret);
  });

  it('fails closed for pending credentials after HMAC key-material rotation', async () => {
    await activatePolicy();
    const invitation = await createInvitation();
    const rotated = new FoundingHouseholdRepository(
      database,
      Buffer.alloc(32, 77),
      2,
      founderPersonId,
      'local',
      sequentialIds(),
      async (_transaction, observedAt) => new Date(observedAt),
    );

    await expect(
      rotated.previewInvitation({
        access: bobAccess,
        householdId: 'household-harbor',
        invitationId: invitation.invitation.id,
        invitationCredential: invitation.credential,
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_found' } satisfies Partial<DomainError>);
    const revoked = await repository.revokeInvitation({
      access: founderAccess,
      invitationId: invitation.invitation.id,
      operationKey: operation('invite-revoke', 83),
      now,
    });
    const history = await database.query<Record<string, unknown>>(
      `SELECT id, state, credential_fingerprint, fingerprint_key_version
       FROM founding_household_invitations WHERE id = $1`,
      [invitation.invitation.id],
    );

    expect(revoked.invitation.state).toBe('revoked');
    expect(history.rows).toEqual([
      {
        id: invitation.invitation.id,
        state: 'revoked',
        credential_fingerprint: null,
        fingerprint_key_version: 1,
      },
    ]);
  });

  it('revalidates current sponsor state and custody before reserving cohort capacity', async () => {
    await activatePolicy();
    await database.query(
      `UPDATE commerce_sponsorships SET state = 'revoked'
       WHERE id = 'founding-sponsorship-family-local-v1'`,
    );
    await expect(createInvitation()).rejects.toMatchObject({
      code: 'not_authorized',
    } satisfies Partial<DomainError>);
    const operations = await database.query(
      `SELECT 1 FROM founding_household_operations WHERE operation_kind = 'invite'`,
    );
    const invitations = await database.query('SELECT 1 FROM founding_household_invitations');
    expect(operations.rows).toHaveLength(0);
    expect(invitations.rows).toHaveLength(0);
  });

  it('caps preview and enrollment expiry at the current sponsor backing end', async () => {
    const sponsorEndsAt = new Date(now.getTime() + 5 * 86_400_000);
    await database.query(
      `UPDATE commerce_sponsorships SET ends_at = $1
       WHERE id = 'founding-sponsorship-family-local-v1'`,
      [sponsorEndsAt.toISOString()],
    );
    await activatePolicy({ accessDurationDays: 30 });
    const invitation = await createInvitation();
    const preview = await repository.previewInvitation({
      access: bobAccess,
      householdId: 'household-harbor',
      invitationId: invitation.invitation.id,
      invitationCredential: invitation.credential,
      now,
    });
    const accepted = await acceptBob(invitation);

    expect(preview.accessEndsAtIfAcceptedNow).toEqual(sponsorEndsAt);
    expect(accepted.enrollment.endsAt).toEqual(sponsorEndsAt);
  });

  it('accepts atomically as sponsored—not paid—and records only purpose-limited consent', async () => {
    await activatePolicy();
    const invitation = await createInvitation();
    const result = await acceptBob(invitation);
    const retry = await acceptBob(invitation);
    const chain = await database.query<Record<string, unknown>>(
      `SELECT enrollment.state AS enrollment_state, enrollment.evidence_tier,
              enrollment.protected_enrollment_created,
              subscription.payer_person_id, subscription.source, subscription.source_verified,
              allocation.state AS allocation_state, grant_record.source AS grant_source,
              grant_record.source_verified AS grant_verified, invitation.state AS invitation_state,
              invitation.credential_fingerprint
       FROM founding_household_enrollments enrollment
       JOIN commerce_subscriptions subscription
         ON subscription.household_id = enrollment.household_id
        AND subscription.id = enrollment.subscription_id
       JOIN commerce_sponsorship_allocations allocation
         ON allocation.household_id = enrollment.household_id
        AND allocation.id = enrollment.sponsorship_allocation_id
       JOIN entitlement_grants grant_record
         ON grant_record.household_id = enrollment.household_id
        AND grant_record.id = enrollment.entitlement_grant_id
       JOIN founding_household_invitations invitation ON invitation.id = enrollment.invitation_id
       WHERE enrollment.household_id = 'household-harbor'`,
    );
    const consent = await database.query<Record<string, unknown>>(
      `SELECT consent.purpose, consent.consent_version, projection.state,
              projection.expires_at, evidence.scope, evidence.disclosure_digest,
              evidence.policy_digest
       FROM consents consent
       JOIN consent_current_projections projection
         ON projection.household_id = consent.household_id
        AND projection.consent_id = consent.id
       JOIN consent_evidence evidence
         ON evidence.household_id = projection.household_id
        AND evidence.id = projection.latest_evidence_id
       WHERE consent.household_id = 'household-harbor'
         AND consent.purpose = 'founding_household_service_beta'`,
    );
    const paid = await database.query(
      `SELECT 1 FROM commerce_subscriptions
       WHERE household_id = 'household-harbor' AND payer_person_id IS NOT NULL
         AND id IN (SELECT subscription_id FROM founding_household_enrollments)`,
    );

    expect(result).toMatchObject({
      protectedEnrollment: 'created',
      reused: false,
      paymentCollected: false,
      externalActionExecuted: false,
      enrollment: {
        householdId: 'household-harbor',
        state: 'active',
        paymentState: 'not_paid_sponsored_beta',
        evidenceTier: 'local_simulation',
        researchConsent: false,
        marketingConsent: false,
        followUpConsent: false,
      },
    });
    expect(retry).toMatchObject({ protectedEnrollment: 'created', reused: true });
    expect(chain.rows[0]).toMatchObject({
      enrollment_state: 'active',
      evidence_tier: 'local_simulation',
      protected_enrollment_created: true,
      payer_person_id: null,
      source: 'sponsor',
      source_verified: true,
      allocation_state: 'active',
      grant_source: 'sponsor',
      grant_verified: true,
      invitation_state: 'accepted',
      credential_fingerprint: null,
    });
    expect(paid.rows).toHaveLength(0);
    expect(consent.rows).toHaveLength(1);
    expect(consent.rows[0]).toMatchObject({
      purpose: 'founding_household_service_beta',
      consent_version: foundingHouseholdServiceConsentVersion,
      state: 'active',
      disclosure_digest: foundingHouseholdServiceDocuments.disclosureDigest,
      policy_digest: foundingHouseholdServiceDocuments.policyDigest,
      scope: {
        cohortKey: foundingHouseholdCohortKey,
        researchConsent: false,
        marketingConsent: false,
        followUpConsent: false,
      },
    });
    expect(foundingHouseholdProtectedDocuments.disclosureDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('binds existing protected and Trusted Circle allocations to the longer Founding grant', async () => {
    const unrelatedEnd = new Date(now.getTime() + 2 * 86_400_000);
    await database.query(
      `UPDATE commerce_subscriptions SET current_period_ends_at = $1
       WHERE household_id = 'household-sunrise' AND id = 'subscription-local-sunrise'`,
      [unrelatedEnd.toISOString()],
    );
    await database.query(
      `UPDATE entitlement_grants SET ends_at = $1
       WHERE household_id = 'household-sunrise' AND id = 'grant-local-sunrise'`,
      [unrelatedEnd.toISOString()],
    );
    const aliceSessionId = await new SessionRepository(database, {
      next: () => 'session-founding-alice',
    }).create({
      personId: 'person-owner-alice',
      audience: 'customer',
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 180 * 86_400_000),
    });
    const aliceAccess: FoundingHouseholdMemberAccess = {
      actorPersonId: 'person-owner-alice',
      actorIssuer: 'boomerbuddy-dev',
      actorIdentityId: 'identity-owner-alice',
      actorIdentitySubject: 'owner-alice',
      sessionId: aliceSessionId,
      audience: 'customer',
      correlationId: 'correlation-founding-alice',
    };
    await refreshExactProtectedSelfConsent(database, {
      personId: aliceAccess.actorPersonId,
      identityId: 'identity-owner-alice',
      identitySubject: 'owner-alice',
      sessionId: aliceSessionId,
      keyNamespace: '40000000',
      correlationLabel: 'alice-allocation-binding',
    });
    await activatePolicy();
    const invitation = await createInvitation();
    const accepted = await repository.acceptInvitation({
      access: aliceAccess,
      householdId: 'household-sunrise',
      invitationId: invitation.invitation.id,
      invitationCredential: invitation.credential,
      operationKey: operation('accept', 3),
      serviceConsentVersion: foundingHouseholdServiceConsentVersion,
      serviceDisclosureDigest: foundingHouseholdServiceDocuments.disclosureDigest,
      servicePolicyDigest: foundingHouseholdServiceDocuments.policyDigest,
      protectedEnrollmentConsentVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
      protectedEnrollmentDisclosureDigest: foundingHouseholdProtectedDocuments.disclosureDigest,
      protectedEnrollmentPolicyDigest: foundingHouseholdProtectedDocuments.policyDigest,
      now,
    });
    const grant = await database.query<{ entitlement_grant_id: string } & Record<string, unknown>>(
      `SELECT entitlement_grant_id FROM founding_household_enrollments WHERE id = $1`,
      [accepted.enrollment.id],
    );
    const allocations = await database.query<Record<string, unknown>>(
      `SELECT allowance_key, subject_id, entitlement_grant_id
       FROM commerce_allowance_allocations
       WHERE household_id = 'household-sunrise'
         AND state = 'active'
         AND (
           (allowance_key = 'protected_members'
             AND subject_id IN ('person-owner-alice','person-protected-pat'))
           OR (allowance_key = 'trusted_circle_participants'
             AND subject_id = 'person-trusted-terry')
         )
       ORDER BY allowance_key, subject_id`,
    );
    expect(allocations.rows).toEqual([
      {
        allowance_key: 'protected_members',
        subject_id: 'person-owner-alice',
        entitlement_grant_id: grant.rows[0]?.entitlement_grant_id,
      },
      {
        allowance_key: 'protected_members',
        subject_id: 'person-protected-pat',
        entitlement_grant_id: grant.rows[0]?.entitlement_grant_id,
      },
      {
        allowance_key: 'trusted_circle_participants',
        subject_id: 'person-trusted-terry',
        entitlement_grant_id: grant.rows[0]?.entitlement_grant_id,
      },
    ]);

    const afterUnrelatedExpiry = new Date(unrelatedEnd.getTime() + 1);
    const family = await new FamilyRepository(
      database,
      Buffer.alloc(32, 31),
      1,
      sequentialIds(),
      'local',
    ).list('household-sunrise', aliceAccess.actorPersonId, afterUnrelatedExpiry);
    expect(
      family?.members.find(({ personId }) => personId === 'person-owner-alice')?.isProtectedMember,
    ).toBe(true);
    expect(
      family?.members.find(({ personId }) => personId === 'person-protected-pat')
        ?.isProtectedMember,
    ).toBe(true);
    expect(family?.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'relationship-sunrise-pat-terry', state: 'active' }),
      ]),
    );
  });

  it('deduplicates multi-relationship trusted members before the bounded rebind limit', async () => {
    const unrelatedEnd = new Date(now.getTime() + 2 * 86_400_000);
    await database.query(
      `UPDATE commerce_subscriptions SET current_period_ends_at = $1
       WHERE household_id = 'household-sunrise' AND id = 'subscription-local-sunrise'`,
      [unrelatedEnd.toISOString()],
    );
    await database.query(
      `UPDATE entitlement_grants SET ends_at = $1
       WHERE household_id = 'household-sunrise' AND id = 'grant-local-sunrise'`,
      [unrelatedEnd.toISOString()],
    );
    await database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO household_memberships(
           household_id, id, person_id, membership_kind, status, created_at
         ) VALUES (
           'household-sunrise','membership-sunrise-olivia','person-protected-olivia',
           'member','active',$1
         )`,
        [now.toISOString()],
      );
      await transaction.query(
        `INSERT INTO consents(
           household_id, id, protected_person_id, granted_by_person_id, purpose,
           consent_version, state, granted_at
         ) VALUES
           ('household-sunrise','consent-sunrise-alice-terry-duplicate','person-owner-alice',
            'person-owner-alice','trusted_circle_relationship','founding-test-v1','active',$1),
           ('household-sunrise','consent-sunrise-alice-olivia','person-owner-alice',
            'person-owner-alice','trusted_circle_relationship','founding-test-v1','active',$1)`,
        [now.toISOString()],
      );
      await transaction.query(
        `INSERT INTO consent_evidence(
           household_id, id, consent_id, actor_person_id, subject_person_id,
           recipient_person_id, purpose, scope, action, disclosure_version,
           disclosure_digest, policy_version, policy_digest, source_interaction,
           assurance, effective_at, recorded_at
         ) VALUES
           ('household-sunrise','evidence-sunrise-alice-terry-duplicate',
            'consent-sunrise-alice-terry-duplicate','person-owner-alice','person-owner-alice',
            'person-trusted-terry','trusted_circle_relationship',$2::jsonb,'accept',
            'founding-test-v1',repeat('1',64),'founding-test-policy-v1',repeat('2',64),
            'founding_household_test','development',$1,$1),
           ('household-sunrise','evidence-sunrise-alice-olivia',
            'consent-sunrise-alice-olivia','person-owner-alice','person-owner-alice',
            'person-protected-olivia','trusted_circle_relationship',$2::jsonb,'accept',
            'founding-test-v1',repeat('1',64),'founding-test-policy-v1',repeat('2',64),
            'founding_household_test','development',$1,$1)`,
        [now.toISOString(), JSON.stringify({ permissions: ['view_shared_checks'] })],
      );
      await transaction.query(
        `INSERT INTO consent_current_projections(
           household_id, consent_id, latest_evidence_id, actor_person_id,
           subject_person_id, recipient_person_id, purpose, scope, state,
           effective_at, updated_at
         ) VALUES
           ('household-sunrise','consent-sunrise-alice-terry-duplicate',
            'evidence-sunrise-alice-terry-duplicate','person-owner-alice','person-owner-alice',
            'person-trusted-terry','trusted_circle_relationship',$2::jsonb,'active',$1,$1),
           ('household-sunrise','consent-sunrise-alice-olivia',
            'evidence-sunrise-alice-olivia','person-owner-alice','person-owner-alice',
            'person-protected-olivia','trusted_circle_relationship',$2::jsonb,'active',$1,$1)`,
        [now.toISOString(), JSON.stringify({ permissions: ['view_shared_checks'] })],
      );
      await transaction.query(
        `INSERT INTO trusted_circle_relationships(
           household_id, id, protected_person_id, trusted_person_id, permissions,
           consent_id, consent_version, state, created_at, latest_consent_evidence_id
         ) VALUES
           ('household-sunrise','relationship-sunrise-alice-terry-duplicate',
            'person-owner-alice','person-trusted-terry',$2::jsonb,
            'consent-sunrise-alice-terry-duplicate','founding-test-v1','active',$1,
            'evidence-sunrise-alice-terry-duplicate'),
           ('household-sunrise','relationship-sunrise-alice-olivia',
            'person-owner-alice','person-protected-olivia',$2::jsonb,
            'consent-sunrise-alice-olivia','founding-test-v1','active',$1,
            'evidence-sunrise-alice-olivia')`,
        [now.toISOString(), JSON.stringify(['view_shared_checks'])],
      );
      await transaction.query(
        `INSERT INTO commerce_allowance_allocations(
           household_id, id, entitlement_grant_id, allowance_key, subject_kind,
           subject_id, state, allocated_at
         ) VALUES (
           'household-sunrise','allocation-sunrise-zz-olivia','grant-local-sunrise',
           'trusted_circle_participants','trusted_circle_person','person-protected-olivia',
           'active',$1
         )`,
        [new Date(now.getTime() + 1).toISOString()],
      );
    });
    const aliceSessionId = await new SessionRepository(database, {
      next: () => 'session-founding-alice-deduplicated',
    }).create({
      personId: 'person-owner-alice',
      audience: 'customer',
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 180 * 86_400_000),
    });
    const aliceAccess: FoundingHouseholdMemberAccess = {
      actorPersonId: 'person-owner-alice',
      actorIssuer: 'boomerbuddy-dev',
      actorIdentityId: 'identity-owner-alice',
      actorIdentitySubject: 'owner-alice',
      sessionId: aliceSessionId,
      audience: 'customer',
      correlationId: 'correlation-founding-alice-deduplicated',
    };
    await refreshExactProtectedSelfConsent(database, {
      personId: aliceAccess.actorPersonId,
      identityId: 'identity-owner-alice',
      identitySubject: 'owner-alice',
      sessionId: aliceSessionId,
      keyNamespace: '41000000',
      correlationLabel: 'alice-deduplicated-binding',
    });
    await activatePolicy({ benefitKey: 'plus_beta_v1' });
    const invitation = await createInvitation();
    const accepted = await repository.acceptInvitation({
      access: aliceAccess,
      householdId: 'household-sunrise',
      invitationId: invitation.invitation.id,
      invitationCredential: invitation.credential,
      operationKey: operation('accept', 3),
      serviceConsentVersion: foundingHouseholdServiceConsentVersion,
      serviceDisclosureDigest: foundingHouseholdServiceDocuments.disclosureDigest,
      servicePolicyDigest: foundingHouseholdServiceDocuments.policyDigest,
      protectedEnrollmentConsentVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
      protectedEnrollmentDisclosureDigest: foundingHouseholdProtectedDocuments.disclosureDigest,
      protectedEnrollmentPolicyDigest: foundingHouseholdProtectedDocuments.policyDigest,
      now,
    });
    const allocations = await database.query<Record<string, unknown>>(
      `SELECT id, entitlement_grant_id FROM commerce_allowance_allocations
       WHERE household_id = 'household-sunrise'
         AND id IN ('allocation-sunrise-terry','allocation-sunrise-zz-olivia')
       ORDER BY id`,
    );
    const foundingGrant = await database.query<
      { entitlement_grant_id: string } & Record<string, unknown>
    >(`SELECT entitlement_grant_id FROM founding_household_enrollments WHERE id = $1`, [
      accepted.enrollment.id,
    ]);
    expect(allocations.rows).toEqual([
      {
        id: 'allocation-sunrise-terry',
        entitlement_grant_id: foundingGrant.rows[0]?.entitlement_grant_id,
      },
      {
        id: 'allocation-sunrise-zz-olivia',
        entitlement_grant_id: foundingGrant.rows[0]?.entitlement_grant_id,
      },
    ]);

    const family = await new FamilyRepository(
      database,
      Buffer.alloc(32, 31),
      1,
      sequentialIds(),
      'local',
    ).list('household-sunrise', aliceAccess.actorPersonId, new Date(unrelatedEnd.getTime() + 1));
    expect(family?.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'relationship-sunrise-pat-terry', state: 'active' }),
        expect.objectContaining({ id: 'relationship-sunrise-alice-olivia', state: 'active' }),
      ]),
    );
  });

  it('projects ledger enrollment separately from current effective sponsor access', async () => {
    await activatePolicy();
    const invitation = await createInvitation();
    const accepted = await acceptBob(invitation);
    const status = () =>
      repository.memberStatus({
        access: bobAccess,
        householdId: 'household-harbor',
        now: new Date(now.getTime() + 1_000),
      });

    expect(await status()).toMatchObject({ state: 'active', ledgerState: 'active' });

    await database.query(
      `UPDATE organizations SET verification_state = 'unverified'
       WHERE id = 'organization-founding-households-local'`,
    );
    expect(await status()).toMatchObject({
      state: 'attention',
      ledgerState: 'active',
      accessAttentionCode: 'sponsor_backing_invalid',
      paymentState: 'not_paid_sponsored_beta',
    });
    await database.query(
      `UPDATE organizations SET verification_state = 'local_fixture'
       WHERE id = 'organization-founding-households-local'`,
    );

    await database.query(
      `UPDATE commerce_subscriptions SET source_verified = false
       WHERE household_id = 'household-harbor'
         AND id = (SELECT subscription_id FROM founding_household_enrollments WHERE id = $1)`,
      [accepted.enrollment.id],
    );
    expect(await status()).toMatchObject({
      state: 'attention',
      accessAttentionCode: 'subscription_invalid',
    });
    await database.query(
      `UPDATE commerce_subscriptions SET source_verified = true
       WHERE household_id = 'household-harbor'
         AND id = (SELECT subscription_id FROM founding_household_enrollments WHERE id = $1)`,
      [accepted.enrollment.id],
    );

    await database.query(
      `UPDATE commerce_sponsorship_allocations SET source_verified = false
       WHERE household_id = 'household-harbor'
         AND id = (SELECT sponsorship_allocation_id FROM founding_household_enrollments
                   WHERE id = $1)`,
      [accepted.enrollment.id],
    );
    expect(await status()).toMatchObject({
      state: 'attention',
      accessAttentionCode: 'allocation_invalid',
    });
    await database.query(
      `UPDATE commerce_sponsorship_allocations SET source_verified = true
       WHERE household_id = 'household-harbor'
         AND id = (SELECT sponsorship_allocation_id FROM founding_household_enrollments
                   WHERE id = $1)`,
      [accepted.enrollment.id],
    );

    await database.query(
      `UPDATE entitlement_grants SET source_verified = false
       WHERE household_id = 'household-harbor'
         AND id = (SELECT entitlement_grant_id FROM founding_household_enrollments WHERE id = $1)`,
      [accepted.enrollment.id],
    );
    expect(await status()).toMatchObject({
      state: 'attention',
      accessAttentionCode: 'grant_invalid',
    });
    const consoleRecord = await repository.founderConsole({
      access: founderAccess,
      now: new Date(now.getTime() + 1_000),
    });
    expect(consoleRecord.capacity).toMatchObject({
      activeHouseholds: 0,
      attentionHouseholds: 1,
      committedHouseholds: 1,
      remaining: 1,
    });
  });

  it('projects sponsor shortening immediately and excludes activity after the shortened end', async () => {
    await activatePolicy();
    const invitation = await createInvitation();
    const accepted = await acceptBob(invitation);
    const shortenedEnd = new Date(now.getTime() + 5 * 86_400_000);
    await database.query(
      `UPDATE commerce_sponsorships SET ends_at = $2
       WHERE id = (
         SELECT sponsorship_id FROM founding_household_enrollments WHERE id = $1
       )`,
      [accepted.enrollment.id, shortenedEnd.toISOString()],
    );

    const attention = await repository.memberStatus({
      access: bobAccess,
      householdId: 'household-harbor',
      now: new Date(now.getTime() + 86_400_000),
    });
    expect(attention).toMatchObject({
      state: 'attention',
      ledgerState: 'active',
      accessAttentionCode: 'sponsor_backing_invalid',
      effectiveEndsAt: shortenedEnd,
    });

    const afterSponsorEnd = new Date(now.getTime() + 6 * 86_400_000);
    await new SessionRepository(database, {
      next: () => 'session-founding-after-sponsor-end',
    }).create({
      personId: bobAccess.actorPersonId,
      audience: 'customer',
      issuedAt: afterSponsorEnd,
      expiresAt: new Date(afterSponsorEnd.getTime() + 86_400_000),
    });
    const terminated = await repository.memberStatus({
      access: bobAccess,
      householdId: 'household-harbor',
      now: new Date(now.getTime() + 7 * 86_400_000),
    });
    expect(terminated).toMatchObject({
      state: 'attention',
      ledgerState: 'active',
      accessAttentionCode: 'sponsor_backing_invalid',
      effectiveEndsAt: shortenedEnd,
    });
    expect(terminated?.funnel.find(({ stage }) => stage === 'returned_later')).toMatchObject({
      state: 'not_observed',
    });
    const consoleRecord = await repository.founderConsole({
      access: founderAccess,
      now: new Date(now.getTime() + 7 * 86_400_000),
    });
    expect(consoleRecord.capacity).toMatchObject({
      attentionHouseholds: 1,
      committedHouseholds: 1,
    });
  });

  it.each([
    {
      label: 'subscription period end',
      attentionCode: 'subscription_invalid',
      terminate: async (target: Database, enrollmentId: string, at: Date) =>
        target.query(
          `UPDATE commerce_subscriptions SET current_period_ends_at = $2, updated_at = $2
           WHERE household_id = 'household-harbor'
             AND id = (SELECT subscription_id FROM founding_household_enrollments WHERE id = $1)`,
          [enrollmentId, at.toISOString()],
        ),
    },
    {
      label: 'subscription inactive lifecycle',
      attentionCode: 'subscription_invalid',
      terminate: async (target: Database, enrollmentId: string, at: Date) =>
        target.query(
          `UPDATE commerce_subscriptions
           SET lifecycle = 'canceled', ended_at = $2, updated_at = $2
           WHERE household_id = 'household-harbor'
             AND id = (SELECT subscription_id FROM founding_household_enrollments WHERE id = $1)`,
          [enrollmentId, at.toISOString()],
        ),
    },
    {
      label: 'sponsorship allocation end',
      attentionCode: 'allocation_invalid',
      terminate: async (target: Database, enrollmentId: string, at: Date) =>
        target.query(
          `UPDATE commerce_sponsorship_allocations SET state = 'ended', ends_at = $2
           WHERE household_id = 'household-harbor'
             AND id = (
               SELECT sponsorship_allocation_id FROM founding_household_enrollments WHERE id = $1
             )`,
          [enrollmentId, at.toISOString()],
        ),
    },
    {
      label: 'grant end',
      attentionCode: 'grant_invalid',
      terminate: async (target: Database, enrollmentId: string, at: Date) =>
        target.query(
          `UPDATE entitlement_grants SET ends_at = $2
           WHERE household_id = 'household-harbor'
             AND id = (
               SELECT entitlement_grant_id FROM founding_household_enrollments WHERE id = $1
             )`,
          [enrollmentId, at.toISOString()],
        ),
    },
    {
      label: 'grant revocation',
      attentionCode: 'grant_invalid',
      terminate: async (target: Database, enrollmentId: string, at: Date) =>
        target.query(
          `UPDATE entitlement_grants SET revoked_at = $2
           WHERE household_id = 'household-harbor'
             AND id = (
               SELECT entitlement_grant_id FROM founding_household_enrollments WHERE id = $1
             )`,
          [enrollmentId, at.toISOString()],
        ),
    },
  ])(
    'uses the canonical $label as the single status and funnel end',
    async ({ attentionCode, terminate }) => {
      await activatePolicy();
      const invitation = await createInvitation();
      const accepted = await acceptBob(invitation);
      const terminatedAt = new Date(now.getTime() + 2 * 86_400_000);
      await terminate(database, accepted.enrollment.id, terminatedAt);
      const afterTermination = new Date(terminatedAt.getTime() + 60 * 60_000);
      await database.query(
        `INSERT INTO orientation_states(
           household_id, person_id, status, completed_steps, safe_word_disposition,
           needs_attention, version, updated_at
         ) VALUES (
           'household-harbor','person-owner-bob','ready','[]'::jsonb,'unanswered',false,1,$1
         )`,
        [afterTermination.toISOString()],
      );
      await new SessionRepository(database, {
        next: () => 'session-founding-after-canonical-end',
      }).create({
        personId: bobAccess.actorPersonId,
        audience: 'customer',
        issuedAt: afterTermination,
        expiresAt: new Date(afterTermination.getTime() + 86_400_000),
      });

      const status = await repository.memberStatus({
        access: bobAccess,
        householdId: 'household-harbor',
        now: new Date(afterTermination.getTime() + 60 * 60_000),
      });
      expect(status).toMatchObject({
        state: 'attention',
        ledgerState: 'active',
        accessAttentionCode: attentionCode,
        effectiveEndsAt: terminatedAt,
      });
      expect(status?.funnel.find(({ stage }) => stage === 'orientation_ready')).toMatchObject({
        state: 'not_observed',
      });
      expect(status?.funnel.find(({ stage }) => stage === 'returned_later')).toMatchObject({
        state: 'not_observed',
      });
      const consoleRecord = await repository.founderConsole({
        access: founderAccess,
        now: new Date(afterTermination.getTime() + 60 * 60_000),
      });
      expect(consoleRecord.capacity).toMatchObject({
        attentionHouseholds: 1,
        committedHouseholds: 1,
      });
    },
  );

  it('revalidates a structurally Founding grant at the final entitlement snapshot', async () => {
    await activatePolicy();
    const invitation = await createInvitation();
    const accepted = await acceptBob(invitation);
    const foundingGrant = await database.query<
      { entitlement_grant_id: string } & Record<string, unknown>
    >(`SELECT entitlement_grant_id FROM founding_household_enrollments WHERE id = $1`, [
      accepted.enrollment.id,
    ]);
    const foundingGrantId = foundingGrant.rows[0]?.entitlement_grant_id;
    if (foundingGrantId === undefined) throw new Error('Founding grant fixture is missing');

    let reclassifiedBeforeGrantRead = false;
    const interleavingDatabase: Database = {
      kind: database.kind,
      query: async <Row extends Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ) => {
        if (!reclassifiedBeforeGrantRead && sql.includes('FROM entitlement_grants grant_record')) {
          reclassifiedBeforeGrantRead = true;
          await database.query(
            `UPDATE entitlement_grants
             SET source = 'web', sponsorship_id = NULL,
                 subscription_id = 'subscription-local-harbor', plan_version_id = 'free_v1',
                 capabilities = (
                   SELECT capabilities FROM commerce_plan_versions WHERE id = 'free_v1'
                 )
             WHERE household_id = 'household-harbor' AND id = $1`,
            [foundingGrantId],
          );
        }
        return database.query<Row>(sql, parameters);
      },
      exec: (sql: string) => database.exec(sql),
      transaction: <Result>(work: (transaction: SqlExecutor) => Promise<Result>) =>
        database.transaction(work),
      close: async () => undefined,
    };

    const entitlements = await new EntitlementRepository(
      interleavingDatabase,
      undefined,
      'local',
    ).forHousehold('household-harbor', new Date(now.getTime() + 1_000));
    expect(reclassifiedBeforeGrantRead).toBe(true);
    expect(entitlements.portfolio.contributingGrantIds).not.toContain(foundingGrantId);
    expect(entitlements.portfolio.contributingGrantIds).toContain('grant-local-harbor');
  });

  it.each([
    {
      label: 'unverified sponsor organization',
      attentionCode: 'sponsor_backing_invalid',
      expectedEnd: 'start',
      mutate: async (target: Database) =>
        target.query(
          `UPDATE organizations SET verification_state = 'unverified'
           WHERE id = 'organization-founding-households-local'`,
        ),
    },
    {
      label: 'ended sponsorship',
      attentionCode: 'sponsor_backing_invalid',
      expectedEnd: 'termination',
      mutate: async (target: Database, enrollmentId: string, terminatedAt: Date) =>
        target.query(
          `UPDATE commerce_sponsorships SET state = 'ended', ends_at = $2
           WHERE id = (
             SELECT sponsorship_id FROM founding_household_enrollments WHERE id = $1
           )`,
          [enrollmentId, terminatedAt.toISOString()],
        ),
    },
    {
      label: 'payer-bearing Founding subscription',
      attentionCode: 'subscription_invalid',
      expectedEnd: 'start',
      mutate: async (target: Database, enrollmentId: string) =>
        target.query(
          `UPDATE commerce_subscriptions SET payer_person_id = 'person-owner-bob'
           WHERE household_id = 'household-harbor'
             AND id = (
               SELECT subscription_id FROM founding_household_enrollments WHERE id = $1
             )`,
          [enrollmentId],
        ),
    },
    {
      label: 'reclassified Founding subscription source',
      attentionCode: 'subscription_invalid',
      expectedEnd: 'start',
      mutate: async (target: Database, enrollmentId: string) =>
        target.query(
          `UPDATE commerce_subscriptions SET source = 'web'
           WHERE household_id = 'household-harbor'
             AND id = (
               SELECT subscription_id FROM founding_household_enrollments WHERE id = $1
             )`,
          [enrollmentId],
        ),
    },
    {
      label: 'backdated Founding subscription start',
      attentionCode: 'subscription_invalid',
      expectedEnd: 'start',
      mutate: async (target: Database, enrollmentId: string) =>
        target.query(
          `UPDATE commerce_subscriptions
           SET current_period_starts_at = current_period_starts_at - interval '1 hour'
           WHERE household_id = 'household-harbor'
             AND id = (
               SELECT subscription_id FROM founding_household_enrollments WHERE id = $1
             )`,
          [enrollmentId],
        ),
    },
    {
      label: 'shortened Founding subscription period',
      attentionCode: 'subscription_invalid',
      expectedEnd: 'termination',
      mutate: async (target: Database, enrollmentId: string, terminatedAt: Date) =>
        target.query(
          `UPDATE commerce_subscriptions SET current_period_ends_at = $2, updated_at = $2
           WHERE household_id = 'household-harbor'
             AND id = (
               SELECT subscription_id FROM founding_household_enrollments WHERE id = $1
             )`,
          [enrollmentId, terminatedAt.toISOString()],
        ),
    },
    {
      label: 'unverified sponsorship allocation',
      attentionCode: 'allocation_invalid',
      expectedEnd: 'start',
      mutate: async (target: Database, enrollmentId: string) =>
        target.query(
          `UPDATE commerce_sponsorship_allocations SET source_verified = false
           WHERE household_id = 'household-harbor'
             AND id = (
               SELECT sponsorship_allocation_id
               FROM founding_household_enrollments WHERE id = $1
             )`,
          [enrollmentId],
        ),
    },
    {
      label: 'backdated sponsorship allocation start',
      attentionCode: 'allocation_invalid',
      expectedEnd: 'start',
      mutate: async (target: Database, enrollmentId: string) =>
        target.query(
          `UPDATE commerce_sponsorship_allocations
           SET starts_at = starts_at - interval '1 hour'
           WHERE household_id = 'household-harbor'
             AND id = (
               SELECT sponsorship_allocation_id
               FROM founding_household_enrollments WHERE id = $1
             )`,
          [enrollmentId],
        ),
    },
    {
      label: 'ended sponsorship allocation',
      attentionCode: 'allocation_invalid',
      expectedEnd: 'termination',
      mutate: async (target: Database, enrollmentId: string, terminatedAt: Date) =>
        target.query(
          `UPDATE commerce_sponsorship_allocations SET state = 'ended', ends_at = $2
           WHERE household_id = 'household-harbor'
             AND id = (
               SELECT sponsorship_allocation_id
               FROM founding_household_enrollments WHERE id = $1
             )`,
          [enrollmentId, terminatedAt.toISOString()],
        ),
    },
    {
      label: 'capability-divergent Founding grant',
      attentionCode: 'grant_invalid',
      expectedEnd: 'start',
      mutate: async (target: Database, enrollmentId: string) =>
        target.query(
          `UPDATE entitlement_grants SET capabilities = '[]'::jsonb
           WHERE household_id = 'household-harbor'
             AND id = (
               SELECT entitlement_grant_id FROM founding_household_enrollments WHERE id = $1
             )`,
          [enrollmentId],
        ),
    },
    {
      label: 'reclassified Founding grant on an unrelated web subscription',
      attentionCode: 'grant_invalid',
      expectedEnd: 'start',
      mutate: async (target: Database, enrollmentId: string) =>
        target.query(
          `UPDATE entitlement_grants
           SET source = 'web', sponsorship_id = NULL,
               subscription_id = 'subscription-local-harbor', plan_version_id = 'free_v1',
               capabilities = (
                 SELECT capabilities FROM commerce_plan_versions WHERE id = 'free_v1'
               )
           WHERE household_id = 'household-harbor'
             AND id = (
               SELECT entitlement_grant_id FROM founding_household_enrollments WHERE id = $1
             )`,
          [enrollmentId],
        ),
    },
    {
      label: 'backdated Founding grant start',
      attentionCode: 'grant_invalid',
      expectedEnd: 'start',
      mutate: async (target: Database, enrollmentId: string) =>
        target.query(
          `UPDATE entitlement_grants SET starts_at = starts_at - interval '1 hour'
           WHERE household_id = 'household-harbor'
             AND id = (
               SELECT entitlement_grant_id FROM founding_household_enrollments WHERE id = $1
             )`,
          [enrollmentId],
        ),
    },
    {
      label: 'revoked Founding grant',
      attentionCode: 'grant_invalid',
      expectedEnd: 'termination',
      mutate: async (target: Database, enrollmentId: string, terminatedAt: Date) =>
        target.query(
          `UPDATE entitlement_grants SET revoked_at = $2
           WHERE household_id = 'household-harbor'
             AND id = (
               SELECT entitlement_grant_id FROM founding_household_enrollments WHERE id = $1
             )`,
          [enrollmentId, terminatedAt.toISOString()],
        ),
    },
  ] as const)(
    'uses one canonical resolver for $label and excludes every post-end fact',
    async ({ attentionCode, expectedEnd, mutate }) => {
      await activatePolicy();
      const invitation = await createInvitation();
      const accepted = await acceptBob(invitation);
      const terminatedAt = new Date(accepted.enrollment.startsAt.getTime() + 2 * 86_400_000);
      await mutate(database, accepted.enrollment.id, terminatedAt);
      const observedAt = new Date(terminatedAt.getTime() + 25 * 60 * 60_000);
      await insertPostEndFunnelFacts(database, observedAt);
      await expectCanonicalAttention({
        target: database,
        targetRepository: repository,
        enrollmentId: accepted.enrollment.id,
        attentionCode,
        effectiveEndsAt: expectedEnd === 'start' ? accepted.enrollment.startsAt : terminatedAt,
        observedAt: new Date(observedAt.getTime() + 1),
        serviceConsentState: 'active',
      });
    },
  );

  it.each([
    { label: 'missing sponsor backing', kind: 'backing' },
    { label: 'missing immutable plan', kind: 'plan' },
  ] as const)('keeps the ledger visible and denies access for $label', async ({ kind }) => {
    await activatePolicy();
    const invitation = await createInvitation();
    const accepted = await acceptBob(invitation);
    const observedAt = new Date(accepted.enrollment.startsAt.getTime() + 25 * 60 * 60_000);
    await insertPostEndFunnelFacts(database, observedAt);
    const target = withQueryOverrideEverywhere(database, (sql) => {
      let replacement = sql;
      if (kind === 'backing') {
        replacement = replacement
          .replace(
            'AND backing.plan_version_id = enrollment.plan_version_id',
            `AND backing.plan_version_id = enrollment.plan_version_id
               AND backing.sponsorship_id IS NULL`,
          )
          .replace(
            'AND fb.plan_version_id = f.plan_version_id',
            `AND fb.plan_version_id = f.plan_version_id
               AND fb.sponsorship_id IS NULL`,
          );
      } else {
        if (sql.includes('access_integrity')) {
          replacement = replacement.replace("AND plan.state = 'active'", 'AND false');
        } else if (sql.includes('sponsor_backing_verified')) {
          replacement = replacement.replace("AND fpv.state = 'active'", 'AND false');
        }
      }
      return replacement === sql ? undefined : { sql: replacement };
    });
    await expectCanonicalAttention({
      target,
      targetRepository: repositoryForDatabase(target),
      enrollmentId: accepted.enrollment.id,
      attentionCode: 'sponsor_backing_invalid',
      effectiveEndsAt: accepted.enrollment.startsAt,
      observedAt: new Date(observedAt.getTime() + 1),
      serviceConsentState: 'active',
    });
  });

  it.each([
    { state: 'proposed', action: 'propose' },
    { state: 'deferred', action: 'defer' },
    { state: 'withdrawn', action: 'withdraw' },
    { state: 'relinquished', action: 'relinquish' },
    { state: 'suspended', action: 'suspend' },
    { state: 'revoked', action: 'revoke' },
    { state: 'expired', action: 'expire' },
  ] as const)(
    'keeps the active ledger visible for exact $state service-consent projection state',
    async ({ state, action }) => {
      await activatePolicy();
      const invitation = await createInvitation();
      const accepted = await acceptBob(invitation);
      const terminatedAt = new Date(accepted.enrollment.startsAt.getTime() + 2 * 86_400_000);
      const observedAt = new Date(terminatedAt.getTime() + 25 * 60 * 60_000);
      const rollback = new Error(`rollback service projection ${state}`);

      await expect(
        database.transaction(async (transaction) => {
          const consent = await transaction.query<
            { service_consent_id: string } & Record<string, unknown>
          >(`SELECT service_consent_id FROM founding_household_enrollments WHERE id = $1`, [
            accepted.enrollment.id,
          ]);
          const consentId = consent.rows[0]?.service_consent_id;
          if (consentId === undefined) throw new Error('Founding service consent is unavailable');
          await appendConsentEvidence(transaction, sequentialIds(), {
            householdId: 'household-harbor',
            consentId,
            actorPersonId: 'person-owner-bob',
            subjectPersonId: 'person-owner-bob',
            purpose: 'founding_household_service_beta',
            scope: {
              cohortKey: foundingHouseholdCohortKey,
              followUpConsent: false,
              marketingConsent: false,
              researchConsent: false,
            },
            action,
            sourceInteraction: `founding_household_h5_${state}`,
            sessionId: bobAccess.sessionId,
            correlationId: `correlation:founding-h5-${state}`,
            effectiveAt: terminatedAt,
            documents: foundingHouseholdServiceDocuments,
          });
          const target = databaseForExecutor(database, transaction);
          await insertPostEndFunnelFacts(target, observedAt);
          await expectCanonicalAttention({
            target,
            targetRepository: repositoryForDatabase(target),
            enrollmentId: accepted.enrollment.id,
            attentionCode: 'service_consent_invalid',
            effectiveEndsAt: terminatedAt,
            observedAt: new Date(observedAt.getTime() + 1),
            serviceConsentState: state,
          });
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    },
  );

  it.each([
    {
      label: 'missing projection',
      expectedState: 'missing',
      corrupt: async (transaction: SqlExecutor, consentId: string) =>
        transaction.query(
          `DELETE FROM consent_current_projections
           WHERE household_id = 'household-harbor' AND consent_id = $1`,
          [consentId],
        ),
    },
    {
      label: 'wrong purpose',
      expectedState: 'active',
      corrupt: async (transaction: SqlExecutor, consentId: string) =>
        transaction.query(
          `UPDATE consent_current_projections SET purpose = 'unrelated_service_purpose'
           WHERE household_id = 'household-harbor' AND consent_id = $1`,
          [consentId],
        ),
    },
    {
      label: 'expanded scope',
      expectedState: 'active',
      corrupt: async (transaction: SqlExecutor, consentId: string) =>
        transaction.query(
          `UPDATE consent_current_projections
           SET scope = scope || '{"researchConsent":true}'::jsonb
           WHERE household_id = 'household-harbor' AND consent_id = $1`,
          [consentId],
        ),
    },
    {
      label: 'wrong subject',
      expectedState: 'active',
      corrupt: async (transaction: SqlExecutor, consentId: string) =>
        transaction.query(
          `UPDATE consent_current_projections SET subject_person_id = 'person-protected-olivia'
           WHERE household_id = 'household-harbor' AND consent_id = $1`,
          [consentId],
        ),
    },
    {
      label: 'drifted effective and update times',
      expectedState: 'active',
      corrupt: async (transaction: SqlExecutor, consentId: string, corruptedAt: Date) =>
        transaction.query(
          `UPDATE consent_current_projections SET effective_at = $2, updated_at = $2
           WHERE household_id = 'household-harbor' AND consent_id = $1`,
          [consentId, corruptedAt.toISOString()],
        ),
    },
    {
      label: 'noncanonical latest evidence',
      expectedState: 'active',
      corrupt: async (transaction: SqlExecutor, consentId: string, corruptedAt: Date) =>
        appendConsentEvidence(transaction, sequentialIds(), {
          householdId: 'household-harbor',
          consentId,
          actorPersonId: 'person-owner-bob',
          subjectPersonId: 'person-owner-bob',
          purpose: 'founding_household_service_beta',
          scope: {
            cohortKey: foundingHouseholdCohortKey,
            followUpConsent: false,
            marketingConsent: false,
            researchConsent: false,
          },
          action: 'narrow',
          sourceInteraction: 'founding_household_h5_noncanonical_latest',
          sessionId: bobAccess.sessionId,
          correlationId: 'correlation:founding-h5-noncanonical-latest',
          effectiveAt: corruptedAt,
          documents: foundingHouseholdServiceDocuments,
        }),
    },
  ] as const)(
    'projects $label as explicit service-consent attention without inventing evidence',
    async ({ expectedState, corrupt }) => {
      await activatePolicy();
      const invitation = await createInvitation();
      const accepted = await acceptBob(invitation);
      const corruptedAt = new Date(accepted.enrollment.startsAt.getTime() + 2 * 86_400_000);
      const observedAt = new Date(corruptedAt.getTime() + 25 * 60 * 60_000);
      const rollback = new Error('rollback malformed service projection');

      await expect(
        database.transaction(async (transaction) => {
          const consent = await transaction.query<
            { service_consent_id: string } & Record<string, unknown>
          >(`SELECT service_consent_id FROM founding_household_enrollments WHERE id = $1`, [
            accepted.enrollment.id,
          ]);
          const consentId = consent.rows[0]?.service_consent_id;
          if (consentId === undefined) throw new Error('Founding service consent is unavailable');
          await corrupt(transaction, consentId, corruptedAt);
          const target = databaseForExecutor(database, transaction);
          await insertPostEndFunnelFacts(target, observedAt);
          await expectCanonicalAttention({
            target,
            targetRepository: repositoryForDatabase(target),
            enrollmentId: accepted.enrollment.id,
            attentionCode: 'service_consent_invalid',
            effectiveEndsAt: accepted.enrollment.startsAt,
            observedAt: new Date(observedAt.getTime() + 1),
            serviceConsentState: expectedState,
          });
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    },
  );

  it('fails closed for wrong, expired, nonadministrator, and nonlocal identities', async () => {
    await activatePolicy({ invitationTtlDays: 1, programEndsAt: new Date('2026-09-01T00:00:00Z') });
    const invitation = await createInvitation();
    await expect(
      repository.previewInvitation({
        access: bobAccess,
        householdId: 'household-harbor',
        invitationId: invitation.invitation.id,
        invitationCredential: `${invitation.invitation.id}.${'x'.repeat(43)}`,
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_found' } satisfies Partial<DomainError>);

    await expect(
      repository.previewInvitation({
        access: { ...bobAccess, actorIssuer: 'managed-idp' },
        householdId: 'household-harbor',
        invitationId: invitation.invitation.id,
        invitationCredential: invitation.credential,
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);

    await expect(
      repository.previewInvitation({
        access: { ...bobAccess, sessionId: 'session-does-not-exist' },
        householdId: 'household-harbor',
        invitationId: invitation.invitation.id,
        invitationCredential: invitation.credential,
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);

    await database.query('UPDATE sessions SET revoked_at = $2 WHERE id = $1', [
      bobAccess.sessionId,
      now.toISOString(),
    ]);
    await expect(
      repository.previewInvitation({
        access: bobAccess,
        householdId: 'household-harbor',
        invitationId: invitation.invitation.id,
        invitationCredential: invitation.credential,
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);
    await database.query('UPDATE sessions SET revoked_at = NULL WHERE id = $1', [
      bobAccess.sessionId,
    ]);

    await database.query(
      `UPDATE household_administrator_assignments SET status = 'suspended', suspended_at = $1
       WHERE household_id = 'household-harbor' AND person_id = 'person-owner-bob'`,
      [now.toISOString()],
    );
    await expect(
      repository.previewInvitation({
        access: bobAccess,
        householdId: 'household-harbor',
        invitationId: invitation.invitation.id,
        invitationCredential: invitation.credential,
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);

    await database.query(
      `UPDATE household_administrator_assignments SET status = 'active', suspended_at = NULL
       WHERE household_id = 'household-harbor' AND person_id = 'person-owner-bob'`,
    );
    await expect(
      repository.previewInvitation({
        access: bobAccess,
        householdId: 'household-harbor',
        invitationId: invitation.invitation.id,
        invitationCredential: invitation.credential,
        now: new Date(now.getTime() + 86_400_000 + 1),
      }),
    ).rejects.toMatchObject({ code: 'expired' } satisfies Partial<DomainError>);
    const stored = await database.query<
      { state: string; credential_fingerprint: string | null } & Record<string, unknown>
    >(`SELECT state, credential_fingerprint FROM founding_household_invitations WHERE id = $1`, [
      invitation.invitation.id,
    ]);
    expect(stored.rows).toEqual([{ state: 'expired', credential_fingerprint: null }]);
  });

  it('enforces cohort capacity under concurrent invitation issuance', async () => {
    await activatePolicy({ maxHouseholds: 1 });
    const attempts = await Promise.allSettled([
      repository.createInvitation({
        access: founderAccess,
        operationKey: operation('invite', 2),
        now,
      }),
      repository.createInvitation({
        access: founderAccess,
        operationKey: operation('invite', 3),
        now,
      }),
    ]);
    const pending = await database.query<{ count: number } & Record<string, unknown>>(
      `SELECT count(*)::integer AS count FROM founding_household_invitations
       WHERE environment = 'local' AND state = 'pending'`,
    );
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'conflict' },
    });
    expect(pending.rows[0]?.count).toBe(1);
  });

  it('expires the finite sponsor grant naturally without claiming revocation or paid access', async () => {
    await activatePolicy({ accessDurationDays: 1 });
    const invitation = await createInvitation();
    const accepted = await acceptBob(invitation);
    const afterExpiry = new Date(accepted.enrollment.endsAt.getTime() + 1);
    const status = await repository.memberStatus({
      access: bobAccess,
      householdId: 'household-harbor',
      now: afterExpiry,
    });
    const enrollmentGrant = await database.query<
      { entitlement_grant_id: string; revoked_at: unknown | null } & Record<string, unknown>
    >(
      `SELECT enrollment.entitlement_grant_id, grant_record.revoked_at
       FROM founding_household_enrollments enrollment
       JOIN entitlement_grants grant_record
         ON grant_record.household_id = enrollment.household_id
        AND grant_record.id = enrollment.entitlement_grant_id
       WHERE enrollment.household_id = 'household-harbor'`,
    );
    const entitlements = await new EntitlementRepository(database, undefined, 'local').forHousehold(
      'household-harbor',
      afterExpiry,
    );

    expect(status).toMatchObject({
      state: 'expired',
      paymentState: 'not_paid_sponsored_beta',
    });
    expect(enrollmentGrant.rows[0]?.revoked_at).toBeNull();
    expect(entitlements.portfolio.contributingGrantIds).not.toContain(
      enrollmentGrant.rows[0]?.entitlement_grant_id,
    );
  });

  it('offboards only the linked sponsor chain and distinguishes household consent withdrawal', async () => {
    await activatePolicy();
    const invitation = await createInvitation();
    const accepted = await acceptBob(invitation);
    const unrelatedEndsAt = new Date(now.getTime() + 90 * 86_400_000);
    await database.query(
      `INSERT INTO commerce_subscriptions(
         household_id, id, payer_person_id, plan_version_id, source, lifecycle,
         source_verified, precedence, current_period_starts_at, current_period_ends_at,
         reconciliation_state, created_at, updated_at
       ) VALUES (
         'household-harbor','subscription-founding-unrelated','person-owner-bob','family_v1',
         'local','active',true,150,$1,$2,'not_required',$1,$1
       )`,
      [now.toISOString(), unrelatedEndsAt.toISOString()],
    );
    await database.query(
      `INSERT INTO commerce_provider_subscription_records(
         id, household_id, subscription_id, provider, environment,
         external_subscription_id, raw_state, provider_version, observed_at, verified_at
       ) VALUES (
         'provider-founding-unrelated','household-harbor','subscription-founding-unrelated',
         'local','local','local-founding-unrelated','active','fixture-v1',$1,$1
       )`,
      [now.toISOString()],
    );
    await database.query(
      `INSERT INTO entitlement_grants(
         household_id, id, source, capabilities, starts_at, ends_at, revoked_at,
         source_verified, precedence, plan_version_id, subscription_id,
         sponsorship_id, created_at
       ) SELECT 'household-harbor','grant-founding-unrelated','local',capabilities,$1,$2,NULL,
                true,150,id,'subscription-founding-unrelated',NULL,$1
         FROM commerce_plan_versions WHERE id = 'family_v1'`,
      [now.toISOString(), unrelatedEndsAt.toISOString()],
    );
    await database.query(
      `INSERT INTO consents(
         household_id, id, protected_person_id, granted_by_person_id, purpose,
         consent_version, state, granted_at
       ) VALUES (
         'household-harbor','consent-founding-bob-olivia','person-owner-bob',
         'person-owner-bob','trusted_circle_relationship','founding-test-v1','active',$1
       )`,
      [new Date(now.getTime() + 500).toISOString()],
    );
    await database.query(
      `INSERT INTO consent_evidence(
         household_id, id, consent_id, actor_person_id, subject_person_id,
         recipient_person_id, purpose, scope, action, disclosure_version,
         disclosure_digest, policy_version, policy_digest, source_interaction,
         actor_identity_id, actor_identity_issuer, actor_identity_subject, assurance,
         session_id, effective_at, recorded_at
       ) VALUES (
         'household-harbor','evidence-founding-bob-olivia','consent-founding-bob-olivia',
         'person-owner-bob','person-owner-bob','person-protected-olivia',
         'trusted_circle_relationship',$2::jsonb,'accept','founding-test-v1',repeat('1',64),
         'founding-test-policy-v1',repeat('2',64),'founding_household_test',
         'identity-owner-bob','boomerbuddy-dev','owner-bob','development',$3,$1,$1
       )`,
      [
        new Date(now.getTime() + 500).toISOString(),
        JSON.stringify({ permissions: ['view_shared_checks'] }),
        bobAccess.sessionId,
      ],
    );
    await database.query(
      `INSERT INTO consent_current_projections(
         household_id, consent_id, latest_evidence_id, actor_person_id,
         subject_person_id, recipient_person_id, purpose, scope, state,
         effective_at, updated_at
       ) VALUES (
         'household-harbor','consent-founding-bob-olivia','evidence-founding-bob-olivia',
         'person-owner-bob','person-owner-bob','person-protected-olivia',
         'trusted_circle_relationship',$2::jsonb,'active',$1,$1
       )`,
      [
        new Date(now.getTime() + 500).toISOString(),
        JSON.stringify({ permissions: ['view_shared_checks'] }),
      ],
    );
    await database.query(
      `INSERT INTO trusted_circle_relationships(
         household_id, id, protected_person_id, trusted_person_id, permissions,
         consent_id, consent_version, state, created_at, latest_consent_evidence_id
       ) VALUES (
         'household-harbor','relationship-founding-bob-olivia','person-owner-bob',
         'person-protected-olivia',$2::jsonb,'consent-founding-bob-olivia',
         'founding-test-v1','active',$1,'evidence-founding-bob-olivia'
       )`,
      [new Date(now.getTime() + 500).toISOString(), JSON.stringify(['view_shared_checks'])],
    );
    await database.query(
      `INSERT INTO commerce_allowance_allocations(
         household_id, id, entitlement_grant_id, allowance_key, subject_kind,
         subject_id, state, allocated_at
       ) VALUES (
         'household-harbor','allocation-founding-trusted-olivia',
         (SELECT entitlement_grant_id FROM founding_household_enrollments WHERE id = $2),
         'trusted_circle_participants','trusted_circle_person','person-protected-olivia',
         'active',$1
       )`,
      [new Date(now.getTime() + 500).toISOString(), accepted.enrollment.id],
    );
    const unrelatedBefore = await database.query<Record<string, unknown>>(
      `SELECT id, source, revoked_at FROM entitlement_grants
       WHERE household_id = 'household-harbor'
         AND id NOT IN (SELECT entitlement_grant_id FROM founding_household_enrollments)
       ORDER BY id`,
    );
    const offboarded = await repository.offboard({
      access: bobAccess,
      authority: 'household',
      householdId: 'household-harbor',
      operationKey: operation('offboard', 4),
      now: new Date(now.getTime() + 1_000),
    });
    const unrelatedAfter = await database.query<Record<string, unknown>>(
      `SELECT id, source, revoked_at FROM entitlement_grants
       WHERE household_id = 'household-harbor'
         AND id NOT IN (SELECT entitlement_grant_id FROM founding_household_enrollments)
       ORDER BY id`,
    );
    const service = await database.query<Record<string, unknown>>(
      `SELECT projection.state, evidence.action
       FROM consents consent
       JOIN consent_current_projections projection
         ON projection.household_id = consent.household_id
        AND projection.consent_id = consent.id
       JOIN consent_evidence evidence
         ON evidence.household_id = projection.household_id
        AND evidence.id = projection.latest_evidence_id
       WHERE consent.household_id = 'household-harbor'
         AND consent.purpose = 'founding_household_service_beta'`,
    );
    const reboundAllocations = await database.query<Record<string, unknown>>(
      `SELECT allowance_key, subject_id, entitlement_grant_id
       FROM commerce_allowance_allocations
       WHERE household_id = 'household-harbor'
         AND subject_id IN ('person-owner-bob','person-protected-olivia')
         AND id IN (
           SELECT allowance_allocation_id FROM protected_members
           WHERE household_id = 'household-harbor'
           UNION ALL SELECT 'allocation-founding-trusted-olivia'
         )
       ORDER BY subject_id, allowance_key`,
    );

    expect(offboarded).toMatchObject({
      enrollment: { state: 'revoked' },
      reason: 'household_withdrew',
      reused: false,
      unrelatedGrantsChanged: false,
      reboundProtectedAllocations: 2,
      reboundTrustedCircleAllocations: 1,
    });
    expect(unrelatedAfter.rows).toEqual(unrelatedBefore.rows);
    expect(reboundAllocations.rows).toEqual([
      {
        allowance_key: 'protected_members',
        subject_id: 'person-owner-bob',
        entitlement_grant_id: 'grant-founding-unrelated',
      },
      {
        allowance_key: 'protected_members',
        subject_id: 'person-protected-olivia',
        entitlement_grant_id: 'grant-founding-unrelated',
      },
      {
        allowance_key: 'trusted_circle_participants',
        subject_id: 'person-protected-olivia',
        entitlement_grant_id: 'grant-founding-unrelated',
      },
    ]);
    expect(service.rows).toEqual([{ state: 'withdrawn', action: 'withdraw' }]);
  });

  it('lets the founder end only sponsorship without claiming customer consent withdrawal', async () => {
    await activatePolicy();
    const invitation = await createInvitation();
    await acceptBob(invitation);
    const result = await repository.offboard({
      access: founderAccess,
      authority: 'founder',
      householdId: 'household-harbor',
      operationKey: operation('offboard', 4),
      now: new Date(now.getTime() + 1_000),
    });
    const service = await database.query<Record<string, unknown>>(
      `SELECT projection.state, evidence.action
       FROM consents consent
       JOIN consent_current_projections projection
         ON projection.household_id = consent.household_id
        AND projection.consent_id = consent.id
       JOIN consent_evidence evidence
         ON evidence.household_id = projection.household_id
        AND evidence.id = projection.latest_evidence_id
       WHERE consent.household_id = 'household-harbor'
         AND consent.purpose = 'founding_household_service_beta'`,
    );

    expect(result).toMatchObject({
      enrollment: { state: 'revoked' },
      reason: 'founder_revoked',
      unrelatedGrantsChanged: false,
    });
    expect(service.rows).toEqual([{ state: 'active', action: 'accept' }]);

    const grantBeforeConsentWithdrawal = await database.query<Record<string, unknown>>(
      `SELECT grant_record.id, grant_record.revoked_at
       FROM founding_household_enrollments enrollment
       JOIN entitlement_grants grant_record
         ON grant_record.household_id = enrollment.household_id
        AND grant_record.id = enrollment.entitlement_grant_id
       WHERE enrollment.household_id = 'household-harbor'`,
    );
    const consentOnly = await repository.offboard({
      access: bobAccess,
      authority: 'household',
      householdId: 'household-harbor',
      operationKey: operation('offboard', 5),
      now: new Date(now.getTime() + 2_000),
    });
    const consentOnlyRetry = await repository.offboard({
      access: bobAccess,
      authority: 'household',
      householdId: 'household-harbor',
      operationKey: operation('offboard', 5),
      now: new Date(now.getTime() + 3_000),
    });
    const serviceAfter = await database.query<Record<string, unknown>>(
      `SELECT projection.state, evidence.action, evidence.source_interaction
       FROM consents consent
       JOIN consent_current_projections projection
         ON projection.household_id = consent.household_id
        AND projection.consent_id = consent.id
       JOIN consent_evidence evidence
         ON evidence.household_id = projection.household_id
        AND evidence.id = projection.latest_evidence_id
       WHERE consent.household_id = 'household-harbor'
         AND consent.purpose = 'founding_household_service_beta'`,
    );
    const grantAfterConsentWithdrawal = await database.query<Record<string, unknown>>(
      `SELECT grant_record.id, grant_record.revoked_at
       FROM founding_household_enrollments enrollment
       JOIN entitlement_grants grant_record
         ON grant_record.household_id = enrollment.household_id
        AND grant_record.id = enrollment.entitlement_grant_id
       WHERE enrollment.household_id = 'household-harbor'`,
    );
    expect(consentOnly).toMatchObject({
      enrollment: { state: 'revoked', serviceConsentState: 'withdrawn' },
      reused: false,
      reboundProtectedAllocations: 0,
      reboundTrustedCircleAllocations: 0,
      unrelatedGrantsChanged: false,
    });
    expect(consentOnlyRetry).toMatchObject({ reused: true });
    expect(serviceAfter.rows).toEqual([
      {
        state: 'withdrawn',
        action: 'withdraw',
        source_interaction: 'founding_household_consent_only_withdrawal',
      },
    ]);
    expect(grantAfterConsentWithdrawal.rows).toEqual(grantBeforeConsentWithdrawal.rows);
  });

  it('enforces internal-owner and append-only history rules at the direct SQL boundary', async () => {
    await activatePolicy();
    const invitation = await createInvitation();
    await expect(
      withCapturedAuthority(now, async (transaction) => {
        await transaction.query(
          `INSERT INTO founding_household_operations(
             operation_key, cohort_key, environment, operation_kind, request_digest,
             actor_person_id, result_reference, created_at
           ) VALUES ($1,$2,'local','policy',$3,'person-hq-riley','3:0',$4)`,
          [operation('policy', 98), foundingHouseholdCohortKey, 'C'.repeat(43), now.toISOString()],
        );
        await transaction.query(
          `INSERT INTO founding_household_policy_versions(
             cohort_key, environment, revision, state, benefit_key, max_households,
             invitation_ttl_days, access_duration_days, program_ends_at,
             changed_by_person_id, operation_key, created_at
           ) VALUES ($1,'local',3,'disabled',NULL,NULL,NULL,NULL,NULL,
                     'person-hq-riley',$2,$3)`,
          [foundingHouseholdCohortKey, operation('policy', 98), now.toISOString()],
        );
      }),
    ).rejects.toThrow('active internal owner');

    await database.query(
      `UPDATE employee_assignments SET role = 'hq_owner'
       WHERE id = 'employee-hq-riley'`,
    );
    await expect(
      withCapturedAuthority(now, async (transaction) => {
        await transaction.query(
          `INSERT INTO founding_household_operations(
             operation_key, cohort_key, environment, operation_kind, request_digest,
             actor_person_id, result_reference, created_at
           ) VALUES ($1,$2,'local','policy',$3,'person-hq-riley','3:0',$4)`,
          [operation('policy', 97), foundingHouseholdCohortKey, 'D'.repeat(43), now.toISOString()],
        );
        await transaction.query(
          `INSERT INTO founding_household_policy_versions(
             cohort_key, environment, revision, state, benefit_key, max_households,
             invitation_ttl_days, access_duration_days, program_ends_at,
             changed_by_person_id, operation_key, created_at
           ) VALUES ($1,'local',3,'disabled',NULL,NULL,NULL,NULL,NULL,
                     'person-hq-riley',$2,$3)`,
          [foundingHouseholdCohortKey, operation('policy', 97), now.toISOString()],
        );
      }),
    ).rejects.toThrow('bound configured founder');

    await expect(
      withCapturedAuthority(now, async (transaction) => {
        await transaction.query(
          `INSERT INTO founding_household_operations(
             operation_key, cohort_key, environment, operation_kind, request_digest,
             actor_person_id, result_reference, created_at
           ) VALUES ($1,$2,'local','invite',$3,'person-hq-riley','direct-reviewer-invite',$4)`,
          [operation('invite', 99), foundingHouseholdCohortKey, 'A'.repeat(43), now.toISOString()],
        );
        await transaction.query(
          `INSERT INTO founding_household_invitations(
             id, cohort_key, environment, policy_revision, benefit_key,
             access_duration_days, program_ends_at, credential_fingerprint,
             fingerprint_key_version, state, created_by_person_id, operation_key,
             expires_at, created_at, ended_at
           ) VALUES ('direct-reviewer-invite',$1,'local',2,'family_beta_v1',30,$2,$3,1,
                     'pending','person-hq-riley',$4,$5,$6,NULL)`,
          [
            foundingHouseholdCohortKey,
            '2026-10-01T00:00:00.000Z',
            'B'.repeat(43),
            operation('invite', 99),
            '2026-08-24T12:00:00.000Z',
            now.toISOString(),
          ],
        );
      }),
    ).rejects.toThrow('bound configured founder');
    await expect(
      withCapturedAuthority(now, async (transaction) => {
        await transaction.query(
          `INSERT INTO founding_household_operations(
             operation_key, cohort_key, environment, operation_kind, request_digest,
             actor_person_id, result_reference, created_at
           ) VALUES ($1,$2,'local','invite',$3,'person-hq-riley','direct-owner-invite',$4)`,
          [operation('invite', 96), foundingHouseholdCohortKey, 'E'.repeat(43), now.toISOString()],
        );
        await transaction.query(
          `INSERT INTO founding_household_invitations(
             id, cohort_key, environment, policy_revision, benefit_key,
             access_duration_days, program_ends_at, credential_fingerprint,
             fingerprint_key_version, state, created_by_person_id, operation_key,
             expires_at, created_at, ended_at
           ) VALUES ('direct-owner-invite',$1,'local',2,'family_beta_v1',30,$2,$3,1,
                     'pending','person-hq-riley',$4,$5,$6,NULL)`,
          [
            foundingHouseholdCohortKey,
            '2026-10-01T00:00:00.000Z',
            'F'.repeat(43),
            operation('invite', 96),
            '2026-08-24T12:00:00.000Z',
            now.toISOString(),
          ],
        );
      }),
    ).rejects.toThrow('bound configured founder');
    await expect(
      database.query(
        `UPDATE founding_household_invitations SET benefit_key = 'plus_beta_v1'
         WHERE id = $1`,
        [invitation.invitation.id],
      ),
    ).rejects.toThrow('immutable');
    await expect(
      database.query('DELETE FROM founding_household_invitations WHERE id = $1', [
        invitation.invitation.id,
      ]),
    ).rejects.toThrow('append-only');
    await expect(
      withCapturedAuthority(now, (transaction) =>
        transaction.query(
          `UPDATE founding_household_invitations
         SET state = 'accepted', credential_fingerprint = NULL, ended_at = $2
         WHERE id = $1`,
          [invitation.invitation.id, now.toISOString()],
        ),
      ),
    ).rejects.toThrow('Invalid Founding Household invitation transition');
  });

  it('requires one exact captured database clock across raw operation and child writes', async () => {
    await activatePolicy();
    const invitation = await createInvitation();

    await expect(
      database.query(
        `INSERT INTO founding_household_operations(
           operation_key, cohort_key, environment, operation_kind, request_digest,
           actor_person_id, result_reference, created_at
         ) VALUES ($1,$2,'local','invite',$3,$4,'uncaptured-invite',$5)`,
        [
          operation('invite', 84),
          foundingHouseholdCohortKey,
          'T'.repeat(43),
          founderPersonId,
          now.toISOString(),
        ],
      ),
    ).rejects.toThrow('authority clock was not captured');

    for (const [index, offset] of [-1, 1].entries()) {
      const divergent = new Date(now.getTime() + offset);
      await expect(
        withCapturedAuthority(now, (transaction) =>
          transaction.query(
            `INSERT INTO founding_household_operations(
               operation_key, cohort_key, environment, operation_kind, request_digest,
               actor_person_id, result_reference, created_at
             ) VALUES ($1,$2,'local','invite',$3,$4,$5,$6)`,
            [
              operation('invite', 85 + index),
              foundingHouseholdCohortKey,
              'U'.repeat(43),
              founderPersonId,
              `divergent-invite-${index}`,
              divergent.toISOString(),
            ],
          ),
        ),
      ).rejects.toThrow('must equal captured database authority');
    }

    await expect(
      withCapturedAuthority(now, async (transaction) => {
        await transaction.query(
          `INSERT INTO founding_household_operations(
             operation_key, cohort_key, environment, operation_kind, request_digest,
             actor_person_id, result_reference, created_at
           ) VALUES ($1,$2,'local','policy',$3,$4,'3:1',$5)`,
          [
            operation('policy', 83),
            foundingHouseholdCohortKey,
            'P'.repeat(43),
            founderPersonId,
            now.toISOString(),
          ],
        );
        await transaction.query(
          `INSERT INTO founding_household_policy_versions(
             cohort_key, environment, revision, state, benefit_key, max_households,
             invitation_ttl_days, access_duration_days, program_ends_at,
             changed_by_person_id, operation_key, created_at
           ) VALUES ($1,'local',3,'disabled',NULL,NULL,NULL,NULL,NULL,$2,$3,$4)`,
          [
            foundingHouseholdCohortKey,
            founderPersonId,
            operation('policy', 83),
            new Date(now.getTime() + 1).toISOString(),
          ],
        );
      }),
    ).rejects.toThrow('policy time must equal captured database authority');

    const equivalentUtc = new Date('2026-08-17T05:00:00-07:00');
    await expect(
      withCapturedAuthority(equivalentUtc, async (transaction) => {
        await transaction.query(
          `INSERT INTO founding_household_operations(
             operation_key, cohort_key, environment, operation_kind, request_digest,
             actor_person_id, result_reference, created_at
           ) VALUES ($1,$2,'local','invite',$3,$4,'utc-equivalent-invite',$5)`,
          [
            operation('invite', 87),
            foundingHouseholdCohortKey,
            'V'.repeat(43),
            founderPersonId,
            now.toISOString(),
          ],
        );
        throw new Error('rollback after exact UTC-equivalent authority assertion');
      }),
    ).rejects.toThrow('rollback after exact UTC-equivalent authority assertion');

    await expect(
      withCapturedAuthority(now, async (transaction) => {
        await transaction.query(
          `INSERT INTO founding_household_operations(
             operation_key, cohort_key, environment, operation_kind, request_digest,
             actor_person_id, result_reference, created_at
           ) VALUES ($1,$2,'local','invite',$3,$4,'wrong-ttl-invite',$5)`,
          [
            operation('invite', 88),
            foundingHouseholdCohortKey,
            'W'.repeat(43),
            founderPersonId,
            now.toISOString(),
          ],
        );
        await transaction.query(
          `INSERT INTO founding_household_invitations(
             id, cohort_key, environment, policy_revision, benefit_key,
             access_duration_days, program_ends_at, credential_fingerprint,
             fingerprint_key_version, state, created_by_person_id, operation_key,
             expires_at, created_at, ended_at
           ) VALUES ('wrong-ttl-invite',$1,'local',2,'family_beta_v1',30,$2,$3,1,
                     'pending',$4,$5,$6,$7,NULL)`,
          [
            foundingHouseholdCohortKey,
            '2026-10-01T00:00:00.000Z',
            'X'.repeat(43),
            founderPersonId,
            operation('invite', 88),
            new Date(now.getTime() + 86_400_000).toISOString(),
            now.toISOString(),
          ],
        );
      }),
    ).rejects.toThrow('expiry must match the finite policy bound');

    const transitionAt = new Date(now.getTime() + 1_000);
    await expect(
      withCapturedAuthority(transitionAt, async (transaction) => {
        await transaction.query(
          `INSERT INTO founding_household_operations(
             operation_key, cohort_key, environment, operation_kind, request_digest,
             actor_person_id, result_reference, created_at
           ) VALUES ($1,$2,'local','invite_revoke',$3,$4,$5,$6)`,
          [
            operation('invite-revoke', 89),
            foundingHouseholdCohortKey,
            'Y'.repeat(43),
            founderPersonId,
            invitation.invitation.id,
            transitionAt.toISOString(),
          ],
        );
        await transaction.query(
          `UPDATE founding_household_invitations
           SET state = 'revoked', credential_fingerprint = NULL, ended_at = $2,
               terminal_operation_key = $3
           WHERE id = $1`,
          [
            invitation.invitation.id,
            new Date(transitionAt.getTime() + 1).toISOString(),
            operation('invite-revoke', 89),
          ],
        );
      }),
    ).rejects.toThrow('must equal captured database authority');
  });

  it('rejects raw enrollment duration extension and partial offboarding transitions', async () => {
    await activatePolicy();
    const invitation = await createInvitation();
    const acceptanceAt = new Date(now.getTime() + 1_000);
    await expect(
      withCapturedAuthority(acceptanceAt, async (transaction) => {
        await transaction.query(
          `INSERT INTO founding_household_operations(
             operation_key, cohort_key, environment, operation_kind, request_digest,
             actor_person_id, result_reference, created_at
           ) VALUES ($1,$2,'local','accept',$3,$4,'direct-long-enrollment',$5)`,
          [
            operation('accept', 90),
            foundingHouseholdCohortKey,
            'G'.repeat(43),
            bobAccess.actorPersonId,
            acceptanceAt.toISOString(),
          ],
        );
        await transaction.query(
          `INSERT INTO founding_household_enrollments(
             household_id, id, cohort_key, environment, policy_revision, invitation_id,
             benefit_key, plan_version_id, sponsorship_id, sponsorship_allocation_id,
             subscription_id, entitlement_grant_id, service_consent_id,
             protected_enrollment_created, accepted_by_person_id, accepted_session_id,
             accepted_identity_id, accepted_identity_issuer, accepted_identity_subject,
             state, evidence_tier, operation_key, starts_at, ends_at, created_at
           ) VALUES (
             'household-harbor','direct-long-enrollment',$1,'local',2,$2,
             'family_beta_v1','founding_family_beta_v2','missing-sponsorship',
             'missing-allocation','missing-subscription','missing-grant','missing-consent',
             false,$3,$4,'identity-owner-bob','boomerbuddy-dev','owner-bob',
             'active','local_simulation',$5,$6,$7,$6
           )`,
          [
            foundingHouseholdCohortKey,
            invitation.invitation.id,
            bobAccess.actorPersonId,
            bobAccess.sessionId,
            operation('accept', 90),
            acceptanceAt.toISOString(),
            '2026-10-01T00:00:00.000Z',
          ],
        );
      }),
    ).rejects.toThrow('enrollment end must match invitation and sponsor bounds');

    const accepted = await acceptBob(invitation);
    const offboardAt = new Date(now.getTime() + 2_000);
    await expect(
      withCapturedAuthority(offboardAt, async (transaction) => {
        await transaction.query(
          `INSERT INTO founding_household_operations(
             operation_key, cohort_key, environment, operation_kind, request_digest,
             actor_person_id, result_reference, created_at
           ) VALUES ($1,$2,'local','offboard',$3,$4,$5,$6)`,
          [
            operation('offboard', 91),
            foundingHouseholdCohortKey,
            'H'.repeat(43),
            founderPersonId,
            `${accepted.enrollment.id}:0:0`,
            offboardAt.toISOString(),
          ],
        );
        await transaction.query(
          `UPDATE founding_household_enrollments
           SET state = 'revoked', revoked_at = $2, revoked_by_person_id = $3,
               revoked_reason = 'founder_revoked', revocation_operation_key = $4
           WHERE id = $1`,
          [
            accepted.enrollment.id,
            offboardAt.toISOString(),
            founderPersonId,
            operation('offboard', 91),
          ],
        );
      }),
    ).rejects.toThrow('requires the exact sponsor chain closed first');

    const enrollmentState = await database.query<{ state: string } & Record<string, unknown>>(
      `SELECT state FROM founding_household_enrollments WHERE id = $1`,
      [accepted.enrollment.id],
    );
    const localEntitlement = await new EntitlementRepository(
      database,
      undefined,
      'local',
    ).forHousehold('household-harbor', offboardAt);
    expect(enrollmentState.rows).toEqual([{ state: 'active' }]);
    expect(localEntitlement.portfolio.accessState).toBe('effective');
  });

  it('requires one exact audit and outbox pair before a raw operation can commit', async () => {
    await activatePolicy();
    const invitation = await createInvitation();
    const transitionAt = new Date(now.getTime() + 1_000);

    await expect(
      withCapturedAuthority(transitionAt, async (transaction) => {
        await transaction.query(
          `INSERT INTO founding_household_operations(
             operation_key, cohort_key, environment, operation_kind, request_digest,
             actor_person_id, result_reference, created_at
           ) VALUES ($1,$2,'local','invite_revoke',$3,$4,$5,$6)`,
          [
            operation('invite-revoke', 70),
            foundingHouseholdCohortKey,
            'J'.repeat(43),
            founderPersonId,
            invitation.invitation.id,
            transitionAt.toISOString(),
          ],
        );
        await transaction.query(
          `UPDATE founding_household_invitations
           SET state = 'revoked', credential_fingerprint = NULL, ended_at = $2,
               terminal_operation_key = $3
           WHERE id = $1`,
          [invitation.invitation.id, transitionAt.toISOString(), operation('invite-revoke', 70)],
        );
      }),
    ).rejects.toThrow('requires one fresh operation-bound audit and outbox pair');

    const secondTransitionAt = new Date(now.getTime() + 2_000);
    await expect(
      withCapturedAuthority(secondTransitionAt, async (transaction) => {
        await transaction.query(
          `INSERT INTO founding_household_operations(
             operation_key, cohort_key, environment, operation_kind, request_digest,
             actor_person_id, result_reference, created_at
           ) VALUES ($1,$2,'local','invite_revoke',$3,$4,$5,$6)`,
          [
            operation('invite-revoke', 71),
            foundingHouseholdCohortKey,
            'K'.repeat(43),
            founderPersonId,
            invitation.invitation.id,
            secondTransitionAt.toISOString(),
          ],
        );
        await transaction.query(
          `UPDATE founding_household_invitations
           SET state = 'revoked', credential_fingerprint = NULL, ended_at = $2,
               terminal_operation_key = $3
           WHERE id = $1`,
          [
            invitation.invitation.id,
            secondTransitionAt.toISOString(),
            operation('invite-revoke', 71),
          ],
        );
        await insertDirectAuditAndOutbox(transaction, {
          suffix: 'founding-raw-wrong-time',
          actorPersonId: founderPersonId,
          action: 'founding_household.invitation_revoked',
          resourceType: 'founding_household_invitation',
          resourceId: invitation.invitation.id,
          eventType: 'founding_household.invitation_revoked.v1',
          aggregateType: 'founding_household_invitation',
          operationKey: operation('invite-revoke', 71),
          occurredAt: new Date(secondTransitionAt.getTime() + 1),
        });
      }),
    ).rejects.toThrow('requires one fresh operation-bound audit and outbox pair');

    const stored = await database.query<{ state: string } & Record<string, unknown>>(
      `SELECT state FROM founding_household_invitations WHERE id = $1`,
      [invitation.invitation.id],
    );
    expect(stored.rows).toEqual([{ state: 'pending' }]);
  });

  it('rejects a raw policy revision that leaves prior invitation credentials usable', async () => {
    await activatePolicy();
    const invitation = await createInvitation();
    const changedAt = new Date(now.getTime() + 1_000);

    await expect(
      withCapturedAuthority(changedAt, async (transaction) => {
        await transaction.query(
          `INSERT INTO founding_household_operations(
             operation_key, cohort_key, environment, operation_kind, request_digest,
             actor_person_id, result_reference, created_at
           ) VALUES ($1,$2,'local','policy',$3,$4,'3:1',$5)`,
          [
            operation('policy', 72),
            foundingHouseholdCohortKey,
            'L'.repeat(43),
            founderPersonId,
            changedAt.toISOString(),
          ],
        );
        await transaction.query(
          `INSERT INTO founding_household_policy_versions(
             cohort_key, environment, revision, state, benefit_key, max_households,
             invitation_ttl_days, access_duration_days, program_ends_at,
             changed_by_person_id, operation_key, created_at
           ) VALUES ($1,'local',3,'disabled',NULL,NULL,NULL,NULL,NULL,$2,$3,$4)`,
          [
            foundingHouseholdCohortKey,
            founderPersonId,
            operation('policy', 72),
            changedAt.toISOString(),
          ],
        );
        await insertDirectAuditAndOutbox(transaction, {
          suffix: 'founding-raw-policy-no-supersession',
          actorPersonId: founderPersonId,
          action: 'founding_household.policy_configured',
          resourceType: 'founding_household_program',
          resourceId: foundingHouseholdCohortKey,
          eventType: 'founding_household.policy_configured.v1',
          aggregateType: 'founding_household_program',
          operationKey: operation('policy', 72),
          occurredAt: changedAt,
        });
      }),
    ).rejects.toThrow('policy result does not match exact supersessions');

    const policy = await database.query<{ revision: number } & Record<string, unknown>>(
      `SELECT max(revision)::integer AS revision
       FROM founding_household_policy_versions WHERE environment = 'local'`,
    );
    const storedInvitation = await database.query<
      { state: string; credential_fingerprint: string | null } & Record<string, unknown>
    >(
      `SELECT state, credential_fingerprint
       FROM founding_household_invitations WHERE id = $1`,
      [invitation.invitation.id],
    );
    expect(policy.rows).toEqual([{ revision: 2 }]);
    expect(storedInvitation.rows[0]).toMatchObject({ state: 'pending' });
    expect(storedInvitation.rows[0]?.credential_fingerprint).not.toBeNull();
  });

  it('rejects raw acceptance without invitation zeroization and exact consent or chain times', async () => {
    await activatePolicy();
    const invitation = await createInvitation();

    let invitationTransitionSuppressed = false;
    const noInvitationTransition = repositoryWithQueryOverride((sql) => {
      if (
        sql.includes('UPDATE founding_household_invitations') &&
        sql.includes("SET state = 'accepted'")
      ) {
        invitationTransitionSuppressed = true;
        return { result: { rows: [], rowCount: 1 } };
      }
      return undefined;
    });
    await expect(acceptBobWith(noInvitationTransition, invitation, 73)).rejects.toThrow(
      'enrollment commit must accept and zeroize its invitation',
    );
    expect(invitationTransitionSuppressed).toBe(true);

    const divergent = new Date(now.getTime() + 1).toISOString();
    const timestampCases: readonly {
      readonly label: string;
      readonly error: string;
      readonly override: (
        sql: string,
        parameters: readonly unknown[] | undefined,
      ) => QueryOverride | undefined;
    }[] = [
      {
        label: 'service consent evidence effective and recorded time',
        error: 'purpose-limited service consent',
        override: (sql, parameters) => {
          if (
            sql.includes('INSERT INTO consent_evidence(') &&
            parameters?.[6] === 'founding_household_service_beta'
          ) {
            const changed = [...parameters];
            changed[19] = divergent;
            return { parameters: changed };
          }
          return undefined;
        },
      },
      {
        label: 'service consent projection effective and updated time',
        error: 'purpose-limited service consent',
        override: (sql, parameters) => {
          if (
            sql.includes('INSERT INTO consent_current_projections(') &&
            parameters?.[6] === 'founding_household_service_beta'
          ) {
            const changed = [...parameters];
            changed[9] = divergent;
            return { parameters: changed };
          }
          return undefined;
        },
      },
      {
        label: 'subscription update time',
        error: 'exact finite sponsor entitlement chain',
        override: (sql, parameters) => {
          if (sql.includes('INSERT INTO commerce_subscriptions(') && sql.includes("'sponsor'")) {
            return {
              sql: sql.replace("'not_required',$4,$4)", "'not_required',$4,$6)"),
              parameters: [...(parameters ?? []), divergent],
            };
          }
          return undefined;
        },
      },
      {
        label: 'sponsorship allocation creation time',
        error: 'exact finite sponsor entitlement chain',
        override: (sql, parameters) => {
          if (sql.includes('INSERT INTO commerce_sponsorship_allocations(')) {
            return {
              sql: sql.replace("'active',true,$6,$7,$6)", "'active',true,$6,$7,$8)"),
              parameters: [...(parameters ?? []), divergent],
            };
          }
          return undefined;
        },
      },
      {
        label: 'grant creation time',
        error: 'exact finite sponsor entitlement chain',
        override: (sql, parameters) => {
          if (sql.includes('INSERT INTO entitlement_grants(') && sql.includes("'sponsor'")) {
            return {
              sql: sql.replace('plan.id,$5,$6,$3', 'plan.id,$5,$6,$8'),
              parameters: [...(parameters ?? []), divergent],
            };
          }
          return undefined;
        },
      },
    ];

    for (const [index, testCase] of timestampCases.entries()) {
      let intercepted = false;
      const target = repositoryWithQueryOverride((sql, parameters) => {
        const replacement = testCase.override(sql, parameters);
        if (replacement !== undefined) intercepted = true;
        return replacement;
      });
      await expect(acceptBobWith(target, invitation, 74 + index), testCase.label).rejects.toThrow(
        testCase.error,
      );
      expect(intercepted, testCase.label).toBe(true);
    }
  });

  it('rejects raw offboarding that strands Founding allowances despite unrelated capacity', async () => {
    await activatePolicy();
    const invitation = await createInvitation();
    await acceptBob(invitation);
    await insertUnrelatedFamilyGrant('founding-raw-offboard');

    let suppressedRebindings = 0;
    const partialOffboard = repositoryWithQueryOverride((sql) => {
      if (
        sql.includes('UPDATE commerce_allowance_allocations') &&
        sql.includes('SET entitlement_grant_id = $3')
      ) {
        suppressedRebindings += 1;
        return { result: { rows: [], rowCount: 1 } };
      }
      return undefined;
    });
    await expect(
      partialOffboard.offboard({
        access: founderAccess,
        authority: 'founder',
        householdId: 'household-harbor',
        operationKey: operation('offboard', 79),
        now: new Date(now.getTime() + 1_000),
      }),
    ).rejects.toThrow('operation result_reference does not match completed domain result');
    expect(suppressedRebindings).toBeGreaterThan(0);

    const state = await database.query<
      { enrollment_state: string; active_old_allocations: number } & Record<string, unknown>
    >(
      `SELECT enrollment.state AS enrollment_state,
              count(allowance.id)::integer AS active_old_allocations
       FROM founding_household_enrollments enrollment
       LEFT JOIN commerce_allowance_allocations allowance
         ON allowance.household_id = enrollment.household_id
        AND allowance.entitlement_grant_id = enrollment.entitlement_grant_id
        AND allowance.state = 'active'
       WHERE enrollment.household_id = 'household-harbor'
       GROUP BY enrollment.state`,
    );
    expect(state.rows[0]?.enrollment_state).toBe('active');
    expect(state.rows[0]?.active_old_allocations).toBeGreaterThan(0);
  });

  it('preserves accepted invitation, operation, and enrollment history at the SQL boundary', async () => {
    await activatePolicy();
    const invitation = await createInvitation();
    const accepted = await acceptBob(invitation);
    await expect(
      database.query('DELETE FROM founding_household_enrollments WHERE id = $1', [
        accepted.enrollment.id,
      ]),
    ).rejects.toThrow('append-only');
    await expect(
      database.query(
        `UPDATE founding_household_enrollments SET ends_at = ends_at + interval '1 day'
         WHERE id = $1`,
        [accepted.enrollment.id],
      ),
    ).rejects.toThrow('immutable');
    await expect(
      database.query(
        `UPDATE founding_household_enrollments SET state = 'revoked'
         WHERE id = $1`,
        [accepted.enrollment.id],
      ),
    ).rejects.toThrow('Invalid Founding Household enrollment transition');
    await expect(
      database.query('DELETE FROM founding_household_operations WHERE operation_key = $1', [
        operation('accept', 3),
      ]),
    ).rejects.toThrow('append-only');
    await expect(
      database.query('DELETE FROM founding_household_invitations WHERE id = $1', [
        invitation.invitation.id,
      ]),
    ).rejects.toThrow('append-only');
  });

  it('derives only available privacy-bounded funnel facts and never fabricates missing outcomes', async () => {
    await activatePolicy();
    const invitation = await createInvitation();
    const accepted = await acceptBob(invitation);
    const record = await repository.memberStatus({
      access: bobAccess,
      householdId: 'household-harbor',
      now: new Date(now.getTime() + 25 * 60 * 60_000),
    });
    expect(
      record?.funnel.map(({ stage, state, evidenceSource }) => ({
        stage,
        state,
        evidenceSource,
      })),
    ).toEqual([
      { stage: 'account_ready', state: 'observed', evidenceSource: 'active_identity' },
      {
        stage: 'founding_household_accepted',
        state: 'observed',
        evidenceSource: 'cohort_enrollment',
      },
      { stage: 'orientation_ready', state: 'not_observed', evidenceSource: 'orientation_state' },
      {
        stage: 'first_check_completed',
        state: 'not_observed',
        evidenceSource: 'completed_analysis',
      },
      {
        stage: 'result_comprehension_confirmed',
        state: 'not_observed',
        evidenceSource: 'not_implemented',
      },
      {
        stage: 'safe_next_action_confirmed',
        state: 'not_observed',
        evidenceSource: 'not_implemented',
      },
      {
        stage: 'trusted_circle_established',
        state: 'not_observed',
        evidenceSource: 'trusted_circle_relationship',
      },
      {
        stage: 'service_value_confirmed',
        state: 'not_observed',
        evidenceSource: 'not_implemented',
      },
      { stage: 'feedback_submitted', state: 'not_observed', evidenceSource: 'feedback_record' },
      { stage: 'returned_later', state: 'not_observed', evidenceSource: 'later_session' },
    ]);

    const feedbackAt = new Date(now.getTime() + 60 * 60_000);
    await feedbackRepository(database).createAuthenticated({
      householdId: 'household-harbor',
      actorPersonId: 'person-owner-bob',
      request: feedbackRequest(
        77,
        'The sponsored beta navigation was clear enough to complete the task.',
      ),
      correlationId: 'correlation:founding-feedback',
      now: feedbackAt,
    });
    const withFeedback = await repository.memberStatus({
      access: bobAccess,
      householdId: 'household-harbor',
      now: new Date(feedbackAt.getTime() + 1),
    });
    expect(withFeedback?.funnel.find(({ stage }) => stage === 'feedback_submitted')).toEqual({
      stage: 'feedback_submitted',
      state: 'observed',
      evidenceSource: 'feedback_record',
      observedAt: feedbackAt,
    });
    expect(JSON.stringify(record)).not.toMatch(
      /Harbor Household|Bob Owner|analysis-seed|submitted_content|message_body/iu,
    );
    expect(accepted.enrollment.id).toBe(record?.id);
  });

  it('stops cohort attribution at withdrawal even when unrelated access remains active', async () => {
    await activatePolicy();
    const invitation = await createInvitation();
    await acceptBob(invitation);
    const withdrawnAt = new Date(now.getTime() + 1_000);
    await repository.offboard({
      access: bobAccess,
      authority: 'household',
      householdId: 'household-harbor',
      operationKey: operation('offboard', 69),
      now: withdrawnAt,
    });
    const postWithdrawal = new Date(withdrawnAt.getTime() + 1_000);
    await database.query(
      `INSERT INTO orientation_states(
         household_id, person_id, status, completed_steps, safe_word_disposition,
         needs_attention, version, updated_at
       ) VALUES (
         'household-harbor','person-owner-bob','ready','[]'::jsonb,
         'informed_deferral',false,1,$1
       )`,
      [postWithdrawal.toISOString()],
    );
    await feedbackRepository(database).createAuthenticated({
      householdId: 'household-harbor',
      actorPersonId: 'person-owner-bob',
      request: feedbackRequest(
        79,
        'This feedback happened after I ended the Founding Household cohort.',
      ),
      correlationId: 'correlation:founding-post-withdrawal-feedback',
      now: postWithdrawal,
    });
    const returnAt = new Date(now.getTime() + 25 * 60 * 60_000);
    await new SessionRepository(database, {
      next: () => 'session-founding-post-withdrawal',
    }).create({
      personId: 'person-owner-bob',
      audience: 'customer',
      issuedAt: returnAt,
      expiresAt: new Date(returnAt.getTime() + 86_400_000),
    });
    const status = await repository.memberStatus({
      access: bobAccess,
      householdId: 'household-harbor',
      now: new Date(returnAt.getTime() + 1),
    });

    expect(status).toMatchObject({ state: 'revoked', ledgerState: 'revoked' });
    for (const stage of ['orientation_ready', 'feedback_submitted', 'returned_later'] as const) {
      expect(status?.funnel.find((milestone) => milestone.stage === stage)).toMatchObject({
        state: 'not_observed',
      });
    }
  });

  it('excludes incomplete, unsafe, anonymous, and out-of-window feedback from the funnel', async () => {
    await activatePolicy();
    const invitation = await createInvitation();
    const accepted = await acceptBob(invitation);
    const feedback = feedbackRepository(database);
    const inWindow = new Date(now.getTime() + 60 * 60_000);

    await database.query(
      `INSERT INTO feedback_records(
         id, schema_version, identity_mode, household_id, actor_person_id, source_surface,
         app_version, build_version, locale, device_class, feedback_type, linked_object_type,
         linked_object_id, linkage_consent_version, origin_interaction_id, correlation_id,
         evidence_tier, created_at
       ) VALUES (
         'feedback-founding-incomplete',1,'authenticated','household-harbor',
         'person-owner-bob','in_app_contextual',NULL,NULL,NULL,'desktop','product_feedback',
         NULL,NULL,NULL,NULL,'correlation:founding-incomplete','local_simulation',$1
       )`,
      [inWindow.toISOString()],
    );
    const credentialLikeMarker = ['ghp', '_', 'A'.repeat(24)].join('');
    const unsafe = await feedback.createAuthenticated({
      householdId: 'household-harbor',
      actorPersonId: 'person-owner-bob',
      request: feedbackRequest(
        78,
        `The form unexpectedly displayed ${credentialLikeMarker} beside the primary action.`,
      ),
      correlationId: 'correlation:founding-unsafe-feedback',
      now: new Date(inWindow.getTime() + 1_000),
    });
    expect(unsafe.status).toBe('unsafe_unprocessable');
    await feedback.createAnonymous({
      networkAddress: '192.0.2.44',
      request: {
        ...feedbackRequest(79, 'The anonymous local feedback path was visible.'),
        source: { surface: 'web_feedback_form', deviceClass: 'desktop' },
      },
      correlationId: 'correlation:founding-anonymous-feedback',
      now: new Date(inWindow.getTime() + 2_000),
    });
    const outsideWindow = new Date(accepted.enrollment.endsAt.getTime() + 1);
    await feedback.createAuthenticated({
      householdId: 'household-harbor',
      actorPersonId: 'person-owner-bob',
      request: feedbackRequest(80, 'This safe feedback occurred after sponsored access ended.'),
      correlationId: 'correlation:founding-late-feedback',
      now: outsideWindow,
    });

    const record = await repository.memberStatus({
      access: bobAccess,
      householdId: 'household-harbor',
      now: new Date(outsideWindow.getTime() + 1),
    });
    expect(record?.funnel.find(({ stage }) => stage === 'feedback_submitted')).toEqual({
      stage: 'feedback_submitted',
      state: 'not_observed',
      evidenceSource: 'feedback_record',
    });
  });
});
