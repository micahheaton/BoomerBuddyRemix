import { afterEach, describe, expect, it, vi } from 'vitest';

async function networkClients(environment: 'development' | 'production') {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', environment);
  const [customer, hq] = await Promise.all([
    import('../../apps/web/src/lib/api'),
    import('../../apps/hq/src/lib/api'),
  ]);
  return { customer, hq };
}

function nonJsonFailure(): Response {
  return new Response('<html>Bad gateway</html>', {
    status: 502,
    headers: { 'Content-Type': 'text/html' },
  });
}

function waitForAbort(_input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (signal == null) {
      reject(new Error('Expected the request client to configure a timeout signal'));
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

describe('production network fallback copy', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('uses customer-safe service names when production receives a non-JSON failure', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => nonJsonFailure());
    vi.stubGlobal('fetch', fetchMock);
    const { customer, hq } = await networkClients('production');

    expect(customer.apiBaseUrl).toBe('/api');
    await expect(customer.apiRequest('/v1/copy-probe')).rejects.toMatchObject({
      message: 'BoomerBuddy could not complete that request.',
      code: 'request_failed',
      status: 502,
    });
    await expect(hq.hqRequest('/v1/copy-probe')).rejects.toMatchObject({
      message: 'The HQ service could not complete this request.',
      status: 502,
    });
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      '/api/v1/copy-probe',
      '/api/v1/copy-probe',
    ]);
  });

  it('uses customer-safe service names when production requests time out', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(waitForAbort));
    const { customer, hq } = await networkClients('production');

    const customerFailure = expect(customer.apiRequest('/v1/timeout-probe')).rejects.toMatchObject({
      message: 'BoomerBuddy did not respond in time.',
      code: 'request_timeout',
      status: 408,
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await customerFailure;

    const hqFailure = expect(hq.hqRequest('/v1/timeout-probe')).rejects.toMatchObject({
      message: 'The HQ service did not respond in time.',
      status: 408,
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await hqFailure;
  });

  it('retains explicit local-service context for developer failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async () => nonJsonFailure()),
    );
    const { customer, hq } = await networkClients('development');

    await expect(customer.apiRequest('/v1/local-probe')).rejects.toThrow(
      'The local service could not complete that request.',
    );
    await expect(hq.hqRequest('/v1/local-probe')).rejects.toThrow(
      'The local HQ service could not complete this request.',
    );
  });
});
