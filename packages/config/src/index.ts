import { config as loadDotEnv } from 'dotenv';
import { z } from 'zod';

const booleanText = z.enum(['true', 'false']).transform((value) => value === 'true');
const nonEmpty = z.string().trim().min(1);
const boundedExternalIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,511}$/u;
const boundedPersonIdentifier = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;
const publishedDevelopmentSecretDefaults = {
  artifactEncryptionKey: Buffer.alloc(32),
  fingerprintKey: Buffer.alloc(32, 1),
  safeWordPepper: Buffer.from('local-safe-word-pepper-not-for-production', 'utf8'),
} as const;

function postgresConnectionString(value: string, production: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    url.hostname === '' ||
    url.pathname === '/' ||
    url.hash !== ''
  ) {
    throw new TypeError('DATABASE_URL must identify one PostgreSQL database');
  }
  if (production) {
    const sslModes = url.searchParams.getAll('sslmode');
    if (
      sslModes.length !== 1 ||
      !['require', 'verify-ca', 'verify-full'].includes(sslModes[0] ?? '')
    ) {
      throw new TypeError('Production DATABASE_URL must require encrypted PostgreSQL transport');
    }
  }
  return value;
}

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  BB_API_HOST: nonEmpty.default('127.0.0.1'),
  BB_API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  BB_TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0),
  BB_PRIVATE_BETA_ACCESS_INTENTS_ENABLED: booleanText.default(false),
  BB_PRIVATE_BETA_ACCESS_INTENTS_EDGE_GUARD_CONFIRMED: booleanText.default(false),
  BB_SUPPORT_RECEIPTS_CUSTOMER_ACCESS_ENABLED: booleanText.default(false),
  BB_SUPPORT_RECEIPTS_INTAKE_ENABLED: booleanText.default(false),
  BB_SUPPORT_RECEIPTS_HQ_QUEUE_ENABLED: booleanText.default(false),
  BB_FIRST_PARTY_CONTENT_ENABLED: booleanText.default(false),
  BB_DAILY_CONTENT_DRAFTS_ENABLED: booleanText.default(false),
  BB_DATABASE_DRIVER: z.enum(['pglite', 'postgres']).default('pglite'),
  BB_PGLITE_PATH: nonEmpty.optional(),
  DATABASE_URL: z.string().url().optional(),
  BB_POSTGRES_POOL_MAX: z.coerce.number().int().min(1).max(10).optional(),
  BB_RUN_MIGRATIONS: booleanText.default(true),
  BB_SEED_DEMO: booleanText.default(false),
  BB_ALLOW_DEV_IDENTITY: booleanText.default(true),
  BB_FOUNDER_PERSON_ID: nonEmpty.optional(),
  BB_FOUNDER_CLERK_SUBJECT: nonEmpty.optional(),
  BB_CUSTOMER_ORIGINS: nonEmpty,
  BB_HQ_ORIGINS: nonEmpty,
  BB_CLERK_CUSTOMER_ISSUER: nonEmpty.optional(),
  BB_CLERK_CUSTOMER_AUDIENCE: nonEmpty.optional(),
  BB_CLERK_CUSTOMER_JWT_KEY: nonEmpty.optional(),
  BB_CLERK_MOBILE_AUTHORIZED_PARTIES: z.string().trim().min(1).max(4_096).optional(),
  BB_CLERK_HQ_ISSUER: nonEmpty.optional(),
  BB_CLERK_HQ_AUDIENCE: nonEmpty.optional(),
  BB_CLERK_HQ_JWT_KEY: nonEmpty.optional(),
  BB_CLERK_HQ_MAX_SECOND_FACTOR_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(3_600)
    .default(600),
  BB_SESSION_SECRET: z.string().min(32).optional(),
  BB_ARTIFACT_KEY_BASE64: nonEmpty,
  BB_FINGERPRINT_KEY_BASE64: nonEmpty,
  BB_SAFE_WORD_PEPPER: z.string().min(16),
  BB_STRIPE_MODE: z.enum(['disabled', 'test', 'live']).default('disabled'),
  BB_STRIPE_TEST_ACCOUNT_ID: z.string().optional(),
  BB_STRIPE_TEST_API_KEY: z.string().optional(),
  BB_STRIPE_TEST_WEBHOOK_SECRET: z.string().optional(),
  BB_STRIPE_TEST_FOUNDING_PRODUCT_ID: z.string().optional(),
  BB_STRIPE_TEST_FOUNDING_MONTHLY_PRICE_ID: z.string().optional(),
  BB_STRIPE_TEST_FAMILY_ANNUAL_PRICE_ID: z.string().optional(),
  BB_STRIPE_TEST_INDIVIDUAL_PRODUCT_ID: z.string().optional(),
  BB_STRIPE_TEST_INDIVIDUAL_MONTHLY_PRICE_ID: z.string().optional(),
  BB_STRIPE_TEST_INDIVIDUAL_ANNUAL_PRICE_ID: z.string().optional(),
  BB_STRIPE_TEST_INDIVIDUAL_OFFERS_ENABLED: booleanText.default(false),
  BB_STRIPE_TEST_CANCEL_ONLY_PORTAL_CONFIGURATION_ID: z.string().optional(),
  BB_STRIPE_LIVE_ACCOUNT_ID: z.string().optional(),
  BB_STRIPE_RUNTIME_SURFACE: z.enum(['api', 'worker']).optional(),
  BB_STRIPE_LIVE_INITIATION_ENABLED: booleanText.default(false),
  BB_STRIPE_LIVE_API_RESTRICTED_KEY: z.string().optional(),
  BB_STRIPE_LIVE_WORKER_RESTRICTED_KEY: z.string().optional(),
  // Legacy name is parsed only so startup can reject an unrestricted or shared live key clearly.
  BB_STRIPE_LIVE_API_KEY: z.string().optional(),
  BB_STRIPE_LIVE_WEBHOOK_SECRET: z.string().optional(),
  BB_STRIPE_LIVE_FOUNDING_PRODUCT_ID: z.string().optional(),
  BB_STRIPE_LIVE_FOUNDING_MONTHLY_PRICE_ID: z.string().optional(),
  BB_STRIPE_LIVE_FAMILY_ANNUAL_PRICE_ID: z.string().optional(),
  BB_STRIPE_LIVE_INDIVIDUAL_PRODUCT_ID: z.string().optional(),
  BB_STRIPE_LIVE_INDIVIDUAL_MONTHLY_PRICE_ID: z.string().optional(),
  BB_STRIPE_LIVE_INDIVIDUAL_ANNUAL_PRICE_ID: z.string().optional(),
  BB_STRIPE_LIVE_INDIVIDUAL_OFFERS_ENABLED: booleanText.default(false),
  BB_STRIPE_LIVE_CANCEL_ONLY_PORTAL_CONFIGURATION_ID: z.string().optional(),
  BB_BILLING_PUBLIC_SUPPORT_EMAIL: z.string().trim().email().optional(),
  BB_BILLING_PUBLIC_SUPPORT_URL: z.string().url().optional(),
  BB_BILLING_PUBLIC_PRIVACY_URL: z.string().url().optional(),
  BB_BILLING_PUBLIC_TERMS_URL: z.string().url().optional(),
  BB_BILLING_PUBLIC_BILLING_TERMS_URL: z.string().url().optional(),
  BB_BILLING_POLICY_VERSION: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/u)
    .optional(),
  BB_BILLING_POLICY_EFFECTIVE_AT: z.string().datetime({ offset: true }).optional(),
  BB_BILLING_SUPPORT_OPERATIONS_READY: booleanText.default(false),
  BB_BILLING_SUPPORT_RECEIPT_ID: z.string().trim().regex(boundedExternalIdentifier).optional(),
  BB_BILLING_TRIAL_REMINDER_DELIVERY_MODE: z
    .enum(['stripe_automatic_email', 'consented_durable_channel'])
    .optional(),
  BB_BILLING_TRIAL_REMINDER_DELIVERY_RECEIPT_ID: z
    .string()
    .trim()
    .regex(boundedExternalIdentifier)
    .optional(),
  BB_BILLING_TAX_TREATMENT_REVIEW_COMPLETE: booleanText.default(false),
  BB_BILLING_TAX_REVIEWED_LAUNCH_GEOGRAPHY: z
    .string()
    .trim()
    .regex(boundedExternalIdentifier)
    .optional(),
  BB_BILLING_TAX_TREATMENT_REVIEW_RECEIPT_ID: z
    .string()
    .trim()
    .regex(boundedExternalIdentifier)
    .optional(),
  BB_TWILIO_MODE: z.literal('disabled').default('disabled'),
  BB_TWILIO_ACCOUNT_SID: z.string().optional(),
  BB_TWILIO_AUTH_TOKEN: z.string().optional(),
  BB_TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  BB_TWILIO_TOLL_FREE_NUMBER_SID: z.string().optional(),
  BB_TWILIO_INBOUND_WEBHOOK_BASE_URL: z.string().optional(),
  BB_TWILIO_STATUS_CALLBACK_BASE_URL: z.string().optional(),
  BB_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type StripeRuntimeOfferId =
  | 'founding_family_monthly_v1'
  | 'family_monthly_v2'
  | 'family_annual_v2'
  | 'individual_monthly_v1'
  | 'individual_annual_v1';

