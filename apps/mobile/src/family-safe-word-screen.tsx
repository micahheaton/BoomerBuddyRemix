import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type {
  FamilyResponse,
  FamilySafeWordLifecycleResponse,
  FamilySafeWordStatusResponse,
  FamilySafeWordVerifyResponse,
} from '@boomerbuddy/contracts';
import {
  MobileCustomerError,
  mobileRequest,
  readableError,
  requiresRecentAuthentication,
} from './api';
import { mobileHouseholdScopeSummary, useMobileHousehold } from './household';
import type { RootStackParamList } from './navigation';
import { appStyles as s } from './theme';

type TrustedProtectedPerson = { readonly personId: string; readonly displayName: string };

function ActionButton({
  title,
  onPress,
  disabled = false,
  kind = 'primary',
}: {
  readonly title: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly kind?: 'primary' | 'secondary' | 'danger';
}): React.ReactElement {
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
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        container,
        disabled && s.buttonDisabled,
        pressed && { opacity: 0.82 },
      ]}
    >
      <Text style={text}>{title}</Text>
    </Pressable>
  );
}

function trustedProtectedPeople(family: FamilyResponse, trustedPersonId: string) {
  const activeProtectedMembers = new Map(
    family.members
      .filter((member) => member.status === 'active' && member.isProtectedMember)
      .map((member) => [member.personId, member.displayName] as const),
  );
  const targets = new Map<string, TrustedProtectedPerson>();
  for (const relationship of family.relationships) {
    if (relationship.state !== 'active' || relationship.trustedPersonId !== trustedPersonId) {
      continue;
    }
    const displayName = activeProtectedMembers.get(relationship.protectedPersonId);
    if (displayName) {
      targets.set(relationship.protectedPersonId, {
        personId: relationship.protectedPersonId,
        displayName,
      });
    }
  }
  return [...targets.values()];
}

