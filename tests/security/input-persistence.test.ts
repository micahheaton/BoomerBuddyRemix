import { loadConfig } from '@boomerbuddy/config';
import { decryptField, parseEncryptedField } from '@boomerbuddy/security';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bearerHeaders,
  browserHeaders,
  createApiHarness,
  login,
  type ApiHarness,
} from '../integration/support';

describe('input, persistence, and no-network security', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness?.close();
    harness = undefined;
  });

  it('returns safe 4xx envelopes for malformed tenant scope, Unicode byte overflow, and large bodies', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const headers = browserHeaders(alice.cookie as string);
    const malformedTenant = await harness.app.inject({
      method: 'GET',
      url: '/v1/checks',
      headers: { ...headers, 'x-bb-household-id': '!!' },
    });
    const textOverflow = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers,
      payload: { kind: 'text', content: '界'.repeat(6_000) },
    });
    const urlOverflow = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers,
      payload: { kind: 'url', content: `https://example.com/${'界'.repeat(1_500)}` },
    });
    const hugeBody = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: JSON.stringify({ kind: 'text', content: 'x'.repeat(30_000) }),
    });
    expect(malformedTenant.statusCode).toBe(400);
    expect(malformedTenant.json().error).toMatchObject({
      code: 'invalid_input',
      requestId: expect.any(String),
    });
    expect(textOverflow.statusCode).toBe(400);
    expect(urlOverflow.statusCode).toBe(400);
    expect(hugeBody.statusCode).toBe(413);
    for (const response of [textOverflow, urlOverflow, hugeBody]) {
      expect(response.body).not.toContain('界');
      expect(response.json().error.requestId).toEqual(expect.any(String));
    }
  }, 15_000);

  it('never fetches a submitted URL and enforces the URL entitlement independently', async () => {
    harness = await createApiHarness();
    const fetchSpy = vi.fn(() => Promise.reject(new Error('Network must not be called')));
    vi.stubGlobal('fetch', fetchSpy);
    const aliceMobile = await login(harness.app, 'owner-alice', 'mobile');
    const urlCheck = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: bearerHeaders(aliceMobile.token as string),
      payload: { kind: 'url', content: 'https://example.com/account/verify?local=test' },
    });
    expect(urlCheck.statusCode).toBe(201);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(urlCheck.body).not.toContain('example.com');

    await harness.database.query(
      `UPDATE entitlement_grants
       SET capabilities = '["check:text","history:read","family:manage","orientation:use"]'::jsonb
       WHERE household_id = 'household-sunrise'`,
    );
    const reducedSession = await login(harness.app, 'protected-pat', 'mobile');
    const textAllowed = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: bearerHeaders(reducedSession.token as string),
      payload: { kind: 'text', content: 'Text capability remains available.' },
    });
    const urlDenied = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: bearerHeaders(reducedSession.token as string),
      payload: { kind: 'url', content: 'https://example.org/local-only' },
    });
    expect(textAllowed.statusCode).toBe(201);
    expect(urlDenied.statusCode).toBe(403);
    expect(urlDenied.json().error.details.reason).toBe('missing_capability');
  });

  it('redacts safe typed spans before persistence and never reflects the submitted value', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const restricted = 'Use payment card 4111111111111111 immediately';
    const before = await harness.database.query<{ artifacts: number; analyses: number }>(
      `SELECT (SELECT count(*)::int FROM artifacts) AS artifacts,
              (SELECT count(*)::int FROM analyses) AS analyses`,
    );
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: browserHeaders(alice.cookie as string),
      payload: { kind: 'text', content: restricted },
    });
    const after = await harness.database.query<{ artifacts: number; analyses: number }>(
      `SELECT (SELECT count(*)::int FROM artifacts) AS artifacts,
              (SELECT count(*)::int FROM analyses) AS analyses`,
    );
    expect(response.statusCode).toBe(201);
    expect(response.body).not.toContain('4111111111111111');
    expect(after.rows[0]).toEqual({
      artifacts: (before.rows[0]?.artifacts ?? 0) + 1,
      analyses: (before.rows[0]?.analyses ?? 0) + 1,
    });
    const stored = await harness.database.query<{
      artifact_id: string;
      household_id: string;
      encrypted_content: string;
    }>(
      `SELECT a.artifact_id, a.household_id, r.encrypted_content
       FROM analyses a JOIN artifacts r
         ON r.household_id = a.household_id AND r.id = a.artifact_id
       WHERE a.id = $1`,
      [response.json().check.id],
    );
    const row = stored.rows[0];
    const plaintext = decryptField(
      parseEncryptedField(row?.encrypted_content as string),
      Buffer.alloc(32, 7),
      {
        tenantId: row?.household_id as string,
        resourceId: row?.artifact_id as string,
        field: 'content',
        schemaVersion: 1,
        keyVersion: 1,
      },
    ).toString('utf8');
    expect(plaintext).toContain('[PAYMENT_CARD]');
    expect(plaintext).not.toContain('4111111111111111');
    const events = await harness.database.query<Record<string, unknown>>(
      'SELECT metadata FROM audit_events UNION ALL SELECT payload AS metadata FROM outbox_events',
    );
    expect(JSON.stringify(events.rows)).not.toContain('4111111111111111');
  });

  it('analyzes and stores the same minimized Unicode input', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: browserHeaders(alice.cookie as string),
      payload: {
        kind: 'text',
        content: '  Ａｃｔ     ｎｏｗ\r\n\r\n\r\nplease verify.  ',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().check.risk).toBe('caution');
    const stored = await harness.database.query<{
      artifact_id: string;
      encrypted_content: string;
    }>(
      `SELECT artifact_id, encrypted_content FROM analyses a
       JOIN artifacts r ON r.household_id = a.household_id AND r.id = a.artifact_id
       WHERE a.id = $1`,
      [response.json().check.id],
    );
    const row = stored.rows[0];
    expect(row).toBeDefined();
    const plaintext = decryptField(
      parseEncryptedField(row?.encrypted_content as string),
      Buffer.alloc(32, 7),
      {
        tenantId: 'household-sunrise',
        resourceId: row?.artifact_id as string,
        field: 'content',
        schemaVersion: 1,
        keyVersion: 1,
      },
    ).toString('utf8');
    expect(plaintext).toBe('Act now\n\nplease verify.');
  });

  it('rolls back artifact, decision, audit, and outbox together if event persistence fails', async () => {
    harness = await createApiHarness();
    await harness.database.exec(`
      ALTER TABLE outbox_events
      ADD CONSTRAINT reject_check_completed_for_test
      CHECK (event_type <> 'check.completed.v1') NOT VALID
    `);
    const alice = await login(harness.app, 'owner-alice');
    const before = await harness.database.query<{
      artifacts: number;
      analyses: number;
      audits: number;
    }>(
      `SELECT (SELECT count(*)::int FROM artifacts) AS artifacts,
              (SELECT count(*)::int FROM analyses) AS analyses,
              (SELECT count(*)::int FROM audit_events) AS audits`,
    );
    const raw = 'Atomic persistence local regression value';
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: browserHeaders(alice.cookie as string),
      payload: { kind: 'text', content: raw },
    });
    const after = await harness.database.query<{
      artifacts: number;
      analyses: number;
      audits: number;
    }>(
      `SELECT (SELECT count(*)::int FROM artifacts) AS artifacts,
              (SELECT count(*)::int FROM analyses) AS analyses,
              (SELECT count(*)::int FROM audit_events) AS audits`,
    );
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(raw);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('does not expose safe-word verifiers and refuses Run 1 production configuration', async () => {
    harness = await createApiHarness();
    const pat = await login(harness.app, 'protected-pat');
    const headers = browserHeaders(pat.cookie as string);
    const before = await harness.database.query<{
      status: string;
      completed_steps: unknown;
      safe_word_disposition: string;
      version: number;
    }>(
      `SELECT status, completed_steps, safe_word_disposition, version
       FROM orientation_states
       WHERE household_id = 'household-sunrise' AND person_id = 'person-protected-pat'`,
    );
    const outOfOrder = await harness.app.inject({
      method: 'PUT',
      url: '/v1/orientation/safe-word',
      headers,
      payload: { action: 'configure', phrase: 'Only local household phrase' },
    });
    expect(outOfOrder.statusCode).toBe(409);
    expect(outOfOrder.body).not.toMatch(/phrase|verifier|scrypt|salt/iu);
    const afterOutOfOrder = await harness.database.query<{
      status: string;
      completed_steps: unknown;
      safe_word_disposition: string;
      version: number;
    }>(
      `SELECT status, completed_steps, safe_word_disposition, version
       FROM orientation_states
       WHERE household_id = 'household-sunrise' AND person_id = 'person-protected-pat'`,
    );
    const verifierCount = await harness.database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM safe_word_verifiers
       WHERE household_id = 'household-sunrise' AND protected_person_id = 'person-protected-pat'`,
    );
    expect(afterOutOfOrder.rows).toEqual(before.rows);
    expect(verifierCount.rows[0]?.count).toBe(0);

    const started = await harness.app.inject({
      method: 'POST',
      url: '/v1/orientation/start',
      headers,
    });
    expect(started.statusCode).toBe(200);
    for (const step of ['protection_subject', 'trusted_circle']) {
      const response = await harness.app.inject({
        method: 'PUT',
        url: `/v1/orientation/steps/${step}`,
        headers,
        payload: { complete: true },
      });
      expect(response.statusCode).toBe(200);
    }
    const configured = await harness.app.inject({
      method: 'PUT',
      url: '/v1/orientation/safe-word',
      headers,
      payload: { action: 'configure', phrase: 'Only local household phrase' },
    });
    expect(configured.statusCode).toBe(200);
    expect(configured.body).not.toMatch(/phrase|verifier|scrypt|salt/iu);
    expect(configured.json().orientation).toMatchObject({
      status: 'in_progress',
      completedSteps: ['protection_subject', 'trusted_circle', 'safe_word'],
      safeWordDisposition: 'configured',
    });
    const verificationEvents = await harness.database.query<{
      audits: number;
      outbox: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM audit_events
          WHERE action = 'orientation.verification_aid_updated') AS audits,
         (SELECT count(*)::int FROM outbox_events
          WHERE event_type = 'orientation.verification_aid_updated.v1') AS outbox`,
    );
    expect(verificationEvents.rows[0]).toEqual({ audits: 1, outbox: 1 });
    const noVerifierGet = await harness.app.inject({
      method: 'GET',
      url: '/v1/orientation/safe-word',
      headers,
    });
    expect(noVerifierGet.statusCode).toBe(404);
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        BB_DATABASE_DRIVER: 'postgres',
        DATABASE_URL: 'postgres://user:password@localhost:5432/boomerbuddy',
        BB_RUN_MIGRATIONS: 'true',
        BB_SEED_DEMO: 'false',
        BB_ALLOW_DEV_IDENTITY: 'false',
        BB_CUSTOMER_ORIGINS: 'https://customer.example',
        BB_HQ_ORIGINS: 'https://hq.example',
        BB_SESSION_SECRET: 'a-secure-production-session-secret-value',
        BB_ARTIFACT_KEY_BASE64: Buffer.alloc(32, 3).toString('base64'),
        BB_FINGERPRINT_KEY_BASE64: Buffer.alloc(32, 4).toString('base64'),
        BB_SAFE_WORD_PEPPER: 'a-secure-production-safe-word-pepper',
      }),
    ).toThrow(/refuses production/iu);
  });

  it('rolls back safe-word disposition, verifier, and step completion together', async () => {
    harness = await createApiHarness();
    const pat = await login(harness.app, 'protected-pat');
    const headers = browserHeaders(pat.cookie as string);
    await harness.app.inject({ method: 'POST', url: '/v1/orientation/start', headers });
    for (const step of ['protection_subject', 'trusted_circle']) {
      const completed = await harness.app.inject({
        method: 'PUT',
        url: `/v1/orientation/steps/${step}`,
        headers,
        payload: { complete: true },
      });
      expect(completed.statusCode).toBe(200);
    }
    await harness.database.exec(`
      ALTER TABLE outbox_events
      ADD CONSTRAINT reject_safe_word_event_for_test
      CHECK (event_type <> 'orientation.verification_aid_updated.v1') NOT VALID
    `);
    const response = await harness.app.inject({
      method: 'PUT',
      url: '/v1/orientation/safe-word',
      headers,
      payload: { action: 'configure', phrase: 'Rollback household phrase' },
    });
    expect(response.statusCode).toBe(500);
    const state = await harness.database.query<{
      completed_steps: unknown;
      safe_word_disposition: string;
      version: number;
      verifiers: number;
      audits: number;
    }>(
      `SELECT o.completed_steps, o.safe_word_disposition, o.version,
         (SELECT count(*)::int FROM safe_word_verifiers v
          WHERE v.household_id = o.household_id AND v.protected_person_id = o.person_id)
           AS verifiers,
         (SELECT count(*)::int FROM audit_events a
          WHERE a.household_id = o.household_id
            AND a.action = 'orientation.verification_aid_updated') AS audits
       FROM orientation_states o
       WHERE o.household_id = 'household-sunrise'
         AND o.person_id = 'person-protected-pat'`,
    );
    expect(state.rows[0]).toMatchObject({
      completed_steps: ['protection_subject', 'trusted_circle'],
      safe_word_disposition: 'unanswered',
      version: 4,
      verifiers: 0,
      audits: 0,
    });
  });
});
