export interface MobileAuthenticationTokenRequest {
  readonly skipCache?: boolean;
}

export interface MobileAuthenticationBridge {
  readonly getToken: (request?: MobileAuthenticationTokenRequest) => Promise<string | null>;
  readonly recoverUnauthorizedSession: () => Promise<void>;
}

let activeBridge: MobileAuthenticationBridge | undefined;
let activeRecovery: Promise<void> | undefined;
let activeForcedTokenRefresh: Promise<string | null> | undefined;

export function configureMobileAuthentication(bridge: MobileAuthenticationBridge): () => void {
  activeBridge = bridge;
  return () => {
    if (activeBridge === bridge) activeBridge = undefined;
  };
}

export async function readMobileAuthenticationToken(
  request: MobileAuthenticationTokenRequest = {},
): Promise<string | null> {
  if (!request.skipCache) return (await activeBridge?.getToken({ skipCache: false })) ?? null;
  if (activeForcedTokenRefresh === undefined) {
    const bridge = activeBridge;
    activeForcedTokenRefresh = Promise.resolve()
      .then(() => bridge?.getToken({ skipCache: true }) ?? null)
      .finally(() => {
        activeForcedTokenRefresh = undefined;
      });
  }
  return activeForcedTokenRefresh;
}

export async function recoverUnauthorizedMobileSession(): Promise<void> {
  if (activeRecovery === undefined) {
    activeRecovery = Promise.resolve(activeBridge?.recoverUnauthorizedSession())
      .catch(() => undefined)
      .finally(() => {
        activeRecovery = undefined;
      });
  }
  await activeRecovery;
}
