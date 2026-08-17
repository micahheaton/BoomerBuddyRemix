import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createPGliteDatabase, type Database } from './database';
import { migrationDirectory, runMigrations } from './migrations';

describe('automation budget forward migration', () => {
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

  it('upgrades 0012 state without resetting policy/control history or granting budget', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-budget-migration-'));
    const files = (await readdir(sourceDirectory)).filter(
      (file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file) && file < '0013_',
    );
    for (const file of files) {
      await copyFile(join(sourceDirectory, file), join(temporaryDirectory, file));
    }
    database = await createPGliteDatabase();
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(12);
    await database.query(
      `INSERT INTO persons(id, display_name, created_at)
       VALUES ('person-budget-migration','Budget migration owner','2026-08-16T00:00:00.000Z')`,
    );
    await database.query(
      `INSERT INTO autonomy_policies(
         id, action_key, autonomy_class, allowed_data_classes, allowed_tools, budget_cents,
         requires_audit, enabled, approved_by_person_id, version, created_at, updated_at
       ) VALUES (
         'policy-budget-migration','create_internal_task','auto','["public"]','["hq"]',17,
         true,true,'person-budget-migration',1,'2026-08-16T00:00:00.000Z',
         '2026-08-16T00:00:00.000Z'
       )`,
    );
    await database.query(
      `INSERT INTO autonomy_policy_versions(
         id, policy_id, action_key, version, autonomy_class, allowed_data_classes,
         allowed_tools, budget_cents, requires_audit, enabled, approved_by_person_id, recorded_at
       ) VALUES (
         'policy-version-budget-migration','policy-budget-migration','create_internal_task',1,
         'auto','["public"]','["hq"]',17,true,true,'person-budget-migration',
         '2026-08-16T00:00:00.000Z'
       )`,
    );
    await database.query(
      `UPDATE automation_global_control
       SET kill_switch = false, updated_by_person_id = 'person-budget-migration',
           updated_at = '2026-08-16T01:00:00.000Z'
       WHERE control_key = 'global'`,
    );
    await database.query(
      `INSERT INTO automation_global_control_history(
         id, kill_switch, updated_by_person_id, recorded_at
       ) VALUES
         ('control-a-tie',true,'person-budget-migration','2026-08-15T00:00:00.000Z'),
         ('control-b-tie',false,'person-budget-migration','2026-08-15T00:00:00.000Z'),
         ('control-z-late',true,'person-budget-migration','2026-08-17T00:00:00.000Z')`,
    );
    await database.query(
      `INSERT INTO automation_runs(
         id, policy_id, action_key, tool_key, data_classes, estimated_cost_cents,
         state, audit_reference, created_at
       ) VALUES (
         'run-budget-migration','policy-budget-migration','create_internal_task','hq','["public"]',
         1,'approved','automation:run-budget-migration','2026-08-16T02:00:00.000Z'
       )`,
    );

    await copyFile(
      join(sourceDirectory, '0013_run3_automation_budget_ledger.sql'),
      join(temporaryDirectory, '0013_run3_automation_budget_ledger.sql'),
    );
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([
      '0013_run3_automation_budget_ledger.sql',
    ]);
    const upgraded = await database.query<
      {
        cap_count: number;
        control_version: number;
        current_ceiling: number;
        evaluation_only: boolean;
        history_ceiling: number;
        history_version: number;
        snapshot_kill_switch: boolean;
        snapshot_version: number;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT max_cost_per_operation_cents FROM autonomy_policies
          WHERE id = 'policy-budget-migration') AS current_ceiling,
         (SELECT max_cost_per_operation_cents FROM autonomy_policy_versions
          WHERE id = 'policy-version-budget-migration') AS history_ceiling,
         (SELECT version FROM automation_global_control WHERE control_key = 'global') AS control_version,
         (SELECT control_version FROM automation_global_control_history
          WHERE id = 'control-z-late') AS history_version,
         (SELECT control_version FROM automation_global_control_history
          WHERE id = 'automation-global-control-migration-snapshot-0013') AS snapshot_version,
         (SELECT kill_switch FROM automation_global_control_history
          WHERE id = 'automation-global-control-migration-snapshot-0013') AS snapshot_kill_switch,
         (SELECT evaluation_only FROM automation_runs WHERE id = 'run-budget-migration') AS evaluation_only,
         (SELECT count(*)::int FROM automation_budget_caps) AS cap_count`,
    );
    expect(upgraded.rows[0]).toEqual({
      cap_count: 0,
      control_version: 4,
      current_ceiling: 17,
      evaluation_only: true,
      history_ceiling: 17,
      history_version: 3,
      snapshot_kill_switch: false,
      snapshot_version: 4,
    });
    await expect(database.query('DELETE FROM automation_global_control_history')).rejects.toThrow(
      'append-only',
    );
    await expect(database.query('DELETE FROM autonomy_policy_versions')).rejects.toThrow(
      'append-only',
    );
  });

  it('snapshots the exact current control as version one when legacy history is empty', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-budget-empty-history-'));
    const files = (await readdir(sourceDirectory)).filter(
      (file) =>
        /^\d+_[a-z0-9_]+\.sql$/u.test(file) && file <= '0013_run3_automation_budget_ledger.sql',
    );
    for (const file of files) {
      await copyFile(join(sourceDirectory, file), join(temporaryDirectory, file));
    }
    database = await createPGliteDatabase();
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(13);
    const control = await database.query<
      {
        current_kill_switch: boolean;
        current_version: number;
        history_kill_switch: boolean;
        history_version: number;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT kill_switch FROM automation_global_control WHERE control_key = 'global')
           AS current_kill_switch,
         (SELECT version FROM automation_global_control WHERE control_key = 'global')
           AS current_version,
         (SELECT kill_switch FROM automation_global_control_history
          WHERE id = 'automation-global-control-migration-snapshot-0013')
           AS history_kill_switch,
         (SELECT control_version FROM automation_global_control_history
          WHERE id = 'automation-global-control-migration-snapshot-0013')
           AS history_version`,
    );
    expect(control.rows[0]).toEqual({
      current_kill_switch: true,
      current_version: 1,
      history_kill_switch: true,
      history_version: 1,
    });
  });
});
