import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const services = {
  api: '@boomerbuddy/api',
  hq: '@boomerbuddy/hq',
  web: '@boomerbuddy/web',
  worker: '@boomerbuddy/worker',
};
const service = process.env.BB_REPLIT_SERVICE;
const mode = process.argv[2];

if (!(service in services)) {
  throw new TypeError('BB_REPLIT_SERVICE must be exactly api, worker, web, or hq');
}
if (mode !== 'build' && mode !== 'start') {
  throw new TypeError('Replit service mode must be exactly build or start');
}
if (process.env.NODE_ENV !== 'production') {
  throw new TypeError('A Replit service build or start requires NODE_ENV=production');
}

const workspace = services[service];
const npmCommand = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
const npmPrefix = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd'] : [];

function run(args) {
  const result = spawnSync(npmCommand, [...npmPrefix, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 32 * 1_024 * 1_024,
    shell: false,
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} exited with status ${result.status ?? 'unknown'}`);
  }
}

function captureJson(args) {
  const result = spawnSync(npmCommand, [...npmPrefix, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 32 * 1_024 * 1_024,
    shell: false,
  });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`npm ${args.join(' ')} exited with status ${result.status ?? 'unknown'}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm ${args.join(' ')} did not emit valid JSON`);
  }
}

function captureGit(args) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} exited with status ${result.status ?? 'unknown'}`);
  }
  return result.stdout.trim();
}

const provenanceDiagnosticMaxBuffer = 1024 * 1024;
const provenanceDiagnosticMaxEntries = 50;
const provenanceDiagnosticMaxPathBytes = 256;
const replitCanonicalConfigBlob = '04697d2c8f4a23f4d89edff84930bbd25ede8be3';
const replitAutoscaleOverlayBlob = '7d305e8966bf99376816ea5bfaf47621133c225c';
const replitAutoscaleOverlayStatus = Buffer.from(' M .replit\0', 'utf8');
const replitAutoscaleServices = new Set(['api', 'hq', 'web']);
const reviewedWebOptionalArtifacts = {
  '@emnapi/runtime': {
    version: '1.11.3',
    resolved: 'https://registry.npmjs.org/@emnapi/runtime/-/runtime-1.11.3.tgz',
    integrity:
      'sha512-Xz4Tpyki7XyrpbUK1jR1AhdAdaXyhhY4lZ3neLodmhpuWfy2PAQN5B46sAiU4liOXGLkHypn/qU+jvfWSCYYLA==',
    lockDependencies: { tslib: '^2.4.0' },
  },
  '@img/sharp-wasm32': {
    version: '0.35.3',
    resolved: 'https://registry.npmjs.org/@img/sharp-wasm32/-/sharp-wasm32-0.35.3.tgz',
    integrity:
      'sha512-cZ0XkcYGpHZkqW6iCkqTcmUC0CD9DhD5d/qeZlZkfRBn6GnHniZXLUo5+9xw8Iv76YE6LQFN9YNBlKREcCG76w==',
    lockDependencies: { '@emnapi/runtime': '^1.11.1' },
  },
};

function captureGitBytes(args) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: provenanceDiagnosticMaxBuffer,
    shell: false,
  });
  if (result.error !== undefined || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error('git could not produce bounded provenance diagnostics');
  }
  return result.stdout;
}

function parseGitNameStatus(output) {
  const fields = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    fields.push(output.subarray(start, index));
    start = index + 1;
  }
  if (start !== output.length || fields.length % 2 !== 0) {
    throw new Error('git emitted malformed provenance diagnostics');
  }

  const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    const statusBytes = fields[index];
    const pathBytes = fields[index + 1];
    const status = statusBytes.toString('ascii');
    if (!/^[ADMTUXB]$/u.test(status) || pathBytes.length === 0) {
      throw new Error('git emitted malformed provenance diagnostics');
    }
    changes.push({ status, pathBytes });
  }
  return changes.sort((left, right) => Buffer.compare(left.pathBytes, right.pathBytes));
}

function parseGitPorcelainStatus(output) {
  const changes = [];
  let start = 0;

  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;

    const record = output.subarray(start, index);
    if (record.length <= 3 || record[2] !== 0x20) {
      throw new Error('git emitted malformed dirty-checkout diagnostics');
    }

    const status = String.fromCharCode(record[0], record[1]);
    if (status === '  ' || (!/^[ ADMTU]{2}$/u.test(status) && status !== '??' && status !== '!!')) {
      throw new Error('git emitted malformed dirty-checkout diagnostics');
    }

    changes.push({
      status,
      pathBytes: Buffer.from(record.subarray(3)),
    });
    start = index + 1;
  }

  if (start !== output.length) {
    throw new Error('git emitted malformed dirty-checkout diagnostics');
  }

  return changes.sort((left, right) => Buffer.compare(left.pathBytes, right.pathBytes));
}

