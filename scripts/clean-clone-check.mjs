import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const source = resolve(process.cwd());
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

const continuityEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  BB_DATABASE_DRIVER: 'pglite',
  BB_PGLITE_PATH: join(clone, '.data', 'continuity'),
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
  run('git', ['clone', '--no-local', source, clone], source);
  run(npm, [...npmPrefix, 'ci']);
  run('node', ['scripts/verify-portability.mjs']);
  run(npm, [...npmPrefix, 'run', 'db:migrate'], clone, continuityEnvironment);
  run(npm, [...npmPrefix, 'run', 'db:seed'], clone, continuityEnvironment);
  run(npm, [...npmPrefix, 'run', 'typecheck']);
  run(npm, [...npmPrefix, 'test']);
  run(npm, [...npmPrefix, 'run', 'build']);
  run(npm, [...npmPrefix, 'run', 'build', '-w', '@boomerbuddy/worker']);
  const dockerAvailable =
    available('docker', ['buildx', 'version']) &&
    available('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (dockerAvailable) {
    run('docker', [
      'buildx',
      'build',
      '--output',
      `type=oci,dest=${join(temporaryRoot, 'boomerbuddy-run2.oci.tar')}`,
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
  process.stdout.write(
    'Clean-clone source/install/migrate/seed/test/build reconstruction passed.\n',
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
