import type { SupportReceiptRecordDto } from '@boomerbuddy/contracts';

export function canWithdrawSupportReceipt(state: SupportReceiptRecordDto['state']): boolean {
  return state === 'open' || state === 'acknowledged' || state === 'in_review';
}
