import { errorEnvelopeSchema } from '@boomerbuddy/contracts';
import {
  captureMobileAuthenticationContext,
  readMobileAuthenticationToken,
  recoverUnauthorizedMobileSession,
  requireMobileAuthenticationContextCurrent,
} from './authentication';
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

class MobileRequestAbortedError extends Error {
  override readonly name = 'MobileRequestAbortedError';
}

function customerError(message: string, status?: number): MobileCustomerError {
  return new MobileCustomerError(message, status);
}

function awaitRequestStep<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal.removeEventListener('abort', abort);
    const abort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new MobileRequestAbortedError());
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

export async function mobileRequest<T>(
  path: string,
  init: RequestInit = {},
  includeAuth = true,
): Promise<T> {
  // Bind the request to the household that was selected when the caller initiated it. Clerk token
  // acquisition can yield long enough for navigation to select a different household.
  const selectedHouseholdId = includeAuth && path !== '/v1/me' ? readSelectedHouseholdId() : null;
  const authenticationContext = includeAuth ? captureMobileAuthenticationContext() : undefined;
  const requireCurrentAuthenticationContext = (): void => {
    if (authenticationContext) {
      requireMobileAuthenticationContextCurrent(authenticationContext);
    }
  };
  const callerSignal = init.signal ?? undefined;
  const requestController = new AbortController();
  let abortCause: 'caller' | 'timeout' | undefined;
  const abortRequest = (cause: 'caller' | 'timeout'): void => {
    if (abortCause !== undefined) return;
    abortCause = cause;
    requestController.abort();
  };
  const abortForCaller = (): void => abortRequest('caller');
  if (callerSignal?.aborted) abortForCaller();
  else callerSignal?.addEventListener('abort', abortForCaller, { once: true });
  const timeout = setTimeout(() => abortRequest('timeout'), 15_000);
  try {
    const token = includeAuth
      ? await awaitRequestStep(
          readMobileAuthenticationToken({}, authenticationContext),
          requestController.signal,
        )
      : null;
    if (includeAuth && !token) {
      await awaitRequestStep(
        recoverUnauthorizedMobileSession(authenticationContext),
        requestController.signal,
      );
      throw customerError('Your session ended. Sign in again to continue.');
    }
    const send = (requestToken: string | null) => {
      requireCurrentAuthenticationContext();
      const headers = new Headers(init.headers);
      headers.set('Accept', 'application/json');
      if (init.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      if (requestToken) headers.set('Authorization', `Bearer ${requestToken}`);
      else headers.delete('Authorization');
      // Native customer authentication is Bearer-only. Never allow a caller-provided browser
      // credential or origin to create an ambiguous production request.
      headers.delete('Cookie');
      headers.delete('Origin');
      if (!includeAuth) {
        headers.delete('X-BB-Household-Id');
      } else if (!headers.has('X-BB-Household-Id')) {
        if (selectedHouseholdId) headers.set('X-BB-Household-Id', selectedHouseholdId);
        else headers.delete('X-BB-Household-Id');
      }
      return fetch(`${baseUrl}${path}`, {
        ...init,
        credentials: 'omit',
        signal: requestController.signal,
        headers,
      });
    };
    let response = await awaitRequestStep(send(token), requestController.signal);
    requireCurrentAuthenticationContext();
    if (response.status === 401 && includeAuth) {
      let refreshedToken: string | null;
      try {
        refreshedToken = await awaitRequestStep(
          readMobileAuthenticationToken({ skipCache: true }, authenticationContext),
          requestController.signal,
        );
      } catch {
        if (requestController.signal.aborted) throw new MobileRequestAbortedError();
        throw customerError('BoomerBuddy could not refresh your session. Please try again.');
      }
      if (!refreshedToken) {
        await awaitRequestStep(
          recoverUnauthorizedMobileSession(authenticationContext),
          requestController.signal,
        );
        throw customerError('Your session ended. Sign in again to continue.');
      }
      response = await awaitRequestStep(send(refreshedToken), requestController.signal);
      requireCurrentAuthenticationContext();
    }
    if (!response.ok) {
      if (response.status === 401 && includeAuth) {
        await awaitRequestStep(
          recoverUnauthorizedMobileSession(authenticationContext),
          requestController.signal,
        );
        throw customerError('Your session ended. Sign in again to continue.');
      }
      let errorMessage: string | undefined;
      try {
        const parsed = errorEnvelopeSchema.safeParse(
          await awaitRequestStep(response.json(), requestController.signal),
        );
        if (parsed.success) errorMessage = parsed.data.error.message;
      } catch {
        if (requestController.signal.aborted) throw new MobileRequestAbortedError();
        /* Use safe fallback. */
      }
      requireCurrentAuthenticationContext();
      throw customerError(
        errorMessage ?? 'BoomerBuddy could not complete that request.',
        response.status,
      );
    }
    if (response.status === 204) return undefined as T;
    try {
      const body = (await awaitRequestStep(response.json(), requestController.signal)) as T;
      requireCurrentAuthenticationContext();
      return body;
    } catch {
      if (requestController.signal.aborted) throw new MobileRequestAbortedError();
      throw customerError('BoomerBuddy received an unexpected response. Please try again.');
    }
  } catch (error) {
    if (abortCause === 'timeout') {
      throw customerError(
        'BoomerBuddy did not respond in time. Check your connection and try again.',
      );
    }
    if (error instanceof MobileCustomerError) throw error;
    if (abortCause === 'caller') throw customerError('The request was canceled. Please try again.');
    throw customerError('BoomerBuddy could not connect. Check your connection and try again.');
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abortForCaller);
  }
}

export function readableError(error: unknown): string {
  return error instanceof MobileCustomerError
    ? error.message
    : 'Something went wrong. Please try again.';
}
