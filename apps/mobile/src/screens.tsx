import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
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
import * as Crypto from 'expo-crypto';
import type {
  AcceptHouseholdMemberInvitationResponse,
  CheckKind,
  CheckListResponse,
  CheckResult,
  CheckShareLifecycle,
  CheckShareListResponse,
  CreateCheckResponse,
  CreateHouseholdMemberInvitationResponse,
  CreateInvitationResponse,
  CreateRecipientConnectionCodeResponse,
  EntitlementResponse,
  FamilyResponse,
  HouseholdMemberInvitationPreviewResponse,
  InvitationPreviewResponse,
  MeResponse,
  OrientationStateDto,
  ProtectedSelfEnrollmentStatusResponse,
  TrustedCircleAttentionResponse,
  TrustedCirclePermissionDto,
} from '@boomerbuddy/contracts';
import {
  apiPaths,
  buildUserInitiatedInvitationShareDraft,
  meResponseSchema,
} from '@boomerbuddy/contracts';
import {
  MobileCustomerError,
  mobileRequest,
  readableError,
  requiresRecentAuthentication,
} from './api';
import {
  emptyHouseholdResource,
  householdBoundDraftValue,
  householdResourceIsVisible,
  householdResourceReducer,
  type HouseholdBoundDraft,
} from './household-resource';
import {
  mobileHouseholdScopeSummary,
  useMobileHousehold,
  useOptionalMobileHousehold,
} from './household';
import {
  historyContinuationIsCurrent,
  mergeHistoryContinuation,
  type HistoryContinuation,
} from './history-resource';
import { startMobileHostedSignIn } from './hosted-auth';
import {
  emptyInvitationReview,
  invitationAcceptanceBinding,
  invitationReviewReducer,
  type InvitationReviewState,
} from './invitation-review';
import type { NativeEntrySignal, RootStackParamList } from './navigation';
import {
  createProtectedAccessEnrollmentOperation,
  createProtectedAccessWithdrawalOperation,
  isDefinitiveProtectedAccessMutationFailure,
  parseProtectedAccessEnrollment,
  parseProtectedAccessStatus,
  parseProtectedAccessWithdrawal,
  protectedAccessAttemptIsCurrent,
  protectedAccessEligibilityMessage,
  protectedAccessOperationIsResolvedByStatus,
  protectedAccessOperationSlot,
  protectedAccessTruthAnnouncement,
  type ProtectedAccessAttempt,
  type ProtectedAccessOperation,
} from './protected-access-resource';
import { canCloseSharedResult } from './share-lifecycle';
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
      if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
        setError('Secure member sign-in is unavailable on this platform.');
        return;
      }
      const outcome = await startMobileHostedSignIn(startHostedAuth, Platform.OS);
      if (outcome === 'not_completed') {
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
      <Text style={s.muted}>
        If secure sign-in asks you to confirm this device, finish that step in the same window.
        BoomerBuddy accepts only the callback created by that sign-in attempt.
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
        Already have a BoomerBuddy account? Sign in with the same email address. Create and manage
        paid membership on the BoomerBuddy website; this app does not take payment.
      </Text>
    </Screen>
  );
}

