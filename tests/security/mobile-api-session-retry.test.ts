import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('../../apps/mobile/src/secure-store', () => ({
  isAvailableAsync: async () => false,
}));

async function mobileModules() {
  vi.resetModules();
  vi.stubGlobal('__DEV__', true);
  process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:4000';
  const authentication = await import('../../apps/mobile/src/authentication');
  const session = await import('../../apps/mobile/src/session');
  const api = await import('../../apps/mobile/src/api');
  return { api, authentication, session };
}

function response(status: number, body: unknown = { error: { message: 'denied' } }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('mobile API session retry', () => {
  afterEach(() => {
    vi.useRealTimers();
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

  it('limits pending-sign-out token access to the exact current-session DELETE', async () => {
    const { api, authentication } = await mobileModules();
    const getToken = vi.fn(async () => 'captured-sign-out-token');
    const dispose = authentication.configureMobileAuthentication({
      getToken,
      recoverUnauthorizedSession: async () => undefined,
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      api.mobileRequest('/v1/sessions/current', {
        method: 'DELETE',
        authenticationPurpose: 'session_sign_out',
      }),
    ).resolves.toBeUndefined();
    expect(getToken).toHaveBeenCalledWith({
      skipCache: false,
      purpose: 'session_sign_out',
    });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer captured-sign-out-token',
    );

    await expect(
      api.mobileRequest('/v1/family', {
        authenticationPurpose: 'session_sign_out',
      }),
    ).rejects.toThrow('limited to the exact current-session DELETE');
    expect(fetchMock).toHaveBeenCalledOnce();
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

  it('does not retry or recover a stale request through a replacement authentication session', async () => {
    const { api, authentication } = await mobileModules();
    const oldGetToken = vi.fn(async () => 'old-session-token');
    const oldRecover = vi.fn(async () => undefined);
    const disposeOld = authentication.configureMobileAuthentication({
      getToken: oldGetToken,
      recoverUnauthorizedSession: oldRecover,
    });
    let releaseOldResponse!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => {
      releaseOldResponse = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementationOnce(() => oldResponse);
    vi.stubGlobal('fetch', fetchMock);
    const staleRequest = api.mobileRequest('/v1/retry-proof', { method: 'POST' });
    const staleRejection = expect(staleRequest).rejects.toThrow(
      'BoomerBuddy could not connect. Check your connection and try again.',
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    disposeOld();
    const newGetToken = vi.fn(async () => 'new-session-token');
    const newRecover = vi.fn(async () => undefined);
    const disposeNew = authentication.configureMobileAuthentication({
      getToken: newGetToken,
      recoverUnauthorizedSession: newRecover,
    });
    releaseOldResponse(response(401));

    await staleRejection;
    expect(oldGetToken).toHaveBeenCalledOnce();
    expect(newGetToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(oldRecover).not.toHaveBeenCalled();
    expect(newRecover).not.toHaveBeenCalled();
    disposeNew();
  });

  it('preserves an explicit authorized household scope while replacing caller authentication', async () => {
    const { api, authentication } = await mobileModules();
    const dispose = authentication.configureMobileAuthentication({
      getToken: async () => 'clerk-mobile-token',
      recoverUnauthorizedSession: async () => undefined,
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await api.mobileRequest('/v1/family', {
      headers: {
        Authorization: 'Bearer caller-controlled-token',
        'X-BB-Household-Id': 'household-secondary',
      },
    });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer clerk-mobile-token');
    expect(headers.get('X-BB-Household-Id')).toBe('household-secondary');
    dispose();
  });

  it('binds an implicit household scope before asynchronous token acquisition', async () => {
    const { api, authentication, session } = await mobileModules();
    const householdSession = session.beginMobileHouseholdSession('identity-session-a');
    await session.setSelectedHouseholdId(householdSession, 'person-household-test', 'household-a');
    let resolveToken!: (token: string) => void;
    const token = new Promise<string>((resolve) => {
      resolveToken = resolve;
    });
    const dispose = authentication.configureMobileAuthentication({
      getToken: () => token,
      recoverUnauthorizedSession: async () => undefined,
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const request = api.mobileRequest('/v1/orientation/start', { method: 'POST' });
    await session.setSelectedHouseholdId(householdSession, 'person-household-test', 'household-b');
    resolveToken('clerk-mobile-token');

    await expect(request).resolves.toEqual({ ok: true });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('X-BB-Household-Id')).toBe(
      'household-a',
    );
    dispose();
  });

  it('omits browser credentials and strips caller cookie and origin headers', async () => {
    const { api, authentication } = await mobileModules();
    const dispose = authentication.configureMobileAuthentication({
      getToken: async () => 'clerk-mobile-token',
      recoverUnauthorizedSession: async () => undefined,
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await api.mobileRequest('/v1/transport-proof', {
      credentials: 'include',
      headers: {
        Cookie: '__session=caller-controlled-cookie',
        Origin: 'https://caller-controlled.test',
      },
    });

    const request = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(request?.headers);
    expect(request?.credentials).toBe('omit');
    expect(headers.has('Cookie')).toBe(false);
    expect(headers.has('Origin')).toBe(false);
    expect(headers.get('Authorization')).toBe('Bearer clerk-mobile-token');
    dispose();
  });

  it('does not expose unexpected provider or parser details to customer screens', async () => {
    const { api, authentication } = await mobileModules();
    const dispose = authentication.configureMobileAuthentication({
      getToken: async () => 'clerk-mobile-token',
      recoverUnauthorizedSession: async () => undefined,
    });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('not-json')));

    await expect(api.mobileRequest('/v1/unexpected')).rejects.toThrow(
      'BoomerBuddy received an unexpected response. Please try again.',
    );
    expect(api.readableError(new Error('sensitive provider implementation detail'))).toBe(
      'Something went wrong. Please try again.',
    );
    dispose();
  });

  it('preserves HTTP status for safe feature availability recovery', async () => {
    const { api, authentication } = await mobileModules();
    const dispose = authentication.configureMobileAuthentication({
      getToken: async () => 'clerk-mobile-token',
      recoverUnauthorizedSession: async () => undefined,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        response(404, {
          error: {
            code: 'NOT_FOUND',
            message: 'This feature is not available right now.',
            requestId: 'request-mobile-support-unavailable',
          },
        }),
      ),
    );

    await expect(api.mobileRequest('/v1/support-receipts')).rejects.toMatchObject({
      name: 'MobileCustomerError',
      message: 'This feature is not available right now.',
      status: 404,
    });
    dispose();
  });

  it('cancels independently when the caller aborts a composed request signal', async () => {
    const { api, authentication } = await mobileModules();
    const dispose = authentication.configureMobileAuthentication({
      getToken: async () => 'clerk-mobile-token',
      recoverUnauthorizedSession: async () => undefined,
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new Error('aborted'));
            return;
          }
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const caller = new AbortController();
    const request = api.mobileRequest('/v1/family', { signal: caller.signal });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0]?.[1]?.signal).not.toBe(caller.signal);

    caller.abort();

    await expect(request).rejects.toThrow('The request was canceled. Please try again.');
    dispose();
  });

  it('keeps the bounded timeout active when a caller signal is also present', async () => {
    vi.useFakeTimers();
    const { api, authentication } = await mobileModules();
    const dispose = authentication.configureMobileAuthentication({
      getToken: async () => 'clerk-mobile-token',
      recoverUnauthorizedSession: async () => undefined,
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new Error('aborted'));
            return;
          }
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const caller = new AbortController();
    const request = api.mobileRequest('/v1/family', { signal: caller.signal });
    const rejection = expect(request).rejects.toThrow(
      'BoomerBuddy did not respond in time. Check your connection and try again.',
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(caller.signal.aborted).toBe(false);
    dispose();
  });

  it('applies caller cancellation before initial token acquisition completes', async () => {
    const { api, authentication } = await mobileModules();
    const dispose = authentication.configureMobileAuthentication({
      getToken: () => new Promise<string | null>(() => undefined),
      recoverUnauthorizedSession: async () => undefined,
    });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener');
    const request = api.mobileRequest('/v1/family', { signal: caller.signal });

    caller.abort();

    await expect(request).rejects.toThrow('The request was canceled. Please try again.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    dispose();
  });

  it('bounds initial token acquisition within the total request timeout', async () => {
    vi.useFakeTimers();
    const { api, authentication } = await mobileModules();
    const dispose = authentication.configureMobileAuthentication({
      getToken: () => new Promise<string | null>(() => undefined),
      recoverUnauthorizedSession: async () => undefined,
    });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const request = api.mobileRequest('/v1/family');
    const rejection = expect(request).rejects.toThrow(
      'BoomerBuddy did not respond in time. Check your connection and try again.',
    );

    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    dispose();
  });

  it('bounds forced token refresh within the original total request timeout', async () => {
    vi.useFakeTimers();
    const { api, authentication } = await mobileModules();
    const getToken = vi.fn((request?: { skipCache?: boolean }) =>
      request?.skipCache
        ? new Promise<string | null>(() => undefined)
        : Promise.resolve('cached-mobile-token'),
    );
    const dispose = authentication.configureMobileAuthentication({
      getToken,
      recoverUnauthorizedSession: async () => undefined,
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(401));
    vi.stubGlobal('fetch', fetchMock);
    const request = api.mobileRequest('/v1/family');
    const rejection = expect(request).rejects.toThrow(
      'BoomerBuddy did not respond in time. Check your connection and try again.',
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(getToken).toHaveBeenCalledWith({ skipCache: true });

    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
    dispose();
  });

  it('bounds session recovery when no authentication token is available', async () => {
    vi.useFakeTimers();
    const { api, authentication } = await mobileModules();
    const recoverUnauthorizedSession = vi.fn(() => new Promise<void>(() => undefined));
    const dispose = authentication.configureMobileAuthentication({
      getToken: async () => null,
      recoverUnauthorizedSession,
    });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>());
    const request = api.mobileRequest('/v1/family');
    const rejection = expect(request).rejects.toThrow(
      'BoomerBuddy did not respond in time. Check your connection and try again.',
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(recoverUnauthorizedSession).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
    dispose();
  });

  it('bounds successful-response parsing within the total request timeout', async () => {
    vi.useFakeTimers();
    const { api, authentication } = await mobileModules();
    const dispose = authentication.configureMobileAuthentication({
      getToken: async () => 'clerk-mobile-token',
      recoverUnauthorizedSession: async () => undefined,
    });
    const parse = vi.fn(() => new Promise<unknown>(() => undefined));
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue({ status: 200, ok: true, json: parse } as unknown as Response),
    );
    const request = api.mobileRequest('/v1/family');
    const rejection = expect(request).rejects.toThrow(
      'BoomerBuddy did not respond in time. Check your connection and try again.',
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(parse).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
    dispose();
  });

  it('preserves caller cancellation while parsing an error response', async () => {
    const { api, authentication } = await mobileModules();
    const dispose = authentication.configureMobileAuthentication({
      getToken: async () => 'clerk-mobile-token',
      recoverUnauthorizedSession: async () => undefined,
    });
    const parse = vi.fn(() => new Promise<unknown>(() => undefined));
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue({ status: 409, ok: false, json: parse } as unknown as Response),
    );
    const caller = new AbortController();
    const request = api.mobileRequest('/v1/family', { signal: caller.signal });
    await vi.waitFor(() => expect(parse).toHaveBeenCalledOnce());

    caller.abort();

    await expect(request).rejects.toThrow('The request was canceled. Please try again.');
    dispose();
  });
});
