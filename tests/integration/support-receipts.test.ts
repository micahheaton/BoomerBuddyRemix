import { afterEach, describe, expect, it } from 'vitest';

import {
  bearerHeaders,
  browserHeaders,
  createApiHarness,
  hqOrigin,
  login,
  type ApiHarness,
} from './support';

let operationSequence = 0;

function operation(kind: 'create' | 'withdraw' | 'transition'): string {
  operationSequence += 1;
  return `support-receipt:${kind}:00000000-0000-4000-8000-${String(operationSequence).padStart(12, '0')}`;
}

describe('authenticated content-free support receipts', () => {
  let harness: ApiHarness;

  afterEach(async () => {
    await harness?.close();
  });

  it('runs the customer and HQ lifecycle without content, provider action, or outbound work', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const heidi = await login(harness.app, 'hq-heidi', 'hq');
    const aliceHeaders = {
      ...browserHeaders(alice.cookie!),
      'x-bb-household-id': 'household-sunrise',
    };
    const hqHeaders = browserHeaders(heidi.cookie!, hqOrigin);
    const outboxBefore = await harness.database.query<{ readonly count: number }>(
      'SELECT count(*)::integer AS count FROM outbox_events',
    );
    const createKey = operation('create');
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/support-receipts',
      headers: { ...aliceHeaders, 'idempotency-key': createKey },
      payload: { category: 'mobile_app', impact: 'blocked' },
    });

    expect(created.statusCode).toBe(201);
    expect(created.headers['cache-control']).toContain('no-store');
    expect(created.json()).toMatchObject({
      receipt: { category: 'mobile_app', impact: 'blocked', state: 'open' },
      reused: false,
      contentIncluded: false,
      outboundMessage: 'not_sent',
      providerAction: 'none',
    });
    const receiptCode = created.json<{ receipt: { receiptCode: string } }>().receipt.receiptCode;
    expect(receiptCode).toMatch(/^support_receipt_[A-Za-z0-9_-]{32}$/u);
    expect(created.body).not.toMatch(
      /household-sunrise|person-owner-alice|"email"|"phone"|"message"|"url"/iu,
    );

    const retried = await harness.app.inject({
      method: 'POST',
      url: '/v1/support-receipts',
      headers: { ...aliceHeaders, 'idempotency-key': createKey },
      payload: { category: 'mobile_app', impact: 'blocked' },
    });
    expect(retried.statusCode).toBe(201);
    expect(retried.json()).toMatchObject({ reused: true });
    expect(retried.json<{ receipt: { receiptCode: string } }>().receipt.receiptCode).toBe(
      receiptCode,
    );

    const changedPayload = await harness.app.inject({
      method: 'POST',
      url: '/v1/support-receipts',
      headers: { ...aliceHeaders, 'idempotency-key': createKey },
      payload: { category: 'billing', impact: 'blocked' },
    });
    expect(changedPayload.statusCode).toBe(409);

    const queue = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/support-receipts',
      headers: hqHeaders,
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json()).toMatchObject({
      projection: 'content_free_support_receipts',
      receipts: [{ receiptCode, householdId: 'household-sunrise', state: 'open' }],
      contentIncluded: false,
      outboundMessage: 'not_sent',
      providerAction: 'none',
    });

    let acknowledgeKey = '';
    let resolvedUpdatedAt = '';
    for (const [action, expectedState, resolutionCode] of [
      ['acknowledge', 'acknowledged', undefined],
      ['start_review', 'in_review', undefined],
      ['resolve', 'resolved', 'completed'],
    ] as const) {
      const transitionKey = operation('transition');
      if (action === 'acknowledge') acknowledgeKey = transitionKey;
      const transitioned = await harness.app.inject({
        method: 'POST',
        url: '/v1/hq/support-receipts/transitions',
        headers: { ...hqHeaders, 'idempotency-key': transitionKey },
        payload: {
          receiptCode,
          action,
          ...(resolutionCode === undefined ? {} : { resolutionCode }),
        },
      });
      expect(transitioned.statusCode).toBe(200);
      expect(transitioned.json()).toMatchObject({
        receipt: {
          receiptCode,
          state: expectedState,
          ...(resolutionCode === undefined ? {} : { resolutionCode }),
        },
        contentIncluded: false,
        outboundMessage: 'not_sent',
        providerAction: 'none',
      });
      if (action === 'resolve') {
        resolvedUpdatedAt = transitioned.json<{ receipt: { updatedAt: string } }>().receipt
          .updatedAt;
      }
    }

    const replayedCreate = await harness.app.inject({
      method: 'POST',
      url: '/v1/support-receipts',
      headers: { ...aliceHeaders, 'idempotency-key': createKey },
      payload: { category: 'mobile_app', impact: 'blocked' },
    });
    expect(replayedCreate.statusCode).toBe(201);
    expect(replayedCreate.json()).toMatchObject({
      receipt: { receiptCode, state: 'resolved', resolutionCode: 'completed' },
      reused: true,
    });
    expect(replayedCreate.json<{ receipt: { updatedAt: string } }>().receipt.updatedAt).toBe(
      resolvedUpdatedAt,
    );

    const replayedAcknowledge = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/support-receipts/transitions',
      headers: { ...hqHeaders, 'idempotency-key': acknowledgeKey },
      payload: { receiptCode, action: 'acknowledge' },
    });
    expect(replayedAcknowledge.statusCode).toBe(200);
    expect(replayedAcknowledge.json()).toMatchObject({
      receipt: {
        receiptCode,
        state: 'resolved',
        resolutionCode: 'completed',
        updatedAt: resolvedUpdatedAt,
      },
      reused: true,
    });

    const customerList = await harness.app.inject({
      method: 'GET',
      url: '/v1/support-receipts',
      headers: aliceHeaders,
    });
    expect(customerList.statusCode).toBe(200);
    expect(customerList.json()).toMatchObject({
      receipts: [{ receiptCode, state: 'resolved', resolutionCode: 'completed' }],
      contentIncluded: false,
      outboundMessage: 'not_sent',
      providerAction: 'none',
    });
    const queueAfter = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/support-receipts',
      headers: hqHeaders,
    });
    expect(queueAfter.json<{ receipts: unknown[] }>().receipts).toEqual([]);

    const outboxAfter = await harness.database.query<{ readonly count: number }>(
      'SELECT count(*)::integer AS count FROM outbox_events',
    );
    expect(outboxAfter.rows).toEqual(outboxBefore.rows);
    const stored = JSON.stringify(
      await harness.database.query<Record<string, unknown>>(
        `SELECT receipt.*, operation.operation_key_hmac, operation.request_digest,
                event.action, event.from_state, event.to_state, event.resolution_code
         FROM support_receipts receipt
         JOIN support_receipt_operations operation
           ON operation.receipt_code = receipt.receipt_code
         JOIN support_receipt_events event
           ON event.operation_key_hmac = operation.operation_key_hmac`,
      ),
    );
    expect(stored).not.toContain(createKey);
  });

  it('enforces self and owner authority and rejects submitted content', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const bob = await login(harness.app, 'owner-bob');
    const riley = await login(harness.app, 'hq-riley', 'hq');
    const aliceHeaders = {
      ...browserHeaders(alice.cookie!),
      'x-bb-household-id': 'household-sunrise',
    };
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/support-receipts',
      headers: { ...aliceHeaders, 'idempotency-key': operation('create') },
      payload: { category: 'billing', impact: 'question' },
    });
    const receiptCode = created.json<{ receipt: { receiptCode: string } }>().receipt.receiptCode;

    const contentAttempt = await harness.app.inject({
      method: 'POST',
      url: '/v1/support-receipts',
      headers: { ...aliceHeaders, 'idempotency-key': operation('create') },
      payload: { category: 'billing', impact: 'question', message: 'forbidden' },
    });
    expect(contentAttempt.statusCode).toBe(400);

    const secondReceipt = await harness.app.inject({
      method: 'POST',
      url: '/v1/support-receipts',
      headers: { ...aliceHeaders, 'idempotency-key': operation('create') },
      payload: { category: 'privacy', impact: 'degraded' },
    });
    expect(secondReceipt.statusCode).toBe(201);
    const firstPage = await harness.app.inject({
      method: 'GET',
      url: '/v1/support-receipts?limit=1&offset=0',
      headers: aliceHeaders,
    });
    expect(firstPage.json()).toMatchObject({
      receipts: [expect.objectContaining({ receiptCode: expect.any(String) })],
      truncated: true,
      nextOffset: 1,
    });
    const secondPage = await harness.app.inject({
      method: 'GET',
      url: '/v1/support-receipts?limit=1&offset=1',
      headers: aliceHeaders,
    });
    expect(secondPage.json()).toMatchObject({
      receipts: [expect.objectContaining({ receiptCode: expect.any(String) })],
      truncated: false,
      nextOffset: null,
    });
    expect(
      secondPage.json<{ receipts: { receiptCode: string }[] }>().receipts[0]?.receiptCode,
    ).not.toBe(firstPage.json<{ receipts: { receiptCode: string }[] }>().receipts[0]?.receiptCode);

    const bobWithdrawal = await harness.app.inject({
      method: 'POST',
      url: '/v1/support-receipts/withdrawals',
      headers: {
        ...browserHeaders(bob.cookie!),
        'x-bb-household-id': 'household-sunrise',
        'idempotency-key': operation('withdraw'),
      },
      payload: { receiptCode },
    });
    expect(bobWithdrawal.statusCode).toBe(403);

    const nonOwnerQueue = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/support-receipts',
      headers: browserHeaders(riley.cookie!, hqOrigin),
    });
    expect(nonOwnerQueue.statusCode).toBe(403);

    const crossTenant = await harness.app.inject({
      method: 'GET',
      url: '/v1/support-receipts',
      headers: {
        ...browserHeaders(bob.cookie!),
        'x-bb-household-id': 'household-harbor',
      },
    });
    expect(crossTenant.statusCode).toBe(200);
    expect(crossTenant.json<{ receipts: unknown[] }>().receipts).toEqual([]);
  });

  it('supports the mobile bearer path and fails closed when the feature flags are off', async () => {
    harness = await createApiHarness();
    const mobile = await login(harness.app, 'owner-alice', 'mobile');
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/support-receipts',
      headers: { ...bearerHeaders(mobile.token!), 'idempotency-key': operation('create') },
      payload: { category: 'account_access', impact: 'degraded' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      receipt: { category: 'account_access', impact: 'degraded', state: 'open' },
      contentIncluded: false,
      outboundMessage: 'not_sent',
      providerAction: 'none',
    });

    await harness.close();
    harness = await createApiHarness(undefined, {
      supportReceiptsCustomerAccessEnabled: false,
      supportReceiptsIntakeEnabled: false,
      supportReceiptsHqQueueEnabled: false,
    });
    const disabledCustomer = await login(harness.app, 'owner-alice');
    const disabledHq = await login(harness.app, 'hq-heidi', 'hq');
    for (const request of [
      {
        method: 'GET' as const,
        url: '/v1/support-receipts',
        headers: browserHeaders(disabledCustomer.cookie!),
      },
      {
        method: 'POST' as const,
        url: '/v1/support-receipts',
        headers: {
          ...browserHeaders(disabledCustomer.cookie!),
          'idempotency-key': operation('create'),
        },
        payload: { category: 'billing', impact: 'question' },
      },
      {
        method: 'GET' as const,
        url: '/v1/hq/support-receipts',
        headers: browserHeaders(disabledHq.cookie!, hqOrigin),
      },
    ]) {
      const response = await harness.app.inject(request);
      expect(response.statusCode).toBe(404);
    }
    const receipts = await harness.database.query<{ readonly count: number }>(
      'SELECT count(*)::integer AS count FROM support_receipts',
    );
    expect(receipts.rows).toEqual([{ count: 0 }]);

    await harness.close();
    harness = await createApiHarness(undefined, {
      supportReceiptsCustomerAccessEnabled: false,
      supportReceiptsIntakeEnabled: true,
      supportReceiptsHqQueueEnabled: false,
    });
    const inconsistentCustomer = await login(harness.app, 'owner-alice');
    const failClosedIntake = await harness.app.inject({
      method: 'POST',
      url: '/v1/support-receipts',
      headers: {
        ...browserHeaders(inconsistentCustomer.cookie!),
        'idempotency-key': operation('create'),
      },
      payload: { category: 'billing', impact: 'question' },
    });
    expect(failClosedIntake.statusCode).toBe(404);
  });
});
