import { spawnSync } from 'node:child_process';
import process from 'node:process';

const npm = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
const npmPrefix = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd'] : [];
const result = spawnSync(
  npm,
  [
    ...npmPrefix,
    'ls',
    '--omit=dev',
    '--workspace',
    '@boomerbuddy/api',
    '--workspace',
    '@boomerbuddy/worker',
    '--all',
    '--json',
  ],
  { cwd: process.cwd(), encoding: 'utf8', shell: false },
);
if (result.status !== 0) {
  throw new Error(`Unable to resolve the API/worker production dependency graph: ${result.stderr}`);
}

const graph = JSON.parse(result.stdout);
const dependencies = new Set();
function collect(node) {
  for (const [name, dependency] of Object.entries(node?.dependencies ?? {})) {
    dependencies.add(name);
    collect(dependency);
  }
}
collect(graph);

const requiredRuntimePackages = [
  '@electric-sql/pglite',
  'dotenv',
  'fastify',
  'kysely',
  'pg',
  'tldts',
  'zod',
];
const forbiddenRuntimePackages = [
  '@playwright/test',
  'next',
  'playwright',
  'react-native',
  'tsx',
  'typescript',
  'vitest',
];
const missing = requiredRuntimePackages.filter((name) => !dependencies.has(name));
const forbidden = forbiddenRuntimePackages.filter((name) => dependencies.has(name));
if (missing.length > 0 || forbidden.length > 0) {
  throw new Error(
    `API/worker production dependency scope is invalid; missing=${missing.join(',') || 'none'} forbidden=${forbidden.join(',') || 'none'}`,
  );
}

process.stdout.write(
  `API/worker production dependency scope passed with ${dependencies.size} named packages.\n`,
);
