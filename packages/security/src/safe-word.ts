import { randomBytes, scrypt } from 'node:crypto';
import { constantTimeEqual, lengthPrefixed } from './encoding';

export interface SafeWordVerifier {
  readonly algorithm: 'scrypt';
  readonly version: number;
  readonly salt: string;
  readonly verifier: string;
  readonly parameters: {
    readonly cost: number;
    readonly blockSize: number;
    readonly parallelization: number;
    readonly keyLength: number;
  };
  readonly createdAt: string;
}

const parameters = { cost: 16_384, blockSize: 8, parallelization: 1, keyLength: 32 } as const;

function normalizeSafeWord(value: string): string {
  const normalized = value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if (normalized.length < 4 || normalized.length > 128) {
    throw new TypeError('Safe word must be between 4 and 128 characters');
  }
  return normalized;
}

async function derive(value: string, pepper: Uint8Array, salt: Uint8Array): Promise<Buffer> {
  if (pepper.byteLength < 16) throw new TypeError('Safe-word pepper must be at least 16 bytes');
  return new Promise((resolve, reject) => {
    scrypt(
      lengthPrefixed([normalizeSafeWord(value), pepper]),
      salt,
      parameters.keyLength,
      {
        N: parameters.cost,
        r: parameters.blockSize,
        p: parameters.parallelization,
        maxmem: 64 * 1024 * 1024,
      },
      (error, derived) => {
        if (error !== null) reject(error);
        else resolve(derived);
      },
    );
  });
}

export async function createSafeWordVerifier(
  safeWord: string,
  pepper: Uint8Array,
  now: Date = new Date(),
): Promise<SafeWordVerifier> {
  const salt = randomBytes(16);
  const verifier = await derive(safeWord, pepper, salt);
  return {
    algorithm: 'scrypt',
    version: 1,
    salt: salt.toString('base64'),
    verifier: verifier.toString('base64'),
    parameters,
    createdAt: now.toISOString(),
  };
}

export async function verifySafeWord(
  candidate: string,
  stored: SafeWordVerifier,
  pepper: Uint8Array,
): Promise<boolean> {
  if (
    stored.algorithm !== 'scrypt' ||
    stored.version !== 1 ||
    stored.parameters.cost !== parameters.cost ||
    stored.parameters.blockSize !== parameters.blockSize ||
    stored.parameters.parallelization !== parameters.parallelization ||
    stored.parameters.keyLength !== parameters.keyLength
  ) {
    return false;
  }
  try {
    const actual = await derive(candidate, pepper, Buffer.from(stored.salt, 'base64'));
    return constantTimeEqual(actual, Buffer.from(stored.verifier, 'base64'));
  } catch {
    return false;
  }
}
