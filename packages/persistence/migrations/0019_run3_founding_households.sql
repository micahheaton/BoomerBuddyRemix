CREATE TABLE founding_household_program_definitions (
  cohort_key text PRIMARY KEY
    CHECK (cohort_key = 'run3_sponsored_founding_household_v1'),
  definition_version integer NOT NULL CHECK (definition_version = 1),
  definition_digest text NOT NULL CHECK (definition_digest ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz NOT NULL
);

CREATE TABLE founding_household_founder_authorities (
  cohort_key text NOT NULL REFERENCES founding_household_program_definitions(cohort_key),
  environment text NOT NULL CHECK (environment IN ('local', 'staging', 'production')),
  founder_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  bound_at timestamptz NOT NULL,
  PRIMARY KEY (cohort_key, environment)
);

CREATE FUNCTION capture_founding_household_authority_now() RETURNS timestamptz
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  captured_at timestamptz;
BEGIN
  captured_at := COALESCE(
    CASE
      WHEN position('(PGlite ' in version()) > 0
      THEN NULLIF(current_setting('boomerbuddy.founding_household_test_now', true), '')::timestamptz
      ELSE NULL
    END,
    clock_timestamp()
  );
  PERFORM set_config(
    'boomerbuddy.founding_household_authority_now',
    captured_at::text,
    true
  );
  RETURN captured_at;
END;
$$;

CREATE FUNCTION founding_household_authority_now() RETURNS timestamptz
LANGUAGE plpgsql STABLE AS $$
DECLARE
  captured_at_text text := NULLIF(
    current_setting('boomerbuddy.founding_household_authority_now', true),
    ''
  );
BEGIN
  IF captured_at_text IS NULL THEN
    RAISE EXCEPTION 'Founding Household database authority clock was not captured';
  END IF;
  RETURN captured_at_text::timestamptz;
END;
$$;

CREATE FUNCTION validate_founding_household_founder_authority() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.bound_at IS DISTINCT FROM founding_household_authority_now() THEN
    RAISE EXCEPTION 'Founding Household founder binding must equal captured database authority';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM employee_assignments employee
    JOIN organizations organization ON organization.id = employee.organization_id
    WHERE employee.person_id = NEW.founder_person_id
      AND employee.role = 'hq_owner' AND employee.status = 'active'
      AND organization.kind = 'internal'
  ) THEN
    RAISE EXCEPTION 'Founding Household founder binding requires an active internal owner';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER founding_household_founder_authority_guard
BEFORE INSERT ON founding_household_founder_authorities
FOR EACH ROW EXECUTE FUNCTION validate_founding_household_founder_authority();

CREATE FUNCTION reject_founding_household_append_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Founding Household definition, policy, and operation records are append-only';
END;
$$;

CREATE TRIGGER founding_household_program_definition_immutable
BEFORE UPDATE OR DELETE ON founding_household_program_definitions
FOR EACH ROW EXECUTE FUNCTION reject_founding_household_append_mutation();

CREATE TRIGGER founding_household_founder_authority_immutable
BEFORE UPDATE OR DELETE ON founding_household_founder_authorities
FOR EACH ROW EXECUTE FUNCTION reject_founding_household_append_mutation();

