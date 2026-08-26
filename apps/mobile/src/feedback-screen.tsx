import type { FeedbackIntakeResponse } from '@boomerbuddy/contracts';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { mobileRequest, readableError } from './api';
import { appStyles as s } from './theme';

type FeedbackType =
  | 'product_feedback'
  | 'bug_report'
  | 'safety_concern'
  | 'accessibility_issue'
  | 'support_request'
  | 'pricing_feedback'
  | 'feature_request';

const feedbackTypes: readonly { readonly value: FeedbackType; readonly label: string }[] = [
  { value: 'product_feedback', label: 'General product feedback' },
  { value: 'bug_report', label: 'Something did not work' },
  { value: 'safety_concern', label: 'Safety or scam-quality concern' },
  { value: 'accessibility_issue', label: 'Accessibility problem' },
  { value: 'support_request', label: 'Support request' },
  { value: 'pricing_feedback', label: 'Pricing feedback' },
  { value: 'feature_request', label: 'Feature idea' },
];

function operationKey(): string {
  return `feedback:${globalThis.crypto.randomUUID()}`;
}

export function FeedbackScreen() {
  const operation = useRef(operationKey());
  const [feedbackType, setFeedbackType] = useState<FeedbackType>('product_feedback');
  const [text, setText] = useState('');
  const [followUp, setFollowUp] = useState(false);
  const [researchRetention, setResearchRetention] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<FeedbackIntakeResponse>();

  async function submit(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const result = await mobileRequest<FeedbackIntakeResponse>('/v1/feedback', {
        method: 'POST',
        body: JSON.stringify({
          operationKey: operation.current,
          text,
          feedbackType,
          source: { surface: 'mobile_app', deviceClass: 'phone' },
          link: { permitted: false },
          followUp: followUp
            ? {
                granted: true,
                purpose: 'feedback_follow_up',
                consentVersion: 'feedback-follow-up-v1',
                channelClass: 'in_app',
              }
            : { granted: false },
          researchRetention: researchRetention
            ? {
                granted: true,
                purpose: 'product_feedback_research',
                consentVersion: 'feedback-research-v1',
                retainUntil: new Date(Date.now() + 23 * 60 * 60_000).toISOString(),
              }
            : { granted: false },
        }),
      });
      setReceipt(result);
      setText('');
      operation.current = operationKey();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.safe} contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={s.title}>
        Share feedback
      </Text>
      <View style={s.banner} accessibilityRole="summary">
        <Text style={s.label}>Text-only feedback</Text>
        <Text style={s.muted}>
          Do not paste passwords, payment-card numbers, one-time codes, private keys, or emergency
          details. You can send text only. BoomerBuddy does not accept attachments or recordings
          here, send this feedback to outside AI services, or contact you by email or text.
        </Text>
      </View>

      <Text style={s.label}>What kind of feedback is this?</Text>
      {feedbackTypes.map((option) => (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: feedbackType === option.value }}
          key={option.value}
          onPress={() => setFeedbackType(option.value)}
          style={[s.choice, feedbackType === option.value && s.choiceSelected]}
        >
          <View style={[s.radio, feedbackType === option.value && s.radioSelected]} />
          <Text style={s.body}>{option.label}</Text>
        </Pressable>
      ))}

      <Text style={s.label}>Your feedback</Text>
      <TextInput
        accessibilityLabel="Your feedback"
        editable={!busy}
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
          onValueChange={setFollowUp}
          value={followUp}
        />
        <Text style={s.body}>Allow an in-app follow-up. This does not authorize email or SMS.</Text>
      </View>
      <View style={s.choice}>
        <Switch
          accessibilityLabel="Allow short research retention"
          onValueChange={setResearchRetention}
          value={researchRetention}
        />
        <Text style={s.body}>
          Allow minimized text to remain available for product-feedback research for up to 23 hours.
        </Text>
      </View>

      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || text.trim().length < 4 }}
        disabled={busy || text.trim().length < 4}
        onPress={() => void submit()}
        style={({ pressed }) => [
          s.button,
          s.buttonPrimary,
          (busy || text.trim().length < 4) && s.buttonDisabled,
          pressed && { opacity: 0.82 },
        ]}
      >
        <Text style={s.buttonTextPrimary}>{busy ? 'Recording...' : 'Submit feedback'}</Text>
      </Pressable>

      {receipt ? (
        <View style={s.card} accessibilityLiveRegion="polite">
          <Text style={s.label}>Feedback received</Text>
          <Text style={s.body}>
            Your feedback was recorded with reference {receipt.feedback.id}.
          </Text>
          <Text style={s.muted}>
            This did not open a support case or start an email or text message. If you allowed
            follow-up, it can happen only inside BoomerBuddy.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
