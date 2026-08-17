import { createHash, randomBytes } from 'node:crypto';

import {
  assertActiveFoundingHouseholdPolicy,
  DomainError,
  effectiveFoundingHouseholdEnrollmentState,
  effectiveFoundingHouseholdInvitationState,
  foundingHouseholdAccessEndsAt,
  foundingHouseholdAccessAttentionCodes,
  foundingHouseholdBenefitKeys,
  foundingHouseholdBenefitProfiles,
  foundingHouseholdCohortKey,
  foundingHouseholdEnvironmentEvidenceTiers,
  foundingHouseholdEnvironments,
  foundingHouseholdEvidenceTier,
  foundingHouseholdFunnelEvidenceSources,
  foundingHouseholdFunnelStages,
  foundingHouseholdInvitationEndsAt,
  foundingHouseholdPolicyBounds,
  foundingHouseholdProtectedEnrollmentConsentVersion,
  foundingHouseholdServiceConsentVersion,
  type Audience,
  type FoundingHouseholdAccessAttentionCode,
  type FoundingHouseholdBenefitKey,
  type FoundingHouseholdEnrollmentState,
  type FoundingHouseholdEnvironment,
  type FoundingHouseholdFunnelEvidenceSource,
  type FoundingHouseholdFunnelStage,
  type FoundingHouseholdInvitationState,
  type FoundingHouseholdPolicyState,
} from '@boomerbuddy/domain';
import { constantTimeEqual, fingerprintMinimized } from '@boomerbuddy/security';

import { appendConsentEvidence, identityEvidenceForPerson, type ConsentDocuments } from './consent';
import type { Database, SqlExecutor } from './database';
import {
  protectedEnrollment,
  reconcileProtectedMemberAllowanceBindings,
  reconcileTrustedCircleAllowanceBindings,
} from './entitlements';
import { writeAuditAndOutbox } from './events';
import { asDate, randomIdFactory, type IdFactory } from './values';

const definitionVersion = 1 as const;
const localEnvironment = 'local' as const;
const operationKeyPattern =
  /^founding-(policy|invite|accept|invite-revoke|offboard):[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const boundedIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,199}$/u;
const operationResultIdentifier = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,199}$/u;

export const foundingHouseholdServiceDisclosureText =
  'This finite Founding Household beta is sponsored by BoomerBuddy and requires no card. It provides the selected code-owned benefit only until the displayed effective end. To operate this bounded cohort during effective access, BoomerBuddy records only whether an active local account existed before enrollment, orientation became ready, a Check completed without its submitted content or result, an active Trusted Circle relationship was established without message or contact contents, an authenticated minimized feedback intake completed without treating it as useful, and a later authenticated session occurred. The founder console sees the stable internal household identifier, effective sponsor-access state, and these yes-or-no milestones, but not precise event times, Check or feedback content, message or contact contents. These operational facts are retained with the append-only enrollment history under the service retention policy; they are not research, marketing, testimonial, referral, follow-up, or media consent, and they are not evidence of willingness to pay. The accepting administrator may withdraw service consent at any time, including after founder offboarding.';
export const foundingHouseholdServicePolicyText =
  'Founding Household service consent is purpose-limited to delivering and measuring the finite sponsored beta with the bounded operational facts named in the disclosure. Attribution stops at the earliest of withdrawal, founder offboarding, sponsor access end, or program end. Existing consent, enrollment, audit, and bounded operational event history remains append-only under the applicable service retention policy; submitted Check content is excluded, and feedback content has its own retention and withdrawal controls. Research participation, content reuse, marketing, follow-up, referral, testimonial, and media uses require separate explicit consent. Ending this cohort revokes only its sponsor chain and must preserve or rebind unrelated effective entitlements.';
export const foundingHouseholdProtectedDisclosureText =
  'The accepting household administrator separately chooses protected-adult self-enrollment so they can use Check, orientation, history, and Family features within an effective entitlement. This consent can be withdrawn independently.';
export const foundingHouseholdProtectedPolicyText =
  'Protected-adult enrollment is self-consented, versioned, append-only, and independent of payer, administrator, research, marketing, and Founding Household sponsorship authority.';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export const foundingHouseholdServiceDocuments: ConsentDocuments = Object.freeze({
  disclosureVersion: foundingHouseholdServiceConsentVersion,
  disclosureDigest: sha256Hex(foundingHouseholdServiceDisclosureText),
  policyVersion: `${foundingHouseholdServiceConsentVersion}-policy`,
  policyDigest: sha256Hex(foundingHouseholdServicePolicyText),
});

export const foundingHouseholdProtectedDocuments: ConsentDocuments = Object.freeze({
  disclosureVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
  disclosureDigest: sha256Hex(foundingHouseholdProtectedDisclosureText),
  policyVersion: `${foundingHouseholdProtectedEnrollmentConsentVersion}-policy`,
  policyDigest: sha256Hex(foundingHouseholdProtectedPolicyText),
});

export interface FoundingHouseholdFounderAccess {
  readonly actorPersonId: string;
  readonly correlationId: string;
}

export interface FoundingHouseholdMemberAccess {
  readonly actorPersonId: string;
  readonly actorIssuer: string;
  readonly sessionId: string;
  readonly audience: Extract<Audience, 'customer' | 'mobile'>;
  readonly correlationId: string;
}

export type FoundingHouseholdAuthorityClock = (
  transaction: SqlExecutor,
  observedAt: Date,
) => Promise<Date>;

export interface FoundingHouseholdPolicyRecord {
  readonly environment: FoundingHouseholdEnvironment;
  readonly revision: number;
  readonly state: FoundingHouseholdPolicyState;
  readonly benefitKey?: FoundingHouseholdBenefitKey;
  readonly maxHouseholds?: number;
  readonly invitationTtlDays?: number;
  readonly accessDurationDays?: number;
  readonly programEndsAt?: Date;
  readonly changedAt: Date;
}

export interface FoundingHouseholdCapacityRecord {
  readonly maxHouseholds: number;
  readonly activeHouseholds: number;
  readonly attentionHouseholds: number;
  readonly committedHouseholds: number;
  readonly reservedInvitations: number;
  readonly remaining: number;
}

export interface FoundingHouseholdInvitationRecord {
  readonly id: string;
  readonly environment: FoundingHouseholdEnvironment;
  readonly policyRevision: number;
  readonly benefitKey: FoundingHouseholdBenefitKey;
  readonly state: FoundingHouseholdInvitationState;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface FoundingHouseholdFunnelMilestoneRecord {
  readonly stage: FoundingHouseholdFunnelStage;
  readonly state: 'observed' | 'not_observed';
  readonly evidenceSource: FoundingHouseholdFunnelEvidenceSource;
  readonly observedAt?: Date;
}

export type FoundingHouseholdServiceConsentState =
  | 'missing'
  | 'proposed'
  | 'active'
  | 'deferred'
  | 'withdrawn'
  | 'relinquished'
  | 'suspended'
  | 'revoked'
  | 'expired';

export interface FoundingHouseholdEnrollmentRecord {
  readonly id: string;
  readonly environment: FoundingHouseholdEnvironment;
  readonly householdId: string;
  readonly invitationId: string;
  readonly benefitKey: FoundingHouseholdBenefitKey;
  readonly state: FoundingHouseholdEnrollmentState;
  readonly ledgerState: 'active' | 'revoked';
  readonly accessAttentionCode?: FoundingHouseholdAccessAttentionCode;
  readonly serviceConsentState: FoundingHouseholdServiceConsentState;
  readonly acceptedByPersonId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly effectiveEndsAt: Date;
  readonly paymentState: 'not_paid_sponsored_beta';
  readonly evidenceTier: 'local_simulation';
  readonly researchConsent: false;
  readonly marketingConsent: false;
  readonly followUpConsent: false;
  readonly funnel: readonly FoundingHouseholdFunnelMilestoneRecord[];
}

export interface FoundingHouseholdFounderConsoleRecord {
  readonly policy: FoundingHouseholdPolicyRecord;
  readonly capacity: FoundingHouseholdCapacityRecord;
  readonly invitations: readonly FoundingHouseholdInvitationRecord[];
  readonly enrollments: readonly FoundingHouseholdEnrollmentRecord[];
}

interface DefinitionRow extends Record<string, unknown> {
  readonly definition_version: number;
  readonly definition_digest: string;
}

interface PolicyRow extends Record<string, unknown> {
  readonly environment: FoundingHouseholdEnvironment;
  readonly revision: number;
  readonly state: FoundingHouseholdPolicyState;
  readonly benefit_key: FoundingHouseholdBenefitKey | null;
  readonly max_households: number | null;
  readonly invitation_ttl_days: number | null;
  readonly access_duration_days: number | null;
  readonly program_ends_at: unknown | null;
  readonly created_at: unknown;
}

interface InvitationRow extends Record<string, unknown> {
  readonly id: string;
  readonly environment: FoundingHouseholdEnvironment;
  readonly policy_revision: number;
  readonly benefit_key: FoundingHouseholdBenefitKey;
  readonly access_duration_days: number;
  readonly program_ends_at: unknown;
  readonly credential_fingerprint: string | null;
  readonly fingerprint_key_version: number;
  readonly state: Exclude<FoundingHouseholdInvitationState, 'expired'> | 'expired';
  readonly expires_at: unknown;
  readonly created_at: unknown;
}

interface OperationRow extends Record<string, unknown> {
  readonly operation_kind: 'policy' | 'invite' | 'accept' | 'invite_revoke' | 'offboard';
  readonly environment: FoundingHouseholdEnvironment;
  readonly request_digest: string;
  readonly actor_person_id: string;
  readonly result_reference: string;
}

interface SponsorBackingRow extends Record<string, unknown> {
  readonly sponsorship_id: string;
  readonly plan_version_id: string;
  readonly evidence_tier: 'local_simulation';
  readonly sponsorship_ends_at: unknown | null;
}

interface AdministratorAuthorityRow extends Record<string, unknown> {
  readonly issued_at: unknown;
  readonly expires_at: unknown;
}

interface EnrollmentRow extends Record<string, unknown> {
  readonly id: string;
  readonly environment: FoundingHouseholdEnvironment;
  readonly household_id: string;
  readonly invitation_id: string;
  readonly benefit_key: FoundingHouseholdBenefitKey;
  readonly accepted_by_person_id: string;
  readonly accepted_session_id: string;
  readonly protected_enrollment_created: boolean;
  readonly state: 'active' | 'revoked';
  readonly revoked_at: unknown | null;
  readonly access_attention_code: FoundingHouseholdAccessAttentionCode | null;
  readonly service_consent_state: FoundingHouseholdServiceConsentState;
  readonly starts_at: unknown;
  readonly ends_at: unknown;
  readonly effective_ends_at: unknown;
  readonly account_at: unknown | null;
  readonly orientation_at: unknown | null;
  readonly first_check_at: unknown | null;
  readonly trusted_circle_at: unknown | null;
  readonly feedback_at: unknown | null;
  readonly returned_at: unknown | null;
}

function requestDigest(value: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url');
}

function assertIdentifier(value: string, label: string): void {
  if (!boundedIdentifier.test(value)) throw new DomainError('invalid_input', `Invalid ${label}`);
}

function assertOperationKey(value: string, kind: OperationRow['operation_kind']): void {
  const match = operationKeyPattern.exec(value);
  const expected = kind === 'invite_revoke' ? 'invite-revoke' : kind;
  if (match?.[1] !== expected) {
    throw new DomainError('invalid_input', 'Invalid Founding Household idempotency key');
  }
}

export function foundingHouseholdDefinitionDigest(): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        cohortKey: foundingHouseholdCohortKey,
        definitionVersion,
        environments: foundingHouseholdEnvironments.map((environment) => ({
          key: environment,
          evidenceTier: foundingHouseholdEnvironmentEvidenceTiers[environment],
        })),
        benefits: foundingHouseholdBenefitKeys.map((key) => foundingHouseholdBenefitProfiles[key]),
        bounds: foundingHouseholdPolicyBounds,
        funnel: {
          attentionCodes: foundingHouseholdAccessAttentionCodes,
          stages: foundingHouseholdFunnelStages,
          evidenceSources: foundingHouseholdFunnelEvidenceSources,
          attributionWindow: {
            accountReady: 'active_local_identity_created_at_or_before_enrollment_start',
            cohortEvents:
              'enrollment_start_inclusive_to_minimum_enrollment_sponsor_subscription_allocation_grant_or_service_consent_end_exclusive',
            feedbackSubmitted:
              'authenticated_household_person_completed_minimized_safe_intake_only',
            returnedLater: 'different_local_session_at_least_24_hours_after_enrollment_start',
          },
        },
        serviceConsent: foundingHouseholdServiceDocuments,
        protectedEnrollmentConsent: foundingHouseholdProtectedDocuments,
      }),
    )
    .digest('base64url');
}

function policyFromRow(row: PolicyRow): FoundingHouseholdPolicyRecord {
  return {
    environment: row.environment,
    revision: row.revision,
    state: row.state,
    ...(row.benefit_key === null ? {} : { benefitKey: row.benefit_key }),
    ...(row.max_households === null ? {} : { maxHouseholds: row.max_households }),
    ...(row.invitation_ttl_days === null ? {} : { invitationTtlDays: row.invitation_ttl_days }),
    ...(row.access_duration_days === null ? {} : { accessDurationDays: row.access_duration_days }),
    ...(row.program_ends_at === null
      ? {}
      : { programEndsAt: asDate(row.program_ends_at, 'founding policy program end') }),
    changedAt: asDate(row.created_at, 'founding policy created_at'),
  };
}

