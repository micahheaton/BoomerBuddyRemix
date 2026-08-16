import { createHmac } from 'node:crypto';
import { lengthPrefixed } from './encoding';

export interface FingerprintContext {
  readonly tenantId: string;
  readonly purpose: string;
  readonly keyVersion: number;
}

export interface KeyedFingerprint {
  readonly algorithm: 'hmac-sha256';
  readonly keyVersion: number;
  readonly value: string;
}

export function fingerprintMinimized(
  minimized: string | Uint8Array,
  key: Uint8Array,
  context: FingerprintContext,
): KeyedFingerprint {
  if (key.byteLength < 32) throw new TypeError('Fingerprint key must contain at least 32 bytes');
  const macInput = lengthPrefixed([
    'boomerbuddy:minimized-fingerprint',
    context.tenantId,
    context.purpose,
    String(context.keyVersion),
    minimized,
  ]);
  return {
    algorithm: 'hmac-sha256',
    keyVersion: context.keyVersion,
    value: createHmac('sha256', key).update(macInput).digest('base64url'),
  };
}
