import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const mobileRoot = resolve(repositoryRoot, 'apps/mobile');

type NativePermission = {
  $: Record<string, string>;
};

type NativeIntentFilter = {
  data?: NativePermission[];
};

type NativeActivity = {
  $: Record<string, string>;
  'intent-filter'?: NativeIntentFilter[];
};

type IntrospectedExpoConfig = {
  _internal: {
    modResults: {
      ios: {
        infoPlist: {
          CFBundleURLTypes?: Array<{ CFBundleURLSchemes?: string[] }>;
          NSAppTransportSecurity?: { NSAllowsArbitraryLoads?: boolean };
          NSFaceIDUsageDescription?: string;
        };
        entitlements: Record<string, unknown>;
      };
      android: {
        manifest: {
          manifest: {
            application?: Array<{ activity?: NativeActivity[] }>;
            'uses-permission'?: NativePermission[];
          };
        };
      };
    };
  };
};

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

function introspectedExpoConfig(): IntrospectedExpoConfig {
  const expoCli = resolve(repositoryRoot, 'node_modules/expo/bin/cli');
  return JSON.parse(
    execFileSync(process.execPath, [expoCli, 'config', '--type', 'introspect', '--json'], {
      cwd: mobileRoot,
      encoding: 'utf8',
    }),
  ) as IntrospectedExpoConfig;
}

