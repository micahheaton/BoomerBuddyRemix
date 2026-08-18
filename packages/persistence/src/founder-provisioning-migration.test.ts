import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { founderProvisioningCatalogue } from '@boomerbuddy/domain';

import { createPGliteDatabase, type Database } from './database';
import { founderProvisioningDefinitionDigest } from './founder-provisioning';
import { migrationDirectory, runMigrations } from './migrations';

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

async function databaseAuthorityTime(database: Database): Promise<Date> {
  const result = await database.query<{ authority_now: unknown } & Record<string, unknown>>(
    'SELECT clock_timestamp() AS authority_now',
  );
  const value = result.rows[0]?.authority_now;
  const authorityNow = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(authorityNow.getTime())) throw new TypeError('Missing database authority time');
  return authorityNow;
}

function directOperationKey(sequence: number): string {
  return `provisioning:company_git:00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

interface DirectAttempt {
  readonly sequence: number;
  readonly version: number;
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly tier: string;
  readonly kind: string;
  readonly result: string;
  readonly observedAt: Date;
  readonly recordedAt: Date;
  readonly operationCreatedAt?: Date;
  readonly manifestDigest?: string;
}

async function stageDirectAttempt(database: Database, input: DirectAttempt): Promise<void> {
  await database.query(
    `INSERT INTO founder_provisioning_evidence(
       id, workstream_key, actor_person_id, tier, kind, result,
       manifest_digest, observed_at, recorded_at, correlation_id
     ) VALUES ($1,'company_git','person-chronology-test',$2,$3,$4,$5,$6,$7,$8)`,
    [
      `direct-evidence-${input.sequence}`,
      input.tier,
      input.kind,
      input.result,
      input.manifestDigest ?? null,
      input.observedAt.toISOString(),
      input.recordedAt.toISOString(),
      `direct-chronology-${input.sequence}`,
    ],
  );
  await database.query(
    `INSERT INTO founder_provisioning_operations(
       operation_key, workstream_key, request_digest, actor_person_id, created_at
     ) VALUES ($1,'company_git',$2,'person-chronology-test',$3)`,
    [
      directOperationKey(input.sequence),
      String(input.sequence % 10).repeat(43),
      (input.operationCreatedAt ?? input.recordedAt).toISOString(),
    ],
  );
}

async function insertDirectStatus(database: Database, input: DirectAttempt): Promise<void> {
  await database.query(
    `INSERT INTO founder_provisioning_status_events(
       id, workstream_key, from_status, to_status, version, evidence_id,
       actor_person_id, operation_key, occurred_at
     ) VALUES ($1,'company_git',$2,$3,$4,$5,'person-chronology-test',$6,$7)`,
    [
      `direct-status-${input.sequence}`,
      input.fromStatus,
      input.toStatus,
      input.version,
      `direct-evidence-${input.sequence}`,
      directOperationKey(input.sequence),
      input.recordedAt.toISOString(),
    ],
  );
}

async function applyDirectAttempt(database: Database, input: DirectAttempt): Promise<void> {
  await stageDirectAttempt(database, input);
  await insertDirectStatus(database, input);
}

describe('founder provisioning forward migration', () => {
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

  it('applies the complete 0001 through 0017 chain and seeds the exact reconciled baseline', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-provisioning-migration-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0017_run3_founder_provisioning.sql',
    );
    database = await createPGliteDatabase();

    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(17);
    const catalogue = await database.query<{
      definition_digest: string;
      workstream_key: string;
    }>(
      `SELECT workstream_key, definition_digest
       FROM founder_provisioning_workstreams
       ORDER BY display_order`,
    );
    const statusCounts = await database.query<{ status: string; count: number }>(`
      SELECT to_status AS status, count(*)::integer AS count
      FROM founder_provisioning_status_events
      GROUP BY to_status
      ORDER BY to_status
    `);

    expect(catalogue.rows).toEqual(
      founderProvisioningCatalogue.map((entry) => ({
        definition_digest: founderProvisioningDefinitionDigest(entry),
        workstream_key: entry.key,
      })),
    );
    expect(statusCounts.rows).toEqual([
      { status: 'blocked', count: 5 },
      { status: 'founder_in_progress', count: 7 },
      { status: 'not_started', count: 11 },
    ]);
  });

  it('upgrades an applied 0016 database without replaying earlier migrations', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-provisioning-upgrade-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0016_run3_stripe_first_dollar.sql',
    );
    database = await createPGliteDatabase();
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(16);

    await copyFile(
      join(sourceDirectory, '0017_run3_founder_provisioning.sql'),
      join(temporaryDirectory, '0017_run3_founder_provisioning.sql'),
    );
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([
      '0017_run3_founder_provisioning.sql',
    ]);
  });

  it('rejects mutation of catalogue, evidence, and status history', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-provisioning-immutable-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0017_run3_founder_provisioning.sql',
    );
    database = await createPGliteDatabase();
    await runMigrations(database, temporaryDirectory);
    await database.query(
      "INSERT INTO persons(id, display_name) VALUES ('person-immutable-test', 'Immutable test')",
    );
    await expect(
      database.query(`
        INSERT INTO founder_provisioning_operations(
          operation_key, workstream_key, request_digest, actor_person_id, created_at
        ) VALUES (
          'sk_test_do_not_store_as_operation', 'company_git',
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'person-immutable-test',
          '2026-08-16T01:00:00.000Z'
        )
      `),
    ).rejects.toThrow();
    await expect(
      database.query(`
        INSERT INTO founder_provisioning_operations(
          operation_key, workstream_key, request_digest, actor_person_id, created_at
        ) VALUES (
          'provisioning:stripe:00000000-0000-4000-8000-000000000001', 'company_git',
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'person-immutable-test',
          '2026-08-16T01:00:00.000Z'
        )
      `),
    ).rejects.toThrow();
    await database.query(`
      INSERT INTO founder_provisioning_operations(
        operation_key, workstream_key, request_digest, actor_person_id, created_at
      ) VALUES (
        'provisioning:company_git:00000000-0000-4000-8000-000000000001', 'company_git',
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'person-immutable-test',
        '2026-08-16T01:00:00.000Z'
      )
    `);

    await expect(
      database.query(
        "UPDATE founder_provisioning_workstreams SET display_order = 11 WHERE workstream_key = 'company_git'",
      ),
    ).rejects.toThrow('immutable');
    await expect(
      database.query(
        "UPDATE founder_provisioning_workstreams SET definition_digest = 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ' WHERE workstream_key = 'company_git'",
      ),
    ).rejects.toThrow('immutable');
    await expect(
      database.query(
        "DELETE FROM founder_provisioning_evidence WHERE workstream_key = 'company_git'",
      ),
    ).rejects.toThrow('immutable');
    await expect(
      database.query(
        "UPDATE founder_provisioning_status_events SET to_status = 'blocked' WHERE workstream_key = 'company_git'",
      ),
    ).rejects.toThrow('immutable');
    await expect(
      database.query(
        "DELETE FROM founder_provisioning_operations WHERE operation_key = 'provisioning:company_git:00000000-0000-4000-8000-000000000001'",
      ),
    ).rejects.toThrow('immutable');
  });

  it('rejects stale or skipped status sequence inserts at the database boundary', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-provisioning-sequence-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0017_run3_founder_provisioning.sql',
    );
    database = await createPGliteDatabase();
    await runMigrations(database, temporaryDirectory);
    await database.query(
      "INSERT INTO persons(id, display_name) VALUES ('person-sequence-test', 'Sequence test')",
    );
    const skipAt = await databaseAuthorityTime(database);
    await database.query(
      `
      INSERT INTO founder_provisioning_evidence(
        id, workstream_key, actor_person_id, tier, kind, result,
        observed_at, recorded_at, correlation_id
      ) VALUES (
        'sequence-evidence', 'company_git', 'person-sequence-test',
        'founder_report', 'setup_started', 'reported', '2026-08-16T01:00:00.000Z',
        '2026-08-16T01:00:00.000Z', 'sequence-test'
      )
    `,
    );
    await database.query(`
      INSERT INTO founder_provisioning_operations(
        operation_key, workstream_key, request_digest, actor_person_id, created_at
      ) VALUES (
        'provisioning:company_git:00000000-0000-4000-8000-000000000002',
        'company_git', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'person-sequence-test', '2026-08-16T01:00:00.000Z'
      )
    `);

    await expect(
      database.query(`
        INSERT INTO founder_provisioning_status_events(
          id, workstream_key, from_status, to_status, version, evidence_id,
          actor_person_id, operation_key, occurred_at
        ) VALUES (
          'sequence-status', 'company_git', 'blocked', 'founder_in_progress', 2,
          'sequence-evidence', 'person-sequence-test',
          'provisioning:company_git:00000000-0000-4000-8000-000000000002',
          '2026-08-16T01:00:00.000Z'
        )
      `),
    ).rejects.toThrow('stale or invalid');

    await database.query(
      `
      INSERT INTO founder_provisioning_evidence(
        id, workstream_key, actor_person_id, tier, kind, result,
        manifest_digest, observed_at, recorded_at, correlation_id
      ) VALUES (
        'sequence-skip-evidence', 'company_git', 'person-sequence-test',
        'deployed_staging', 'configuration_ready', 'passed',
        'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        $1, $1,
        'sequence-skip-test'
      )
    `,
      [skipAt.toISOString()],
    );
    await database.query(
      `
      INSERT INTO founder_provisioning_operations(
        operation_key, workstream_key, request_digest, actor_person_id, created_at
      ) VALUES (
        'provisioning:company_git:00000000-0000-4000-8000-000000000003', 'company_git',
        'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        'person-sequence-test', $1
      )
    `,
      [skipAt.toISOString()],
    );

    await expect(
      database.query(
        `
        INSERT INTO founder_provisioning_status_events(
          id, workstream_key, from_status, to_status, version, evidence_id,
          actor_person_id, operation_key, occurred_at
        ) VALUES (
          'sequence-skip-status', 'company_git', 'not_started', 'ready_for_test', 2,
          'sequence-skip-evidence', 'person-sequence-test',
          'provisioning:company_git:00000000-0000-4000-8000-000000000003',
          $1
        )
      `,
        [skipAt.toISOString()],
      ),
    ).rejects.toThrow('cannot skip an evidence gate');
  });

  it('enforces chronology, freshness, invalidation, and reconfiguration in direct SQL', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-provisioning-chronology-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0017_run3_founder_provisioning.sql',
    );
    database = await createPGliteDatabase();
    await runMigrations(database, temporaryDirectory);
    await database.query(
      "INSERT INTO persons(id, display_name) VALUES ('person-chronology-test', 'Chronology test')",
    );
    const baseline = await database.query<{ occurred_at: unknown } & Record<string, unknown>>(
      `SELECT occurred_at FROM founder_provisioning_status_events
       WHERE workstream_key = 'company_git' AND version = 1`,
    );
    const baselineValue = baseline.rows[0]?.occurred_at;
    const baselineOccurredAt =
      baselineValue instanceof Date ? baselineValue : new Date(String(baselineValue));

    const recordingAuthorityAt = await databaseAuthorityTime(database);
    const staleRecording: DirectAttempt = {
      sequence: 9,
      version: 2,
      fromStatus: 'not_started',
      toStatus: 'founder_in_progress',
      tier: 'founder_report',
      kind: 'setup_started',
      result: 'reported',
      observedAt: recordingAuthorityAt,
      recordedAt: new Date(recordingAuthorityAt.getTime() - 10 * 60 * 1_000),
    };
    await stageDirectAttempt(database, staleRecording);
    await expect(insertDirectStatus(database, staleRecording)).rejects.toThrow(
      'recording time must be current database time',
    );

    const ancientAt = await databaseAuthorityTime(database);
    const ancient: DirectAttempt = {
      sequence: 10,
      version: 2,
      fromStatus: 'not_started',
      toStatus: 'founder_in_progress',
      tier: 'founder_report',
      kind: 'setup_started',
      result: 'reported',
      observedAt: new Date(baselineOccurredAt.getTime() - 1),
      recordedAt: ancientAt,
    };
    await stageDirectAttempt(database, ancient);
    await expect(insertDirectStatus(database, ancient)).rejects.toThrow(
      'predates the current status gate',
    );

    const futureAt = await databaseAuthorityTime(database);
    const future: DirectAttempt = {
      ...ancient,
      sequence: 11,
      observedAt: new Date(futureAt.getTime() + 10 * 60 * 1_000),
      recordedAt: futureAt,
    };
    await stageDirectAttempt(database, future);
    await expect(insertDirectStatus(database, future)).rejects.toThrow('cannot be future-dated');

    const incoherentAt = await databaseAuthorityTime(database);
    const incoherent: DirectAttempt = {
      ...ancient,
      sequence: 12,
      observedAt: incoherentAt,
      recordedAt: incoherentAt,
      operationCreatedAt: new Date(incoherentAt.getTime() + 1),
    };
    await stageDirectAttempt(database, incoherent);
    await expect(insertDirectStatus(database, incoherent)).rejects.toThrow('time must match');

    const progressAt = await databaseAuthorityTime(database);
    await applyDirectAttempt(database, {
      ...ancient,
      sequence: 13,
      observedAt: progressAt,
      recordedAt: progressAt,
    });
    const configuredAt = await databaseAuthorityTime(database);
    await applyDirectAttempt(database, {
      sequence: 14,
      version: 3,
      fromStatus: 'founder_in_progress',
      toStatus: 'ready_for_test',
      tier: 'repository_review',
      kind: 'configuration_ready',
      result: 'passed',
      manifestDigest: 'D'.repeat(43),
      observedAt: configuredAt,
      recordedAt: configuredAt,
    });

    const expiredAt = await databaseAuthorityTime(database);
    const expired: DirectAttempt = {
      sequence: 15,
      version: 4,
      fromStatus: 'ready_for_test',
      toStatus: 'test_proven',
      tier: 'deployed_staging',
      kind: 'verification_passed',
      result: 'passed',
      manifestDigest: 'E'.repeat(43),
      observedAt: new Date(expiredAt.getTime() - 24 * 60 * 60 * 1_000 - 1),
      recordedAt: expiredAt,
    };
    await stageDirectAttempt(database, expired);
    await expect(insertDirectStatus(database, expired)).rejects.toThrow('24-hour freshness bound');

    const proofAt = await databaseAuthorityTime(database);
    await applyDirectAttempt(database, {
      ...expired,
      sequence: 16,
      observedAt: proofAt,
      recordedAt: proofAt,
    });
    const invalidatedAt = await databaseAuthorityTime(database);
    await applyDirectAttempt(database, {
      sequence: 17,
      version: 5,
      fromStatus: 'test_proven',
      toStatus: 'ready_for_test',
      tier: 'repository_review',
      kind: 'evidence_invalidated',
      result: 'invalidated',
      observedAt: invalidatedAt,
      recordedAt: invalidatedAt,
    });
    const staleAfterInvalidationAt = await databaseAuthorityTime(database);
    const staleAfterInvalidation: DirectAttempt = {
      ...expired,
      sequence: 18,
      version: 6,
      observedAt: new Date(invalidatedAt.getTime() - 1),
      recordedAt: staleAfterInvalidationAt,
    };
    await stageDirectAttempt(database, staleAfterInvalidation);
    await expect(insertDirectStatus(database, staleAfterInvalidation)).rejects.toThrow(
      'predates the current status gate',
    );

    const revokedAt = await databaseAuthorityTime(database);
    await applyDirectAttempt(database, {
      sequence: 19,
      version: 6,
      fromStatus: 'ready_for_test',
      toStatus: 'founder_in_progress',
      tier: 'repository_review',
      kind: 'configuration_revoked',
      result: 'invalidated',
      observedAt: revokedAt,
      recordedAt: revokedAt,
    });
    const reconfiguredAt = await databaseAuthorityTime(database);
    await applyDirectAttempt(database, {
      sequence: 20,
      version: 7,
      fromStatus: 'founder_in_progress',
      toStatus: 'ready_for_test',
      tier: 'repository_review',
      kind: 'configuration_ready',
      result: 'passed',
      manifestDigest: 'F'.repeat(43),
      observedAt: reconfiguredAt,
      recordedAt: reconfiguredAt,
    });
    const staleAfterReconfigurationAt = await databaseAuthorityTime(database);
    const staleAfterReconfiguration: DirectAttempt = {
      ...expired,
      sequence: 21,
      version: 8,
      observedAt: new Date(reconfiguredAt.getTime() - 1),
      recordedAt: staleAfterReconfigurationAt,
    };
    await stageDirectAttempt(database, staleAfterReconfiguration);
    await expect(insertDirectStatus(database, staleAfterReconfiguration)).rejects.toThrow(
      'predates the current status gate',
    );

    const statusCount = await database.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM founder_provisioning_status_events
       WHERE workstream_key = 'company_git'`,
    );
    expect(statusCount.rows[0]?.count).toBe(7);
  });

  it('serializes racing direct SQL status inserts at the workstream lock', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-provisioning-race-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0017_run3_founder_provisioning.sql',
    );
    database = await createPGliteDatabase();
    await runMigrations(database, temporaryDirectory);
    await database.query(
      "INSERT INTO persons(id, display_name) VALUES ('person-chronology-test', 'Chronology test')",
    );
    const raceAt = await databaseAuthorityTime(database);
    const left: DirectAttempt = {
      sequence: 30,
      version: 2,
      fromStatus: 'not_started',
      toStatus: 'founder_in_progress',
      tier: 'founder_report',
      kind: 'setup_started',
      result: 'reported',
      observedAt: raceAt,
      recordedAt: raceAt,
    };
    const right: DirectAttempt = { ...left, sequence: 31 };
    await stageDirectAttempt(database, left);
    await stageDirectAttempt(database, right);

    const results = await Promise.allSettled([
      insertDirectStatus(database, left),
      insertDirectStatus(database, right),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const statusCount = await database.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM founder_provisioning_status_events
       WHERE workstream_key = 'company_git'`,
    );
    expect(statusCount.rows[0]?.count).toBe(2);
  });
});
