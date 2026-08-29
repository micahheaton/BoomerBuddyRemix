'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  CheckKind,
  CheckResult,
  CreateCheckResponse,
  FamilyResponse,
  MeResponse,
} from '@boomerbuddy/contracts';
import { useHousehold } from '../../../components/household-context';
import { apiRequest, readableError } from '../../../lib/api';
import {
  householdBoundValue,
  householdRequestIsCurrent,
  type HouseholdBoundValue,
} from '../../../lib/household-request';

const riskText: Record<CheckResult['risk'], string> = {
  caution: 'Use caution',
  high_concern: 'High concern',
  unknown: 'Unknown risk',
};

const sufficiencyText: Record<CheckResult['evidenceSufficiency'], string> = {
  limited: 'Limited',
  moderate: 'Moderate',
  strong: 'Strong',
};

export default function CheckPage() {
  const { selectedHouseholdId, selectedHouseholdName, selectedScope } = useHousehold();
  const [kind, setKind] = useState<CheckKind>('text');
  const [content, setContent] = useState('');
  const [resultState, setResultState] = useState<HouseholdBoundValue<CheckResult>>();
  const [busyState, setBusyState] = useState<HouseholdBoundValue<boolean>>();
  const [errorState, setErrorState] = useState<HouseholdBoundValue<string>>();
  const [shareTargetsState, setShareTargetsState] = useState<
    HouseholdBoundValue<{
      readonly checkId: string;
      readonly targets?: FamilyResponse['relationships'];
      readonly error?: string;
    }>
  >();
  const [shareReloadVersion, setShareReloadVersion] = useState(0);
  const [sharedWith, setSharedWith] = useState<string[]>([]);
  const [shareStatus, setShareStatus] = useState('');
  const [shareError, setShareError] = useState('');
  const [sharingWith, setSharingWith] = useState('');
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const selectedHouseholdIdRef = useRef(selectedHouseholdId);
  const shareLoadGenerationRef = useRef(0);
  const submitControllerRef = useRef<AbortController | undefined>(undefined);
  const shareActionControllerRef = useRef<AbortController | undefined>(undefined);
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

  useEffect(() => {
    selectedHouseholdIdRef.current = selectedHouseholdId;
  }, [selectedHouseholdId]);

  useEffect(
    () => () => {
      submitControllerRef.current?.abort();
      shareActionControllerRef.current?.abort();
    },
    [selectedHouseholdId],
  );

  const result = householdBoundValue(resultState, selectedHouseholdId);
  const busy = householdBoundValue(busyState, selectedHouseholdId) ?? false;
  const error = householdBoundValue(errorState, selectedHouseholdId) ?? '';
  const shareTargetsResource = householdBoundValue(shareTargetsState, selectedHouseholdId);
  const currentShareTargetsResource =
    result && shareTargetsResource?.checkId === result.id ? shareTargetsResource : undefined;
  const shareTargets = currentShareTargetsResource?.targets;

  useEffect(() => {
    if (!result || !isProtectedMember || !result.access.canShare) return;
    const householdId = selectedHouseholdId;
    const generation = ++shareLoadGenerationRef.current;
    const controller = new AbortController();
    const requestIdentity = { householdId, generation };
    const requestIsCurrent = (): boolean =>
      !controller.signal.aborted &&
      householdRequestIsCurrent(requestIdentity, {
        householdId: selectedHouseholdIdRef.current,
        generation: shareLoadGenerationRef.current,
      });
    const scopedRequest = {
      headers: { 'X-BB-Household-Id': householdId },
      signal: controller.signal,
    };
    resultHeading.current?.focus();
    Promise.all([
      apiRequest<FamilyResponse>('/v1/family', scopedRequest),
      apiRequest<MeResponse>('/v1/me', { signal: controller.signal }),
    ])
      .then(([family, me]) => {
        if (!requestIsCurrent()) return;
        setShareTargetsState({
          householdId,
          value: {
            checkId: result.id,
            targets: family.relationships.filter(
              (relationship) =>
                relationship.state === 'active' &&
                relationship.permissions.includes('view_shared_checks') &&
                relationship.protectedPersonId === me.principal.personId,
            ),
          },
        });
      })
      .catch((caught) => {
        if (!requestIsCurrent()) return;
        setShareTargetsState({
          householdId,
          value: { checkId: result.id, error: readableError(caught) },
        });
      });
    return () => controller.abort();
  }, [isProtectedMember, result, selectedHouseholdId, shareReloadVersion]);

  async function shareResult(personId: string, displayName: string) {
    if (!result) return;
    const householdId = selectedHouseholdId;
    const checkId = result.id;
    shareActionControllerRef.current?.abort();
    const controller = new AbortController();
    shareActionControllerRef.current = controller;
    const actionIsCurrent = (): boolean =>
      !controller.signal.aborted &&
      shareActionControllerRef.current === controller &&
      selectedHouseholdIdRef.current === householdId;
    setSharingWith(personId);
    setShareStatus('');
    setShareError('');
    try {
      await apiRequest(`/v1/checks/${encodeURIComponent(checkId)}/shares`, {
        method: 'POST',
        body: JSON.stringify({ sharedWithPersonId: personId }),
        headers: { 'X-BB-Household-Id': householdId },
        signal: controller.signal,
      });
      if (!actionIsCurrent()) return;
      setSharedWith((current) => [...new Set([...current, personId])]);
      setShareStatus(
        `Help requested from ${displayName} in BoomerBuddy. The redacted result is in their History, where they can acknowledge it. No notification was sent, and the submitted message or website address was not included.`,
      );
    } catch (caught) {
      if (actionIsCurrent()) setShareError(readableError(caught));
    } finally {
      if (actionIsCurrent()) setSharingWith('');
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const householdId = selectedHouseholdId;
    if (!householdId) return;
    submitControllerRef.current?.abort();
    const controller = new AbortController();
    submitControllerRef.current = controller;
    const actionIsCurrent = (): boolean =>
      !controller.signal.aborted &&
      submitControllerRef.current === controller &&
      selectedHouseholdIdRef.current === householdId;
    setBusyState({ householdId, value: true });
    setErrorState(undefined);
    setResultState(undefined);
    setShareTargetsState(undefined);
    setSharedWith([]);
    setShareStatus('');
    setShareError('');
    setSharingWith('');
    try {
      const response = await apiRequest<CreateCheckResponse>('/v1/checks', {
        method: 'POST',
        body: JSON.stringify({ kind: effectiveKind, content }),
        headers: { 'X-BB-Household-Id': householdId },
        signal: controller.signal,
      });
      if (!actionIsCurrent()) return;
      if (response.check.householdId !== householdId) {
        setErrorState({
          householdId,
          value: 'The Check result did not match the selected household. Nothing is shown.',
        });
        return;
      }
      setResultState({ householdId, value: response.check });
      setContent('');
    } catch (caught) {
      if (actionIsCurrent()) {
        setErrorState({ householdId, value: readableError(caught) });
      }
    } finally {
      if (actionIsCurrent()) setBusyState(undefined);
    }
  }

  if (!isProtectedMember) {
    return (
      <main id="main-content" className="member-shell member-main">
        <span className="eyebrow">Check</span>
        <h1 className="member-heading">Check unavailable in this household</h1>
        <section className="notice notice-warning">
          <h2>Protected adult access required</h2>
          <p>
            Only an enrolled protected adult can create a Check. Managing or paying for the
            household does not give you access to another adult&apos;s Checks.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main id="main-content" className="member-shell member-main">
      <span className="eyebrow">Check</span>
      <h1 className="member-heading">Check something suspicious</h1>
      <p className="lede">
        Paste only the text or URL you need to assess. Remove names, account numbers, passwords, and
        access codes first.
      </p>
      <div className="member-grid">
        <form className="card form-stack" onSubmit={submit}>
          <fieldset>
            <legend>What are you checking?</legend>
            <div className="choice-row">
              <label className="choice">
                <input
                  type="radio"
                  name="kind"
                  value="text"
                  checked={effectiveKind === 'text'}
                  disabled={!canCheckText}
                  onChange={() => {
                    setKind('text');
                    setContent('');
                  }}
                />
                Message text
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="kind"
                  value="url"
                  checked={effectiveKind === 'url'}
                  disabled={!canCheckUrl}
                  onChange={() => {
                    setKind('url');
                    setContent('');
                  }}
                />
                Website address
              </label>
            </div>
          </fieldset>
          <label htmlFor="check-content">
            {effectiveKind === 'text' ? 'Suspicious message' : 'Website address (URL)'}
          </label>
          {effectiveKind === 'text' ? (
            <textarea
              id="check-content"
              value={content}
              maxLength={20_000}
              required
              placeholder="Paste the suspicious message here"
              onChange={(event) => setContent(event.target.value)}
            />
          ) : (
            <input
              id="check-content"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              value={content}
              maxLength={2_048}
              required
              placeholder="example.com or https://example.com/path"
              onChange={(event) => setContent(event.target.value)}
            />
          )}
          <p className="help">
            BoomerBuddy will not open the website address or look it up with an outside service. The
            result can be wrong.
          </p>
          <p className="notice notice-warning">
            Before you submit: the service minimizes and encrypts the input, retains it for up to 30
            days, and deletes it sooner if you delete the check. History never displays the
            submitted text or URL.
          </p>
          {!canCheckText && !canCheckUrl ? (
            <p className="notice notice-warning">
              Checks are unavailable for your role in this household. Choose another active
              household or return Home.
            </p>
          ) : null}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button-primary"
            type="submit"
            disabled={busy || !content.trim() || (!canCheckText && !canCheckUrl)}
          >
            {busy ? 'Checking…' : 'Check it'}
          </button>
        </form>
        <aside className="notice notice-warning">
          <h2>Before you act</h2>
          <ul className="plain-list">
            <li>Do not call a number in the suspicious message.</li>
            <li>Do not share codes, passwords, or remote access.</li>
            <li>Urgency and secrecy are reasons to pause.</li>
          </ul>
        </aside>
        {result && (
          <section
            className={`result-card risk risk-${result.risk} full-span`}
            data-testid="check-result"
            data-household-id={result.householdId}
            aria-live="polite"
          >
            <span className="dev-pill">Analysis result</span>
            <h2 ref={resultHeading} tabIndex={-1}>
              Check result
            </h2>
            <p className="risk-label">
              <span className="sr-only">Risk level: </span>
              {riskText[result.risk]}
            </p>
            <p>{result.summary}</p>
            <dl className="definition-grid">
              <dt>How much information was available</dt>
              <dd>
                {sufficiencyText[result.evidenceSufficiency]} - this describes what the check could
                examine, not the chance that something is safe or harmful.
              </dd>
              <dt>Important limit</dt>
              <dd>This result can be wrong and must not be read as proof or certainty.</dd>
              <dt>Household</dt>
              <dd>{selectedHouseholdName}</dd>
              <dt>Retention</dt>
              <dd>
                Scheduled for deletion {new Date(result.retention.deleteAfter).toLocaleDateString()}{' '}
                unless you delete it sooner.
              </dd>
            </dl>
            <h3>What the check noticed</h3>
            {result.evidence.length ? (
              <ul className="plain-list">
                {result.evidence.map((item, index) => (
                  <li key={`${item.label}-${index}`}>
                    <strong>{item.label}:</strong> {item.observation}
                    {item.limitations ? (
                      <>
                        {' '}
                        <span className="meta">Limit: {item.limitations}</span>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No supporting observations were produced. Treat the risk as unknown.</p>
            )}
            <h3>Safer next actions</h3>
            <ol className="plain-list">
              {[...result.actions]
                .sort((a, b) => a.priority - b.priority)
                .map((action) => (
                  <li key={action.key}>
                    <strong>{action.title}</strong> - {action.detail}
                    {action.officialChannelOnly && (
                      <span className="meta"> Use an independently verified official channel.</span>
                    )}
                  </li>
                ))}
            </ol>
            <p className="notice notice-warning">
              <strong>This is decision support, not proof.</strong> If money, credentials, accounts,
              or physical safety are involved, stop and verify independently.
            </p>
            {result.access.canShare && isProtectedMember ? (
              <section className="card" aria-labelledby="share-result-heading">
                <h3 id="share-result-heading">Ask a trusted person to help</h3>
                <p>
                  This deliberate share lets an eligible Trusted Circle person see the redacted
                  result, warning signs, and safe actions. They can acknowledge it in History, and
                  you can close the request after taking a safer action. It never includes the
                  submitted text or website address and does not send a notification.
                </p>
                {!currentShareTargetsResource ? (
                  <p role="status">Loading eligible Trusted Circle people...</p>
                ) : currentShareTargetsResource.error ? (
                  <div className="notice notice-warning">
                    <p className="error" role="alert">
                      {currentShareTargetsResource.error}
                    </p>
                    <button
                      className="button-secondary"
                      type="button"
                      onClick={() => setShareReloadVersion((current) => current + 1)}
                    >
                      Try loading Trusted Circle people again
                    </button>
                  </div>
                ) : shareTargets?.length ? (
                  <div className="button-row">
                    {shareTargets.map((target) => (
                      <button
                        className="button-secondary"
                        disabled={
                          sharingWith === target.trustedPersonId ||
                          sharedWith.includes(target.trustedPersonId)
                        }
                        key={target.id}
                        type="button"
                        onClick={() =>
                          void shareResult(target.trustedPersonId, target.trustedDisplayName)
                        }
                      >
                        {sharedWith.includes(target.trustedPersonId)
                          ? `Help requested from ${target.trustedDisplayName}`
                          : sharingWith === target.trustedPersonId
                            ? 'Sharing…'
                            : `Ask ${target.trustedDisplayName} to review`}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="meta">
                    No active relationship currently has permission to view deliberately shared
                    checks. Family invitations and consent are managed in Family.
                  </p>
                )}
                {shareStatus && (
                  <p className="notice" role="status" aria-live="polite">
                    {shareStatus}
                  </p>
                )}
                {shareError ? (
                  <p className="error" role="alert">
                    {shareError}
                  </p>
                ) : null}
                <p className="help">
                  Sharing saves the result in the other person&apos;s BoomerBuddy account, but it
                  does not notify them. Contact them directly if help is urgent.
                </p>
              </section>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}
