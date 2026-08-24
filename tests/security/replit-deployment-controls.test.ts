import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const replitServiceScript = join(root, 'scripts/replit-service.mjs');
const provenanceFixtureRoot = join(root, 'tmp');
const canonicalReplitConfig = [
  'entrypoint = "scripts/replit-service.mjs"',
  'modules = ["nodejs-22"]',
  'run = "npm run replit:start"',
  '',
  '[packager.features]',
  'enabledForHosting = false',
  '',
  '[deployment]',
  'build = "npm run replit:build"',
  'run = "npm run replit:start"',
  '',
  '',
].join('\n');
const autoscaleReplitConfig = canonicalReplitConfig.replace(
  '[deployment]\nbuild = "npm run replit:build"\nrun = "npm run replit:start"\n',
  '[deployment]\nbuild = "npm run replit:build"\nrun = "npm run replit:start"\ndeploymentTarget = "cloudrun"\n',
);

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
  options: {
    annotated?: boolean;
    inventory?: (directory: string) => Record<string, unknown>;
    lockfile?: () => Record<string, unknown>;
  } = {},
): Promise<ProvenanceFixture> {
  await mkdir(provenanceFixtureRoot, { recursive: true });
  const directory = await mkdtemp(join(provenanceFixtureRoot, 'replit-provenance-'));
  const binDirectory = join(directory, 'bin');
  await mkdir(binDirectory);
  const inventoryJson = JSON.stringify(options.inventory?.(directory) ?? { dependencies: {} });
  const lockfileJson = `${JSON.stringify(
    options.lockfile?.() ?? { lockfileVersion: 3, packages: {} },
    null,
    2,
  )}\n`;
  if (inventoryJson.includes("'")) {
    throw new Error('The test npm inventory cannot contain a single quote');
  }
  await Promise.all([
    writeFile(join(directory, '.replit'), canonicalReplitConfig, 'utf8'),
    writeFile(join(directory, 'package-lock.json'), lockfileJson, 'utf8'),
    writeFile(join(directory, 'tracked.txt'), 'candidate tree\n', 'utf8'),
    writeFile(
      join(binDirectory, 'npm'),
      `#!/bin/sh\nif [ "$1" = "ls" ]; then\n  printf '%s\\n' '${inventoryJson}'\nfi\nexit 0\n`,
      'utf8',
    ),
    writeFile(
      join(binDirectory, 'npm.cmd'),
      `@echo off\r\nif "%~1"=="ls" echo ${inventoryJson}\r\nexit /b 0\r\n`,
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

function runFixtureBuild(
  fixture: ProvenanceFixture,
  service: 'api' | 'hq' | 'web' | 'worker' = 'worker',
) {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    BB_REPLIT_SERVICE: service,
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

function reviewedOptionalInventory(
  directory: string,
  options: { runtimeVersion?: string; sharpPath?: string } = {},
): Record<string, unknown> {
  const runtimeVersion = options.runtimeVersion ?? '1.11.3';
  const runtimePath = join(directory, 'node_modules', '@emnapi', 'runtime');
  const sharpPath =
    options.sharpPath ?? join(directory, 'node_modules', '@img', 'sharp-wasm32');
  const runtimeProblem = `extraneous: @emnapi/runtime@${runtimeVersion} ${runtimePath}`;
  const sharpProblem = `extraneous: @img/sharp-wasm32@0.35.3 ${sharpPath}`;
  return {
    problems: [runtimeProblem, sharpProblem],
    dependencies: {
      '@emnapi/runtime': {
        version: runtimeVersion,
        resolved: 'https://registry.npmjs.org/@emnapi/runtime/-/runtime-1.11.3.tgz',
        overridden: false,
        extraneous: true,
        problems: [runtimeProblem],
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
        problems: [sharpProblem],
        dependencies: {
          '@emnapi/runtime': { version: runtimeVersion },
        },
      },
    },
  };
}

function reviewedOptionalLockfile(): Record<string, unknown> {
  return {
    lockfileVersion: 3,
    packages: {
      'node_modules/@emnapi/runtime': {
        version: '1.11.3',
        resolved: 'https://registry.npmjs.org/@emnapi/runtime/-/runtime-1.11.3.tgz',
        integrity:
          'sha512-Xz4Tpyki7XyrpbUK1jR1AhdAdaXyhhY4lZ3neLodmhpuWfy2PAQN5B46sAiU4liOXGLkHypn/qU+jvfWSCYYLA==',
        optional: true,
        dependencies: { tslib: '^2.4.0' },
      },
      'node_modules/@img/sharp-wasm32': {
        version: '0.35.3',
        resolved: 'https://registry.npmjs.org/@img/sharp-wasm32/-/sharp-wasm32-0.35.3.tgz',
        integrity:
          'sha512-cZ0XkcYGpHZkqW6iCkqTcmUC0CD9DhD5d/qeZlZkfRBn6GnHniZXLUo5+9xw8Iv76YE6LQFN9YNBlKREcCG76w==',
        optional: true,
        dependencies: { '@emnapi/runtime': '^1.11.1' },
      },
    },
  };
}

describe('Run 3.1 Replit deployment controls', () => {
  it('uses one exact service selector and excludes the mobile build graph', async () => {
    const source = await readFile(join(root, 'scripts/replit-service.mjs'), 'utf8');
    const replit = await readFile(join(root, '.replit'), 'utf8');
    const worker = await readFile(join(root, 'apps/worker/src/server.ts'), 'utf8');
    const workerHealth = await readFile(join(root, 'apps/worker/src/health-server.ts'), 'utf8');
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
    expect(source).toContain('const provenanceDiagnosticMaxBuffer = 1024 * 1024');
    expect(source).toContain('const provenanceDiagnosticMaxEntries = 50');
    expect(source).toContain('const provenanceDiagnosticMaxPathBytes = 256');
    expect(source).toContain("'--no-renames'");
    expect(source).toContain("Buffer.from(' M .replit\\0', 'utf8')");
    expect(source).toContain("'04697d2c8f4a23f4d89edff84930bbd25ede8be3'");
    expect(source).toContain("'7d305e8966bf99376816ea5bfaf47621133c225c'");
    expect(source).toContain("captureGit(['checkout-index', '--force', '--', '.replit'])");
    expect(source).toContain("'@emnapi/runtime': {");
    expect(source).toContain("'@img/sharp-wasm32': {");
    expect(source).toContain('lockfile.lockfileVersion !== 3');
    expect(source).toContain('reviewNpmProblems(inventory)');
    expect(source).toContain('hashes and filenames only');
    expect(source).toContain('expectedTag.endsWith(expectedCommit.slice(0, 12))');
    expect(source).toContain('{ ...process.env, BB_API_PORT: providerApiPort }');
    expect(source).toContain('A configured BB_API_PORT must equal the provider PORT');
    expect(worker).toContain('new ProductionIdentityRepository(database).assertFounderBinding');
    expect(worker).toContain('await runReplitWorkerLifecycle(');
    expect(worker).toContain('registerDatabaseClose(() => database.close())');
    expect(worker).toContain('registerWorkerStop(stopWorker)');
    expect(worker.indexOf('await runReplitWorkerLifecycle(')).toBeLessThan(
      worker.indexOf('loadConfig()'),
    );
    expect(worker.indexOf('assertFounderBinding')).toBeLessThan(worker.indexOf('const jobs ='));
    expect(worker.indexOf('assertFounderBinding')).toBeLessThan(
      worker.indexOf('await worker.start()'),
    );
    expect(workerHealth.indexOf('if (stopWorker !== undefined) await stopWorker()')).toBeLessThan(
      workerHealth.indexOf('await closeWorkerHealthServer(server)'),
    );
    expect(workerHealth.indexOf('await closeWorkerHealthServer(server)')).toBeLessThan(
      workerHealth.indexOf('if (closeDatabase !== undefined) await closeDatabase()'),
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

  it('normalizes only the exact Replit Autoscale overlay before requiring a clean checkout', async () => {
    const fixture = await createProvenanceFixture();
    try {
      const snapshotCommit = commitFixture(fixture.directory, 'Replit Autoscale snapshot', [
        '--allow-empty',
      ]);
      expect(snapshotCommit).not.toBe(fixture.releaseCommit);
      await writeFile(join(fixture.directory, '.replit'), autoscaleReplitConfig, 'utf8');

      const result = runFixtureBuild(fixture, 'web');
      const output = commandOutput(result);
      expect(result.status, output).toBe(0);
      expect(output).toContain(
        'Normalized exact Replit Autoscale metadata before clean-checkout verification.',
      );
      expect(output).toContain(
        'Replit web build passed with an isolated production dependency graph.',
      );
      expect(await readFile(join(fixture.directory, '.replit'), 'utf8')).toBe(
        canonicalReplitConfig,
      );
      expect(runGit(fixture.directory, ['status', '--porcelain=v1', '--untracked-files=all'])).toBe(
        '',
      );
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it('rejects the exact Autoscale overlay for the Reserved VM worker', async () => {
    const fixture = await createProvenanceFixture();
    try {
      await writeFile(join(fixture.directory, '.replit'), autoscaleReplitConfig, 'utf8');

      const result = runFixtureBuild(fixture, 'worker');
      const output = commandOutput(result);
      expect(result.status).not.toBe(0);
      expect(output).not.toContain('Normalized exact Replit Autoscale metadata');
      expect(output).toContain('The Replit checkout contains changes outside the tagged candidate');
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it.each([
    ['wrong target', autoscaleReplitConfig.replace('"cloudrun"', '"cloud-run"')],
    [
      'wrong placement',
      canonicalReplitConfig.replace(
        '[deployment]\n',
        '[deployment]\ndeploymentTarget = "cloudrun"\n',
      ),
    ],
    ['extra content', `${autoscaleReplitConfig}# extra setting\n`],
    [
      'changed modules',
      autoscaleReplitConfig.replace('["nodejs-22"]', '["nodejs-22", "python-base-3.13"]'),
    ],
    ['CRLF endings', autoscaleReplitConfig.replaceAll('\n', '\r\n')],
    ['missing final newline', autoscaleReplitConfig.slice(0, -1)],
    ['extra final newline', `${autoscaleReplitConfig}\n`],
  ])('rejects an Autoscale .replit overlay with %s', async (_name, invalidConfig) => {
    const fixture = await createProvenanceFixture();
    try {
      await writeFile(join(fixture.directory, '.replit'), invalidConfig, 'utf8');

      const result = runFixtureBuild(fixture, 'web');
      const output = commandOutput(result);
      expect(result.status).not.toBe(0);
      expect(output).not.toContain('Normalized exact Replit Autoscale metadata');
      expect(output).toContain('The Replit checkout contains changes outside the tagged candidate');
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it.each(['staged-overlay', 'extra-staged', 'extra-unstaged', 'extra-untracked'] as const)(
    'rejects the exact Autoscale overlay with %s checkout state',
    async (state) => {
      const fixture = await createProvenanceFixture();
      try {
        await writeFile(join(fixture.directory, '.replit'), autoscaleReplitConfig, 'utf8');
        if (state === 'staged-overlay') {
          runGit(fixture.directory, ['add', '.replit']);
        } else if (state === 'extra-untracked') {
          await writeFile(join(fixture.directory, 'extra.txt'), 'do-not-print-content', 'utf8');
        } else {
          await writeFile(join(fixture.directory, 'tracked.txt'), 'do-not-print-content', 'utf8');
          if (state === 'extra-staged') runGit(fixture.directory, ['add', 'tracked.txt']);
        }

        const result = runFixtureBuild(fixture, 'web');
        const output = commandOutput(result);
        expect(result.status).not.toBe(0);
        expect(output).not.toContain('Normalized exact Replit Autoscale metadata');
        expect(output).not.toContain('do-not-print-content');
        expect(output).toContain(
          'The Replit checkout contains changes outside the tagged candidate',
        );
      } finally {
        await rm(fixture.directory, { force: true, recursive: true });
      }
    },
  );

  it.each(['web', 'hq'] as const)(
    'accepts only the reviewed optional Sharp inventory artifacts for %s',
    async (service) => {
      const fixture = await createProvenanceFixture({
        inventory: reviewedOptionalInventory,
        lockfile: reviewedOptionalLockfile,
      });
      try {
        const result = runFixtureBuild(fixture, service);
        const output = commandOutput(result);
        expect(result.status, output).toBe(0);
        expect(output).toContain(
          'Reviewed optional npm artifacts: @emnapi/runtime, @img/sharp-wasm32.',
        );
      } finally {
        await rm(fixture.directory, { force: true, recursive: true });
      }
    },
  );

  it.each(['api', 'worker'] as const)(
    'rejects the reviewed web optional artifacts for the %s graph',
    async (service) => {
      const fixture = await createProvenanceFixture({
        inventory: reviewedOptionalInventory,
        lockfile: reviewedOptionalLockfile,
      });
      try {
        const result = runFixtureBuild(fixture, service);
        const output = commandOutput(result);
        expect(result.status).not.toBe(0);
        expect(output).not.toContain('Reviewed optional npm artifacts');
        expect(output).toContain(`The ${service} production dependency graph contains npm problems`);
      } finally {
        await rm(fixture.directory, { force: true, recursive: true });
      }
    },
  );

  it.each([
    [
      'version',
      (directory: string) => reviewedOptionalInventory(directory, { runtimeVersion: '1.11.4' }),
    ],
    [
      'path',
      (directory: string) =>
        reviewedOptionalInventory(directory, {
          sharpPath: join(directory, 'outside-node-modules', '@img', 'sharp-wasm32'),
        }),
    ],
    [
      'additional problem',
      (directory: string) => {
        const inventory = reviewedOptionalInventory(directory) as {
          problems: string[];
          dependencies: Record<string, unknown>;
        };
        inventory.problems.push(
          `extraneous: unreviewed-package@1.0.0 ${join(directory, 'node_modules', 'unreviewed-package')}`,
        );
        return inventory;
      },
    ],
  ])('rejects reviewed optional npm artifacts with altered %s metadata', async (_name, inventory) => {
    const fixture = await createProvenanceFixture({
      inventory,
      lockfile: reviewedOptionalLockfile,
    });
    try {
      const result = runFixtureBuild(fixture, 'web');
      const output = commandOutput(result);
      expect(result.status).not.toBe(0);
      expect(output).not.toContain('Reviewed optional npm artifacts');
      expect(output).toContain('The web production dependency graph contains npm problems');
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it.each([
    [
      'missing problem',
      (directory: string) => {
        const inventory = reviewedOptionalInventory(directory) as { problems: string[] };
        inventory.problems.pop();
        return inventory;
      },
    ],
    [
      'duplicate problem',
      (directory: string) => {
        const inventory = reviewedOptionalInventory(directory) as { problems: string[] };
        inventory.problems[1] = inventory.problems[0];
        return inventory;
      },
    ],
    [
      'malformed problem',
      (directory: string) => {
        const inventory = reviewedOptionalInventory(directory) as { problems: unknown[] };
        inventory.problems[1] = 42;
        return inventory;
      },
    ],
    [
      'resolved URL',
      (directory: string) => {
        const inventory = reviewedOptionalInventory(directory) as {
          dependencies: Record<string, Record<string, unknown>>;
        };
        inventory.dependencies['@emnapi/runtime'].resolved = 'https://example.invalid/runtime.tgz';
        return inventory;
      },
    ],
    [
      'nested dependency',
      (directory: string) => {
        const inventory = reviewedOptionalInventory(directory) as {
          dependencies: Record<string, { dependencies: Record<string, unknown> }>;
        };
        inventory.dependencies['@emnapi/runtime'].dependencies.extra = { version: '1.0.0' };
        return inventory;
      },
    ],
    [
      'nested problem outside the reviewed nodes',
      (directory: string) => {
        const inventory = reviewedOptionalInventory(directory) as {
          dependencies: Record<string, unknown>;
        };
        inventory.dependencies.unrelated = {
          version: '1.0.0',
          problems: ['invalid: unrelated'],
        };
        return inventory;
      },
    ],
  ])('rejects reviewed npm inventory with %s drift', async (_name, inventory) => {
    const fixture = await createProvenanceFixture({
      inventory,
      lockfile: reviewedOptionalLockfile,
    });
    try {
      const result = runFixtureBuild(fixture, 'web');
      const output = commandOutput(result);
      expect(result.status).not.toBe(0);
      expect(output).not.toContain('Reviewed optional npm artifacts');
      expect(output).toContain('The web production dependency graph contains npm problems');
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it.each([
    [
      'lockfile version',
      () => {
        const lockfile = reviewedOptionalLockfile() as { lockfileVersion: number };
        lockfile.lockfileVersion = 2;
        return lockfile;
      },
    ],
    [
      'optional flag',
      () => {
        const lockfile = reviewedOptionalLockfile() as {
          packages: Record<string, Record<string, unknown>>;
        };
        lockfile.packages['node_modules/@emnapi/runtime'].optional = false;
        return lockfile;
      },
    ],
    [
      'integrity',
      () => {
        const lockfile = reviewedOptionalLockfile() as {
          packages: Record<string, Record<string, unknown>>;
        };
        lockfile.packages['node_modules/@img/sharp-wasm32'].integrity = 'sha512-invalid';
        return lockfile;
      },
    ],
    [
      'dependency range',
      () => {
        const lockfile = reviewedOptionalLockfile() as {
          packages: Record<string, { dependencies: Record<string, string> }>;
        };
        lockfile.packages['node_modules/@img/sharp-wasm32'].dependencies[
          '@emnapi/runtime'
        ] = '*';
        return lockfile;
      },
    ],
    [
      'extra dependency',
      () => {
        const lockfile = reviewedOptionalLockfile() as {
          packages: Record<string, { dependencies: Record<string, string> }>;
        };
        lockfile.packages['node_modules/@emnapi/runtime'].dependencies.extra = '1.0.0';
        return lockfile;
      },
    ],
  ])('rejects reviewed optional npm artifacts with altered %s metadata', async (_name, lockfile) => {
    const fixture = await createProvenanceFixture({
      inventory: reviewedOptionalInventory,
      lockfile,
    });
    try {
      const result = runFixtureBuild(fixture, 'hq');
      const output = commandOutput(result);
      expect(result.status).not.toBe(0);
      expect(output).not.toContain('Reviewed optional npm artifacts');
      expect(output).toContain('The hq production dependency graph contains npm problems');
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it('still rejects forbidden mobile packages alongside the reviewed optional artifacts', async () => {
    const fixture = await createProvenanceFixture({
      inventory: (directory) => {
        const inventory = reviewedOptionalInventory(directory) as {
          dependencies: Record<string, unknown>;
        };
        inventory.dependencies['react-native'] = { version: '0.84.1' };
        return inventory;
      },
      lockfile: reviewedOptionalLockfile,
    });
    try {
      const result = runFixtureBuild(fixture, 'web');
      const output = commandOutput(result);
      expect(result.status).not.toBe(0);
      expect(output).toContain('Reviewed optional npm artifacts');
      expect(output).toContain('The web Replit graph unexpectedly includes react-native');
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it('reports bounded hashes and filenames, never changed file content, for a tree mismatch', async () => {
    const fixture = await createProvenanceFixture();
    try {
      const contentSentinel = 'private-snapshot-content-must-not-be-logged';
      await writeFile(join(fixture.directory, 'tracked.txt'), `${contentSentinel}\n`, 'utf8');
      runGit(fixture.directory, ['add', 'tracked.txt']);
      const headCommit = commitFixture(fixture.directory, 'Changed snapshot tree');
      const headTree = runGit(fixture.directory, ['rev-parse', 'HEAD^{tree}']);
      const taggedTree = runGit(fixture.directory, [
        'rev-parse',
        `refs/tags/${fixture.tag}^{tree}`,
      ]);

      const result = runFixtureBuild(fixture);
      const output = commandOutput(result);
      expect(result.status).not.toBe(0);
      expect(output).toContain(
        'The Replit checkout tree does not match the tagged Run 3.1 candidate',
      );
      expect(output).toContain(
        'Replit provenance mismatch diagnostics (hashes and filenames only):',
      );
      expect(output).toContain(`HEAD commit: ${headCommit}`);
      expect(output).toContain(`HEAD tree: ${headTree}`);
      expect(output).toContain(`annotated tag commit: ${fixture.releaseCommit}`);
      expect(output).toContain(`annotated tag tree: ${taggedTree}`);
      expect(output).toContain('tag -> HEAD name-status paths: 1');
      expect(output).toContain('    M "tracked.txt"');
      expect(output).not.toContain(contentSentinel);
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it('reports renames as bounded add/delete filenames without similarity scanning', async () => {
    const fixture = await createProvenanceFixture();
    try {
      runGit(fixture.directory, ['mv', 'tracked.txt', 'renamed.txt']);
      commitFixture(fixture.directory, 'Renamed snapshot path');

      const result = runFixtureBuild(fixture);
      const output = commandOutput(result);
      expect(result.status).not.toBe(0);
      expect(output).toContain('tag -> HEAD name-status paths: 2');
      expect(output).toContain('    A "renamed.txt"');
      expect(output).toContain('    D "tracked.txt"');
      expect(output).not.toContain('    R ');
      expect(output).toContain(
        'The Replit checkout tree does not match the tagged Run 3.1 candidate',
      );
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it('ASCII-escapes control and non-ASCII path bytes in mismatch diagnostics', async () => {
    const fixture = await createProvenanceFixture();
    try {
      const diagnosticPath = 'control-\x7f-café.txt';
      const blob = runGit(fixture.directory, ['rev-parse', 'HEAD:tracked.txt']);
      runGit(fixture.directory, [
        'update-index',
        '--add',
        '--cacheinfo',
        '100644',
        blob,
        diagnosticPath,
      ]);
      commitFixture(fixture.directory, 'Added unusual snapshot path');

      const result = runFixtureBuild(fixture);
      const output = commandOutput(result);
      expect(result.status).not.toBe(0);
      expect(output).toContain('    A "control-\\x7f-caf\\xc3\\xa9.txt"');
      expect(output).not.toContain(diagnosticPath);
      expect(output).toContain(
        'The Replit checkout tree does not match the tagged Run 3.1 candidate',
      );
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it('caps mismatch diagnostics at fifty deterministically sorted paths', async () => {
    const fixture = await createProvenanceFixture();
    try {
      const paths = Array.from(
        { length: 53 },
        (_value, index) => `diagnostic-${String(index).padStart(3, '0')}.txt`,
      );
      await Promise.all(
        paths.map((path) => writeFile(join(fixture.directory, path), 'diagnostic\n', 'utf8')),
      );
      runGit(fixture.directory, ['add', '--all']);
      commitFixture(fixture.directory, 'Many snapshot paths');

      const result = runFixtureBuild(fixture);
      const output = commandOutput(result);
      expect(result.status).not.toBe(0);
      expect(output).toContain('tag -> HEAD name-status paths: 53');
      expect(output).toContain('    A "diagnostic-000.txt"');
      expect(output).toContain('    A "diagnostic-049.txt"');
      expect(output).not.toContain('    A "diagnostic-050.txt"');
      expect(output).toContain('    ... 3 more paths omitted');
      expect(output).toContain(
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
        const contentSentinel = `do-not-print-${contentState}-checkout-content`;
        if (contentState === 'untracked') {
          await writeFile(join(fixture.directory, 'untracked.txt'), contentSentinel, 'utf8');
        } else {
          await writeFile(join(fixture.directory, 'tracked.txt'), contentSentinel, 'utf8');
          if (contentState === 'staged') runGit(fixture.directory, ['add', 'tracked.txt']);
        }
        expect(
          runGit(fixture.directory, ['status', '--porcelain=v1', '--untracked-files=all']),
        ).not.toBe('');

        const result = runFixtureBuild(fixture);
        const output = commandOutput(result);
        expect(result.status).not.toBe(0);
        expect(output).toContain('Replit dirty checkout diagnostics (status and filenames only):');
        expect(output).toContain('  index/worktree status paths: 1');
        expect(output).toContain(
          contentState === 'staged'
            ? '    M  "tracked.txt"'
            : contentState === 'unstaged'
              ? '     M "tracked.txt"'
              : '    ?? "untracked.txt"',
        );
        expect(output).not.toContain(contentSentinel);
        expect(output).toContain(
          'The Replit checkout contains changes outside the tagged candidate',
        );
      } finally {
        await rm(fixture.directory, { force: true, recursive: true });
      }
    },
  );

  it('caps dirty-checkout diagnostics at fifty deterministically sorted paths', async () => {
    const fixture = await createProvenanceFixture();
    try {
      const paths = Array.from(
        { length: 53 },
        (_value, index) => `dirty-${String(index).padStart(3, '0')}.txt`,
      );
      await Promise.all(
        paths.map((path) =>
          writeFile(join(fixture.directory, path), 'do-not-print-dirty-content', 'utf8'),
        ),
      );

      const result = runFixtureBuild(fixture);
      const output = commandOutput(result);
      expect(result.status).not.toBe(0);
      expect(output).toContain('  index/worktree status paths: 53');
      expect(output).toContain('    ?? "dirty-000.txt"');
      expect(output).toContain('    ?? "dirty-049.txt"');
      expect(output).not.toContain('    ?? "dirty-050.txt"');
      expect(output).toContain('    ... 3 more paths omitted');
      expect(output).not.toContain('do-not-print-dirty-content');
      expect(output).toContain('The Replit checkout contains changes outside the tagged candidate');
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

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
