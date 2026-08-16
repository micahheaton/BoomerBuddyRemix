import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const required = [
  '.replit',
  'Dockerfile',
  'docker-compose.yml',
  'render.yaml',
  '.github/workflows/ci.yml',
  'apps/web/vercel.json',
  'apps/hq/vercel.json',
  'apps/mobile/eas.json',
  '.env.example',
];
const forbidden = [/@replit\//u, /REPLIT_DB_URL/u, /\bREPL_ID\b/u, /replit\.database/u];
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.yml', '.yaml']);

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.next', '.expo', 'coverage'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (extensions.has(extname(entry.name))) result.push(path);
  }
  return result;
}

for (const path of required) await readFile(join(root, path), 'utf8');
const sourceFiles = [
  ...(await files(join(root, 'apps'))),
  ...(await files(join(root, 'packages'))),
  ...(await files(join(root, 'scripts'))),
].filter((path) => !path.endsWith('verify-portability.mjs'));
const violations = [];
for (const path of sourceFiles) {
  const value = await readFile(path, 'utf8');
  if (forbidden.some((pattern) => pattern.test(value))) violations.push(relative(root, path));
}
if (violations.length > 0) {
  throw new Error(`Replit-only runtime dependency detected: ${violations.sort().join(', ')}`);
}
process.stdout.write(
  'Portable configuration inventory passed; external remote, backup, restore, DNS, and vendor proof remain blocked.\n',
);
