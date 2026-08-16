import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { browserHeaders, createApiHarness, login, type ApiHarness } from '../integration/support';

describe('Public Check conversion evidence boundary', () => {
  let harness: ApiHarness;

  beforeEach(async () => {
    harness = await createApiHarness();
  });

  afterEach(async () => harness.close());

  it('keeps consent evidence immutable and operational records content-free', async () => {
    const context = await harness.app.inject({
      method: 'POST',
      url: '/v1/public/check-contexts',
      payload: { attribution: { source: 'partner', campaign: 'trusted_partner' } },
    });
    const contextToken = context.json<{ context: { token: string } }>().context.token;
    const sensitiveMarker = `private-marker-${String(100_000 + 2345)}`;
    const analyzed = await harness.app.inject({
      method: 'POST',
      url: '/v1/public/checks',
      payload: {
        contextToken,
        kind: 'text',
        content: `A caller requested verification code ${String(100_000 + 2345)}; ${sensitiveMarker}`,
      },
    });
    expect(analyzed.statusCode).toBe(201);
    const result = analyzed.json<{
      result: { id: string; conversionGrant: { token: string } };
    }>().result;
    const pat = await login(harness.app, 'protected-pat');
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

    const transient = await harness.database.query<Record<string, unknown>>(
      `SELECT state, encrypted_payload, conversion_hmac
       FROM public_check_results WHERE id = $1`,
      [result.id],
    );
    expect(transient.rows[0]).toEqual({
      state: 'consumed',
      encrypted_payload: null,
      conversion_hmac: null,
    });
    const evidence = await harness.database.query<Record<string, unknown>>(
      'SELECT * FROM public_check_conversions WHERE result_id = $1',
      [result.id],
    );
    const serializedEvidence = JSON.stringify(evidence.rows[0]);
    expect(serializedEvidence).not.toContain(sensitiveMarker);
    expect(serializedEvidence).not.toContain(result.conversionGrant.token);
    expect(evidence.rows[0]).toEqual(
      expect.objectContaining({
        actor_person_id: 'person-protected-pat',
        household_id: 'household-sunrise',
        attribution_source: 'partner',
        attribution_campaign: 'trusted_partner',
        save_consent: true,
        consent_version: 'public-check-save-v1',
      }),
    );
    await expect(
      harness.database.query(
        `UPDATE public_check_conversions SET consent_version = 'public-check-save-v1'
         WHERE result_id = $1`,
        [result.id],
      ),
    ).rejects.toThrow('append-only');
    await expect(
      harness.database.query('DELETE FROM public_check_conversions WHERE result_id = $1', [
        result.id,
      ]),
    ).rejects.toThrow('append-only');

    const operational = await harness.database.query<Record<string, unknown>>(
      `SELECT metadata FROM audit_events WHERE resource_id = $1
       UNION ALL
       SELECT payload AS metadata FROM outbox_events WHERE aggregate_id = $1`,
      [result.id],
    );
    const serializedOperational = JSON.stringify(operational.rows);
    expect(serializedOperational).not.toContain(sensitiveMarker);
    expect(serializedOperational).not.toContain(result.conversionGrant.token);
  });
});
