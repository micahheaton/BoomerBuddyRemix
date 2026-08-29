'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  CheckKind,
  CheckResult,
  CreateCheckResponse,
  FamilyResponse,
  MeResponse,
  PrincipalDto,
} from '@boomerbuddy/contracts';
import { PublicFooter, PublicHeader } from '../../components/public-shell';
import { ApiError, apiRequest, readableError, setSelectedHouseholdId } from '../../lib/api';

type PublicAttribution = {
  source: 'direct' | 'organic' | 'partner' | 'campaign';
  campaign: 'none' | 'launch_2026' | 'trusted_partner';
};

type PublicContext = {
  token: string;
  continuityProof: string;
  expiresAt: string;
  remainingChecks: number;
};

type PublicCheckResult = {
  id: string;
  kind: CheckKind;
  risk: CheckResult['risk'];
  evidenceSufficiency: CheckResult['evidenceSufficiency'];
  calibration: 'not_calibrated';
  summary: string;
  warningSigns: string[];
  actions: CheckResult['actions'];
  inputSafety: {
    redactions: Array<{
      class: 'payment_card' | 'authorization_credential' | 'one_time_code';
      placeholder: '[PAYMENT_CARD]' | '[AUTH_CREDENTIAL]' | '[ONE_TIME_CODE]';
      count: number;
    }>;
    flags: Array<
      'contained_payment_card' | 'contained_authorization_credential' | 'contained_one_time_code'
    >;
  };
  expiresAt: string;
  conversionGrant: {
    token: string;
    expiresAt: string;
    semanticsVersion: 'single-success-retry-v1';
    singleSuccessfulConversion: true;
    retryableWithSameCredentialOwnerAndConsent: true;
    oneTime: true;
  };
};

type PublicHouseholdChoice = {
  id: string;
  label: string;
  detail: string;
};

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

const redactionText: Record<
  PublicCheckResult['inputSafety']['redactions'][number]['class'],
  string
> = {
  payment_card: 'payment-card pattern',
  authorization_credential: 'password or access-code pattern',
  one_time_code: 'one-time code',
};

function householdChoiceDetail(scope: PrincipalDto['households'][number]): string {
  return [
    scope.isAdministrator ? 'administrator' : 'member',
    scope.isProtectedMember ? 'protected adult' : '',
    scope.isBillingManager ? 'billing manager' : '',
  ]
    .filter(Boolean)
    .join(', ');
}

function attributionFromLocation(): PublicAttribution {
  if (typeof window === 'undefined') return { source: 'direct', campaign: 'none' };
  const parameters = new URLSearchParams(window.location.search);
  const sourceValue = parameters.get('source');
  const campaignValue = parameters.get('campaign');
  const sources: PublicAttribution['source'][] = ['direct', 'organic', 'partner', 'campaign'];
  const campaigns: PublicAttribution['campaign'][] = ['none', 'launch_2026', 'trusted_partner'];
  return {
    source: sources.includes(sourceValue as PublicAttribution['source'])
      ? (sourceValue as PublicAttribution['source'])
      : 'direct',
    campaign: campaigns.includes(campaignValue as PublicAttribution['campaign'])
      ? (campaignValue as PublicAttribution['campaign'])
      : 'none',
  };
}

function captureAttributionAndCanonicalize(): PublicAttribution {
  const attribution = attributionFromLocation();
  if (typeof window !== 'undefined' && window.location.search.length > 0) {
    window.history.replaceState(null, '', window.location.pathname);
  }
  return attribution;
}