export function SessionRecoveryScreen({
  navigation,
  message,
  onRetry,
  onSignOut,
}: NativeStackScreenProps<RootStackParamList, 'SessionRecovery'> & {
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
      <ActionButton
        kind="secondary"
        title="Help and policies"
        onPress={() => navigation.navigate('HelpPolicies')}
      />
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
  const [attention, setAttention] = useState<{
    householdId: string;
    value: TrustedCircleAttentionResponse;
  }>();
  const [attentionUnavailableFor, setAttentionUnavailableFor] = useState('');
  const [attentionRefreshAttempt, setAttentionRefreshAttempt] = useState(0);
  const selectedHomeHouseholdIdRef = useRef(selectedHouseholdId);
  useLayoutEffect(() => {
    selectedHomeHouseholdIdRef.current = selectedHouseholdId;
  }, [selectedHouseholdId]);
  const attentionFocusGenerationRef = useRef(0);
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
  const hasTrustedCircleGrant =
    selectedScope?.trustedCircleGrants.some((grant) =>
      grant.permissions.includes('view_shared_checks'),
    ) === true;
  useFocusEffect(
    useCallback(() => {
      void attentionRefreshAttempt;
      const householdId = selectedHouseholdId;
      const attentionFocusGeneration = ++attentionFocusGenerationRef.current;
      let active = true;
      const attentionRequestIsCurrent = (): boolean =>
        active &&
        selectedHomeHouseholdIdRef.current === householdId &&
        attentionFocusGenerationRef.current === attentionFocusGeneration;
      if (!householdId || !hasTrustedCircleGrant) {
        setAttention(undefined);
        setAttentionUnavailableFor('');
        return () => {
          active = false;
          if (attentionFocusGenerationRef.current === attentionFocusGeneration) {
            attentionFocusGenerationRef.current += 1;
          }
        };
      }
      const controller = new AbortController();
      setAttention((current) => (current?.householdId === householdId ? undefined : current));
      setAttentionUnavailableFor('');
      void mobileRequest<TrustedCircleAttentionResponse>('/v1/trusted-circle/attention', {
        headers: { 'X-BB-Household-Id': householdId },
        signal: controller.signal,
      })
        .then((response) => {
          if (!attentionRequestIsCurrent()) return;
          setAttention({ householdId, value: response });
          setAttentionUnavailableFor('');
        })
        .catch(() => {
          if (controller.signal.aborted || !attentionRequestIsCurrent()) return;
          setAttention((current) => (current?.householdId === householdId ? undefined : current));
          setAttentionUnavailableFor(householdId);
        });
      return () => {
        active = false;
        controller.abort();
        if (attentionFocusGenerationRef.current === attentionFocusGeneration) {
          attentionFocusGenerationRef.current += 1;
        }
      };
    }, [attentionRefreshAttempt, hasTrustedCircleGrant, selectedHouseholdId]),
  );
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
  const canUseFamily = isUnassigned || selectedScope !== undefined;
  const selectedEntitlements =
    entitlements?.householdId === selectedHouseholdId ? entitlements.value : undefined;
  const selectedAttention =
    attention?.householdId === selectedHouseholdId ? attention.value : undefined;
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
        {!isUnassigned ? (
          <ActionButton
            kind="secondary"
            title="Protected access"
            accessibilityHint="Review or change protected-adult access for yourself in the selected household"
            onPress={() => navigation.navigate('ProtectedAccess')}
          />
        ) : null}
        {canUseFamily ? (
          <ActionButton
            kind="secondary"
            title="Trusted Circle and family"
            onPress={() => navigation.navigate('Family')}
          />
        ) : null}
        {!isUnassigned ? (
          <ActionButton
            kind="secondary"
            title="Family Safe Word"
            onPress={() => navigation.navigate('FamilySafeWord')}
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
        {!isUnassigned ? (
          <ActionButton
            kind="secondary"
            title="Share feedback"
            onPress={() => navigation.navigate('Feedback')}
          />
        ) : null}
        <ActionButton
          kind="secondary"
          title="Support"
          onPress={() => navigation.navigate('Support')}
        />
        <ActionButton
          kind="secondary"
          title="Help and policies"
          onPress={() => navigation.navigate('HelpPolicies')}
        />
        <ActionButton kind="secondary" title="Sign out" onPress={onSignOut} />
      </View>
      {!isUnassigned && hasTrustedCircleGrant ? (
        <View style={s.card}>
          <Text style={s.pill}>Trusted Circle attention</Text>
          <Text style={s.heading}>Review requests</Text>
          <Text style={s.body} accessibilityLiveRegion="polite">
            {attentionUnavailableFor === selectedHouseholdId
              ? 'Trusted Circle requests are unavailable right now.'
              : selectedAttention
                ? selectedAttention.pendingAcknowledgementCount > 0
                  ? `${selectedAttention.pendingAcknowledgementCount} shared ${
                      selectedAttention.pendingAcknowledgementCount === 1
                        ? 'result needs'
                        : 'results need'
                    } your acknowledgement.`
                  : 'No shared results are waiting for your acknowledgement.'
                : 'Checking for Trusted Circle requests...'}
          </Text>
          <Text style={s.muted}>
            BoomerBuddy does not send a text, email, or push alert. Open History here when a trusted
            person contacts you directly.
          </Text>
          <ActionButton
            kind="secondary"
            title="Open shared History"
            onPress={() => navigation.navigate('History')}
          />
          {attentionUnavailableFor === selectedHouseholdId ? (
            <ActionButton
              kind="secondary"
              title="Retry Trusted Circle requests"
              onPress={() => setAttentionRefreshAttempt((current) => current + 1)}
            />
          ) : null}
        </View>
      ) : null}
      {!isUnassigned && canUseOrientation ? (
        <View style={s.card}>
          <Text style={s.pill}>This week</Text>
          <Text style={s.heading}>One short lesson and current updates</Text>
          <Text style={s.body}>
            Practice a safety skill, review source-linked guidance for your selected region, and
            check your in-app reminder center. National guidance remains available when no reviewed
            state item exists. Progress belongs to you and this household.
          </Text>
          <ActionButton
            kind="secondary"
            title="Seven lessons and regional guidance"
            onPress={() => navigation.navigate('LearnUpdates')}
          />
        </View>
      ) : null}
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

export function ProtectedAccessScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'ProtectedAccess'>): React.ReactElement {
  const { principal, selectedHouseholdId, selectedHouseholdName, selectedScope, replacePrincipal } =
    useMobileHousehold();
  const [statusState, dispatchStatus] = useReducer(
    householdResourceReducer<ProtectedSelfEnrollmentStatusResponse>,
    emptyHouseholdResource<ProtectedSelfEnrollmentStatusResponse>(),
  );
  const [operations, setOperations] = useState<Readonly<Record<string, ProtectedAccessOperation>>>(
    {},
  );
  const [enrollmentAcceptance, setEnrollmentAcceptance] = useState<
    Readonly<Record<string, boolean>>
  >({});
  const [withdrawalAcknowledgment, setWithdrawalAcknowledgment] = useState<
    Readonly<Record<string, boolean>>
  >({});
  const [errorState, setErrorState] = useState<HouseholdBoundDraft<string>>();
  const [announcementState, setAnnouncementState] = useState<HouseholdBoundDraft<string>>();
  const [busyAttempt, setBusyAttempt] = useState<ProtectedAccessAttempt>();
  const selectedHouseholdIdRef = useRef(selectedHouseholdId);
  useLayoutEffect(() => {
    selectedHouseholdIdRef.current = selectedHouseholdId;
  }, [selectedHouseholdId]);
  const householdGenerationRef = useRef(0);
  const statusRequestIdRef = useRef(0);
  const statusAbortRef = useRef<AbortController | undefined>(undefined);
  const actionRequestIdRef = useRef(0);
  const actionAbortRef = useRef<AbortController | undefined>(undefined);

  const loadStatus = useCallback(
    async (
      householdId: string,
      householdGeneration: number,
      controller: AbortController,
    ): Promise<ProtectedSelfEnrollmentStatusResponse | undefined> => {
      const requestId = ++statusRequestIdRef.current;
      dispatchStatus({ type: 'started', householdId, requestId });
      const requestIsCurrent = (): boolean =>
        !controller.signal.aborted &&
        selectedHouseholdIdRef.current === householdId &&
        householdGenerationRef.current === householdGeneration &&
        statusRequestIdRef.current === requestId;
      try {
        const raw = await mobileRequest<unknown>(apiPaths.protectedEnrollment, {
          headers: { 'X-BB-Household-Id': householdId },
          signal: controller.signal,
        });
        const status = parseProtectedAccessStatus(raw, householdId, principal.personId);
        if (!requestIsCurrent()) return undefined;
        setOperations((current) => {
          let changed = false;
          const next = { ...current };
          for (const action of ['enroll', 'withdraw'] as const) {
            const slot = protectedAccessOperationSlot(householdId, action);
            const operation = current[slot];
            if (operation && protectedAccessOperationIsResolvedByStatus(operation, status)) {
              delete next[slot];
              changed = true;
            }
          }
          return changed ? next : current;
        });
        dispatchStatus({ type: 'succeeded', householdId, requestId, value: status });
        return status;
      } catch (caught) {
        if (!requestIsCurrent()) return undefined;
        dispatchStatus({
          type: 'failed',
          householdId,
          requestId,
          message: readableError(caught),
        });
        return undefined;
      } finally {
        if (statusAbortRef.current === controller) statusAbortRef.current = undefined;
      }
    },
    [principal.personId],
  );

  const beginStatusLoad = useCallback(
    (householdId: string, householdGeneration: number): void => {
      statusAbortRef.current?.abort();
      const controller = new AbortController();
      statusAbortRef.current = controller;
      void loadStatus(householdId, householdGeneration, controller);
    },
    [loadStatus],
  );

  useEffect(() => {
    const householdId = selectedHouseholdId;
    const householdGeneration = ++householdGenerationRef.current;
    statusRequestIdRef.current += 1;
    statusAbortRef.current?.abort();
    statusAbortRef.current = undefined;
    actionRequestIdRef.current += 1;
    actionAbortRef.current?.abort();
    actionAbortRef.current = undefined;
    void Promise.resolve().then(() => {
      if (householdGenerationRef.current !== householdGeneration) return;
      setBusyAttempt(undefined);
      setErrorState(undefined);
      setAnnouncementState(undefined);
      if (!householdId) dispatchStatus({ type: 'reset' });
      else beginStatusLoad(householdId, householdGeneration);
    });
    if (!householdId) {
      return () => undefined;
    }
    return () => {
      statusAbortRef.current?.abort();
      statusAbortRef.current = undefined;
      actionRequestIdRef.current += 1;
      actionAbortRef.current?.abort();
      actionAbortRef.current = undefined;
      if (householdGenerationRef.current === householdGeneration) {
        householdGenerationRef.current += 1;
      }
    };
  }, [beginStatusLoad, selectedHouseholdId]);

  const visibleStatusState = householdResourceIsVisible(statusState, selectedHouseholdId)
    ? statusState
    : undefined;
  const status = visibleStatusState?.status === 'ready' ? visibleStatusState.value : undefined;
  const enrollSlot = protectedAccessOperationSlot(selectedHouseholdId, 'enroll');
  const withdrawSlot = protectedAccessOperationSlot(selectedHouseholdId, 'withdraw');
  const pendingEnroll =
    operations[enrollSlot]?.action === 'enroll' ? operations[enrollSlot] : undefined;
  const pendingWithdraw =
    operations[withdrawSlot]?.action === 'withdraw' ? operations[withdrawSlot] : undefined;
  const enrollmentAccepted =
    pendingEnroll !== undefined || enrollmentAcceptance[selectedHouseholdId] === true;
  const withdrawalAcknowledged =
    pendingWithdraw !== undefined || withdrawalAcknowledgment[selectedHouseholdId] === true;
  const actionError = householdBoundDraftValue(errorState, selectedHouseholdId) ?? '';
  const announcement = householdBoundDraftValue(announcementState, selectedHouseholdId) ?? '';
  const busy = busyAttempt?.householdId === selectedHouseholdId ? busyAttempt.action : '';

  function clearOperation(operation: ProtectedAccessOperation): void {
    const slot = protectedAccessOperationSlot(operation.householdId, operation.action);
    setOperations((current) => {
      if (current[slot]?.key !== operation.key) return current;
      const next = { ...current };
      delete next[slot];
      return next;
    });
  }

  function attemptIsCurrent(attempt: ProtectedAccessAttempt): boolean {
    return protectedAccessAttemptIsCurrent(attempt, {
      householdId: selectedHouseholdIdRef.current,
      householdGeneration: householdGenerationRef.current,
      requestId: actionRequestIdRef.current,
    });
  }

  async function refreshPrincipalAfterMutation(householdId: string): Promise<void> {
    const refreshed = meResponseSchema.parse(await mobileRequest<unknown>('/v1/me'));
    if (!refreshed.principal.households.some((scope) => scope.id === householdId)) {
      throw new MobileCustomerError(
        'The changed household is not available in the refreshed account session.',
      );
    }
    const currentlySelected = selectedHouseholdIdRef.current;
    const preferredHouseholdId = refreshed.principal.households.some(
      (scope) => scope.id === currentlySelected,
    )
      ? currentlySelected
      : householdId;
    const nextHouseholdId = replacePrincipal(refreshed.principal, preferredHouseholdId);
    if (currentlySelected === householdId && nextHouseholdId !== householdId) {
      throw new MobileCustomerError('The changed household could not be selected safely.');
    }
  }

  async function submitOperation(operation: ProtectedAccessOperation): Promise<void> {
    if (busyAttempt !== undefined || actionAbortRef.current !== undefined) return;
    const attempt: ProtectedAccessAttempt = {
      householdId: operation.householdId,
      householdGeneration: householdGenerationRef.current,
      requestId: ++actionRequestIdRef.current,
      action: operation.action,
      operationKey: operation.key,
    };
    const controller = new AbortController();
    actionAbortRef.current = controller;
    setBusyAttempt(attempt);
    setErrorState(undefined);
    setAnnouncementState(undefined);
    let mutationConfirmed = false;
    try {
      const raw = await mobileRequest<unknown>(
        operation.action === 'enroll'
          ? apiPaths.protectedEnrollment
          : `${apiPaths.protectedEnrollment}/withdraw`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': operation.key,
            'X-BB-Household-Id': operation.householdId,
          },
          body: JSON.stringify(operation.request),
          signal: controller.signal,
        },
      );
      if (operation.action === 'enroll') parseProtectedAccessEnrollment(raw);
      else parseProtectedAccessWithdrawal(raw);
      mutationConfirmed = true;
      clearOperation(operation);
      if (operation.action === 'enroll') {
        setEnrollmentAcceptance((current) => ({
          ...current,
          [operation.householdId]: false,
        }));
      } else {
        setWithdrawalAcknowledgment((current) => ({
          ...current,
          [operation.householdId]: false,
        }));
      }
      let refreshedStatus: ProtectedSelfEnrollmentStatusResponse | undefined;
      if (attemptIsCurrent(attempt)) {
        statusAbortRef.current?.abort();
        const statusController = new AbortController();
        statusAbortRef.current = statusController;
        refreshedStatus = await loadStatus(
          operation.householdId,
          attempt.householdGeneration,
          statusController,
        );
      }
      let principalRefreshFailed = false;
      try {
        await refreshPrincipalAfterMutation(operation.householdId);
      } catch {
        principalRefreshFailed = true;
      }
      if (attemptIsCurrent(attempt)) {
        if (refreshedStatus) {
          setAnnouncementState({
            householdId: operation.householdId,
            value: protectedAccessTruthAnnouncement(operation.action, refreshedStatus),
          });
        }
        if (!refreshedStatus) {
          setErrorState({
            householdId: operation.householdId,
            value:
              'The request returned, but current protected-adult access could not be confirmed. Refresh status before continuing.',
          });
        } else if (principalRefreshFailed) {
          setErrorState({
            householdId: operation.householdId,
            value:
              'Current protected-adult status is confirmed, but account access could not be refreshed. Refresh status before continuing.',
          });
        }
      }
    } catch (caught) {
      if (mutationConfirmed) return;
      const definitive =
        caught instanceof MobileCustomerError &&
        isDefinitiveProtectedAccessMutationFailure(caught.status);
      if (definitive) clearOperation(operation);
      if (!attemptIsCurrent(attempt)) return;
      setErrorState({
        householdId: operation.householdId,
        value: definitive
          ? readableError(caught)
          : `${readableError(caught)} The outcome is uncertain. Retry the exact same request safely.`,
      });
      if (definitive) {
        beginStatusLoad(operation.householdId, attempt.householdGeneration);
      }
    } finally {
      if (actionAbortRef.current === controller) actionAbortRef.current = undefined;
      setBusyAttempt((current) =>
        current?.operationKey === attempt.operationKey ? undefined : current,
      );
    }
  }

  function enrollSelf(): void {
    if (!selectedHouseholdId || !status || actionAbortRef.current !== undefined) return;
    if (!pendingEnroll && !enrollmentAccepted) return;
    try {
      const operation =
        pendingEnroll ??
        createProtectedAccessEnrollmentOperation(selectedHouseholdId, status, Crypto.randomUUID());
      setOperations((current) => ({
        ...current,
        [protectedAccessOperationSlot(selectedHouseholdId, 'enroll')]: operation,
      }));
      void submitOperation(operation);
    } catch (caught) {
      setErrorState({ householdId: selectedHouseholdId, value: readableError(caught) });
    }
  }

  function withdrawSelf(): void {
    if (!selectedHouseholdId || !status || actionAbortRef.current !== undefined) return;
    if (!pendingWithdraw && !withdrawalAcknowledged) return;
    try {
      const operation =
        pendingWithdraw ??
        createProtectedAccessWithdrawalOperation(selectedHouseholdId, status, Crypto.randomUUID());
      setOperations((current) => ({
        ...current,
        [protectedAccessOperationSlot(selectedHouseholdId, 'withdraw')]: operation,
      }));
      void submitOperation(operation);
    } catch (caught) {
      setErrorState({ householdId: selectedHouseholdId, value: readableError(caught) });
    }
  }

  const reviewedConsent = pendingEnroll?.reviewedConsent ?? status?.consent;
  const canContinueOrientation =
    status?.enrollment.effectiveAccess === true &&
    selectedScope?.isProtectedMember === true &&
    selectedScope.capabilities.includes('orientation:use');
  const canOpenCheck =
    status?.enrollment.effectiveAccess === true &&
    selectedScope?.isProtectedMember === true &&
    (selectedScope.capabilities.includes('check:text') ||
      selectedScope.capabilities.includes('check:url'));

  return (
    <Screen>
      <Text style={s.pill}>Your consent</Text>
      <Text accessibilityRole="header" style={s.title}>
        Protected-adult access
      </Text>
      <Text style={s.body}>
        Review and choose protected-adult access for yourself in{' '}
        <Text style={s.label}>{selectedHouseholdName || 'the selected household'}</Text>. Paying for
        or managing a household never lets someone make this choice for another adult.
      </Text>
      <View style={s.banner}>
        <Text style={s.label}>No purchase or message</Text>
        <Text style={s.muted}>
          This screen does not charge a card, buy or change a plan, invite anyone, or send a
          message. It changes only your own protected-adult consent in the selected household.
        </Text>
      </View>
      {announcement ? (
        <Text accessibilityLiveRegion="polite" style={s.body}>
          {announcement}
        </Text>
      ) : null}
      {actionError ? <ErrorText message={actionError} /> : null}

      {!selectedHouseholdId ? (
        <View style={s.card}>
          <Text style={s.heading}>A household is required</Text>
          <Text style={s.body}>
            Join a household before choosing protected-adult access for yourself.
          </Text>
          <ActionButton
            kind="secondary"
            title="Return home"
            onPress={() => navigation.navigate('Home')}
          />
        </View>
      ) : visibleStatusState?.status === 'error' ? (
        <View style={s.card}>
          <ErrorText message={visibleStatusState.message} />
          <ActionButton
            kind="secondary"
            title="Try loading protected access again"
            onPress={() => {
              setErrorState(undefined);
              beginStatusLoad(selectedHouseholdId, householdGenerationRef.current);
            }}
          />
        </View>
      ) : !status ? (
        <Loading label="Checking your protected-adult access..." />
      ) : (
        <>
          <View style={s.card} accessibilityLiveRegion="polite">
            <Text style={s.heading}>Current status</Text>
            {status.enrollment.state === 'enrolled' ? (
              <>
                <Text style={s.body}>
                  <Text style={s.label}>Enrolled for this household. </Text>
                  {status.enrollment.effectiveAccess
                    ? "Protected-adult features are available under the household's current access."
                    : 'Your enrollment remains recorded, but protected-adult features are unavailable while household access is inactive.'}
                </Text>
                <Text style={s.muted}>
                  Recorded consent version: {status.enrollment.consentVersion}
                </Text>
              </>
            ) : (
              <Text style={s.body}>
                <Text style={s.label}>Not enrolled. </Text>
                {protectedAccessEligibilityMessage[status.eligibility]}
              </Text>
            )}
            <ActionButton
              kind="secondary"
              title="Refresh status"
              disabled={busy !== ''}
              onPress={() => {
                setErrorState(undefined);
                beginStatusLoad(selectedHouseholdId, householdGenerationRef.current);
              }}
            />
          </View>

          {status.enrollment.state === 'not_enrolled' && reviewedConsent ? (
            <View style={s.card}>
              <Text style={s.heading}>Review before enrolling</Text>
              <Text style={s.muted}>Consent version: {reviewedConsent.version}</Text>
              <View
                accessibilityLabel={`Protected-adult disclosure ${reviewedConsent.disclosure.version}`}
                style={s.banner}
              >
                <Text style={s.label}>What enrollment does</Text>
                <Text style={s.body}>{reviewedConsent.disclosure.text}</Text>
                <Text style={s.muted}>
                  Disclosure version: {reviewedConsent.disclosure.version}
                </Text>
              </View>
              <View
                accessibilityLabel={`Protected-adult policy ${reviewedConsent.policy.version}`}
                style={s.banner}
              >
                <Text style={s.label}>Consent and withdrawal policy</Text>
                <Text style={s.body}>{reviewedConsent.policy.text}</Text>
                <Text style={s.muted}>Policy version: {reviewedConsent.policy.version}</Text>
              </View>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="I choose protected-adult access for myself in this exact household and accept the disclosure and policy shown"
                accessibilityState={{
                  checked: enrollmentAccepted,
                  disabled: busy !== '' || pendingEnroll !== undefined,
                }}
                disabled={busy !== '' || pendingEnroll !== undefined}
                onPress={() =>
                  setEnrollmentAcceptance((current) => ({
                    ...current,
                    [selectedHouseholdId]: !enrollmentAccepted,
                  }))
                }
                style={[s.choice, enrollmentAccepted && s.choiceSelected]}
              >
                <View style={[s.radio, enrollmentAccepted && s.radioSelected]} />
                <Text style={s.body}>
                  I am choosing protected-adult access for myself in this exact household, and I
                  accept the disclosure and policy shown above.
                </Text>
              </Pressable>
              {pendingEnroll ? (
                <Text accessibilityLiveRegion="polite" style={s.muted}>
                  The previous result was uncertain. Retry reuses the exact household, consent
                  versions, evidence fingerprints, request body, and idempotency key you already
                  reviewed.
                </Text>
              ) : null}
              <ActionButton
                title={
                  busy === 'enroll'
                    ? 'Recording consent...'
                    : pendingEnroll
                      ? 'Retry exact enrollment request'
                      : 'Enroll myself'
                }
                disabled={
                  busy !== '' ||
                  (!pendingEnroll && (!enrollmentAccepted || status.eligibility !== 'available'))
                }
                accessibilityHint="Records protected-adult consent only for your account in the selected household"
                onPress={enrollSelf}
              />
              <Text style={s.muted}>
                This does not charge a card, change the subscription, invite anyone, or enroll
                another person.
              </Text>
            </View>
          ) : status.enrollment.state === 'enrolled' ? (
            <>
              <View style={s.card}>
                <Text style={s.heading}>Continue your safety setup</Text>
                {status.enrollment.effectiveAccess ? (
                  <View style={s.navGrid}>
                    {canContinueOrientation ? (
                      <ActionButton
                        title="Continue orientation"
                        onPress={() => navigation.navigate('Orientation')}
                      />
                    ) : null}
                    {canOpenCheck ? (
                      <ActionButton
                        kind="secondary"
                        title="Open Check"
                        onPress={() => navigation.navigate('Check')}
                      />
                    ) : null}
                  </View>
                ) : (
                  <Text style={s.body}>
                    Protected features remain unavailable until this household has effective access.
                    Your recorded consent can still be withdrawn below.
                  </Text>
                )}
              </View>
              <View style={s.card}>
                <Text style={s.heading}>Withdraw protected-adult consent</Text>
                <Text style={s.body}>
                  Withdrawal ends your own protected-adult access in this household and releases
                  your seat. It does not cancel billing, remove your household membership, delete
                  Check records, or change another person&apos;s consent.
                </Text>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel="I understand the effects and want to withdraw my own protected-adult consent"
                  accessibilityState={{
                    checked: withdrawalAcknowledged,
                    disabled: busy !== '' || pendingWithdraw !== undefined,
                  }}
                  disabled={busy !== '' || pendingWithdraw !== undefined}
                  onPress={() =>
                    setWithdrawalAcknowledgment((current) => ({
                      ...current,
                      [selectedHouseholdId]: !withdrawalAcknowledged,
                    }))
                  }
                  style={[s.choice, withdrawalAcknowledged && s.choiceSelected]}
                >
                  <View style={[s.radio, withdrawalAcknowledged && s.radioSelected]} />
                  <Text style={s.body}>
                    I understand these effects and want to withdraw my own protected-adult consent.
                  </Text>
                </Pressable>
                {pendingWithdraw ? (
                  <Text accessibilityLiveRegion="polite" style={s.muted}>
                    The previous result was uncertain. Retry reuses the exact household,
                    acknowledgment, request body, and idempotency key.
                  </Text>
                ) : null}
                <ActionButton
                  kind="danger"
                  title={
                    busy === 'withdraw'
                      ? 'Withdrawing consent...'
                      : pendingWithdraw
                        ? 'Retry exact withdrawal request'
                        : 'Withdraw my consent'
                  }
                  disabled={busy !== '' || (!pendingWithdraw && !withdrawalAcknowledged)}
                  accessibilityHint="Withdraws only your protected-adult consent in the selected household"
                  onPress={withdrawSelf}
                />
              </View>
            </>
          ) : null}
        </>
      )}
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
      <View style={s.card}>
        <Text style={s.heading}>Optional on-device weekly reminder</Text>
        <Text style={s.body}>
          The app can schedule generic weekly practice text on the device after a member opts in. It
          does not request a push token or include a Check, person, household, message, or link.
          Permission denial and cancellation are implemented, but lock-screen delivery is not yet
          verified across supported iOS and Android devices.
        </Text>
      </View>
      <View style={s.banner}>
        <Text style={s.label}>Still outside this proof</Text>
        <Text style={s.muted}>
          Remote push notifications, contacts, clipboard reads, background monitoring, and automatic
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
  const { principal, selectedHouseholdId, selectedScope } = useMobileHousehold();
  const isProtectedMember = selectedScope?.isProtectedMember === true;
  const [shareTargetsState, setShareTargetsState] = useState<{
    readonly householdId: string;
    readonly checkId: string;
    readonly status: 'ready' | 'error';
    readonly targets?: FamilyResponse['relationships'];
    readonly message?: string;
  }>();
  const [shareTargetsReloadVersion, setShareTargetsReloadVersion] = useState(0);
  const [shareLifecycles, setShareLifecycles] = useState<CheckShareLifecycle[]>([]);
  const [sharingWith, setSharingWith] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const [shareActionError, setShareActionError] = useState('');
  const [shareLifecycleError, setShareLifecycleError] = useState('');
  const [shareLifecycleLoading, setShareLifecycleLoading] = useState(false);
  const visibleShareTargetsState =
    shareTargetsState?.householdId === selectedHouseholdId && shareTargetsState.checkId === check.id
      ? shareTargetsState
      : undefined;
  const shareTargets = visibleShareTargetsState?.targets;
  useEffect(() => {
    let active = true;
    if (!isProtectedMember || !check.access.canShare || check.householdId !== selectedHouseholdId)
      return;
    Promise.all([mobileRequest<FamilyResponse>('/v1/family'), mobileRequest<MeResponse>('/v1/me')])
      .then(([family, me]) => {
        if (!active) return;
        setShareTargetsState({
          householdId: selectedHouseholdId,
          checkId: check.id,
          status: 'ready',
          targets: family.relationships.filter(
            (relationship) =>
              relationship.state === 'active' &&
              relationship.permissions.includes('view_shared_checks') &&
              relationship.protectedPersonId === me.principal.personId,
          ),
        });
      })
      .catch((caught) => {
        if (active) {
          setShareTargetsState({
            householdId: selectedHouseholdId,
            checkId: check.id,
            status: 'error',
            message: readableError(caught),
          });
        }
      });
    return () => {
      active = false;
    };
  }, [
    check.access.canShare,
    check.householdId,
    check.id,
    isProtectedMember,
    selectedHouseholdId,
    shareTargetsReloadVersion,
  ]);
  const loadShareLifecycles = useCallback(async () => {
    if (check.householdId !== selectedHouseholdId) return;
    await Promise.resolve();
    setShareLifecycleLoading(true);
    setShareLifecycleError('');
    try {
      const response = await mobileRequest<CheckShareListResponse>(
        `/v1/checks/${encodeURIComponent(check.id)}/shares`,
      );
      setShareLifecycles(response.shares);
    } catch (caught) {
      setShareLifecycles([]);
      setShareLifecycleError(readableError(caught));
    } finally {
      setShareLifecycleLoading(false);
    }
  }, [check.householdId, check.id, selectedHouseholdId]);
  useEffect(() => {
    void Promise.resolve().then(loadShareLifecycles);
  }, [loadShareLifecycles]);
  function replaceShareLifecycle(next: CheckShareLifecycle) {
    setShareLifecycles((current) => [
      ...current.filter(
        (share) =>
          !(share.checkId === next.checkId && share.sharedWithPersonId === next.sharedWithPersonId),
      ),
      next,
    ]);
  }
  async function shareResult(personId: string, displayName: string) {
    setSharingWith(personId);
    setShareStatus('');
    setShareActionError('');
    try {
      const response = await mobileRequest<{ lifecycle: CheckShareLifecycle }>(
        `/v1/checks/${encodeURIComponent(check.id)}/shares`,
        {
          method: 'POST',
          body: JSON.stringify({ sharedWithPersonId: personId }),
        },
      );
      replaceShareLifecycle(response.lifecycle);
      setShareStatus(
        `Redacted result shared with ${displayName} in BoomerBuddy. No notification was sent and submitted content was not included.`,
      );
    } catch (caught) {
      setShareActionError(readableError(caught));
    } finally {
      setSharingWith('');
    }
  }
  async function acknowledgeSharedResult() {
    setSharingWith(principal.personId);
    setShareStatus('');
    setShareActionError('');
    try {
      const response = await mobileRequest<{ share: CheckShareLifecycle }>(
        `/v1/checks/${encodeURIComponent(check.id)}/share-acknowledgement`,
        { method: 'POST', body: '{}' },
      );
      replaceShareLifecycle(response.share);
      setShareStatus(
        'You confirmed that you reviewed this redacted result. No notification or message was sent.',
      );
    } catch (caught) {
      setShareActionError(readableError(caught));
    } finally {
      setSharingWith('');
    }
  }
  async function closeSharedResult(
    personId: string,
    resolution: 'safer_action_completed' | 'no_longer_needs_help',
  ) {
    setSharingWith(personId);
    setShareStatus('');
    setShareActionError('');
    try {
      const response = await mobileRequest<{ share: CheckShareLifecycle }>(
        `/v1/checks/${encodeURIComponent(check.id)}/shares/${encodeURIComponent(personId)}/closure`,
        { method: 'POST', body: JSON.stringify({ resolution }) },
      );
      replaceShareLifecycle(response.share);
      setShareStatus(
        resolution === 'safer_action_completed'
          ? 'Shared-result follow-up closed after a safer action was completed.'
          : 'Shared-result follow-up closed because help is no longer needed.',
      );
    } catch (caught) {
      setShareActionError(readableError(caught));
    } finally {
      setSharingWith('');
    }
  }
  const receivedShare = shareLifecycles.find(
    (share) => share.sharedWithPersonId === principal.personId,
  );
  if (check.householdId !== selectedHouseholdId) {
    return (
      <Screen>
        <Text accessibilityRole="header" style={s.title}>
          Choose the result&apos;s household
        </Text>
        <Text style={s.body}>
          This result belongs to a different household than the one currently selected. BoomerBuddy
          hid it instead of showing one household&apos;s result under another household&apos;s name.
        </Text>
        <ActionButton title="Return Home" onPress={() => navigation.navigate('Home')} />
      </Screen>
    );
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
      {shareStatus ? (
        <Text accessibilityLiveRegion="polite" style={s.body}>
          {shareStatus}
        </Text>
      ) : null}
      {shareActionError ? <ErrorText message={shareActionError} /> : null}
      {shareLifecycleError ? (
        <View style={s.card}>
          <ErrorText message={shareLifecycleError} />
          <ActionButton
            kind="secondary"
            title="Retry shared-result status"
            disabled={shareLifecycleLoading}
            onPress={() => void loadShareLifecycles()}
          />
        </View>
      ) : null}
      {check.access.kind === 'shared' ? (
        <View style={s.card}>
          <Text style={s.heading}>Confirm you reviewed this result</Text>
          <Text style={s.body}>
            Acknowledgement records only that you reviewed this redacted result. It does not send a
            message, reveal submitted content, or say that an action was completed.
          </Text>
          {shareLifecycleLoading ? (
            <Loading label="Loading shared-result follow-up…" />
          ) : receivedShare?.state === 'shared' ? (
            <ActionButton
              title={sharingWith ? 'Saving acknowledgement…' : 'I reviewed this result'}
              disabled={Boolean(sharingWith)}
              onPress={() => void acknowledgeSharedResult()}
            />
          ) : receivedShare?.state === 'acknowledged' ? (
            <Text accessibilityLiveRegion="polite" style={s.body}>
              Review acknowledged. The person who shared it can now close the follow-up.
            </Text>
          ) : receivedShare?.state === 'closed' ? (
            <Text style={s.body}>This shared-result follow-up is closed.</Text>
          ) : (
            <Text style={s.muted}>
              Acknowledgement is unavailable until current share permission is verified.
            </Text>
          )}
        </View>
      ) : null}
      {isProtectedMember && check.access.canShare && check.householdId === selectedHouseholdId ? (
        <View style={s.card}>
          <Text style={s.heading}>Share this redacted result</Text>
          <Text style={s.body}>
            Eligible Trusted Circle people receive the summary, warning signs, and safer actions
            only. Submitted text or URLs are excluded, and no notification is sent.
          </Text>
          {!visibleShareTargetsState ? (
            <Loading label="Loading eligible Trusted Circle people…" />
          ) : visibleShareTargetsState.status === 'error' ? (
            <View style={s.card}>
              <ErrorText
                message={
                  visibleShareTargetsState.message ?? 'Trusted Circle people could not be loaded.'
                }
              />
              <ActionButton
                kind="secondary"
                title="Retry Trusted Circle people"
                onPress={() => {
                  setShareTargetsState(undefined);
                  setShareTargetsReloadVersion((current) => current + 1);
                }}
              />
            </View>
          ) : shareTargets?.length ? (
            shareTargets.map((target) => {
              const lifecycle = shareLifecycles.find(
                (share) => share.sharedWithPersonId === target.trustedPersonId,
              );
              return (
                <View key={target.id} style={s.card}>
                  <Text style={s.label}>{target.trustedDisplayName}</Text>
                  <Text style={s.muted}>
                    {lifecycle?.state === 'acknowledged'
                      ? 'They confirmed they reviewed this result.'
                      : lifecycle?.state === 'closed'
                        ? 'Follow-up is closed.'
                        : lifecycle?.state === 'shared'
                          ? 'Shared in BoomerBuddy; review has not been acknowledged.'
                          : 'This result has not been shared with them.'}
                  </Text>
                  {!lifecycle ? (
                    <ActionButton
                      kind="secondary"
                      title={
                        sharingWith === target.trustedPersonId
                          ? 'Sharing…'
                          : `Share with ${target.trustedDisplayName}`
                      }
                      disabled={Boolean(sharingWith) || Boolean(shareLifecycleError)}
                      onPress={() =>
                        void shareResult(target.trustedPersonId, target.trustedDisplayName)
                      }
                    />
                  ) : canCloseSharedResult(lifecycle) ? (
                    <>
                      <Text style={s.body}>
                        Close this follow-up only after you have finished the next step together.
                      </Text>
                      <ActionButton
                        kind="secondary"
                        title="Close: safer action completed"
                        disabled={Boolean(sharingWith)}
                        onPress={() =>
                          void closeSharedResult(target.trustedPersonId, 'safer_action_completed')
                        }
                      />
                      <ActionButton
                        kind="secondary"
                        title="Close: help no longer needed"
                        disabled={Boolean(sharingWith)}
                        onPress={() =>
                          void closeSharedResult(target.trustedPersonId, 'no_longer_needs_help')
                        }
                      />
                    </>
                  ) : null}
                </View>
              );
            })
          ) : (
            <Text style={s.muted}>
              No one in your Trusted Circle currently has permission to view shared Checks.
            </Text>
          )}
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
  const [retryVersion, setRetryVersion] = useState(0);
  const selectedHistoryHouseholdIdRef = useRef(selectedHouseholdId);
  useLayoutEffect(() => {
    selectedHistoryHouseholdIdRef.current = selectedHouseholdId;
  }, [selectedHouseholdId]);
  const historyHouseholdGenerationRef = useRef(0);
  const historyContinuationRequestIdRef = useRef(0);
  const historyContinuationAbortRef = useRef<AbortController | undefined>(undefined);
  const canReadHistory =
    selectedScope?.capabilities.includes('history:read') === true &&
    (selectedScope.isProtectedMember ||
      selectedScope.trustedCircleGrants.some((grant) =>
        grant.permissions.includes('view_shared_checks'),
      ));
  useFocusEffect(
    useCallback(() => {
      void retryVersion;
      let active = true;
      const householdId = selectedHouseholdId;
      const householdGeneration = ++historyHouseholdGenerationRef.current;
      historyContinuationRequestIdRef.current += 1;
      historyContinuationAbortRef.current?.abort();
      historyContinuationAbortRef.current = undefined;
      setLoadingMore(false);
      setAnnouncement('');
      setConfirming('');
      const generationIsCurrent = (): boolean =>
        active &&
        selectedHistoryHouseholdIdRef.current === householdId &&
        historyHouseholdGenerationRef.current === householdGeneration;
      if (!canReadHistory) {
        setChecks([]);
        setHasMore(false);
        setNextOffset(0);
        setTotal(0);
        setLoadedHouseholdId(householdId);
        setLoading(false);
        setError('History is unavailable for this household.');
        return () => {
          active = false;
          if (historyHouseholdGenerationRef.current === householdGeneration) {
            historyHouseholdGenerationRef.current += 1;
          }
        };
      }
      const controller = new AbortController();
      setLoading(true);
      setError('');
      void mobileRequest<CheckListResponse>('/v1/checks?limit=50&offset=0', {
        headers: { 'X-BB-Household-Id': householdId },
        signal: controller.signal,
      })
        .then((response) => {
          if (!generationIsCurrent()) return;
          setChecks(response.checks);
          setHasMore(response.page.hasMore);
          setNextOffset(response.page.offset + response.checks.length);
          setTotal(response.total);
          setLoadedHouseholdId(householdId);
        })
        .catch((caught) => {
          if (controller.signal.aborted || !generationIsCurrent()) return;
          setChecks([]);
          setHasMore(false);
          setLoadedHouseholdId(householdId);
          setError(readableError(caught));
        })
        .finally(() => {
          if (generationIsCurrent()) setLoading(false);
        });
      return () => {
        active = false;
        controller.abort();
        if (historyHouseholdGenerationRef.current === householdGeneration) {
          historyHouseholdGenerationRef.current += 1;
        }
        historyContinuationRequestIdRef.current += 1;
        historyContinuationAbortRef.current?.abort();
        historyContinuationAbortRef.current = undefined;
      };
    }, [canReadHistory, retryVersion, selectedHouseholdId]),
  );
  async function loadMore() {
    if (loadingMore || !hasMore || loadedHouseholdId !== selectedHouseholdId) return;
    const continuation: HistoryContinuation = {
      householdId: selectedHouseholdId,
      householdGeneration: historyHouseholdGenerationRef.current,
      requestId: ++historyContinuationRequestIdRef.current,
      offset: nextOffset,
    };
    historyContinuationAbortRef.current?.abort();
    const controller = new AbortController();
    historyContinuationAbortRef.current = controller;
    const continuationIsCurrent = (): boolean =>
      historyContinuationIsCurrent(continuation, {
        householdId: selectedHistoryHouseholdIdRef.current,
        householdGeneration: historyHouseholdGenerationRef.current,
        requestId: historyContinuationRequestIdRef.current,
      });
    setLoadingMore(true);
    setError('');
    try {
      const response = await mobileRequest<CheckListResponse>(
        `/v1/checks?limit=50&offset=${continuation.offset}`,
        {
          headers: { 'X-BB-Household-Id': continuation.householdId },
          signal: controller.signal,
        },
      );
      if (!continuationIsCurrent()) return;
      if (response.page.offset !== continuation.offset) {
        throw new MobileCustomerError('History changed while loading. Please try again.');
      }
      setChecks((current) =>
        mergeHistoryContinuation(current, response.checks, response.page.offset, continuation, {
          householdId: selectedHistoryHouseholdIdRef.current,
          householdGeneration: historyHouseholdGenerationRef.current,
          requestId: historyContinuationRequestIdRef.current,
        }),
      );
      setHasMore((current) => (continuationIsCurrent() ? response.page.hasMore : current));
      setNextOffset((current) =>
        continuationIsCurrent() ? response.page.offset + response.checks.length : current,
      );
      setTotal((current) => (continuationIsCurrent() ? response.total : current));
      setAnnouncement((current) =>
        continuationIsCurrent() ? `Loaded ${response.checks.length} more check records.` : current,
      );
    } catch (caught) {
      if (controller.signal.aborted || !continuationIsCurrent()) return;
      setError(readableError(caught));
    } finally {
      if (continuationIsCurrent()) {
        historyContinuationAbortRef.current = undefined;
        setLoadingMore(false);
      }
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
  if (!canReadHistory) {
    return (
      <Screen>
        <Text accessibilityRole="header" style={s.title}>
          History unavailable in this household
        </Text>
        <Text style={s.body}>
          An enrolled protected adult can see their own History. A Trusted Circle person can see
          only redacted results that were deliberately shared with them.
        </Text>
      </Screen>
    );
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
      {error && checks.length > 0 ? <ErrorText message={error} /> : null}
      {loading || loadedHouseholdId !== selectedHouseholdId ? (
        <Loading label="Loading history…" />
      ) : error ? (
        <View style={s.card}>
          <ErrorText message={error} />
          <ActionButton
            kind="secondary"
            title="Retry History"
            onPress={() => {
              setError('');
              setLoading(true);
              setRetryVersion((current) => current + 1);
            }}
          />
        </View>
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
type FamilyScreenStatus =
  | { readonly scope: 'invitation'; readonly message: string }
  | { readonly scope: 'household'; readonly householdId: string; readonly message: string };

type NeutralMembershipAttempt = {
  readonly householdId: string;
  readonly householdGeneration: number;
  readonly requestId: number;
};

export function FamilyScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Family'>): React.ReactElement {
  const { principal, selectedHouseholdId, selectedScope, replacePrincipal } = useMobileHousehold();
  const [familyState, dispatchFamily] = useReducer(
    householdResourceReducer<FamilyResponse>,
    emptyHouseholdResource<FamilyResponse>(),
  );
  const selectedHouseholdIdRef = useRef(selectedHouseholdId);
  const householdGenerationRef = useRef(0);
  useLayoutEffect(() => {
    selectedHouseholdIdRef.current = selectedHouseholdId;
    householdGenerationRef.current += 1;
  }, [selectedHouseholdId]);
  const familyRequestIdRef = useRef(0);
  const [errorState, setErrorState] = useState<HouseholdBoundDraft<string>>();
  const [busy, setBusy] = useState(false);
  const [inviteeNameDraft, setInviteeNameDraft] = useState<HouseholdBoundDraft<string>>();
  const [recipientConnectionCodeDraft, setRecipientConnectionCodeDraft] =
    useState<HouseholdBoundDraft<string>>();
  const [memberRecipientConnectionCodeDraft, setMemberRecipientConnectionCodeDraft] =
    useState<HouseholdBoundDraft<string>>();
  const [ownConnectionCode, setOwnConnectionCode] =
    useState<CreateRecipientConnectionCodeResponse>();
  const [createdForHousehold, setCreatedForHousehold] = useState<{
    readonly householdId: string;
    readonly value: CreateInvitationResponse;
  }>();
  const [createdMemberInvitationForHousehold, setCreatedMemberInvitationForHousehold] = useState<{
    readonly householdId: string;
    readonly value: CreateHouseholdMemberInvitationResponse;
  }>();
  const [memberInvitationId, setMemberInvitationId] = useState('');
  const [memberInvitationCredential, setMemberInvitationCredential] = useState('');
  const [memberInvitationReview, setMemberInvitationReview] = useState<{
    readonly invitationId: string;
    readonly invitationCredential: string;
    readonly value: HouseholdMemberInvitationPreviewResponse;
  }>();
  const memberInvitationReviewRequestIdRef = useRef(0);
  const memberInvitationReviewAbortRef = useRef<AbortController | undefined>(undefined);
  const [memberConsentConfirmed, setMemberConsentConfirmed] = useState(false);
  const [acceptedNeutralMembershipHouseholdId, setAcceptedNeutralMembershipHouseholdId] =
    useState('');
  const [invitationId, setInvitationId] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [invitationReviewState, dispatchInvitationReview] = useReducer(
    invitationReviewReducer<InvitationPreviewResponse>,
    emptyInvitationReview<InvitationPreviewResponse>(),
  );
  const invitationReviewRequestIdRef = useRef(0);
  const invitationReviewAbortRef = useRef<AbortController | undefined>(undefined);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [confirmingInvitation, setConfirmingInvitation] = useState<{
    readonly householdId: string;
    readonly invitationId: string;
  }>();
  const [confirmingMemberInvitation, setConfirmingMemberInvitation] = useState<{
    readonly householdId: string;
    readonly invitationId: string;
  }>();
  const [confirmingMembership, setConfirmingMembership] = useState<{
    readonly householdId: string;
    readonly familyRequestId: number;
    readonly membershipId: string;
  }>();
  const membershipMutationRequestIdRef = useRef(0);
  const membershipMutationAbortRef = useRef<AbortController | undefined>(undefined);
  const [confirmingRelationship, setConfirmingRelationship] = useState<{
    readonly householdId: string;
    readonly relationshipId: string;
  }>();
  const [statusState, setStatusState] = useState<FamilyScreenStatus>();
  const [recentAuthenticationState, setRecentAuthenticationState] =
    useState<HouseholdBoundDraft<boolean>>();
  const error = householdBoundDraftValue(errorState, selectedHouseholdId) ?? '';
  const setError = (message: string): void => {
    setErrorState(message ? { householdId: selectedHouseholdId, value: message } : undefined);
  };
  const recentAuthenticationRequired =
    householdBoundDraftValue(recentAuthenticationState, selectedHouseholdId) ?? false;
  const clearMutationError = (): void => {
    setError('');
    setRecentAuthenticationState(undefined);
  };
  const setMutationError = (caught: unknown): void => {
    setError(readableError(caught));
    if (requiresRecentAuthentication(caught)) {
      setRecentAuthenticationState({ householdId: selectedHouseholdId, value: true });
    }
  };
  const inviteeName = householdBoundDraftValue(inviteeNameDraft, selectedHouseholdId) ?? '';
  const recipientConnectionCode =
    householdBoundDraftValue(recipientConnectionCodeDraft, selectedHouseholdId) ?? '';
  const memberRecipientConnectionCode =
    householdBoundDraftValue(memberRecipientConnectionCodeDraft, selectedHouseholdId) ?? '';
  const reviewedInvitation: Extract<
    InvitationReviewState<InvitationPreviewResponse>,
    { status: 'ready' }
  > | null = invitationReviewState.status === 'ready' ? invitationReviewState : null;
  const preview = reviewedInvitation?.value;
  const created =
    createdForHousehold?.householdId === selectedHouseholdId
      ? createdForHousehold.value
      : undefined;
  const createdMemberInvitation =
    createdMemberInvitationForHousehold?.householdId === selectedHouseholdId
      ? createdMemberInvitationForHousehold.value
      : undefined;
  const confirmingInvitationId =
    confirmingInvitation?.householdId === selectedHouseholdId
      ? confirmingInvitation.invitationId
      : '';
  const confirmingMemberInvitationId =
    confirmingMemberInvitation?.householdId === selectedHouseholdId
      ? confirmingMemberInvitation.invitationId
      : '';
  const confirmingMembershipId =
    confirmingMembership?.householdId === selectedHouseholdId &&
    familyState.status === 'ready' &&
    familyState.householdId === selectedHouseholdId &&
    confirmingMembership.familyRequestId === familyState.requestId
      ? confirmingMembership.membershipId
      : '';
  const confirmingRelationshipId =
    confirmingRelationship?.householdId === selectedHouseholdId
      ? confirmingRelationship.relationshipId
      : '';
  const status =
    statusState?.scope === 'invitation' || statusState?.householdId === selectedHouseholdId
      ? statusState.message
      : '';
  useEffect(
    () => () => {
      invitationReviewRequestIdRef.current += 1;
      invitationReviewAbortRef.current?.abort();
      invitationReviewAbortRef.current = undefined;
      memberInvitationReviewRequestIdRef.current += 1;
      memberInvitationReviewAbortRef.current?.abort();
      memberInvitationReviewAbortRef.current = undefined;
      membershipMutationRequestIdRef.current += 1;
      membershipMutationAbortRef.current?.abort();
      membershipMutationAbortRef.current = undefined;
    },
    [],
  );
  useEffect(() => {
    membershipMutationRequestIdRef.current += 1;
    membershipMutationAbortRef.current?.abort();
    membershipMutationAbortRef.current = undefined;
  }, [selectedHouseholdId]);
  const load = useCallback(async (householdId: string, signal?: AbortSignal) => {
    if (!householdId || selectedHouseholdIdRef.current !== householdId) return false;
    const requestId = ++familyRequestIdRef.current;
    dispatchFamily({ type: 'started', householdId, requestId });
    try {
      const familyResponse = await mobileRequest<FamilyResponse>('/v1/family', {
        headers: { 'X-BB-Household-Id': householdId },
        ...(signal === undefined ? {} : { signal }),
      });
      if (selectedHouseholdIdRef.current !== householdId) return false;
      dispatchFamily({ type: 'succeeded', householdId, requestId, value: familyResponse });
      return true;
    } catch (caught) {
      if (signal?.aborted || selectedHouseholdIdRef.current !== householdId) return false;
      dispatchFamily({
        type: 'failed',
        householdId,
        requestId,
        message: readableError(caught),
      });
      return false;
    }
  }, []);
  useEffect(() => {
    if (!selectedHouseholdId) {
      familyRequestIdRef.current += 1;
      dispatchFamily({ type: 'reset' });
      return;
    }
    const controller = new AbortController();
    void load(selectedHouseholdId, controller.signal);
    return () => controller.abort();
  }, [load, selectedHouseholdId]);
  const visibleFamilyState = householdResourceIsVisible(familyState, selectedHouseholdId)
    ? familyState
    : undefined;
  const family = visibleFamilyState?.status === 'ready' ? visibleFamilyState.value : undefined;
  const currentHouseholdScope =
    selectedScope?.id === family?.household.id ? selectedScope : undefined;
  const isHouseholdAdministrator = currentHouseholdScope?.isAdministrator === true;
  const isProtectedMember =
    currentHouseholdScope?.isProtectedMember === true &&
    currentHouseholdScope.capabilities.includes('family:manage');
  const protectedSelfCanUseSafeWord =
    currentHouseholdScope?.isProtectedMember === true &&
    family?.members.some(
      (member) =>
        member.status === 'active' &&
        member.isProtectedMember &&
        member.personId === principal.personId,
    );
  const trustedPersonCanUseSafeWord = family?.relationships.some(
    (relationship) =>
      relationship.state === 'active' &&
      relationship.trustedPersonId === principal.personId &&
      family.members.some(
        (member) =>
          member.status === 'active' &&
          member.isProtectedMember &&
          member.personId === relationship.protectedPersonId,
      ),
  );
  function memberHasActiveTrustedRole(personId: string): boolean {
    return (
      family?.relationships.some(
        (relationship) =>
          relationship.state === 'active' &&
          (relationship.protectedPersonId === personId ||
            relationship.trustedPersonId === personId),
      ) ?? false
    );
  }
  function canRemoveNeutralMembership(member: FamilyResponse['members'][number]): boolean {
    const removingSelf = member.personId === principal.personId;
    const selectedSelfHasAnotherRole =
      removingSelf &&
      (currentHouseholdScope?.isPayer === true ||
        currentHouseholdScope?.isBillingManager === true ||
        (currentHouseholdScope?.trustedCircleGrants.length ?? 0) > 0);
    return (
      member.status === 'active' &&
      !member.isAdministrator &&
      !member.isProtectedMember &&
      !memberHasActiveTrustedRole(member.personId) &&
      !selectedSelfHasAnotherRole &&
      (isHouseholdAdministrator || removingSelf)
    );
  }
  async function generateRecipientConnectionCode() {
    setBusy(true);
    setError('');
    try {
      const response = await mobileRequest<CreateRecipientConnectionCodeResponse>(
        '/v1/family/recipient-connection-codes',
        { method: 'POST', body: '{}' },
      );
      setOwnConnectionCode(response);
      setStatusState({
        scope: 'invitation',
        message:
          'One-time connection code created. It grants no access by itself and is not sent automatically.',
      });
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }
  async function shareRecipientConnectionCode() {
    if (!ownConnectionCode) return;
    setError('');
    try {
      const outcome = await Share.share({
        message: [
          'Use this one-time BoomerBuddy connection code to invite this signed-in account:',
          ownConnectionCode.recipientConnectionCode,
          `Expires ${new Date(ownConnectionCode.expiresAt).toLocaleString()}.`,
        ].join('\n'),
      });
      setStatusState({
        scope: 'invitation',
        message:
          outcome.action === Share.sharedAction
            ? 'Your device share sheet completed. BoomerBuddy did not choose a recipient or send a message.'
            : 'Share sheet closed. BoomerBuddy did not send anything.',
      });
    } catch (caught) {
      setError(readableError(caught));
    }
  }
  async function createMemberInvitation() {
    const householdId = selectedHouseholdId;
    if (!householdId) return;
    setBusy(true);
    clearMutationError();
    setCreatedMemberInvitationForHousehold(undefined);
    try {
      const response = await mobileRequest<CreateHouseholdMemberInvitationResponse>(
        '/v1/family/member-invitations',
        {
          method: 'POST',
          headers: { 'X-BB-Household-Id': householdId },
          body: JSON.stringify({
            recipientConnectionCode: memberRecipientConnectionCode.trim(),
          }),
        },
      );
      if (selectedHouseholdIdRef.current !== householdId) return;
      setCreatedMemberInvitationForHousehold({ householdId, value: response });
      setMemberRecipientConnectionCodeDraft(undefined);
      setStatusState({
        scope: 'household',
        householdId,
        message: response.reused
          ? 'The existing neutral household membership invitation was recovered safely. It grants no protected-adult access.'
          : 'Neutral household membership invitation created. It grants no protected-adult access.',
      });
      await load(householdId);
    } catch (caught) {
      if (selectedHouseholdIdRef.current === householdId) setMutationError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function shareCreatedMemberInvitation() {
    if (!createdMemberInvitation) return;
    try {
      const outcome = await Share.share({
        message: [
          'BoomerBuddy household membership invitation',
          `Invitation ID: ${createdMemberInvitation.invitation.id}`,
          `Expires ${new Date(createdMemberInvitation.invitation.expiresAt).toLocaleString()}.`,
          'Use the same one-time connection code you created for this invitation. BoomerBuddy does not create or send a second credential.',
          'This invitation grants household membership only. Protected-adult enrollment is a separate choice.',
        ].join('\n'),
      });
      setStatusState({
        scope: 'household',
        householdId: selectedHouseholdId,
        message:
          outcome.action === Share.sharedAction
            ? 'Your device share sheet completed. BoomerBuddy did not choose a recipient or send a message.'
            : 'Share sheet closed. BoomerBuddy did not send anything.',
      });
    } catch (caught) {
      setError(readableError(caught));
    }
  }
  function invalidateMemberInvitationReview() {
    memberInvitationReviewRequestIdRef.current += 1;
    memberInvitationReviewAbortRef.current?.abort();
    memberInvitationReviewAbortRef.current = undefined;
    setMemberInvitationReview(undefined);
    setMemberConsentConfirmed(false);
  }
  async function reviewMemberInvitation() {
    const reviewedInvitationId = memberInvitationId.trim();
    const reviewedInvitationCredential = memberInvitationCredential.trim();
    const requestId = ++memberInvitationReviewRequestIdRef.current;
    memberInvitationReviewAbortRef.current?.abort();
    const controller = new AbortController();
    memberInvitationReviewAbortRef.current = controller;
    setBusy(true);
    setError('');
    setMemberInvitationReview(undefined);
    setMemberConsentConfirmed(false);
    try {
      const response = await mobileRequest<HouseholdMemberInvitationPreviewResponse>(
        `/v1/family/member-invitations/${encodeURIComponent(reviewedInvitationId)}/preview`,
        {
          method: 'POST',
          body: JSON.stringify({ invitationCredential: reviewedInvitationCredential }),
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted || memberInvitationReviewRequestIdRef.current !== requestId)
        return;
      if (response.invitation.id !== reviewedInvitationId) {
        throw new MobileCustomerError(
          'The household membership invitation did not match the credentials you entered.',
        );
      }
      setMemberInvitationReview({
        invitationId: reviewedInvitationId,
        invitationCredential: reviewedInvitationCredential,
        value: response,
      });
      setStatusState({
        scope: 'invitation',
        message: 'Household membership invitation ready to review. No access has been granted.',
      });
    } catch (caught) {
      if (controller.signal.aborted || memberInvitationReviewRequestIdRef.current !== requestId)
        return;
      setError(readableError(caught));
    } finally {
      if (memberInvitationReviewRequestIdRef.current === requestId) {
        memberInvitationReviewAbortRef.current = undefined;
        setBusy(false);
      }
    }
  }
  async function acceptMemberInvitation() {
    if (!memberInvitationReview || !memberConsentConfirmed) return;
    const reviewed = memberInvitationReview;
    const acceptedHouseholdId = reviewed.value.invitation.household.id;
    setBusy(true);
    clearMutationError();
    try {
      const response = await mobileRequest<AcceptHouseholdMemberInvitationResponse>(
        `/v1/family/member-invitations/${encodeURIComponent(reviewed.invitationId)}/accept`,
        {
          method: 'POST',
          body: JSON.stringify({
            invitationCredential: reviewed.invitationCredential,
            previewVersion: reviewed.value.invitation.previewVersion,
          }),
        },
      );
      if (response.membership.householdId !== acceptedHouseholdId) {
        throw new MobileCustomerError(
          'The accepted household did not match the membership invitation you reviewed.',
        );
      }
      invalidateMemberInvitationReview();
      setMemberInvitationId('');
      setMemberInvitationCredential('');
      const refreshedMe = await mobileRequest<MeResponse>('/v1/me');
      if (!refreshedMe.principal.households.some((scope) => scope.id === acceptedHouseholdId)) {
        throw new MobileCustomerError(
          'Membership was accepted, but the reviewed household is not available in this session.',
        );
      }
      const nextHouseholdId = replacePrincipal(refreshedMe.principal, acceptedHouseholdId);
      if (nextHouseholdId !== acceptedHouseholdId) {
        throw new MobileCustomerError('The reviewed household could not be selected safely.');
      }
      setAcceptedNeutralMembershipHouseholdId(acceptedHouseholdId);
      setStatusState({
        scope: 'invitation',
        message:
          'Household membership accepted. Protected-adult access remains a separate consent choice.',
      });
      await load(acceptedHouseholdId);
    } catch (caught) {
      setMutationError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function revokeMemberInvitation(id: string) {
    const householdId = selectedHouseholdId;
    if (!householdId) return;
    setBusy(true);
    clearMutationError();
    try {
      await mobileRequest(`/v1/family/member-invitations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'X-BB-Household-Id': householdId },
      });
      if (selectedHouseholdIdRef.current !== householdId) return;
      if (createdMemberInvitation?.invitation.id === id) {
        setCreatedMemberInvitationForHousehold(undefined);
      }
      setConfirmingMemberInvitation(undefined);
      setStatusState({
        scope: 'household',
        householdId,
        message: 'Pending household membership invitation revoked.',
      });
      await load(householdId);
    } catch (caught) {
      if (selectedHouseholdIdRef.current === householdId) setMutationError(caught);
    } finally {
      setBusy(false);
    }
  }
  function membershipMutationIsCurrent(
    attempt: NeutralMembershipAttempt,
    controller: AbortController,
  ): boolean {
    return (
      !controller.signal.aborted &&
      membershipMutationAbortRef.current === controller &&
      membershipMutationRequestIdRef.current === attempt.requestId &&
      householdGenerationRef.current === attempt.householdGeneration &&
      selectedHouseholdIdRef.current === attempt.householdId
    );
  }
  async function removeNeutralMembership(membershipId: string, removingSelf: boolean) {
    const householdId = selectedHouseholdId;
    const member = family?.members.find((candidate) => candidate.membershipId === membershipId);
    if (
      !householdId ||
      family?.household.id !== householdId ||
      member === undefined ||
      (member.personId === principal.personId) !== removingSelf ||
      !canRemoveNeutralMembership(member)
    ) {
      setConfirmingMembership(undefined);
      setError(
        'This membership still has another household role. End protected, Trusted Circle, administrator, payer, or billing authority first.',
      );
      return;
    }
    membershipMutationAbortRef.current?.abort();
    const controller = new AbortController();
    membershipMutationAbortRef.current = controller;
    const attempt: NeutralMembershipAttempt = {
      householdId,
      householdGeneration: householdGenerationRef.current,
      requestId: ++membershipMutationRequestIdRef.current,
    };
    let removalCommitted = false;
    setBusy(true);
    clearMutationError();
    try {
      await mobileRequest(`/v1/family/members/${encodeURIComponent(membershipId)}`, {
        method: 'DELETE',
        headers: { 'X-BB-Household-Id': householdId },
        signal: controller.signal,
      });
      removalCommitted = true;
      if (!membershipMutationIsCurrent(attempt, controller)) return;
      setConfirmingMembership(undefined);
      if (removingSelf) {
        const refreshed = meResponseSchema.parse(
          await mobileRequest<unknown>('/v1/me', { signal: controller.signal }),
        );
        if (!membershipMutationIsCurrent(attempt, controller)) return;
        if (refreshed.principal.households.some((scope) => scope.id === householdId)) {
          throw new MobileCustomerError(
            'The membership was removed, but the account still reported the former household.',
          );
        }
        familyRequestIdRef.current += 1;
        dispatchFamily({ type: 'reset' });
        const nextHouseholdId = replacePrincipal(refreshed.principal);
        if (nextHouseholdId === householdId) {
          throw new MobileCustomerError('The former household could not be cleared safely.');
        }
        setStatusState({
          scope: 'invitation',
          message:
            'You left the household. No protected, Trusted Circle, administrator, payer, or billing authority was changed.',
        });
        navigation.navigate('Home');
        return;
      }
      const refreshedFamily = await load(householdId, controller.signal);
      if (!membershipMutationIsCurrent(attempt, controller)) return;
      if (!refreshedFamily) {
        throw new MobileCustomerError(
          'The neutral membership was removed, but the household roster could not be refreshed.',
        );
      }
      setStatusState({
        scope: 'household',
        householdId,
        message: 'The neutral household membership was removed.',
      });
    } catch (caught) {
      if (!membershipMutationIsCurrent(attempt, controller)) return;
      if (removalCommitted) {
        familyRequestIdRef.current += 1;
        dispatchFamily({ type: 'reset' });
        setError(
          'The membership change was saved, but mobile access could not be refreshed. Do not submit it again. Return Home and refresh access.',
        );
        navigation.navigate('Home');
      } else {
        setMutationError(caught);
      }
    } finally {
      if (
        membershipMutationRequestIdRef.current === attempt.requestId ||
        (controller.signal.aborted && membershipMutationAbortRef.current === undefined)
      ) {
        membershipMutationAbortRef.current = undefined;
        setBusy(false);
      }
    }
  }
  async function createInvite() {
    const householdId = selectedHouseholdId;
    if (!householdId) return;
    setBusy(true);
    clearMutationError();
    setCreatedForHousehold(undefined);
    try {
      const response = await mobileRequest<CreateInvitationResponse>('/v1/family/invitations', {
        method: 'POST',
        headers: { 'X-BB-Household-Id': householdId },
        body: JSON.stringify({
          ...(__DEV__
            ? { inviteeDisplayName: inviteeName }
            : { recipientConnectionCode: recipientConnectionCode.trim() }),
          permissions: ['view_shared_checks'],
        }),
      });
      if (selectedHouseholdIdRef.current !== householdId) return;
      setCreatedForHousehold({ householdId, value: response });
      setInviteeNameDraft(undefined);
      setRecipientConnectionCodeDraft(undefined);
      await load(householdId);
    } catch (caught) {
      if (selectedHouseholdIdRef.current === householdId) setMutationError(caught);
    } finally {
      setBusy(false);
    }
  }
  function invalidateInvitationReview() {
    invitationReviewAbortRef.current?.abort();
    dispatchInvitationReview({ type: 'clear' });
    setConsentConfirmed(false);
    setStatusState(undefined);
  }
  async function reviewInvite() {
    const reviewedInvitationId = invitationId;
    const reviewedInviteCode = inviteCode;
    const requestId = ++invitationReviewRequestIdRef.current;
    invitationReviewAbortRef.current?.abort();
    const controller = new AbortController();
    invitationReviewAbortRef.current = controller;
    setBusy(true);
    setError('');
    setStatusState(undefined);
    dispatchInvitationReview({
      type: 'started',
      requestId,
      invitationId: reviewedInvitationId,
      localInviteCode: reviewedInviteCode,
    });
    setConsentConfirmed(false);
    try {
      const response = await mobileRequest<InvitationPreviewResponse>(
        `/v1/family/invitations/${encodeURIComponent(reviewedInvitationId)}/preview`,
        {
          method: 'POST',
          body: JSON.stringify({ localInviteCode: reviewedInviteCode }),
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted || invitationReviewRequestIdRef.current !== requestId) return;
      if (response.invitation.id !== reviewedInvitationId) {
        throw new MobileCustomerError(
          'The invitation review did not match the credentials you entered. Please try again.',
        );
      }
      dispatchInvitationReview({
        type: 'succeeded',
        requestId,
        invitationId: reviewedInvitationId,
        localInviteCode: reviewedInviteCode,
        value: response,
      });
      setStatusState({
        scope: 'invitation',
        message: 'Invitation ready to review. No access has been granted.',
      });
    } catch (caught) {
      if (controller.signal.aborted || invitationReviewRequestIdRef.current !== requestId) return;
      dispatchInvitationReview({ type: 'clear' });
      setError(readableError(caught));
    } finally {
      if (invitationReviewRequestIdRef.current === requestId) {
        invitationReviewAbortRef.current = undefined;
        setBusy(false);
      }
    }
  }
  async function shareCreatedInvitation() {
    if (created === undefined) return;
    const householdId = selectedHouseholdId;
    try {
      const message =
        created.delivery === 'local_only'
          ? buildUserInitiatedInvitationShareDraft({
              invitationId: created.invitation.id,
              localInviteCode: created.localInviteCode,
              expiresAt: created.invitation.expiresAt,
              surface: 'native_share_sheet',
            }).draftText
          : [
              'BoomerBuddy Trusted Circle invitation.',
              'You must sign in, review the invitation, and choose whether to accept. Opening it grants no access or messaging consent.',
              `Invitation ID: ${created.invitation.id}`,
              'Use the one-time connection code you created and already hold. BoomerBuddy does not create or send a second credential.',
              `Expires: ${created.invitation.expiresAt}`,
              'Share only with the intended trusted person. Do not forward.',
            ].join('\n');
      const outcome = await Share.share({ message });
      if (selectedHouseholdIdRef.current !== householdId) return;
      setConfirmingRelationship(undefined);
      setStatusState({
        scope: 'household',
        householdId,
        message:
          outcome.action === Share.sharedAction
            ? 'Your device share sheet completed. BoomerBuddy did not select a contact or send a message.'
            : 'Share sheet closed. BoomerBuddy did not send anything.',
      });
    } catch (caught) {
      if (selectedHouseholdIdRef.current === householdId) setError(readableError(caught));
    }
  }
  async function acceptInvite() {
    if (!reviewedInvitation || !consentConfirmed) return;
    const acceptance = invitationAcceptanceBinding(reviewedInvitation);
    if (acceptance === null) {
      setError('The reviewed invitation no longer matches. Review it again before accepting.');
      return;
    }
    const acceptedHouseholdId = reviewedInvitation.value.invitation.household.id;
    setBusy(true);
    clearMutationError();
    try {
      const accepted = await mobileRequest<AcceptedInvitation>(
        `/v1/family/invitations/${encodeURIComponent(acceptance.invitationId)}/accept`,
        {
          method: 'POST',
          body: JSON.stringify({
            localInviteCode: acceptance.localInviteCode,
            previewVersion: acceptance.previewVersion,
          }),
        },
      );
      if (accepted.householdId !== acceptedHouseholdId) {
        throw new MobileCustomerError(
          'The accepted household did not match the invitation you reviewed.',
        );
      }
      dispatchInvitationReview({ type: 'clear' });
      setConsentConfirmed(false);
      setInvitationId('');
      setInviteCode('');
      setStatusState({
        scope: 'invitation',
        message: 'Invitation accepted with permission to view deliberately shared checks.',
      });
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
      setMutationError(caught);
    } finally {
      setBusy(false);
    }
  }
  function cancelReview() {
    invalidateInvitationReview();
    setInvitationId('');
    setInviteCode('');
    setStatusState({
      scope: 'invitation',
      message: 'Invitation review cancelled. No household access was granted.',
    });
  }
  async function cancelPendingInvitation(id: string) {
    const householdId = selectedHouseholdId;
    if (!householdId) return;
    setBusy(true);
    clearMutationError();
    try {
      await mobileRequest(`/v1/family/invitations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'X-BB-Household-Id': householdId },
      });
      if (selectedHouseholdIdRef.current !== householdId) return;
      setConfirmingInvitation(undefined);
      if (created?.invitation.id === id) setCreatedForHousehold(undefined);
      setStatusState({
        scope: 'household',
        householdId,
        message: 'Pending invitation cancelled. Its one-time code no longer works.',
      });
      await load(householdId);
    } catch (caught) {
      if (selectedHouseholdIdRef.current === householdId) setMutationError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    const householdId = selectedHouseholdId;
    if (!householdId) return;
    setBusy(true);
    clearMutationError();
    try {
      await mobileRequest(`/v1/family/relationships/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'X-BB-Household-Id': householdId },
      });
      if (selectedHouseholdIdRef.current !== householdId) return;
      setStatusState({
        scope: 'household',
        householdId,
        message: 'Trusted Circle access revoked.',
      });
      const refreshedMe = await mobileRequest<MeResponse>('/v1/me');
      if (selectedHouseholdIdRef.current !== householdId) return;
      if (refreshedMe.principal.households.some((scope) => scope.id === householdId)) {
        replacePrincipal(refreshedMe.principal, householdId);
        await load(householdId);
      } else {
        familyRequestIdRef.current += 1;
        dispatchFamily({ type: 'reset' });
        replacePrincipal(refreshedMe.principal);
        navigation.navigate('Home');
      }
    } catch (caught) {
      if (selectedHouseholdIdRef.current === householdId) setMutationError(caught);
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
      {recentAuthenticationRequired ? (
        <View style={s.banner}>
          <Text style={s.heading}>Sign in again before changing household access</Text>
          <Text style={s.body}>
            BoomerBuddy did not make the change or retry it. Your invitation entries remain on this
            screen where possible. Return Home, sign out, sign in again, then review the details and
            submit the change yourself.
          </Text>
          <ActionButton
            kind="secondary"
            title="Return Home to sign out"
            onPress={() => navigation.navigate('Home')}
          />
        </View>
      ) : null}
      {status ? (
        <Text accessibilityLiveRegion="polite" style={s.body}>
          {status}
        </Text>
      ) : null}
      <View style={s.card}>
        <Text style={s.heading}>Create a private connection code</Text>
        <Text style={s.body}>
          Give this one-time code to a household organizer who is adding you as a neutral member or
          to a protected adult who is inviting you into their Trusted Circle. The code expires after
          24 hours, grants no access by itself, and is never sent automatically.
        </Text>
        <ActionButton
          kind="secondary"
          title={ownConnectionCode ? 'Rotate connection code' : 'Create connection code'}
          disabled={busy}
          onPress={() => void generateRecipientConnectionCode()}
        />
        {ownConnectionCode ? (
          <View accessibilityLiveRegion="polite" style={s.banner}>
            <Text style={s.label}>One-time connection code</Text>
            <Text selectable style={s.body}>
              {ownConnectionCode.recipientConnectionCode}
            </Text>
            <Text style={s.muted}>
              Expires {new Date(ownConnectionCode.expiresAt).toLocaleString()}. Creating another
              code makes this one stop working.
            </Text>
            <ActionButton
              title="Share connection code"
              disabled={busy}
              onPress={() => void shareRecipientConnectionCode()}
            />
          </View>
        ) : null}
      </View>
      <View style={s.card}>
        <Text style={s.heading}>Accept a household membership invitation</Text>
        <Text style={s.muted}>
          Use the invitation ID the organizer gave you and the connection code you created and kept.
          This invitation only joins you to a household. It does not make you a protected adult,
          share Checks, or grant another person access to you. Those choices remain separate.
        </Text>
        <Text style={s.label}>Membership invitation ID</Text>
        <TextInput
          accessibilityLabel="Household membership invitation ID"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          onChangeText={(value) => {
            setMemberInvitationId(value);
            invalidateMemberInvitationReview();
          }}
          style={s.input}
          value={memberInvitationId}
        />
        <Text style={s.label}>Connection code you created for this invitation</Text>
        <TextInput
          accessibilityLabel="Connection code you created for this household invitation"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          onChangeText={(value) => {
            setMemberInvitationCredential(value);
            invalidateMemberInvitationReview();
          }}
          secureTextEntry
          style={s.input}
          value={memberInvitationCredential}
        />
        <ActionButton
          title="Review household membership invitation"
          disabled={busy || !memberInvitationId.trim() || memberInvitationCredential.length < 32}
          onPress={() => void reviewMemberInvitation()}
        />
      </View>
      {memberInvitationReview ? (
        <View style={s.card}>
          <Text style={s.pill}>Membership only</Text>
          <Text accessibilityRole="header" style={s.heading}>
            Review household membership
          </Text>
          <Text style={s.label}>Household</Text>
          <Text style={s.body}>{memberInvitationReview.value.invitation.household.name}</Text>
          <Text style={s.label}>Invited by</Text>
          <Text style={s.body}>
            {memberInvitationReview.value.invitation.invitedBy.displayName}
          </Text>
          <Text style={s.label}>Access after acceptance</Text>
          <Text style={s.body}>
            Neutral household membership only. Protected-adult enrollment, learning, Check, and
            Trusted Circle permissions remain separate choices.
          </Text>
          <Text style={s.label}>Expires</Text>
          <Text style={s.body}>
            {new Date(memberInvitationReview.value.invitation.expiresAt).toLocaleString()}
          </Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: memberConsentConfirmed }}
            onPress={() => setMemberConsentConfirmed((current) => !current)}
            style={[s.choice, memberConsentConfirmed && s.choiceSelected]}
          >
            <View style={[s.radio, memberConsentConfirmed && s.radioSelected]} />
            <Text style={s.body}>
              I reviewed the household, inviter, membership-only access, and expiry and choose to
              join.
            </Text>
          </Pressable>
          <ActionButton
            title={busy ? 'Accepting membership…' : 'Accept household membership'}
            disabled={busy || !memberConsentConfirmed}
            onPress={() => void acceptMemberInvitation()}
          />
          <ActionButton
            kind="secondary"
            title="Cancel without joining"
            disabled={busy}
            onPress={() => {
              invalidateMemberInvitationReview();
              setMemberInvitationId('');
              setMemberInvitationCredential('');
            }}
          />
        </View>
      ) : null}
      {acceptedNeutralMembershipHouseholdId === selectedHouseholdId ? (
        <View style={s.banner}>
          <Text style={s.heading}>Household membership accepted</Text>
          <Text style={s.body}>
            You joined as a neutral member. If this account is for the adult who will use
            BoomerBuddy protection, review protected-adult enrollment separately. Nothing was
            enrolled automatically.
          </Text>
          <ActionButton
            kind="secondary"
            title="Review protected-adult enrollment"
            onPress={() => navigation.navigate('ProtectedAccess')}
          />
        </View>
      ) : null}
      <View style={s.card}>
        <Text style={s.heading}>Accept a Trusted Circle invitation</Text>
        <Text style={s.muted}>
          {__DEV__
            ? 'Sign in with the invited account and enter the invitation ID and separate one-time credential the protected member gave you. Review the household, protected person, permission, and expiry before deciding.'
            : 'Sign in with the invited account. Enter the invitation ID the protected member gave you and the connection code you created and kept. Review the household, protected person, permission, and expiry before deciding.'}
        </Text>
        <Text style={s.label}>Invitation ID</Text>
        <TextInput
          accessibilityLabel="Invitation ID"
          autoCapitalize="none"
          onChangeText={(value) => {
            setInvitationId(value);
            invalidateInvitationReview();
          }}
          editable={!busy}
          style={s.input}
          value={invitationId}
        />
        <Text style={s.label}>
          {__DEV__ ? 'One-time invitation credential' : 'Your connection code'}
        </Text>
        <TextInput
          accessibilityLabel={__DEV__ ? 'One-time invitation credential' : 'Your connection code'}
          autoCapitalize="none"
          onChangeText={(value) => {
            setInviteCode(value);
            invalidateInvitationReview();
          }}
          editable={!busy}
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
            {family.members.map((member) => {
              const removingSelf = member.personId === principal.personId;
              const canRemove = canRemoveNeutralMembership(member);
              return (
                <View key={member.membershipId}>
                  <Text style={s.label}>{member.displayName}</Text>
                  <Text style={s.muted}>
                    member · {member.status}
                    {member.isAdministrator ? ' · administrator' : ''}
                    {member.isProtectedMember ? ' · protected adult' : ''}
                  </Text>
                  {canRemove ? (
                    confirmingMembershipId === member.membershipId ? (
                      <>
                        <Text style={s.body}>
                          {removingSelf
                            ? 'Leave this household? This is allowed only while you have no active protected, Trusted Circle, administrator, payer, or billing role.'
                            : 'Remove this neutral membership? The server will refuse if any protected, Trusted Circle, administrator, payer, or billing role remains.'}
                        </Text>
                        <ActionButton
                          kind="danger"
                          title={
                            busy
                              ? 'Updating…'
                              : removingSelf
                                ? 'Yes, leave household'
                                : 'Yes, remove member'
                          }
                          disabled={busy}
                          onPress={() =>
                            void removeNeutralMembership(member.membershipId, removingSelf)
                          }
                        />
                        <ActionButton
                          kind="secondary"
                          title="Keep membership"
                          disabled={busy}
                          onPress={() => setConfirmingMembership(undefined)}
                        />
                      </>
                    ) : (
                      <ActionButton
                        kind="danger"
                        title={removingSelf ? 'Leave household' : 'Remove member'}
                        disabled={busy}
                        onPress={() =>
                          setConfirmingMembership({
                            householdId: selectedHouseholdId,
                            familyRequestId:
                              visibleFamilyState?.status === 'ready'
                                ? visibleFamilyState.requestId
                                : -1,
                            membershipId: member.membershipId,
                          })
                        }
                      />
                    )
                  ) : null}
                </View>
              );
            })}
          </View>
          <View style={s.card}>
            <Text style={s.heading}>Household membership invitations</Text>
            <Text style={s.muted}>
              These invitations grant neutral household membership only. They do not enroll a
              protected adult or grant Check, learning, or Trusted Circle access.
            </Text>
            {(family.memberInvitations ?? []).filter((invitation) => invitation.state === 'pending')
              .length ? (
              (family.memberInvitations ?? [])
                .filter((invitation) => invitation.state === 'pending')
                .map((invitation) => (
                  <View key={invitation.id}>
                    <Text style={s.label}>{invitation.inviteeDisplayName}</Text>
                    <Text style={s.muted}>
                      Neutral membership only · Expires{' '}
                      {new Date(invitation.expiresAt).toLocaleString()} · Not sent automatically
                    </Text>
                    {isHouseholdAdministrator ? (
                      confirmingMemberInvitationId === invitation.id ? (
                        <>
                          <Text style={s.body}>
                            Revoke this membership invitation? Its one-time credential will stop
                            working.
                          </Text>
                          <ActionButton
                            kind="danger"
                            title={busy ? 'Revoking…' : 'Yes, revoke membership invitation'}
                            disabled={busy}
                            onPress={() => void revokeMemberInvitation(invitation.id)}
                          />
                          <ActionButton
                            kind="secondary"
                            title="Keep membership invitation"
                            disabled={busy}
                            onPress={() => setConfirmingMemberInvitation(undefined)}
                          />
                        </>
                      ) : (
                        <ActionButton
                          kind="danger"
                          title="Revoke membership invitation"
                          disabled={busy}
                          onPress={() =>
                            setConfirmingMemberInvitation({
                              householdId: selectedHouseholdId,
                              invitationId: invitation.id,
                            })
                          }
                        />
                      )
                    ) : null}
                  </View>
                ))
            ) : (
              <Text style={s.body}>No pending household membership invitations.</Text>
            )}
            <Text style={s.muted}>
              Invitation history never displays a one-time membership credential.
            </Text>
          </View>
          {isHouseholdAdministrator ? (
            <View style={s.card}>
              <Text style={s.heading}>Invite someone to join the household</Text>
              <Text style={s.body}>
                Ask the signed-in recipient to create a one-time connection code above and give it
                to you manually. This creates neutral household membership only. Protected-adult
                enrollment and every sharing permission remain separate choices.
              </Text>
              <Text style={s.label}>Recipient's one-time connection code</Text>
              <TextInput
                accessibilityLabel="Recipient's one-time connection code for household membership"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                onChangeText={(value) =>
                  setMemberRecipientConnectionCodeDraft({
                    householdId: selectedHouseholdId,
                    value,
                  })
                }
                secureTextEntry
                style={s.input}
                value={memberRecipientConnectionCode}
              />
              <ActionButton
                title="Create household membership invitation"
                disabled={busy || memberRecipientConnectionCode.trim().length < 32}
                onPress={() => void createMemberInvitation()}
              />
            </View>
          ) : null}
          {createdMemberInvitation ? (
            <View accessibilityLiveRegion="polite" style={s.banner}>
              <Text style={s.heading}>
                {createdMemberInvitation.reused
                  ? 'Household membership invitation recovered'
                  : 'Household membership invitation created'}
              </Text>
              <Text style={s.body}>
                Give the invitation ID to the intended person. They use the same one-time connection
                code they created and already hold. BoomerBuddy does not create a second credential,
                choose a recipient, or send a message.
              </Text>
              <Text selectable style={s.label}>
                Invitation ID: {createdMemberInvitation.invitation.id}
              </Text>
              <Text style={s.muted}>
                Neutral membership only · Expires{' '}
                {new Date(createdMemberInvitation.invitation.expiresAt).toLocaleString()}
              </Text>
              <ActionButton
                title="Share membership invitation ID"
                disabled={busy}
                onPress={() => void shareCreatedMemberInvitation()}
              />
              <Text style={s.muted}>
                Your device owns the destination and final send. BoomerBuddy requests no contacts
                permission and sends nothing automatically.
              </Text>
            </View>
          ) : null}
          {protectedSelfCanUseSafeWord || trustedPersonCanUseSafeWord ? (
            <View style={s.card}>
              <Text style={s.heading}>Family verification aid</Text>
              <Text style={s.body}>
                A protected adult can replace or disable their family safe word. An exact active
                trusted person can privately check a phrase. A match is a social aid, not identity
                proof.
              </Text>
              <ActionButton
                kind="secondary"
                title="Open family verification aid"
                onPress={() => navigation.navigate('FamilySafeWord')}
              />
            </View>
          ) : null}
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
                      confirmingRelationshipId === relationship.id ? (
                        <>
                          <Text style={s.body}>
                            End this Trusted Circle relationship? Future sharing access will stop.
                          </Text>
                          <ActionButton
                            kind="danger"
                            title={busy ? 'Ending access…' : 'Yes, end Trusted Circle access'}
                            disabled={busy}
                            onPress={() => void revoke(relationship.id)}
                          />
                          <ActionButton
                            kind="secondary"
                            title="Keep Trusted Circle access"
                            disabled={busy}
                            onPress={() => setConfirmingRelationship(undefined)}
                          />
                        </>
                      ) : (
                        <ActionButton
                          kind="danger"
                          title="End Trusted Circle access"
                          disabled={busy}
                          onPress={() =>
                            setConfirmingRelationship({
                              householdId: selectedHouseholdId,
                              relationshipId: relationship.id,
                            })
                          }
                        />
                      )
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
                            onPress={() => setConfirmingInvitation(undefined)}
                          />
                        </>
                      ) : (
                        <ActionButton
                          kind="danger"
                          title="Cancel invitation"
                          disabled={busy}
                          onPress={() =>
                            setConfirmingInvitation({
                              householdId: selectedHouseholdId,
                              invitationId: invitation.id,
                            })
                          }
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
              <Text style={s.heading}>Invite a trusted person</Text>
              <Text style={s.body}>
                You are inviting a trusted person into a relationship with you. An administrator
                cannot consent on your behalf, and the invited person must separately accept.
              </Text>
              {__DEV__ ? (
                <>
                  <Text style={s.label}>Trusted person’s display name</Text>
                  <TextInput
                    accessibilityLabel="Trusted person’s display name"
                    onChangeText={(value) =>
                      setInviteeNameDraft({ householdId: selectedHouseholdId, value })
                    }
                    style={s.input}
                    value={inviteeName}
                  />
                </>
              ) : (
                <>
                  <Text style={s.label}>Their one-time connection code</Text>
                  <TextInput
                    accessibilityLabel="Trusted person’s one-time connection code"
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={(value) =>
                      setRecipientConnectionCodeDraft({
                        householdId: selectedHouseholdId,
                        value,
                      })
                    }
                    secureTextEntry
                    style={s.input}
                    value={recipientConnectionCode}
                  />
                </>
              )}
              <Text style={s.muted}>
                Requested permission: view only redacted check results that are deliberately shared.
                The other person still reviews and accepts the invitation before access begins.
              </Text>
              <ActionButton
                title="Create one-time invitation credential"
                disabled={
                  busy ||
                  (__DEV__ ? !inviteeName.trim() : recipientConnectionCode.trim().length < 32)
                }
                onPress={() => void createInvite()}
              />
            </View>
          ) : null}
          {created ? (
            <View accessibilityLiveRegion="polite" style={s.banner}>
              <Text style={s.heading}>
                {created.reused
                  ? 'Trusted Circle invitation recovered'
                  : 'Trusted Circle invitation created'}
              </Text>
              <Text style={s.body}>
                {created.delivery === 'local_only'
                  ? 'Share these once with the intended person. They are not sent automatically or retained in the displayed history.'
                  : 'Give the invitation ID to the intended person. They use the same one-time connection code they created and already hold. BoomerBuddy creates no second credential and sends nothing automatically.'}
              </Text>
              <Text selectable style={s.label}>
                Invitation ID: {created.invitation.id}
              </Text>
              {created.delivery === 'local_only' ? (
                <Text selectable style={s.label}>
                  One-time code: {created.localInviteCode}
                </Text>
              ) : null}
              <ActionButton
                title="Share Trusted Circle invitation ID"
                onPress={() => void shareCreatedInvitation()}
              />
              <Text style={s.muted}>
                Your device owns the destination and final send. BoomerBuddy does not request
                contacts permission, upload an address book, or send automatically.
              </Text>
            </View>
          ) : null}
        </>
      ) : visibleFamilyState?.status === 'error' ? (
        <View style={s.card}>
          <ErrorText message={visibleFamilyState.message} />
          <ActionButton
            kind="secondary"
            title="Retry Family"
            disabled={busy}
            onPress={() => void load(selectedHouseholdId)}
          />
        </View>
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

export function OrientationScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Orientation'>): React.ReactElement {
  const { selectedHouseholdId, selectedScope } = useMobileHousehold();
  const [state, setState] = useState<OrientationStateDto>();
  const [loadedHouseholdId, setLoadedHouseholdId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [phrase, setPhrase] = useState('');
  const [practice, setPractice] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [recentAuthenticationRequired, setRecentAuthenticationRequired] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
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
        setError('');
      })
      .catch((caught) => {
        if (active) setError(readableError(caught));
      });
    return () => {
      active = false;
    };
  }, [canUseOrientation, retryVersion, selectedHouseholdId]);
  async function start() {
    setBusy('start');
    setError('');
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
    setError('');
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
    setError('');
    setRecentAuthenticationRequired(false);
    try {
      const response = await mobileRequest<{ orientation: OrientationStateDto }>(
        '/v1/orientation/safe-word',
        {
          method: 'PUT',
          body: JSON.stringify(action === 'configure' ? { action, phrase } : { action }),
        },
      );
      setState(response.orientation);
      setPhrase('');
      setAnnouncement('Safe-word choice saved and step completed.');
    } catch (caught) {
      if (requiresRecentAuthentication(caught)) {
        setPhrase('');
        setRecentAuthenticationRequired(true);
        setError('Sign in again before changing the family verification aid. No change was made.');
      } else {
        setError(readableError(caught));
      }
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
      {!canUseOrientation ? (
        <View style={s.banner}>
          <Text style={s.heading}>Protected adult access required</Text>
          <Text style={s.body}>
            Only an enrolled protected adult can complete orientation and set a safe word. Managing
            or paying for the household does not replace that adult&apos;s consent.
          </Text>
        </View>
      ) : error && !visibleState ? (
        <View style={s.card}>
          <ErrorText message={error} />
          <ActionButton
            kind="secondary"
            title="Retry Orientation"
            onPress={() => {
              setError('');
              setRetryVersion((current) => current + 1);
            }}
          />
        </View>
      ) : !visibleState ? (
        <Loading label="Loading orientation…" />
      ) : (
        <>
          {error ? <ErrorText message={error} /> : null}
          {recentAuthenticationRequired ? (
            <View style={s.banner}>
              <Text style={s.heading}>A recent sign-in is required</Text>
              <Text style={s.body}>
                The phrase was cleared. BoomerBuddy did not make or retry the change. Return Home,
                sign out, sign in again, then reopen Orientation and submit the choice yourself.
              </Text>
              <ActionButton
                kind="secondary"
                title="Return Home to sign out"
                onPress={() => navigation.navigate('Home')}
              />
            </View>
          ) : null}
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
                      maxLength={128}
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
