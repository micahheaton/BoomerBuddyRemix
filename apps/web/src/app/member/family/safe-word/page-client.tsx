'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  FamilyResponse,
  FamilySafeWordLifecycleResponse,
  FamilySafeWordStatusResponse,
  FamilySafeWordVerifyResponse,
} from '@boomerbuddy/contracts';
import { useHousehold } from '../../../../components/household-context';
import { ApiError, apiRequest, readableError } from '../../../../lib/api';
import { productionSessionRecoveryPath } from '../../../../lib/auth-recovery';
import { householdBoundValue, type HouseholdBoundValue } from '../../../../lib/household-request';

type TrustedProtectedPerson = {
  readonly personId: string;
  readonly displayName: string;
};

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

function isRecentAuthenticationError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    error.message === 'Sign in again before changing household access'
  );
}

export default function FamilySafeWordPageClient() {
  const { me, selectedHouseholdId, selectedScope } = useHousehold();
  const [familyState, setFamilyState] = useState<HouseholdBoundValue<FamilyResponse>>();
  const [selfStatusState, setSelfStatusState] =
    useState<HouseholdBoundValue<FamilySafeWordStatusResponse>>();
  const [selfStatusUnavailableState, setSelfStatusUnavailableState] =
    useState<HouseholdBoundValue<true>>();
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
    const reset = window.setTimeout(() => {
      setLifecyclePhrase('');
      setLifecyclePhraseConfirmation('');
      setVerificationPhrase('');
      setVerificationResult(undefined);
      setSelectedTrustedTargetId('');
      setSelfStatusUnavailableState(undefined);
      setConfirmDisable(false);
      setRecentAuthenticationRequired(false);
      setBusy(undefined);
      setError('');
      setAnnouncement('');
      setLoading(Boolean(selectedHouseholdId));
    }, 0);
    return () => window.clearTimeout(reset);
  }, [selectedHouseholdId]);

  useEffect(() => {
    const householdId = selectedHouseholdId;
    if (!householdId) return;
    const controller = new AbortController();
    void apiRequest<FamilyResponse>('/v1/family', {
      headers: { 'X-BB-Household-Id': householdId },
      signal: controller.signal,
    })
      .then((response) => {
        if (controller.signal.aborted || selectedHouseholdIdRef.current !== householdId) return;
        if (response.household.id !== householdId) {
          setError('BoomerBuddy returned a different household. Switch households and retry.');
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

  const family = householdBoundValue(familyState, selectedHouseholdId);
  const currentScope = selectedScope?.id === family?.household.id ? selectedScope : undefined;
  const protectedSelf =
    currentScope?.isProtectedMember === true
      ? family?.members.find(
          (member) =>
            member.status === 'active' &&
            member.isProtectedMember &&
            member.personId === me.principal.personId,
        )
      : undefined;
  const trustedTargets = family
    ? trustedProtectedPeople(family, me.principal.personId)
    : ([] as TrustedProtectedPerson[]);
  const selectedTrustedTarget =
    trustedTargets.find((target) => target.personId === selectedTrustedTargetId) ??
    trustedTargets[0];
  const selfStatus = householdBoundValue(selfStatusState, selectedHouseholdId);
  const selfStatusUnavailable =
    householdBoundValue(selfStatusUnavailableState, selectedHouseholdId) === true;

  useEffect(() => {
    const householdId = selectedHouseholdId;
    const protectedPersonId = protectedSelf?.personId;
    if (!householdId || !protectedPersonId) return;
    const controller = new AbortController();
    void apiRequest<FamilySafeWordStatusResponse>(
      `/v1/family/safe-word/${encodeURIComponent(protectedPersonId)}`,
      {
        headers: { 'X-BB-Household-Id': householdId },
        signal: controller.signal,
      },
    )
      .then((response) => {
        if (!controller.signal.aborted && selectedHouseholdIdRef.current === householdId) {
          setSelfStatusState({ householdId, value: response });
          setSelfStatusUnavailableState(undefined);
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted && selectedHouseholdIdRef.current === householdId) {
          setSelfStatusUnavailableState({ householdId, value: true });
          setError(readableError(caught));
        }
      });
    return () => controller.abort();
  }, [protectedSelf?.personId, selectedHouseholdId]);

  function beginMutation() {
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
    if (isRecentAuthenticationError(caught)) {
      setRecentAuthenticationRequired(true);
      setError('Sign in again before changing the family verification aid. No change was made.');
      return;
    }
    setError(readableError(caught));
  }

  async function replaceSafeWord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      const response = await apiRequest<FamilySafeWordLifecycleResponse>(
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

  async function disableSafeWord() {
    if (!protectedSelf) return;
    const householdId = selectedHouseholdId;
    const protectedPersonId = protectedSelf.personId;
    const controller = beginMutation();
    setBusy('disable');
    prepareMutation();
    try {
      const response = await apiRequest<FamilySafeWordLifecycleResponse>(
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

  async function verifySafeWord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      const response = await apiRequest<FamilySafeWordVerifyResponse>(
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
          caught instanceof ApiError && caught.status === 429
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
    <main id="main-content" className="member-shell member-main">
      <span className="eyebrow">Family</span>
      <h1 className="member-heading">Family verification aid</h1>
      <p className="lede">
        A family safe word can help during a separate conversation. A match or non-match is a social
        verification aid, not identity proof, voice authentication, or proof that a request is
        genuine. Independently contact the person through a number or channel you already trust.
      </p>
      <p>
        <Link href="/member/family">Back to Family and Trusted Circle</Link>
      </p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {announcement ? (
        <p className="notice" role="status" aria-live="polite">
          {announcement}
        </p>
      ) : null}
      {recentAuthenticationRequired ? (
        <section className="notice notice-warning" aria-labelledby="safe-word-sign-in-heading">
          <h2 id="safe-word-sign-in-heading">A recent sign-in is required</h2>
          <p>
            The phrase was cleared. BoomerBuddy did not make or retry the change. Sign in again,
            clear the previous session if prompted, then reopen Family verification aid, review the
            action, and submit it yourself.
          </p>
          <Link className="button button-secondary" href={productionSessionRecoveryPath}>
            Clear session and sign in again
          </Link>
        </section>
      ) : null}
      {loading ? <p role="status">Loading family verification access…</p> : null}
      {!loading && !family ? (
        <p className="notice notice-warning">Family verification access could not be loaded.</p>
      ) : null}
      {!loading && family && !hasAccess ? (
        <section className="card">
          <h2>Unavailable for this household role</h2>
          <p>
            This page is available to an active protected adult for their own phrase and to an exact
            active trusted person for verification with that protected adult.
          </p>
        </section>
      ) : null}
      {protectedSelf ? (
        <section className="card form-stack" aria-labelledby="manage-safe-word-heading">
          <h2 id="manage-safe-word-heading">Your family safe word</h2>
          <p>
            Status:{' '}
            <strong>
              {selfStatus
                ? selfStatus.state === 'configured'
                  ? 'Configured'
                  : 'Disabled'
                : selfStatusUnavailable
                  ? 'Status unavailable'
                  : 'Checking…'}
            </strong>
          </p>
          {selfStatus?.updatedAt ? (
            <p className="meta">Last changed {new Date(selfStatus.updatedAt).toLocaleString()}</p>
          ) : null}
          <p className="help">
            BoomerBuddy cannot show the phrase. Replacing it invalidates the previous phrase. A
            recent sign-in is required for replacement or disablement.
          </p>
          <form className="form-stack" onSubmit={replaceSafeWord}>
            <label htmlFor="family-safe-word-replacement">New family safe word</label>
            <input
              id="family-safe-word-replacement"
              type="password"
              autoComplete="off"
              minLength={8}
              maxLength={128}
              value={lifecyclePhrase}
              disabled={Boolean(busy)}
              required
              onChange={(event) => setLifecyclePhrase(event.target.value)}
            />
            <p className="help">Use 8 to 128 characters and share it outside BoomerBuddy.</p>
            <label htmlFor="family-safe-word-confirmation">Enter the new safe word again</label>
            <input
              id="family-safe-word-confirmation"
              type="password"
              autoComplete="off"
              minLength={8}
              maxLength={128}
              value={lifecyclePhraseConfirmation}
              disabled={Boolean(busy)}
              required
              onChange={(event) => setLifecyclePhraseConfirmation(event.target.value)}
            />
            {lifecyclePhraseConfirmation && lifecyclePhrase !== lifecyclePhraseConfirmation ? (
              <p className="help">The two entries do not match.</p>
            ) : null}
            <button
              className="button-primary"
              type="submit"
              disabled={Boolean(busy) || lifecyclePhrase !== lifecyclePhraseConfirmation}
            >
              {busy === 'replace' ? 'Replacing…' : 'Replace family safe word'}
            </button>
          </form>
          {confirmDisable ? (
            <div className="form-stack">
              <p>Disable verification? The current phrase will stop matching immediately.</p>
              <div className="button-row">
                <button
                  className="button-danger"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void disableSafeWord()}
                >
                  {busy === 'disable' ? 'Disabling…' : 'Yes, disable verification'}
                </button>
                <button
                  className="button-secondary"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => setConfirmDisable(false)}
                >
                  Keep verification enabled
                </button>
              </div>
            </div>
          ) : (
            <button
              className="button-danger"
              type="button"
              disabled={Boolean(busy) || selfStatus?.state !== 'configured'}
              onClick={() => setConfirmDisable(true)}
            >
              Disable family safe word
            </button>
          )}
        </section>
      ) : null}
      {trustedTargets.length ? (
        <section className="card form-stack" aria-labelledby="verify-safe-word-heading">
          <h2 id="verify-safe-word-heading">Verify with a protected person</h2>
          <p>
            Only protected people connected to you by an active Trusted Circle relationship appear
            here. Ask the person for the phrase in a separate conversation.
          </p>
          <form className="form-stack" onSubmit={verifySafeWord}>
            <label htmlFor="safe-word-protected-person">Protected person</label>
            <select
              id="safe-word-protected-person"
              value={selectedTrustedTarget?.personId ?? ''}
              disabled={Boolean(busy)}
              onChange={(event) => {
                setSelectedTrustedTargetId(event.target.value);
                setVerificationPhrase('');
                setVerificationResult(undefined);
                setError('');
              }}
            >
              {trustedTargets.map((target) => (
                <option key={target.personId} value={target.personId}>
                  {target.displayName}
                </option>
              ))}
            </select>
            <label htmlFor="family-safe-word-verification">Phrase shared by that person</label>
            <input
              id="family-safe-word-verification"
              type="password"
              autoComplete="off"
              minLength={8}
              maxLength={128}
              value={verificationPhrase}
              disabled={Boolean(busy)}
              required
              onChange={(event) => setVerificationPhrase(event.target.value)}
            />
            <button className="button-primary" type="submit" disabled={Boolean(busy)}>
              {busy === 'verify' ? 'Checking…' : 'Check phrase'}
            </button>
          </form>
          {verificationResult ? (
            <p className="notice" role="status" aria-live="polite">
              {verificationResult === 'verified'
                ? 'Verified: the phrase matched the stored verifier.'
                : 'Not verified: the phrase did not match.'}{' '}
              This result is a social aid, not identity proof. Independently contact the person
              before acting on an urgent or financial request.
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
