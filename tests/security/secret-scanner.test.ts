import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

  it.each([
    {
      file: 'AuthKey_SYNTHETIC.p8',
      ignoredPattern: '*.p8',
      contents: Buffer.from(`GOC${'SPX-'}${'B'.repeat(32)}\n`, 'utf8'),
    },
    {
      file: 'synthetic.mobileprovision',
      ignoredPattern: '*.mobileprovision',
      contents: Buffer.from([0x30, 0x82, 0x00, 0xff, 0x10, 0x00, 0x7f]),
    },
  ])('detects an ignored, untracked $file artifact', async ({ file, ignoredPattern, contents }) => {
    const directory = await mkdtemp(join(tmpdir(), 'boomerbuddy-secret-scan-'));
    temporaryDirectories.push(directory);
    expect(run('git', ['init', '--quiet'], directory).status).toBe(0);

    await writeFile(join(directory, '.gitignore'), `${ignoredPattern}\n`, 'utf8');
    await writeFile(join(directory, file), contents);
    expect(run('git', ['add', '.gitignore'], directory).status).toBe(0);
    expect(run('git', ['status', '--short', '--ignored'], directory).stdout).toContain(
      `!! ${file}`,
    );

    const scanner = resolve('scripts/verify-no-secrets.mjs');
    const result = run(process.execPath, [scanner], directory);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(file);
    expect(result.stderr).toContain('forbidden secret-bearing filename');
    expect(result.stderr).not.toContain('GOCSPX-');
  });

  it.each([
    'credentials.json',
    'eas-credentials-production.json',
    'GoogleService-Info.plist',
    'google-services.json',
    'service-account-production.json',
    'my-service-account-production.json',
    'project-firebase-adminsdk-abc-123.json',
    'client_secret_synthetic.json',
    'provider-credentials.production.json',
  ])('rejects the credential-bearing provider filename %s', async (file) => {
    const directory = await mkdtemp(join(tmpdir(), 'boomerbuddy-secret-scan-'));
    temporaryDirectories.push(directory);
    expect(run('git', ['init', '--quiet'], directory).status).toBe(0);

    await writeFile(join(directory, file), '{}\n', 'utf8');
    expect(run('git', ['add', file], directory).status).toBe(0);

    const scanner = resolve('scripts/verify-no-secrets.mjs');
    const result = run(process.execPath, [scanner], directory);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(file);
    expect(result.stderr).toContain('forbidden secret-bearing filename');
  });

  it('detects a JSON-escaped private key in an arbitrarily named provider export', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'boomerbuddy-secret-scan-'));
    temporaryDirectories.push(directory);
    expect(run('git', ['init', '--quiet'], directory).status).toBe(0);

    const privateKey = [
      '-----BEGIN PRIVATE KEY-----',
      'A'.repeat(64),
      'B'.repeat(64),
      '-----END PRIVATE KEY-----',
      '',
    ].join('\n');
    const file = 'project-0123456789abcdef.json';
    await writeFile(
      join(directory, file),
      `${JSON.stringify({ private_key: privateKey })}\n`,
      'utf8',
    );
    expect(run('git', ['add', file], directory).status).toBe(0);

    const scanner = resolve('scripts/verify-no-secrets.mjs');
    const result = run(process.execPath, [scanner], directory);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(file);
    expect(result.stderr).toContain('JSON-escaped private key');
    expect(result.stderr).not.toContain('A'.repeat(64));
  });

  it('recursively detects a credential artifact inside a fully ignored directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'boomerbuddy-secret-scan-'));
    temporaryDirectories.push(directory);
    expect(run('git', ['init', '--quiet'], directory).status).toBe(0);

    const nestedDirectory = join(directory, '.expo', 'provider-export');
    const file = '.expo/provider-export/credentials.json';
    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(join(directory, '.gitignore'), '.expo/\n', 'utf8');
    await writeFile(join(directory, file), '{}\n', 'utf8');
    expect(run('git', ['add', '.gitignore'], directory).status).toBe(0);
    expect(run('git', ['status', '--short', '--ignored'], directory).stdout).toContain('!! .expo/');

    const scanner = resolve('scripts/verify-no-secrets.mjs');
    const result = run(process.execPath, [scanner], directory);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(file);
    expect(result.stderr).toContain('forbidden secret-bearing filename');
  });

  it('allows ordinary public mobile and store metadata filenames', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'boomerbuddy-secret-scan-'));
    temporaryDirectories.push(directory);
    expect(run('git', ['init', '--quiet'], directory).status).toBe(0);

    for (const file of [
      'app.json',
      'eas.json',
      'store-metadata.json',
      'public-provider-config.json',
    ]) {
      await writeFile(join(directory, file), '{}\n', 'utf8');
    }
    expect(run('git', ['add', '.'], directory).status).toBe(0);

    const scanner = resolve('scripts/verify-no-secrets.mjs');
    const result = run(process.execPath, [scanner], directory);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('High-confidence secret scan passed');
    expect(result.stderr).toBe('');
  });
});
