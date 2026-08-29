import { settleIdentitySignOut } from '@boomerbuddy/security/identity-sign-out';
import { memberLearningPendingOperationStoragePrefix } from './member-learning-idempotency';

export const selectedHouseholdStorageKey = 'boomerbuddy.selected-household';
export const protectedSelfOperationStoragePrefix = 'bb:protected-self:';
export const memberAuthenticationProbeStorageKey = 'bb:member-authentication-probe';
export const productionSessionRecoveryPath = '/sign-in/session-recovery';
export const productionSessionResetPath = '/sign-in/session-reset';
export const productionSessionResetSearchParam = 'session_reset';
export const productionSessionResetTarget = `/sign-in?${productionSessionResetSearchParam}=1`;
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

type ClerkSessionSignOut = (callback: () => void | Promise<void>) => Promise<void>;

const cleanupFailureMessage =
  'BoomerBuddy could not confirm that the session was cleared. This page has not continued. Try again or email support.';
const navigationFailureMessage =
  'BoomerBuddy cleared the session but could not open a fresh sign-in page. This page has not continued. Try again or email support.';

export function isSameOriginMemberRedirectTarget(
  value: string | null | undefined,
  currentOrigin: string,
): boolean {
  if (!value) return false;

  try {
    const origin = new URL(currentOrigin);
    const target = new URL(value, origin);
    return (
      target.origin === origin.origin &&
      target.username === '' &&
      target.password === '' &&
      (target.pathname === '/member' || target.pathname.startsWith('/member/'))
    );
  } catch {
    return false;
  }
}

export type MemberAuthenticationProbeDecision =
  { readonly action: 'navigate'; readonly target: string } | { readonly action: 'recover' };

export function decideMemberAuthenticationProbe(input: {
  readonly currentOrigin: string;
  readonly probePending: boolean;
  readonly redirectTarget: string | null | undefined;
}): MemberAuthenticationProbeDecision {
  if (input.probePending) return { action: 'recover' };
  if (!isSameOriginMemberRedirectTarget(input.redirectTarget, input.currentOrigin)) {
    return { action: 'navigate', target: '/member' };
  }

  const target = new URL(input.redirectTarget ?? '/member', input.currentOrigin);
  return { action: 'navigate', target: `${target.pathname}${target.search}${target.hash}` };
}

export async function clearClerkClientSessions(input: {
  readonly signOut: ClerkSessionSignOut;
}): Promise<void> {
  let providerConfirmed = false;
  await input.signOut(() => {
    providerConfirmed = true;
  });

  if (!providerConfirmed) {
    throw new Error('Clerk did not confirm that this browser session was cleared.');
  }
}

export async function resetBrowserClerkSession(
  fetchSessionReset: typeof fetch = globalThis.fetch,
): Promise<void> {
  const response = await fetchSessionReset(productionSessionResetPath, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`The local browser session reset failed with status ${response.status}.`);
  }
}

export async function clearClerkSessionsWithLocalFallback(input: {
  readonly clearClerkSessions: () => Promise<void>;
  readonly resetLocalSession: () => Promise<void>;
}): Promise<void> {
  try {
    await input.clearClerkSessions();
  } catch {
    await input.resetLocalSession();
  }
}

export function isTerminalSessionReset(search: string): boolean {
  return new URLSearchParams(search).get(productionSessionResetSearchParam) === '1';
}

type CustomerSessionStorage = Pick<Storage, 'key' | 'length' | 'removeItem'>;
type MemberAuthenticationProbeStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

export function hasPendingMemberAuthenticationProbe(
  storage: MemberAuthenticationProbeStorage,
): boolean {
  return storage.getItem(memberAuthenticationProbeStorageKey) === 'pending';
}

export function markMemberAuthenticationProbe(storage: MemberAuthenticationProbeStorage): void {
  storage.setItem(memberAuthenticationProbeStorageKey, 'pending');
}

export function clearMemberAuthenticationProbe(storage: MemberAuthenticationProbeStorage): void {
  storage.removeItem(memberAuthenticationProbeStorageKey);
}

export function clearCustomerSessionState(storage: CustomerSessionStorage): void {
  const operationKeys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (
      key?.startsWith(protectedSelfOperationStoragePrefix) ||
      key?.startsWith(memberLearningPendingOperationStoragePrefix)
    ) {
      operationKeys.push(key);
    }
  }
  storage.removeItem(selectedHouseholdStorageKey);
  storage.removeItem(memberAuthenticationProbeStorageKey);
  for (const key of operationKeys) storage.removeItem(key);
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
