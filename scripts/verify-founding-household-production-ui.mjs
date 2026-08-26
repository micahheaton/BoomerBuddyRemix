import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import process from 'node:process';

const webIdentityUnavailableText = 'Member sign in is temporarily unavailable';

function dynamicApplicationRoute(application, path) {
  return {
    appPathsManifest: resolve(`apps/${application}/.next/server/app-paths-manifest.json`),
    expectedEntry: `app/${path}/page.js`,
    routeKey: `/${path}/page`,
    serverRoot: resolve(`apps/${application}/.next/server`),
  };
}

const routes = [
  {
    name: 'HQ Founding Household',
    directory: resolve('apps/hq/.next/server/app/founding-households'),
    staticDirectory: resolve('apps/hq/.next/static/chunks'),
    dynamicRoute: dynamicApplicationRoute('hq', 'founding-households'),
    resourceGuarded: true,
    requiredText: ['New sponsored enrollment is disabled', 'New invitations are disabled'],
    forbiddenText: ['Exact Clerk customer subject', 'Managed-identity activation is blocked'],
  },
  {
    name: 'member Founding Household',
    directory: resolve('apps/web/.next/server/app/member/founding-household'),
    staticDirectory: resolve('apps/web/.next/static/chunks'),
    dynamicRoute: dynamicApplicationRoute('web', 'member/founding-household'),
    resourceGuarded: true,
    requiredText: [
      'Manage sponsored access',
      'Historical access only.',
      'This page cannot create, preview, or accept a new sponsored enrollment.',
    ],
    unconfiguredText: webIdentityUnavailableText,
    forbiddenText: ['Managed-identity activation is blocked'],
  },
  {
    name: 'member home',
    directory: resolve('apps/web/.next/server/app/member'),
    staticDirectory: resolve('apps/web/.next/static/chunks'),
    dynamicRoute: dynamicApplicationRoute('web', 'member'),
    resourceGuarded: true,
    requiredText: ['Share feedback', 'Manage sponsored access'],
    unconfiguredText: webIdentityUnavailableText,
  },
  {
    name: 'customer sign in',
    directory: resolve('apps/web/.next/server/app/sign-in'),
    staticDirectory: resolve('apps/web/.next/static/chunks'),
    dynamicRoute: {
      appPathsManifest: resolve('apps/web/.next/server/app-paths-manifest.json'),
      expectedEntry: 'app/sign-in/[[...sign-in]]/page.js',
      routeKey: '/sign-in/[[...sign-in]]/page',
      serverRoot: resolve('apps/web/.next/server'),
    },
    unconfiguredText: webIdentityUnavailableText,
    requiredText: ['Sign in to BoomerBuddy'],
    forbiddenText: [
      'Private Founding Household beta',
      'Choose a seeded person',
      'Enter local member area',
    ],
  },
  {
    name: 'unauthorized member sign in',
    directory: resolve('apps/web/.next/server/app/sign-in'),
    staticDirectory: resolve('apps/web/.next/static/chunks'),
    dynamicRoute: {
      appPathsManifest: resolve('apps/web/.next/server/app-paths-manifest.json'),
      expectedEntry: 'app/sign-in/[[...sign-in]]/page.js',
      routeKey: '/sign-in/[[...sign-in]]/page',
      serverRoot: resolve('apps/web/.next/server'),
    },
    unconfiguredText: webIdentityUnavailableText,
    requiredText: [
      'This sign-in cannot continue here',
      'Opening this page by itself does not prove that a session was revoked.',
      'Try member sign in again',
    ],
  },
  {
    name: 'member messaging',
    directory: resolve('apps/web/.next/server/app/member/messaging'),
    staticDirectory: resolve('apps/web/.next/static/chunks'),
    dynamicRoute: dynamicApplicationRoute('web', 'member/messaging'),
    resourceGuarded: true,
    requiredText: 'Messaging is not activated',
    unconfiguredText: webIdentityUnavailableText,
  },
  {
    name: 'HQ messaging support',
    directory: resolve('apps/hq/.next/server/app/messaging'),
    staticDirectory: resolve('apps/hq/.next/static/chunks'),
    dynamicRoute: dynamicApplicationRoute('hq', 'messaging'),
    resourceGuarded: true,
    requiredText: 'Messaging support is not activated',
  },
  {
    name: 'HQ editorial intelligence',
    directory: resolve('apps/hq/.next/server/app/editorial'),
    staticDirectory: resolve('apps/hq/.next/static/chunks'),
    dynamicRoute: dynamicApplicationRoute('hq', 'editorial'),
    resourceGuarded: true,
    requiredText: 'Editorial intelligence is not activated',
  },
  {
    name: 'HQ referral evidence',
    directory: resolve('apps/hq/.next/server/app/referrals'),
    staticDirectory: resolve('apps/hq/.next/static/chunks'),
    dynamicRoute: dynamicApplicationRoute('hq', 'referrals'),
    resourceGuarded: true,
    requiredText: 'Referral credits are not activated',
  },
  {
    name: 'public feedback',
    directory: resolve('apps/web/.next/server/app/feedback'),
    staticDirectory: resolve('apps/web/.next/static/chunks'),
    requiredText: 'Feedback intake is not activated',
    unconfiguredText: webIdentityUnavailableText,
    forbiddenText: ['Submit local feedback'],
  },
  {
    name: 'member feedback',
    directory: resolve('apps/web/.next/server/app/member/feedback'),
    staticDirectory: resolve('apps/web/.next/static/chunks'),
    dynamicRoute: dynamicApplicationRoute('web', 'member/feedback'),
    resourceGuarded: true,
    requiredText: ['Share a product observation.', 'Submit feedback'],
    unconfiguredText: webIdentityUnavailableText,
    forbiddenText: ['Feedback intake is not activated', 'Submit local feedback'],
  },
  {
    name: 'HQ feedback review',
    directory: resolve('apps/hq/.next/server/app/feedback'),
    staticDirectory: resolve('apps/hq/.next/static/chunks'),
    dynamicRoute: dynamicApplicationRoute('hq', 'feedback'),
    resourceGuarded: true,
    requiredText: ['Feedback review', 'Claim exact review', 'Open minimized text'],
    forbiddenText: ['Feedback review is not activated'],
  },
];
const forbiddenAcrossRoute = [
  'Issue one local credential',
  'Record active local policy',
  'Open messaging consent laboratory',
  'Record local fixture',
  'Choose this purpose',
  'Select exact event',
  'Read assigned minimized text',
  'Loading disabled referral evidence',
  'No local referral attribution has been issued',
  'Open Founding Household review',
  'Enter the one-time invitation credential',
  'Accept finite sponsored beta - no card',
];
const forbiddenInRenderedPayload = ['localInvitationCredential'];
const productionUiExpectation = process.env.BB_PRODUCTION_UI_EXPECTATION ?? 'unconfigured_identity';
if (!['unconfigured_identity', 'configured_static'].includes(productionUiExpectation)) {
  throw new Error(
    'BB_PRODUCTION_UI_EXPECTATION must be unconfigured_identity or configured_static',
  );
}
const identityUnavailableText = 'Production identity is unavailable.';
const productionSignInPaths = [
  '/sign-in',
  '/sign-in/client-trust',
  '/sign-in/session-recovery',
  '/sign-in/sso-callback',
  '/sign-in/oauth-callback',
];
const unauthorizedRewriteTarget = '/sign-in/unauthorized-sign-in';
const productionAuthRoutesOnly = process.env.BB_PRODUCTION_AUTH_ROUTES_ONLY === 'true';
if (process.env.BB_PRODUCTION_AUTH_ROUTES_ONLY !== undefined && !productionAuthRoutesOnly) {
  throw new Error('BB_PRODUCTION_AUTH_ROUTES_ONLY must be true when set');
}

