import { randomBytes } from 'node:crypto';
import { DomainError, type Audience } from '@boomerbuddy/domain';
import { constantTimeEqual, fingerprintMinimized } from '@boomerbuddy/security';
import type { Database } from './database';
import {
  allocateCommerceAllowance,
  EntitlementRepository,
  hasEffectiveProtectedEnrollment,
  rebindCommerceAllowanceToEffectiveGrant,
  releaseCommerceAllowance,
  type EntitlementRuntimeEnvironment,
} from './entitlements';
import { writeAuditAndOutbox } from './events';
import { appendConsentEvidence, identityEvidenceForPerson } from './consent';
import {
  asDate,
  jsonParameter,
  jsonValue,
  randomIdFactory,
  stringArray,
  type IdFactory,
} from './values';

export type TrustedPermission =
  'view_shared_checks' | 'receive_escalations' | 'help_with_orientation';

export interface FamilyMemberRecord {
  readonly membershipId: string;
  readonly personId: string;
  readonly displayName: string;
  readonly membershipKind: 'member';
  readonly isAdministrator: boolean;
  readonly isProtectedMember: boolean;
  readonly status: 'active' | 'revoked';
}

export interface InvitationRecord {
  readonly id: string;
  readonly protectedPersonId: string;
  readonly inviteeDisplayName: string;
  readonly permissions: readonly TrustedPermission[];
  readonly state: 'pending' | 'accepted' | 'expired' | 'revoked' | 'withdrawn';
  readonly identityBindingState: 'development_unbound' | 'verified_identity';
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface RelationshipRecord {
  readonly id: string;
  readonly protectedPersonId: string;
  readonly trustedPersonId: string;
  readonly trustedDisplayName: string;
  readonly permissions: readonly TrustedPermission[];
  readonly state: 'active' | 'withdrawn' | 'relinquished' | 'suspended' | 'revoked';
  readonly consentVersion: string;
  readonly createdAt: Date;
  readonly endedAction?: 'withdraw' | 'relinquish' | 'suspend' | 'legacy_revoke';
  readonly endedAt?: Date;
}

interface HouseholdRow extends Record<string, unknown> {
  readonly id: string;
  readonly name: string;
}

interface MemberRow extends Record<string, unknown> {
  readonly membership_id: string;
  readonly person_id: string;
  readonly display_name: string;
  readonly membership_kind: 'member';
  readonly status: FamilyMemberRecord['status'];
  readonly is_administrator: boolean;
  readonly protected_grant_id: string | null;
}

interface InvitationRow extends Record<string, unknown> {
  readonly household_id: string;
  readonly id: string;
  readonly protected_person_id: string;
  readonly consent_id: string;
  readonly consent_version?: string;
  readonly latest_consent_evidence_id: string;
  readonly invitee_display_name: string;
  readonly invite_code_fingerprint: string;
  readonly fingerprint_key_version: number;
  readonly permissions: unknown;
  readonly state: InvitationRecord['state'];
  readonly identity_binding_state: InvitationRecord['identityBindingState'];
  readonly intended_identity_issuer: string | null;
  readonly intended_identity_subject: string | null;
  readonly intended_person_id?: string | null;
  readonly expires_at: unknown;
  readonly created_at: unknown;
}

interface RelationshipRow extends Record<string, unknown> {
  readonly id: string;
  readonly protected_person_id: string;
  readonly trusted_person_id: string;
  readonly trusted_display_name: string;
  readonly permissions: unknown;
  readonly state: RelationshipRecord['state'];
  readonly consent_version: string;
  readonly created_at: unknown;
  readonly ended_action: NonNullable<RelationshipRecord['endedAction']> | null;
  readonly ended_at: unknown | null;
}

interface ConsentRow extends Record<string, unknown> {
  readonly id: string;
  readonly consent_version: string;
  readonly latest_evidence_id: string;
}

export interface InvitationCredentialRecord extends InvitationRecord {
  readonly householdId: string;
  readonly consentVersion: string;
  readonly latestConsentEvidenceId: string;
  readonly invitedPersonId?: string;
}

export interface InvitationPreviewRecord {
  readonly id: string;
  readonly household: { readonly id: string; readonly name: string };
  readonly protectedPerson: { readonly id: string; readonly displayName: string };
  readonly permissions: readonly TrustedPermission[];
  readonly state: 'pending';
  readonly identityBindingState: InvitationRecord['identityBindingState'];
  readonly invitedPersonId?: string;
  readonly expiresAt: Date;
  readonly previewVersion: string;
}

export interface RelationshipScopeRecord {
  readonly id: string;
  readonly householdId: string;
  readonly protectedPersonId: string;
  readonly trustedPersonId: string;
}

function permissions(value: unknown): readonly TrustedPermission[] {
  return stringArray(jsonValue(value), 'permissions') as readonly TrustedPermission[];
}

function invitationFromRow(row: InvitationRow): InvitationRecord {
  return {
    id: row.id,
    protectedPersonId: row.protected_person_id,
    inviteeDisplayName: row.invitee_display_name,
    permissions: permissions(row.permissions),
    state: row.state,
    identityBindingState: row.identity_binding_state,
    expiresAt: asDate(row.expires_at, 'invitations.expires_at'),
    createdAt: asDate(row.created_at, 'invitations.created_at'),
  };
}

export class FamilyRepository {
  constructor(
    private readonly database: Database,
    private readonly fingerprintKey: Uint8Array,
    private readonly fingerprintKeyVersion: number,
    private readonly idFactory: IdFactory = randomIdFactory,
    private readonly runtimeEnvironment: EntitlementRuntimeEnvironment = 'production',
  ) {}

