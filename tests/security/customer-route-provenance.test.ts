import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const customerAppRoot = resolve(repositoryRoot, 'apps/web/src/app');

function productionCustomerArtifactFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return productionCustomerArtifactFiles(path);
    if (entry.name === 'layout.tsx') return [path];
    const topLevelSegment = relative(customerAppRoot, path).split(sep)[0];
    return entry.name === 'page.tsx' && topLevelSegment !== 'research' ? [path] : [];
  });
}

function productionArtifact(path: string): string {
  const build = buildSync({
    entryPoints: [path],
    bundle: true,
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.BB_PRIVATE_BETA_ACCESS_INTENTS_ENABLED': '"false"',
      'process.env.BB_PRIVATE_BETA_ACCESS_INTENTS_EDGE_GUARD_CONFIRMED': '"false"',
    },
    format: 'esm',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
    minify: true,
    packages: 'external',
    platform: 'node',
    target: 'node22',
    treeShaking: true,
    write: false,
  });
  return build.outputFiles.map((output) => output.text).join('\n');
}

describe('customer production route provenance', () => {
  it('removes beta, development, persona, and fixture copy from production pages and layouts', () => {
    const artifacts = productionCustomerArtifactFiles(customerAppRoot).sort();
    const relativeArtifacts = artifacts.map((path) =>
      relative(customerAppRoot, path).split(sep).join('/'),
    );
    expect(
      relativeArtifacts.filter((path) => path.endsWith('/page.tsx') || path === 'page.tsx').length,
    ).toBeGreaterThan(15);
    for (const requiredLayout of [
      'layout.tsx',
      'check/layout.tsx',
      'member/layout.tsx',
      'research/layout.tsx',
      'sign-in/layout.tsx',
    ]) {
      expect(relativeArtifacts).toContain(requiredLayout);
    }
    expect(relativeArtifacts).not.toContain('research/offer-pair-v2/page.tsx');

    for (const artifact of artifacts) {
      const route = relative(customerAppRoot, artifact).split(sep).join('/');
      expect(productionArtifact(artifact), route).not.toMatch(
        /\bbeta\b|development access|choose a seeded person|development persona|fictional local personas|enter local member area|local use only|local development|seed fixture|development build|mock analysis|test checkout|local destination fixture|record local fixture/iu,
      );
    }
  });

  it('binds those artifacts to the tagged production startup wrapper, never a dev server', () => {
    const wrapper = readFileSync(resolve(repositoryRoot, 'scripts/replit-service.mjs'), 'utf8');
    const replit = readFileSync(resolve(repositoryRoot, '.replit'), 'utf8');
    const rootPackage = JSON.parse(
      readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const webPackage = JSON.parse(
      readFileSync(resolve(repositoryRoot, 'apps/web/package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(wrapper).toContain("process.env.NODE_ENV !== 'production'");
    expect(wrapper).toContain("process.env.REPLIT_DEPLOYMENT !== '1'");
    expect(wrapper).toContain("assertReleaseProvenance({ verifyCheckout: mode === 'build' });");
    expect(wrapper).toContain("'run', 'start', '--workspace', workspace");
    expect(
      wrapper.indexOf("assertReleaseProvenance({ verifyCheckout: mode === 'build' });"),
    ).toBeLessThan(wrapper.indexOf('const child = spawn(npmCommand'));
    expect(replit).toContain('run = "npm run replit:start"');
    expect(replit).toContain('build = "npm run replit:build"');
    expect(replit).not.toContain('npm run dev');
    expect(rootPackage.scripts['replit:start']).toBe('node scripts/replit-service.mjs start');
    expect(webPackage.scripts.start).toBe('next start');
    expect(webPackage.scripts.dev).toBe('next dev -p 3000');
  });
});
