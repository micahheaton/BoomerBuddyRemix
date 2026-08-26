import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useHostedAuth } from '@clerk/expo/hosted-auth';
import type {
  CheckKind,
  CheckListResponse,
  CheckResult,
  CreateCheckResponse,
  CreateInvitationResponse,
  EntitlementResponse,
  FamilyResponse,
  InvitationPreviewResponse,
  MeResponse,
  OrientationStateDto,
  TrustedCirclePermissionDto,
} from '@boomerbuddy/contracts';
import { buildUserInitiatedInvitationShareDraft } from '@boomerbuddy/contracts';
import { MobileCustomerError, mobileRequest, readableError } from './api';
import {
  mobileHouseholdScopeSummary,
  useMobileHousehold,
  useOptionalMobileHousehold,
} from './household';
import type { NativeEntrySignal, RootStackParamList } from './navigation';
import { appStyles as s } from './theme';

const customerWebSignInUrl = 'https://app.boomerbuddy.net/sign-in';

type ButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: 'primary' | 'secondary' | 'danger';
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

function ActionButton({
  title,
  onPress,
  disabled = false,
  kind = 'primary',
  style,
  accessibilityHint,
}: ButtonProps) {
  const container =
    kind === 'primary' ? s.buttonPrimary : kind === 'danger' ? s.buttonDanger : s.buttonSecondary;
  const text =
    kind === 'primary'
      ? s.buttonTextPrimary
      : kind === 'danger'
        ? s.buttonTextDanger
        : s.buttonTextSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        container,
        disabled && s.buttonDisabled,
        pressed && { opacity: 0.82 },
        style,
      ]}
    >
      <Text style={text}>{title}</Text>
    </Pressable>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  const household = useOptionalMobileHousehold();
  return (
    <ScrollView style={s.safe} contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      {household?.selectedScope ? (
        <View style={s.scopeBanner}>
          <Text style={s.label}>Active household: {household.selectedHouseholdName}</Text>
          <Text style={s.muted}>{mobileHouseholdScopeSummary(household.selectedScope)}</Text>
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
}
function Loading({ label }: { label: string }) {
  return (
    <View style={s.card}>
      <ActivityIndicator accessibilityLabel={label} />
      <Text style={s.body}>{label}</Text>
    </View>
  );
}
function ErrorText({ message }: { message: string }) {
  return (
    <Text accessibilityRole="alert" style={s.error}>
      {message}
    </Text>
  );
}

export function SignInScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'SignIn'>): React.ReactElement {
  const { startHostedAuth } = useHostedAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function authenticate() {
    setBusy(true);
    setError('');
    try {
      if (Platform.OS === 'web') {
        await Linking.openURL(customerWebSignInUrl);
        return;
      }
      const result = await startHostedAuth({ mode: 'sign-in' });
      if (!result.createdSessionId) {
        setError('Sign-in was not completed. You can try again when you are ready.');
      }
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Text accessibilityRole="header" style={s.title}>
        Welcome to BoomerBuddy
      </Text>
      <Text style={s.body}>
        Sign in with the customer account you use for your household. A secure sign-in window opens
        and returns to this app when complete.
      </Text>
      <View style={s.banner}>
        <Text style={s.label}>Your password stays in secure sign-in</Text>
        <Text style={s.muted}>
          BoomerBuddy does not store your password. The sign-in service keeps you signed in securely
          on supported devices.
        </Text>
      </View>
      {error ? <ErrorText message={error} /> : null}
      <ActionButton
        title={busy ? 'Opening member sign in…' : 'Member sign in'}
        disabled={busy}
        onPress={() => void authenticate()}
      />
      <ActionButton
        kind="secondary"
        title="Help and policies"
        disabled={busy}
        onPress={() => navigation.navigate('HelpPolicies')}
      />
      <Text style={s.muted}>
        BoomerBuddy is invite-only. Use the email address that received your invitation.
      </Text>
    </Screen>
  );
}

export function SessionRecoveryScreen({
  message,
  onRetry,
  onSignOut,
}: {
  message: string;
  onRetry: () => void;
  onSignOut: () => void;
}): React.ReactElement {
  return (
    <Screen>
      <Text accessibilityRole="header" style={s.title}>
        We could not open your account
      </Text>
      <ErrorText message={message} />
      <Text style={s.body}>
        Check your connection and try again. If the problem continues, sign out and restart the
        secure sign-in flow.
      </Text>
      <ActionButton title="Try again" onPress={onRetry} />
      <ActionButton kind="secondary" title="Sign out" onPress={onSignOut} />
    </Screen>
  );
}

export function HomeScreen({
  navigation,
  nativeEntrySignal,
  onNativeEntryHandled,
  onSignOut,
}: NativeStackScreenProps<RootStackParamList, 'Home'> & {
  nativeEntrySignal: NativeEntrySignal;
  onNativeEntryHandled: () => void;
  onSignOut: () => void;
}) {
  const {
    principal,
    selectedHouseholdId,
    selectedScope,
    selectHousehold,
    replacePrincipal,
    householdName,
  } = useMobileHousehold();
  const [entitlements, setEntitlements] = useState<{
    householdId: string;
    value: EntitlementResponse;
  }>();
  const [entitlementsUnavailableFor, setEntitlementsUnavailableFor] = useState('');
  const [entitlementsRefreshingFor, setEntitlementsRefreshingFor] = useState('');
  const [entitlementRefreshAttempt, setEntitlementRefreshAttempt] = useState(0);
  useEffect(() => {
    if (!selectedHouseholdId || !selectedScope?.isBillingManager) return;
    let active = true;
    void Promise.resolve()
      .then(() => {
        if (active) setEntitlementsRefreshingFor(selectedHouseholdId);
        return Promise.all([
          mobileRequest<EntitlementResponse>('/v1/entitlements'),
          mobileRequest<MeResponse>('/v1/me'),
        ]);
      })
      .then(([response, me]) => {
        if (!active) return;
        replacePrincipal(me.principal, selectedHouseholdId);
        setEntitlements({ householdId: selectedHouseholdId, value: response });
        setEntitlementsUnavailableFor('');
      })
      .catch(() => {
        if (!active) return;
        setEntitlements((current) =>
          current?.householdId === selectedHouseholdId ? undefined : current,
        );
        setEntitlementsUnavailableFor(selectedHouseholdId);
      })
      .finally(() => {
        if (active) setEntitlementsRefreshingFor('');
      });
    return () => {
      active = false;
    };
  }, [
    entitlementRefreshAttempt,
    replacePrincipal,
    selectedHouseholdId,
    selectedScope?.isBillingManager,
  ]);
  const isUnassigned = principal.households.length === 0;
  const isProtectedMember = selectedScope?.isProtectedMember === true;
  const canCheck =
    isProtectedMember &&
    (selectedScope?.capabilities.includes('check:text') ||
      selectedScope?.capabilities.includes('check:url'));
  const canReadHistory =
    selectedScope?.capabilities.includes('history:read') === true &&
    (isProtectedMember ||
      selectedScope.trustedCircleGrants.some((grant) =>
        grant.permissions.includes('view_shared_checks'),
      ));
  const canUseOrientation =
    isProtectedMember && selectedScope?.capabilities.includes('orientation:use');
  const canUseFamily =
    isUnassigned ||
    selectedScope?.isAdministrator === true ||
    selectedScope?.isProtectedMember === true ||
    (selectedScope?.trustedCircleGrants.length ?? 0) > 0;
  const selectedEntitlements =
    entitlements?.householdId === selectedHouseholdId ? entitlements.value : undefined;
  const protectedAllowance = selectedEntitlements?.commerce.allowances.find(
    (allowance) => allowance.kind === 'protected_members',
  );
  const trustedAllowance = selectedEntitlements?.commerce.allowances.find(
    (allowance) => allowance.kind === 'trusted_circle_participants',
  );
  const allowanceSummary = (label: string, allowance: typeof protectedAllowance): string => {
    if (!allowance) return `${label}: details are not available right now.`;
    if (allowance.used === null) {
      return `${label}: up to ${allowance.limit} included; current use is not available.`;
    }
    return `${label}: ${allowance.used} of ${allowance.limit} used; ${allowance.remaining} available.`;
  };
  const accessSummary = !selectedEntitlements
    ? 'Household access'
    : selectedEntitlements.commerce.accessState === 'effective'
      ? 'Household access is active'
      : 'Household access is not active';

  return (
    <Screen>
      <Text style={s.pill}>Pause and check</Text>
      <Text accessibilityRole="header" style={s.title}>
        Hello, {principal.displayName}
      </Text>
      <Text style={s.body}>
        {isUnassigned
          ? 'You are not connected to a household. A valid invitation and explicit consent are required before protection features become available.'
          : 'Pause before you click, reply, pay, or share a code. BoomerBuddy can help you choose a safer next step, but it can be wrong.'}
      </Text>
      {principal.households.length > 1 ? (
        <View style={s.card}>
          <Text style={s.heading}>Active household</Text>
          <Text style={s.muted}>
            The household you choose applies to Check, History, Family, and Orientation.
          </Text>
          {principal.households.map((scope, index) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selectedHouseholdId === scope.id }}
              key={scope.id}
              onPress={() => selectHousehold(scope.id)}
              style={[s.choice, selectedHouseholdId === scope.id && s.choiceSelected]}
            >
              <View style={[s.radio, selectedHouseholdId === scope.id && s.radioSelected]} />
              <Text style={s.body}>
                {householdName(scope.id, index)} - {mobileHouseholdScopeSummary(scope)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {__DEV__ ? (
        <View style={s.banner}>
          <Text style={s.label}>Native intake is blocked pending device verification</Text>
          <Text style={s.muted}>
            Route-only deep-link observation is scaffolded. Inbound share targets are not
            configured, and this build does not read messages, notifications, contacts, or the
            clipboard. Paste an item manually in Check.
          </Text>
          <ActionButton
            kind="secondary"
            title="Review native proof status"
            onPress={() => navigation.navigate('NativeProof')}
          />
        </View>
      ) : null}
      {nativeEntrySignal === 'route_only_check' ? (
        <View style={s.card}>
          <Text style={s.pill}>Check opened</Text>
          <Text style={s.body}>
            BoomerBuddy opened Check without copying anything from the link. Paste the item yourself
            if you want it reviewed.
          </Text>
          {canCheck ? (
            <ActionButton
              title="Continue to Check"
              onPress={() => {
                onNativeEntryHandled();
                navigation.navigate('Check');
              }}
            />
          ) : (
            <Text style={s.muted}>Check is unavailable for this household.</Text>
          )}
          <ActionButton kind="secondary" title="Dismiss" onPress={onNativeEntryHandled} />
        </View>
      ) : nativeEntrySignal === 'rejected_payload' ? (
        <View style={s.banner}>
          <Text style={s.label}>Content was not opened</Text>
          <Text style={s.muted}>
            For privacy, BoomerBuddy does not copy suspicious content from app links. Paste it into
            Check yourself if you want it reviewed.
          </Text>
          <ActionButton kind="secondary" title="Dismiss" onPress={onNativeEntryHandled} />
        </View>
      ) : null}
      <View style={s.navGrid}>
        {!isUnassigned && canCheck ? (
          <ActionButton
            title="Check a message or link"
            onPress={() => navigation.navigate('Check')}
          />
        ) : !isUnassigned ? (
          <Text style={s.muted}>
            Only an enrolled protected adult can create a Check. Managing or paying for the
            household does not give you access to another adult&apos;s Checks.
          </Text>
        ) : null}
        {!isUnassigned && canReadHistory ? (
          <ActionButton
            kind="secondary"
            title="Open history"
            onPress={() => navigation.navigate('History')}
          />
        ) : !isUnassigned ? (
          <Text style={s.muted}>History is unavailable for this household.</Text>
        ) : null}
        {canUseFamily ? (
          <ActionButton
            kind="secondary"
            title="Open Family"
            onPress={() => navigation.navigate('Family')}
          />
        ) : null}
        {!isUnassigned && canUseOrientation ? (
          <ActionButton
            kind="secondary"
            title="Continue orientation"
            onPress={() => navigation.navigate('Orientation')}
          />
        ) : !isUnassigned ? (
          <Text style={s.muted}>
            Only an enrolled protected adult can complete orientation for this household.
          </Text>
        ) : null}
        <ActionButton
          kind="secondary"
          title="Help and policies"
          onPress={() => navigation.navigate('HelpPolicies')}
        />
        <ActionButton kind="secondary" title="Sign out" onPress={onSignOut} />
      </View>
      {!isUnassigned ? (
        <View style={s.card} testID="account-access-summary">
          <Text style={s.pill}>Current access and plan</Text>
          <Text style={s.heading}>{accessSummary}</Text>
          <Text style={s.body}>
            Your available features depend on the household you selected, your role, and each
            person&apos;s consent.
          </Text>
          {!selectedScope?.isBillingManager ? (
            <Text style={s.muted}>
              Detailed household limits are visible only to the person authorized to manage the
              plan. Your actions still follow the permissions for this selected household.
            </Text>
          ) : selectedEntitlements ? (
            <>
              {selectedEntitlements.commerce.primary?.accessEndsAt ? (
                <Text style={s.muted}>
                  Current access is scheduled through{' '}
                  {new Date(selectedEntitlements.commerce.primary.accessEndsAt).toLocaleString()}.
                </Text>
              ) : null}
              <Text style={s.body}>{allowanceSummary('Protected adults', protectedAllowance)}</Text>
              <Text style={s.body}>
                {allowanceSummary('Trusted Circle participants', trustedAllowance)}
              </Text>
            </>
          ) : entitlementsUnavailableFor === selectedHouseholdId ? (
            <Text style={s.muted}>
              Plan and allowance details are unavailable. The selected household permissions shown
              in the actions above still apply.
            </Text>
          ) : (
            <Text style={s.muted}>Loading access details...</Text>
          )}
          {selectedScope?.isBillingManager ? (
            <>
              <Text style={s.muted}>
                If Family access was recently started, renewed, canceled, or restored, confirmation
                can take a moment. Refresh here before trying protected features again. This does
                not start or change a purchase.
              </Text>
              <ActionButton
                kind="secondary"
                title={
                  entitlementsRefreshingFor === selectedHouseholdId
                    ? 'Refreshing access...'
                    : 'Refresh access'
                }
                disabled={entitlementsRefreshingFor === selectedHouseholdId}
                onPress={() => setEntitlementRefreshAttempt((attempt) => attempt + 1)}
              />
            </>
          ) : null}
        </View>
      ) : null}
      <View style={s.card}>
        <Text style={s.heading}>If money or safety is at risk</Text>
        <Text style={s.body}>
          Stop contact and verify through an official phone number you find independently. Call
          emergency services if someone is in immediate danger.
        </Text>
      </View>
    </Screen>
  );
}

export function NativeProofScreen(): React.ReactElement {
  const [routeStatus, setRouteStatus] = useState('Not checked on this runtime.');
  const [shareStatus, setShareStatus] = useState('No share sheet opened.');
  const isWebPreview = Platform.OS === 'web';

  async function checkRouteRegistration() {
    try {
      const supported = await Linking.canOpenURL('boomerbuddy://check');
      setRouteStatus(
        supported
          ? 'This runtime reports a handler for the route-only scheme. End-to-end device intake is still not verified.'
          : 'This runtime did not report a handler. Native deep-link intake remains blocked.',
      );
    } catch (caught) {
      setRouteStatus(readableError(caught));
    }
  }

  async function shareSafeGuidance() {
    try {
      const outcome = await Share.share({
        message:
          'Pause before you click, reply, pay, or share a code. Verify through an official contact channel you find independently.',
        title: 'BoomerBuddy safer next step',
      });
      setShareStatus(
        outcome.action === Share.sharedAction
          ? 'The operating system reported an outbound share action for fixed guidance only.'
          : 'The outbound share sheet closed without a reported share action.',
      );
    } catch (caught) {
      setShareStatus(readableError(caught));
    }
  }

  return (
    <Screen>
      <Text style={s.pill}>Blocked · not device-verified</Text>
      <Text accessibilityRole="header" style={s.title}>
        Native intake proof
      </Text>
      <Text style={s.body}>
        This screen records what is scaffolded and what remains unproven. A web export, simulator
        render, or successful typecheck is not native-device evidence.
      </Text>
      <View style={s.card}>
        <Text style={s.heading}>Route-only deep link</Text>
        <Text style={s.body}>
          The app manifest registers <Text style={s.label}>boomerbuddy://check</Text>. The listener
          accepts only that empty route signal; query strings and fragments are rejected so the app
          does not ingest artifacts that may already be exposed in operating-system link history.
        </Text>
        <ActionButton
          kind="secondary"
          title="Check scheme on this runtime"
          disabled={isWebPreview}
          onPress={() => void checkRouteRegistration()}
        />
        <Text accessibilityLiveRegion="polite" style={s.muted}>
          {isWebPreview ? 'Blocked in the web preview; use a native device build.' : routeStatus}
        </Text>
      </View>
      <View style={s.card}>
        <Text style={s.heading}>Inbound share intake</Text>
        <Text style={s.body}>
          Blocked. No Android share intent or iOS share extension is configured, and no physical
          device flow has been verified. The app does not claim to receive content from another app.
        </Text>
      </View>
      <View style={s.card}>
        <Text style={s.heading}>Outbound fixed guidance</Text>
        <Text style={s.body}>
          React Native can open the system share sheet for a fixed safety reminder. This proof never
          includes submitted text, a Check result, a person, or a household identifier.
        </Text>
        <ActionButton
          kind="secondary"
          title="Share fixed safety reminder"
          disabled={isWebPreview}
          onPress={() => void shareSafeGuidance()}
        />
        <Text accessibilityLiveRegion="polite" style={s.muted}>
          {isWebPreview ? 'Blocked in the web preview; use a native device build.' : shareStatus}
        </Text>
      </View>
      <View style={s.banner}>
        <Text style={s.label}>Still outside this proof</Text>
        <Text style={s.muted}>
          Push notifications, contacts, clipboard reads, background monitoring, and automatic
          artifact import are not implemented or represented as working.
        </Text>
      </View>
    </Screen>
  );
}

export function CheckScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Check'>) {
  const { selectedScope } = useMobileHousehold();
  const [kind, setKind] = useState<CheckKind>('text');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isProtectedMember = selectedScope?.isProtectedMember === true;
  const canCheckText =
    isProtectedMember && (selectedScope?.capabilities.includes('check:text') ?? false);
  const canCheckUrl =
    isProtectedMember && (selectedScope?.capabilities.includes('check:url') ?? false);
  const effectiveKind: CheckKind =
    (kind === 'text' && canCheckText) || (kind === 'url' && canCheckUrl)
      ? kind
      : canCheckText
        ? 'text'
        : 'url';
  async function check() {
    setBusy(true);
    setError('');
    try {
      const response = await mobileRequest<CreateCheckResponse>('/v1/checks', {
        method: 'POST',
        body: JSON.stringify({ kind: effectiveKind, content }),
      });
      setContent('');
      navigation.navigate('Result', { check: response.check });
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }
  if (!isProtectedMember) {
    return (
      <Screen>
        <Text accessibilityRole="header" style={s.title}>
          Check unavailable in this household
        </Text>
        <View style={s.banner}>
          <Text style={s.heading}>Protected adult access required</Text>
          <Text style={s.body}>
            Only an enrolled protected adult can create a Check. Managing or paying for the
            household does not give you access to another adult&apos;s Checks.
          </Text>
        </View>
      </Screen>
    );
  }
  return (
    <Screen>
      <Text accessibilityRole="header" style={s.title}>
        Check something suspicious
      </Text>
      <Text style={s.body}>
        Remove names, account numbers, passwords, access codes, payment details, and safe words
        before pasting.
      </Text>
      <Text style={s.label}>What are you checking?</Text>
      <View style={s.row}>
        {(['text', 'url'] as const).map((item) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{
              checked: effectiveKind === item,
              disabled: item === 'text' ? !canCheckText : !canCheckUrl,
            }}
            disabled={item === 'text' ? !canCheckText : !canCheckUrl}
            key={item}
            onPress={() => {
              setKind(item);
              setContent('');
            }}
            style={[s.choice, { flexGrow: 1 }, effectiveKind === item && s.choiceSelected]}
          >
            <View style={[s.radio, effectiveKind === item && s.radioSelected]} />
            <Text style={s.body}>{item === 'text' ? 'Message text' : 'Website URL'}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.label}>
        {effectiveKind === 'text' ? 'Suspicious message' : 'Website address (URL)'}
      </Text>
      <TextInput
        accessibilityLabel={effectiveKind === 'text' ? 'Suspicious message' : 'Website address URL'}
        autoCapitalize="none"
        autoCorrect={false}
        multiline={effectiveKind === 'text'}
        keyboardType={effectiveKind === 'url' ? 'url' : 'default'}
        maxLength={effectiveKind === 'text' ? 20_000 : 2_048}
        onChangeText={setContent}
        placeholder={
          effectiveKind === 'text' ? 'Paste the message here' : 'https://example.com/path'
        }
        style={[s.input, effectiveKind === 'text' && s.textarea]}
        value={content}
      />
      <Text style={s.muted}>
        BoomerBuddy reviews only the message text or website address you submit. It does not open
        the website or compare it with live online data. It can miss warning signs, so do not treat
        a result as proof that something is safe.
      </Text>
      {!canCheckText && !canCheckUrl ? (
        <View style={s.banner}>
          <Text style={s.label}>Checks unavailable</Text>
          <Text style={s.muted}>Choose a household where your membership includes Check.</Text>
        </View>
      ) : null}
      <View style={s.banner}>
        <Text style={s.label}>Retention and deletion</Text>
        <Text style={s.muted}>
          The service minimizes and encrypts submitted input, retains it for up to 30 days, and
          deletes it sooner when you delete the check. History never displays it.
        </Text>
      </View>
      {error ? <ErrorText message={error} /> : null}
      <ActionButton
        title={busy ? 'Checking…' : 'Check it'}
        disabled={busy || !content.trim() || (!canCheckText && !canCheckUrl)}
        onPress={() => void check()}
      />
    </Screen>
  );
}

const riskLabels: Record<CheckResult['risk'], string> = {
  caution: 'Use caution',
  high_concern: 'High concern',
  unknown: 'Unknown risk',
};
const supportingInformationLabels: Record<CheckResult['evidenceSufficiency'], string> = {
  limited: 'The check found only a small amount of supporting information.',
  moderate: 'The check found some supporting information.',
  strong: 'The check found multiple supporting details.',
};
function riskStyle(risk: CheckResult['risk']): ViewStyle {
  return risk === 'caution' ? s.riskCaution : risk === 'high_concern' ? s.riskHigh : s.riskUnknown;
}

type ResultScreenProps = NativeStackScreenProps<RootStackParamList, 'Result'>;

export function ResultScreen(props: ResultScreenProps): React.ReactElement {
  return <ResultContent key={props.route.params.check.id} {...props} />;
}

function ResultContent({ route, navigation }: ResultScreenProps) {
  const { check } = route.params;
  const { selectedHouseholdId, selectedScope } = useMobileHousehold();
  const isProtectedMember = selectedScope?.isProtectedMember === true;
  const [shareTargets, setShareTargets] = useState<FamilyResponse['relationships']>([]);
  const [sharedWith, setSharedWith] = useState<string[]>([]);
  const [sharingWith, setSharingWith] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  useEffect(() => {
    let active = true;
    if (!isProtectedMember || !check.access.canShare || check.householdId !== selectedHouseholdId)
      return;
    Promise.all([mobileRequest<FamilyResponse>('/v1/family'), mobileRequest<MeResponse>('/v1/me')])
      .then(([family, me]) => {
        if (!active) return;
        setShareTargets(
          family.relationships.filter(
            (relationship) =>
              relationship.state === 'active' &&
              relationship.permissions.includes('view_shared_checks') &&
              relationship.protectedPersonId === me.principal.personId,
          ),
        );
      })
      .catch(() => {
        if (active) setShareTargets([]);
      });
    return () => {
      active = false;
    };
  }, [check.access.canShare, check.householdId, check.id, isProtectedMember, selectedHouseholdId]);
  async function shareResult(personId: string, displayName: string) {
    setSharingWith(personId);
    setShareStatus('');
    try {
      await mobileRequest(`/v1/checks/${encodeURIComponent(check.id)}/shares`, {
        method: 'POST',
        body: JSON.stringify({ sharedWithPersonId: personId }),
      });
      setSharedWith((current) => [...new Set([...current, personId])]);
      setShareStatus(
        `Redacted result shared with ${displayName} in BoomerBuddy. No notification was sent and submitted content was not included.`,
      );
    } catch (caught) {
      setShareStatus(readableError(caught));
    } finally {
      setSharingWith('');
    }
  }
  return (
    <Screen>
      <View accessibilityLiveRegion="polite" style={[s.card, s.risk, riskStyle(check.risk)]}>
        <Text style={s.pill}>BoomerBuddy Check</Text>
        <Text style={s.pill}>{check.access.kind === 'owned' ? 'Yours' : 'Shared with you'}</Text>
        <Text accessibilityRole="header" style={s.title}>
          Check result
        </Text>
        <Text style={s.heading}>Risk: {riskLabels[check.risk]}</Text>
        <Text style={s.body}>{check.summary}</Text>
        <Text style={s.label}>How much the check found</Text>
        <Text style={s.body}>{supportingInformationLabels[check.evidenceSufficiency]}</Text>
        <Text style={s.muted}>
          This is not a probability and does not show that a message or website is safe.
        </Text>
        <Text style={s.label}>Important limit</Text>
        <Text style={s.body}>
          BoomerBuddy can miss warning signs and can be wrong. Pause and verify independently before
          acting when money, accounts, credentials, or safety are involved.
        </Text>
        <Text style={s.label}>Saved result</Text>
        <Text style={s.body}>
          This result is scheduled for deletion on{' '}
          {new Date(check.retention.deleteAfter).toLocaleString()}. You can delete it sooner from
          History.
        </Text>
      </View>
      <View style={s.card}>
        <Text style={s.heading}>What the check noticed</Text>
        {check.evidence.length ? (
          check.evidence.map((item, index) => (
            <View key={`${item.label}-${index}`}>
              <Text style={s.label}>{item.label}</Text>
              <Text style={s.body}>{item.observation}</Text>
              {item.limitations ? <Text style={s.muted}>Limit: {item.limitations}</Text> : null}
            </View>
          ))
        ) : (
          <Text style={s.body}>
            No supporting observations were produced. Treat the risk as unknown.
          </Text>
        )}
      </View>
      <View style={s.card}>
        <Text style={s.heading}>Safer next actions</Text>
        {[...check.actions]
          .sort((a, b) => a.priority - b.priority)
          .map((action) => (
            <View key={action.key}>
              <Text style={s.label}>
                {action.priority}. {action.title}
              </Text>
              <Text style={s.body}>{action.detail}</Text>
              {action.officialChannelOnly ? (
                <Text style={s.muted}>Use a channel you verify independently.</Text>
              ) : null}
            </View>
          ))}
      </View>
      <View style={s.banner}>
        <Text style={s.label}>This is decision support, not proof</Text>
        <Text style={s.body}>
          Pause and verify independently when money, credentials, accounts, or safety are involved.
        </Text>
      </View>
      {isProtectedMember && check.access.canShare && check.householdId === selectedHouseholdId ? (
        <View style={s.card}>
          <Text style={s.heading}>Share this redacted result</Text>
          <Text style={s.body}>
            Eligible Trusted Circle people receive the summary, warning signs, and safer actions
            only. Submitted text or URLs are excluded, and no notification is sent.
          </Text>
          {shareTargets.length ? (
            shareTargets.map((target) => (
              <ActionButton
                kind="secondary"
                key={target.id}
                title={
                  sharedWith.includes(target.trustedPersonId)
                    ? `Shared with ${target.trustedDisplayName}`
                    : sharingWith === target.trustedPersonId
                      ? 'Sharing…'
                      : `Share with ${target.trustedDisplayName}`
                }
                disabled={
                  sharingWith === target.trustedPersonId ||
                  sharedWith.includes(target.trustedPersonId)
                }
                onPress={() => void shareResult(target.trustedPersonId, target.trustedDisplayName)}
              />
            ))
          ) : (
            <Text style={s.muted}>
              No one in your Trusted Circle currently has permission to view shared Checks.
            </Text>
          )}
          {shareStatus ? (
            <Text accessibilityLiveRegion="polite" style={s.body}>
              {shareStatus}
            </Text>
          ) : null}
          <Text style={s.muted}>
            Sharing saves this result in the other person&apos;s BoomerBuddy account, but it does
            not notify them. Contact them directly if help is urgent.
          </Text>
        </View>
      ) : check.access.kind === 'shared' ? (
        <View style={s.card}>
          <Text style={s.heading}>Shared with you</Text>
          <Text style={s.body}>
            Only the check owner can reshare or delete this result. To leave shared access, withdraw
            from the Trusted Circle connection in Family.
          </Text>
          <ActionButton
            kind="secondary"
            title="Open Family"
            onPress={() => navigation.navigate('Family')}
          />
        </View>
      ) : null}
      {isProtectedMember ? (
        <ActionButton title="Check another item" onPress={() => navigation.navigate('Check')} />
      ) : null}
      <ActionButton
        kind="secondary"
        title="Open history"
        onPress={() => navigation.navigate('History')}
      />
    </Screen>
  );
}

export function HistoryScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'History'>): React.ReactElement {
  const { selectedHouseholdId, selectedScope } = useMobileHousehold();
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedHouseholdId, setLoadedHouseholdId] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const canReadHistory =
    selectedScope?.capabilities.includes('history:read') === true &&
    (selectedScope.isProtectedMember ||
      selectedScope.trustedCircleGrants.some((grant) =>
        grant.permissions.includes('view_shared_checks'),
      ));
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!canReadHistory) {
        setChecks([]);
        setHasMore(false);
        setNextOffset(0);
        setTotal(0);
        setLoadedHouseholdId(selectedHouseholdId);
        setLoading(false);
        setError('History is unavailable for this household.');
        return () => {
          active = false;
        };
      }
      setLoading(true);
      setError('');
      void mobileRequest<CheckListResponse>('/v1/checks?limit=50&offset=0', {
        headers: { 'X-BB-Household-Id': selectedHouseholdId },
      })
        .then((response) => {
          if (!active) return;
          setChecks(response.checks);
          setHasMore(response.page.hasMore);
          setNextOffset(response.page.offset + response.checks.length);
          setTotal(response.total);
          setLoadedHouseholdId(selectedHouseholdId);
        })
        .catch((caught) => {
          if (!active) return;
          setChecks([]);
          setHasMore(false);
          setLoadedHouseholdId(selectedHouseholdId);
          setError(readableError(caught));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [canReadHistory, selectedHouseholdId]),
  );
  async function loadMore() {
    if (loadingMore || !hasMore || loadedHouseholdId !== selectedHouseholdId) return;
    setLoadingMore(true);
    setError('');
    try {
      const response = await mobileRequest<CheckListResponse>(
        `/v1/checks?limit=50&offset=${nextOffset}`,
      );
      setChecks((current) => {
        const byId = new Map(current.map((check) => [check.id, check]));
        for (const check of response.checks) byId.set(check.id, check);
        return [...byId.values()];
      });
      setHasMore(response.page.hasMore);
      setNextOffset(response.page.offset + response.checks.length);
      setTotal(response.total);
      setAnnouncement(`Loaded ${response.checks.length} more check records.`);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setLoadingMore(false);
    }
  }
  async function remove(id: string) {
    try {
      await mobileRequest(`/v1/checks/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setChecks((current) => current.filter((check) => check.id !== id));
      setTotal((current) => Math.max(0, current - 1));
      setNextOffset((current) => Math.max(0, current - 1));
      setConfirming('');
      setAnnouncement('Check record deleted.');
    } catch (caught) {
      setError(readableError(caught));
    }
  }
  return (
    <Screen>
      <Text accessibilityRole="header" style={s.title}>
        History
      </Text>
      <Text style={s.body}>
        Submitted content is never shown here. Saved results remain encrypted until their scheduled
        deletion or until you delete them sooner. Limited security records may remain afterward.
      </Text>
      {announcement ? (
        <Text accessibilityLiveRegion="polite" style={s.muted}>
          {announcement}
        </Text>
      ) : null}
      {error ? <ErrorText message={error} /> : null}
      {loading || loadedHouseholdId !== selectedHouseholdId ? (
        <Loading label="Loading history…" />
      ) : checks.length === 0 ? (
        <View style={s.card}>
          <Text style={s.heading}>No check records yet</Text>
        </View>
      ) : (
        <>
          {checks.map((check) => (
            <View key={check.id} style={[s.card, s.risk, riskStyle(check.risk)]}>
              <Text style={s.label}>
                {check.kind === 'text' ? 'Message text' : 'Website address'}
              </Text>
              <Text style={s.pill}>
                {check.access.kind === 'owned' ? 'Yours' : 'Shared with you'}
              </Text>
              <Text style={s.body}>
                {riskLabels[check.risk]} · {supportingInformationLabels[check.evidenceSufficiency]}
              </Text>
              <Text style={s.muted}>
                {new Date(check.createdAt).toLocaleString()} - BoomerBuddy Check
              </Text>
              <ActionButton
                kind="secondary"
                title="Open result details"
                onPress={() => navigation.navigate('Result', { check })}
              />
              {check.access.canDelete && confirming === check.id ? (
                <>
                  <Text style={s.label}>Delete this minimized record?</Text>
                  <ActionButton
                    kind="danger"
                    title="Yes, delete"
                    onPress={() => void remove(check.id)}
                  />
                  <ActionButton kind="secondary" title="Cancel" onPress={() => setConfirming('')} />
                </>
              ) : check.access.canDelete ? (
                <ActionButton
                  kind="danger"
                  title="Delete record"
                  onPress={() => setConfirming(check.id)}
                />
              ) : (
                <>
                  <Text style={s.muted}>
                    Only the check owner can delete this shared record. Withdraw from the
                    relationship in Family if you want to leave shared access.
                  </Text>
                  <ActionButton
                    kind="secondary"
                    title="Open Family"
                    onPress={() => navigation.navigate('Family')}
                  />
                </>
              )}
            </View>
          ))}
          <Text style={s.muted}>
            Showing {checks.length} of {total} available check records.
          </Text>
          {hasMore ? (
            <ActionButton
              kind="secondary"
              title={loadingMore ? 'Loading more…' : 'Load more history'}
              disabled={loadingMore}
              onPress={() => void loadMore()}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}

const trustedPermissionLabels: Record<TrustedCirclePermissionDto, string> = {
  view_shared_checks: 'View only redacted check results deliberately shared with you',
  receive_escalations: 'Escalation notifications are unavailable',
  help_with_orientation: 'Guided orientation help is unavailable',
};
type AcceptedInvitation = { relationship: { id: string }; householdId: string };

export function FamilyScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Family'>): React.ReactElement {
  const { principal, selectedHouseholdId, selectedScope, replacePrincipal } = useMobileHousehold();
  const [family, setFamily] = useState<FamilyResponse>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteeName, setInviteeName] = useState('');
  const [created, setCreated] = useState<CreateInvitationResponse>();
  const [invitationId, setInvitationId] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [preview, setPreview] = useState<InvitationPreviewResponse>();
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [confirmingInvitationId, setConfirmingInvitationId] = useState('');
  const [status, setStatus] = useState('');
  const load = useCallback(async (householdId: string) => {
    if (!householdId) return;
    const familyResponse = await mobileRequest<FamilyResponse>('/v1/family', {
      headers: { 'X-BB-Household-Id': householdId },
    });
    setFamily(familyResponse);
  }, []);
  useEffect(() => {
    if (!selectedHouseholdId) return;
    const timer = setTimeout(() => {
      void load(selectedHouseholdId).catch((caught) => setError(readableError(caught)));
    }, 0);
    return () => clearTimeout(timer);
  }, [load, selectedHouseholdId]);
  const currentHouseholdScope =
    selectedScope?.id === family?.household.id ? selectedScope : undefined;
  const isHouseholdAdministrator = currentHouseholdScope?.isAdministrator === true;
  const isProtectedMember =
    currentHouseholdScope?.isProtectedMember === true &&
    currentHouseholdScope.capabilities.includes('family:manage');
  async function createInvite() {
    setBusy(true);
    setError('');
    setCreated(undefined);
    try {
      const response = await mobileRequest<CreateInvitationResponse>('/v1/family/invitations', {
        method: 'POST',
        headers: { 'X-BB-Household-Id': selectedHouseholdId },
        body: JSON.stringify({
          inviteeDisplayName: inviteeName,
          permissions: ['view_shared_checks'],
        }),
      });
      setCreated(response);
      setInviteeName('');
      await load(selectedHouseholdId);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }
  async function reviewInvite() {
    setBusy(true);
    setError('');
    setPreview(undefined);
    setConsentConfirmed(false);
    try {
      const response = await mobileRequest<InvitationPreviewResponse>(
        `/v1/family/invitations/${encodeURIComponent(invitationId)}/preview`,
        {
          method: 'POST',
          body: JSON.stringify({ localInviteCode: inviteCode }),
        },
      );
      setPreview(response);
      setStatus('Invitation ready to review. No access has been granted.');
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }
  async function shareCreatedInvitation() {
    if (!__DEV__ || created === undefined) return;
    try {
      const draft = buildUserInitiatedInvitationShareDraft({
        invitationId: created.invitation.id,
        localInviteCode: created.localInviteCode,
        expiresAt: created.invitation.expiresAt,
        surface: 'native_share_sheet',
      });
      const outcome = await Share.share({ message: draft.draftText });
      setStatus(
        outcome.action === Share.sharedAction
          ? 'Your device share sheet completed. BoomerBuddy did not select a contact or send a message.'
          : 'Share sheet closed. BoomerBuddy did not send anything.',
      );
    } catch (caught) {
      setError(readableError(caught));
    }
  }
  async function acceptInvite() {
    if (!preview || !consentConfirmed) return;
    const acceptedHouseholdId = preview.invitation.household.id;
    setBusy(true);
    setError('');
    try {
      const accepted = await mobileRequest<AcceptedInvitation>(
        `/v1/family/invitations/${encodeURIComponent(invitationId)}/accept`,
        {
          method: 'POST',
          body: JSON.stringify({
            localInviteCode: inviteCode,
            previewVersion: preview.invitation.previewVersion,
          }),
        },
      );
      if (accepted.householdId !== acceptedHouseholdId) {
        throw new MobileCustomerError(
          'The accepted household did not match the invitation you reviewed.',
        );
      }
      setPreview(undefined);
      setConsentConfirmed(false);
      setInvitationId('');
      setInviteCode('');
      setStatus('Invitation accepted with permission to view deliberately shared checks.');
      const refreshedMe = await mobileRequest<MeResponse>('/v1/me');
      if (!refreshedMe.principal.households.some((scope) => scope.id === acceptedHouseholdId)) {
        throw new MobileCustomerError(
          'Invitation accepted, but the reviewed household is not available in this session.',
        );
      }
      const nextHouseholdId = replacePrincipal(refreshedMe.principal, acceptedHouseholdId);
      if (nextHouseholdId !== acceptedHouseholdId) {
        throw new MobileCustomerError('The reviewed household could not be selected safely.');
      }
      await load(acceptedHouseholdId);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }
  function cancelReview() {
    setPreview(undefined);
    setConsentConfirmed(false);
    setInvitationId('');
    setInviteCode('');
    setStatus('Invitation review cancelled. No household access was granted.');
  }
  async function cancelPendingInvitation(id: string) {
    setBusy(true);
    setError('');
    try {
      await mobileRequest(`/v1/family/invitations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'X-BB-Household-Id': selectedHouseholdId },
      });
      setConfirmingInvitationId('');
      if (created?.invitation.id === id) setCreated(undefined);
      setStatus('Pending invitation cancelled. Its one-time code no longer works.');
      await load(selectedHouseholdId);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    try {
      await mobileRequest(`/v1/family/relationships/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'X-BB-Household-Id': selectedHouseholdId },
      });
      setStatus('Trusted Circle access revoked.');
      const refreshedMe = await mobileRequest<MeResponse>('/v1/me');
      if (refreshedMe.principal.households.some((scope) => scope.id === selectedHouseholdId)) {
        replacePrincipal(refreshedMe.principal, selectedHouseholdId);
        await load(selectedHouseholdId);
      } else {
        setFamily(undefined);
        replacePrincipal(refreshedMe.principal);
        navigation.navigate('Home');
      }
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Text accessibilityRole="header" style={s.title}>
        Family and Trusted Circle
      </Text>
      <Text style={s.body}>Permissions are explicit. Invitations are not emailed or texted.</Text>
      {error ? <ErrorText message={error} /> : null}
      {status ? (
        <Text accessibilityLiveRegion="polite" style={s.body}>
          {status}
        </Text>
      ) : null}
      <View style={s.card}>
        <Text style={s.heading}>Accept an invitation</Text>
        <Text style={s.muted}>
          Sign in with the invited account and enter both one-time values given by the protected
          member who initiated the invitation. Review the household, protected person, permission,
          and expiry before deciding.
        </Text>
        <Text style={s.label}>Invitation ID</Text>
        <TextInput
          accessibilityLabel="Invitation ID"
          autoCapitalize="none"
          onChangeText={(value) => {
            setInvitationId(value);
            setPreview(undefined);
            setConsentConfirmed(false);
          }}
          style={s.input}
          value={invitationId}
        />
        <Text style={s.label}>One-time code</Text>
        <TextInput
          accessibilityLabel="One-time invitation code"
          autoCapitalize="none"
          onChangeText={(value) => {
            setInviteCode(value);
            setPreview(undefined);
            setConsentConfirmed(false);
          }}
          secureTextEntry
          style={s.input}
          value={inviteCode}
        />
        <ActionButton
          title="Review invitation"
          disabled={busy || !invitationId || inviteCode.length < 24}
          onPress={() => void reviewInvite()}
        />
      </View>
      {preview ? (
        <View style={s.card}>
          <Text style={s.pill}>Review before accepting</Text>
          <Text accessibilityRole="header" style={s.heading}>
            Invitation consent details
          </Text>
          <Text style={s.label}>Household</Text>
          <Text style={s.body}>{preview.invitation.household.name}</Text>
          <Text style={s.label}>Protected person</Text>
          <Text style={s.body}>{preview.invitation.protectedPerson.displayName}</Text>
          <Text style={s.label}>Requested permission</Text>
          {preview.invitation.permissions.map((permission) => (
            <Text key={permission} style={s.body}>
              {trustedPermissionLabels[permission]}
            </Text>
          ))}
          <Text style={s.label}>Expires</Text>
          <Text style={s.body}>{new Date(preview.invitation.expiresAt).toLocaleString()}</Text>
          <Text style={s.muted}>
            Acceptance never shares all history. Each redacted result must be deliberately shared,
            submitted content is excluded, and no notification is sent.
          </Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consentConfirmed }}
            onPress={() => setConsentConfirmed((current) => !current)}
            style={[s.choice, consentConfirmed && s.choiceSelected]}
          >
            <View style={[s.radio, consentConfirmed && s.radioSelected]} />
            <Text style={s.body}>
              I reviewed the household, person, permission, and expiry and choose to accept.
            </Text>
          </Pressable>
          <ActionButton
            title={busy ? 'Accepting…' : 'Accept invitation'}
            disabled={busy || !consentConfirmed}
            onPress={() => void acceptInvite()}
          />
          <ActionButton
            kind="secondary"
            title="Cancel without accepting"
            disabled={busy}
            onPress={cancelReview}
          />
        </View>
      ) : null}
      {family ? (
        <>
          <View style={s.card}>
            <Text style={s.heading}>{family.household.name}</Text>
            {family.members.map((member) => (
              <View key={member.membershipId}>
                <Text style={s.label}>{member.displayName}</Text>
                <Text style={s.muted}>
                  member · {member.status}
                  {member.isAdministrator ? ' · administrator' : ''}
                  {member.isProtectedMember ? ' · protected adult' : ''}
                </Text>
              </View>
            ))}
          </View>
          <View style={s.card}>
            <Text style={s.heading}>Active Trusted Circle</Text>
            {family.relationships.filter((relationship) => relationship.state === 'active')
              .length ? (
              family.relationships
                .filter((relationship) => relationship.state === 'active')
                .map((relationship) => (
                  <View key={relationship.id}>
                    <Text style={s.label}>{relationship.trustedDisplayName}</Text>
                    {relationship.permissions.map((permission) => (
                      <Text key={permission} style={s.muted}>
                        {trustedPermissionLabels[permission]}
                      </Text>
                    ))}
                    {isHouseholdAdministrator ||
                    relationship.protectedPersonId === principal.personId ||
                    relationship.trustedPersonId === principal.personId ? (
                      <ActionButton
                        kind="danger"
                        title="Revoke access"
                        disabled={busy}
                        onPress={() => void revoke(relationship.id)}
                      />
                    ) : null}
                  </View>
                ))
            ) : (
              <Text style={s.body}>No active trusted relationships.</Text>
            )}
          </View>
          <View style={s.card}>
            <Text style={s.heading}>Pending invitations</Text>
            {family.invitations.filter((invitation) => invitation.state === 'pending').length ? (
              family.invitations
                .filter((invitation) => invitation.state === 'pending')
                .map((invitation) => (
                  <View key={invitation.id}>
                    <Text style={s.label}>{invitation.inviteeDisplayName}</Text>
                    <Text style={s.muted}>
                      Expires {new Date(invitation.expiresAt).toLocaleString()} · Not sent
                      automatically
                    </Text>
                    {isHouseholdAdministrator ||
                    invitation.protectedPersonId === principal.personId ? (
                      confirmingInvitationId === invitation.id ? (
                        <>
                          <Text style={s.body}>
                            Cancel this invitation? Its one-time code will stop working.
                          </Text>
                          <ActionButton
                            kind="danger"
                            title={busy ? 'Cancelling…' : 'Yes, cancel invitation'}
                            disabled={busy}
                            onPress={() => void cancelPendingInvitation(invitation.id)}
                          />
                          <ActionButton
                            kind="secondary"
                            title="Keep invitation"
                            disabled={busy}
                            onPress={() => setConfirmingInvitationId('')}
                          />
                        </>
                      ) : (
                        <ActionButton
                          kind="danger"
                          title="Cancel invitation"
                          disabled={busy}
                          onPress={() => setConfirmingInvitationId(invitation.id)}
                        />
                      )
                    ) : null}
                  </View>
                ))
            ) : (
              <Text style={s.body}>No pending invitations.</Text>
            )}
            <Text style={s.muted}>Invitation history never displays one-time codes.</Text>
          </View>
          {__DEV__ && isProtectedMember ? (
            <View style={s.card}>
              <Text style={s.heading}>Create local invitation</Text>
              <Text style={s.body}>
                You are inviting a trusted person into a relationship with you. An administrator
                cannot consent on your behalf, and the invited person must separately accept.
              </Text>
              <Text style={s.label}>Trusted person’s display name</Text>
              <TextInput
                accessibilityLabel="Trusted person’s display name"
                onChangeText={setInviteeName}
                style={s.input}
                value={inviteeName}
              />
              <Text style={s.muted}>
                Requested permission: view only redacted check results that are deliberately shared.
                Narrow acceptance and participant revocation are implemented. Broader generic
                consent activate/defer and escalation notifications are deferred.
              </Text>
              <ActionButton
                title="Create local invitation"
                disabled={busy || !inviteeName.trim()}
                onPress={() => void createInvite()}
              />
            </View>
          ) : null}
          {__DEV__ && created ? (
            <View accessibilityLiveRegion="polite" style={s.banner}>
              <Text style={s.heading}>Local invitation created</Text>
              <Text style={s.body}>
                Share these once with the intended person. They are not sent automatically or
                retained in the displayed history.
              </Text>
              <Text selectable style={s.label}>
                Invitation ID: {created.invitation.id}
              </Text>
              <Text selectable style={s.label}>
                One-time code: {created.localInviteCode}
              </Text>
              <ActionButton
                title="Open device share sheet"
                onPress={() => void shareCreatedInvitation()}
              />
              <Text style={s.muted}>
                Your device owns the destination and final send. BoomerBuddy does not request
                contacts permission, upload an address book, or send automatically.
              </Text>
            </View>
          ) : null}
        </>
      ) : selectedHouseholdId ? (
        <Loading label="Loading Family..." />
      ) : (
        <View style={s.card}>
          <Text style={s.heading}>No household access</Text>
          <Text style={s.body}>Review a valid invitation above when you are ready.</Text>
        </View>
      )}
    </Screen>
  );
}

const orientationSteps = [
  [
    'protection_subject',
    'Confirm identity, enrollment, and consent',
    'Confirm whose account and safety plan this is. BoomerBuddy does not verify identity. The protected adult must enroll and consent for themselves; managing or paying for the household does not replace their consent.',
  ],
  [
    'trusted_circle',
    'Consent and Trusted Circle',
    'Invite only people you know. Each person must accept their own sharing permission, and either person can end it. Sharing a Check does not notify them, so agree on how to contact each other.',
  ],
  [
    'safe_word',
    'Plan a family safe word',
    'Use a private phrase that is not one of your passwords.',
  ],
  [
    'practice_check',
    'Practice checking and sharing',
    'Use a fictional bank-message scenario to practice pausing, entering suspicious material in Check, reading what it noticed and its limits, taking a safe action, and deliberately sharing only a redacted result.',
  ],
  [
    'capabilities_and_limits',
    'Understand limits and recovery',
    'BoomerBuddy reviews only what you submit. It does not open websites, compare them with live online data, monitor messages, or guarantee safety. If money, access, or passwords were exposed, stop contact, use independently found official channels, secure the account, and seek qualified help.',
  ],
  [
    'review',
    'Review the plan',
    "Confirm who the plan is for, each person's consent and sharing choices, how to contact one another, the safe word, recovery contacts, and how to verify urgent requests independently.",
  ],
] as const;
type OrientationKey = (typeof orientationSteps)[number][0];
const orientationStatusLabels: Record<OrientationStateDto['status'], string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  ready: 'Ready',
};
const safeWordStatusLabels: Record<OrientationStateDto['safeWordDisposition'], string> = {
  unanswered: 'Not chosen',
  configured: 'Set up',
  informed_deferral: 'Deferred after review',
};

export function OrientationScreen(): React.ReactElement {
  const { selectedHouseholdId, selectedScope } = useMobileHousehold();
  const [state, setState] = useState<OrientationStateDto>();
  const [loadedHouseholdId, setLoadedHouseholdId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [phrase, setPhrase] = useState('');
  const [practice, setPractice] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const canUseOrientation =
    selectedScope?.isProtectedMember === true &&
    selectedScope.capabilities.includes('orientation:use');
  useEffect(() => {
    if (!canUseOrientation) return;
    let active = true;
    void mobileRequest<{ orientation: OrientationStateDto }>('/v1/orientation', {
      headers: { 'X-BB-Household-Id': selectedHouseholdId },
    })
      .then((response) => {
        if (!active) return;
        setState(response.orientation);
        setLoadedHouseholdId(selectedHouseholdId);
      })
      .catch((caught) => {
        if (active) setError(readableError(caught));
      });
    return () => {
      active = false;
    };
  }, [canUseOrientation, selectedHouseholdId]);
  async function start() {
    setBusy('start');
    try {
      const response = await mobileRequest<{ orientation: OrientationStateDto }>(
        '/v1/orientation/start',
        { method: 'POST', body: '{}' },
      );
      setState(response.orientation);
      setAnnouncement('Orientation started.');
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy('');
    }
  }
  async function complete(key: OrientationKey) {
    setBusy(key);
    try {
      const response = await mobileRequest<{ orientation: OrientationStateDto }>(
        `/v1/orientation/steps/${key}`,
        { method: 'PUT', body: JSON.stringify({ complete: true }) },
      );
      setState(response.orientation);
      setAnnouncement(`${orientationSteps.find((step) => step[0] === key)?.[1]} complete.`);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy('');
    }
  }
  async function safeWord(action: 'configure' | 'defer') {
    setBusy('safe_word');
    try {
      await mobileRequest('/v1/orientation/safe-word', {
        method: 'PUT',
        body: JSON.stringify(action === 'configure' ? { action, phrase } : { action }),
      });
      const response = await mobileRequest<{ orientation: OrientationStateDto }>(
        '/v1/orientation/steps/safe_word',
        { method: 'PUT', body: JSON.stringify({ complete: true }) },
      );
      setState(response.orientation);
      setPhrase('');
      setAnnouncement('Safe-word choice saved and step completed.');
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy('');
    }
  }
  const visibleState = loadedHouseholdId === selectedHouseholdId ? state : undefined;
  const nextIncompleteStep = orientationSteps.find(
    ([key]) => !(visibleState?.completedSteps.includes(key) ?? false),
  )?.[0];
  return (
    <Screen>
      <Text accessibilityRole="header" style={s.title}>
        Orientation
      </Text>
      <Text style={s.body}>
        Six guided stages cover identity, consent, Trusted Circle sharing, a realistic Check,
        recovery, and what BoomerBuddy can and cannot do.
      </Text>
      {announcement ? (
        <Text accessibilityLiveRegion="polite" style={s.body}>
          {announcement}
        </Text>
      ) : null}
      {error ? <ErrorText message={error} /> : null}
      {!canUseOrientation ? (
        <View style={s.banner}>
          <Text style={s.heading}>Protected adult access required</Text>
          <Text style={s.body}>
            Only an enrolled protected adult can complete orientation and set a safe word. Managing
            or paying for the household does not replace that adult&apos;s consent.
          </Text>
        </View>
      ) : !visibleState ? (
        <Loading label="Loading orientation…" />
      ) : (
        <>
          <View style={s.card}>
            <Text style={s.heading}>{visibleState.completedSteps.length} of 6 complete</Text>
            <Text style={s.body}>Status: {orientationStatusLabels[visibleState.status]}</Text>
            <Text style={s.muted}>
              Safe-word choice: {safeWordStatusLabels[visibleState.safeWordDisposition]}.{' '}
              {visibleState.needsAttention ? 'Setup still needs review.' : 'No setup issue found.'}
            </Text>
            {visibleState.status === 'not_started' ? (
              <ActionButton
                title={busy === 'start' ? 'Starting…' : 'Start orientation'}
                disabled={Boolean(busy)}
                onPress={() => void start()}
              />
            ) : null}
          </View>
          {orientationSteps.map(([key, title, detail], index) => {
            const done = visibleState.completedSteps.includes(key);
            const isCurrent = visibleState.status !== 'not_started' && nextIncompleteStep === key;
            return (
              <View key={key} style={s.card}>
                <Text style={s.pill}>{done ? 'Complete' : `Step ${index + 1}`}</Text>
                <Text style={s.heading}>{title}</Text>
                <Text style={s.body}>{detail}</Text>
                {key === 'trusted_circle' ? (
                  <Text style={s.muted}>
                    Marking this step complete only records that you reviewed it. Add or remove
                    people and sharing permissions separately in Family. BoomerBuddy does not send a
                    notification when you finish this step.
                  </Text>
                ) : null}
                {!done && !isCurrent ? (
                  <Text style={s.muted}>Complete the earlier steps before this one.</Text>
                ) : !done && key === 'safe_word' ? (
                  <>
                    <Text style={s.label}>Private family phrase</Text>
                    <TextInput
                      accessibilityLabel="Private family phrase"
                      autoComplete="new-password"
                      onChangeText={setPhrase}
                      secureTextEntry
                      style={s.input}
                      value={phrase}
                    />
                    <Text style={s.muted}>
                      BoomerBuddy never stores the phrase itself. It stores only a one-way protected
                      value used to check it later.
                    </Text>
                    <ActionButton
                      title="Save and complete"
                      disabled={Boolean(busy) || phrase.length < 8 || !isCurrent}
                      onPress={() => void safeWord('configure')}
                    />
                    <ActionButton
                      kind="secondary"
                      title="Defer after reading"
                      disabled={Boolean(busy) || !isCurrent}
                      onPress={() => void safeWord('defer')}
                    />
                  </>
                ) : !done && key === 'practice_check' ? (
                  <>
                    <Text style={s.label}>
                      A text says your bank account is locked and gives a link. Choose the safer
                      response.
                    </Text>
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: practice === 'link' }}
                      onPress={() => setPractice('link')}
                      style={[s.choice, practice === 'link' && s.choiceSelected]}
                    >
                      <View style={[s.radio, practice === 'link' && s.radioSelected]} />
                      <Text style={s.body}>Open the link quickly</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: practice === 'official' }}
                      onPress={() => setPractice('official')}
                      style={[s.choice, practice === 'official' && s.choiceSelected]}
                    >
                      <View style={[s.radio, practice === 'official' && s.radioSelected]} />
                      <Text style={s.body}>
                        Avoid the link; find the bank’s official number independently
                      </Text>
                    </Pressable>
                    {practice === 'link' ? (
                      <ErrorText message="The supplied link could be part of the scam. Verify independently." />
                    ) : null}
                    {practice === 'official' ? (
                      <Text accessibilityLiveRegion="polite" style={s.body}>
                        That is the safer response.
                      </Text>
                    ) : null}
                    <ActionButton
                      title="Complete practice"
                      disabled={Boolean(busy) || practice !== 'official' || !isCurrent}
                      onPress={() => void complete(key)}
                    />
                  </>
                ) : !done ? (
                  <ActionButton
                    title="Mark step complete"
                    disabled={Boolean(busy) || !isCurrent}
                    onPress={() => void complete(key)}
                  />
                ) : null}
              </View>
            );
          })}
          {visibleState.status === 'ready' ? (
            <View style={s.banner}>
              <Text style={s.heading}>Orientation ready</Text>
              <Text style={s.body}>
                Readiness does not mean messages are monitored or guaranteed safe.
              </Text>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}
