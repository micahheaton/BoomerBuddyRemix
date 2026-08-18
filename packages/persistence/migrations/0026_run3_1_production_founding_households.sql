SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

CREATE TABLE founding_household_program_definition_revisions (
  cohort_key text NOT NULL
    REFERENCES founding_household_program_definitions(cohort_key) ON DELETE RESTRICT,
  definition_version integer NOT NULL CHECK (definition_version IN (1, 2)),
  definition_digest text NOT NULL CHECK (definition_digest ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (cohort_key, definition_version)
);

INSERT INTO founding_household_program_definition_revisions(
  cohort_key, definition_version, definition_digest, created_at
)
SELECT cohort_key, definition_version, definition_digest, created_at
FROM founding_household_program_definitions;

INSERT INTO founding_household_program_definition_revisions(
  cohort_key, definition_version, definition_digest, created_at
) VALUES (
  'run3_sponsored_founding_household_v1',
  2,
  '1iiZgSqZuLNp_M7OEmEEPOglKpy4AjeSjK3y2ILrDd0',
  transaction_timestamp()
);

CREATE TRIGGER founding_household_definition_revisions_append_only
BEFORE UPDATE OR DELETE ON founding_household_program_definition_revisions
FOR EACH ROW EXECUTE FUNCTION reject_founding_household_append_mutation();

CREATE FUNCTION validate_founding_household_production_policy_cap() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.environment = 'production' AND NEW.state = 'active'
    AND (NEW.max_households IS NULL OR NEW.max_households < 1 OR NEW.max_households > 5) THEN
    RAISE EXCEPTION 'Production Founding Household policy requires a hard cohort cap from 1 to 5';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER founding_household_production_policy_cap_guard
BEFORE INSERT ON founding_household_policy_versions
FOR EACH ROW EXECUTE FUNCTION validate_founding_household_production_policy_cap();

CREATE FUNCTION require_founding_household_production_founder() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor_person_id text;
BEGIN
  IF NEW.environment <> 'production' THEN
    RETURN NEW;
  END IF;

  actor_person_id := CASE TG_TABLE_NAME
    WHEN 'founding_household_policy_versions' THEN to_jsonb(NEW)->>'changed_by_person_id'
    WHEN 'founding_household_sponsor_backings' THEN to_jsonb(NEW)->>'approved_by_person_id'
    WHEN 'founding_household_invitations' THEN to_jsonb(NEW)->>'created_by_person_id'
    ELSE NULL
  END;

  IF actor_person_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM production_founder_bootstraps bootstrap
    JOIN identities identity
      ON identity.id = bootstrap.identity_id
     AND identity.person_id = bootstrap.person_id
     AND identity.issuer = bootstrap.issuer
     AND identity.subject = bootstrap.subject
     AND identity.status = 'active'
    JOIN organizations organization
      ON organization.id = bootstrap.organization_id
     AND organization.kind = 'internal'
     AND organization.verification_state = 'verified'
    JOIN employee_assignments employee
      ON employee.id = bootstrap.employee_assignment_id
     AND employee.person_id = bootstrap.person_id
     AND employee.organization_id = bootstrap.organization_id
     AND employee.role = 'hq_owner'
     AND employee.status = 'active'
    WHERE bootstrap.bootstrap_key = 'production-founder-v1'
      AND bootstrap.person_id = actor_person_id
  ) THEN
    RAISE EXCEPTION 'Production Founding Household changes require the exact active verified founder bootstrap';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER founding_household_production_founder_policy_guard
BEFORE INSERT ON founding_household_policy_versions
FOR EACH ROW EXECUTE FUNCTION require_founding_household_production_founder();

CREATE TRIGGER founding_household_production_founder_backing_guard
BEFORE INSERT ON founding_household_sponsor_backings
FOR EACH ROW EXECUTE FUNCTION require_founding_household_production_founder();

CREATE TRIGGER founding_household_production_founder_invitation_guard
BEFORE INSERT ON founding_household_invitations
FOR EACH ROW EXECUTE FUNCTION require_founding_household_production_founder();

