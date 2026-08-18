import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import process from 'node:process';

const outputDirectoryValue = process.env.BB_DEPENDENCY_EVIDENCE_DIR;
if (outputDirectoryValue === undefined || outputDirectoryValue.trim() === '') {
  throw new TypeError(
    'BB_DEPENDENCY_EVIDENCE_DIR must name an evidence directory outside the repository checkout',
  );
}

const repository = resolve(process.cwd());
const outputDirectory = resolve(outputDirectoryValue);
const evidenceRelativePath = relative(repository, outputDirectory);
if (
  evidenceRelativePath === '' ||
  (!evidenceRelativePath.startsWith('..') && !isAbsolute(evidenceRelativePath))
) {
  throw new TypeError('Dependency evidence must be written outside the repository checkout');
}
const npmCommand = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
const npmPrefix = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd'] : [];

function npmJson(args, acceptedStatuses = [0]) {
  const result = spawnSync(npmCommand, [...npmPrefix, ...args], {
    cwd: repository,
    encoding: 'utf8',
    maxBuffer: 64 * 1_024 * 1_024,
    shell: false,
  });
  if (!acceptedStatuses.includes(result.status ?? -1)) {
    throw new Error(
      `npm ${args.join(' ')} exited with ${result.status ?? 'unknown'}: ${result.stderr.trim()}`,
    );
  }
  try {
    return { parsed: JSON.parse(result.stdout), raw: result.stdout.trimEnd() };
  } catch {
    throw new Error(`npm ${args.join(' ')} did not emit valid JSON`);
  }
}

