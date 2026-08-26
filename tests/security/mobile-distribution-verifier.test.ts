import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8')) as Record<string, unknown>;
}

describe('provider-free mobile distribution verifier', () => {
  it('keeps canonical store metadata ASCII-only and provider-neutral', () => {
    const metadata = json('apps/mobile/store-metadata.json');
    const serialized = JSON.stringify(metadata);

    expect(serialized).toMatch(/^[\x20-\x7e]+$/u);
    expect(metadata).toMatchObject({
      bundleIdentifier: 'net.boomerbuddy.app',
      androidPackage: 'net.boomerbuddy.app',
      marketingVersion: '0.1.0',
      supportUrl: 'https://app.boomerbuddy.net/support',
      privacyPolicyUrl: 'https://app.boomerbuddy.net/privacy',
      termsOfUseUrl: 'https://app.boomerbuddy.net/terms',
      accountDeletionUrl: 'https://app.boomerbuddy.net/account-deletion',
      universalAndAppLinksStatus: 'blocked_pending_provider_signing_and_two_way_association',
      nativeCommerceStatus: 'web_first_no_native_purchase_or_payment_steering',
    });
    expect(serialized).not.toMatch(/appleTeamId|projectId|serviceAccount|signingSha/iu);
  });

  it('verifies resolved manifests, release inputs, legal routes, assets, and link posture offline', () => {
    const output = execFileSync(
      process.execPath,
      [resolve(repositoryRoot, 'scripts/verify-mobile-distribution.mjs')],
      { cwd: repositoryRoot, encoding: 'utf8' },
    );

    expect(JSON.parse(output)).toMatchObject({
      status: 'provider_free_mobile_distribution_inputs_verified',
      applicationId: 'net.boomerbuddy.app',
      marketingVersion: '0.1.0',
      developerBuildVersionSource: 'remote_eas_receipt_required',
      universalAndAppLinks: 'blocked_pending_two_way_provider_association',
      assetSha256: {
        'icon.png': expect.stringMatching(/^[a-f0-9]{64}$/u),
        'adaptive-icon.png': expect.stringMatching(/^[a-f0-9]{64}$/u),
        'splash-icon.png': expect.stringMatching(/^[a-f0-9]{64}$/u),
        'favicon.png': expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
  }, 30_000);
});
