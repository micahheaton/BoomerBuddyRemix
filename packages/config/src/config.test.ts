import { describe, expect, it } from 'vitest';
import { loadConfig } from './index';

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

  it('requires a complete test-only Stripe configuration when enabled', () => {
    expect(() => loadConfig({ ...developmentEnvironment(), BB_STRIPE_MODE: 'test' })).toThrow(
      'complete test credentials',
    );
    const config = loadConfig({
      ...developmentEnvironment(),
      BB_STRIPE_MODE: 'test',
      BB_STRIPE_SECRET_KEY: 'sk_test_fixture_12345678',
      BB_STRIPE_WEBHOOK_SECRET: 'whsec_fixture_12345678',
      BB_STRIPE_API_VERSION: '2026-07-29.fixture',
      BB_STRIPE_CANCEL_ONLY_PORTAL_CONFIGURATION_ID: 'bpc_cancel_only_fixture',
      BB_STRIPE_PLUS_MONTHLY_PRICE_ID: 'price_plus_month_fixture',
      BB_STRIPE_PLUS_ANNUAL_PRICE_ID: 'price_plus_year_fixture',
      BB_STRIPE_FAMILY_MONTHLY_PRICE_ID: 'price_family_month_fixture',
      BB_STRIPE_FAMILY_ANNUAL_PRICE_ID: 'price_family_year_fixture',
    });
    expect(config.commerce.stripe).toMatchObject({ mode: 'test' });
  });
});
