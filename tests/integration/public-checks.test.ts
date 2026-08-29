import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GrowthRuntimeRepository, PublicCheckRepository } from '@boomerbuddy/persistence';
import {
  browserHeaders,
  createApiHarness,
  customerOrigin,
  login,
  type ApiHarness,
} from './support';

describe('privacy-bounded public Check journey', () => {
  let harness: ApiHarness;

  beforeEach(async () => {
    harness = await createApiHarness();
  });

  afterEach(async () => harness.close());

  async function contextToken(): Promise<string> {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/public/check-contexts',
      payload: { attribution: { source: 'direct', campaign: 'none' } },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ context: { token: string } }>().context.token;
  }

  async function contextGrant(remoteAddress: string): Promise<{
    readonly token: string;
    readonly continuityProof: string;
  }> {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/public/check-contexts',
      remoteAddress,
      payload: { attribution: { source: 'direct', campaign: 'none' } },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{
      context: { token: string; continuityProof: string };
    }>().context;
  }

  it('returns a redacted transient result without creating customer artifacts or analyses', async () => {
    const beforeArtifacts = await harness.database.query<
      { total: number } & Record<string, unknown>
    >('SELECT count(*)::int AS total FROM artifacts');
    const beforeAnalyses = await harness.database.query<
      { total: number } & Record<string, unknown>
    >('SELECT count(*)::int AS total FROM analyses');
    const otp = String(100_000 + 2345);
    const card = ['4242', '4242', '4242', '4242'].join(' ');
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/public/checks',
      payload: {
        contextToken: await contextToken(),
        kind: 'text',
        content: `Urgent: caller requested verification code ${otp} and card ${card}; stop now.`,
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{
      result: {
        id: string;
        risk: string;
        warningSigns: string[];
        inputSafety: { flags: string[] };
        conversionGrant: {
          token: string;
          oneTime: boolean;
          semanticsVersion: string;
          singleSuccessfulConversion: boolean;
          retryableWithSameCredentialOwnerAndConsent: boolean;
        };
      };
    }>();
    expect(body.result.risk).toMatch(/^(unknown|caution|high_concern)$/u);
    expect(body.result.warningSigns).toEqual(
      expect.arrayContaining([
        'Uses urgent language that can pressure a rushed decision.',
        'Requests an authentication credential or highly sensitive identifier.',
      ]),
    );
    expect(body.result.inputSafety.flags).toEqual(
      expect.arrayContaining(['contained_one_time_code', 'contained_payment_card']),
    );
    expect(body.result.conversionGrant.oneTime).toBe(true);
    expect(body.result.conversionGrant).toEqual(
      expect.objectContaining({
        semanticsVersion: 'single-success-retry-v1',
        singleSuccessfulConversion: true,
        retryableWithSameCredentialOwnerAndConsent: true,
      }),
    );
    expect(response.body).not.toContain(otp);
    expect(response.body).not.toContain(card);

    const afterArtifacts = await harness.database.query<
      { total: number } & Record<string, unknown>
    >('SELECT count(*)::int AS total FROM artifacts');
    const afterAnalyses = await harness.database.query<{ total: number } & Record<string, unknown>>(
      'SELECT count(*)::int AS total FROM analyses',
    );
    expect(afterArtifacts.rows[0]?.total).toBe(beforeArtifacts.rows[0]?.total);
    expect(afterAnalyses.rows[0]?.total).toBe(beforeAnalyses.rows[0]?.total);

    const stored = await harness.database.query<Record<string, unknown>>(
      'SELECT * FROM public_check_results WHERE id = $1',
      [body.result.id],
    );
    expect(JSON.stringify(stored.rows[0])).not.toContain(otp);
    expect(JSON.stringify(stored.rows[0])).not.toContain(card);
  });

  it('uses a memory-only continuity proof across network changes without moving abuse quotas', async () => {
    const firstNetwork = '198.51.100.41';
    const secondNetwork = '2001:db8::41';
    const grant = await contextGrant(firstNetwork);
    const stored = JSON.stringify(
      await harness.database.query<Record<string, unknown>>(
        `SELECT token_hmac, client_key_hmac, continuity_hmac
         FROM public_check_contexts`,
      ),
    );
    expect(stored).not.toContain(grant.token);
    expect(stored).not.toContain(grant.continuityProof);
    expect(stored).not.toContain(firstNetwork);

    const changedNetwork = await harness.app.inject({
      method: 'POST',
      url: '/v1/public/checks',
      remoteAddress: secondNetwork,
      payload: {
        contextToken: grant.token,
        continuityProof: grant.continuityProof,
        kind: 'text',
        content: 'Unexpected payment request; pause and verify independently.',
      },
    });
    expect(changedNetwork.statusCode).toBe(201);

    const secondNetworkKey = new PublicCheckRepository(harness.database, {
      encryptionKey: Buffer.alloc(32, 7),
      encryptionKeyVersion: 1,
      hmacKey: Buffer.alloc(32, 11),
      hmacKeyVersion: 1,
    }).clientKeyForNetworkAddress(secondNetwork);
    const quota = await harness.database.query<
      { scope_key: string; used_count: number } & Record<string, unknown>
    >(
      `SELECT scope_key, used_count FROM public_check_quota_buckets
       WHERE scope = 'global_public_check' AND scope_key <> 'global'`,
    );
    expect(quota.rows).toContainEqual({ scope_key: secondNetworkKey, used_count: 1 });

    const withoutProof = await harness.app.inject({
      method: 'POST',
      url: '/v1/public/checks',
      remoteAddress: '203.0.113.41',
      payload: {
        contextToken: grant.token,
        kind: 'text',
        content: 'A second bounded attempt from another network.',
      },
    });
    expect(withoutProof.statusCode).toBe(404);
  });

  it('requires authentication and explicit consent, then saves exactly once as actor-owned', async () => {
    const publicContent = 'Urgent bank fraud department request: pause and verify independently.';
    const analyzed = await harness.app.inject({
      method: 'POST',
      url: '/v1/public/checks',
      payload: {
        contextToken: await contextToken(),
        kind: 'text',
        content: publicContent,
      },
    });
    expect(analyzed.statusCode).toBe(201);
    const result = analyzed.json<{
      result: { id: string; conversionGrant: { token: string } };
    }>().result;

    const unauthenticated = await harness.app.inject({
      method: 'POST',
      url: `/v1/public/checks/${result.id}/save`,
      headers: { origin: customerOrigin },
      payload: {
        conversionToken: result.conversionGrant.token,
        saveConsent: true,
        consentVersion: 'public-check-save-v1',
      },
    });
    expect(unauthenticated.statusCode).toBe(401);

    const pat = await login(harness.app, 'protected-pat');
    const missingConsent = await harness.app.inject({
      method: 'POST',
      url: `/v1/public/checks/${result.id}/save`,
      headers: browserHeaders(pat.cookie ?? ''),
      payload: { conversionToken: result.conversionGrant.token },
    });
    expect(missingConsent.statusCode).toBe(400);

    const saved = await harness.app.inject({
      method: 'POST',
      url: `/v1/public/checks/${result.id}/save`,
      headers: browserHeaders(pat.cookie ?? ''),
      payload: {
        conversionToken: result.conversionGrant.token,
        saveConsent: true,
        consentVersion: 'public-check-save-v1',
      },
    });
    expect(saved.statusCode).toBe(201);
    const check = saved.json<{ check: { id: string; access: { kind: string } } }>().check;
    expect(check.access.kind).toBe('owned');

    const evidence = await harness.database.query<
      {
        result_id: string;
        actor_person_id: string;
        household_id: string;
        context_id: string;
        attribution_source: string;
        attribution_campaign: string;
        analysis_id: string;
        save_consent: boolean;
        consent_version: string;
        semantics_version: string;
        session_audience: string;
        credential_hmac: string;
      } & Record<string, unknown>
    >('SELECT * FROM public_check_conversions WHERE result_id = $1', [result.id]);
    expect(evidence.rows[0]).toEqual(
      expect.objectContaining({
        result_id: result.id,
        actor_person_id: 'person-protected-pat',
        household_id: 'household-sunrise',
        attribution_source: 'direct',
        attribution_campaign: 'none',
        analysis_id: check.id,
        save_consent: true,
        consent_version: 'public-check-save-v1',
        semantics_version: 'single-success-retry-v1',
        session_audience: 'customer',
      }),
    );
    expect(evidence.rows[0]?.context_id).toMatch(/^public_context_/u);
    expect(evidence.rows[0]?.credential_hmac).not.toContain(result.conversionGrant.token);

    const operational = await harness.database.query<Record<string, unknown>>(
      `SELECT action, metadata FROM audit_events WHERE resource_id IN ($1, $2)
       UNION ALL
       SELECT event_type AS action, payload AS metadata FROM outbox_events
       WHERE aggregate_id IN ($1, $2)`,
      [result.id, check.id],
    );
    const serializedOperational = JSON.stringify(operational.rows);
    expect(serializedOperational).not.toContain(publicContent);
    expect(serializedOperational).not.toContain(result.conversionGrant.token);
    expect(serializedOperational).toContain('public-check-save-v1');

    const growth = new GrowthRuntimeRepository(harness.database);
    await growth.projectPending({ limit: 100, now: harness.clock.now() });
    const acquisition = await harness.database.query<{
      channel: string;
      milestone: string;
      workflow_state: string;
    }>(
      `SELECT touchpoint.channel, touchpoint.milestone, workflow.state AS workflow_state
       FROM acquisition_touchpoints touchpoint
       JOIN lifecycle_workflows workflow ON workflow.household_id = touchpoint.subject_id
       WHERE touchpoint.subject_kind = 'household'
         AND touchpoint.subject_id = 'household-sunrise'
         AND touchpoint.milestone = 'signup'
         AND workflow.trigger_event_id = (
           SELECT id FROM outbox_events
           WHERE event_type = 'public_check.saved.v1' AND aggregate_id = $1
         )`,
      [result.id],
    );
    expect(acquisition.rows[0]).toEqual({
      channel: 'direct',
      milestone: 'signup',
      workflow_state: 'completed',
    });

    const repeated = await harness.app.inject({
      method: 'POST',
      url: `/v1/public/checks/${result.id}/save`,
      headers: browserHeaders(pat.cookie ?? ''),
      payload: {
        conversionToken: result.conversionGrant.token,
        saveConsent: true,
        consentVersion: 'public-check-save-v1',
      },
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json<{ check: { id: string } }>().check.id).toBe(check.id);
    const afterRetry = await harness.database.query<{ total: number } & Record<string, unknown>>(
      'SELECT count(*)::int AS total FROM public_check_conversions WHERE result_id = $1',
      [result.id],
    );
    expect(afterRetry.rows[0]?.total).toBe(1);

    const retention = new PublicCheckRepository(harness.database, {
      encryptionKey: Buffer.alloc(32, 7),
      encryptionKeyVersion: 1,
      hmacKey: Buffer.alloc(32, 11),
      hmacKeyVersion: 1,
    });
    await retention.purgeExpired(new Date(harness.clock.now().getTime() + 25 * 60 * 60_000));
    const anonymousRows = await harness.database.query<{ total: number } & Record<string, unknown>>(
      `SELECT count(*)::int AS total FROM public_check_results WHERE id = $1
       UNION ALL
       SELECT count(*)::int AS total FROM public_check_contexts WHERE id = $2`,
      [result.id, evidence.rows[0]?.context_id],
    );
    expect(anonymousRows.rows.map((row) => row.total)).toEqual([0, 0]);
    const retryAfterAnonymousPurge = await harness.app.inject({
      method: 'POST',
      url: `/v1/public/checks/${result.id}/save`,
      headers: browserHeaders(pat.cookie ?? ''),
      payload: {
        conversionToken: result.conversionGrant.token,
        saveConsent: true,
        consentVersion: 'public-check-save-v1',
      },
    });
    expect(retryAfterAnonymousPurge.statusCode).toBe(200);
    expect(retryAfterAnonymousPurge.json<{ check: { id: string } }>().check.id).toBe(check.id);

    const alice = await login(harness.app, 'owner-alice');
    const wrongActor = await harness.app.inject({
      method: 'POST',
      url: `/v1/public/checks/${result.id}/save`,
      headers: browserHeaders(alice.cookie ?? ''),
      payload: {
        conversionToken: result.conversionGrant.token,
        saveConsent: true,
        consentVersion: 'public-check-save-v1',
      },
    });
    expect(wrongActor.statusCode).toBe(404);

    const olivia = await login(harness.app, 'protected-olivia');
    const wrongScope = await harness.app.inject({
      method: 'POST',
      url: `/v1/public/checks/${result.id}/save`,
      headers: browserHeaders(olivia.cookie ?? ''),
      payload: {
        conversionToken: result.conversionGrant.token,
        saveConsent: true,
        consentVersion: 'public-check-save-v1',
      },
    });
    expect(wrongScope.statusCode).toBe(404);

    const replacement = result.conversionGrant.token.endsWith('A') ? 'B' : 'A';
    const wrongToken = await harness.app.inject({
      method: 'POST',
      url: `/v1/public/checks/${result.id}/save`,
      headers: browserHeaders(pat.cookie ?? ''),
      payload: {
        conversionToken: `${result.conversionGrant.token.slice(0, -1)}${replacement}`,
        saveConsent: true,
        consentVersion: 'public-check-save-v1',
      },
    });
    expect(wrongToken.statusCode).toBe(404);
  });

  it('serializes concurrent matching retries and rejects a concurrent owner mismatch', async () => {
    const analyzed = await harness.app.inject({
      method: 'POST',
      url: '/v1/public/checks',
      payload: {
        contextToken: await contextToken(),
        kind: 'text',
        content: 'Unexpected account request; stop and use an independently verified channel.',
      },
    });
    const result = analyzed.json<{
      result: { id: string; conversionGrant: { token: string } };
    }>().result;
    const pat = await login(harness.app, 'protected-pat');
    const olivia = await login(harness.app, 'protected-olivia');
    const payload = {
      conversionToken: result.conversionGrant.token,
      saveConsent: true,
      consentVersion: 'public-check-save-v1',
    };
    const [ownerAttempt, mismatchAttempt] = await Promise.all([
      harness.app.inject({
        method: 'POST',
        url: `/v1/public/checks/${result.id}/save`,
        headers: browserHeaders(pat.cookie ?? ''),
        payload,
      }),
      harness.app.inject({
        method: 'POST',
        url: `/v1/public/checks/${result.id}/save`,
        headers: browserHeaders(olivia.cookie ?? ''),
        payload,
      }),
    ]);
    expect([ownerAttempt.statusCode, mismatchAttempt.statusCode].sort()).toEqual([201, 404]);
    const conversion = await harness.database.query<
      { actor_person_id: string; total: number } & Record<string, unknown>
    >(
      `SELECT actor_person_id, count(*)::int AS total
       FROM public_check_conversions WHERE result_id = $1
       GROUP BY actor_person_id`,
      [result.id],
    );
    expect(conversion.rows).toHaveLength(1);
    expect(conversion.rows[0]?.total).toBe(1);

    const winningCookie =
      conversion.rows[0]?.actor_person_id === 'person-protected-pat'
        ? (pat.cookie ?? '')
        : (olivia.cookie ?? '');
    const [firstRetry, secondRetry] = await Promise.all([
      harness.app.inject({
        method: 'POST',
        url: `/v1/public/checks/${result.id}/save`,
        headers: browserHeaders(winningCookie),
        payload,
      }),
      harness.app.inject({
        method: 'POST',
        url: `/v1/public/checks/${result.id}/save`,
        headers: browserHeaders(winningCookie),
        payload,
      }),
    ]);
    expect(firstRetry.statusCode).toBe(200);
    expect(secondRetry.statusCode).toBe(200);
    expect(firstRetry.json<{ check: { id: string } }>().check.id).toBe(
      secondRetry.json<{ check: { id: string } }>().check.id,
    );
  });

  it('rolls back Check creation and grant consumption when conversion evidence cannot commit', async () => {
    const analyzed = await harness.app.inject({
      method: 'POST',
      url: '/v1/public/checks',
      payload: {
        contextToken: await contextToken(),
        kind: 'text',
        content: 'Unexpected wire request; pause and verify through the official number.',
      },
    });
    const result = analyzed.json<{
      result: { id: string; conversionGrant: { token: string } };
    }>().result;
    const before = await harness.database.query<{ total: number } & Record<string, unknown>>(
      'SELECT count(*)::int AS total FROM analyses',
    );
    await harness.database.exec(`
      CREATE FUNCTION fail_test_public_check_conversion() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'injected conversion evidence failure';
      END;
      $$;
      CREATE TRIGGER fail_test_public_check_conversion
      BEFORE INSERT ON public_check_conversions
      FOR EACH ROW EXECUTE FUNCTION fail_test_public_check_conversion();
    `);
    const pat = await login(harness.app, 'protected-pat');
    const failed = await harness.app.inject({
      method: 'POST',
      url: `/v1/public/checks/${result.id}/save`,
      headers: browserHeaders(pat.cookie ?? ''),
      payload: {
        conversionToken: result.conversionGrant.token,
        saveConsent: true,
        consentVersion: 'public-check-save-v1',
      },
    });
    expect(failed.statusCode).toBe(500);
    const afterFailure = await harness.database.query<{ total: number } & Record<string, unknown>>(
      'SELECT count(*)::int AS total FROM analyses',
    );
    expect(afterFailure.rows[0]?.total).toBe(before.rows[0]?.total);
    const stillRetryable = await harness.database.query<
      {
        state: string;
        encrypted_payload: string | null;
        conversion_hmac: string | null;
      } & Record<string, unknown>
    >(
      `SELECT state, encrypted_payload, conversion_hmac
       FROM public_check_results WHERE id = $1`,
      [result.id],
    );
    expect(stillRetryable.rows[0]).toEqual(
      expect.objectContaining({
        state: 'active',
        encrypted_payload: expect.any(String),
        conversion_hmac: expect.any(String),
      }),
    );

    await harness.database.exec(`
      DROP TRIGGER fail_test_public_check_conversion ON public_check_conversions;
      DROP FUNCTION fail_test_public_check_conversion();
    `);
    const retried = await harness.app.inject({
      method: 'POST',
      url: `/v1/public/checks/${result.id}/save`,
      headers: browserHeaders(pat.cookie ?? ''),
      payload: {
        conversionToken: result.conversionGrant.token,
        saveConsent: true,
        consentVersion: 'public-check-save-v1',
      },
    });
    expect(retried.statusCode).toBe(201);
    const consumed = await harness.database.query<Record<string, unknown>>(
      `SELECT state, encrypted_payload, conversion_hmac
       FROM public_check_results WHERE id = $1`,
      [result.id],
    );
    expect(consumed.rows[0]).toEqual({
      state: 'consumed',
      encrypted_payload: null,
      conversion_hmac: null,
    });
  });

  it('hard-rejects unsafe URL credentials and stores no transient result', async () => {
    const before = await harness.database.query<{ total: number } & Record<string, unknown>>(
      'SELECT count(*)::int AS total FROM public_check_results',
    );
    const credentialUrl = ['https://', 'user', ':', 'generated-password', '@example.test/'].join(
      '',
    );
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/public/checks',
      payload: { contextToken: await contextToken(), kind: 'url', content: credentialUrl },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain(credentialUrl);
    const after = await harness.database.query<{ total: number } & Record<string, unknown>>(
      'SELECT count(*)::int AS total FROM public_check_results',
    );
    expect(after.rows[0]?.total).toBe(before.rows[0]?.total);
  });
});
