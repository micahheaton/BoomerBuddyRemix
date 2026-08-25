import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

describe('mobile production surface', () => {
  it('pins the native application identity and production EAS profiles', () => {
    const app = JSON.parse(source('apps/mobile/app.json')) as {
      expo: {
        icon: string;
        scheme: string;
        ios: { bundleIdentifier: string };
        android: {
          package: string;
          adaptiveIcon: { foregroundImage: string; backgroundColor: string };
        };
        web: { favicon: string };
        plugins: Array<string | [string, Record<string, unknown>]>;
        extra: Record<string, string>;
      };
    };
    const eas = JSON.parse(source('apps/mobile/eas.json')) as {
      build: Record<string, Record<string, unknown>>;
      submit: Record<string, Record<string, unknown>>;
    };

    expect(app.expo.scheme).toBe('boomerbuddy');
    expect(app.expo.ios.bundleIdentifier).toBe('net.boomerbuddy.app');
    expect(app.expo.android.package).toBe('net.boomerbuddy.app');
    expect(app.expo.plugins).toEqual(
      expect.arrayContaining(['@clerk/expo', 'expo-secure-store', 'expo-web-browser']),
    );
    expect(app.expo.icon).toBe('./assets/icon.png');
    expect(app.expo.android.adaptiveIcon).toEqual({
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#F7F5EF',
    });
    expect(app.expo.web.favicon).toBe('./assets/favicon.png');
    expect(app.expo.plugins).toContainEqual([
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#F7F5EF',
      },
    ]);
    for (const asset of ['icon.png', 'adaptive-icon.png', 'splash-icon.png', 'favicon.png']) {
      const path = resolve(repositoryRoot, 'apps/mobile/assets', asset);
      expect(statSync(path).size).toBeGreaterThan(100);
      expect(readFileSync(path).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    }
    expect(app.expo.extra.mobileJwtTemplate).toBe('boomerbuddy-mobile');
    expect(JSON.stringify(app)).not.toMatch(/secret|private[_-]?key|sk_live/u);
    expect(eas.build.production).toMatchObject({
      autoIncrement: true,
      channel: 'production',
      environment: 'production',
      env: { EXPO_PUBLIC_API_URL: 'https://api.boomerbuddy.net' },
    });
    expect(eas.submit).toHaveProperty('production');
  });

  it('uses Clerk secure caching and the dedicated mobile template with no dev-session path', () => {
    const app = source('apps/mobile/App.tsx');
    const api = source('apps/mobile/src/api.ts');
    const apiOrigin = source('apps/mobile/src/api-origin.ts');
    const session = source('apps/mobile/src/session.ts');
    const combined = `${app}\n${api}\n${session}`;

    expect(app).toContain("import { tokenCache } from '@clerk/expo/token-cache';");
    expect(app).toContain('template: mobileJwtTemplate');
    expect(app).toContain('skipCache: true');
    expect(app).toContain('<ClerkProvider');
    expect(api).toContain("headers.set('Authorization', `Bearer ${requestToken}`)");
    expect(api).toContain('recoverUnauthorizedMobileSession');
    expect(apiOrigin).toContain(
      "export const productionMobileApiOrigin = 'https://api.boomerbuddy.net';",
    );
    expect(api).toContain('readMobileAuthenticationToken({ skipCache: true })');
    expect(combined).not.toContain('/v1/dev/sessions/mobile');
    expect(combined).not.toContain('writeSessionToken');
    expect(combined).not.toContain('readSessionToken');
  });

  it('keeps entitlement information without external payment steering', () => {
    const screens = source('apps/mobile/src/screens.tsx');

    expect(screens).toContain('Current access and plan');
    expect(screens).toContain('Household access is active');
    expect(screens).toContain('This screen shows access information only.');
    for (const prohibited of [
      'Payments are completed on',
      'Billing is managed on',
      'secure BoomerBuddy website',
      'external purchase',
      'memberBillingUrl',
      'Open web billing',
      'WebBrowser.openBrowserAsync',
      'Continue to checkout',
      'Manage payment',
      '/member/billing',
    ]) {
      expect(screens).not.toContain(prohibited);
    }
  });

  it('provides signed-in and signed-out help and policy destinations without billing links', () => {
    const app = source('apps/mobile/App.tsx');
    const navigation = source('apps/mobile/src/navigation.ts');
    const screens = source('apps/mobile/src/screens.tsx');
    const policies = source('apps/mobile/src/policy-screens.tsx');

    for (const route of [
      'HelpPolicies',
      'Support',
      'Privacy',
      'Terms',
      'Accessibility',
      'AccountDeletion',
    ]) {
      expect(navigation).toContain(`${route}: undefined;`);
      expect(app).toContain(`name="${route}"`);
    }
    expect(app.match(/name="HelpPolicies"/gu) ?? []).toHaveLength(2);
    expect(screens).toContain("navigation.navigate('HelpPolicies')");
    expect(policies).toContain('support@boomerbuddy.net');
    expect(policies).toContain('subject &quot;Account deletion');
    expect(policies).toContain('BoomerBuddy is not an emergency service.');
    for (const prohibited of [
      'checkout',
      'pricing',
      'purchase link',
      'billing link',
      '/member/billing',
      'https://',
    ]) {
      expect(policies.toLowerCase()).not.toContain(prohibited.toLowerCase());
    }
  });

  it('provides a confirmed in-app deletion request with safe receipt recovery', () => {
    const policies = source('apps/mobile/src/policy-screens.tsx');

    expect(policies).toContain("mobileRequest<PrivacyRequestList>('/v1/privacy-requests')");
    expect(policies).toContain("requestKind: 'delete'");
    expect(policies).toContain("confirmation: 'DELETE_MY_ACCOUNT'");
    expect(policies).toContain('Confirm account deletion request');
    expect(policies).toContain('Submit deletion request');
    expect(policies).toContain('Your existing account deletion request was recovered safely.');
    expect(policies).toContain('Receipt ID: {receipt.id}');
    expect(policies).toContain('Status: {deletionStateLabels[receipt.state]}');
    expect(policies).toContain('Response due by:');
    expect(policies).toContain('Refresh request status');
    expect(policies).toContain('Sign in with the account you want deleted');
    expect(policies).toContain('even if the account is not connected to a household');
  });

  it('uses plain customer language for results, history, access, and feedback receipts', () => {
    const screens = source('apps/mobile/src/screens.tsx');
    const feedback = source('apps/mobile/src/feedback-screen.tsx');
    const combined = `${screens}\n${feedback}`;

    expect(screens).toContain('How much the check found');
    expect(screens).toContain('What the check noticed');
    expect(screens).toContain('Important limit');
    expect(screens).toContain('Limited security records may remain afterward.');
    expect(feedback).toContain('Feedback received');
    for (const prohibited of [
      'Evidence sufficiency',
      'Provider provenance',
      'Ruleset version',
      'HQ audit metadata',
      'operational proof',
      'current access projection',
      'Access state:',
      'Plan state:',
      "replaceAll('_', ' ')",
      'Clerk-hosted',
      'identity provider',
      'token cache',
    ]) {
      expect(combined).not.toContain(prohibited);
    }
  });

  it('does not expose implementation-status language to customers', () => {
    const app = source('apps/mobile/App.tsx');
    const screens = source('apps/mobile/src/screens.tsx');

    expect(screens).not.toContain('scaffolded and not implemented');
    expect(screens).not.toContain('Future escalation notifications (not implemented)');
    expect(screens).not.toContain('Future guided orientation help (not implemented)');
    expect(screens).toContain(
      'Notifications for newly shared Checks are not available in this beta.',
    );
    expect(app).toContain('{__DEV__ ? (');
    expect(app).toContain('name="NativeProof"');
    expect(screens).toContain('Native intake proof');
  });
});
