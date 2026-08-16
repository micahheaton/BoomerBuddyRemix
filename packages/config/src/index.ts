import { config as loadDotEnv } from 'dotenv';
import { z } from 'zod';

const booleanText = z.enum(['true', 'false']).transform((value) => value === 'true');
const nonEmpty = z.string().trim().min(1);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  BB_API_HOST: nonEmpty.default('127.0.0.1'),
  BB_API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  BB_DATABASE_DRIVER: z.enum(['pglite', 'postgres']).default('pglite'),
  BB_PGLITE_PATH: nonEmpty.optional(),
  DATABASE_URL: z.string().url().optional(),
  BB_RUN_MIGRATIONS: booleanText.default(true),
  BB_SEED_DEMO: booleanText.default(false),
  BB_ALLOW_DEV_IDENTITY: booleanText.default(true),
  BB_CUSTOMER_ORIGINS: nonEmpty,
  BB_HQ_ORIGINS: nonEmpty,
  BB_SESSION_SECRET: z.string().min(32),
  BB_ARTIFACT_KEY_BASE64: nonEmpty,
  BB_FINGERPRINT_KEY_BASE64: nonEmpty,
  BB_SAFE_WORD_PEPPER: z.string().min(16),
  BB_STRIPE_MODE: z.enum(['disabled', 'test']).default('disabled'),
  BB_STRIPE_SECRET_KEY: z.string().optional(),
  BB_STRIPE_WEBHOOK_SECRET: z.string().optional(),
  BB_STRIPE_API_VERSION: z.string().optional(),
  BB_STRIPE_CANCEL_ONLY_PORTAL_CONFIGURATION_ID: z.string().optional(),
  BB_STRIPE_PLUS_MONTHLY_PRICE_ID: z.string().optional(),
  BB_STRIPE_PLUS_ANNUAL_PRICE_ID: z.string().optional(),
  BB_STRIPE_FAMILY_MONTHLY_PRICE_ID: z.string().optional(),
  BB_STRIPE_FAMILY_ANNUAL_PRICE_ID: z.string().optional(),
  BB_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export interface AppConfig {
  readonly environment: 'development' | 'test' | 'production';
  readonly api: { readonly host: string; readonly port: number };
  readonly database:
    | {
        readonly driver: 'pglite';
        readonly path: string;
        readonly runMigrations: boolean;
        readonly seedDemo: boolean;
      }
    | {
        readonly driver: 'postgres';
        readonly url: string;
        readonly runMigrations: boolean;
        readonly seedDemo: boolean;
      };
  readonly identity: {
    readonly allowDevelopmentIssuer: boolean;
    readonly customerOrigins: readonly string[];
    readonly hqOrigins: readonly string[];
  };
  readonly secrets: {
    readonly session: Buffer;
    readonly artifactEncryptionKey: Buffer;
    readonly fingerprintKey: Buffer;
    readonly safeWordPepper: Buffer;
  };
  readonly commerce:
    | { readonly stripe: { readonly mode: 'disabled' } }
    | {
        readonly stripe: {
          readonly mode: 'test';
          readonly secretKey: string;
          readonly webhookSecret: string;
          readonly apiVersion: string;
          readonly cancelOnlyPortalConfigurationId: string;
          readonly prices: Readonly<
            Record<'plus_v1:month' | 'plus_v1:year' | 'family_v1:month' | 'family_v1:year', string>
          >;
        };
      };
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function decodeBase64Key(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64');
  if (
    decoded.byteLength !== 32 ||
    decoded.toString('base64').replace(/=+$/u, '') !== value.replace(/=+$/u, '')
  ) {
    throw new TypeError('Encryption material must be canonical base64 encoding of 32 bytes');
  }
  return decoded;
}

function origins(value: string, name: string): readonly string[] {
  const parsed = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (parsed.length === 0) throw new TypeError(`${name} must contain at least one origin`);
  const normalized = parsed.map((entry) => {
    const url = new URL(entry);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      throw new TypeError(`${name} entries must be origins without paths, queries, or fragments`);
    }
    return url.origin;
  });
  return [...new Set(normalized)];
}

function refuseUnsafeProduction(parsed: z.infer<typeof environmentSchema>): void {
  if (parsed.NODE_ENV !== 'production') return;
  // Managed identity and KMS adapters are not yet implemented. Refusing the entire
  // production mode is more truthful than accepting raw environment keys as ready.
  throw new TypeError(
    'BoomerBuddy refuses production startup until managed identity and KMS adapters are configured',
  );
}

