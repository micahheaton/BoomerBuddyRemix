import { mkdtemp, rm } from 'node:fs/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';

const source = process.env.BB_CONTINUITY_GIT_URL;
const candidateRef = process.env.BB_CONTINUITY_GIT_REF;
const expectedCommit = process.env.BB_CONTINUITY_GIT_COMMIT?.toLowerCase();
function isLoopbackHostname(value) {
  const hostname = value
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (isIP(hostname) === 4) return hostname === '0.0.0.0' || hostname.split('.')[0] === '127';
  if (isIP(hostname) === 6) {
    return (
      hostname === '::' ||
      hostname === '0:0:0:0:0:0:0:0' ||
      hostname === '::1' ||
      hostname === '0:0:0:0:0:0:0:1' ||
      /^::ffff:127(?:\.[0-9]{1,3}){3}$/u.test(hostname) ||
      /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/u.test(hostname)
    );
  }
  return false;
}

function isExternalGitRemoteWithoutEmbeddedCredentials(value) {
  if (value.startsWith('git@')) {
    const match = /^git@([A-Za-z0-9.-]+):([A-Za-z0-9._~/-]+)$/u.exec(value);
    return match !== null && !isLoopbackHostname(match[1]);
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'ssh:') &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      url.hostname !== '' &&
      !isLoopbackHostname(url.hostname) &&
      url.pathname !== '' &&
      url.pathname !== '/'
    );
  } catch {
    return false;
  }
}
if (
  source === undefined ||
  source.trim() !== source ||
  /replit/iu.test(source) ||
  !isExternalGitRemoteWithoutEmbeddedCredentials(source)
) {
  throw new TypeError(
    'BB_CONTINUITY_GIT_URL must identify a non-Replit, non-loopback external Git remote URL without embedded credentials',
  );
}
if (!/^run3-local-candidate-[0-9a-f]{12}$/u.test(candidateRef ?? '')) {
  throw new TypeError('BB_CONTINUITY_GIT_REF must be an immutable Run 3 candidate tag');
}
if (!/^[0-9a-f]{40}$/u.test(expectedCommit ?? '')) {
  throw new TypeError('BB_CONTINUITY_GIT_COMMIT must be the exact 40-character commit for the tag');
}
if (candidateRef.slice(-12) !== expectedCommit.slice(0, 12)) {
  throw new TypeError('BB_CONTINUITY_GIT_REF suffix must match BB_CONTINUITY_GIT_COMMIT');
}
const temporaryRoot = await mkdtemp(join(tmpdir(), 'boomerbuddy-loss-drill-'));
const clone = join(temporaryRoot, 'repository');
const npm = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
const npmPrefix = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd'] : [];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: clone, stdio: 'inherit', shell: false });
  if (result.status !== 0)
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: clone,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
  }
  return result.stdout.trim();
}

try {
  const cloned = spawnSync('git', ['clone', '--no-checkout', source, clone], {
    cwd: temporaryRoot,
    stdio: 'inherit',
    shell: false,
  });
  if (cloned.status !== 0) throw new Error('External source recovery failed');
  const tagCommit = capture('git', [
    'rev-parse',
    '--verify',
    `refs/tags/${candidateRef}^{commit}`,
  ]).toLowerCase();
  if (tagCommit !== expectedCommit) {
    throw new Error(`Candidate tag resolved to ${tagCommit}, expected ${expectedCommit}`);
  }
  run('git', ['checkout', '--detach', tagCommit]);
  const checkedOutCommit = capture('git', ['rev-parse', 'HEAD']).toLowerCase();
  if (checkedOutCommit !== expectedCommit) {
    throw new Error(`Candidate tag resolved to ${checkedOutCommit}, expected ${expectedCommit}`);
  }
  if (capture('git', ['status', '--porcelain']) !== '') {
    throw new Error('Recovered candidate checkout is not clean');
  }
  run(npm, [...npmPrefix, 'ci']);
  run('node', ['scripts/verify-portability.mjs']);
  run(npm, [...npmPrefix, 'run', 'verify:runtime-deps']);
  run(npm, [...npmPrefix, 'run', 'typecheck']);
  run(npm, [...npmPrefix, 'test']);
  run(npm, [...npmPrefix, 'run', 'build']);
  run(npm, [...npmPrefix, 'run', 'verify:production-ui']);
  run(npm, [...npmPrefix, 'run', 'build', '-w', '@boomerbuddy/worker']);
  if (capture('git', ['status', '--porcelain']) !== '') {
    throw new Error('Recovered candidate reconstruction mutated the frozen checkout');
  }
  process.stdout.write(
    `${JSON.stringify({
      status: 'partial_source_build_proof_only',
      candidateRef,
      candidateCommit: expectedCommit,
      sourceUrlExcludedReplitMarkerAndLoopback: true,
      sourceUrlContainedNoEmbeddedCredentials: true,
      databaseRestoreProven: false,
      objectRestoreProven: false,
      dnsCutoverProven: false,
      mobileSigningProven: false,
    })}\n`,
  );
} finally {
  const resolvedTemporaryRoot = resolve(temporaryRoot);
  if (
    resolvedTemporaryRoot.startsWith(resolve(tmpdir())) &&
    resolvedTemporaryRoot.includes('boomerbuddy-loss-drill-')
  ) {
    await rm(resolvedTemporaryRoot, { recursive: true, force: true });
  }
}
