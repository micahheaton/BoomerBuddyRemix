import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  createDevSession,
  createSafeWordVerifier,
  decryptField,
  detectRestrictedInput,
  encryptField,
  fingerprintMinimized,
  minimizeRestrictedInput,
  parseEncryptedField,
  redactSensitiveInput,
  redactForLog,
  serializeEncryptedField,
  verifyDevSession,
  verifySafeWord,
} from './index';

const encryptionKey = Buffer.alloc(32, 7);
const context = {
  tenantId: 'tenant_one',
  resourceId: 'artifact_one',
  field: 'minimized_content',
  schemaVersion: 1,
  keyVersion: 1,
};

describe('AES-256-GCM restricted fields', () => {
  it('round-trips with context-bound, versioned AAD and unique nonces', () => {
    const first = encryptField('bounded harmless input', encryptionKey, context);
    const second = encryptField('bounded harmless input', encryptionKey, context);
    expect(first.iv).not.toBe(second.iv);
    expect(decryptField(first, encryptionKey, context).toString('utf8')).toBe(
      'bounded harmless input',
    );
    expect(parseEncryptedField(serializeEncryptedField(first))).toEqual(first);
  });

  it.each([
    ['tenantId', 'tenant_two'],
    ['resourceId', 'artifact_two'],
    ['field', 'other_field'],
    ['schemaVersion', 2],
    ['keyVersion', 2],
  ] as const)('rejects a swapped %s context', (field, value) => {
    const encrypted = encryptField('harmless', encryptionKey, context);
    expect(() => decryptField(encrypted, encryptionKey, { ...context, [field]: value })).toThrow();
  });

  it('rejects tampering, malformed serialization and wrong key sizes', () => {
    const encrypted = encryptField('harmless', encryptionKey, context);
    const bytes = Buffer.from(encrypted.ciphertext, 'base64');
    if (bytes[0] !== undefined) bytes[0] ^= 1;
    expect(() =>
      decryptField({ ...encrypted, ciphertext: bytes.toString('base64') }, encryptionKey, context),
    ).toThrow();
    expect(() => encryptField('x', Buffer.alloc(31), context)).toThrow(TypeError);
    expect(() => parseEncryptedField('{}')).toThrow(TypeError);
    expect(() => encryptField('x', encryptionKey, { ...context, keyVersion: 0 })).toThrow(
      TypeError,
    );
    expect(() => encryptField('x', encryptionKey, { ...context, tenantId: '' })).toThrow(TypeError);
  });
});

describe('keyed minimized fingerprints', () => {
  it('is stable within scope and differs across tenant, purpose and key', () => {
    const key = Buffer.alloc(32, 9);
    const base = { tenantId: 'tenant_one', purpose: 'duplicate_check', keyVersion: 1 };
    const first = fingerprintMinimized('harmless', key, base);
    expect(fingerprintMinimized('harmless', key, base)).toEqual(first);
    expect(
      fingerprintMinimized('harmless', key, { ...base, tenantId: 'tenant_two' }).value,
    ).not.toBe(first.value);
    expect(fingerprintMinimized('harmless', key, { ...base, purpose: 'provider' }).value).not.toBe(
      first.value,
    );
    expect(fingerprintMinimized('harmless', Buffer.alloc(32, 8), base).value).not.toBe(first.value);
    expect(() => fingerprintMinimized('x', Buffer.alloc(12), base)).toThrow(TypeError);
  });
});