function invitationFromRow(row: InvitationRow, now: Date): FoundingHouseholdInvitationRecord {
  const expiresAt = asDate(row.expires_at, 'founding invitation expires_at');
  return {
    id: row.id,
    environment: row.environment,
    policyRevision: row.policy_revision,
    benefitKey: row.benefit_key,
    state: effectiveFoundingHouseholdInvitationState(row.state, expiresAt, now),
    createdAt: asDate(row.created_at, 'founding invitation created_at'),
    expiresAt,
  };
}

function milestone(
  stage: FoundingHouseholdFunnelStage,
  evidenceSource: FoundingHouseholdFunnelEvidenceSource,
  value: unknown | null,
): FoundingHouseholdFunnelMilestoneRecord {
  return value === null
    ? { stage, state: 'not_observed', evidenceSource }
    : {
        stage,
        state: 'observed',
        evidenceSource,
        observedAt: asDate(value, `founding funnel ${stage}`),
      };
}

function enrollmentFromRow(row: EnrollmentRow, now: Date): FoundingHouseholdEnrollmentRecord {
  const startsAt = asDate(row.starts_at, 'founding enrollment starts_at');
  const endsAt = asDate(row.ends_at, 'founding enrollment ends_at');
  const effectiveEndsAt = asDate(row.effective_ends_at, 'founding enrollment effective_ends_at');
  const dateState = effectiveFoundingHouseholdEnrollmentState(row.state, effectiveEndsAt, now);
  const state =
    row.state === 'active' && row.access_attention_code !== null ? 'attention' : dateState;
  const funnel = [
    milestone('account_ready', 'active_identity', row.account_at),
    milestone('founding_household_accepted', 'cohort_enrollment', row.starts_at),
    milestone('orientation_ready', 'orientation_state', row.orientation_at),
    milestone('first_check_completed', 'completed_analysis', row.first_check_at),
    milestone('result_comprehension_confirmed', 'not_implemented', null),
    milestone('safe_next_action_confirmed', 'not_implemented', null),
    milestone('trusted_circle_established', 'trusted_circle_relationship', row.trusted_circle_at),
    milestone('service_value_confirmed', 'not_implemented', null),
    milestone('feedback_submitted', 'feedback_record', row.feedback_at),
    milestone('returned_later', 'later_session', row.returned_at),
  ] satisfies readonly FoundingHouseholdFunnelMilestoneRecord[];
  if (funnel.length !== foundingHouseholdFunnelStages.length) {
    throw new Error('Founding Household funnel definition is incomplete');
  }
  return {
    id: row.id,
    environment: row.environment,
    householdId: row.household_id,
    invitationId: row.invitation_id,
    benefitKey: row.benefit_key,
    state,
    ledgerState: row.state,
    ...(row.access_attention_code === null
      ? {}
      : { accessAttentionCode: row.access_attention_code }),
    serviceConsentState: row.service_consent_state,
    acceptedByPersonId: row.accepted_by_person_id,
    startsAt,
    endsAt,
    effectiveEndsAt,
    paymentState: 'not_paid_sponsored_beta',
    evidenceTier: foundingHouseholdEvidenceTier,
    researchConsent: false,
    marketingConsent: false,
    followUpConsent: false,
    funnel,
  };
}

async function lockConfiguredFounder(
  transaction: SqlExecutor,
  configuredFounderPersonId: string | undefined,
  actorPersonId: string,
): Promise<void> {
  if (configuredFounderPersonId === undefined || configuredFounderPersonId !== actorPersonId) {
    throw new DomainError('not_authorized', 'The exact configured founder identity is required');
  }
  const result = await transaction.query(
    `SELECT employee.id FROM employee_assignments employee
     JOIN organizations organization ON organization.id = employee.organization_id
     WHERE employee.person_id = $1 AND employee.role = 'hq_owner'
       AND employee.status = 'active' AND organization.kind = 'internal'
     ORDER BY employee.id LIMIT 1 FOR UPDATE`,
    [actorPersonId],
  );
  if (result.rows[0] === undefined) {
    throw new DomainError('not_authorized', 'An active internal hq_owner assignment is required');
  }
}

async function bindConfiguredFounderAuthority(
  transaction: SqlExecutor,
  actorPersonId: string,
  authorityNow: Date,
): Promise<void> {
  await transaction.query(
    `INSERT INTO founding_household_founder_authorities(
       cohort_key, environment, founder_person_id, bound_at
     ) VALUES ($1,$2,$3,$4)
     ON CONFLICT (cohort_key, environment) DO NOTHING`,
    [foundingHouseholdCohortKey, localEnvironment, actorPersonId, authorityNow.toISOString()],
  );
  const result = await transaction.query<{ founder_person_id: string } & Record<string, unknown>>(
    `SELECT founder_person_id FROM founding_household_founder_authorities
     WHERE cohort_key = $1 AND environment = $2 FOR UPDATE`,
    [foundingHouseholdCohortKey, localEnvironment],
  );
  if (result.rows[0]?.founder_person_id !== actorPersonId) {
    throw new DomainError(
      'not_authorized',
      'Founding Household authority is bound to a different configured founder',
    );
  }
}

async function lockActiveAdministrator(
  transaction: SqlExecutor,
  access: FoundingHouseholdMemberAccess,
  householdId: string,
): Promise<AdministratorAuthorityRow> {
  if (access.actorIssuer !== 'boomerbuddy-dev') {
    throw new DomainError(
      'not_authorized',
      'A reviewed managed identity adapter is required outside local simulation',
    );
  }
  const result = await transaction.query<AdministratorAuthorityRow>(
    `SELECT session.issued_at, session.expires_at
     FROM household_memberships membership
     JOIN household_administrator_assignments administrator
       ON administrator.household_id = membership.household_id
      AND administrator.person_id = membership.person_id
     JOIN identities identity ON identity.person_id = membership.person_id
     JOIN sessions session ON session.id = $4
       AND session.person_id = membership.person_id
       AND session.issuer = identity.issuer
     WHERE membership.household_id = $1 AND membership.person_id = $2
       AND membership.status = 'active' AND administrator.status = 'active'
       AND identity.issuer = $3 AND identity.status = 'active'
       AND session.audience = $5 AND session.revoked_at IS NULL
     ORDER BY membership.id LIMIT 1
     FOR UPDATE OF membership, administrator, identity, session`,
    [householdId, access.actorPersonId, access.actorIssuer, access.sessionId, access.audience],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new DomainError(
      'not_authorized',
      'Founding Household acceptance requires an active household administrator identity',
    );
  }
  return row;
}

function assertAdministratorSessionCurrent(
  row: AdministratorAuthorityRow,
  authorityNow: Date,
): void {
  const issuedAt = asDate(row.issued_at, 'founding administrator session issued_at');
  const expiresAt = asDate(row.expires_at, 'founding administrator session expires_at');
  if (issuedAt > authorityNow || expiresAt <= authorityNow) {
    throw new DomainError(
      'not_authorized',
      'Founding Household acceptance requires a current administrator session',
    );
  }
}

const databaseFoundingHouseholdAuthorityClock: FoundingHouseholdAuthorityClock = async (
  transaction,
) => {
  const result = await transaction.query<{ authority_now: unknown } & Record<string, unknown>>(
    'SELECT capture_founding_household_authority_now() AS authority_now',
  );
  const value = result.rows[0]?.authority_now;
  return asDate(value, 'founding household authority clock');
};

async function lockDefinition(transaction: SqlExecutor): Promise<void> {
  const result = await transaction.query<DefinitionRow>(
    `SELECT definition_version, definition_digest
     FROM founding_household_program_definitions
     WHERE cohort_key = $1 FOR UPDATE`,
    [foundingHouseholdCohortKey],
  );
  const row = result.rows[0];
  if (
    row === undefined ||
    row.definition_version !== definitionVersion ||
    row.definition_digest !== foundingHouseholdDefinitionDigest()
  ) {
    throw new Error(
      `Founding Household code-owned definition drift: stored=${row?.definition_digest ?? 'missing'} expected=${foundingHouseholdDefinitionDigest()}`,
    );
  }
  const plus = foundingHouseholdBenefitProfiles.plus_beta_v1;
  const family = foundingHouseholdBenefitProfiles.family_beta_v1;
  const planResult = await transaction.query<{ id: string } & Record<string, unknown>>(
    `SELECT plan.id FROM commerce_plan_versions plan
     JOIN commerce_product_versions product ON product.id = plan.product_version_id
     WHERE product.id = 'consumer_household_v1'
       AND product.product_key = 'consumer_household' AND product.version = 1
       AND product.available_until IS NULL AND plan.state = 'active'
       AND plan.available_until IS NULL
       AND (
         (plan.id = $1 AND plan.plan_key = 'plus' AND plan.version = 2
          AND plan.display_name = 'Founding Plus beta sponsor benefit'
          AND plan.capabilities = $2::jsonb AND plan.allowances = $3::jsonb
          AND plan.prices = $4::jsonb)
         OR
         (plan.id = $5 AND plan.plan_key = 'family' AND plan.version = 2
          AND plan.display_name = 'Founding Family beta sponsor benefit'
          AND plan.capabilities = $6::jsonb AND plan.allowances = $7::jsonb
          AND plan.prices = $8::jsonb)
       )
     ORDER BY plan.id FOR UPDATE OF plan, product`,
    [
      plus.planVersionId,
      JSON.stringify(plus.capabilities),
      JSON.stringify([
        { kind: 'protected_members', limit: plus.protectedMemberLimit },
        { kind: 'trusted_circle_participants', limit: plus.trustedCircleLimit },
      ]),
      JSON.stringify([plus.price]),
      family.planVersionId,
      JSON.stringify(family.capabilities),
      JSON.stringify([
        { kind: 'protected_members', limit: family.protectedMemberLimit },
        { kind: 'trusted_circle_participants', limit: family.trustedCircleLimit },
      ]),
      JSON.stringify([family.price]),
    ],
  );
  if (planResult.rows.length !== foundingHouseholdBenefitKeys.length) {
    throw new Error('Founding Household sponsor benefit catalogue drift');
  }
}

