'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  ConfigureFoundingHouseholdPolicyResponse,
  CreateFoundingHouseholdInvitationResponse,
  FoundingHouseholdFounderConsoleResponse,
  OffboardFoundingHouseholdResponse,
  RevokeFoundingHouseholdInvitationResponse,
} from '@boomerbuddy/contracts';
import { apiPaths } from '@boomerbuddy/contracts';

import { HqApiError, hqRequest, readableError } from '../lib/api';

type PolicyDraft = {
  readonly benefitKey: 'plus_beta_v1' | 'family_beta_v1';
  readonly maxHouseholds: number;
  readonly invitationTtlDays: number;
  readonly accessDurationDays: number;
  readonly programEndsAt: string;
};

const initialPolicy: PolicyDraft = {
  benefitKey: 'family_beta_v1',
  maxHouseholds: 1,
  invitationTtlDays: 7,
  accessDurationDays: 60,
  programEndsAt: '',
};

function operation(kind: 'policy' | 'invite' | 'invite-revoke' | 'offboard'): string {
  return `founding-${kind}:${crypto.randomUUID()}`;
}

function label(value: string): string {
  return value.replaceAll('_', ' ');
}

export function FoundingHouseholds() {
  const [data, setData] = useState<FoundingHouseholdFounderConsoleResponse>();
  const [draft, setDraft] = useState<PolicyDraft>(initialPolicy);
  const [oneTimeCredential, setOneTimeCredential] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [authorizationLost, setAuthorizationLost] = useState(false);
  const [lostInvitationId, setLostInvitationId] = useState('');
  const pendingOperations = useRef(
    new Map<string, { readonly signature: string; readonly operationKey: string }>(),
  );

  function operationFor(
    slot: string,
    kind: 'policy' | 'invite' | 'invite-revoke' | 'offboard',
    signature: string,
  ): string {
    const current = pendingOperations.current.get(slot);
    if (current?.signature === signature) return current.operationKey;
    const operationKey = operation(kind);
    pendingOperations.current.set(slot, { signature, operationKey });
    return operationKey;
  }

  function resolveOperation(slot: string): void {
    pendingOperations.current.delete(slot);
  }

  function handleFailure(caught: unknown, slot?: string): void {
    if (caught instanceof HqApiError && (caught.status === 401 || caught.status === 403)) {
      pendingOperations.current.clear();
      setData(undefined);
      setOneTimeCredential('');
      setLostInvitationId('');
      setNotice('');
      setAuthorizationLost(true);
    } else if (slot !== undefined && caught instanceof HqApiError && caught.status === 409) {
      resolveOperation(slot);
    }
    setError(readableError(caught));
  }

  const load = useCallback(async () => {
    const response = await hqRequest<FoundingHouseholdFounderConsoleResponse>(
      apiPaths.hqFoundingHouseholds,
      { cache: 'no-store' },
    );
    setData(response);
    setAuthorizationLost(false);
    setError('');
  }, []);

  useEffect(() => {
    let active = true;
    void hqRequest<FoundingHouseholdFounderConsoleResponse>(apiPaths.hqFoundingHouseholds, {
      cache: 'no-store',
    })
      .then((response) => {
        if (active) {
          setData(response);
          setAuthorizationLost(false);
        }
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof HqApiError && (caught.status === 401 || caught.status === 403)) {
          pendingOperations.current.clear();
          setData(undefined);
          setOneTimeCredential('');
          setLostInvitationId('');
          setAuthorizationLost(true);
        }
        setError(readableError(caught));
      });
    return () => {
      active = false;
    };
  }, []);

  async function configure(event: FormEvent) {
    event.preventDefault();
    setBusy('policy');
    setError('');
    setNotice('');
    setOneTimeCredential('');
    try {
      if (!data || !draft.programEndsAt) throw new Error('Choose a finite program end date.');
      const payload = {
        state: 'active' as const,
        expectedRevision: data.policy.revision,
        benefitKey: draft.benefitKey,
        maxHouseholds: draft.maxHouseholds,
        invitationTtlDays: draft.invitationTtlDays,
        accessDurationDays: draft.accessDurationDays,
        programEndsAt: new Date(draft.programEndsAt).toISOString(),
      };
      const result = await hqRequest<ConfigureFoundingHouseholdPolicyResponse>(
        `${apiPaths.hqFoundingHouseholds}/policy`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Idempotency-Key': operationFor('policy', 'policy', JSON.stringify(payload)),
          },
          body: JSON.stringify(payload),
        },
      );
      resolveOperation('policy');
      setNotice(
        `Local policy revision ${result.policy.revision} recorded. No invitation, message, payment, or external action ran.`,
      );
      await load();
    } catch (caught) {
      handleFailure(caught, 'policy');
    } finally {
      setBusy('');
    }
  }

  async function disablePolicy() {
    if (!data) return;
    setBusy('policy');
    setError('');
    setNotice('');
    setOneTimeCredential('');
    try {
      const payload = { state: 'disabled' as const, expectedRevision: data.policy.revision };
      const result = await hqRequest<ConfigureFoundingHouseholdPolicyResponse>(
        `${apiPaths.hqFoundingHouseholds}/policy`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Idempotency-Key': operationFor('policy', 'policy', JSON.stringify(payload)),
          },
          body: JSON.stringify(payload),
        },
      );
      resolveOperation('policy');
      setNotice(
        `Policy disabled; ${result.invalidatedInvitationCount} pending credential(s) were terminally superseded and zeroized. History remains.`,
      );
      await load();
    } catch (caught) {
      handleFailure(caught, 'policy');
    } finally {
      setBusy('');
    }
  }

  async function createInvitation() {
    setBusy('invite');
    setError('');
    setNotice('');
    try {
      const signature = String(data?.policy.revision ?? 'unknown');
      const result = await hqRequest<CreateFoundingHouseholdInvitationResponse>(
        `${apiPaths.hqFoundingHouseholds}/invitations`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Idempotency-Key': operationFor('invite', 'invite', signature) },
        },
      );
      resolveOperation('invite');
      if (result.credentialState === 'created_credential_unavailable') {
        setOneTimeCredential('');
        setLostInvitationId(result.invitation.id);
        setNotice(
          `Invitation ${result.invitation.id} was already created, but its one-time credential cannot be recovered. Revoke that exact invitation before issuing a replacement.`,
        );
        await load();
        return;
      }
      if (result.localInvitationCredential === undefined) {
        throw new Error('The invitation response did not contain its one-time credential.');
      }
      setLostInvitationId('');
      setOneTimeCredential(result.localInvitationCredential);
      setNotice(
        'One local credential was issued. It is displayed once and has not been emailed, texted, logged, or placed in a contact list.',
      );
      await load();
    } catch (caught) {
      handleFailure(caught, 'invite');
    } finally {
      setBusy('');
    }
  }

  async function revokeInvitation(invitationId: string) {
    setBusy(invitationId);
    setError('');
    setOneTimeCredential('');
    try {
      const result = await hqRequest<RevokeFoundingHouseholdInvitationResponse>(
        `${apiPaths.hqFoundingHouseholds}/invitations/${encodeURIComponent(invitationId)}/revoke`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Idempotency-Key': operationFor(
              `revoke:${invitationId}`,
              'invite-revoke',
              invitationId,
            ),
          },
        },
      );
      resolveOperation(`revoke:${invitationId}`);
      if (lostInvitationId === invitationId) setLostInvitationId('');
      setNotice(`Invitation ${result.invitation.id} revoked and its HMAC material zeroized.`);
      await load();
    } catch (caught) {
      handleFailure(caught, `revoke:${invitationId}`);
    } finally {
      setBusy('');
    }
  }

  async function offboard(householdId: string) {
    setBusy(householdId);
    setError('');
    setOneTimeCredential('');
    try {
      const result = await hqRequest<OffboardFoundingHouseholdResponse>(
        `${apiPaths.hqFoundingHouseholds}/enrollments/${encodeURIComponent(householdId)}/offboard`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Idempotency-Key': operationFor(`offboard:${householdId}`, 'offboard', householdId),
          },
        },
      );
      resolveOperation(`offboard:${householdId}`);
      setNotice(
        `Founding sponsorship ${label(result.enrollment.state)}. No unrelated entitlement or customer consent was changed.`,
      );
      await load();
    } catch (caught) {
      handleFailure(caught, `offboard:${householdId}`);
    } finally {
      setBusy('');
    }
  }

  if (process.env.NODE_ENV === 'production') {
    return (
      <div className="control-boundary" role="note">
        <strong>Managed-identity activation is blocked.</strong> Local Founding Household credential
        and sponsor controls are excluded from the production build pending a reviewed
        managed-identity and environment-bound sponsor release.
      </div>
    );
  }

  if (authorizationLost) {
    return (
      <p className="error" role="alert">
        Founder authorization was lost. Private Founding Household data and credentials were
        cleared; sign in again before reopening this console.
      </p>
    );
  }

  if (!data && !error) return <p role="status">Loading Founding Household controls…</p>;

  return (
    <>
      <div className="control-boundary" role="note">
        <strong>Local simulation; no card and no delivery adapter.</strong> This founder-only
        control plane can issue one-time local credentials and finite sponsor grants. It cannot
        create an identity, send a message, collect payment, or make production access effective.
        Managed customer identity remains a founder-provisioning blocker.
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="success-message" role="status">
          {notice}
        </p>
      ) : null}
      {oneTimeCredential ? (
        <section className="hq-card section" aria-label="One-time local invitation credential">
          <span className="seed-label">Displayed once — local handoff only</span>
          <h2>Founding Household invitation</h2>
          <code>{oneTimeCredential}</code>
          <p className="source">
            Do not paste this into source, documentation, logs, prompts, tickets, or a campaign. If
            it is lost, revoke the invitation and issue another; the server cannot recover it.
          </p>
          <button className="secondary" type="button" onClick={() => setOneTimeCredential('')}>
            Hide credential
          </button>
        </section>
      ) : null}

      {data ? (
        <section className="metric-grid section" aria-label="Founding Household capacity">
          <article className="metric-card">
            <span>Policy</span>
            <strong>{label(data.policy.state)}</strong>
            <small>revision {data.policy.revision}</small>
          </article>
          <article className="metric-card">
            <span>Active households</span>
            <strong>{data.capacity.activeHouseholds}</strong>
            <small>of {data.capacity.maxHouseholds}</small>
          </article>
          <article className="metric-card">
            <span>Reserved invitations</span>
            <strong>{data.capacity.reservedInvitations}</strong>
            <small>{data.capacity.remaining} remaining</small>
          </article>
          <article className="metric-card">
            <span>Evidence</span>
            <strong>Local only</strong>
            <small>{data.evidenceTier.replaceAll('_', ' ')}</small>
          </article>
        </section>
      ) : null}

      {data ? (
        <details className="hq-card action-panel section">
          <summary>Configure the finite local cohort policy</summary>
          <form className="form-grid" onSubmit={configure}>
            <label>
              Sponsor benefit
              <select
                value={draft.benefitKey}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    benefitKey: event.target.value as PolicyDraft['benefitKey'],
                  })
                }
              >
                <option value="family_beta_v1">
                  Founding Family beta — 3 protected / 6 trusted
                </option>
                <option value="plus_beta_v1">Founding Plus beta — 1 protected / 2 trusted</option>
              </select>
            </label>
            <label>
              Maximum households (1–25)
              <input
                type="number"
                min={1}
                max={25}
                value={draft.maxHouseholds}
                onChange={(event) =>
                  setDraft({ ...draft, maxHouseholds: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Invitation lifetime, days (1–14)
              <input
                type="number"
                min={1}
                max={14}
                value={draft.invitationTtlDays}
                onChange={(event) =>
                  setDraft({ ...draft, invitationTtlDays: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Sponsored access, days (1–180)
              <input
                type="number"
                min={1}
                max={180}
                value={draft.accessDurationDays}
                onChange={(event) =>
                  setDraft({ ...draft, accessDurationDays: Number(event.target.value) })
                }
              />
            </label>
            <label className="form-span">
              Hard program end
              <input
                type="datetime-local"
                value={draft.programEndsAt}
                onChange={(event) => setDraft({ ...draft, programEndsAt: event.target.value })}
              />
            </label>
            <p className="source form-span">
              Saving a policy supersedes every pending invitation and zeroizes its HMAC. It never
              changes existing unrelated grants or runs an external action.
            </p>
            <div className="button-row form-span">
              <button className="primary" type="submit" disabled={Boolean(busy)}>
                {busy === 'policy' ? 'Recording…' : 'Record active local policy'}
              </button>
              <button
                className="secondary"
                type="button"
                disabled={Boolean(busy) || data.policy.state === 'disabled'}
                onClick={() => void disablePolicy()}
              >
                Disable and invalidate pending credentials
              </button>
            </div>
          </form>
        </details>
      ) : null}

      <section className="hq-card section">
        <h2>Local invitation issuance</h2>
        <p>
          The server stores only an HMAC fingerprint. No recipient name, email, phone number,
          contact list, or delivery status exists in this workflow.
        </p>
        <button
          className="primary"
          type="button"
          disabled={
            Boolean(busy) ||
            Boolean(oneTimeCredential) ||
            Boolean(lostInvitationId) ||
            data?.policy.state !== 'active' ||
            data.capacity.remaining < 1
          }
          onClick={() => void createInvitation()}
        >
          {busy === 'invite' ? 'Issuing…' : 'Issue one local credential'}
        </button>
      </section>

      {lostInvitationId ? (
        <p className="error" role="alert">
          Credential recovery is impossible for {lostInvitationId}. Revoke that exact pending
          invitation below before issuing a replacement.
        </p>
      ) : null}

      <section className="control-grid section" aria-label="Founding Household records">
        {(data?.invitations ?? []).map((invitation) => (
          <article className="hq-card" key={invitation.id}>
            <span className="seed-label">Invitation · {label(invitation.state)}</span>
            <h2>{invitation.id}</h2>
            <p>
              {label(invitation.benefitKey)} · expires{' '}
              {new Date(invitation.expiresAt).toLocaleString()}
            </p>
            {invitation.state === 'pending' ? (
              <button
                className="secondary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void revokeInvitation(invitation.id)}
              >
                Revoke and zeroize
              </button>
            ) : null}
          </article>
        ))}
        {(data?.enrollments ?? []).map((enrollment) => (
          <article className="hq-card" key={enrollment.id}>
            <span className="seed-label">Household · {label(enrollment.state)}</span>
            <h2>{enrollment.householdId}</h2>
            <p>
              {label(enrollment.benefitKey)} · sponsored until{' '}
              {new Date(enrollment.effectiveEndsAt).toLocaleString()}
            </p>
            <p className="source">
              {label(enrollment.paymentState)} · research no · marketing no · follow-up no
            </p>
            <p className="source">Service consent: {label(enrollment.serviceConsentState)}</p>
            {enrollment.accessAttentionCode ? (
              <p className="error" role="alert">
                Access attention: {label(enrollment.accessAttentionCode)}. The ledger enrollment
                exists, but effective sponsor access is not active.
              </p>
            ) : null}
            {enrollment.state === 'active' && enrollment.ledgerState === 'active' ? (
              <button
                className="secondary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void offboard(enrollment.householdId)}
              >
                End only this sponsorship
              </button>
            ) : null}
          </article>
        ))}
        {data?.invitations.length === 0 && data.enrollments.length === 0 ? (
          <p>No local invitations or enrollments exist.</p>
        ) : null}
      </section>
    </>
  );
}
