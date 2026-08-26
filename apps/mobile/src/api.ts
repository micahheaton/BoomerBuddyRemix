import { errorEnvelopeSchema } from '@boomerbuddy/contracts';
import { readMobileAuthenticationToken, recoverUnauthorizedMobileSession } from './authentication';
import { resolveMobileApiOrigin } from './api-origin';
import { readSelectedHouseholdId } from './session';

declare const process: { env: { EXPO_PUBLIC_API_URL?: string } };
declare const __DEV__: boolean;

const baseUrl = resolveMobileApiOrigin({
  configured: process.env.EXPO_PUBLIC_API_URL,
  development: __DEV__,
});

export class MobileCustomerError extends Error {
  override readonly name = 'MobileCustomerError';

  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function customerError(message: string, status?: number): MobileCustomerError {
  return new MobileCustomerError(message, status);
}

export async function mobileRequest<T>(
  path: string,
  init: RequestInit = {},
  includeAuth = true,
): Promise<T> {
  const token = includeAuth ? await readMobileAuthenticationToken() : null;
  if (includeAuth && !token) {
    await recoverUnauthorizedMobileSession();
    throw customerError('Your session ended. Sign in again to continue.');
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
      if (!includeAuth) {
        headers.delete('X-BB-Household-Id');
      } else if (!headers.has('X-BB-Household-Id')) {
        if (selectedHouseholdId) headers.set('X-BB-Household-Id', selectedHouseholdId);
        else headers.delete('X-BB-Household-Id');
      }
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
        throw customerError('BoomerBuddy could not refresh your session. Please try again.');
      }
      if (!refreshedToken) {
        await recoverUnauthorizedMobileSession();
        throw customerError('Your session ended. Sign in again to continue.');
      }
      response = await send(refreshedToken);
    }
    if (!response.ok) {
      if (response.status === 401 && includeAuth) {
        await recoverUnauthorizedMobileSession();
        throw customerError('Your session ended. Sign in again to continue.');
      }
      let errorMessage: string | undefined;
      try {
        const parsed = errorEnvelopeSchema.safeParse(await response.json());
        if (parsed.success) errorMessage = parsed.data.error.message;
      } catch {
        /* Use safe fallback. */
      }
      throw customerError(
        errorMessage ?? 'BoomerBuddy could not complete that request.',
        response.status,
      );
    }
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch {
      throw customerError('BoomerBuddy received an unexpected response. Please try again.');
    }
  } catch (error) {
    if (timeoutController?.signal.aborted) {
      throw customerError(
        'BoomerBuddy did not respond in time. Check your connection and try again.',
      );
    }
    if (error instanceof MobileCustomerError) throw error;
    if (callerSignal?.aborted) throw customerError('The request was canceled. Please try again.');
    throw customerError('BoomerBuddy could not connect. Check your connection and try again.');
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function readableError(error: unknown): string {
  return error instanceof MobileCustomerError
    ? error.message
    : 'Something went wrong. Please try again.';
}