function isMissing(error) {
  return typeof error === 'object' && error !== null && error.code === 'ENOENT';
}

async function collectGeneratedBodies(directory, files) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) {
      return;
    }
    throw error;
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collectGeneratedBodies(entryPath, files);
    } else if (entry.isFile() && /\.(?:html|rsc|body)$/u.test(entry.name)) {
      files.add(entryPath);
    }
  }
}

async function collectGeneratedJavaScript(directory, files) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) {
      return;
    }
    throw error;
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = resolve(directory, entry.name);
    if (!entryPath.startsWith(`${directory}${sep}`)) {
      throw new Error(`Generated route artifact escaped ${directory}`);
    }
    if (entry.isDirectory()) {
      await collectGeneratedJavaScript(entryPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.add(entryPath);
    }
  }
}

async function collectReferencedServerJavaScript(applicationRoute, files) {
  const buildRoot = resolve(applicationRoute.serverRoot, '..');
  const pending = [...files];
  while (pending.length > 0) {
    const artifact = pending.pop();
    if (artifact === undefined) {
      continue;
    }
    const body = await readFile(artifact, 'utf8');
    for (const match of body.matchAll(/["'](server\/chunks\/[^"'\\\s<>]+\.js)["']/gu)) {
      const referencedArtifact = resolve(buildRoot, match[1]);
      if (!referencedArtifact.startsWith(`${buildRoot}${sep}`)) {
        throw new Error(`Compiled route referenced JavaScript outside ${buildRoot}`);
      }
      if (!(await stat(referencedArtifact)).isFile()) {
        throw new Error(`Compiled route referenced missing JavaScript ${match[1]}`);
      }
      if (!files.has(referencedArtifact)) {
        files.add(referencedArtifact);
        pending.push(referencedArtifact);
      }
    }
  }
}

