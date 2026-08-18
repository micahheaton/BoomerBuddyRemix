import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import process from 'node:process';

const routes = [
  {
    name: 'HQ Founding Household',
    directory: resolve('apps/hq/.next/server/app/founding-households'),
    staticDirectory: resolve('apps/hq/.next/static/chunks'),
    requiredText: ['Exact Clerk customer subject', 'Issue one manual-delivery credential'],
    forbiddenText: ['Managed-identity activation is blocked', 'Issue one local credential'],
  },
  {
    name: 'member Founding Household',
    directory: resolve('apps/web/.next/server/app/member/founding-household'),
    staticDirectory: resolve('apps/web/.next/static/chunks'),
    requiredText: [
      'Enter the one-time invitation credential',
      'Accept finite sponsored beta — no card',
    ],
    forbiddenText: ['Managed-identity activation is blocked'],
  },
  {
    name: 'member home',
    directory: resolve('apps/web/.next/server/app/member'),
    staticDirectory: resolve('apps/web/.next/static/chunks'),
    requiredText: ['Open Founding Household review', 'Open selected-household feedback'],
  },
  {
    name: 'customer sign in',
    directory: resolve('apps/web/.next/server/app/sign-in'),
    staticDirectory: resolve('apps/web/.next/static/chunks'),
    requiredText: ['Private Founding Household beta', 'Sign in to BoomerBuddy'],
    forbiddenText: ['Choose a seeded person', 'Enter local member area'],
  },
  {
    name: 'member messaging',
    directory: resolve('apps/web/.next/server/app/member/messaging'),
    staticDirectory: resolve('apps/web/.next/static/chunks'),
    requiredText: 'Messaging is not activated',
  },
  {
    name: 'HQ messaging support',
    directory: resolve('apps/hq/.next/server/app/messaging'),
    staticDirectory: resolve('apps/hq/.next/static/chunks'),
    requiredText: 'Messaging support is not activated',
  },
  {
    name: 'HQ editorial intelligence',
    directory: resolve('apps/hq/.next/server/app/editorial'),
    staticDirectory: resolve('apps/hq/.next/static/chunks'),
    requiredText: 'Editorial intelligence is not activated',
  },
  {
    name: 'HQ referral evidence',
    directory: resolve('apps/hq/.next/server/app/referrals'),
    staticDirectory: resolve('apps/hq/.next/static/chunks'),
    requiredText: 'Referral credits are not activated',
  },
  {
    name: 'public feedback',
    directory: resolve('apps/web/.next/server/app/feedback'),
    staticDirectory: resolve('apps/web/.next/static/chunks'),
    requiredText: 'Feedback intake is not activated',
    forbiddenText: ['Submit local feedback'],
  },
  {
    name: 'member feedback',
    directory: resolve('apps/web/.next/server/app/member/feedback'),
    staticDirectory: resolve('apps/web/.next/static/chunks'),
    requiredText: ['Share a product observation.', 'Submit feedback'],
    forbiddenText: ['Feedback intake is not activated', 'Submit local feedback'],
  },
  {
    name: 'HQ feedback review',
    directory: resolve('apps/hq/.next/server/app/feedback'),
    staticDirectory: resolve('apps/hq/.next/static/chunks'),
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
];
const forbiddenInRenderedPayload = ['localInvitationCredential'];
const productionUiExpectation = process.env.BB_PRODUCTION_UI_EXPECTATION ?? 'unconfigured_identity';
if (!['unconfigured_identity', 'configured_static'].includes(productionUiExpectation)) {
  throw new Error(
    'BB_PRODUCTION_UI_EXPECTATION must be unconfigured_identity or configured_static',
  );
}
const identityUnavailableText = 'Production identity is unavailable.';

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

async function generatedRouteText(directory, staticDirectory) {
  const files = new Set();
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

  if (files.size === 0) {
    throw new Error(`No generated HTML/RSC body was found under ${directory}`);
  }
  const generatedBody = (
    await Promise.all(
      [...files]
        .sort((left, right) => left.localeCompare(right))
        .map((file) => readFile(file, 'utf8')),
    )
  ).join('\n');
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
  return { combined: [generatedBody, ...chunks].join('\n'), generatedBody };
}

for (const route of routes) {
  const generated = await generatedRouteText(route.directory, route.staticDirectory);
  const requiredText =
    route.requiredText === undefined
      ? []
      : Array.isArray(route.requiredText)
        ? route.requiredText
        : [route.requiredText];
  if (productionUiExpectation === 'unconfigured_identity') {
    if (!generated.generatedBody.includes(identityUnavailableText)) {
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
    ? 'Static production route bodies fail closed when Clerk build configuration is absent, and the mobile bundle omits local actions; configured and hydrated production-browser proof remains unproved.\n'
    : 'Configured static production route artifacts/payloads and the mobile bundle passed the local-action boundary checks; Clerk provider behavior and hydrated production-browser proof remain unproved.\n',
);
