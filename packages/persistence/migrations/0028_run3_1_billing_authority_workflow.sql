ALTER TABLE household_billing_authorities
  DROP CONSTRAINT household_billing_authorities_household_id_granted_by_pers_fkey,
  ADD COLUMN grant_source text NOT NULL DEFAULT 'household_member'
    CHECK (grant_source IN ('household_member', 'hq_operator')),
  ADD CONSTRAINT household_billing_authorities_granted_by_person_id_fkey
    FOREIGN KEY (granted_by_person_id) REFERENCES persons(id) ON DELETE RESTRICT;

CREATE FUNCTION validate_billing_authority_grant_source() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status <> 'active' THEN
    IF NEW.grant_source IS DISTINCT FROM OLD.grant_source
      OR NEW.granted_by_person_id IS DISTINCT FROM OLD.granted_by_person_id
      OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
      OR NEW.household_id IS DISTINCT FROM OLD.household_id
      OR NEW.person_id IS DISTINCT FROM OLD.person_id
    THEN
      RAISE EXCEPTION 'Closed billing authority cannot rewrite grant evidence';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.grant_source = 'household_member' AND NOT EXISTS (
    SELECT 1 FROM household_memberships membership
    WHERE membership.household_id = NEW.household_id
      AND membership.person_id = NEW.granted_by_person_id
  ) THEN
    RAISE EXCEPTION 'Household billing authority grantor is outside the household';
  END IF;
  IF NEW.grant_source = 'hq_operator' AND NOT EXISTS (
    SELECT 1 FROM employee_assignments employee
    JOIN organizations organization ON organization.id = employee.organization_id
    WHERE employee.person_id = NEW.granted_by_person_id
      AND employee.role = 'hq_owner' AND employee.status = 'active'
      AND organization.kind = 'internal'
  ) THEN
    RAISE EXCEPTION 'HQ billing authority grantor lacks active internal owner authority';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER household_billing_authorities_grant_source_guard
BEFORE INSERT OR UPDATE ON household_billing_authorities
FOR EACH ROW EXECUTE FUNCTION validate_billing_authority_grant_source();

CREATE TABLE household_billing_authority_events (
  id text PRIMARY KEY,
  operation_key text NOT NULL UNIQUE CHECK (
    operation_key ~ '^billing-authority:(grant|revoke):[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'
  ),
  household_id text NOT NULL,
  person_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('grant', 'revoke')),
  previous_status text NOT NULL CHECK (
    previous_status IN ('absent', 'active', 'suspended', 'revoked')
  ),
  next_status text NOT NULL CHECK (next_status IN ('active', 'revoked')),
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code IN (
    'customer_billing_consent_verified',
    'customer_billing_consent_withdrawn',
    'operator_correction',
    'security_response'
  )),
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (household_id, person_id)
    REFERENCES household_memberships(household_id, person_id) ON DELETE RESTRICT,
  CHECK (
    (action = 'grant' AND next_status = 'active'
      AND reason_code IN ('customer_billing_consent_verified', 'operator_correction'))
    OR
    (action = 'revoke' AND next_status = 'revoked'
      AND reason_code IN (
        'customer_billing_consent_withdrawn', 'operator_correction', 'security_response'
      ))
  )
);

CREATE INDEX household_billing_authority_events_target_idx
  ON household_billing_authority_events(household_id, person_id, occurred_at DESC, id);

CREATE FUNCTION reject_billing_authority_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Billing authority event history is append-only';
END;
$$;

CREATE TRIGGER household_billing_authority_events_append_only
BEFORE UPDATE OR DELETE ON household_billing_authority_events
FOR EACH ROW EXECUTE FUNCTION reject_billing_authority_event_mutation();
