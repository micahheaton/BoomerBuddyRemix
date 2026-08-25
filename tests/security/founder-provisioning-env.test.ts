import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { founderProvisioningCatalogue } from '@boomerbuddy/domain';

import {
  founderProvisioningCatalogueBeginMarker,
  founderProvisioningCatalogueEndMarker,
  renderFounderProvisioningCatalogueMarkdown,
} from '../../scripts/generate-founder-provisioning-doc';

describe('founder provisioning names-only environment catalogue', () => {
  it('references only exact names present in .env.example and never their values', async () => {
    const environmentExample = await readFile('.env.example', 'utf8');
    const documentedNames = new Set(
      environmentExample
        .split(/\r?\n/u)
        .map((line) => /^(?:#\s*)?([A-Z][A-Z0-9_]*)=/u.exec(line)?.[1])
        .filter((name): name is string => name !== undefined),
    );
    const catalogueNames = new Set(
      founderProvisioningCatalogue.flatMap((entry) => [
        ...entry.configurationEnvironmentNames,
        ...entry.secretEnvironmentNames,
      ]),
    );

    expect(catalogueNames.size).toBeGreaterThan(0);
    for (const name of catalogueNames) expect(documentedNames.has(name), name).toBe(true);
    expect(JSON.stringify(founderProvisioningCatalogue)).not.toContain(
      'local-browser-session-secret-not-for-production',
    );
  });

  it('mechanically pins all 23 definitions, ordered steps, and exact names in the runbook', async () => {
    const document = (await readFile('docs/run-3/FOUNDER-PROVISIONING.md', 'utf8')).replace(
      /\r\n/gu,
      '\n',
    );
    const renderedCatalogue = renderFounderProvisioningCatalogueMarkdown();
    expect(document).toContain(renderedCatalogue);
    expect(document.match(/<!-- catalogue-entry:[a-z0-9_]+:v1 -->/gu)).toHaveLength(23);
    expect(document.split(founderProvisioningCatalogueBeginMarker)).toHaveLength(2);
    expect(document.split(founderProvisioningCatalogueEndMarker)).toHaveLength(2);
    expect(renderedCatalogue).not.toContain('.env.example');
    expect(renderedCatalogue).not.toContain('BB_STRIPE_LIVE_*');
    expect(renderedCatalogue).not.toContain('BB_STRIPE_LIVE_API_KEY');
    expect(renderedCatalogue).toContain('BB_STRIPE_RUNTIME_SURFACE');
    expect(renderedCatalogue).toContain('BB_STRIPE_LIVE_INITIATION_ENABLED');
    expect(renderedCatalogue).toContain('BB_STRIPE_LIVE_API_RESTRICTED_KEY');
    expect(renderedCatalogue).toContain('BB_STRIPE_LIVE_WORKER_RESTRICTED_KEY');

    for (const entry of founderProvisioningCatalogue) {
      expect(document.match(new RegExp(`catalogue-entry:${entry.key}:v1`, 'gu'))).toHaveLength(1);
      if (entry.adapterState === 'not_implemented') {
        expect(entry.configurationEnvironmentNames).toEqual([]);
        expect(entry.secretEnvironmentNames).toEqual([]);
      }
    }
  });
});