function stripeConfiguration(parsed: z.infer<typeof environmentSchema>): AppConfig['commerce'] {
  if (parsed.BB_STRIPE_MODE === 'disabled') return { stripe: { mode: 'disabled' } };
  const required = {
    secretKey: parsed.BB_STRIPE_SECRET_KEY,
    webhookSecret: parsed.BB_STRIPE_WEBHOOK_SECRET,
    apiVersion: parsed.BB_STRIPE_API_VERSION,
    cancelOnlyPortalConfigurationId: parsed.BB_STRIPE_CANCEL_ONLY_PORTAL_CONFIGURATION_ID,
    plusMonth: parsed.BB_STRIPE_PLUS_MONTHLY_PRICE_ID,
    plusYear: parsed.BB_STRIPE_PLUS_ANNUAL_PRICE_ID,
    familyMonth: parsed.BB_STRIPE_FAMILY_MONTHLY_PRICE_ID,
    familyYear: parsed.BB_STRIPE_FAMILY_ANNUAL_PRICE_ID,
  };
  if (
    required.secretKey === undefined ||
    !/^sk_test_[A-Za-z0-9_]{8,}$/u.test(required.secretKey) ||
    required.webhookSecret === undefined ||
    !/^whsec_[A-Za-z0-9_]{8,}$/u.test(required.webhookSecret) ||
    required.apiVersion === undefined ||
    !/^\d{4}-\d{2}-\d{2}(?:\.[A-Za-z0-9_-]+)?$/u.test(required.apiVersion) ||
    required.cancelOnlyPortalConfigurationId === undefined ||
    !/^bpc_[A-Za-z0-9_]{6,}$/u.test(required.cancelOnlyPortalConfigurationId) ||
    required.plusMonth === undefined ||
    required.plusYear === undefined ||
    required.familyMonth === undefined ||
    required.familyYear === undefined ||
    ![required.plusMonth, required.plusYear, required.familyMonth, required.familyYear].every(
      (value) => /^price_[A-Za-z0-9_]{6,}$/u.test(value),
    )
  ) {
    throw new TypeError('Stripe test mode requires complete test credentials and price mapping');
  }
  return {
    stripe: {
      mode: 'test',
      secretKey: required.secretKey,
      webhookSecret: required.webhookSecret,
      apiVersion: required.apiVersion,
      cancelOnlyPortalConfigurationId: required.cancelOnlyPortalConfigurationId,
      prices: {
        'plus_v1:month': required.plusMonth,
        'plus_v1:year': required.plusYear,
        'family_v1:month': required.familyMonth,
        'family_v1:year': required.familyYear,
      },
    },
  };
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);
  refuseUnsafeProduction(parsed);
  const customerOrigins = origins(parsed.BB_CUSTOMER_ORIGINS, 'BB_CUSTOMER_ORIGINS');
  const hqOrigins = origins(parsed.BB_HQ_ORIGINS, 'BB_HQ_ORIGINS');
  if (customerOrigins.some((origin) => hqOrigins.includes(origin))) {
    throw new TypeError('Customer and HQ origins must be disjoint');
  }
  if (parsed.NODE_ENV === 'production') {
    for (const origin of [...customerOrigins, ...hqOrigins]) {
      if (!origin.startsWith('https://')) throw new TypeError('Production origins must use HTTPS');
    }
  }

  const database: AppConfig['database'] =
    parsed.BB_DATABASE_DRIVER === 'postgres'
      ? {
          driver: 'postgres',
          url:
            parsed.DATABASE_URL ??
            (() => {
              throw new TypeError('DATABASE_URL is required for the PostgreSQL driver');
            })(),
          runMigrations: parsed.BB_RUN_MIGRATIONS,
          seedDemo: parsed.BB_SEED_DEMO,
        }
      : {
          driver: 'pglite',
          path: parsed.BB_PGLITE_PATH ?? '.data/boomerbuddy',
          runMigrations: parsed.BB_RUN_MIGRATIONS,
          seedDemo: parsed.BB_SEED_DEMO,
        };

  const artifactEncryptionKey = decodeBase64Key(parsed.BB_ARTIFACT_KEY_BASE64);
  const fingerprintKey = decodeBase64Key(parsed.BB_FINGERPRINT_KEY_BASE64);
  const session = Buffer.from(parsed.BB_SESSION_SECRET, 'utf8');
  const safeWordPepper = Buffer.from(parsed.BB_SAFE_WORD_PEPPER, 'utf8');
  const separateSecrets = [artifactEncryptionKey, fingerprintKey, session, safeWordPepper];
  for (let left = 0; left < separateSecrets.length; left += 1) {
    for (let right = left + 1; right < separateSecrets.length; right += 1) {
      if (separateSecrets[left]?.equals(separateSecrets[right] ?? Buffer.alloc(0)) === true) {
        throw new TypeError('Encryption keys, signing secrets, and peppers must be separate');
      }
    }
  }

  return {
    environment: parsed.NODE_ENV,
    api: { host: parsed.BB_API_HOST, port: parsed.BB_API_PORT },
    database,
    identity: {
      allowDevelopmentIssuer: parsed.BB_ALLOW_DEV_IDENTITY,
      customerOrigins,
      hqOrigins,
    },
    secrets: {
      session,
      artifactEncryptionKey,
      fingerprintKey,
      safeWordPepper,
    },
    commerce: stripeConfiguration(parsed),
    logLevel: parsed.BB_LOG_LEVEL,
  };
}

export function loadEnvironmentFile(path?: string): void {
  const result = path === undefined ? loadDotEnv() : loadDotEnv({ path });
  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (path !== undefined || code !== 'ENOENT') throw result.error;
  }
}
