import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  foundingHouseholdProtectedEnrollmentConsentVersion,
  foundingHouseholdServiceConsentVersion,
} from '@boomerbuddy/domain';
import { createSeededTestDatabase } from '@boomerbuddy/testkit';

import type { Database } from './database';
import {
  FoundingHouseholdRepository,
  foundingHouseholdProtectedDocuments,
  foundingHouseholdServiceDocuments,
} from './founding-households';
import { SessionRepository } from './sessions';
import {
  maximumMobileJtiSessionCleanupLimit,
  MobileJtiSessionRetentionRepository,
} from './session-retention';
import type { IdFactory } from './values';

const baseNow = new Date('2026-08-17T12:00:00.000Z');
const observedAt = new Date('2026-08-20T12:00:00.000Z');

function sequentialIds(label: string): IdFactory {
  let sequence = 0;
  return { next: (prefix) => `${prefix}-retention-${label}-${++sequence}` };
}

async function insertSession(
  database: Database,
  input: {
    readonly id: string;
    readonly providerSessionId: string;
    readonly expiresAt: Date;
    readonly audience?: 'customer' | 'mobile';
  },
): Promise<void> {
  await database.query(
    `INSERT INTO sessions(
       id, person_id, audience, issuer, issued_at, expires_at,
       identity_id, identity_subject, provider_session_id, last_verified_at
     ) VALUES (
       $1,'person-owner-alice',$2,'boomerbuddy-dev',$3,$4,
       'identity-owner-alice','owner-alice',$5,$3
     )`,
    [
      input.id,
      input.audience ?? 'mobile',
      new Date(input.expiresAt.getTime() - 60_000).toISOString(),
      input.expiresAt.toISOString(),
      input.providerSessionId,
    ],
  );
}