CREATE TABLE founding_household_operations (
  operation_key text PRIMARY KEY,
  cohort_key text NOT NULL REFERENCES founding_household_program_definitions(cohort_key),
  environment text NOT NULL CHECK (environment IN ('local', 'staging', 'production')),
  operation_kind text NOT NULL CHECK (operation_kind IN (
    'policy', 'invite', 'accept', 'invite_revoke', 'offboard'
  )),
  request_digest text NOT NULL CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  result_reference text NOT NULL CHECK (char_length(result_reference) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL,
  CHECK (
    (operation_kind = 'policy' AND operation_key ~ '^founding-policy:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    OR (operation_kind = 'invite' AND operation_key ~ '^founding-invite:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    OR (operation_kind = 'accept' AND operation_key ~ '^founding-accept:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    OR (operation_kind = 'invite_revoke' AND operation_key ~ '^founding-invite-revoke:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    OR (operation_kind = 'offboard' AND operation_key ~ '^founding-offboard:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  ),
  CHECK (
    (operation_kind = 'policy'
      AND result_reference ~ '^[1-9][0-9]{0,8}:(0|[1-9]|1[0-9]|2[0-5])$')
    OR (operation_kind IN ('invite','accept','invite_revoke')
      AND result_reference ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')
    OR (operation_kind = 'offboard'
      AND result_reference ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,117}:[0-3]:[0-6]$')
  )
);

ALTER TABLE audit_events
  ADD COLUMN founding_household_operation_key text
    REFERENCES founding_household_operations(operation_key)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE outbox_events
  ADD COLUMN founding_household_operation_key text
    REFERENCES founding_household_operations(operation_key)
    DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX audit_events_founding_household_operation_idx
  ON audit_events(founding_household_operation_key)
  WHERE founding_household_operation_key IS NOT NULL;

CREATE UNIQUE INDEX outbox_events_founding_household_operation_idx
  ON outbox_events(founding_household_operation_key)
  WHERE founding_household_operation_key IS NOT NULL;

CREATE FUNCTION guard_founding_household_audit_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.founding_household_operation_key IS NOT NULL
    OR (TG_OP = 'UPDATE' AND NEW.founding_household_operation_key IS NOT NULL) THEN
    RAISE EXCEPTION 'Founding Household operation-bound audit history is append-only';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER founding_household_audit_history_guard
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION guard_founding_household_audit_history();

CREATE FUNCTION guard_founding_household_outbox_provenance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.founding_household_operation_key IS NOT NULL THEN
      RAISE EXCEPTION 'Founding Household operation-bound outbox history cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.founding_household_operation_key IS NULL
    AND NEW.founding_household_operation_key IS NOT NULL THEN
    RAISE EXCEPTION 'Founding Household operation-bound outbox provenance must be inserted';
  END IF;
  IF OLD.founding_household_operation_key IS NOT NULL AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.event_version IS DISTINCT FROM OLD.event_version
    OR NEW.aggregate_type IS DISTINCT FROM OLD.aggregate_type
    OR NEW.aggregate_id IS DISTINCT FROM OLD.aggregate_id
    OR NEW.household_id IS DISTINCT FROM OLD.household_id
    OR NEW.actor_person_id IS DISTINCT FROM OLD.actor_person_id
    OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
    OR NEW.classification IS DISTINCT FROM OLD.classification
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
    OR NEW.available_at IS DISTINCT FROM OLD.available_at
    OR NEW.founding_household_operation_key IS DISTINCT FROM
      OLD.founding_household_operation_key
  ) THEN
    RAISE EXCEPTION 'Founding Household operation-bound outbox provenance is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER founding_household_outbox_provenance_guard
BEFORE UPDATE OR DELETE ON outbox_events
FOR EACH ROW EXECUTE FUNCTION guard_founding_household_outbox_provenance();

CREATE TRIGGER founding_household_operations_append_only
BEFORE UPDATE OR DELETE ON founding_household_operations
FOR EACH ROW EXECUTE FUNCTION reject_founding_household_append_mutation();

CREATE FUNCTION validate_founding_household_operation_time() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  authority_now timestamptz := founding_household_authority_now();
BEGIN
  IF NEW.operation_kind = 'policy' AND NEW.result_reference !~
    '^[1-9][0-9]{0,8}:(0|[1-9]|1[0-9]|2[0-5])$' THEN
    RAISE EXCEPTION 'Founding Household policy result does not match exact supersessions';
  END IF;
  IF (NEW.operation_kind IN ('invite','accept','invite_revoke')
      AND NEW.result_reference !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')
    OR (NEW.operation_kind = 'offboard'
      AND NEW.result_reference !~
        '^[A-Za-z0-9][A-Za-z0-9._-]{0,117}:[0-3]:[0-6]$') THEN
    RAISE EXCEPTION 'Founding Household operation result_reference does not match completed domain result';
  END IF;
  IF NEW.created_at IS DISTINCT FROM authority_now THEN
    RAISE EXCEPTION 'Founding Household operation time must equal captured database authority';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER founding_household_operation_time_guard
BEFORE INSERT ON founding_household_operations
FOR EACH ROW EXECUTE FUNCTION validate_founding_household_operation_time();

CREATE TABLE founding_household_policy_versions (
  cohort_key text NOT NULL REFERENCES founding_household_program_definitions(cohort_key),
  environment text NOT NULL CHECK (environment IN ('local', 'staging', 'production')),
  revision integer NOT NULL CHECK (revision > 0),
  state text NOT NULL CHECK (state IN ('disabled', 'active')),
  benefit_key text CHECK (benefit_key IN ('plus_beta_v1', 'family_beta_v1')),
  max_households integer CHECK (max_households BETWEEN 1 AND 25),
  invitation_ttl_days integer CHECK (invitation_ttl_days BETWEEN 1 AND 14),
  access_duration_days integer CHECK (access_duration_days BETWEEN 1 AND 180),
  program_ends_at timestamptz,
  changed_by_person_id text REFERENCES persons(id) ON DELETE RESTRICT,
  operation_key text UNIQUE REFERENCES founding_household_operations(operation_key),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (cohort_key, environment, revision),
  CHECK (
    (revision = 1 AND state = 'disabled' AND benefit_key IS NULL
      AND max_households IS NULL AND invitation_ttl_days IS NULL
      AND access_duration_days IS NULL AND program_ends_at IS NULL
      AND changed_by_person_id IS NULL AND operation_key IS NULL)
    OR
    (revision > 1 AND changed_by_person_id IS NOT NULL AND operation_key IS NOT NULL AND (
      (state = 'disabled' AND benefit_key IS NULL AND max_households IS NULL
        AND invitation_ttl_days IS NULL AND access_duration_days IS NULL
        AND program_ends_at IS NULL)
      OR
      (state = 'active' AND benefit_key IS NOT NULL AND max_households IS NOT NULL
        AND invitation_ttl_days IS NOT NULL AND access_duration_days IS NOT NULL
        AND program_ends_at > created_at
        AND program_ends_at <= created_at + interval '180 days')
    ))
  )
);

CREATE FUNCTION validate_founding_household_policy_append() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_revision integer;
  expected_supersessions integer;
  authority_now timestamptz;
BEGIN
  IF NEW.revision = 1 THEN
    RETURN NEW;
  END IF;

  authority_now := founding_household_authority_now();

  PERFORM 1 FROM founding_household_program_definitions
  WHERE cohort_key = NEW.cohort_key FOR UPDATE;

  IF NEW.created_at IS DISTINCT FROM authority_now THEN
    RAISE EXCEPTION 'Founding Household policy time must equal captured database authority';
  END IF;

  SELECT max(revision) INTO current_revision
  FROM founding_household_policy_versions
  WHERE cohort_key = NEW.cohort_key AND environment = NEW.environment;

  IF current_revision IS NULL OR NEW.revision <> current_revision + 1 THEN
    RAISE EXCEPTION 'Founding Household policy revision must advance exactly once';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM employee_assignments employee
    JOIN organizations organization ON organization.id = employee.organization_id
    WHERE employee.person_id = NEW.changed_by_person_id
      AND employee.role = 'hq_owner' AND employee.status = 'active'
      AND organization.kind = 'internal'
  ) THEN
    RAISE EXCEPTION 'Founding Household policy requires an active internal owner';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM founding_household_founder_authorities authority
    WHERE authority.cohort_key = NEW.cohort_key
      AND authority.environment = NEW.environment
      AND authority.founder_person_id = NEW.changed_by_person_id
  ) THEN
    RAISE EXCEPTION 'Founding Household policy requires the bound configured founder';
  END IF;

  SELECT count(*)::integer INTO expected_supersessions
  FROM founding_household_invitations invitation
  WHERE invitation.cohort_key = NEW.cohort_key
    AND invitation.environment = NEW.environment
    AND invitation.policy_revision < NEW.revision
    AND invitation.state = 'pending';

  IF NOT EXISTS (
    SELECT 1 FROM founding_household_operations operation
    WHERE operation.operation_key = NEW.operation_key
      AND operation.cohort_key = NEW.cohort_key
      AND operation.environment = NEW.environment
      AND operation.operation_kind = 'policy'
      AND operation.actor_person_id = NEW.changed_by_person_id
      AND operation.created_at = NEW.created_at
      AND operation.result_reference =
        NEW.revision::text || ':' || expected_supersessions::text
  ) THEN
    RAISE EXCEPTION 'Founding Household policy result does not match exact supersessions';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER founding_household_policy_append_guard
BEFORE INSERT ON founding_household_policy_versions
FOR EACH ROW EXECUTE FUNCTION validate_founding_household_policy_append();

CREATE TRIGGER founding_household_policy_versions_append_only
BEFORE UPDATE OR DELETE ON founding_household_policy_versions
FOR EACH ROW EXECUTE FUNCTION reject_founding_household_append_mutation();

CREATE TABLE founding_household_sponsor_backings (
  cohort_key text NOT NULL REFERENCES founding_household_program_definitions(cohort_key),
  environment text NOT NULL CHECK (environment IN ('local', 'staging', 'production')),
  benefit_key text NOT NULL CHECK (benefit_key IN ('plus_beta_v1', 'family_beta_v1')),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  sponsorship_id text NOT NULL,
  plan_version_id text NOT NULL REFERENCES commerce_plan_versions(id) ON DELETE RESTRICT,
  evidence_tier text NOT NULL CHECK (
    (environment = 'local' AND evidence_tier = 'local_simulation')
    OR (environment = 'staging' AND evidence_tier = 'deployed_staging')
    OR (environment = 'production' AND evidence_tier = 'live_production')
  ),
  approved_by_person_id text REFERENCES persons(id) ON DELETE RESTRICT,
  approved_at timestamptz NOT NULL,
  PRIMARY KEY (cohort_key, environment, benefit_key),
  UNIQUE (environment, benefit_key, sponsorship_id, plan_version_id),
  FOREIGN KEY (sponsorship_id, plan_version_id)
    REFERENCES commerce_sponsorships(id, plan_version_id) ON DELETE RESTRICT,
  CHECK (
    (benefit_key = 'plus_beta_v1' AND plan_version_id = 'founding_plus_beta_v2')
    OR (benefit_key = 'family_beta_v1' AND plan_version_id = 'founding_family_beta_v2')
  ),
  CHECK (environment = 'local' OR approved_by_person_id IS NOT NULL)
);

CREATE FUNCTION validate_founding_household_sponsor_backing() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM commerce_sponsorships sponsorship
    JOIN organizations organization ON organization.id = sponsorship.organization_id
    JOIN commerce_plan_versions plan ON plan.id = sponsorship.plan_version_id
    WHERE sponsorship.id = NEW.sponsorship_id
      AND sponsorship.organization_id = NEW.organization_id
      AND sponsorship.plan_version_id = NEW.plan_version_id
      AND sponsorship.state = 'active' AND plan.state = 'active'
      AND organization.kind = 'sponsor'
      AND (
        (NEW.environment = 'local' AND organization.verification_state = 'local_fixture')
        OR (NEW.environment <> 'local' AND organization.verification_state = 'verified')
      )
  ) THEN
    RAISE EXCEPTION 'Founding Household sponsor backing is not verified for its environment';
  END IF;

  IF NEW.environment <> 'local' AND NOT EXISTS (
    SELECT 1 FROM employee_assignments employee
    JOIN organizations organization ON organization.id = employee.organization_id
    WHERE employee.person_id = NEW.approved_by_person_id
      AND employee.role = 'hq_owner' AND employee.status = 'active'
      AND organization.kind = 'internal'
  ) THEN
    RAISE EXCEPTION 'Nonlocal Founding Household sponsor backing requires an internal owner';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER founding_household_sponsor_backing_guard
BEFORE INSERT ON founding_household_sponsor_backings
FOR EACH ROW EXECUTE FUNCTION validate_founding_household_sponsor_backing();

CREATE TRIGGER founding_household_sponsor_backing_append_only
BEFORE UPDATE OR DELETE ON founding_household_sponsor_backings
FOR EACH ROW EXECUTE FUNCTION reject_founding_household_append_mutation();

CREATE TABLE founding_household_invitations (
  id text PRIMARY KEY,
  cohort_key text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('local', 'staging', 'production')),
  policy_revision integer NOT NULL,
  benefit_key text NOT NULL CHECK (benefit_key IN ('plus_beta_v1', 'family_beta_v1')),
  access_duration_days integer NOT NULL CHECK (access_duration_days BETWEEN 1 AND 180),
  program_ends_at timestamptz NOT NULL,
  credential_fingerprint text CHECK (
    credential_fingerprint IS NULL OR credential_fingerprint ~ '^[A-Za-z0-9_-]{43}$'
  ),
  fingerprint_key_version integer NOT NULL CHECK (fingerprint_key_version > 0),
  state text NOT NULL CHECK (state IN (
    'pending', 'accepted', 'expired', 'revoked', 'superseded'
  )),
  created_by_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  operation_key text NOT NULL UNIQUE REFERENCES founding_household_operations(operation_key),
  terminal_operation_key text REFERENCES founding_household_operations(operation_key)
    DEFERRABLE INITIALLY DEFERRED,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  ended_at timestamptz,
  FOREIGN KEY (cohort_key, environment, policy_revision)
    REFERENCES founding_household_policy_versions(cohort_key, environment, revision),
  CHECK (expires_at > created_at AND expires_at <= program_ends_at),
  CHECK (ended_at IS NULL OR ended_at >= created_at),
  CHECK (
    (state = 'pending' AND credential_fingerprint IS NOT NULL
      AND ended_at IS NULL AND terminal_operation_key IS NULL)
    OR (state = 'expired' AND credential_fingerprint IS NULL
      AND ended_at IS NOT NULL AND terminal_operation_key IS NULL)
    OR (state IN ('accepted','revoked','superseded') AND credential_fingerprint IS NULL
      AND ended_at IS NOT NULL AND terminal_operation_key IS NOT NULL)
  )
);

CREATE INDEX founding_household_invitation_capacity_idx
  ON founding_household_invitations(cohort_key, environment, policy_revision, expires_at, id)
  WHERE state = 'pending';

CREATE TABLE founding_household_enrollments (
  household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  id text NOT NULL UNIQUE,
  cohort_key text NOT NULL REFERENCES founding_household_program_definitions(cohort_key),
  environment text NOT NULL CHECK (environment IN ('local', 'staging', 'production')),
  policy_revision integer NOT NULL,
  invitation_id text NOT NULL UNIQUE REFERENCES founding_household_invitations(id) ON DELETE RESTRICT,
  benefit_key text NOT NULL CHECK (benefit_key IN ('plus_beta_v1', 'family_beta_v1')),
  plan_version_id text NOT NULL REFERENCES commerce_plan_versions(id),
  sponsorship_id text NOT NULL,
  sponsorship_allocation_id text NOT NULL,
  subscription_id text NOT NULL,
  entitlement_grant_id text NOT NULL,
  service_consent_id text NOT NULL,
  protected_enrollment_created boolean NOT NULL,
  accepted_by_person_id text NOT NULL,
  accepted_session_id text NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('active', 'revoked')),
  evidence_tier text NOT NULL CHECK (
    (environment = 'local' AND evidence_tier = 'local_simulation')
    OR (environment = 'staging' AND evidence_tier = 'deployed_staging')
    OR (environment = 'production' AND evidence_tier = 'live_production')
  ),
  operation_key text NOT NULL UNIQUE REFERENCES founding_household_operations(operation_key),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by_person_id text REFERENCES persons(id) ON DELETE RESTRICT,
  revoked_reason text CHECK (revoked_reason IN ('founder_revoked', 'household_withdrew')),
  revocation_operation_key text REFERENCES founding_household_operations(operation_key)
    DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (environment, household_id),
  FOREIGN KEY (cohort_key, environment, policy_revision)
    REFERENCES founding_household_policy_versions(cohort_key, environment, revision),
  FOREIGN KEY (environment, benefit_key, sponsorship_id, plan_version_id)
    REFERENCES founding_household_sponsor_backings(
      environment, benefit_key, sponsorship_id, plan_version_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, accepted_by_person_id)
    REFERENCES household_memberships(household_id, person_id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, service_consent_id)
    REFERENCES consents(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (sponsorship_id, plan_version_id)
    REFERENCES commerce_sponsorships(id, plan_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, sponsorship_allocation_id, plan_version_id)
    REFERENCES commerce_sponsorship_allocations(household_id, id, plan_version_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (household_id, subscription_id, plan_version_id)
    REFERENCES commerce_subscriptions(household_id, id, plan_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, entitlement_grant_id)
    REFERENCES entitlement_grants(household_id, id) ON DELETE RESTRICT,
  CHECK (ends_at > starts_at),
  CHECK (revoked_at IS NULL OR (revoked_at >= starts_at AND revoked_at < ends_at)),
  CHECK (
    (state = 'active' AND revoked_at IS NULL AND revoked_by_person_id IS NULL
      AND revoked_reason IS NULL AND revocation_operation_key IS NULL)
    OR (state = 'revoked' AND revoked_at IS NOT NULL AND revoked_by_person_id IS NOT NULL
      AND revoked_reason IS NOT NULL AND revocation_operation_key IS NOT NULL)
  )
);

CREATE TABLE founding_household_allowance_transitions (
  operation_key text NOT NULL REFERENCES founding_household_operations(operation_key)
    DEFERRABLE INITIALLY DEFERRED,
  enrollment_id text NOT NULL REFERENCES founding_household_enrollments(id)
    DEFERRABLE INITIALLY DEFERRED,
  household_id text NOT NULL,
  allowance_allocation_id text NOT NULL,
  allowance_key text NOT NULL CHECK (
    allowance_key IN ('protected_members','trusted_circle_participants')
  ),
  from_grant_id text NOT NULL,
  to_grant_id text,
  transition_kind text NOT NULL CHECK (transition_kind IN ('rebind','release')),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (operation_key, allowance_allocation_id),
  FOREIGN KEY (household_id, allowance_allocation_id)
    REFERENCES commerce_allowance_allocations(household_id, id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (household_id, from_grant_id)
    REFERENCES entitlement_grants(household_id, id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (household_id, to_grant_id)
    REFERENCES entitlement_grants(household_id, id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (
    (transition_kind = 'rebind' AND to_grant_id IS NOT NULL
      AND to_grant_id <> from_grant_id)
    OR (transition_kind = 'release' AND to_grant_id IS NULL)
  )
);

CREATE FUNCTION guard_founding_household_allowance_transition_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'Founding Household allowance transition history is database-owned';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Founding Household allowance transition history is append-only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER founding_household_allowance_transition_history_guard
BEFORE INSERT OR UPDATE OR DELETE ON founding_household_allowance_transitions
FOR EACH ROW EXECUTE FUNCTION guard_founding_household_allowance_transition_history();

CREATE INDEX founding_household_enrollment_active_idx
  ON founding_household_enrollments(cohort_key, environment, ends_at, household_id)
  WHERE state = 'active';

CREATE FUNCTION validate_founding_household_invitation_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_policy founding_household_policy_versions%ROWTYPE;
  active_count integer;
  reserved_count integer;
  authority_now timestamptz := founding_household_authority_now();
BEGIN
  IF NEW.state <> 'pending'
    OR NEW.credential_fingerprint IS NULL
    OR NEW.ended_at IS NOT NULL
    OR NEW.terminal_operation_key IS NOT NULL THEN
    RAISE EXCEPTION 'Founding Household invitation must be inserted pending';
  END IF;

  PERFORM 1 FROM founding_household_program_definitions
  WHERE cohort_key = NEW.cohort_key FOR UPDATE;

  IF NEW.created_at IS DISTINCT FROM authority_now THEN
    RAISE EXCEPTION 'Founding Household invitation time must equal captured database authority';
  END IF;

  SELECT * INTO current_policy
  FROM founding_household_policy_versions
  WHERE cohort_key = NEW.cohort_key AND environment = NEW.environment
  ORDER BY revision DESC LIMIT 1;

  IF current_policy.state <> 'active'
    OR current_policy.revision <> NEW.policy_revision
    OR current_policy.benefit_key <> NEW.benefit_key
    OR current_policy.access_duration_days <> NEW.access_duration_days
    OR current_policy.program_ends_at <> NEW.program_ends_at
    OR current_policy.program_ends_at <= NEW.created_at THEN
    RAISE EXCEPTION 'Founding Household invitation is not bound to the current active policy';
  END IF;

  IF NEW.expires_at IS DISTINCT FROM LEAST(
    NEW.created_at + current_policy.invitation_ttl_days * interval '1 day',
    current_policy.program_ends_at
  ) THEN
    RAISE EXCEPTION 'Founding Household invitation expiry must match the finite policy bound';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM founding_household_sponsor_backings backing
    JOIN commerce_sponsorships sponsorship
      ON sponsorship.id = backing.sponsorship_id
     AND sponsorship.organization_id = backing.organization_id
     AND sponsorship.plan_version_id = backing.plan_version_id
    JOIN organizations organization ON organization.id = backing.organization_id
    JOIN commerce_plan_versions plan ON plan.id = backing.plan_version_id
    WHERE backing.cohort_key = NEW.cohort_key
      AND backing.environment = NEW.environment
      AND backing.benefit_key = NEW.benefit_key
      AND sponsorship.state = 'active' AND sponsorship.starts_at <= NEW.created_at
      AND (sponsorship.ends_at IS NULL OR sponsorship.ends_at > NEW.created_at)
      AND organization.kind = 'sponsor' AND plan.state = 'active'
      AND (
        (NEW.environment = 'local' AND organization.verification_state = 'local_fixture')
        OR (NEW.environment <> 'local' AND organization.verification_state = 'verified')
      )
  ) THEN
    RAISE EXCEPTION 'Founding Household sponsor backing is dormant in this environment';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM employee_assignments employee
    JOIN organizations organization ON organization.id = employee.organization_id
    WHERE employee.person_id = NEW.created_by_person_id
      AND employee.role = 'hq_owner' AND employee.status = 'active'
      AND organization.kind = 'internal'
  ) THEN
    RAISE EXCEPTION 'Founding Household invitation requires an active internal owner';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM founding_household_founder_authorities authority
    WHERE authority.cohort_key = NEW.cohort_key
      AND authority.environment = NEW.environment
      AND authority.founder_person_id = NEW.created_by_person_id
  ) THEN
    RAISE EXCEPTION 'Founding Household invitation requires the bound configured founder';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM founding_household_operations operation
    WHERE operation.operation_key = NEW.operation_key
      AND operation.cohort_key = NEW.cohort_key
      AND operation.environment = NEW.environment
      AND operation.operation_kind = 'invite'
      AND operation.actor_person_id = NEW.created_by_person_id
      AND operation.result_reference = NEW.id
      AND operation.created_at = NEW.created_at
  ) THEN
    RAISE EXCEPTION 'Founding Household invitation operation provenance is invalid';
  END IF;

  SELECT count(*)::integer INTO active_count
  FROM founding_household_enrollments enrollment
  WHERE enrollment.cohort_key = NEW.cohort_key
    AND enrollment.environment = NEW.environment AND enrollment.state = 'active'
    AND enrollment.ends_at > NEW.created_at;

  SELECT count(*)::integer INTO reserved_count
  FROM founding_household_invitations invitation
  WHERE invitation.cohort_key = NEW.cohort_key
    AND invitation.environment = NEW.environment
    AND invitation.policy_revision = NEW.policy_revision
    AND invitation.state = 'pending' AND invitation.expires_at > NEW.created_at;

  IF active_count + reserved_count >= current_policy.max_households THEN
    RAISE EXCEPTION 'Founding Household cohort is at capacity';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER founding_household_invitation_insert_guard
BEFORE INSERT ON founding_household_invitations
FOR EACH ROW EXECUTE FUNCTION validate_founding_household_invitation_insert();

CREATE FUNCTION guard_founding_household_invitation_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  authority_now timestamptz;
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.cohort_key IS DISTINCT FROM OLD.cohort_key
    OR NEW.environment IS DISTINCT FROM OLD.environment
    OR NEW.policy_revision IS DISTINCT FROM OLD.policy_revision
    OR NEW.benefit_key IS DISTINCT FROM OLD.benefit_key
    OR NEW.access_duration_days IS DISTINCT FROM OLD.access_duration_days
    OR NEW.program_ends_at IS DISTINCT FROM OLD.program_ends_at
    OR NEW.fingerprint_key_version IS DISTINCT FROM OLD.fingerprint_key_version
    OR NEW.created_by_person_id IS DISTINCT FROM OLD.created_by_person_id
    OR NEW.operation_key IS DISTINCT FROM OLD.operation_key
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Founding Household invitation facts are immutable';
  END IF;

  IF OLD.state <> 'pending'
    OR NEW.state NOT IN ('accepted', 'expired', 'revoked', 'superseded')
    OR NEW.credential_fingerprint IS NOT NULL
    OR NEW.ended_at IS NULL THEN
    RAISE EXCEPTION 'Invalid Founding Household invitation transition';
  END IF;

  authority_now := founding_household_authority_now();

  IF (NEW.state = 'expired' AND NEW.terminal_operation_key IS NOT NULL)
    OR (NEW.state IN ('accepted','revoked','superseded')
      AND NEW.terminal_operation_key IS NULL) THEN
    RAISE EXCEPTION 'Invalid Founding Household invitation transition';
  END IF;

  IF NEW.ended_at IS DISTINCT FROM authority_now THEN
    RAISE EXCEPTION 'Founding Household invitation transition must equal captured database authority';
  END IF;

  IF NEW.state = 'expired' AND NEW.ended_at < NEW.expires_at THEN
    RAISE EXCEPTION 'Founding Household invitation cannot expire before its deadline';
  END IF;

  IF NEW.state IN ('accepted', 'revoked', 'superseded') AND NEW.ended_at >= NEW.expires_at THEN
    RAISE EXCEPTION 'Founding Household live invitation transition occurred after expiry';
  END IF;

  IF NEW.state = 'accepted' AND NOT EXISTS (
    SELECT 1 FROM founding_household_enrollments enrollment
    WHERE enrollment.invitation_id = NEW.id
      AND enrollment.operation_key = NEW.terminal_operation_key
  ) THEN
    RAISE EXCEPTION 'Accepted Founding Household invitation requires its enrollment';
  END IF;

  IF NEW.state = 'revoked' AND NOT EXISTS (
    SELECT 1 FROM founding_household_operations operation
    JOIN founding_household_founder_authorities authority
      ON authority.cohort_key = operation.cohort_key
     AND authority.environment = operation.environment
     AND authority.founder_person_id = operation.actor_person_id
    JOIN employee_assignments employee ON employee.person_id = operation.actor_person_id
    JOIN organizations organization ON organization.id = employee.organization_id
    WHERE operation.operation_key = NEW.terminal_operation_key
      AND operation.operation_kind = 'invite_revoke'
      AND operation.cohort_key = NEW.cohort_key
      AND operation.environment = NEW.environment
      AND operation.result_reference = NEW.id
      AND operation.created_at = NEW.ended_at
      AND employee.role = 'hq_owner' AND employee.status = 'active'
      AND organization.kind = 'internal'
  ) THEN
    RAISE EXCEPTION 'Founding Household invitation revocation provenance is invalid';
  END IF;

  IF NEW.state = 'superseded' AND NOT EXISTS (
    SELECT 1 FROM founding_household_operations operation
    JOIN founding_household_founder_authorities authority
      ON authority.cohort_key = operation.cohort_key
     AND authority.environment = operation.environment
     AND authority.founder_person_id = operation.actor_person_id
    JOIN employee_assignments employee ON employee.person_id = operation.actor_person_id
    JOIN organizations organization ON organization.id = employee.organization_id
    JOIN founding_household_policy_versions policy
      ON policy.operation_key = operation.operation_key
    WHERE operation.operation_key = NEW.terminal_operation_key
      AND operation.operation_kind = 'policy'
      AND operation.cohort_key = NEW.cohort_key
      AND operation.environment = NEW.environment
      AND operation.created_at = NEW.ended_at
      AND policy.revision > NEW.policy_revision
      AND employee.role = 'hq_owner' AND employee.status = 'active'
      AND organization.kind = 'internal'
  ) THEN
    RAISE EXCEPTION 'Founding Household invitation supersession provenance is invalid';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER founding_household_invitation_transition_guard
BEFORE UPDATE ON founding_household_invitations
FOR EACH ROW EXECUTE FUNCTION guard_founding_household_invitation_transition();

CREATE TRIGGER founding_household_invitation_no_delete
BEFORE DELETE ON founding_household_invitations
FOR EACH ROW EXECUTE FUNCTION reject_founding_household_append_mutation();

CREATE FUNCTION founding_household_has_exact_service_consent(
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
      AND consent.consent_version = 'founding-household-service-beta-v1'
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
      AND evidence.disclosure_version = 'founding-household-service-beta-v1'
      AND evidence.disclosure_digest =
        '2fe80c6da4f199a54462acea1ed3de53716a35ec8ff4f6b38f6bba633de181ae'
      AND evidence.policy_version = 'founding-household-service-beta-v1-policy'
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

CREATE FUNCTION founding_household_has_exact_protected_consent(
  target_household_id text,
  target_person_id text,
  target_session_id text,
  target_environment text,
  target_starts_at timestamptz,
  target_entitlement_grant_id text,
  target_created boolean
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
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
    WHERE protected.household_id = target_household_id
      AND protected.person_id = target_person_id
      AND protected.status = 'accepted'
      AND protected.consented_by_person_id = target_person_id
      AND protected.consent_version = consent.consent_version
      AND allowance.entitlement_grant_id = target_entitlement_grant_id
      AND allowance.allowance_key = 'protected_members'
      AND allowance.subject_kind = 'protected_member'
      AND allowance.subject_id = target_person_id
      AND allowance.state = 'active' AND allowance.released_at IS NULL
      AND allowance_grant.source_verified = true
      AND allowance_grant.starts_at <= target_starts_at
      AND (allowance_grant.ends_at IS NULL OR allowance_grant.ends_at > target_starts_at)
      AND allowance_grant.revoked_at IS NULL
      AND consent.protected_person_id = target_person_id
      AND consent.granted_by_person_id = target_person_id
      AND consent.purpose = 'protected_enrollment'
      AND consent.state = 'active' AND consent.revoked_at IS NULL
      AND projection.actor_person_id = evidence.actor_person_id
      AND projection.subject_person_id = evidence.subject_person_id
      AND projection.recipient_person_id IS NOT DISTINCT FROM evidence.recipient_person_id
      AND projection.purpose = evidence.purpose
      AND projection.scope = evidence.scope
      AND projection.state = 'active'
      AND projection.effective_at = evidence.effective_at
      AND projection.expires_at IS NOT DISTINCT FROM evidence.expires_at
      AND projection.updated_at = evidence.recorded_at
      AND evidence.actor_person_id = target_person_id
      AND evidence.subject_person_id = target_person_id
      AND evidence.recipient_person_id IS NULL
      AND evidence.purpose = 'protected_enrollment'
      AND evidence.action IN ('accept','reactivate')
      AND (
        (target_environment = 'local'
          AND evidence.assurance = 'development'
          AND evidence.actor_identity_issuer = 'boomerbuddy-dev')
        OR (target_environment <> 'local'
          AND evidence.assurance = 'verified'
          AND evidence.actor_identity_issuer <> 'boomerbuddy-dev')
      )
      AND (
        target_created = false
        OR (
          protected.consent_version = 'founding-household-protected-self-v1'
          AND protected.accepted_at = target_starts_at
          AND protected.created_at = target_starts_at
          AND protected.updated_at = target_starts_at
          AND consent.consent_version = 'founding-household-protected-self-v1'
          AND consent.granted_at = target_starts_at
          AND projection.effective_at = target_starts_at
          AND projection.expires_at IS NULL
          AND projection.updated_at = target_starts_at
          AND evidence.action = 'accept'
          AND evidence.scope = jsonb_build_object(
            'protectedEnrollment', true,
            'source', 'founding_household_acceptance'
          )
          AND evidence.disclosure_version = 'founding-household-protected-self-v1'
          AND evidence.disclosure_digest =
            'ef161c853b8b4e918188a656228b126cc658fb61facf220012ec380130f2bd7b'
          AND evidence.policy_version = 'founding-household-protected-self-v1-policy'
          AND evidence.policy_digest =
            '4c91b448eca0142aca6a13c10172a800649973d641f1e63b0117ffe3e98196c8'
          AND evidence.source_interaction = 'founding_household_protected_enrollment'
          AND evidence.session_id = target_session_id
          AND evidence.effective_at = target_starts_at
          AND evidence.expires_at IS NULL
          AND evidence.recorded_at = target_starts_at
          AND evidence.supersedes_evidence_id IS NULL
        )
      )
  );
$$;

CREATE FUNCTION founding_household_sponsor_chain_closed_at(
  target_enrollment_id text,
  target_closed_at timestamptz
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM founding_household_enrollments enrollment
    JOIN entitlement_grants grant_record
      ON grant_record.household_id = enrollment.household_id
     AND grant_record.id = enrollment.entitlement_grant_id
    JOIN commerce_sponsorship_allocations allocation
      ON allocation.household_id = enrollment.household_id
     AND allocation.id = enrollment.sponsorship_allocation_id
    JOIN commerce_subscriptions subscription
      ON subscription.household_id = enrollment.household_id
     AND subscription.id = enrollment.subscription_id
    WHERE enrollment.id = target_enrollment_id
      AND enrollment.state = 'revoked'
      AND enrollment.revoked_at = target_closed_at
      AND grant_record.revoked_at = target_closed_at
      AND allocation.state = 'revoked'
      AND allocation.ends_at = target_closed_at
      AND subscription.lifecycle = 'canceled'
      AND subscription.ended_at = target_closed_at
      AND subscription.updated_at = target_closed_at
  );
$$;

CREATE FUNCTION validate_founding_household_enrollment_insert() RETURNS trigger
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
    JOIN identities identity ON identity.person_id = membership.person_id
      AND identity.issuer = session.issuer
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

  IF NOT EXISTS (
    SELECT 1 FROM consents consent
    JOIN consent_current_projections projection
      ON projection.household_id = consent.household_id
     AND projection.consent_id = consent.id
    JOIN consent_evidence evidence
      ON evidence.household_id = projection.household_id
     AND evidence.id = projection.latest_evidence_id
    WHERE consent.household_id = NEW.household_id AND consent.id = NEW.service_consent_id
      AND consent.protected_person_id = NEW.accepted_by_person_id
      AND consent.granted_by_person_id = NEW.accepted_by_person_id
      AND consent.purpose = 'founding_household_service_beta'
      AND consent.consent_version = 'founding-household-service-beta-v1'
      AND consent.granted_at = NEW.starts_at
      AND projection.state = 'active' AND projection.expires_at = NEW.ends_at
      AND projection.effective_at = NEW.starts_at
      AND projection.updated_at = NEW.starts_at
      AND evidence.action = 'accept'
      AND evidence.disclosure_version = 'founding-household-service-beta-v1'
      AND evidence.disclosure_digest = '2fe80c6da4f199a54462acea1ed3de53716a35ec8ff4f6b38f6bba633de181ae'
      AND evidence.policy_version = 'founding-household-service-beta-v1-policy'
      AND evidence.policy_digest = '815a516d88fef3be88b960c5f12a6b36c7be2f1c020610bfab16f7746ba197df'
      AND evidence.actor_person_id = NEW.accepted_by_person_id
      AND evidence.subject_person_id = NEW.accepted_by_person_id
      AND evidence.session_id = NEW.accepted_session_id
      AND evidence.effective_at = NEW.starts_at
      AND evidence.recorded_at = NEW.starts_at
      AND evidence.scope @> jsonb_build_object(
        'cohortKey', NEW.cohort_key,
        'researchConsent', false,
        'marketingConsent', false,
        'followUpConsent', false
      )
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
          AND protected_evidence.disclosure_digest = 'ef161c853b8b4e918188a656228b126cc658fb61facf220012ec380130f2bd7b'
          AND protected_evidence.policy_version = 'founding-household-protected-self-v1-policy'
          AND protected_evidence.policy_digest = '4c91b448eca0142aca6a13c10172a800649973d641f1e63b0117ffe3e98196c8'
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

CREATE TRIGGER founding_household_enrollment_insert_guard
BEFORE INSERT ON founding_household_enrollments
FOR EACH ROW EXECUTE FUNCTION validate_founding_household_enrollment_insert();

CREATE FUNCTION guard_founding_household_enrollment_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  authority_now timestamptz;
BEGIN
  IF NEW.household_id IS DISTINCT FROM OLD.household_id
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.cohort_key IS DISTINCT FROM OLD.cohort_key
    OR NEW.environment IS DISTINCT FROM OLD.environment
    OR NEW.policy_revision IS DISTINCT FROM OLD.policy_revision
    OR NEW.invitation_id IS DISTINCT FROM OLD.invitation_id
    OR NEW.benefit_key IS DISTINCT FROM OLD.benefit_key
    OR NEW.plan_version_id IS DISTINCT FROM OLD.plan_version_id
    OR NEW.sponsorship_id IS DISTINCT FROM OLD.sponsorship_id
    OR NEW.sponsorship_allocation_id IS DISTINCT FROM OLD.sponsorship_allocation_id
    OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
    OR NEW.entitlement_grant_id IS DISTINCT FROM OLD.entitlement_grant_id
    OR NEW.service_consent_id IS DISTINCT FROM OLD.service_consent_id
    OR NEW.protected_enrollment_created IS DISTINCT FROM OLD.protected_enrollment_created
    OR NEW.accepted_by_person_id IS DISTINCT FROM OLD.accepted_by_person_id
    OR NEW.accepted_session_id IS DISTINCT FROM OLD.accepted_session_id
    OR NEW.evidence_tier IS DISTINCT FROM OLD.evidence_tier
    OR NEW.operation_key IS DISTINCT FROM OLD.operation_key
    OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
    OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Founding Household enrollment facts are immutable';
  END IF;

  IF OLD.state <> 'active' OR NEW.state <> 'revoked'
    OR NEW.revoked_at IS NULL OR NEW.revoked_by_person_id IS NULL
    OR NEW.revoked_reason IS NULL OR OLD.revocation_operation_key IS NOT NULL
    OR NEW.revocation_operation_key IS NULL THEN
    RAISE EXCEPTION 'Invalid Founding Household enrollment transition';
  END IF;

  authority_now := founding_household_authority_now();

  IF NEW.revoked_at IS DISTINCT FROM authority_now THEN
    RAISE EXCEPTION 'Founding Household offboarding time must equal captured database authority';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM founding_household_operations operation
    WHERE operation.operation_key = NEW.revocation_operation_key
      AND operation.operation_kind = 'offboard'
      AND operation.cohort_key = NEW.cohort_key
      AND operation.environment = NEW.environment
      AND operation.actor_person_id = NEW.revoked_by_person_id
      AND split_part(operation.result_reference, ':', 1) = NEW.id
      AND operation.created_at = NEW.revoked_at
  ) THEN
    RAISE EXCEPTION 'Founding Household offboarding operation provenance is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM entitlement_grants grant_record
    WHERE grant_record.household_id = NEW.household_id
      AND grant_record.id = NEW.entitlement_grant_id
      AND grant_record.revoked_at = NEW.revoked_at
  ) OR NOT EXISTS (
    SELECT 1 FROM commerce_sponsorship_allocations allocation
    WHERE allocation.household_id = NEW.household_id
      AND allocation.id = NEW.sponsorship_allocation_id
      AND allocation.state = 'revoked'
      AND allocation.ends_at = NEW.revoked_at
  ) OR NOT EXISTS (
    SELECT 1 FROM commerce_subscriptions subscription
    WHERE subscription.household_id = NEW.household_id
      AND subscription.id = NEW.subscription_id
      AND subscription.lifecycle = 'canceled'
      AND subscription.ended_at = NEW.revoked_at
      AND subscription.updated_at = NEW.revoked_at
  ) THEN
    RAISE EXCEPTION 'Founding Household offboarding requires the exact sponsor chain closed first';
  END IF;

  IF NEW.revoked_reason = 'founder_revoked' AND NOT EXISTS (
    SELECT 1 FROM employee_assignments employee
    JOIN organizations organization ON organization.id = employee.organization_id
    JOIN founding_household_founder_authorities authority
      ON authority.cohort_key = NEW.cohort_key
     AND authority.environment = NEW.environment
     AND authority.founder_person_id = employee.person_id
    WHERE employee.person_id = NEW.revoked_by_person_id
      AND employee.role = 'hq_owner' AND employee.status = 'active'
      AND organization.kind = 'internal'
  ) THEN
    RAISE EXCEPTION 'Founding Household founder offboarding authority is invalid';
  END IF;

  IF NEW.revoked_reason = 'household_withdrew' AND (
    NEW.revoked_by_person_id IS DISTINCT FROM NEW.accepted_by_person_id
    OR NOT EXISTS (
      SELECT 1 FROM household_memberships membership
      JOIN household_administrator_assignments administrator
        ON administrator.household_id = membership.household_id
       AND administrator.person_id = membership.person_id
      WHERE membership.household_id = NEW.household_id
        AND membership.person_id = NEW.revoked_by_person_id
        AND membership.status = 'active' AND administrator.status = 'active'
    )
  ) THEN
    RAISE EXCEPTION 'Founding Household household withdrawal authority is invalid';
  END IF;

  IF NEW.revoked_reason = 'household_withdrew' AND NOT EXISTS (
    SELECT 1 FROM consent_current_projections projection
    JOIN consent_evidence evidence
      ON evidence.household_id = projection.household_id
     AND evidence.id = projection.latest_evidence_id
    WHERE projection.household_id = NEW.household_id
      AND projection.consent_id = NEW.service_consent_id
      AND projection.state = 'withdrawn'
      AND projection.actor_person_id = NEW.revoked_by_person_id
      AND projection.subject_person_id = NEW.accepted_by_person_id
      AND projection.effective_at = NEW.revoked_at
      AND projection.updated_at = NEW.revoked_at
      AND evidence.action = 'withdraw'
      AND evidence.purpose = 'founding_household_service_beta'
      AND evidence.actor_person_id = NEW.revoked_by_person_id
      AND evidence.subject_person_id = NEW.accepted_by_person_id
      AND evidence.effective_at = NEW.revoked_at
      AND evidence.recorded_at = NEW.revoked_at
  ) THEN
    RAISE EXCEPTION 'Founding Household household withdrawal requires exact consent evidence first';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER founding_household_enrollment_transition_guard
BEFORE UPDATE ON founding_household_enrollments
FOR EACH ROW EXECUTE FUNCTION guard_founding_household_enrollment_transition();

CREATE TRIGGER founding_household_enrollment_no_delete
BEFORE DELETE ON founding_household_enrollments
FOR EACH ROW EXECUTE FUNCTION reject_founding_household_append_mutation();

CREATE FUNCTION require_founding_household_policy_completion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actual_supersessions integer;
BEGIN
  IF NEW.revision = 1 THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM founding_household_invitations invitation
    WHERE invitation.cohort_key = NEW.cohort_key
      AND invitation.environment = NEW.environment
      AND invitation.policy_revision < NEW.revision
      AND invitation.state = 'pending'
  ) THEN
    RAISE EXCEPTION 'Founding Household policy commit must supersede and zeroize prior credentials';
  END IF;
  SELECT count(*)::integer INTO actual_supersessions
  FROM founding_household_invitations invitation
  WHERE invitation.cohort_key = NEW.cohort_key
    AND invitation.environment = NEW.environment
    AND invitation.policy_revision < NEW.revision
    AND invitation.state = 'superseded'
    AND invitation.credential_fingerprint IS NULL
    AND invitation.ended_at = NEW.created_at
    AND invitation.terminal_operation_key = NEW.operation_key;
  IF NOT EXISTS (
    SELECT 1 FROM founding_household_operations operation
    WHERE operation.operation_key = NEW.operation_key
      AND operation.result_reference =
        NEW.revision::text || ':' || actual_supersessions::text
  ) THEN
    RAISE EXCEPTION 'Founding Household policy result does not match exact supersessions';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER founding_household_policy_completion_required
AFTER INSERT ON founding_household_policy_versions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_founding_household_policy_completion();

CREATE FUNCTION require_founding_household_enrollment_completion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_enrollment founding_household_enrollments%ROWTYPE;
BEGIN
  SELECT * INTO current_enrollment
  FROM founding_household_enrollments enrollment
  WHERE enrollment.id = NEW.id;

  IF current_enrollment.state = 'active' AND NOT EXISTS (
    SELECT 1 FROM founding_household_invitations invitation
    WHERE invitation.id = current_enrollment.invitation_id
      AND invitation.state = 'accepted'
      AND invitation.credential_fingerprint IS NULL
      AND invitation.ended_at = current_enrollment.starts_at
      AND invitation.terminal_operation_key = current_enrollment.operation_key
  ) THEN
    RAISE EXCEPTION 'Founding Household enrollment commit must accept and zeroize its invitation';
  END IF;
  IF current_enrollment.state = 'active' AND NOT founding_household_has_exact_service_consent(
    current_enrollment.household_id,
    current_enrollment.service_consent_id,
    current_enrollment.accepted_by_person_id,
    current_enrollment.accepted_session_id,
    current_enrollment.cohort_key,
    current_enrollment.benefit_key,
    current_enrollment.environment,
    current_enrollment.starts_at,
    current_enrollment.ends_at
  ) THEN
    RAISE EXCEPTION 'Founding Household enrollment commit requires exact current service consent';
  END IF;
  IF current_enrollment.state = 'active' AND NOT founding_household_has_exact_protected_consent(
    current_enrollment.household_id,
    current_enrollment.accepted_by_person_id,
    current_enrollment.accepted_session_id,
    current_enrollment.environment,
    current_enrollment.starts_at,
    current_enrollment.entitlement_grant_id,
    current_enrollment.protected_enrollment_created
  ) THEN
    RAISE EXCEPTION 'Founding Household enrollment commit requires exact protected-adult consent';
  END IF;
  IF current_enrollment.state = 'revoked' AND EXISTS (
    SELECT 1 FROM commerce_allowance_allocations allowance
    WHERE allowance.household_id = current_enrollment.household_id
      AND allowance.entitlement_grant_id = current_enrollment.entitlement_grant_id
      AND allowance.state = 'active'
      AND EXISTS (
        SELECT 1 FROM entitlement_grants candidate
        WHERE candidate.household_id = allowance.household_id
          AND candidate.id <> current_enrollment.entitlement_grant_id
          AND founding_household_allowance_grant_supports(
            allowance.household_id,
            candidate.id,
            allowance.allowance_key,
            current_enrollment.revoked_at,
            true
          )
      )
  ) THEN
    RAISE EXCEPTION 'Founding Household offboarding commit must rebind supported allowances';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER founding_household_enrollment_completion_required
AFTER INSERT OR UPDATE ON founding_household_enrollments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_founding_household_enrollment_completion();

CREATE FUNCTION founding_household_has_exact_service_termination(
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
     AND terminal_session.person_id = evidence.actor_person_id
     AND terminal_session.issuer = evidence.actor_identity_issuer
     AND terminal_session.audience IN ('customer','mobile')
     AND terminal_session.revoked_at IS NULL
    WHERE enrollment.id = target_enrollment_id
      AND consent.protected_person_id = enrollment.accepted_by_person_id
      AND consent.granted_by_person_id = enrollment.accepted_by_person_id
      AND consent.purpose = 'founding_household_service_beta'
      AND consent.consent_version = 'founding-household-service-beta-v1'
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
      AND evidence.disclosure_version = 'founding-household-service-beta-v1'
      AND evidence.disclosure_digest =
        '2fe80c6da4f199a54462acea1ed3de53716a35ec8ff4f6b38f6bba633de181ae'
      AND evidence.policy_version = 'founding-household-service-beta-v1-policy'
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
      AND prior_evidence.disclosure_version = 'founding-household-service-beta-v1'
      AND prior_evidence.disclosure_digest =
        '2fe80c6da4f199a54462acea1ed3de53716a35ec8ff4f6b38f6bba633de181ae'
      AND prior_evidence.policy_version = 'founding-household-service-beta-v1-policy'
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

CREATE FUNCTION require_founding_household_consent_projection() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_household_id text := CASE WHEN TG_OP = 'DELETE' THEN OLD.household_id ELSE NEW.household_id END;
  target_consent_id text := CASE WHEN TG_OP = 'DELETE' THEN OLD.consent_id ELSE NEW.consent_id END;
  service_enrollment founding_household_enrollments%ROWTYPE;
  protected_enrollment founding_household_enrollments%ROWTYPE;
  current_projection consent_current_projections%ROWTYPE;
  terminal_evidence consent_evidence%ROWTYPE;
BEGIN
  SELECT * INTO service_enrollment
  FROM founding_household_enrollments enrollment
  WHERE enrollment.household_id = target_household_id
    AND enrollment.service_consent_id = target_consent_id;

  IF service_enrollment.id IS NOT NULL THEN
    SELECT * INTO current_projection
    FROM consent_current_projections projection
    WHERE projection.household_id = target_household_id
      AND projection.consent_id = target_consent_id;
    IF current_projection.consent_id IS NULL THEN
      RAISE EXCEPTION 'Founding Household enrollment commit requires exact current service consent';
    END IF;
    IF current_projection.state = 'active' THEN
      IF NOT founding_household_has_exact_service_consent(
        service_enrollment.household_id,
        service_enrollment.service_consent_id,
        service_enrollment.accepted_by_person_id,
        service_enrollment.accepted_session_id,
        service_enrollment.cohort_key,
        service_enrollment.benefit_key,
        service_enrollment.environment,
        service_enrollment.starts_at,
        service_enrollment.ends_at
      ) THEN
        RAISE EXCEPTION 'Founding Household enrollment commit requires exact current service consent';
      END IF;
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    SELECT * INTO terminal_evidence
    FROM consent_evidence evidence
    WHERE evidence.household_id = current_projection.household_id
      AND evidence.consent_id = current_projection.consent_id
      AND evidence.id = current_projection.latest_evidence_id;
    IF NOT founding_household_has_exact_service_termination(service_enrollment.id) THEN
      RAISE EXCEPTION 'Founding Household active service-consent termination requires exact sponsor-chain closure';
    END IF;

    IF service_enrollment.state = 'revoked'
      AND service_enrollment.revoked_reason = 'household_withdrew'
      AND service_enrollment.revoked_at = terminal_evidence.effective_at
      AND service_enrollment.revocation_operation_key IS NOT NULL
      AND terminal_evidence.source_interaction = 'founding_household_withdrawal'
      AND founding_household_sponsor_chain_closed_at(
        service_enrollment.id,
        terminal_evidence.effective_at
      ) THEN
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF service_enrollment.state = 'revoked'
      AND service_enrollment.revoked_reason = 'founder_revoked'
      AND service_enrollment.revoked_at < terminal_evidence.effective_at
      AND terminal_evidence.source_interaction = 'founding_household_consent_only_withdrawal'
      AND founding_household_sponsor_chain_closed_at(
        service_enrollment.id,
        service_enrollment.revoked_at
      )
      AND EXISTS (
        SELECT 1 FROM founding_household_operations operation
        WHERE operation.operation_kind = 'offboard'
          AND operation.actor_person_id = service_enrollment.accepted_by_person_id
          AND operation.created_at = terminal_evidence.effective_at
          AND operation.result_reference = service_enrollment.id || ':0:0'
      )
      AND NOT EXISTS (
        SELECT 1 FROM founding_household_allowance_transitions transition
        JOIN founding_household_operations operation
          ON operation.operation_key = transition.operation_key
        WHERE transition.enrollment_id = service_enrollment.id
          AND operation.created_at = terminal_evidence.effective_at
      ) THEN
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    RAISE EXCEPTION 'Founding Household active service-consent termination requires exact sponsor-chain closure';
  END IF;

  SELECT enrollment.* INTO protected_enrollment
  FROM founding_household_enrollments enrollment
  JOIN protected_members protected
    ON protected.household_id = enrollment.household_id
   AND protected.person_id = enrollment.accepted_by_person_id
  WHERE protected.household_id = target_household_id
    AND protected.consent_id = target_consent_id;

  IF protected_enrollment.id IS NOT NULL THEN
    SELECT * INTO current_projection
    FROM consent_current_projections projection
    WHERE projection.household_id = target_household_id
      AND projection.consent_id = target_consent_id;
    IF current_projection.consent_id IS NULL THEN
      RAISE EXCEPTION 'Founding Household enrollment commit requires exact protected-adult consent';
    END IF;
    IF current_projection.state = 'active' THEN
      IF NOT founding_household_has_exact_protected_consent(
        protected_enrollment.household_id,
        protected_enrollment.accepted_by_person_id,
        protected_enrollment.accepted_session_id,
        protected_enrollment.environment,
        protected_enrollment.starts_at,
        protected_enrollment.entitlement_grant_id,
        protected_enrollment.protected_enrollment_created
      ) THEN
        RAISE EXCEPTION 'Founding Household enrollment commit requires exact protected-adult consent';
      END IF;
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM protected_members protected
      JOIN commerce_allowance_allocations allowance
        ON allowance.household_id = protected.household_id
       AND allowance.id = protected.allowance_allocation_id
      JOIN consent_evidence evidence
        ON evidence.household_id = current_projection.household_id
       AND evidence.consent_id = current_projection.consent_id
       AND evidence.id = current_projection.latest_evidence_id
      JOIN identities identity
        ON identity.id = evidence.actor_identity_id
       AND identity.person_id = evidence.actor_person_id
       AND identity.issuer = evidence.actor_identity_issuer
       AND identity.subject = evidence.actor_identity_subject
       AND identity.status = 'active'
      WHERE protected.household_id = target_household_id
        AND protected.consent_id = target_consent_id
        AND protected.person_id = protected_enrollment.accepted_by_person_id
        AND protected.status = 'revoked'
        AND protected.latest_consent_evidence_id = current_projection.latest_evidence_id
        AND protected.revoked_at = current_projection.effective_at
        AND protected.updated_at = current_projection.updated_at
        AND allowance.state = 'released'
        AND allowance.released_at = current_projection.effective_at
        AND current_projection.state = 'withdrawn'
        AND current_projection.actor_person_id = protected.person_id
        AND current_projection.subject_person_id = protected.person_id
        AND current_projection.recipient_person_id IS NULL
        AND current_projection.purpose = 'protected_enrollment'
        AND current_projection.scope = evidence.scope
        AND current_projection.effective_at = evidence.effective_at
        AND current_projection.expires_at IS NULL
        AND current_projection.updated_at = evidence.recorded_at
        AND evidence.action = 'withdraw'
        AND evidence.actor_person_id = protected.person_id
        AND evidence.subject_person_id = protected.person_id
        AND evidence.recipient_person_id IS NULL
        AND evidence.purpose = 'protected_enrollment'
        AND evidence.scope = jsonb_build_object('protectedEnrollment', true)
        AND evidence.source_interaction = 'protected_enrollment_withdraw'
        AND evidence.effective_at = evidence.recorded_at
        AND evidence.expires_at IS NULL
        AND evidence.supersedes_evidence_id IS NOT NULL
        AND (
          (protected_enrollment.environment = 'local'
            AND evidence.assurance = 'development'
            AND evidence.actor_identity_issuer = 'boomerbuddy-dev')
          OR (protected_enrollment.environment <> 'local'
            AND evidence.assurance = 'verified'
            AND evidence.actor_identity_issuer <> 'boomerbuddy-dev')
        )
    ) THEN
      RAISE EXCEPTION 'Founding Household enrollment commit requires exact protected-adult consent';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE CONSTRAINT TRIGGER founding_household_consent_projection_required
AFTER INSERT OR UPDATE OR DELETE ON consent_current_projections
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_founding_household_consent_projection();

CREATE FUNCTION founding_household_allowance_grant_supports(
  target_household_id text,
  target_grant_id text,
  target_allowance_key text,
  effective_at timestamptz,
  require_spare_capacity boolean
) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE
  allowance_limit integer;
  active_usage integer;
BEGIN
  SELECT (allowance.value->>'limit')::integer INTO allowance_limit
  FROM entitlement_grants grant_record
  JOIN commerce_subscriptions subscription
    ON subscription.household_id = grant_record.household_id
   AND subscription.id = grant_record.subscription_id
   AND subscription.plan_version_id = grant_record.plan_version_id
  JOIN commerce_plan_versions plan ON plan.id = grant_record.plan_version_id
  JOIN commerce_product_versions product ON product.id = plan.product_version_id
  CROSS JOIN LATERAL jsonb_array_elements(plan.allowances) allowance(value)
  WHERE grant_record.household_id = target_household_id
    AND grant_record.id = target_grant_id
    AND grant_record.source_verified = true
    AND grant_record.starts_at <= effective_at
    AND (grant_record.ends_at IS NULL OR grant_record.ends_at > effective_at)
    AND grant_record.revoked_at IS NULL
    AND subscription.source_verified = true
    AND subscription.lifecycle IN ('trialing','active','grace','cancel_at_period_end','restored')
    AND subscription.current_period_starts_at <= effective_at
    AND (
      subscription.current_period_ends_at IS NULL
      OR subscription.current_period_ends_at > effective_at
    )
    AND plan.available_from <= effective_at
    AND (plan.available_until IS NULL OR plan.available_until > effective_at)
    AND product.available_from <= effective_at
    AND (product.available_until IS NULL OR product.available_until > effective_at)
    AND (
      plan.state = 'active'
      OR (
        plan.state = 'hypothesis' AND (
          (
            subscription.source <> 'sponsor'
            AND EXISTS (
              SELECT 1 FROM commerce_provider_subscription_records provider
              WHERE provider.household_id = subscription.household_id
                AND provider.subscription_id = subscription.id
                AND provider.environment IN ('local','test')
                AND provider.verified_at IS NOT NULL
            )
          )
          OR (
            subscription.source = 'sponsor'
            AND EXISTS (
              SELECT 1 FROM commerce_sponsorship_allocations sponsor_allocation
              JOIN commerce_sponsorships sponsorship
                ON sponsorship.id = sponsor_allocation.sponsorship_id
              JOIN organizations organization ON organization.id = sponsorship.organization_id
              WHERE sponsor_allocation.household_id = grant_record.household_id
                AND sponsor_allocation.id = grant_record.sponsorship_id
                AND organization.verification_state = 'local_fixture'
            )
          )
        )
      )
    )
    AND (
      subscription.source <> 'sponsor'
      OR EXISTS (
        SELECT 1 FROM commerce_sponsorship_allocations sponsor_allocation
        JOIN commerce_sponsorships sponsorship
          ON sponsorship.id = sponsor_allocation.sponsorship_id
        JOIN organizations organization ON organization.id = sponsorship.organization_id
        WHERE sponsor_allocation.household_id = grant_record.household_id
          AND sponsor_allocation.id = grant_record.sponsorship_id
          AND sponsor_allocation.state = 'active'
          AND sponsor_allocation.source_verified = true
          AND sponsor_allocation.starts_at <= effective_at
          AND (sponsor_allocation.ends_at IS NULL OR sponsor_allocation.ends_at > effective_at)
          AND sponsorship.state = 'active' AND sponsorship.starts_at <= effective_at
          AND (sponsorship.ends_at IS NULL OR sponsorship.ends_at > effective_at)
          AND organization.verification_state IN ('local_fixture','verified')
      )
    )
    AND allowance.value->>'kind' = target_allowance_key
    AND NOT EXISTS (
      SELECT 1 FROM founding_household_enrollments other_founding
      WHERE other_founding.household_id = grant_record.household_id
        AND other_founding.entitlement_grant_id = grant_record.id
    )
  ORDER BY grant_record.precedence DESC, grant_record.id
  LIMIT 1;

  IF allowance_limit IS NULL THEN
    RETURN false;
  END IF;
  SELECT count(*)::integer INTO active_usage
  FROM commerce_allowance_allocations allocation
  WHERE allocation.household_id = target_household_id
    AND allocation.entitlement_grant_id = target_grant_id
    AND allocation.allowance_key = target_allowance_key
    AND allocation.state = 'active';
  IF require_spare_capacity THEN
    RETURN active_usage < allowance_limit;
  END IF;
  RETURN active_usage <= allowance_limit;
END;
$$;

CREATE FUNCTION require_founding_household_allowance_rebinding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  founding_enrollment founding_household_enrollments%ROWTYPE;
  transition_kind text;
  transition_to_grant_id text;
BEGIN
  SELECT * INTO founding_enrollment
  FROM founding_household_enrollments enrollment
  WHERE enrollment.household_id = OLD.household_id
    AND enrollment.entitlement_grant_id = OLD.entitlement_grant_id;
  IF founding_enrollment.id IS NULL OR founding_enrollment.state <> 'revoked' THEN
    RETURN NEW;
  END IF;
  IF founding_enrollment.revocation_operation_key IS NULL THEN
    RAISE EXCEPTION 'Founding Household allowance transition requires exact offboarding operation';
  END IF;
  IF NEW.household_id IS DISTINCT FROM OLD.household_id
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.allowance_key IS DISTINCT FROM OLD.allowance_key
    OR NEW.subject_kind IS DISTINCT FROM OLD.subject_kind
    OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
    OR NEW.allocated_at IS DISTINCT FROM OLD.allocated_at THEN
    RAISE EXCEPTION 'Founding Household offboarding cannot rewrite allowance identity';
  END IF;
  IF NEW.state = 'active' THEN
    IF NEW.entitlement_grant_id = OLD.entitlement_grant_id
      OR NEW.released_at IS NOT NULL
      OR NOT founding_household_allowance_grant_supports(
        NEW.household_id,
        NEW.entitlement_grant_id,
        NEW.allowance_key,
        founding_enrollment.revoked_at,
        false
      ) THEN
      RAISE EXCEPTION 'Founding Household allowance must rebind to an effective unrelated grant';
    END IF;
    transition_kind := 'rebind';
    transition_to_grant_id := NEW.entitlement_grant_id;
  ELSIF NEW.state = 'released' THEN
    IF NEW.entitlement_grant_id IS DISTINCT FROM OLD.entitlement_grant_id
      OR NEW.released_at IS DISTINCT FROM founding_enrollment.revoked_at THEN
      RAISE EXCEPTION 'Founding Household allowance release must match exact offboarding';
    END IF;
    IF EXISTS (
      SELECT 1 FROM entitlement_grants candidate
      WHERE candidate.household_id = NEW.household_id
        AND candidate.id <> OLD.entitlement_grant_id
        AND founding_household_allowance_grant_supports(
          NEW.household_id,
          candidate.id,
          NEW.allowance_key,
          founding_enrollment.revoked_at,
          true
        )
    ) THEN
      RAISE EXCEPTION 'Founding Household allowance cannot release while an unrelated grant supports it';
    END IF;
    transition_kind := 'release';
    transition_to_grant_id := NULL;
  ELSE
    RAISE EXCEPTION 'Founding Household allowance offboarding state is invalid';
  END IF;

  INSERT INTO founding_household_allowance_transitions(
    operation_key, enrollment_id, household_id, allowance_allocation_id,
    allowance_key, from_grant_id, to_grant_id, transition_kind, occurred_at
  ) VALUES (
    founding_enrollment.revocation_operation_key,
    founding_enrollment.id,
    OLD.household_id,
    OLD.id,
    OLD.allowance_key,
    OLD.entitlement_grant_id,
    transition_to_grant_id,
    transition_kind,
    founding_enrollment.revoked_at
  );
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER founding_household_allowance_rebinding_required
AFTER UPDATE ON commerce_allowance_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_founding_household_allowance_rebinding();

CREATE FUNCTION guard_founding_household_allowance_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM founding_household_enrollments enrollment
    WHERE enrollment.household_id = OLD.household_id
      AND enrollment.entitlement_grant_id = OLD.entitlement_grant_id
  ) THEN
    RAISE EXCEPTION 'Founding Household allowance history cannot be deleted during offboarding';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER aa_founding_household_allowance_delete_guard
