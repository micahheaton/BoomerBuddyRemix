'use client';

import { useState, type FormEvent } from 'react';
import type {
  BillingAuthorityHouseholdResponse,
  BillingAuthorityTransitionRequest,
  BillingAuthorityTransitionResponse,
} from '@boomerbuddy/contracts';
import { apiPaths } from '@boomerbuddy/contracts';

import { hqRequest, readableError } from '../lib/api';

const grantReasons = ['customer_billing_consent_verified', 'operator_correction'] as const;
const revokeReasons = [
  'customer_billing_consent_withdrawn',
  'security_response',
  'operator_correction',
] as const;

function label(value: string): string {
  return value.replaceAll('_', ' ');
}

export function BillingAuthority() {
  const [householdId, setHouseholdId] = useState('');
  const [data, setData] = useState<BillingAuthorityHouseholdResponse>();
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [action, setAction] = useState<BillingAuthorityTransitionRequest['action']>('grant');
  const [reasonCode, setReasonCode] = useState<BillingAuthorityTransitionRequest['reasonCode']>(
    'customer_billing_consent_verified',
  );
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await hqRequest<BillingAuthorityHouseholdResponse>(
        `${apiPaths.hqBillingAuthorities}/${encodeURIComponent(householdId)}`,
      );
      setData(result);
      setSelectedPersonId((current) =>
        result.members.some((member) => member.personId === current) ? current : '',
      );
    } catch (caught) {
      setError(readableError(caught));
      setData(undefined);
    } finally {
      setBusy(false);
    }
  }

  function selectAction(next: BillingAuthorityTransitionRequest['action']): void {
    setAction(next);
    setReasonCode(
      next === 'grant' ? 'customer_billing_consent_verified' : 'customer_billing_consent_withdrawn',
    );
    setConfirmation('');
  }

  async function transition(event: FormEvent) {
    event.preventDefault();
    const expectedConfirmation = action.toUpperCase();
    if (confirmation !== expectedConfirmation) {
      setError(`Type ${expectedConfirmation} to confirm the exact-person transition.`);
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await hqRequest<BillingAuthorityTransitionResponse>(
        `${apiPaths.hqBillingAuthorities}/${encodeURIComponent(householdId)}/${encodeURIComponent(selectedPersonId)}/transitions`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': `billing-authority:${action}:${crypto.randomUUID()}`,
          },
          body: JSON.stringify({ action, reasonCode }),
        },
      );
      setNotice(
        `${label(result.action)} recorded for ${result.personId}. No checkout, charge, Stripe call, message, or other external action ran.`,
      );
      setConfirmation('');
      await load();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  const selectedMember = data?.members.find((member) => member.personId === selectedPersonId);
  const reasons = action === 'grant' ? grantReasons : revokeReasons;

  return (
    <>
      <section className="section card" aria-labelledby="billing-authority-household-heading">
        <h2 id="billing-authority-household-heading">Exact household</h2>
        <p>
          Load one household by opaque ID. This founder workflow provisions or removes authority; it
          is not a per-checkout approval step.
        </p>
        <form className="form-stack" onSubmit={(event) => void load(event)}>
          <label htmlFor="billing-authority-household-id">Household ID</label>
          <input
            id="billing-authority-household-id"
            required
            minLength={3}
            maxLength={128}
            value={householdId}
            onChange={(event) => setHouseholdId(event.target.value)}
          />
          <button className="secondary" disabled={busy} type="submit">
            {busy ? 'Loading…' : 'Load exact household'}
          </button>
        </form>
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

      {data ? (
        <>
          <section className="section card" aria-labelledby="billing-authority-members-heading">
            <h2 id="billing-authority-members-heading">{data.household.name}</h2>
            <p>
              {data.household.id}. Select one exact active member; authority remains independent
              from payer, administrator, protected-member, and Trusted Circle roles.
            </p>
            <table>
              <caption>Household membership and billing-authority state</caption>
              <thead>
                <tr>
                  <th scope="col">Member</th>
                  <th scope="col">Person ID</th>
                  <th scope="col">Membership</th>
                  <th scope="col">Billing authority</th>
                  <th scope="col">Select</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((member) => (
                  <tr key={member.personId}>
                    <td>{member.displayName}</td>
                    <td>{member.personId}</td>
                    <td>{member.membershipStatus}</td>
                    <td>{member.authorityStatus}</td>
                    <td>
                      <button
                        className="secondary"
                        disabled={member.membershipStatus !== 'active'}
                        type="button"
                        onClick={() => {
                          setSelectedPersonId(member.personId);
                          selectAction(member.authorityStatus === 'active' ? 'revoke' : 'grant');
                        }}
                      >
                        Select
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {selectedMember ? (
            <section className="section card" aria-labelledby="billing-authority-change-heading">
              <h2 id="billing-authority-change-heading">Change exact-person authority</h2>
              <p>
                Target: {selectedMember.displayName} ({selectedMember.personId}); current state:{' '}
                {selectedMember.authorityStatus}.
              </p>
              <form className="form-stack" onSubmit={(event) => void transition(event)}>
                <label htmlFor="billing-authority-action">Action</label>
                <select
                  id="billing-authority-action"
                  value={action}
                  onChange={(event) =>
                    selectAction(event.target.value as BillingAuthorityTransitionRequest['action'])
                  }
                >
                  <option value="grant">Grant</option>
                  <option value="revoke">Revoke</option>
                </select>
                <label htmlFor="billing-authority-reason">Reason</label>
                <select
                  id="billing-authority-reason"
                  value={reasonCode}
                  onChange={(event) =>
                    setReasonCode(
                      event.target.value as BillingAuthorityTransitionRequest['reasonCode'],
                    )
                  }
                >
                  {reasons.map((reason) => (
                    <option key={reason} value={reason}>
                      {label(reason)}
                    </option>
                  ))}
                </select>
                <label htmlFor="billing-authority-confirmation">
                  Type {action.toUpperCase()} to confirm
                </label>
                <input
                  id="billing-authority-confirmation"
                  autoComplete="off"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
                <button className="primary" disabled={busy} type="submit">
                  {busy ? 'Recording…' : `${action === 'grant' ? 'Grant' : 'Revoke'} authority`}
                </button>
              </form>
            </section>
          ) : null}

          <section className="section card" aria-labelledby="billing-authority-events-heading">
            <h2 id="billing-authority-events-heading">Immutable transition history</h2>
            {data.events.length === 0 ? (
              <p>No HQ billing-authority transitions are recorded for this household.</p>
            ) : (
              <table>
                <caption>Most recent 100 billing-authority events</caption>
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Person</th>
                    <th scope="col">Change</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Actor</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((event) => (
                    <tr key={event.id}>
                      <td>{new Date(event.occurredAt).toLocaleString()}</td>
                      <td>{event.personId}</td>
                      <td>
                        {event.previousStatus} to {event.nextStatus}
                      </td>
                      <td>{label(event.reasonCode)}</td>
                      <td>{event.actorPersonId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}
