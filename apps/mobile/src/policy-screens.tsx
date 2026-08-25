import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '@clerk/expo';
import type { PrivacyRequestDto } from '@boomerbuddy/contracts';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { mobileRequest, readableError } from './api';
import type { RootStackParamList } from './navigation';
import { appStyles as s } from './theme';

const supportEmail = 'support@boomerbuddy.net';

function PolicyLayout({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}): React.ReactElement {
  return (
    <ScrollView style={s.safe} contentContainerStyle={s.screen}>
      <Text accessibilityRole="header" style={s.title}>
        {title}
      </Text>
      <Text style={s.body}>{summary}</Text>
      {children}
    </ScrollView>
  );
}

function PolicySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={s.card}>
      <Text style={s.heading}>{title}</Text>
      {children}
    </View>
  );
}

function PolicyButton({
  title,
  onPress,
  disabled = false,
  kind = 'secondary',
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: 'secondary' | 'danger';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        kind === 'danger' ? s.buttonDanger : s.buttonSecondary,
        disabled && s.buttonDisabled,
        pressed && { opacity: 0.82 },
      ]}
    >
      <Text style={kind === 'danger' ? s.buttonTextDanger : s.buttonTextSecondary}>{title}</Text>
    </Pressable>
  );
}

export function HelpPoliciesScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'HelpPolicies'>): React.ReactElement {
  return (
    <PolicyLayout
      title="Help and policies"
      summary="Get product help and review the privacy, safety, accessibility, and deletion information that applies to your account."
    >
      <View style={s.navGrid}>
        <PolicyButton title="Support" onPress={() => navigation.navigate('Support')} />
        <PolicyButton title="Privacy" onPress={() => navigation.navigate('Privacy')} />
        <PolicyButton title="Terms" onPress={() => navigation.navigate('Terms')} />
        <PolicyButton title="Accessibility" onPress={() => navigation.navigate('Accessibility')} />
        <PolicyButton
          title="Account deletion"
          onPress={() => navigation.navigate('AccountDeletion')}
        />
      </View>
      <PolicySection title="Urgent help">
        <Text style={s.body}>
          BoomerBuddy is not an emergency service. If anyone is in immediate danger, contact local
          emergency services. For a bank or account problem, use contact information you find
          independently from the organization.
        </Text>
      </PolicySection>
    </PolicyLayout>
  );
}

export function SupportScreen(): React.ReactElement {
  return (
    <PolicyLayout
      title="Customer support"
      summary="Use support for account, privacy, accessibility, or product help."
    >
      <PolicySection title="Contact support">
        <Text style={s.body}>
          Email <Text style={s.label}>{supportEmail}</Text> and briefly describe the help you need.
        </Text>
        <Text selectable style={s.label}>
          {supportEmail}
        </Text>
        <Text style={s.muted}>
          Do not send passwords, verification codes, payment-card details, safe words, or the full
          text of a suspicious message.
        </Text>
      </PolicySection>
      <PolicySection title="Response and safety">
        <Text style={s.body}>
          Support is monitored on a best-effort basis and does not promise 24-hour coverage. For an
          immediate threat, contact local emergency services.
        </Text>
      </PolicySection>
    </PolicyLayout>
  );
}

export function PrivacyScreen(): React.ReactElement {
  return (
    <PolicyLayout
      title="Privacy"
      summary="BoomerBuddy uses only the information needed to provide and protect your account and household features."
    >
      <PolicySection title="Information used">
        <Text style={s.body}>
          This may include account and session information, household roles and consent, material
          you deliberately submit for a Check, saved results, feedback, support messages, and
          limited device and security records.
        </Text>
      </PolicySection>
      <PolicySection title="Use and sharing">
        <Text style={s.body}>
          Information is used to provide the service, enforce permissions and consent, answer
          support requests, prevent abuse, and improve reliability. BoomerBuddy does not visit a
          submitted website address and does not sell personal information.
        </Text>
      </PolicySection>
      <PolicySection title="Your choices">
        <Text style={s.body}>
          You may request access, correction, restriction, export, or deletion by emailing{' '}
          <Text style={s.label}>{supportEmail}</Text>. Identity and authority are verified before a
          request is completed.
        </Text>
      </PolicySection>
    </PolicyLayout>
  );
}

