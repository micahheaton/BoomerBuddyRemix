import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createPGliteDatabase, type Database } from './database';
import { migrationDirectory, runMigrations } from './migrations';

describe('growth replay-lineage forward migration', () => {
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

  it('upgrades an 0011 database, backfills the canonical root, and restricts lineage deletion', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-growth-migration-'));
    const files = (await readdir(sourceDirectory)).filter(
      (file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file) && file < '0012_',
    );
    for (const file of files) {
      await copyFile(join(sourceDirectory, file), join(temporaryDirectory, file));
    }
    database = await createPGliteDatabase();
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(11);
    const root = await database.query<{ causal_order_position: number }>(
      `INSERT INTO outbox_events(
         id, event_type, event_version, aggregate_type, aggregate_id, correlation_id,
         classification, payload, occurred_at, available_at, next_attempt_at
       ) VALUES (
         'event-migration-root','check.completed.v1',1,'analysis','analysis-migration-root',
         'growth-migration-root','internal','{}','2026-08-16T12:00:00.000Z',
         '2026-08-16T12:00:00.000Z','2026-08-16T12:00:00.000Z'
       ) RETURNING causal_order_position`,
    );
    await database.query(
      `INSERT INTO outbox_events(
         id, event_type, event_version, aggregate_type, aggregate_id, correlation_id,
         classification, payload, occurred_at, available_at, next_attempt_at,
         replay_of_event_id, replay_reason, causal_order_position
       ) VALUES (
         'event-migration-replay','check.completed.v1',1,'analysis','analysis-migration-root',
         'growth-migration-replay','internal','{}','2026-08-16T12:00:00.000Z',
         '2026-08-16T12:01:00.000Z','2026-08-16T12:01:00.000Z',
         'event-migration-root','migration_replay',$1
       )`,
      [root.rows[0]?.causal_order_position],
    );
    await database.query(
      `INSERT INTO growth_event_receipts(
         event_id, event_type, projection_version, disposition, projected_at
       ) VALUES (
         'event-migration-replay','check.completed.v1','run2-growth-v1','projected',
         '2026-08-16T12:02:00.000Z'
       )`,
    );

    await copyFile(
      join(sourceDirectory, '0012_run2_growth_replay_lineage.sql'),
      join(temporaryDirectory, '0012_run2_growth_replay_lineage.sql'),
    );
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([
      '0012_run2_growth_replay_lineage.sql',
    ]);
    const receipt = await database.query<{ event_id: string; root_event_id: string }>(
      'SELECT event_id, root_event_id FROM growth_event_receipts',
    );
    expect(receipt.rows).toEqual([
      {
        event_id: 'event-migration-replay',
        root_event_id: 'event-migration-root',
      },
    ]);
    await expect(
      database.query("DELETE FROM outbox_events WHERE id = 'event-migration-root'"),
    ).rejects.toThrow(/foreign key/iu);
    await expect(
      database.query("DELETE FROM outbox_events WHERE id = 'event-migration-replay'"),
    ).rejects.toThrow(/foreign key/iu);
  });
});
