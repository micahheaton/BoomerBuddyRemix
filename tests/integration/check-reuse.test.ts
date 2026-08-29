import type { CreateCheckResponse } from '@boomerbuddy/contracts';
import { checkAnalysisReuseWindowMs, LocalUnknownProvider } from '@boomerbuddy/fraud';
import type { SqlExecutor } from '@boomerbuddy/persistence';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserHeaders, createApiHarness, login, type ApiHarness } from './support';

async function submitCheck(harness: ApiHarness, cookie: string, content: string, refresh = false) {
  return harness.app.inject({
    method: 'POST',
    url: '/v1/checks',
    headers: browserHeaders(cookie),
    payload: { kind: 'text', content, ...(refresh ? { refresh: true } : {}) },
  });
}

async function submitUrlCheck(harness: ApiHarness, cookie: string, content: string) {
  return harness.app.inject({
    method: 'POST',
    url: '/v1/checks',
    headers: browserHeaders(cookie),
    payload: { kind: 'url', content },
  });
}

describe('authenticated Check analysis reuse', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await harness?.close();
    harness = undefined;
  });

  it('returns a fresh exact Check without rerunning analysis and explicitly refreshes with 201', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const inspect = vi.spyOn(LocalUnknownProvider.prototype, 'inspect');
    const content = 'Exact reuse regression asks me to act now and buy a gift card.';

    const created = await submitCheck(harness, alice.cookie as string, content);
    const first = created.json<CreateCheckResponse>();
    expect(created.statusCode).toBe(201);
    expect(first.analysis).toEqual({
      reused: false,
      source: 'new',
      analyzedAt: '2026-08-15T12:00:00.000Z',
      refreshAfter: '2026-08-16T12:00:00.000Z',
    });
    expect(inspect).toHaveBeenCalledTimes(1);

    const reused = await submitCheck(harness, alice.cookie as string, content);
    const second = reused.json<CreateCheckResponse>();
    expect(reused.statusCode).toBe(200);
    expect(second.check.id).toBe(first.check.id);
    expect(second.analysis).toEqual({
      reused: true,
      source: 'recent_owned',
      analyzedAt: first.analysis.analyzedAt,
      refreshAfter: first.analysis.refreshAfter,
    });
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(reused.body).not.toContain(content);
    expect(reused.body).not.toMatch(/fingerprint|encrypted_content/iu);

    const refreshed = await submitCheck(harness, alice.cookie as string, content, true);
    const third = refreshed.json<CreateCheckResponse>();
    expect(refreshed.statusCode).toBe(201);
    expect(third.check.id).not.toBe(first.check.id);
    expect(third.analysis.reused).toBe(false);
    expect(inspect).toHaveBeenCalledTimes(2);

    const normalizedUrl = await submitUrlCheck(
      harness,
      alice.cookie as string,
      'https://example.com/',
    );
    const friendlyUrl = await submitUrlCheck(harness, alice.cookie as string, 'example.com');
    expect(normalizedUrl.statusCode).toBe(201);
    expect(friendlyUrl.statusCode).toBe(200);
    expect(friendlyUrl.json<CreateCheckResponse>().check.id).toBe(
      normalizedUrl.json<CreateCheckResponse>().check.id,
    );
    expect(inspect).toHaveBeenCalledTimes(3);
  }, 20_000);

  it('rechecks freshness with a timestamp sampled after the serialization lock', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const content = 'Lock wait boundary regression asks for an urgent gift card purchase.';
    const created = await submitCheck(harness, alice.cookie as string, content);
    const first = created.json<CreateCheckResponse>();
    const refreshAfter = new Date(first.analysis.refreshAfter as string);
    harness.clock.set(new Date(refreshAfter.getTime() - 1));
    const freshSession = await login(harness.app, 'owner-alice');

    const originalTransaction = harness.database.transaction.bind(harness.database);
    let advanced = false;
    vi.spyOn(harness.database, 'transaction').mockImplementation((work) =>
      originalTransaction(async (transaction) => {
        const wrappedTransaction: SqlExecutor = {
          query: async <Row extends Record<string, unknown>>(
            sql: string,
            parameters?: readonly unknown[],
          ) => {
            const result = await transaction.query<Row>(sql, parameters);
            if (!advanced && sql.includes('pg_advisory_xact_lock')) {
              advanced = true;
              harness?.clock.advance(2);
            }
            return result;
          },
          exec: (sql) => transaction.exec(sql),
        };
        return work(wrappedTransaction);
      }),
    );

    const replacement = await submitCheck(harness, freshSession.cookie as string, content);
    const second = replacement.json<CreateCheckResponse>();
    expect(advanced).toBe(true);
    expect(replacement.statusCode).toBe(201);
    expect(second.check.id).not.toBe(first.check.id);
    expect(second.analysis.analyzedAt).toBe(new Date(refreshAfter.getTime() + 1).toISOString());
  });

  it('does not collide literal placeholders with content that was actually redacted', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const inspect = vi.spyOn(LocalUnknownProvider.prototype, 'inspect');
    const literal = 'Urgent request says card [PAYMENT_CARD] now.';
    const sensitive = 'Urgent request says card 4242 4242 4242 4242 now.';

    const literalResult = await submitCheck(harness, alice.cookie as string, literal);
    const sensitiveResult = await submitCheck(harness, alice.cookie as string, sensitive);
    const sensitiveReuse = await submitCheck(harness, alice.cookie as string, sensitive);

    expect(literalResult.statusCode).toBe(201);
    expect(sensitiveResult.statusCode).toBe(201);
    expect(sensitiveReuse.statusCode).toBe(200);
    expect(sensitiveResult.json<CreateCheckResponse>().check.id).not.toBe(
      literalResult.json<CreateCheckResponse>().check.id,
    );
    expect(sensitiveReuse.json<CreateCheckResponse>().check.id).toBe(
      sensitiveResult.json<CreateCheckResponse>().check.id,
    );
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it('serializes concurrent exact submissions into one analysis', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const inspect = vi.spyOn(LocalUnknownProvider.prototype, 'inspect');
    const content = 'Concurrent retry regression asks for an urgent wire transfer.';

    const [left, right] = await Promise.all([
      submitCheck(harness, alice.cookie as string, content),
      submitCheck(harness, alice.cookie as string, content),
    ]);
    expect([left.statusCode, right.statusCode].sort()).toEqual([200, 201]);
    expect(left.json<CreateCheckResponse>().check.id).toBe(
      right.json<CreateCheckResponse>().check.id,
    );
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it('does not reuse expired, stale-provenance, wrong-key-version, or deleted rows', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    let cookie = alice.cookie as string;
    const freshnessWindowMs = checkAnalysisReuseWindowMs(new LocalUnknownProvider().manifest);

    const expiredContent = 'Freshness boundary regression with an urgent transfer request.';
    const expiredOriginal = await submitCheck(harness, cookie, expiredContent);
    expect(expiredOriginal.statusCode).toBe(201);
    const expiredOriginalId = expiredOriginal.json<CreateCheckResponse>().check.id;
    harness.clock.advance(freshnessWindowMs);
    cookie = (await login(harness.app, 'owner-alice')).cookie as string;
    const expiredReplacement = await submitCheck(harness, cookie, expiredContent);
    expect(expiredReplacement.statusCode).toBe(201);
    expect(expiredReplacement.json<CreateCheckResponse>().check.id).not.toBe(expiredOriginalId);

    const provenanceContent = 'Pipeline provenance regression with an urgent cash request.';
    const provenanceOriginal = await submitCheck(harness, cookie, provenanceContent);
    const provenanceOriginalId = provenanceOriginal.json<CreateCheckResponse>().check.id;
    await harness.database.query(
      `UPDATE analyses SET reuse_provenance_key = 'check-reuse-v1:prior' WHERE id = $1`,
      [provenanceOriginalId],
    );
    const provenanceReplacement = await submitCheck(harness, cookie, provenanceContent);
    expect(provenanceReplacement.statusCode).toBe(201);
    expect(provenanceReplacement.json<CreateCheckResponse>().check.id).not.toBe(
      provenanceOriginalId,
    );

    const keyContent = 'Fingerprint key version regression with an urgent bank call request.';
    const keyOriginal = await submitCheck(harness, cookie, keyContent);
    const keyOriginalId = keyOriginal.json<CreateCheckResponse>().check.id;
    await harness.database.query(
      `UPDATE artifacts SET fingerprint_key_version = 2
       WHERE household_id = 'household-sunrise'
         AND id = (SELECT artifact_id FROM analyses WHERE id = $1)`,
      [keyOriginalId],
    );
    const keyReplacement = await submitCheck(harness, cookie, keyContent);
    expect(keyReplacement.statusCode).toBe(201);
    expect(keyReplacement.json<CreateCheckResponse>().check.id).not.toBe(keyOriginalId);

    const deletedContent = 'Deleted Check regression with an urgent cryptocurrency request.';
    const deletedOriginal = await submitCheck(harness, cookie, deletedContent);
    const deletedOriginalId = deletedOriginal.json<CreateCheckResponse>().check.id;
    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/checks/${deletedOriginalId}`,
      headers: browserHeaders(cookie),
    });
    expect(deleted.statusCode).toBe(200);
    const deletedReplacement = await submitCheck(harness, cookie, deletedContent);
    expect(deletedReplacement.statusCode).toBe(201);
    expect(deletedReplacement.json<CreateCheckResponse>().check.id).not.toBe(deletedOriginalId);
  }, 30_000);

  it('isolates reuse by actor within a household and by household tenant', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const pat = await login(harness.app, 'protected-pat');
    const olivia = await login(harness.app, 'protected-olivia');
    const inspect = vi.spyOn(LocalUnknownProvider.prototype, 'inspect');
    const content = 'Tenant isolation regression asks for an immediate wire transfer.';

    const aliceCheck = await submitCheck(harness, alice.cookie as string, content);
    const patCheck = await submitCheck(harness, pat.cookie as string, content);
    const patReuse = await submitCheck(harness, pat.cookie as string, content);
    const oliviaCheck = await submitCheck(harness, olivia.cookie as string, content);
    const oliviaReuse = await submitCheck(harness, olivia.cookie as string, content);

    expect(aliceCheck.statusCode).toBe(201);
    expect(patCheck.statusCode).toBe(201);
    expect(patReuse.statusCode).toBe(200);
    expect(oliviaCheck.statusCode).toBe(201);
    expect(oliviaReuse.statusCode).toBe(200);
    const aliceId = aliceCheck.json<CreateCheckResponse>().check.id;
    const patId = patCheck.json<CreateCheckResponse>().check.id;
    const oliviaId = oliviaCheck.json<CreateCheckResponse>().check.id;
    expect(patId).not.toBe(aliceId);
    expect(patReuse.json<CreateCheckResponse>().check.id).toBe(patId);
    expect(oliviaId).not.toBe(aliceId);
    expect(oliviaId).not.toBe(patId);
    expect(oliviaReuse.json<CreateCheckResponse>().check.id).toBe(oliviaId);
    expect(inspect).toHaveBeenCalledTimes(3);
  }, 20_000);
});