export function TermsScreen(): React.ReactElement {
  return (
    <PolicyLayout
      title="Terms"
      summary="These terms apply to the invite-only BoomerBuddy service. Members must be adults age 18 or older."
    >
      <PolicySection title="Accounts and consent">
        <Text style={s.body}>
          Use only the invited identity, households, and roles you are authorized to access.
          Household administration never replaces another adult&apos;s consent or privacy choices.
        </Text>
      </PolicySection>
      <PolicySection title="What the service does">
        <Text style={s.body}>
          BoomerBuddy provides rules-based help for reviewing suspicious messages and choosing a
          safer next step. Results can be incomplete or wrong and are not an emergency, legal, or
          financial service.
        </Text>
      </PolicySection>
      <PolicySection title="Safe use">
        <Text style={s.body}>
          Do not submit passwords, verification codes, payment-card details, safe words, illegal
          content, or information you do not have permission to use. Do not bypass access controls
          or use the service to deceive or harm another person.
        </Text>
      </PolicySection>
      <PolicySection title="Questions">
        <Text style={s.body}>
          Contact <Text style={s.label}>{supportEmail}</Text> with questions or complaints.
        </Text>
      </PolicySection>
    </PolicyLayout>
  );
}

export function AccessibilityScreen(): React.ReactElement {
  return (
    <PolicyLayout
      title="Accessibility"
      summary="BoomerBuddy is designed for clear, calm use with keyboard, screen reader, zoom, contrast, and mobile accessibility features."
    >
      <PolicySection title="Our approach">
        <Text style={s.body}>
          We work toward WCAG 2.2 AA with clear headings, visible focus, text alternatives, status
          announcements, readable contrast, reduced-motion support, and layouts that remain usable
          when text is enlarged.
        </Text>
      </PolicySection>
      <PolicySection title="Report a barrier">
        <Text style={s.body}>
          Email <Text style={s.label}>{supportEmail}</Text> with the screen, task, device, and what
          prevented completion. Do not include passwords, codes, card information, safe words, or
          private submitted content.
        </Text>
      </PolicySection>
    </PolicyLayout>
  );
}

type DeleteReceipt = Pick<PrivacyRequestDto, 'id' | 'state' | 'dueAt'>;

interface PrivacyRequestList {
  readonly requests: readonly PrivacyRequestDto[];
}

interface CreateDeleteRequestResponse {
  readonly id: string;
  readonly state: 'received';
  readonly dueAt: string;
}

const deletionStateLabels: Readonly<Record<PrivacyRequestDto['state'], string>> = {
  received: 'Request received',
  verified: 'Identity verified',
  in_progress: 'Deletion review in progress',
  completed: 'Request completed',
  denied: 'Request could not be completed',
};

function currentDeleteReceipt(requests: readonly PrivacyRequestDto[]): DeleteReceipt | undefined {
  return (
    requests.find(
      (request) =>
        request.requestKind === 'delete' &&
        request.state !== 'completed' &&
        request.state !== 'denied',
    ) ?? requests.find((request) => request.requestKind === 'delete')
  );
}

