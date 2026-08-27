import { settleIdentitySignOut } from '@boomerbuddy/security/identity-sign-out';

export const selectedHouseholdStorageKey = 'boomerbuddy.selected-household';
export const protectedSelfOperationStoragePrefix = 'bb:protected-self:';
export const productionSessionRecoveryPath = '/sign-in/session-recovery';
export const clerkRecoveryLoadTimeoutMs = 2_000;

type RecoveryAction = () => void | Promise<void>;
type RecoveryRearmScheduler = (callback: () => void) => void;
type RecoveryWait = (delayMs: number) => Promise<void>;

const clerkRecoveryLoadPollIntervalMs = 25;

export type ClerkSessionCleanupOutcome = 'cleared' | 'cleanup_failed';
export type SessionRecoveryRetryOutcome =
  'busy' | 'cleanup_failed' | 'navigated' | 'navigation_failed';

export interface SessionRecoveryRetryState {
  readonly busy: boolean;
  readonly error: string;
}

const cleanupFailureMessage =
  'BoomerBuddy could not confirm that the session was cleared. This page has not continued. Try again or email support.';
const navigationFailureMessage =
  'BoomerBuddy cleared the session but could not open a fresh sign-in page. This page has not continued. Try again or email support.';

type CustomerSessionStorage = Pick<Storage, 'key' | 'length' | 'removeItem'>;

export function clearCustomerSessionState(storage: CustomerSessionStorage): void {
  const protectedOperationKeys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(protectedSelfOperationStoragePrefix)) {
      protectedOperationKeys.push(key);
    }
  }
  storage.removeItem(selectedHouseholdStorageKey);
  for (const key of protectedOperationKeys) storage.removeItem(key);
}

export interface AuthenticationRecoveryCoordinator {
  begin(input: {
    readonly clearLocalState: () => void;
    readonly fallbackNavigation: RecoveryAction;
    readonly hasReachedRecoveryDestination?: () => boolean;
    readonly scheduleRearm?: RecoveryRearmScheduler;
  }): Promise<void>;
  register(handler: RecoveryAction): () => void;
}

export function createAuthenticationRecoveryCoordinator(): AuthenticationRecoveryCoordinator {
  let handler: RecoveryAction | undefined;
  let recovery: Promise<void> | undefined;

  return {
    begin(input) {
      if (recovery !== undefined) return recovery;

      input.clearLocalState();
      const registeredHandler = handler;
      recovery = Promise.resolve()
        .then(registeredHandler ?? input.fallbackNavigation)
        .catch(async () => {
          if (registeredHandler === undefined) return;
          try {
            await input.fallbackNavigation();
          } catch {
            // The terminal route is also available as a direct same-origin URL. There is no
            // additional automatic redirect that could recreate the failed-session loop.
          }
        });
      const currentRecovery = recovery;
      void currentRecovery.then(() => {
        if (input.hasReachedRecoveryDestination?.() === true) return;
        const scheduleRearm = input.scheduleRearm ?? ((callback: () => void) => callback());
        try {
          scheduleRearm(() => {
            if (recovery === currentRecovery && input.hasReachedRecoveryDestination?.() !== true) {
              recovery = undefined;
            }
          });
        } catch {
          if (recovery === currentRecovery) recovery = undefined;
        }
      });
      return recovery;
    },
    register(nextHandler) {
      handler = nextHandler;
      return () => {
        if (handler === nextHandler) handler = undefined;
      };
    },
  };
}

const productionAuthenticationRecovery = createAuthenticationRecoveryCoordinator();

export function registerProductionAuthenticationRecovery(handler: RecoveryAction): () => void {
  return productionAuthenticationRecovery.register(handler);
}

export function shouldBeginProductionAuthenticationRecovery(
  status: number,
  environment: string | undefined,
  authenticatedCustomerRequest: boolean,
): boolean {
  return authenticatedCustomerRequest && status === 401 && environment === 'production';
}

