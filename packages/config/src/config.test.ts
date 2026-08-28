import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertStripeOnlineRuntimePermitted, loadConfig } from './index';

const publishedDevelopmentSecretDefaults = {
  artifactEncryptionKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  fingerprintKey: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
  safeWordPepper: 'local-safe-word-pepper-not-for-production',
} as const;

function developmentEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    BB_API_HOST: '127.0.0.1',
    BB_API_PORT: '4000',
    BB_TRUSTED_PROXY_HOPS: '0',
    BB_DATABASE_DRIVER: 'pglite',
    BB_PGLITE_PATH: 'memory://',
    BB_RUN_MIGRATIONS: 'true',
    BB_SEED_DEMO: 'true',
    BB_ALLOW_DEV_IDENTITY: 'true',
    BB_CUSTOMER_ORIGINS: 'http://127.0.0.1:3000,http://127.0.0.1:3000',
    BB_HQ_ORIGINS: 'http://127.0.0.1:3001',
    BB_SESSION_SECRET: 'a-session-secret-that-is-long-enough-for-tests',
    BB_ARTIFACT_KEY_BASE64: Buffer.alloc(32, 1).toString('base64'),
    BB_FINGERPRINT_KEY_BASE64: Buffer.alloc(32, 2).toString('base64'),
    BB_SAFE_WORD_PEPPER: 'a-separate-test-pepper-value',
    BB_LOG_LEVEL: 'debug',
  };
}

function productionEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...developmentEnvironment(),
    NODE_ENV: 'production',
    BB_TRUSTED_PROXY_HOPS: '0',
    BB_DATABASE_DRIVER: 'postgres',
    DATABASE_URL: 'postgresql://test.invalid/database?sslmode=require',
    BB_POSTGRES_POOL_MAX: '2',
    BB_RUN_MIGRATIONS: 'false',
    BB_SEED_DEMO: 'false',
    BB_ALLOW_DEV_IDENTITY: 'false',
    BB_FOUNDER_PERSON_ID: 'person-founder-production',
    BB_FOUNDER_CLERK_SUBJECT: 'user_founder_production',
    BB_CUSTOMER_ORIGINS: 'https://customer.test',
    BB_HQ_ORIGINS: 'https://hq.test',
    BB_CLERK_CUSTOMER_ISSUER: 'https://customer.clerk.test',
    BB_CLERK_CUSTOMER_AUDIENCE: 'boomerbuddy-customer',
    BB_CLERK_CUSTOMER_JWT_KEY:
      '-----BEGIN PUBLIC KEY-----\ncustomer-fixture-key-material\n-----END PUBLIC KEY-----',
    BB_CLERK_MOBILE_AUTHORIZED_PARTIES: 'none',
    BB_CLERK_HQ_ISSUER: 'https://hq.clerk.test',
    BB_CLERK_HQ_AUDIENCE: 'boomerbuddy-hq',
    BB_CLERK_HQ_JWT_KEY:
      '-----BEGIN PUBLIC KEY-----\nhq-fixture-key-material\n-----END PUBLIC KEY-----',
    BB_CLERK_HQ_MAX_SECOND_FACTOR_AGE_SECONDS: '600',
  };
  delete environment.BB_SESSION_SECRET;
  return environment;
}

