import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canWithdrawMobileSupportReceipt,
  isDefinitiveMobileSupportReceiptMutationFailure,
  mobileSupportReceiptCategories,
  mobileSupportReceiptImpacts,
  mobileSupportReceiptOperationKey,
  parseMobileSupportReceiptList,
  parseMobileSupportReceiptMutation,
} from '../../apps/mobile/src/support-receipts';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const receipt = {
  receiptCode: `support_receipt_${'A'.repeat(32)}`,
  category: 'mobile_app',
  impact: 'blocked',
  state: 'open',
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
} as const;

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

describe('mobile support receipt surface', () => {
  it('uses only the fixed contract category and impact choices', () => {
    expect(mobileSupportReceiptCategories.map((option) => option.value)).toEqual([
      'account_access',
      'billing',
      'check_experience',
      'family_access',
      'mobile_app',
      'privacy',
      'service_availability',
    ]);
    expect(mobileSupportReceiptImpacts.map((option) => option.value)).toEqual([
      'question',
      'degraded',
      'blocked',
      'safety_concern',
    ]);
  });

  it('builds exact create and withdrawal idempotency keys', () => {
    const uuid = '12345678-1234-4123-8123-123456789abc';
    expect(mobileSupportReceiptOperationKey('create', uuid)).toBe(`support-receipt:create:${uuid}`);
    expect(mobileSupportReceiptOperationKey('withdraw', uuid)).toBe(
      `support-receipt:withdraw:${uuid}`,
    );
    expect(() => mobileSupportReceiptOperationKey('create', 'not-a-uuid')).toThrow();
  });

  it('accepts only content-free list and mutation responses', () => {
    const boundary = {
      contentIncluded: false,
      outboundMessage: 'not_sent',
      providerAction: 'none',
    } as const;
    expect(
      parseMobileSupportReceiptList({
        receipts: [receipt],
        truncated: false,
        nextOffset: null,
        ...boundary,
      }).receipts,
    ).toEqual([receipt]);
    expect(
      parseMobileSupportReceiptList({
        receipts: [receipt],
        truncated: true,
        nextOffset: null,
        ...boundary,
      }),
    ).toMatchObject({ truncated: true, nextOffset: null });
    expect(
      parseMobileSupportReceiptMutation({ receipt, reused: false, ...boundary }).receipt,
    ).toEqual(receipt);
    expect(() =>
      parseMobileSupportReceiptList({
        receipts: [{ ...receipt, message: 'content must not cross this boundary' }],
        truncated: false,
        nextOffset: null,
        ...boundary,
      }),
    ).toThrow();
    expect(() =>
      parseMobileSupportReceiptMutation({ receipt, reused: false, ...boundary, sent: true }),
    ).toThrow();
  });

  it('allows withdrawal only before a terminal receipt state', () => {
    expect(canWithdrawMobileSupportReceipt('open')).toBe(true);
    expect(canWithdrawMobileSupportReceipt('acknowledged')).toBe(true);
    expect(canWithdrawMobileSupportReceipt('in_review')).toBe(true);
    expect(canWithdrawMobileSupportReceipt('resolved')).toBe(false);
    expect(canWithdrawMobileSupportReceipt('withdrawn')).toBe(false);
  });

  it('terminally resolves definitive client failures but retains uncertain create retries', () => {
    for (const status of [400, 403, 404, 409, 422, 429]) {
      expect(isDefinitiveMobileSupportReceiptMutationFailure(status)).toBe(true);
    }
    for (const status of [undefined, 408, 500, 503]) {
      expect(isDefinitiveMobileSupportReceiptMutationFailure(status)).toBe(false);
    }
  });

  it('keeps navigation, accessibility, recovery, and email fallback boundaries explicit', () => {
    const app = source('apps/mobile/App.tsx');
    const screen = source('apps/mobile/src/support-screen.tsx');

    expect(app).toContain("import { SupportScreen } from './src/support-screen';");
    expect(app.match(/name="Support"/gu) ?? []).toHaveLength(3);
    expect(screen).toContain('apiPaths.supportReceipts');
    expect(screen).toContain('`${apiPaths.supportReceipts}/withdrawals`');
    expect(screen).toContain(
      'body: JSON.stringify({ category: operation.category, impact: operation.impact })',
    );
    expect(screen).toContain('body: JSON.stringify({ receiptCode })');
    expect(screen).toContain('accessibilityRole="radio"');
    expect(screen).toContain('accessibilityState={{');
    expect(screen).toContain('category === option.value && s.radioSelected');
    expect(screen).toContain('impact === option.value && s.radioSelected');
    expect(screen).toContain('Confirm withdrawal');
    expect(screen).toContain('Retry same receipt request');
    expect(screen).toMatch(
      /isDefinitiveMobileSupportReceiptMutationFailure\(caught\.status\)[\s\S]{0,120}setPendingCreate\(undefined\)/u,
    );
    expect(screen).toContain('Try loading receipts again');
    expect(screen).toContain(
      'setTerminalTruncation(response.truncated && response.nextOffset === null)',
    );
    expect(screen).toContain('Additional older receipts are outside this bounded history view.');
    expect(screen).toContain('Your receipt list was refreshed');
    expect(screen).toContain('customerErrorStatus(caught, 404)');
    expect(screen).toContain('customerErrorStatus(caught, 409)');
    expect(screen).toContain('Separate email option');
    expect(screen).toContain('Linking.openURL(`mailto:${supportEmail}`)');
    expect(screen).toContain('supportReceiptCodeSchema.parse(receiptCode)');
    expect(screen).toContain(
      '`mailto:${supportEmail}?subject=${encodeURIComponent(validatedReceiptCode)}`',
    );
    expect(screen).toContain('openSupportEmail(emailReceiptCode)');
    expect(screen).toContain('does not prefill the email body');
    expect(screen).toContain('Review any automatic signature before');
    expect(screen).toContain('No email is sent until you choose Send');
    expect(screen).not.toMatch(/[?&](?:body|cc|bcc)=/iu);
    expect(screen).toContain('does not promise 24-hour or real-time support coverage');
    expect(screen).toContain('not a guarantee that a person has seen it');
    expect(screen).not.toContain('Support is monitored');
    expect(screen).not.toMatch(
      /TextInput|textarea|provider\.send|messages\.create|twilio|stripe/iu,
    );
  });

  it('uses ASCII punctuation in the new mobile support files', () => {
    expect(
      `${source('apps/mobile/src/support-screen.tsx')}\n${source('apps/mobile/src/support-receipts.ts')}`,
    ).not.toMatch(/[\u2013\u2014]/u);
  });
});
