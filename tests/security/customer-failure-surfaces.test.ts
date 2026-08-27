import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

describe('customer failure surfaces', () => {
  const files = [
    'apps/web/src/app/error.tsx',
    'apps/web/src/app/global-error.tsx',
    'apps/web/src/app/not-found.tsx',
  ];

  it('provides retry or home recovery and a support path without leaking error details', () => {
    const [routeError, globalError, notFound] = files.map(source);
    const combined = `${routeError}\n${globalError}\n${notFound}`;

    expect(routeError).toContain('onClick={reset}');
    expect(globalError).toContain('onClick={reset}');
    expect(notFound).toContain('Page not found');
    for (const content of [routeError, globalError, notFound]) {
      expect(content).toContain('href="/"');
      expect(content).toContain('href="/support"');
      expect(content).not.toMatch(/error\.(?:message|stack|digest)|console\.(?:error|log)/u);
      expect(content).not.toMatch(/response time|24[- ]hour|monitored/iu);
    }
    expect(combined).toContain('Your action has not been confirmed');
  });

  it('uses accessible landmarks and ASCII punctuation', () => {
    for (const content of files.map(source)) {
      expect(content).toContain('id="main-content"');
      expect(content).toContain('aria-labelledby=');
      expect(content).not.toMatch(/[\u2013\u2014]/u);
    }
    expect(source('apps/web/src/app/global-error.tsx')).toContain('<html lang="en">');
  });
});
