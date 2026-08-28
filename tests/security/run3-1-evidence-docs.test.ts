import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function document(name: string): Promise<string> {
  return readFile(resolve(repositoryRoot, 'docs/run-3-1', name), 'utf8');
}

describe('Run 3.1 founder evidence documents', () => {
  it('marks the Founding bootstrap instructions historical and points to the current entry', async () => {
    const runbook = await document('FOUNDING-HOUSEHOLD-GO-LIVE.md');

    expect(runbook.startsWith('# Historical Founding Household go-live record\n')).toBe(true);
    expect(runbook).toContain('superseded; not an operational production runbook');
    expect(runbook).toMatch(/Do not execute its\s+numbered actions/u);
    expect(runbook).toContain('docs/post-launch-beta/RUN-NEXT-EXECUTION.md');
    expect(runbook).toContain('maintenance-only historical tooling');
    expect(runbook).toContain('npm run identity:bootstrap-founder');
    expect(runbook).toContain('npm run founding-household:bootstrap-production');
    expect(runbook).toContain('--benefit-key family_beta_v1');
    expect(runbook).not.toContain('--benefit-key founding_family_beta_v2');
    expect(runbook).toContain('--confirm-production FOUNDING_HOUSEHOLD_PRODUCTION');
    expect(runbook).toContain('RESTORE-DISPOSABLE:<exact-database-name>');
    expect(runbook).toContain('The current verdict is `REMEDIATE_BEFORE_EXTERNAL_USER`');
    expect(runbook).toContain('BB_ALLOW_POSTGRES_VERIFICATION=true');
    expect(runbook).toContain('BB_POSTGRES_POOL_MAX=1');
    expect(runbook).toContain('SQLSTATE `53200`');
    expect(runbook).toMatch(/Never run this\s+command against the live database/u);
  });

  it('inventories every production and portability variable without activating providers', async () => {
    const manifest = await document('REPLIT-ENVIRONMENT-MANIFEST.md');
    const requiredVariables = [
      'NODE_ENV',
      'BB_REPLIT_SERVICE',
      'BB_RUN3_1_RELEASE_COMMIT',
      'BB_RUN3_1_RELEASE_TAG',
      'REPLIT_DEPLOYMENT',
      'PORT',
      'BB_PUBLIC_ORIGIN',
      'BB_API_INTERNAL_ORIGIN',
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
      'CLERK_SECRET_KEY',
      'NEXT_PUBLIC_CLERK_SIGN_IN_URL',
      'BB_CUSTOMER_CLERK_SELF_DELETION_DISABLED_CONFIRMED',
      'BB_API_HOST',
      'BB_API_PORT',
      'BB_TRUSTED_PROXY_HOPS',
      'BB_PRIVATE_BETA_ACCESS_INTENTS_ENABLED',
      'BB_PRIVATE_BETA_ACCESS_INTENTS_EDGE_GUARD_CONFIRMED',
      'BB_SUPPORT_RECEIPTS_CUSTOMER_ACCESS_ENABLED',
      'BB_SUPPORT_RECEIPTS_INTAKE_ENABLED',
      'BB_SUPPORT_RECEIPTS_HQ_QUEUE_ENABLED',
      'BB_FIRST_PARTY_CONTENT_ENABLED',
      'BB_DAILY_CONTENT_DRAFTS_ENABLED',
      'BB_DATABASE_DRIVER',
      'DATABASE_URL',
      'BB_POSTGRES_POOL_MAX',
      'BB_RUN_MIGRATIONS',
      'BB_SEED_DEMO',
      'BB_ALLOW_DEV_IDENTITY',
      'BB_FOUNDER_PERSON_ID',
      'BB_FOUNDER_CLERK_SUBJECT',
      'BB_CUSTOMER_ORIGINS',
      'BB_HQ_ORIGINS',
      'BB_CLERK_CUSTOMER_ISSUER',
      'BB_CLERK_CUSTOMER_AUDIENCE',
      'BB_CLERK_CUSTOMER_JWT_KEY',
      'BB_CLERK_MOBILE_AUTHORIZED_PARTIES',
      'BB_CLERK_HQ_ISSUER',
      'BB_CLERK_HQ_AUDIENCE',
      'BB_CLERK_HQ_JWT_KEY',
      'BB_CLERK_HQ_MAX_SECOND_FACTOR_AGE_SECONDS',
      'BB_ARTIFACT_KEY_BASE64',
      'BB_FINGERPRINT_KEY_BASE64',
      'BB_SAFE_WORD_PEPPER',
      'BB_LOG_LEVEL',
      'BB_STRIPE_MODE',
      'BB_STRIPE_RUNTIME_SURFACE',
      'BB_STRIPE_LIVE_INITIATION_ENABLED',
      'BB_STRIPE_LIVE_ACCOUNT_ID',
      'BB_STRIPE_LIVE_FOUNDING_PRODUCT_ID',
      'BB_STRIPE_LIVE_FOUNDING_MONTHLY_PRICE_ID',
      'BB_STRIPE_LIVE_FAMILY_ANNUAL_PRICE_ID',
      'BB_STRIPE_LIVE_INDIVIDUAL_PRODUCT_ID',
      'BB_STRIPE_LIVE_INDIVIDUAL_MONTHLY_PRICE_ID',
      'BB_STRIPE_LIVE_INDIVIDUAL_ANNUAL_PRICE_ID',
      'BB_STRIPE_LIVE_INDIVIDUAL_OFFERS_ENABLED',
      'BB_STRIPE_LIVE_CANCEL_ONLY_PORTAL_CONFIGURATION_ID',
      'BB_STRIPE_LIVE_API_RESTRICTED_KEY',
      'BB_STRIPE_LIVE_WORKER_RESTRICTED_KEY',
      'BB_STRIPE_LIVE_WEBHOOK_SECRET',
      'BB_BILLING_PUBLIC_SUPPORT_EMAIL',
      'BB_BILLING_PUBLIC_SUPPORT_URL',
      'BB_BILLING_PUBLIC_PRIVACY_URL',
      'BB_BILLING_PUBLIC_TERMS_URL',
      'BB_BILLING_PUBLIC_BILLING_TERMS_URL',
      'BB_BILLING_POLICY_VERSION',
      'BB_BILLING_POLICY_EFFECTIVE_AT',
      'BB_BILLING_SUPPORT_OPERATIONS_READY',
      'BB_BILLING_SUPPORT_RECEIPT_ID',
      'BB_BILLING_TRIAL_REMINDER_DELIVERY_MODE',
      'BB_BILLING_TRIAL_REMINDER_DELIVERY_RECEIPT_ID',
      'BB_BILLING_TAX_TREATMENT_REVIEW_COMPLETE',
      'BB_BILLING_TAX_REVIEWED_LAUNCH_GEOGRAPHY',
      'BB_BILLING_TAX_TREATMENT_REVIEW_RECEIPT_ID',
      'BB_TWILIO_MODE',
      'BB_WORKER_ID',
      'BB_WORKER_POLL_MS',
      'BB_WORKER_LEASE_MS',
      'BB_WORKER_HEARTBEAT_MS',
      'BB_WORKER_SHUTDOWN_MS',
      'BB_WORKER_BATCH_SIZE',
      'BB_WORKER_RETRY_BASE_MS',
      'BB_WORKER_RETRY_MAX_MS',
      'BB_RUN3_1_BACKUP_KEY_BASE64',
      'BB_ALLOW_POSTGRES_VERIFICATION',
    ];

    for (const variable of requiredVariables) expect(manifest).toContain(`\`${variable}\``);
    expect(manifest).toContain('`REPLIT_SECRET_SUFFICIENT_FOR_BETA`');
    expect(manifest).toContain('`NOT_USED_IN_FOUNDING_HOUSEHOLD_SCOPE`');
    expect(manifest).toContain('No enabled Run 3.1 runtime value is classified');
    expect(manifest).toContain('Surface-separated live Stripe configuration');
    expect(manifest).toContain('operator-approved, unexpired max-one cohort');
    expect(manifest).toContain('The deprecated shared `BB_STRIPE_LIVE_API_KEY` is always absent');
    expect(manifest).toContain('Twilio credential/URL fields are refused');
    expect(manifest).toContain('disposable provider-test PostgreSQL verification shell');
    expect(manifest).toContain('API pool 2 plus worker pool 1/batch 1');
    expect(manifest).toContain('Family annual is the default Checkout offer: USD 149.90');
    expect(manifest).toContain('Family monthly remains selectable at USD 14.99');
    expect(manifest).toContain('Account creation alone does not start a trial or charge');
    expect(manifest).toMatch(/Individual.+remain\s+default-off/isu);
    expect(manifest).toContain('Referrals remain disabled');
    expect(manifest).toContain('set `BB_STRIPE_LIVE_INITIATION_ENABLED=false`');
    expect(manifest).toContain('keep `BB_TWILIO_MODE=disabled`');
    for (const service of [
      'boomerbuddy-web',
      'boomerbuddy-api',
      'boomerbuddy-worker',
      'boomerbuddy-hq',
    ]) {
      expect(manifest).toContain(`\`${service}\``);
    }
    expect(manifest).toMatch(/Replit must never push to\s+GitHub/u);
    expect(manifest).toContain('separate legacy Replit project named `BoomerBuddy`');
  });
});
