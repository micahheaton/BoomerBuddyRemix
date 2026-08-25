import type { ErrorEnvelope } from '@boomerbuddy/contracts';
import { readMobileAuthenticationToken, recoverUnauthorizedMobileSession } from './authentication';
import { resolveMobileApiOrigin } from './api-origin';
import { readSelectedHouseholdId } from './session';

declare const process: { env: { EXPO_PUBLIC_API_URL?: string } };
declare const __DEV__: boolean;

const baseUrl = resolveMobileApiOrigin({
  configured: process.env.EXPO_PUBLIC_API_URL,
  development: __DEV__,
});

export async function mobileRequest<T>(
  path: string,
  init: RequestInit = {},
  includeAuth = true,
): Promise<T> {
  const token = includeAuth ? await readMobileAuthenticationToken() : null;
  if (includeAuth && !token) {
    await recoverUnauthorizedMobileSession();
    throw new Error('Your session ended. Sign in again to continue.');
  }
  const selectedHouseholdId = includeAuth && path !== '/v1/me' ? readSelectedHouseholdId() : null;
  const callerSignal = init.signal ?? undefined;
  const timeoutController = callerSignal ? undefined : new AbortController();
  const timeout = timeoutController
    ? setTimeout(() => timeoutController.abort(), 15_000)
    : undefined;
  const requestSignal = callerSignal ?? timeoutController!.signal;
  try {
    const send = async (requestToken: string | null) => {
      const headers = new Headers(init.headers);
      headers.set('Accept', 'application/json');
      if (init.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      if (requestToken) headers.set('Authorization', `Bearer ${requestToken}`);
      else headers.delete('Authorization');
      if (selectedHouseholdId) headers.set('X-BB-Household-Id', selectedHouseholdId);
      else headers.delete('X-BB-Household-Id');
      return fetch(`${baseUrl}${path}`, {
        ...init,
        signal: requestSignal,
        headers,
      });
    };
    let response = await send(token);
    if (response.status === 401 && includeAuth) {
      let refreshedToken: string | null;
      try {
        refreshedToken = await readMobileAuthenticationToken({ skipCache: true });
      } catch {
        throw new Error('BoomerBuddy could not refresh your session. Please try again.');
      }
      if (!refreshedToken) {
        await recoverUnauthorizedMobileSession();
        throw new Error('Your session ended. Sign in again to continue.');
      }
      response = await send(refreshedToken);
    }
    if (!response.ok) {
      if (response.status === 401 && includeAuth) {
        await recoverUnauthorizedMobileSession();
        throw new Error('Your session ended. Sign in again to continue.');
      }
      let error: ErrorEnvelope | undefined;
      try {
        error = (await response.json()) as ErrorEnvelope;
      } catch {
        /* Use safe fallback. */
      }
      throw new Error(error?.error.message ?? 'BoomerBuddy could not complete that request.');
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (timeoutController?.signal.aborted) {
      throw new Error('BoomerBuddy did not respond in time. Check your connection and try again.');
    }
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function readableError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
