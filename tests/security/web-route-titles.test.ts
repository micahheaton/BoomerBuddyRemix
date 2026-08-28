import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

describe('customer route titles', () => {
  it.each([
    ['apps/web/src/app/member/page.tsx', 'Member home | BoomerBuddy'],
    ['apps/web/src/app/member/check/page.tsx', 'Check something suspicious | BoomerBuddy'],
    ['apps/web/src/app/member/history/page.tsx', 'Check history | BoomerBuddy'],
    ['apps/web/src/app/member/family/page.tsx', 'Family and Trusted Circle | BoomerBuddy'],
    ['apps/web/src/app/member/family/safe-word/page.tsx', 'Family verification aid | BoomerBuddy'],
    [
      'apps/web/src/app/member/orientation/page.tsx',
      'Orientation, Learn and updates | BoomerBuddy',
    ],
    ['apps/web/src/app/sign-in/client-trust/page.tsx', 'Confirm this device | BoomerBuddy'],
  ])('gives %s a unique descriptive title', (path, title) => {
    const route = source(path);
    expect(route).toContain("import type { Metadata } from 'next'");
    expect(route).toContain('export const metadata: Metadata');
    expect(route).toContain(`title: '${title}'`);
  });

  it('keeps the explicit client-trust page as a server metadata wrapper around the client route', () => {
    const route = source('apps/web/src/app/sign-in/client-trust/page.tsx');
    expect(route).not.toContain("'use client'");
    expect(route).toContain("export { default } from '../[[...sign-in]]/page'");
  });
});
