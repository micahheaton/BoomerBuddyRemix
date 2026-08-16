import { readFile, readdir } from 'node:fs/promises';
import { extname, join, posix, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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
const extensions = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
]);

export function containsForbiddenV1RuntimeReference(value) {
  const source = ts.createSourceFile(
    'runtime-reference.tsx',
    value,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const literals = [];
  const staticString = (node) => {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = staticString(node.left);
      const right = staticString(node.right);
      return left === undefined || right === undefined ? undefined : left + right;
    }
    return undefined;
  };
  const visit = (node) => {
    const literal = staticString(node);
    if (literal !== undefined) literals.push(literal);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return literals.some((literal) => {
    let decoded = literal;
    try {
      decoded = decodeURIComponent(literal);
    } catch {
      // Invalid encoding cannot become a valid resolving file/module specifier.
    }
    const segments = posix
      .normalize(decoded.replaceAll('\\', '/'))
      .split('/')
      .map((segment) => segment.toLocaleLowerCase('en-US'));
    return segments.some(
      (segment, index) => segment === 'reference' && segments[index + 1] === 'boomerbuddy-v1',
    );
  });
}

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

async function verifyPortability() {
  for (const path of required) await readFile(join(root, path), 'utf8');
  const runtimeSourceFiles = [
    ...(await files(join(root, 'apps'))),
    ...(await files(join(root, 'packages'))),
  ].filter((path) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path));
  const sourceFiles = [...runtimeSourceFiles, ...(await files(join(root, 'scripts')))].filter(
    (path) => !path.endsWith('verify-portability.mjs'),
  );
  const hostViolations = [];
  const v1Violations = [];
  for (const path of sourceFiles) {
    const value = await readFile(path, 'utf8');
    if (forbidden.some((pattern) => pattern.test(value))) hostViolations.push(relative(root, path));
    if (runtimeSourceFiles.includes(path) && containsForbiddenV1RuntimeReference(value)) {
      v1Violations.push(relative(root, path));
    }
  }
  if (hostViolations.length > 0) {
    throw new Error(`Replit-only runtime dependency detected: ${hostViolations.sort().join(', ')}`);
  }
  if (v1Violations.length > 0) {
    throw new Error(
      `BoomerBuddy 2.0 runtime reference to V1 detected: ${v1Violations.sort().join(', ')}`,
    );
  }
  process.stdout.write(
    'Portable configuration and V1 runtime-isolation checks passed; external remote, backup, restore, DNS, and vendor proof remain blocked.\n',
  );
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await verifyPortability();
}
