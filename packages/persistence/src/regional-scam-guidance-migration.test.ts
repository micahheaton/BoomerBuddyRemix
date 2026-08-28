import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createPGliteDatabase, type Database } from './database';
import { migrationDirectory, runMigrations } from './migrations';

const migration = '0042_run3_1_regional_scam_guidance.sql';

const regionalBriefs = [
  {
    briefKey: 'az-crypto-atm-payment-demand',
    regionCode: 'US-AZ',
    sourceUrl:
      'https://www.azag.gov/press-release/attorney-general-mayes-better-business-bureau-warn-arizonans-about-crypto-atm-scams',
    sourcePublishedAt: '2026-03-25T12:00:00.000Z',
  },
  {
    briefKey: 'il-fake-traffic-toll-text',
    regionCode: 'US-IL',
    sourceUrl:
      'https://illinoisattorneygeneral.gov/news/story/consumer-alert-attorney-general-raoul-urges-illinoisans-to-be-alert-for-text-message-scams-involving-fake-traffic-violations',
    sourcePublishedAt: '2026-03-30T12:00:00.000Z',
  },
  {
    briefKey: 'ny-gold-bar-account-emergency',
    regionCode: 'US-NY',
    sourceUrl:
      'https://ag.ny.gov/press-release/2026/attorney-general-james-warns-new-yorkers-gold-bar-scam-targeting-seniors',
    sourcePublishedAt: '2026-08-07T12:00:00.000Z',
  },
  {
    briefKey: 'pa-cash-courier-emergency',
    regionCode: 'US-PA',
    sourceUrl:
      'https://www.attorneygeneral.gov/taking-action/attorney-general-sunday-warns-pennsylvanians-of-cash-scams-involving-trusted-person-pickups/',
    sourcePublishedAt: '2026-04-20T12:00:00.000Z',
  },
] as const;

describe('regional scam guidance migration', () => {
  let database: Database | undefined;
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
    if (temporaryDirectory !== undefined) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = undefined;
    }
  });

  async function installPreviousMigrations(): Promise<{
    readonly sourceDirectory: string;
    readonly database: Database;
  }> {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-regional-guidance-'));
    const previous = (await readdir(sourceDirectory))
      .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file) && file < migration)
      .sort((left, right) => left.localeCompare(right));
    for (const file of previous) {
      await copyFile(join(sourceDirectory, file), join(temporaryDirectory, file));
    }
    database = await createPGliteDatabase();
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(41);
    return { sourceDirectory, database };
  }

  it('adds four immutable in-app-only briefs after the 0041 frontier', async () => {
    const installed = await installPreviousMigrations();
    await copyFile(
      join(installed.sourceDirectory, migration),
      join(temporaryDirectory!, migration),
    );

    await expect(runMigrations(installed.database, temporaryDirectory!)).resolves.toEqual([
      migration,
    ]);
    await expect(runMigrations(installed.database, temporaryDirectory!)).resolves.toEqual([]);

    const result = await installed.database.query<
      {
        readonly brief_key: string;
        readonly region_code: string;
        readonly source_url: string;
        readonly source_published_at: unknown;
        readonly reviewed_at: unknown;
        readonly published_at: unknown;
        readonly expires_at: unknown;
        readonly safe_action_count: number;
        readonly source_kind: string;
        readonly review_state: string;
        readonly publication_state: string;
        readonly automation_generated: boolean;
        readonly external_delivery_permitted: boolean;
      } & Record<string, unknown>
    >(
      `SELECT brief_key, region_code, source_url, source_published_at, reviewed_at,
              published_at, expires_at, jsonb_array_length(safe_actions)::integer AS safe_action_count,
              source_kind, review_state, publication_state, automation_generated,
              external_delivery_permitted
       FROM member_scam_guidance_briefs
       WHERE brief_key = ANY($1::text[])
       ORDER BY region_code`,
      [regionalBriefs.map((brief) => brief.briefKey)],
    );

    expect(result.rows).toHaveLength(4);
    expect(
      result.rows.map((row) => ({
        briefKey: row.brief_key,
        regionCode: row.region_code,
        sourceUrl: row.source_url,
        sourcePublishedAt: new Date(String(row.source_published_at)).toISOString(),
      })),
    ).toEqual(regionalBriefs);
    for (const row of result.rows) {
      expect(row.safe_action_count).toBe(4);
      expect(row.source_kind).toBe('public_official');
      expect(row.review_state).toBe('approved');
      expect(row.publication_state).toBe('in_app_only');
      expect(row.automation_generated).toBe(false);
      expect(row.external_delivery_permitted).toBe(false);
      expect(new Date(String(row.source_published_at)) <= new Date(String(row.reviewed_at))).toBe(
        true,
      );
      expect(new Date(String(row.reviewed_at)) <= new Date(String(row.published_at))).toBe(true);
      expect(new Date(String(row.published_at)) < new Date(String(row.expires_at))).toBe(true);
    }
  }, 90_000);

  it('rejects a conflicting immutable row and rolls back every new insert', async () => {
    const installed = await installPreviousMigrations();
    await installed.database.query(
      `INSERT INTO member_scam_guidance_briefs(
         brief_key, version, region_code, title, summary, safe_actions,
         source_title, source_url, source_published_at, reviewed_at,
         published_at, expires_at, source_kind, review_state, publication_state,
         automation_generated, external_delivery_permitted, created_at
       ) VALUES (
         'az-crypto-atm-payment-demand',1,'US-AZ','Conflicting title','Synthetic conflict probe',
         '["Stop"]'::jsonb,'Synthetic source','https://example.invalid/conflict',
         '2026-03-25T12:00:00.000Z','2026-08-28T07:28:00.000Z',
         '2026-08-28T07:28:00.000Z','2026-11-26T12:00:00.000Z',
         'public_official','approved','in_app_only',false,false,
         '2026-08-28T07:28:00.000Z'
       )`,
    );
    await copyFile(
      join(installed.sourceDirectory, migration),
      join(temporaryDirectory!, migration),
    );

    await expect(runMigrations(installed.database, temporaryDirectory!)).rejects.toThrow(
      'Regional member scam guidance catalogue conflict',
    );
    const rows = await installed.database.query<
      { readonly brief_key: string } & Record<string, unknown>
    >(
      `SELECT brief_key FROM member_scam_guidance_briefs
       WHERE brief_key = ANY($1::text[]) ORDER BY brief_key`,
      [regionalBriefs.map((brief) => brief.briefKey)],
    );
    expect(rows.rows).toEqual([{ brief_key: 'az-crypto-atm-payment-demand' }]);
    const ledger = await installed.database.query<
      { readonly count: number } & Record<string, unknown>
    >('SELECT count(*)::integer AS count FROM schema_migrations WHERE version = $1', [migration]);
    expect(ledger.rows[0]?.count).toBe(0);
  }, 90_000);
});
