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

function run(command, args, cwd = clone) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false });
  if (result.status !== 0)
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
}

try {
  run('git', ['clone', '--no-local', source, clone], source);
  run(npm, [...npmPrefix, 'ci']);
  run('node', ['scripts/verify-portability.mjs']);
  run(npm, [...npmPrefix, 'run', 'typecheck']);
  run(npm, [...npmPrefix, 'test']);
  run(npm, [...npmPrefix, 'run', 'build']);
  run(npm, [...npmPrefix, 'run', 'build', '-w', '@boomerbuddy/worker']);
  process.stdout.write('Clean-clone source/install/test/build reconstruction passed.\n');
} finally {
  const resolvedTemporaryRoot = resolve(temporaryRoot);
  if (
    resolvedTemporaryRoot.startsWith(resolve(tmpdir())) &&
    resolvedTemporaryRoot.includes('boomerbuddy-clean-clone-')
  ) {
    await rm(resolvedTemporaryRoot, { recursive: true, force: true });
  }
}
