import { restrictedArtifactDiagnostic, transactionFactsDiagnostic } from '@boomerbuddy/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import { browserHeaders, createApiHarness, login, type ApiHarness } from './support';

describe('Run 1 API', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('serves health, the Family launch offer, and an authenticated local Check without echoing content', async () => {
    harness = await createApiHarness();
    const live = await harness.app.inject({ method: 'GET', url: '/health/live' });
    const ready = await harness.app.inject({ method: 'GET', url: '/health/ready' });
    const publicConfig = await harness.app.inject({ method: 'GET', url: '/v1/public/config' });
    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(200);
    expect(publicConfig.json()).toMatchObject({
      liveProvidersEnabled: false,
      pricing: [
        {
          key: 'family',
          name: 'Family',
          monthlyUsd: 14.99,
          annualUsd: null,
          hypothesis: false,
        },
      ],
    });

    const session = await login(harness.app, 'owner-alice');
    const raw = 'Please act now, but I will verify through the official bank application.';
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: browserHeaders(session.cookie as string),
      payload: { kind: 'text', content: raw },
    });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain(raw);
    expect(created.json().check).toMatchObject({
      evidenceSufficiency: expect.stringMatching(/^(limited|moderate|strong)$/u),
      calibration: 'not_calibrated',
      provider: { state: 'unknown' },
    });
    const checkId = String(created.json().check.id);
    const restricted = await restrictedArtifactDiagnostic(
      harness.database,
      'household-sunrise',
      checkId,
    );
    expect(restricted?.encrypted_content).toEqual(expect.any(String));
    expect(String(restricted?.encrypted_content)).not.toContain(raw);
    const facts = await transactionFactsDiagnostic(harness.database, 'household-sunrise', checkId);
    expect(facts).toEqual({ analyses: 1, audits: 1, outbox: 1 });
  }, 15_000);
});
