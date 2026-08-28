import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function repositoryDocument(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), 'utf8');
}

describe('noncharging release documentation', () => {
  it('uses a two-stage external receipt without making the candidate bind itself', async () => {
    const [receipt, plan, index] = await Promise.all([
      repositoryDocument('docs/post-launch-beta/NONCHARGING-RELEASE-RECEIPT.md'),
      repositoryDocument('docs/post-launch-beta/EXECUTION-PLAN.md'),
      repositoryDocument('docs/post-launch-beta/README.md'),
    ]);

    expect(receipt).toContain('`draft_pre_authorization`');
    expect(receipt).toContain('External effects before authorization | Exactly zero');
    expect(receipt).toContain('`CONFIRM NONCHARGING RELEASE SETUP`');
    expect(receipt).toContain('The first authorized action is release identity');
    expect(receipt).toContain('before any provider write');
    expect(receipt).toContain('Do not squash');
    expect(receipt).toContain('`executing_noncharging`');
    expect(receipt).toContain('`complete_noncharging`');
    expect(plan).toContain('planned annotated tag');
    expect(plan).toContain('first authorized action creates, pushes, and verifies');
    expect(index).toContain('[NONCHARGING-RELEASE-RECEIPT.md]');
    expect(index).toMatch(/completed receipt lives\s+outside the versioned candidate/iu);
  });

  it('defines reproducible canonical scope-digest bytes and preserves the authorized snapshot', async () => {
    const receipt = await repositoryDocument(
      'docs/post-launch-beta/NONCHARGING-RELEASE-RECEIPT.md',
    );

    expect(receipt).toContain('scope_digest_sha256=EXCLUDED_FROM_CANONICAL_BYTES');
    expect(receipt).toContain('normalize CRLF and bare CR line');
    expect(receipt).toContain('encode as UTF-8 without a byte-order mark');
    expect(receipt).toContain('exactly one trailing LF');
    expect(receipt).toContain('Do not Unicode-normalize');
    expect(receipt).toContain('The appended digest record is not part of the frozen snapshot');
    expect(receipt).toMatch(/never alter or replace the\s+authorized snapshot/u);
  });

  it('keeps the live release default-off and separates sandbox rehearsal evidence', async () => {
    const receipt = await repositoryDocument(
      'docs/post-launch-beta/NONCHARGING-RELEASE-RECEIPT.md',
    );

    const requiredFields = [
      'unit_amount=1499',
      'BB_STRIPE_LIVE_INITIATION_ENABLED=false',
      'stripe_database_initiation=false',
      'stripe_active_cohort=0',
      'stripe_eligible_customer_households=0',
      'stripe_live_checkout_or_portal_sessions_created=0',
      'stripe_live_customers_or_subscriptions_created=0',
      'stripe_live_money_moved=false',
      'stripe_sandbox_rehearsal_objects_torn_down=true',
      'customer_contacted=false',
      'customer_pii_retained=false',
      'twilio_enabled=false',
      'legacy_boomerbuddy_changed=false',
      'final_disposition=NONCHARGING_READY_CHECKOUT_CLOSED',
    ];

    for (const field of requiredFields) expect(receipt).toContain(field);
    expect(receipt).toContain('https://api.boomerbuddy.net/v1/webhooks/stripe');
    expect(receipt).toContain('https://boomerbuddy.net/api/webhooks/stripe');
    expect(receipt).toContain('one active recurring USD 14.99 monthly Price');
    expect(receipt).toMatch(/Family\s+annual, Individual, group, referral/u);
  });

  it('requires a unique technically read-only credential and denied-write proof per service', async () => {
    const [receipt, runbook, manifest, goLive] = await Promise.all([
      repositoryDocument('docs/post-launch-beta/NONCHARGING-RELEASE-RECEIPT.md'),
      repositoryDocument('docs/run-3/REPLIT-FIRST-LAUNCH-RUNBOOK.md'),
      repositoryDocument('docs/run-3-1/REPLIT-ENVIRONMENT-MANIFEST.md'),
      repositoryDocument('docs/run-3-1/FOUNDING-HOUSEHOLD-GO-LIVE.md'),
    ]);
    const combined = [receipt, runbook, manifest, goLive].join('\n');

    for (const project of [
      'boomerbuddy-web',
      'boomerbuddy-api',
      'boomerbuddy-worker',
      'boomerbuddy-hq',
    ]) {
      expect(combined).toContain(`\`${project}\``);
    }
    expect(runbook).toContain('**Allow write access** unchecked');
    expect(runbook).toContain('`Contents: Read-only`');
    expect(runbook).toContain('`Metadata: Read-only`');
    expect(runbook).toContain(
      'git push --dry-run origin HEAD:refs/heads/bb-denied-write-proof-<receipt-id>',
    );
    expect(runbook).toContain('It must exit nonzero');
    expect(manifest).toContain('Exit zero is a hard stop');
    expect(goLive).toContain('With the same per-project credential');
  });

  it('binds every published checkout to the exact release commit, not only its tree', async () => {
    const receipt = await repositoryDocument(
      'docs/post-launch-beta/NONCHARGING-RELEASE-RECEIPT.md',
    );

    expect(receipt).toContain('published checkout HEAD equality to the');
    expect(receipt).toContain('exact checkout HEAD equality');
    expect(receipt).toContain(
      'different snapshot commit is rejected even when its tree is identical',
    );
  });

  it('keeps the standalone Replit runbook behind the same exact authority and inventory gates', async () => {
    const runbook = await repositoryDocument('docs/run-3/REPLIT-FIRST-LAUNCH-RUNBOOK.md');

    expect(runbook).toContain(
      'Before authorization, this runbook permits only read-only inventory',
    );
    expect(runbook).toContain('Item 4 is then the first authorized external write');
    expect(runbook).toContain('[NONCHARGING-RELEASE-RECEIPT.md]');
    expect(runbook).toContain('`CONFIRM NONCHARGING RELEASE SETUP`');
    expect(runbook).toContain('As the first authorized external write');
    expect(runbook).toContain('`https://github.com/micahheaton/BoomerBuddyRemix.git`');
    expect(runbook).toContain('The separate legacy Replit project');
    expect(runbook).toContain('Inventory every existing managed PostgreSQL project and database');
    expect(runbook).toContain('Never create a second database');
    expect(runbook).not.toContain(
      'Create or confirm a company-controlled private Git remote with MFA',
    );
  });

  it('inventories live Stripe before writes and marks the Founding activation path historical', async () => {
    const [receipt, goLive, verdict, firstCustomer, playbook] = await Promise.all([
      repositoryDocument('docs/post-launch-beta/NONCHARGING-RELEASE-RECEIPT.md'),
      repositoryDocument('docs/run-3-1/FOUNDING-HOUSEHOLD-GO-LIVE.md'),
      repositoryDocument('docs/run-3/00-EXECUTIVE-VERDICT.md'),
      repositoryDocument('docs/run-3/FIRST-CUSTOMER-7-DAY-PLAN.md'),
      repositoryDocument('docs/run-3/FOUNDING-HOUSEHOLD-PLAYBOOK.md'),
    ]);
    const liveStripe = receipt.slice(
      receipt.indexOf('### H. Configure minimum live Stripe'),
      receipt.indexOf('### I. Prove monitoring'),
    );
    const inventory = liveStripe.indexOf('run a fresh read-only inventory');
    const firstCreate = liveStripe.indexOf('Create one active Family Product');

    expect(inventory).toBeGreaterThanOrEqual(0);
    expect(firstCreate).toBeGreaterThan(inventory);
    expect(liveStripe).toContain('before any live POST, PATCH, DELETE');
    expect(liveStripe).toContain('expected zero live commerce resources');
    expect(liveStripe).toContain('explicitly says `adopt_existing`');
    expect(liveStripe).toMatch(/exact\s+before\/after counts/u);
    expect(liveStripe).toContain('scope drift: stop before the first write');

    expect(goLive).toContain('Status: **superseded; not an operational production runbook**');
    expect(goLive).toMatch(/Do not execute its\s+numbered actions/u);
    expect(goLive).toContain('maintenance-only historical tooling');
    expect(verdict).toContain(
      'The Run 3 Founding Household customer path is historical evidence only',
    );
    expect(verdict).toContain('The current implementation entry point is');
    expect(firstCustomer).toContain(
      'superseded and not an operational customer-activation runbook',
    );
    expect(playbook).toContain('not an operational production runbook');
    expect(verdict).not.toMatch(/remain the operational\s+handoff/u);
  });

  it('records exact default-off acquisition and support rollout plus two clean rehearsals', async () => {
    const [receipt, manifest, runbook, gauntlet, cohort] = await Promise.all([
      repositoryDocument('docs/post-launch-beta/NONCHARGING-RELEASE-RECEIPT.md'),
      repositoryDocument('docs/run-3-1/REPLIT-ENVIRONMENT-MANIFEST.md'),
      repositoryDocument('docs/run-3/REPLIT-FIRST-LAUNCH-RUNBOOK.md'),
      repositoryDocument('docs/post-launch-beta/GAUNTLET-PROMPT-PACK-G4-G15.md'),
      repositoryDocument('docs/run-3/FIRST-COHORT-AND-DISCOVERY-WORKFLOW.md'),
    ]);
    const deploymentContract = `${receipt}\n${manifest}\n${runbook}`;

    for (const control of [
      'BB_PRIVATE_BETA_ACCESS_INTENTS_ENABLED',
      'BB_PRIVATE_BETA_ACCESS_INTENTS_EDGE_GUARD_CONFIRMED',
      'BB_SUPPORT_RECEIPTS_CUSTOMER_ACCESS_ENABLED',
      'BB_SUPPORT_RECEIPTS_HQ_QUEUE_ENABLED',
      'BB_SUPPORT_RECEIPTS_INTAKE_ENABLED',
    ]) {
      expect(receipt).toContain(`${control}=false`);
      expect(manifest).toContain(`\`${control}\``);
      expect(runbook).toContain(`\`${control}\``);
    }
    expect(deploymentContract).toMatch(
      /keep support intake false[\s\S]*customer access and HQ queue true/iu,
    );
    expect(deploymentContract).toMatch(/roll back intake first/iu);
    expect(deploymentContract).toContain('PRIVATE-BETA-ACCESS-INTENTS.md');
    expect(receipt).toContain('private_beta_access_intents_edge_guard_api=false');
    expect(receipt).toContain('private_beta_access_intents_edge_guard_web=false');
    expect(receipt).toContain('customer_clerk_self_deletion_disabled_confirmed=true');
    expect(receipt).toContain('BB_CUSTOMER_CLERK_SELF_DELETION_DISABLED_CONFIRMED=true');
    expect(receipt).toContain('approved isolated nonproduction');
    expect(receipt).toContain('first_customer_rehearsal_1=<separate receipt ID>:passed');
    expect(receipt).toContain('first_customer_rehearsal_2=<separate receipt ID>:passed');
    expect(gauntlet).toMatch(/two clean rehearsals/iu);
    expect(gauntlet).toMatch(/separate fresh customer and HQ sessions/iu);
    expect(gauntlet).toMatch(/reset synthetic state/iu);
    expect(cohort).toContain('1 -> 3 -> 5');
  });

  it('discovers the tagged migration suffix exactly and tracks the current end of chain', async () => {
    const goLive = await repositoryDocument('docs/run-3-1/FOUNDING-HOUSEHOLD-GO-LIVE.md');
    const migrationFiles = (
      await readdir(resolve(repositoryRoot, 'packages/persistence/migrations'))
    )
      .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(file))
      .sort((left, right) => left.localeCompare(right));
    const latestMigration = migrationFiles.at(-1);

    expect(latestMigration).toBeDefined();
    expect(goLive).toContain(latestMigration);
    expect(goLive).toContain(
      'git ls-tree -r --name-only refs/tags/<tag> -- packages/persistence/migrations',
    );
    expect(goLive).toContain('git ls-tree -r refs/tags/<tag> -- packages/persistence/migrations');
    expect(goLive).toContain('exact checksum-valid prefix of the tagged manifest');
    expect(goLive).toContain('tagged candidate manifest minus the exact database prefix');
    expect(goLive).toContain('0033_run3_1_billing_recovery_evidence.sql');
    expect(goLive).toContain('0034_run3_1_support_receipts.sql');
    expect(goLive).toContain('0035_run3_1_paid_family_catalog.sql');
    expect(goLive).toContain('Applied 0 migration(s): none');
    expect(goLive).not.toContain('complete `0001` through `0032` forward chain');
  });

  it('records separate exact Customer and HQ Clerk path contracts', async () => {
    const [receipt, manifest, goLive] = await Promise.all([
      repositoryDocument('docs/post-launch-beta/NONCHARGING-RELEASE-RECEIPT.md'),
      repositoryDocument('docs/run-3-1/REPLIT-ENVIRONMENT-MANIFEST.md'),
      repositoryDocument('docs/run-3-1/FOUNDING-HOUSEHOLD-GO-LIVE.md'),
    ]);
    const combined = [receipt, manifest, goLive].join('\n');

    for (const path of [
      'https://app.boomerbuddy.net/member',
      'https://app.boomerbuddy.net/unauthorized-sign-in',
      'https://app.boomerbuddy.net/sign-in',
      'https://hq.boomerbuddy.net/',
      'https://hq.boomerbuddy.net/sign-in',
    ]) {
      expect(combined).toContain(path);
    }
    expect(manifest).toContain('Customer and HQ before/after values');
    expect(manifest).toContain('A Customer success cannot close an HQ field');
    expect(goLive).toContain('select the exact existing **Customer production application**');
    expect(goLive).toContain('select the exact existing **HQ production application**');
    expect(goLive).toContain('Select the exact existing managed Production PostgreSQL project');
    expect(goLive).not.toMatch(
      /create a \*\*(?:separate customer|different HQ) production application/iu,
    );
    expect(goLive).toContain('Record the HQ issuer');
    expect(goLive).toMatch(/separately from\s+Customer evidence/u);
  });

  it('keeps the edited release documents free of en and em dashes', async () => {
    const documents = await Promise.all([
      repositoryDocument('docs/post-launch-beta/NONCHARGING-RELEASE-RECEIPT.md'),
      repositoryDocument('docs/post-launch-beta/README.md'),
      repositoryDocument('docs/post-launch-beta/EXECUTION-PLAN.md'),
      repositoryDocument('docs/run-3/REPLIT-FIRST-LAUNCH-RUNBOOK.md'),
      repositoryDocument('docs/run-3-1/FOUNDING-HOUSEHOLD-GO-LIVE.md'),
      repositoryDocument('docs/run-3-1/REPLIT-ENVIRONMENT-MANIFEST.md'),
    ]);

    for (const content of documents) expect(content).not.toMatch(/[\u2013\u2014]/u);
  });
});