export default function PublicCheckPage() {
  const [kind, setKind] = useState<CheckKind>('text');
  const [content, setContent] = useState('');
  const [context, setContext] = useState<PublicContext>();
  const [result, setResult] = useState<PublicCheckResult>();
  const [savedCheck, setSavedCheck] = useState<CheckResult>();
  const [busy, setBusy] = useState<'check' | 'save' | ''>('');
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [householdChoices, setHouseholdChoices] = useState<PublicHouseholdChoice[]>([]);
  const [saveHouseholdId, setSaveHouseholdId] = useState('');
  const attribution = useRef<PublicAttribution | undefined>(undefined);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (result) resultHeading.current?.focus();
  }, [result]);

  useEffect(() => {
    attribution.current ??= captureAttributionAndCanonicalize();
  }, []);

  async function currentContext(): Promise<PublicContext> {
    if (
      context &&
      context.remainingChecks > 0 &&
      new Date(context.expiresAt).getTime() > Date.now() + 5_000
    ) {
      return context;
    }
    const capturedAttribution = attribution.current ?? captureAttributionAndCanonicalize();
    attribution.current = capturedAttribution;
    const response = await apiRequest<{ context: PublicContext }>('/v1/public/check-contexts', {
      method: 'POST',
      body: JSON.stringify({ attribution: capturedAttribution }),
    });
    setContext(response.context);
    return response.context;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy('check');
    setError('');
    setSaveStatus('');
    setNeedsSignIn(false);
    setHouseholdChoices([]);
    setSaveHouseholdId('');
    setSavedCheck(undefined);
    setResult(undefined);
    try {
      const activeContext = await currentContext();
      const response = await apiRequest<{ result: PublicCheckResult }>('/v1/public/checks', {
        method: 'POST',
        body: JSON.stringify({
          contextToken: activeContext.token,
          continuityProof: activeContext.continuityProof,
          kind,
          content,
        }),
      });
      setContext({ ...activeContext, remainingChecks: activeContext.remainingChecks - 1 });
      setResult(response.result);
      setContent('');
    } catch (caught) {
      setContext(undefined);
      setError(readableError(caught));
    } finally {
      setBusy('');
    }
  }

  async function loadHouseholdChoices(): Promise<number> {
    const me = await apiRequest<MeResponse>('/v1/me', {
      publicCheckHandoff: 'household_discovery',
    });
    const eligibleScopes = me.principal.households.filter((scope) => scope.isProtectedMember);
    const choices = await Promise.all(
      eligibleScopes.map(async (scope, index): Promise<PublicHouseholdChoice> => {
        let label = `Household ${index + 1}`;
        try {
          const family = await apiRequest<FamilyResponse>('/v1/family', {
            publicCheckHandoff: 'household_name',
            headers: { 'X-BB-Household-Id': scope.id },
          });
          label = family.household.name;
        } catch {
          // A numbered fallback avoids exposing opaque IDs when a name is unavailable.
        }
        return { id: scope.id, label, detail: householdChoiceDetail(scope) };
      }),
    );
    setHouseholdChoices(choices);
    setSaveHouseholdId('');
    return choices.length;
  }

  async function saveToHousehold() {
    if (!result || savedCheck) return;
    setBusy('save');
    setError('');
    setSaveStatus('');
    setNeedsSignIn(false);
    try {
      const response = await apiRequest<CreateCheckResponse>(
        `/v1/public/checks/${encodeURIComponent(result.id)}/save`,
        {
          method: 'POST',
          publicCheckHandoff: 'conversion_save',
          body: JSON.stringify({
            conversionToken: result.conversionGrant.token,
            saveConsent: true,
            consentVersion: 'public-check-save-v1',
          }),
        },
      );
      setSavedCheck(response.check);
      setSaveStatus(
        'Saved to your active household with your permission. If the connection is interrupted, trying again returns this same saved Check instead of creating another.',
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setNeedsSignIn(true);
        setSaveStatus(
          'Sign in in another tab, return here, and choose Save again before this result expires.',
        );
      } else if (
        caught instanceof ApiError &&
        caught.status === 409 &&
        caught.code === 'conflict'
      ) {
        try {
          const eligibleHouseholdCount = await loadHouseholdChoices();
          setSaveStatus(
            eligibleHouseholdCount > 0
              ? 'Choose the household that should receive this Check, then choose Save.'
              : 'Your account does not have an eligible protected-adult household for saving this Check.',
          );
        } catch (householdError) {
          if (householdError instanceof ApiError && householdError.status === 401) {
            setNeedsSignIn(true);
            setSaveStatus(
              'Sign in in another tab, return here, and choose Save again before this result expires.',
            );
          } else {
            setSaveStatus(readableError(householdError));
          }
        }
      } else {
        setSaveStatus(readableError(caught));
      }
    } finally {
      setBusy('');
    }
  }

  const totalRedactions =
    result?.inputSafety.redactions.reduce((total, redaction) => total + redaction.count, 0) ?? 0;

  return (
    <>
      <PublicHeader />
      <main id="main-content" className="page-shell">
        <span className="eyebrow">Public Check · no account required</span>
        <h1 className="page-title">Pause before you act.</h1>
        <p className="lede">
          Check suspicious message text or a website address without signing in. BoomerBuddy uses a
          fixed set of checks, never opens a submitted website address, and can be wrong.
        </p>
        <div className="member-grid public-check-grid">
          <form className="card form-stack" onSubmit={submit}>
            <fieldset>
              <legend>What are you checking?</legend>
              <div className="choice-row">
                <label className="choice">
                  <input
                    type="radio"
                    name="public-check-kind"
                    value="text"
                    checked={kind === 'text'}
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
                    name="public-check-kind"
                    value="url"
                    checked={kind === 'url'}
                    onChange={() => {
                      setKind('url');
                      setContent('');
                    }}
                  />
                  Website address
                </label>
              </div>
            </fieldset>
            <label htmlFor="public-check-content">
              {kind === 'text' ? 'Suspicious message' : 'Website address (URL)'}
            </label>
            {kind === 'text' ? (
              <textarea
                id="public-check-content"
                value={content}
                maxLength={20_000}
                required
                placeholder="Paste only the suspicious message"
                onChange={(event) => setContent(event.target.value)}
              />
            ) : (
              <input
                id="public-check-content"
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
              Remove names, account numbers, passwords, access codes, and payment details. The page
              does not put your submission or result into the URL or browser storage.
            </p>
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              className="button-primary"
              type="submit"
              disabled={busy !== '' || !content.trim()}
            >
              {busy === 'check' ? 'Checking…' : 'Check it'}
            </button>
          </form>
          <aside className="notice notice-warning">
            <h2>Anonymous and temporary</h2>
            <ul className="plain-list">
              <li>No account or household is attached to an anonymous Check.</li>
              <li>
                Common card, password, and one-time-code patterns are removed before a temporary
                copy is protected.
              </li>
              <li>
                You may choose to save the result once. The save option expires after 15 minutes,
                and the temporary copy is then deleted automatically. Refreshing this page clears
                the save option immediately.
              </li>
              <li>
                Short-lived browser protection keeps this page working through ordinary connection
                changes. Limits protect the service from abuse.
              </li>
              <li>
                Submitted messages and website addresses are never used to identify a marketing
                source.
              </li>
            </ul>
          </aside>
          {result ? (
            <section
              className={`result-card risk risk-${result.risk} full-span`}
              data-testid="public-check-result"
              aria-live="polite"
            >
              <span className="dev-pill">Anonymous result</span>
              <h2 ref={resultHeading} tabIndex={-1}>
                Check result
              </h2>
              <p className="risk-label">
                <span className="sr-only">Risk level: </span>
                {riskText[result.risk]}
              </p>
              <p>{result.summary}</p>
              <section aria-labelledby="public-check-warning-signs">
                <h3 id="public-check-warning-signs">What the Check noticed</h3>
                <ul className="plain-list">
                  {result.warningSigns.map((warningSign) => (
                    <li key={warningSign}>{warningSign}</li>
                  ))}
                </ul>
                <p className="help">
                  These are warning patterns in the submitted characters, not proof that the sender
                  or request is fraudulent.
                </p>
              </section>
              <dl className="definition-grid">
                <dt>How much information was available</dt>
                <dd>
                  {sufficiencyText[result.evidenceSufficiency]} - this describes what the check
                  could examine, not the chance that something is safe or harmful.
                </dd>
                <dt>Important limit</dt>
                <dd>This result can be wrong. It is decision support, not proof or certainty.</dd>
                <dt>Save option expires</dt>
                <dd>{new Date(result.expiresAt).toLocaleString()}</dd>
                <dt>Sensitive information check</dt>
                <dd>
                  {totalRedactions === 0
                    ? 'No supported sensitive pattern was redacted. This is not a guarantee that the input contained no sensitive data.'
                    : `${totalRedactions} supported sensitive pattern${totalRedactions === 1 ? ' was' : 's were'} redacted.`}
                </dd>
              </dl>
              {result.inputSafety.redactions.length ? (
                <div className="notice notice-warning" role="status">
                  <h3>Sensitive patterns removed</h3>
                  <ul className="plain-list">
                    {result.inputSafety.redactions.map((redaction) => (
                      <li key={redaction.class}>
                        {redaction.count} {redactionText[redaction.class]}
                        {redaction.count === 1 ? '' : 's'} replaced with {redaction.placeholder}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <h3>Safer next actions</h3>
              <ol className="plain-list">
                {[...result.actions]
                  .sort((left, right) => left.priority - right.priority)
                  .map((action) => (
                    <li key={action.key}>
                      <strong>{action.title}</strong> - {action.detail}
                      {action.officialChannelOnly
                        ? ' Use a contact channel you verify independently.'
                        : ''}
                    </li>
                  ))}
              </ol>
              <p className="notice notice-warning">
                <strong>Do not treat this as proof.</strong> If money, credentials, accounts, or
                physical safety are involved, stop and verify independently.
              </p>
              <section className="card" aria-labelledby="optional-save-heading">
                <h3 id="optional-save-heading">Optional: save to your household</h3>
                <p>
                  Saving is never automatic. You must sign in, choose Save, and have permission in
                  the selected household. BoomerBuddy saves the version with supported sensitive
                  patterns already removed. Trying again can return only this same saved Check.
                </p>
                {householdChoices.length > 0 ? (
                  <div className="form-stack">
                    <label htmlFor="public-check-household">Household for this saved Check</label>
                    <select
                      id="public-check-household"
                      value={saveHouseholdId}
                      onChange={(event) => {
                        const householdId = event.target.value;
                        setSaveHouseholdId(householdId);
                        setSelectedHouseholdId(householdId);
                      }}
                    >
                      <option value="">Choose a household</option>
                      {householdChoices.map((choice) => (
                        <option key={choice.id} value={choice.id}>
                          {choice.label} - {choice.detail}
                        </option>
                      ))}
                    </select>
                    <p className="help">
                      This choice stays in this tab and is used only for requests you make while the
                      tab remains open.
                    </p>
                  </div>
                ) : null}
                <button
                  className="button-secondary"
                  type="button"
                  disabled={
                    busy !== '' ||
                    Boolean(savedCheck) ||
                    (householdChoices.length > 0 && !saveHouseholdId)
                  }
                  onClick={() => void saveToHousehold()}
                >
                  {savedCheck
                    ? 'Saved to active household'
                    : busy === 'save'
                      ? 'Saving…'
                      : 'Save with my consent'}
                </button>
                {saveStatus ? (
                  <p className={savedCheck ? 'notice' : 'help'} role="status" aria-live="polite">
                    {saveStatus}
                  </p>
                ) : null}
                {needsSignIn ? (
                  <p>
                    <Link href="/sign-in" target="_blank" rel="noopener noreferrer">
                      Open member sign in in a new tab
                    </Link>
                    . Keep this tab open so the save option remains available.
                  </p>
                ) : null}
                {savedCheck ? <Link href="/member/history">Open member history</Link> : null}
              </section>
            </section>
          ) : null}
        </div>
      </main>
      <PublicFooter />
    </>
  );
}