  async list(
    householdId: string,
    actorPersonId: string,
    now: Date,
  ): Promise<{
    readonly household: { readonly id: string; readonly name: string };
    readonly members: readonly FamilyMemberRecord[];
    readonly relationships: readonly RelationshipRecord[];
    readonly invitations: readonly InvitationRecord[];
  } | null> {
    const household = await this.database.query<HouseholdRow>(
      'SELECT id, name FROM households WHERE id = $1',
      [householdId],
    );
    const householdRow = household.rows[0];
    if (householdRow === undefined) return null;
    const actorMembership = await this.database.query<MemberRow>(
      `SELECT m.id AS membership_id, m.person_id, p.display_name, m.membership_kind, m.status,
              EXISTS (
                SELECT 1 FROM household_administrator_assignments administrator
                WHERE administrator.household_id = m.household_id
                  AND administrator.person_id = m.person_id
                  AND administrator.status = 'active'
              ) AS is_administrator,
              a.entitlement_grant_id AS protected_grant_id
       FROM household_memberships m JOIN persons p ON p.id = m.person_id
       LEFT JOIN protected_members pm
         ON pm.household_id = m.household_id AND pm.person_id = m.person_id
        AND pm.status = 'accepted'
       LEFT JOIN commerce_allowance_allocations a
         ON a.household_id = pm.household_id AND a.id = pm.allowance_allocation_id
        AND a.state = 'active' AND a.allowance_key = 'protected_members'
        AND a.subject_kind = 'protected_member' AND a.subject_id = pm.person_id
       WHERE m.household_id = $1 AND m.person_id = $2 AND m.status = 'active'`,
      [householdId, actorPersonId],
    );
    const actor = actorMembership.rows[0];
    if (actor === undefined) return null;
    const members = await this.database.query<MemberRow>(
      `SELECT m.id AS membership_id, m.person_id, p.display_name, m.membership_kind, m.status,
              EXISTS (
                SELECT 1 FROM household_administrator_assignments administrator
                WHERE administrator.household_id = m.household_id
                  AND administrator.person_id = m.person_id
                  AND administrator.status = 'active'
              ) AS is_administrator,
              a.entitlement_grant_id AS protected_grant_id
       FROM household_memberships m JOIN persons p ON p.id = m.person_id
       LEFT JOIN protected_members pm
         ON pm.household_id = m.household_id AND pm.person_id = m.person_id
        AND pm.status = 'accepted'
       LEFT JOIN commerce_allowance_allocations a
         ON a.household_id = pm.household_id AND a.id = pm.allowance_allocation_id
        AND a.state = 'active' AND a.allowance_key = 'protected_members'
        AND a.subject_kind = 'protected_member' AND a.subject_id = pm.person_id
       WHERE m.household_id = $1 ORDER BY m.created_at`,
      [householdId],
    );
    const relationships = await this.database.query<RelationshipRow>(
      `SELECT t.id, t.protected_person_id, t.trusted_person_id,
              p.display_name AS trusted_display_name, t.permissions, t.state,
               t.consent_version, t.created_at, t.ended_action, t.ended_at
       FROM trusted_circle_relationships t JOIN persons p ON p.id = t.trusted_person_id
       WHERE t.household_id = $1 ORDER BY t.created_at`,
      [householdId],
    );
    const visibleRelationships = relationships.rows.filter((row) => {
      if (actor.is_administrator) return true;
      return row.protected_person_id === actorPersonId || row.trusted_person_id === actorPersonId;
    });
    const visiblePersonIds = new Set<string>([actorPersonId]);
    for (const relationship of visibleRelationships) {
      visiblePersonIds.add(relationship.protected_person_id);
      visiblePersonIds.add(relationship.trusted_person_id);
    }
    const visibleMembers = actor.is_administrator
      ? members.rows
      : members.rows.filter((row) => visiblePersonIds.has(row.person_id));
    const entitlements = await new EntitlementRepository(
      this.database,
      undefined,
      this.runtimeEnvironment,
    ).forHousehold(householdId, now);
    const contributingGrantIds = new Set<string>(entitlements.portfolio.contributingGrantIds);
    const invitationRows = await this.database.query<InvitationRow>(
      `SELECT household_id, id, protected_person_id, consent_id, invitee_display_name,
                   latest_consent_evidence_id, invite_code_fingerprint,
                   fingerprint_key_version, permissions, state, identity_binding_state,
                   intended_identity_issuer, intended_identity_subject, expires_at, created_at
           FROM invitations WHERE household_id = $1 AND state = 'pending' AND expires_at > $4
              AND ($2 = true OR protected_person_id = $3)
            ORDER BY created_at`,
      [householdId, actor.is_administrator, actorPersonId, now.toISOString()],
    );
    return {
      household: { id: householdRow.id, name: householdRow.name },
      members: visibleMembers.map((row) => ({
        membershipId: row.membership_id,
        personId: row.person_id,
        displayName: row.display_name,
        membershipKind: row.membership_kind,
        isAdministrator: row.is_administrator,
        isProtectedMember:
          row.status === 'active' &&
          row.protected_grant_id !== null &&
          contributingGrantIds.has(row.protected_grant_id),
        status: row.status,
      })),
      relationships: visibleRelationships.map((row) => ({
        id: row.id,
        protectedPersonId: row.protected_person_id,
        trustedPersonId: row.trusted_person_id,
        trustedDisplayName: row.trusted_display_name,
        permissions: permissions(row.permissions),
        state: row.state,
        consentVersion: row.consent_version,
        createdAt: asDate(row.created_at, 'trusted_circle_relationships.created_at'),
        ...(row.ended_action === null ? {} : { endedAction: row.ended_action }),
        ...(row.ended_at === null
          ? {}
          : { endedAt: asDate(row.ended_at, 'trusted_circle_relationships.ended_at') }),
      })),
      invitations: invitationRows.rows.map(invitationFromRow),
    };
  }