function git(args) {
  const result = spawnSync('git', args, {
    cwd: repository,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} exited with ${result.status ?? 'unknown'}`);
  }
  return result.stdout.trim();
}

const candidateCommit = git(['rev-parse', 'HEAD']).toLowerCase();
if (!/^[0-9a-f]{40}$/u.test(candidateCommit)) {
  throw new Error('Git HEAD did not resolve to one exact lowercase commit');
}
if (git(['status', '--porcelain']) !== '') {
  throw new Error('Dependency evidence requires a clean candidate checkout');
}
const candidateTags = git(['tag', '--points-at', candidateCommit])
  .split(/\r?\n/gu)
  .filter((tag) => /^run3-1-replit-founding-household-[0-9a-f]{12}$/u.test(tag))
  .filter((tag) => tag.endsWith(candidateCommit.slice(0, 12)));
if (candidateTags.length > 1) {
  throw new Error('More than one Run 3.1 candidate tag points at the evidence commit');
}
const candidateTag = candidateTags[0] ?? null;
if (process.env.BB_REQUIRE_RUN3_1_CANDIDATE_TAG === 'true' && candidateTag === null) {
  throw new Error('Dependency evidence requires the exact immutable Run 3.1 candidate tag');
}
await mkdir(outputDirectory, { recursive: true });
if ((await readdir(outputDirectory)).length !== 0) {
  throw new Error('Dependency evidence output directory must be empty');
}

function directAdvisories(report) {
  const advisories = [];
  for (const [affectedPackage, value] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of value.via ?? []) {
      if (typeof via === 'string') continue;
      advisories.push({
        affectedPackage,
        dependency: via.dependency,
        severity: via.severity,
        title: via.title,
        url: via.url,
        range: via.range,
        fixAvailable: value.fixAvailable,
      });
    }
  }
  return advisories.sort((left, right) =>
    `${left.url}:${left.affectedPackage}`.localeCompare(`${right.url}:${right.affectedPackage}`),
  );
}

const deployableWorkspaces = ['api', 'worker', 'web', 'hq'];
const fullAudit = npmJson(['audit', '--json'], [0, 1]);
const mobileAudit = npmJson(
  ['audit', '--workspace', '@boomerbuddy/mobile', '--omit=dev', '--json'],
  [0, 1],
);
const workspaceAudits = Object.fromEntries(
  deployableWorkspaces.map((workspace) => [
    workspace,
    npmJson(['audit', '--workspace', `@boomerbuddy/${workspace}`, '--omit=dev', '--json'], [0, 1]),
  ]),
);

const allowedMobileHighAdvisories = new Set([
  'https://github.com/advisories/GHSA-5p2g-fcmc-qvqq',
  'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr',
]);
const fullDirect = directAdvisories(fullAudit.parsed);
const mobileDirect = directAdvisories(mobileAudit.parsed);
const fullHighOrCritical = fullDirect.filter((item) =>
  ['high', 'critical'].includes(item.severity),
);
const mobileHighOrCritical = mobileDirect.filter((item) =>
  ['high', 'critical'].includes(item.severity),
);

if (
  fullHighOrCritical.some(
    (item) => item.severity === 'critical' || !allowedMobileHighAdvisories.has(item.url),
  )
) {
  throw new Error('The full dependency audit contains an unadjudicated High or Critical advisory');
}
if (
  mobileHighOrCritical.length !== allowedMobileHighAdvisories.size ||
  mobileHighOrCritical.some((item) => !allowedMobileHighAdvisories.has(item.url))
) {
  throw new Error('The mobile-only High advisory allowlist no longer matches the registry report');
}
for (const [workspace, audit] of Object.entries(workspaceAudits)) {
  const counts = audit.parsed.metadata?.vulnerabilities;
  if ((counts?.high ?? 0) !== 0 || (counts?.critical ?? 0) !== 0) {
    throw new Error(`${workspace} contains a production High or Critical dependency advisory`);
  }
}

const fullInventory = npmJson(['ls', '--all', '--json']);
const workspaceInventories = Object.fromEntries(
  deployableWorkspaces.map((workspace) => [
    workspace,
    npmJson(['ls', '--workspace', `@boomerbuddy/${workspace}`, '--omit=dev', '--all', '--json']),
  ]),
);
const mobileInventory = npmJson([
  'ls',
  '--workspace',
  '@boomerbuddy/mobile',
  '--omit=dev',
  '--all',
  '--json',
]);
const sbom = npmJson(['sbom', '--sbom-format', 'cyclonedx'], [0]);

const lockBytes = await readFile(resolve(repository, 'package-lock.json'));
const lock = {
  sha256: createHash('sha256').update(lockBytes).digest('hex'),
  byteSize: lockBytes.byteLength,
};
const summary = {
  generatedAt: new Date().toISOString(),
  evidenceClass:
    candidateTag === null
      ? 'commit_bound_registry_and_local_inventory'
      : 'candidate_tag_bound_registry_and_local_inventory',
  candidateCommit,
  candidateTag,
  lock,
  node: process.version,
  npm: process.env.npm_config_user_agent ?? 'invoked npm CLI',
  fullAuditCounts: fullAudit.parsed.metadata?.vulnerabilities,
  fullDirectAdvisories: fullDirect,
  mobileOnlyAcceptedHighAdvisories: [...allowedMobileHighAdvisories].sort(),
  deployableWorkspaceAuditCounts: Object.fromEntries(
    Object.entries(workspaceAudits).map(([workspace, audit]) => [
      workspace,
      audit.parsed.metadata?.vulnerabilities,
    ]),
  ),
  boundary: {
    mobileDeployed: false,
    expoOrMetroStartedInProduction: false,
    untrustedMobileBuildAssetsAccepted: false,
    acceptanceExpiresWhenAnyBoundaryChanges: true,
  },
};

const files = {
  'npm-audit-full.json': fullAudit.raw,
  'npm-audit-mobile-production.json': mobileAudit.raw,
  'npm-ls-all.json': fullInventory.raw,
  'npm-ls-mobile-production.json': mobileInventory.raw,
  'boomerbuddy.cdx.json': sbom.raw,
  'summary.json': JSON.stringify(summary, null, 2),
};
for (const [workspace, audit] of Object.entries(workspaceAudits)) {
  files[`npm-audit-${workspace}-production.json`] = audit.raw;
}
for (const [workspace, inventory] of Object.entries(workspaceInventories)) {
  files[`npm-ls-${workspace}-production.json`] = inventory.raw;
}
await Promise.all(
  Object.entries(files).map(([name, contents]) =>
    writeFile(resolve(outputDirectory, name), `${contents}\n`, { encoding: 'utf8' }),
  ),
);
const evidenceManifest = Object.entries(files)
  .map(([name, contents]) => {
    const bytes = Buffer.from(`${contents}\n`, 'utf8');
    return {
      name,
      byteSize: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  })
  .sort((left, right) => left.name.localeCompare(right.name));
await writeFile(
  resolve(outputDirectory, 'evidence-manifest.json'),
  `${JSON.stringify(
    {
      candidateCommit,
      candidateTag,
      files: evidenceManifest,
    },
    null,
    2,
  )}\n`,
  { encoding: 'utf8' },
);
if (git(['status', '--porcelain']) !== '') {
  throw new Error('Dependency evidence observed a candidate checkout mutation');
}

process.stdout.write(
  `Run 3.1 dependency evidence passed for ${candidateCommit}${candidateTag === null ? ' (untagged commit)' : ` (${candidateTag})`}: deployable workspace High/Critical counts are zero; ${fullHighOrCritical.length} direct High advisories remain confined to the undeployed mobile build graph. Evidence: ${outputDirectory}\n`,
);
