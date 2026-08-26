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
  const { selectedHouseholdName, selectedScope } = useHousehold();
  const [kind, setKind] = useState<CheckKind>('text');
  const [content, setContent] = useState('');
  const [result, setResult] = useState<CheckResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shareTargets, setShareTargets] = useState<FamilyResponse['relationships']>([]);
  const [sharedWith, setSharedWith] = useState<string[]>([]);
  const [shareStatus, setShareStatus] = useState('');
  const [sharingWith, setSharingWith] = useState('');
  const resultHeading = useRef<HTMLHeadingElement>(null);
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
    if (!result || !isProtectedMember || !result.access.canShare) return;
    let active = true;
    resultHeading.current?.focus();
    Promise.all([apiRequest<FamilyResponse>('/v1/family'), apiRequest<MeResponse>('/v1/me')])
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
  }, [isProtectedMember, result]);

  async function shareResult(personId: string, displayName: string) {
    if (!result) return;
    setSharingWith(personId);
    setShareStatus('');
    try {
      await apiRequest(`/v1/checks/${encodeURIComponent(result.id)}/shares`, {
        method: 'POST',
        body: JSON.stringify({ sharedWithPersonId: personId }),
      });
      setSharedWith((current) => [...new Set([...current, personId])]);
      setShareStatus(
        `Redacted result shared with ${displayName} in BoomerBuddy. No notification was sent, and the submitted message or website address was not included.`,
      );
    } catch (caught) {
      setShareStatus(readableError(caught));
    } finally {
      setSharingWith('');
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setResult(undefined);
    setShareTargets([]);
    setSharedWith([]);
    setShareStatus('');
    setSharingWith('');
    try {
      const response = await apiRequest<CreateCheckResponse>('/v1/checks', {
        method: 'POST',
        body: JSON.stringify({ kind: effectiveKind, content }),
      });
      setResult(response.check);
      setContent('');
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
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
              type="url"
              inputMode="url"
              value={content}
              maxLength={2_048}
              required
              placeholder="https://example.com/path"
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
                <h3 id="share-result-heading">Share this redacted result</h3>
                <p>
                  Sharing lets an eligible Trusted Circle person see the result details, warning
                  signs, and safe actions. It never includes the submitted text or website address
                  and does not send a notification.
                </p>
                {shareTargets.length ? (
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
                          ? `Shared with ${target.trustedDisplayName}`
                          : sharingWith === target.trustedPersonId
                            ? 'Sharing…'
                            : `Share with ${target.trustedDisplayName}`}
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
