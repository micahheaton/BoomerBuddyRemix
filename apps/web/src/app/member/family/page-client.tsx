'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  AcceptHouseholdMemberInvitationResponse,
  CreateHouseholdMemberInvitationResponse,
  CreateInvitationResponse,
  CreateRecipientConnectionCodeResponse,
  FamilyResponse,
  HouseholdMemberInvitationPreviewResponse,
  InvitationPreviewResponse,
  TrustedCirclePermissionDto,
} from '@boomerbuddy/contracts';
import { useHousehold } from '../../../components/household-context';
import { apiRequest, readableError } from '../../../lib/api';
import {
  householdBoundValue,
  householdRequestIsCurrent,
  type HouseholdBoundValue,
} from '../../../lib/household-request';

const permissionLabels: Record<TrustedCirclePermissionDto, string> = {
  view_shared_checks: 'View checks that are deliberately shared',
  receive_escalations: 'Escalation notifications are unavailable',
  help_with_orientation: 'Guided orientation help is unavailable',
};
type AcceptedInvitation = {
  relationship: { id: string };
  householdId: string;
  reused: boolean;
};

export default function FamilyPage() {
  const { me, selectedHouseholdId, selectedScope, refreshPrincipal } = useHousehold();
  const [familyState, setFamilyState] = useState<HouseholdBoundValue<FamilyResponse>>();
  const [inviteeDisplayName, setInviteeDisplayName] = useState('');
  const [recipientConnectionCode, setRecipientConnectionCode] = useState('');
  const [createdRecipientCode, setCreatedRecipientCode] =
    useState<CreateRecipientConnectionCodeResponse>();
  const [memberRecipientConnectionCode, setMemberRecipientConnectionCode] = useState('');
  const [memberInviteConsentConfirmed, setMemberInviteConsentConfirmed] = useState(false);
  const [createdMemberInvitation, setCreatedMemberInvitation] =
    useState<CreateHouseholdMemberInvitationResponse>();
  const [memberInvitationId, setMemberInvitationId] = useState('');
  const [memberInvitationCredential, setMemberInvitationCredential] = useState('');
  const [memberInvitationPreview, setMemberInvitationPreview] =
    useState<HouseholdMemberInvitationPreviewResponse>();
  const [memberAcceptanceConfirmed, setMemberAcceptanceConfirmed] = useState(false);
  const [acceptedMembership, setAcceptedMembership] =
    useState<AcceptHouseholdMemberInvitationResponse>();
  const [confirmingMemberInvitationId, setConfirmingMemberInvitationId] = useState('');
  const [confirmingMembershipId, setConfirmingMembershipId] = useState('');
  const [inviteConsentConfirmed, setInviteConsentConfirmed] = useState(false);
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
  const [reloadVersion, setReloadVersion] = useState(0);
  const selectedHouseholdIdRef = useRef(selectedHouseholdId);
  const loadGenerationRef = useRef(0);
  const mutationGenerationRef = useRef(0);
  const mutationControllerRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    selectedHouseholdIdRef.current = selectedHouseholdId;
  }, [selectedHouseholdId]);

  useEffect(() => {
    mutationGenerationRef.current += 1;
    mutationControllerRef.current?.abort();
    mutationControllerRef.current = undefined;
    const reset = window.setTimeout(() => {
      setFamilyState(undefined);
      setMemberRecipientConnectionCode('');
      setMemberInviteConsentConfirmed(false);
      setCreatedMemberInvitation(undefined);
      setConfirmingMemberInvitationId('');
      setConfirmingMembershipId('');
      setInviteeDisplayName('');
      setRecipientConnectionCode('');
      setInviteConsentConfirmed(false);
      setCreated(undefined);
      setConfirmingInvitationId('');
      setBusy(false);
      setError('');
      setAnnouncement('');
    }, 0);
    return () => window.clearTimeout(reset);
  }, [selectedHouseholdId]);

  useEffect(() => {
    const householdId = selectedHouseholdId;
    const generation = ++loadGenerationRef.current;
    if (!householdId) return;
    const controller = new AbortController();
    const attempt = { householdId, generation };
    const requestIsCurrent = (): boolean =>
      !controller.signal.aborted &&
      householdRequestIsCurrent(attempt, {
        householdId: selectedHouseholdIdRef.current,
        generation: loadGenerationRef.current,
      });
    void apiRequest<FamilyResponse>('/v1/family', {
      headers: { 'X-BB-Household-Id': householdId },
      signal: controller.signal,
    })
      .then((response) => {
        if (!requestIsCurrent()) return;
        if (response.household.id !== householdId) {
          setError('BoomerBuddy returned a different household. Switch households and retry.');
          return;
        }
        setFamilyState({ householdId, value: response });
      })
      .catch((caught) => {
        if (requestIsCurrent()) setError(readableError(caught));
      });
    return () => controller.abort();
  }, [reloadVersion, selectedHouseholdId]);

  useEffect(
    () => () => {
      mutationGenerationRef.current += 1;
      mutationControllerRef.current?.abort();
    },
    [],
  );

  function beginHouseholdMutation(householdId: string) {
    mutationControllerRef.current?.abort();
    const controller = new AbortController();
    mutationControllerRef.current = controller;
    const generation = ++mutationGenerationRef.current;
    const attempt = { householdId, generation };
    return {
      signal: controller.signal,
      isCurrent: (): boolean =>
        !controller.signal.aborted &&
        householdRequestIsCurrent(attempt, {
          householdId: selectedHouseholdIdRef.current,
          generation: mutationGenerationRef.current,
        }),
    };
  }

  const family = householdBoundValue(familyState, selectedHouseholdId);
  const production = process.env.NODE_ENV === 'production';
  const canInvite =
    inviteConsentConfirmed &&
    (production ? recipientConnectionCode.trim().length >= 32 : Boolean(inviteeDisplayName.trim()));

  async function createRecipientCode() {
    setBusy('recipient-code');
    setError('');
    setCreatedRecipientCode(undefined);
    try {
      const response = await apiRequest<CreateRecipientConnectionCodeResponse>(
        '/v1/family/recipient-connection-codes',
        { method: 'POST', body: JSON.stringify({}) },
      );
      setCreatedRecipientCode(response);
      setAnnouncement(
        'A new connection code was created. Any earlier connection code has stopped working.',
      );
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function copyRecipientCode() {
    if (!createdRecipientCode) return;
    try {
      await navigator.clipboard.writeText(createdRecipientCode.recipientConnectionCode);
      setAnnouncement('Connection code copied. Give it only to the person you want to invite you.');
    } catch {
      setAnnouncement('Copy was unavailable. Select the connection code and copy it manually.');
    }
  }

  async function createMemberInvite(event: FormEvent) {
    event.preventDefault();
    const householdId = selectedHouseholdId;
    if (
      !memberInviteConsentConfirmed ||
      memberRecipientConnectionCode.trim().length < 32 ||
      !householdId
    ) {
      return;
    }
    const operation = beginHouseholdMutation(householdId);
    const connectionCode = memberRecipientConnectionCode.trim();
    setBusy('member-invitation-create');
    setError('');
    setCreatedMemberInvitation(undefined);
    try {
      const response = await apiRequest<CreateHouseholdMemberInvitationResponse>(
        '/v1/family/member-invitations',
        {
          method: 'POST',
          headers: { 'X-BB-Household-Id': householdId },
          signal: operation.signal,
          body: JSON.stringify({
            recipientConnectionCode: connectionCode,
          }),
        },
      );
      if (!operation.isCurrent()) return;
      setCreatedMemberInvitation(response);
      setMemberRecipientConnectionCode('');
      setMemberInviteConsentConfirmed(false);
      setAnnouncement(
        response.reused
          ? 'The existing member invitation was recovered. Give its ID to the intended adult.'
          : 'Member invitation created. Give its ID to the intended adult; they already hold the connection code needed to accept.',
      );
      setReloadVersion((version) => version + 1);
    } catch (caught) {
      if (operation.isCurrent()) setError(readableError(caught));
    } finally {
      if (operation.isCurrent()) setBusy(false);
    }
  }

  async function reviewMemberInvite(event: FormEvent) {
    event.preventDefault();
    setBusy('member-invitation-preview');
    setError('');
    setMemberInvitationPreview(undefined);
    setMemberAcceptanceConfirmed(false);
    try {
      const response = await apiRequest<HouseholdMemberInvitationPreviewResponse>(
        `/v1/family/member-invitations/${encodeURIComponent(memberInvitationId)}/preview`,
        {
          method: 'POST',
          body: JSON.stringify({ invitationCredential: memberInvitationCredential }),
        },
      );
      setMemberInvitationPreview(response);
      setAnnouncement('Household membership details are ready to review. Nothing changed yet.');
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function acceptMemberInvite() {
    if (!memberInvitationPreview || !memberAcceptanceConfirmed) return;
    const acceptedHouseholdId = memberInvitationPreview.invitation.household.id;
    setBusy('member-invitation-accept');
    setError('');
    setAcceptedMembership(undefined);
    try {
      const response = await apiRequest<AcceptHouseholdMemberInvitationResponse>(
        `/v1/family/member-invitations/${encodeURIComponent(memberInvitationId)}/accept`,
        {
          method: 'POST',
          body: JSON.stringify({
            invitationCredential: memberInvitationCredential,
            previewVersion: memberInvitationPreview.invitation.previewVersion,
          }),
        },
      );
      if (response.membership.householdId !== acceptedHouseholdId) {
        throw new Error('The accepted household did not match the invitation you reviewed.');
      }
      setAcceptedMembership(response);
      setMemberInvitationPreview(undefined);
      setMemberAcceptanceConfirmed(false);
      setMemberInvitationId('');
      setMemberInvitationCredential('');
      const refreshed = await refreshPrincipal(acceptedHouseholdId);
      if (
        !refreshed.me.principal.households.some((scope) => scope.id === acceptedHouseholdId) ||
        refreshed.selectedHouseholdId !== acceptedHouseholdId
      ) {
        throw new Error(
          'Membership was accepted, but the reviewed household is not available in this session.',
        );
      }
      setAnnouncement(
        'Household membership is active. Protection and Trusted Circle access remain off until you choose them separately.',
      );
      setReloadVersion((version) => version + 1);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  function cancelMemberReview() {
    setMemberInvitationPreview(undefined);
    setMemberAcceptanceConfirmed(false);
    setAnnouncement('Household membership review cancelled. Nothing changed.');
  }

  async function cancelPendingMemberInvitation(invitationIdToCancel: string) {
    const householdId = selectedHouseholdId;
    if (!householdId) return;
    const operation = beginHouseholdMutation(householdId);
    setBusy(invitationIdToCancel);
    setError('');
    try {
      await apiRequest(
        `/v1/family/member-invitations/${encodeURIComponent(invitationIdToCancel)}`,
        {
          method: 'DELETE',
          headers: { 'X-BB-Household-Id': householdId },
          signal: operation.signal,
        },
      );
      if (!operation.isCurrent()) return;
      setConfirmingMemberInvitationId('');
      if (createdMemberInvitation?.invitation.id === invitationIdToCancel) {
        setCreatedMemberInvitation(undefined);
      }
      setAnnouncement('Pending household member invitation revoked.');
      setReloadVersion((version) => version + 1);
    } catch (caught) {
      if (operation.isCurrent()) setError(readableError(caught));
    } finally {
      if (operation.isCurrent()) setBusy(false);
    }
  }

  async function removeNeutralMembership(membershipId: string, removingSelf: boolean) {
    const householdId = selectedHouseholdId;
    if (!householdId) return;
    const operation = beginHouseholdMutation(householdId);
    setBusy(membershipId);
    setError('');
    try {
      await apiRequest(`/v1/family/members/${encodeURIComponent(membershipId)}`, {
        method: 'DELETE',
        headers: { 'X-BB-Household-Id': householdId },
        signal: operation.signal,
      });
      if (!operation.isCurrent()) return;
      setConfirmingMembershipId('');
      setAnnouncement(
        removingSelf
          ? 'You left the household. No protected or Trusted Circle authority was changed.'
          : 'The neutral household membership was removed.',
      );
      const refreshed = await refreshPrincipal();
      if (removingSelf) {
        setFamilyState(undefined);
        window.location.assign('/member');
        return;
      }
      if (!operation.isCurrent()) return;
      if (refreshed.selectedHouseholdId !== householdId) {
        setFamilyState(undefined);
        window.location.assign('/member');
        return;
      }
      setReloadVersion((version) => version + 1);
    } catch (caught) {
      if (operation.isCurrent()) setError(readableError(caught));
    } finally {
      if (operation.isCurrent()) setBusy(false);
    }
  }

  async function createInvite(event: FormEvent) {
    event.preventDefault();
    const householdId = selectedHouseholdId;
    if (!canInvite || !householdId) return;
    const operation = beginHouseholdMutation(householdId);
    const connectionCode = recipientConnectionCode.trim();
    const localDisplayName = inviteeDisplayName;
    setBusy(true);
    setError('');
    setCreated(undefined);
    try {
      const response = await apiRequest<CreateInvitationResponse>('/v1/family/invitations', {
        method: 'POST',
        headers: { 'X-BB-Household-Id': householdId },
        signal: operation.signal,
        body: JSON.stringify({
          ...(production
            ? { recipientConnectionCode: connectionCode }
            : { inviteeDisplayName: localDisplayName }),
          permissions: ['view_shared_checks'],
        }),
      });
      if (!operation.isCurrent()) return;
      setCreated(response);
      setInviteeDisplayName('');
      setRecipientConnectionCode('');
      setInviteConsentConfirmed(false);
      setAnnouncement(
        response.delivery === 'recipient_manual_only'
          ? response.reused
            ? 'The existing Trusted Circle invitation was recovered. Give its invitation ID to the intended person; their connection code is still the credential.'
            : 'Invitation created. Give the invitation ID to the intended person; they already hold the connection code needed to review and accept.'
          : 'Local invitation created. Give its invitation ID and one-time credential directly to the intended person.',
      );
      setReloadVersion((version) => version + 1);
    } catch (caught) {
      if (operation.isCurrent()) setError(readableError(caught));
    } finally {
      if (operation.isCurrent()) setBusy(false);
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
      setAnnouncement(
        response.reused
          ? 'This invitation was already accepted. The same Trusted Circle access remains active.'
          : 'Invitation accepted. Trusted Circle access is now active.',
      );
      const refreshed = await refreshPrincipal(acceptedHouseholdId);
      if (
        !refreshed.me.principal.households.some((scope) => scope.id === acceptedHouseholdId) ||
        refreshed.selectedHouseholdId !== acceptedHouseholdId
      ) {
        throw new Error(
          'Invitation accepted, but the reviewed household is not available in this session.',
        );
      }
      setReloadVersion((version) => version + 1);
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
    const householdId = selectedHouseholdId;
    if (!householdId) return;
    const operation = beginHouseholdMutation(householdId);
    setBusy(invitationIdToCancel);
    setError('');
    try {
      await apiRequest(`/v1/family/invitations/${encodeURIComponent(invitationIdToCancel)}`, {
        method: 'DELETE',
        headers: { 'X-BB-Household-Id': householdId },
        signal: operation.signal,
      });
      if (!operation.isCurrent()) return;
      setConfirmingInvitationId('');
      if (created?.invitation.id === invitationIdToCancel) setCreated(undefined);
      setAnnouncement('Pending invitation cancelled. Its one-time code can no longer be used.');
      setReloadVersion((version) => version + 1);
    } catch (caught) {
      if (operation.isCurrent()) setError(readableError(caught));
    } finally {
      if (operation.isCurrent()) setBusy(false);
    }
  }

  async function revokeRelationship(relationshipId: string) {
    const householdId = selectedHouseholdId;
    if (!householdId) return;
    const operation = beginHouseholdMutation(householdId);
    setBusy(relationshipId);
    setError('');
    try {
      await apiRequest(`/v1/family/relationships/${encodeURIComponent(relationshipId)}`, {
        method: 'DELETE',
        headers: { 'X-BB-Household-Id': householdId },
        signal: operation.signal,
      });
      if (!operation.isCurrent()) return;
      const refreshed = await refreshPrincipal();
      if (!operation.isCurrent()) return;
      const refreshedScope = refreshed.me.principal.households.find(
        (scope) => scope.id === householdId,
      );
      const canStillViewFamily =
        refreshedScope?.isAdministrator === true ||
        refreshedScope?.isProtectedMember === true ||
        (refreshedScope?.trustedCircleGrants.length ?? 0) > 0;
      if (canStillViewFamily) {
        setReloadVersion((version) => version + 1);
      } else {
        setFamilyState(undefined);
        window.location.assign('/member');
      }
    } catch (caught) {
      if (operation.isCurrent()) setError(readableError(caught));
    } finally {
      if (operation.isCurrent()) setBusy(false);
    }
  }

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
        member.personId === me.principal.personId,
    );
  const trustedPersonCanUseSafeWord = family?.relationships.some(
    (relationship) =>
      relationship.state === 'active' &&
      relationship.trustedPersonId === me.principal.personId &&
      family.members.some(
        (member) =>
          member.status === 'active' &&
          member.isProtectedMember &&
          member.personId === relationship.protectedPersonId,
      ),
  );

  return (
    <main id="main-content" className="member-shell member-main">
      <span className="eyebrow">Family</span>
      <h1 className="member-heading">Your household and Trusted Circle</h1>
      <p className="lede">
        Permissions describe exactly what another person may do. An invitation is manually handed to
        the intended person and is not emailed or texted by BoomerBuddy.
      </p>
      {error && (
        <div className="form-stack" role="alert">
          <p className="error">{error}</p>
          <p className="help">
            If BoomerBuddy says your sign-in is too old for a household access change, sign in again
            and retry that action.
          </p>
        </div>
      )}
      {announcement ? (
        <p className="notice" role="status" aria-live="polite">
          {announcement}
        </p>
      ) : null}
      {production ? (
        <>
          <form
            className="card form-stack"
            onSubmit={reviewMemberInvite}
            style={{ marginTop: '1.5rem' }}
            data-testid="accept-member-invitation"
          >
            <h2>Join a household</h2>
            <p>
              Use the invitation ID the household organizer gave you and the connection code you
              created and kept. Review the household and organizer before accepting. This first step
              adds only neutral membership.
            </p>
            <label htmlFor="member-invitation-id">Household invitation ID</label>
            <input
              id="member-invitation-id"
              value={memberInvitationId}
              required
              onChange={(event) => {
                setMemberInvitationId(event.target.value);
                setMemberInvitationPreview(undefined);
                setMemberAcceptanceConfirmed(false);
              }}
            />
            <label htmlFor="member-invitation-credential">
              Connection code you created for this invitation
            </label>
            <input
              id="member-invitation-credential"
              type="password"
              autoComplete="off"
              minLength={32}
              maxLength={600}
              value={memberInvitationCredential}
              required
              onChange={(event) => {
                setMemberInvitationCredential(event.target.value);
                setMemberInvitationPreview(undefined);
                setMemberAcceptanceConfirmed(false);
              }}
            />
            <button
              className="button-primary"
              type="submit"
              disabled={
                Boolean(busy) ||
                !memberInvitationId ||
                memberInvitationCredential.trim().length < 32
              }
            >
              {busy === 'member-invitation-preview'
                ? 'Reviewing membership…'
                : 'Review household membership'}
            </button>
          </form>
          {memberInvitationPreview ? (
            <section className="card form-stack" data-testid="member-invitation-preview">
              <span className="dev-pill">Review before joining</span>
              <h2>Neutral household membership</h2>
              <dl className="definition-grid">
                <dt>Household</dt>
                <dd>{memberInvitationPreview.invitation.household.name}</dd>
                <dt>Organizer</dt>
                <dd>{memberInvitationPreview.invitation.invitedBy.displayName}</dd>
                <dt>Account being invited</dt>
                <dd>{memberInvitationPreview.invitation.inviteeDisplayName}</dd>
                <dt>Expires</dt>
                <dd>{new Date(memberInvitationPreview.invitation.expiresAt).toLocaleString()}</dd>
              </dl>
              <p className="help">
                Accepting does not make you a protected adult, household administrator, Trusted
                Circle helper, or billing manager. It shares no Check history. After joining, you
                may separately choose protection for yourself and later invite a helper with an
                explicit permission.
              </p>
              <label className="choice">
                <input
                  type="checkbox"
                  checked={memberAcceptanceConfirmed}
                  onChange={(event) => setMemberAcceptanceConfirmed(event.target.checked)}
                />
                I reviewed this exact household and choose to join as a member only.
              </label>
              <div className="button-row">
                <button
                  className="button-primary"
                  type="button"
                  disabled={Boolean(busy) || !memberAcceptanceConfirmed}
                  onClick={() => void acceptMemberInvite()}
                >
                  {busy === 'member-invitation-accept' ? 'Joining household…' : 'Join household'}
                </button>
                <button className="button-secondary" type="button" onClick={cancelMemberReview}>
                  Cancel without joining
                </button>
              </div>
            </section>
          ) : null}
          {acceptedMembership ? (
            <section className="notice" role="status" aria-live="polite">
              <h2>Household joined</h2>
              <p>
                You are a neutral member. No protection, Trusted Circle, administrator, billing, or
                Check access was granted.
              </p>
              <a className="button-primary" href="/member/protection">
                Review protection for myself
              </a>
            </section>
          ) : null}
        </>
      ) : null}
      <form
        className="card form-stack"
        onSubmit={reviewInvite}
        style={{ marginTop: '1.5rem' }}
        data-testid="accept-invitation"
      >
        <h2>Accept an invitation</h2>
        <p>
          {production
            ? 'Sign in as the separately invited person. Enter the invitation ID the protected member gave you and the temporary connection code you created and kept. Review the named people, household, permission, and expiry before you decide.'
            : 'Sign in as the separately invited person. Enter the invitation ID and separate one-time credential the protected member gave you. Review the named people, household, permission, and expiry before you decide.'}
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
        <label htmlFor="local-invite-code">
          {production ? 'Your temporary connection code' : 'One-time invitation credential'}
        </label>
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
        <p className="help">
          If this action says your sign-in is too old, sign in again and retry.
        </p>
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
          Invitation accepted. The Trusted Circle relationship is now active.
        </p>
      )}
      {production ? (
        <section className="card form-stack" style={{ marginTop: '1.5rem' }}>
          <h2>Create a private connection code</h2>
          <p>
            Give this temporary code directly either to a household organizer who is adding you as a
            member or to a protected adult who is inviting you into their Trusted Circle. It
            identifies only your signed-in account and grants no access by itself.
          </p>
          <p className="help">
            A new code replaces any earlier code, expires after 24 hours, and can create only one
            invitation. BoomerBuddy does not email or text it.
          </p>
          <button
            className="button-secondary"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void createRecipientCode()}
          >
            {busy === 'recipient-code' ? 'Creating code…' : 'Create connection code'}
          </button>
          {createdRecipientCode ? (
            <div className="notice" role="status" aria-live="polite">
              <p>
                Connection code:{' '}
                <strong className="invite-code">
                  {createdRecipientCode.recipientConnectionCode}
                </strong>
              </p>
              <p className="meta">
                Expires {new Date(createdRecipientCode.expiresAt).toLocaleString()} · Manual sharing
                only
              </p>
              <button
                className="button-secondary"
                type="button"
                onClick={() => void copyRecipientCode()}
              >
                Copy connection code
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
      {family && (
        <>
          <section className="card" style={{ marginTop: '1.5rem' }}>
            <h2>{family.household.name}</h2>
            <ul className="plain-list">
              {family.members.map((member) => {
                const removingSelf = member.personId === me.principal.personId;
                const canRemoveNeutralMembership =
                  member.status === 'active' &&
                  !member.isAdministrator &&
                  !member.isProtectedMember &&
                  (isHouseholdAdministrator || removingSelf);
                return (
                  <li key={member.membershipId}>
                    <strong>{member.displayName}</strong> - member ({member.status})
                    {member.isAdministrator ? ' · administrator' : ''}
                    {member.isProtectedMember ? ' · protected adult' : ''}
                    {canRemoveNeutralMembership ? (
                      confirmingMembershipId === member.membershipId ? (
                        <div className="form-stack">
                          <p>
                            {removingSelf
                              ? 'Leave this household? This is allowed only while you have no active protected, Trusted Circle, administrator, or billing role.'
                              : 'Remove this neutral membership? Active protected, Trusted Circle, administrator, or billing roles must be ended first.'}
                          </p>
                          <div className="button-row">
                            <button
                              className="button-danger"
                              type="button"
                              disabled={busy === member.membershipId}
                              onClick={() =>
                                void removeNeutralMembership(member.membershipId, removingSelf)
                              }
                            >
                              {busy === member.membershipId
                                ? 'Updating…'
                                : removingSelf
                                  ? 'Yes, leave household'
                                  : 'Yes, remove member'}
                            </button>
                            <button
                              className="button-secondary"
                              type="button"
                              onClick={() => setConfirmingMembershipId('')}
                            >
                              Keep membership
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="button-danger"
                          type="button"
                          onClick={() => setConfirmingMembershipId(member.membershipId)}
                        >
                          {removingSelf ? 'Leave household' : 'Remove member'}
                        </button>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
          {production && isHouseholdAdministrator ? (
            <>
              <form
                className="card form-stack"
                onSubmit={createMemberInvite}
                style={{ marginTop: '1rem' }}
              >
                <h2>Invite an adult to this household</h2>
                <p>
                  Ask the intended adult to sign in and create a private connection code above. This
                  invitation adds only neutral membership. The adult must accept it and then
                  separately choose whether to enroll as protected.
                </p>
                <label htmlFor="household-member-connection-code">
                  Intended adult&apos;s temporary connection code
                </label>
                <input
                  id="household-member-connection-code"
                  type="password"
                  autoComplete="off"
                  minLength={32}
                  maxLength={600}
                  value={memberRecipientConnectionCode}
                  required
                  onChange={(event) => setMemberRecipientConnectionCode(event.target.value)}
                />
                <p className="help">
                  Do not enter an email address or account-provider ID. BoomerBuddy does not email
                  or text this invitation.
                </p>
                <label className="choice">
                  <input
                    type="checkbox"
                    checked={memberInviteConsentConfirmed}
                    onChange={(event) => setMemberInviteConsentConfirmed(event.target.checked)}
                  />
                  I am inviting the exact signed-in account represented by this code as a household
                  member only.
                </label>
                <button
                  className="button-primary"
                  type="submit"
                  disabled={
                    Boolean(busy) ||
                    !memberInviteConsentConfirmed ||
                    memberRecipientConnectionCode.trim().length < 32
                  }
                >
                  {busy === 'member-invitation-create'
                    ? 'Creating household invitation…'
                    : 'Create household invitation'}
                </button>
              </form>
              {createdMemberInvitation ? (
                <section
                  className="notice notice-warning"
                  role="status"
                  aria-live="polite"
                  data-testid="member-invite-created"
                >
                  <h2>Household invitation created</h2>
                  <p>
                    Give the invitation ID directly to the intended adult. They use the connection
                    code they created as the one-time credential. Nothing is sent automatically.
                  </p>
                  <p>
                    Invitation ID:{' '}
                    <strong className="invite-id">{createdMemberInvitation.invitation.id}</strong>
                  </p>
                  <p className="meta">
                    {createdMemberInvitation.reused ? 'Recovered invitation' : 'New invitation'} ·
                    Member only · Expires{' '}
                    {new Date(createdMemberInvitation.invitation.expiresAt).toLocaleString()}
                  </p>
                </section>
              ) : null}
              <section className="card" style={{ marginTop: '1rem' }}>
                <h2>Pending household member invitations</h2>
                {family.memberInvitations.length ? (
                  <ul className="plain-list">
                    {family.memberInvitations.map((invitation) => (
                      <li key={invitation.id}>
                        <strong>{invitation.inviteeDisplayName}</strong>
                        <div className="meta">
                          Member only · Expires {new Date(invitation.expiresAt).toLocaleString()} ·
                          Not sent automatically
                        </div>
                        {confirmingMemberInvitationId === invitation.id ? (
                          <div className="form-stack">
                            <p>
                              Revoke this invitation? Its one-time credential will stop working.
                            </p>
                            <div className="button-row">
                              <button
                                className="button-danger"
                                type="button"
                                disabled={busy === invitation.id}
                                onClick={() => void cancelPendingMemberInvitation(invitation.id)}
                              >
                                {busy === invitation.id ? 'Revoking…' : 'Yes, revoke invitation'}
                              </button>
                              <button
                                className="button-secondary"
                                type="button"
                                onClick={() => setConfirmingMemberInvitationId('')}
                              >
                                Keep invitation
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            className="button-danger"
                            type="button"
                            onClick={() => setConfirmingMemberInvitationId(invitation.id)}
                          >
                            Revoke invitation
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No pending household member invitations.</p>
                )}
              </section>
            </>
          ) : null}
          {protectedSelfCanUseSafeWord || trustedPersonCanUseSafeWord ? (
            <section className="card" style={{ marginTop: '1rem' }}>
              <h2>Family verification aid</h2>
              <p>
                A protected adult can replace or disable their family safe word. An exact active
                trusted person can privately check a phrase. A match is a social aid, not identity
                proof.
              </p>
              <Link className="button button-secondary" href="/member/family/safe-word">
                Open family verification aid
              </Link>
            </section>
          ) : null}
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
                          Expires {new Date(item.expiresAt).toLocaleDateString()} · Not sent
                          automatically
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
          {isProtectedMember ? (
            <form className="card form-stack" onSubmit={createInvite} style={{ marginTop: '1rem' }}>
              <h2>Invite a trusted person</h2>
              <p>
                You are inviting a person into a relationship with you. An administrator cannot
                consent on your behalf, and the invited person must separately accept.
              </p>
              {production ? (
                <>
                  <label htmlFor="recipient-connection-code">
                    Trusted person&apos;s temporary connection code
                  </label>
                  <input
                    id="recipient-connection-code"
                    type="password"
                    autoComplete="off"
                    minLength={32}
                    maxLength={600}
                    value={recipientConnectionCode}
                    required
                    onChange={(event) => setRecipientConnectionCode(event.target.value)}
                  />
                  <p className="help">
                    Ask the intended person to sign in, open Family, and create this code. Do not
                    use an email address, account-provider ID, or another person&apos;s code.
                  </p>
                </>
              ) : (
                <>
                  <label htmlFor="invitee-name">Trusted person’s display name</label>
                  <input
                    id="invitee-name"
                    value={inviteeDisplayName}
                    required
                    maxLength={120}
                    onChange={(event) => setInviteeDisplayName(event.target.value)}
                  />
                </>
              )}
              <fieldset>
                <legend>Permission requested</legend>
                <p>{permissionLabels.view_shared_checks}</p>
              </fieldset>
              <p className="help">
                This invitation permits only deliberate sharing of redacted Check results. It does
                not turn on notifications or broader account access.
              </p>
              <label className="choice">
                <input
                  type="checkbox"
                  checked={inviteConsentConfirmed}
                  onChange={(event) => setInviteConsentConfirmed(event.target.checked)}
                />
                I choose to invite this exact person to view only the Check results I deliberately
                share.
              </label>
              <button
                className="button-primary"
                disabled={Boolean(busy) || !canInvite}
                type="submit"
              >
                {busy ? 'Creating invitation…' : 'Create invitation'}
              </button>
            </form>
          ) : null}
          {created ? (
            <section
              className="notice notice-warning"
              role="status"
              aria-live="polite"
              data-testid="invite-created"
            >
              <h2>{production ? 'Invitation created' : 'Local invitation created'}</h2>
              <p>
                {created.delivery === 'recipient_manual_only'
                  ? 'Share the invitation ID directly with the intended person. They must use the temporary connection code they already created; BoomerBuddy does not send anything automatically.'
                  : 'Share these one-time values directly with the intended person. They are not sent automatically and the credential will not appear again in invitation history.'}
              </p>
              <p>
                Invitation ID: <strong className="invite-id">{created.invitation.id}</strong>
              </p>
              {created.delivery === 'local_only' ? (
                <p>
                  One-time code: <strong className="invite-code">{created.localInviteCode}</strong>
                </p>
              ) : (
                <p className="help">
                  Credential: intended person&apos;s connection code. It is never shown or stored in
                  plaintext here.
                </p>
              )}
              <p className="meta">
                Delivery: {created.delivery.replaceAll('_', ' ')} · Expires{' '}
                {new Date(created.invitation.expiresAt).toLocaleString()}
              </p>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
