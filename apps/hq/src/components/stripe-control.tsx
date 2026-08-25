'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  apiPaths,
  type StripeCohortControlProjection,
  type StripeCohortControlRequest,
  type StripeControlResponse,
  type StripeControlStatusProjection,
  type StripeHouseholdEligibilityRequest,
  type StripeInitiationControlProjection,
  type StripeInitiationControlRequest,
} from '@boomerbuddy/contracts';
import { hqRequest, readableError } from '../lib/api';

type Environment = 'test' | 'production';

function correlationId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function label(value: string): string {
  return value.replaceAll('_', ' ');
}

function defaultExpiry(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString().slice(0, 16);
}

export function StripeControl() {
  const [environment, setEnvironment] = useState<Environment>('production');
  const [initiation, setInitiation] = useState<StripeInitiationControlProjection>();
  const [cohort, setCohort] = useState<StripeCohortControlProjection>();
  const [status, setStatus] = useState<StripeControlStatusProjection>();
  const [initiationState, setInitiationState] =
    useState<StripeInitiationControlRequest['nextState']>('disabled');
  const [cohortState, setCohortState] =
    useState<StripeCohortControlRequest['nextState']>('disabled');
  const [policyExpiresAt, setPolicyExpiresAt] = useState(defaultExpiry);
  const [householdId, setHouseholdId] = useState('');
  const [eligibilityState, setEligibilityState] =
    useState<StripeHouseholdEligibilityRequest['nextState']>('revoked');
  const [initiationConfirmation, setInitiationConfirmation] = useState('');
  const [cohortConfirmation, setCohortConfirmation] = useState('');
  const [eligibilityConfirmation, setEligibilityConfirmation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    await Promise.resolve();
    setBusy(true);
    setError('');
    try {
      const query = `?environment=${environment}`;
      const [nextInitiation, nextCohort, nextStatus] = await Promise.all([
        hqRequest<StripeInitiationControlProjection>(
          `${apiPaths.hqStripeInitiationControl}${query}`,
        ),
        hqRequest<StripeCohortControlProjection>(`${apiPaths.hqStripeCohortControl}${query}`),
        hqRequest<StripeControlStatusProjection>(`${apiPaths.hqStripeStatus}${query}`),
      ]);
      setInitiation(nextInitiation);
      setCohort(nextCohort);
      setStatus(nextStatus);
      setInitiationState(nextInitiation.state === 'enabled' ? 'disabled' : 'enabled');
      setCohortState(nextCohort.state === 'active' ? 'disabled' : 'active');
    } catch (caught) {
      setInitiation(undefined);
      setCohort(undefined);
      setStatus(undefined);
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }, [environment]);

  useEffect(() => {
    const scheduled = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(scheduled);
  }, [load]);

  const initiationConfirmationText = `${initiationState === 'enabled' ? 'ENABLE' : 'DISABLE'} ${environment.toUpperCase()} CHECKOUT`;
  const cohortConfirmationText = `${cohortState === 'active' ? 'ACTIVATE' : cohortState === 'expired' ? 'EXPIRE' : 'DISABLE'} ${environment.toUpperCase()} COHORT`;
  const eligibilityConfirmationText = `${eligibilityState === 'eligible' ? 'ALLOW' : 'REVOKE'} ${householdId}`;
  const activeEligibleHousehold = status?.eligibleHouseholds[0]?.householdId;
  const preflightChecks =
    status?.preflight.state === 'unknown' ? undefined : status?.preflight.checks;
  const enableAvailable =
    initiationState === 'disabled' ||
    environment === 'test' ||
    initiation?.liveEnableAvailable === true;
  const eligibilityAvailable =
    eligibilityState === 'revoked' ||
    (cohort?.state === 'active' &&
      cohort.maxActive === 1 &&
      (activeEligibleHousehold === undefined || activeEligibleHousehold === householdId));

  async function changeInitiation(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!initiation || initiationConfirmation !== initiationConfirmationText) {
      setError(`Type ${initiationConfirmationText} exactly.`);
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body: StripeInitiationControlRequest = {
        environment,
        nextState: initiationState,
        reasonCode:
          initiationState === 'enabled'
            ? environment === 'production'
              ? 'founder_live_activation'
              : 'founder_test_activation'
            : 'founder_disable',
        expectedRevision: initiation.revision,
        correlationId: correlationId('stripe-initiation-control'),
      };
      const changed = await hqRequest<StripeControlResponse>(apiPaths.hqStripeInitiationControl, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setNotice(
        `Checkout initiation is ${changed.state}. Revision ${changed.revision ?? 'recorded'}.`,
      );
      setInitiationConfirmation('');
      await load();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function changeCohort(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!cohort || cohortConfirmation !== cohortConfirmationText) {
      setError(`Type ${cohortConfirmationText} exactly.`);
      return;
    }
    if (cohortState !== 'active' && initiation?.state === 'enabled') {
      setError('Disable Checkout initiation before closing its cohort.');
      return;
    }
    const expiry = new Date(policyExpiresAt);
    if (cohortState === 'active' && !Number.isFinite(expiry.getTime())) {
      setError('Choose a valid future cohort expiry.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body: StripeCohortControlRequest = {
        environment,
        nextState: cohortState,
        maxActive: cohortState === 'active' ? 1 : 0,
        ...(cohortState === 'active' ? { policyExpiresAt: expiry.toISOString() } : {}),
        liveApproved: cohortState === 'active' && environment === 'production',
        expectedRevision: cohort.revision,
        reasonCode:
          cohortState === 'active'
            ? cohort.state === 'active'
              ? 'cohort_change'
              : 'cohort_activation'
            : cohortState === 'expired'
              ? 'cohort_expiration'
              : 'founder_disable',
        correlationId: correlationId('stripe-cohort-control'),
      };
      const changed = await hqRequest<StripeCohortControlProjection>(
        apiPaths.hqStripeCohortControl,
        { method: 'POST', body: JSON.stringify(body) },
      );
      setNotice(`The ${environment} cohort is ${changed.state} at revision ${changed.revision}.`);
      setCohortConfirmation('');
      await load();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function changeEligibility(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (householdId.length < 3 || eligibilityConfirmation !== eligibilityConfirmationText) {
      setError(`Type ${eligibilityConfirmationText} exactly.`);
      return;
    }
    if (!eligibilityAvailable) {
      setError('The one-household cohort is not open for this exact household.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body: StripeHouseholdEligibilityRequest = {
        householdId,
        environment,
        nextState: eligibilityState,
        correlationId: correlationId('stripe-household-eligibility'),
      };
      const changed = await hqRequest<StripeControlResponse>(apiPaths.hqStripeEligibleHousehold, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setNotice(`Household ${changed.householdId ?? householdId} is ${changed.state}.`);
      setEligibilityConfirmation('');
      await load();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  const evidence = useMemo(() => status?.evidence ?? [], [status]);

  return (
    <>
      <section className="section card" aria-labelledby="stripe-environment-heading">
        <h2 id="stripe-environment-heading">Exact environment</h2>
        <p>
          Reads and changes require the configured HQ owner and recent MFA. The server rejects stale
          revisions, stale MFA, an unbounded cohort, or a live enable when runtime custody is
          closed.
        </p>
        <label htmlFor="stripe-environment">Environment</label>
        <select
          id="stripe-environment"
          value={environment}
          disabled={busy}
          onChange={(event) => {
            setEnvironment(event.target.value as Environment);
            setInitiationConfirmation('');
            setCohortConfirmation('');
            setEligibilityConfirmation('');
          }}
        >
          <option value="production">Production</option>
          <option value="test">Test</option>
        </select>
        <button className="secondary" type="button" disabled={busy} onClick={() => void load()}>
          Refresh persisted evidence
        </button>
      </section>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}

      <section className="control-grid section" aria-label="Stripe control plane">
        <article className="card">
          <h2>Provider preflight</h2>
          <p>
            Persisted state: <strong>{status?.preflight.state ?? 'loading'}</strong>. No provider
            call runs when this page loads.
          </p>
          {status?.preflight.state !== undefined && status.preflight.state !== 'unknown' ? (
            <dl>
              <dt>Checked</dt>
              <dd>{new Date(status.preflight.checkedAt).toLocaleString()}</dd>
              <dt>Evidence</dt>
              <dd>{label(status.preflight.evidenceLevel)}</dd>
              <dt>Authenticity</dt>
              <dd>{label(status.preflight.authenticityKind)}</dd>
              <dt>Account ready</dt>
              <dd>{preflightChecks?.accountReady ? 'yes' : 'no'}</dd>
              <dt>Offer ready</dt>
              <dd>{preflightChecks?.offerReady ? 'yes' : 'no'}</dd>
              <dt>Portal ready</dt>
              <dd>{preflightChecks?.portalReady ? 'yes' : 'no'}</dd>
              <dt>Checkout policy ready</dt>
              <dd>{preflightChecks?.checkoutPolicyReady ? 'yes' : 'no'}</dd>
              <dt>Evidence digest</dt>
              <dd>
                <code>{status.preflight.evidenceDigest}</code>
              </dd>
            </dl>
          ) : (
            <p>No persisted preflight evidence exists for this environment.</p>
          )}
        </article>

        <article className="card">
          <h2>Checkout initiation</h2>
          <p>
            Current state: {initiation?.state ?? 'loading'}; revision {initiation?.revision ?? 0}.
          </p>
          <form className="form-stack" onSubmit={(event) => void changeInitiation(event)}>
            <label htmlFor="stripe-initiation-state">Next state</label>
            <select
              id="stripe-initiation-state"
              value={initiationState}
              onChange={(event) => {
                setInitiationState(
                  event.target.value as StripeInitiationControlRequest['nextState'],
                );
                setInitiationConfirmation('');
              }}
            >
              <option value="disabled">Disabled</option>
              <option value="enabled">Enabled</option>
            </select>
            <label htmlFor="stripe-initiation-confirmation">
              Type {initiationConfirmationText}
            </label>
            <input
              id="stripe-initiation-confirmation"
              autoComplete="off"
              value={initiationConfirmation}
              onChange={(event) => setInitiationConfirmation(event.target.value)}
            />
            <button
              className="primary"
              type="submit"
              disabled={busy || !initiation || !enableAvailable}
            >
              Record revision-safe initiation change
            </button>
          </form>
        </article>

        <article className="card">
          <h2>One-household cohort</h2>
          <p>
            Current state: {cohort?.state ?? 'loading'}; cap {cohort?.maxActive ?? 0}; revision{' '}
            {cohort?.revision ?? 0}.
          </p>
          <form className="form-stack" onSubmit={(event) => void changeCohort(event)}>
            <label htmlFor="stripe-cohort-state">Next state</label>
            <select
              id="stripe-cohort-state"
              value={cohortState}
              onChange={(event) => {
                setCohortState(event.target.value as StripeCohortControlRequest['nextState']);
                setCohortConfirmation('');
              }}
            >
              <option value="disabled">Disabled</option>
              <option value="active">Active, maximum one household</option>
              <option value="expired">Expired</option>
            </select>
            {cohortState === 'active' ? (
              <>
                <label htmlFor="stripe-cohort-expiry">Policy expires</label>
                <input
                  id="stripe-cohort-expiry"
                  type="datetime-local"
                  value={policyExpiresAt}
                  onChange={(event) => setPolicyExpiresAt(event.target.value)}
                />
              </>
            ) : null}
            <label htmlFor="stripe-cohort-confirmation">Type {cohortConfirmationText}</label>
            <input
              id="stripe-cohort-confirmation"
              autoComplete="off"
              value={cohortConfirmation}
              onChange={(event) => setCohortConfirmation(event.target.value)}
            />
            <button className="primary" type="submit" disabled={busy || !cohort}>
              Record revision-safe cohort change
            </button>
          </form>
        </article>

        <article className="card">
          <h2>Exact eligible household</h2>
          <p>Active persisted household: {activeEligibleHousehold ?? 'none'}.</p>
          <form className="form-stack" onSubmit={(event) => void changeEligibility(event)}>
            <label htmlFor="stripe-household-id">Opaque household ID</label>
            <input
              id="stripe-household-id"
              required
              minLength={3}
              maxLength={128}
              value={householdId}
              onChange={(event) => {
                setHouseholdId(event.target.value);
                setEligibilityConfirmation('');
              }}
            />
            <label htmlFor="stripe-eligibility-state">Next state</label>
            <select
              id="stripe-eligibility-state"
              value={eligibilityState}
              onChange={(event) => {
                setEligibilityState(
                  event.target.value as StripeHouseholdEligibilityRequest['nextState'],
                );
                setEligibilityConfirmation('');
              }}
            >
              <option value="revoked">Revoked</option>
              <option value="eligible">Eligible</option>
            </select>
            <label htmlFor="stripe-eligibility-confirmation">
              Type {eligibilityConfirmationText}
            </label>
            <input
              id="stripe-eligibility-confirmation"
              autoComplete="off"
              value={eligibilityConfirmation}
              onChange={(event) => setEligibilityConfirmation(event.target.value)}
            />
            <button className="primary" type="submit" disabled={busy || !eligibilityAvailable}>
              Record exact-household change
            </button>
          </form>
        </article>
      </section>

      <section className="section card" aria-labelledby="stripe-evidence-heading">
        <h2 id="stripe-evidence-heading">Bounded append-only evidence</h2>
        <p>
          Up to 50 persisted control and preflight entries. Secrets and raw provider objects are
          excluded.
        </p>
        {evidence.length === 0 ? (
          <p>No Stripe control evidence is recorded for this environment.</p>
        ) : (
          <table>
            <caption>Most recent persisted Stripe control evidence</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Kind</th>
                <th scope="col">State</th>
                <th scope="col">Subject</th>
                <th scope="col">Revision or evidence</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((entry, index) => (
                <tr key={`${entry.kind}-${entry.occurredAt}-${index}`}>
                  <td>{new Date(entry.occurredAt).toLocaleString()}</td>
                  <td>{label(entry.kind)}</td>
                  <td>{label(entry.state)}</td>
                  <td>{entry.subjectId ?? 'environment'}</td>
                  <td>
                    {entry.revision ?? entry.evidenceDigest ?? entry.reasonCode ?? 'recorded'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
