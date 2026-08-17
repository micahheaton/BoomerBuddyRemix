import { describe, expect, it } from 'vitest';
import { assertStripeOnlineRuntimePermitted, loadConfig } from './index';

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

  it.each([
    ['BB_ALLOW_DEV_IDENTITY', 'true'],
    ['BB_DATABASE_DRIVER', 'pglite'],
    ['BB_SEED_DEMO', 'true'],
  ])('refuses unsafe production setting %s', (key, value) => {
    expect(() =>
      loadConfig({
        ...developmentEnvironment(),
        NODE_ENV: 'production',
        BB_ALLOW_DEV_IDENTITY: 'false',
        BB_DATABASE_DRIVER: 'postgres',
        DATABASE_URL: 'postgresql://test.invalid/database',
        BB_SEED_DEMO: 'false',
        BB_CUSTOMER_ORIGINS: 'https://customer.test',
        BB_HQ_ORIGINS: 'https://hq.test',
        [key]: value,
      }),
    ).toThrow();
  });

  it('refuses production even when development switches are disabled', () => {
    expect(() =>
      loadConfig({
        ...developmentEnvironment(),
        NODE_ENV: 'production',
        BB_ALLOW_DEV_IDENTITY: 'false',
        BB_DATABASE_DRIVER: 'postgres',
        DATABASE_URL: 'postgresql://test.invalid/database',
        BB_SEED_DEMO: 'false',
        BB_CUSTOMER_ORIGINS: 'https://customer.test',
        BB_HQ_ORIGINS: 'https://hq.test',
      }),
    ).toThrow('refuses production startup');
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
    });
    expect(config.commerce.stripe).toMatchObject({
      mode: 'test',
      environment: 'test',
      apiVersion: '2026-02-25.clover',
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

  it('refuses raw live secrets and inactive Stripe environment families in every mode', () => {
    for (const [name, value] of [
      ['BB_STRIPE_LIVE_API_KEY', 'sk_live_fixture_12345678'],
      ['BB_STRIPE_LIVE_WEBHOOK_SECRET', 'whsec_live_fixture_12345678'],
    ] as const) {
      expect(() => loadConfig({ ...developmentEnvironment(), [name]: value })).toThrow(
        'Live Stripe secrets cannot be loaded from raw environment keys',
      );
    }
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

  it('accepts reviewed test keys and keeps live configuration offline without raw secrets', () => {
    const commonLive = {
      ...developmentEnvironment(),
      BB_STRIPE_MODE: 'live',
      BB_STRIPE_LIVE_ACCOUNT_ID: 'acct_livefixture1',
      BB_STRIPE_LIVE_CANCEL_ONLY_PORTAL_CONFIGURATION_ID: 'bpc_live_cancel_fixture',
      BB_STRIPE_LIVE_FOUNDING_PRODUCT_ID: 'prod_live_family_fixture',
      BB_STRIPE_LIVE_FOUNDING_MONTHLY_PRICE_ID: 'price_live_family_fixture',
    };
    expect(() =>
      loadConfig({ ...commonLive, BB_STRIPE_LIVE_API_KEY: 'sk_live_fixture_12345678' }),
    ).toThrow('raw environment keys');
    expect(() =>
      loadConfig({ ...commonLive, BB_STRIPE_LIVE_API_KEY: 'rk_test_fixture_12345678' }),
    ).toThrow('raw environment keys');
    const liveConfig = loadConfig(commonLive);
    expect(liveConfig.commerce.stripe).toMatchObject({
      mode: 'live',
      environment: 'production',
      runtimeInitiationPermitted: false,
      runtimeNetworkPermitted: false,
      credentialCustody: 'managed_identity_kms_unavailable',
      requiredSecretNames: ['BB_STRIPE_LIVE_API_KEY', 'BB_STRIPE_LIVE_WEBHOOK_SECRET'],
    });
    expect(() => assertStripeOnlineRuntimePermitted(liveConfig, 'api')).toThrow(
      'offline-only; api startup is refused',
    );
    expect(() => assertStripeOnlineRuntimePermitted(liveConfig, 'worker')).toThrow(
      'offline-only; worker startup is refused',
    );
    expect(() =>
      loadConfig({
        ...commonLive,
        BB_STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_live_fixture_12345678',
      }),
    ).toThrow('raw environment keys');
    expect(() =>
      loadConfig({
        ...commonLive,
        BB_STRIPE_TEST_ACCOUNT_ID: 'acct_fixture1234',
      }),
    ).toThrow('live mode refuses test Stripe configuration values');
  });
});
