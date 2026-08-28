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
      sourceLocale: 'en-US',
      supportedLocales: ['en-US'],
      localizationStatus: 'source_only_no_translations_approved',
      bundleIdentifier: 'net.boomerbuddy.app',
      androidPackage: 'net.boomerbuddy.app',
      marketingVersion: '0.1.0',
      subtitle: 'Family scam safety practice',
      categories: {
        status: 'draft_pending_current_console_review',
        policyReviewedAt: '2026-08-26',
        appleAppStore: {
          primary: 'Utilities',
          secondary: 'Lifestyle',
          status: 'draft_pending_console_review',
          policySource: 'https://developer.apple.com/app-store/categories/',
        },
        googlePlay: {
          category: 'Tools',
          status: 'draft_pending_console_review',
          policySource:
            'https://support.google.com/googleplay/android-developer/answer/9859673?hl=en',
        },
      },
      supportUrl: 'https://app.boomerbuddy.net/support',
      privacyPolicyUrl: 'https://app.boomerbuddy.net/privacy',
      termsOfUseUrl: 'https://app.boomerbuddy.net/terms',
      accountDeletionUrl: 'https://app.boomerbuddy.net/account-deletion',
      universalAndAppLinksStatus: 'blocked_pending_provider_signing_and_two_way_association',
      nativeCommerceStatus: 'web_first_no_native_purchase_or_payment_steering',
      audience: {
        providerAgeRatingStatus: 'pending_current_console_questionnaire_and_professional_review',
        childDirected: false,
        madeForChildren: false,
      },
      contentDeclarations: {
        status: 'draft_pending_current_provider_questionnaires_and_professional_review',
        privateUserSubmittedContent: true,
        publicUserGeneratedContent: false,
        advertising: false,
        crossAppTracking: false,
        nativePurchases: false,
        externalPaymentSteering: false,
      },
      privacyDeclarations: {
        status:
          'draft_requires_current_sdk_disclosures_provider_questionnaires_and_professional_review',
        appleAppPrivacyStatus: 'draft_not_submitted',
        googleDataSafetyStatus: 'draft_not_submitted',
        tracking: false,
        advertising: false,
        dataSale: false,
      },
      reviewerFlow: {
        status:
          'draft_pending_non_expiring_synthetic_account_preflight_signed_build_and_provider_secure_delivery',
        credentialsIncludedInRepository: false,
      },
      screenshots: {
        status: 'pending_exact_signed_artifact_device_capture_and_current_store_dimension_check',
      },
      releaseNotes: {
        sourceLocale: 'en-US',
        policyReviewedAt: '2026-08-26',
        appleAppStore: {
          initialVersionAction: 'omit_whats_new_field',
          status: 'draft_first_version_field_intentionally_absent',
        },
        googlePlay: {
          status: 'draft_pending_signed_build_verification',
          maximumCharacters: 500,
        },
      },
    });
    expect([...(metadata.appName as string)].length).toBeGreaterThanOrEqual(2);
    expect((metadata.keywords as string[]).every((keyword) => [...keyword].length > 2)).toBe(true);
    expect(
      Buffer.byteLength((metadata.keywords as string[]).join(','), 'utf8'),
    ).toBeLessThanOrEqual(100);
    expect((metadata.categories as { policyCaveat: string }).policyCaveat).toContain(
      'Recheck the current provider documentation and console',
    );
    const fullDescription = metadata.fullDescription as string;
    for (const implementedValue of [
      'seven short safety lessons',
      'dated source-linked guidance',
      'weekly rehearsal',
      'private 30-day history',
      'redacted result',
      'Trusted Circle',
      'Family Safe Word',
    ]) {
      expect(fullDescription).toContain(implementedValue);
    }
    const appleReleaseNotes = (metadata.releaseNotes as { appleAppStore: Record<string, unknown> })
      .appleAppStore;
    expect(appleReleaseNotes).not.toHaveProperty('text');
    expect(appleReleaseNotes).not.toHaveProperty('whatsNew');
    const googleReleaseNotes = (
      metadata.releaseNotes as { googlePlay: { text: string; maximumCharacters: number } }
    ).googlePlay;
    expect([...googleReleaseNotes.text].length).toBeLessThanOrEqual(
      googleReleaseNotes.maximumCharacters,
    );
    expect(serialized).not.toMatch(
      /appleTeamId|projectId|serviceAccount|signingSha|reviewerEmail|reviewerPassword/iu,
    );
  });

  it('maps repository-observed privacy, reviewer, and device evidence without claiming approval', () => {
    const metadata = json('apps/mobile/store-metadata.json');
    const privacy = metadata.privacyDeclarations as {
      dataItems: Array<{ category: string; linkedToAccount: boolean; usedForTracking: boolean }>;
      notObservedInProductCode: string[];
    };
    const reviewerFlow = metadata.reviewerFlow as {
      dataPolicy: string;
      accountRequirements: {
        accountType: string;
        nonExpiring: boolean;
        reusable: boolean;
        oneTimeCredentialOnly: boolean;
        oneTimeCredentialsForbidden: boolean;
        repositoryAuthBypassForbidden: boolean;
      };
      providerDelivery: {
        appleAppStoreReview: { channel: string; policySource: string };
        googlePlayReview: { channel: string; policySource: string };
      };
      accountPreflight: {
        requiredBeforeCredentialDelivery: boolean;
        requiredRole: string;
        isProtectedMember: boolean;
        isBillingManager: boolean;
        householdCount: number;
        householdStatus: string;
        requiredCapabilities: string[];
        canonicalAccessState: string;
        requiredAllowances: Array<{ kind: string; mustBePresent: boolean }>;
        allListedFlowsMustPass: boolean;
      };
      steps: Array<{ id: string; instruction: string; preflightRequired: boolean }>;
      prerequisites: string[];
    };
    const screenshots = metadata.screenshots as {
      matrix: Array<{
        id: string;
        platform: string;
        formFactor: string;
        required: boolean;
        status: string;
      }>;
      captureRules: string[];
    };

    expect(privacy.dataItems.map((item) => item.category)).toEqual([
      'account_and_authentication_identifiers',
      'email_address_for_sign_in_and_recovery',
      'profile_household_and_relationship_data',
      'user_submitted_check_content',
      'check_results_and_private_history',
      'support_receipt_state',
      'feedback_text_category_consent_and_receipt',
      'orientation_privacy_and_deletion_state',
      'learning_progress_coarse_region_and_in_app_feed',
      'subscription_access_status',
    ]);
    expect(privacy.dataItems.every((item) => item.linkedToAccount && !item.usedForTracking)).toBe(
      true,
    );
    expect(privacy.notObservedInProductCode).toEqual(
      expect.arrayContaining([
        'contacts_or_address_book',
        'precise_or_coarse_location',
        'payment_card_or_bank_data',
        'background_message_monitoring',
        'remote_push_tokens_or_provider_registration',
      ]),
    );
    expect(reviewerFlow.prerequisites).toHaveLength(4);
    expect(reviewerFlow.steps).toHaveLength(10);
    expect(reviewerFlow.dataPolicy).toContain('synthetic');
    expect(reviewerFlow.dataPolicy).toContain('Do not use customer PII.');
    expect(reviewerFlow.accountRequirements).toMatchObject({
      accountType: 'founder_controlled_synthetic_review_account',
      nonExpiring: true,
      reusable: true,
      oneTimeCredentialOnly: false,
      oneTimeCredentialsForbidden: true,
      repositoryAuthBypassForbidden: true,
    });
    expect(reviewerFlow.providerDelivery).toEqual({
      appleAppStoreReview: {
        channel: 'app_store_connect_app_review_sign_in_fields_and_notes',
        samePreflightedAccountRequired: true,
        policySource:
          'https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information',
      },
      googlePlayReview: {
        channel: 'play_console_sign_in_details',
        samePreflightedAccountRequired: true,
        policySource:
          'https://support.google.com/googleplay/android-developer/answer/15748846?hl=en',
      },
    });
    expect(reviewerFlow.accountPreflight).toMatchObject({
      requiredBeforeCredentialDelivery: true,
      requiredRole: 'protected_adult',
      isProtectedMember: true,
      isBillingManager: true,
      householdCount: 1,
      householdStatus: 'active',
      requiredCapabilities: [
        'check:text',
        'check:url',
        'history:read',
        'family:manage',
        'orientation:use',
      ],
      canonicalAccessState: 'effective',
      requiredAllowances: [
        expect.objectContaining({ kind: 'protected_members', mustBePresent: true }),
        expect.objectContaining({ kind: 'trusted_circle_participants', mustBePresent: true }),
      ],
      allListedFlowsMustPass: true,
    });
    expect(reviewerFlow.steps.map((step) => step.id)).toEqual([
      'hosted_customer_sign_in_and_native_return',
      'protected_adult_household_and_access',
      'manual_check_and_result',
      'private_household_history',
      'family_and_orientation',
      'learning_guidance_and_weekly_practice',
      'support_legal_accessibility_and_deletion',
      'text_feedback_and_consent_withdrawal',
      'session_restart_and_sign_out',
      'no_native_commerce_or_payment_steering',
    ]);
    expect(
      reviewerFlow.steps.every((step) => step.preflightRequired && step.instruction.length >= 40),
    ).toBe(true);
    expect(screenshots.matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ios_phone_primary',
          platform: 'ios',
          formFactor: 'phone',
          required: true,
          status: 'pending_signed_device_capture',
        }),
        expect.objectContaining({
          id: 'ios_tablet_primary',
          platform: 'ios',
          formFactor: 'tablet',
          required: true,
          status: 'pending_signed_device_capture',
        }),
        expect.objectContaining({
          id: 'android_phone_primary',
          platform: 'android',
          formFactor: 'phone',
          required: true,
          status: 'pending_signed_device_capture',
        }),
      ]),
    );
    expect(screenshots.captureRules.join(' ')).toContain('exact signed production candidate');
  });

  it('classifies every approved runtime mobile dependency and fails closed on additions', () => {
    const metadata = json('apps/mobile/store-metadata.json');
    const mobilePackage = json('apps/mobile/package.json');
    const dependencyPrivacy = metadata.runtimeDependencyPrivacyClassification as {
      status: string;
      source: string;
      unclassifiedDependencyPolicy: string;
      currentSdkDisclosureReconciliationRequired: boolean;
      signedArtifactReconciliationRequired: boolean;
      classifications: Record<string, string>;
    };

    expect(dependencyPrivacy).toMatchObject({
      status:
        'approved_repository_allowlist_requires_current_sdk_and_signed_artifact_reconciliation',
      source: 'apps/mobile/package.json#dependencies',
      unclassifiedDependencyPolicy: 'fail_distribution_verification',
      currentSdkDisclosureReconciliationRequired: true,
      signedArtifactReconciliationRequired: true,
    });
    expect(Object.keys(dependencyPrivacy.classifications).sort()).toEqual(
      Object.keys(mobilePackage.dependencies as Record<string, string>).sort(),
    );
    expect(dependencyPrivacy.classifications).toEqual({
      '@boomerbuddy/contracts': 'first_party_contracts_no_runtime_collection',
      '@boomerbuddy/design': 'first_party_static_design_no_runtime_collection',
      '@boomerbuddy/security': 'first_party_session_security_no_runtime_collection',
      '@clerk/expo': 'hosted_identity_and_session_sdk',
      '@react-navigation/native': 'navigation_ui_runtime',
      '@react-navigation/native-stack': 'navigation_ui_runtime',
      expo: 'application_runtime_framework',
      'expo-auth-session': 'hosted_auth_session_bridge',
      'expo-constants': 'runtime_configuration_reader',
      'expo-crypto': 'local_cryptography_utility',
      'expo-notifications': 'on_device_local_notification_scheduler_no_remote_tokens',
      'expo-secure-store': 'secure_local_storage',
      'expo-splash-screen': 'static_startup_ui',
      'expo-status-bar': 'static_status_ui',
      'expo-web-browser': 'system_browser_auth_bridge',
      react: 'ui_runtime_framework',
      'react-dom': 'web_preview_ui_runtime',
      'react-native': 'native_ui_and_network_runtime',
      'react-native-safe-area-context': 'native_layout_runtime',
      'react-native-screens': 'native_navigation_runtime',
      'react-native-web': 'web_preview_native_compatibility',
    });
  });

  it('fails closed around the optional local-only weekly reminder', () => {
    const metadata = json('apps/mobile/store-metadata.json');
    const app = json('apps/mobile/app.json') as {
      expo: { plugins: Array<string | [string, Record<string, unknown>]> };
    };
    const permissions = metadata.permissions as Record<string, unknown>;
    const verifier = readFileSync(
      resolve(repositoryRoot, 'scripts/verify-mobile-distribution.mjs'),
      'utf8',
    );
    const reminder = readFileSync(
      resolve(repositoryRoot, 'apps/mobile/src/weekly-rehearsal-reminder.ts'),
      'utf8',
    );

    expect(app.expo.plugins).toContainEqual([
      'expo-notifications',
      { color: '#255B57', enableBackgroundRemoteNotifications: false },
    ]);
    expect(permissions).toEqual({
      expectedActiveAndroidPermissions: [
        'android.permission.INTERNET',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.RECEIVE_BOOT_COMPLETED',
      ],
      notificationPermissionPromptExpected: true,
      notificationPromptReason: 'optional_on_device_weekly_rehearsal_reminder',
      otherSensitivePermissionPromptsExpected: false,
      remoteNotificationRegistrationExpected: false,
    });
    expect(reminder).toContain('setAutoServerRegistrationEnabledAsync(false)');
    expect(reminder).toContain('data: { kind: weeklyRehearsalReminderMarker }');
    expect(reminder).toContain('.filter(isWeeklyRehearsalReminder)');
    expect(reminder).not.toContain('getExpoPushTokenAsync');
    expect(reminder).not.toContain('getDevicePushTokenAsync');
    expect(verifier).toContain('weekly rehearsal notification must remain generic');
    expect(verifier).toContain('weekly rehearsal notification must cancel on sign-out');
    expect(verifier).toContain('device proof explicitly pending');
    expect(verifier).toContain('pinned notification SDK Android manifest permissions');
    expect(verifier).toContain(
      'declared Android permissions across the app and pinned notification SDK manifests',
    );
  });

  it('allows only explicit blank or validated receipt-code support email drafts', () => {
    const verifier = readFileSync(
      resolve(repositoryRoot, 'scripts/verify-mobile-distribution.mjs'),
      'utf8',
    );
    const supportScreen = readFileSync(
      resolve(repositoryRoot, 'apps/mobile/src/support-screen.tsx'),
      'utf8',
    );

    expect(verifier).toContain("'mailto:${supportEmail}'");
    expect(verifier).toContain(
      "'mailto:${supportEmail}?subject=${encodeURIComponent(validatedReceiptCode)}'",
    );
    expect(verifier).toContain('supportReceiptCodeSchema.parse(receiptCode)');
    expect(verifier).toContain(
      '(combinedProductionSource.match(/\\?subject=/gu) ?? []).length === 1',
    );
    expect(verifier).toContain('/[?&](?:body|cc|bcc)=/iu.test(combinedProductionSource)');
    expect(verifier).toContain(
      '(supportScreenSource.match(/openSupportEmail\\(/gu) ?? []).length === 3',
    );
    expect(verifier).toContain('Linking.openURL(supportReceiptEmailDraftUrl(receiptCode))');
    const automaticSendFailure =
      'mobile support must not send or share outbound content automatically';
    expect(verifier).toContain(automaticSendFailure);
    const automaticSendGuardEnd = verifier.indexOf(automaticSendFailure);
    const automaticSendGuardStart = verifier.lastIndexOf('assertRelease(', automaticSendGuardEnd);
    expect(automaticSendGuardStart).toBeGreaterThanOrEqual(0);
    const automaticSendGuard = verifier.slice(automaticSendGuardStart, automaticSendGuardEnd);
    expect(automaticSendGuard).toContain('supportScreenSource');
    expect(automaticSendGuard).not.toContain('combinedProductionSource');
    expect(supportScreen).toContain('onPress={() => void openSupportEmail(emailReceiptCode)}');
    expect(supportScreen).not.toMatch(/[?&](?:body|cc|bcc)=/iu);
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
      nativeAuthCallbacks: {
        iosSchemes: ['boomerbuddy', 'net.boomerbuddy.app'],
        androidHostedCallbackUri: 'clerk://net.boomerbuddy.app.hosted-callback',
      },
      assetSha256: {
        'icon.png': expect.stringMatching(/^[a-f0-9]{64}$/u),
        'adaptive-icon.png': expect.stringMatching(/^[a-f0-9]{64}$/u),
        'splash-icon.png': expect.stringMatching(/^[a-f0-9]{64}$/u),
        'favicon.png': expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
  }, 30_000);
});
