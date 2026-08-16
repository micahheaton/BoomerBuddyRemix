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
import type {
  CheckKind,
  CheckListResponse,
  CheckResult,
  CreateCheckResponse,
  CreateInvitationResponse,
  DevPersonaId,
  EntitlementResponse,
  FamilyResponse,
  InvitationPreviewResponse,
  MeResponse,
  MobileSessionResponse,
  OrientationStateDto,
  PrincipalDto,
  TrustedCirclePermissionDto,
} from '@boomerbuddy/contracts';
import { mobileRequest, readableError } from './api';
import {
  mobileHouseholdScopeSummary,
  useMobileHousehold,
  useOptionalMobileHousehold,
} from './household';
import type { NativeEntrySignal, RootStackParamList } from './navigation';
import {
  clearSessionToken,
  sessionStorageDisclosure,
  setSelectedHouseholdId as persistSelectedHouseholdId,
  writeSessionToken,
} from './session';
import { appStyles as s } from './theme';

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
  onSignedIn,
}: NativeStackScreenProps<RootStackParamList, 'SignIn'> & {
  onSignedIn: (principal: PrincipalDto) => void;
}) {
  const [personaId, setPersonaId] = useState<DevPersonaId>('owner-alice');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const personas: Array<{ id: DevPersonaId; label: string }> = [
    { id: 'owner-alice', label: 'Alice — Sunrise administrator and protected adult' },
    { id: 'protected-pat', label: 'Pat — Sunrise protected member' },
    { id: 'trusted-terry', label: 'Terry — seeded trusted person' },
    { id: 'trusted-jordan', label: 'Jordan — unassigned trusted person' },
    { id: 'owner-bob', label: 'Bob — Harbor administrator without protected enrollment' },
    { id: 'protected-olivia', label: 'Olivia — Harbor protected member' },
  ];
  async function signIn() {
    setBusy(true);
    setError('');
    try {
      const response = await mobileRequest<MobileSessionResponse>(
        '/v1/dev/sessions/mobile',
        { method: 'POST', body: JSON.stringify({ personaId }) },
        false,
      );
      await writeSessionToken(response.token);
      await persistSelectedHouseholdId(response.principal.households[0]?.id ?? null);
      onSignedIn(response.principal);
    } catch (caught) {
      await clearSessionToken().catch(() => undefined);
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Text accessibilityRole="header" style={s.title}>
        Choose a seeded person
      </Text>
      <Text style={s.body}>
        This is a local development build. There is no production account or password.
      </Text>
      <View style={s.banner}>
        <Text style={s.label}>Device state is not verified</Text>
        <Text style={s.muted}>{sessionStorageDisclosure}</Text>
      </View>
      <Text style={s.label}>Development persona</Text>
      {personas.map((persona) => (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: persona.id === personaId }}
          key={persona.id}
          onPress={() => setPersonaId(persona.id)}
          style={[s.choice, persona.id === personaId && s.choiceSelected]}
        >
          <View style={[s.radio, persona.id === personaId && s.radioSelected]} />
          <Text style={s.body}>{persona.label}</Text>
        </Pressable>
      ))}
      {error ? <ErrorText message={error} /> : null}
      <ActionButton
        title={busy ? 'Signing in…' : 'Enter local mobile build'}
        disabled={busy}
        onPress={() => void signIn()}
      />
      <Text style={s.muted}>
        Development bearer sessions are refused when the service runs in production mode.
      </Text>
    </Screen>
  );
}

