import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const source = (path: string): string => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('mobile feedback golden path', () => {
  it('wires authenticated household feedback into production navigation', () => {
    const app = source('apps/mobile/App.tsx');
    const navigation = source('apps/mobile/src/navigation.ts');
    const home = source('apps/mobile/src/screens.tsx');

    expect(navigation).toContain('Feedback: undefined;');
    expect(app).toContain("import { FeedbackScreen } from './src/feedback-screen';");
    expect(app).toContain('name="Feedback"');
    expect(app).toContain('component={FeedbackScreen}');
    expect(home).toContain('title="Share feedback"');
    expect(home).toContain("navigation.navigate('Feedback')");
    expect(home).toContain('{!isUnassigned ? (');
  });

  it('binds mutation, receipt, and consent withdrawal to one selected household', () => {
    const screen = source('apps/mobile/src/feedback-screen.tsx');

    expect(screen).toContain("key={selectedHouseholdId ?? 'unassigned'}");
    expect(screen).toContain('activeAttemptRef.current === attempt');
    expect(screen).toContain("headers: { 'X-BB-Household-Id': householdId }");
    expect(screen).toContain('receipt?.householdId === selectedHouseholdId');
    expect(screen).toContain('activeAttemptRef.current?.controller.abort();');
    expect(screen).toContain('/consents/${purpose}/withdraw`');
    expect(screen).toContain('parseMobileFeedbackConsentWithdrawalResponse(raw, {');
    expect(screen).toContain('feedbackId: currentReceipt.response.feedback.id');
    expect(screen).toContain('result.activeStoreCiphertextErased');
    expect(screen).toContain('applyMobileFeedbackConsentWithdrawal(current, {');
    expect(screen).not.toContain('result.activeStoreCiphertextErased\n            ? []');
  });

  it('keeps uncertain retries exact and validates every provider response', () => {
    const screen = source('apps/mobile/src/feedback-screen.tsx');
    const resource = source('apps/mobile/src/feedback-resource.ts');

    expect(screen).toContain('operation.formSignature !== formSignature');
    expect(screen).toContain('pendingOperation.current = operation;');
    expect(screen).toContain('pendingOperation.current = undefined;');
    expect(screen).toContain('parseMobileFeedbackIntakeResponse(raw)');
    expect(resource).toContain('createAuthenticatedFeedbackRequestSchema.parse');
    expect(resource).toContain('feedbackIntakeResponseSchema.parse');
    expect(resource).toContain('feedbackConsentWithdrawalResponseSchema.parse');
    expect(resource).toContain('result.feedbackId !== expected.feedbackId');
    expect(resource).toContain('result.purpose !== expected.purpose');
    expect(resource).toContain('result.withdrawn !== true');
    expect(resource).toContain('value !== input.purpose');
    expect(resource).toContain("surface: 'mobile_app'");
    expect(resource).toContain('link: { permitted: false }');
    expect(screen).toContain('Crypto.randomUUID()');
    expect(screen).not.toContain('globalThis.crypto.randomUUID()');
  });

  it('discloses feedback data and makes the exact flow part of signed-candidate review', () => {
    const metadata = JSON.parse(source('apps/mobile/store-metadata.json')) as {
      privacyDeclarations: { dataItems: Array<{ category: string; purposes: string[] }> };
      reviewerFlow: { steps: Array<{ id: string; preflightRequired: boolean }> };
    };
    const feedbackData = metadata.privacyDeclarations.dataItems.find(
      (item) => item.category === 'feedback_text_category_consent_and_receipt',
    );
    const reviewerStep = metadata.reviewerFlow.steps.find(
      (step) => step.id === 'text_feedback_and_consent_withdrawal',
    );

    expect(feedbackData?.purposes).toEqual(['app_functionality', 'customer_support', 'analytics']);
    expect(reviewerStep).toEqual(expect.objectContaining({ preflightRequired: true }));
  });
});
