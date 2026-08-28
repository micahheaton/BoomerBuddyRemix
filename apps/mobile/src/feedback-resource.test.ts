import { describe, expect, it } from 'vitest';
import {
  applyMobileFeedbackConsentWithdrawal,
  createMobileFeedbackRequest,
  mobileFeedbackDeviceClass,
  mobileFeedbackFormSignature,
  mobileFeedbackTextIsSubmittable,
  parseMobileFeedbackConsentWithdrawalResponse,
  parseMobileFeedbackIntakeResponse,
} from './feedback-resource';

const operationKey = 'feedback:00000000-0000-4000-8000-000000000123';

describe('mobile feedback resource', () => {
  it('classifies phone and tablet layouts from the shortest side', () => {
    expect(mobileFeedbackDeviceClass(390, 844)).toBe('phone');
    expect(mobileFeedbackDeviceClass(1_024, 768)).toBe('tablet');
    expect(mobileFeedbackDeviceClass(599, 1_200)).toBe('phone');
    expect(mobileFeedbackDeviceClass(600, 900)).toBe('tablet');
  });

  it('enforces the server UTF-8 byte boundary before submission', () => {
    expect(mobileFeedbackTextIsSubmittable('abc')).toBe(false);
    expect(mobileFeedbackTextIsSubmittable(' useful feedback ')).toBe(true);
    expect(mobileFeedbackTextIsSubmittable('x'.repeat(8_192))).toBe(true);
    expect(mobileFeedbackTextIsSubmittable('\u{1f642}'.repeat(2_049))).toBe(false);
  });

  it('creates the exact mobile text-only request and a bounded research deadline', () => {
    const now = new Date('2026-08-28T08:00:00.000Z');
    const request = createMobileFeedbackRequest({
      operationKey,
      now,
      form: {
        feedbackType: 'accessibility_issue',
        text: 'The larger text layout needs more spacing.',
        followUp: true,
        researchRetention: true,
        deviceClass: 'tablet',
      },
    });

    expect(request).toEqual({
      operationKey,
      text: 'The larger text layout needs more spacing.',
      feedbackType: 'accessibility_issue',
      source: { surface: 'mobile_app', deviceClass: 'tablet' },
      link: { permitted: false },
      followUp: {
        granted: true,
        purpose: 'feedback_follow_up',
        consentVersion: 'feedback-follow-up-v1',
        channelClass: 'in_app',
      },
      researchRetention: {
        granted: true,
        purpose: 'product_feedback_research',
        consentVersion: 'feedback-research-v1',
        retainUntil: '2026-08-29T07:00:00.000Z',
      },
    });
  });

  it('reuses an operation only while the exact normalized form remains unchanged', () => {
    const value = {
      feedbackType: 'product_feedback' as const,
      text: '  Helpful lesson.  ',
      followUp: false,
      researchRetention: false,
      deviceClass: 'phone' as const,
    };
    expect(mobileFeedbackFormSignature(value)).toBe(
      mobileFeedbackFormSignature({ ...value, text: 'Helpful lesson.' }),
    );
    expect(mobileFeedbackFormSignature(value)).not.toBe(
      mobileFeedbackFormSignature({ ...value, followUp: true }),
    );
  });

  it('fails closed on malformed intake and withdrawal responses', () => {
    expect(() =>
      parseMobileFeedbackIntakeResponse({
        feedback: {
          id: 'feedback-123',
          status: 'queued_unassigned',
          redactionStatus: 'minimized_clean',
          queue: 'new_feedback',
          evidenceTier: 'live_production',
          reused: false,
        },
        mediaAccepted: false,
        providerProcessed: false,
        externalActionExecuted: true,
      }),
    ).toThrow();
    expect(() =>
      parseMobileFeedbackConsentWithdrawalResponse(
        {
          feedbackId: 'feedback-123',
          purpose: 'follow_up',
          withdrawn: true,
          activeStoreCiphertextErased: false,
          externalActionExecuted: true,
        },
        { feedbackId: 'feedback-123', purpose: 'follow_up' },
      ),
    ).toThrow();
  });

  it('fails closed when withdrawal confirmation does not match the requested mutation', () => {
    const confirmation = {
      feedbackId: 'feedback-123',
      purpose: 'follow_up' as const,
      withdrawn: true,
      activeStoreCiphertextErased: false,
      externalActionExecuted: false,
    };
    const expected = { feedbackId: 'feedback-123', purpose: 'follow_up' as const };

    expect(parseMobileFeedbackConsentWithdrawalResponse(confirmation, expected)).toEqual(
      confirmation,
    );
    expect(() =>
      parseMobileFeedbackConsentWithdrawalResponse(
        { ...confirmation, feedbackId: 'feedback-other' },
        expected,
      ),
    ).toThrow();
    expect(() =>
      parseMobileFeedbackConsentWithdrawalResponse(
        { ...confirmation, purpose: 'research_retention' },
        expected,
      ),
    ).toThrow();
    expect(() =>
      parseMobileFeedbackConsentWithdrawalResponse({ ...confirmation, withdrawn: false }, expected),
    ).toThrow();
  });

  it('withdraws independent grants in sequence after retained text is erased', () => {
    const initialConsentState = {
      grantedPurposes: ['follow_up', 'research_retention'] as const,
      activeTextErased: false,
    };

    const afterResearchWithdrawal = applyMobileFeedbackConsentWithdrawal(initialConsentState, {
      purpose: 'research_retention',
      activeStoreCiphertextErased: true,
    });
    expect(afterResearchWithdrawal).toEqual({
      grantedPurposes: ['follow_up'],
      activeTextErased: true,
    });

    const afterFollowUpWithdrawal = applyMobileFeedbackConsentWithdrawal(afterResearchWithdrawal, {
      purpose: 'follow_up',
      activeStoreCiphertextErased: false,
    });
    expect(afterFollowUpWithdrawal).toEqual({
      grantedPurposes: [],
      activeTextErased: true,
    });
  });
});
