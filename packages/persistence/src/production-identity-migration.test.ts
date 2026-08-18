import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPGliteDatabase, type Database } from './database';
import { migrationDirectory, runMigrations } from './migrations';

async function copyThrough(source: string, target: string, maximumVersion: number): Promise<void> {
  const files = (await readdir(source)).filter((file) => {
    const version = Number.parseInt(file.split('_', 1)[0] ?? '', 10);
    return Number.isInteger(version) && version <= maximumVersion;
  });
  await Promise.all(files.map((file) => copyFile(join(source, file), join(target, file))));
}

describe('production identity migration 0024', () => {
  let database: Database | undefined;
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    await database?.close();
    if (temporaryDirectory !== undefined) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('forward-binds an existing session to its exact identity and provider session id', async () => {
    database = await createPGliteDatabase(':memory:');
    const source = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-production-identity-'));
    await copyThrough(source, temporaryDirectory, 23);
    await runMigrations(database, temporaryDirectory);
    await database.query(
      `INSERT INTO persons(id, display_name, created_at)
       VALUES ('person-existing-session','Existing customer',$1)`,
      ['2026-08-17T11:00:00.000Z'],
    );
    await database.query(
      `INSERT INTO identities(id, person_id, issuer, subject, status, created_at)
       VALUES ('identity-existing-session','person-existing-session','boomerbuddy-dev',
               'existing-session-subject','active',$1)`,
      ['2026-08-17T11:00:00.000Z'],
    );
    await database.query(
      `INSERT INTO sessions(id, person_id, audience, issuer, issued_at, expires_at)
       VALUES ('session-existing-upgrade','person-existing-session','customer','boomerbuddy-dev',
               $1,$2)`,
      ['2026-08-17T11:30:00.000Z', '2026-08-17T13:00:00.000Z'],
    );

    await copyFile(
      join(source, '0024_run3_1_production_identity.sql'),
      join(temporaryDirectory, '0024_run3_1_production_identity.sql'),
    );
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([
      '0024_run3_1_production_identity.sql',
    ]);
    const session = await database.query<
      {
        readonly identity_id: string;
        readonly identity_subject: string;
        readonly provider_session_id: string;
        readonly last_verified_at: unknown;
      } & Record<string, unknown>
    >(
      `SELECT identity_id, identity_subject, provider_session_id, last_verified_at
       FROM sessions WHERE id = 'session-existing-upgrade'`,
    );
    expect(session.rows[0]).toMatchObject({
      identity_id: 'identity-existing-session',
      identity_subject: 'existing-session-subject',
      provider_session_id: 'session-existing-upgrade',
    });
    expect(new Date(String(session.rows[0]?.last_verified_at)).toISOString()).toBe(
      '2026-08-17T11:30:00.000Z',
    );
  });

  it('fails the upgrade rather than guessing when an existing session has no issuer identity', async () => {
    database = await createPGliteDatabase(':memory:');
    const source = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-production-identity-fail-'));
    await copyThrough(source, temporaryDirectory, 23);
    await runMigrations(database, temporaryDirectory);
    await database.query(
      `INSERT INTO persons(id, display_name, created_at)
       VALUES ('person-orphan-session','Orphan session',$1)`,
      ['2026-08-17T11:00:00.000Z'],
    );
    await database.query(
      `INSERT INTO sessions(id, person_id, audience, issuer, issued_at, expires_at)
       VALUES ('session-orphan-upgrade','person-orphan-session','customer','unknown-issuer',
               $1,$2)`,
      ['2026-08-17T11:30:00.000Z', '2026-08-17T13:00:00.000Z'],
    );
    await copyFile(
      join(source, '0024_run3_1_production_identity.sql'),
      join(temporaryDirectory, '0024_run3_1_production_identity.sql'),
    );
    await expect(runMigrations(database, temporaryDirectory)).rejects.toThrow(
      'cannot be bound to an exact identity',
    );
  });
});
