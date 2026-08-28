import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import sharp from 'sharp';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const mobileRoot = join(repositoryRoot, 'apps/mobile');
const exactApplicationId = 'net.boomerbuddy.app';
const exactApiOrigin = 'https://api.boomerbuddy.net';
const exactCustomerOrigin = 'https://app.boomerbuddy.net';
const excludedInputDirectories = new Set(['.expo', 'dist', 'node_modules']);

function assertRelease(condition, message) {
  if (!condition) throw new Error(`Mobile distribution verification failed: ${message}`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function assertAscii(value, path = 'metadata') {
  if (typeof value === 'string') {
    assertRelease(/^[\x20-\x7e]*$/u.test(value), `${path} must contain printable ASCII only`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertAscii(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      assertAscii(key, `${path} key`);
      assertAscii(entry, `${path}.${key}`);
    }
  }
}

function assertExactPublicUrl(value, pathname, label) {
  assertRelease(
    value === `${exactCustomerOrigin}${pathname}`,
    `${label} must use the canonical URL`,
  );
  const url = new URL(value);
  assertRelease(
    url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '',
    `${label} must be a credential-free HTTPS URL without query or fragment`,
  );
}

function assertBoundedText(value, minimum, maximum, label) {
  assertRelease(typeof value === 'string', `${label} must be text`);
  assertRelease(
    value.length >= minimum && value.length <= maximum,
    `${label} must be between ${minimum} and ${maximum} characters`,
  );
}

function assertExactStringSet(value, expected, label) {
  assertRelease(Array.isArray(value), `${label} must be an array`);
  assertRelease(
    JSON.stringify([...value].sort()) === JSON.stringify([...expected].sort()),
    `${label} must match the reviewed set`,
  );
}

async function listFiles(directory, predicate = () => true) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedInputDirectories.has(entry.name) && !entry.name.startsWith('dist-')) {
        files.push(...(await listFiles(path, predicate)));
      }
    } else if (predicate(path)) {
      files.push(path);
    }
  }
  return files;
}

