export interface MobileAuthenticationTokenRequest {
  readonly skipCache?: boolean;
}

export interface MobileAuthenticationRecoveryGuard {
  readonly isCurrent: () => boolean;
}

export interface MobileAuthenticationBridge {
  readonly getToken: (request?: MobileAuthenticationTokenRequest) => Promise<string | null>;
  readonly recoverUnauthorizedSession: (guard: MobileAuthenticationRecoveryGuard) => Promise<void>;
}

export type MobileAuthenticationContext = Readonly<{
  bridge: MobileAuthenticationBridge | undefined;
  generation: number;
}>;

let activeBridge: MobileAuthenticationBridge | undefined;
let activeBridgeGeneration = 0;

interface MobileAuthenticationAttempt<T> {
  readonly bridge: MobileAuthenticationBridge | undefined;
  readonly generation: number;
  readonly promise: Promise<T>;
}

let activeRecovery: MobileAuthenticationAttempt<void> | undefined;
let activeForcedTokenRefresh: MobileAuthenticationAttempt<string | null> | undefined;
const mobileAuthenticationProviderTimeoutMs = 15_000;

class MobileAuthenticationProviderTimeoutError extends Error {
  override readonly name = 'MobileAuthenticationProviderTimeoutError';
}

class MobileAuthenticationContextChangedError extends Error {
  override readonly name = 'MobileAuthenticationContextChangedError';
}

function authenticationContextIsCurrent(
  bridge: MobileAuthenticationBridge | undefined,
  generation: number,
): boolean {
  return activeBridge === bridge && activeBridgeGeneration === generation;
}

function requireCurrentAuthenticationContext(
  bridge: MobileAuthenticationBridge | undefined,
  generation: number,
): void {
  if (!authenticationContextIsCurrent(bridge, generation)) {
    throw new MobileAuthenticationContextChangedError('Authentication context changed');
  }
}

export function captureMobileAuthenticationContext(): MobileAuthenticationContext {
  return Object.freeze({
    bridge: activeBridge,
    generation: activeBridgeGeneration,
  });
}

export function isMobileAuthenticationContextCurrent(
  context: MobileAuthenticationContext,
): boolean {
  return authenticationContextIsCurrent(context.bridge, context.generation);
}

export function requireMobileAuthenticationContextCurrent(
  context: MobileAuthenticationContext,
): void {
  requireCurrentAuthenticationContext(context.bridge, context.generation);
}

function boundProviderAttempt<T>(operation: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new MobileAuthenticationProviderTimeoutError('Authentication provider timed out'));
    }, mobileAuthenticationProviderTimeoutMs);
    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function clearForcedRefreshWhenSettled(attempt: MobileAuthenticationAttempt<string | null>): void {
  const clear = (): void => {
    if (activeForcedTokenRefresh === attempt) activeForcedTokenRefresh = undefined;
  };
  void attempt.promise.then(clear, clear);
}

function clearRecoveryWhenSettled(attempt: MobileAuthenticationAttempt<void>): void {
  const clear = (): void => {
    if (activeRecovery === attempt) activeRecovery = undefined;
  };
  void attempt.promise.then(clear, clear);
}

function invalidateCoalescedAuthenticationWork(): void {
  activeForcedTokenRefresh = undefined;
  activeRecovery = undefined;
}

export function configureMobileAuthentication(bridge: MobileAuthenticationBridge): () => void {
  const generation = ++activeBridgeGeneration;
  activeBridge = bridge;
  invalidateCoalescedAuthenticationWork();
  return () => {
    if (activeBridge !== bridge || activeBridgeGeneration !== generation) return;
    activeBridge = undefined;
    activeBridgeGeneration += 1;
    invalidateCoalescedAuthenticationWork();
  };
}

export async function readMobileAuthenticationToken(
  request: MobileAuthenticationTokenRequest = {},
  context: MobileAuthenticationContext = captureMobileAuthenticationContext(),
): Promise<string | null> {
  const { bridge, generation } = context;
  requireCurrentAuthenticationContext(bridge, generation);
  if (!request.skipCache) {
    const token = (await bridge?.getToken({ skipCache: false })) ?? null;
    requireCurrentAuthenticationContext(bridge, generation);
    return token;
  }
  if (activeForcedTokenRefresh === undefined) {
    const promise = boundProviderAttempt(
      Promise.resolve().then(() => {
        requireCurrentAuthenticationContext(bridge, generation);
        return bridge?.getToken({ skipCache: true }) ?? null;
      }),
    ).then((token) => {
      requireCurrentAuthenticationContext(bridge, generation);
      return token;
    });
    const attempt = { bridge, generation, promise };
    activeForcedTokenRefresh = attempt;
    clearForcedRefreshWhenSettled(attempt);
  }
  return activeForcedTokenRefresh.promise;
}

export async function recoverUnauthorizedMobileSession(
  context: MobileAuthenticationContext = captureMobileAuthenticationContext(),
): Promise<void> {
  const { bridge, generation } = context;
  if (!authenticationContextIsCurrent(bridge, generation)) return;
  if (activeRecovery === undefined) {
    const promise = boundProviderAttempt(
      Promise.resolve().then(() => {
        requireCurrentAuthenticationContext(bridge, generation);
        return bridge?.recoverUnauthorizedSession({
          isCurrent: () => authenticationContextIsCurrent(bridge, generation),
        });
      }),
    )
      .then(() => requireCurrentAuthenticationContext(bridge, generation))
      .catch(() => undefined);
    const attempt = { bridge, generation, promise };
    activeRecovery = attempt;
    clearRecoveryWhenSettled(attempt);
  }
  await activeRecovery.promise;
}