export interface StripeRuntimeOffer {
  readonly offerId: StripeRuntimeOfferId;
  readonly planVersionId: 'family_v1' | 'family_v3' | 'individual_v3';
  readonly plan: 'family' | 'individual';
  readonly displayName: 'Family' | 'Individual';
  readonly billingInterval: 'month' | 'year';
  readonly providerProductId: string;
  readonly providerPriceId: string;
  readonly currency: 'usd';
  readonly unitAmountMinor: 899 | 1499 | 8990 | 14990;
  readonly quantity: 1;
  readonly trialPeriodDays: 0 | 7;
  readonly customerSelectable: boolean;
  readonly defaultAcquisitionOffer: boolean;
}

export type StripeBillingOperationalReadiness =
  | { readonly state: 'incomplete' }
  | {
      readonly state: 'ready';
      readonly supportEmail: string;
      readonly supportUrl: string;
      readonly privacyUrl: string;
      readonly termsUrl: string;
      readonly billingTermsUrl: string;
      readonly policyVersion: string;
      readonly policyEffectiveAt: string;
      readonly supportOperationsReady: true;
      readonly supportReceiptId: string;
      readonly trialReminderDeliveryMode: 'stripe_automatic_email' | 'consented_durable_channel';
      readonly trialReminderDeliveryReceiptId: string;
      readonly taxTreatmentReviewComplete: true;
      readonly taxReviewedLaunchGeography: string;
      readonly taxTreatmentReviewReceiptId: string;
    };

