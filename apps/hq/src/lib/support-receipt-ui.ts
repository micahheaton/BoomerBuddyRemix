import type { HqSupportReceiptRecordDto } from '@boomerbuddy/contracts';

export type TransitionAction = 'acknowledge' | 'start_review' | 'resolve';

export function supportReceiptActions(
  state: HqSupportReceiptRecordDto['state'],
): readonly TransitionAction[] {
  if (state === 'open') return ['acknowledge'];
  if (state === 'acknowledged') return ['start_review', 'resolve'];
  if (state === 'in_review') return ['resolve'];
  return [];
}
