CREATE TABLE protected_self_enrollment_household_gates (
  household_id text PRIMARY KEY REFERENCES households(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL
);

CREATE TABLE protected_self_enrollment_operations (
  operation_key text PRIMARY KEY,
  household_id text NOT NULL
    REFERENCES protected_self_enrollment_household_gates(household_id) ON DELETE RESTRICT,
  actor_person_id text NOT NULL,
  operation_kind text NOT NULL CHECK (operation_kind IN ('enroll', 'withdraw')),
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  result_state text NOT NULL CHECK (result_state IN (
    'enrolled', 'already_enrolled', 'withdrawn', 'already_withdrawn'
  )),
  result_consent_version text,
  result_allowance_allocation_id text,
  changed boolean NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (household_id, actor_person_id)
    REFERENCES household_memberships(household_id, person_id) ON DELETE RESTRICT,
  CHECK (
    (
      operation_kind = 'enroll'
      AND operation_key ~ '^protected-self-enroll:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND result_state IN ('enrolled', 'already_enrolled')
      AND result_consent_version IS NOT NULL
      AND result_allowance_allocation_id IS NOT NULL
    )
    OR
    (
      operation_kind = 'withdraw'
      AND operation_key ~ '^protected-self-withdraw:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND result_state IN ('withdrawn', 'already_withdrawn')
      AND result_consent_version IS NULL
      AND result_allowance_allocation_id IS NULL
    )
  ),
  CHECK (changed = (result_state IN ('enrolled', 'withdrawn')))
);

CREATE INDEX protected_self_enrollment_operations_actor_idx
  ON protected_self_enrollment_operations(
    household_id, actor_person_id, created_at, operation_key
  );

CREATE FUNCTION reject_protected_self_enrollment_operation_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Protected-self enrollment operations are append-only';
END;
$$;

CREATE TRIGGER protected_self_enrollment_operations_append_only
BEFORE UPDATE OR DELETE ON protected_self_enrollment_operations
FOR EACH ROW EXECUTE FUNCTION reject_protected_self_enrollment_operation_mutation();

COMMENT ON TABLE protected_self_enrollment_operations IS
  'Durable temporal-idempotency receipts. Request digests contain no submitted content or PII; rows remain append-only so an old key can never repeat a later mutation. The household/person membership foreign key preserves tenant and actor lineage. Repository enforcement caps no-effect requests and state-changing enrollments; a state-changing withdrawal remains available and is structurally bounded by a prior accepted enrollment.';

COMMENT ON TABLE protected_self_enrollment_household_gates IS
  'One serialization row per household. Unrelated households never share a protected-enrollment lock; operation receipts retain a gate through an exact foreign key.';

CREATE OR REPLACE FUNCTION founding_household_has_exact_protected_consent(
  target_household_id text,
  target_person_id text,
  target_session_id text,
  target_environment text,
  target_starts_at timestamptz,
  target_entitlement_grant_id text,
  target_created boolean
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM protected_members protected
      JOIN commerce_allowance_allocations allowance
        ON allowance.household_id = protected.household_id
       AND allowance.id = protected.allowance_allocation_id
      JOIN entitlement_grants allowance_grant
        ON allowance_grant.household_id = allowance.household_id
       AND allowance_grant.id = allowance.entitlement_grant_id
      JOIN consents consent
        ON consent.household_id = protected.household_id
       AND consent.id = protected.consent_id
      JOIN consent_current_projections projection
        ON projection.household_id = protected.household_id
       AND projection.consent_id = protected.consent_id
       AND projection.latest_evidence_id = protected.latest_consent_evidence_id
      JOIN consent_evidence evidence
        ON evidence.household_id = projection.household_id
       AND evidence.consent_id = projection.consent_id
       AND evidence.id = projection.latest_evidence_id
      JOIN identities identity
        ON identity.id = evidence.actor_identity_id
       AND identity.person_id = evidence.actor_person_id
       AND identity.issuer = evidence.actor_identity_issuer
       AND identity.subject = evidence.actor_identity_subject
       AND identity.status = 'active'
      JOIN sessions evidence_session
        ON evidence_session.id = evidence.session_id
       AND evidence_session.person_id = evidence.actor_person_id
       AND evidence_session.identity_id = evidence.actor_identity_id
       AND evidence_session.issuer = evidence.actor_identity_issuer
       AND evidence_session.identity_subject = evidence.actor_identity_subject
       AND evidence_session.audience IN ('customer','mobile')
       AND evidence_session.revoked_at IS NULL
      WHERE protected.household_id = target_household_id
        AND protected.person_id = target_person_id
        AND protected.status = 'accepted'
        AND protected.consented_by_person_id = target_person_id
        AND protected.consent_version = consent.consent_version
        AND allowance.allowance_key = 'protected_members'
        AND allowance.subject_kind = 'protected_member'
        AND allowance.subject_id = target_person_id
        AND allowance.state = 'active' AND allowance.released_at IS NULL
        AND allowance_grant.source_verified = true
        AND allowance_grant.starts_at <= evidence.effective_at
        AND (allowance_grant.ends_at IS NULL OR allowance_grant.ends_at > evidence.effective_at)
        AND allowance_grant.revoked_at IS NULL
        AND consent.protected_person_id = target_person_id
        AND consent.granted_by_person_id = target_person_id
        AND consent.purpose = 'protected_enrollment'
        AND consent.state = 'active' AND consent.revoked_at IS NULL
        AND projection.actor_person_id = target_person_id
        AND projection.subject_person_id = target_person_id
        AND projection.recipient_person_id IS NULL
        AND projection.purpose = 'protected_enrollment'
        AND projection.scope = evidence.scope
        AND projection.state = 'active'
        AND projection.effective_at = evidence.effective_at
        AND projection.expires_at IS NOT DISTINCT FROM evidence.expires_at
        AND projection.updated_at = evidence.recorded_at
        AND evidence.actor_person_id = target_person_id
        AND evidence.subject_person_id = target_person_id
        AND evidence.recipient_person_id IS NULL
        AND evidence.purpose = 'protected_enrollment'
        AND evidence.scope @> jsonb_build_object('protectedEnrollment', true)
        AND evidence.action IN ('accept','reactivate')
        AND evidence_session.issued_at <= evidence.effective_at
        AND evidence_session.expires_at > evidence.effective_at
        AND NOT EXISTS (
          SELECT 1 FROM provider_session_revocations revoked
          WHERE revoked.issuer = evidence_session.issuer
            AND revoked.provider_session_id = evidence_session.provider_session_id
        )
        AND (
          (
            evidence.source_interaction = 'founding_household_protected_enrollment'
            AND evidence.disclosure_version = 'founding-household-protected-self-v1'
            AND evidence.disclosure_digest =
              'ef161c853b8b4e918188a656228b126cc658fb61facf220012ec380130f2bd7b'
            AND evidence.policy_version = 'founding-household-protected-self-v1-policy'
            AND evidence.policy_digest =
              '4c91b448eca0142aca6a13c10172a800649973d641f1e63b0117ffe3e98196c8'
          )
          OR
          (
            evidence.source_interaction = 'protected_enrollment_accept'
            AND evidence.disclosure_version = 'protected-self-enrollment-disclosure-v1'
            AND evidence.disclosure_digest =
              '11bede904cc26aaa0e9d40c210acede3e82f19c24064ee07a0884ac48dc74cc8'
            AND evidence.policy_version = 'protected-self-enrollment-policy-v1'
            AND evidence.policy_digest =
              '59be4972507cbe29fab528d9657425da090b5f42e0fe1928a4d2a03111cb96eb'
          )
        )
        AND (
          (target_environment = 'local'
            AND evidence.assurance = 'development'
            AND evidence.actor_identity_issuer = 'boomerbuddy-dev')
          OR (target_environment <> 'local'
            AND evidence.assurance = 'verified'
            AND evidence.actor_identity_issuer <> 'boomerbuddy-dev')
        )
    )
    AND (
      target_created = false
      OR EXISTS (
        SELECT 1
        FROM consents historical_consent
        JOIN consent_evidence historical_evidence
          ON historical_evidence.household_id = historical_consent.household_id
         AND historical_evidence.consent_id = historical_consent.id
        JOIN identities historical_identity
          ON historical_identity.id = historical_evidence.actor_identity_id
         AND historical_identity.person_id = historical_evidence.actor_person_id
         AND historical_identity.issuer = historical_evidence.actor_identity_issuer
         AND historical_identity.subject = historical_evidence.actor_identity_subject
        JOIN sessions historical_session
          ON historical_session.id = historical_evidence.session_id
         AND historical_session.person_id = historical_evidence.actor_person_id
         AND historical_session.identity_id = historical_evidence.actor_identity_id
         AND historical_session.issuer = historical_evidence.actor_identity_issuer
         AND historical_session.identity_subject = historical_evidence.actor_identity_subject
         AND historical_session.audience IN ('customer','mobile')
        JOIN commerce_allowance_allocations historical_allowance
          ON historical_allowance.household_id = historical_consent.household_id
         AND historical_allowance.allowance_key = 'protected_members'
         AND historical_allowance.subject_kind = 'protected_member'
         AND historical_allowance.subject_id = target_person_id
         AND historical_allowance.allocated_at = target_starts_at
        WHERE historical_consent.household_id = target_household_id
          AND historical_consent.protected_person_id = target_person_id
          AND historical_consent.granted_by_person_id = target_person_id
          AND historical_consent.purpose = 'protected_enrollment'
          AND historical_consent.consent_version = 'founding-household-protected-self-v1'
          AND historical_consent.granted_at = target_starts_at
          AND historical_evidence.actor_person_id = target_person_id
          AND historical_evidence.subject_person_id = target_person_id
          AND historical_evidence.recipient_person_id IS NULL
          AND historical_evidence.purpose = 'protected_enrollment'
          AND historical_evidence.scope = jsonb_build_object(
            'protectedEnrollment', true,
            'source', 'founding_household_acceptance'
          )
          AND historical_evidence.action = 'accept'
          AND historical_evidence.disclosure_version =
            'founding-household-protected-self-v1'
          AND historical_evidence.disclosure_digest =
            'ef161c853b8b4e918188a656228b126cc658fb61facf220012ec380130f2bd7b'
          AND historical_evidence.policy_version =
            'founding-household-protected-self-v1-policy'
          AND historical_evidence.policy_digest =
            '4c91b448eca0142aca6a13c10172a800649973d641f1e63b0117ffe3e98196c8'
          AND historical_evidence.source_interaction =
            'founding_household_protected_enrollment'
          AND historical_evidence.session_id = target_session_id
          AND historical_evidence.effective_at = target_starts_at
          AND historical_evidence.expires_at IS NULL
          AND historical_evidence.recorded_at = target_starts_at
          AND historical_evidence.supersedes_evidence_id IS NULL
          AND historical_session.issued_at <= target_starts_at
          AND historical_session.expires_at > target_starts_at
          AND (
            historical_allowance.entitlement_grant_id = target_entitlement_grant_id
            OR EXISTS (
              SELECT 1
              FROM founding_household_allowance_transitions transition
              JOIN founding_household_enrollments historical_enrollment
                ON historical_enrollment.id = transition.enrollment_id
              WHERE transition.household_id = target_household_id
                AND transition.allowance_allocation_id = historical_allowance.id
                AND transition.allowance_key = 'protected_members'
                AND transition.from_grant_id = target_entitlement_grant_id
                AND transition.operation_key = historical_enrollment.revocation_operation_key
                AND transition.occurred_at = historical_enrollment.revoked_at
                AND historical_enrollment.household_id = target_household_id
                AND historical_enrollment.environment = target_environment
                AND historical_enrollment.entitlement_grant_id = target_entitlement_grant_id
                AND historical_enrollment.accepted_by_person_id = target_person_id
                AND historical_enrollment.accepted_session_id = target_session_id
                AND historical_enrollment.protected_enrollment_created = true
                AND historical_enrollment.starts_at = target_starts_at
                AND historical_enrollment.state = 'revoked'
            )
          )
          AND (
            (target_environment = 'local'
              AND historical_evidence.assurance = 'development'
              AND historical_evidence.actor_identity_issuer = 'boomerbuddy-dev')
            OR (target_environment <> 'local'
              AND historical_evidence.assurance = 'verified'
              AND historical_evidence.actor_identity_issuer <> 'boomerbuddy-dev')
          )
      )
    );
$$;