describe('mobile production surface', () => {
  it('pins the remediated Metro graph and permits no High dependency allowlist', () => {
    const rootPackage = JSON.parse(source('package.json')) as {
      overrides: Record<string, string>;
    };
    const lock = JSON.parse(source('package-lock.json')) as {
      packages: Record<string, { version?: string }>;
    };
    const dependencyVerifier = source('scripts/verify-run3-1-dependencies.mjs');
    const disposition = source('docs/run-3/MOBILE-DEPENDENCY-AUDIT.md');

    expect(rootPackage.overrides).toMatchObject({
      metro: '0.84.5',
      'metro-config': '0.84.5',
      'metro-transform-worker': '0.84.5',
    });
    const exactMetroNodes = Object.entries(lock.packages).filter(([path]) =>
      /node_modules\/(?:metro|metro-config|metro-transform-worker)$/u.test(path),
    );
    expect(exactMetroNodes).toHaveLength(3);
    expect(exactMetroNodes.every(([, metadata]) => metadata.version === '0.84.5')).toBe(true);
    expect(
      Object.keys(lock.packages).some((path) => /(?:^|\/)node_modules\/image-size$/u.test(path)),
    ).toBe(false);
    expect(dependencyVerifier).toContain('const allowedMobileHighAdvisories = new Set();');
    expect(disposition).toContain('0 critical, 0 high, 23 moderate, 0 low');
  });

  it('resolves a least-privilege native transport and permission surface', () => {
    const config = introspectedExpoConfig();
    const infoPlist = config._internal.modResults.ios.infoPlist;
    const permissions =
      config._internal.modResults.android.manifest.manifest['uses-permission'] ?? [];
    const activities =
      config._internal.modResults.android.manifest.manifest.application?.flatMap(
        (application) => application.activity ?? [],
      ) ?? [];
    const blockedPermissions = [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.VIBRATE',
    ];
    const activePermissionNames = permissions
      .filter((permission) => permission.$['tools:node'] !== 'remove')
      .map((permission) => permission.$['android:name']);

    expect(infoPlist.NSAppTransportSecurity?.NSAllowsArbitraryLoads).toBe(false);
    expect(infoPlist).not.toHaveProperty('NSFaceIDUsageDescription');
    expect(activePermissionNames).not.toEqual(expect.arrayContaining(blockedPermissions));
    for (const permissionName of blockedPermissions) {
      expect(permissions).toContainEqual({
        $: expect.objectContaining({
          'android:name': permissionName,
          'tools:node': 'remove',
        }),
      });
    }
    expect(infoPlist.CFBundleURLTypes?.flatMap((entry) => entry.CFBundleURLSchemes ?? [])).toEqual(
      expect.arrayContaining(['boomerbuddy', 'net.boomerbuddy.app']),
    );
    expect(
      activities
        .flatMap((activity) => activity['intent-filter'] ?? [])
        .flatMap((filter) => filter.data ?? [])
        .map((data) => data.$),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          'android:scheme': 'clerk',
          'android:host': 'net.boomerbuddy.app.hosted-callback',
        }),
      ]),
    );
    expect(config._internal.modResults.ios.entitlements).toMatchObject({
      'com.apple.developer.applesignin': ['Default'],
    });
  });

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
      cli: { version: string; requireCommit: boolean; appVersionSource: string };
      build: Record<string, Record<string, unknown>>;
      submit: Record<string, Record<string, unknown>>;
    };

    expect(app.expo.scheme).toBe('boomerbuddy');
    expect(app.expo.ios.bundleIdentifier).toBe('net.boomerbuddy.app');
    expect(app.expo.android.package).toBe('net.boomerbuddy.app');
    expect(app.expo.plugins).toEqual(expect.arrayContaining(['@clerk/expo', 'expo-web-browser']));
    expect(app.expo.plugins).toContainEqual(['expo-secure-store', { faceIDPermission: false }]);
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
    expect(eas.cli).toEqual({
      version: '22.4.0',
      requireCommit: true,
      appVersionSource: 'remote',
    });
    expect(eas.build.preview).toMatchObject({
      node: '22.23.2',
      distribution: 'internal',
      channel: 'preview',
      environment: 'preview',
      android: {
        buildType: 'apk',
        image: 'ubuntu-26.04-jdk-17-ndk-r27b-sdk-57',
      },
      ios: { image: 'macos-tahoe-26.5-xcode-26.6' },
    });
    expect(eas.build['preview-simulator']).toEqual({
      extends: 'preview',
      ios: { simulator: true },
    });
    expect(eas.build.production).toMatchObject({
      node: '22.23.2',
      autoIncrement: true,
      channel: 'production',
      environment: 'production',
      android: { image: 'ubuntu-26.04-jdk-17-ndk-r27b-sdk-57' },
      ios: { image: 'macos-tahoe-26.5-xcode-26.6' },
      env: { EXPO_PUBLIC_API_URL: 'https://api.boomerbuddy.net' },
    });
    expect(eas.build.preview).not.toHaveProperty('npm');
    expect(eas.build.production).not.toHaveProperty('npm');
    expect(eas.submit).toHaveProperty('production');
  });

  it('uses Clerk secure caching and the dedicated mobile template with no dev-session path', () => {
    const app = source('apps/mobile/App.tsx');
    const api = source('apps/mobile/src/api.ts');
    const apiOrigin = source('apps/mobile/src/api-origin.ts');
    const screens = source('apps/mobile/src/screens.tsx');
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
    expect(app).toContain('completeMobileSignOut({');
    expect(app).toContain('secure sign out did not finish');
    expect(combined).not.toContain('/v1/dev/sessions/mobile');
    expect(combined).not.toContain('writeSessionToken');
    expect(combined).not.toContain('readSessionToken');
    expect(screens).not.toContain("mode: 'sign-up'");
  });

  it('keeps entitlement information without external payment steering', () => {
    const screens = source('apps/mobile/src/screens.tsx');

    expect(screens).toContain('Current access and plan');
    expect(screens).toContain('Household access is active');
    expect(screens).toContain('Your available features depend on the household you selected');
    expect(screens).toContain('Family access was recently started, renewed, canceled, or restored');
    expect(screens).toContain("'Refresh access'");
    expect(screens).toContain('This does\n                not start or change a purchase.');
    expect(screens).toContain("mobileRequest<MeResponse>('/v1/me')");
    expect(screens).toContain('replacePrincipal(me.principal, selectedHouseholdId)');
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
    expect(screens).toContain('Sharing saves this result in the other person&apos;s BoomerBuddy');
    expect(app).toContain('{__DEV__ ? (');
    expect(app).toContain('name="NativeProof"');
    expect(screens).toContain('Native intake proof');
  });

  it('keeps visual and accessibility selection state aligned for Check input', () => {
    const screens = source('apps/mobile/src/screens.tsx');

    expect(screens).toContain(
      '<View style={[s.radio, effectiveKind === item && s.radioSelected]} />',
    );
    expect(screens).not.toContain('<View style={[s.radio, kind === item && s.radioSelected]} />');
  });

  it('clears handled or rejected native entry signals without retaining payload state', () => {
    const app = source('apps/mobile/App.tsx');
    const screens = source('apps/mobile/src/screens.tsx');

    expect(app).toContain("onNativeEntryHandled={() => setNativeEntry('none')}");
    expect(screens).toContain('onNativeEntryHandled();');
    expect(screens.match(/title="Dismiss"/gu) ?? []).toHaveLength(2);
  });

  it('keeps experimental revenue offers out of the mobile customer surface', () => {
    const customerSurface = [
      source('apps/mobile/App.tsx'),
      source('apps/mobile/src/screens.tsx'),
      source('apps/mobile/src/policy-screens.tsx'),
    ].join('\n');

    for (const prohibited of [
      'USD 149',
      '$149',
      'USD 8.99',
      '$8.99',
      'USD 89',
      '$89',
      'annual Family',
      'Individual plan',
      'referral bonus',
      'group rate',
    ]) {
      expect(customerSurface).not.toContain(prohibited);
    }
  });
});