function renderDiagnosticGitPath(pathBytes) {
  const visible = pathBytes.subarray(0, provenanceDiagnosticMaxPathBytes);
  let rendered = '"';
  for (const byte of visible) {
    if (byte === 0x22) rendered += '\\"';
    else if (byte === 0x5c) rendered += '\\\\';
    else if (byte >= 0x20 && byte <= 0x7e) rendered += String.fromCharCode(byte);
    else rendered += `\\x${byte.toString(16).padStart(2, '0')}`;
  }
  rendered += '"';
  if (pathBytes.length > visible.length) {
    rendered += `...(+${pathBytes.length - visible.length} bytes)`;
  }
  return rendered;
}

function reportTreeMismatch({ headCommit, headTree, taggedCommit, taggedTree }) {
  const lines = [
    'Replit provenance mismatch diagnostics (hashes and filenames only):',
    `  HEAD commit: ${headCommit}`,
    `  HEAD tree: ${headTree}`,
    `  annotated tag commit: ${taggedCommit}`,
    `  annotated tag tree: ${taggedTree}`,
  ];
  try {
    const changes = parseGitNameStatus(
      captureGitBytes([
        'diff-tree',
        '--no-commit-id',
        '--name-status',
        '-r',
        '--no-renames',
        '-z',
        taggedTree,
        headTree,
        '--',
      ]),
    );
    lines.push(`  tag -> HEAD name-status paths: ${changes.length}`);
    for (const change of changes.slice(0, provenanceDiagnosticMaxEntries)) {
      lines.push(`    ${change.status} ${renderDiagnosticGitPath(change.pathBytes)}`);
    }
    if (changes.length > provenanceDiagnosticMaxEntries) {
      lines.push(`    ... ${changes.length - provenanceDiagnosticMaxEntries} more paths omitted`);
    }
  } catch {
    lines.push('  tag -> HEAD name-status paths: unavailable within bounded diagnostics');
  }
  process.stderr.write(`${lines.join('\n')}\n`);
}

