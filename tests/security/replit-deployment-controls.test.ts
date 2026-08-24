import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const replitServiceScript = join(root, 'scripts/replit-service.mjs');
const provenanceFixtureRoot = join(root, 'tmp');
const gitIdentity = [
  '-c',
  'user.name=BoomerBuddy tests',
  '-c',
  'user.email=tests@boomerbuddy.invalid',
] as const;

type ProvenanceFixture = {
  directory: string;
  releaseCommit: string;
  tag: string;
};

function runGit(directory: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: directory,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${`${result.stdout ?? ''}${result.stderr ?? ''}`.trim()}`,
    );
  }
  return result.stdout.trim();
}

function commitFixture(directory: string, message: string, extraArgs: string[] = []): string {
  runGit(directory, [
    ...gitIdentity,
    '-c',
    'commit.gpgSign=false',
    'commit',
    ...extraArgs,
    '--message',
    message,
  ]);
  return runGit(directory, ['rev-parse', 'HEAD']);
}

function createAnnotatedTag(directory: string, tag: string, commit: string): void {
  runGit(directory, [
    ...gitIdentity,
    '-c',
    'tag.gpgSign=false',
    'tag',
    '--annotate',
    tag,
    '--message',
    'Run 3.1 candidate',
    commit,
  ]);
}

async function createProvenanceFixture(
  options: { annotated?: boolean } = {},
): Promise<ProvenanceFixture> {
  await mkdir(provenanceFixtureRoot, { recursive: true });
  const directory = await mkdtemp(join(provenanceFixtureRoot, 'replit-provenance-'));
  const binDirectory = join(directory, 'bin');
  await mkdir(binDirectory);
  await Promise.all([
    writeFile(join(directory, 'tracked.txt'), 'candidate tree\n', 'utf8'),
    writeFile(
      join(binDirectory, 'npm'),
      `#!/bin/sh\nif [ "$1" = "ls" ]; then\n  printf '%s\\n' '{"dependencies":{}}'\nfi\nexit 0\n`,
      'utf8',
    ),
    writeFile(
      join(binDirectory, 'npm.cmd'),
      '@echo off\r\nif "%~1"=="ls" echo {"dependencies":{}}\r\nexit /b 0\r\n',
      'utf8',
    ),
  ]);
  await chmod(join(binDirectory, 'npm'), 0o755);
  runGit(directory, ['init']);
  runGit(directory, ['config', 'core.autocrlf', 'false']);
  runGit(directory, ['add', '--all']);
  const releaseCommit = commitFixture(directory, 'Release candidate');
  const tag = `run3-1-replit-founding-household-${releaseCommit.slice(0, 12)}`;
  if (options.annotated === false) runGit(directory, ['tag', tag, releaseCommit]);
  else createAnnotatedTag(directory, tag, releaseCommit);
  return { directory, releaseCommit, tag };
}

function runFixtureBuild(fixture: ProvenanceFixture) {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    BB_REPLIT_SERVICE: 'worker',
    BB_RUN3_1_RELEASE_COMMIT: fixture.releaseCommit,
    BB_RUN3_1_RELEASE_TAG: fixture.tag,
    NODE_ENV: 'production',
    REPLIT_DEPLOYMENT: '1',
  };
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  environment[pathKey] =
    `${join(fixture.directory, 'bin')}${delimiter}${environment[pathKey] ?? ''}`;
  return spawnSync(process.execPath, [replitServiceScript, 'build'], {
    cwd: fixture.directory,
    encoding: 'utf8',
    env: environment,
    shell: false,
  });
}