async function collectTextFiles(directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = resolve(directory, entry.name);
    if (!entryPath.startsWith(`${directory}${sep}`)) {
      throw new Error(`Generated mobile artifact escaped ${directory}`);
    }
    if (entry.isDirectory()) {
      await collectTextFiles(entryPath, files);
    } else if (entry.isFile() && /\.(?:html|js|json)$/u.test(entry.name)) {
      files.add(entryPath);
    }
  }
}

async function compiledApplicationEntry(applicationRoute) {
  const appPaths = JSON.parse(await readFile(applicationRoute.appPathsManifest, 'utf8'));
  if (appPaths[applicationRoute.routeKey] !== applicationRoute.expectedEntry) {
    throw new Error(
      `Application route ${applicationRoute.routeKey} is absent from the app manifest`,
    );
  }
  const compiledEntry = resolve(applicationRoute.serverRoot, applicationRoute.expectedEntry);
  if (!compiledEntry.startsWith(`${applicationRoute.serverRoot}${sep}`)) {
    throw new Error(`Application route ${applicationRoute.routeKey} escaped the server build root`);
  }
  if (!(await stat(compiledEntry)).isFile()) {
    throw new Error(`Application route ${applicationRoute.routeKey} has no compiled entry`);
  }
  return compiledEntry;
}