function reportDirtyCheckout() {
  const lines = ['Replit dirty checkout diagnostics (status and filenames only):'];
  const changes = parseGitPorcelainStatus(
    captureGitBytes(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']),
  );

  lines.push(`  index/worktree status paths: ${changes.length}`);
  for (const change of changes.slice(0, provenanceDiagnosticMaxEntries)) {
    lines.push(`    ${change.status} ${renderDiagnosticGitPath(change.pathBytes)}`);
  }
  if (changes.length > provenanceDiagnosticMaxEntries) {
    lines.push(`    ... ${changes.length - provenanceDiagnosticMaxEntries} more paths omitted`);
  }

  process.stderr.write(`${lines.join('\n')}\n`);
}

function normalizeExactReplitAutoscaleOverlay() {
  if (!replitAutoscaleServices.has(service)) return false;
  const status = captureGitBytes([
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--no-renames',
  ]);
  if (!status.equals(replitAutoscaleOverlayStatus)) return false;
  if (
    captureGit(['rev-parse', '--verify', 'HEAD:.replit']) !== replitCanonicalConfigBlob ||
    captureGit(['hash-object', '--', '.replit']) !== replitAutoscaleOverlayBlob ||
    captureGit(['diff', '--summary', '--', '.replit']) !== ''
  ) {
    return false;
  }
  captureGit(['checkout-index', '--force', '--', '.replit']);
  return true;
}

function assertReleaseProvenance({ verifyCheckout }) {
  const expectedCommit = process.env.BB_RUN3_1_RELEASE_COMMIT;
  const expectedTag = process.env.BB_RUN3_1_RELEASE_TAG;
  if (!/^[0-9a-f]{40}$/u.test(expectedCommit ?? '')) {
    throw new TypeError('BB_RUN3_1_RELEASE_COMMIT must be the exact lowercase 40-character commit');
  }
  if (!/^run3-1-replit-founding-household-[0-9a-f]{12}$/u.test(expectedTag ?? '')) {
    throw new TypeError('BB_RUN3_1_RELEASE_TAG must be the immutable Run 3.1 candidate tag');
  }
  if (!expectedTag.endsWith(expectedCommit.slice(0, 12))) {
    throw new TypeError('The Run 3.1 release tag suffix must match the exact release commit');
  }
  if (!verifyCheckout) return;
  const tagReference = `refs/tags/${expectedTag}`;
  if (captureGit(['cat-file', '-t', tagReference]) !== 'tag') {
    throw new TypeError('The Run 3.1 release tag must be an annotated tag object');
  }
  const taggedCommit = captureGit(['rev-parse', '--verify', `${tagReference}^{commit}`]);
  if (taggedCommit !== expectedCommit) {
    throw new TypeError(
      'The Run 3.1 release tag does not resolve to the configured release commit',
    );
  }
  const headCommit = captureGit(['rev-parse', '--verify', 'HEAD^{commit}']);
  const headTree = captureGit(['rev-parse', '--verify', 'HEAD^{tree}']);
  const taggedTree = captureGit(['rev-parse', '--verify', `${tagReference}^{tree}`]);
  if (headTree !== taggedTree) {
    try {
      reportTreeMismatch({ headCommit, headTree, taggedCommit, taggedTree });
    } catch {
      process.stderr.write(
        'Replit provenance mismatch diagnostics unavailable within bounded diagnostics.\n',
      );
    }
    throw new TypeError('The Replit checkout tree does not match the tagged Run 3.1 candidate');
  }
  let checkoutStatus = captureGit(['status', '--porcelain=v1', '--untracked-files=all']);
  if (checkoutStatus !== '') {
    try {
      if (normalizeExactReplitAutoscaleOverlay()) {
        checkoutStatus = captureGit(['status', '--porcelain=v1', '--untracked-files=all']);
        if (checkoutStatus === '') {
          process.stderr.write(
            'Normalized exact Replit Autoscale metadata before clean-checkout verification.\n',
          );
        }
      }
    } catch {
      // Fail closed through the unchanged dirty-checkout rejection below.
    }
  }
  if (checkoutStatus !== '') {
    try {
      reportDirtyCheckout();
    } catch {
      process.stderr.write(
        'Replit dirty checkout diagnostics unavailable within bounded diagnostics.\n',
      );
    }
    throw new TypeError('The Replit checkout contains changes outside the tagged candidate');
  }
}

function dependencyNames(tree) {
  const names = new Set();
  const visit = (dependencies) => {
    for (const [name, dependency] of Object.entries(dependencies ?? {})) {
      names.add(name);
      if (typeof dependency === 'object' && dependency !== null) visit(dependency.dependencies);
    }
  };
  visit(tree.dependencies);
  return names;
}

function exactJsonShape(value, expected) {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(value) &&
      value.length === expected.length &&
      expected.every((item, index) => exactJsonShape(value[index], item))
    );
  }
  if (typeof expected === 'object' && expected !== null) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const actualKeys = Object.keys(value).sort();
    const expectedKeys = Object.keys(expected).sort();
    return (
      exactJsonShape(actualKeys, expectedKeys) &&
      expectedKeys.every((key) => exactJsonShape(value[key], expected[key]))
    );
  }
  return Object.is(value, expected);
}

function hasUnexpectedNpmProblemMetadata(dependencies, reviewedTopLevel = new Set()) {
  if (dependencies === undefined) return false;
  if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) {
    return true;
  }
  for (const [name, dependency] of Object.entries(dependencies)) {
    if (typeof dependency !== 'object' || dependency === null || Array.isArray(dependency)) {
      return true;
    }
    if (
      !reviewedTopLevel.has(name) &&
      dependency.problems !== undefined &&
      (!Array.isArray(dependency.problems) || dependency.problems.length > 0)
    ) {
      return true;
    }
    if (hasUnexpectedNpmProblemMetadata(dependency.dependencies)) return true;
  }
  return false;
}

