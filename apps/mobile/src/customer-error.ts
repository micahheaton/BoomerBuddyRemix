import type { ErrorEnvelope } from '@boomerbuddy/contracts';

export class MobileCustomerError extends Error {
  override readonly name = 'MobileCustomerError';

  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly details?: ErrorEnvelope['error']['details'],
  ) {
    super(message);
  }
}

export function requiresRecentAuthentication(error: unknown): error is MobileCustomerError {
  return (
    error instanceof MobileCustomerError &&
    error.status === 403 &&
    error.details?.action === 'sign_in_again' &&
    error.details.reason === 'recent_authentication_required'
  );
}