ALTER TABLE founding_household_invitations
  ADD COLUMN intended_identity_id text,
  ADD COLUMN intended_identity_issuer text,
  ADD COLUMN intended_identity_subject text,
  ADD COLUMN intended_person_id text,
  ADD COLUMN intended_household_id text,
  ADD CONSTRAINT founding_household_invitation_intended_identity_fk
    FOREIGN KEY (
      intended_identity_id,
      intended_person_id,
      intended_identity_issuer,
      intended_identity_subject
    ) REFERENCES identities(id, person_id, issuer, subject) ON DELETE RESTRICT,
  ADD CONSTRAINT founding_household_invitation_intended_household_fk
    FOREIGN KEY (intended_household_id) REFERENCES households(id) ON DELETE RESTRICT,
  ADD CONSTRAINT founding_household_invitation_identity_environment_check CHECK (
    (
      environment = 'local'
      AND intended_identity_id IS NULL
      AND intended_identity_issuer IS NULL
      AND intended_identity_subject IS NULL
      AND intended_person_id IS NULL
      AND intended_household_id IS NULL
    )
    OR (
      environment <> 'local'
      AND intended_identity_id IS NOT NULL
      AND intended_identity_issuer IS NOT NULL
      AND intended_identity_subject IS NOT NULL
      AND intended_person_id IS NOT NULL
      AND intended_household_id IS NOT NULL
      AND intended_identity_issuer <> 'boomerbuddy-dev'
    )
  );

ALTER TABLE founding_household_enrollments
  ADD COLUMN accepted_identity_id text,
  ADD COLUMN accepted_identity_issuer text,
  ADD COLUMN accepted_identity_subject text;

UPDATE founding_household_enrollments enrollment
SET accepted_identity_id = session.identity_id,
    accepted_identity_issuer = session.issuer,
    accepted_identity_subject = session.identity_subject
FROM sessions session
WHERE session.id = enrollment.accepted_session_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM founding_household_enrollments
    WHERE accepted_identity_id IS NULL
      OR accepted_identity_issuer IS NULL
      OR accepted_identity_subject IS NULL
  ) THEN
    RAISE EXCEPTION 'Existing Founding Household enrollments cannot be identity-bound';
  END IF;
END;
$$;

ALTER TABLE founding_household_enrollments
  ALTER COLUMN accepted_identity_id SET NOT NULL,
  ALTER COLUMN accepted_identity_issuer SET NOT NULL,
  ALTER COLUMN accepted_identity_subject SET NOT NULL,
  ADD CONSTRAINT founding_household_enrollment_accepted_identity_fk
    FOREIGN KEY (
      accepted_identity_id,
      accepted_by_person_id,
      accepted_identity_issuer,
      accepted_identity_subject
    ) REFERENCES identities(id, person_id, issuer, subject) ON DELETE RESTRICT;