BEFORE DELETE ON commerce_allowance_allocations
FOR EACH ROW EXECUTE FUNCTION guard_founding_household_allowance_delete();

CREATE FUNCTION require_founding_household_operation_completion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_id text;
  target_household_id text;
  actual_result_reference text;
  protected_rebind_count integer;
  trusted_rebind_count integer;
  expected_action text;
  expected_resource_type text;
  expected_event_type text;
  expected_aggregate_type text;
  matching_pairs integer;
BEGIN
  IF NEW.operation_kind = 'policy' THEN
    SELECT
      policy.cohort_key,
      policy.revision::text || ':' || (
        SELECT count(*)::integer
        FROM founding_household_invitations invitation
        WHERE invitation.terminal_operation_key = NEW.operation_key
          AND invitation.cohort_key = policy.cohort_key
          AND invitation.environment = policy.environment
          AND invitation.policy_revision < policy.revision
          AND invitation.state = 'superseded'
          AND invitation.credential_fingerprint IS NULL
          AND invitation.ended_at = policy.created_at
      )::text
    INTO target_id, actual_result_reference
    FROM founding_household_policy_versions policy
    WHERE policy.operation_key = NEW.operation_key
      AND policy.created_at = NEW.created_at;
    IF target_id IS NULL OR NEW.result_reference IS DISTINCT FROM actual_result_reference THEN
      RAISE EXCEPTION 'Founding Household policy result does not match exact supersessions';
    END IF;
    expected_action := 'founding_household.policy_configured';
    expected_resource_type := 'founding_household_program';
    expected_event_type := 'founding_household.policy_configured.v1';
    expected_aggregate_type := 'founding_household_program';
  ELSIF NEW.operation_kind = 'invite' THEN
    SELECT invitation.id INTO target_id
    FROM founding_household_invitations invitation
    WHERE invitation.operation_key = NEW.operation_key
      AND invitation.created_at = NEW.created_at
      AND invitation.state = 'pending'
      AND invitation.credential_fingerprint IS NOT NULL
      AND invitation.ended_at IS NULL
      AND invitation.terminal_operation_key IS NULL;
    actual_result_reference := target_id;
    expected_action := 'founding_household.invitation_created';
    expected_resource_type := 'founding_household_invitation';
    expected_event_type := 'founding_household.invitation_created.v1';
    expected_aggregate_type := 'founding_household_invitation';
  ELSIF NEW.operation_kind = 'invite_revoke' THEN
    SELECT invitation.id INTO target_id
    FROM founding_household_invitations invitation
    WHERE invitation.terminal_operation_key = NEW.operation_key
      AND invitation.state = 'revoked'
      AND invitation.credential_fingerprint IS NULL
      AND invitation.ended_at = NEW.created_at;
    actual_result_reference := target_id;
    expected_action := 'founding_household.invitation_revoked';
    expected_resource_type := 'founding_household_invitation';
    expected_event_type := 'founding_household.invitation_revoked.v1';
    expected_aggregate_type := 'founding_household_invitation';
  ELSIF NEW.operation_kind = 'accept' THEN
    SELECT enrollment.id, enrollment.household_id INTO target_id, target_household_id
    FROM founding_household_enrollments enrollment
    WHERE enrollment.operation_key = NEW.operation_key
      AND enrollment.starts_at = NEW.created_at
      AND enrollment.state = 'active'
      AND enrollment.revoked_at IS NULL
      AND enrollment.revoked_by_person_id IS NULL
      AND enrollment.revoked_reason IS NULL
      AND enrollment.revocation_operation_key IS NULL;
    actual_result_reference := target_id;
    expected_action := 'founding_household.accepted';
    expected_resource_type := 'founding_household_enrollment';
    expected_event_type := 'founding_household.accepted.v1';
    expected_aggregate_type := 'founding_household_enrollment';
  ELSIF NEW.operation_kind = 'offboard' THEN
    SELECT enrollment.id, enrollment.household_id INTO target_id, target_household_id
    FROM founding_household_enrollments enrollment
    WHERE enrollment.revocation_operation_key = NEW.operation_key
      AND enrollment.state = 'revoked'
      AND enrollment.revoked_at = NEW.created_at
      AND founding_household_sponsor_chain_closed_at(enrollment.id, NEW.created_at);
    IF target_id IS NOT NULL THEN
      SELECT count(*)::integer INTO protected_rebind_count
      FROM founding_household_allowance_transitions transition
      WHERE transition.operation_key = NEW.operation_key
        AND transition.enrollment_id = target_id
        AND transition.allowance_key = 'protected_members'
        AND transition.transition_kind = 'rebind'
        AND transition.occurred_at = NEW.created_at;
      SELECT count(*)::integer INTO trusted_rebind_count
      FROM founding_household_allowance_transitions transition
      WHERE transition.operation_key = NEW.operation_key
        AND transition.enrollment_id = target_id
        AND transition.allowance_key = 'trusted_circle_participants'
        AND transition.transition_kind = 'rebind'
        AND transition.occurred_at = NEW.created_at;
      actual_result_reference := target_id || ':' || protected_rebind_count::text
        || ':' || trusted_rebind_count::text;
      expected_action := 'founding_household.offboarded';
      expected_event_type := 'founding_household.offboarded.v1';
    ELSE
      target_id := split_part(NEW.result_reference, ':', 1);
      SELECT enrollment.household_id INTO target_household_id
      FROM founding_household_enrollments enrollment
      JOIN consent_current_projections projection
        ON projection.household_id = enrollment.household_id
       AND projection.consent_id = enrollment.service_consent_id
      JOIN consent_evidence evidence
        ON evidence.household_id = projection.household_id
       AND evidence.consent_id = projection.consent_id
       AND evidence.id = projection.latest_evidence_id
      WHERE enrollment.id = target_id
        AND enrollment.state = 'revoked'
        AND enrollment.revoked_reason = 'founder_revoked'
        AND enrollment.revocation_operation_key <> NEW.operation_key
        AND enrollment.accepted_by_person_id = NEW.actor_person_id
        AND projection.state = 'withdrawn'
        AND evidence.action = 'withdraw'
        AND evidence.source_interaction = 'founding_household_consent_only_withdrawal'
        AND evidence.effective_at = NEW.created_at
        AND evidence.recorded_at = NEW.created_at
        AND founding_household_has_exact_service_termination(enrollment.id)
        AND founding_household_sponsor_chain_closed_at(
          enrollment.id,
          enrollment.revoked_at
        )
        AND NOT EXISTS (
          SELECT 1 FROM founding_household_allowance_transitions transition
          WHERE transition.operation_key = NEW.operation_key
        );
      IF target_household_id IS NULL THEN
        RAISE EXCEPTION 'Founding Household operation result_reference does not match completed domain result';
      END IF;
      actual_result_reference := target_id || ':0:0';
      expected_action := 'founding_household.service_consent_withdrawn';
      expected_event_type := 'founding_household.service_consent_withdrawn.v1';
    END IF;
    expected_resource_type := 'founding_household_enrollment';
    expected_aggregate_type := 'founding_household_enrollment';
  END IF;

  IF target_id IS NULL
    OR NEW.result_reference IS DISTINCT FROM actual_result_reference THEN
    RAISE EXCEPTION 'Founding Household operation result_reference does not match completed domain result';
  END IF;

  SELECT count(*)::integer INTO matching_pairs
  FROM audit_events audit
  JOIN outbox_events event
    ON event.founding_household_operation_key = audit.founding_household_operation_key
   AND event.correlation_id = audit.correlation_id
   AND event.household_id IS NOT DISTINCT FROM audit.household_id
   AND event.actor_person_id IS NOT DISTINCT FROM audit.actor_person_id
  WHERE audit.founding_household_operation_key = NEW.operation_key
    AND event.founding_household_operation_key = NEW.operation_key
    AND audit.actor_person_id = NEW.actor_person_id
    AND audit.household_id IS NOT DISTINCT FROM target_household_id
    AND audit.action = expected_action
    AND audit.resource_type = expected_resource_type
    AND audit.resource_id = target_id
    AND audit.outcome = 'completed'
    AND audit.occurred_at = NEW.created_at
    AND event.event_type = expected_event_type
    AND event.event_version = 1
    AND event.aggregate_type = expected_aggregate_type
    AND event.aggregate_id = target_id
    AND event.classification = 'internal'
    AND event.occurred_at = NEW.created_at
    AND event.available_at = NEW.created_at
    AND event.next_attempt_at = NEW.created_at
    AND event.processed_at IS NULL
    AND event.dead_lettered_at IS NULL
    AND event.attempts = 0
    AND event.lease_owner IS NULL
    AND event.lease_expires_at IS NULL
    AND event.heartbeat_at IS NULL
    AND event.last_error_code IS NULL
    AND event.replay_of_event_id IS NULL
    AND event.replay_reason IS NULL
    AND event.replay_actor_person_id IS NULL
    AND event.replay_resolved_at IS NULL;

  IF matching_pairs <> 1 THEN
    RAISE EXCEPTION 'Founding Household operation requires one fresh operation-bound audit and outbox pair';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER founding_household_operation_completion_required
