import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import {
  founderProvisioningCatalogue,
  type FounderProvisioningCatalogueEntry,
} from '@boomerbuddy/domain';

export const founderProvisioningCatalogueBeginMarker =
  '<!-- BEGIN CODE-OWNED FOUNDER PROVISIONING CATALOGUE V1 -->';
export const founderProvisioningCatalogueEndMarker =
  '<!-- END CODE-OWNED FOUNDER PROVISIONING CATALOGUE V1 -->';

function codeList(values: readonly string[], empty: string): string {
  return values.length === 0 ? empty : values.map((value) => `\`${value}\``).join(', ');
}

export function renderFounderProvisioningCatalogueEntryMarkdown(
  entry: FounderProvisioningCatalogueEntry,
): string {
  const manualSteps = entry.manualSteps
    .map(
      (step, index) =>
        `  ${index + 1}. \`${step.code}\` — required before \`${step.requiredBefore}\`: ${step.instruction}`,
    )
    .join('\n');
  return [
    `### ${entry.displayOrder}. \`${entry.key}\` — ${entry.provider}`,
    `<!-- catalogue-entry:${entry.key}:v${entry.definitionVersion} -->`,
    '',
    `- Definition version: \`${entry.definitionVersion}\``,
    `- Purpose: ${entry.purpose}`,
    `- Account owner: ${entry.accountOwner}`,
    `- Conservative initial status: \`${entry.initialStatus}\``,
    `- Adapter state: \`${entry.adapterState}\``,
    '- Ordered manual founder steps:',
    manualSteps,
    `- Required safe identifier names: ${codeList(entry.requiredIdentifierNames, 'None.')}`,
    `- Configuration environment names: ${codeList(
      entry.configurationEnvironmentNames,
      'None — no implemented adapter configuration environment name.',
    )}`,
    `- Secret environment names: ${codeList(
      entry.secretEnvironmentNames,
      'None — no implemented adapter secret environment name.',
    )}`,
    `- Verification test: ${entry.verificationTest}`,
    `- Allowed retained proof tiers: ${codeList(entry.allowedProofTiers, 'None.')}`,
    `- Monthly cost ceiling: \`${entry.monthlyCostCeiling}\``,
    `- Recovery owner: ${entry.recoveryOwner}`,
    `- Export / termination: ${entry.exportTermination}`,
    `- Next founder action: ${entry.nextFounderAction}`,
  ].join('\n');
}

export function renderFounderProvisioningCatalogueMarkdown(): string {
  return [
    founderProvisioningCatalogueBeginMarker,
    '## Exact code-owned catalogue details',
    '',
    'This appendix is mechanically rendered from the immutable version-1 catalogue. It is the authoritative source for exact ordered founder steps and exact implemented provider-adapter environment names; the register table above is only a summary. `None` means no provider adapter environment name exists and no name may be invented to advance a status. A fail-closed disabled sentinel or a reserved name that configuration explicitly rejects is not an implemented adapter name and is documented separately in the current provider runbook.',
    '',
    ...founderProvisioningCatalogue.flatMap((entry) => [
      renderFounderProvisioningCatalogueEntryMarkdown(entry),
      '',
    ]),
    founderProvisioningCatalogueEndMarker,
  ].join('\n');
}

export function reconcileFounderProvisioningDocument(
  document: string,
  renderedCatalogue = renderFounderProvisioningCatalogueMarkdown(),
): string {
  const markerPattern = new RegExp(
    `${founderProvisioningCatalogueBeginMarker}[\\s\\S]*?${founderProvisioningCatalogueEndMarker}`,
    'u',
  );
  if (markerPattern.test(document)) return document.replace(markerPattern, renderedCatalogue);
  const insertionMarker = '\n## Founder steps by critical path';
  if (!document.includes(insertionMarker)) {
    throw new Error('Founder provisioning document insertion marker is missing');
  }
  return document.replace(insertionMarker, `\n${renderedCatalogue}\n${insertionMarker}`);
}

async function main(): Promise<void> {
  const documentPath = resolve('docs/run-3/FOUNDER-PROVISIONING.md');
  const current = await readFile(documentPath, 'utf8');
  const newline = current.includes('\r\n') ? '\r\n' : '\n';
  const rendered = renderFounderProvisioningCatalogueMarkdown().replace(/\n/gu, newline);
  const next = reconcileFounderProvisioningDocument(current, rendered);
  if (process.argv.includes('--check')) {
    if (next !== current) throw new Error('Founder provisioning document is out of date');
    return;
  }
  await writeFile(documentPath, next, 'utf8');
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  await main();
}