describe('typed secret minimization', () => {
  it('redacts clearly typed credentials, contextual OTPs and Luhn-valid cards', () => {
    const generatedPrivateKey = [
      '-----BEGIN ' + 'PRIVATE KEY-----',
      'generated-test-body',
      '-----END ' + 'PRIVATE KEY-----',
    ].join('\n');
    const generatedCredential = ['Authorization:', 'Bearer', 'generated_test_value_123'].join(' ');
    const generatedPassword = ['password', '=', 'generated-passphrase'].join(' ');
    const generatedOtp = ['verification', 'code', String(100_000 + 2345)].join(' ');
    // Construct at runtime so recognizable values never become stored fixture content.
    const generatedCard = ['4242', '4242', '4242', '4242'].join(' ');
    expect(detectRestrictedInput(generatedPrivateKey)).toContain('private_key');
    expect(detectRestrictedInput(generatedCredential)).toContain('authorization_credential');
    expect(detectRestrictedInput(generatedPassword)).toContain('authorization_credential');
    expect(detectRestrictedInput(generatedOtp)).toContain('one_time_code');
    expect(detectRestrictedInput(generatedCard)).toContain('payment_card');
    for (const value of [generatedCredential, generatedPassword, generatedOtp, generatedCard]) {
      const result = redactSensitiveInput(`Scam message contained ${value}; stop and verify.`);
      expect(result.status).toBe('accepted');
      expect(JSON.stringify(result)).not.toContain(value);
    }
    expect(redactSensitiveInput(generatedPrivateKey)).toEqual(
      expect.objectContaining({ status: 'rejected', reason: 'restricted_input' }),
    );
  });

  it('normalizes benign bounded text and keeps legacy reject-mode fail closed', () => {
    expect(minimizeRestrictedInput('  hello   there\r\n\r\n\r\nfriend  ')).toEqual({
      status: 'accepted',
      minimized: 'hello there\n\nfriend',
      detected: [],
      redactions: [],
      safetyFlags: [],
    });
    expect(minimizeRestrictedInput('verification code 102345').status).toBe('rejected');
    expect(redactSensitiveInput('Skateboarding lessons start at noon.').status).toBe('accepted');
    expect(() => minimizeRestrictedInput('long input', 2)).toThrow(RangeError);
  });

  it('hard-rejects URL secrets, ambiguous credentials, overlap and unusable results', () => {
    const values = [
      ['https://', 'generated-user', ':', 'generated-password', '@example.test/path'].join(''),
      ['https://example.test/path?', 'access_token', '=', 'generated-value'].join(''),
      ['https://example.test/path#', 'verification_code', '=', String(100_000 + 2345)].join(''),
    ];
    for (const value of values) {
      const result = redactSensitiveInput(`Please inspect ${value}`);
      expect(result.status).toBe('rejected');
      expect(JSON.stringify(result)).not.toContain(value);
    }
    const jwt = ['eyJgeneratedheader', 'generatedpayload1', 'generatedsignature1'].join('.');
    expect(redactSensitiveInput(`Received ${jwt}`).status).toBe('rejected');
    expect(redactSensitiveInput('verification code 4242 4242 4242 4242').status).toBe('rejected');
    expect(redactSensitiveInput(['4242', '4242', '4242', '4242'].join(' '))).toEqual(
      expect.objectContaining({ status: 'rejected', reason: 'unusable_after_redaction' }),
    );
  });

  it('returns only class/count metadata and never a redacted original', () => {
    const first = String(100_000 + 2345);
    const second = String(200_000 + 3456);
    const result = redactSensitiveInput(
      `The caller gave verification code ${first} and OTP ${second}; do not use either.`,
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'accepted',
        redactions: [
          {
            class: 'one_time_code',
            placeholder: '[ONE_TIME_CODE]',
            count: 2,
          },
        ],
        safetyFlags: ['contained_one_time_code'],
      }),
    );
    expect(JSON.stringify(result)).not.toContain(first);
    expect(JSON.stringify(result)).not.toContain(second);
  });
});

