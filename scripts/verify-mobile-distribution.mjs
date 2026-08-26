import { execFileSync } from 'node:child_process';
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
const appConfig = app.expo;

assertAscii(metadata);
assertRelease(metadata.schemaVersion === 1, 'store metadata schemaVersion must be 1');
assertRelease(metadata.appName === appConfig.name, 'store app name must match Expo config');
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
const productionSources = await listFiles(mobileRoot, (path) => /\.(?:ts|tsx)$/u.test(path));
const combinedProductionSource = (
  await Promise.all(productionSources.map((path) => readFile(path, 'utf8')))
).join('\n');
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
assertRelease(
  (combinedProductionSource.match(/Linking\.openURL\(/gu) ?? []).length === 2 &&
    combinedProductionSource.includes('Linking.openURL(customerWebSignInUrl)') &&
    combinedProductionSource.includes('Linking.openURL(`mailto:${supportEmail}`)'),
  'outbound mobile links must remain limited to web-preview sign-in and user-initiated email',
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
const activePermissions = (androidManifest?.['uses-permission'] ?? [])
  .filter((permission) => permission.$?.['tools:node'] !== 'remove')
  .map((permission) => permission.$?.['android:name']);
const androidAppLinkData = (androidApplication?.activity ?? [])
  .flatMap((activity) => activity['intent-filter'] ?? [])
  .flatMap((filter) => filter.data ?? [])
  .map((data) => data.$)
  .filter((data) => data?.['android:scheme'] === 'https');
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
  'resolved Android manifest must request only Internet access',
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
]);

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'provider_free_mobile_distribution_inputs_verified',
      applicationId: exactApplicationId,
      marketingVersion: appConfig.version,
      developerBuildVersionSource: 'remote_eas_receipt_required',
      universalAndAppLinks: 'blocked_pending_two_way_provider_association',
      inputSha256,
      assetSha256: assetHashes,
    },
    null,
    2,
  )}\n`,
);
