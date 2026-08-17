import { describe, expect, it } from 'vitest';
import {
  assignedFeedbackContentResponseSchema,
  createAnonymousFeedbackRequestSchema,
  createAuthenticatedFeedbackRequestSchema,
  feedbackConsentWithdrawalResponseSchema,
  feedbackIntakeResponseSchema,
  hqFeedbackQueueResponseSchema,
  supportFeedbackConversionRequestSchema,
} from './feedback';

const operationKey = 'feedback:99d88d04-66bc-4f7a-9093-05d1a732d1e2';
const source = {
  surface: 'web_feedback_form' as const,
  appVersion: 'web-3.0.0',
  locale: 'en-US',
  deviceClass: 'desktop' as const,
};

describe('feedback contracts', () => {
  it('accepts explicit authenticated consent choices without destinations', () => {
    expect(
      createAuthenticatedFeedbackRequestSchema.parse({
        operationKey,
        text: 'The primary button was difficult to find.',
        feedbackType: 'product_feedback',
        source,
        link: { permitted: false },
        followUp: {
          granted: true,
          purpose: 'feedback_follow_up',
          consentVersion: 'feedback-follow-up-v1',
          channelClass: 'in_app',
        },
        researchRetention: { granted: false },
      }),
    ).toBeDefined();
  });

  it('rejects covert anonymous linkage, follow-up destinations, and media fields', () => {
    const base = {
      operationKey,
      text: 'The primary button was difficult to find.',
      feedbackType: 'product_feedback',
      source,
      link: { permitted: false },
      followUp: { granted: false },
      researchRetention: { granted: false },
    };
    expect(() =>
      createAnonymousFeedbackRequestSchema.parse({
        ...base,
        link: {
          permitted: true,
          consentVersion: 'feedback-linkage-v1',
          objectType: 'check',
          objectId: 'check-secret',
        },
      }),
    ).toThrow();
    expect(() =>
      createAnonymousFeedbackRequestSchema.parse({
        ...base,
        followUp: { granted: false, email: 'person@example.test' },
      }),
    ).toThrow();
    expect(() =>
      createAnonymousFeedbackRequestSchema.parse({ ...base, attachmentIds: ['media-one'] }),
    ).toThrow();
  });

  it('requires exact contextual linkage and reserves support conversion for HQ', () => {
    expect(() =>
      createAuthenticatedFeedbackRequestSchema.parse({
        operationKey,
        text: 'The result was confusing to me.',
        feedbackType: 'product_feedback',
        source: { ...source, surface: 'post_check' },
        link: { permitted: false },
        followUp: { granted: false },
        researchRetention: { granted: false },
      }),
    ).toThrow(/exact check link/u);
    expect(() =>
      supportFeedbackConversionRequestSchema.parse({
        operationKey,
        text: 'Customer described a navigation blocker.',
        feedbackType: 'accessibility_issue',
        source: { ...source, surface: 'support_conversion' },
        followUp: { granted: true },
      }),
    ).toThrow();
  });

  it('makes the local-only evidence and no-effect boundary explicit', () => {
    expect(
      feedbackIntakeResponseSchema.parse({
        feedback: {
          id: 'feedback-example',
          status: 'queued_unassigned',
          redactionStatus: 'minimized_clean',
          queue: 'new_feedback',
          evidenceTier: 'local_simulation',
          retainedUntil: '2026-08-17T00:00:00.000Z',
          reused: false,
        },
        mediaAccepted: false,
        providerProcessed: false,
        externalActionExecuted: false,
      }),
    ).toBeDefined();
    expect(
      feedbackConsentWithdrawalResponseSchema.parse({
        feedbackId: 'feedback-example',
        purpose: 'research_retention',
        withdrawn: true,
        activeStoreCiphertextErased: true,
        externalActionExecuted: false,
      }),
    ).toBeDefined();
    expect(() =>
      feedbackConsentWithdrawalResponseSchema.parse({
        feedbackId: 'feedback-example',
        purpose: 'research_retention',
        withdrawn: true,
        activeStoreCiphertextErased: true,
        backupErased: true,
        externalActionExecuted: false,
      }),
    ).toThrow();
  });

  it('allows only content-free owner-global or exact-assignee queue metadata', () => {
    expect(
      hqFeedbackQueueResponseSchema.parse({
        projection: 'owner_global_or_exact_assigned_feedback_metadata',
        contentIncluded: false,
        externalActionExecuted: false,
        feedback: [
          {
            id: 'feedback-example',
            identityMode: 'anonymous',
            sourceSurface: 'web_feedback_form',
            feedbackType: 'product_feedback',
            status: 'minimized',
            severity: 'unassessed',
            classification: 'unclassified',
            queue: 'new_feedback',
            routingState: 'unassigned',
            redactionStatus: 'minimized_clean',
            closeLoopState: 'not_requested',
            followUpConsented: false,
            researchRetentionConsented: false,
            evidenceTier: 'local_simulation',
            version: 2,
            createdAt: '2026-08-17T00:00:00.000Z',
            routedAt: '2026-08-17T00:00:00.000Z',
            contentReadAuthorized: false,
            selfClaimAvailable: false,
          },
        ],
      }),
    ).toBeDefined();
    expect(() =>
      hqFeedbackQueueResponseSchema.parse({
        projection: 'owner_global_or_exact_assigned_feedback_metadata',
        contentIncluded: false,
        externalActionExecuted: false,
        feedback: [{ text: 'content must never enter this projection' }],
      }),
    ).toThrow();
  });

  it('allows only assigned minimized text through the narrow content response', () => {
    const response = {
      feedbackId: 'feedback-example',
      minimizedText: 'The primary button was difficult to find.',
      redactionStatus: 'minimized_clean',
      evidenceTier: 'local_simulation',
      contentBoundary: 'assigned_minimized_text',
      externalActionExecuted: false,
    } as const;
    expect(assignedFeedbackContentResponseSchema.parse(response)).toEqual(response);
    expect(() =>
      assignedFeedbackContentResponseSchema.parse({ ...response, encryptedText: 'forbidden' }),
    ).toThrow();
  });
});
