import type { FastifyInstance } from 'fastify';
import { AccessIntentRepository } from '@boomerbuddy/persistence';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiHarness, customerOrigin, hqOrigin, login, type ApiHarness } from './support';

const directRequest = {
  purpose: 'private_beta_access_request',
  attribution: { source: 'direct', campaign: 'none' },
} as const;

let operationSequence = 0;

function nextOperationKey(): string {
  operationSequence += 1;
  return `access-intent:00000000-0000-4000-8000-${String(operationSequence).padStart(12, '0')}`;
}

async function createIntent(
  app: FastifyInstance,
  input: {
    readonly payload?: unknown;
    readonly origin?: string;
    readonly operationKey?: string;
    readonly remoteAddress?: string;
  } = {},
) {
  return app.inject({
    method: 'POST',
    url: '/v1/public/access-intents',
    headers: {
      ...(input.origin === undefined ? {} : { origin: input.origin }),
      'idempotency-key': input.operationKey ?? nextOperationKey(),
    },
    payload: input.payload ?? directRequest,
    remoteAddress: input.remoteAddress ?? '198.51.100.44',
  });
}

describe('private-beta access-intent receipts', () => {
  let harness: ApiHarness;

  beforeEach(async () => {
    harness = await createApiHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('creates one durable content-free intent receipt without an account or outbound message', async () => {
    const outboxBefore = await harness.database.query<{ readonly count: number }>(
      'SELECT count(*)::integer AS count FROM outbox_events',
    );
    const response = await createIntent(harness.app, { origin: customerOrigin });

    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toContain('no-store');
    const body = response.json<{
      intent: {
        receiptCode: string;
        lifecycle: string;
        outboundMessage: string;
        createdAt: string;
        expiresAt: string;
      };
    }>();
    expect(body.intent).toMatchObject({
      lifecycle: 'intent_created',
      outboundMessage: 'not_sent',
    });
    expect(body.intent.receiptCode).toMatch(/^access_intent_[A-Za-z0-9_-]{32}$/u);
    expect(
      new Date(body.intent.expiresAt).getTime() - new Date(body.intent.createdAt).getTime(),
    ).toBe(7 * 24 * 60 * 60_000);

    const rows = await harness.database.query<Record<string, unknown>>(
      'SELECT * FROM private_beta_access_intent_receipts',
    );
    expect(rows.rows).toEqual([
      {
        receipt_code: body.intent.receiptCode,
        operation_key_hmac: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
        request_digest: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
        purpose: 'private_beta_access_request',
        attribution_source: 'direct',
        attribution_campaign: 'none',
        lifecycle_state: 'intent_created',
        created_at: expect.anything(),
        expires_at: expect.anything(),
      },
    ]);
    const columns = await harness.database.query<{ readonly column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'private_beta_access_intent_receipts'
       ORDER BY ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'receipt_code',
      'operation_key_hmac',
      'request_digest',
      'purpose',
      'attribution_source',
      'attribution_campaign',
      'lifecycle_state',
      'created_at',
      'expires_at',
    ]);
    expect(response.body).not.toMatch(
      /support@|email|phone|messageBody|customerId|clerk|198\.51\.100\.44/iu,
    );

    const networkBucket = await harness.database.query<{ readonly scope_key_hmac: string }>(
      `SELECT scope_key_hmac FROM private_beta_access_intent_rate_buckets
       WHERE scope = 'network'`,
    );
    expect(networkBucket.rows[0]?.scope_key_hmac).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(networkBucket.rows[0]?.scope_key_hmac).not.toBe('198.51.100.44');
    const outboxAfter = await harness.database.query<{ readonly count: number }>(
      'SELECT count(*)::integer AS count FROM outbox_events',
    );
    expect(outboxAfter.rows).toEqual(outboxBefore.rows);
  });

  it('does not register the public mutation when the fail-closed runtime switch is off', async () => {
    await harness.close();
    harness = await createApiHarness(undefined, { accessIntentsEnabled: false });

    const response = await createIntent(harness.app, { origin: customerOrigin });
    expect(response.statusCode).toBe(404);
    const receipts = await harness.database.query<{ readonly count: number }>(
      'SELECT count(*)::integer AS count FROM private_beta_access_intent_receipts',
    );
    expect(receipts.rows).toEqual([{ count: 0 }]);

    const hqProjection = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/access-intents',
      headers: { origin: hqOrigin },
    });
    expect(hqProjection.statusCode).toBe(401);
  });

  it('does not register the mutation when edge evidence is absent even if runtime is requested', async () => {
    await harness.close();
    harness = await createApiHarness(undefined, {
      accessIntentsEnabled: true,
      accessIntentsEdgeGuardConfirmed: false,
    });

    const response = await createIntent(harness.app, { origin: customerOrigin });
    expect(response.statusCode).toBe(404);
  });

  it('rejects the process-local rate ceiling before entering the repository gate', async () => {
    await harness.close();
    harness = await createApiHarness(undefined, { accessIntentRequestLimitPerMinute: 1 });

    const first = await createIntent(harness.app, { origin: customerOrigin });
    const rejected = await createIntent(harness.app, { origin: customerOrigin });

    expect(first.statusCode).toBe(201);
    expect(rejected.statusCode).toBe(429);
    expect(rejected.headers['cache-control']).toContain('no-store');
    expect(rejected.headers['retry-after']).toMatch(/^\d+$/u);
    expect(rejected.json()).toMatchObject({
      error: {
        code: 'rate_limited',
        message: 'Early-access requests are temporarily limited',
      },
    });
    const receipts = await harness.database.query<{ readonly count: number }>(
      'SELECT count(*)::integer AS count FROM private_beta_access_intent_receipts',
    );
    const quota = await harness.database.query<{ readonly used_count: number }>(
      'SELECT used_count FROM private_beta_access_intent_rate_buckets ORDER BY scope',
    );
    expect(receipts.rows).toEqual([{ count: 1 }]);
    expect(quota.rows).toEqual([{ used_count: 1 }, { used_count: 1 }]);
  });

  it('returns the same receipt for a retried operation without double-counting intent', async () => {
    const operationKey = nextOperationKey();
    const [first, retry] = await Promise.all([
      createIntent(harness.app, { origin: customerOrigin, operationKey }),
      createIntent(harness.app, { origin: customerOrigin, operationKey }),
    ]);

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    const receipts = await harness.database.query<{ readonly count: number }>(
      'SELECT count(*)::integer AS count FROM private_beta_access_intent_receipts',
    );
    const aggregates = await harness.database.query<{ readonly event_count: number }>(
      'SELECT event_count FROM private_beta_access_intent_aggregates',
    );
    const quotas = await harness.database.query<{ readonly used_count: number }>(
      `SELECT used_count FROM private_beta_access_intent_rate_buckets
       ORDER BY scope`,
    );
    expect(receipts.rows).toEqual([{ count: 1 }]);
    expect(aggregates.rows).toEqual([{ event_count: 1 }]);
    expect(quotas.rows).toEqual([{ used_count: 1 }, { used_count: 1 }]);
    expect(
      JSON.stringify(
        await harness.database.query<Record<string, unknown>>(
          'SELECT operation_key_hmac, request_digest FROM private_beta_access_intent_receipts',
        ),
      ),
    ).not.toContain(operationKey);

    const conflicting = await createIntent(harness.app, {
      origin: customerOrigin,
      operationKey,
      payload: {
        purpose: 'private_beta_access_request',
        attribution: { source: 'organic', campaign: 'none' },
      },
    });
    expect(conflicting.statusCode).toBe(409);
  });

  it('returns the same receipt after a network change without consuming another quota or count', async () => {
    const operationKey = nextOperationKey();
    const first = await createIntent(harness.app, {
      origin: customerOrigin,
      operationKey,
      remoteAddress: '198.51.100.10',
    });
    const moved = await createIntent(harness.app, {
      origin: customerOrigin,
      operationKey,
      remoteAddress: '203.0.113.10',
    });

    expect(first.statusCode).toBe(201);
    expect(moved.statusCode).toBe(201);
    expect(moved.json()).toEqual(first.json());
    const receipts = await harness.database.query<{ readonly count: number }>(
      'SELECT count(*)::integer AS count FROM private_beta_access_intent_receipts',
    );
    const aggregates = await harness.database.query<{ readonly event_count: number }>(
      'SELECT event_count FROM private_beta_access_intent_aggregates',
    );
    const networkBuckets = await harness.database.query<{ readonly count: number }>(
      `SELECT count(*)::integer AS count
       FROM private_beta_access_intent_rate_buckets WHERE scope = 'network'`,
    );
    expect(receipts.rows).toEqual([{ count: 1 }]);
    expect(aggregates.rows).toEqual([{ event_count: 1 }]);
    expect(networkBuckets.rows).toEqual([{ count: 1 }]);
  });

  it('fails closed on missing origin, extra content, and unrecognized attribution', async () => {
    const cases = [
      { payload: directRequest, expected: 403 },
      {
        origin: customerOrigin,
        payload: { ...directRequest, email: 'forbidden' },
        expected: 400,
      },
      {
        origin: customerOrigin,
        payload: {
          ...directRequest,
          attribution: { source: 'campaign', campaign: 'none' },
        },
        expected: 400,
      },
      {
        origin: customerOrigin,
        operationKey: 'invalid',
        payload: directRequest,
        expected: 400,
      },
      {
        origin: customerOrigin,
        payload: {
          ...directRequest,
          attribution: { source: 'unknown', campaign: 'none' },
        },
        expected: 400,
      },
    ] as const;
    for (const input of cases) {
      const response = await createIntent(harness.app, input);
      expect(response.statusCode).toBe(input.expected);
    }
    const receipts = await harness.database.query<{ readonly count: number }>(
      'SELECT count(*)::integer AS count FROM private_beta_access_intent_receipts',
    );
    expect(receipts.rows).toEqual([{ count: 0 }]);
  });

  it('limits one network atomically without storing its raw address', async () => {
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        createIntent(harness.app, {
          origin: customerOrigin,
          remoteAddress: '203.0.113.82',
        }),
      ),
    );
    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(5);
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(1);
    const receipts = await harness.database.query<{ readonly count: number }>(
      'SELECT count(*)::integer AS count FROM private_beta_access_intent_receipts',
    );
    expect(receipts.rows).toEqual([{ count: 5 }]);
    const serialized = JSON.stringify(
      await harness.database.query<Record<string, unknown>>(
        'SELECT * FROM private_beta_access_intent_rate_buckets',
      ),
    );
    expect(serialized).not.toContain('203.0.113.82');
  });

  it('limits the global hourly quota atomically across distinct network buckets', async () => {
    const repository = new AccessIntentRepository(harness.database, Buffer.alloc(32, 19), 2, 2);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 3 }, (_, index) =>
        repository.create({
          purpose: 'private_beta_access_request',
          attribution: { source: 'direct', campaign: 'none' },
          clientKey: repository.clientKeyForNetworkAddress(`203.0.113.${index + 10}`),
          operationKey: nextOperationKey(),
          now: harness.clock.now(),
        }),
      ),
    );

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(2);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected).toBeDefined();
    if (rejected?.status !== 'rejected') throw new Error('Expected one global quota rejection');
    expect(rejected.reason).toMatchObject({ code: 'conflict' });

    const receipts = await harness.database.query<{ readonly count: number }>(
      'SELECT count(*)::integer AS count FROM private_beta_access_intent_receipts',
    );
    const aggregate = await harness.database.query<{ readonly event_count: number }>(
      'SELECT event_count FROM private_beta_access_intent_aggregates',
    );
    const globalBucket = await harness.database.query<{ readonly used_count: number }>(
      `SELECT used_count FROM private_beta_access_intent_rate_buckets
       WHERE scope = 'global'`,
    );
    const networkBuckets = await harness.database.query<{ readonly count: number }>(
      `SELECT count(*)::integer AS count FROM private_beta_access_intent_rate_buckets
       WHERE scope = 'network'`,
    );
    expect(receipts.rows).toEqual([{ count: 2 }]);
    expect(aggregate.rows).toEqual([{ event_count: 2 }]);
    expect(globalBucket.rows).toEqual([{ used_count: 2 }]);
    expect(networkBuckets.rows).toEqual([{ count: 2 }]);
  });

  it('deletes expired state in bounded batches and reports continuation without returning codes', async () => {
    for (let index = 0; index < 3; index += 1) {
      expect((await createIntent(harness.app, { origin: customerOrigin })).statusCode).toBe(201);
    }
    harness.clock.advance(8 * 24 * 60 * 60_000 + 1);
    const repository = new AccessIntentRepository(harness.database, Buffer.alloc(32, 11));

    const first = await repository.purgeExpired(harness.clock.now(), 2);
    expect(first).toEqual({
      receiptsDeleted: 2,
      rateBucketsDeleted: 2,
      aggregatesDeleted: 0,
      saturated: true,
    });
    const afterFirst = await harness.database.query<{ readonly count: number }>(
      'SELECT count(*)::integer AS count FROM private_beta_access_intent_receipts',
    );
    expect(afterFirst.rows).toEqual([{ count: 1 }]);

    const second = await repository.purgeExpired(harness.clock.now(), 2);
    expect(second).toEqual({
      receiptsDeleted: 1,
      rateBucketsDeleted: 0,
      aggregatesDeleted: 0,
      saturated: false,
    });
    const afterSecond = await harness.database.query<{ readonly count: number }>(
      'SELECT count(*)::integer AS count FROM private_beta_access_intent_receipts',
    );
    expect(afterSecond.rows).toEqual([{ count: 0 }]);
  });

  it('enforces immutable receipt rows and exact attribution pairs in migration 0032', async () => {
    await createIntent(harness.app, { origin: customerOrigin });
    await expect(
      harness.database.query(
        "UPDATE private_beta_access_intent_receipts SET attribution_source = 'organic'",
      ),
    ).rejects.toThrow('immutable');
    await expect(
      harness.database.query(
        `INSERT INTO private_beta_access_intent_aggregates(
           bucket_start, attribution_source, attribution_campaign, event_kind, event_count
         ) VALUES ('2026-08-15','campaign','none','intent_created',1)`,
      ),
    ).rejects.toThrow();
  });

  it('exposes only content-free receipt correlation to an active HQ owner', async () => {
    const created = await createIntent(harness.app, {
      origin: customerOrigin,
      payload: {
        purpose: 'private_beta_access_request',
        attribution: { source: 'campaign', campaign: 'launch_2026' },
      },
    });
    const receiptCode = created.json<{ intent: { receiptCode: string } }>().intent.receiptCode;

    const anonymous = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/access-intents',
      headers: { origin: hqOrigin },
    });
    expect(anonymous.statusCode).toBe(401);

    const support = await login(harness.app, 'hq-sam', 'hq');
    const denied = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/access-intents',
      headers: { cookie: support.cookie as string, origin: hqOrigin },
    });
    expect(denied.statusCode).toBe(403);

    const owner = await login(harness.app, 'hq-heidi', 'hq');
    const allowed = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/access-intents',
      headers: { cookie: owner.cookie as string, origin: hqOrigin },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers['cache-control']).toContain('no-store');
    expect(allowed.json()).toMatchObject({
      projection: 'content_free_access_intents',
      intents: [
        {
          receiptCode,
          lifecycle: 'intent_created',
          attribution: { source: 'campaign', campaign: 'launch_2026' },
        },
      ],
      truncated: false,
    });
    expect(allowed.body).not.toMatch(/email|phone|message|customer|clerk/iu);
    const audit = await harness.database.query<{
      readonly actor_person_id: string;
      readonly resource_id: string;
    }>(
      `SELECT actor_person_id, resource_id FROM audit_events
       WHERE action = 'hq.metadata_projection.read'
         AND resource_id = 'owner_access_intents'`,
    );
    expect(audit.rows).toEqual([
      { actor_person_id: 'person-hq-heidi', resource_id: 'owner_access_intents' },
    ]);

    harness.clock.advance(7 * 24 * 60 * 60_000 + 1);
    const refreshedOwner = await login(harness.app, 'hq-heidi', 'hq');
    const expired = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/access-intents',
      headers: { cookie: refreshedOwner.cookie as string, origin: hqOrigin },
    });
    expect(expired.json<{ intents: Array<{ lifecycle: string }> }>().intents[0]?.lifecycle).toBe(
      'expired',
    );

    harness.clock.advance(24 * 60 * 60_000 + 1);
    const cleanupTrigger = await createIntent(harness.app, {
      origin: customerOrigin,
      remoteAddress: '198.51.100.99',
    });
    expect(cleanupTrigger.statusCode).toBe(201);
    const retained = await harness.database.query<{ readonly receipt_code: string }>(
      `SELECT receipt_code FROM private_beta_access_intent_receipts
       ORDER BY receipt_code`,
    );
    expect(retained.rows).toHaveLength(1);
    expect(retained.rows[0]?.receipt_code).not.toBe(receiptCode);
  });

  it('rechecks the current HQ owner assignment before returning receipt metadata', async () => {
    await createIntent(harness.app, { origin: customerOrigin });
    const owner = await login(harness.app, 'hq-heidi', 'hq');
    await harness.database.query(
      "UPDATE employee_assignments SET status = 'suspended' WHERE id = 'employee-hq-heidi'",
    );

    const denied = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/access-intents',
      headers: { cookie: owner.cookie as string, origin: hqOrigin },
    });

    expect(denied.statusCode).toBe(403);
    const audits = await harness.database.query<{ readonly count: number }>(
      `SELECT count(*)::integer AS count FROM audit_events
       WHERE action = 'hq.metadata_projection.read'
         AND resource_id = 'owner_access_intents'`,
    );
    expect(audits.rows).toEqual([{ count: 0 }]);
  });
});
