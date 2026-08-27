import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { supportReceiptActions } from '../../apps/hq/src/lib/support-receipt-ui';
import { canWithdrawSupportReceipt } from '../../apps/web/src/lib/support-receipt-ui';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function source(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), 'utf8');
}

describe('support receipt customer and HQ UI boundaries', () => {
  it('gives signed-in members a content-free form, private history, and email fallback', async () => {
    const [page, component, memberNavigation] = await Promise.all([
      source('apps/web/src/app/member/support/page.tsx'),
      source('apps/web/src/components/support-receipts.tsx'),
      source('apps/web/src/components/member-shell.tsx'),
    ]);

    expect(page).toContain('<SupportReceipts />');
    expect(memberNavigation).toContain('href="/member/support"');
    expect(component).toContain('apiPaths.supportReceipts');
    expect(component).toContain('`support-receipt:${kind}:${crypto.randomUUID()}`');
    expect(component).toContain('const [pendingCreate, setPendingCreate]');
    expect(component).toContain(
      'const pendingCreateRef = useRef<PendingCreate | undefined>(undefined)',
    );
    expect(component).toContain('const operation = pendingCreateRef.current ??');
    expect(component).toContain('pendingCreateRef.current = operation');
    expect(component).toContain("headers: { 'Idempotency-Key': operation.key }");
    expect(component).toContain("withdrawalKeys.current[receiptCode] ?? operationKey('withdraw')");
    expect(component).toContain("headers: { 'Idempotency-Key': key }");
    expect(component).toContain('delete withdrawalKeys.current[receiptCode]');
    expect(component).toContain(') : listError ? null : unavailable ? (');
    expect(component).toContain(
      'That receipt could not be withdrawn. Check its current status before trying again.',
    );
    expect(component).not.toContain('Your receipt list was refreshed.');
    expect(component).toContain('mailto:support@boomerbuddy.net');
    expect(component).toContain('supportReceiptCodeSchema.parse(receiptCode)');
    expect(component).toContain(
      '`mailto:support@boomerbuddy.net?subject=${encodeURIComponent(validatedReceiptCode)}`',
    );
    expect(component).toContain('href={supportReceiptEmailDraftHref(emailReceiptCode)}');
    expect(component).toContain('does not prefill the');
    expect(component).toContain('Review any automatic signature before sending');
    expect(component).not.toMatch(/[?&](?:body|cc|bcc)=/iu);
    expect(component).toContain('This form has no message box');
    expect(component).toContain('Support receipts are not available right now');
    expect(component).toContain('Creating a new support receipt is not available right now');
    expect(component).toContain('Try loading receipts again');
    expect(component).toContain(
      'setTerminalTruncation(response.truncated && response.nextOffset === null)',
    );
    expect(component).toContain('Additional older receipts are outside this bounded history view.');
    expect(component).not.toMatch(/<textarea|type=["']text["']/iu);
    expect(component).not.toContain('receipt.householdId');
    expect(component).not.toMatch(/twilio|stripe|provider\.send|messages\.create|fetch\s*\(/iu);
  });

  it('offers customer withdrawal only before a receipt reaches a terminal state', () => {
    expect(canWithdrawSupportReceipt('open')).toBe(true);
    expect(canWithdrawSupportReceipt('acknowledged')).toBe(true);
    expect(canWithdrawSupportReceipt('in_review')).toBe(true);
    expect(canWithdrawSupportReceipt('resolved')).toBe(false);
    expect(canWithdrawSupportReceipt('withdrawn')).toBe(false);
  });

  it('gives only the HQ owner view fixed content-free transitions and resolutions', async () => {
    const [page, component, shell, rules] = await Promise.all([
      source('apps/hq/src/app/support-receipts/page.tsx'),
      source('apps/hq/src/components/support-receipt-queue.tsx'),
      source('apps/hq/src/components/hq-screen.tsx'),
      source('apps/hq/src/lib/support-receipt-ui.ts'),
    ]);

    expect(page).toContain('view="support-receipts"');
    expect(shell).toContain("| 'support-receipts'");
    expect(shell).toContain('{isOwner && (');
    expect(shell).toContain('href="/support-receipts"');
    expect(component).toContain('apiPaths.hqSupportReceipts');
    expect(component).toContain('support-receipt:transition:');
    expect(component).toContain('const pendingOperations = useRef(');
    expect(component).toContain(
      'prior?.signature === signature ? prior.operationKey : operationKey()',
    );
    expect(component).toContain("headers: { 'Idempotency-Key': key }");
    expect(component).toContain('pendingOperations.current.delete(receipt.receiptCode)');
    expect(component).toContain(') : listError ? null : unavailable ? (');
    expect(component).toContain(
      'That receipt could not be updated. Check the current owner queue before trying again.',
    );
    expect(component).not.toContain('The owner queue was refreshed.');
    expect(component).toContain(
      'setTerminalTruncation(response.truncated && response.nextOffset === null)',
    );
    expect(component).toContain('Additional queued receipts are outside this bounded queue view.');
    expect(rules).toContain("if (state === 'open') return ['acknowledge']");
    expect(rules).toContain("if (state === 'acknowledged') return ['start_review', 'resolve']");
    expect(rules).toContain("if (state === 'in_review') return ['resolve']");
    for (const resolution of [
      'completed',
      'duplicate',
      'insufficient_content_free_evidence',
      'outside_supported_scope',
    ]) {
      expect(component).toContain(resolution);
    }
    expect(component).not.toMatch(/<textarea|type=["']text["']/iu);
    expect(component).not.toMatch(/twilio|stripe|provider\.send|messages\.create|fetch\s*\(/iu);
  });

  it('offers HQ only the next valid fixed transition for each queue state', () => {
    expect(supportReceiptActions('open')).toEqual(['acknowledge']);
    expect(supportReceiptActions('acknowledged')).toEqual(['start_review', 'resolve']);
    expect(supportReceiptActions('in_review')).toEqual(['resolve']);
    expect(supportReceiptActions('resolved')).toEqual([]);
    expect(supportReceiptActions('withdrawn')).toEqual([]);
  });

  it('uses ASCII punctuation without en or em dashes in every new support UI file', async () => {
    const files = await Promise.all([
      source('apps/web/src/app/member/support/page.tsx'),
      source('apps/web/src/components/support-receipts.tsx'),
      source('apps/web/src/lib/support-receipt-ui.ts'),
      source('apps/hq/src/app/support-receipts/page.tsx'),
      source('apps/hq/src/components/support-receipt-queue.tsx'),
      source('apps/hq/src/lib/support-receipt-ui.ts'),
    ]);
    expect(files.join('\n')).not.toMatch(/[\u2013\u2014]/u);
  });
});
