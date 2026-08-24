import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function document(name: string): Promise<string> {
  return readFile(resolve(repositoryRoot, 'docs/run-3-1', name), 'utf8');
}

describe('Run 3.1 founder evidence documents', () => {
  it('starts with exact founder actions and preserves the executable production bootstrap contract', async () => {
    const runbook = await document('FOUNDING-HOUSEHOLD-GO-LIVE.md');

    expect(runbook.startsWith('### Founder clicks/actions\n')).toBe(true);
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
      'BB_API_HOST',
      'BB_API_PORT',
      'BB_TRUSTED_PROXY_HOPS',
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
      'BB_CLERK_HQ_ISSUER',
      'BB_CLERK_HQ_AUDIENCE',
      'BB_CLERK_HQ_JWT_KEY',
      'BB_CLERK_HQ_MAX_SECOND_FACTOR_AGE_SECONDS',
      'BB_ARTIFACT_KEY_BASE64',
      'BB_FINGERPRINT_KEY_BASE64',
      'BB_SAFE_WORD_PEPPER',
      'BB_LOG_LEVEL',
      'BB_STRIPE_MODE',
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
    expect(manifest).toContain('Stripe is out of scope');
    expect(manifest).toContain('Provider adapter is absent');
    expect(manifest).toContain('disposable provider-test PostgreSQL verification shell');
    expect(manifest).toContain('API pool 2 plus worker pool 1/batch 1');
  });
});