  async canHelpOrientation(
    householdId: string,
    protectedPersonId: string,
    trustedPersonId: string,
  ): Promise<boolean> {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT 1 FROM trusted_circle_relationships t
       JOIN consent_current_projections c
         ON c.household_id = t.household_id AND c.consent_id = t.consent_id
        AND c.latest_evidence_id = t.latest_consent_evidence_id
       WHERE t.household_id = $1 AND t.protected_person_id = $2
         AND t.trusted_person_id = $3 AND t.state = 'active' AND c.state = 'active'
         AND t.permissions ? 'help_with_orientation'`,
      [householdId, protectedPersonId, trustedPersonId],
    );
    return result.rows.length > 0;
  }

  async createInvitation(input: {
    readonly householdId: string;
    readonly invitedByPersonId: string;
    readonly protectedPersonId: string;
    readonly inviteeDisplayName: string;
    readonly permissions: readonly TrustedPermission[];
    readonly audience: Audience;
    readonly actorIssuer: string;
    readonly intendedIdentity?: {
      readonly issuer: string;
      readonly subject: string;
    };
    readonly sessionId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<{ readonly invitation: InvitationRecord; readonly localInviteCode: string }> {
    if (input.invitedByPersonId !== input.protectedPersonId) {
      throw new DomainError(
        'not_authorized',
        'Only the protected member may create this invitation',
      );
    }
    if (input.intendedIdentity?.issuer === 'boomerbuddy-dev') {
      throw new DomainError(
        'invalid_input',
        'Development identities cannot be used as verified invitation bindings',
      );
    }
    if (input.actorIssuer !== 'boomerbuddy-dev' && input.intendedIdentity === undefined) {
      throw new DomainError(
        'invalid_input',
        'Verified identity binding is required outside development',
      );
    }
    const identityBindingState =
      input.intendedIdentity === undefined
        ? ('development_unbound' as const)
        : ('verified_identity' as const);
    const invitationId = this.idFactory.next('invitation');
    const consentId = this.idFactory.next('consent');
    const consentVersion = `self-invite-v2-${invitationId.slice(-12)}`;
    const secret = randomBytes(24).toString('base64url');
    const localInviteCode = `${invitationId}.${secret}`;
    const fingerprint = fingerprintMinimized(secret, this.fingerprintKey, {
      tenantId: input.householdId,
      purpose: 'trusted-circle-invitation',
      keyVersion: this.fingerprintKeyVersion,
    });
    const expiresAt = new Date(input.now.getTime() + 7 * 24 * 60 * 60 * 1_000);
    await this.database.transaction(async (transaction) => {
      const hasEnrollment = await hasEffectiveProtectedEnrollment(
        transaction,
        input.householdId,
        input.protectedPersonId,
        input.now,
        true,
        this.runtimeEnvironment,
      );
      if (!hasEnrollment) {
        throw new DomainError('not_authorized', 'Protected-member consent is required');
      }
      const actorIdentity = await identityEvidenceForPerson(
        transaction,
        input.invitedByPersonId,
        input.actorIssuer,
      );
      if (actorIdentity === null) {
        throw new DomainError('not_authenticated', 'An active identity is required');
      }
      await transaction.query(
        `INSERT INTO consents(
           household_id, id, protected_person_id, granted_by_person_id, purpose,
           consent_version, state, granted_at
         ) VALUES ($1,$2,$3,$3,'trusted_circle_relationship',$4,'active',$5)`,
        [
          input.householdId,
          consentId,
          input.protectedPersonId,
          consentVersion,
          input.now.toISOString(),
        ],
      );
      const consentEvidenceId = await appendConsentEvidence(transaction, this.idFactory, {
        householdId: input.householdId,
        consentId,
        actorPersonId: input.invitedByPersonId,
        subjectPersonId: input.protectedPersonId,
        purpose: 'trusted_circle_relationship',
        scope: { permissions: [...input.permissions] },
        action: 'propose',
        sourceInteraction: 'family_invitation_create',
        actorIdentity,
        sessionId: input.sessionId,
        correlationId: input.correlationId,
        effectiveAt: input.now,
        expiresAt,
      });
      await transaction.query(
        `INSERT INTO invitations(
           household_id, id, invited_by_person_id, protected_person_id, consent_id,
           latest_consent_evidence_id, invitee_display_name, invite_code_fingerprint,
           fingerprint_key_version, permissions, state, identity_binding_state,
           intended_identity_issuer, intended_identity_subject, expires_at, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'pending',
           $11,$12,$13,$14,$15)`,
        [
          input.householdId,
          invitationId,
          input.invitedByPersonId,
          input.protectedPersonId,
          consentId,
          consentEvidenceId,
          input.inviteeDisplayName,
          fingerprint.value,
          fingerprint.keyVersion,
          jsonParameter(input.permissions),
          identityBindingState,
          input.intendedIdentity?.issuer ?? null,
          input.intendedIdentity?.subject ?? null,
          expiresAt.toISOString(),
          input.now.toISOString(),
        ],
      );
      await writeAuditAndOutbox(
        transaction,
        this.idFactory,
        {
          householdId: input.householdId,
          actorPersonId: input.invitedByPersonId,
          audience: input.audience,
          correlationId: input.correlationId,
          now: input.now,
        },
        {
          action: 'family.invitation_created',
          resourceType: 'invitation',
          resourceId: invitationId,
          outcome: 'completed',
        },
        {
          eventType: 'family.invitation_created.v1',
          aggregateType: 'invitation',
          aggregateId: invitationId,
          payload: { delivery: 'local_only', state: 'pending' },
        },
      );
    });
    return {
      invitation: {
        id: invitationId,
        protectedPersonId: input.protectedPersonId,
        inviteeDisplayName: input.inviteeDisplayName,
        permissions: input.permissions,
        state: 'pending',
        identityBindingState,
        expiresAt,
        createdAt: input.now,
      },
      localInviteCode,
    };
  }

  async validateInvitationCredential(
    invitationId: string,
    localInviteCode: string,
    now: Date,
  ): Promise<InvitationCredentialRecord | null> {
    const separator = localInviteCode.indexOf('.');
    const codeId = localInviteCode.slice(0, separator);
    const secret = localInviteCode.slice(separator + 1);
    if (separator < 1 || codeId !== invitationId || secret.length < 24) return null;
    const result = await this.database.query<InvitationRow>(
      `SELECT i.household_id, i.id, i.protected_person_id, i.consent_id,
              c.consent_version, i.latest_consent_evidence_id, i.invitee_display_name,
              i.invite_code_fingerprint, i.fingerprint_key_version, i.permissions,
              i.state, i.identity_binding_state, i.intended_identity_issuer,
              i.intended_identity_subject, intended.person_id AS intended_person_id,
              i.expires_at, i.created_at
       FROM invitations i
       JOIN consents c ON c.household_id = i.household_id AND c.id = i.consent_id
       JOIN consent_current_projections projection
         ON projection.household_id = i.household_id AND projection.consent_id = i.consent_id
        AND projection.latest_evidence_id = i.latest_consent_evidence_id
       LEFT JOIN identities intended
         ON intended.issuer = i.intended_identity_issuer
        AND intended.subject = i.intended_identity_subject AND intended.status = 'active'
       WHERE i.id = $1 AND projection.state = 'proposed'`,
      [invitationId],
    );
    const row = result.rows[0];
    if (
      row === undefined ||
      row.state !== 'pending' ||
      asDate(row.expires_at, 'invitations.expires_at').getTime() <= now.getTime()
    ) {
      return null;
    }
    const candidate = fingerprintMinimized(secret, this.fingerprintKey, {
      tenantId: row.household_id,
      purpose: 'trusted-circle-invitation',
      keyVersion: row.fingerprint_key_version,
    });
    if (!constantTimeEqual(candidate.value, row.invite_code_fingerprint)) return null;
    if (row.consent_version === undefined) throw new TypeError('Invitation consent is unavailable');
    return {
      ...invitationFromRow(row),
      householdId: row.household_id,
      consentVersion: row.consent_version,
      latestConsentEvidenceId: row.latest_consent_evidence_id,
      ...(row.identity_binding_state === 'verified_identity' &&
      typeof row.intended_person_id === 'string'
        ? { invitedPersonId: row.intended_person_id }
        : {}),
    };
  }

  async previewInvitationCredential(
    invitationId: string,
    localInviteCode: string,
    now: Date,
  ): Promise<InvitationPreviewRecord | null> {
    const invitation = await this.validateInvitationCredential(invitationId, localInviteCode, now);
    if (invitation === null) return null;
    if (
      !(await hasEffectiveProtectedEnrollment(
        this.database,
        invitation.householdId,
        invitation.protectedPersonId,
        now,
        false,
        this.runtimeEnvironment,
      ))
    ) {
      return null;
    }
    const display = await this.database.query<
      { household_name: string; protected_display_name: string } & Record<string, unknown>
    >(
      `SELECT h.name AS household_name, p.display_name AS protected_display_name
       FROM households h
       JOIN household_memberships m ON m.household_id = h.id AND m.person_id = $2
       JOIN persons p ON p.id = m.person_id
       JOIN protected_members pm
         ON pm.household_id = m.household_id AND pm.person_id = m.person_id
        AND pm.status = 'accepted'
       JOIN commerce_allowance_allocations a
         ON a.household_id = pm.household_id AND a.id = pm.allowance_allocation_id
        AND a.state = 'active' AND a.allowance_key = 'protected_members'
        AND a.subject_kind = 'protected_member' AND a.subject_id = pm.person_id
       WHERE h.id = $1 AND m.status = 'active'`,
      [invitation.householdId, invitation.protectedPersonId],
    );
    const row = display.rows[0];
    if (row === undefined) return null;
    return {
      id: invitation.id,
      household: { id: invitation.householdId, name: row.household_name },
      protectedPerson: {
        id: invitation.protectedPersonId,
        displayName: row.protected_display_name,
      },
      permissions: invitation.permissions,
      state: 'pending',
      identityBindingState: invitation.identityBindingState,
      ...(invitation.invitedPersonId === undefined
        ? {}
        : { invitedPersonId: invitation.invitedPersonId }),
      expiresAt: invitation.expiresAt,
      previewVersion: invitation.consentVersion,
    };
  }

  async invitationForCancellation(
    householdId: string,
    invitationId: string,
    now: Date,
  ): Promise<{
    readonly id: string;
    readonly householdId: string;
    readonly protectedPersonId: string;
    readonly state: InvitationRecord['state'];
  } | null> {
    const result = await this.database.query<InvitationRow>(
      `SELECT household_id, id, protected_person_id, consent_id, invitee_display_name,
              invite_code_fingerprint, fingerprint_key_version, permissions, state,
              expires_at, created_at
       FROM invitations
       WHERE household_id = $1 AND id = $2 AND expires_at > $3`,
      [householdId, invitationId, now.toISOString()],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          id: row.id,
          householdId: row.household_id,
          protectedPersonId: row.protected_person_id,
          state: row.state,
        };
  }

  async revokeInvitation(input: {
    readonly invitationId: string;
    readonly householdId: string;
    readonly protectedPersonId: string;
    readonly actorPersonId: string;
    readonly audience: Audience;
    readonly actorIssuer: string;
    readonly sessionId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<'withdrawn' | 'revoked' | null> {
    return this.database.transaction(async (transaction) => {
      const result = await transaction.query<
        { consent_id: string; permissions: unknown } & Record<string, unknown>
      >(
        `SELECT consent_id, permissions FROM invitations
         WHERE household_id = $1 AND id = $2 AND protected_person_id = $3
            AND state = 'pending' AND expires_at > $4 FOR UPDATE`,
        [input.householdId, input.invitationId, input.protectedPersonId, input.now.toISOString()],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      const protectedWithdrawal = input.actorPersonId === input.protectedPersonId;
      if (!protectedWithdrawal) {
        const administrator = await transaction.query<Record<string, unknown>>(
          `SELECT 1 FROM household_administrator_assignments
           WHERE household_id = $1 AND person_id = $2 AND status = 'active'`,
          [input.householdId, input.actorPersonId],
        );
        if (administrator.rows.length !== 1) {
          throw new DomainError('not_authorized', 'Invitation authority is unavailable');
        }
      }
      const actorIdentity = await identityEvidenceForPerson(
        transaction,
        input.actorPersonId,
        input.actorIssuer,
      );
      if (actorIdentity === null) {
        throw new DomainError('not_authenticated', 'An active identity is required');
      }
      const state = protectedWithdrawal ? ('withdrawn' as const) : ('revoked' as const);
      const lifecycleAction = protectedWithdrawal
        ? ('family.invitation_withdrawn' as const)
        : ('family.invitation_revoked' as const);
      const consentEvidenceId = await appendConsentEvidence(transaction, this.idFactory, {
        householdId: input.householdId,
        consentId: row.consent_id,
        actorPersonId: input.actorPersonId,
        subjectPersonId: input.protectedPersonId,
        purpose: 'trusted_circle_relationship',
        scope: { permissions: [...permissions(row.permissions)] },
        action: protectedWithdrawal ? 'withdraw' : 'revoke',
        sourceInteraction: 'family_invitation_cancel',
        actorIdentity,
        sessionId: input.sessionId,
        correlationId: input.correlationId,
        effectiveAt: input.now,
      });
      await transaction.query(
        `UPDATE invitations
         SET state = $4, latest_consent_evidence_id = $5, revoked_at = $6,
             ended_by_person_id = $7, ended_action = $8
         WHERE household_id = $1 AND id = $2 AND protected_person_id = $3
            AND state = 'pending'`,
        [
          input.householdId,
          input.invitationId,
          input.protectedPersonId,
          state,
          consentEvidenceId,
          input.now.toISOString(),
          input.actorPersonId,
          protectedWithdrawal ? 'withdraw' : 'revoke',
        ],
      );
      await writeAuditAndOutbox(
        transaction,
        this.idFactory,
        {
          householdId: input.householdId,
          actorPersonId: input.actorPersonId,
          audience: input.audience,
          correlationId: input.correlationId,
          now: input.now,
        },
        {
          action: lifecycleAction,
          resourceType: 'invitation',
          resourceId: input.invitationId,
          outcome: 'completed',
        },
        {
          eventType: `${lifecycleAction}.v2`,
          aggregateType: 'invitation',
          aggregateId: input.invitationId,
          payload: { state },
        },
      );
      return state;
    });
  }

  async acceptInvitation(input: {
    readonly invitationId: string;
    readonly localInviteCode: string;
    readonly previewVersion: string;
    readonly acceptingPersonId: string;
    readonly audience: Audience;
    readonly actorIssuer: string;
    readonly sessionId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<RelationshipRecord> {
    const separator = input.localInviteCode.indexOf('.');
    const codeId = input.localInviteCode.slice(0, separator);
    const secret = input.localInviteCode.slice(separator + 1);
    if (separator < 1 || codeId !== input.invitationId || secret.length < 24) {
      throw new DomainError('not_found', 'Invitation is invalid or unavailable');
    }
    return this.database.transaction(async (transaction) => {
      const result = await transaction.query<InvitationRow>(
        `SELECT household_id, id, protected_person_id, consent_id, invitee_display_name,
                latest_consent_evidence_id, invite_code_fingerprint,
                fingerprint_key_version, permissions, state, identity_binding_state,
                intended_identity_issuer, intended_identity_subject, expires_at, created_at
         FROM invitations WHERE id = $1 FOR UPDATE`,
        [input.invitationId],
      );
      const invitation = result.rows[0];
      if (invitation === undefined || invitation.state !== 'pending') {
        throw new DomainError('not_found', 'Invitation is invalid or unavailable');
      }
      if (
        asDate(invitation.expires_at, 'invitations.expires_at').getTime() <= input.now.getTime()
      ) {
        throw new DomainError('not_found', 'Invitation is invalid or unavailable');
      }
      const candidate = fingerprintMinimized(secret, this.fingerprintKey, {
        tenantId: invitation.household_id,
        purpose: 'trusted-circle-invitation',
        keyVersion: invitation.fingerprint_key_version,
      });
      if (!constantTimeEqual(candidate.value, invitation.invite_code_fingerprint)) {
        throw new DomainError('not_found', 'Invitation is invalid or unavailable');
      }
      const acceptingIdentity = await identityEvidenceForPerson(
        transaction,
        input.acceptingPersonId,
        input.actorIssuer,
      );
      if (acceptingIdentity === null) {
        throw new DomainError('not_authenticated', 'An active identity is required');
      }
      if (
        invitation.identity_binding_state === 'verified_identity' &&
        (acceptingIdentity.assurance !== 'verified' ||
          acceptingIdentity.issuer !== invitation.intended_identity_issuer ||
          acceptingIdentity.subject !== invitation.intended_identity_subject)
      ) {
        throw new DomainError('not_found', 'Invitation is invalid or unavailable');
      }
      if (
        !(await hasEffectiveProtectedEnrollment(
          transaction,
          invitation.household_id,
          invitation.protected_person_id,
          input.now,
          true,
          this.runtimeEnvironment,
        ))
      ) {
        throw new DomainError('not_found', 'Invitation is invalid or unavailable');
      }
      const existing = await transaction.query<
        { membership_kind: string; status: string } & Record<string, unknown>
      >(
        `SELECT membership_kind, status FROM household_memberships
         WHERE household_id = $1 AND person_id = $2 FOR UPDATE`,
        [invitation.household_id, input.acceptingPersonId],
      );
      const existingMembership = existing.rows[0];
      if (existingMembership !== undefined && existingMembership.membership_kind !== 'member') {
        throw new DomainError('conflict', 'Household membership is invalid');
      }
      const existingPair = await transaction.query<
        { id: string; state: string; created_at: unknown } & Record<string, unknown>
      >(
        `SELECT id, state, created_at FROM trusted_circle_relationships
         WHERE household_id = $1 AND protected_person_id = $2
           AND trusted_person_id = $3 FOR UPDATE`,
        [invitation.household_id, invitation.protected_person_id, input.acceptingPersonId],
      );
      const priorPair = existingPair.rows[0];
      if (priorPair?.state === 'active') {
        throw new DomainError('conflict', 'This Trusted Circle relationship already exists');
      }
      const consentResult = await transaction.query<ConsentRow>(
        `SELECT consent.id, consent.consent_version, projection.latest_evidence_id
         FROM consents consent
         JOIN consent_current_projections projection
           ON projection.household_id = consent.household_id
          AND projection.consent_id = consent.id
         WHERE consent.household_id = $1 AND consent.id = $2
           AND consent.protected_person_id = $3
           AND consent.granted_by_person_id = consent.protected_person_id
           AND consent.purpose = 'trusted_circle_relationship'
           AND projection.state = 'proposed'
           AND projection.latest_evidence_id = $4`,
        [
          invitation.household_id,
          invitation.consent_id,
          invitation.protected_person_id,
          invitation.latest_consent_evidence_id,
        ],
      );
      const consent = consentResult.rows[0];
      if (consent === undefined)
        throw new DomainError('not_found', 'Invitation is invalid or unavailable');
      if (consent.consent_version !== input.previewVersion) {
        throw new DomainError('conflict', 'Invitation preview is stale');
      }
      const membershipId = this.idFactory.next('membership');
      const relationshipId = priorPair?.id ?? this.idFactory.next('relationship');
      if (existingMembership === undefined || existingMembership.status === 'revoked') {
        if (existingMembership === undefined) {
          await transaction.query(
            `INSERT INTO household_memberships(
             household_id, id, person_id, membership_kind, status, created_at
           ) VALUES ($1,$2,$3,'member','active',$4)`,
            [
              invitation.household_id,
              membershipId,
              input.acceptingPersonId,
              input.now.toISOString(),
            ],
          );
        } else {
          await transaction.query(
            `UPDATE household_memberships
             SET status = 'active', revoked_at = NULL
             WHERE household_id = $1 AND person_id = $2 AND membership_kind = 'member'`,
            [invitation.household_id, input.acceptingPersonId],
          );
        }
      }
      const allowanceBinding = await rebindCommerceAllowanceToEffectiveGrant(transaction, {
        householdId: invitation.household_id,
        kind: 'trusted_circle_participants',
        subjectKind: 'trusted_circle_person',
        subjectId: input.acceptingPersonId,
        now: input.now,
        runtimeEnvironment: this.runtimeEnvironment,
      });
      if (allowanceBinding === 'not_found') {
        await allocateCommerceAllowance(transaction, {
          householdId: invitation.household_id,
          allocationId: this.idFactory.next('allocation'),
          kind: 'trusted_circle_participants',
          subjectKind: 'trusted_circle_person',
          subjectId: input.acceptingPersonId,
          now: input.now,
          runtimeEnvironment: this.runtimeEnvironment,
        });
      }
      const consentEvidenceId = await appendConsentEvidence(transaction, this.idFactory, {
        householdId: invitation.household_id,
        consentId: consent.id,
        actorPersonId: input.acceptingPersonId,
        subjectPersonId: invitation.protected_person_id,
        recipientPersonId: input.acceptingPersonId,
        purpose: 'trusted_circle_relationship',
        scope: { permissions: [...permissions(invitation.permissions)] },
        action: 'accept',
        sourceInteraction: 'family_invitation_accept',
        actorIdentity: acceptingIdentity,
        sessionId: input.sessionId,
        correlationId: input.correlationId,
        effectiveAt: input.now,
      });
      if (priorPair === undefined) {
        await transaction.query(
          `INSERT INTO trusted_circle_relationships(
           household_id, id, protected_person_id, trusted_person_id, permissions,
           consent_id, consent_version, state, created_at, latest_consent_evidence_id
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,'active',$8,$9)`,
          [
            invitation.household_id,
            relationshipId,
            invitation.protected_person_id,
            input.acceptingPersonId,
            jsonParameter(permissions(invitation.permissions)),
            consent.id,
            consent.consent_version,
            input.now.toISOString(),
            consentEvidenceId,
          ],
        );
      } else {
        await transaction.query(
          `UPDATE trusted_circle_relationships
            SET permissions = $5::jsonb, consent_id = $6, consent_version = $7,
                state = 'active', revoked_at = NULL, ended_by_person_id = NULL,
                ended_action = NULL, ended_at = NULL, latest_consent_evidence_id = $8
            WHERE household_id = $1 AND id = $2 AND protected_person_id = $3
              AND trusted_person_id = $4 AND state <> 'active'`,
          [
            invitation.household_id,
            relationshipId,
            invitation.protected_person_id,
            input.acceptingPersonId,
            jsonParameter(permissions(invitation.permissions)),
            consent.id,
            consent.consent_version,
            consentEvidenceId,
          ],
        );
      }
      await transaction.query(
        `UPDATE invitations
         SET state = 'accepted', accepted_by_person_id = $3, accepted_at = $4,
             accepted_identity_id = $5, accepted_identity_issuer = $6,
             accepted_identity_subject = $7, latest_consent_evidence_id = $8
         WHERE household_id = $1 AND id = $2 AND state = 'pending'`,
        [
          invitation.household_id,
          invitation.id,
          input.acceptingPersonId,
          input.now.toISOString(),
          acceptingIdentity.id,
          acceptingIdentity.issuer,
          acceptingIdentity.subject,
          consentEvidenceId,
        ],
      );
      await writeAuditAndOutbox(
        transaction,
        this.idFactory,
        {
          householdId: invitation.household_id,
          actorPersonId: input.acceptingPersonId,
          audience: input.audience,
          correlationId: input.correlationId,
          now: input.now,
        },
        {
          action: 'family.invitation_accepted',
          resourceType: 'relationship',
          resourceId: relationshipId,
          outcome: 'completed',
        },
        {
          eventType: 'family.relationship_activated.v1',
          aggregateType: 'relationship',
          aggregateId: relationshipId,
          payload: { state: 'active', consentVersion: consent.consent_version },
        },
      );
      const person = await transaction.query<{ display_name: string } & Record<string, unknown>>(
        'SELECT display_name FROM persons WHERE id = $1',
        [input.acceptingPersonId],
      );
      const displayName = person.rows[0]?.display_name;
      if (displayName === undefined) throw new DomainError('not_found', 'Person is unavailable');
      return {
        id: relationshipId,
        protectedPersonId: invitation.protected_person_id,
        trustedPersonId: input.acceptingPersonId,
        trustedDisplayName: displayName,
        permissions: permissions(invitation.permissions),
        state: 'active',
        consentVersion: consent.consent_version,
        createdAt:
          priorPair === undefined
            ? input.now
            : asDate(priorPair.created_at, 'trusted_circle_relationships.created_at'),
      };
    });
  }

  async relationshipForRevocation(
    householdId: string,
    relationshipId: string,
  ): Promise<RelationshipScopeRecord | null> {
    const result = await this.database.query<
      {
        id: string;
        household_id: string;
        protected_person_id: string;
        trusted_person_id: string;
      } & Record<string, unknown>
    >(
      `SELECT id, household_id, protected_person_id, trusted_person_id
       FROM trusted_circle_relationships
       WHERE household_id = $1 AND id = $2 AND state = 'active'`,
      [householdId, relationshipId],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          id: row.id,
          householdId: row.household_id,
          protectedPersonId: row.protected_person_id,
          trustedPersonId: row.trusted_person_id,
        };
  }

  async revokeRelationship(input: {
    readonly relationshipId: string;
    readonly householdId: string;
    readonly protectedPersonId: string;
    readonly trustedPersonId: string;
    readonly actorPersonId: string;
    readonly audience: Audience;
    readonly actorIssuer: string;
    readonly sessionId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<'withdrawn' | 'relinquished' | 'suspended' | null> {
    return this.database.transaction(async (transaction) => {
      const relationship = await transaction.query<
        { trusted_person_id: string; consent_id: string; permissions: unknown } & Record<
          string,
          unknown
        >
      >(
        `SELECT trusted_person_id, consent_id, permissions FROM trusted_circle_relationships
         WHERE household_id = $1 AND id = $2 AND protected_person_id = $3
           AND trusted_person_id = $4 AND state = 'active' FOR UPDATE`,
        [input.householdId, input.relationshipId, input.protectedPersonId, input.trustedPersonId],
      );
      const row = relationship.rows[0];
      if (row === undefined) return null;
      let action: 'withdraw' | 'relinquish' | 'suspend';
      let state: 'withdrawn' | 'relinquished' | 'suspended';
      if (input.actorPersonId === input.protectedPersonId) {
        action = 'withdraw';
        state = 'withdrawn';
      } else if (input.actorPersonId === input.trustedPersonId) {
        action = 'relinquish';
        state = 'relinquished';
      } else {
        const administrator = await transaction.query<Record<string, unknown>>(
          `SELECT 1 FROM household_administrator_assignments
           WHERE household_id = $1 AND person_id = $2 AND status = 'active'`,
          [input.householdId, input.actorPersonId],
        );
        if (administrator.rows.length !== 1) {
          throw new DomainError('not_authorized', 'Relationship authority is unavailable');
        }
        action = 'suspend';
        state = 'suspended';
      }
      const actorIdentity = await identityEvidenceForPerson(
        transaction,
        input.actorPersonId,
        input.actorIssuer,
      );
      if (actorIdentity === null) {
        throw new DomainError('not_authenticated', 'An active identity is required');
      }
      const consentEvidenceId = await appendConsentEvidence(transaction, this.idFactory, {
        householdId: input.householdId,
        consentId: row.consent_id,
        actorPersonId: input.actorPersonId,
        subjectPersonId: input.protectedPersonId,
        recipientPersonId: input.trustedPersonId,
        purpose: 'trusted_circle_relationship',
        scope: { permissions: [...permissions(row.permissions)] },
        action,
        sourceInteraction: 'family_relationship_end',
        actorIdentity,
        sessionId: input.sessionId,
        correlationId: input.correlationId,
        effectiveAt: input.now,
      });
      await transaction.query(
        'DELETE FROM check_shares WHERE household_id = $1 AND relationship_id = $2',
        [input.householdId, input.relationshipId],
      );
      await transaction.query(
        `UPDATE trusted_circle_relationships
         SET state = $5, revoked_at = $6, ended_by_person_id = $7,
             ended_action = $8, ended_at = $6, latest_consent_evidence_id = $9
         WHERE household_id = $1 AND id = $2 AND protected_person_id = $3
            AND trusted_person_id = $4 AND state = 'active'`,
        [
          input.householdId,
          input.relationshipId,
          input.protectedPersonId,
          input.trustedPersonId,
          state,
          input.now.toISOString(),
          input.actorPersonId,
          action,
          consentEvidenceId,
        ],
      );
      const remainingRelationships = await transaction.query<Record<string, unknown>>(
        `SELECT 1 FROM trusted_circle_relationships
         WHERE household_id = $1 AND trusted_person_id = $2 AND state = 'active'`,
        [input.householdId, row.trusted_person_id],
      );
      if (remainingRelationships.rows.length === 0) {
        await releaseCommerceAllowance(transaction, {
          householdId: input.householdId,
          kind: 'trusted_circle_participants',
          subjectKind: 'trusted_circle_person',
          subjectId: row.trusted_person_id,
          now: input.now,
        });
      }
      const lifecycleAction = `family.relationship_${state}`;
      await writeAuditAndOutbox(
        transaction,
        this.idFactory,
        {
          householdId: input.householdId,
          actorPersonId: input.actorPersonId,
          audience: input.audience,
          correlationId: input.correlationId,
          now: input.now,
        },
        {
          action: lifecycleAction,
          resourceType: 'relationship',
          resourceId: input.relationshipId,
          outcome: 'completed',
        },
        {
          eventType: `${lifecycleAction}.v2`,
          aggregateType: 'relationship',
          aggregateId: input.relationshipId,
          payload: { state, action },
        },
      );
      return state;
    });
  }
}
