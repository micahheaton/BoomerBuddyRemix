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
  readonly recipient_code_id?: string | null;
  readonly accepted_by_person_id?: string | null;
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
  readonly acceptedPersonId?: string;
}

export interface RecipientConnectionCodeRecord {
  readonly recipientConnectionCode: string;
  readonly expiresAt: Date;
}

export interface HouseholdMemberInvitationRecord {
  readonly id: string;
  readonly inviteeDisplayName: string;
  readonly state: 'pending' | 'accepted' | 'revoked' | 'expired';
  readonly identityBindingState: 'verified_identity';
  readonly access: 'neutral_membership_only';
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

interface HouseholdMemberInvitationRow extends Record<string, unknown> {
  readonly household_id: string;
  readonly id: string;
  readonly invited_by_person_id: string;
  readonly intended_identity_id: string;
  readonly intended_person_id: string;
  readonly intended_identity_issuer: string;
  readonly intended_identity_subject: string;
  readonly invitee_display_name: string;
  readonly recipient_code_id: string;
  readonly invitation_code_fingerprint: string;
  readonly fingerprint_key_version: number;
  readonly preview_version: string;
  readonly state: HouseholdMemberInvitationRecord['state'];
  readonly expires_at: unknown;
  readonly created_at: unknown;
  readonly accepted_membership_id: string | null;
  readonly accepted_by_person_id: string | null;
  readonly accepted_identity_id: string | null;
  readonly accepted_at: unknown | null;
  readonly revoked_by_person_id: string | null;
  readonly revoked_at: unknown | null;
  readonly expired_at: unknown | null;
}

export interface HouseholdMemberInvitationCredentialRecord extends HouseholdMemberInvitationRecord {
  readonly householdId: string;
  readonly invitedByPersonId: string;
  readonly intendedIdentityId: string;
  readonly intendedPersonId: string;
  readonly intendedIdentityIssuer: string;
  readonly intendedIdentitySubject: string;
  readonly previewVersion: string;
  readonly acceptedMembershipId?: string;
}

export interface HouseholdMemberInvitationPreviewRecord {
  readonly id: string;
  readonly household: { readonly id: string; readonly name: string };
  readonly invitedBy: { readonly displayName: string };
  readonly inviteeDisplayName: string;
  readonly access: 'neutral_membership_only';
  readonly state: 'pending';
  readonly identityBindingState: 'verified_identity';
  readonly intendedPersonId: string;
  readonly expiresAt: Date;
  readonly previewVersion: string;
}

export interface AcceptedHouseholdMembershipRecord {
  readonly membershipId: string;
  readonly householdId: string;
  readonly membershipKind: 'member';
  readonly status: 'active';
  readonly reused: boolean;
}

interface RecipientConnectionCodeRow extends Record<string, unknown> {
  readonly id: string;
  readonly identity_id: string;
  readonly person_id: string;
  readonly code_fingerprint: string;
  readonly fingerprint_key_version: number;
  readonly state: 'active' | 'consumed' | 'rotated';
  readonly expires_at: unknown;
  readonly issuer: string;
  readonly subject: string;
  readonly display_name: string;
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

export interface NeutralMembershipScopeRecord {
  readonly membershipId: string;
  readonly householdId: string;
  readonly memberPersonId: string;
  readonly status: 'active';
}

function permissions(value: unknown): readonly TrustedPermission[] {
  return stringArray(jsonValue(value), 'permissions') as readonly TrustedPermission[];
}

function splitOpaqueCredential(
  value: string,
): { readonly id: string; readonly secret: string } | null {
  const separator = value.indexOf('.');
  if (separator < 1) return null;
  const id = value.slice(0, separator);
  const secret = value.slice(separator + 1);
  return secret.length < 24 ? null : { id, secret };
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

function householdMemberInvitationFromRow(
  row: HouseholdMemberInvitationRow,
): HouseholdMemberInvitationRecord {
  return {
    id: row.id,
    inviteeDisplayName: row.invitee_display_name,
    state: row.state,
    identityBindingState: 'verified_identity',
    access: 'neutral_membership_only',
    expiresAt: asDate(row.expires_at, 'household_member_invitations.expires_at'),
    createdAt: asDate(row.created_at, 'household_member_invitations.created_at'),
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
    readonly memberInvitations: readonly HouseholdMemberInvitationRecord[];
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
    const memberInvitationRows = actor.is_administrator
      ? await this.database.query<HouseholdMemberInvitationRow>(
          `SELECT household_id, id, invited_by_person_id, intended_identity_id,
                  intended_person_id, intended_identity_issuer, intended_identity_subject,
                  invitee_display_name, recipient_code_id, invitation_code_fingerprint,
                  fingerprint_key_version,
                  preview_version, state, expires_at, created_at, accepted_membership_id,
                  accepted_by_person_id, accepted_identity_id, accepted_at,
                  revoked_by_person_id, revoked_at, expired_at
           FROM household_member_invitations
           WHERE household_id = $1 AND state = 'pending' AND expires_at > $2
           ORDER BY created_at`,
          [householdId, now.toISOString()],
        )
      : { rows: [] as HouseholdMemberInvitationRow[] };
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
      memberInvitations: memberInvitationRows.rows.map(householdMemberInvitationFromRow),
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

  async consumeRecipientCodeRateLimit(input: {
    readonly personId: string;
    readonly action: 'recipient_code_generation' | 'recipient_code_lookup';
    readonly maximumPerHour: number;
    readonly now: Date;
  }): Promise<boolean> {
    if (!Number.isSafeInteger(input.maximumPerHour) || input.maximumPerHour < 1) {
      throw new TypeError('Trusted Circle rate limit must be a positive integer');
    }
    const timestamp = input.now.getTime();
    if (!Number.isFinite(timestamp))
      throw new TypeError('Trusted Circle rate-limit time is invalid');
    const bucketStartsAt = new Date(Math.floor(timestamp / 3_600_000) * 3_600_000);
    const charged = await this.database.query<Record<string, unknown>>(
      `INSERT INTO trusted_circle_authenticated_rate_buckets(
         person_id, action_kind, bucket_starts_at, used_count, updated_at
       ) VALUES ($1,$2,$3,1,$4)
       ON CONFLICT (person_id, action_kind, bucket_starts_at) DO UPDATE
       SET used_count = trusted_circle_authenticated_rate_buckets.used_count + 1,
           updated_at = EXCLUDED.updated_at
       WHERE trusted_circle_authenticated_rate_buckets.used_count < $5
       RETURNING used_count`,
      [
        input.personId,
        input.action,
        bucketStartsAt.toISOString(),
        input.now.toISOString(),
        input.maximumPerHour,
      ],
    );
    return charged.rowCount === 1;
  }

  async createRecipientConnectionCode(input: {
    readonly identityId: string;
    readonly personId: string;
    readonly actorIssuer: string;
    readonly actorSubject: string;
    readonly audience: Audience;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<RecipientConnectionCodeRecord> {
    if (input.actorIssuer === 'boomerbuddy-dev') {
      throw new DomainError(
        'invalid_input',
        'Recipient connection codes require a verified production identity',
      );
    }
    const codeId = this.idFactory.next('recipient_code');
    const secret = randomBytes(24).toString('base64url');
    const recipientConnectionCode = `${codeId}.${secret}`;
    const fingerprint = fingerprintMinimized(secret, this.fingerprintKey, {
      tenantId: input.personId,
      purpose: 'trusted-circle-recipient-code',
      keyVersion: this.fingerprintKeyVersion,
    });
    const expiresAt = new Date(input.now.getTime() + 24 * 60 * 60 * 1_000);
    await this.database.transaction(async (transaction) => {
      const identity = await transaction.query<Record<string, unknown>>(
        `SELECT 1 FROM production_customer_bootstraps bootstrap
         JOIN identities identity
           ON identity.id = bootstrap.identity_id
          AND identity.person_id = bootstrap.person_id
          AND identity.issuer = bootstrap.issuer
          AND identity.subject = bootstrap.subject
          AND identity.status = 'active'
         WHERE bootstrap.identity_id = $1 AND bootstrap.person_id = $2
           AND bootstrap.issuer = $3 AND bootstrap.subject = $4`,
        [input.identityId, input.personId, input.actorIssuer, input.actorSubject],
      );
      if (identity.rows.length !== 1) {
        throw new DomainError('not_authenticated', 'An active customer identity is required');
      }
      await transaction.query(
        `UPDATE trusted_circle_recipient_codes
         SET state = 'rotated', ended_at = $2
         WHERE identity_id = $1 AND state = 'active'`,
        [input.identityId, input.now.toISOString()],
      );
      await transaction.query(
        `INSERT INTO trusted_circle_recipient_codes(
           id, identity_id, person_id, code_fingerprint, fingerprint_key_version,
           state, expires_at, created_at
         ) VALUES ($1,$2,$3,$4,$5,'active',$6,$7)`,
        [
          codeId,
          input.identityId,
          input.personId,
          fingerprint.value,
          fingerprint.keyVersion,
          expiresAt.toISOString(),
          input.now.toISOString(),
        ],
      );
      await writeAuditAndOutbox(
        transaction,
        this.idFactory,
        {
          actorPersonId: input.personId,
          audience: input.audience,
          correlationId: input.correlationId,
          now: input.now,
        },
        {
          action: 'family.recipient_connection_code_created',
          resourceType: 'recipient_connection_code',
          resourceId: codeId,
          outcome: 'completed',
          metadata: { expiresAt: expiresAt.toISOString(), delivery: 'manual_only' },
        },
        {
          eventType: 'family.recipient_connection_code_created.v1',
          aggregateType: 'recipient_connection_code',
          aggregateId: codeId,
          payload: { expiresAt: expiresAt.toISOString(), delivery: 'manual_only' },
        },
      );
    });
    return { recipientConnectionCode, expiresAt };
  }

  async createHouseholdMemberInvitation(input: {
    readonly householdId: string;
    readonly invitedByPersonId: string;
    readonly actorIdentityId: string;
    readonly actorIssuer: string;
    readonly actorSubject: string;
    readonly recipientConnectionCode: string;
    readonly audience: Audience;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<{
    readonly invitation: HouseholdMemberInvitationRecord;
    readonly reused: boolean;
  }> {
    if (input.actorIssuer === 'boomerbuddy-dev') {
      throw new DomainError(
        'invalid_input',
        'Household member invitations require verified production identities',
      );
    }
    const recipientCredential = splitOpaqueCredential(input.recipientConnectionCode);
    if (recipientCredential === null) {
      throw new DomainError('not_found', 'Recipient connection code is invalid or unavailable');
    }
    const invitationId = this.idFactory.next('member_invitation');
    const invitationFingerprint = fingerprintMinimized(
      recipientCredential.secret,
      this.fingerprintKey,
      {
        tenantId: input.householdId,
        purpose: 'household-member-invitation',
        keyVersion: this.fingerprintKeyVersion,
      },
    );
    const previewVersion = `neutral-household-member-v1-${invitationId.slice(-12)}`;
    const invitation = await this.database.transaction(async (transaction) => {
      const administrator = await transaction.query<Record<string, unknown>>(
        `SELECT 1
         FROM household_memberships membership
         JOIN household_administrator_assignments administrator
           ON administrator.household_id = membership.household_id
          AND administrator.person_id = membership.person_id
          AND administrator.status = 'active'
         JOIN identities identity
           ON identity.id = $3 AND identity.person_id = membership.person_id
          AND identity.issuer = $4 AND identity.subject = $5
          AND identity.status = 'active'
         WHERE membership.household_id = $1 AND membership.person_id = $2
           AND membership.membership_kind = 'member' AND membership.status = 'active'`,
        [
          input.householdId,
          input.invitedByPersonId,
          input.actorIdentityId,
          input.actorIssuer,
          input.actorSubject,
        ],
      );
      if (administrator.rows.length !== 1) {
        throw new DomainError('not_authorized', 'Household invitation authority is unavailable');
      }
      const recipient = await transaction.query<RecipientConnectionCodeRow>(
        `SELECT code.id, code.identity_id, code.person_id, code.code_fingerprint,
                code.fingerprint_key_version, code.state, code.expires_at,
                identity.issuer, identity.subject, person.display_name
         FROM trusted_circle_recipient_codes code
         JOIN production_customer_bootstraps bootstrap
           ON bootstrap.identity_id = code.identity_id
          AND bootstrap.person_id = code.person_id
         JOIN identities identity
           ON identity.id = bootstrap.identity_id
          AND identity.person_id = bootstrap.person_id
          AND identity.issuer = bootstrap.issuer
          AND identity.subject = bootstrap.subject
          AND identity.status = 'active'
         JOIN persons person ON person.id = code.person_id
         WHERE code.id = $1 FOR UPDATE OF code`,
        [recipientCredential.id],
      );
      const recipientRow = recipient.rows[0];
      if (recipientRow === undefined) {
        throw new DomainError('not_found', 'Recipient connection code is invalid or unavailable');
      }
      const candidate = fingerprintMinimized(recipientCredential.secret, this.fingerprintKey, {
        tenantId: recipientRow.person_id,
        purpose: 'trusted-circle-recipient-code',
        keyVersion: recipientRow.fingerprint_key_version,
      });
      if (
        !constantTimeEqual(candidate.value, recipientRow.code_fingerprint) ||
        recipientRow.person_id === input.invitedByPersonId
      ) {
        throw new DomainError('not_found', 'Recipient connection code is invalid or unavailable');
      }
      const priorInvitation = await transaction.query<HouseholdMemberInvitationRow>(
        `SELECT household_id, id, invited_by_person_id, intended_identity_id,
                intended_person_id, intended_identity_issuer, intended_identity_subject,
                invitee_display_name, recipient_code_id, invitation_code_fingerprint,
                fingerprint_key_version, preview_version, state, expires_at, created_at,
                accepted_membership_id, accepted_by_person_id, accepted_identity_id,
                accepted_at, revoked_by_person_id, revoked_at, expired_at
         FROM household_member_invitations
         WHERE household_id = $1 AND invited_by_person_id = $2 AND recipient_code_id = $3
         FOR UPDATE`,
        [input.householdId, input.invitedByPersonId, recipientRow.id],
      );
      const prior = priorInvitation.rows[0];
      if (prior !== undefined) {
        const priorCandidate = fingerprintMinimized(
          recipientCredential.secret,
          this.fingerprintKey,
          {
            tenantId: prior.household_id,
            purpose: 'household-member-invitation',
            keyVersion: prior.fingerprint_key_version,
          },
        );
        if (!constantTimeEqual(priorCandidate.value, prior.invitation_code_fingerprint)) {
          throw new DomainError('not_found', 'Recipient connection code is invalid or unavailable');
        }
        if (
          prior.state === 'pending' &&
          asDate(prior.expires_at, 'household_member_invitations.expires_at').getTime() <=
            input.now.getTime()
        ) {
          await transaction.query(
            `UPDATE household_member_invitations
             SET state = 'expired', expired_at = $3
             WHERE household_id = $1 AND id = $2 AND state = 'pending'`,
            [input.householdId, prior.id, input.now.toISOString()],
          );
          throw new DomainError('not_found', 'Recipient connection code is invalid or unavailable');
        }
        if (prior.state === 'pending' || prior.state === 'accepted') {
          return { invitation: householdMemberInvitationFromRow(prior), reused: true };
        }
        throw new DomainError('not_found', 'Recipient connection code is invalid or unavailable');
      }
      if (
        recipientRow.state !== 'active' ||
        asDate(recipientRow.expires_at, 'trusted_circle_recipient_codes.expires_at').getTime() <=
          input.now.getTime()
      ) {
        throw new DomainError('not_found', 'Recipient connection code is invalid or unavailable');
      }
      const expiresAt = asDate(
        recipientRow.expires_at,
        'trusted_circle_recipient_codes.expires_at',
      );
      const existingMember = await transaction.query<Record<string, unknown>>(
        `SELECT 1 FROM household_memberships
         WHERE household_id = $1 AND person_id = $2`,
        [input.householdId, recipientRow.person_id],
      );
      if (existingMember.rows.length !== 0) {
        throw new DomainError('conflict', 'This account is already a household member');
      }
      await transaction.query(
        `UPDATE household_member_invitations
         SET state = 'expired', expired_at = $3
         WHERE household_id = $1 AND intended_person_id = $2
           AND state = 'pending' AND expires_at <= $3`,
        [input.householdId, recipientRow.person_id, input.now.toISOString()],
      );
      const pending = await transaction.query<Record<string, unknown>>(
        `SELECT 1 FROM household_member_invitations
         WHERE household_id = $1 AND intended_person_id = $2
           AND state = 'pending' AND expires_at > $3 FOR UPDATE`,
        [input.householdId, recipientRow.person_id, input.now.toISOString()],
      );
      if (pending.rows.length !== 0) {
        throw new DomainError('conflict', 'A household member invitation is already pending');
      }
      const consumed = await transaction.query(
        `UPDATE trusted_circle_recipient_codes
         SET state = 'consumed', ended_at = $2
         WHERE id = $1 AND state = 'active'`,
        [recipientRow.id, input.now.toISOString()],
      );
      if (consumed.rowCount !== 1) {
        throw new DomainError('not_found', 'Recipient connection code is invalid or unavailable');
      }
      await transaction.query(
        `INSERT INTO household_member_invitations(
           household_id, id, invited_by_person_id, intended_identity_id,
           intended_person_id, intended_identity_issuer, intended_identity_subject,
           invitee_display_name, recipient_code_id, invitation_code_fingerprint,
           fingerprint_key_version, preview_version, state, expires_at, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13,$14)`,
        [
          input.householdId,
          invitationId,
          input.invitedByPersonId,
          recipientRow.identity_id,
          recipientRow.person_id,
          recipientRow.issuer,
          recipientRow.subject,
          recipientRow.display_name,
          recipientRow.id,
          invitationFingerprint.value,
          invitationFingerprint.keyVersion,
          previewVersion,
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
          action: 'family.recipient_connection_code_consumed',
          resourceType: 'recipient_connection_code',
          resourceId: recipientRow.id,
          outcome: 'completed',
        },
        {
          eventType: 'family.recipient_connection_code_consumed.v1',
          aggregateType: 'recipient_connection_code',
          aggregateId: recipientRow.id,
          payload: { state: 'consumed' },
        },
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
          action: 'family.household_member_invitation_created',
          resourceType: 'household_member_invitation',
          resourceId: invitationId,
          outcome: 'completed',
          metadata: { access: 'neutral_membership_only', delivery: 'recipient_manual_only' },
        },
        {
          eventType: 'family.household_member_invitation_created.v1',
          aggregateType: 'household_member_invitation',
          aggregateId: invitationId,
          payload: {
            state: 'pending',
            access: 'neutral_membership_only',
            delivery: 'recipient_manual_only',
          },
        },
      );
      return {
        invitation: {
          id: invitationId,
          inviteeDisplayName: recipientRow.display_name,
          state: 'pending' as const,
          identityBindingState: 'verified_identity' as const,
          access: 'neutral_membership_only' as const,
          expiresAt,
          createdAt: input.now,
        },
        reused: false,
      };
    });
    return invitation;
  }

  async validateHouseholdMemberInvitationCredential(
    invitationId: string,
    invitationCredential: string,
    now: Date,
  ): Promise<HouseholdMemberInvitationCredentialRecord | null> {
    const credential = splitOpaqueCredential(invitationCredential);
    if (credential === null) return null;
    const result = await this.database.query<HouseholdMemberInvitationRow>(
      `SELECT invitation.household_id, invitation.id, invitation.invited_by_person_id,
              invitation.intended_identity_id, invitation.intended_person_id,
              invitation.intended_identity_issuer, invitation.intended_identity_subject,
              invitation.invitee_display_name, invitation.recipient_code_id,
              invitation.invitation_code_fingerprint,
              invitation.fingerprint_key_version, invitation.preview_version, invitation.state,
              invitation.expires_at, invitation.created_at, invitation.accepted_membership_id,
              invitation.accepted_by_person_id, invitation.accepted_identity_id,
              invitation.accepted_at, invitation.revoked_by_person_id,
              invitation.revoked_at, invitation.expired_at
       FROM household_member_invitations invitation
       JOIN identities identity
         ON identity.id = invitation.intended_identity_id
        AND identity.person_id = invitation.intended_person_id
        AND identity.issuer = invitation.intended_identity_issuer
        AND identity.subject = invitation.intended_identity_subject
        AND identity.status = 'active'
       WHERE invitation.id = $1`,
      [invitationId],
    );
    const row = result.rows[0];
    if (
      row === undefined ||
      row.recipient_code_id !== credential.id ||
      (row.state !== 'pending' && row.state !== 'accepted') ||
      (row.state === 'pending' &&
        asDate(row.expires_at, 'household_member_invitations.expires_at').getTime() <=
          now.getTime())
    ) {
      return null;
    }
    const candidate = fingerprintMinimized(credential.secret, this.fingerprintKey, {
      tenantId: row.household_id,
      purpose: 'household-member-invitation',
      keyVersion: row.fingerprint_key_version,
    });
    if (!constantTimeEqual(candidate.value, row.invitation_code_fingerprint)) return null;
    return {
      ...householdMemberInvitationFromRow(row),
      householdId: row.household_id,
      invitedByPersonId: row.invited_by_person_id,
      intendedIdentityId: row.intended_identity_id,
      intendedPersonId: row.intended_person_id,
      intendedIdentityIssuer: row.intended_identity_issuer,
      intendedIdentitySubject: row.intended_identity_subject,
      previewVersion: row.preview_version,
      ...(row.accepted_membership_id === null
        ? {}
        : { acceptedMembershipId: row.accepted_membership_id }),
    };
  }

  async previewHouseholdMemberInvitationCredential(
    invitationId: string,
    invitationCredential: string,
    now: Date,
  ): Promise<HouseholdMemberInvitationPreviewRecord | null> {
    const invitation = await this.validateHouseholdMemberInvitationCredential(
      invitationId,
      invitationCredential,
      now,
    );
    if (invitation === null || invitation.state !== 'pending') return null;
    const display = await this.database.query<
      { household_name: string; invited_by_display_name: string } & Record<string, unknown>
    >(
      `SELECT household.name AS household_name,
              inviter.display_name AS invited_by_display_name
       FROM households household
       JOIN household_memberships membership
         ON membership.household_id = household.id
        AND membership.person_id = $2 AND membership.status = 'active'
       JOIN household_administrator_assignments administrator
         ON administrator.household_id = membership.household_id
        AND administrator.person_id = membership.person_id
        AND administrator.status = 'active'
       JOIN persons inviter ON inviter.id = membership.person_id
       WHERE household.id = $1`,
      [invitation.householdId, invitation.invitedByPersonId],
    );
    const row = display.rows[0];
    if (row === undefined) return null;
    return {
      id: invitation.id,
      household: { id: invitation.householdId, name: row.household_name },
      invitedBy: { displayName: row.invited_by_display_name },
      inviteeDisplayName: invitation.inviteeDisplayName,
      access: 'neutral_membership_only',
      state: 'pending',
      identityBindingState: 'verified_identity',
      intendedPersonId: invitation.intendedPersonId,
      expiresAt: invitation.expiresAt,
      previewVersion: invitation.previewVersion,
    };
  }

  async acceptHouseholdMemberInvitation(input: {
    readonly invitationId: string;
    readonly invitationCredential: string;
    readonly previewVersion: string;
    readonly acceptingIdentityId: string;
    readonly acceptingPersonId: string;
    readonly actorIssuer: string;
    readonly actorSubject: string;
    readonly audience: Audience;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<AcceptedHouseholdMembershipRecord> {
    const credential = splitOpaqueCredential(input.invitationCredential);
    if (credential === null) {
      throw new DomainError('not_found', 'Household invitation is invalid or unavailable');
    }
    return this.database.transaction(async (transaction) => {
      const result = await transaction.query<HouseholdMemberInvitationRow>(
        `SELECT household_id, id, invited_by_person_id, intended_identity_id,
                intended_person_id, intended_identity_issuer, intended_identity_subject,
                invitee_display_name, recipient_code_id, invitation_code_fingerprint,
                fingerprint_key_version, preview_version, state, expires_at, created_at,
                accepted_membership_id,
                accepted_by_person_id, accepted_identity_id, accepted_at,
                revoked_by_person_id, revoked_at, expired_at
         FROM household_member_invitations WHERE id = $1 FOR UPDATE`,
        [input.invitationId],
      );
      const invitation = result.rows[0];
      if (
        invitation === undefined ||
        (invitation.state !== 'pending' && invitation.state !== 'accepted')
      ) {
        throw new DomainError('not_found', 'Household invitation is invalid or unavailable');
      }
      const candidate = fingerprintMinimized(credential.secret, this.fingerprintKey, {
        tenantId: invitation.household_id,
        purpose: 'household-member-invitation',
        keyVersion: invitation.fingerprint_key_version,
      });
      if (
        !constantTimeEqual(candidate.value, invitation.invitation_code_fingerprint) ||
        invitation.recipient_code_id !== credential.id ||
        invitation.preview_version !== input.previewVersion ||
        invitation.intended_identity_id !== input.acceptingIdentityId ||
        invitation.intended_person_id !== input.acceptingPersonId ||
        invitation.intended_identity_issuer !== input.actorIssuer ||
        invitation.intended_identity_subject !== input.actorSubject
      ) {
        throw new DomainError('not_found', 'Household invitation is invalid or unavailable');
      }
      const exactIdentity = await transaction.query<Record<string, unknown>>(
        `SELECT 1 FROM production_customer_bootstraps bootstrap
         JOIN identities identity
           ON identity.id = bootstrap.identity_id
          AND identity.person_id = bootstrap.person_id
          AND identity.issuer = bootstrap.issuer
          AND identity.subject = bootstrap.subject
          AND identity.status = 'active'
         WHERE bootstrap.identity_id = $1 AND bootstrap.person_id = $2
           AND bootstrap.issuer = $3 AND bootstrap.subject = $4`,
        [input.acceptingIdentityId, input.acceptingPersonId, input.actorIssuer, input.actorSubject],
      );
      if (exactIdentity.rows.length !== 1) {
        throw new DomainError('not_found', 'Household invitation is invalid or unavailable');
      }
      if (invitation.state === 'accepted') {
        if (
          invitation.accepted_membership_id === null ||
          invitation.accepted_by_person_id !== input.acceptingPersonId ||
          invitation.accepted_identity_id !== input.acceptingIdentityId
        ) {
          throw new DomainError('not_found', 'Household invitation is invalid or unavailable');
        }
        const membership = await transaction.query<
          { id: string; membership_kind: string; status: string } & Record<string, unknown>
        >(
          `SELECT id, membership_kind, status FROM household_memberships
           WHERE household_id = $1 AND id = $2 AND person_id = $3`,
          [invitation.household_id, invitation.accepted_membership_id, input.acceptingPersonId],
        );
        const membershipRow = membership.rows[0];
        if (
          membershipRow === undefined ||
          membershipRow.membership_kind !== 'member' ||
          membershipRow.status !== 'active'
        ) {
          throw new DomainError('conflict', 'Accepted household membership is unavailable');
        }
        return {
          membershipId: membershipRow.id,
          householdId: invitation.household_id,
          membershipKind: 'member',
          status: 'active',
          reused: true,
        };
      }
      if (
        asDate(invitation.expires_at, 'household_member_invitations.expires_at').getTime() <=
        input.now.getTime()
      ) {
        throw new DomainError('not_found', 'Household invitation is invalid or unavailable');
      }
      const currentInviterAuthority = await transaction.query<Record<string, unknown>>(
        `SELECT 1
         FROM household_memberships membership
         JOIN household_administrator_assignments administrator
           ON administrator.household_id = membership.household_id
          AND administrator.person_id = membership.person_id
          AND administrator.status = 'active'
         WHERE membership.household_id = $1 AND membership.person_id = $2
           AND membership.membership_kind = 'member' AND membership.status = 'active'
         FOR UPDATE OF membership, administrator`,
        [invitation.household_id, invitation.invited_by_person_id],
      );
      if (currentInviterAuthority.rows.length !== 1) {
        throw new DomainError('not_found', 'Household invitation is invalid or unavailable');
      }
      const existingMembership = await transaction.query<Record<string, unknown>>(
        `SELECT 1 FROM household_memberships
         WHERE household_id = $1 AND person_id = $2`,
        [invitation.household_id, input.acceptingPersonId],
      );
      if (existingMembership.rows.length !== 0) {
        throw new DomainError('conflict', 'Household membership already exists');
      }
      const membershipId = this.idFactory.next('membership');
      await transaction.query(
        `INSERT INTO household_memberships(
           household_id, id, person_id, membership_kind, status, created_at
         ) VALUES ($1,$2,$3,'member','active',$4)`,
        [invitation.household_id, membershipId, input.acceptingPersonId, input.now.toISOString()],
      );
      const accepted = await transaction.query(
        `UPDATE household_member_invitations
         SET state = 'accepted', accepted_membership_id = $2,
             accepted_by_person_id = $3, accepted_identity_id = $4, accepted_at = $5
         WHERE household_id = $1 AND id = $6 AND state = 'pending'`,
        [
          invitation.household_id,
          membershipId,
          input.acceptingPersonId,
          input.acceptingIdentityId,
          input.now.toISOString(),
          invitation.id,
        ],
      );
      if (accepted.rowCount !== 1) {
        throw new DomainError('conflict', 'Household invitation acceptance did not complete');
      }
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
          action: 'family.household_member_invitation_accepted',
          resourceType: 'household_member_invitation',
          resourceId: invitation.id,
          outcome: 'completed',
          metadata: { access: 'neutral_membership_only' },
        },
        {
          eventType: 'family.household_member_invitation_accepted.v1',
          aggregateType: 'household_member_invitation',
          aggregateId: invitation.id,
          payload: { state: 'accepted', access: 'neutral_membership_only' },
        },
      );
      return {
        membershipId,
        householdId: invitation.household_id,
        membershipKind: 'member',
        status: 'active',
        reused: false,
      };
    });
  }

  async householdMemberInvitationForCancellation(
    householdId: string,
    invitationId: string,
    now: Date,
  ): Promise<HouseholdMemberInvitationRecord | null> {
    const result = await this.database.query<HouseholdMemberInvitationRow>(
      `SELECT household_id, id, invited_by_person_id, intended_identity_id,
              intended_person_id, intended_identity_issuer, intended_identity_subject,
              invitee_display_name, recipient_code_id, invitation_code_fingerprint,
              fingerprint_key_version,
              preview_version, state, expires_at, created_at, accepted_membership_id,
              accepted_by_person_id, accepted_identity_id, accepted_at,
              revoked_by_person_id, revoked_at, expired_at
       FROM household_member_invitations
       WHERE household_id = $1 AND id = $2 AND state = 'pending' AND expires_at > $3`,
      [householdId, invitationId, now.toISOString()],
    );
    const row = result.rows[0];
    return row === undefined ? null : householdMemberInvitationFromRow(row);
  }

  async revokeHouseholdMemberInvitation(input: {
    readonly invitationId: string;
    readonly householdId: string;
    readonly actorPersonId: string;
    readonly actorIdentityId: string;
    readonly actorIssuer: string;
    readonly actorSubject: string;
    readonly audience: Audience;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<'revoked' | null> {
    return this.database.transaction(async (transaction) => {
      const administrator = await transaction.query<Record<string, unknown>>(
        `SELECT 1
         FROM household_memberships membership
         JOIN household_administrator_assignments administrator
           ON administrator.household_id = membership.household_id
          AND administrator.person_id = membership.person_id
          AND administrator.status = 'active'
         JOIN identities identity
           ON identity.id = $3 AND identity.person_id = membership.person_id
          AND identity.issuer = $4 AND identity.subject = $5
          AND identity.status = 'active'
         WHERE membership.household_id = $1 AND membership.person_id = $2
           AND membership.membership_kind = 'member' AND membership.status = 'active'`,
        [
          input.householdId,
          input.actorPersonId,
          input.actorIdentityId,
          input.actorIssuer,
          input.actorSubject,
        ],
      );
      if (administrator.rows.length !== 1) {
        throw new DomainError('not_authorized', 'Household invitation authority is unavailable');
      }
      const invitation = await transaction.query<Record<string, unknown>>(
        `SELECT 1 FROM household_member_invitations
         WHERE household_id = $1 AND id = $2 AND state = 'pending'
           AND expires_at > $3 FOR UPDATE`,
        [input.householdId, input.invitationId, input.now.toISOString()],
      );
      if (invitation.rows.length !== 1) return null;
      const revoked = await transaction.query(
        `UPDATE household_member_invitations
         SET state = 'revoked', revoked_by_person_id = $3, revoked_at = $4
         WHERE household_id = $1 AND id = $2 AND state = 'pending'`,
        [input.householdId, input.invitationId, input.actorPersonId, input.now.toISOString()],
      );
      if (revoked.rowCount !== 1) return null;
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
          action: 'family.household_member_invitation_revoked',
          resourceType: 'household_member_invitation',
          resourceId: input.invitationId,
          outcome: 'completed',
        },
        {
          eventType: 'family.household_member_invitation_revoked.v1',
          aggregateType: 'household_member_invitation',
          aggregateId: input.invitationId,
          payload: { state: 'revoked' },
        },
      );
      return 'revoked';
    });
  }

  async neutralMembershipForRevocation(
    householdId: string,
    membershipId: string,
  ): Promise<NeutralMembershipScopeRecord | null> {
    const result = await this.database.query<
      { id: string; household_id: string; person_id: string; status: string } & Record<
        string,
        unknown
      >
    >(
      `SELECT id, household_id, person_id, status
       FROM household_memberships
       WHERE household_id = $1 AND id = $2
         AND membership_kind = 'member' AND status = 'active'`,
      [householdId, membershipId],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          membershipId: row.id,
          householdId: row.household_id,
          memberPersonId: row.person_id,
          status: 'active',
        };
  }

  async revokeNeutralMembership(input: {
    readonly membershipId: string;
    readonly householdId: string;
    readonly memberPersonId: string;
    readonly actorPersonId: string;
    readonly actorIdentityId: string;
    readonly actorIssuer: string;
    readonly actorSubject: string;
    readonly audience: Audience;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<'revoked' | null> {
    return this.database.transaction(async (transaction) => {
      const membership = await transaction.query<Record<string, unknown>>(
        `SELECT 1 FROM household_memberships
         WHERE household_id = $1 AND id = $2 AND person_id = $3
           AND membership_kind = 'member' AND status = 'active' FOR UPDATE`,
        [input.householdId, input.membershipId, input.memberPersonId],
      );
      if (membership.rows.length !== 1) return null;
      const exactActor = await transaction.query<Record<string, unknown>>(
        `SELECT 1 FROM identities
         WHERE id = $1 AND person_id = $2 AND issuer = $3 AND subject = $4
           AND status = 'active'`,
        [input.actorIdentityId, input.actorPersonId, input.actorIssuer, input.actorSubject],
      );
      if (exactActor.rows.length !== 1) {
        throw new DomainError('not_authenticated', 'An active identity is required');
      }
      if (input.actorPersonId !== input.memberPersonId) {
        const administrator = await transaction.query<Record<string, unknown>>(
          `SELECT 1 FROM household_memberships membership
           JOIN household_administrator_assignments administrator
             ON administrator.household_id = membership.household_id
            AND administrator.person_id = membership.person_id
            AND administrator.status = 'active'
           WHERE membership.household_id = $1 AND membership.person_id = $2
             AND membership.status = 'active' FOR UPDATE OF membership, administrator`,
          [input.householdId, input.actorPersonId],
        );
        if (administrator.rows.length !== 1) {
          throw new DomainError('not_authorized', 'Household member authority is unavailable');
        }
      }
      const authority = await transaction.query<Record<string, unknown>>(
        `SELECT 1
         WHERE EXISTS (
           SELECT 1 FROM household_administrator_assignments
           WHERE household_id = $1 AND person_id = $2 AND status = 'active'
         ) OR EXISTS (
           SELECT 1 FROM protected_members
           WHERE household_id = $1 AND person_id = $2 AND status = 'accepted'
         ) OR EXISTS (
           SELECT 1 FROM trusted_circle_relationships
           WHERE household_id = $1
             AND (protected_person_id = $2 OR trusted_person_id = $2)
             AND state = 'active'
         ) OR EXISTS (
           SELECT 1 FROM household_billing_authorities
           WHERE household_id = $1 AND person_id = $2 AND status = 'active'
         ) OR EXISTS (
           SELECT 1 FROM household_payers
           WHERE household_id = $1 AND person_id = $2 AND status = 'active'
         )`,
        [input.householdId, input.memberPersonId],
      );
      if (authority.rows.length !== 0) {
        throw new DomainError(
          'conflict',
          'End protected, Trusted Circle, administrator, and billing roles before removing membership',
        );
      }
      const revoked = await transaction.query(
        `UPDATE household_memberships
         SET status = 'revoked', revoked_at = $4
         WHERE household_id = $1 AND id = $2 AND person_id = $3 AND status = 'active'`,
        [input.householdId, input.membershipId, input.memberPersonId, input.now.toISOString()],
      );
      if (revoked.rowCount !== 1) return null;
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
          action: 'family.neutral_membership_revoked',
          resourceType: 'household_membership',
          resourceId: input.membershipId,
          outcome: 'completed',
        },
        {
          eventType: 'family.neutral_membership_revoked.v1',
          aggregateType: 'household_membership',
          aggregateId: input.membershipId,
          payload: { state: 'revoked', authoritySideEffects: 'none' },
        },
      );
      return 'revoked';
    });
  }

  async createInvitation(input: {
    readonly householdId: string;
    readonly invitedByPersonId: string;
    readonly protectedPersonId: string;
    readonly inviteeDisplayName?: string;
    readonly recipientConnectionCode?: string;
    readonly permissions: readonly TrustedPermission[];
    readonly audience: Audience;
    readonly actorIssuer: string;
    readonly sessionId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<
    | {
        readonly invitation: InvitationRecord;
        readonly localInviteCode: string;
        readonly delivery: 'local_only';
        readonly reused: false;
      }
    | {
        readonly invitation: InvitationRecord;
        readonly delivery: 'recipient_manual_only';
        readonly reused: boolean;
      }
  > {
    if (input.invitedByPersonId !== input.protectedPersonId) {
      throw new DomainError(
        'not_authorized',
        'Only the protected member may create this invitation',
      );
    }
    const development = input.actorIssuer === 'boomerbuddy-dev';
    if (
      (development &&
        (input.inviteeDisplayName === undefined || input.recipientConnectionCode !== undefined)) ||
      (!development &&
        (input.recipientConnectionCode === undefined || input.inviteeDisplayName !== undefined))
    ) {
      throw new DomainError(
        'invalid_input',
        development
          ? 'Local invitations require a display name and no production recipient code'
          : 'Production invitations require one recipient connection code',
      );
    }
    const identityBindingState = development
      ? ('development_unbound' as const)
      : ('verified_identity' as const);
    const invitationId = this.idFactory.next('invitation');
    const consentId = this.idFactory.next('consent');
    const consentVersion = `self-invite-v2-${invitationId.slice(-12)}`;
    const localSecret = development ? randomBytes(24).toString('base64url') : undefined;
    const localInviteCode =
      localSecret === undefined ? undefined : `${invitationId}.${localSecret}`;
    const created = await this.database.transaction(async (transaction) => {
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
      let resolvedInviteeDisplayName = input.inviteeDisplayName;
      let intendedIdentity: { readonly issuer: string; readonly subject: string } | undefined;
      let recipientCodeId: string | undefined;
      let invitationSecret = localSecret;
      let expiresAt = new Date(input.now.getTime() + 7 * 24 * 60 * 60 * 1_000);
      if (!development) {
        const credential = splitOpaqueCredential(input.recipientConnectionCode ?? '');
        if (credential === null) {
          throw new DomainError('not_found', 'Recipient connection code is invalid or unavailable');
        }
        const recipient = await transaction.query<RecipientConnectionCodeRow>(
          `SELECT code.id, code.identity_id, code.person_id, code.code_fingerprint,
                  code.fingerprint_key_version, code.state, code.expires_at,
                  identity.issuer, identity.subject, person.display_name
           FROM trusted_circle_recipient_codes code
           JOIN production_customer_bootstraps bootstrap
             ON bootstrap.identity_id = code.identity_id
            AND bootstrap.person_id = code.person_id
           JOIN identities identity
             ON identity.id = bootstrap.identity_id
            AND identity.person_id = bootstrap.person_id
            AND identity.issuer = bootstrap.issuer
            AND identity.subject = bootstrap.subject
            AND identity.status = 'active'
           JOIN persons person ON person.id = code.person_id
           WHERE code.id = $1 FOR UPDATE OF code`,
          [credential.id],
        );
        const recipientRow = recipient.rows[0];
        if (recipientRow === undefined || recipientRow.person_id === input.invitedByPersonId) {
          throw new DomainError('not_found', 'Recipient connection code is invalid or unavailable');
        }
        const candidate = fingerprintMinimized(credential.secret, this.fingerprintKey, {
          tenantId: recipientRow.person_id,
          purpose: 'trusted-circle-recipient-code',
          keyVersion: recipientRow.fingerprint_key_version,
        });
        if (!constantTimeEqual(candidate.value, recipientRow.code_fingerprint)) {
          throw new DomainError('not_found', 'Recipient connection code is invalid or unavailable');
        }
        resolvedInviteeDisplayName = recipientRow.display_name;
        intendedIdentity = { issuer: recipientRow.issuer, subject: recipientRow.subject };
        recipientCodeId = recipientRow.id;
        invitationSecret = credential.secret;
        expiresAt = asDate(recipientRow.expires_at, 'trusted_circle_recipient_codes.expires_at');
        const prior = await transaction.query<InvitationRow>(
          `SELECT household_id, id, protected_person_id, consent_id,
                  latest_consent_evidence_id, invitee_display_name,
                  invite_code_fingerprint, fingerprint_key_version, permissions, state,
                  identity_binding_state, intended_identity_issuer,
                  intended_identity_subject, recipient_code_id, accepted_by_person_id,
                  expires_at, created_at
           FROM invitations
           WHERE household_id = $1 AND invited_by_person_id = $2
             AND protected_person_id = $3 AND recipient_code_id = $4
           FOR UPDATE`,
          [input.householdId, input.invitedByPersonId, input.protectedPersonId, recipientRow.id],
        );
        const priorInvitation = prior.rows[0];
        if (priorInvitation !== undefined) {
          const priorCandidate = fingerprintMinimized(credential.secret, this.fingerprintKey, {
            tenantId: priorInvitation.household_id,
            purpose: 'trusted-circle-invitation',
            keyVersion: priorInvitation.fingerprint_key_version,
          });
          if (
            !constantTimeEqual(priorCandidate.value, priorInvitation.invite_code_fingerprint) ||
            priorInvitation.intended_identity_issuer !== recipientRow.issuer ||
            priorInvitation.intended_identity_subject !== recipientRow.subject ||
            (priorInvitation.state === 'pending' &&
              asDate(priorInvitation.expires_at, 'invitations.expires_at').getTime() <=
                input.now.getTime()) ||
            (priorInvitation.state !== 'pending' && priorInvitation.state !== 'accepted')
          ) {
            throw new DomainError(
              'not_found',
              'Recipient connection code is invalid or unavailable',
            );
          }
          return { invitation: invitationFromRow(priorInvitation), reused: true as const };
        }
        if (recipientRow.state !== 'active' || expiresAt.getTime() <= input.now.getTime()) {
          throw new DomainError('not_found', 'Recipient connection code is invalid or unavailable');
        }
      }
      if (resolvedInviteeDisplayName === undefined || invitationSecret === undefined) {
        throw new DomainError('invalid_input', 'Invitation recipient is unavailable');
      }
      const fingerprint = fingerprintMinimized(invitationSecret, this.fingerprintKey, {
        tenantId: input.householdId,
        purpose: 'trusted-circle-invitation',
        keyVersion: this.fingerprintKeyVersion,
      });
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
           intended_identity_issuer, intended_identity_subject, recipient_code_id,
           expires_at, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'pending',
           $11,$12,$13,$14,$15,$16)`,
        [
          input.householdId,
          invitationId,
          input.invitedByPersonId,
          input.protectedPersonId,
          consentId,
          consentEvidenceId,
          resolvedInviteeDisplayName,
          fingerprint.value,
          fingerprint.keyVersion,
          jsonParameter(input.permissions),
          identityBindingState,
          intendedIdentity?.issuer ?? null,
          intendedIdentity?.subject ?? null,
          recipientCodeId ?? null,
          expiresAt.toISOString(),
          input.now.toISOString(),
        ],
      );
      if (recipientCodeId !== undefined) {
        const consumed = await transaction.query(
          `UPDATE trusted_circle_recipient_codes
           SET state = 'consumed', ended_at = $2
           WHERE id = $1 AND state = 'active'`,
          [recipientCodeId, input.now.toISOString()],
        );
        if (consumed.rowCount !== 1) {
          throw new DomainError('not_found', 'Recipient connection code is invalid or unavailable');
        }
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
            action: 'family.recipient_connection_code_consumed',
            resourceType: 'recipient_connection_code',
            resourceId: recipientCodeId,
            outcome: 'completed',
          },
          {
            eventType: 'family.recipient_connection_code_consumed.v1',
            aggregateType: 'recipient_connection_code',
            aggregateId: recipientCodeId,
            payload: { state: 'consumed' },
          },
        );
      }
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
          payload: {
            delivery: development ? 'local_only' : 'recipient_manual_only',
            state: 'pending',
          },
        },
      );
      return {
        invitation: {
          id: invitationId,
          protectedPersonId: input.protectedPersonId,
          inviteeDisplayName: resolvedInviteeDisplayName,
          permissions: input.permissions,
          state: 'pending' as const,
          identityBindingState,
          expiresAt,
          createdAt: input.now,
        },
        reused: false as const,
      };
    });
    return development
      ? {
          invitation: created.invitation,
          localInviteCode: localInviteCode as string,
          delivery: 'local_only',
          reused: false,
        }
      : {
          invitation: created.invitation,
          delivery: 'recipient_manual_only',
          reused: created.reused,
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
    if (separator < 1 || secret.length < 24) return null;
    const result = await this.database.query<InvitationRow>(
      `SELECT i.household_id, i.id, i.protected_person_id, i.consent_id,
              c.consent_version, i.latest_consent_evidence_id, i.invitee_display_name,
              i.invite_code_fingerprint, i.fingerprint_key_version, i.permissions,
              i.state, i.identity_binding_state, i.intended_identity_issuer,
              i.intended_identity_subject, intended.person_id AS intended_person_id,
              i.recipient_code_id, i.accepted_by_person_id, i.expires_at, i.created_at
       FROM invitations i
       JOIN consents c ON c.household_id = i.household_id AND c.id = i.consent_id
       JOIN consent_current_projections projection
         ON projection.household_id = i.household_id AND projection.consent_id = i.consent_id
        AND projection.latest_evidence_id = i.latest_consent_evidence_id
       LEFT JOIN identities intended
         ON intended.issuer = i.intended_identity_issuer
        AND intended.subject = i.intended_identity_subject AND intended.status = 'active'
       WHERE i.id = $1
         AND ((i.state = 'pending' AND projection.state = 'proposed')
           OR (i.state = 'accepted' AND projection.state = 'active'))`,
      [invitationId],
    );
    const row = result.rows[0];
    if (
      row === undefined ||
      (row.recipient_code_id === null
        ? codeId !== invitationId
        : codeId !== row.recipient_code_id) ||
      (row.identity_binding_state === 'verified_identity' &&
        typeof row.intended_person_id !== 'string') ||
      (row.state === 'pending' &&
        asDate(row.expires_at, 'invitations.expires_at').getTime() <= now.getTime())
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
      ...(typeof row.accepted_by_person_id === 'string'
        ? { acceptedPersonId: row.accepted_by_person_id }
        : {}),
    };
  }

  async previewInvitationCredential(
    invitationId: string,
    localInviteCode: string,
    now: Date,
  ): Promise<InvitationPreviewRecord | null> {
    const invitation = await this.validateInvitationCredential(invitationId, localInviteCode, now);
    if (invitation === null || invitation.state !== 'pending') return null;
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
  }): Promise<{ readonly relationship: RelationshipRecord; readonly reused: boolean }> {
    const separator = input.localInviteCode.indexOf('.');
    const codeId = input.localInviteCode.slice(0, separator);
    const secret = input.localInviteCode.slice(separator + 1);
    if (separator < 1 || secret.length < 24) {
      throw new DomainError('not_found', 'Invitation is invalid or unavailable');
    }
    return this.database.transaction(async (transaction) => {
      const result = await transaction.query<InvitationRow>(
        `SELECT household_id, id, protected_person_id, consent_id, invitee_display_name,
                latest_consent_evidence_id, invite_code_fingerprint,
                fingerprint_key_version, permissions, state, identity_binding_state,
                intended_identity_issuer, intended_identity_subject, recipient_code_id,
                accepted_by_person_id, expires_at, created_at
         FROM invitations WHERE id = $1 FOR UPDATE`,
        [input.invitationId],
      );
      const invitation = result.rows[0];
      if (
        invitation === undefined ||
        (invitation.recipient_code_id === null
          ? codeId !== input.invitationId
          : codeId !== invitation.recipient_code_id)
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
      if (invitation.state === 'accepted') {
        if (invitation.accepted_by_person_id !== input.acceptingPersonId) {
          throw new DomainError('not_found', 'Invitation is invalid or unavailable');
        }
        const accepted = await transaction.query<RelationshipRow>(
          `SELECT relationship.id, relationship.protected_person_id,
                  relationship.trusted_person_id, person.display_name AS trusted_display_name,
                  relationship.permissions, relationship.state, relationship.consent_version,
                  relationship.created_at, relationship.ended_action, relationship.ended_at
           FROM trusted_circle_relationships relationship
           JOIN persons person ON person.id = relationship.trusted_person_id
           JOIN household_memberships membership
             ON membership.household_id = relationship.household_id
            AND membership.person_id = relationship.trusted_person_id
            AND membership.membership_kind = 'member'
            AND membership.status = 'active'
           WHERE relationship.household_id = $1
             AND relationship.consent_id = $2
             AND relationship.protected_person_id = $3
             AND relationship.trusted_person_id = $4
             AND relationship.state = 'active'`,
          [
            invitation.household_id,
            invitation.consent_id,
            invitation.protected_person_id,
            input.acceptingPersonId,
          ],
        );
        const relationship = accepted.rows[0];
        if (relationship === undefined) {
          throw new DomainError('not_found', 'Invitation is invalid or unavailable');
        }
        return {
          relationship: {
            id: relationship.id,
            protectedPersonId: relationship.protected_person_id,
            trustedPersonId: relationship.trusted_person_id,
            trustedDisplayName: relationship.trusted_display_name,
            permissions: permissions(relationship.permissions),
            state: 'active',
            consentVersion: relationship.consent_version,
            createdAt: asDate(relationship.created_at, 'trusted_circle_relationships.created_at'),
          },
          reused: true,
        };
      }
      if (
        invitation.state !== 'pending' ||
        asDate(invitation.expires_at, 'invitations.expires_at').getTime() <= input.now.getTime()
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
      if (existingMembership?.status === 'revoked') {
        throw new DomainError(
          'conflict',
          'A revoked household membership requires a separate reinstatement process',
        );
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
      if (existingMembership === undefined) {
        await transaction.query(
          `INSERT INTO household_memberships(
             household_id, id, person_id, membership_kind, status, created_at
           ) VALUES ($1,$2,$3,'member','active',$4)`,
          [invitation.household_id, membershipId, input.acceptingPersonId, input.now.toISOString()],
        );
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
        relationship: {
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
        },
        reused: false,
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