CREATE FUNCTION validate_founding_household_invitation_identity_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  environment_policy founding_household_policy_versions%ROWTYPE;
BEGIN
  IF NEW.environment = 'local' THEN
    IF NEW.intended_identity_id IS NOT NULL
      OR NEW.intended_identity_issuer IS NOT NULL
      OR NEW.intended_identity_subject IS NOT NULL
      OR NEW.intended_person_id IS NOT NULL
      OR NEW.intended_household_id IS NOT NULL THEN
      RAISE EXCEPTION 'Local Founding Household invitation cannot claim production identity';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO environment_policy
  FROM founding_household_policy_versions policy
  WHERE policy.cohort_key = NEW.cohort_key
    AND policy.environment = NEW.environment
  ORDER BY policy.revision DESC LIMIT 1
  FOR UPDATE;

  IF NEW.environment = 'production'
    AND (environment_policy.max_households IS NULL OR environment_policy.max_households > 5) THEN
    RAISE EXCEPTION 'Production Founding Household policy exceeds the hard cohort cap';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM production_customer_bootstraps bootstrap
    JOIN identities identity
      ON identity.id = bootstrap.identity_id
     AND identity.person_id = bootstrap.person_id
     AND identity.issuer = bootstrap.issuer
     AND identity.subject = bootstrap.subject
    JOIN household_memberships membership
      ON membership.household_id = bootstrap.household_id
     AND membership.id = bootstrap.membership_id
     AND membership.person_id = bootstrap.person_id
    JOIN household_administrator_assignments administrator
      ON administrator.household_id = membership.household_id
     AND administrator.person_id = membership.person_id
    WHERE bootstrap.identity_id = NEW.intended_identity_id
      AND bootstrap.issuer = NEW.intended_identity_issuer
      AND bootstrap.subject = NEW.intended_identity_subject
      AND bootstrap.person_id = NEW.intended_person_id
      AND bootstrap.household_id = NEW.intended_household_id
      AND identity.status = 'active' AND identity.issuer <> 'boomerbuddy-dev'
      AND membership.status = 'active' AND administrator.status = 'active'
      AND (
        SELECT count(DISTINCT other_membership.household_id)
        FROM household_memberships other_membership
        JOIN household_administrator_assignments other_administrator
          ON other_administrator.household_id = other_membership.household_id
         AND other_administrator.person_id = other_membership.person_id
        WHERE other_membership.person_id = bootstrap.person_id
          AND other_membership.status = 'active'
          AND other_administrator.status = 'active'
      ) = 1
      AND NOT EXISTS (
        SELECT 1 FROM founding_household_enrollments enrollment
        WHERE enrollment.environment = NEW.environment
          AND enrollment.household_id = bootstrap.household_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM entitlement_grants grant_record
        WHERE grant_record.household_id = bootstrap.household_id
          AND grant_record.revoked_at IS NULL
          AND grant_record.starts_at <= NEW.created_at
          AND (grant_record.ends_at IS NULL OR grant_record.ends_at > NEW.created_at)
      )
  ) THEN
    RAISE EXCEPTION 'Production Founding Household invitation requires its exact empty customer bootstrap';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER founding_household_invitation_identity_binding_guard
BEFORE INSERT ON founding_household_invitations
FOR EACH ROW EXECUTE FUNCTION validate_founding_household_invitation_identity_binding();

CREATE FUNCTION guard_founding_household_invitation_identity_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.intended_identity_id IS DISTINCT FROM OLD.intended_identity_id
    OR NEW.intended_identity_issuer IS DISTINCT FROM OLD.intended_identity_issuer
    OR NEW.intended_identity_subject IS DISTINCT FROM OLD.intended_identity_subject
    OR NEW.intended_person_id IS DISTINCT FROM OLD.intended_person_id
    OR NEW.intended_household_id IS DISTINCT FROM OLD.intended_household_id THEN
    RAISE EXCEPTION 'Founding Household intended identity and household binding is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER founding_household_invitation_identity_binding_immutable
BEFORE UPDATE ON founding_household_invitations
FOR EACH ROW EXECUTE FUNCTION guard_founding_household_invitation_identity_binding();