describe('mobile JTI session retention', () => {
  let database: Database;

  beforeEach(async () => {
    database = await createSeededTestDatabase(baseNow);
  });

  afterEach(async () => database.close());

  it('migrates the candidate and evidence-reference indexes and inventories every session FK', async () => {
    const migrations = await database.query<{ readonly count: number } & Record<string, unknown>>(
      `SELECT count(*)::integer AS count FROM schema_migrations
       WHERE version = '0031_run3_1_mobile_session_retention.sql'`,
    );
    expect(migrations.rows).toEqual([{ count: 1 }]);

    const indexes = await database.query<{ readonly indexname: string } & Record<string, unknown>>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname IN (
           'sessions_mobile_jti_retention_idx',
           'consent_evidence_session_retention_idx',
           'founding_household_enrollments_session_retention_idx',
           'household_billing_authority_events_session_retention_idx'
         )
       ORDER BY indexname`,
    );
    expect(indexes.rows).toEqual([
      { indexname: 'consent_evidence_session_retention_idx' },
      { indexname: 'founding_household_enrollments_session_retention_idx' },
      { indexname: 'household_billing_authority_events_session_retention_idx' },
      { indexname: 'sessions_mobile_jti_retention_idx' },
    ]);

    const references = await database.query<
      {
        readonly source_table: string;
        readonly source_column: string;
        readonly target_column: string;
        readonly key_position: number;
      } & Record<string, unknown>
    >(
      `SELECT source.relname AS source_table,
              source_attribute.attname AS source_column,
              target_attribute.attname AS target_column,
              source_key.ordinality::integer AS key_position
       FROM pg_constraint constraint_record
       JOIN pg_class source ON source.oid = constraint_record.conrelid
       JOIN LATERAL unnest(constraint_record.conkey) WITH ORDINALITY
         AS source_key(attribute_number, ordinality) ON true
       JOIN LATERAL unnest(constraint_record.confkey) WITH ORDINALITY
         AS target_key(attribute_number, ordinality)
         ON target_key.ordinality = source_key.ordinality
       JOIN pg_attribute source_attribute
         ON source_attribute.attrelid = constraint_record.conrelid
        AND source_attribute.attnum = source_key.attribute_number
       JOIN pg_attribute target_attribute
         ON target_attribute.attrelid = constraint_record.confrelid
        AND target_attribute.attnum = target_key.attribute_number
       WHERE constraint_record.contype = 'f'
         AND constraint_record.confrelid = 'sessions'::regclass
       ORDER BY source.relname, constraint_record.conname, source_key.ordinality`,
    );
    expect(references.rows).toEqual([
      {
        source_table: 'consent_evidence',
        source_column: 'session_id',
        target_column: 'id',
        key_position: 1,
      },
      {
        source_table: 'founding_household_enrollments',
        source_column: 'accepted_session_id',
        target_column: 'id',
        key_position: 1,
      },
      {
        source_table: 'household_billing_authority_events',
        source_column: 'actor_session_id',
        target_column: 'id',
        key_position: 1,
      },
      {
        source_table: 'provider_session_revocations',
        source_column: 'session_id',
        target_column: 'id',
        key_position: 1,
      },
      {
        source_table: 'provider_session_revocations',
        source_column: 'issuer',
        target_column: 'issuer',
        key_position: 2,
      },
      {
        source_table: 'provider_session_revocations',
        source_column: 'provider_session_id',
        target_column: 'provider_session_id',
        key_position: 3,
      },
      {
        source_table: 'provider_session_revocations',
        source_column: 'identity_id',
        target_column: 'identity_id',
        key_position: 4,
      },
    ]);
  });

  it('deletes only the oldest eligible rows within a bounded batch', async () => {
    await insertSession(database, {
      id: 'session-mobile-eligible-oldest',
      providerSessionId: 'jti-mobile-eligible-oldest',
      expiresAt: new Date('2026-08-17T13:00:00.000Z'),
    });
    await insertSession(database, {
      id: 'session-mobile-consent-evidence',
      providerSessionId: 'jti-mobile-consent-evidence',
      expiresAt: new Date('2026-08-17T14:00:00.000Z'),
    });
    await insertSession(database, {
      id: 'session-mobile-revoked',
      providerSessionId: 'jti-mobile-revoked',
      expiresAt: new Date('2026-08-17T15:00:00.000Z'),
    });
    await insertSession(database, {
      id: 'session-mobile-eligible-newer',
      providerSessionId: 'jti-mobile-eligible-newer',
      expiresAt: new Date('2026-08-18T12:00:00.000Z'),
    });
    await insertSession(database, {
      id: 'session-mobile-expired-in-grace',
      providerSessionId: 'jti-mobile-expired-in-grace',
      expiresAt: new Date('2026-08-20T06:00:00.000Z'),
    });
    await insertSession(database, {
      id: 'session-mobile-active',
      providerSessionId: 'jti-mobile-active',
      expiresAt: new Date('2026-08-21T12:00:00.000Z'),
    });
    await insertSession(database, {
      id: 'session-customer-expired',
      providerSessionId: 'jti-customer-expired',
      expiresAt: new Date('2026-08-17T12:30:00.000Z'),
      audience: 'customer',
    });
    await insertSession(database, {
      id: 'session-mobile-local-marker',
      providerSessionId: 'session-mobile-local-marker',
      expiresAt: new Date('2026-08-17T12:30:00.000Z'),
    });

    await database.query(
      `INSERT INTO consents(
         household_id, id, protected_person_id, granted_by_person_id,
         purpose, consent_version, state, granted_at
       ) VALUES (
         'household-sunrise','consent-mobile-retention','person-owner-alice',
         'person-owner-alice','service_access','mobile-retention-v1','active',$1
       )`,
      [baseNow.toISOString()],
    );
    await database.query(
      `INSERT INTO consent_evidence(
         household_id, id, consent_id, actor_person_id, subject_person_id,
         recipient_person_id, purpose, scope, action, disclosure_version,
         disclosure_digest, policy_version, policy_digest, source_interaction,
         session_id, actor_identity_id, actor_identity_issuer, actor_identity_subject,
         assurance, effective_at, recorded_at
       ) VALUES (
         'household-sunrise','evidence-mobile-retention','consent-mobile-retention',
         'person-owner-alice','person-owner-alice',NULL,'service_access','{}'::jsonb,
         'accept','mobile-retention-disclosure-v1',repeat('1',64),
         'mobile-retention-policy-v1',repeat('2',64),'mobile_retention_test',
         'session-mobile-consent-evidence','identity-owner-alice','boomerbuddy-dev',
         'owner-alice','development',$1,$1
       )`,
      [baseNow.toISOString()],
    );
    await database.query(
      `INSERT INTO provider_session_revocations(
         issuer, provider_session_id, identity_id, session_id, revoked_at, reason
       ) VALUES (
         'boomerbuddy-dev','jti-mobile-revoked','identity-owner-alice',
         'session-mobile-revoked',$1,'local_logout'
       )`,
      [baseNow.toISOString()],
    );

    const retention = new MobileJtiSessionRetentionRepository(database);
    await expect(retention.monitor(observedAt)).resolves.toMatchObject({
      observedAt,
      cleanupEligibleBefore: new Date('2026-08-19T12:00:00.000Z'),
      totalSessionCount: 6,
      expiredSessionCount: 5,
      retainedInGraceCount: 1,
      cleanupEligibleCount: 2,
      evidenceProtectedCount: 1,
      consentEvidenceProtectedCount: 1,
      foundingHouseholdEvidenceProtectedCount: 0,
      revocationProtectedCount: 1,
      oldestCleanupEligibleExpiresAt: new Date('2026-08-17T13:00:00.000Z'),
    });

    await expect(retention.cleanup({ now: observedAt, limit: 1 })).resolves.toMatchObject({
      requestedLimit: 1,
      deletedCount: 1,
      remainingEligibleCount: 1,
      oldestDeletedExpiresAt: new Date('2026-08-17T13:00:00.000Z'),
      newestDeletedExpiresAt: new Date('2026-08-17T13:00:00.000Z'),
    });
    await expect(retention.cleanup({ now: observedAt, limit: 10 })).resolves.toMatchObject({
      requestedLimit: 10,
      deletedCount: 1,
      remainingEligibleCount: 0,
      oldestDeletedExpiresAt: new Date('2026-08-18T12:00:00.000Z'),
      newestDeletedExpiresAt: new Date('2026-08-18T12:00:00.000Z'),
    });

    const remaining = await database.query<{ readonly id: string } & Record<string, unknown>>(
      `SELECT id FROM sessions
       WHERE id LIKE 'session-mobile-%' OR id = 'session-customer-expired'
       ORDER BY id`,
    );
    expect(remaining.rows).toEqual([
      { id: 'session-customer-expired' },
      { id: 'session-mobile-active' },
      { id: 'session-mobile-consent-evidence' },
      { id: 'session-mobile-expired-in-grace' },
      { id: 'session-mobile-local-marker' },
      { id: 'session-mobile-revoked' },
    ]);
    await expect(
      database.query(
        `SELECT 1 FROM consent_evidence
         WHERE session_id = 'session-mobile-consent-evidence'`,
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      database.query(
        `SELECT 1 FROM provider_session_revocations
         WHERE session_id = 'session-mobile-revoked'`,
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('preserves a mobile session referenced by founding-household evidence', async () => {
    const founding = new FoundingHouseholdRepository(
      database,
      Buffer.alloc(32, 31),
      1,
      'person-hq-heidi',
      'local',
      sequentialIds('founding'),
      async (_transaction, now) => new Date(now),
    );
    const founderAccess = {
      actorPersonId: 'person-hq-heidi',
      correlationId: 'correlation:mobile-retention-founder',
    } as const;
    await founding.configurePolicy({
      access: founderAccess,
      operationKey: 'founding-policy:00000000-0000-4000-8000-000000000031',
      expectedRevision: 1,
      state: 'active',
      benefitKey: 'family_beta_v1',
      maxHouseholds: 1,
      invitationTtlDays: 7,
      accessDurationDays: 30,
      programEndsAt: new Date('2026-10-01T00:00:00.000Z'),
      now: baseNow,
    });
    const invitation = await founding.createInvitation({
      access: founderAccess,
      operationKey: 'founding-invite:00000000-0000-4000-8000-000000000031',
      now: baseNow,
    });
    if (invitation.invitationCredential === undefined) {
      throw new Error('Expected a local invitation credential');
    }

    const session = await new SessionRepository(
      database,
      sequentialIds('session'),
    ).resolveProviderSession({
      identityId: 'identity-owner-bob',
      personId: 'person-owner-bob',
      issuer: 'boomerbuddy-dev',
      subject: 'owner-bob',
      providerSessionId: 'jti-mobile-founding-evidence',
      audience: 'mobile',
      issuedAt: new Date(baseNow.getTime() - 1_000),
      expiresAt: new Date(baseNow.getTime() + 60_000),
      now: baseNow,
    });
    if (session === null) throw new Error('Expected a mobile provider session');
    const accepted = await founding.acceptInvitation({
      access: {
        actorPersonId: 'person-owner-bob',
        actorIssuer: session.issuer,
        actorIdentityId: session.identityId,
        actorIdentitySubject: session.identitySubject,
        sessionId: session.principal.sessionId,
        audience: 'mobile',
        correlationId: 'correlation:mobile-retention-accept',
      },
      householdId: 'household-harbor',
      invitationId: invitation.invitation.id,
      invitationCredential: invitation.invitationCredential,
      operationKey: 'founding-accept:00000000-0000-4000-8000-000000000031',
      serviceConsentVersion: foundingHouseholdServiceConsentVersion,
      serviceDisclosureDigest: foundingHouseholdServiceDocuments.disclosureDigest,
      servicePolicyDigest: foundingHouseholdServiceDocuments.policyDigest,
      protectedEnrollmentConsentVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
      protectedEnrollmentDisclosureDigest: foundingHouseholdProtectedDocuments.disclosureDigest,
      protectedEnrollmentPolicyDigest: foundingHouseholdProtectedDocuments.policyDigest,
      now: baseNow,
    });

    const retention = new MobileJtiSessionRetentionRepository(database);
    await expect(retention.monitor(observedAt)).resolves.toMatchObject({
      totalSessionCount: 1,
      expiredSessionCount: 1,
      cleanupEligibleCount: 0,
      evidenceProtectedCount: 1,
      consentEvidenceProtectedCount: 1,
      foundingHouseholdEvidenceProtectedCount: 1,
      revocationProtectedCount: 0,
    });
    await expect(retention.cleanup({ now: observedAt })).resolves.toMatchObject({
      deletedCount: 0,
      remainingEligibleCount: 0,
    });

    await expect(
      database.query('SELECT 1 FROM sessions WHERE id = $1', [session.principal.sessionId]),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      database.query(
        `SELECT 1 FROM founding_household_enrollments
         WHERE id = $1 AND accepted_session_id = $2`,
        [accepted.enrollment.id, session.principal.sessionId],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('rejects invalid observation times and unbounded cleanup requests', async () => {
    const retention = new MobileJtiSessionRetentionRepository(database);
    await expect(retention.monitor(new Date(Number.NaN))).rejects.toThrow(
      'requires a valid observation time',
    );
    await expect(
      retention.cleanup({ now: observedAt, limit: maximumMobileJtiSessionCleanupLimit + 1 }),
    ).rejects.toThrow('must be an integer between 1 and 1000');
    await expect(retention.cleanup({ now: observedAt, limit: 0 })).rejects.toThrow(
      'must be an integer between 1 and 1000',
    );
  });
});
