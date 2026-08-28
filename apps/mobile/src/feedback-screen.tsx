import type {
  CreateAuthenticatedFeedbackRequest,
  FeedbackIntakeResponse,
} from '@boomerbuddy/contracts';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { mobileRequest, readableError } from './api';
import {
  applyMobileFeedbackConsentWithdrawal,
  createMobileFeedbackRequest,
  mobileFeedbackDeviceClass,
  mobileFeedbackFormSignature,
  mobileFeedbackTextIsSubmittable,
  parseMobileFeedbackConsentWithdrawalResponse,
  parseMobileFeedbackIntakeResponse,
  type MobileFeedbackConsentPurpose,
  type MobileFeedbackFormValue,
  type MobileFeedbackType,
} from './feedback-resource';
import { useMobileHousehold } from './household';
import { appStyles as s } from './theme';

const feedbackTypes: readonly { readonly value: MobileFeedbackType; readonly label: string }[] = [
  { value: 'product_feedback', label: 'General product feedback' },
  { value: 'bug_report', label: 'Something did not work' },
  { value: 'safety_concern', label: 'Safety or scam-quality concern' },
  { value: 'accessibility_issue', label: 'Accessibility problem' },
  { value: 'support_request', label: 'Possible support need' },
  { value: 'pricing_feedback', label: 'Pricing feedback' },
  { value: 'feature_request', label: 'Feature idea' },
];

function operationKey(): string {
  return `feedback:${Crypto.randomUUID()}`;
}

type PendingFeedbackOperation = Readonly<{
  householdId: string;
  formSignature: string;
  request: CreateAuthenticatedFeedbackRequest;
}>;

type FeedbackReceiptState = Readonly<{
  householdId: string;
  response: FeedbackIntakeResponse;
  grantedPurposes: readonly MobileFeedbackConsentPurpose[];
  activeTextErased: boolean;
}>;

type FeedbackAttempt = Readonly<{
  householdId: string;
  controller: AbortController;
  kind: 'submit' | MobileFeedbackConsentPurpose;
}>;

export function FeedbackScreen(): React.ReactElement {
  const { selectedHouseholdId, selectedHouseholdName } = useMobileHousehold();
  return (
    <HouseholdFeedbackScreen
      key={selectedHouseholdId ?? 'unassigned'}
      selectedHouseholdId={selectedHouseholdId}
      selectedHouseholdName={selectedHouseholdName}
    />
  );
}

