import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';

const root = process.cwd();
const production = `/// <reference types="next" />
/// <reference types="next/image-types/global" />
import "./.next/types/routes.d.ts";
import "./.next/types/root-params.d.ts";

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`;
const development = production.replaceAll('/.next/types/', '/.next/dev/types/');

describe('Next generated declaration normalization', () => {
  let temporaryRoot: string | undefined;

  afterEach(async () => {
    if (temporaryRoot !== undefined) {
      await rm(temporaryRoot, { force: true, recursive: true });
      temporaryRoot = undefined;
    }
  });

  async function createFixture(content: string): Promise<{
    readonly declaration: string;
    readonly script: string;
    readonly workspace: string;
  }> {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'boomerbuddy-next-env-'));
    const scripts = join(temporaryRoot, 'scripts');
    const workspace = join(temporaryRoot, 'apps', 'web');
    await Promise.all([mkdir(scripts, { recursive: true }), mkdir(workspace, { recursive: true })]);
    const script = join(scripts, 'normalize-next-env.mjs');
    const declaration = join(workspace, 'next-env.d.ts');
    await Promise.all([
      writeFile(
        script,
        await readFile(join(root, 'scripts', 'normalize-next-env.mjs'), 'utf8'),
        'utf8',
      ),
      writeFile(declaration, content, 'utf8'),
    ]);
    return { declaration, script, workspace };
  }

  it('resolves the repository from the script when launched in a workspace', async () => {
    const fixture = await createFixture(production);

    const result = spawnSync(process.execPath, [fixture.script, 'web'], {
      cwd: fixture.workspace,
      encoding: 'utf8',
      shell: false,
    });

    expect(result.status).toBe(0);
    await expect(readFile(fixture.declaration, 'utf8')).resolves.toBe(development);
  });

  it('fails closed without overwriting unexpected declaration content', async () => {
    const unexpected = 'unexpected declaration content\n';
    const fixture = await createFixture(unexpected);

    const result = spawnSync(process.execPath, [fixture.script, 'web'], {
      cwd: fixture.workspace,
      encoding: 'utf8',
      shell: false,
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      'Refusing to overwrite unexpected generated declaration content',
    );
    await expect(readFile(fixture.declaration, 'utf8')).resolves.toBe(unexpected);
  });
});
