import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

function run(command: string, args: readonly string[], cwd: string) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('repository secret scanner', () => {
  it('detects a Google OAuth client secret without printing its value', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'boomerbuddy-secret-scan-'));
    temporaryDirectories.push(directory);
    expect(run('git', ['init', '--quiet'], directory).status).toBe(0);

    const secret = `GOC${'SPX-'}${'A'.repeat(32)}`;
    await writeFile(join(directory, 'credential.txt'), `${secret}\n`, 'utf8');
    expect(run('git', ['add', 'credential.txt'], directory).status).toBe(0);

    const scanner = resolve('scripts/verify-no-secrets.mjs');
    const result = run(process.execPath, [scanner], directory);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Google OAuth client secret');
    expect(result.stderr).not.toContain(secret);
    expect(result.stdout).not.toContain(secret);
  });
});
