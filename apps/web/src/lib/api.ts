import type { ErrorEnvelope } from '@boomerbuddy/contracts';

export const apiBaseUrl =
  process.env.NODE_ENV === 'production'
    ? '/api'
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000');
const selectedHouseholdKey = 'boomerbuddy.selected-household';

export function readSelectedHouseholdId(): string {
  return typeof window === 'undefined'
    ? ''
    : (window.sessionStorage.getItem(selectedHouseholdKey) ?? '');
}

export function setSelectedHouseholdId(householdId: string): void {
  if (typeof window === 'undefined') return;
  if (householdId) window.sessionStorage.setItem(selectedHouseholdKey, householdId);
  else window.sessionStorage.removeItem(selectedHouseholdKey);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function serviceName(): string {
  return process.env.NODE_ENV === 'production' ? 'BoomerBuddy' : 'The local service';
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const anonymousPublicRequest =
    path === '/v1/public/check-contexts' ||
    path === '/v1/public/checks' ||
    path === '/v1/public/access-intents';
  const selectedHouseholdId =
    path === '/v1/me' || anonymousPublicRequest ? '' : readSelectedHouseholdId();
  const callerSignal = init.signal ?? undefined;
  const timeoutController = callerSignal ? undefined : new AbortController();
  const timeout = timeoutController
    ? setTimeout(() => timeoutController.abort(), 15_000)
    : undefined;
  const requestSignal = callerSignal ?? timeoutController!.signal;
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      credentials: anonymousPublicRequest ? 'omit' : 'include',
      signal: requestSignal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(selectedHouseholdId ? { 'X-BB-Household-Id': selectedHouseholdId } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      let envelope: ErrorEnvelope | undefined;
      try {
        envelope = (await response.json()) as ErrorEnvelope;
      } catch {
        // The fallback below remains safe when a proxy returns non-JSON.
      }
      throw new ApiError(
        envelope?.error.message ?? `${serviceName()} could not complete that request.`,
        envelope?.error.code ?? 'request_failed',
        response.status,
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (timeoutController?.signal.aborted) {
      throw new ApiError(`${serviceName()} did not respond in time.`, 'request_timeout', 408);
    }
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function readableError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