async function currentPolicy(transaction: SqlExecutor): Promise<PolicyRow> {
  const result = await transaction.query<PolicyRow>(
    `SELECT environment, revision, state, benefit_key, max_households,
            invitation_ttl_days, access_duration_days, program_ends_at, created_at
     FROM founding_household_policy_versions
     WHERE cohort_key = $1 AND environment = $2
     ORDER BY revision DESC LIMIT 1`,
    [foundingHouseholdCohortKey, localEnvironment],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('Founding Household local policy is missing');
  return row;
}

async function currentSponsorBacking(
  transaction: SqlExecutor,
  benefitKey: FoundingHouseholdBenefitKey,
  now: Date,
): Promise<SponsorBackingRow | null> {
  const result = await transaction.query<SponsorBackingRow>(
    `SELECT backing.sponsorship_id, backing.plan_version_id, backing.evidence_tier,
            sponsorship.ends_at AS sponsorship_ends_at
     FROM founding_household_sponsor_backings backing
     JOIN commerce_sponsorships sponsorship
       ON sponsorship.id = backing.sponsorship_id
      AND sponsorship.organization_id = backing.organization_id
      AND sponsorship.plan_version_id = backing.plan_version_id
     JOIN organizations organization ON organization.id = backing.organization_id
     JOIN commerce_plan_versions plan ON plan.id = backing.plan_version_id
     WHERE backing.cohort_key = $1 AND backing.environment = $2
       AND backing.benefit_key = $3 AND backing.evidence_tier = $4
       AND sponsorship.state = 'active' AND sponsorship.starts_at <= $5
       AND (sponsorship.ends_at IS NULL OR sponsorship.ends_at > $5)
       AND organization.kind = 'sponsor'
       AND organization.verification_state = 'local_fixture'
       AND plan.state = 'active'
     FOR UPDATE OF backing, sponsorship, organization, plan`,
    [
      foundingHouseholdCohortKey,
      localEnvironment,
      benefitKey,
      foundingHouseholdEvidenceTier,
      now.toISOString(),
    ],
  );
  return result.rows[0] ?? null;
}

function sponsorBoundedAccessEndsAt(
  acceptedAt: Date,
  accessDurationDays: number,
  programEndsAt: Date,
  backing: SponsorBackingRow,
): Date {
  const policyBound = foundingHouseholdAccessEndsAt(acceptedAt, accessDurationDays, programEndsAt);
  const sponsorshipEnd =
    backing.sponsorship_ends_at === null
      ? undefined
      : asDate(backing.sponsorship_ends_at, 'founding sponsor backing ends_at');
  const endsAt =
    sponsorshipEnd === undefined || sponsorshipEnd >= policyBound ? policyBound : sponsorshipEnd;
  if (endsAt <= acceptedAt) {
    throw new DomainError('expired', 'Founding Household sponsor backing has expired');
  }
  return endsAt;
}

async function existingOperation(
  transaction: SqlExecutor,
  input: {
    readonly operationKey: string;
    readonly kind: OperationRow['operation_kind'];
    readonly requestDigest: string;
    readonly actorPersonId: string;
  },
): Promise<string | null> {
  const result = await transaction.query<OperationRow>(
    `SELECT operation_kind, environment, request_digest, actor_person_id, result_reference
     FROM founding_household_operations WHERE operation_key = $1`,
    [input.operationKey],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  if (
    row.operation_kind !== input.kind ||
    row.environment !== localEnvironment ||
    row.request_digest !== input.requestDigest ||
    row.actor_person_id !== input.actorPersonId
  ) {
    throw new DomainError(
      'conflict',
      'Founding Household idempotency key was used for a different request',
    );
  }
  return row.result_reference;
}

function policyOperationResult(reference: string): {
  readonly revision: number;
  readonly invalidatedInvitationCount: number;
} {
  const match = /^(\d{1,10}):(\d{1,2})$/u.exec(reference);
  const revision = Number(match?.[1]);
  const invalidatedInvitationCount = Number(match?.[2]);
  if (
    match === null ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    revision > 2_147_483_647 ||
    !Number.isSafeInteger(invalidatedInvitationCount) ||
    invalidatedInvitationCount < 0 ||
    invalidatedInvitationCount > foundingHouseholdPolicyBounds.maxHouseholds.max
  ) {
    throw new Error('Founding Household policy operation result is invalid');
  }
  return { revision, invalidatedInvitationCount };
}

function offboardOperationResult(reference: string): {
  readonly enrollmentId: string;
  readonly reboundProtectedAllocations: number;
  readonly reboundTrustedCircleAllocations: number;
} {
  const match = /^([A-Za-z0-9][A-Za-z0-9._/-]{1,199}):(\d):(\d)$/u.exec(reference);
  const reboundProtectedAllocations = Number(match?.[2]);
  const reboundTrustedCircleAllocations = Number(match?.[3]);
  if (
    match === null ||
    !operationResultIdentifier.test(match[1] ?? '') ||
    !Number.isSafeInteger(reboundProtectedAllocations) ||
    reboundProtectedAllocations < 0 ||
    reboundProtectedAllocations > 3 ||
    !Number.isSafeInteger(reboundTrustedCircleAllocations) ||
    reboundTrustedCircleAllocations < 0 ||
    reboundTrustedCircleAllocations > 6
  ) {
    throw new Error('Founding Household offboarding operation result is invalid');
  }
  return {
    enrollmentId: match[1] as string,
    reboundProtectedAllocations,
    reboundTrustedCircleAllocations,
  };
}

async function insertOperation(
  transaction: SqlExecutor,
  input: {
    readonly operationKey: string;
    readonly kind: OperationRow['operation_kind'];
    readonly requestDigest: string;
    readonly actorPersonId: string;
    readonly resultReference: string;
    readonly now: Date;
  },
): Promise<void> {
  await transaction.query(
    `INSERT INTO founding_household_operations(
       operation_key, cohort_key, environment, operation_kind, request_digest,
       actor_person_id, result_reference, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.operationKey,
      foundingHouseholdCohortKey,
      localEnvironment,
      input.kind,
      input.requestDigest,
      input.actorPersonId,
      input.resultReference,
      input.now.toISOString(),
    ],
  );
}

async function bindExistingTrustedCircleAllocationsToFoundingGrant(
  transaction: SqlExecutor,
  input: {
    readonly householdId: string;
    readonly entitlementGrantId: string;
    readonly limit: number;
  },
): Promise<number> {
  const allocations = await transaction.query<{ id: string } & Record<string, unknown>>(
    `SELECT allocation.id
     FROM commerce_allowance_allocations allocation
     WHERE allocation.household_id = $1 AND allocation.state = 'active'
       AND allocation.allowance_key = 'trusted_circle_participants'
       AND allocation.subject_kind = 'trusted_circle_person'
       AND EXISTS (
         SELECT 1 FROM trusted_circle_relationships relationship
         JOIN consent_current_projections consent
           ON consent.household_id = relationship.household_id
          AND consent.consent_id = relationship.consent_id
          AND consent.latest_evidence_id = relationship.latest_consent_evidence_id
          AND consent.state = 'active'
         WHERE relationship.household_id = allocation.household_id
           AND relationship.trusted_person_id = allocation.subject_id
           AND relationship.state = 'active'
       )
     ORDER BY allocation.allocated_at, allocation.id
     LIMIT $2 FOR UPDATE OF allocation`,
    [input.householdId, input.limit],
  );
  for (const allocation of allocations.rows) {
    const rebound = await transaction.query(
      `UPDATE commerce_allowance_allocations SET entitlement_grant_id = $3
       WHERE household_id = $1 AND id = $2 AND state = 'active'
         AND allowance_key = 'trusted_circle_participants'
         AND subject_kind = 'trusted_circle_person'`,
      [input.householdId, allocation.id, input.entitlementGrantId],
    );
    if (rebound.rowCount !== 1) {
      throw new DomainError('conflict', 'Trusted Circle Founding allowance binding changed');
    }
  }
  return allocations.rows.length;
}

async function bindExistingProtectedAllocationsToFoundingGrant(
  transaction: SqlExecutor,
  input: {
    readonly householdId: string;
    readonly acceptingPersonId: string;
    readonly entitlementGrantId: string;
    readonly limit: number;
  },
): Promise<number> {
  const allocations = await transaction.query<{ id: string } & Record<string, unknown>>(
    `SELECT allocation.id
     FROM commerce_allowance_allocations allocation
     JOIN protected_members protected
       ON protected.household_id = allocation.household_id
      AND protected.person_id = allocation.subject_id
      AND protected.allowance_allocation_id = allocation.id
      AND protected.status = 'accepted'
     JOIN household_memberships membership
       ON membership.household_id = protected.household_id
      AND membership.person_id = protected.person_id
      AND membership.status = 'active'
     JOIN consent_current_projections consent
       ON consent.household_id = protected.household_id
      AND consent.consent_id = protected.consent_id
      AND consent.latest_evidence_id = protected.latest_consent_evidence_id
      AND consent.state = 'active'
     WHERE allocation.household_id = $1 AND allocation.state = 'active'
       AND allocation.allowance_key = 'protected_members'
       AND allocation.subject_kind = 'protected_member'
     ORDER BY (allocation.subject_id = $2) DESC, allocation.allocated_at, allocation.id
     LIMIT $3 FOR UPDATE OF allocation`,
    [input.householdId, input.acceptingPersonId, input.limit],
  );
  for (const allocation of allocations.rows) {
    const rebound = await transaction.query(
      `UPDATE commerce_allowance_allocations SET entitlement_grant_id = $3
       WHERE household_id = $1 AND id = $2 AND state = 'active'
         AND allowance_key = 'protected_members' AND subject_kind = 'protected_member'`,
      [input.householdId, allocation.id, input.entitlementGrantId],
    );
    if (rebound.rowCount !== 1) {
      throw new DomainError('conflict', 'Protected-member Founding allowance binding changed');
    }
  }
  return allocations.rows.length;
}

async function expireDueInvitations(transaction: SqlExecutor, now: Date): Promise<number> {
  const result = await transaction.query(
    `UPDATE founding_household_invitations
     SET state = 'expired', credential_fingerprint = NULL, ended_at = $3
     WHERE cohort_key = $1 AND environment = $2 AND state = 'pending'
       AND expires_at <= $3`,
    [foundingHouseholdCohortKey, localEnvironment, now.toISOString()],
  );
  return result.rowCount;
}

async function writeFounderReadAudit(
  transaction: SqlExecutor,
  ids: IdFactory,
  access: FoundingHouseholdFounderAccess,
  now: Date,
  expiredInvitationCount: number,
): Promise<void> {
  await transaction.query(
    `INSERT INTO audit_events(
       id, household_id, actor_person_id, session_audience, action, resource_type,
       resource_id, outcome, metadata, correlation_id, occurred_at
     ) VALUES ($1,NULL,$2,'hq','founding_household.console_read',
       'founding_household_program',$3,'allowed',$4::jsonb,$5,$6)`,
    [
      ids.next('audit'),
      access.actorPersonId,
      foundingHouseholdCohortKey,
      JSON.stringify({
        environment: localEnvironment,
        evidenceTier: foundingHouseholdEvidenceTier,
        expiredInvitationCount,
        externalActionExecuted: false,
        paymentCollected: false,
      }),
      access.correlationId,
      now.toISOString(),
    ],
  );
}

async function enrollmentRows(
  executor: SqlExecutor,
  now: Date,
  householdId?: string,
  enrollmentId?: string,
): Promise<readonly EnrollmentRow[]> {
  const result = await executor.query<EnrollmentRow>(
    `SELECT enrollment.id, enrollment.environment, enrollment.household_id,
            enrollment.invitation_id, enrollment.benefit_key,
            enrollment.accepted_by_person_id, enrollment.accepted_session_id,
            enrollment.protected_enrollment_created,
            enrollment.state, enrollment.starts_at, enrollment.ends_at, enrollment.revoked_at,
       access_resolution.effective_ends_at,
       COALESCE(service_consent.state, 'missing') AS service_consent_state,
       access_resolution.access_attention_code,
       (SELECT min(identity.created_at) FROM identities identity
        WHERE identity.person_id = enrollment.accepted_by_person_id
          AND identity.issuer = 'boomerbuddy-dev'
          AND identity.status = 'active'
          AND identity.created_at <= enrollment.starts_at) AS account_at,
       (SELECT min(orientation.updated_at) FROM orientation_states orientation
        WHERE orientation.household_id = enrollment.household_id
          AND orientation.person_id = enrollment.accepted_by_person_id
          AND orientation.status = 'ready'
          AND orientation.updated_at >= enrollment.starts_at
          AND orientation.updated_at < access_resolution.effective_ends_at) AS orientation_at,
       (SELECT min(analysis.created_at) FROM analyses analysis
        WHERE analysis.household_id = enrollment.household_id
          AND analysis.requested_by = enrollment.accepted_by_person_id
          AND analysis.state = 'completed'
          AND analysis.created_at >= enrollment.starts_at
          AND analysis.created_at < access_resolution.effective_ends_at) AS first_check_at,
       (SELECT min(relationship.created_at) FROM trusted_circle_relationships relationship
        JOIN consent_current_projections consent
          ON consent.household_id = relationship.household_id
         AND consent.consent_id = relationship.consent_id
         AND consent.latest_evidence_id = relationship.latest_consent_evidence_id
        WHERE relationship.household_id = enrollment.household_id
          AND relationship.protected_person_id = enrollment.accepted_by_person_id
          AND relationship.state = 'active' AND consent.state = 'active'
          AND relationship.created_at >= enrollment.starts_at
          AND relationship.created_at < access_resolution.effective_ends_at) AS trusted_circle_at,
       (SELECT min(feedback.created_at) FROM feedback_records feedback
        JOIN feedback_intake_operations operation
          ON operation.feedback_id = feedback.id AND operation.completed_at IS NOT NULL
         AND operation.response_status IN ('queued_unassigned','assigned')
         AND operation.response_redaction_status IN ('minimized_clean','minimized_redacted')
        WHERE feedback.identity_mode = 'authenticated'
          AND feedback.household_id = enrollment.household_id
          AND feedback.actor_person_id = enrollment.accepted_by_person_id
          AND feedback.evidence_tier = 'local_simulation'
          AND feedback.created_at >= enrollment.starts_at
          AND feedback.created_at < access_resolution.effective_ends_at
          AND EXISTS (
            SELECT 1 FROM feedback_state_events state
            WHERE state.feedback_id = feedback.id AND state.to_status = 'minimized'
          )) AS feedback_at,
       (SELECT min(session.issued_at) FROM sessions session
        WHERE session.person_id = enrollment.accepted_by_person_id
          AND session.id <> enrollment.accepted_session_id
          AND session.audience IN ('customer','mobile')
          AND session.issuer = 'boomerbuddy-dev'
          AND session.issued_at >= enrollment.starts_at + interval '24 hours'
          AND session.issued_at < access_resolution.effective_ends_at) AS returned_at
     FROM founding_household_enrollments enrollment
     LEFT JOIN founding_household_sponsor_backings backing
       ON backing.cohort_key = enrollment.cohort_key
      AND backing.environment = enrollment.environment
      AND backing.benefit_key = enrollment.benefit_key
      AND backing.sponsorship_id = enrollment.sponsorship_id
      AND backing.plan_version_id = enrollment.plan_version_id
     LEFT JOIN commerce_sponsorships sponsorship
       ON sponsorship.id = backing.sponsorship_id
      AND sponsorship.organization_id = backing.organization_id
      AND sponsorship.plan_version_id = backing.plan_version_id
     LEFT JOIN organizations organization ON organization.id = backing.organization_id
     LEFT JOIN commerce_plan_versions plan ON plan.id = backing.plan_version_id
     LEFT JOIN commerce_subscriptions subscription
       ON subscription.household_id = enrollment.household_id
      AND subscription.id = enrollment.subscription_id
     LEFT JOIN commerce_sponsorship_allocations allocation
       ON allocation.household_id = enrollment.household_id
      AND allocation.id = enrollment.sponsorship_allocation_id
     LEFT JOIN entitlement_grants grant_record
       ON grant_record.household_id = enrollment.household_id
      AND grant_record.id = enrollment.entitlement_grant_id
     LEFT JOIN consents service_consent_origin
       ON service_consent_origin.household_id = enrollment.household_id
      AND service_consent_origin.id = enrollment.service_consent_id
     LEFT JOIN consent_current_projections service_consent
       ON service_consent.household_id = enrollment.household_id
      AND service_consent.consent_id = enrollment.service_consent_id
     LEFT JOIN consent_evidence service_evidence
       ON service_evidence.household_id = service_consent.household_id
      AND service_evidence.consent_id = service_consent.consent_id
      AND service_evidence.id = service_consent.latest_evidence_id
     CROSS JOIN LATERAL (
       SELECT
         (
           backing.cohort_key IS NOT NULL
           AND backing.environment = enrollment.environment
           AND backing.benefit_key = enrollment.benefit_key
           AND backing.sponsorship_id = enrollment.sponsorship_id
           AND backing.plan_version_id = enrollment.plan_version_id
           AND backing.evidence_tier = CASE enrollment.environment
             WHEN 'local' THEN 'local_simulation'
             WHEN 'staging' THEN 'deployed_staging'
             ELSE 'live_production'
           END
           AND sponsorship.id IS NOT NULL
           AND sponsorship.organization_id = backing.organization_id
           AND sponsorship.plan_version_id = backing.plan_version_id
           AND organization.kind = 'sponsor'
           AND (
             (enrollment.environment = 'local'
               AND organization.verification_state = 'local_fixture')
             OR (enrollment.environment <> 'local'
               AND organization.verification_state = 'verified')
           )
           AND plan.id = enrollment.plan_version_id
           AND plan.state = 'active'
         ) AS sponsor_basis_valid,
         (
           subscription.id IS NOT NULL
           AND subscription.payer_person_id IS NULL
           AND subscription.source = 'sponsor'
           AND subscription.source_verified = true
           AND subscription.reconciliation_state = 'not_required'
           AND subscription.plan_version_id = enrollment.plan_version_id
           AND subscription.current_period_starts_at = enrollment.starts_at
         ) AS subscription_basis_valid,
         (
           allocation.id IS NOT NULL
           AND allocation.sponsorship_id = enrollment.sponsorship_id
           AND allocation.plan_version_id = enrollment.plan_version_id
           AND allocation.source_verified = true
           AND allocation.starts_at = enrollment.starts_at
         ) AS allocation_basis_valid,
         (
           grant_record.id IS NOT NULL
           AND grant_record.source = 'sponsor'
           AND grant_record.source_verified = true
           AND grant_record.plan_version_id = enrollment.plan_version_id
           AND grant_record.subscription_id = enrollment.subscription_id
           AND grant_record.sponsorship_id = enrollment.sponsorship_allocation_id
           AND grant_record.starts_at = enrollment.starts_at
           AND grant_record.capabilities = plan.capabilities
         ) AS grant_basis_valid,
         (
           service_consent_origin.id IS NOT NULL
           AND service_consent_origin.protected_person_id = enrollment.accepted_by_person_id
           AND service_consent_origin.granted_by_person_id = enrollment.accepted_by_person_id
           AND service_consent_origin.purpose = 'founding_household_service_beta'
           AND service_consent_origin.consent_version = $6
           AND service_consent_origin.state = 'active'
           AND service_consent_origin.granted_at = enrollment.starts_at
           AND service_consent.consent_id IS NOT NULL
           AND service_consent.actor_person_id = enrollment.accepted_by_person_id
           AND service_consent.subject_person_id = enrollment.accepted_by_person_id
           AND service_consent.recipient_person_id IS NULL
           AND service_consent.purpose = 'founding_household_service_beta'
           AND service_evidence.id IS NOT NULL
           AND service_evidence.actor_person_id = service_consent.actor_person_id
           AND service_evidence.subject_person_id = service_consent.subject_person_id
           AND service_evidence.recipient_person_id IS NOT DISTINCT FROM
             service_consent.recipient_person_id
           AND service_evidence.purpose = service_consent.purpose
           AND service_evidence.scope = service_consent.scope
           AND service_evidence.effective_at = service_consent.effective_at
           AND service_evidence.expires_at IS NOT DISTINCT FROM service_consent.expires_at
           AND service_evidence.recorded_at = service_consent.updated_at
           AND service_evidence.disclosure_version = $6
           AND service_evidence.disclosure_digest = $7
           AND service_evidence.policy_version = $8
           AND service_evidence.policy_digest = $9
           AND service_evidence.action = CASE service_consent.state
             WHEN 'proposed' THEN 'propose'
             WHEN 'active' THEN 'accept'
             WHEN 'deferred' THEN 'defer'
             WHEN 'withdrawn' THEN 'withdraw'
             WHEN 'relinquished' THEN 'relinquish'
             WHEN 'suspended' THEN 'suspend'
             WHEN 'revoked' THEN 'revoke'
             WHEN 'expired' THEN 'expire'
           END
           AND service_consent.scope = CASE
             WHEN service_consent.state = 'active' THEN jsonb_build_object(
               'accessEndsAt', to_char(
                 enrollment.ends_at AT TIME ZONE 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
               ),
               'benefitKey', enrollment.benefit_key,
               'cohortKey', enrollment.cohort_key,
               'followUpConsent', false,
               'marketingConsent', false,
               'researchConsent', false
             )
             ELSE jsonb_build_object(
               'cohortKey', enrollment.cohort_key,
               'followUpConsent', false,
               'marketingConsent', false,
               'researchConsent', false
             )
           END
         ) AS service_projection_trustworthy
     ) access_integrity
     CROSS JOIN LATERAL (
       SELECT
         (
           access_integrity.sponsor_basis_valid
           AND sponsorship.state = 'active'
           AND sponsorship.starts_at <= enrollment.starts_at
           AND (sponsorship.ends_at IS NULL OR sponsorship.ends_at >= enrollment.ends_at)
         ) AS sponsor_access_valid,
         CASE
           WHEN NOT access_integrity.sponsor_basis_valid THEN enrollment.starts_at
           WHEN sponsorship.state = 'active'
             AND sponsorship.starts_at <= enrollment.starts_at
             THEN LEAST(enrollment.ends_at, COALESCE(sponsorship.ends_at, enrollment.ends_at))
           WHEN sponsorship.state = 'ended' AND sponsorship.ends_at IS NOT NULL
             THEN LEAST(enrollment.ends_at, sponsorship.ends_at)
           ELSE enrollment.starts_at
         END AS sponsor_effective_ends_at,
         (
           access_integrity.subscription_basis_valid
           AND subscription.lifecycle = 'active'
           AND subscription.current_period_ends_at = enrollment.ends_at
           AND subscription.ended_at IS NULL
         ) AS subscription_access_valid,
         CASE
           WHEN NOT access_integrity.subscription_basis_valid THEN enrollment.starts_at
           WHEN subscription.lifecycle <> 'active'
             THEN COALESCE(subscription.ended_at, enrollment.starts_at)
           WHEN subscription.current_period_ends_at IS NULL THEN enrollment.starts_at
           ELSE LEAST(
             enrollment.ends_at,
             subscription.current_period_ends_at,
             COALESCE(subscription.ended_at, enrollment.ends_at)
           )
         END AS subscription_effective_ends_at,
         (
           access_integrity.allocation_basis_valid
           AND allocation.state = 'active'
           AND allocation.ends_at = enrollment.ends_at
         ) AS allocation_access_valid,
         CASE
           WHEN NOT access_integrity.allocation_basis_valid THEN enrollment.starts_at
           WHEN allocation.state = 'active' AND allocation.ends_at IS NOT NULL
             THEN LEAST(enrollment.ends_at, allocation.ends_at)
           WHEN allocation.state = 'ended' AND allocation.ends_at IS NOT NULL
             THEN LEAST(enrollment.ends_at, allocation.ends_at)
           ELSE enrollment.starts_at
         END AS allocation_effective_ends_at,
         (
           access_integrity.grant_basis_valid
           AND grant_record.ends_at = enrollment.ends_at
           AND grant_record.revoked_at IS NULL
         ) AS grant_access_valid,
         CASE
           WHEN NOT access_integrity.grant_basis_valid THEN enrollment.starts_at
           WHEN grant_record.ends_at IS NULL AND grant_record.revoked_at IS NULL
             THEN enrollment.starts_at
           ELSE LEAST(
             enrollment.ends_at,
             COALESCE(grant_record.ends_at, enrollment.ends_at),
             COALESCE(grant_record.revoked_at, enrollment.ends_at)
           )
         END AS grant_effective_ends_at,
         (
           access_integrity.service_projection_trustworthy
           AND service_consent.state = 'active'
           AND service_consent.effective_at = enrollment.starts_at
           AND service_consent.expires_at = enrollment.ends_at
           AND service_consent.updated_at = enrollment.starts_at
           AND service_evidence.session_id = enrollment.accepted_session_id
           AND service_evidence.effective_at = enrollment.starts_at
           AND service_evidence.expires_at = enrollment.ends_at
           AND service_evidence.recorded_at = enrollment.starts_at
           AND service_evidence.supersedes_evidence_id IS NULL
         ) AS service_access_valid,
         CASE
           WHEN access_integrity.service_projection_trustworthy
             AND service_consent.state = 'active'
             AND service_consent.effective_at = enrollment.starts_at
             AND service_consent.expires_at = enrollment.ends_at
             AND service_consent.updated_at = enrollment.starts_at
             AND service_evidence.session_id = enrollment.accepted_session_id
             AND service_evidence.effective_at = enrollment.starts_at
             AND service_evidence.expires_at = enrollment.ends_at
             AND service_evidence.recorded_at = enrollment.starts_at
             AND service_evidence.supersedes_evidence_id IS NULL
             THEN enrollment.ends_at
           WHEN access_integrity.service_projection_trustworthy
             AND service_consent.state <> 'active'
             AND service_evidence.supersedes_evidence_id IS NOT NULL
             THEN service_consent.effective_at
           ELSE enrollment.starts_at
         END AS service_effective_ends_at
     ) access_components
     CROSS JOIN LATERAL (
       SELECT
         CASE
           WHEN enrollment.state <> 'active' OR enrollment.ends_at <= $5::timestamptz THEN NULL
           WHEN NOT access_components.service_access_valid THEN 'service_consent_invalid'
           WHEN NOT access_components.sponsor_access_valid THEN 'sponsor_backing_invalid'
           WHEN NOT access_components.subscription_access_valid THEN 'subscription_invalid'
           WHEN NOT access_components.allocation_access_valid THEN 'allocation_invalid'
           WHEN NOT access_components.grant_access_valid THEN 'grant_invalid'
           ELSE NULL
         END AS access_attention_code,
         GREATEST(
           enrollment.starts_at,
           LEAST(
             enrollment.ends_at,
             COALESCE(enrollment.revoked_at, enrollment.ends_at),
             access_components.sponsor_effective_ends_at,
             access_components.subscription_effective_ends_at,
             access_components.allocation_effective_ends_at,
             access_components.grant_effective_ends_at,
             access_components.service_effective_ends_at
           )
         ) AS effective_ends_at
     ) access_resolution
     WHERE enrollment.cohort_key = $1 AND enrollment.environment = $2
       AND ($3::text IS NULL OR enrollment.household_id = $3)
       AND ($4::text IS NULL OR enrollment.id = $4)
     ORDER BY enrollment.created_at, enrollment.id`,
    [
      foundingHouseholdCohortKey,
      localEnvironment,
      householdId ?? null,
      enrollmentId ?? null,
      now.toISOString(),
      foundingHouseholdServiceConsentVersion,
      foundingHouseholdServiceDocuments.disclosureDigest,
      foundingHouseholdServiceDocuments.policyVersion,
      foundingHouseholdServiceDocuments.policyDigest,
    ],
  );
  return result.rows;
}

async function invitationById(
  transaction: SqlExecutor,
  invitationId: string,
  lock = false,
): Promise<InvitationRow | null> {
  const result = await transaction.query<InvitationRow>(
    `SELECT id, environment, policy_revision, benefit_key, access_duration_days,
            program_ends_at, credential_fingerprint, fingerprint_key_version,
            state, expires_at, created_at
     FROM founding_household_invitations
     WHERE id = $1 AND cohort_key = $2 AND environment = $3${lock ? ' FOR UPDATE' : ''}`,
    [invitationId, foundingHouseholdCohortKey, localEnvironment],
  );
  return result.rows[0] ?? null;
}

export class FoundingHouseholdRepository {
  constructor(
    private readonly database: Database,
    private readonly fingerprintKey: Uint8Array,
    private readonly fingerprintKeyVersion: number,
    private readonly configuredFounderPersonId: string | undefined,
    private readonly environment: FoundingHouseholdEnvironment = localEnvironment,
    private readonly ids: IdFactory = randomIdFactory,
    private readonly authorityClock: FoundingHouseholdAuthorityClock = databaseFoundingHouseholdAuthorityClock,
  ) {
    if (
      fingerprintKey.byteLength < 32 ||
      !Number.isSafeInteger(fingerprintKeyVersion) ||
      fingerprintKeyVersion < 1
    ) {
      throw new TypeError('Founding Household HMAC configuration is invalid');
    }
  }

  private async authorityNow(transaction: SqlExecutor, observedAt: Date): Promise<Date> {
    let authorityNow: Date;
    if (this.authorityClock === databaseFoundingHouseholdAuthorityClock) {
      authorityNow = await this.authorityClock(transaction, observedAt);
    } else {
      const testAuthorityNow = await this.authorityClock(transaction, observedAt);
      if (!(testAuthorityNow instanceof Date) || !Number.isFinite(testAuthorityNow.getTime())) {
        throw new DomainError(
          'conflict',
          'Founding Household database authority time is unavailable',
        );
      }
      await transaction.query(
        `SELECT set_config('boomerbuddy.founding_household_test_now',$1,true) AS configured`,
        [testAuthorityNow.toISOString()],
      );
      const capturedResult = await transaction.query<
        { authority_now: unknown } & Record<string, unknown>
      >('SELECT capture_founding_household_authority_now() AS authority_now');
      authorityNow = asDate(
        capturedResult.rows[0]?.authority_now,
        'founding household captured authority clock',
      );
      if (authorityNow.getTime() !== testAuthorityNow.getTime()) {
        throw new DomainError('conflict', 'Founding Household test authority clock diverged');
      }
    }
    if (!(authorityNow instanceof Date) || !Number.isFinite(authorityNow.getTime())) {
      throw new DomainError(
        'conflict',
        'Founding Household database authority time is unavailable',
      );
    }
    return new Date(authorityNow);
  }

  private assertLocalEnvironment(): void {
    if (this.environment !== localEnvironment) {
      throw new DomainError(
        'not_authorized',
        'A reviewed managed-identity and environment-bound sponsor release is required',
      );
    }
  }

  private async expireInvitationForAuthorizedMember(input: {
    readonly access: FoundingHouseholdMemberAccess;
    readonly householdId: string;
    readonly invitationId: string;
    readonly now: Date;
  }): Promise<void> {
    const expired = await this.database.transaction(async (transaction) => {
      await lockDefinition(transaction);
      const administrator = await lockActiveAdministrator(
        transaction,
        input.access,
        input.householdId,
      );
      const authorityNow = await this.authorityNow(transaction, input.now);
      assertAdministratorSessionCurrent(administrator, authorityNow);
      const result = await transaction.query(
        `UPDATE founding_household_invitations
         SET state = 'expired', credential_fingerprint = NULL, ended_at = $4
         WHERE id = $1 AND cohort_key = $2 AND environment = $3
           AND state = 'pending' AND expires_at <= $4`,
        [
          input.invitationId,
          foundingHouseholdCohortKey,
          localEnvironment,
          authorityNow.toISOString(),
        ],
      );
      return result.rowCount === 1;
    });
    if (expired) throw new DomainError('expired', 'Founding Household invitation has expired');
  }

  async founderConsole(input: {
    readonly access: FoundingHouseholdFounderAccess;
    readonly now: Date;
  }): Promise<FoundingHouseholdFounderConsoleRecord> {
    this.assertLocalEnvironment();
    assertIdentifier(input.access.correlationId, 'correlation identifier');
    return this.database.transaction(async (transaction) => {
      await lockDefinition(transaction);
      await lockConfiguredFounder(
        transaction,
        this.configuredFounderPersonId,
        input.access.actorPersonId,
      );
      const authorityNow = await this.authorityNow(transaction, input.now);
      const expiredInvitationCount = await expireDueInvitations(transaction, authorityNow);
      const policyRow = await currentPolicy(transaction);
      const policy = policyFromRow(policyRow);
      const invitationResult = await transaction.query<InvitationRow>(
        `SELECT id, environment, policy_revision, benefit_key, access_duration_days,
                program_ends_at, credential_fingerprint, fingerprint_key_version,
                state, expires_at, created_at
         FROM founding_household_invitations
         WHERE cohort_key = $1 AND environment = $2
         ORDER BY created_at DESC, id`,
        [foundingHouseholdCohortKey, localEnvironment],
      );
      const rows = await enrollmentRows(transaction, authorityNow);
      const enrollments = rows.map((row) => enrollmentFromRow(row, authorityNow));
      const invitations = invitationResult.rows.map((row) => invitationFromRow(row, authorityNow));
      const activeHouseholds = enrollments.filter((item) => item.state === 'active').length;
      const attentionHouseholds = enrollments.filter((item) => item.state === 'attention').length;
      const committedHouseholds = activeHouseholds + attentionHouseholds;
      const reservedInvitations = invitations.filter((item) => item.state === 'pending').length;
      const maxHouseholds = policy.maxHouseholds ?? 0;
      await writeFounderReadAudit(
        transaction,
        this.ids,
        input.access,
        authorityNow,
        expiredInvitationCount,
      );
      return {
        policy,
        capacity: {
          maxHouseholds,
          activeHouseholds,
          attentionHouseholds,
          committedHouseholds,
          reservedInvitations,
          remaining: Math.max(maxHouseholds - committedHouseholds - reservedInvitations, 0),
        },
        invitations,
        enrollments,
      };
    });
  }

  async configurePolicy(input: {
    readonly access: FoundingHouseholdFounderAccess;
    readonly operationKey: string;
    readonly expectedRevision: number;
    readonly state: FoundingHouseholdPolicyState;
    readonly benefitKey?: FoundingHouseholdBenefitKey;
    readonly maxHouseholds?: number;
    readonly invitationTtlDays?: number;
    readonly accessDurationDays?: number;
    readonly programEndsAt?: Date;
    readonly now: Date;
  }): Promise<{
    readonly policy: FoundingHouseholdPolicyRecord;
    readonly reused: boolean;
    readonly invalidatedInvitationCount: number;
    readonly externalActionExecuted: false;
  }> {
    this.assertLocalEnvironment();
    assertIdentifier(input.access.correlationId, 'correlation identifier');
    assertOperationKey(input.operationKey, 'policy');
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new DomainError('invalid_input', 'Expected policy revision is invalid');
    }
    if (input.state === 'active') {
      if (
        input.benefitKey === undefined ||
        input.maxHouseholds === undefined ||
        input.invitationTtlDays === undefined ||
        input.accessDurationDays === undefined ||
        input.programEndsAt === undefined
      ) {
        throw new DomainError('invalid_input', 'Active policy configuration is incomplete');
      }
      if (!Number.isFinite(input.programEndsAt.getTime())) {
        throw new DomainError('invalid_input', 'Founding Household program end is invalid');
      }
    } else if (
      input.benefitKey !== undefined ||
      input.maxHouseholds !== undefined ||
      input.invitationTtlDays !== undefined ||
      input.accessDurationDays !== undefined ||
      input.programEndsAt !== undefined
    ) {
      throw new DomainError('invalid_input', 'Disabled policy cannot retain benefit or expiry');
    }
    const digest = requestDigest({
      accessDurationDays: input.accessDurationDays ?? null,
      benefitKey: input.benefitKey ?? null,
      expectedRevision: input.expectedRevision,
      invitationTtlDays: input.invitationTtlDays ?? null,
      maxHouseholds: input.maxHouseholds ?? null,
      programEndsAt: input.programEndsAt?.toISOString() ?? null,
      state: input.state,
    });
    return this.database.transaction(async (transaction) => {
      await lockDefinition(transaction);
      await lockConfiguredFounder(
        transaction,
        this.configuredFounderPersonId,
        input.access.actorPersonId,
      );
      const existing = await existingOperation(transaction, {
        operationKey: input.operationKey,
        kind: 'policy',
        requestDigest: digest,
        actorPersonId: input.access.actorPersonId,
      });
      if (existing !== null) {
        const operationResult = policyOperationResult(existing);
        const reusedResult = await transaction.query<PolicyRow>(
          `SELECT environment, revision, state, benefit_key, max_households,
                  invitation_ttl_days, access_duration_days, program_ends_at, created_at
           FROM founding_household_policy_versions
           WHERE cohort_key = $1 AND environment = $2 AND revision = $3`,
          [foundingHouseholdCohortKey, localEnvironment, operationResult.revision],
        );
        const row = reusedResult.rows[0];
        if (row === undefined) throw new Error('Founding Household policy operation is incomplete');
        return {
          policy: policyFromRow(row),
          reused: true,
          invalidatedInvitationCount: operationResult.invalidatedInvitationCount,
          externalActionExecuted: false,
        };
      }
      const authorityNow = await this.authorityNow(transaction, input.now);
      await bindConfiguredFounderAuthority(transaction, input.access.actorPersonId, authorityNow);
      if (
        input.state === 'active' &&
        input.benefitKey !== undefined &&
        input.maxHouseholds !== undefined &&
        input.invitationTtlDays !== undefined &&
        input.accessDurationDays !== undefined &&
        input.programEndsAt !== undefined
      ) {
        assertActiveFoundingHouseholdPolicy(
          {
            benefitKey: input.benefitKey,
            maxHouseholds: input.maxHouseholds,
            invitationTtlDays: input.invitationTtlDays,
            accessDurationDays: input.accessDurationDays,
            programEndsAt: input.programEndsAt,
          },
          authorityNow,
        );
      }
      await expireDueInvitations(transaction, authorityNow);
      const current = await currentPolicy(transaction);
      if (current.revision !== input.expectedRevision) {
        throw new DomainError('conflict', 'Founding Household policy revision changed');
      }
      if (input.state === 'active' && input.maxHouseholds !== undefined) {
        const active = await transaction.query<{ count: number } & Record<string, unknown>>(
          `SELECT count(*)::integer AS count FROM founding_household_enrollments
           WHERE cohort_key = $1 AND environment = $2 AND state = 'active' AND ends_at > $3`,
          [foundingHouseholdCohortKey, localEnvironment, authorityNow.toISOString()],
        );
        if ((active.rows[0]?.count ?? 0) > input.maxHouseholds) {
          throw new DomainError('conflict', 'Policy cap is below the active household count');
        }
      }
      const nextRevision = current.revision + 1;
      const pendingInvitations = await transaction.query<{ id: string } & Record<string, unknown>>(
        `SELECT id FROM founding_household_invitations
         WHERE cohort_key = $1 AND environment = $2 AND state = 'pending'
         ORDER BY id FOR UPDATE`,
        [foundingHouseholdCohortKey, localEnvironment],
      );
      await insertOperation(transaction, {
        operationKey: input.operationKey,
        kind: 'policy',
        requestDigest: digest,
        actorPersonId: input.access.actorPersonId,
        resultReference: `${nextRevision}:${pendingInvitations.rows.length}`,
        now: authorityNow,
      });
      await transaction.query(
        `INSERT INTO founding_household_policy_versions(
           cohort_key, environment, revision, state, benefit_key, max_households,
           invitation_ttl_days, access_duration_days, program_ends_at,
           changed_by_person_id, operation_key, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          foundingHouseholdCohortKey,
          localEnvironment,
          nextRevision,
          input.state,
          input.benefitKey ?? null,
          input.maxHouseholds ?? null,
          input.invitationTtlDays ?? null,
          input.accessDurationDays ?? null,
          input.programEndsAt?.toISOString() ?? null,
          input.access.actorPersonId,
          input.operationKey,
          authorityNow.toISOString(),
        ],
      );
      const invalidated = await transaction.query(
        `UPDATE founding_household_invitations
         SET state = 'superseded', credential_fingerprint = NULL, ended_at = $3,
             terminal_operation_key = $4
         WHERE cohort_key = $1 AND environment = $2 AND state = 'pending'`,
        [
          foundingHouseholdCohortKey,
          localEnvironment,
          authorityNow.toISOString(),
          input.operationKey,
        ],
      );
      if (invalidated.rowCount !== pendingInvitations.rows.length) {
        throw new Error('Founding Household invitation invalidation count changed');
      }
      await writeAuditAndOutbox(
        transaction,
        this.ids,
        {
          actorPersonId: input.access.actorPersonId,
          audience: 'hq',
          foundingHouseholdOperationKey: input.operationKey,
          correlationId: input.access.correlationId,
          now: authorityNow,
        },
        {
          action: 'founding_household.policy_configured',
          resourceType: 'founding_household_program',
          resourceId: foundingHouseholdCohortKey,
          outcome: 'completed',
          metadata: {
            environment: localEnvironment,
            invalidatedInvitations: invalidated.rowCount,
            paymentCollected: false,
            revision: nextRevision,
            state: input.state,
          },
        },
        {
          eventType: 'founding_household.policy_configured.v1',
          aggregateType: 'founding_household_program',
          aggregateId: foundingHouseholdCohortKey,
          payload: {
            environment: localEnvironment,
            invalidatedInvitations: invalidated.rowCount,
            revision: nextRevision,
            state: input.state,
          },
        },
      );
      return {
        policy: {
          environment: localEnvironment,
          revision: nextRevision,
          state: input.state,
          ...(input.benefitKey === undefined ? {} : { benefitKey: input.benefitKey }),
          ...(input.maxHouseholds === undefined ? {} : { maxHouseholds: input.maxHouseholds }),
          ...(input.invitationTtlDays === undefined
            ? {}
            : { invitationTtlDays: input.invitationTtlDays }),
          ...(input.accessDurationDays === undefined
            ? {}
            : { accessDurationDays: input.accessDurationDays }),
          ...(input.programEndsAt === undefined ? {} : { programEndsAt: input.programEndsAt }),
          changedAt: authorityNow,
        },
        reused: false,
        invalidatedInvitationCount: invalidated.rowCount,
        externalActionExecuted: false,
      };
    });
  }

  async createInvitation(input: {
    readonly access: FoundingHouseholdFounderAccess;
    readonly operationKey: string;
    readonly now: Date;
  }): Promise<{
    readonly invitation: FoundingHouseholdInvitationRecord;
    readonly localInvitationCredential?: string;
    readonly credentialState: 'created_credential_returned' | 'created_credential_unavailable';
    readonly reused: boolean;
    readonly credentialRecoverable: false;
    readonly delivery: 'founder_manual_local_only';
    readonly externalActionExecuted: false;
  }> {
    this.assertLocalEnvironment();
    assertIdentifier(input.access.correlationId, 'correlation identifier');
    assertOperationKey(input.operationKey, 'invite');
    const digest = requestDigest({ action: 'invite', environment: localEnvironment });
    return this.database.transaction(async (transaction) => {
      await lockDefinition(transaction);
      await lockConfiguredFounder(
        transaction,
        this.configuredFounderPersonId,
        input.access.actorPersonId,
      );
      const authorityNow = await this.authorityNow(transaction, input.now);
      await bindConfiguredFounderAuthority(transaction, input.access.actorPersonId, authorityNow);
      await expireDueInvitations(transaction, authorityNow);
      const existing = await existingOperation(transaction, {
        operationKey: input.operationKey,
        kind: 'invite',
        requestDigest: digest,
        actorPersonId: input.access.actorPersonId,
      });
      if (existing !== null) {
        const row = await invitationById(transaction, existing);
        if (row === null) throw new Error('Founding Household invitation operation is incomplete');
        return {
          invitation: invitationFromRow(row, authorityNow),
          credentialState: 'created_credential_unavailable',
          reused: true,
          credentialRecoverable: false,
          delivery: 'founder_manual_local_only',
          externalActionExecuted: false,
        };
      }
      const policy = await currentPolicy(transaction);
      if (
        policy.state !== 'active' ||
        policy.benefit_key === null ||
        policy.max_households === null ||
        policy.invitation_ttl_days === null ||
        policy.access_duration_days === null ||
        policy.program_ends_at === null
      ) {
        throw new DomainError('not_authorized', 'Founding Household policy is disabled');
      }
      const programEndsAt = asDate(policy.program_ends_at, 'founding policy program end');
      if (programEndsAt <= authorityNow) {
        throw new DomainError('expired', 'Founding Household policy has expired');
      }
      const backing = await currentSponsorBacking(transaction, policy.benefit_key, authorityNow);
      if (backing === null) {
        throw new DomainError('not_authorized', 'Local sponsor backing is unavailable');
      }
      const occupancy = await transaction.query<
        { active: number; reserved: number } & Record<string, unknown>
      >(
        `SELECT
           (SELECT count(*)::integer FROM founding_household_enrollments enrollment
            WHERE enrollment.cohort_key = $1 AND enrollment.environment = $2
              AND enrollment.state = 'active' AND enrollment.ends_at > $3) AS active,
           (SELECT count(*)::integer FROM founding_household_invitations invitation
            WHERE invitation.cohort_key = $1 AND invitation.environment = $2
              AND invitation.state = 'pending' AND invitation.expires_at > $3) AS reserved`,
        [foundingHouseholdCohortKey, localEnvironment, authorityNow.toISOString()],
      );
      const counts = occupancy.rows[0] ?? { active: 0, reserved: 0 };
      if (counts.active + counts.reserved >= policy.max_households) {
        throw new DomainError('conflict', 'Founding Household cohort is at capacity');
      }
      const invitationId = this.ids.next('founding-invitation');
      const secret = randomBytes(32).toString('base64url');
      const credential = `${invitationId}.${secret}`;
      const fingerprint = fingerprintMinimized(secret, this.fingerprintKey, {
        tenantId: foundingHouseholdCohortKey,
        purpose: 'founding-household-invitation',
        keyVersion: this.fingerprintKeyVersion,
      });
      const expiresAt = foundingHouseholdInvitationEndsAt(
        authorityNow,
        policy.invitation_ttl_days,
        programEndsAt,
      );
      await insertOperation(transaction, {
        operationKey: input.operationKey,
        kind: 'invite',
        requestDigest: digest,
        actorPersonId: input.access.actorPersonId,
        resultReference: invitationId,
        now: authorityNow,
      });
      await transaction.query(
        `INSERT INTO founding_household_invitations(
           id, cohort_key, environment, policy_revision, benefit_key,
           access_duration_days, program_ends_at, credential_fingerprint,
           fingerprint_key_version, state, created_by_person_id, operation_key,
           expires_at, created_at, ended_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,$12,$13,NULL)`,
        [
          invitationId,
          foundingHouseholdCohortKey,
          localEnvironment,
          policy.revision,
          policy.benefit_key,
          policy.access_duration_days,
          programEndsAt.toISOString(),
          fingerprint.value,
          fingerprint.keyVersion,
          input.access.actorPersonId,
          input.operationKey,
          expiresAt.toISOString(),
          authorityNow.toISOString(),
        ],
      );
      await writeAuditAndOutbox(
        transaction,
        this.ids,
        {
          actorPersonId: input.access.actorPersonId,
          audience: 'hq',
          foundingHouseholdOperationKey: input.operationKey,
          correlationId: input.access.correlationId,
          now: authorityNow,
        },
        {
          action: 'founding_household.invitation_created',
          resourceType: 'founding_household_invitation',
          resourceId: invitationId,
          outcome: 'completed',
          metadata: {
            benefitKey: policy.benefit_key,
            delivery: 'founder_manual_local_only',
            environment: localEnvironment,
            paymentCollected: false,
            policyRevision: policy.revision,
          },
        },
        {
          eventType: 'founding_household.invitation_created.v1',
          aggregateType: 'founding_household_invitation',
          aggregateId: invitationId,
          payload: {
            benefitKey: policy.benefit_key,
            delivery: 'founder_manual_local_only',
            environment: localEnvironment,
            policyRevision: policy.revision,
            state: 'pending',
          },
        },
      );
      return {
        invitation: {
          id: invitationId,
          environment: localEnvironment,
          policyRevision: policy.revision,
          benefitKey: policy.benefit_key,
          state: 'pending',
          createdAt: authorityNow,
          expiresAt,
        },
        localInvitationCredential: credential,
        credentialState: 'created_credential_returned',
        reused: false,
        credentialRecoverable: false,
        delivery: 'founder_manual_local_only',
        externalActionExecuted: false,
      };
    });
  }

  private async validateCredential(
    transaction: SqlExecutor,
    invitationId: string,
    localInvitationCredential: string,
    now: Date,
  ): Promise<InvitationRow> {
    const separator = localInvitationCredential.indexOf('.');
    const credentialId = localInvitationCredential.slice(0, separator);
    const secret = localInvitationCredential.slice(separator + 1);
    if (
      separator < 1 ||
      credentialId !== invitationId ||
      secret.length < 32 ||
      secret.length > 80
    ) {
      throw new DomainError('not_found', 'Founding Household invitation is unavailable');
    }
    const row = await invitationById(transaction, invitationId, true);
    if (row === null || row.state !== 'pending' || row.credential_fingerprint === null) {
      throw new DomainError('not_found', 'Founding Household invitation is unavailable');
    }
    const expiresAt = asDate(row.expires_at, 'founding invitation expires_at');
    if (expiresAt <= now) {
      await transaction.query(
        `UPDATE founding_household_invitations
         SET state = 'expired', credential_fingerprint = NULL, ended_at = $2
         WHERE id = $1 AND state = 'pending'`,
        [invitationId, now.toISOString()],
      );
      throw new DomainError('expired', 'Founding Household invitation has expired');
    }
    const fingerprint = fingerprintMinimized(secret, this.fingerprintKey, {
      tenantId: foundingHouseholdCohortKey,
      purpose: 'founding-household-invitation',
      keyVersion: row.fingerprint_key_version,
    });
    if (!constantTimeEqual(fingerprint.value, row.credential_fingerprint)) {
      throw new DomainError('not_found', 'Founding Household invitation is unavailable');
    }
    return row;
  }

  async previewInvitation(input: {
    readonly access: FoundingHouseholdMemberAccess;
    readonly householdId: string;
    readonly invitationId: string;
    readonly localInvitationCredential: string;
    readonly now: Date;
  }): Promise<{
    readonly invitation: FoundingHouseholdInvitationRecord;
    readonly householdId: string;
    readonly benefit: (typeof foundingHouseholdBenefitProfiles)[FoundingHouseholdBenefitKey];
    readonly accessEndsAtIfAcceptedNow: Date;
  }> {
    this.assertLocalEnvironment();
    assertIdentifier(input.access.correlationId, 'correlation identifier');
    await this.expireInvitationForAuthorizedMember(input);
    return this.database.transaction(async (transaction) => {
      await lockDefinition(transaction);
      const administrator = await lockActiveAdministrator(
        transaction,
        input.access,
        input.householdId,
      );
      const authorityNow = await this.authorityNow(transaction, input.now);
      assertAdministratorSessionCurrent(administrator, authorityNow);
      const invitation = await this.validateCredential(
        transaction,
        input.invitationId,
        input.localInvitationCredential,
        authorityNow,
      );
      const policy = await currentPolicy(transaction);
      if (
        policy.state !== 'active' ||
        policy.revision !== invitation.policy_revision ||
        policy.benefit_key !== invitation.benefit_key ||
        policy.program_ends_at === null ||
        asDate(policy.program_ends_at, 'founding policy program end') <= authorityNow
      ) {
        throw new DomainError('not_found', 'Founding Household invitation is unavailable');
      }
      const backing = await currentSponsorBacking(
        transaction,
        invitation.benefit_key,
        authorityNow,
      );
      const profile = foundingHouseholdBenefitProfiles[invitation.benefit_key];
      if (
        backing === null ||
        backing.evidence_tier !== foundingHouseholdEvidenceTier ||
        backing.plan_version_id !== profile.planVersionId
      ) {
        throw new DomainError('not_authorized', 'Local sponsor backing is unavailable');
      }
      const existing = await transaction.query(
        `SELECT 1 FROM founding_household_enrollments
         WHERE environment = $1 AND household_id = $2`,
        [localEnvironment, input.householdId],
      );
      if (existing.rows[0] !== undefined) {
        throw new DomainError('conflict', 'This household already has a Founding Household record');
      }
      const programEndsAt = asDate(invitation.program_ends_at, 'invitation program end');
      const accessEndsAtIfAcceptedNow = sponsorBoundedAccessEndsAt(
        authorityNow,
        invitation.access_duration_days,
        programEndsAt,
        backing,
      );
      await transaction.query(
        `INSERT INTO audit_events(
           id, household_id, actor_person_id, session_audience, action, resource_type,
           resource_id, outcome, metadata, correlation_id, occurred_at
         ) VALUES ($1,$2,$3,$4,'founding_household.invitation_previewed',
           'founding_household_invitation',$5,'allowed',$6::jsonb,$7,$8)`,
        [
          this.ids.next('audit'),
          input.householdId,
          input.access.actorPersonId,
          input.access.audience,
          input.invitationId,
          JSON.stringify({
            environment: localEnvironment,
            evidenceTier: foundingHouseholdEvidenceTier,
            paymentRequired: false,
          }),
          input.access.correlationId,
          authorityNow.toISOString(),
        ],
      );
      return {
        invitation: invitationFromRow(invitation, authorityNow),
        householdId: input.householdId,
        benefit: foundingHouseholdBenefitProfiles[invitation.benefit_key],
        accessEndsAtIfAcceptedNow,
      };
    });
  }

  async acceptInvitation(input: {
    readonly access: FoundingHouseholdMemberAccess;
    readonly householdId: string;
    readonly invitationId: string;
    readonly localInvitationCredential: string;
    readonly operationKey: string;
    readonly serviceConsentVersion: typeof foundingHouseholdServiceConsentVersion;
    readonly serviceDisclosureDigest: string;
    readonly servicePolicyDigest: string;
    readonly protectedEnrollmentConsentVersion: typeof foundingHouseholdProtectedEnrollmentConsentVersion;
    readonly protectedEnrollmentDisclosureDigest: string;
    readonly protectedEnrollmentPolicyDigest: string;
    readonly now: Date;
  }): Promise<{
    readonly enrollment: FoundingHouseholdEnrollmentRecord;
    readonly protectedEnrollment: 'created' | 'already_active';
    readonly reused: boolean;
    readonly paymentCollected: false;
    readonly externalActionExecuted: false;
  }> {
    this.assertLocalEnvironment();
    assertIdentifier(input.access.correlationId, 'correlation identifier');
    assertOperationKey(input.operationKey, 'accept');
    if (
      input.serviceDisclosureDigest !== foundingHouseholdServiceDocuments.disclosureDigest ||
      input.servicePolicyDigest !== foundingHouseholdServiceDocuments.policyDigest ||
      input.protectedEnrollmentDisclosureDigest !==
        foundingHouseholdProtectedDocuments.disclosureDigest ||
      input.protectedEnrollmentPolicyDigest !== foundingHouseholdProtectedDocuments.policyDigest
    ) {
      throw new DomainError('invalid_input', 'Founding Household consent document digest changed');
    }
    await this.expireInvitationForAuthorizedMember(input);
    const digest = requestDigest({
      householdId: input.householdId,
      invitationId: input.invitationId,
      protectedEnrollmentConsentVersion: input.protectedEnrollmentConsentVersion,
      protectedEnrollmentDisclosureDigest: input.protectedEnrollmentDisclosureDigest,
      protectedEnrollmentPolicyDigest: input.protectedEnrollmentPolicyDigest,
      serviceConsentVersion: input.serviceConsentVersion,
      serviceDisclosureDigest: input.serviceDisclosureDigest,
      servicePolicyDigest: input.servicePolicyDigest,
    });
    return this.database.transaction(async (transaction) => {
      await lockDefinition(transaction);
      const administrator = await lockActiveAdministrator(
        transaction,
        input.access,
        input.householdId,
      );
      const authorityNow = await this.authorityNow(transaction, input.now);
      assertAdministratorSessionCurrent(administrator, authorityNow);
      const existing = await existingOperation(transaction, {
        operationKey: input.operationKey,
        kind: 'accept',
        requestDigest: digest,
        actorPersonId: input.access.actorPersonId,
      });
      if (existing !== null) {
        const rows = await enrollmentRows(transaction, authorityNow, undefined, existing);
        const row = rows[0];
        if (row === undefined) throw new Error('Founding Household acceptance is incomplete');
        return {
          enrollment: enrollmentFromRow(row, authorityNow),
          protectedEnrollment: row.protected_enrollment_created ? 'created' : 'already_active',
          reused: true,
          paymentCollected: false,
          externalActionExecuted: false,
        };
      }
      const invitation = await this.validateCredential(
        transaction,
        input.invitationId,
        input.localInvitationCredential,
        authorityNow,
      );
      const policy = await currentPolicy(transaction);
      if (
        policy.state !== 'active' ||
        policy.revision !== invitation.policy_revision ||
        policy.benefit_key !== invitation.benefit_key ||
        policy.program_ends_at === null ||
        asDate(policy.program_ends_at, 'founding policy program end') <= authorityNow
      ) {
        throw new DomainError('not_found', 'Founding Household invitation is unavailable');
      }
      const prior = await transaction.query(
        `SELECT 1 FROM founding_household_enrollments
         WHERE environment = $1 AND household_id = $2 FOR UPDATE`,
        [localEnvironment, input.householdId],
      );
      if (prior.rows[0] !== undefined) {
        throw new DomainError('conflict', 'This household already has a Founding Household record');
      }
      const actorIdentity = await identityEvidenceForPerson(
        transaction,
        input.access.actorPersonId,
        input.access.actorIssuer,
      );
      if (actorIdentity === null || actorIdentity.assurance !== 'development') {
        throw new DomainError('not_authenticated', 'An active local identity is required');
      }
      const backing = await currentSponsorBacking(
        transaction,
        invitation.benefit_key,
        authorityNow,
      );
      const profile = foundingHouseholdBenefitProfiles[invitation.benefit_key];
      if (
        backing === null ||
        backing.evidence_tier !== foundingHouseholdEvidenceTier ||
        backing.plan_version_id !== profile.planVersionId
      ) {
        throw new DomainError('not_authorized', 'Local sponsor backing is unavailable');
      }
      const programEndsAt = asDate(invitation.program_ends_at, 'invitation program end');
      const endsAt = sponsorBoundedAccessEndsAt(
        authorityNow,
        invitation.access_duration_days,
        programEndsAt,
        backing,
      );
      const enrollmentId = this.ids.next('founding-enrollment');
      const subscriptionId = this.ids.next('founding-subscription');
      const sponsorshipAllocationId = this.ids.next('founding-sponsor-allocation');
      const grantId = this.ids.next('founding-grant');
      const serviceConsentId = this.ids.next('consent');
      await insertOperation(transaction, {
        operationKey: input.operationKey,
        kind: 'accept',
        requestDigest: digest,
        actorPersonId: input.access.actorPersonId,
        resultReference: enrollmentId,
        now: authorityNow,
      });
      await transaction.query(
        `INSERT INTO commerce_subscriptions(
           household_id, id, payer_person_id, plan_version_id, source, lifecycle,
           source_verified, precedence, current_period_starts_at, current_period_ends_at,
           reconciliation_state, created_at, updated_at
         ) VALUES ($1,$2,NULL,$3,'sponsor','active',true,40,$4,$5,'not_required',$4,$4)`,
        [
          input.householdId,
          subscriptionId,
          backing.plan_version_id,
          authorityNow.toISOString(),
          endsAt.toISOString(),
        ],
      );
      await transaction.query(
        `INSERT INTO commerce_sponsorship_allocations(
           household_id, id, sponsorship_id, plan_version_id, eligibility_reference,
           state, source_verified, starts_at, ends_at, created_at
         ) VALUES ($1,$2,$3,$4,$5,'active',true,$6,$7,$6)`,
        [
          input.householdId,
          sponsorshipAllocationId,
          backing.sponsorship_id,
          backing.plan_version_id,
          input.invitationId,
          authorityNow.toISOString(),
          endsAt.toISOString(),
        ],
      );
      await transaction.query(
        `INSERT INTO entitlement_grants(
           household_id, id, source, capabilities, starts_at, ends_at, revoked_at,
           source_verified, precedence, plan_version_id, subscription_id,
           sponsorship_id, created_at
         ) SELECT $1,$2,'sponsor',plan.capabilities,$3,$4,NULL,true,40,
                  plan.id,$5,$6,$3
           FROM commerce_plan_versions plan WHERE plan.id = $7 AND plan.state = 'active'`,
        [
          input.householdId,
          grantId,
          authorityNow.toISOString(),
          endsAt.toISOString(),
          subscriptionId,
          sponsorshipAllocationId,
          backing.plan_version_id,
        ],
      );
      await transaction.query(
        `INSERT INTO consents(
           household_id, id, protected_person_id, granted_by_person_id, purpose,
           consent_version, state, granted_at
         ) VALUES ($1,$2,$3,$3,'founding_household_service_beta',$4,'active',$5)`,
        [
          input.householdId,
          serviceConsentId,
          input.access.actorPersonId,
          input.serviceConsentVersion,
          authorityNow.toISOString(),
        ],
      );
      await appendConsentEvidence(transaction, this.ids, {
        householdId: input.householdId,
        consentId: serviceConsentId,
        actorPersonId: input.access.actorPersonId,
        subjectPersonId: input.access.actorPersonId,
        purpose: 'founding_household_service_beta',
        scope: {
          accessEndsAt: endsAt.toISOString(),
          benefitKey: invitation.benefit_key,
          cohortKey: foundingHouseholdCohortKey,
          followUpConsent: false,
          marketingConsent: false,
          researchConsent: false,
        },
        action: 'accept',
        sourceInteraction: 'founding_household_acceptance',
        actorIdentity,
        sessionId: input.access.sessionId,
        correlationId: input.access.correlationId,
        effectiveAt: authorityNow,
        expiresAt: endsAt,
        documents: foundingHouseholdServiceDocuments,
      });
      const currentProtected = await protectedEnrollment(
        transaction,
        input.householdId,
        input.access.actorPersonId,
        true,
      );
      let protectedEnrollmentState: 'created' | 'already_active' = 'already_active';
      if (currentProtected === null) {
        protectedEnrollmentState = 'created';
        const allowanceId = this.ids.next('allocation');
        const protectedConsentId = this.ids.next('consent');
        await transaction.query(
          `INSERT INTO commerce_allowance_allocations(
             household_id, id, entitlement_grant_id, allowance_key, subject_kind,
             subject_id, state, allocated_at
           ) VALUES ($1,$2,$3,'protected_members','protected_member',$4,'active',$5)`,
          [
            input.householdId,
            allowanceId,
            grantId,
            input.access.actorPersonId,
            authorityNow.toISOString(),
          ],
        );
        await transaction.query(
          `INSERT INTO consents(
             household_id, id, protected_person_id, granted_by_person_id, purpose,
             consent_version, state, granted_at
           ) VALUES ($1,$2,$3,$3,'protected_enrollment',$4,'active',$5)`,
          [
            input.householdId,
            protectedConsentId,
            input.access.actorPersonId,
            input.protectedEnrollmentConsentVersion,
            authorityNow.toISOString(),
          ],
        );
        const protectedEvidenceId = await appendConsentEvidence(transaction, this.ids, {
          householdId: input.householdId,
          consentId: protectedConsentId,
          actorPersonId: input.access.actorPersonId,
          subjectPersonId: input.access.actorPersonId,
          purpose: 'protected_enrollment',
          scope: { protectedEnrollment: true, source: 'founding_household_acceptance' },
          action: 'accept',
          sourceInteraction: 'founding_household_protected_enrollment',
          actorIdentity,
          sessionId: input.access.sessionId,
          correlationId: input.access.correlationId,
          effectiveAt: authorityNow,
          documents: foundingHouseholdProtectedDocuments,
        });
        await transaction.query(
          `INSERT INTO protected_members(
             household_id, person_id, status, consented_by_person_id, consent_version,
             allowance_allocation_id, accepted_at, created_at, updated_at,
             consent_id, latest_consent_evidence_id
           ) VALUES ($1,$2,'accepted',$2,$3,$4,$5,$5,$5,$6,$7)
           ON CONFLICT (household_id, person_id) DO UPDATE SET
             status = 'accepted', consented_by_person_id = EXCLUDED.consented_by_person_id,
             consent_version = EXCLUDED.consent_version,
             allowance_allocation_id = EXCLUDED.allowance_allocation_id,
             accepted_at = EXCLUDED.accepted_at, deferred_at = NULL, revoked_at = NULL,
             consent_id = EXCLUDED.consent_id,
             latest_consent_evidence_id = EXCLUDED.latest_consent_evidence_id,
             updated_at = EXCLUDED.updated_at`,
          [
            input.householdId,
            input.access.actorPersonId,
            input.protectedEnrollmentConsentVersion,
            allowanceId,
            authorityNow.toISOString(),
            protectedConsentId,
            protectedEvidenceId,
          ],
        );
      }
      await bindExistingProtectedAllocationsToFoundingGrant(transaction, {
        householdId: input.householdId,
        acceptingPersonId: input.access.actorPersonId,
        entitlementGrantId: grantId,
        limit: foundingHouseholdBenefitProfiles[invitation.benefit_key].protectedMemberLimit,
      });
      await bindExistingTrustedCircleAllocationsToFoundingGrant(transaction, {
        householdId: input.householdId,
        entitlementGrantId: grantId,
        limit: foundingHouseholdBenefitProfiles[invitation.benefit_key].trustedCircleLimit,
      });
      await transaction.query(
        `INSERT INTO founding_household_enrollments(
           household_id, id, cohort_key, environment, policy_revision, invitation_id,
           benefit_key, plan_version_id, sponsorship_id, sponsorship_allocation_id,
           subscription_id, entitlement_grant_id, service_consent_id,
           protected_enrollment_created, accepted_by_person_id, accepted_session_id,
           state, evidence_tier, operation_key, starts_at, ends_at, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                   'active',$17,$18,$19,$20,$19)`,
        [
          input.householdId,
          enrollmentId,
          foundingHouseholdCohortKey,
          localEnvironment,
          invitation.policy_revision,
          input.invitationId,
          invitation.benefit_key,
          backing.plan_version_id,
          backing.sponsorship_id,
          sponsorshipAllocationId,
          subscriptionId,
          grantId,
          serviceConsentId,
          protectedEnrollmentState === 'created',
          input.access.actorPersonId,
          input.access.sessionId,
          foundingHouseholdEvidenceTier,
          input.operationKey,
          authorityNow.toISOString(),
          endsAt.toISOString(),
        ],
      );
      await transaction.query(
        `UPDATE founding_household_invitations
         SET state = 'accepted', credential_fingerprint = NULL, ended_at = $2,
             terminal_operation_key = $3
         WHERE id = $1 AND state = 'pending'`,
        [input.invitationId, authorityNow.toISOString(), input.operationKey],
      );
      await writeAuditAndOutbox(
        transaction,
        this.ids,
        {
          householdId: input.householdId,
          actorPersonId: input.access.actorPersonId,
          audience: input.access.audience,
          foundingHouseholdOperationKey: input.operationKey,
          correlationId: input.access.correlationId,
          now: authorityNow,
        },
        {
          action: 'founding_household.accepted',
          resourceType: 'founding_household_enrollment',
          resourceId: enrollmentId,
          outcome: 'completed',
          metadata: {
            benefitKey: invitation.benefit_key,
            environment: localEnvironment,
            evidenceTier: foundingHouseholdEvidenceTier,
            followUpConsent: false,
            marketingConsent: false,
            paymentCollected: false,
            researchConsent: false,
          },
        },
        {
          eventType: 'founding_household.accepted.v1',
          aggregateType: 'founding_household_enrollment',
          aggregateId: enrollmentId,
          payload: {
            benefitKey: invitation.benefit_key,
            environment: localEnvironment,
            evidenceTier: foundingHouseholdEvidenceTier,
            paymentCollected: false,
            state: 'active',
          },
        },
      );
      const rows = await enrollmentRows(transaction, authorityNow, undefined, enrollmentId);
      const row = rows[0];
      if (row === undefined) throw new Error('Founding Household enrollment was not recorded');
      return {
        enrollment: enrollmentFromRow(row, authorityNow),
        protectedEnrollment: protectedEnrollmentState,
        reused: false,
        paymentCollected: false,
        externalActionExecuted: false,
      };
    });
  }

  async revokeInvitation(input: {
    readonly access: FoundingHouseholdFounderAccess;
    readonly invitationId: string;
    readonly operationKey: string;
    readonly now: Date;
  }): Promise<{
    readonly invitation: FoundingHouseholdInvitationRecord;
    readonly reused: boolean;
    readonly externalActionExecuted: false;
  }> {
    this.assertLocalEnvironment();
    assertIdentifier(input.access.correlationId, 'correlation identifier');
    assertOperationKey(input.operationKey, 'invite_revoke');
    const digest = requestDigest({ invitationId: input.invitationId });
    return this.database.transaction(async (transaction) => {
      await lockDefinition(transaction);
      await lockConfiguredFounder(
        transaction,
        this.configuredFounderPersonId,
        input.access.actorPersonId,
      );
      const authorityNow = await this.authorityNow(transaction, input.now);
      await bindConfiguredFounderAuthority(transaction, input.access.actorPersonId, authorityNow);
      const priorOperation = await existingOperation(transaction, {
        operationKey: input.operationKey,
        kind: 'invite_revoke',
        requestDigest: digest,
        actorPersonId: input.access.actorPersonId,
      });
      if (priorOperation !== null) {
        const prior = await invitationById(transaction, priorOperation);
        if (prior === null) throw new Error('Invitation revocation operation is incomplete');
        return {
          invitation: invitationFromRow(prior, authorityNow),
          reused: true,
          externalActionExecuted: false,
        };
      }
      await expireDueInvitations(transaction, authorityNow);
      const invitation = await invitationById(transaction, input.invitationId, true);
      if (invitation === null || invitation.state !== 'pending') {
        throw new DomainError('not_found', 'Founding Household invitation is unavailable');
      }
      await insertOperation(transaction, {
        operationKey: input.operationKey,
        kind: 'invite_revoke',
        requestDigest: digest,
        actorPersonId: input.access.actorPersonId,
        resultReference: input.invitationId,
        now: authorityNow,
      });
      await transaction.query(
        `UPDATE founding_household_invitations
         SET state = 'revoked', credential_fingerprint = NULL, ended_at = $2,
             terminal_operation_key = $3
         WHERE id = $1 AND state = 'pending'`,
        [input.invitationId, authorityNow.toISOString(), input.operationKey],
      );
      await writeAuditAndOutbox(
        transaction,
        this.ids,
        {
          actorPersonId: input.access.actorPersonId,
          audience: 'hq',
          foundingHouseholdOperationKey: input.operationKey,
          correlationId: input.access.correlationId,
          now: authorityNow,
        },
        {
          action: 'founding_household.invitation_revoked',
          resourceType: 'founding_household_invitation',
          resourceId: input.invitationId,
          outcome: 'completed',
          metadata: { environment: localEnvironment, paymentCollected: false },
        },
        {
          eventType: 'founding_household.invitation_revoked.v1',
          aggregateType: 'founding_household_invitation',
          aggregateId: input.invitationId,
          payload: { environment: localEnvironment, state: 'revoked' },
        },
      );
      return {
        invitation: {
          ...invitationFromRow(invitation, authorityNow),
          state: 'revoked',
        },
        reused: false,
        externalActionExecuted: false,
      };
    });
  }

  async memberStatus(input: {
    readonly access: FoundingHouseholdMemberAccess;
    readonly householdId: string;
    readonly now: Date;
  }): Promise<FoundingHouseholdEnrollmentRecord | null> {
    this.assertLocalEnvironment();
    return this.database.transaction(async (transaction) => {
      await lockDefinition(transaction);
      const administrator = await lockActiveAdministrator(
        transaction,
        input.access,
        input.householdId,
      );
      const authorityNow = await this.authorityNow(transaction, input.now);
      assertAdministratorSessionCurrent(administrator, authorityNow);
      const rows = await enrollmentRows(transaction, authorityNow, input.householdId);
      const row = rows[0];
      return row === undefined ? null : enrollmentFromRow(row, authorityNow);
    });
  }

  async offboard(input: {
    readonly access: FoundingHouseholdFounderAccess | FoundingHouseholdMemberAccess;
    readonly authority: 'founder' | 'household';
    readonly householdId: string;
    readonly operationKey: string;
    readonly now: Date;
  }): Promise<{
    readonly enrollment: FoundingHouseholdEnrollmentRecord;
    readonly reason: 'founder_revoked' | 'household_withdrew';
    readonly reused: boolean;
    readonly unrelatedGrantsChanged: false;
    readonly reboundProtectedAllocations: number;
    readonly reboundTrustedCircleAllocations: number;
    readonly externalActionExecuted: false;
  }> {
    this.assertLocalEnvironment();
    assertOperationKey(input.operationKey, 'offboard');
    const reason = input.authority === 'founder' ? 'founder_revoked' : 'household_withdrew';
    const digest = requestDigest({ householdId: input.householdId, reason });
    return this.database.transaction(async (transaction) => {
      await lockDefinition(transaction);
      let administrator: AdministratorAuthorityRow | undefined;
      if (input.authority === 'founder') {
        await lockConfiguredFounder(
          transaction,
          this.configuredFounderPersonId,
          input.access.actorPersonId,
        );
      } else {
        administrator = await lockActiveAdministrator(
          transaction,
          input.access as FoundingHouseholdMemberAccess,
          input.householdId,
        );
      }
      const authorityNow = await this.authorityNow(transaction, input.now);
      if (input.authority === 'founder') {
        await bindConfiguredFounderAuthority(transaction, input.access.actorPersonId, authorityNow);
      }
      if (administrator !== undefined) {
        assertAdministratorSessionCurrent(administrator, authorityNow);
      }
      const existingOperationReference = await existingOperation(transaction, {
        operationKey: input.operationKey,
        kind: 'offboard',
        requestDigest: digest,
        actorPersonId: input.access.actorPersonId,
      });
      if (existingOperationReference !== null) {
        const operationResult = offboardOperationResult(existingOperationReference);
        const rows = await enrollmentRows(
          transaction,
          authorityNow,
          undefined,
          operationResult.enrollmentId,
        );
        const row = rows[0];
        if (row === undefined) throw new Error('Founding Household offboarding is incomplete');
        return {
          enrollment: enrollmentFromRow(row, authorityNow),
          reason,
          reused: true,
          unrelatedGrantsChanged: false,
          reboundProtectedAllocations: operationResult.reboundProtectedAllocations,
          reboundTrustedCircleAllocations: operationResult.reboundTrustedCircleAllocations,
          externalActionExecuted: false,
        };
      }
      const result = await transaction.query<
        {
          id: string;
          accepted_by_person_id: string;
          service_consent_id: string;
          subscription_id: string;
          sponsorship_allocation_id: string;
          entitlement_grant_id: string;
          state: string;
          revoked_reason: 'founder_revoked' | 'household_withdrew' | null;
          ends_at: unknown;
        } & Record<string, unknown>
      >(
        `SELECT id, accepted_by_person_id, service_consent_id, subscription_id,
                sponsorship_allocation_id, entitlement_grant_id, state, revoked_reason, ends_at
         FROM founding_household_enrollments
         WHERE environment = $1 AND household_id = $2 FOR UPDATE`,
        [localEnvironment, input.householdId],
      );
      const enrollment = result.rows[0];
      if (
        enrollment !== undefined &&
        enrollment.state === 'revoked' &&
        enrollment.revoked_reason === 'founder_revoked' &&
        input.authority === 'household'
      ) {
        const memberAccess = input.access as FoundingHouseholdMemberAccess;
        if (enrollment.accepted_by_person_id !== memberAccess.actorPersonId) {
          throw new DomainError('not_authorized', 'Only the accepting administrator may withdraw');
        }
        const consent = await transaction.query<{ state: string } & Record<string, unknown>>(
          `SELECT state FROM consent_current_projections
           WHERE household_id = $1 AND consent_id = $2 FOR UPDATE`,
          [input.householdId, enrollment.service_consent_id],
        );
        if (consent.rows[0]?.state !== 'active') {
          throw new DomainError(
            'conflict',
            'Founding Household service consent is already inactive; replay the original request',
          );
        }
        const actorIdentity = await identityEvidenceForPerson(
          transaction,
          memberAccess.actorPersonId,
          memberAccess.actorIssuer,
        );
        if (actorIdentity === null)
          throw new DomainError('not_authenticated', 'Identity unavailable');
        await appendConsentEvidence(transaction, this.ids, {
          householdId: input.householdId,
          consentId: enrollment.service_consent_id,
          actorPersonId: memberAccess.actorPersonId,
          subjectPersonId: memberAccess.actorPersonId,
          purpose: 'founding_household_service_beta',
          scope: {
            cohortKey: foundingHouseholdCohortKey,
            followUpConsent: false,
            marketingConsent: false,
            researchConsent: false,
          },
          action: 'withdraw',
          sourceInteraction: 'founding_household_consent_only_withdrawal',
          actorIdentity,
          sessionId: memberAccess.sessionId,
          correlationId: memberAccess.correlationId,
          effectiveAt: authorityNow,
          documents: foundingHouseholdServiceDocuments,
        });
        await insertOperation(transaction, {
          operationKey: input.operationKey,
          kind: 'offboard',
          requestDigest: digest,
          actorPersonId: memberAccess.actorPersonId,
          resultReference: `${enrollment.id}:0:0`,
          now: authorityNow,
        });
        await writeAuditAndOutbox(
          transaction,
          this.ids,
          {
            householdId: input.householdId,
            actorPersonId: memberAccess.actorPersonId,
            audience: memberAccess.audience,
            foundingHouseholdOperationKey: input.operationKey,
            correlationId: memberAccess.correlationId,
            now: authorityNow,
          },
          {
            action: 'founding_household.service_consent_withdrawn',
            resourceType: 'founding_household_enrollment',
            resourceId: enrollment.id,
            outcome: 'completed',
            metadata: {
              environment: localEnvironment,
              sponsorChainChanged: false,
              priorOffboardingReason: 'founder_revoked',
            },
          },
          {
            eventType: 'founding_household.service_consent_withdrawn.v1',
            aggregateType: 'founding_household_enrollment',
            aggregateId: enrollment.id,
            payload: {
              environment: localEnvironment,
              sponsorChainChanged: false,
              state: 'withdrawn',
            },
          },
        );
        const rows = await enrollmentRows(transaction, authorityNow, undefined, enrollment.id);
        const row = rows[0];
        if (row === undefined) throw new Error('Founding Household enrollment is unavailable');
        return {
          enrollment: enrollmentFromRow(row, authorityNow),
          reason,
          reused: false,
          unrelatedGrantsChanged: false,
          reboundProtectedAllocations: 0,
          reboundTrustedCircleAllocations: 0,
          externalActionExecuted: false,
        };
      }
      if (
        enrollment === undefined ||
        enrollment.state !== 'active' ||
        asDate(enrollment.ends_at, 'founding enrollment ends_at') <= authorityNow
      ) {
        throw new DomainError('not_found', 'Active Founding Household access is unavailable');
      }
      if (
        input.authority === 'household' &&
        enrollment.accepted_by_person_id !== input.access.actorPersonId
      ) {
        throw new DomainError('not_authorized', 'Only the accepting administrator may withdraw');
      }
      if (input.authority === 'household') {
        const memberAccess = input.access as FoundingHouseholdMemberAccess;
        const actorIdentity = await identityEvidenceForPerson(
          transaction,
          memberAccess.actorPersonId,
          memberAccess.actorIssuer,
        );
        if (actorIdentity === null)
          throw new DomainError('not_authenticated', 'Identity unavailable');
        await appendConsentEvidence(transaction, this.ids, {
          householdId: input.householdId,
          consentId: enrollment.service_consent_id,
          actorPersonId: memberAccess.actorPersonId,
          subjectPersonId: memberAccess.actorPersonId,
          purpose: 'founding_household_service_beta',
          scope: {
            cohortKey: foundingHouseholdCohortKey,
            followUpConsent: false,
            marketingConsent: false,
            researchConsent: false,
          },
          action: 'withdraw',
          sourceInteraction: 'founding_household_withdrawal',
          actorIdentity,
          sessionId: memberAccess.sessionId,
          correlationId: memberAccess.correlationId,
          effectiveAt: authorityNow,
          documents: foundingHouseholdServiceDocuments,
        });
      }
      await transaction.query(
        `UPDATE entitlement_grants SET revoked_at = $3
         WHERE household_id = $1 AND id = $2 AND revoked_at IS NULL`,
        [input.householdId, enrollment.entitlement_grant_id, authorityNow.toISOString()],
      );
      await transaction.query(
        `UPDATE commerce_sponsorship_allocations SET state = 'revoked', ends_at = $3
         WHERE household_id = $1 AND id = $2 AND state = 'active'`,
        [input.householdId, enrollment.sponsorship_allocation_id, authorityNow.toISOString()],
      );
      await transaction.query(
        `UPDATE commerce_subscriptions
         SET lifecycle = 'canceled', ended_at = $3, updated_at = $3
         WHERE household_id = $1 AND id = $2 AND lifecycle = 'active'`,
        [input.householdId, enrollment.subscription_id, authorityNow.toISOString()],
      );
      const protectedRebinding = await reconcileProtectedMemberAllowanceBindings(transaction, {
        householdId: input.householdId,
        now: authorityNow,
        runtimeEnvironment: localEnvironment,
        allowPartialRebinding: true,
        onlyFromGrantId: enrollment.entitlement_grant_id,
      });
      const trustedCircleRebinding = await reconcileTrustedCircleAllowanceBindings(transaction, {
        householdId: input.householdId,
        now: authorityNow,
        runtimeEnvironment: localEnvironment,
        onlyFromGrantId: enrollment.entitlement_grant_id,
      });
      await insertOperation(transaction, {
        operationKey: input.operationKey,
        kind: 'offboard',
        requestDigest: digest,
        actorPersonId: input.access.actorPersonId,
        resultReference: `${enrollment.id}:${protectedRebinding.rebound}:${trustedCircleRebinding.rebound}`,
        now: authorityNow,
      });
      await transaction.query(
        `UPDATE founding_household_enrollments
         SET state = 'revoked', revoked_at = $3, revoked_by_person_id = $4,
             revoked_reason = $5, revocation_operation_key = $6
         WHERE environment = $1 AND household_id = $2 AND state = 'active'`,
        [
          localEnvironment,
          input.householdId,
          authorityNow.toISOString(),
          input.access.actorPersonId,
          reason,
          input.operationKey,
        ],
      );
      await writeAuditAndOutbox(
        transaction,
        this.ids,
        {
          householdId: input.householdId,
          actorPersonId: input.access.actorPersonId,
          audience:
            input.authority === 'founder'
              ? 'hq'
              : (input.access as FoundingHouseholdMemberAccess).audience,
          foundingHouseholdOperationKey: input.operationKey,
          correlationId: input.access.correlationId,
          now: authorityNow,
        },
        {
          action: 'founding_household.offboarded',
          resourceType: 'founding_household_enrollment',
          resourceId: enrollment.id,
          outcome: 'completed',
          metadata: {
            environment: localEnvironment,
            reason,
            reboundProtectedAllocations: protectedRebinding.rebound,
            reboundTrustedCircleAllocations: trustedCircleRebinding.rebound,
            unrelatedGrantsChanged: false,
          },
        },
        {
          eventType: 'founding_household.offboarded.v1',
          aggregateType: 'founding_household_enrollment',
          aggregateId: enrollment.id,
          payload: {
            environment: localEnvironment,
            reason,
            reboundProtectedAllocations: protectedRebinding.rebound,
            reboundTrustedCircleAllocations: trustedCircleRebinding.rebound,
            state: 'revoked',
            unrelatedGrantsChanged: false,
          },
        },
      );
      const rows = await enrollmentRows(transaction, authorityNow, undefined, enrollment.id);
      const row = rows[0];
      if (row === undefined) throw new Error('Founding Household offboarding was not recorded');
      return {
        enrollment: enrollmentFromRow(row, authorityNow),
        reason,
        reused: false,
        unrelatedGrantsChanged: false,
        reboundProtectedAllocations: protectedRebinding.rebound,
        reboundTrustedCircleAllocations: trustedCircleRebinding.rebound,
        externalActionExecuted: false,
      };
    });
  }
}
