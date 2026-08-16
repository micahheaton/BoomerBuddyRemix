import type { ErrorEnvelope } from '@boomerbuddy/contracts';
import { readSelectedHouseholdId, readSessionToken } from './session';

declare const process: { env: { EXPO_PUBLIC_API_URL?: string } };

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export async function mobileRequest<T>(
  path: string,
  init: RequestInit = {},
  includeAuth = true,
): Promise<T> {
  const token = includeAuth ? await readSessionToken() : null;
  const selectedHouseholdId = includeAuth && path !== '/v1/me' ? readSelectedHouseholdId() : null;
  const callerSignal = init.signal ?? undefined;
  const timeoutController = callerSignal ? undefined : new AbortController();
  const timeout = timeoutController
    ? setTimeout(() => timeoutController.abort(), 15_000)
    : undefined;
  const requestSignal = callerSignal ?? timeoutController!.signal;
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: requestSignal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(selectedHouseholdId ? { 'X-BB-Household-Id': selectedHouseholdId } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      let error: ErrorEnvelope | undefined;
      try {
        error = (await response.json()) as ErrorEnvelope;
      } catch {
        /* Use safe fallback. */
      }
      throw new Error(error?.error.message ?? 'The local service could not complete that request.');
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (timeoutController?.signal.aborted) {
      throw new Error('The local service did not respond in time.');
    }
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function readableError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