function commandOutput(result: ReturnType<typeof runFixtureBuild>): string {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

describe('Run 3.1 Replit deployment controls', () => {
  it('uses one exact service selector and excludes the mobile build graph', async () => {
    const source = await readFile(join(root, 'scripts/replit-service.mjs'), 'utf8');
    const replit = await readFile(join(root, '.replit'), 'utf8');
    const worker = await readFile(join(root, 'apps/worker/src/server.ts'), 'utf8');
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const webPackage = JSON.parse(await readFile(join(root, 'apps/web/package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const hqPackage = JSON.parse(await readFile(join(root, 'apps/hq/package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(replit).toContain('build = "npm run replit:build"');
    expect(replit).toContain('run = "npm run replit:start"');
    expect(replit).toContain('enabledForHosting = false');
    expect(replit).not.toContain('ignorePorts');
    expect(replit).not.toContain('[[ports]]');
    expect(replit).not.toContain('npm run dev');
    expect(packageJson.scripts['replit:build']).toBe('node scripts/replit-service.mjs build');
    expect(packageJson.scripts['replit:start']).toBe('node scripts/replit-service.mjs start');
    expect(webPackage.scripts.start).toBe('next start');
    expect(hqPackage.scripts.start).toBe('next start');
    expect(source).toContain("['@expo/metro', 'expo', 'image-size', 'metro', 'react-native']");
    expect(source).toContain("'--include-workspace-root=false'");
    expect(source).toContain("process.env.REPLIT_DEPLOYMENT !== '1'");
    expect(source).toContain('const tagReference = `refs/tags/${expectedTag}`');
    expect(source).toContain("captureGit(['cat-file', '-t', tagReference])");
    expect(source).toContain("captureGit(['rev-parse', '--verify', 'HEAD^{tree}'])");
    expect(source).toContain('`${tagReference}^{tree}`');
    expect(source).toContain("captureGit(['status', '--porcelain=v1', '--untracked-files=all'])");
    expect(source).toContain('expectedTag.endsWith(expectedCommit.slice(0, 12))');
    expect(source).toContain('{ ...process.env, BB_API_PORT: providerApiPort }');
    expect(source).toContain('A configured BB_API_PORT must equal the provider PORT');
    expect(worker).toContain('new ProductionIdentityRepository(database).assertFounderBinding');
    expect(worker).toContain('startWorkerHealthServer(process.env)');
    expect(worker.indexOf('assertFounderBinding')).toBeLessThan(worker.indexOf('const jobs ='));
    expect(worker.indexOf('const jobs =')).toBeLessThan(
      worker.indexOf('startWorkerHealthServer(process.env)'),
    );
    expect(worker.indexOf('startWorkerHealthServer(process.env)')).toBeLessThan(
      worker.indexOf('await worker.start()'),
    );
    expect(worker.indexOf('await closeWorkerHealthServer(healthServer)')).toBeLessThan(
      worker.indexOf('await database.close()'),
    );
  });

  it('fails closed for missing, invalid, or nonproduction service selection', () => {
    for (const environment of [
      { NODE_ENV: 'production' },
      { BB_REPLIT_SERVICE: 'mobile', NODE_ENV: 'production' },
      { BB_REPLIT_SERVICE: 'web', NODE_ENV: 'development' },
    ]) {
      const result = spawnSync(process.execPath, ['scripts/replit-service.mjs', 'start'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, ...environment },
        shell: false,
      });
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).not.toContain('npm run start');
    }
  });

  it('requires deployment provenance and exact API host/port binding before startup', () => {
    for (const service of ['web', 'hq']) {
      const missingPort = spawnSync(process.execPath, ['scripts/replit-service.mjs', 'start'], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          BB_REPLIT_SERVICE: service,
          NODE_ENV: 'production',
          REPLIT_DEPLOYMENT: '1',
        },
        shell: false,
      });
      expect(missingPort.status).not.toBe(0);
      expect(`${missingPort.stdout}${missingPort.stderr}`).toContain('requires a valid PORT');
    }

    const missingDeployment = spawnSync(process.execPath, ['scripts/replit-service.mjs', 'start'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        BB_REPLIT_SERVICE: 'api',
        NODE_ENV: 'production',
        PORT: '3000',
        BB_API_HOST: '0.0.0.0',
        BB_API_PORT: '3000',
      },
      shell: false,
    });
    expect(missingDeployment.status).not.toBe(0);
    expect(`${missingDeployment.stdout}${missingDeployment.stderr}`).toContain(
      'REPLIT_DEPLOYMENT=1',
    );

    const wrongBinding = spawnSync(process.execPath, ['scripts/replit-service.mjs', 'start'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        BB_REPLIT_SERVICE: 'api',
        NODE_ENV: 'production',
        PORT: '3000',
        REPLIT_DEPLOYMENT: '1',
        BB_API_HOST: '127.0.0.1',
        BB_API_PORT: '3000',
      },
      shell: false,
    });
    expect(wrongBinding.status).not.toBe(0);
    expect(`${wrongBinding.stdout}${wrongBinding.stderr}`).toContain('BB_API_HOST=0.0.0.0');

    const wrongPort = spawnSync(process.execPath, ['scripts/replit-service.mjs', 'start'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        BB_REPLIT_SERVICE: 'api',
        NODE_ENV: 'production',
        PORT: '3107',
        REPLIT_DEPLOYMENT: '1',
        BB_API_HOST: '0.0.0.0',
        BB_API_PORT: '3000',
      },
      shell: false,
    });
    expect(wrongPort.status).not.toBe(0);
    expect(`${wrongPort.stdout}${wrongPort.stderr}`).toContain(
      'A configured BB_API_PORT must equal the provider PORT',
    );

    const derivedPort = spawnSync(process.execPath, ['scripts/replit-service.mjs', 'start'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        BB_REPLIT_SERVICE: 'api',
        NODE_ENV: 'production',
        PORT: '3107',
        REPLIT_DEPLOYMENT: '1',
        BB_API_HOST: '0.0.0.0',
      },
      shell: false,
    });
    expect(derivedPort.status).not.toBe(0);
    expect(`${derivedPort.stdout}${derivedPort.stderr}`).toContain(
      'BB_RUN3_1_RELEASE_COMMIT must be the exact',
    );
    expect(`${derivedPort.stdout}${derivedPort.stderr}`).not.toContain(
      'A configured BB_API_PORT must equal the provider PORT',
    );
  });

  it('rejects a missing immutable tag or a tag suffix that does not match the commit', () => {
    const head = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      shell: false,
    }).stdout.trim();
    const missingCommit = '1'.repeat(40);
    const missingTag = spawnSync(process.execPath, ['scripts/replit-service.mjs', 'build'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        BB_REPLIT_SERVICE: 'worker',
        BB_RUN3_1_RELEASE_COMMIT: missingCommit,
        BB_RUN3_1_RELEASE_TAG: `run3-1-replit-founding-household-${missingCommit.slice(0, 12)}`,
        NODE_ENV: 'production',
        REPLIT_DEPLOYMENT: '1',
      },
      shell: false,
    });
    expect(missingTag.status).not.toBe(0);
    expect(`${missingTag.stdout}${missingTag.stderr}`).toContain('git cat-file -t refs/tags/');

    const wrongSuffix = spawnSync(process.execPath, ['scripts/replit-service.mjs', 'start'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        BB_REPLIT_SERVICE: 'worker',
        BB_RUN3_1_RELEASE_COMMIT: head,
        BB_RUN3_1_RELEASE_TAG: 'run3-1-replit-founding-household-000000000000',
        NODE_ENV: 'production',
        REPLIT_DEPLOYMENT: '1',
      },
      shell: false,
    });
    expect(wrongSuffix.status).not.toBe(0);
    expect(`${wrongSuffix.stdout}${wrongSuffix.stderr}`).toContain('release tag suffix must match');
  });

  it('accepts a clean Replit snapshot commit with the exact annotated candidate tree', async () => {
    const fixture = await createProvenanceFixture();
    try {
      const snapshotCommit = commitFixture(fixture.directory, 'Replit snapshot', ['--allow-empty']);
      expect(snapshotCommit).not.toBe(fixture.releaseCommit);
      expect(runGit(fixture.directory, ['rev-parse', 'HEAD^{tree}'])).toBe(
        runGit(fixture.directory, ['rev-parse', `refs/tags/${fixture.tag}^{tree}`]),
      );

      const result = runFixtureBuild(fixture);
      expect(result.status, commandOutput(result)).toBe(0);
      expect(commandOutput(result)).toContain(
        'Replit worker build passed with an isolated production dependency graph.',
      );
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it('rejects a clean snapshot commit whose tracked tree differs from the candidate', async () => {
    const fixture = await createProvenanceFixture();
    try {
      await writeFile(join(fixture.directory, 'tracked.txt'), 'changed tree\n', 'utf8');
      runGit(fixture.directory, ['add', 'tracked.txt']);
      commitFixture(fixture.directory, 'Changed snapshot tree');

      const result = runFixtureBuild(fixture);
      expect(result.status).not.toBe(0);
      expect(commandOutput(result)).toContain(
        'The Replit checkout tree does not match the tagged Run 3.1 candidate',
      );
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it.each(['staged', 'unstaged', 'untracked'] as const)(
    'rejects %s nonignored checkout content',
    async (contentState) => {
      const fixture = await createProvenanceFixture();
      try {
        if (contentState === 'untracked') {
          await writeFile(join(fixture.directory, 'untracked.txt'), 'not in candidate\n', 'utf8');
        } else {
          await writeFile(
            join(fixture.directory, 'tracked.txt'),
            `${contentState} change\n`,
            'utf8',
          );
          if (contentState === 'staged') runGit(fixture.directory, ['add', 'tracked.txt']);
        }
        expect(
          runGit(fixture.directory, ['status', '--porcelain=v1', '--untracked-files=all']),
        ).not.toBe('');

        const result = runFixtureBuild(fixture);
        expect(result.status).not.toBe(0);
        expect(commandOutput(result)).toContain(
          'The Replit checkout contains changes outside the tagged candidate',
        );
      } finally {
        await rm(fixture.directory, { force: true, recursive: true });
      }
    },
  );

  it('rejects a lightweight release tag even when it resolves to the configured commit', async () => {
    const fixture = await createProvenanceFixture({ annotated: false });
    try {
      const result = runFixtureBuild(fixture);
      expect(result.status).not.toBe(0);
      expect(commandOutput(result)).toContain(
        'The Run 3.1 release tag must be an annotated tag object',
      );
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it('rejects an annotated tag that resolves to a commit other than the configured release', async () => {
    const fixture = await createProvenanceFixture();
    try {
      runGit(fixture.directory, ['tag', '--delete', fixture.tag]);
      const otherCommit = commitFixture(fixture.directory, 'Other commit', ['--allow-empty']);
      createAnnotatedTag(fixture.directory, fixture.tag, otherCommit);
      expect(otherCommit).not.toBe(fixture.releaseCommit);

      const result = runFixtureBuild(fixture);
      expect(result.status).not.toBe(0);
      expect(commandOutput(result)).toContain(
        'The Run 3.1 release tag does not resolve to the configured release commit',
      );
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });
});
