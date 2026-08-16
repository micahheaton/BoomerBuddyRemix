import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const source = process.env.BB_CONTINUITY_GIT_URL;
if (
  source === undefined ||
  source.trim() === '' ||
  /replit/iu.test(source) ||
  !(source.startsWith('https://') || source.startsWith('ssh://') || source.startsWith('git@'))
) {
  throw new TypeError('BB_CONTINUITY_GIT_URL must identify a non-Replit external Git remote');
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

try {
  const cloned = spawnSync('git', ['clone', source, clone], {
    cwd: temporaryRoot,
    stdio: 'inherit',
    shell: false,
  });
  if (cloned.status !== 0) throw new Error('External source recovery failed');
  run(npm, [...npmPrefix, 'ci']);
  run('node', ['scripts/verify-portability.mjs']);
  run(npm, [...npmPrefix, 'run', 'typecheck']);
  run(npm, [...npmPrefix, 'test']);
  run(npm, [...npmPrefix, 'run', 'build']);
  run(npm, [...npmPrefix, 'run', 'build', '-w', '@boomerbuddy/worker']);
  process.stdout.write(
    `${JSON.stringify({
      status: 'partial_source_build_proof_only',
      sourceRecoveredOutsideReplit: true,
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