export interface AppConfig {
  readonly environment: 'development' | 'test' | 'production';
  readonly api: {
    readonly host: string;
    readonly port: number;
    /** Zero trusts the direct peer only; nonzero must match the reviewed hosting topology. */
    readonly trustedProxyHops: 0 | 1 | 2;
  };
  /**
   * The public mutation is enabled only when the application switch and independently operated
   * edge guard have both been explicitly confirmed. Hand-built test configurations may omit this
   * object and therefore fail closed.
   */
  readonly accessIntents?: {
    readonly runtimeEnabled: boolean;
    readonly edgeRateLimitConfirmed: boolean;
  };
  readonly supportReceipts?: {
    readonly customerAccessEnabled: boolean;
    readonly intakeEnabled: boolean;
    readonly hqQueueEnabled: boolean;
  };
  readonly content?: {
    readonly firstPartyPublishingEnabled: boolean;
    readonly dailyDraftGenerationEnabled: boolean;
  };
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
        readonly poolMax: number;
        readonly runMigrations: boolean;
        readonly seedDemo: boolean;
      };
  readonly identity: {
    readonly allowDevelopmentIssuer: boolean;
    readonly customerOrigins: readonly string[];
    /** Exact founder identity for consequential automation-control mutations. Omitted means fail closed. */
    readonly founderPersonId?: string;
    readonly hqOrigins: readonly string[];
    /** Present only after the production startup invariants have all passed. */
    readonly clerk?: {
      readonly customer: {
        readonly issuer: string;
        readonly audience: string;
        readonly jwtKey: string;
        readonly authorizedParties: readonly string[];
        /** Empty means native JWTs must omit azp; otherwise only these exact HTTPS origins pass. */
        readonly mobileAuthorizedParties?: readonly string[];
      };
      readonly hq: {
        readonly issuer: string;
        readonly audience: string;
        readonly jwtKey: string;
        readonly authorizedParties: readonly string[];
        readonly maxSecondFactorAgeSeconds: number;
      };
      readonly founderSubject: string;
    };
  };
  readonly secrets: {
    readonly session: Buffer;
    readonly artifactEncryptionKey: Buffer;
    readonly fingerprintKey: Buffer;
    readonly safeWordPepper: Buffer;
    /** Replit runtime secrets are an explicitly accepted, bounded beta custody tier. */
    readonly custodyClassification?: 'local_development' | 'replit_runtime_secret_beta';
  };
  readonly commerce:
    | { readonly stripe: { readonly mode: 'disabled' } }
    | {
        readonly stripe: {
          readonly mode: 'test';
          readonly environment: 'test';
          readonly accountId: string;
          readonly apiKey: string;
          readonly webhookSecret: string;
          readonly apiVersion: typeof stripeApiVersion;
          readonly runtimeInitiationPermitted: true;
          readonly runtimeNetworkPermitted: true;
          readonly cancelOnlyPortalConfigurationId: string;
          readonly defaultOfferId: 'family_annual_v2';
          readonly offer: StripeRuntimeOffer;
          readonly offers: readonly StripeRuntimeOffer[];
          readonly billingOperationalReadiness: StripeBillingOperationalReadiness;
        };
      }
    | {
        readonly stripe:
          | {
              readonly mode: 'live';
              readonly environment: 'production';
              readonly runtimeSurface: 'api';
              readonly accountId: string;
              readonly apiRestrictedKey: string;
              readonly webhookSecret: string;
              readonly apiVersion: typeof stripeApiVersion;
              readonly runtimeInitiationPermitted: boolean;
              readonly runtimeNetworkPermitted: true;
              readonly credentialCustody: 'separate_replit_runtime_restricted_keys';
              readonly cancelOnlyPortalConfigurationId: string;
              readonly defaultOfferId: 'family_annual_v2';
              readonly offer: StripeRuntimeOffer;
              readonly offers: readonly StripeRuntimeOffer[];
              readonly billingOperationalReadiness: StripeBillingOperationalReadiness;
            }
          | {
              readonly mode: 'live';
              readonly environment: 'production';
              readonly runtimeSurface: 'worker';
              readonly accountId: string;
              readonly workerRestrictedKey: string;
              readonly apiVersion: typeof stripeApiVersion;
              readonly runtimeInitiationPermitted: false;
              readonly runtimeNetworkPermitted: true;
              readonly credentialCustody: 'separate_replit_runtime_restricted_keys';
              readonly cancelOnlyPortalConfigurationId: string;
              readonly defaultOfferId: 'family_annual_v2';
              readonly offer: StripeRuntimeOffer;
              readonly offers: readonly StripeRuntimeOffer[];
              readonly billingOperationalReadiness: StripeBillingOperationalReadiness;
            };
      };
  readonly messaging?: {
    readonly twilio: {
      readonly mode: 'disabled';
      readonly runtimeNetworkPermitted: false;
      readonly credentialLoadingPermitted: false;
    };
  };
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/** Enforce that each live process receives only its own least-privilege credential family. */
export function assertStripeOnlineRuntimePermitted(
  config: AppConfig,
  surface: 'api' | 'worker',
): void {
  if (config.commerce.stripe.mode === 'live' && config.commerce.stripe.runtimeSurface !== surface) {
    throw new TypeError(
      `Live Stripe ${surface} startup refuses ${config.commerce.stripe.runtimeSurface} credential custody`,
    );
  }
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

function refusePublishedProductionSecretDefaults(
  environment: AppConfig['environment'],
  material: {
    readonly artifactEncryptionKey: Buffer;
    readonly fingerprintKey: Buffer;
    readonly safeWordPepper: Buffer;
  },
): void {
  if (environment !== 'production') return;
  if (
    material.artifactEncryptionKey.equals(publishedDevelopmentSecretDefaults.artifactEncryptionKey)
  ) {
    throw new TypeError(
      'Production refuses the published .env.example default for BB_ARTIFACT_KEY_BASE64',
    );
  }
  if (material.fingerprintKey.equals(publishedDevelopmentSecretDefaults.fingerprintKey)) {
    throw new TypeError(
      'Production refuses the published .env.example default for BB_FINGERPRINT_KEY_BASE64',
    );
  }
  if (material.safeWordPepper.equals(publishedDevelopmentSecretDefaults.safeWordPepper)) {
    throw new TypeError(
      'Production refuses the published .env.example default for BB_SAFE_WORD_PEPPER',
    );
  }
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

function mobileAuthorizedParties(value: string | undefined): readonly string[] {
  if (value === undefined) {
    throw new TypeError('BB_CLERK_MOBILE_AUTHORIZED_PARTIES is required in production');
  }
  if (value === 'none') return [];
  const parsed = origins(value, 'BB_CLERK_MOBILE_AUTHORIZED_PARTIES');
  if (parsed.length > 8 || parsed.some((origin) => !origin.startsWith('https://'))) {
    throw new TypeError(
      'BB_CLERK_MOBILE_AUTHORIZED_PARTIES must be none or at most eight exact HTTPS origins',
    );
  }
  return parsed;
}

function refuseUnsafeProduction(parsed: z.infer<typeof environmentSchema>): void {
  if (parsed.NODE_ENV !== 'production') return;
  if (parsed.BB_DATABASE_DRIVER !== 'postgres') {
    throw new TypeError('Production requires the PostgreSQL database driver');
  }
  if (parsed.BB_RUN_MIGRATIONS) {
    throw new TypeError('Production refuses runtime database migrations');
  }
  if (parsed.BB_SEED_DEMO) {
    throw new TypeError('Production refuses demo data seeding');
  }
  if (parsed.BB_ALLOW_DEV_IDENTITY) {
    throw new TypeError('Production refuses the development identity issuer');
  }
  if (parsed.BB_SESSION_SECRET !== undefined) {
    throw new TypeError('Production refuses unused development session signing material');
  }
  if (parsed.BB_TRUSTED_PROXY_HOPS !== 0) {
    throw new TypeError('Production trusted proxy hops remain zero until deployed proof exists');
  }
  if (parsed.BB_POSTGRES_POOL_MAX === undefined) {
    throw new TypeError('Production requires an explicit BB_POSTGRES_POOL_MAX');
  }
  if (parsed.BB_TWILIO_MODE !== 'disabled') {
    throw new TypeError('Production requires Twilio to remain disabled');
  }
  const requiredIdentity = [
    parsed.BB_FOUNDER_PERSON_ID,
    parsed.BB_FOUNDER_CLERK_SUBJECT,
    parsed.BB_CLERK_CUSTOMER_ISSUER,
    parsed.BB_CLERK_CUSTOMER_AUDIENCE,
    parsed.BB_CLERK_CUSTOMER_JWT_KEY,
    parsed.BB_CLERK_MOBILE_AUTHORIZED_PARTIES,
    parsed.BB_CLERK_HQ_ISSUER,
    parsed.BB_CLERK_HQ_AUDIENCE,
    parsed.BB_CLERK_HQ_JWT_KEY,
  ];
  if (requiredIdentity.some((value) => value === undefined)) {
    throw new TypeError(
      'Production requires complete customer, HQ, and founder Clerk identity configuration',
    );
  }
  if (
    !boundedPersonIdentifier.test(parsed.BB_FOUNDER_PERSON_ID as string) ||
    !boundedExternalIdentifier.test(parsed.BB_FOUNDER_CLERK_SUBJECT as string) ||
    (parsed.BB_CLERK_CUSTOMER_AUDIENCE as string).length > 512 ||
    /\s/u.test(parsed.BB_CLERK_CUSTOMER_AUDIENCE as string) ||
    (parsed.BB_CLERK_HQ_AUDIENCE as string).length > 512 ||
    /\s/u.test(parsed.BB_CLERK_HQ_AUDIENCE as string)
  ) {
    throw new TypeError('Production founder and Clerk audience identifiers are invalid');
  }
  if (parsed.BB_CLERK_CUSTOMER_ISSUER === parsed.BB_CLERK_HQ_ISSUER) {
    throw new TypeError('Production customer and HQ Clerk issuers must be distinct');
  }
  if (parsed.BB_CLERK_CUSTOMER_AUDIENCE === parsed.BB_CLERK_HQ_AUDIENCE) {
    throw new TypeError('Production customer and HQ Clerk audiences must be distinct');
  }
  if (parsed.BB_CLERK_CUSTOMER_JWT_KEY === parsed.BB_CLERK_HQ_JWT_KEY) {
    throw new TypeError('Production customer and HQ Clerk verification keys must be distinct');
  }
}

function clerkIssuer(value: string | undefined, name: string): string {
  if (value === undefined) throw new TypeError(`${name} is required`);
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new TypeError(`${name} must be an HTTPS issuer origin`);
  }
  if (url.origin.length > 2_048) throw new TypeError(`${name} is too long`);
  return url.origin;
}

function clerkJwtKey(value: string | undefined, name: string): string {
  if (
    value === undefined ||
    !/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/u.test(value) ||
    value.length > 8_192
  ) {
    throw new TypeError(`${name} must be a bounded PEM public key`);
  }
  return value;
}

export const stripeApiVersion = '2026-07-29.dahlia' as const;

function stripeConfiguration(parsed: z.infer<typeof environmentSchema>): AppConfig['commerce'] {
  const testFields = [
    parsed.BB_STRIPE_TEST_ACCOUNT_ID,
    parsed.BB_STRIPE_TEST_API_KEY,
    parsed.BB_STRIPE_TEST_WEBHOOK_SECRET,
    parsed.BB_STRIPE_TEST_FOUNDING_PRODUCT_ID,
    parsed.BB_STRIPE_TEST_FOUNDING_MONTHLY_PRICE_ID,
    parsed.BB_STRIPE_TEST_FAMILY_ANNUAL_PRICE_ID,
    parsed.BB_STRIPE_TEST_INDIVIDUAL_PRODUCT_ID,
    parsed.BB_STRIPE_TEST_INDIVIDUAL_MONTHLY_PRICE_ID,
    parsed.BB_STRIPE_TEST_INDIVIDUAL_ANNUAL_PRICE_ID,
    parsed.BB_STRIPE_TEST_CANCEL_ONLY_PORTAL_CONFIGURATION_ID,
  ];
  const liveFields = [
    parsed.BB_STRIPE_LIVE_ACCOUNT_ID,
    parsed.BB_STRIPE_RUNTIME_SURFACE,
    parsed.BB_STRIPE_LIVE_API_RESTRICTED_KEY,
    parsed.BB_STRIPE_LIVE_WORKER_RESTRICTED_KEY,
    parsed.BB_STRIPE_LIVE_API_KEY,
    parsed.BB_STRIPE_LIVE_WEBHOOK_SECRET,
    parsed.BB_STRIPE_LIVE_FOUNDING_PRODUCT_ID,
    parsed.BB_STRIPE_LIVE_FOUNDING_MONTHLY_PRICE_ID,
    parsed.BB_STRIPE_LIVE_FAMILY_ANNUAL_PRICE_ID,
    parsed.BB_STRIPE_LIVE_INDIVIDUAL_PRODUCT_ID,
    parsed.BB_STRIPE_LIVE_INDIVIDUAL_MONTHLY_PRICE_ID,
    parsed.BB_STRIPE_LIVE_INDIVIDUAL_ANNUAL_PRICE_ID,
    parsed.BB_STRIPE_LIVE_CANCEL_ONLY_PORTAL_CONFIGURATION_ID,
  ];
  const hasConfiguredField = (fields: readonly (string | undefined)[]) =>
    fields.some((value) => value !== undefined);
  if (parsed.BB_STRIPE_LIVE_API_KEY !== undefined) {
    throw new TypeError(
      'Live Stripe refuses the legacy shared API key; use a separate restricted key for each runtime surface',
    );
  }
  if (
    parsed.BB_STRIPE_MODE === 'disabled' &&
    (hasConfiguredField([...testFields, ...liveFields]) ||
      parsed.BB_STRIPE_LIVE_INITIATION_ENABLED ||
      parsed.BB_STRIPE_TEST_INDIVIDUAL_OFFERS_ENABLED ||
      parsed.BB_STRIPE_LIVE_INDIVIDUAL_OFFERS_ENABLED)
  ) {
    throw new TypeError('Stripe disabled mode refuses all Stripe configuration values');
  }
  if (parsed.BB_STRIPE_MODE === 'disabled') return { stripe: { mode: 'disabled' } };
  const test = parsed.BB_STRIPE_MODE === 'test';
  if (
    test &&
    (hasConfiguredField(liveFields) ||
      parsed.BB_STRIPE_LIVE_INITIATION_ENABLED ||
      parsed.BB_STRIPE_LIVE_INDIVIDUAL_OFFERS_ENABLED)
  ) {
    throw new TypeError('Stripe test mode refuses live Stripe configuration values');
  }
  if (
    !test &&
    (hasConfiguredField(testFields) || parsed.BB_STRIPE_TEST_INDIVIDUAL_OFFERS_ENABLED)
  ) {
    throw new TypeError('Stripe live mode refuses test Stripe configuration values');
  }
  if (test && parsed.NODE_ENV === 'production') {
    throw new TypeError('Production runtime refuses Stripe sandbox mode');
  }
  const required = {
    accountId: test ? parsed.BB_STRIPE_TEST_ACCOUNT_ID : parsed.BB_STRIPE_LIVE_ACCOUNT_ID,
    apiKey: test ? parsed.BB_STRIPE_TEST_API_KEY : undefined,
    webhookSecret: test
      ? parsed.BB_STRIPE_TEST_WEBHOOK_SECRET
      : parsed.BB_STRIPE_LIVE_WEBHOOK_SECRET,
    productId: test
      ? parsed.BB_STRIPE_TEST_FOUNDING_PRODUCT_ID
      : parsed.BB_STRIPE_LIVE_FOUNDING_PRODUCT_ID,
    priceId: test
      ? parsed.BB_STRIPE_TEST_FOUNDING_MONTHLY_PRICE_ID
      : parsed.BB_STRIPE_LIVE_FOUNDING_MONTHLY_PRICE_ID,
    familyAnnualPriceId: test
      ? parsed.BB_STRIPE_TEST_FAMILY_ANNUAL_PRICE_ID
      : parsed.BB_STRIPE_LIVE_FAMILY_ANNUAL_PRICE_ID,
    individualProductId: test
      ? parsed.BB_STRIPE_TEST_INDIVIDUAL_PRODUCT_ID
      : parsed.BB_STRIPE_LIVE_INDIVIDUAL_PRODUCT_ID,
    individualMonthlyPriceId: test
      ? parsed.BB_STRIPE_TEST_INDIVIDUAL_MONTHLY_PRICE_ID
      : parsed.BB_STRIPE_LIVE_INDIVIDUAL_MONTHLY_PRICE_ID,
    individualAnnualPriceId: test
      ? parsed.BB_STRIPE_TEST_INDIVIDUAL_ANNUAL_PRICE_ID
      : parsed.BB_STRIPE_LIVE_INDIVIDUAL_ANNUAL_PRICE_ID,
    cancelOnlyPortalConfigurationId: test
      ? parsed.BB_STRIPE_TEST_CANCEL_ONLY_PORTAL_CONFIGURATION_ID
      : parsed.BB_STRIPE_LIVE_CANCEL_ONLY_PORTAL_CONFIGURATION_ID,
  };
  if (
    required.accountId === undefined ||
    !/^acct_[A-Za-z0-9]{8,}$/u.test(required.accountId) ||
    (test &&
      (required.apiKey === undefined ||
        !/^rk_test_[A-Za-z0-9_]{8,}$/u.test(required.apiKey) ||
        required.webhookSecret === undefined ||
        !/^whsec_[A-Za-z0-9_]{8,}$/u.test(required.webhookSecret))) ||
    required.cancelOnlyPortalConfigurationId === undefined ||
    !/^bpc_[A-Za-z0-9_]{6,}$/u.test(required.cancelOnlyPortalConfigurationId) ||
    required.productId === undefined ||
    !/^prod_[A-Za-z0-9_]{6,}$/u.test(required.productId) ||
    required.priceId === undefined ||
    !/^price_[A-Za-z0-9_]{6,}$/u.test(required.priceId) ||
    required.familyAnnualPriceId === undefined ||
    !/^price_[A-Za-z0-9_]{6,}$/u.test(required.familyAnnualPriceId)
  ) {
    throw new TypeError(
      `Stripe ${parsed.BB_STRIPE_MODE} mode requires complete environment-specific credentials and the Family monthly and annual offer mapping`,
    );
  }
  const individualFields = [
    required.individualProductId,
    required.individualMonthlyPriceId,
    required.individualAnnualPriceId,
  ];
  const individualConfigured = individualFields.every((value) => value !== undefined);
  if (individualFields.some((value) => value !== undefined) && !individualConfigured) {
    throw new TypeError('Stripe Individual product mapping must be complete or absent');
  }
  const individualEnabled = test
    ? parsed.BB_STRIPE_TEST_INDIVIDUAL_OFFERS_ENABLED
    : parsed.BB_STRIPE_LIVE_INDIVIDUAL_OFFERS_ENABLED;
  if (individualEnabled && !individualConfigured) {
    throw new TypeError(
      'Stripe Individual checkout cannot be enabled without exact product mapping',
    );
  }
  const offer: StripeRuntimeOffer = {
    offerId: 'founding_family_monthly_v1' as const,
    planVersionId: 'family_v1' as const,
    plan: 'family' as const,
    displayName: 'Family' as const,
    billingInterval: 'month' as const,
    providerProductId: required.productId,
    providerPriceId: required.priceId,
    currency: 'usd' as const,
    unitAmountMinor: 1499 as const,
    quantity: 1 as const,
    trialPeriodDays: 0 as const,
    customerSelectable: false,
    defaultAcquisitionOffer: false,
  };
  const offers: StripeRuntimeOffer[] = [
    offer,
    {
      offerId: 'family_monthly_v2',
      planVersionId: 'family_v3',
      plan: 'family',
      displayName: 'Family',
      billingInterval: 'month',
      providerProductId: required.productId,
      providerPriceId: required.priceId,
      currency: 'usd',
      unitAmountMinor: 1499,
      quantity: 1,
      trialPeriodDays: 0,
      customerSelectable: true,
      defaultAcquisitionOffer: false,
    },
    {
      offerId: 'family_annual_v2',
      planVersionId: 'family_v3',
      plan: 'family',
      displayName: 'Family',
      billingInterval: 'year',
      providerProductId: required.productId,
      providerPriceId: required.familyAnnualPriceId,
      currency: 'usd',
      unitAmountMinor: 14_990,
      quantity: 1,
      trialPeriodDays: 7,
      customerSelectable: true,
      defaultAcquisitionOffer: true,
    },
  ];
  if (individualConfigured) {
    offers.push(
      {
        offerId: 'individual_monthly_v1',
        planVersionId: 'individual_v3',
        plan: 'individual',
        displayName: 'Individual',
        billingInterval: 'month',
        providerProductId: required.individualProductId as string,
        providerPriceId: required.individualMonthlyPriceId as string,
        currency: 'usd',
        unitAmountMinor: 899,
        quantity: 1,
        trialPeriodDays: 0,
        customerSelectable: individualEnabled,
        defaultAcquisitionOffer: false,
      },
      {
        offerId: 'individual_annual_v1',
        planVersionId: 'individual_v3',
        plan: 'individual',
        displayName: 'Individual',
        billingInterval: 'year',
        providerProductId: required.individualProductId as string,
        providerPriceId: required.individualAnnualPriceId as string,
        currency: 'usd',
        unitAmountMinor: 8_990,
        quantity: 1,
        trialPeriodDays: 7,
        customerSelectable: individualEnabled,
        defaultAcquisitionOffer: false,
      },
    );
  }
  const billingReadinessValues = [
    parsed.BB_BILLING_PUBLIC_SUPPORT_EMAIL,
    parsed.BB_BILLING_PUBLIC_SUPPORT_URL,
    parsed.BB_BILLING_PUBLIC_PRIVACY_URL,
    parsed.BB_BILLING_PUBLIC_TERMS_URL,
    parsed.BB_BILLING_PUBLIC_BILLING_TERMS_URL,
    parsed.BB_BILLING_POLICY_VERSION,
    parsed.BB_BILLING_POLICY_EFFECTIVE_AT,
    parsed.BB_BILLING_SUPPORT_RECEIPT_ID,
    parsed.BB_BILLING_TRIAL_REMINDER_DELIVERY_MODE,
    parsed.BB_BILLING_TRIAL_REMINDER_DELIVERY_RECEIPT_ID,
    parsed.BB_BILLING_TAX_REVIEWED_LAUNCH_GEOGRAPHY,
    parsed.BB_BILLING_TAX_TREATMENT_REVIEW_RECEIPT_ID,
  ] as const;
  const billingReadinessComplete =
    parsed.BB_BILLING_SUPPORT_OPERATIONS_READY &&
    parsed.BB_BILLING_TAX_TREATMENT_REVIEW_COMPLETE &&
    billingReadinessValues.every((value) => value !== undefined);
  const billingOperationalReadiness: StripeBillingOperationalReadiness = billingReadinessComplete
    ? {
        state: 'ready',
        supportEmail: parsed.BB_BILLING_PUBLIC_SUPPORT_EMAIL as string,
        supportUrl: parsed.BB_BILLING_PUBLIC_SUPPORT_URL as string,
        privacyUrl: parsed.BB_BILLING_PUBLIC_PRIVACY_URL as string,
        termsUrl: parsed.BB_BILLING_PUBLIC_TERMS_URL as string,
        billingTermsUrl: parsed.BB_BILLING_PUBLIC_BILLING_TERMS_URL as string,
        policyVersion: parsed.BB_BILLING_POLICY_VERSION as string,
        policyEffectiveAt: parsed.BB_BILLING_POLICY_EFFECTIVE_AT as string,
        supportOperationsReady: true,
        supportReceiptId: parsed.BB_BILLING_SUPPORT_RECEIPT_ID as string,
        trialReminderDeliveryMode: parsed.BB_BILLING_TRIAL_REMINDER_DELIVERY_MODE as
          'stripe_automatic_email' | 'consented_durable_channel',
        trialReminderDeliveryReceiptId:
          parsed.BB_BILLING_TRIAL_REMINDER_DELIVERY_RECEIPT_ID as string,
        taxTreatmentReviewComplete: true,
        taxReviewedLaunchGeography: parsed.BB_BILLING_TAX_REVIEWED_LAUNCH_GEOGRAPHY as string,
        taxTreatmentReviewReceiptId: parsed.BB_BILLING_TAX_TREATMENT_REVIEW_RECEIPT_ID as string,
      }
    : { state: 'incomplete' };
  if (!test && parsed.BB_STRIPE_LIVE_INITIATION_ENABLED && !billingReadinessComplete) {
    throw new TypeError(
      'Live Stripe initiation requires exact public support/legal policy configuration, support readiness, a trial-reminder delivery receipt, and a reviewed tax-treatment disposition receipt',
    );
  }
  if (!test) {
    const runtimeSurface = parsed.BB_STRIPE_RUNTIME_SURFACE;
    const apiRestrictedKey = parsed.BB_STRIPE_LIVE_API_RESTRICTED_KEY;
    const workerRestrictedKey = parsed.BB_STRIPE_LIVE_WORKER_RESTRICTED_KEY;
    const apiCustodyExact =
      runtimeSurface === 'api' &&
      apiRestrictedKey !== undefined &&
      /^rk_live_[A-Za-z0-9_]{8,}$/u.test(apiRestrictedKey) &&
      required.webhookSecret !== undefined &&
      /^whsec_[A-Za-z0-9_]{8,}$/u.test(required.webhookSecret) &&
      workerRestrictedKey === undefined;
    const workerCustodyExact =
      runtimeSurface === 'worker' &&
      workerRestrictedKey !== undefined &&
      /^rk_live_[A-Za-z0-9_]{8,}$/u.test(workerRestrictedKey) &&
      apiRestrictedKey === undefined &&
      required.webhookSecret === undefined &&
      !parsed.BB_STRIPE_LIVE_INITIATION_ENABLED;
    if (!apiCustodyExact && !workerCustodyExact) {
      throw new TypeError(
        'Stripe live mode requires one exact runtime surface with its own restricted key custody',
      );
    }
    if (runtimeSurface === 'api') {
      return {
        stripe: {
          mode: 'live',
          environment: 'production',
          runtimeSurface,
          accountId: required.accountId,
          apiRestrictedKey: apiRestrictedKey as string,
          webhookSecret: required.webhookSecret as string,
          apiVersion: stripeApiVersion,
          runtimeInitiationPermitted: parsed.BB_STRIPE_LIVE_INITIATION_ENABLED,
          runtimeNetworkPermitted: true,
          credentialCustody: 'separate_replit_runtime_restricted_keys',
          cancelOnlyPortalConfigurationId: required.cancelOnlyPortalConfigurationId,
          defaultOfferId: 'family_annual_v2',
          offer,
          offers: Object.freeze(offers),
          billingOperationalReadiness,
        },
      };
    }
    return {
      stripe: {
        mode: 'live',
        environment: 'production',
        runtimeSurface: 'worker',
        accountId: required.accountId,
        workerRestrictedKey: workerRestrictedKey as string,
        apiVersion: stripeApiVersion,
        runtimeInitiationPermitted: false,
        runtimeNetworkPermitted: true,
        credentialCustody: 'separate_replit_runtime_restricted_keys',
        cancelOnlyPortalConfigurationId: required.cancelOnlyPortalConfigurationId,
        defaultOfferId: 'family_annual_v2',
        offer,
        offers: Object.freeze(offers),
        billingOperationalReadiness,
      },
    };
  }
  return {
    stripe: {
      mode: 'test',
      environment: 'test',
      accountId: required.accountId,
      apiKey: required.apiKey as string,
      webhookSecret: required.webhookSecret as string,
      apiVersion: stripeApiVersion,
      runtimeInitiationPermitted: true,
      runtimeNetworkPermitted: true,
      cancelOnlyPortalConfigurationId: required.cancelOnlyPortalConfigurationId,
      defaultOfferId: 'family_annual_v2',
      offer,
      offers: Object.freeze(offers),
      billingOperationalReadiness,
    },
  };
}

function twilioConfiguration(
  parsed: z.infer<typeof environmentSchema>,
): NonNullable<AppConfig['messaging']> {
  const reservedValues = [
    parsed.BB_TWILIO_ACCOUNT_SID,
    parsed.BB_TWILIO_AUTH_TOKEN,
    parsed.BB_TWILIO_MESSAGING_SERVICE_SID,
    parsed.BB_TWILIO_TOLL_FREE_NUMBER_SID,
    parsed.BB_TWILIO_INBOUND_WEBHOOK_BASE_URL,
    parsed.BB_TWILIO_STATUS_CALLBACK_BASE_URL,
  ];
  if (reservedValues.some((value) => value !== undefined)) {
    throw new TypeError(
      'Twilio configuration and credentials are refused until the reviewed provider adapter exists',
    );
  }
  return {
    twilio: {
      mode: parsed.BB_TWILIO_MODE,
      runtimeNetworkPermitted: false,
      credentialLoadingPermitted: false,
    },
  };
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);
  if (parsed.NODE_ENV !== 'production' && parsed.BB_SESSION_SECRET === undefined) {
    throw new TypeError('BB_SESSION_SECRET is required outside production');
  }
  refuseUnsafeProduction(parsed);
  if (
    parsed.BB_SUPPORT_RECEIPTS_INTAKE_ENABLED &&
    (!parsed.BB_SUPPORT_RECEIPTS_CUSTOMER_ACCESS_ENABLED ||
      !parsed.BB_SUPPORT_RECEIPTS_HQ_QUEUE_ENABLED)
  ) {
    throw new TypeError(
      'Support receipt intake requires customer history and the HQ queue to be enabled',
    );
  }
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
  const clerkMobileAuthorizedParties =
    parsed.NODE_ENV === 'production'
      ? mobileAuthorizedParties(parsed.BB_CLERK_MOBILE_AUTHORIZED_PARTIES)
      : [];
  if (
    clerkMobileAuthorizedParties.some(
      (party) => customerOrigins.includes(party) || hqOrigins.includes(party),
    )
  ) {
    throw new TypeError(
      'Mobile Clerk authorized parties must be disjoint from customer and HQ browser origins',
    );
  }

  const database: AppConfig['database'] =
    parsed.BB_DATABASE_DRIVER === 'postgres'
      ? {
          driver: 'postgres',
          url: postgresConnectionString(
            parsed.DATABASE_URL ??
              (() => {
                throw new TypeError('DATABASE_URL is required for the PostgreSQL driver');
              })(),
            parsed.NODE_ENV === 'production',
          ),
          poolMax: parsed.BB_POSTGRES_POOL_MAX ?? 10,
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
  const session = Buffer.from(parsed.BB_SESSION_SECRET ?? '', 'utf8');
  const safeWordPepper = Buffer.from(parsed.BB_SAFE_WORD_PEPPER, 'utf8');
  refusePublishedProductionSecretDefaults(parsed.NODE_ENV, {
    artifactEncryptionKey,
    fingerprintKey,
    safeWordPepper,
  });
  const separateSecrets = [
    artifactEncryptionKey,
    fingerprintKey,
    ...(session.byteLength === 0 ? [] : [session]),
    safeWordPepper,
  ];
  for (let left = 0; left < separateSecrets.length; left += 1) {
    for (let right = left + 1; right < separateSecrets.length; right += 1) {
      if (separateSecrets[left]?.equals(separateSecrets[right] ?? Buffer.alloc(0)) === true) {
        throw new TypeError('Encryption keys, signing secrets, and peppers must be separate');
      }
    }
  }

  const clerk =
    parsed.NODE_ENV === 'production'
      ? {
          customer: {
            issuer: clerkIssuer(parsed.BB_CLERK_CUSTOMER_ISSUER, 'BB_CLERK_CUSTOMER_ISSUER'),
            audience: parsed.BB_CLERK_CUSTOMER_AUDIENCE as string,
            jwtKey: clerkJwtKey(parsed.BB_CLERK_CUSTOMER_JWT_KEY, 'BB_CLERK_CUSTOMER_JWT_KEY'),
            authorizedParties: customerOrigins,
            mobileAuthorizedParties: clerkMobileAuthorizedParties,
          },
          hq: {
            issuer: clerkIssuer(parsed.BB_CLERK_HQ_ISSUER, 'BB_CLERK_HQ_ISSUER'),
            audience: parsed.BB_CLERK_HQ_AUDIENCE as string,
            jwtKey: clerkJwtKey(parsed.BB_CLERK_HQ_JWT_KEY, 'BB_CLERK_HQ_JWT_KEY'),
            authorizedParties: hqOrigins,
            maxSecondFactorAgeSeconds: parsed.BB_CLERK_HQ_MAX_SECOND_FACTOR_AGE_SECONDS,
          },
          founderSubject: parsed.BB_FOUNDER_CLERK_SUBJECT as string,
        }
      : undefined;

  return {
    environment: parsed.NODE_ENV,
    api: {
      host: parsed.BB_API_HOST,
      port: parsed.BB_API_PORT,
      trustedProxyHops: parsed.BB_TRUSTED_PROXY_HOPS as 0 | 1 | 2,
    },
    accessIntents: {
      runtimeEnabled:
        parsed.BB_PRIVATE_BETA_ACCESS_INTENTS_ENABLED &&
        parsed.BB_PRIVATE_BETA_ACCESS_INTENTS_EDGE_GUARD_CONFIRMED,
      edgeRateLimitConfirmed: parsed.BB_PRIVATE_BETA_ACCESS_INTENTS_EDGE_GUARD_CONFIRMED,
    },
    supportReceipts: {
      customerAccessEnabled: parsed.BB_SUPPORT_RECEIPTS_CUSTOMER_ACCESS_ENABLED,
      intakeEnabled: parsed.BB_SUPPORT_RECEIPTS_INTAKE_ENABLED,
      hqQueueEnabled: parsed.BB_SUPPORT_RECEIPTS_HQ_QUEUE_ENABLED,
    },
    content: {
      firstPartyPublishingEnabled: parsed.BB_FIRST_PARTY_CONTENT_ENABLED,
      dailyDraftGenerationEnabled: parsed.BB_DAILY_CONTENT_DRAFTS_ENABLED,
    },
    database,
    identity: {
      allowDevelopmentIssuer: parsed.BB_ALLOW_DEV_IDENTITY,
      customerOrigins,
      ...(parsed.BB_FOUNDER_PERSON_ID === undefined
        ? {}
        : { founderPersonId: parsed.BB_FOUNDER_PERSON_ID }),
      hqOrigins,
      ...(clerk === undefined ? {} : { clerk }),
    },
    secrets: {
      session,
      artifactEncryptionKey,
      fingerprintKey,
      safeWordPepper,
      custodyClassification:
        parsed.NODE_ENV === 'production' ? 'replit_runtime_secret_beta' : 'local_development',
    },
    commerce: stripeConfiguration(parsed),
    messaging: twilioConfiguration(parsed),
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