function HouseholdFeedbackScreen({
  selectedHouseholdId,
  selectedHouseholdName,
}: Readonly<{
  selectedHouseholdId: string | null;
  selectedHouseholdName: string;
}>): React.ReactElement {
  const { width, height } = useWindowDimensions();
  const pendingOperation = useRef<PendingFeedbackOperation | undefined>(undefined);
  const activeAttemptRef = useRef<FeedbackAttempt | undefined>(undefined);
  const [feedbackType, setFeedbackType] = useState<MobileFeedbackType>('product_feedback');
  const [text, setText] = useState('');
  const [followUp, setFollowUp] = useState(false);
  const [researchRetention, setResearchRetention] = useState(false);
  const [busy, setBusy] = useState<FeedbackAttempt['kind']>();
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<FeedbackReceiptState>();
  const [withdrawalNotice, setWithdrawalNotice] = useState('');

  useEffect(
    () => () => {
      activeAttemptRef.current?.controller.abort();
      activeAttemptRef.current = undefined;
    },
    [],
  );

  function attemptIsCurrent(attempt: FeedbackAttempt): boolean {
    return activeAttemptRef.current === attempt && !attempt.controller.signal.aborted;
  }

  function beginAttempt(
    householdId: string,
    kind: FeedbackAttempt['kind'],
  ): FeedbackAttempt | undefined {
    if (activeAttemptRef.current !== undefined) return undefined;
    const attempt: FeedbackAttempt = {
      householdId,
      controller: new AbortController(),
      kind,
    };
    activeAttemptRef.current = attempt;
    setBusy(kind);
    setError('');
    setWithdrawalNotice('');
    return attempt;
  }

  function finishAttempt(attempt: FeedbackAttempt): void {
    if (activeAttemptRef.current !== attempt) return;
    activeAttemptRef.current = undefined;
    setBusy(undefined);
  }

  const form: MobileFeedbackFormValue = {
    feedbackType,
    text,
    followUp,
    researchRetention,
    deviceClass: mobileFeedbackDeviceClass(width, height),
  };
  const canSubmit = selectedHouseholdId !== null && mobileFeedbackTextIsSubmittable(text);
  const visibleReceipt = receipt?.householdId === selectedHouseholdId ? receipt : undefined;

  async function submit(): Promise<void> {
    const householdId = selectedHouseholdId;
    if (!householdId || !mobileFeedbackTextIsSubmittable(text)) {
      setError('Enter at least 4 characters and keep feedback within 8192 UTF-8 bytes.');
      return;
    }
    const formSignature = mobileFeedbackFormSignature(form);
    let operation = pendingOperation.current;
    if (operation?.householdId !== householdId || operation.formSignature !== formSignature) {
      try {
        operation = {
          householdId,
          formSignature,
          request: createMobileFeedbackRequest({
            operationKey: operationKey(),
            form,
            now: new Date(),
          }),
        };
      } catch {
        setError('Enter at least 4 characters and keep feedback within 8192 UTF-8 bytes.');
        return;
      }
      pendingOperation.current = operation;
    }
    const attempt = beginAttempt(householdId, 'submit');
    if (!attempt) return;
    try {
      const raw = await mobileRequest<unknown>('/v1/feedback', {
        method: 'POST',
        headers: { 'X-BB-Household-Id': householdId },
        body: JSON.stringify(operation.request),
        signal: attempt.controller.signal,
      });
      const result = parseMobileFeedbackIntakeResponse(raw);
      if (!attemptIsCurrent(attempt)) return;
      setReceipt({
        householdId,
        response: result,
        grantedPurposes: [
          ...(operation.request.followUp.granted ? (['follow_up'] as const) : []),
          ...(operation.request.researchRetention.granted ? (['research_retention'] as const) : []),
        ],
        activeTextErased: false,
      });
      setText('');
      setFollowUp(false);
      setResearchRetention(false);
      pendingOperation.current = undefined;
    } catch (caught) {
      if (attemptIsCurrent(attempt)) setError(readableError(caught));
    } finally {
      finishAttempt(attempt);
    }
  }

  async function withdrawConsent(purpose: MobileFeedbackConsentPurpose): Promise<void> {
    const householdId = selectedHouseholdId;
    const currentReceipt = visibleReceipt;
    if (!householdId || !currentReceipt?.grantedPurposes.includes(purpose)) return;
    const attempt = beginAttempt(householdId, purpose);
    if (!attempt) return;
    try {
      const raw = await mobileRequest<unknown>(
        `/v1/feedback/${encodeURIComponent(currentReceipt.response.feedback.id)}/consents/${purpose}/withdraw`,
        {
          method: 'POST',
          headers: { 'X-BB-Household-Id': householdId },
          signal: attempt.controller.signal,
        },
      );
      const result = parseMobileFeedbackConsentWithdrawalResponse(raw, {
        feedbackId: currentReceipt.response.feedback.id,
        purpose,
      });
      if (!attemptIsCurrent(attempt)) return;
      setReceipt((current) => {
        if (current !== currentReceipt) return current;
        const consentState = applyMobileFeedbackConsentWithdrawal(current, {
          purpose,
          activeStoreCiphertextErased: result.activeStoreCiphertextErased,
        });
        return {
          ...current,
          ...consentState,
        };
      });
      setWithdrawalNotice(
        result.activeStoreCiphertextErased
          ? 'Consent withdrawn. The retained minimized text was erased.'
          : 'Consent withdrawn.',
      );
    } catch (caught) {
      if (attemptIsCurrent(attempt)) setError(readableError(caught));
    } finally {
      finishAttempt(attempt);
    }
  }

  return (
    <ScrollView style={s.safe} contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={s.title}>
        Share feedback
      </Text>
      {selectedHouseholdId ? (
        <View style={s.scopeBanner}>
          <Text style={s.label}>Active household: {selectedHouseholdName}</Text>
          <Text style={s.muted}>This feedback and its receipt belong only to this household.</Text>
        </View>
      ) : (
        <View style={s.banner} accessibilityRole="alert">
          <Text style={s.label}>A household is required</Text>
          <Text style={s.muted}>Join or select a household before submitting feedback.</Text>
        </View>
      )}
      <View style={s.banner} accessibilityRole="summary">
        <Text style={s.label}>Text-only feedback</Text>
        <Text style={s.muted}>
          Do not paste passwords, payment-card numbers, bank credentials, one-time codes, private
          keys, crypto seed phrases, Family Safe Words, or emergency details. You can send text
          only. This is not emergency response and does not open a support request. BoomerBuddy does
          not accept attachments or recordings here, send this feedback to outside AI services, or
          contact you by email or text.
        </Text>
      </View>

      <Text style={s.label}>What kind of feedback is this?</Text>
      {feedbackTypes.map((option) => (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: feedbackType === option.value }}
          disabled={busy !== undefined}
          key={option.value}
          onPress={() => setFeedbackType(option.value)}
          style={[
            s.choice,
            feedbackType === option.value && s.choiceSelected,
            busy !== undefined && s.buttonDisabled,
          ]}
        >
          <View style={[s.radio, feedbackType === option.value && s.radioSelected]} />
          <Text style={s.body}>{option.label}</Text>
        </Pressable>
      ))}

      <Text style={s.label}>Your feedback</Text>
      <TextInput
        accessibilityLabel="Your feedback"
        editable={busy === undefined}
        maxLength={8_192}
        multiline
        onChangeText={setText}
        placeholder="Tell us what happened and what would help."
        style={[s.input, s.textarea]}
        value={text}
      />

      <View style={s.choice}>
        <Switch
          accessibilityLabel="Allow in-app follow-up"
          disabled={busy !== undefined}
          onValueChange={setFollowUp}
          value={followUp}
        />
        <Text style={s.body}>Allow an in-app follow-up. This does not authorize email or SMS.</Text>
      </View>
      <View style={s.choice}>
        <Switch
          accessibilityLabel="Allow short research retention"
          disabled={busy !== undefined}
          onValueChange={setResearchRetention}
          value={researchRetention}
        />
        <Text style={s.body}>
          Allow minimized text to remain available for product-feedback research for up to 23 hours.
        </Text>
      </View>
      <Text style={s.muted}>
        Without research retention, minimized text is scheduled for erasure after one hour. With
        permission, it may remain for up to 23 hours. Attachments and outside AI processing are not
        available.
      </Text>

      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy !== undefined || !canSubmit }}
        disabled={busy !== undefined || !canSubmit}
        onPress={() => void submit()}
        style={({ pressed }) => [
          s.button,
          s.buttonPrimary,
          (busy !== undefined || !canSubmit) && s.buttonDisabled,
          pressed && { opacity: 0.82 },
        ]}
      >
        <Text style={s.buttonTextPrimary}>
          {busy === 'submit' ? 'Recording...' : 'Submit feedback'}
        </Text>
      </Pressable>

      {visibleReceipt ? (
        <View style={s.card} accessibilityLiveRegion="polite">
          <Text style={s.label}>Feedback received</Text>
          <Text style={s.body}>
            Your feedback was recorded with reference {visibleReceipt.response.feedback.id}.
          </Text>
          <Text style={s.muted}>
            This did not open a support case or start an email or text message. If you allowed
            follow-up, it can happen only inside BoomerBuddy.
          </Text>
          {visibleReceipt.activeTextErased ? (
            <Text style={s.muted}>The retained minimized text was erased.</Text>
          ) : visibleReceipt.response.feedback.retainedUntil ? (
            <Text style={s.muted}>
              Feedback text is scheduled for deletion by{' '}
              {new Date(visibleReceipt.response.feedback.retainedUntil).toLocaleString()}.
            </Text>
          ) : (
            <Text style={s.muted}>
              Text that may contain unsafe secret information was not retained.
            </Text>
          )}
          {visibleReceipt.grantedPurposes.map((purpose) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy !== undefined }}
              disabled={busy !== undefined}
              key={purpose}
              onPress={() => void withdrawConsent(purpose)}
              style={({ pressed }) => [
                s.button,
                s.buttonSecondary,
                busy !== undefined && s.buttonDisabled,
                pressed && { opacity: 0.82 },
              ]}
            >
              <Text style={s.buttonTextSecondary}>
                {busy === purpose
                  ? 'Withdrawing...'
                  : `Withdraw ${purpose === 'follow_up' ? 'follow-up' : 'research retention'} consent`}
              </Text>
            </Pressable>
          ))}
          {withdrawalNotice ? (
            <Text accessibilityRole="summary" style={s.muted}>
              {withdrawalNotice}
            </Text>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
