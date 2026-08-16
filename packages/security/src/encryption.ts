import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { lengthPrefixed } from './encoding';

export interface EncryptionContext {
  readonly tenantId: string;
  readonly resourceId: string;
  readonly field: string;
  readonly schemaVersion: number;
  readonly keyVersion: number;
}

export interface EncryptedField {
  readonly algorithm: 'aes-256-gcm';
  readonly keyVersion: number;
  readonly schemaVersion: number;
  readonly iv: string;
  readonly ciphertext: string;
  readonly authenticationTag: string;
}

function assertKey(key: Uint8Array): Buffer {
  if (key.byteLength !== 32) throw new TypeError('AES-256-GCM requires a 32-byte key');
  return Buffer.from(key);
}

export function fieldAdditionalData(context: EncryptionContext): Buffer {
  if (
    !Number.isSafeInteger(context.schemaVersion) ||
    context.schemaVersion < 1 ||
    !Number.isSafeInteger(context.keyVersion) ||
    context.keyVersion < 1
  ) {
    throw new TypeError('Encryption versions must be positive safe integers');
  }
  for (const value of [context.tenantId, context.resourceId, context.field]) {
    if (value.length < 1 || Buffer.byteLength(value, 'utf8') > 256) {
      throw new TypeError('Encryption context fields must contain 1-256 UTF-8 bytes');
    }
  }
  return lengthPrefixed([
    'boomerbuddy:restricted-field',
    context.tenantId,
    context.resourceId,
    context.field,
    String(context.schemaVersion),
    String(context.keyVersion),
  ]);
}

export function encryptField(
  plaintext: string | Uint8Array,
  key: Uint8Array,
  context: EncryptionContext,
): EncryptedField {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', assertKey(key), iv);
  cipher.setAAD(fieldAdditionalData(context));
  const ciphertext = Buffer.concat([
    cipher.update(typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext),
    cipher.final(),
  ]);
  return {
    algorithm: 'aes-256-gcm',
    keyVersion: context.keyVersion,
    schemaVersion: context.schemaVersion,
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authenticationTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptField(
  encrypted: EncryptedField,
  key: Uint8Array,
  context: EncryptionContext,
): Buffer {
  if (
    encrypted.algorithm !== 'aes-256-gcm' ||
    encrypted.keyVersion !== context.keyVersion ||
    encrypted.schemaVersion !== context.schemaVersion
  ) {
    throw new Error('Encrypted field context does not match');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    assertKey(key),
    Buffer.from(encrypted.iv, 'base64'),
  );
  decipher.setAAD(fieldAdditionalData(context));
  decipher.setAuthTag(Buffer.from(encrypted.authenticationTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]);
}

export function serializeEncryptedField(field: EncryptedField): string {
  return JSON.stringify(field);
}

export function parseEncryptedField(serialized: string): EncryptedField {
  const value: unknown = JSON.parse(serialized);
  if (typeof value !== 'object' || value === null) throw new TypeError('Invalid encrypted field');
  const record = value as Record<string, unknown>;
  if (
    record.algorithm !== 'aes-256-gcm' ||
    typeof record.keyVersion !== 'number' ||
    typeof record.schemaVersion !== 'number' ||
    typeof record.iv !== 'string' ||
    typeof record.ciphertext !== 'string' ||
    typeof record.authenticationTag !== 'string'
  ) {
    throw new TypeError('Invalid encrypted field');
  }
  return {
    algorithm: 'aes-256-gcm',
    keyVersion: record.keyVersion,
    schemaVersion: record.schemaVersion,
    iv: record.iv,
    ciphertext: record.ciphertext,
    authenticationTag: record.authenticationTag,
  };
}
