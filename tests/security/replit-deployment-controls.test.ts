import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

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
    expect(replit).not.toContain('npm run dev');
    expect(packageJson.scripts['replit:build']).toBe('node scripts/replit-service.mjs build');
    expect(packageJson.scripts['replit:start']).toBe('node scripts/replit-service.mjs start');
    expect(webPackage.scripts.start).toBe('next start');
    expect(hqPackage.scripts.start).toBe('next start');
    expect(source).toContain("['@expo/metro', 'expo', 'image-size', 'metro', 'react-native']");
    expect(source).toContain("'--include-workspace-root=false'");
    expect(source).toContain("process.env.REPLIT_DEPLOYMENT !== '1'");
    expect(source).toContain('refs/tags/${expectedTag}^{commit}');
    expect(source).toContain("captureGit(['status', '--porcelain'])");
    expect(source).toContain('expectedTag.endsWith(expectedCommit.slice(0, 12))');
    expect(source).toContain('{ ...process.env, BB_API_PORT: providerApiPort }');
    expect(source).toContain('A configured BB_API_PORT must equal the provider PORT');
    expect(worker).toContain('new ProductionIdentityRepository(database).assertFounderBinding');
    expect(worker.indexOf('assertFounderBinding')).toBeLessThan(worker.indexOf('const jobs ='));
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
    const missingTag = spawnSync(process.execPath, ['scripts/replit-service.mjs', 'start'], {
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
    expect(`${missingTag.stdout}${missingTag.stderr}`).toContain(
      'git rev-parse --verify refs/tags/',
    );

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
});
