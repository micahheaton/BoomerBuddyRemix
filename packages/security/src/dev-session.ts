import { createHmac } from 'node:crypto';
import { constantTimeEqual } from './encoding';

export interface DevSessionClaims {
  readonly issuer: 'boomerbuddy-dev';
  readonly subject: string;
  readonly sessionId: string;
  readonly audience: 'customer' | 'mobile' | 'hq';
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export type DevSessionVerification =
  | { readonly valid: true; readonly claims: DevSessionClaims }
  | {
      readonly valid: false;
      readonly reason:
        | 'production_refusal'
        | 'malformed'
        | 'invalid_signature'
        | 'wrong_issuer'
        | 'wrong_audience'
        | 'expired'
        | 'revoked';
    };

function sign(encoded: string, secret: Uint8Array): string {
  if (secret.byteLength < 32)
    throw new TypeError('Session signing secret must be at least 32 bytes');
  return createHmac('sha256', secret).update(encoded).digest('base64url');
}

const opaqueClaim = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;
const maximumSessionSeconds = 24 * 60 * 60;

function validateClaims(claims: DevSessionClaims): void {
  if (claims.issuer !== 'boomerbuddy-dev') throw new TypeError('Invalid development issuer');
  if (!opaqueClaim.test(claims.subject) || !opaqueClaim.test(claims.sessionId)) {
    throw new TypeError('Development session claims require bounded opaque identifiers');
  }
  if (!['customer', 'mobile', 'hq'].includes(claims.audience)) {
    throw new TypeError('Invalid development session audience');
  }
  if (!Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt)) {
    throw new TypeError('Development session timestamps must be integer seconds');
  }
  if (
    claims.expiresAt <= claims.issuedAt ||
    claims.expiresAt - claims.issuedAt > maximumSessionSeconds
  ) {
    throw new TypeError(
      'Development session lifetime must be positive and no longer than 24 hours',
    );
  }
}

export function createDevSession(claims: DevSessionClaims, secret: Uint8Array): string {
  validateClaims(claims);
  const safeClaims: DevSessionClaims = {
    issuer: claims.issuer,
    subject: claims.subject,
    sessionId: claims.sessionId,
    audience: claims.audience,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  };
  const encoded = Buffer.from(JSON.stringify(safeClaims), 'utf8').toString('base64url');
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifyDevSession(
  token: string,
  secret: Uint8Array,
  options: {
    readonly audience: DevSessionClaims['audience'];
    readonly now?: Date;
    readonly production: boolean;
    readonly revokedSessionIds?: ReadonlySet<string>;
  },
): DevSessionVerification {
  if (options.production) return { valid: false, reason: 'production_refusal' };
  if (token.length > 4_096) return { valid: false, reason: 'malformed' };
  const parts = token.split('.');
  const encoded = parts[0];
  const signature = parts[1];
  if (parts.length !== 2 || encoded === undefined || signature === undefined) {
    return { valid: false, reason: 'malformed' };
  }
  let expected: string;
  try {
    expected = sign(encoded, secret);
  } catch {
    return { valid: false, reason: 'invalid_signature' };
  }
  if (!constantTimeEqual(signature, expected)) return { valid: false, reason: 'invalid_signature' };
  let claims: DevSessionClaims;
  try {
    const value: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (typeof value !== 'object' || value === null) return { valid: false, reason: 'malformed' };
    const record = value as Record<string, unknown>;
    if (
      record.issuer !== 'boomerbuddy-dev' ||
      typeof record.subject !== 'string' ||
      typeof record.sessionId !== 'string' ||
      !['customer', 'mobile', 'hq'].includes(String(record.audience)) ||
      typeof record.issuedAt !== 'number' ||
      typeof record.expiresAt !== 'number'
    ) {
      return {
        valid: false,
        reason: record.issuer === 'boomerbuddy-dev' ? 'malformed' : 'wrong_issuer',
      };
    }
    const candidate: DevSessionClaims = {
      issuer: 'boomerbuddy-dev',
      subject: record.subject,
      sessionId: record.sessionId,
      audience: record.audience as DevSessionClaims['audience'],
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
    };
    try {
      validateClaims(candidate);
    } catch {
      return { valid: false, reason: 'malformed' };
    }
    claims = candidate;
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (claims.audience !== options.audience) return { valid: false, reason: 'wrong_audience' };
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (claims.expiresAt <= nowSeconds || claims.issuedAt > nowSeconds + 60) {
    return { valid: false, reason: 'expired' };
  }
  if (options.revokedSessionIds?.has(claims.sessionId) === true) {
    return { valid: false, reason: 'revoked' };
  }
  return { valid: true, claims };
}