function reviewNpmProblems(inventory) {
  const problems = inventory.problems;
  if (problems === undefined || (Array.isArray(problems) && problems.length === 0)) {
    return hasUnexpectedNpmProblemMetadata(inventory.dependencies) ? undefined : [];
  }
  if (
    !Array.isArray(problems) ||
    problems.some((problem) => typeof problem !== 'string') ||
    (service !== 'web' && service !== 'hq')
  ) {
    return undefined;
  }

  const artifactNames = Object.keys(reviewedWebOptionalArtifacts).sort();
  const expectedProblems = Object.fromEntries(
    artifactNames.map((name) => {
      const artifact = reviewedWebOptionalArtifacts[name];
      const problem = `extraneous: ${name}@${artifact.version} ${join(
        process.cwd(),
        'node_modules',
        ...name.split('/'),
      )}`;
      return [name, problem];
    }),
  );
  if (!exactJsonShape([...problems].sort(), Object.values(expectedProblems).sort())) {
    return undefined;
  }

  const dependencies = inventory.dependencies;
  if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) {
    return undefined;
  }
  const expectedNodes = {
    '@emnapi/runtime': {
      version: '1.11.3',
      resolved: 'https://registry.npmjs.org/@emnapi/runtime/-/runtime-1.11.3.tgz',
      overridden: false,
      extraneous: true,
      problems: [expectedProblems['@emnapi/runtime']],
      dependencies: {
        tslib: {
          version: '2.8.1',
          resolved: 'https://registry.npmjs.org/tslib/-/tslib-2.8.1.tgz',
          overridden: false,
        },
      },
    },
    '@img/sharp-wasm32': {
      version: '0.35.3',
      resolved: 'https://registry.npmjs.org/@img/sharp-wasm32/-/sharp-wasm32-0.35.3.tgz',
      overridden: false,
      extraneous: true,
      problems: [expectedProblems['@img/sharp-wasm32']],
      dependencies: {
        '@emnapi/runtime': { version: '1.11.3' },
      },
    },
  };
  if (
    artifactNames.some((name) => !exactJsonShape(dependencies[name], expectedNodes[name])) ||
    hasUnexpectedNpmProblemMetadata(dependencies, new Set(artifactNames))
  ) {
    return undefined;
  }

  let lockfile;
  try {
    lockfile = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  } catch {
    return undefined;
  }
  if (
    lockfile.lockfileVersion !== 3 ||
    typeof lockfile.packages !== 'object' ||
    lockfile.packages === null ||
    Array.isArray(lockfile.packages)
  ) {
    return undefined;
  }
  for (const name of artifactNames) {
    const artifact = reviewedWebOptionalArtifacts[name];
    const lockEntry = lockfile.packages[`node_modules/${name}`];
    if (
      typeof lockEntry !== 'object' ||
      lockEntry === null ||
      Array.isArray(lockEntry) ||
      lockEntry.version !== artifact.version ||
      lockEntry.resolved !== artifact.resolved ||
      lockEntry.integrity !== artifact.integrity ||
      lockEntry.optional !== true ||
      lockEntry.dev === true ||
      lockEntry.link === true ||
      !exactJsonShape(lockEntry.dependencies, artifact.lockDependencies)
    ) {
      return undefined;
    }
  }
  return artifactNames;
}

let providerApiPort;
if (mode === 'start') {
  if (process.env.REPLIT_DEPLOYMENT !== '1') {
    throw new TypeError('Production service startup requires REPLIT_DEPLOYMENT=1');
  }
  if (service !== 'worker') {
    const port = Number(process.env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new TypeError('A web-facing Replit service requires a valid PORT');
    }
    if (service === 'api') {
      if (process.env.BB_API_HOST !== '0.0.0.0') {
        throw new TypeError('The Replit API must bind BB_API_HOST=0.0.0.0');
      }
      if (process.env.BB_API_PORT !== undefined && Number(process.env.BB_API_PORT) !== port) {
        throw new TypeError('A configured BB_API_PORT must equal the provider PORT');
      }
      providerApiPort = String(port);
    }
  }
}

assertReleaseProvenance({ verifyCheckout: mode === 'build' });

if (mode === 'build') {
  run([
    'ci',
    '--include=dev',
    '--ignore-scripts',
    '--include-workspace-root',
    '--workspace',
    workspace,
  ]);
  run(['run', 'build', '--workspace', workspace]);
  run([
    'ci',
    '--omit=dev',
    '--ignore-scripts',
    '--include-workspace-root=false',
    '--workspace',
    workspace,
  ]);

  const inventory = captureJson(['ls', '--all', '--omit=dev', '--workspace', workspace, '--json']);
  const reviewedProblems = reviewNpmProblems(inventory);
  if (reviewedProblems === undefined) {
    throw new Error(`The ${service} production dependency graph contains npm problems`);
  }
  if (reviewedProblems.length > 0) {
    process.stdout.write(
      `Reviewed optional npm artifacts: ${reviewedProblems.join(', ')}.\n`,
    );
  }
  const installed = dependencyNames(inventory);
  for (const forbidden of ['@expo/metro', 'expo', 'image-size', 'metro', 'react-native']) {
    if (installed.has(forbidden)) {
      throw new Error(`The ${service} Replit graph unexpectedly includes ${forbidden}`);
    }
  }
  process.stdout.write(
    `Replit ${service} build passed with an isolated production dependency graph.\n`,
  );
} else {
  const childEnvironment =
    service === 'api' ? { ...process.env, BB_API_PORT: providerApiPort } : process.env;
  const child = spawn(npmCommand, [...npmPrefix, 'run', 'start', '--workspace', workspace], {
    cwd: process.cwd(),
    env: childEnvironment,
    stdio: 'inherit',
    shell: false,
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => child.kill(signal));
  }
  child.once('error', (error) => {
    throw error;
  });
  child.once('exit', (code, signal) => {
    if (signal !== null) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}