describe('typed configuration', () => {
  it('parses local configuration and canonicalizes origin lists', () => {
    const config = loadConfig(developmentEnvironment());
    expect(config.database).toEqual({
      driver: 'pglite',
      path: 'memory://',
      runMigrations: true,
      seedDemo: true,
    });
    expect(config.identity.customerOrigins).toEqual(['http://127.0.0.1:3000']);
    expect(config.api.trustedProxyHops).toBe(0);
    expect(config.accessIntents).toEqual({
      runtimeEnabled: false,
      edgeRateLimitConfirmed: false,
    });
    expect(config.supportReceipts).toEqual({
      customerAccessEnabled: false,
      intakeEnabled: false,
      hqQueueEnabled: false,
    });
    expect(config.content).toEqual({
      firstPartyPublishingEnabled: false,
      dailyDraftGenerationEnabled: false,
    });
    expect(config.secrets.artifactEncryptionKey.equals(config.secrets.fingerprintKey)).toBe(false);
    expect(config.commerce).toEqual({ stripe: { mode: 'disabled' } });
    expect(config.messaging).toEqual({
      twilio: {
        mode: 'disabled',
        runtimeNetworkPermitted: false,
        credentialLoadingPermitted: false,
      },
    });
  });

  it('keeps demo bootstrap opt-in when the switch is omitted', () => {
    const environment = developmentEnvironment();
    delete environment.BB_SEED_DEMO;
    expect(loadConfig(environment).database.seedDemo).toBe(false);
  });

  it('keeps the published development secret defaults usable outside production', () => {
    const config = loadConfig({
      ...developmentEnvironment(),
      BB_ARTIFACT_KEY_BASE64: publishedDevelopmentSecretDefaults.artifactEncryptionKey,
      BB_FINGERPRINT_KEY_BASE64: publishedDevelopmentSecretDefaults.fingerprintKey,
      BB_SAFE_WORD_PEPPER: publishedDevelopmentSecretDefaults.safeWordPepper,
    });

    expect(config.secrets.artifactEncryptionKey).toEqual(Buffer.alloc(32));
    expect(config.secrets.fingerprintKey).toEqual(Buffer.alloc(32, 1));
    expect(config.secrets.safeWordPepper.toString('utf8')).toBe(
      publishedDevelopmentSecretDefaults.safeWordPepper,
    );
  });

  it('keeps access-intent mutation off unless runtime and independent edge evidence are explicit', () => {
    expect(
      loadConfig({
        ...developmentEnvironment(),
        BB_PRIVATE_BETA_ACCESS_INTENTS_ENABLED: 'true',
      }).accessIntents,
    ).toEqual({ runtimeEnabled: false, edgeRateLimitConfirmed: false });
    expect(
      loadConfig({
        ...developmentEnvironment(),
        BB_PRIVATE_BETA_ACCESS_INTENTS_EDGE_GUARD_CONFIRMED: 'true',
      }).accessIntents,
    ).toEqual({ runtimeEnabled: false, edgeRateLimitConfirmed: true });
    expect(
      loadConfig({
        ...developmentEnvironment(),
        BB_PRIVATE_BETA_ACCESS_INTENTS_ENABLED: 'true',
        BB_PRIVATE_BETA_ACCESS_INTENTS_EDGE_GUARD_CONFIRMED: 'true',
      }).accessIntents,
    ).toEqual({ runtimeEnabled: true, edgeRateLimitConfirmed: true });
  });

  it('keeps support receipts off by default and refuses unattended intake', () => {
    expect(
      loadConfig({
        ...developmentEnvironment(),
        BB_SUPPORT_RECEIPTS_CUSTOMER_ACCESS_ENABLED: 'true',
      }).supportReceipts,
    ).toEqual({ customerAccessEnabled: true, intakeEnabled: false, hqQueueEnabled: false });
    expect(() =>
      loadConfig({
        ...developmentEnvironment(),
        BB_SUPPORT_RECEIPTS_INTAKE_ENABLED: 'true',
      }),
    ).toThrow('requires customer history and the HQ queue');
    expect(
      loadConfig({
        ...developmentEnvironment(),
        BB_SUPPORT_RECEIPTS_CUSTOMER_ACCESS_ENABLED: 'true',
        BB_SUPPORT_RECEIPTS_INTAKE_ENABLED: 'true',
        BB_SUPPORT_RECEIPTS_HQ_QUEUE_ENABLED: 'true',
      }).supportReceipts,
    ).toEqual({ customerAccessEnabled: true, intakeEnabled: true, hqQueueEnabled: true });
  });

  it('keeps governed publication and daily draft generation separately default-off', () => {
    expect(
      loadConfig({
        ...developmentEnvironment(),
        BB_FIRST_PARTY_CONTENT_ENABLED: 'true',
      }).content,
    ).toEqual({ firstPartyPublishingEnabled: true, dailyDraftGenerationEnabled: false });
    expect(
      loadConfig({
        ...developmentEnvironment(),
        BB_DAILY_CONTENT_DRAFTS_ENABLED: 'true',
      }).content,
    ).toEqual({ firstPartyPublishingEnabled: false, dailyDraftGenerationEnabled: true });
  });

  it('requires an explicit bounded trusted-proxy hop count', () => {
    expect(loadConfig({ ...developmentEnvironment(), BB_TRUSTED_PROXY_HOPS: '1' }).api).toEqual(
      expect.objectContaining({ trustedProxyHops: 1 }),
    );
    expect(() => loadConfig({ ...developmentEnvironment(), BB_TRUSTED_PROXY_HOPS: '3' })).toThrow();
  });

  it('requires a database URL for PostgreSQL', () => {
    expect(() =>
      loadConfig({ ...developmentEnvironment(), BB_DATABASE_DRIVER: 'postgres' }),
    ).toThrow('DATABASE_URL');
  });

  it('keeps the existing PostgreSQL pool default outside production and accepts a bounded override', () => {
    const postgresEnvironment = {
      ...developmentEnvironment(),
      BB_DATABASE_DRIVER: 'postgres',
      DATABASE_URL: 'postgresql://test.invalid/database',
    };
    expect(loadConfig(postgresEnvironment).database).toMatchObject({
      driver: 'postgres',
      poolMax: 10,
    });
    expect(
      loadConfig({ ...postgresEnvironment, BB_POSTGRES_POOL_MAX: '3' }).database,
    ).toMatchObject({ driver: 'postgres', poolMax: 3 });
  });

  it.each(['0', '1.5', '11', 'not-a-number'])(
    'refuses invalid PostgreSQL pool max %s',
    (poolMax) => {
      expect(() =>
        loadConfig({ ...developmentEnvironment(), BB_POSTGRES_POOL_MAX: poolMax }),
      ).toThrow();
    },
  );

  it('requires an explicit PostgreSQL pool max in production', () => {
    const environment = productionEnvironment();
    delete environment.BB_POSTGRES_POOL_MAX;
    expect(() => loadConfig(environment)).toThrow('explicit BB_POSTGRES_POOL_MAX');
  });

  it.each([
    'https://test.invalid/database?sslmode=require',
    'postgresql://test.invalid/database',
    'postgresql://test.invalid/database?sslmode=disable',
    'postgresql://test.invalid/database?sslmode=allow',
    'postgresql://test.invalid/database?sslmode=prefer',
  ])('refuses an unsafe production PostgreSQL URL %s', (databaseUrl) => {
    expect(() => loadConfig({ ...productionEnvironment(), DATABASE_URL: databaseUrl })).toThrow();
  });

  it('accepts production PostgreSQL certificate verification modes', () => {
    expect(
      loadConfig({
        ...productionEnvironment(),
        DATABASE_URL: 'postgresql://test.invalid/database?sslmode=verify-full',
      }).database,
    ).toMatchObject({ driver: 'postgres' });
  });

  it.each([
    ['BB_ARTIFACT_KEY_BASE64', publishedDevelopmentSecretDefaults.artifactEncryptionKey],
    ['BB_FINGERPRINT_KEY_BASE64', publishedDevelopmentSecretDefaults.fingerprintKey],
    ['BB_SAFE_WORD_PEPPER', publishedDevelopmentSecretDefaults.safeWordPepper],
  ] as const)('refuses the exact published production default for %s', (name, value) => {
    expect(() => loadConfig({ ...productionEnvironment(), [name]: value })).toThrow(
      `published .env.example default for ${name}`,
    );
  });

  it.each([
    ['BB_ARTIFACT_KEY_BASE64', publishedDevelopmentSecretDefaults.artifactEncryptionKey],
    ['BB_FINGERPRINT_KEY_BASE64', publishedDevelopmentSecretDefaults.fingerprintKey],
  ] as const)('rejects the published key material for %s after decoding', (name, value) => {
    expect(() =>
      loadConfig({ ...productionEnvironment(), [name]: value.replace(/=+$/u, '') }),
    ).toThrow(`published .env.example default for ${name}`);
  });

  it('accepts exact-value near misses for otherwise valid production material', () => {
    const artifactEncryptionKey = Buffer.from(
      publishedDevelopmentSecretDefaults.artifactEncryptionKey,
      'base64',
    );
    const fingerprintKey = Buffer.from(publishedDevelopmentSecretDefaults.fingerprintKey, 'base64');
    artifactEncryptionKey[artifactEncryptionKey.byteLength - 1] = 1;
    fingerprintKey[fingerprintKey.byteLength - 1] = 2;

    const config = loadConfig({
      ...productionEnvironment(),
      BB_ARTIFACT_KEY_BASE64: artifactEncryptionKey.toString('base64'),
      BB_FINGERPRINT_KEY_BASE64: fingerprintKey.toString('base64'),
      BB_SAFE_WORD_PEPPER: `${publishedDevelopmentSecretDefaults.safeWordPepper}-rotated`,
    });

    expect(config.secrets.artifactEncryptionKey.equals(artifactEncryptionKey)).toBe(true);
    expect(config.secrets.fingerprintKey.equals(fingerprintKey)).toBe(true);
    expect(config.secrets.safeWordPepper.toString('utf8')).toBe(
      `${publishedDevelopmentSecretDefaults.safeWordPepper}-rotated`,
    );
  });

  it('accepts freshly generated valid production secret material', () => {
    const artifactEncryptionKey = randomBytes(32);
    const fingerprintKey = randomBytes(32);
    artifactEncryptionKey[0] = 2;
    fingerprintKey[0] = 3;
    const safeWordPepper = `production-${randomBytes(24).toString('base64url')}`;

    const config = loadConfig({
      ...productionEnvironment(),
      BB_ARTIFACT_KEY_BASE64: artifactEncryptionKey.toString('base64'),
      BB_FINGERPRINT_KEY_BASE64: fingerprintKey.toString('base64'),
      BB_SAFE_WORD_PEPPER: safeWordPepper,
    });

    expect(config.secrets.artifactEncryptionKey.equals(artifactEncryptionKey)).toBe(true);
    expect(config.secrets.fingerprintKey.equals(fingerprintKey)).toBe(true);
    expect(config.secrets.safeWordPepper.equals(Buffer.from(safeWordPepper, 'utf8'))).toBe(true);
  });

  it('continues to refuse development session signing material in production', () => {
    expect(() =>
      loadConfig({
        ...productionEnvironment(),
        BB_SESSION_SECRET: 'unused-production-session-secret-value',
      }),
    ).toThrow('unused development session signing material');
  });

  it.each([
    ['BB_ALLOW_DEV_IDENTITY', 'true'],
    ['BB_DATABASE_DRIVER', 'pglite'],
    ['BB_SEED_DEMO', 'true'],
    ['BB_RUN_MIGRATIONS', 'true'],
    ['BB_TRUSTED_PROXY_HOPS', '1'],
    ['BB_STRIPE_MODE', 'test'],
  ])('refuses unsafe production setting %s', (key, value) => {
    expect(() => loadConfig({ ...productionEnvironment(), [key]: value })).toThrow();
  });

  it('accepts only complete disjoint production Clerk realms and explicit beta custody', () => {
    const config = loadConfig(productionEnvironment());
    expect(config.identity.clerk).toMatchObject({
      customer: {
        issuer: 'https://customer.clerk.test',
        audience: 'boomerbuddy-customer',
        authorizedParties: ['https://customer.test'],
        mobileAuthorizedParties: [],
      },
      hq: {
        issuer: 'https://hq.clerk.test',
        audience: 'boomerbuddy-hq',
        authorizedParties: ['https://hq.test'],
        maxSecondFactorAgeSeconds: 600,
      },
      founderSubject: 'user_founder_production',
    });
    expect(config.secrets.custodyClassification).toBe('replit_runtime_secret_beta');
    expect(config.secrets.session.byteLength).toBe(0);
    expect(config.database).toMatchObject({
      driver: 'postgres',
      poolMax: 2,
      runMigrations: false,
      seedDemo: false,
    });

    for (const field of [
      'BB_FOUNDER_PERSON_ID',
      'BB_FOUNDER_CLERK_SUBJECT',
      'BB_CLERK_CUSTOMER_ISSUER',
      'BB_CLERK_CUSTOMER_AUDIENCE',
      'BB_CLERK_CUSTOMER_JWT_KEY',
      'BB_CLERK_MOBILE_AUTHORIZED_PARTIES',
      'BB_CLERK_HQ_ISSUER',
      'BB_CLERK_HQ_AUDIENCE',
      'BB_CLERK_HQ_JWT_KEY',
    ] as const) {
      const environment = productionEnvironment();
      delete environment[field];
      expect(() => loadConfig(environment)).toThrow('complete customer, HQ, and founder Clerk');
    }
    expect(() =>
      loadConfig({
        ...productionEnvironment(),
        BB_CLERK_HQ_ISSUER: 'https://customer.clerk.test',
      }),
    ).toThrow('issuers must be distinct');
    expect(() =>
      loadConfig({
        ...productionEnvironment(),
        BB_CLERK_HQ_AUDIENCE: 'boomerbuddy-customer',
      }),
    ).toThrow('audiences must be distinct');
    expect(() =>
      loadConfig({
        ...productionEnvironment(),
        BB_CLERK_HQ_JWT_KEY: productionEnvironment().BB_CLERK_CUSTOMER_JWT_KEY,
      }),
    ).toThrow('verification keys must be distinct');
    expect(() =>
      loadConfig({
        ...productionEnvironment(),
        BB_CLERK_HQ_ISSUER: 'http://hq.clerk.test',
      }),
    ).toThrow('HTTPS issuer origin');
    expect(() =>
      loadConfig({
        ...productionEnvironment(),
        BB_CLERK_HQ_JWT_KEY: 'not-a-pem-key',
      }),
    ).toThrow('bounded PEM public key');
    expect(
      loadConfig({
        ...productionEnvironment(),
        BB_CLERK_MOBILE_AUTHORIZED_PARTIES: 'https://native-auth.test',
      }).identity.clerk?.customer.mobileAuthorizedParties,
    ).toEqual(['https://native-auth.test']);
    expect(() =>
      loadConfig({
        ...productionEnvironment(),
        BB_CLERK_MOBILE_AUTHORIZED_PARTIES: 'https://customer.test',
      }),
    ).toThrow('disjoint from customer and HQ browser origins');
    expect(() =>
      loadConfig({
        ...productionEnvironment(),
        BB_CLERK_MOBILE_AUTHORIZED_PARTIES: 'http://native-auth.test',
      }),
    ).toThrow('exact HTTPS origins');
  });

  it('refuses shared encryption/fingerprint keys and malformed origins', () => {
    const environment = developmentEnvironment();
    expect(() =>
      loadConfig({
        ...environment,
        BB_FINGERPRINT_KEY_BASE64: environment.BB_ARTIFACT_KEY_BASE64,
      }),
    ).toThrow('must be separate');
    expect(() =>
      loadConfig({ ...environment, BB_CUSTOMER_ORIGINS: 'http://localhost:3000/path' }),
    ).toThrow('origins without paths');
    expect(() =>
      loadConfig({ ...environment, BB_CUSTOMER_ORIGINS: 'ftp://localhost:3000' }),
    ).toThrow('origins without paths');
    expect(() =>
      loadConfig({
        ...environment,
        BB_SAFE_WORD_PEPPER: environment.BB_SESSION_SECRET,
      }),
    ).toThrow('must be separate');
  });

  it('refuses any customer and HQ origin overlap', () => {
    expect(() =>
      loadConfig({
        ...developmentEnvironment(),
        BB_HQ_ORIGINS: 'http://127.0.0.1:3000',
      }),
    ).toThrow('must be disjoint');
  });

  it('requires a complete environment-specific Stripe configuration when enabled', () => {
    expect(() => loadConfig({ ...developmentEnvironment(), BB_STRIPE_MODE: 'test' })).toThrow(
      'complete environment-specific credentials',
    );
    const config = loadConfig({
      ...developmentEnvironment(),
      BB_STRIPE_MODE: 'test',
      BB_STRIPE_TEST_ACCOUNT_ID: 'acct_fixture1234',
      BB_STRIPE_TEST_API_KEY: 'rk_test_fixture_12345678',
      BB_STRIPE_TEST_WEBHOOK_SECRET: 'whsec_fixture_12345678',
      BB_STRIPE_TEST_CANCEL_ONLY_PORTAL_CONFIGURATION_ID: 'bpc_cancel_only_fixture',
      BB_STRIPE_TEST_FOUNDING_PRODUCT_ID: 'prod_family_fixture',
      BB_STRIPE_TEST_FOUNDING_MONTHLY_PRICE_ID: 'price_family_month_fixture',
      BB_STRIPE_TEST_FAMILY_ANNUAL_PRICE_ID: 'price_family_annual_fixture',
    });
    expect(config.commerce.stripe).toMatchObject({
      mode: 'test',
      environment: 'test',
      apiVersion: '2026-07-29.dahlia',
      runtimeInitiationPermitted: true,
      offer: {
        offerId: 'founding_family_monthly_v1',
        currency: 'usd',
        unitAmountMinor: 1499,
        quantity: 1,
      },
    });
    expect(() =>
      loadConfig({
        ...developmentEnvironment(),
        BB_STRIPE_MODE: 'test',
        BB_STRIPE_TEST_ACCOUNT_ID: 'acct_fixture1234',
        BB_STRIPE_TEST_API_KEY: 'sk_test_fixture_12345678',
        BB_STRIPE_TEST_WEBHOOK_SECRET: 'whsec_fixture_12345678',
        BB_STRIPE_TEST_CANCEL_ONLY_PORTAL_CONFIGURATION_ID: 'bpc_cancel_only_fixture',
        BB_STRIPE_TEST_FOUNDING_PRODUCT_ID: 'prod_family_fixture',
        BB_STRIPE_TEST_FOUNDING_MONTHLY_PRICE_ID: 'price_family_month_fixture',
        BB_STRIPE_TEST_FAMILY_ANNUAL_PRICE_ID: 'price_family_annual_fixture',
      }),
    ).toThrow('complete environment-specific credentials');
    expect(() =>
      loadConfig({
        ...developmentEnvironment(),
        BB_STRIPE_MODE: 'test',
        BB_STRIPE_LIVE_ACCOUNT_ID: 'acct_livefixture1',
      }),
    ).toThrow('test mode refuses live Stripe configuration values');
  });

  it('refuses legacy shared live keys and inactive Stripe environment families', () => {
    expect(() =>
      loadConfig({
        ...developmentEnvironment(),
        BB_STRIPE_LIVE_API_KEY: 'sk_live_fixture_12345678',
      }),
    ).toThrow('legacy shared API key');
    expect(() =>
      loadConfig({
        ...developmentEnvironment(),
        BB_STRIPE_TEST_ACCOUNT_ID: 'acct_fixture1234',
      }),
    ).toThrow('disabled mode refuses all Stripe configuration values');
  });

  it('refuses every Twilio mode, credential, and callback value', () => {
    expect(() => loadConfig({ ...developmentEnvironment(), BB_TWILIO_MODE: 'test' })).toThrow();
    for (const [name, value] of [
      ['BB_TWILIO_ACCOUNT_SID', 'AC_fixture'],
      ['BB_TWILIO_AUTH_TOKEN', 'synthetic-token'],
      ['BB_TWILIO_MESSAGING_SERVICE_SID', 'MG_fixture'],
      ['BB_TWILIO_TOLL_FREE_NUMBER_SID', 'PN_fixture'],
      ['BB_TWILIO_INBOUND_WEBHOOK_BASE_URL', 'https://example.invalid/twilio'],
      ['BB_TWILIO_STATUS_CALLBACK_BASE_URL', 'https://example.invalid/status'],
    ] as const) {
      expect(() => loadConfig({ ...developmentEnvironment(), [name]: value })).toThrow(
        'Twilio configuration and credentials are refused',
      );
    }
  });

  it('accepts separate least-privilege live API and worker custody while defaulting initiation off', () => {
    const commonLive = {
      ...productionEnvironment(),
      BB_STRIPE_MODE: 'live',
      BB_STRIPE_LIVE_ACCOUNT_ID: 'acct_livefixture1',
      BB_STRIPE_LIVE_CANCEL_ONLY_PORTAL_CONFIGURATION_ID: 'bpc_live_cancel_fixture',
      BB_STRIPE_LIVE_FOUNDING_PRODUCT_ID: 'prod_live_family_fixture',
      BB_STRIPE_LIVE_FOUNDING_MONTHLY_PRICE_ID: 'price_live_family_fixture',
      BB_STRIPE_LIVE_FAMILY_ANNUAL_PRICE_ID: 'price_live_family_annual_fixture',
    };
    expect(() =>
      loadConfig({
        ...commonLive,
        BB_STRIPE_RUNTIME_SURFACE: 'api',
        BB_STRIPE_LIVE_API_RESTRICTED_KEY: 'sk_live_fixture_12345678',
        BB_STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_live_fixture_12345678',
      }),
    ).toThrow('restricted key custody');
    expect(() =>
      loadConfig({
        ...commonLive,
        BB_STRIPE_RUNTIME_SURFACE: 'api',
        BB_STRIPE_LIVE_API_RESTRICTED_KEY: 'rk_live_api_fixture_12345678',
        BB_STRIPE_LIVE_WORKER_RESTRICTED_KEY: 'rk_live_worker_fixture_12345678',
        BB_STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_live_fixture_12345678',
      }),
    ).toThrow('restricted key custody');
    const apiConfig = loadConfig({
      ...commonLive,
      BB_STRIPE_RUNTIME_SURFACE: 'api',
      BB_STRIPE_LIVE_API_RESTRICTED_KEY: 'rk_live_api_fixture_12345678',
      BB_STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_live_fixture_12345678',
    });
    expect(apiConfig.commerce.stripe).toMatchObject({
      mode: 'live',
      environment: 'production',
      runtimeSurface: 'api',
      runtimeInitiationPermitted: false,
      runtimeNetworkPermitted: true,
      credentialCustody: 'separate_replit_runtime_restricted_keys',
    });
    expect(() => assertStripeOnlineRuntimePermitted(apiConfig, 'api')).not.toThrow();
    expect(() => assertStripeOnlineRuntimePermitted(apiConfig, 'worker')).toThrow(
      'worker startup refuses api credential custody',
    );
    const workerConfig = loadConfig({
      ...commonLive,
      BB_STRIPE_RUNTIME_SURFACE: 'worker',
      BB_STRIPE_LIVE_WORKER_RESTRICTED_KEY: 'rk_live_worker_fixture_12345678',
    });
    expect(workerConfig.commerce.stripe).toMatchObject({
      mode: 'live',
      runtimeSurface: 'worker',
      runtimeInitiationPermitted: false,
      runtimeNetworkPermitted: true,
    });
    expect(() => assertStripeOnlineRuntimePermitted(workerConfig, 'worker')).not.toThrow();
    const liveInitiationReadiness = {
      BB_BILLING_PUBLIC_SUPPORT_EMAIL: 'support@example.invalid',
      BB_BILLING_PUBLIC_SUPPORT_URL: 'https://app.example.invalid/support',
      BB_BILLING_PUBLIC_PRIVACY_URL: 'https://app.example.invalid/privacy',
      BB_BILLING_PUBLIC_TERMS_URL: 'https://app.example.invalid/terms',
      BB_BILLING_PUBLIC_BILLING_TERMS_URL: 'https://app.example.invalid/billing-terms',
      BB_BILLING_POLICY_VERSION: 'billing-v1',
      BB_BILLING_POLICY_EFFECTIVE_AT: '2026-08-28T00:00:00.000Z',
      BB_BILLING_SUPPORT_OPERATIONS_READY: 'true',
      BB_BILLING_SUPPORT_RECEIPT_ID: 'support-readiness-fixture',
      BB_BILLING_TAX_TREATMENT_REVIEW_COMPLETE: 'true',
      BB_BILLING_TAX_REVIEWED_LAUNCH_GEOGRAPHY: 'us-only-fixture',
      BB_BILLING_TAX_TREATMENT_REVIEW_RECEIPT_ID: 'tax-review-fixture',
    } as const;
    expect(() =>
      loadConfig({
        ...commonLive,
        ...liveInitiationReadiness,
        BB_STRIPE_RUNTIME_SURFACE: 'api',
        BB_STRIPE_LIVE_API_RESTRICTED_KEY: 'rk_live_api_fixture_12345678',
        BB_STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_live_fixture_12345678',
        BB_STRIPE_LIVE_INITIATION_ENABLED: 'true',
      }),
    ).toThrow('trial-reminder delivery receipt');
    const readyLiveApi = loadConfig({
      ...commonLive,
      ...liveInitiationReadiness,
      BB_BILLING_TRIAL_REMINDER_DELIVERY_MODE: 'stripe_automatic_email',
      BB_BILLING_TRIAL_REMINDER_DELIVERY_RECEIPT_ID: 'trial-email-setting-fixture',
      BB_STRIPE_RUNTIME_SURFACE: 'api',
      BB_STRIPE_LIVE_API_RESTRICTED_KEY: 'rk_live_api_fixture_12345678',
      BB_STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_live_fixture_12345678',
      BB_STRIPE_LIVE_INITIATION_ENABLED: 'true',
    });
    expect(readyLiveApi.commerce.stripe).toMatchObject({
      mode: 'live',
      runtimeInitiationPermitted: true,
      billingOperationalReadiness: {
        state: 'ready',
        trialReminderDeliveryMode: 'stripe_automatic_email',
        trialReminderDeliveryReceiptId: 'trial-email-setting-fixture',
        taxTreatmentReviewComplete: true,
        taxReviewedLaunchGeography: 'us-only-fixture',
        taxTreatmentReviewReceiptId: 'tax-review-fixture',
      },
    });
    expect(() =>
      loadConfig({
        ...commonLive,
        ...liveInitiationReadiness,
        BB_BILLING_TRIAL_REMINDER_DELIVERY_MODE: 'stripe_automatic_email',
        BB_BILLING_TRIAL_REMINDER_DELIVERY_RECEIPT_ID: 'trial-email-setting-fixture',
        BB_STRIPE_RUNTIME_SURFACE: 'worker',
        BB_STRIPE_LIVE_WORKER_RESTRICTED_KEY: 'rk_live_worker_fixture_12345678',
        BB_STRIPE_LIVE_INITIATION_ENABLED: 'true',
      }),
    ).toThrow('restricted key custody');
    expect(() =>
      loadConfig({
        ...commonLive,
        BB_STRIPE_TEST_ACCOUNT_ID: 'acct_fixture1234',
      }),
    ).toThrow('live mode refuses test Stripe configuration values');
  });
});