AFTER INSERT ON founding_household_operations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_founding_household_operation_completion();

INSERT INTO commerce_product_versions(
  id, product_key, version, display_name, available_from, created_at
) VALUES (
  'consumer_household_v1', 'consumer_household', 1,
  'BoomerBuddy household protection', '2026-08-15T00:00:00.000Z',
  '2026-08-16T00:00:00.000Z'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO commerce_plan_versions(
  id, product_version_id, plan_key, version, display_name, state,
  capabilities, allowances, prices, available_from, created_at
) VALUES
  (
    'founding_plus_beta_v2', 'consumer_household_v1', 'plus', 2,
    'Founding Plus beta sponsor benefit', 'active',
    '["check:text","check:url","history:read","family:manage","orientation:use"]'::jsonb,
    '[{"kind":"protected_members","limit":1},{"kind":"trusted_circle_participants","limit":2}]'::jsonb,
    '[{"interval":"month","amountMinor":0,"currency":"USD","kind":"founding_experiment"}]'::jsonb,
    '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z'
  ),
  (
    'founding_family_beta_v2', 'consumer_household_v1', 'family', 2,
    'Founding Family beta sponsor benefit', 'active',
    '["check:text","check:url","history:read","family:manage","orientation:use"]'::jsonb,
    '[{"kind":"protected_members","limit":3},{"kind":"trusted_circle_participants","limit":6}]'::jsonb,
    '[{"interval":"month","amountMinor":0,"currency":"USD","kind":"founding_experiment"}]'::jsonb,
    '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z'
  )
ON CONFLICT (id) DO NOTHING;

-- A previously seeded local database can legitimately have an earlier created_at
-- for the shared product row. Every effective immutable catalogue fact is pinned;
-- conflicting content under one of these IDs fails the forward migration closed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM commerce_product_versions product
    WHERE product.id = 'consumer_household_v1'
      AND product.product_key = 'consumer_household'
      AND product.version = 1
      AND product.display_name = 'BoomerBuddy household protection'
      AND product.available_from = '2026-08-15T00:00:00.000Z'::timestamptz
      AND product.available_until IS NULL
  ) THEN
    RAISE EXCEPTION 'Founding Household product catalogue conflict';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM commerce_plan_versions plan
    WHERE plan.id = 'founding_plus_beta_v2'
      AND plan.product_version_id = 'consumer_household_v1'
      AND plan.plan_key = 'plus'
      AND plan.version = 2
      AND plan.display_name = 'Founding Plus beta sponsor benefit'
      AND plan.state = 'active'
      AND plan.capabilities =
        '["check:text","check:url","history:read","family:manage","orientation:use"]'::jsonb
      AND plan.allowances =
        '[{"kind":"protected_members","limit":1},{"kind":"trusted_circle_participants","limit":2}]'::jsonb
      AND plan.prices =
        '[{"interval":"month","amountMinor":0,"currency":"USD","kind":"founding_experiment"}]'::jsonb
      AND plan.available_from = '2026-08-16T00:00:00.000Z'::timestamptz
      AND plan.available_until IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM commerce_plan_versions plan
    WHERE plan.id = 'founding_family_beta_v2'
      AND plan.product_version_id = 'consumer_household_v1'
      AND plan.plan_key = 'family'
      AND plan.version = 2
      AND plan.display_name = 'Founding Family beta sponsor benefit'
      AND plan.state = 'active'
      AND plan.capabilities =
        '["check:text","check:url","history:read","family:manage","orientation:use"]'::jsonb
      AND plan.allowances =
        '[{"kind":"protected_members","limit":3},{"kind":"trusted_circle_participants","limit":6}]'::jsonb
      AND plan.prices =
        '[{"interval":"month","amountMinor":0,"currency":"USD","kind":"founding_experiment"}]'::jsonb
      AND plan.available_from = '2026-08-16T00:00:00.000Z'::timestamptz
      AND plan.available_until IS NULL
  ) THEN
    RAISE EXCEPTION 'Founding Household plan catalogue conflict';
  END IF;
END;
$$;

INSERT INTO founding_household_program_definitions(
  cohort_key, definition_version, definition_digest, created_at
) VALUES (
  'run3_sponsored_founding_household_v1',
  1,
  'qGzxlIBWaFTEWjyyMMcMyO9MlT4glrg1Ue2IagISQZ0',
  '2026-08-16T00:00:00.000Z'
);

INSERT INTO founding_household_policy_versions(
  cohort_key, environment, revision, state, benefit_key, max_households,
  invitation_ttl_days, access_duration_days, program_ends_at,
  changed_by_person_id, operation_key, created_at
) VALUES
  ('run3_sponsored_founding_household_v1', 'local', 1, 'disabled', NULL, NULL,
   NULL, NULL, NULL, NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3_sponsored_founding_household_v1', 'staging', 1, 'disabled', NULL, NULL,
   NULL, NULL, NULL, NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3_sponsored_founding_household_v1', 'production', 1, 'disabled', NULL, NULL,
   NULL, NULL, NULL, NULL, NULL, '2026-08-16T00:00:00.000Z');
