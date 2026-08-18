import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('release candidate controls', () => {
  it('binds reconstruction to one exact immutable Run 3 tag and commit', async () => {
    const cleanClone = await readFile(join(root, 'scripts/clean-clone-check.mjs'), 'utf8');
    const lossDrill = await readFile(join(root, 'scripts/replit-loss-drill.mjs'), 'utf8');

    for (const source of [cleanClone, lossDrill]) {
      expect(source).toContain('`refs/tags/${candidateRef}^{commit}`');
      expect(source).toContain("git', ['checkout', '--detach', tagCommit]");
      expect(source).toContain("capture('git', ['rev-parse', 'HEAD'])");
      expect(source).toContain("capture('git', ['status', '--porcelain'])");
      expect(source.match(/capture\('git', \['status', '--porcelain'\]\)/gu)).toHaveLength(2);
      expect(source).toContain('run3-1-replit-founding-household');
      expect(source).toContain('run3-local-candidate');
      expect(source).toContain('/^[0-9a-f]{40}$/u');
    }

    const rejected = spawnSync(process.execPath, ['scripts/clean-clone-check.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        BB_CANDIDATE_COMMIT: 'a'.repeat(40),
        BB_CANDIDATE_REF: '--upload-pack=untrusted',
      },
      shell: false,
    });
    expect(rejected.status).not.toBe(0);
    expect(`${rejected.stdout}${rejected.stderr}`).toContain(
      'BB_CANDIDATE_REF must be an immutable Run 3 or Run 3.1 candidate tag',
    );

    const mismatchedSuffix = spawnSync(process.execPath, ['scripts/clean-clone-check.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        BB_CANDIDATE_COMMIT: 'a'.repeat(40),
        BB_CANDIDATE_REF: `run3-local-candidate-${'b'.repeat(12)}`,
      },
      shell: false,
    });
    expect(mismatchedSuffix.status).not.toBe(0);
    expect(`${mismatchedSuffix.stdout}${mismatchedSuffix.stderr}`).toContain(
      'BB_CANDIDATE_REF suffix must match BB_CANDIDATE_COMMIT',
    );

    const branchRepository = await mkdtemp(join(tmpdir(), 'boomerbuddy-tag-shaped-branch-'));
    try {
      const git = (args: readonly string[]) =>
        spawnSync('git', args, {
          cwd: branchRepository,
          encoding: 'utf8',
          shell: false,
        });
      expect(git(['init']).status).toBe(0);
      await writeFile(join(branchRepository, 'README.md'), 'branch fixture\n', 'utf8');
      expect(git(['add', 'README.md']).status).toBe(0);
      expect(
        git([
          '-c',
          'user.name=Run 3 fixture',
          '-c',
          'user.email=run3-fixture@example.invalid',
          'commit',
          '-m',
          'Create branch fixture',
        ]).status,
      ).toBe(0);
      const commit = git(['rev-parse', 'HEAD']).stdout.trim().toLowerCase();
      const branch = `run3-local-candidate-${commit.slice(0, 12)}`;
      expect(git(['branch', '-M', branch]).status).toBe(0);
      const branchOnly = spawnSync(
        process.execPath,
        [join(root, 'scripts/clean-clone-check.mjs')],
        {
          cwd: branchRepository,
          encoding: 'utf8',
          env: {
            ...process.env,
            BB_CANDIDATE_COMMIT: commit,
            BB_CANDIDATE_REF: branch,
          },
          shell: false,
        },
      );
      expect(branchOnly.status).not.toBe(0);
      expect(`${branchOnly.stdout}${branchOnly.stderr}`).not.toContain(
        'Clean-clone reconstruction passed',
      );
    } finally {
      await rm(branchRepository, { force: true, recursive: true });
    }

    const credentialedRemote = spawnSync(process.execPath, ['scripts/replit-loss-drill.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        BB_CONTINUITY_GIT_URL: 'https://synthetic-user:synthetic-token@example.invalid/repo.git',
        BB_CONTINUITY_GIT_COMMIT: 'a'.repeat(40),
        BB_CONTINUITY_GIT_REF: `run3-local-candidate-${'a'.repeat(12)}`,
      },
      shell: false,
    });
    expect(credentialedRemote.status).not.toBe(0);
    expect(`${credentialedRemote.stdout}${credentialedRemote.stderr}`).toContain(
      'external Git remote URL without embedded credentials',
    );

    for (const loopbackRemote of [
      'https://localhost/repo.git',
      'https://localhost./repo.git',
      'https://127.0.0.1/repo.git',
      'https://0.0.0.0/repo.git',
      'ssh://git@[::1]/repo.git',
      'ssh://git@[::]/repo.git',
      'git@localhost:repo.git',
    ]) {
      const rejectedLoopback = spawnSync(process.execPath, ['scripts/replit-loss-drill.mjs'], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          BB_CONTINUITY_GIT_URL: loopbackRemote,
          BB_CONTINUITY_GIT_COMMIT: 'a'.repeat(40),
          BB_CONTINUITY_GIT_REF: `run3-local-candidate-${'a'.repeat(12)}`,
        },
        shell: false,
      });
      expect(rejectedLoopback.status).not.toBe(0);
      expect(`${rejectedLoopback.stdout}${rejectedLoopback.stderr}`).toContain(
        'non-Replit, non-loopback external Git remote URL without embedded credentials',
      );
    }
  });

  it('keeps CI and the runtime image aligned with the High advisory gate', async () => {
    const cleanClone = await readFile(join(root, 'scripts/clean-clone-check.mjs'), 'utf8');
    const lossDrill = await readFile(join(root, 'scripts/replit-loss-drill.mjs'), 'utf8');
    const workflow = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8');
    const dockerfile = await readFile(join(root, 'Dockerfile'), 'utf8');
    const dockerCompose = await readFile(join(root, 'docker-compose.yml'), 'utf8');
    const dockerIgnore = await readFile(join(root, '.dockerignore'), 'utf8');
    const runtimeDependencyVerifier = await readFile(
      join(root, 'scripts/verify-runtime-dependency-scope.mjs'),
      'utf8',
    );
    const run31DependencyVerifier = await readFile(
      join(root, 'scripts/verify-run3-1-dependencies.mjs'),
      'utf8',
    );
    const productionUiVerifier = await readFile(
      join(root, 'scripts/verify-founding-household-production-ui.mjs'),
      'utf8',
    );
    const webPackage = JSON.parse(await readFile(join(root, 'apps/web/package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const hqPackage = JSON.parse(await readFile(join(root, 'apps/hq/package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(workflow).toContain("'run3-local-candidate-*', 'run3-1-replit-founding-household-*'");
    expect(workflow).toContain('npm run verify:run3-1-deps');
    expect(workflow).toContain('BB_DEPENDENCY_EVIDENCE_DIR');
    expect(workflow).toContain('npm run test:coverage');
    expect(workflow).toContain('npm run test:e2e');
    expect(workflow).toContain('npm run verify:runtime-deps');
    expect(workflow).toContain('npm run verify:production-ui');
    expect(workflow).toContain('boomerbuddy/run3-candidate:${{ github.sha }}');
    const actionUses = [...workflow.matchAll(/uses:\s+([^\s#]+)/gu)].map((match) => match[1]);
    expect(actionUses.length).toBeGreaterThan(0);
    expect(actionUses.every((action) => /^[^@\s]+@[0-9a-f]{40}$/u.test(action ?? ''))).toBe(true);
    expect(workflow).toMatch(/image: postgres:17\.6-bookworm@sha256:[0-9a-f]{64}/u);
    expect(packageJson.scripts['test:coverage']).toBe('vitest run --coverage --project unit');

    expect(dockerfile.match(/node:22\.13\.1-bookworm-slim@sha256:[0-9a-f]{64}/gu)).toHaveLength(2);
    expect(dockerfile).toContain('FROM workspace-manifests AS production-dependencies');
    expect(dockerfile).toContain(
      'npm ci --omit=dev --ignore-scripts --include-workspace-root=false --workspace @boomerbuddy/api --workspace @boomerbuddy/worker',
    );
    expect(dockerfile).not.toContain('RUN npm prune --omit=dev');
    expect(dockerfile).toContain(
      'COPY --from=production-dependencies /workspace/node_modules ./node_modules',
    );
    expect(dockerfile).not.toContain(
      'COPY --from=dependencies /workspace/node_modules ./node_modules',
    );
    expect(dockerCompose).toMatch(/image: postgres:17\.6-bookworm@sha256:[0-9a-f]{64}/u);
    expect(dockerCompose).toContain('      BB_API_HOST: 0.0.0.0');
    expect(dockerCompose).toContain("      - '127.0.0.1:4000:4000'");
    expect(dockerCompose).not.toContain("      - '4000:4000'");
    for (const pattern of [
      '.env.*',
      '.npmrc',
      '.netrc',
      '.pnpm-store',
      '.turbo',
      'build',
      'tmp',
      '*.db',
      '*.db-journal',
      '*.sqlite',
      '*.sqlite3',
      '*.tsbuildinfo',
      '*.pem',
      '*.key',
      '*.p12',
      '*.pfx',
      '*.jks',
      '*.keystore',
      '.DS_Store',
      'Thumbs.db',
      '.idea',
      '.vscode',
    ]) {
      expect(dockerIgnore.split(/\r?\n/gu)).toContain(pattern);
    }
    for (const forbidden of [
      '@playwright/test',
      'next',
      'playwright',
      'react-native',
      'typescript',
    ]) {
      expect(runtimeDependencyVerifier).toContain(`'${forbidden}'`);
    }
    expect(packageJson.scripts['verify:runtime-deps']).toBe(
      'node scripts/verify-runtime-dependency-scope.mjs',
    );
    expect(packageJson.scripts['verify:run3-1-deps']).toBe(
      'node scripts/verify-run3-1-dependencies.mjs',
    );
    expect(run31DependencyVerifier).toContain('candidateCommit');
    expect(run31DependencyVerifier).toContain('candidateTag');
    expect(run31DependencyVerifier).toContain('evidence-manifest.json');
    expect(run31DependencyVerifier).toContain("git(['tag', '--points-at', candidateCommit])");
    expect(run31DependencyVerifier).toContain("git(['status', '--porcelain'])");
    expect(run31DependencyVerifier).toContain('output directory must be empty');
    expect(cleanClone).toContain("BB_REQUIRE_RUN3_1_CANDIDATE_TAG: 'true'");
    expect(packageJson.scripts['verify:production-ui']).toBe(
      'node scripts/verify-founding-household-production-ui.mjs',
    );
    expect(webPackage.scripts.build).toContain('node ../../scripts/normalize-next-env.mjs web');
    expect(hqPackage.scripts.build).toContain('node ../../scripts/normalize-next-env.mjs hq');
    expect(cleanClone).toContain("npmPrefix, 'run', 'verify:production-ui'");
    expect(cleanClone).toContain("npmPrefix, 'run', 'verify:run3-1-deps'");
    expect(lossDrill).toContain("npmPrefix, 'run', 'verify:production-ui'");
    expect(lossDrill).toContain('sourceUrlExcludedReplitMarkerAndLoopback: true');
    expect(lossDrill).not.toContain('sourceRecoveredOutsideReplit: true');
    expect(cleanClone).toContain("BB_PGLITE_PATH: join(temporaryRoot, 'continuity-database')");
    expect(cleanClone).not.toContain("BB_PGLITE_PATH: join(clone, '.continuity-database')");
    for (const localOnlyMobileAction of [
      'Create local invitation',
      'Open device share sheet',
      'Review native proof status',
    ]) {
      expect(productionUiVerifier).toContain(`'${localOnlyMobileAction}'`);
    }
  });
});