export function HomeScreen({
  navigation,
  nativeEntrySignal,
  onSignOut,
}: NativeStackScreenProps<RootStackParamList, 'Home'> & {
  nativeEntrySignal: NativeEntrySignal;
  onSignOut: () => void;
}) {
  const { principal, selectedHouseholdId, selectedScope, selectHousehold, householdName } =
    useMobileHousehold();
  const [entitlements, setEntitlements] = useState<{
    householdId: string;
    value: EntitlementResponse;
  }>();
  const [entitlementsUnavailableFor, setEntitlementsUnavailableFor] = useState('');
  useEffect(() => {
    if (!selectedHouseholdId || !selectedScope?.isBillingManager) return;
    let active = true;
    void mobileRequest<EntitlementResponse>('/v1/entitlements')
      .then((response) => {
        if (!active) return;
        setEntitlements({ householdId: selectedHouseholdId, value: response });
        setEntitlementsUnavailableFor('');
      })
      .catch(() => {
        if (active) setEntitlementsUnavailableFor(selectedHouseholdId);
      });
    return () => {
      active = false;
    };
  }, [selectedHouseholdId, selectedScope?.isBillingManager]);
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
    if (!allowance) return `${label}: unavailable in the local access projection.`;
    if (allowance.used === null) {
      return `${label}: usage unavailable; local limit ${allowance.limit}. State: ${allowance.state.replaceAll('_', ' ')}.`;
    }
    return `${label}: ${allowance.used} of ${allowance.limit} used; ${allowance.remaining} remaining. State: ${allowance.state.replaceAll('_', ' ')}.`;
  };
  return (
    <Screen>
      <Text style={s.pill}>Local rules-only analysis</Text>
      <Text accessibilityRole="header" style={s.title}>
        Hello, {principal.displayName}
      </Text>
      <Text style={s.body}>
        {isUnassigned
          ? 'You are not connected to a household. A valid local invitation and explicit consent are required before protection features become available.'
          : 'Pause before you click, reply, pay, or share a code. BoomerBuddy can help you choose a safer next step, but it can be wrong.'}
      </Text>
      {principal.households.length > 1 ? (
        <View style={s.card}>
          <Text style={s.heading}>Active household</Text>
          <Text style={s.muted}>Checks, history, Family, and orientation use this one scope.</Text>
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
                {householdName(scope.id, index)} — {mobileHouseholdScopeSummary(scope)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={s.banner}>
        <Text style={s.label}>Native intake is blocked pending device verification</Text>
        <Text style={s.muted}>
          Route-only deep-link observation is scaffolded. Inbound share targets are not configured,
          and this build does not read messages, notifications, contacts, or the clipboard. Paste an
          item manually in Check.
        </Text>
        <ActionButton
          kind="secondary"
          title="Review native proof status"
          onPress={() => navigation.navigate('NativeProof')}
        />
      </View>
      {nativeEntrySignal === 'route_only_check' ? (
        <View style={s.card}>
          <Text style={s.pill}>Route-only deep link observed</Text>
          <Text style={s.body}>
            The link requested the Check screen without carrying an artifact. Nothing was pasted or
            analyzed automatically.
          </Text>
          {canCheck ? (
            <ActionButton
              title="Continue to empty Check"
              onPress={() => navigation.navigate('Check')}
            />
          ) : (
            <Text style={s.muted}>Check is unavailable in this household scope.</Text>
          )}
        </View>
      ) : nativeEntrySignal === 'rejected_payload' ? (
        <View style={s.banner}>
          <Text style={s.label}>Deep-link payload rejected</Text>
          <Text style={s.muted}>
            BoomerBuddy accepts only the empty route signal. Suspicious content in a URL is not
            ingested because links may leak through operating-system and app history.
          </Text>
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
            Checks require an active protected-adult enrollment. Owner access alone does not grant
            this protected workflow.
          </Text>
        ) : null}
        {!isUnassigned && canReadHistory ? (
          <ActionButton
            kind="secondary"
            title="Open history"
            onPress={() => navigation.navigate('History')}
          />
        ) : !isUnassigned ? (
          <Text style={s.muted}>History is unavailable in this household scope.</Text>
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
            Orientation requires an active protected-adult enrollment in this household.
          </Text>
        ) : null}
        <ActionButton kind="secondary" title="Sign out" onPress={onSignOut} />
      </View>
      {!isUnassigned ? (
        <View style={s.card} testID="local-access-summary">
          <Text style={s.pill}>Local access hypothesis</Text>
          <Text style={s.heading}>
            {selectedEntitlements?.commerce.primary?.plan.displayName ?? 'Access details'}
          </Text>
          <Text style={s.body}>
            This development-only access record is a product hypothesis. There is no billing,
            purchase, upgrade, or charge in this build.
          </Text>
          {!selectedScope?.isBillingManager ? (
            <Text style={s.muted}>
              Household plan totals are billing-manager-only in this local build. Your available
              actions still follow the permissions for this selected household.
            </Text>
          ) : selectedEntitlements ? (
            <>
              <Text style={s.muted}>
                Access state: {selectedEntitlements.commerce.accessState.replaceAll('_', ' ')}
                {selectedEntitlements.commerce.primary
                  ? ` · Plan state: ${selectedEntitlements.commerce.primary.plan.state}`
                  : ''}
              </Text>
              <Text style={s.body}>{allowanceSummary('Protected adults', protectedAllowance)}</Text>
              <Text style={s.body}>
                {allowanceSummary('Trusted Circle participants', trustedAllowance)}
              </Text>
            </>
          ) : entitlementsUnavailableFor === selectedHouseholdId ? (
            <Text style={s.muted}>
              Local plan and allowance details are unavailable. The selected household permissions
              shown in the actions above still apply.
            </Text>
          ) : (
            <Text style={s.muted}>Loading selected-household access details…</Text>
          )}
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
      const supported = await Linking.canOpenURL('boomerbuddy-local://check');
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
          The app manifest registers <Text style={s.label}>boomerbuddy-local://check</Text>. The
          listener accepts only that empty route signal; query strings and fragments are rejected so
          the app does not ingest artifacts that may already be exposed in operating-system link
          history.
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
          <Text style={s.heading}>Protected-adult enrollment required</Text>
          <Text style={s.body}>
            Creating and owning a Check requires an active protected-adult enrollment. Household
            administrator access alone does not grant this workflow.
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
        Remove names, account numbers, passwords, and access codes before pasting.
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
            <View style={[s.radio, kind === item && s.radioSelected]} />
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
        Local rules do not visit URLs or consult a live reputation provider. Do not paste secrets.
      </Text>
      {!canCheckText && !canCheckUrl ? (
        <View style={s.banner}>
          <Text style={s.label}>Checks unavailable</Text>
          <Text style={s.muted}>Choose a household scope whose plan includes checking.</Text>
        </View>
      ) : null}
      <View style={s.banner}>
        <Text style={s.label}>Local retention</Text>
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
        `Redacted result shared locally with ${displayName}. No notification was sent and submitted content was not included.`,
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
        <Text style={s.pill}>
          {check.provider.state === 'mock' ? 'Mock analysis' : `Provider ${check.provider.state}`}
        </Text>
        <Text style={s.pill}>{check.access.kind === 'owned' ? 'Yours' : 'Shared with you'}</Text>
        <Text accessibilityRole="header" style={s.title}>
          Check result
        </Text>
        <Text style={s.heading}>Risk: {riskLabels[check.risk]}</Text>
        <Text style={s.body}>{check.summary}</Text>
        <Text style={s.label}>Evidence sufficiency: {check.evidenceSufficiency}</Text>
        <Text style={s.muted}>
          This describes how much supporting information local rules found, not a probability.
        </Text>
        <Text style={s.label}>Calibration: Not calibrated</Text>
        <Text style={s.muted}>
          The result has not been empirically calibrated and must not be read as certainty.
        </Text>
        <Text style={s.label}>Provider provenance</Text>
        <Text style={s.body}>
          {check.provider.name} · {check.provider.state} · version {check.provider.version}
        </Text>
        <Text style={s.label}>Ruleset version</Text>
        <Text style={s.body}>{check.rulesetVersion}</Text>
        <Text style={s.label}>Retention and deletion</Text>
        <Text style={s.body}>
          State: {check.retention.state}. Scheduled deletion:{' '}
          {new Date(check.retention.deleteAfter).toLocaleString()} unless you delete sooner.
        </Text>
        <Text style={s.muted}>
          Reference: {check.id}. The same analysis ID is searchable in local HQ audit metadata; it
          is not an external incident number.
        </Text>
      </View>
      <View style={s.card}>
        <Text style={s.heading}>What was observed</Text>
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
            Eligible Trusted Circle people receive result metadata, evidence, and safe actions only.
            Submitted text or URLs are excluded, and no notification is sent.
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
              No active relationship has permission to view deliberately shared checks.
            </Text>
          )}
          {shareStatus ? (
            <Text accessibilityLiveRegion="polite" style={s.body}>
              {shareStatus}
            </Text>
          ) : null}
          <Text style={s.muted}>
            Receive-escalation notifications are scaffolded and not implemented.
          </Text>
        </View>
      ) : check.access.kind === 'shared' ? (
        <View style={s.card}>
          <Text style={s.heading}>Shared with you</Text>
          <Text style={s.body}>
            Only the check owner can reshare or delete this result. To leave shared access, withdraw
            from the pairwise relationship in Family.
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
        setError('History is unavailable in this household scope.');
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
        This response never displays submitted content. Minimized input is encrypted locally until
        scheduled or earlier user deletion; only content-free operational proof and structured
        deletion state remain afterward.
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
                {riskLabels[check.risk]} · Evidence {check.evidenceSufficiency} · Not calibrated
              </Text>
              <Text style={s.muted}>
                {new Date(check.createdAt).toLocaleString()} · {check.provider.state} provider
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
  receive_escalations: 'Future escalation notifications (not implemented)',
  help_with_orientation: 'Future guided orientation help (not implemented)',
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
        throw new Error('The accepted household did not match the invitation you reviewed.');
      }
      setPreview(undefined);
      setConsentConfirmed(false);
      setInvitationId('');
      setInviteCode('');
      setStatus('Invitation accepted with permission to view deliberately shared checks.');
      const refreshedMe = await mobileRequest<MeResponse>('/v1/me');
      if (!refreshedMe.principal.households.some((scope) => scope.id === acceptedHouseholdId)) {
        throw new Error(
          'Invitation accepted, but the reviewed household is not available in this session.',
        );
      }
      const nextHouseholdId = replacePrincipal(refreshedMe.principal, acceptedHouseholdId);
      if (nextHouseholdId !== acceptedHouseholdId) {
        throw new Error('The reviewed household could not be selected safely.');
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
      <Text style={s.body}>
        Permissions are explicit. Local invitations are not emailed or texted.
      </Text>
      {error ? <ErrorText message={error} /> : null}
      {status ? (
        <Text accessibilityLiveRegion="polite" style={s.body}>
          {status}
        </Text>
      ) : null}
      <View style={s.card}>
        <Text style={s.heading}>Accept a local invitation</Text>
        <Text style={s.muted}>
          Sign in as the invited seeded person and enter both one-time values given by the protected
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
          accessibilityLabel="One-time local invite code"
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
                      Expires {new Date(invitation.expiresAt).toLocaleString()} · Local only
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
          {isProtectedMember ? (
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
          {created ? (
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
            </View>
          ) : null}
        </>
      ) : selectedHouseholdId ? (
        <Loading label="Loading scoped family view…" />
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
    'Confirm whose identity and plan this is. This review does not verify identity. The protected adult needs accepted self-enrollment; administration or payment never replaces that person’s consent.',
  ],
  [
    'trusted_circle',
    'Consent and Trusted Circle',
    'Review the exact person, sharing permission, and withdrawal path. Pairwise permission requires acceptance and can end independently. Notifications are unavailable in this build, so agree on a manual contact method.',
  ],
  [
    'safe_word',
    'Plan a family safe word',
    'Use a private phrase that is not one of your passwords.',
  ],
  [
    'practice_check',
    'Practice the Check and sharing workflow',
    'Use a synthetic bank-message scenario to practice pausing, entering suspicious material in Check, reading evidence and limits, taking a safe action, and deliberately sharing only a redacted result.',
  ],
  [
    'capabilities_and_limits',
    'Understand limits and recovery',
    'Local rules-only analysis does not fetch URLs, use a live reputation provider, monitor messages, or guarantee safety. If money, access, or credentials were exposed, stop contact, use independently found official channels, secure the account, and seek qualified help.',
  ],
  [
    'review',
    'Review the plan',
    'Confirm identity and protected-person scope, consent, pairwise permissions, manual contact plan, safe word, Check and sharing workflow, recovery contacts, and independent verification steps.',
  ],
] as const;
type OrientationKey = (typeof orientationSteps)[number][0];

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
        Six guided stages cover identity, protected-person consent, Trusted Circle sharing,
        notification limits, a realistic Check, recovery, and product boundaries.
      </Text>
      {announcement ? (
        <Text accessibilityLiveRegion="polite" style={s.body}>
          {announcement}
        </Text>
      ) : null}
      {error ? <ErrorText message={error} /> : null}
      {!canUseOrientation ? (
        <View style={s.banner}>
          <Text style={s.heading}>Protected-adult enrollment required</Text>
          <Text style={s.body}>
            Self-orientation and safe-word setup require an active protected-adult enrollment.
            Household administrator access alone does not grant these protected workflows.
          </Text>
        </View>
      ) : !visibleState ? (
        <Loading label="Loading orientation…" />
      ) : (
        <>
          <View style={s.card}>
            <Text style={s.heading}>{visibleState.completedSteps.length} of 6 complete</Text>
            <Text style={s.body}>Status: {visibleState.status.replaceAll('_', ' ')}</Text>
            <Text style={s.muted}>
              Safe-word choice: {visibleState.safeWordDisposition.replaceAll('_', ' ')} · Attention:{' '}
              {visibleState.needsAttention
                ? 'setup still needs review'
                : 'no incomplete stage flagged'}
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
                    Completing this stage records review only. It does not create a relationship,
                    grant permission, or send a notification; those actions remain explicit in
                    Family.
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
                      Normalized only in memory; the service stores a salted memory-hard verifier,
                      not the phrase.
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