async function generatedRouteText(directory, staticDirectory, dynamicRoute) {
  const files = new Set();
  let dynamicArtifact = false;
  const compiledEntry =
    dynamicRoute === undefined ? undefined : await compiledApplicationEntry(dynamicRoute);
  for (const extension of ['html', 'rsc', 'body']) {
    const sibling = `${directory}.${extension}`;
    try {
      if ((await stat(sibling)).isFile()) {
        files.add(sibling);
      }
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  }
  await collectGeneratedBodies(directory, files);
  await collectGeneratedBodies(`${directory}.segments`, files);

  let generatedBody;
  if (files.size === 0) {
    dynamicArtifact = true;
    if (dynamicRoute === undefined) {
      throw new Error(`No generated HTML/RSC body was found under ${directory}`);
    }
    if (compiledEntry === undefined)
      throw new Error(`No compiled route was found under ${directory}`);
    const artifacts = new Set([compiledEntry]);
    await collectGeneratedJavaScript(directory, artifacts);
    await collectReferencedServerJavaScript(dynamicRoute, artifacts);
    generatedBody = (
      await Promise.all(
        [...artifacts]
          .sort((left, right) => left.localeCompare(right))
          .map((file) => readFile(file, 'utf8')),
      )
    ).join('\n');
  } else {
    generatedBody = (
      await Promise.all(
        [...files]
          .sort((left, right) => left.localeCompare(right))
          .map((file) => readFile(file, 'utf8')),
      )
    ).join('\n');
  }
  const chunkReferences = new Set(
    [...generatedBody.matchAll(/\/_next\/static\/chunks\/[^"'\\\s<>]+\.js/gu)].map((match) =>
      match[0].replace('/_next/static/chunks/', ''),
    ),
  );
  if (chunkReferences.size === 0) {
    throw new Error(`No generated JavaScript chunk reference was found for ${directory}`);
  }

  const chunks = await Promise.all(
    [...chunkReferences]
      .sort((left, right) => left.localeCompare(right))
      .map(async (reference) => {
        const chunkPath = resolve(staticDirectory, reference);
        if (!chunkPath.startsWith(`${staticDirectory}${sep}`)) {
          throw new Error(`Generated route referenced a chunk outside ${staticDirectory}`);
        }
        return readFile(chunkPath, 'utf8');
      }),
  );
  const combined = [generatedBody, ...chunks].join('\n');
  return { combined, generatedBody: dynamicArtifact ? combined : generatedBody };
}

function verifyProductionSignInRouteManifest(label, routesManifest) {
  const signInRoute = routesManifest.dynamicRoutes?.find(
    (route) => route.page === '/sign-in/[[...sign-in]]',
  );
  if (signInRoute === undefined || typeof signInRoute.regex !== 'string') {
    throw new Error(`${label} production sign-in catch-all is absent from the routes manifest`);
  }
  const signInRegex = new RegExp(signInRoute.regex);
  for (const path of productionSignInPaths) {
    if (!signInRegex.test(path)) {
      throw new Error(`${label} production sign-in catch-all does not resolve ${path}`);
    }
  }

  const rewrites = routesManifest.rewrites ?? {};
  const rewriteRules = [
    ...(rewrites.beforeFiles ?? []),
    ...(rewrites.afterFiles ?? []),
    ...(rewrites.fallback ?? []),
  ];
  const redirectRules = routesManifest.redirects ?? [];
  for (const path of productionSignInPaths) {
    const redirect = redirectRules.find(
      (rule) => typeof rule.regex === 'string' && new RegExp(rule.regex).test(path),
    );
    if (redirect !== undefined) {
      throw new Error(`${label} production sign-in path ${path} unexpectedly matches a redirect`);
    }
    const rewrite = rewriteRules.find(
      (rule) => typeof rule.regex === 'string' && new RegExp(rule.regex).test(path),
    );
    if (rewrite !== undefined) {
      throw new Error(`${label} production sign-in path ${path} unexpectedly matches a rewrite`);
    }
  }
  return { redirectRules, rewriteRules, signInRegex };
}

async function verifyProductionAuthRouteResolution() {
  const [customerRoutesManifest, hqRoutesManifest] = await Promise.all([
    readFile(resolve('apps/web/.next/routes-manifest.json'), 'utf8').then(JSON.parse),
    readFile(resolve('apps/hq/.next/routes-manifest.json'), 'utf8').then(JSON.parse),
  ]);
  const { redirectRules, rewriteRules, signInRegex } = verifyProductionSignInRouteManifest(
    'Customer',
    customerRoutesManifest,
  );
  verifyProductionSignInRouteManifest('HQ', hqRoutesManifest);

  const unauthorizedRewrite = rewriteRules.find(
    (rule) =>
      rule.source === '/unauthorized-sign-in' && rule.destination === unauthorizedRewriteTarget,
  );
  if (
    unauthorizedRewrite === undefined ||
    typeof unauthorizedRewrite.regex !== 'string' ||
    !new RegExp(unauthorizedRewrite.regex).test('/unauthorized-sign-in')
  ) {
    throw new Error(
      'The production unauthorized sign-in rewrite is absent from the routes manifest',
    );
  }

  const unauthorizedRedirect = redirectRules.find(
    (rule) =>
      typeof rule.regex === 'string' && new RegExp(rule.regex).test('/unauthorized-sign-in'),
  );
  if (unauthorizedRedirect !== undefined) {
    throw new Error('Production auth path /unauthorized-sign-in unexpectedly matches a redirect');
  }
  const unauthorizedMatches = rewriteRules.filter(
    (rule) =>
      typeof rule.regex === 'string' && new RegExp(rule.regex).test('/unauthorized-sign-in'),
  );
  if (unauthorizedMatches.length !== 1 || unauthorizedMatches[0] !== unauthorizedRewrite) {
    throw new Error('The production unauthorized sign-in path has an ambiguous rewrite');
  }
  if (!signInRegex.test(unauthorizedRewriteTarget)) {
    throw new Error(
      'The production unauthorized sign-in rewrite target is not an application route',
    );
  }
  const targetTransfer = [...redirectRules, ...rewriteRules].find(
    (rule) =>
      typeof rule.regex === 'string' && new RegExp(rule.regex).test(unauthorizedRewriteTarget),
  );
  if (targetTransfer !== undefined) {
    throw new Error('The production unauthorized sign-in rewrite target is not terminal');
  }
}

await verifyProductionAuthRouteResolution();
if (productionAuthRoutesOnly) {
  process.stdout.write(
    'Customer and HQ production auth paths resolve to compiled application routes without redirect/rewrite loops; Clerk provider behavior and hydrated production-browser proof remain unproved.\n',
  );
  process.exit(0);
}

for (const route of routes) {
  const generated = await generatedRouteText(
    route.directory,
    route.staticDirectory,
    route.dynamicRoute,
  );
  const requiredText =
    route.requiredText === undefined
      ? []
      : Array.isArray(route.requiredText)
        ? route.requiredText
        : [route.requiredText];
  if (route.resourceGuarded === true) {
    for (const value of requiredText) {
      if (!generated.combined.includes(value)) {
        throw new Error(`${route.name} did not retain the required production copy: ${value}`);
      }
    }
    // A resource-guarded App Router page is compiled as a dynamic server artifact. Its bundle can
    // contain unreachable development branches, so it is not rendered-payload evidence. Anonymous
    // fail-closed behavior is exercised by verify-next-resource-auth; a signed-in hydrated browser
    // remains an external closure gate.
    continue;
  }
  if (productionUiExpectation === 'unconfigured_identity') {
    const hasDefaultIdentityBoundary = generated.generatedBody.includes(identityUnavailableText);
    const hasRouteIdentityBoundary = generated.generatedBody.includes(
      route.unconfiguredText ?? identityUnavailableText,
    );
    if (
      route.resourceGuarded !== true &&
      !hasDefaultIdentityBoundary &&
      !hasRouteIdentityBoundary
    ) {
      throw new Error(`${route.name} did not render the missing-identity fail-closed boundary`);
    }
  } else {
    if (generated.generatedBody.includes(identityUnavailableText)) {
      throw new Error(`${route.name} rendered the missing-identity boundary in configured mode`);
    }
    for (const value of requiredText) {
      if (!generated.combined.includes(value)) {
        throw new Error(
          `${route.name} did not retain the configured production boundary: ${value}`,
        );
      }
    }
  }
  for (const value of forbiddenAcrossRoute) {
    if (generated.generatedBody.includes(value)) {
      throw new Error(`${route.name} rendered the local-only production UI text: ${value}`);
    }
  }
  for (const value of route.forbiddenText ?? []) {
    const inspectedText =
      productionUiExpectation === 'configured_static'
        ? generated.combined
        : generated.generatedBody;
    if (inspectedText.includes(value)) {
      throw new Error(`${route.name} retained the local-only production UI text: ${value}`);
    }
  }
  // Shared contract validators retain the credential field name in client chunks. The exact
  // route payload must still never render or serialize it in production.
  for (const value of forbiddenInRenderedPayload) {
    if (generated.generatedBody.includes(value)) {
      throw new Error(`${route.name} rendered the local-only production field: ${value}`);
    }
  }
}

const mobileDirectory = resolve('apps/mobile/dist');
const mobileFiles = new Set();
await collectTextFiles(mobileDirectory, mobileFiles);
if (mobileFiles.size === 0) {
  throw new Error(`No generated production mobile artifacts were found under ${mobileDirectory}`);
}
const mobileText = (
  await Promise.all(
    [...mobileFiles]
      .sort((left, right) => left.localeCompare(right))
      .map((file) => readFile(file, 'utf8')),
  )
).join('\n');
for (const value of [
  'Create local invitation',
  'Open device share sheet',
  'Review native proof status',
  'Share feedback',
  'Submit local feedback',
]) {
  if (mobileText.includes(value)) {
    throw new Error(`Production mobile artifacts retained the local-only action: ${value}`);
  }
}

process.stdout.write(
  productionUiExpectation === 'unconfigured_identity'
    ? 'Customer and HQ production auth paths resolve to compiled application routes without redirect/rewrite loops, route bodies and dynamic artifacts fail closed when Clerk build configuration is absent, and the mobile bundle omits local actions; configured and hydrated production-browser proof remains unproved.\n'
    : 'Customer and HQ production auth paths resolve to compiled application routes without redirect/rewrite loops, configured production route artifacts/payloads and the mobile bundle passed the local-action boundary checks; Clerk provider behavior and hydrated production-browser proof remain unproved.\n',
);
