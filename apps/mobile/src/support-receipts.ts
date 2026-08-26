import {
  supportReceiptCreateOperationKeySchema,
  supportReceiptListResponseSchema,
  supportReceiptMutationResponseSchema,
  supportReceiptWithdrawalOperationKeySchema,
  type CreateSupportReceiptRequest,
  type SupportReceiptRecordDto,
} from '@boomerbuddy/contracts';

export type MobileSupportReceiptCategory = CreateSupportReceiptRequest['category'];
export type MobileSupportReceiptImpact = CreateSupportReceiptRequest['impact'];
export type MobileSupportReceiptListResponse = ReturnType<
  typeof supportReceiptListResponseSchema.parse
>;
export type MobileSupportReceiptMutationResponse = ReturnType<
  typeof supportReceiptMutationResponseSchema.parse
>;

export const mobileSupportReceiptCategories: readonly {
  readonly value: MobileSupportReceiptCategory;
  readonly label: string;
}[] = [
  { value: 'account_access', label: 'Signing in or account access' },
  { value: 'billing', label: 'Billing or membership payment' },
  { value: 'check_experience', label: 'Checking a message or website' },
  { value: 'family_access', label: 'Family or Trusted Circle access' },
  { value: 'mobile_app', label: 'Mobile app' },
  { value: 'privacy', label: 'Privacy or account deletion' },
  { value: 'service_availability', label: 'Service availability' },
];

export const mobileSupportReceiptImpacts: readonly {
  readonly value: MobileSupportReceiptImpact;
  readonly label: string;
}[] = [
  { value: 'question', label: 'I have a question' },
  { value: 'degraded', label: 'Something works only partly' },
  { value: 'blocked', label: 'I cannot continue' },
  { value: 'safety_concern', label: 'I have a safety concern' },
];

export const mobileSupportReceiptStateLabels: Readonly<
  Record<SupportReceiptRecordDto['state'], string>
> = {
  open: 'Received',
  acknowledged: 'Acknowledged',
  in_review: 'In review',
  resolved: 'Resolved',
  withdrawn: 'Withdrawn',
};

export const mobileSupportReceiptResolutionLabels: Readonly<
  Record<NonNullable<SupportReceiptRecordDto['resolutionCode']>, string>
> = {
  completed: 'Completed',
  duplicate: 'Duplicate receipt',
  insufficient_content_free_evidence: 'Not enough content-free information',
  outside_supported_scope: 'Outside supported scope',
};

export function canWithdrawMobileSupportReceipt(state: SupportReceiptRecordDto['state']): boolean {
  return state === 'open' || state === 'acknowledged' || state === 'in_review';
}

export function isDefinitiveMobileSupportReceiptMutationFailure(
  status: number | undefined,
): boolean {
  return status !== undefined && status >= 400 && status < 500 && status !== 408;
}

export function mobileSupportReceiptOperationKey(
  kind: 'create' | 'withdraw',
  uuid: string,
): string {
  const value = `support-receipt:${kind}:${uuid}`;
  return kind === 'create'
    ? supportReceiptCreateOperationKeySchema.parse(value)
    : supportReceiptWithdrawalOperationKeySchema.parse(value);
}

export function parseMobileSupportReceiptList(value: unknown): MobileSupportReceiptListResponse {
  return supportReceiptListResponseSchema.parse(value);
}

export function parseMobileSupportReceiptMutation(
  value: unknown,
): MobileSupportReceiptMutationResponse {
  return supportReceiptMutationResponseSchema.parse(value);
}
