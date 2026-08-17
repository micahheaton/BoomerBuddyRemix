import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

const application = process.argv[2];
if (application !== 'web' && application !== 'hq') {
  throw new TypeError('Expected the generated Next application name: web or hq');
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const file = resolve(root, 'apps', application, 'next-env.d.ts');
if (!file.startsWith(`${root}${sep}`)) {
  throw new Error('Generated Next declaration path escaped the repository');
}

const header = `/// <reference types="next" />
/// <reference types="next/image-types/global" />
`;
const footer = `
// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`;
const development = `${header}import "./.next/dev/types/routes.d.ts";
import "./.next/dev/types/root-params.d.ts";
${footer}`;
const production = `${header}import "./.next/types/routes.d.ts";
import "./.next/types/root-params.d.ts";
${footer}`;
const current = (await readFile(file, 'utf8')).replace(/\r\n?/gu, '\n');
if (current !== development && current !== production) {
  throw new Error(`Refusing to overwrite unexpected generated declaration content: ${file}`);
}
if (current !== development) {
  await writeFile(file, development, 'utf8');
}