export function FamilySafeWordScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'FamilySafeWord'>): React.ReactElement {
  const { principal, selectedHouseholdId, selectedHouseholdName, selectedScope } =
    useMobileHousehold();
  const [familyState, setFamilyState] = useState<{
    readonly householdId: string;
    readonly value: FamilyResponse;
  }>();
  const [selfStatusState, setSelfStatusState] = useState<{
    readonly householdId: string;
    readonly value: FamilySafeWordStatusResponse;
  }>();
  const [selectedTrustedTargetId, setSelectedTrustedTargetId] = useState('');
  const [lifecyclePhrase, setLifecyclePhrase] = useState('');
  const [lifecyclePhraseConfirmation, setLifecyclePhraseConfirmation] = useState('');
  const [verificationPhrase, setVerificationPhrase] = useState('');
  const [verificationResult, setVerificationResult] =
    useState<FamilySafeWordVerifyResponse['result']>();
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [recentAuthenticationRequired, setRecentAuthenticationRequired] = useState(false);
  const [busy, setBusy] = useState<'replace' | 'disable' | 'verify'>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const selectedHouseholdIdRef = useRef(selectedHouseholdId);
  const mutationControllerRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    selectedHouseholdIdRef.current = selectedHouseholdId;
  }, [selectedHouseholdId]);

  useEffect(() => {
    mutationControllerRef.current?.abort();
    const reset = setTimeout(() => {
      setLifecyclePhrase('');
      setLifecyclePhraseConfirmation('');
      setVerificationPhrase('');
      setVerificationResult(undefined);
      setSelectedTrustedTargetId('');
      setConfirmDisable(false);
      setRecentAuthenticationRequired(false);
      setBusy(undefined);
      setError('');
      setAnnouncement('');
      setLoading(Boolean(selectedHouseholdId));
    }, 0);
    return () => clearTimeout(reset);
  }, [selectedHouseholdId]);

  useEffect(() => {
    const householdId = selectedHouseholdId;
    if (!householdId) return;
    const controller = new AbortController();
    void mobileRequest<FamilyResponse>('/v1/family', {
      headers: { 'X-BB-Household-Id': householdId },
      signal: controller.signal,
    })
      .then((response) => {
        if (controller.signal.aborted || selectedHouseholdIdRef.current !== householdId) return;
        if (response.household.id !== householdId) {
          setError('BoomerBuddy returned a different household. Return to Family and retry.');
          return;
        }
        setFamilyState({ householdId, value: response });
      })
      .catch((caught) => {
        if (!controller.signal.aborted && selectedHouseholdIdRef.current === householdId) {
          setError(readableError(caught));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && selectedHouseholdIdRef.current === householdId) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [selectedHouseholdId]);

  useEffect(
    () => () => {
      mutationControllerRef.current?.abort();
    },
    [],
  );

  const family = familyState?.householdId === selectedHouseholdId ? familyState.value : undefined;
  const currentScope = selectedScope?.id === family?.household.id ? selectedScope : undefined;
  const protectedSelf =
    currentScope?.isProtectedMember === true
      ? family?.members.find(
          (member) =>
            member.status === 'active' &&
            member.isProtectedMember &&
            member.personId === principal.personId,
        )
      : undefined;
  const trustedTargets = family
    ? trustedProtectedPeople(family, principal.personId)
    : ([] as TrustedProtectedPerson[]);
  const selectedTrustedTarget =
    trustedTargets.find((target) => target.personId === selectedTrustedTargetId) ??
    trustedTargets[0];
  const selfStatus =
    selfStatusState?.householdId === selectedHouseholdId ? selfStatusState.value : undefined;

  useEffect(() => {
    const householdId = selectedHouseholdId;
    const protectedPersonId = protectedSelf?.personId;
    if (!householdId || !protectedPersonId) return;
    const controller = new AbortController();
    void mobileRequest<FamilySafeWordStatusResponse>(
      `/v1/family/safe-word/${encodeURIComponent(protectedPersonId)}`,
      {
        headers: { 'X-BB-Household-Id': householdId },
        signal: controller.signal,
      },
    )
      .then((response) => {
        if (!controller.signal.aborted && selectedHouseholdIdRef.current === householdId) {
          setSelfStatusState({ householdId, value: response });
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted && selectedHouseholdIdRef.current === householdId) {
          setError(readableError(caught));
        }
      });
    return () => controller.abort();
  }, [protectedSelf?.personId, selectedHouseholdId]);

  function beginMutation(): AbortController {
    mutationControllerRef.current?.abort();
    const controller = new AbortController();
    mutationControllerRef.current = controller;
    return controller;
  }

  function prepareMutation(): void {
    setError('');
    setAnnouncement('');
    setRecentAuthenticationRequired(false);
  }

  function handleLifecycleError(caught: unknown): void {
    if (requiresRecentAuthentication(caught)) {
      setRecentAuthenticationRequired(true);
      setError('Sign in again before changing the family verification aid. No change was made.');
      return;
    }
    setError(readableError(caught));
  }

  async function replaceSafeWord(): Promise<void> {
    if (
      !protectedSelf ||
      lifecyclePhrase.length < 8 ||
      lifecyclePhrase.length > 128 ||
      lifecyclePhrase !== lifecyclePhraseConfirmation
    ) {
      return;
    }
    const householdId = selectedHouseholdId;
    const protectedPersonId = protectedSelf.personId;
    const controller = beginMutation();
    setBusy('replace');
    prepareMutation();
    try {
      const response = await mobileRequest<FamilySafeWordLifecycleResponse>(
        `/v1/family/safe-word/${encodeURIComponent(protectedPersonId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ action: 'replace', phrase: lifecyclePhrase }),
          headers: { 'X-BB-Household-Id': householdId },
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted || selectedHouseholdIdRef.current !== householdId) return;
      setSelfStatusState({ householdId, value: response });
      setAnnouncement('Family verification aid replaced. The previous phrase no longer matches.');
    } catch (caught) {
      if (!controller.signal.aborted && selectedHouseholdIdRef.current === householdId) {
        handleLifecycleError(caught);
      }
    } finally {
      setLifecyclePhrase('');
      setLifecyclePhraseConfirmation('');
      if (!controller.signal.aborted && selectedHouseholdIdRef.current === householdId) {
        setBusy(undefined);
      }
    }
  }

  async function disableSafeWord(): Promise<void> {
    if (!protectedSelf) return;
    const householdId = selectedHouseholdId;
    const protectedPersonId = protectedSelf.personId;
    const controller = beginMutation();
    setBusy('disable');
    prepareMutation();
    try {
      const response = await mobileRequest<FamilySafeWordLifecycleResponse>(
        `/v1/family/safe-word/${encodeURIComponent(protectedPersonId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ action: 'disable' }),
          headers: { 'X-BB-Household-Id': householdId },
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted || selectedHouseholdIdRef.current !== householdId) return;
      setSelfStatusState({ householdId, value: response });
      setConfirmDisable(false);
      setAnnouncement(
        response.changed
          ? 'Family verification aid disabled. The previous phrase no longer matches.'
          : 'Family verification aid was already disabled.',
      );
    } catch (caught) {
      if (!controller.signal.aborted && selectedHouseholdIdRef.current === householdId) {
        handleLifecycleError(caught);
      }
    } finally {
      if (!controller.signal.aborted && selectedHouseholdIdRef.current === householdId) {
        setBusy(undefined);
      }
    }
  }

  async function verifySafeWord(): Promise<void> {
    if (
      !selectedTrustedTarget ||
      verificationPhrase.length < 8 ||
      verificationPhrase.length > 128
    ) {
      return;
    }
    const householdId = selectedHouseholdId;
    const protectedPersonId = selectedTrustedTarget.personId;
    const controller = beginMutation();
    setBusy('verify');
    setError('');
    setAnnouncement('');
    setVerificationResult(undefined);
    try {
      const response = await mobileRequest<FamilySafeWordVerifyResponse>(
        `/v1/family/safe-word/${encodeURIComponent(protectedPersonId)}/verify`,
        {
          method: 'POST',
          body: JSON.stringify({ phrase: verificationPhrase }),
          headers: { 'X-BB-Household-Id': householdId },
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted || selectedHouseholdIdRef.current !== householdId) return;
      setVerificationResult(response.result);
    } catch (caught) {
      if (!controller.signal.aborted && selectedHouseholdIdRef.current === householdId) {
        setError(
          caught instanceof MobileCustomerError && caught.status === 429
            ? 'Too many verification attempts. Wait before trying again; no result was produced.'
            : readableError(caught),
        );
      }
    } finally {
      setVerificationPhrase('');
      if (!controller.signal.aborted && selectedHouseholdIdRef.current === householdId) {
        setBusy(undefined);
      }
    }
  }

  const hasAccess = Boolean(protectedSelf || trustedTargets.length);

  return (
    <ScrollView style={s.safe} contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      {currentScope ? (
        <View style={s.scopeBanner}>
          <Text style={s.label}>Active household: {selectedHouseholdName}</Text>
          <Text style={s.muted}>{mobileHouseholdScopeSummary(currentScope)}</Text>
        </View>
      ) : null}
      <Text accessibilityRole="header" style={s.title}>
        Family verification aid
      </Text>
      <Text style={s.body}>
        A family safe word can help during a separate conversation. A match or non-match is a social
        verification aid, not identity proof, voice authentication, or proof that a request is
        genuine. Independently contact the person through a number or channel you already trust.
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}
      {announcement ? (
        <Text accessibilityLiveRegion="polite" style={s.body}>
          {announcement}
        </Text>
      ) : null}
      {recentAuthenticationRequired ? (
        <View style={s.banner}>
          <Text style={s.heading}>A recent sign-in is required</Text>
          <Text style={s.body}>
            The phrase was cleared. BoomerBuddy did not make or retry the change. Return Home, sign
            out, sign in again, then review and submit the action yourself.
          </Text>
          <ActionButton
            kind="secondary"
            title="Return Home to sign out"
            onPress={() => navigation.navigate('Home')}
          />
        </View>
      ) : null}
      {loading ? <Text style={s.body}>Loading family verification access…</Text> : null}
      {!loading && !family ? (
        <View style={s.banner}>
          <Text style={s.body}>Family verification access could not be loaded.</Text>
        </View>
      ) : null}
      {!loading && family && !hasAccess ? (
        <View style={s.card}>
          <Text style={s.heading}>Unavailable for this household role</Text>
          <Text style={s.body}>
            This screen is available to an active protected adult for their own phrase and to an
            exact active trusted person for verification with that protected adult.
          </Text>
        </View>
      ) : null}
      {protectedSelf ? (
        <View style={s.card}>
          <Text style={s.heading}>Your family safe word</Text>
          <Text style={s.body}>
            Status:{' '}
            {selfStatus
              ? selfStatus.state === 'configured'
                ? 'Configured'
                : 'Disabled'
              : 'Checking…'}
          </Text>
          {selfStatus?.updatedAt ? (
            <Text style={s.muted}>
              Last changed {new Date(selfStatus.updatedAt).toLocaleString()}
            </Text>
          ) : null}
          <Text style={s.muted}>
            BoomerBuddy cannot show the phrase. Replacing it invalidates the previous phrase. A
            recent sign-in is required for replacement or disablement.
          </Text>
          <Text style={s.label}>New family safe word</Text>
          <TextInput
            accessibilityLabel="New family safe word"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            editable={!busy}
            maxLength={128}
            onChangeText={setLifecyclePhrase}
            secureTextEntry
            style={s.input}
            textContentType="none"
            value={lifecyclePhrase}
          />
          <Text style={s.muted}>Use 8 to 128 characters and share it outside BoomerBuddy.</Text>
          <Text style={s.label}>Enter the new safe word again</Text>
          <TextInput
            accessibilityLabel="Enter the new family safe word again"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            editable={!busy}
            maxLength={128}
            onChangeText={setLifecyclePhraseConfirmation}
            secureTextEntry
            style={s.input}
            textContentType="none"
            value={lifecyclePhraseConfirmation}
          />
          {lifecyclePhraseConfirmation && lifecyclePhrase !== lifecyclePhraseConfirmation ? (
            <Text style={s.muted}>The two entries do not match.</Text>
          ) : null}
          <ActionButton
            title={busy === 'replace' ? 'Replacing…' : 'Replace family safe word'}
            disabled={
              Boolean(busy) ||
              lifecyclePhrase.length < 8 ||
              lifecyclePhrase !== lifecyclePhraseConfirmation
            }
            onPress={() => void replaceSafeWord()}
          />
          {confirmDisable ? (
            <View>
              <Text style={s.body}>
                Disable verification? The current phrase will stop matching immediately.
              </Text>
              <ActionButton
                kind="danger"
                title={busy === 'disable' ? 'Disabling…' : 'Yes, disable verification'}
                disabled={Boolean(busy)}
                onPress={() => void disableSafeWord()}
              />
              <ActionButton
                kind="secondary"
                title="Keep verification enabled"
                disabled={Boolean(busy)}
                onPress={() => setConfirmDisable(false)}
              />
            </View>
          ) : (
            <ActionButton
              kind="danger"
              title="Disable family safe word"
              disabled={Boolean(busy) || selfStatus?.state !== 'configured'}
              onPress={() => setConfirmDisable(true)}
            />
          )}
        </View>
      ) : null}
      {trustedTargets.length ? (
        <View style={s.card}>
          <Text style={s.heading}>Verify with a protected person</Text>
          <Text style={s.body}>
            Only protected people connected to you by an active Trusted Circle relationship appear
            here. Ask the person for the phrase in a separate conversation.
          </Text>
          <Text style={s.label}>Protected person</Text>
          {trustedTargets.map((target) => {
            const selected = target.personId === selectedTrustedTarget?.personId;
            return (
              <Pressable
                key={target.personId}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: Boolean(busy) }}
                disabled={Boolean(busy)}
                onPress={() => {
                  setSelectedTrustedTargetId(target.personId);
                  setVerificationPhrase('');
                  setVerificationResult(undefined);
                  setError('');
                }}
                style={[s.choice, selected && s.choiceSelected]}
              >
                <View style={[s.radio, selected && s.radioSelected]} />
                <Text style={s.body}>{target.displayName}</Text>
              </Pressable>
            );
          })}
          <Text style={s.label}>Phrase shared by that person</Text>
          <TextInput
            accessibilityLabel="Phrase shared by the selected protected person"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            editable={!busy}
            maxLength={128}
            onChangeText={setVerificationPhrase}
            secureTextEntry
            style={s.input}
            textContentType="none"
            value={verificationPhrase}
          />
          <ActionButton
            title={busy === 'verify' ? 'Checking…' : 'Check phrase'}
            disabled={Boolean(busy) || verificationPhrase.length < 8}
            onPress={() => void verifySafeWord()}
          />
          {verificationResult ? (
            <Text accessibilityLiveRegion="polite" style={s.body}>
              {verificationResult === 'verified'
                ? 'Verified: the phrase matched the stored verifier.'
                : 'Not verified: the phrase did not match.'}{' '}
              This result is a social aid, not identity proof. Independently contact the person
              before acting on an urgent or financial request.
            </Text>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
