import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  foundingHouseholdCohortKey,
  foundingHouseholdProtectedEnrollmentConsentVersion,
  foundingHouseholdServiceConsentVersion,
} from '@boomerbuddy/domain';
import { createSeededTestDatabase } from '@boomerbuddy/testkit';

import { createPGliteDatabase, type Database, type SqlExecutor } from './database';
import { EntitlementRepository } from './entitlements';
import {
  foundingHouseholdDefinitionDigest,
  foundingHouseholdLegacyDefinitionDigest,
  foundingHouseholdProtectedDocuments,
  FoundingHouseholdRepository,
  foundingHouseholdServiceDocuments,
} from './founding-households';
import { migrationDirectory, runMigrations } from './migrations';
import { SessionRepository } from './sessions';
import type { IdFactory } from './values';

const now = new Date('2026-08-17T12:00:00.000Z');
const founderPersonId = 'person-hq-heidi';

function operation(
  kind: 'policy' | 'invite' | 'accept' | 'invite-revoke' | 'offboard',
  sequence: number,
): string {
  return `founding-${kind}:00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function sequentialIds(): IdFactory {
  let sequence = 0;
  return { next: (prefix) => `${prefix}-founding-migration-${++sequence}` };
}

async function withCapturedAuthority<T>(
  target: Database,
  capturedAt: Date,
  callback: (transaction: SqlExecutor) => Promise<T>,
): Promise<T> {
  return target.transaction(async (transaction) => {
    await transaction.query(
      `SELECT set_config('boomerbuddy.founding_household_test_now',$1,true) AS configured`,
      [capturedAt.toISOString()],
    );
    await transaction.query('SELECT capture_founding_household_authority_now()');
    return callback(transaction);
  });
}

async function foundingFixture(
  target: Database,
  accept: boolean,
): Promise<{
  readonly repository: FoundingHouseholdRepository;
  readonly invitationId: string;
  readonly invitationCredential: string;
  readonly memberSessionId: string;
  readonly enrollmentId?: string;
}> {
  const ids = sequentialIds();
  const repository = new FoundingHouseholdRepository(
    target,
    Buffer.alloc(32, 31),
    1,
    founderPersonId,
    'local',
    ids,
    async (_transaction, observedAt) => new Date(observedAt),
  );
  const memberSessionId = await new SessionRepository(target, ids).create({
    personId: 'person-owner-bob',
    audience: 'customer',
    issuedAt: now,
    expiresAt: new Date(now.getTime() + 180 * 86_400_000),
  });
  await repository.configurePolicy({
    access: {
      actorPersonId: founderPersonId,
      correlationId: 'correlation:founding-migration-founder',
    },
    operationKey: operation('policy', 1),
    expectedRevision: 1,
    state: 'active',
    benefitKey: 'family_beta_v1',
    maxHouseholds: 2,
    invitationTtlDays: 7,
    accessDurationDays: 30,
    programEndsAt: new Date('2026-10-01T00:00:00.000Z'),
    now,
  });
  const invitation = await repository.createInvitation({
    access: {
      actorPersonId: founderPersonId,
      correlationId: 'correlation:founding-migration-founder',
    },
    operationKey: operation('invite', 2),
    now,
  });
  if (invitation.invitationCredential === undefined) {
    throw new Error('Expected local invitation credential');
  }
  if (!accept) {
    return {
      repository,
      invitationId: invitation.invitation.id,
      invitationCredential: invitation.invitationCredential,
      memberSessionId,
    };
  }
  const accepted = await repository.acceptInvitation({
    access: {
      actorPersonId: 'person-owner-bob',
      actorIssuer: 'boomerbuddy-dev',
      sessionId: memberSessionId,
      audience: 'customer',
      correlationId: 'correlation:founding-migration-member',
    },
    householdId: 'household-harbor',
    invitationId: invitation.invitation.id,
    invitationCredential: invitation.invitationCredential,
    operationKey: operation('accept', 3),
    serviceConsentVersion: foundingHouseholdServiceConsentVersion,
    serviceDisclosureDigest: foundingHouseholdServiceDocuments.disclosureDigest,
    servicePolicyDigest: foundingHouseholdServiceDocuments.policyDigest,
    protectedEnrollmentConsentVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
    protectedEnrollmentDisclosureDigest: foundingHouseholdProtectedDocuments.disclosureDigest,
    protectedEnrollmentPolicyDigest: foundingHouseholdProtectedDocuments.policyDigest,
    now,
  });
  return {
    repository,
    invitationId: invitation.invitation.id,
    invitationCredential: invitation.invitationCredential,
    memberSessionId,
    enrollmentId: accepted.enrollment.id,
  };
}

async function copyMigrationsThrough(
  sourceDirectory: string,
  targetDirectory: string,
  lastFile: string,
): Promise<void> {
  const files = (await readdir(sourceDirectory))
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file) && file <= lastFile)
    .sort((left, right) => left.localeCompare(right));
  for (const file of files) {
    await copyFile(join(sourceDirectory, file), join(targetDirectory, file));
  }
}

async function insertPreexistingFoundingCatalogue(
  target: Database,
  input: { readonly wrongProduct?: boolean; readonly wrongPlan?: boolean } = {},
): Promise<void> {
  const createdAt = '2026-08-10T00:00:00.000Z';
  await target.query(
    `INSERT INTO commerce_product_versions(
       id, product_key, version, display_name, available_from, created_at
     ) VALUES ('consumer_household_v1','consumer_household',1,$1,
       '2026-08-15T00:00:00.000Z',$2)`,
    [
      input.wrongProduct ? 'Conflicting household product' : 'BoomerBuddy household protection',
      createdAt,
    ],
  );
  if (input.wrongProduct) return;
  await target.query(
    `INSERT INTO commerce_plan_versions(
       id, product_version_id, plan_key, version, display_name, state,
       capabilities, allowances, prices, available_from, created_at
     ) VALUES
       ('founding_plus_beta_v2','consumer_household_v1','plus',2,
        'Founding Plus beta sponsor benefit','active',$1::jsonb,$2::jsonb,$3::jsonb,
        '2026-08-16T00:00:00.000Z',$4),
       ('founding_family_beta_v2','consumer_household_v1','family',2,
        'Founding Family beta sponsor benefit','active',$5::jsonb,$6::jsonb,$3::jsonb,
        '2026-08-16T00:00:00.000Z',$4)`,
    [
      JSON.stringify(
        input.wrongPlan
          ? []
          : ['check:text', 'check:url', 'history:read', 'family:manage', 'orientation:use'],
      ),
      JSON.stringify([
        { kind: 'protected_members', limit: 1 },
        { kind: 'trusted_circle_participants', limit: 2 },
      ]),
      JSON.stringify([
        { interval: 'month', amountMinor: 0, currency: 'USD', kind: 'founding_experiment' },
      ]),
      createdAt,
      JSON.stringify([
        'check:text',
        'check:url',
        'history:read',
        'family:manage',
        'orientation:use',
      ]),
      JSON.stringify([
        { kind: 'protected_members', limit: 3 },
        { kind: 'trusted_circle_participants', limit: 6 },
      ]),
    ],
  );
}

async function insertTestProductionFounderBootstrap(target: Database): Promise<void> {
  await target.transaction(async (transaction) => {
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

describe('Founding Household forward migration', () => {
  let database: Database | undefined;
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
    if (temporaryDirectory !== undefined) {
      await rm(temporaryDirectory, { force: true, recursive: true });
      temporaryDirectory = undefined;
    }
  });

  it('applies the complete 0001 through 0019 chain with the dormant environment baseline', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-founding-0019-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0019_run3_founding_households.sql',
    );
    database = await createPGliteDatabase();

    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(19);
    const definition = await database.query<{
      cohort_key: string;
      definition_version: number;
      definition_digest: string;
    }>(
      `SELECT cohort_key, definition_version, definition_digest
       FROM founding_household_program_definitions`,
    );
    const policies = await database.query<{ environment: string; state: string }>(
      `SELECT environment, state FROM founding_household_policy_versions
       WHERE cohort_key = $1 ORDER BY environment`,
      [foundingHouseholdCohortKey],
    );
    const plans = await database.query<{
      id: string;
      plan_key: string;
      version: number;
      state: string;
    }>(
      `SELECT id, plan_key, version, state FROM commerce_plan_versions
       WHERE id IN ('founding_plus_beta_v2','founding_family_beta_v2') ORDER BY id`,
    );

    expect(definition.rows).toEqual([
      {
        cohort_key: foundingHouseholdCohortKey,
        definition_version: 1,
        definition_digest: foundingHouseholdLegacyDefinitionDigest,
      },
    ]);
    expect(policies.rows).toEqual([
      { environment: 'local', state: 'disabled' },
      { environment: 'production', state: 'disabled' },
      { environment: 'staging', state: 'disabled' },
    ]);
    expect(plans.rows).toEqual([
      { id: 'founding_family_beta_v2', plan_key: 'family', version: 2, state: 'active' },
      { id: 'founding_plus_beta_v2', plan_key: 'plus', version: 2, state: 'active' },
    ]);
  });

  it('applies the fresh 0001 through 0026 chain after flushing prior deferred events', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-founding-0026-fresh-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0026_run3_1_production_founding_households.sql',
    );
    database = await createPGliteDatabase();

    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(26);
    const revisions = await database.query<{
      definition_version: number;
      definition_digest: string;
    }>(
      `SELECT definition_version, definition_digest
       FROM founding_household_program_definition_revisions
       WHERE cohort_key = $1 ORDER BY definition_version`,
      [foundingHouseholdCohortKey],
    );
    expect(revisions.rows).toEqual([
      { definition_version: 1, definition_digest: foundingHouseholdLegacyDefinitionDigest },
      { definition_version: 2, definition_digest: foundingHouseholdDefinitionDigest() },
    ]);
  });

  it('upgrades an applied 0025 database with only additive 0026 changes', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-founding-0026-upgrade-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0025_run3_1_authenticated_feedback.sql',
    );
    database = await createPGliteDatabase();
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(25);

    await copyFile(
      join(sourceDirectory, '0026_run3_1_production_founding_households.sql'),
      join(temporaryDirectory, '0026_run3_1_production_founding_households.sql'),
    );
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([
      '0026_run3_1_production_founding_households.sql',
    ]);
    const columns = await database.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'founding_household_invitations'
         AND column_name LIKE 'intended_%'
       ORDER BY column_name`,
    );
    expect(columns.rows.map(({ column_name }) => column_name)).toEqual([
      'intended_household_id',
      'intended_identity_id',
      'intended_identity_issuer',
      'intended_identity_subject',
      'intended_person_id',
    ]);
  });

  it.each([
    ['null', null, 40],
    ['above the hard limit', 6, 41],
  ] as const)(
    'rejects raw-DML active production policy caps that are %s',
    async (_label, maxHouseholds, sequence) => {
      database = await createSeededTestDatabase(now);
      await insertTestProductionFounderBootstrap(database);
      const operationKey = operation('policy', sequence);

      await expect(
        withCapturedAuthority(database, now, async (transaction) => {
          await transaction.query(
            `INSERT INTO founding_household_founder_authorities(
               cohort_key, environment, founder_person_id, bound_at
             ) VALUES ($1,'production',$2,$3)
             ON CONFLICT (cohort_key, environment) DO NOTHING`,
            [foundingHouseholdCohortKey, founderPersonId, now.toISOString()],
          );
          await transaction.query(
            `INSERT INTO founding_household_operations(
               operation_key, cohort_key, environment, operation_kind, request_digest,
               actor_person_id, result_reference, created_at
             ) VALUES ($1,$2,'production','policy',$3,$4,'2:0',$5)`,
            [
              operationKey,
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
             ) VALUES ($1,'production',2,'active','family_beta_v1',$2,7,30,$3,$4,$5,$6)`,
            [
              foundingHouseholdCohortKey,
              maxHouseholds,
              '2026-10-01T00:00:00.000Z',
              founderPersonId,
              operationKey,
              now.toISOString(),
            ],
          );
        }),
      ).rejects.toThrow('Production Founding Household policy requires a hard cohort cap');

      const activePolicies = await database.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM founding_household_policy_versions
         WHERE cohort_key = $1 AND environment = 'production' AND state = 'active'`,
        [foundingHouseholdCohortKey],
      );
      expect(activePolicies.rows).toEqual([{ count: 0 }]);
    },
  );

  it('upgrades an applied 0018 database with only the forward 0019 migration', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-founding-0019-upgrade-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0018_run3_stripe_adversarial_remediation.sql',
    );
    database = await createPGliteDatabase();
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(18);

    await database.query(
      `INSERT INTO audit_events(
         id, action, resource_type, outcome, metadata, correlation_id, occurred_at
       ) VALUES (
         'audit-pre-founding-upgrade','migration.preexisting','migration','completed',
         '{}'::jsonb,'correlation:pre-founding-upgrade',$1
       )`,
      [now.toISOString()],
    );
    await database.query(
      `INSERT INTO outbox_events(
         id, event_type, event_version, aggregate_type, aggregate_id, correlation_id,
         classification, payload, occurred_at, available_at, next_attempt_at
       ) VALUES (
         'event-pre-founding-upgrade','migration.preexisting.v1',1,'migration','preexisting',
         'correlation:pre-founding-upgrade','internal','{}'::jsonb,$1,$1,$1
       )`,
      [now.toISOString()],
    );

    await copyFile(
      join(sourceDirectory, '0019_run3_founding_households.sql'),
      join(temporaryDirectory, '0019_run3_founding_households.sql'),
    );
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([
      '0019_run3_founding_households.sql',
    ]);
    const preservedEvents = await database.query<
      { kind: string; founding_household_operation_key: string | null } & Record<string, unknown>
    >(
      `SELECT 'audit' AS kind, founding_household_operation_key
       FROM audit_events WHERE id = 'audit-pre-founding-upgrade'
       UNION ALL
       SELECT 'outbox' AS kind, founding_household_operation_key
       FROM outbox_events WHERE id = 'event-pre-founding-upgrade'
       ORDER BY kind`,
    );
    const transitionColumns = await database.query<
      { column_name: string } & Record<string, unknown>
    >(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'founding_household_allowance_transitions'
       ORDER BY ordinal_position`,
    );
    expect(preservedEvents.rows).toEqual([
      { kind: 'audit', founding_household_operation_key: null },
      { kind: 'outbox', founding_household_operation_key: null },
    ]);
    expect(transitionColumns.rows.map(({ column_name }) => column_name)).toEqual([
      'operation_key',
      'enrollment_id',
      'household_id',
      'allowance_allocation_id',
      'allowance_key',
      'from_grant_id',
      'to_grant_id',
      'transition_kind',
      'occurred_at',
    ]);
  });

  it.each([
    ['product', { wrongProduct: true }],
    ['plan', { wrongPlan: true }],
  ] as const)(
    'fails the 0018 upgrade closed on a conflicting immutable %s row',
    async (catalogueKind, conflict) => {
      const sourceDirectory = await migrationDirectory();
      temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-founding-0019-conflict-'));
      await copyMigrationsThrough(
        sourceDirectory,
        temporaryDirectory,
        '0018_run3_stripe_adversarial_remediation.sql',
      );
      database = await createPGliteDatabase();
      await runMigrations(database, temporaryDirectory);
      await insertPreexistingFoundingCatalogue(database, conflict);
      await copyFile(
        join(sourceDirectory, '0019_run3_founding_households.sql'),
        join(temporaryDirectory, '0019_run3_founding_households.sql'),
      );

      await expect(runMigrations(database, temporaryDirectory)).rejects.toThrow(
        `${catalogueKind} catalogue conflict`,
      );
    },
  );

  it('preserves semantically exact preexisting immutable catalogue rows during upgrade', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-founding-0019-exact-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0018_run3_stripe_adversarial_remediation.sql',
    );
    database = await createPGliteDatabase();
    await runMigrations(database, temporaryDirectory);
    await insertPreexistingFoundingCatalogue(database);
    await copyFile(
      join(sourceDirectory, '0019_run3_founding_households.sql'),
      join(temporaryDirectory, '0019_run3_founding_households.sql'),
    );

    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([
      '0019_run3_founding_households.sql',
    ]);
    const preserved = await database.query<{ id: string; created_at: unknown }>(
      `SELECT id, created_at FROM commerce_product_versions
       WHERE id = 'consumer_household_v1'
       UNION ALL
       SELECT id, created_at FROM commerce_plan_versions
       WHERE id IN ('founding_plus_beta_v2','founding_family_beta_v2')
       ORDER BY id`,
    );
    expect(preserved.rows).toEqual([
      { id: 'consumer_household_v1', created_at: new Date('2026-08-10T00:00:00.000Z') },
      { id: 'founding_family_beta_v2', created_at: new Date('2026-08-10T00:00:00.000Z') },
      { id: 'founding_plus_beta_v2', created_at: new Date('2026-08-10T00:00:00.000Z') },
    ]);
  });

  it('pins the append-only definition and baseline policy history', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-founding-0019-immutable-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0019_run3_founding_households.sql',
    );
    database = await createPGliteDatabase();
    await runMigrations(database, temporaryDirectory);

    await expect(
      database.query(
        `UPDATE founding_household_program_definitions SET definition_version = 1
         WHERE cohort_key = $1`,
        [foundingHouseholdCohortKey],
      ),
    ).rejects.toThrow('append-only');
    await expect(
      database.query(
        `DELETE FROM founding_household_policy_versions
         WHERE cohort_key = $1 AND environment = 'production'`,
        [foundingHouseholdCohortKey],
      ),
    ).rejects.toThrow('append-only');
    await expect(
      database.query(
        `UPDATE founding_household_policy_versions SET state = 'disabled'
         WHERE cohort_key = $1 AND environment = 'local' AND revision = 1`,
        [foundingHouseholdCohortKey],
      ),
    ).rejects.toThrow('append-only');
  });

  it('rejects terminal invitation and enrollment inserts before any provenance can commit', async () => {
    database = await createSeededTestDatabase(now);
    const fixture = await foundingFixture(database, false);
    const attemptedAt = new Date(now.getTime() + 1_000);
    const terminalInvitationOperation = operation('invite', 10);

    await expect(
      withCapturedAuthority(database, attemptedAt, async (transaction) => {
        await transaction.query(
          `INSERT INTO founding_household_operations(
             operation_key, cohort_key, environment, operation_kind, request_digest,
             actor_person_id, result_reference, created_at
           ) VALUES ($1,$2,'local','invite',$3,$4,'terminal-insert-invitation',$5)`,
          [
            terminalInvitationOperation,
            foundingHouseholdCohortKey,
            'A'.repeat(43),
            founderPersonId,
            attemptedAt.toISOString(),
          ],
        );
        await transaction.query(
          `INSERT INTO founding_household_invitations(
             id, cohort_key, environment, policy_revision, benefit_key,
             access_duration_days, program_ends_at, credential_fingerprint,
             fingerprint_key_version, state, created_by_person_id, operation_key,
             terminal_operation_key, expires_at, created_at, ended_at
           ) VALUES (
             'terminal-insert-invitation',$1,'local',2,'family_beta_v1',30,
             '2026-10-01T00:00:00.000Z',NULL,1,'revoked',$2,$3,$3,$4,$5,$5
           )`,
          [
            foundingHouseholdCohortKey,
            founderPersonId,
            terminalInvitationOperation,
            new Date(attemptedAt.getTime() + 7 * 86_400_000).toISOString(),
            attemptedAt.toISOString(),
          ],
        );
      }),
    ).rejects.toThrow('Founding Household invitation must be inserted pending');

    const terminalEnrollmentOperation = operation('accept', 11);
    await expect(
      withCapturedAuthority(database, attemptedAt, async (transaction) => {
        await transaction.query(
          `INSERT INTO founding_household_operations(
             operation_key, cohort_key, environment, operation_kind, request_digest,
             actor_person_id, result_reference, created_at
           ) VALUES ($1,$2,'local','accept',$3,'person-owner-bob',
                     'terminal-insert-enrollment',$4)`,
          [
            terminalEnrollmentOperation,
            foundingHouseholdCohortKey,
            'B'.repeat(43),
            attemptedAt.toISOString(),
          ],
        );
        await transaction.query(
          `INSERT INTO founding_household_enrollments(
             household_id, id, cohort_key, environment, policy_revision, invitation_id,
             benefit_key, plan_version_id, sponsorship_id, sponsorship_allocation_id,
             subscription_id, entitlement_grant_id, service_consent_id,
             protected_enrollment_created, accepted_by_person_id, accepted_session_id,
             accepted_identity_id, accepted_identity_issuer, accepted_identity_subject,
             state, evidence_tier, operation_key, starts_at, ends_at,
             revoked_at, revoked_by_person_id, revoked_reason,
             revocation_operation_key, created_at
           ) VALUES (
             'household-harbor','terminal-insert-enrollment',$1,'local',2,$2,
             'family_beta_v1','founding_family_beta_v2',
             'founding-sponsorship-family-local-v1','missing-allocation',
             'missing-subscription','missing-grant','missing-consent',false,
             'person-owner-bob',$3,'identity-owner-bob','boomerbuddy-dev','owner-bob',
             'revoked','local_simulation',$4,$5,$6,$5,
             'person-owner-bob','household_withdrew',$4,$5
           )`,
          [
            foundingHouseholdCohortKey,
            fixture.invitationId,
            fixture.memberSessionId,
            terminalEnrollmentOperation,
            attemptedAt.toISOString(),
            new Date(attemptedAt.getTime() + 30 * 86_400_000).toISOString(),
          ],
        );
      }),
    ).rejects.toThrow('Founding Household enrollment must be inserted active');

    const stored = await database.query<
      { state: string; fingerprint: string | null; attempted_operations: number } & Record<
        string,
        unknown
      >
    >(
      `SELECT invitation.state, invitation.credential_fingerprint AS fingerprint,
              (SELECT count(*)::integer FROM founding_household_operations operation
               WHERE operation.operation_key IN ($2,$3)) AS attempted_operations
       FROM founding_household_invitations invitation WHERE invitation.id = $1`,
      [fixture.invitationId, terminalInvitationOperation, terminalEnrollmentOperation],
    );
    expect(stored.rows[0]).toMatchObject({ state: 'pending', attempted_operations: 0 });
    expect(stored.rows[0]?.fingerprint).not.toBeNull();
  });

  it('revalidates exact service and protected consent projections at deferred commit', async () => {
    database = await createSeededTestDatabase(now);
    const fixture = await foundingFixture(database, true);
    expect(fixture.enrollmentId).toBeDefined();

    await expect(
      database.query(
        `UPDATE consent_current_projections projection
         SET updated_at = updated_at + interval '1 second'
         WHERE (projection.household_id, projection.consent_id) = (
           SELECT enrollment.household_id, enrollment.service_consent_id
           FROM founding_household_enrollments enrollment WHERE enrollment.id = $1
         )`,
        [fixture.enrollmentId],
      ),
    ).rejects.toThrow('enrollment commit requires exact current service consent');

    await expect(
      database.query(
        `DELETE FROM consent_current_projections projection
         WHERE (projection.household_id, projection.consent_id) = (
           SELECT enrollment.household_id, enrollment.service_consent_id
           FROM founding_household_enrollments enrollment WHERE enrollment.id = $1
         )`,
        [fixture.enrollmentId],
      ),
    ).rejects.toThrow('enrollment commit requires exact current service consent');

    await expect(
      database.query(
        `UPDATE consent_current_projections projection
         SET scope = scope || '{"drift":true}'::jsonb
         WHERE (projection.household_id, projection.consent_id) = (
           SELECT protected.household_id, protected.consent_id
           FROM founding_household_enrollments enrollment
           JOIN protected_members protected
             ON protected.household_id = enrollment.household_id
            AND protected.person_id = enrollment.accepted_by_person_id
           WHERE enrollment.id = $1
         )`,
        [fixture.enrollmentId],
      ),
    ).rejects.toThrow('enrollment commit requires exact protected-adult consent');

    const terminatedAt = new Date(now.getTime() + 2_000);
    await expect(
      database.query(
        `UPDATE consent_current_projections projection
         SET state = 'withdrawn', effective_at = $2, updated_at = $2, expires_at = NULL
         WHERE (projection.household_id, projection.consent_id) = (
           SELECT enrollment.household_id, enrollment.service_consent_id
           FROM founding_household_enrollments enrollment WHERE enrollment.id = $1
         )`,
        [fixture.enrollmentId, terminatedAt.toISOString()],
      ),
    ).rejects.toThrow('active service-consent termination requires exact sponsor-chain closure');
  });

  it('allows exact protected self-withdrawal only with coupled member and allowance closure', async () => {
    database = await createSeededTestDatabase(now);
    await foundingFixture(database, true);
    const withdrawnAt = new Date(now.getTime() + 1_000);

    await expect(
      new EntitlementRepository(database, sequentialIds(), 'local').revokeProtectedSelf({
        householdId: 'household-harbor',
        personId: 'person-owner-bob',
        actorPersonId: 'person-owner-bob',
        actorIssuer: 'boomerbuddy-dev',
        now: withdrawnAt,
      }),
    ).resolves.toBe(true);

    const current = await database.query<Record<string, unknown>>(
      `SELECT protected.status, projection.state AS consent_state,
              allowance.state AS allowance_state, allowance.released_at
       FROM protected_members protected
       JOIN consent_current_projections projection
         ON projection.household_id = protected.household_id
        AND projection.consent_id = protected.consent_id
       JOIN commerce_allowance_allocations allowance
         ON allowance.household_id = protected.household_id
        AND allowance.id = protected.allowance_allocation_id
       WHERE protected.household_id = 'household-harbor'
         AND protected.person_id = 'person-owner-bob'`,
    );
    expect(current.rows).toEqual([
      {
        status: 'revoked',
        consent_state: 'withdrawn',
        allowance_state: 'released',
        released_at: withdrawnAt,
      },
    ]);
  });

  it('requires a uniquely operation-bound fresh audit and outbox before commit', async () => {
    database = await createSeededTestDatabase(now);
    const fixture = await foundingFixture(database, false);
    const revokedAt = new Date(now.getTime() + 1_000);
    const operationKey = operation('invite-revoke', 20);

    await expect(
      withCapturedAuthority(database, revokedAt, async (transaction) => {
        await transaction.query(
          `INSERT INTO founding_household_operations(
             operation_key, cohort_key, environment, operation_kind, request_digest,
             actor_person_id, result_reference, created_at
           ) VALUES ($1,$2,'local','invite_revoke',$3,$4,$5,$6)`,
          [
            operationKey,
            foundingHouseholdCohortKey,
            'C'.repeat(43),
            founderPersonId,
            fixture.invitationId,
            revokedAt.toISOString(),
          ],
        );
        await transaction.query(
          `UPDATE founding_household_invitations
           SET state = 'revoked', credential_fingerprint = NULL, ended_at = $2,
               terminal_operation_key = $3
           WHERE id = $1`,
          [fixture.invitationId, revokedAt.toISOString(), operationKey],
        );
        await transaction.query(
          `INSERT INTO audit_events(
             id, actor_person_id, session_audience, action, resource_type, resource_id,
             outcome, metadata, correlation_id, occurred_at,
             founding_household_operation_key
           ) VALUES (
             'audit-hostile-stale',$1,'hq','founding_household.invitation_revoked',
             'founding_household_invitation',$2,'completed','{}'::jsonb,$3,$4,$5
           )`,
          [
            founderPersonId,
            fixture.invitationId,
            'correlation:hostile-stale',
            revokedAt.toISOString(),
            operationKey,
          ],
        );
        await transaction.query(
          `INSERT INTO outbox_events(
             id, event_type, event_version, aggregate_type, aggregate_id,
             actor_person_id, correlation_id, classification, payload, occurred_at,
             available_at, next_attempt_at, attempts, founding_household_operation_key
           ) VALUES (
             'event-hostile-stale','founding_household.invitation_revoked.v1',1,
             'founding_household_invitation',$1,$2,$3,'internal','{}'::jsonb,
             $4,$4,$4,1,$5
           )`,
          [
            fixture.invitationId,
            founderPersonId,
            'correlation:hostile-stale',
            revokedAt.toISOString(),
            operationKey,
          ],
        );
      }),
    ).rejects.toThrow('one fresh operation-bound audit and outbox pair');

    const rollback = await database.query<Record<string, unknown>>(
      `SELECT invitation.state,
              (SELECT count(*)::integer FROM founding_household_operations operation
               WHERE operation.operation_key = $2) AS operations,
              (SELECT count(*)::integer FROM audit_events WHERE id = 'audit-hostile-stale') AS audits,
              (SELECT count(*)::integer FROM outbox_events WHERE id = 'event-hostile-stale') AS events
       FROM founding_household_invitations invitation WHERE invitation.id = $1`,
      [fixture.invitationId, operationKey],
    );
    expect(rollback.rows).toEqual([{ state: 'pending', operations: 0, audits: 0, events: 0 }]);
  });

  it('preserves operation-bound audit and outbox provenance after completion', async () => {
    database = await createSeededTestDatabase(now);
    await foundingFixture(database, true);
    const operationKey = operation('accept', 3);

    await expect(
      database.query(
        `UPDATE audit_events SET metadata = '{"rewritten":true}'::jsonb
         WHERE founding_household_operation_key = $1`,
        [operationKey],
      ),
    ).rejects.toThrow('operation-bound audit history is append-only');
    await expect(
      database.query(`DELETE FROM audit_events WHERE founding_household_operation_key = $1`, [
        operationKey,
      ]),
    ).rejects.toThrow('operation-bound audit history is append-only');
    await expect(
      database.query(
        `UPDATE outbox_events SET event_type = 'rewritten.v1'
         WHERE founding_household_operation_key = $1`,
        [operationKey],
      ),
    ).rejects.toThrow('operation-bound outbox provenance is immutable');

    await expect(
      database.query(
        `UPDATE outbox_events
         SET attempts = attempts + 1,
             next_attempt_at = next_attempt_at + interval '1 minute',
             last_error_code = 'temporary_failure'
         WHERE founding_household_operation_key = $1`,
        [operationKey],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      database.query(`DELETE FROM outbox_events WHERE founding_household_operation_key = $1`, [
        operationKey,
      ]),
    ).rejects.toThrow('operation-bound outbox history cannot be deleted');
  });

  it('rejects false policy supersession counts and unsafe result-reference grammars', async () => {
    database = await createSeededTestDatabase(now);
    await foundingFixture(database, false);
    const changedAt = new Date(now.getTime() + 1_000);

    await expect(
      withCapturedAuthority(database, changedAt, async (transaction) => {
        await transaction.query(
          `INSERT INTO founding_household_operations(
             operation_key, cohort_key, environment, operation_kind, request_digest,
             actor_person_id, result_reference, created_at
           ) VALUES ($1,$2,'local','policy',$3,$4,'3:0',$5)`,
          [
            operation('policy', 21),
            foundingHouseholdCohortKey,
            'D'.repeat(43),
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
            operation('policy', 21),
            changedAt.toISOString(),
          ],
        );
      }),
    ).rejects.toThrow('policy result does not match exact supersessions');

    await expect(
      withCapturedAuthority(database, changedAt, (transaction) =>
        transaction.query(
          `INSERT INTO founding_household_operations(
             operation_key, cohort_key, environment, operation_kind, request_digest,
             actor_person_id, result_reference, created_at
           ) VALUES ($1,$2,'local','offboard',$3,$4,
                     'enrollment:999999999999999999999:0',$5)`,
          [
            operation('offboard', 22),
            foundingHouseholdCohortKey,
            'E'.repeat(43),
            founderPersonId,
            changedAt.toISOString(),
          ],
        ),
      ),
    ).rejects.toThrow('operation result_reference does not match completed domain result');
  });

  it('prevents raw Founding-bound allowance deletion and rolls back attempted chain closure', async () => {
    database = await createSeededTestDatabase(now);
    const fixture = await foundingFixture(database, true);
    const closedAt = new Date(now.getTime() + 1_000);

    await expect(
      database.transaction(async (transaction) => {
        await transaction.query(
          `UPDATE entitlement_grants SET revoked_at = $2
           WHERE household_id = 'household-harbor'
             AND id = (SELECT entitlement_grant_id FROM founding_household_enrollments
                       WHERE id = $1)`,
          [fixture.enrollmentId, closedAt.toISOString()],
        );
        await transaction.query(
          `UPDATE commerce_sponsorship_allocations
           SET state = 'revoked', ends_at = $2
           WHERE household_id = 'household-harbor'
             AND id = (SELECT sponsorship_allocation_id FROM founding_household_enrollments
                       WHERE id = $1)`,
          [fixture.enrollmentId, closedAt.toISOString()],
        );
        await transaction.query(
          `UPDATE commerce_subscriptions
           SET lifecycle = 'canceled', ended_at = $2, updated_at = $2
           WHERE household_id = 'household-harbor'
             AND id = (SELECT subscription_id FROM founding_household_enrollments
                       WHERE id = $1)`,
          [fixture.enrollmentId, closedAt.toISOString()],
        );
        await transaction.query(
          `DELETE FROM commerce_allowance_allocations allowance
           WHERE allowance.household_id = 'household-harbor'
             AND allowance.entitlement_grant_id = (
               SELECT enrollment.entitlement_grant_id
               FROM founding_household_enrollments enrollment WHERE enrollment.id = $1
             )`,
          [fixture.enrollmentId],
        );
      }),
    ).rejects.toThrow('allowance history cannot be deleted during offboarding');

    const preserved = await database.query<Record<string, unknown>>(
      `SELECT enrollment.state AS enrollment_state,
              grant_record.revoked_at,
              allocation.state AS sponsorship_allocation_state,
              subscription.lifecycle,
              count(allowance.id)::integer AS allowance_count
       FROM founding_household_enrollments enrollment
       JOIN entitlement_grants grant_record
         ON grant_record.household_id = enrollment.household_id
        AND grant_record.id = enrollment.entitlement_grant_id
       JOIN commerce_sponsorship_allocations allocation
         ON allocation.household_id = enrollment.household_id
        AND allocation.id = enrollment.sponsorship_allocation_id
       JOIN commerce_subscriptions subscription
         ON subscription.household_id = enrollment.household_id
        AND subscription.id = enrollment.subscription_id
       LEFT JOIN commerce_allowance_allocations allowance
         ON allowance.household_id = enrollment.household_id
        AND allowance.entitlement_grant_id = enrollment.entitlement_grant_id
       WHERE enrollment.id = $1
       GROUP BY enrollment.state, grant_record.revoked_at, allocation.state,
                subscription.lifecycle`,
      [fixture.enrollmentId],
    );
    expect(preserved.rows[0]).toMatchObject({
      enrollment_state: 'active',
      revoked_at: null,
      sponsorship_allocation_state: 'active',
      lifecycle: 'active',
    });
    expect(preserved.rows[0]?.allowance_count).toBeGreaterThan(0);
  });

  it('records offboard allowance transition evidence from database OLD and NEW images', async () => {
    database = await createSeededTestDatabase(now);
    const fixture = await foundingFixture(database, true);
    const offboardedAt = new Date(now.getTime() + 1_000);
    const result = await fixture.repository.offboard({
      access: {
        actorPersonId: founderPersonId,
        correlationId: 'correlation:founding-migration-offboard',
      },
      authority: 'founder',
      householdId: 'household-harbor',
      operationKey: operation('offboard', 30),
      now: offboardedAt,
    });
    const transitions = await database.query<Record<string, unknown>>(
      `SELECT transition.allowance_key, transition.transition_kind,
              transition.from_grant_id, transition.to_grant_id, transition.occurred_at
       FROM founding_household_allowance_transitions transition
       WHERE transition.operation_key = $1
       ORDER BY transition.allowance_key, transition.allowance_allocation_id`,
      [operation('offboard', 30)],
    );
    expect(
      transitions.rows.filter(({ transition_kind }) => transition_kind === 'rebind'),
    ).toHaveLength(result.reboundProtectedAllocations + result.reboundTrustedCircleAllocations);
    expect(transitions.rows.every(({ occurred_at }) => occurred_at instanceof Date)).toBe(true);
    expect(
      transitions.rows.every(
        ({ occurred_at }) =>
          occurred_at instanceof Date && occurred_at.getTime() === offboardedAt.getTime(),
      ),
    ).toBe(true);

    await expect(
      database.query(
        `INSERT INTO founding_household_allowance_transitions(
           operation_key, enrollment_id, household_id, allowance_allocation_id,
           allowance_key, from_grant_id, to_grant_id, transition_kind, occurred_at
         ) SELECT $1, enrollment.id, enrollment.household_id, allowance.id,
                  allowance.allowance_key, enrollment.entitlement_grant_id,
                  allowance.entitlement_grant_id, 'rebind', $2
           FROM founding_household_enrollments enrollment
           JOIN commerce_allowance_allocations allowance
             ON allowance.household_id = enrollment.household_id
           WHERE enrollment.id = $3 LIMIT 1`,
        [operation('offboard', 30), offboardedAt.toISOString(), fixture.enrollmentId],
      ),
    ).rejects.toThrow('transition history is database-owned');
  });
});
