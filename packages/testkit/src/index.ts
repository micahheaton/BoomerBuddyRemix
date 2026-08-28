import {
  createPGliteDatabase,
  runMigrations,
  seedDemoData,
  type ArtifactProtection,
  type Database,
} from '@boomerbuddy/persistence';

export const fixedTestNow = new Date('2026-08-15T12:00:00.000Z');

export function testArtifactProtection(): ArtifactProtection {
  return {
    encryptionKey: Buffer.alloc(32, 7),
    encryptionKeyVersion: 1,
    fingerprintKey: Buffer.alloc(32, 11),
    fingerprintKeyVersion: 1,
  };
}

export async function createMigratedTestDatabase(): Promise<Database> {
  const database = await createPGliteDatabase(':memory:');
  await runMigrations(database);
  return database;
}

export async function createSeededTestDatabase(now: Date = fixedTestNow): Promise<Database> {
  const database = await createMigratedTestDatabase();
  await seedDemoData(database, testArtifactProtection(), 'test', now);
  return database;
}

export async function restrictedArtifactDiagnostic(
  database: Database,
  householdId: string,
  checkId: string,
): Promise<Readonly<Record<string, unknown>> | null> {
  const result = await database.query<Record<string, unknown>>(
    `SELECT r.encrypted_content, r.input_fingerprint, r.encryption_key_version,
            r.fingerprint_key_version
     FROM artifacts r JOIN analyses a ON a.household_id = r.household_id AND a.artifact_id = r.id
     WHERE a.household_id = $1 AND a.id = $2`,
    [householdId, checkId],
  );
  return result.rows[0] ?? null;
}

export async function transactionFactsDiagnostic(
  database: Database,
  householdId: string,
  checkId: string,
): Promise<{ readonly analyses: number; readonly audits: number; readonly outbox: number }> {
  const result = await database.query<{ analyses: number; audits: number; outbox: number }>(
    `SELECT
      (SELECT count(*)::int FROM analyses WHERE household_id = $1 AND id = $2) AS analyses,
      (SELECT count(*)::int FROM audit_events WHERE household_id = $1 AND resource_id = $2) AS audits,
      (SELECT count(*)::int FROM outbox_events WHERE household_id = $1 AND aggregate_id = $2) AS outbox`,
    [householdId, checkId],
  );
  return result.rows[0] ?? { analyses: 0, audits: 0, outbox: 0 };
}