async function buildInputFingerprint(paths) {
  const files = [];
  for (const path of paths) {
    const metadata = await stat(path);
    if (metadata.isDirectory()) files.push(...(await listFiles(path)));
    else files.push(path);
  }
  const hash = createHash('sha256');
  for (const path of [...new Set(files)].sort()) {
    const contents = await readFile(path);
    hash.update(relative(repositoryRoot, path).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(String(contents.length));
    hash.update('\0');
    hash.update(contents);
    hash.update('\0');
  }
  return hash.digest('hex');
}

const app = await readJson(join(mobileRoot, 'app.json'));
const eas = await readJson(join(mobileRoot, 'eas.json'));
const mobilePackage = await readJson(join(mobileRoot, 'package.json'));
const metadata = await readJson(join(mobileRoot, 'store-metadata.json'));
const notificationsAndroidManifestPath = join(
  repositoryRoot,
  'node_modules/expo-notifications/android/src/main/AndroidManifest.xml',
);
const notificationsAndroidManifestSource = await readFile(notificationsAndroidManifestPath, 'utf8');
const appConfig = app.expo;
const notificationPluginEntries = (appConfig.plugins ?? []).filter(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-notifications',
);

assertAscii(metadata);
assertRelease(metadata.schemaVersion === 1, 'store metadata schemaVersion must be 1');
assertRelease(metadata.appName === appConfig.name, 'store app name must match Expo config');
assertRelease(
  notificationPluginEntries.length === 1 &&
    JSON.stringify(notificationPluginEntries[0][1]) ===
      JSON.stringify({ color: '#255B57', enableBackgroundRemoteNotifications: false }),
  'expo-notifications must keep the reviewed local-only config with remote background mode disabled',
);
assertRelease(
  mobilePackage.dependencies?.['expo-notifications'] === '~57.0.14',
  'expo-notifications must remain on the reviewed Expo SDK 57-compatible range',
);
assertRelease(
  metadata.bundleIdentifier === exactApplicationId &&
    metadata.androidPackage === exactApplicationId &&
    appConfig.ios?.bundleIdentifier === exactApplicationId &&
    appConfig.android?.package === exactApplicationId,
  `iOS and Android application identity must be ${exactApplicationId}`,
);
assertRelease(
  typeof appConfig.version === 'string' && /^\d+\.\d+\.\d+$/u.test(appConfig.version),
  'Expo marketing version must use three numeric components',
);
assertRelease(
  metadata.marketingVersion === appConfig.version,
  'store marketing version must match Expo config',
);
assertRelease(metadata.sourceLocale === 'en-US', 'store source locale must remain en-US');
assertExactStringSet(metadata.supportedLocales, ['en-US'], 'approved store locales');
assertRelease(
  metadata.localizationStatus === 'source_only_no_translations_approved',
  'unreviewed translations must not be represented as approved',
);
assertBoundedText(metadata.appName, 2, 30, 'store app name');
assertBoundedText(metadata.subtitle, 1, 30, 'store subtitle');
assertBoundedText(metadata.promotionalText, 1, 170, 'store promotional text');
assertBoundedText(metadata.shortDescription, 1, 80, 'store short description');
assertBoundedText(metadata.fullDescription, 200, 4_000, 'store full description');
assertRelease(
  Array.isArray(metadata.keywords) &&
    metadata.keywords.length >= 3 &&
    metadata.keywords.every(
      (keyword) => typeof keyword === 'string' && keyword.length > 2 && keyword.length <= 30,
    ) &&
    Buffer.byteLength(metadata.keywords.join(','), 'utf8') <= 100,
  'store keywords must remain a bounded reviewed list',
);
assertRelease(
  metadata.categories?.status === 'draft_pending_current_console_review' &&
    metadata.categories.policyReviewedAt === '2026-08-26' &&
    metadata.categories.policyCaveat ===
      'Provider categories, tags, and console choices can change. Recheck the current provider documentation and console before approval or submission.' &&
    metadata.categories.appleAppStore?.primary === 'Utilities' &&
    metadata.categories.appleAppStore?.secondary === 'Lifestyle' &&
    metadata.categories.appleAppStore?.status === 'draft_pending_console_review' &&
    metadata.categories.appleAppStore?.policySource ===
      'https://developer.apple.com/app-store/categories/' &&
    metadata.categories.googlePlay?.category === 'Tools' &&
    metadata.categories.googlePlay?.status === 'draft_pending_console_review' &&
    metadata.categories.googlePlay?.policySource ===
      'https://support.google.com/googleplay/android-developer/answer/9859673?hl=en',
  'Apple and Google store categories must remain separate current-policy drafts',
);
assertRelease(
  metadata.audience?.providerAgeRatingStatus ===
    'pending_current_console_questionnaire_and_professional_review' &&
    metadata.audience?.childDirected === false &&
    metadata.audience?.madeForChildren === false,
  'age and audience declarations must remain pending and non-child-directed',
);
const approvedListingCopy = [
  metadata.subtitle,
  metadata.promotionalText,
  metadata.shortDescription,
  metadata.fullDescription,
  metadata.releaseNotes?.googlePlay?.text,
].join('\n');
for (const truthfulBoundary of [
  'BoomerBuddy reviews only what you submit.',
  'It does not open websites, monitor messages, guarantee safety',
  'Access is invitation-only during early release.',
]) {
  assertRelease(
    metadata.fullDescription.includes(truthfulBoundary),
    `store description must retain truthful boundary: ${truthfulBoundary}`,
  );
}
for (const implementedValue of [
  'seven short safety lessons',
  'dated source-linked guidance',
  'weekly rehearsal',
  'private 30-day history',
  'redacted result',
  'Trusted Circle',
  'Family Safe Word',
]) {
  assertRelease(
    metadata.fullDescription.includes(implementedValue),
    `store description must explain implemented value: ${implementedValue}`,
  );
}
const listingCopyForClaimScan = approvedListingCopy.replaceAll(
  'It does not open websites, monitor messages, guarantee safety',
  '',
);
assertRelease(
  !/(?:prevents? scams|guaranteed safe|monitors? (?:your )?(?:texts|messages)|24[/-]?7 support|real-time protection|bank-grade)/iu.test(
    listingCopyForClaimScan,
  ),
  'store listing copy must not make an unproved safety, monitoring, or support claim',
);
assertRelease(appConfig.scheme === 'boomerbuddy', 'custom scheme must remain boomerbuddy');
assertRelease(
  metadata.customSchemeCheckUrl === 'boomerbuddy://check',
  'metadata must retain the route-only custom Check URL',
);

assertExactPublicUrl(metadata.supportUrl, '/support', 'support URL');
assertExactPublicUrl(metadata.privacyPolicyUrl, '/privacy', 'privacy policy URL');
assertExactPublicUrl(metadata.termsOfUseUrl, '/terms', 'terms URL');
assertExactPublicUrl(metadata.accountDeletionUrl, '/account-deletion', 'account-deletion URL');
assertRelease(
  metadata.supportEmail === 'support@boomerbuddy.net',
  'support email must be canonical',
);
for (const route of ['support', 'privacy', 'terms', 'account-deletion']) {
  const page = await stat(join(repositoryRoot, 'apps/web/src/app', route, 'page.tsx'));
  assertRelease(page.isFile(), `public ${route} route must exist in the source repository`);
}

assertRelease(
  metadata.universalAndAppLinksStatus ===
    'blocked_pending_provider_signing_and_two_way_association',
  'universal/app-link status must remain explicitly blocked',
);
assertRelease(
  !Object.hasOwn(appConfig.ios ?? {}, 'associatedDomains') &&
    !Object.hasOwn(appConfig.android ?? {}, 'intentFilters'),
  'partial universal/app-link associations are forbidden before provider closure',
);

assertRelease(
  metadata.contentDeclarations?.status ===
    'draft_pending_current_provider_questionnaires_and_professional_review',
  'content declarations must remain explicitly unapproved drafts',
);
for (const field of [
  'publicUserGeneratedContent',
  'publicCommunicationOrChat',
  'advertising',
  'crossAppTracking',
  'gamblingOrContests',
  'sexualContent',
  'graphicViolence',
  'profanityInPublisherContent',
  'controlledSubstancesInPublisherContent',
  'locationSharing',
  'nativePurchases',
  'externalPaymentSteering',
]) {
  assertRelease(
    metadata.contentDeclarations?.[field] === false,
    `content declaration ${field} must remain false`,
  );
}
assertRelease(
  metadata.contentDeclarations?.privateUserSubmittedContent === true &&
    metadata.contentDeclarations?.safetyLimitation ===
      'Decision support can be wrong and is not monitoring, an emergency service, or professional advice.',
  'private submitted content and the safety limitation must be declared truthfully',
);

const privacy = metadata.privacyDeclarations;
assertRelease(
  privacy?.status ===
    'draft_requires_current_sdk_disclosures_provider_questionnaires_and_professional_review' &&
    privacy.appleAppPrivacyStatus === 'draft_not_submitted' &&
    privacy.googleDataSafetyStatus === 'draft_not_submitted' &&
    privacy.nativePrivacyManifestStatus ===
      'pending_signed_artifact_and_current_sdk_manifest_review',
  'privacy declarations must remain drafts pending signed-SDK and professional review',
);
assertRelease(
  privacy.tracking === false && privacy.advertising === false && privacy.dataSale === false,
  'tracking, advertising, and data sale must remain absent',
);
const requiredPrivacyCategories = [
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
];
assertExactStringSet(
  privacy.dataItems?.map((item) => item.category),
  requiredPrivacyCategories,
  'repository-observed privacy categories',
);
const approvedPrivacyPurposes = new Set([
  'app_functionality',
  'account_management',
  'security_and_fraud_prevention',
  'customer_support',
  'analytics',
]);
for (const item of privacy.dataItems) {
  assertRelease(
    typeof item.examples === 'string' && item.examples.length >= 10,
    `privacy category ${item.category} must explain its actual data`,
  );
  assertRelease(
    Array.isArray(item.purposes) &&
      item.purposes.length > 0 &&
      item.purposes.every((purpose) => approvedPrivacyPurposes.has(purpose)),
    `privacy category ${item.category} must use reviewed purposes`,
  );
  assertRelease(
    item.linkedToAccount === true && item.usedForTracking === false,
    `privacy category ${item.category} must remain account-linked and non-tracking`,
  );
}
assertExactStringSet(
  privacy.notObservedInProductCode,
  [
    'advertising_identifiers',
    'cross_app_tracking',
    'contacts_or_address_book',
    'precise_or_coarse_location',
    'camera_photos_video_or_audio',
    'health_or_fitness_data',
    'payment_card_or_bank_data',
    'clipboard_reads',
    'background_message_monitoring',
    'remote_push_tokens_or_provider_registration',
    'third_party_analytics_or_advertising_sdk_events',
  ],
  'data classes not observed in product code',
);
assertRelease(
  Array.isArray(privacy.sdkDueDiligence) &&
    privacy.sdkDueDiligence.length === 2 &&
    privacy.sdkDueDiligence.join(' ').includes('signed artifacts'),
  'privacy metadata must preserve current SDK and signed-artifact due diligence',
);

assertExactStringSet(
  metadata.permissions?.expectedActiveAndroidPermissions,
  [
    'android.permission.INTERNET',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.RECEIVE_BOOT_COMPLETED',
  ],
  'expected Android permissions',
);
assertRelease(
  metadata.permissions?.notificationPermissionPromptExpected === true &&
    metadata.permissions?.notificationPromptReason ===
      'optional_on_device_weekly_rehearsal_reminder' &&
    metadata.permissions?.otherSensitivePermissionPromptsExpected === false &&
    metadata.permissions?.remoteNotificationRegistrationExpected === false &&
    metadata.permissions?.sensitivePermissionPromptsExpected === undefined &&
    metadata.permissions?.contactsCameraMicrophonePhotosLocationNotificationsTrackingExpected ===
      undefined,
  'store permission declaration must isolate the optional local-notification prompt',
);

const expectedRuntimeDependencyPrivacyClassifications = {
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
};
const dependencyPrivacy = metadata.runtimeDependencyPrivacyClassification;
assertRelease(
  dependencyPrivacy?.status ===
    'approved_repository_allowlist_requires_current_sdk_and_signed_artifact_reconciliation' &&
    dependencyPrivacy.source === 'apps/mobile/package.json#dependencies' &&
    dependencyPrivacy.unclassifiedDependencyPolicy === 'fail_distribution_verification' &&
    dependencyPrivacy.currentSdkDisclosureReconciliationRequired === true &&
    dependencyPrivacy.signedArtifactReconciliationRequired === true,
  'runtime dependency privacy classification must preserve fail-closed SDK reconciliation',
);
assertExactStringSet(
  Object.keys(mobilePackage.dependencies ?? {}),
  Object.keys(expectedRuntimeDependencyPrivacyClassifications),
  'approved runtime mobile dependencies',
);
assertExactStringSet(
  Object.keys(dependencyPrivacy.classifications ?? {}),
  Object.keys(expectedRuntimeDependencyPrivacyClassifications),
  'classified runtime mobile dependencies',
);
for (const [dependencyName, classification] of Object.entries(
  expectedRuntimeDependencyPrivacyClassifications,
)) {
  assertRelease(
    dependencyPrivacy.classifications[dependencyName] === classification,
    `runtime dependency ${dependencyName} must retain its reviewed privacy classification`,
  );
}

const reviewerFlow = metadata.reviewerFlow;
assertRelease(
  reviewerFlow?.status ===
    'draft_pending_non_expiring_synthetic_account_preflight_signed_build_and_provider_secure_delivery' &&
    reviewerFlow.credentialsIncludedInRepository === false,
  'reviewer access must remain pending and provider-secure with no repository credentials',
);
assertRelease(
  Array.isArray(reviewerFlow.prerequisites) &&
    reviewerFlow.prerequisites.length === 4 &&
    Array.isArray(reviewerFlow.steps) &&
    reviewerFlow.steps.length === 10 &&
    Array.isArray(reviewerFlow.knownUnavailableFeatures) &&
    reviewerFlow.knownUnavailableFeatures.length === 3,
  'reviewer flow must retain complete bounded instructions and unavailable-feature disclosure',
);
assertRelease(
  reviewerFlow.accountRequirements?.accountType === 'founder_controlled_synthetic_review_account' &&
    reviewerFlow.accountRequirements.nonExpiring === true &&
    reviewerFlow.accountRequirements.reusable === true &&
    reviewerFlow.accountRequirements.validRegardlessOfReviewerLocation === true &&
    reviewerFlow.accountRequirements.oneTimeCredentialOnly === false &&
    reviewerFlow.accountRequirements.oneTimeCredentialsForbidden === true &&
    reviewerFlow.accountRequirements.customerRealmOnly === true &&
    reviewerFlow.accountRequirements.repositoryAuthBypassForbidden === true &&
    reviewerFlow.accountRequirements.providerAndSecurityReviewRequiredForReusableMfaPath === true,
  'review access must use a reusable non-expiring synthetic customer account without a repository auth bypass',
);
assertRelease(
  reviewerFlow.providerDelivery?.appleAppStoreReview?.channel ===
    'app_store_connect_app_review_sign_in_fields_and_notes' &&
    reviewerFlow.providerDelivery.appleAppStoreReview.samePreflightedAccountRequired === true &&
    reviewerFlow.providerDelivery.appleAppStoreReview.policySource ===
      'https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information' &&
    reviewerFlow.providerDelivery?.googlePlayReview?.channel === 'play_console_sign_in_details' &&
    reviewerFlow.providerDelivery.googlePlayReview.samePreflightedAccountRequired === true &&
    reviewerFlow.providerDelivery.googlePlayReview.policySource ===
      'https://support.google.com/googleplay/android-developer/answer/15748846?hl=en',
  'Apple and Google review-account delivery must use their separate secure provider fields',
);
assertExactStringSet(
  reviewerFlow.accountPreflight?.requiredCapabilities,
  ['check:text', 'check:url', 'history:read', 'family:manage', 'orientation:use'],
  'review-account required capabilities',
);
assertRelease(
  reviewerFlow.accountPreflight?.status ===
    'pending_noncharging_provider_setup_live_api_and_exact_signed_candidate' &&
    reviewerFlow.accountPreflight.requiredBeforeCredentialDelivery === true &&
    reviewerFlow.accountPreflight.requiredRole === 'protected_adult' &&
    reviewerFlow.accountPreflight.isProtectedMember === true &&
    reviewerFlow.accountPreflight.isBillingManager === true &&
    reviewerFlow.accountPreflight.householdCount === 1 &&
    reviewerFlow.accountPreflight.householdStatus === 'active' &&
    reviewerFlow.accountPreflight.canonicalAccessState === 'effective' &&
    reviewerFlow.accountPreflight.allListedFlowsMustPass === true,
  'review-account preflight must prove protected-adult household scope and effective canonical access',
);
assertRelease(
  JSON.stringify(reviewerFlow.accountPreflight.requiredAllowances) ===
    JSON.stringify([
      {
        kind: 'protected_members',
        mustBePresent: true,
        limitAtLeast: 1,
        usedAtLeast: 1,
      },
      {
        kind: 'trusted_circle_participants',
        mustBePresent: true,
        limitAtLeast: 1,
        remainingAtLeast: 1,
      },
    ]),
  'review-account preflight must prove both canonical allowance counters',
);
assertExactStringSet(
  reviewerFlow.steps?.map((step) => step.id),
  [
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
  ],
  'review-account flow preflights',
);
assertRelease(
  reviewerFlow.steps.every(
    (step) =>
      step.preflightRequired === true &&
      typeof step.instruction === 'string' &&
      step.instruction.length >= 40,
  ),
  'every reviewer flow must require preflight and retain complete instructions',
);
const reviewerText = JSON.stringify(reviewerFlow);
assertRelease(
  reviewerText.includes('synthetic') &&
    reviewerText.includes('Do not use customer PII.') &&
    reviewerText.includes(
      'no checkout, pricing, billing link, native purchase, or payment steering',
    ),
  'reviewer flow must require synthetic data and preserve the no-commerce boundary',
);
assertRelease(
  !/(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._~-]+|password\s*[:=]|one[- ]time code\s*[:=]/u.test(
    reviewerText,
  ),
  'reviewer instructions must not contain a credential or token value',
);

const screenshots = metadata.screenshots;
assertRelease(
  screenshots?.status ===
    'pending_exact_signed_artifact_device_capture_and_current_store_dimension_check',
  'screenshots must remain explicitly pending signed-device capture',
);
assertExactStringSet(
  screenshots.matrix?.map((entry) => entry.id),
  [
    'ios_phone_primary',
    'ios_tablet_primary',
    'android_phone_primary',
    'android_tablet_layout_check',
  ],
  'screenshot device matrix',
);
for (const entry of screenshots.matrix) {
  assertRelease(
    ['ios', 'android'].includes(entry.platform) &&
      ['phone', 'tablet'].includes(entry.formFactor) &&
      Array.isArray(entry.screens) &&
      entry.screens.length >= 2 &&
      entry.status.startsWith('pending_'),
    `screenshot matrix entry ${entry.id} must remain a pending bounded specification`,
  );
}
assertRelease(
  screenshots.matrix.find((entry) => entry.id === 'ios_phone_primary')?.required === true &&
    screenshots.matrix.find((entry) => entry.id === 'ios_tablet_primary')?.required === true &&
    screenshots.matrix.find((entry) => entry.id === 'android_phone_primary')?.required === true &&
    screenshots.matrix.find((entry) => entry.id === 'android_tablet_layout_check')?.required ===
      false,
  'phone and supported iPad captures must be required without overstating Android tablet scope',
);
assertRelease(
  Array.isArray(screenshots.captureRules) &&
    screenshots.captureRules.length === 5 &&
    screenshots.captureRules.join(' ').includes('exact signed production candidate') &&
    screenshots.captureRules.join(' ').includes('no customer PII') &&
    screenshots.androidFeatureGraphic?.status ===
      'pending_current_console_spec_and_approved_artwork',
  'capture rules and Android feature graphic must remain pending and evidence-bound',
);
assertRelease(
  metadata.releaseNotes?.sourceLocale === 'en-US' &&
    metadata.releaseNotes.policyReviewedAt === '2026-08-26' &&
    metadata.releaseNotes.policyCaveat ===
      'Recheck the current provider documentation and console before every release.' &&
    metadata.releaseNotes.status === 'draft_pending_signed_build_verification' &&
    metadata.releaseNotes.appleAppStore?.initialVersionAction === 'omit_whats_new_field' &&
    metadata.releaseNotes.appleAppStore?.status ===
      'draft_first_version_field_intentionally_absent' &&
    metadata.releaseNotes.appleAppStore?.policySource ===
      'https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information' &&
    !Object.hasOwn(metadata.releaseNotes.appleAppStore, 'text') &&
    !Object.hasOwn(metadata.releaseNotes.appleAppStore, 'whatsNew') &&
    metadata.releaseNotes.googlePlay?.status === 'draft_pending_signed_build_verification' &&
    metadata.releaseNotes.googlePlay?.maximumCharacters === 500 &&
    metadata.releaseNotes.googlePlay?.policySource ===
      'https://support.google.com/googleplay/android-developer/answer/9859348?hl=en' &&
    typeof metadata.releaseNotes.googlePlay?.text === 'string' &&
    metadata.releaseNotes.googlePlay.text.length > 0 &&
    [...metadata.releaseNotes.googlePlay.text].length <= 500,
  'provider-split release notes must omit Apple first-version text and bound Google text to 500 characters',
);
const serializedStoreMetadata = JSON.stringify(metadata);
assertRelease(
  !/(?:appleTeamId|projectId|serviceAccount|signingSha|reviewerEmail|reviewerUsername|reviewerPassword)/iu.test(
    serializedStoreMetadata,
  ),
  'store metadata must not contain guessed provider identifiers or reviewer credential fields',
);

assertRelease(
  appConfig.android?.allowBackup === false,
  'Android application backup must be disabled',
);
assertRelease(
  appConfig.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads === false,
  'iOS arbitrary network loads must remain disabled',
);
assertRelease(
  appConfig.ios?.infoPlist?.ITSAppUsesNonExemptEncryption === false,
  'export-compliance encryption declaration must remain explicit',
);

assertRelease(eas.cli?.version === '22.4.0', 'EAS CLI must remain exactly pinned');
assertRelease(eas.cli?.requireCommit === true, 'EAS builds must require a Git commit');
assertRelease(
  eas.cli?.appVersionSource === 'remote',
  'developer-facing build versions must remain explicitly remote-managed',
);
assertRelease(
  !Object.hasOwn(appConfig.ios ?? {}, 'buildNumber') &&
    !Object.hasOwn(appConfig.android ?? {}, 'versionCode'),
  'ignored local build numbers must not be presented as signed-build truth',
);
assertRelease(
  eas.build?.production?.autoIncrement === true,
  'production developer-facing build versions must auto-increment remotely',
);
for (const profile of ['preview', 'production']) {
  assertRelease(
    eas.build?.[profile]?.env?.EXPO_PUBLIC_API_URL === exactApiOrigin,
    `${profile} must pin the exact production mobile API origin`,
  );
  assertRelease(
    /^\d+\.\d+\.\d+$/u.test(eas.build?.[profile]?.node ?? ''),
    `${profile} Node must be pinned`,
  );
  assertRelease(
    typeof eas.build?.[profile]?.android?.image === 'string' &&
      !/latest|auto/u.test(eas.build[profile].android.image),
    `${profile} Android builder image must be pinned`,
  );
  assertRelease(
    typeof eas.build?.[profile]?.ios?.image === 'string' &&
      !/latest|auto/u.test(eas.build[profile].ios.image),
    `${profile} iOS builder image must be pinned`,
  );
}
assertRelease(
  !Object.hasOwn(eas.build.preview.env, 'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY') &&
    !Object.hasOwn(eas.build.production.env, 'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY'),
  'provider-specific Clerk publishable keys must not be committed in EAS profiles',
);
assertRelease(appConfig.owner === undefined, 'Expo account owner must not be guessed');
assertRelease(appConfig.extra?.eas?.projectId === undefined, 'EAS project ID must not be guessed');
assertRelease(
  Object.keys(eas.submit?.production ?? {}).length === 0,
  'store submission identifiers must remain provider-controlled',
);

const apiOriginSource = await readFile(join(mobileRoot, 'src/api-origin.ts'), 'utf8');
assertRelease(
  apiOriginSource.includes(`productionMobileApiOrigin = '${exactApiOrigin}'`),
  'mobile runtime must pin the exact production API origin',
);
const appSource = await readFile(join(mobileRoot, 'App.tsx'), 'utf8');
const supportScreenSource = await readFile(join(mobileRoot, 'src/support-screen.tsx'), 'utf8');
const householdSource = await readFile(join(mobileRoot, 'src/household.tsx'), 'utf8');
const memberLearningScreenSource = await readFile(
  join(mobileRoot, 'src/member-learning-screen.tsx'),
  'utf8',
);
const officialSourceBoundary = await readFile(join(mobileRoot, 'src/official-source.ts'), 'utf8');
const weeklyReminderSource = await readFile(
  join(mobileRoot, 'src/weekly-rehearsal-reminder.ts'),
  'utf8',
);
assertRelease(
  appSource.includes("value.startsWith('pk_live_')"),
  'production authentication must reject non-live Clerk publishable keys',
);

const forbiddenMobileDependencies =
  /(?:^|[@/_-])(stripe|iap|billing|purchases|revenuecat)(?:$|[/_-])/iu;
for (const dependencyName of Object.keys(mobilePackage.dependencies ?? {})) {
  assertRelease(
    !forbiddenMobileDependencies.test(dependencyName),
    `native commerce dependency ${dependencyName} is not allowed`,
  );
}
const productionSources = await listFiles(
  mobileRoot,
  (path) => /\.(?:ts|tsx)$/u.test(path) && !/\.test\.(?:ts|tsx)$/u.test(path),
);
const combinedProductionSource = (
  await Promise.all(productionSources.map((path) => readFile(path, 'utf8')))
).join('\n');
assertRelease(
  weeklyReminderSource.includes("weeklyRehearsalReminderMarker = 'weekly_rehearsal'") &&
    weeklyReminderSource.includes("title: 'A quick safety practice is ready'") &&
    weeklyReminderSource.includes("body: 'Open BoomerBuddy when you are ready.'") &&
    weeklyReminderSource.includes('data: { kind: weeklyRehearsalReminderMarker }') &&
    weeklyReminderSource.includes('sound: false') &&
    weeklyReminderSource.includes('AndroidImportance.LOW') &&
    weeklyReminderSource.includes('setAutoServerRegistrationEnabledAsync(false)') &&
    weeklyReminderSource.includes('.filter(isWeeklyRehearsalReminder)') &&
    weeklyReminderSource.includes('SchedulableTriggerInputTypes.TIME_INTERVAL') &&
    !/householdId|personId|checkId|submitted|artifact/iu.test(weeklyReminderSource),
  'weekly rehearsal notification must remain generic, quiet, local, and marker-scoped',
);
assertRelease(
  !/getExpoPushTokenAsync|getDevicePushTokenAsync|registerTaskAsync|SCHEDULE_EXACT_ALARM/iu.test(
    combinedProductionSource,
  ),
  'mobile must not request push tokens, background notification tasks, or exact alarms',
);
assertRelease(
  appSource.includes('await disableWeeklyRehearsalReminder();') &&
    householdSource.includes('previousSelectedHouseholdId.current === selectedHouseholdId') &&
    householdSource.includes('void disableWeeklyRehearsalReminder();'),
  'weekly rehearsal notification must cancel on sign-out and household switch',
);
assertRelease(
  memberLearningScreenSource.includes("deviceProof: 'pending'") ||
    (memberLearningScreenSource.includes('Device reminder delivery has not yet been verified') &&
      weeklyReminderSource.includes("deviceProof: 'pending'")),
  'mobile must keep local-notification device proof explicitly pending',
);
assertRelease(
  !combinedProductionSource.includes('Support is monitored') &&
    combinedProductionSource.includes('does not promise 24-hour or real-time support coverage'),
  'mobile support copy must not claim unproven monitoring or response coverage',
);
const approvedHttpsLiterals = new Set([
  exactApiOrigin,
  `${exactCustomerOrigin}/sign-in`,
  'https://example.com/path',
]);
const sourceHttpsLiterals = [
  ...new Set(combinedProductionSource.match(/https:\/\/[^\s'"`<>)]+/gu) ?? []),
];
for (const literal of sourceHttpsLiterals) {
  assertRelease(approvedHttpsLiterals.has(literal), `unapproved mobile HTTPS literal ${literal}`);
}
const approvedMailtoTemplates = new Set([
  'mailto:${supportEmail}',
  'mailto:${supportEmail}?subject=${encodeURIComponent(validatedReceiptCode)}',
]);
const sourceMailtoTemplates = combinedProductionSource.match(/mailto:[^`'"\r\n]+/gu) ?? [];
assertRelease(
  sourceMailtoTemplates.length === approvedMailtoTemplates.size &&
    sourceMailtoTemplates.every((template) => approvedMailtoTemplates.has(template)),
  'mobile email links must remain limited to a blank support draft or a receipt-code subject',
);
assertRelease(
  supportScreenSource.includes(
    [
      'function supportReceiptEmailDraftUrl(receiptCode: string): string {',
      '  const validatedReceiptCode = supportReceiptCodeSchema.parse(receiptCode);',
      '  return `mailto:${supportEmail}?subject=${encodeURIComponent(validatedReceiptCode)}`;',
      '}',
    ].join('\n'),
  ) && (combinedProductionSource.match(/\?subject=/gu) ?? []).length === 1,
  'receipt email subject must contain only a schema-validated opaque receipt code',
);
assertRelease(
  !/[?&](?:body|cc|bcc)=/iu.test(combinedProductionSource),
  'mobile email drafts must not prefill body, cc, or bcc content',
);
assertRelease(
  (supportScreenSource.match(/openSupportEmail\(/gu) ?? []).length === 3 &&
    supportScreenSource.includes('onPress={() => void openSupportEmail(emailReceiptCode)}') &&
    supportScreenSource.includes('onPress={() => void openSupportEmail()}'),
  'support email drafts must open only from explicit user button actions',
);
assertRelease(
  !/(?:Linking\.sendIntent|Share\.share|provider\.send|messages\.create)/iu.test(
    supportScreenSource,
  ),
  'mobile support must not send or share outbound content automatically',
);
assertRelease(
  (combinedProductionSource.match(/Linking\.openURL\(/gu) ?? []).length === 4 &&
    combinedProductionSource.includes('Linking.openURL(customerWebSignInUrl)') &&
    combinedProductionSource.includes('Linking.openURL(`mailto:${supportEmail}`)') &&
    combinedProductionSource.includes(
      'Linking.openURL(supportReceiptEmailDraftUrl(receiptCode))',
    ) &&
    memberLearningScreenSource.includes('Linking.openURL(validatedUrl)') &&
    memberLearningScreenSource.includes('validatedOfficialSourceUrl(url)') &&
    officialSourceBoundary.includes("source.protocol !== 'https:'") &&
    officialSourceBoundary.includes("!source.hostname.endsWith('.gov')"),
  'outbound mobile links must remain limited to sign-in, support email, and validated user-initiated government sources',
);
for (const [label, pattern] of [
  ['authenticated web billing route', /\/member\/billing/iu],
  ['pricing route', /\/pricing(?:[?'"`/]|$)/iu],
  ['checkout action', /continue to checkout|open checkout|checkout session/iu],
  ['native purchase SDK', /react-native-iap|expo-iap|revenuecat|@stripe\/stripe-react-native/iu],
  ['browser-based payment action', /openBrowserAsync\([^)]*(?:billing|checkout|pricing)/iu],
]) {
  assertRelease(!pattern.test(combinedProductionSource), `${label} must remain absent from mobile`);
}
assertRelease(
  metadata.nativeCommerceStatus === 'web_first_no_native_purchase_or_payment_steering',
  'store metadata must state the web-first native-commerce boundary',
);

execFileSync(
  process.execPath,
  [join(repositoryRoot, 'scripts/generate-mobile-assets.mjs'), '--check'],
  {
    cwd: repositoryRoot,
    encoding: 'utf8',
  },
);
const expectedAssets = {
  'icon.png': { width: 1024, height: 1024, opaque: true, hasAlpha: false },
  'adaptive-icon.png': { width: 1024, height: 1024, opaque: false, hasAlpha: true },
  'splash-icon.png': { width: 1024, height: 1024, opaque: false, hasAlpha: true },
  'favicon.png': { width: 256, height: 256, opaque: true, hasAlpha: false },
};
const assetHashes = {};
for (const [filename, expected] of Object.entries(expectedAssets)) {
  const path = join(mobileRoot, 'assets', filename);
  const image = sharp(path);
  const [imageMetadata, imageStats, contents] = await Promise.all([
    image.metadata(),
    image.stats(),
    readFile(path),
  ]);
  assertRelease(imageMetadata.format === 'png', `${filename} must be PNG`);
  assertRelease(
    imageMetadata.width === expected.width && imageMetadata.height === expected.height,
    `${filename} must be ${expected.width}x${expected.height}`,
  );
  assertRelease(
    imageMetadata.hasAlpha === expected.hasAlpha,
    `${filename} alpha channel is invalid`,
  );
  assertRelease(imageStats.isOpaque === expected.opaque, `${filename} opacity is not store-safe`);
  assetHashes[filename] = createHash('sha256').update(contents).digest('hex');
}
assertRelease(appConfig.icon === './assets/icon.png', 'Expo icon must use the verified icon');
assertRelease(
  appConfig.android?.adaptiveIcon?.foregroundImage === './assets/adaptive-icon.png',
  'Android adaptive icon must use the verified foreground',
);
assertRelease(appConfig.web?.favicon === './assets/favicon.png', 'web favicon must be verified');

const expoCli = resolve(repositoryRoot, 'node_modules/expo/bin/cli');
const introspected = JSON.parse(
  execFileSync(process.execPath, [expoCli, 'config', '--type', 'introspect', '--json'], {
    cwd: mobileRoot,
    encoding: 'utf8',
  }),
);
const iosMod = introspected._internal?.modResults?.ios;
const androidManifest = introspected._internal?.modResults?.android?.manifest?.manifest;
const androidApplication = androidManifest?.application?.[0];
const iosUrlSchemes = (iosMod?.infoPlist?.CFBundleURLTypes ?? []).flatMap(
  (urlType) => urlType?.CFBundleURLSchemes ?? [],
);
const activePermissions = (androidManifest?.['uses-permission'] ?? [])
  .filter((permission) => permission.$?.['tools:node'] !== 'remove')
  .map((permission) => permission.$?.['android:name']);
const notificationSdkPermissions = [
  ...notificationsAndroidManifestSource.matchAll(
    /<uses-permission\b[^>]*android:name="([^"]+)"[^>]*\/>/gu,
  ),
].map((match) => match[1]);
const androidAppLinkData = (androidApplication?.activity ?? [])
  .flatMap((activity) => activity['intent-filter'] ?? [])
  .flatMap((filter) => filter.data ?? [])
  .map((data) => data.$)
  .filter((data) => data?.['android:scheme'] === 'https');