export async function waitForClerkLoaded(input: {
  readonly isLoaded: () => boolean;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly wait?: RecoveryWait;
}): Promise<void> {
  if (input.isLoaded()) return;

  const timeoutMs =
    input.timeoutMs !== undefined && Number.isFinite(input.timeoutMs) && input.timeoutMs >= 0
      ? input.timeoutMs
      : clerkRecoveryLoadTimeoutMs;
  const pollIntervalMs =
    input.pollIntervalMs !== undefined &&
    Number.isFinite(input.pollIntervalMs) &&
    input.pollIntervalMs > 0
      ? input.pollIntervalMs
      : clerkRecoveryLoadPollIntervalMs;
  const wait =
    input.wait ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, delayMs);
      }));
  let remainingMs = timeoutMs;

  while (remainingMs > 0) {
    const delayMs = Math.min(pollIntervalMs, remainingMs);
    await wait(delayMs);
    if (input.isLoaded()) return;
    remainingMs -= delayMs;
  }

  throw new Error('Clerk did not become ready before the bounded recovery timeout.');
}

export async function clearClerkSessionWhenLoaded(input: {
  readonly clearClerkSession: () => Promise<void>;
  readonly isLoaded: () => boolean;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly wait?: RecoveryWait;
}): Promise<void> {
  await waitForClerkLoaded(input);
  const outcome = await settleIdentitySignOut({
    clearIdentitySession: input.clearClerkSession,
  });
  if (outcome !== 'cleared') {
    throw new Error('The identity session could not be cleared within the recovery boundary.');
  }
}

export async function clearClerkSessionAndNavigate(input: {
  readonly clearClerkSession: () => Promise<void>;
  readonly navigate: () => void;
}): Promise<ClerkSessionCleanupOutcome> {
  let outcome: ClerkSessionCleanupOutcome = 'cleared';
  try {
    await input.clearClerkSession();
  } catch {
    outcome = 'cleanup_failed';
  }
  input.navigate();
  return outcome;
}

export function createSessionRecoveryRetryController(input: {
  readonly clearClerkSession: () => Promise<void>;
  readonly confirmNavigation: () => Promise<boolean>;
  readonly navigate: () => void;
  readonly onStateChange: (state: SessionRecoveryRetryState) => void;
}): {
  readonly retry: () => Promise<SessionRecoveryRetryOutcome>;
  readonly state: () => SessionRecoveryRetryState;
} {
  let retry: Promise<SessionRecoveryRetryOutcome> | undefined;
  let state: SessionRecoveryRetryState = { busy: false, error: '' };
  const update = (next: SessionRecoveryRetryState) => {
    state = next;
    input.onStateChange(state);
  };

  return {
    retry: () => {
      if (retry !== undefined) return retry;
      if (state.busy) return Promise.resolve('busy');

      update({ busy: true, error: '' });
      retry = (async () => {
        try {
          await input.clearClerkSession();
        } catch {
          update({ busy: false, error: cleanupFailureMessage });
          return 'cleanup_failed';
        }

        try {
          input.navigate();
          if (await input.confirmNavigation()) return 'navigated';
        } catch {
          // The terminal page remains mounted and receives the same bounded recovery state below.
        }
        update({ busy: false, error: navigationFailureMessage });
        return 'navigation_failed';
      })();
      const currentRetry = retry;
      void currentRetry.then(() => {
        if (retry === currentRetry) retry = undefined;
      });
      return currentRetry;
    },
    state: () => state,
  };
}

export function beginProductionAuthenticationRecovery(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  return productionAuthenticationRecovery.begin({
    clearLocalState: () => clearCustomerSessionState(window.sessionStorage),
    fallbackNavigation: () => window.location.replace(productionSessionRecoveryPath),
    hasReachedRecoveryDestination: () => window.location.pathname === productionSessionRecoveryPath,
    scheduleRearm: (callback) => window.setTimeout(callback, 1_000),
  });
}