describe('safe-word verifier', () => {
  it('stores a salted memory-hard verifier and uses normalized constant-time checks', async () => {
    const pepper = Buffer.alloc(32, 4);
    const stored = await createSafeWordVerifier(
      '  Blue Lantern  ',
      pepper,
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(JSON.stringify(stored)).not.toContain('Blue Lantern');
    await expect(verifySafeWord('blue lantern', stored, pepper)).resolves.toBe(true);
    await expect(verifySafeWord('different phrase', stored, pepper)).resolves.toBe(false);
    await expect(verifySafeWord('blue lantern', { ...stored, version: 2 }, pepper)).resolves.toBe(
      false,
    );
  });

  it('rejects weak lengths, short pepper and mismatched byte lengths safely', async () => {
    await expect(createSafeWordVerifier('abc', Buffer.alloc(32))).rejects.toThrow(TypeError);
    await expect(createSafeWordVerifier('valid phrase', Buffer.alloc(8))).rejects.toThrow(
      TypeError,
    );
    expect(constantTimeEqual('short', 'much-longer')).toBe(false);
  });
});

describe('development session envelope', () => {
  const secret = Buffer.alloc(32, 5);
  const claims = {
    issuer: 'boomerbuddy-dev' as const,
    subject: 'seeded_person',
    sessionId: 'session_seeded',
    audience: 'customer' as const,
    issuedAt: 100,
    expiresAt: 200,
  };

  it('verifies only the expected audience and valid lifetime', () => {
    const token = createDevSession(claims, secret);
    expect(
      verifyDevSession(token, secret, {
        audience: 'customer',
        now: new Date(150_000),
        production: false,
      }),
    ).toEqual({ valid: true, claims });
    expect(
      verifyDevSession(token, secret, {
        audience: 'hq',
        now: new Date(150_000),
        production: false,
      }),
    ).toEqual({ valid: false, reason: 'wrong_audience' });
  });

  it('rejects production, expiry, revocation, tampering and malformed values', () => {
    const token = createDevSession(claims, secret);
    expect(verifyDevSession(token, secret, { audience: 'customer', production: true })).toEqual({
      valid: false,
      reason: 'production_refusal',
    });
    expect(
      verifyDevSession(token, secret, {
        audience: 'customer',
        now: new Date(200_000),
        production: false,
      }),
    ).toEqual({ valid: false, reason: 'expired' });
    expect(
      verifyDevSession(token, secret, {
        audience: 'customer',
        now: new Date(150_000),
        production: false,
        revokedSessionIds: new Set(['session_seeded']),
      }),
    ).toEqual({ valid: false, reason: 'revoked' });
    expect(
      verifyDevSession(`${token}x`, secret, { audience: 'customer', production: false }).valid,
    ).toBe(false);
    expect(verifyDevSession('bad', secret, { audience: 'customer', production: false }).valid).toBe(
      false,
    );
    expect(
      verifyDevSession('x'.repeat(4_097), secret, {
        audience: 'customer',
        production: false,
      }),
    ).toEqual({ valid: false, reason: 'malformed' });
    expect(() =>
      createDevSession({ ...claims, expiresAt: claims.issuedAt + 86_401 }, secret),
    ).toThrow('no longer than 24 hours');
  });
});

describe('safe log redaction', () => {
  it('redacts sensitive fields and credential-shaped strings recursively', () => {
    const redacted = redactForLog({
      event: 'request.failed',
      nested: { authorization: 'generated value' },
      note: ['Bearer generated_secret_value'],
    });
    expect(JSON.stringify(redacted)).not.toContain('generated_secret_value');
    expect(redacted).toEqual({
      event: 'request.failed',
      nested: { authorization: '[REDACTED]' },
      note: ['[REDACTED_RESTRICTED_INPUT]'],
    });
  });

  it('redacts restricted values under innocuous keys and inside errors', () => {
    const generatedCard = ['4242', '4242', '4242', '4242'].join(' ');
    const output = redactForLog({
      detail: generatedCard,
      error: new Error('request contained https://private.example/path'),
      array: ['person@example.test'],
    });
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain(generatedCard);
    expect(serialized).not.toContain('private.example');
    expect(serialized).not.toContain('person@example.test');
  });

  it('handles circular metadata without exposing or crashing', () => {
    const circular: Record<string, unknown> = { label: 'safe label' };
    circular.self = circular;
    expect(redactForLog(circular)).toEqual({ label: 'safe label', self: '[CIRCULAR]' });
  });
});