export function AccountDeletionScreen(): React.ReactElement {
  const { isLoaded, isSignedIn } = useAuth();
  const [receipt, setReceipt] = useState<DeleteReceipt>();
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<'loading' | 'submitting' | ''>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadReceipt(): Promise<DeleteReceipt | undefined> {
    const response = await mobileRequest<PrivacyRequestList>('/v1/privacy-requests');
    const existing = currentDeleteReceipt(response.requests);
    setReceipt(existing);
    return existing;
  }

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      return () => undefined;
    }
    let active = true;
    void mobileRequest<PrivacyRequestList>('/v1/privacy-requests')
      .then((response) => {
        if (active) {
          setError('');
          setReceipt(currentDeleteReceipt(response.requests));
        }
      })
      .catch((caught: unknown) => {
        if (active) setError(readableError(caught));
      })
      .finally(() => {
        if (active) setBusy('');
      });
    return () => {
      active = false;
    };
  }, [isLoaded, isSignedIn]);

  async function refreshReceipt() {
    setBusy('loading');
    setError('');
    setNotice('');
    try {
      const existing = await loadReceipt();
      setNotice(
        existing
          ? 'Deletion request status refreshed.'
          : 'No account deletion request is currently recorded.',
      );
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy('');
    }
  }

  async function submitDeletionRequest() {
    if (!confirmed || busy) return;
    setBusy('submitting');
    setError('');
    setNotice('');
    try {
      const created = await mobileRequest<CreateDeleteRequestResponse>('/v1/privacy-requests', {
        method: 'POST',
        body: JSON.stringify({
          requestKind: 'delete',
          confirmation: 'DELETE_MY_ACCOUNT',
        }),
      });
      setReceipt(created);
      setConfirming(false);
      setConfirmed(false);
      setNotice('Your account deletion request was received. Save the receipt ID below.');
    } catch (caught) {
      try {
        const existing = await loadReceipt();
        if (existing) {
          setConfirming(false);
          setConfirmed(false);
          setNotice('Your existing account deletion request was recovered safely.');
          return;
        }
      } catch {
        /* Keep the original safe error when status recovery is unavailable. */
      }
      setError(readableError(caught));
    } finally {
      setBusy('');
    }
  }

  return (
    <PolicyLayout
      title="Account deletion"
      summary="You can request deletion without giving another household participant control over your privacy choice."
    >
      {!isLoaded ? (
        <PolicySection title="Checking account status">
          <Text style={s.body}>Please wait while BoomerBuddy checks your sign-in status.</Text>
        </PolicySection>
      ) : !isSignedIn ? (
        <PolicySection title="Sign in to make an in-app request">
          <Text style={s.body}>
            Sign in with the account you want deleted, then return to this screen. The request is
            tied to that signed-in person, even if the account is not connected to a household.
          </Text>
          <Text style={s.muted}>
            If you cannot sign in, email <Text style={s.label}>{supportEmail}</Text> with the
            subject &quot;Account deletion request.&quot; Do not include passwords, verification
            codes, payment-card details, safe words, or submitted Check content.
          </Text>
        </PolicySection>
      ) : (
        <PolicySection title="Request account deletion">
          <Text style={s.body}>
            This request covers your signed-in identity and associated BoomerBuddy data. Support
            verifies the request and reviews household access and any active subscription before
            deletion is completed.
          </Text>
          {error ? (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          ) : null}
          {notice ? (
            <Text accessibilityLiveRegion="polite" style={s.body}>
              {notice}
            </Text>
          ) : null}
          {receipt ? (
            <View style={s.banner} accessibilityLiveRegion="polite">
              <Text style={s.heading}>Deletion request receipt</Text>
              <Text selectable style={s.label}>
                Receipt ID: {receipt.id}
              </Text>
              <Text style={s.body}>Status: {deletionStateLabels[receipt.state]}</Text>
              <Text style={s.body}>
                Response due by: {new Date(receipt.dueAt).toLocaleString()}
              </Text>
              <Text style={s.muted}>
                Keep this receipt ID. The status shows the request workflow and does not claim that
                deletion is complete until it says completed.
              </Text>
              <PolicyButton
                title={busy === 'loading' ? 'Refreshing request status…' : 'Refresh request status'}
                disabled={Boolean(busy)}
                onPress={() => void refreshReceipt()}
              />
              {receipt.state === 'denied' ? (
                <PolicyButton
                  title="Start another deletion request"
                  disabled={Boolean(busy)}
                  onPress={() => {
                    setReceipt(undefined);
                    setConfirming(true);
                    setConfirmed(false);
                    setError('');
                    setNotice('');
                  }}
                />
              ) : null}
            </View>
          ) : confirming ? (
            <View style={s.banner}>
              <Text style={s.heading}>Confirm account deletion request</Text>
              <Text style={s.body}>
                This starts a formal deletion review. It does not immediately erase the account, and
                you will receive a receipt to track the request.
              </Text>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: confirmed }}
                onPress={() => setConfirmed((current) => !current)}
                style={[s.choice, confirmed && s.choiceSelected]}
              >
                <View style={[s.radio, confirmed && s.radioSelected]} />
                <Text style={s.body}>
                  I am signed in to the account I want deleted and I want to submit this request.
                </Text>
              </Pressable>
              <PolicyButton
                kind="danger"
                title={
                  busy === 'submitting' ? 'Submitting deletion request…' : 'Submit deletion request'
                }
                disabled={!confirmed || Boolean(busy)}
                onPress={() => void submitDeletionRequest()}
              />
              <PolicyButton
                title="Cancel"
                disabled={Boolean(busy)}
                onPress={() => {
                  setConfirming(false);
                  setConfirmed(false);
                  setError('');
                }}
              />
            </View>
          ) : (
            <>
              <PolicyButton
                kind="danger"
                title="Start account deletion request"
                disabled={Boolean(busy)}
                onPress={() => {
                  setConfirming(true);
                  setConfirmed(false);
                  setError('');
                  setNotice('');
                }}
              />
              <PolicyButton
                title={
                  busy === 'loading' ? 'Checking existing requests…' : 'Check existing request'
                }
                disabled={Boolean(busy)}
                onPress={() => void refreshReceipt()}
              />
            </>
          )}
        </PolicySection>
      )}
      <PolicySection title="Verification and scope">
        <Text style={s.body}>
          Support verifies the requesting identity and explains which account, household access,
          Check history, and support records are affected. One adult cannot delete another
          adult&apos;s identity or independent consent record.
        </Text>
      </PolicySection>
      <PolicySection title="Limited records">
        <Text style={s.body}>
          Some minimal security, fraud-prevention, consent, dispute, and deletion records may be
          kept when required by law or needed to protect the service. They are not used to restore
          deleted product content.
        </Text>
      </PolicySection>
    </PolicyLayout>
  );
}
