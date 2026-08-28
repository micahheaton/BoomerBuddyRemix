import { errorEnvelopeSchema, type ErrorEnvelope } from '@boomerbuddy/contracts';
import {
  captureMobileAuthenticationContext,
  readMobileAuthenticationToken,
  recoverUnauthorizedMobileSession,
  requireMobileAuthenticationContextCurrent,
} from './authentication';
import { resolveMobileApiOrigin } from './api-origin';
import { MobileCustomerError } from './customer-error';
import { readSelectedHouseholdId } from './session';

export { MobileCustomerError, requiresRecentAuthentication } from './customer-error';

declare const process: { env: { EXPO_PUBLIC_API_URL?: string } };
declare const __DEV__: boolean;

const baseUrl = resolveMobileApiOrigin({
  configured: process.env.EXPO_PUBLIC_API_URL,
  development: __DEV__,
});

export type MobileRequestInit = RequestInit & {
  readonly authenticationPurpose?: 'session_sign_out';
};

class MobileRequestAbortedError extends Error {
  override readonly name = 'MobileRequestAbortedError';
}

function customerError(
  message: string,
  status?: number,
  code?: string,
  details?: ErrorEnvelope['error']['details'],
): MobileCustomerError {
  return new MobileCustomerError(message, status, code, details);
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
  init: MobileRequestInit = {},
  includeAuth = true,
): Promise<T> {
  const { authenticationPurpose, ...requestInit } = init;
  const method = (requestInit.method ?? 'GET').toUpperCase();
  if (
    authenticationPurpose !== undefined &&
    (!includeAuth || path !== '/v1/sessions/current' || method !== 'DELETE')
  ) {
    throw new TypeError(
      'Pending sign-out authentication is limited to the exact current-session DELETE.',
    );
  }
  // Bind the request to the household that was selected when the caller initiated it. Clerk token
  // acquisition can yield long enough for navigation to select a different household.
  const selectedHouseholdId = includeAuth && path !== '/v1/me' ? readSelectedHouseholdId() : null;
  const authenticationContext = includeAuth ? captureMobileAuthenticationContext() : undefined;
  const requireCurrentAuthenticationContext = (): void => {
    if (authenticationContext) {
      requireMobileAuthenticationContextCurrent(authenticationContext);
    }
  };
  const callerSignal = requestInit.signal ?? undefined;
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
          readMobileAuthenticationToken(
            authenticationPurpose === undefined ? {} : { purpose: authenticationPurpose },
            authenticationContext,
          ),
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
      const headers = new Headers(requestInit.headers);
      headers.set('Accept', 'application/json');
      if (requestInit.body && !headers.has('Content-Type')) {
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
        ...requestInit,
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
          readMobileAuthenticationToken(
            {
              skipCache: true,
              ...(authenticationPurpose === undefined ? {} : { purpose: authenticationPurpose }),
            },
            authenticationContext,
          ),
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
      let parsedError: ErrorEnvelope['error'] | undefined;
      try {
        const parsed = errorEnvelopeSchema.safeParse(
          await awaitRequestStep(response.json(), requestController.signal),
        );
        if (parsed.success) parsedError = parsed.data.error;
      } catch {
        if (requestController.signal.aborted) throw new MobileRequestAbortedError();
        /* Use safe fallback. */
      }
      requireCurrentAuthenticationContext();
      throw customerError(
        parsedError?.message ?? 'BoomerBuddy could not complete that request.',
        response.status,
        parsedError?.code,
        parsedError?.details,
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
