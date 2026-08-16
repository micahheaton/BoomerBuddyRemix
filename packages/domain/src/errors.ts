export const domainErrorCodes = [
  'invalid_input',
  'invalid_transition',
  'not_found',
  'not_authenticated',
  'not_authorized',
  'conflict',
  'restricted_input',
  'expired',
] as const;

export type DomainErrorCode = (typeof domainErrorCodes)[number];

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly safeDetails: Readonly<Record<string, string | number | boolean>> | undefined;

  constructor(
    code: DomainErrorCode,
    message: string,
    safeDetails?: Readonly<Record<string, string | number | boolean>>,
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.safeDetails = safeDetails;
  }
}