CREATE FUNCTION validate_founding_household_enrollment_identity_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sessions session
    JOIN identities identity
      ON identity.id = session.identity_id
     AND identity.person_id = session.person_id
     AND identity.issuer = session.issuer
     AND identity.subject = session.identity_subject
    JOIN founding_household_invitations invitation ON invitation.id = NEW.invitation_id
    WHERE session.id = NEW.accepted_session_id
      AND session.person_id = NEW.accepted_by_person_id
      AND session.identity_id = NEW.accepted_identity_id
      AND session.issuer = NEW.accepted_identity_issuer
      AND session.identity_subject = NEW.accepted_identity_subject
      AND identity.status = 'active'
      AND (
        (
          NEW.environment = 'local'
          AND session.issuer = 'boomerbuddy-dev'
          AND invitation.intended_identity_id IS NULL
          AND invitation.intended_household_id IS NULL
        )
        OR (
          NEW.environment <> 'local'
          AND session.issuer <> 'boomerbuddy-dev'
          AND invitation.intended_identity_id = NEW.accepted_identity_id
          AND invitation.intended_identity_issuer = NEW.accepted_identity_issuer
          AND invitation.intended_identity_subject = NEW.accepted_identity_subject
          AND invitation.intended_person_id = NEW.accepted_by_person_id
          AND invitation.intended_household_id = NEW.household_id
          AND EXISTS (
            SELECT 1 FROM production_customer_bootstraps bootstrap
            WHERE bootstrap.identity_id = NEW.accepted_identity_id
              AND bootstrap.issuer = NEW.accepted_identity_issuer
              AND bootstrap.subject = NEW.accepted_identity_subject
              AND bootstrap.person_id = NEW.accepted_by_person_id
              AND bootstrap.household_id = NEW.household_id
              AND (
                SELECT count(DISTINCT other_membership.household_id)
                FROM household_memberships other_membership
                JOIN household_administrator_assignments other_administrator
                  ON other_administrator.household_id = other_membership.household_id
                 AND other_administrator.person_id = other_membership.person_id
                WHERE other_membership.person_id = bootstrap.person_id
                  AND other_membership.status = 'active'
                  AND other_administrator.status = 'active'
              ) = 1
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Founding Household enrollment identity does not match its invitation and session';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER founding_household_enrollment_identity_binding_guard
BEFORE INSERT ON founding_household_enrollments
FOR EACH ROW EXECUTE FUNCTION validate_founding_household_enrollment_identity_binding();

CREATE FUNCTION guard_founding_household_enrollment_identity_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.accepted_identity_id IS DISTINCT FROM OLD.accepted_identity_id
    OR NEW.accepted_identity_issuer IS DISTINCT FROM OLD.accepted_identity_issuer
    OR NEW.accepted_identity_subject IS DISTINCT FROM OLD.accepted_identity_subject THEN
    RAISE EXCEPTION 'Founding Household accepted identity lineage is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER founding_household_enrollment_identity_binding_immutable
BEFORE UPDATE ON founding_household_enrollments
FOR EACH ROW EXECUTE FUNCTION guard_founding_household_enrollment_identity_binding();

CREATE OR REPLACE FUNCTION founding_household_has_exact_service_consent(
  target_household_id text,
  target_consent_id text,
  target_person_id text,
  target_session_id text,
  target_cohort_key text,
  target_benefit_key text,
  target_environment text,
  target_starts_at timestamptz,
  target_ends_at timestamptz
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM consents consent
    JOIN consent_current_projections projection
      ON projection.household_id = consent.household_id
     AND projection.consent_id = consent.id
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
    WHERE consent.household_id = target_household_id
      AND consent.id = target_consent_id
      AND consent.protected_person_id = target_person_id
      AND consent.granted_by_person_id = target_person_id
      AND consent.purpose = 'founding_household_service_beta'
      AND consent.consent_version = CASE target_environment
        WHEN 'local' THEN 'founding-household-service-beta-v1'
        ELSE 'founding-household-service-beta-v2'
      END
      AND consent.state = 'active' AND consent.revoked_at IS NULL
      AND consent.granted_at = target_starts_at
      AND projection.latest_evidence_id = evidence.id
      AND projection.actor_person_id = target_person_id
      AND projection.subject_person_id = target_person_id
      AND projection.recipient_person_id IS NULL
      AND projection.purpose = evidence.purpose
      AND projection.scope = evidence.scope
      AND projection.state = 'active'
      AND projection.effective_at = target_starts_at
      AND projection.expires_at = target_ends_at
      AND projection.updated_at = target_starts_at
      AND evidence.actor_person_id = target_person_id
      AND evidence.subject_person_id = target_person_id
      AND evidence.recipient_person_id IS NULL
      AND evidence.purpose = 'founding_household_service_beta'
      AND evidence.scope = jsonb_build_object(
        'accessEndsAt', to_char(
          target_ends_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'benefitKey', target_benefit_key,
        'cohortKey', target_cohort_key,
        'followUpConsent', false,
        'marketingConsent', false,
        'researchConsent', false
      )
      AND evidence.action = 'accept'
      AND evidence.disclosure_version = consent.consent_version
      AND evidence.disclosure_digest = CASE target_environment
        WHEN 'local' THEN '2fe80c6da4f199a54462acea1ed3de53716a35ec8ff4f6b38f6bba633de181ae'
        ELSE 'b120fec99dab8271bf106c5a44fbff7640f3cb179a72b63957d34978cc41f137'
      END
      AND evidence.policy_version = consent.consent_version || '-policy'
      AND evidence.policy_digest =
        '815a516d88fef3be88b960c5f12a6b36c7be2f1c020610bfab16f7746ba197df'
      AND evidence.source_interaction = 'founding_household_acceptance'
      AND evidence.session_id = target_session_id
      AND evidence.effective_at = target_starts_at
      AND evidence.expires_at = target_ends_at
      AND evidence.recorded_at = target_starts_at
      AND evidence.supersedes_evidence_id IS NULL
      AND (
        (target_environment = 'local'
          AND evidence.assurance = 'development'
          AND evidence.actor_identity_issuer = 'boomerbuddy-dev')
        OR (target_environment <> 'local'
          AND evidence.assurance = 'verified'
          AND evidence.actor_identity_issuer <> 'boomerbuddy-dev')
      )
  );
$$;

CREATE OR REPLACE FUNCTION validate_founding_household_enrollment_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invitation founding_household_invitations%ROWTYPE;
  sponsorship_ends_at timestamptz;
  authority_now timestamptz := founding_household_authority_now();
BEGIN
  IF NEW.state <> 'active'
    OR NEW.revoked_at IS NOT NULL
    OR NEW.revoked_by_person_id IS NOT NULL
    OR NEW.revoked_reason IS NOT NULL
    OR NEW.revocation_operation_key IS NOT NULL THEN
    RAISE EXCEPTION 'Founding Household enrollment must be inserted active';
  END IF;

  SELECT * INTO invitation FROM founding_household_invitations
  WHERE id = NEW.invitation_id FOR UPDATE;

  IF NEW.created_at IS DISTINCT FROM NEW.starts_at
    OR NEW.created_at IS DISTINCT FROM authority_now THEN
    RAISE EXCEPTION 'Founding Household enrollment time must equal captured database authority';
  END IF;

  IF invitation.state <> 'pending'
    OR invitation.cohort_key <> NEW.cohort_key
    OR invitation.environment <> NEW.environment
    OR invitation.policy_revision <> NEW.policy_revision
    OR invitation.benefit_key <> NEW.benefit_key
    OR invitation.expires_at <= NEW.starts_at
    OR NEW.ends_at > invitation.program_ends_at THEN
    RAISE EXCEPTION 'Founding Household enrollment does not match its live invitation';
  END IF;

  SELECT sponsorship.ends_at INTO sponsorship_ends_at
  FROM founding_household_sponsor_backings backing
  JOIN commerce_sponsorships sponsorship
    ON sponsorship.id = backing.sponsorship_id
   AND sponsorship.organization_id = backing.organization_id
   AND sponsorship.plan_version_id = backing.plan_version_id
  WHERE backing.cohort_key = NEW.cohort_key
    AND backing.environment = NEW.environment
    AND backing.benefit_key = NEW.benefit_key
    AND backing.sponsorship_id = NEW.sponsorship_id
    AND backing.plan_version_id = NEW.plan_version_id;

  IF NEW.ends_at IS DISTINCT FROM LEAST(
    NEW.starts_at + invitation.access_duration_days * interval '1 day',
    invitation.program_ends_at,
    COALESCE(sponsorship_ends_at, invitation.program_ends_at)
  ) THEN
    RAISE EXCEPTION 'Founding Household enrollment end must match invitation and sponsor bounds';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM founding_household_operations operation
    WHERE operation.operation_key = NEW.operation_key
      AND operation.cohort_key = NEW.cohort_key
      AND operation.environment = NEW.environment
      AND operation.operation_kind = 'accept'
      AND operation.actor_person_id = NEW.accepted_by_person_id
      AND operation.result_reference = NEW.id
      AND operation.created_at = NEW.created_at
  ) THEN
    RAISE EXCEPTION 'Founding Household acceptance operation provenance is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM household_memberships membership
    JOIN household_administrator_assignments administrator
      ON administrator.household_id = membership.household_id
     AND administrator.person_id = membership.person_id
    JOIN sessions session ON session.id = NEW.accepted_session_id
      AND session.person_id = membership.person_id
      AND session.identity_id = NEW.accepted_identity_id
      AND session.issuer = NEW.accepted_identity_issuer
      AND session.identity_subject = NEW.accepted_identity_subject
    JOIN identities identity
      ON identity.id = session.identity_id
     AND identity.person_id = membership.person_id
     AND identity.issuer = session.issuer
     AND identity.subject = session.identity_subject
    WHERE membership.household_id = NEW.household_id
      AND membership.person_id = NEW.accepted_by_person_id
      AND membership.status = 'active' AND administrator.status = 'active'
      AND session.audience IN ('customer','mobile') AND session.revoked_at IS NULL
      AND session.issued_at <= NEW.starts_at AND session.expires_at > NEW.starts_at
      AND identity.status = 'active'
      AND (
        (NEW.environment = 'local' AND session.issuer = 'boomerbuddy-dev')
        OR (NEW.environment <> 'local' AND session.issuer <> 'boomerbuddy-dev')
      )
  ) THEN
    RAISE EXCEPTION 'Founding Household acceptance requires an active household administrator';
  END IF;

  IF NOT founding_household_has_exact_service_consent(
    NEW.household_id,
    NEW.service_consent_id,
    NEW.accepted_by_person_id,
    NEW.accepted_session_id,
    NEW.cohort_key,
    NEW.benefit_key,
    NEW.environment,
    NEW.starts_at,
    NEW.ends_at
  ) THEN
    RAISE EXCEPTION 'Founding Household enrollment requires current purpose-limited service consent';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM protected_members protected
    JOIN commerce_allowance_allocations allowance
      ON allowance.household_id = protected.household_id
     AND allowance.id = protected.allowance_allocation_id
    JOIN entitlement_grants allowance_grant
      ON allowance_grant.household_id = allowance.household_id
     AND allowance_grant.id = allowance.entitlement_grant_id
    LEFT JOIN consents protected_consent
      ON protected_consent.household_id = protected.household_id
     AND protected_consent.id = protected.consent_id
    LEFT JOIN consent_current_projections protected_projection
      ON protected_projection.household_id = protected.household_id
     AND protected_projection.consent_id = protected.consent_id
    LEFT JOIN consent_evidence protected_evidence
      ON protected_evidence.household_id = protected.household_id
     AND protected_evidence.id = protected.latest_consent_evidence_id
    WHERE protected.household_id = NEW.household_id
      AND protected.person_id = NEW.accepted_by_person_id
      AND protected.status = 'accepted'
      AND allowance.state = 'active' AND allowance.allowance_key = 'protected_members'
      AND allowance.subject_kind = 'protected_member'
      AND allowance.subject_id = NEW.accepted_by_person_id
      AND allowance_grant.source_verified = true
      AND allowance_grant.starts_at <= NEW.starts_at
      AND (allowance_grant.ends_at IS NULL OR allowance_grant.ends_at > NEW.starts_at)
      AND allowance_grant.revoked_at IS NULL
      AND (
        NEW.protected_enrollment_created = false
        OR (
          allowance.entitlement_grant_id = NEW.entitlement_grant_id
          AND protected.consent_version = 'founding-household-protected-self-v1'
          AND protected.accepted_at = NEW.starts_at
          AND protected.created_at = NEW.starts_at
          AND protected.updated_at = NEW.starts_at
          AND protected_consent.purpose = 'protected_enrollment'
          AND protected_consent.consent_version = 'founding-household-protected-self-v1'
          AND protected_consent.granted_at = NEW.starts_at
          AND protected_projection.state = 'active'
          AND protected_projection.effective_at = NEW.starts_at
          AND protected_projection.updated_at = NEW.starts_at
          AND protected_evidence.action = 'accept'
          AND protected_evidence.disclosure_version = 'founding-household-protected-self-v1'
          AND protected_evidence.disclosure_digest =
            'ef161c853b8b4e918188a656228b126cc658fb61facf220012ec380130f2bd7b'
          AND protected_evidence.policy_version = 'founding-household-protected-self-v1-policy'
          AND protected_evidence.policy_digest =
            '4c91b448eca0142aca6a13c10172a800649973d641f1e63b0117ffe3e98196c8'
          AND protected_evidence.actor_person_id = NEW.accepted_by_person_id
          AND protected_evidence.subject_person_id = NEW.accepted_by_person_id
          AND protected_evidence.session_id = NEW.accepted_session_id
          AND protected_evidence.effective_at = NEW.starts_at
          AND protected_evidence.recorded_at = NEW.starts_at
        )
      )
  ) THEN
    RAISE EXCEPTION 'Founding Household enrollment requires exact protected-adult consent';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM commerce_subscriptions subscription
    JOIN commerce_sponsorship_allocations allocation
      ON allocation.household_id = subscription.household_id
     AND allocation.id = NEW.sponsorship_allocation_id
     AND allocation.plan_version_id = subscription.plan_version_id
    JOIN entitlement_grants grant_record
      ON grant_record.household_id = subscription.household_id
     AND grant_record.id = NEW.entitlement_grant_id
     AND grant_record.subscription_id = subscription.id
     AND grant_record.sponsorship_id = allocation.id
     AND grant_record.plan_version_id = subscription.plan_version_id
    JOIN commerce_sponsorships sponsorship
      ON sponsorship.id = allocation.sponsorship_id
     AND sponsorship.plan_version_id = allocation.plan_version_id
    JOIN organizations organization ON organization.id = sponsorship.organization_id
    JOIN commerce_plan_versions plan ON plan.id = subscription.plan_version_id
    WHERE subscription.household_id = NEW.household_id
      AND subscription.id = NEW.subscription_id
      AND subscription.payer_person_id IS NULL
      AND subscription.source = 'sponsor' AND subscription.lifecycle = 'active'
      AND subscription.source_verified = true
      AND subscription.current_period_starts_at = NEW.starts_at
      AND subscription.current_period_ends_at = NEW.ends_at
      AND subscription.created_at = NEW.starts_at
      AND subscription.updated_at = NEW.starts_at
      AND allocation.sponsorship_id = NEW.sponsorship_id
      AND allocation.state = 'active' AND allocation.source_verified = true
      AND allocation.starts_at = NEW.starts_at AND allocation.ends_at = NEW.ends_at
      AND allocation.created_at = NEW.starts_at
      AND sponsorship.state = 'active' AND sponsorship.starts_at <= NEW.starts_at
      AND (sponsorship.ends_at IS NULL OR sponsorship.ends_at > NEW.starts_at)
      AND (sponsorship.ends_at IS NULL OR NEW.ends_at <= sponsorship.ends_at)
      AND organization.kind = 'sponsor' AND plan.state = 'active'
      AND (
        (NEW.environment = 'local' AND organization.verification_state = 'local_fixture')
        OR (NEW.environment <> 'local' AND organization.verification_state = 'verified')
      )
      AND grant_record.source = 'sponsor' AND grant_record.source_verified = true
      AND grant_record.starts_at = NEW.starts_at AND grant_record.ends_at = NEW.ends_at
      AND grant_record.created_at = NEW.starts_at
      AND grant_record.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Founding Household enrollment requires its exact finite sponsor entitlement chain';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION founding_household_has_exact_service_termination(
  target_enrollment_id text
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM founding_household_enrollments enrollment
    JOIN consents consent
      ON consent.household_id = enrollment.household_id
     AND consent.id = enrollment.service_consent_id
    JOIN consent_current_projections projection
      ON projection.household_id = consent.household_id
     AND projection.consent_id = consent.id
    JOIN consent_evidence evidence
      ON evidence.household_id = projection.household_id
     AND evidence.consent_id = projection.consent_id
     AND evidence.id = projection.latest_evidence_id
    JOIN consent_evidence prior_evidence
      ON prior_evidence.household_id = evidence.household_id
     AND prior_evidence.consent_id = evidence.consent_id
     AND prior_evidence.id = evidence.supersedes_evidence_id
    JOIN identities identity
      ON identity.id = evidence.actor_identity_id
     AND identity.person_id = evidence.actor_person_id
     AND identity.issuer = evidence.actor_identity_issuer
     AND identity.subject = evidence.actor_identity_subject
     AND identity.status = 'active'
    JOIN sessions terminal_session
      ON terminal_session.id = evidence.session_id
     AND terminal_session.identity_id = evidence.actor_identity_id
     AND terminal_session.person_id = evidence.actor_person_id
     AND terminal_session.issuer = evidence.actor_identity_issuer
     AND terminal_session.identity_subject = evidence.actor_identity_subject
     AND terminal_session.audience IN ('customer','mobile')
     AND terminal_session.revoked_at IS NULL
    WHERE enrollment.id = target_enrollment_id
      AND consent.protected_person_id = enrollment.accepted_by_person_id
      AND consent.granted_by_person_id = enrollment.accepted_by_person_id
      AND consent.purpose = 'founding_household_service_beta'
      AND consent.consent_version = CASE enrollment.environment
        WHEN 'local' THEN 'founding-household-service-beta-v1'
        ELSE 'founding-household-service-beta-v2'
      END
      AND consent.state = 'active' AND consent.revoked_at IS NULL
      AND consent.granted_at = enrollment.starts_at
      AND projection.actor_person_id = enrollment.accepted_by_person_id
      AND projection.subject_person_id = enrollment.accepted_by_person_id
      AND projection.recipient_person_id IS NULL
      AND projection.purpose = evidence.purpose
      AND projection.scope = evidence.scope
      AND projection.state = 'withdrawn'
      AND projection.effective_at = evidence.effective_at
      AND projection.expires_at IS NULL
      AND projection.updated_at = evidence.recorded_at
      AND evidence.actor_person_id = enrollment.accepted_by_person_id
      AND evidence.subject_person_id = enrollment.accepted_by_person_id
      AND evidence.recipient_person_id IS NULL
      AND evidence.purpose = 'founding_household_service_beta'
      AND evidence.scope = jsonb_build_object(
        'cohortKey', enrollment.cohort_key,
        'followUpConsent', false,
        'marketingConsent', false,
        'researchConsent', false
      )
      AND evidence.action = 'withdraw'
      AND evidence.disclosure_version = consent.consent_version
      AND evidence.disclosure_digest = CASE enrollment.environment
        WHEN 'local' THEN '2fe80c6da4f199a54462acea1ed3de53716a35ec8ff4f6b38f6bba633de181ae'
        ELSE 'b120fec99dab8271bf106c5a44fbff7640f3cb179a72b63957d34978cc41f137'
      END
      AND evidence.policy_version = consent.consent_version || '-policy'
      AND evidence.policy_digest =
        '815a516d88fef3be88b960c5f12a6b36c7be2f1c020610bfab16f7746ba197df'
      AND evidence.source_interaction IN (
        'founding_household_withdrawal',
        'founding_household_consent_only_withdrawal'
      )
      AND evidence.effective_at = evidence.recorded_at
      AND evidence.expires_at IS NULL
      AND prior_evidence.action = 'accept'
      AND prior_evidence.purpose = 'founding_household_service_beta'
      AND prior_evidence.actor_person_id = enrollment.accepted_by_person_id
      AND prior_evidence.subject_person_id = enrollment.accepted_by_person_id
      AND prior_evidence.disclosure_version = consent.consent_version
      AND prior_evidence.disclosure_digest = CASE enrollment.environment
        WHEN 'local' THEN '2fe80c6da4f199a54462acea1ed3de53716a35ec8ff4f6b38f6bba633de181ae'
        ELSE 'b120fec99dab8271bf106c5a44fbff7640f3cb179a72b63957d34978cc41f137'
      END
      AND prior_evidence.policy_version = consent.consent_version || '-policy'
      AND prior_evidence.policy_digest =
        '815a516d88fef3be88b960c5f12a6b36c7be2f1c020610bfab16f7746ba197df'
      AND terminal_session.issued_at <= evidence.effective_at
      AND terminal_session.expires_at > evidence.effective_at
      AND (
        (enrollment.environment = 'local'
          AND evidence.assurance = 'development'
          AND evidence.actor_identity_issuer = 'boomerbuddy-dev')
        OR (enrollment.environment <> 'local'
          AND evidence.assurance = 'verified'
          AND evidence.actor_identity_issuer <> 'boomerbuddy-dev')
      )
  );
$$;
