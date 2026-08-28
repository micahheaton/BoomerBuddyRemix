import {
  createAuthenticatedFeedbackRequestSchema,
  feedbackConsentWithdrawalResponseSchema,
  feedbackIntakeResponseSchema,
  type CreateAuthenticatedFeedbackRequest,
  type FeedbackConsentWithdrawalResponse,
  type FeedbackIntakeResponse,
} from '@boomerbuddy/contracts';

export type MobileFeedbackType = CreateAuthenticatedFeedbackRequest['feedbackType'];
export type MobileFeedbackDeviceClass = 'phone' | 'tablet';
export type MobileFeedbackConsentPurpose = 'follow_up' | 'research_retention';

export type MobileFeedbackReceiptConsentState = Readonly<{
  grantedPurposes: readonly MobileFeedbackConsentPurpose[];
  activeTextErased: boolean;
}>;

export type MobileFeedbackFormValue = Readonly<{
  feedbackType: MobileFeedbackType;
  text: string;
  followUp: boolean;
  researchRetention: boolean;
  deviceClass: MobileFeedbackDeviceClass;
}>;

const researchRetentionDurationMs = 23 * 60 * 60_000;

export function mobileFeedbackDeviceClass(
  width: number,
  height: number,
): MobileFeedbackDeviceClass {
  return Math.min(width, height) >= 600 ? 'tablet' : 'phone';
}

export function mobileFeedbackTextIsSubmittable(text: string): boolean {
  const normalized = text.trim();
  return normalized.length >= 4 && new TextEncoder().encode(normalized).byteLength <= 8_192;
}

export function mobileFeedbackFormSignature(value: MobileFeedbackFormValue): string {
  return JSON.stringify([
    value.feedbackType,
    value.text.trim(),
    value.followUp,
    value.researchRetention,
    value.deviceClass,
  ]);
}

export function createMobileFeedbackRequest(input: {
  readonly operationKey: string;
  readonly form: MobileFeedbackFormValue;
  readonly now: Date;
}): CreateAuthenticatedFeedbackRequest {
  return createAuthenticatedFeedbackRequestSchema.parse({
    operationKey: input.operationKey,
    text: input.form.text,
    feedbackType: input.form.feedbackType,
    source: {
      surface: 'mobile_app',
      deviceClass: input.form.deviceClass,
    },
    link: { permitted: false },
    followUp: input.form.followUp
      ? {
          granted: true,
          purpose: 'feedback_follow_up',
          consentVersion: 'feedback-follow-up-v1',
          channelClass: 'in_app',
        }
      : { granted: false },
    researchRetention: input.form.researchRetention
      ? {
          granted: true,
          purpose: 'product_feedback_research',
          consentVersion: 'feedback-research-v1',
          retainUntil: new Date(input.now.getTime() + researchRetentionDurationMs).toISOString(),
        }
      : { granted: false },
  });
}

export function parseMobileFeedbackIntakeResponse(value: unknown): FeedbackIntakeResponse {
  return feedbackIntakeResponseSchema.parse(value);
}

export function parseMobileFeedbackConsentWithdrawalResponse(
  value: unknown,
  expected: Readonly<{
    feedbackId: string;
    purpose: MobileFeedbackConsentPurpose;
  }>,
): FeedbackConsentWithdrawalResponse {
  const result = feedbackConsentWithdrawalResponseSchema.parse(value);
  if (
    result.feedbackId !== expected.feedbackId ||
    result.purpose !== expected.purpose ||
    result.withdrawn !== true
  ) {
    throw new Error('Feedback consent withdrawal did not confirm the requested mutation.');
  }
  return result;
}

export function applyMobileFeedbackConsentWithdrawal(
  current: MobileFeedbackReceiptConsentState,
  input: Readonly<{
    purpose: MobileFeedbackConsentPurpose;
    activeStoreCiphertextErased: boolean;
  }>,
): MobileFeedbackReceiptConsentState {
  return {
    grantedPurposes: current.grantedPurposes.filter((value) => value !== input.purpose),
    activeTextErased: current.activeTextErased || input.activeStoreCiphertextErased,
  };
}
