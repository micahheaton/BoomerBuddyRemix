import type { ErrorEnvelope } from '@boomerbuddy/contracts';

const baseUrl =
  process.env.NODE_ENV === 'production'
    ? '/api'
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000');

export class HqApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HqApiError';
  }
}

export async function hqRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const callerSignal = init.signal ?? undefined;
  const timeoutController = callerSignal ? undefined : new AbortController();
  const timeout = timeoutController
    ? setTimeout(() => timeoutController.abort(), 15_000)
    : undefined;
  const requestSignal = callerSignal ?? timeoutController!.signal;
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      signal: requestSignal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      let error: ErrorEnvelope | undefined;
      try {
        error = (await response.json()) as ErrorEnvelope;
      } catch {
        /* Preserve the safe fallback. */
      }
      throw new HqApiError(
        error?.error.message ?? 'The local HQ service could not complete this request.',
        response.status,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (timeoutController?.signal.aborted) {
      throw new HqApiError('The local service did not respond in time.', 408);
    }
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function readableError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
