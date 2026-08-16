import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DecisionRecord } from './checks';
import { createPGliteDatabase, type Database } from './database';
import { KnowledgeRepository } from './knowledge';
import { runMigrations } from './migrations';
import {
  PublicCheckRepository,
  type PublicCheckAttribution,
  type PublicCheckInteraction,
} from './public-checks';
import type { IdFactory } from './values';

const now = new Date('2026-08-16T12:00:00Z');
const decision: DecisionRecord = {
  risk: 'caution',
  summary: 'Some warning signs deserve an independent check.',
  evidence: [],
  actions: [
    {
      key: 'pause',
      priority: 1,
      title: 'Pause',
      detail: 'Stop before acting.',
      officialChannelOnly: false,
    },
  ],
  provider: { name: 'local-unknown', state: 'unknown', version: '2' },
  rulesetVersion: 'score-v2',
  evidenceSufficiency: 'limited',
  calibration: 'not_calibrated',
};

function sequentialIds(): IdFactory {
  let value = 0;
  return { next: (prefix) => `${prefix}_${String((value += 1)).padStart(4, '0')}` };
}

describe('privacy-bounded public Check persistence', () => {
  let database: Database;
  let repository: PublicCheckRepository;

  beforeEach(async () => {
    database = await createPGliteDatabase();
    await runMigrations(database);
    repository = new PublicCheckRepository(
      database,
      {
        encryptionKey: Buffer.alloc(32, 21),
        encryptionKeyVersion: 1,
        hmacKey: Buffer.alloc(32, 22),
        hmacKeyVersion: 1,
      },
      sequentialIds(),
      10,
    );
  });

  afterEach(async () => database.close());

  async function interaction(
    attribution: PublicCheckAttribution = { source: 'direct', campaign: 'none' },
  ): Promise<PublicCheckInteraction> {
    const clientKey = repository.clientKeyForNetworkAddress('198.51.100.10');
    const context = await repository.createContext({ attribution, clientKey, now });
    return repository.consumeContext({ token: context.token, clientKey, now });
  }

  it('mints a short-lived context and stores only content-free attribution and quota data', async () => {
    const clientKey = repository.clientKeyForNetworkAddress('198.51.100.10');
    const context = await repository.createContext({
      attribution: { source: 'campaign', campaign: 'launch_2026' },
      clientKey,
      now,
    });
    expect(context.remainingChecks).toBe(3);
    expect(context.expiresAt).toEqual(new Date('2026-08-16T12:10:00Z'));
    const serialized = JSON.stringify(
      await database.query<Record<string, unknown>>('SELECT * FROM public_check_contexts'),
    );
    expect(serialized).not.toContain(context.token);
    expect(serialized).not.toContain('content');

    await expect(
      repository.consumeContext({ token: context.token, clientKey, now }),
    ).resolves.toEqual(expect.objectContaining({ source: 'campaign', campaign: 'launch_2026' }));
    const quota = await database.query<{ used_count: number } & Record<string, unknown>>(
      `SELECT used_count FROM public_check_quota_buckets
       WHERE scope = 'global_public_check'`,
    );
    expect(quota.rows[0]?.used_count).toBe(1);
  });

  it('binds grants to privacy-HMAC clients and enforces client quotas independently', async () => {
    repository = new PublicCheckRepository(
      database,
      {
        encryptionKey: Buffer.alloc(32, 21),
        encryptionKeyVersion: 1,
        hmacKey: Buffer.alloc(32, 22),
        hmacKeyVersion: 1,
      },
      sequentialIds(),
      10,
      10,
      10,
      1,
    );
    const firstAddress = '198.51.100.21';
    const secondAddress = '198.51.100.22';
    const firstKey = repository.clientKeyForNetworkAddress(firstAddress);
    const secondKey = repository.clientKeyForNetworkAddress(secondAddress);
    const first = await repository.createContext({
      attribution: { source: 'direct', campaign: 'none' },
      clientKey: firstKey,
      now,
    });
    await expect(
      repository.createContext({
        attribution: { source: 'direct', campaign: 'none' },
        clientKey: firstKey,
        now,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      repository.createContext({
        attribution: { source: 'direct', campaign: 'none' },
        clientKey: secondKey,
        now,
      }),
    ).resolves.toEqual(expect.objectContaining({ remainingChecks: 3 }));
    await expect(
      repository.consumeContext({ token: first.token, clientKey: secondKey, now }),
    ).rejects.toMatchObject({ code: 'not_found' });
    const stored = JSON.stringify(
      await database.query<Record<string, unknown>>(
        'SELECT client_key_hmac FROM public_check_contexts ORDER BY id',
      ),
    );
    expect(stored).not.toContain(firstAddress);
    expect(stored).not.toContain(secondAddress);
  });

  it('holds bounded expiring analysis leases per client and globally', async () => {
    repository = new PublicCheckRepository(
      database,
      {
        encryptionKey: Buffer.alloc(32, 21),
        encryptionKeyVersion: 1,
        hmacKey: Buffer.alloc(32, 22),
        hmacKeyVersion: 1,
      },
      sequentialIds(),
      10,
      10,
      10,
      10,
      2,
      1,
    );
    const firstKey = repository.clientKeyForNetworkAddress('198.51.100.31');
    const secondKey = repository.clientKeyForNetworkAddress('198.51.100.32');
    const firstLease = await repository.acquireAnalysisLease({ clientKey: firstKey, now });
    await expect(
      repository.acquireAnalysisLease({ clientKey: firstKey, now }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(repository.acquireAnalysisLease({ clientKey: secondKey, now })).resolves.toMatch(
      /^public_analysis_lease_/u,
    );
    await repository.releaseAnalysisLease({ leaseId: firstLease, clientKey: firstKey });
    await expect(repository.acquireAnalysisLease({ clientKey: firstKey, now })).resolves.toMatch(
      /^public_analysis_lease_/u,
    );
  });

  it('encrypts a redacted transient result and stores neither content nor bearer token', async () => {
    const original = `verification code ${String(100_000 + 2345)}`;
    const redactedContent = 'verification code [ONE_TIME_CODE]; stop and verify';
    const grant = await repository.createResult({
      kind: 'text',
      redactedContent,
      decision,
      inputSafety: {
        redactions: [{ class: 'one_time_code', placeholder: '[ONE_TIME_CODE]', count: 1 }],
        flags: ['contained_one_time_code'],
      },
      interaction: await interaction(),
      now,
    });
    const stored = await database.query<Record<string, unknown>>(
      'SELECT * FROM public_check_results WHERE id = $1',
      [grant.id],
    );
    const serialized = JSON.stringify(stored.rows[0]);
    expect(serialized).not.toContain(redactedContent);
    expect(serialized).not.toContain(original);
    expect(serialized).not.toContain(grant.conversionToken);

    const active = await database.query<
      { state: string; encrypted_payload: string | null; conversion_hmac: string | null } & Record<
        string,
        unknown
      >
    >('SELECT state, encrypted_payload, conversion_hmac FROM public_check_results WHERE id = $1', [
      grant.id,
    ]);
    expect(active.rows[0]).toEqual(expect.objectContaining({ state: 'active' }));
  });

  it('rejects a result whose source does not match its consumed context', async () => {
    const genuine = await interaction({ source: 'direct', campaign: 'none' });
    await expect(
      repository.createResult({
        kind: 'text',
        redactedContent: 'bounded content',
        decision,
        inputSafety: { redactions: [], flags: [] },
        interaction: { ...genuine, source: 'partner' },
        now,
      }),
    ).rejects.toThrow();
  });

  it('refuses reserved risk and erases expired transient payloads', async () => {
    await expect(
      repository.createResult({
        kind: 'text',
        redactedContent: 'bounded content',
        decision: { ...decision, risk: 'lower_concern' },
        inputSafety: { redactions: [], flags: [] },
        interaction: await interaction(),
        now,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      repository.createResult({
        kind: 'text',
        redactedContent: `Stop before using card ${['4242', '4242', '4242', '4242'].join(' ')}.`,
        decision,
        inputSafety: { redactions: [], flags: [] },
        interaction: await interaction(),
        now,
      }),
    ).rejects.toMatchObject({ code: 'restricted_input' });
    const grant = await repository.createResult({
      kind: 'text',
      redactedContent: 'bounded content',
      decision,
      inputSafety: { redactions: [], flags: [] },
      interaction: await interaction(),
      now,
    });
    expect(await repository.purgeExpired(new Date(now.getTime() + 16 * 60_000))).toEqual(
      expect.objectContaining({ results: 1 }),
    );
    const wiped = await database.query<Record<string, unknown>>(
      `SELECT state, encrypted_payload, conversion_hmac
       FROM public_check_results WHERE id = $1`,
      [grant.id],
    );
    expect(wiped.rows[0]).toEqual({
      state: 'expired',
      encrypted_payload: null,
      conversion_hmac: null,
    });
  });

  it('physically removes terminal anonymous grants after the 24-hour horizon', async () => {
    const interactionValue = await interaction({ source: 'organic', campaign: 'none' });
    const grant = await repository.createResult({
      kind: 'text',
      redactedContent: 'bounded content',
      decision,
      inputSafety: { redactions: [], flags: [] },
      interaction: interactionValue,
      now,
    });
    await repository.purgeExpired(new Date(now.getTime() + 16 * 60_000));
    await repository.purgeExpired(new Date(now.getTime() + 25 * 60 * 60_000));
    const result = await database.query<Record<string, unknown>>(
      'SELECT id FROM public_check_results WHERE id = $1',
      [grant.id],
    );
    const context = await database.query<Record<string, unknown>>(
      'SELECT id FROM public_check_contexts WHERE id = $1',
      [interactionValue.contextId],
    );
    expect(result.rowCount).toBe(0);
    expect(context.rowCount).toBe(0);
  });
});

describe('governed knowledge persistence', () => {
  let database: Database;

  beforeEach(async () => {
    database = await createPGliteDatabase();
    await runMigrations(database);
  });

  afterEach(async () => database.close());

  it('keeps source-verified seed drafts out of runtime and admits reviewed 2.0 assets', async () => {
    const repository = new KnowledgeRepository(database, sequentialIds());
    expect(await repository.listRuntimeEligible({ locale: 'en-US', jurisdiction: 'US' })).toEqual(
      [],
    );
    const seeded = await repository.listAllVersions('knowledge_gift_card');
    expect(seeded).toHaveLength(1);
    expect(seeded[0]).toEqual(
      expect.objectContaining({
        lifecycle: 'draft',
        reviewState: 'source_verified',
        authoringVersion: 'run-2-curation-v1',
      }),
    );

    await repository.createVersion({
      assetKey: 'knowledge_test_reviewed',
      version: 1,
      locale: 'en-US',
      jurisdiction: 'US',
      lifecycle: 'active',
      reviewState: 'independently_reviewed',
      sourcePublisher: 'United States Federal Trade Commission',
      sourceUrl: 'https://consumer.ftc.gov/articles/how-avoid-scam',
      sourceRetrievedAt: now,
      rightsBasis: 'Official public guidance; project-authored paraphrase',
      authoringVersion: 'run-2-curation-v1',
      content: {
        title: 'Pause and verify',
        summary: 'Unexpected requests should be verified through an independent official channel.',
        defensiveActions: ['Pause before sending money or information.'],
      },
      reviews: [
        {
          reviewerReference: 'source-reviewer',
          reviewKind: 'source',
          decision: 'approve',
          notes: 'Source verified.',
          reviewedAt: now,
        },
        {
          reviewerReference: 'domain-reviewer',
          reviewKind: 'domain',
          decision: 'approve',
          notes: 'Domain guidance approved.',
          reviewedAt: now,
        },
        {
          reviewerReference: 'domain-reviewer',
          reviewKind: 'rights',
          decision: 'approve',
          notes: 'Rights basis approved.',
          reviewedAt: now,
        },
      ],
      now,
    });
    const eligible = await repository.listRuntimeEligible({
      locale: 'en-US',
      jurisdiction: 'US',
    });
    expect(eligible.map((asset) => asset.assetKey)).toContain('knowledge_test_reviewed');
    expect(JSON.stringify(eligible)).not.toContain('reference/boomerbuddy-v1');
  });

  it('enforces independent release review and append-only evidence', async () => {
    const repository = new KnowledgeRepository(database, sequentialIds());
    await expect(
      repository.createVersion({
        assetKey: 'knowledge_unreviewed',
        version: 1,
        locale: 'en-US',
        jurisdiction: 'US',
        lifecycle: 'active',
        reviewState: 'independently_reviewed',
        sourcePublisher: 'Official source',
        sourceUrl: 'https://example.gov/guidance',
        sourceRetrievedAt: now,
        rightsBasis: 'Official public guidance',
        authoringVersion: 'run-2-curation-v1',
        content: {
          title: 'Test',
          summary: 'A bounded project-authored test summary.',
          defensiveActions: ['Pause.'],
        },
        now,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      database.query(
        `UPDATE knowledge_assets SET lifecycle = 'active'
         WHERE id = 'knowledge_gift_card_v1'`,
      ),
    ).rejects.toThrow('append-only');
  });
});
