'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  CreateInvitationResponse,
  FamilyResponse,
  InvitationPreviewResponse,
  TrustedCirclePermissionDto,
} from '@boomerbuddy/contracts';
import { useHousehold } from '../../../components/household-context';
import { apiRequest, readableError } from '../../../lib/api';

const permissionLabels: Record<TrustedCirclePermissionDto, string> = {
  view_shared_checks: 'View checks that are deliberately shared',
  receive_escalations: 'Reserved for future escalation notifications (not implemented)',
  help_with_orientation: 'Reserved for future guided orientation help (not implemented)',
};
type AcceptedInvitation = { relationship: { id: string }; householdId: string };

export default function FamilyPage() {
  const { me, selectedHouseholdId, selectedScope, refreshPrincipal } = useHousehold();
  const [family, setFamily] = useState<FamilyResponse>();
  const [inviteeDisplayName, setInviteeDisplayName] = useState('');
  const [created, setCreated] = useState<CreateInvitationResponse>();
  const [invitationId, setInvitationId] = useState('');
  const [localInviteCode, setLocalInviteCode] = useState('');
  const [preview, setPreview] = useState<InvitationPreviewResponse>();
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [accepted, setAccepted] = useState<AcceptedInvitation>();
  const [confirmingInvitationId, setConfirmingInvitationId] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<boolean | string>(false);

  const load = useCallback(async (householdId: string) => {
    if (!householdId) return;
    try {
      const response = await apiRequest<FamilyResponse>('/v1/family', {
        headers: { 'X-BB-Household-Id': householdId },
      });
      setFamily(response);
    } catch (caught) {
      setError(readableError(caught));
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(selectedHouseholdId), 0);
    return () => window.clearTimeout(timer);
  }, [load, selectedHouseholdId]);
  const canInvite = Boolean(inviteeDisplayName.trim());

  async function createInvite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setCreated(undefined);
    try {
      const response = await apiRequest<CreateInvitationResponse>('/v1/family/invitations', {
        method: 'POST',
        headers: { 'X-BB-Household-Id': selectedHouseholdId },
        body: JSON.stringify({
          inviteeDisplayName,
          permissions: ['view_shared_checks'],
        }),
      });
      setCreated(response);
      setInviteeDisplayName('');
      await load(selectedHouseholdId);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function reviewInvite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setPreview(undefined);
    setConsentConfirmed(false);
    try {
      const response = await apiRequest<InvitationPreviewResponse>(
        `/v1/family/invitations/${encodeURIComponent(invitationId)}/preview`,
        { method: 'POST', body: JSON.stringify({ localInviteCode }) },
      );
      setPreview(response);
      setAnnouncement('Invitation details ready to review. No access has been granted.');
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
    setAccepted(undefined);
    try {
      const response = await apiRequest<AcceptedInvitation>(
        `/v1/family/invitations/${encodeURIComponent(invitationId)}/accept`,
        {
          method: 'POST',
          body: JSON.stringify({
            localInviteCode,
            previewVersion: preview.invitation.previewVersion,
          }),
        },
      );
      if (response.householdId !== acceptedHouseholdId) {
        throw new Error('The accepted household did not match the invitation you reviewed.');
      }
      setAccepted(response);
      setPreview(undefined);
      setConsentConfirmed(false);
      setInvitationId('');
      setLocalInviteCode('');
      setAnnouncement('Invitation accepted. Scoped Trusted Circle access is now active.');
      const refreshed = await refreshPrincipal(acceptedHouseholdId);
      if (
        !refreshed.me.principal.households.some((scope) => scope.id === acceptedHouseholdId) ||
        refreshed.selectedHouseholdId !== acceptedHouseholdId
      ) {
        throw new Error(
          'Invitation accepted, but the reviewed household is not available in this session.',
        );
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
    setLocalInviteCode('');
    setAnnouncement('Invitation review cancelled. No household access was granted.');
  }

  async function cancelPendingInvitation(invitationIdToCancel: string) {
    setBusy(invitationIdToCancel);
    setError('');
    try {
      await apiRequest(`/v1/family/invitations/${encodeURIComponent(invitationIdToCancel)}`, {
        method: 'DELETE',
        headers: { 'X-BB-Household-Id': selectedHouseholdId },
      });
      setConfirmingInvitationId('');
      if (created?.invitation.id === invitationIdToCancel) setCreated(undefined);
      setAnnouncement('Pending invitation cancelled. Its one-time code can no longer be used.');
      await load(selectedHouseholdId);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function revokeRelationship(relationshipId: string) {
    setBusy(relationshipId);
    setError('');
    try {
      await apiRequest(`/v1/family/relationships/${encodeURIComponent(relationshipId)}`, {
        method: 'DELETE',
        headers: { 'X-BB-Household-Id': selectedHouseholdId },
      });
      const refreshed = await refreshPrincipal();
      const refreshedScope = refreshed.me.principal.households.find(
        (scope) => scope.id === selectedHouseholdId,
      );
      const canStillViewFamily =
        refreshedScope?.isAdministrator === true ||
        refreshedScope?.isProtectedMember === true ||
        (refreshedScope?.trustedCircleGrants.length ?? 0) > 0;
      if (canStillViewFamily) {
        await load(selectedHouseholdId);
      } else {
        setFamily(undefined);
        window.location.assign('/member');
      }
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  const currentHouseholdScope =
    selectedScope?.id === family?.household.id ? selectedScope : undefined;
  const isHouseholdAdministrator = currentHouseholdScope?.isAdministrator === true;
  const isProtectedMember =
    currentHouseholdScope?.isProtectedMember === true &&
    currentHouseholdScope.capabilities.includes('family:manage');

  return (
    <main id="main-content" className="member-shell member-main">
      <span className="eyebrow">Family</span>
      <h1 className="member-heading">Your household and Trusted Circle</h1>
      <p className="lede">
        Permissions describe exactly what another person may do. An invitation is local only and is
        not emailed or texted.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {announcement ? (
        <p className="notice" role="status" aria-live="polite">
          {announcement}
        </p>
      ) : null}
      <form
        className="card form-stack"
        onSubmit={reviewInvite}
        style={{ marginTop: '1.5rem' }}
        data-testid="accept-invitation"
      >
        <h2>Accept a local invitation</h2>
        <p>
          Sign in as the separately invited seeded person, then enter both one-time values given
          directly by the protected member who initiated the invitation. Review the named people,
          household, permission, and expiry before you decide.
        </p>
        <label htmlFor="invitation-id">Invitation ID</label>
        <input
          id="invitation-id"
          value={invitationId}
          required
          onChange={(event) => {
            setInvitationId(event.target.value);
            setPreview(undefined);
            setConsentConfirmed(false);
          }}
        />
        <label htmlFor="local-invite-code">One-time local invite code</label>
        <input
          id="local-invite-code"
          type="password"
          autoComplete="off"
          minLength={24}
          value={localInviteCode}
          required
          onChange={(event) => {
            setLocalInviteCode(event.target.value);
            setPreview(undefined);
            setConsentConfirmed(false);
          }}
        />
        <button
          className="button-primary"
          type="submit"
          disabled={busy === true || !invitationId || localInviteCode.length < 24}
        >
          Review invitation
        </button>
      </form>
      {preview ? (
        <section className="card form-stack" data-testid="invitation-preview">
          <span className="dev-pill">Review before accepting</span>
          <h2>Invitation consent details</h2>
          <dl className="definition-grid">
            <dt>Household</dt>
            <dd>{preview.invitation.household.name}</dd>
            <dt>Protected person</dt>
            <dd>{preview.invitation.protectedPerson.displayName}</dd>
            <dt>Requested permission</dt>
            <dd>
              {preview.invitation.permissions
                .map((permission) => permissionLabels[permission])
                .join('; ')}
            </dd>
            <dt>Expires</dt>
            <dd>{new Date(preview.invitation.expiresAt).toLocaleString()}</dd>
          </dl>
          <p className="help">
            Accepting does not share all history. The protected person must deliberately share each
            redacted result. Submitted messages and URLs are never included, and no notification is
            sent.
          </p>
          <label className="choice">
            <input
              type="checkbox"
              checked={consentConfirmed}
              onChange={(event) => setConsentConfirmed(event.target.checked)}
            />
            I reviewed the household, person, permission, and expiry and choose to accept.
          </label>
          <div className="button-row">
            <button
              className="button-primary"
              type="button"
              disabled={Boolean(busy) || !consentConfirmed}
              onClick={() => void acceptInvite()}
            >
              {busy ? 'Accepting…' : 'Accept invitation'}
            </button>
            <button className="button-secondary" type="button" onClick={cancelReview}>
              Cancel without accepting
            </button>
          </div>
        </section>
      ) : null}
      {accepted && (
        <p className="notice" role="status">
          Invitation accepted. The scoped Trusted Circle relationship is now active.
        </p>
      )}
      {family && (
        <>
          <section className="card" style={{ marginTop: '1.5rem' }}>
            <h2>{family.household.name}</h2>
            <ul className="plain-list">
              {family.members.map((member) => (
                <li key={member.membershipId}>
                  <strong>{member.displayName}</strong> — member ({member.status})
                  {member.isAdministrator ? ' · administrator' : ''}
                  {member.isProtectedMember ? ' · protected adult' : ''}
                </li>
              ))}
            </ul>
          </section>
          <div className="member-grid">
            <section className="card">
              <h2>Active Trusted Circle</h2>
              {family.relationships.filter((item) => item.state === 'active').length ? (
                <ul className="plain-list">
                  {family.relationships
                    .filter((item) => item.state === 'active')
                    .map((item) => (
                      <li key={item.id}>
                        <strong>{item.trustedDisplayName}</strong>
                        <div className="meta">
                          {item.permissions
                            .map((permission) => permissionLabels[permission])
                            .join('; ')}
                        </div>
                        {(isHouseholdAdministrator ||
                          item.protectedPersonId === me.principal.personId ||
                          item.trustedPersonId === me.principal.personId) && (
                          <button
                            className="button-danger"
                            type="button"
                            disabled={busy === item.id}
                            onClick={() => void revokeRelationship(item.id)}
                          >
                            {busy === item.id ? 'Revoking…' : 'Revoke access'}
                          </button>
                        )}
                      </li>
                    ))}
                </ul>
              ) : (
                <p>No active trusted relationships.</p>
              )}
            </section>
            <section className="card">
              <h2>Pending invitations</h2>
              {family.invitations.filter((item) => item.state === 'pending').length ? (
                <ul className="plain-list">
                  {family.invitations
                    .filter((item) => item.state === 'pending')
                    .map((item) => (
                      <li key={item.id}>
                        <strong>{item.inviteeDisplayName}</strong>
                        <div className="meta">
                          Expires {new Date(item.expiresAt).toLocaleDateString()} · Local only
                        </div>
                        {isHouseholdAdministrator ||
                        item.protectedPersonId === me.principal.personId ? (
                          confirmingInvitationId === item.id ? (
                            <div className="form-stack">
                              <p>
                                Cancel this pending invitation? Its one-time code will stop working.
                              </p>
                              <div className="button-row">
                                <button
                                  className="button-danger"
                                  type="button"
                                  disabled={busy === item.id}
                                  onClick={() => void cancelPendingInvitation(item.id)}
                                >
                                  {busy === item.id ? 'Cancelling…' : 'Yes, cancel invitation'}
                                </button>
                                <button
                                  className="button-secondary"
                                  type="button"
                                  onClick={() => setConfirmingInvitationId('')}
                                >
                                  Keep invitation
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              className="button-danger"
                              type="button"
                              onClick={() => setConfirmingInvitationId(item.id)}
                            >
                              Cancel invitation
                            </button>
                          )
                        ) : null}
                      </li>
                    ))}
                </ul>
              ) : (
                <p>No pending invitations.</p>
              )}
              <p className="help">Invite codes are deliberately not shown in this history.</p>
            </section>
          </div>
          {isProtectedMember && (
            <form className="card form-stack" onSubmit={createInvite} style={{ marginTop: '1rem' }}>
              <h2>Invite a trusted person</h2>
              <p>
                You are inviting a person into a relationship with you. An administrator cannot
                consent on your behalf, and the invited person must separately accept.
              </p>
              <label htmlFor="invitee-name">Trusted person’s display name</label>
              <input
                id="invitee-name"
                value={inviteeDisplayName}
                required
                maxLength={120}
                onChange={(event) => setInviteeDisplayName(event.target.value)}
              />
              <fieldset>
                <legend>Run 1 permission requested</legend>
                <p>{permissionLabels.view_shared_checks}</p>
              </fieldset>
              <p className="help">
                Orientation help and receive-escalation notification permissions are scaffolded but
                unavailable in this build. A broader generic consent activate/defer workflow is also
                deferred and is not represented as complete.
              </p>
              <button
                className="button-primary"
                disabled={Boolean(busy) || !canInvite}
                type="submit"
              >
                {busy ? 'Creating invitation…' : 'Create local invitation'}
              </button>
            </form>
          )}
          {created && (
            <section
              className="notice notice-warning"
              role="status"
              aria-live="polite"
              data-testid="invite-created"
            >
              <h2>Local invitation created</h2>
              <p>
                Share these one-time development values directly with the intended person. They are
                not sent automatically and will not appear again in invitation history.
              </p>
              <p>
                Invitation ID: <strong className="invite-id">{created.invitation.id}</strong>
              </p>
              <p>
                One-time code: <strong className="invite-code">{created.localInviteCode}</strong>
              </p>
              <p className="meta">
                Delivery: local only · Expires{' '}
                {new Date(created.invitation.expiresAt).toLocaleString()}
              </p>
            </section>
          )}
        </>
      )}
    </main>
  );
}
