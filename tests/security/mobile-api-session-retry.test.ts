import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-secure-store', () => ({
  isAvailableAsync: async () => false,
}));

async function mobileModules() {
  vi.resetModules();
  vi.stubGlobal('__DEV__', true);
  process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:4000';
  const authentication = await import('../../apps/mobile/src/authentication');
  const api = await import('../../apps/mobile/src/api');
  return { api, authentication };
}

function response(status: number, body: unknown = { error: { message: 'denied' } }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('mobile API session retry', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_API_URL;
    vi.unstubAllGlobals();
  });

  it('forces one fresh Clerk token after a 401 and retries without signing out', async () => {
    const { api, authentication } = await mobileModules();
    const getToken = vi.fn(async (request?: { skipCache?: boolean }) =>
      request?.skipCache ? 'fresh-mobile-token' : 'cached-mobile-token',
    );
    const recoverUnauthorizedSession = vi.fn(async () => undefined);
    const dispose = authentication.configureMobileAuthentication({
      getToken,
      recoverUnauthorizedSession,
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      api.mobileRequest<{ ok: boolean }>('/v1/retry-proof', {
        headers: { Authorization: 'Bearer caller-controlled-token' },
      }),
    ).resolves.toEqual({ ok: true });
    expect(getToken).toHaveBeenNthCalledWith(1, { skipCache: false });
    expect(getToken).toHaveBeenNthCalledWith(2, { skipCache: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer cached-mobile-token',
    );
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer fresh-mobile-token',
    );
    expect(recoverUnauthorizedSession).not.toHaveBeenCalled();
    dispose();
  });

  it('signs out only after the forced token also receives a 401', async () => {
    const { api, authentication } = await mobileModules();
    const getToken = vi.fn(async (request?: { skipCache?: boolean }) =>
      request?.skipCache ? 'fresh-mobile-token' : 'cached-mobile-token',
    );
    const recoverUnauthorizedSession = vi.fn(async () => undefined);
    const dispose = authentication.configureMobileAuthentication({
      getToken,
      recoverUnauthorizedSession,
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.mobileRequest('/v1/retry-proof')).rejects.toThrow(
      'Your session ended. Sign in again to continue.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(recoverUnauthorizedSession).toHaveBeenCalledOnce();
    dispose();
  });
});
