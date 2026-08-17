import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const source = resolve(process.cwd());
const candidateRef = process.env.BB_CANDIDATE_REF;
const expectedCommit = process.env.BB_CANDIDATE_COMMIT?.toLowerCase();
if (!/^run3-local-candidate-[0-9a-f]{12}$/u.test(candidateRef ?? '')) {
  throw new TypeError('BB_CANDIDATE_REF must be an immutable Run 3 candidate tag');
}
if (!/^[0-9a-f]{40}$/u.test(expectedCommit ?? '')) {
  throw new TypeError('BB_CANDIDATE_COMMIT must be the exact 40-character commit for the tag');
}
if (candidateRef.slice(-12) !== expectedCommit.slice(0, 12)) {
  throw new TypeError('BB_CANDIDATE_REF suffix must match BB_CANDIDATE_COMMIT');
}
const temporaryRoot = await mkdtemp(join(tmpdir(), 'boomerbuddy-clean-clone-'));
const clone = join(temporaryRoot, 'repository');
const npm = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
const npmPrefix = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd'] : [];

function run(command, args, cwd = clone, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: false });
  if (result.status !== 0)
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
}

function available(command, args, cwd = clone) {
  return spawnSync(command, args, { cwd, stdio: 'ignore', shell: false }).status === 0;
}

function capture(command, args, cwd = clone) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false });
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
  }
  return result.stdout.trim();
}

const continuityEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  BB_DATABASE_DRIVER: 'pglite',
  // PGlite creates the database directory itself, but not an absent parent such as `.data`.
  BB_PGLITE_PATH: join(temporaryRoot, 'continuity-database'),
  BB_RUN_MIGRATIONS: 'true',
  BB_SEED_DEMO: 'false',
  BB_ALLOW_DEV_IDENTITY: 'true',
  BB_CUSTOMER_ORIGINS: 'http://127.0.0.1:3000',
  BB_HQ_ORIGINS: 'http://127.0.0.1:3001',
  BB_SESSION_SECRET: 'clean-clone-session-secret-for-local-proof-only',
  BB_ARTIFACT_KEY_BASE64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  BB_FINGERPRINT_KEY_BASE64: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
  BB_SAFE_WORD_PEPPER: 'clean-clone-safe-word-pepper',
  BB_STRIPE_MODE: 'disabled',
};

try {
  run('git', ['clone', '--no-local', '--no-checkout', source, clone], source);
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
    throw new Error('Candidate checkout is not clean before reconstruction');
  }
  run(npm, [...npmPrefix, 'ci']);
  run('node', ['scripts/verify-portability.mjs']);
  run(npm, [...npmPrefix, 'run', 'verify:runtime-deps']);
  run(npm, [...npmPrefix, 'run', 'db:migrate'], clone, continuityEnvironment);
  run(npm, [...npmPrefix, 'run', 'db:seed'], clone, continuityEnvironment);
  run(npm, [...npmPrefix, 'run', 'typecheck']);
  run(npm, [...npmPrefix, 'test']);
  run(npm, [...npmPrefix, 'run', 'build']);
  run(npm, [...npmPrefix, 'run', 'verify:production-ui']);
  run(npm, [...npmPrefix, 'run', 'build', '-w', '@boomerbuddy/worker']);
  const dockerAvailable =
    available('docker', ['buildx', 'version']) &&
    available('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (dockerAvailable) {
    run('docker', [
      'buildx',
      'build',
      '--output',
      `type=oci,dest=${join(temporaryRoot, 'boomerbuddy-run3-candidate.oci.tar')}`,
      '.',
    ]);
    process.stdout.write('Clean-clone OCI artifact build passed.\n');
  } else if (process.env.BB_REQUIRE_OCI_BUILD === 'true') {
    throw new Error('OCI build is required but a working Docker Buildx daemon is unavailable');
  } else {
    process.stdout.write(
      'OCI artifact build BLOCKED locally: a working Docker Buildx daemon is unavailable; the CI container job remains required external evidence.\n',
    );
  }
  if (capture('git', ['status', '--porcelain']) !== '') {
    throw new Error('Candidate reconstruction mutated the frozen checkout');
  }
  process.stdout.write(
    `Clean-clone reconstruction passed for ${candidateRef} at ${expectedCommit}.\n`,
  );
} finally {
  const resolvedTemporaryRoot = resolve(temporaryRoot);
  if (
    resolvedTemporaryRoot.startsWith(resolve(tmpdir())) &&
    resolvedTemporaryRoot.includes('boomerbuddy-clean-clone-')
  ) {
    await rm(resolvedTemporaryRoot, { recursive: true, force: true });
  }
}