const androidMainActivities = (androidApplication?.activity ?? []).filter(
  (activity) => activity.$?.['android:name'] === '.MainActivity',
);
assertRelease(
  androidMainActivities.length === 1,
  'resolved Android manifest must contain exactly one .MainActivity',
);
const hostedCallbackHost = `${exactApplicationId}.hosted-callback`;
const clerkCallbackFilters = (androidMainActivities[0]?.['intent-filter'] ?? []).filter((filter) =>
  (filter.data ?? []).some(
    (data) =>
      data.$?.['android:scheme'] === 'clerk' || data.$?.['android:host'] === hostedCallbackHost,
  ),
);
assertRelease(
  clerkCallbackFilters.length === 1,
  'resolved Android manifest must contain exactly one bounded Clerk hosted-callback filter',
);
const clerkCallbackFilter = clerkCallbackFilters[0];
const clerkCallbackActions = (clerkCallbackFilter?.action ?? []).map(
  (action) => action.$?.['android:name'],
);
const clerkCallbackCategories = (clerkCallbackFilter?.category ?? []).map(
  (category) => category.$?.['android:name'],
);
const clerkCallbackData = clerkCallbackFilter?.data ?? [];
assertExactStringSet(
  iosUrlSchemes,
  [appConfig.scheme, exactApplicationId],
  'resolved iOS native-auth callback schemes',
);
assertExactStringSet(
  clerkCallbackActions,
  ['android.intent.action.VIEW'],
  'resolved Android Clerk callback actions',
);
assertExactStringSet(
  clerkCallbackCategories,
  ['android.intent.category.DEFAULT', 'android.intent.category.BROWSABLE'],
  'resolved Android Clerk callback categories',
);
assertRelease(
  clerkCallbackData.length === 1 &&
    JSON.stringify(Object.keys(clerkCallbackData[0]?.$ ?? {}).sort()) ===
      JSON.stringify(['android:host', 'android:scheme']) &&
    clerkCallbackData[0]?.$?.['android:scheme'] === 'clerk' &&
    clerkCallbackData[0]?.$?.['android:host'] === hostedCallbackHost,
  'resolved Android Clerk callback data must contain only the exact hosted-callback URI',
);
const androidHostedCallbackUri = `clerk://${hostedCallbackHost}`;
assertRelease(
  iosMod?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads === false,
  'resolved iOS manifest must deny arbitrary loads',
);
assertRelease(
  iosMod?.infoPlist?.NSFaceIDUsageDescription === undefined,
  'resolved iOS manifest must not claim unused Face ID access',
);
assertRelease(
  iosMod?.entitlements?.['com.apple.developer.associated-domains'] === undefined,
  'resolved iOS manifest must not contain a partial universal-link entitlement',
);
assertRelease(
  androidApplication?.$?.['android:allowBackup'] === 'false',
  'resolved Android manifest must disable application backup',
);
assertRelease(
  activePermissions.length === 1 && activePermissions[0] === 'android.permission.INTERNET',
  'repository-owned Android manifest must directly request only Internet access',
);
assertExactStringSet(
  notificationSdkPermissions,
  ['android.permission.POST_NOTIFICATIONS', 'android.permission.RECEIVE_BOOT_COMPLETED'],
  'pinned notification SDK Android manifest permissions',
);
assertExactStringSet(
  [...activePermissions, ...notificationSdkPermissions],
  metadata.permissions.expectedActiveAndroidPermissions,
  'declared Android permissions across the app and pinned notification SDK manifests',
);
assertRelease(
  androidAppLinkData.length === 0,
  'resolved Android manifest must not contain a partial HTTPS App Link filter',
);

const inputSha256 = await buildInputFingerprint([
  mobileRoot,
  join(repositoryRoot, 'packages/contracts'),
  join(repositoryRoot, 'packages/design'),
  join(repositoryRoot, 'packages/domain'),
  join(repositoryRoot, 'package.json'),
  join(repositoryRoot, 'package-lock.json'),
  join(repositoryRoot, 'scripts/generate-mobile-assets.mjs'),
  join(repositoryRoot, 'scripts/verify-mobile-distribution.mjs'),
  notificationsAndroidManifestPath,
]);

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'provider_free_mobile_distribution_inputs_verified',
      applicationId: exactApplicationId,
      marketingVersion: appConfig.version,
      developerBuildVersionSource: 'remote_eas_receipt_required',
      universalAndAppLinks: 'blocked_pending_two_way_provider_association',
      nativeAuthCallbacks: {
        iosSchemes: [...iosUrlSchemes].sort(),
        androidHostedCallbackUri,
      },
      inputSha256,
      assetSha256: assetHashes,
    },
    null,
    2,
  )}\n`,
);
