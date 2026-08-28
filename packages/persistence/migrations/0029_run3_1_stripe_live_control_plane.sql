-- Production-capable Stripe controls. This migration creates no production control row and
-- therefore cannot enable live network initiation by itself.

-- The version-1 provisioning catalogue is code-bound by digest. Advance only the two definitions
-- whose exact Stripe surface custody contract changed in this migration. Refuse an unexpected prior
-- digest instead of silently rewriting a divergent catalogue.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM founder_provisioning_workstreams
    WHERE workstream_key = 'replit'
      AND definition_version = 1
      AND definition_digest = 'vVZsCo6BGaVr9JmIW9nOrmHHYh_OmvtZ_H0o_NvWQcQ'
  ) OR NOT EXISTS (
    SELECT 1 FROM founder_provisioning_workstreams
    WHERE workstream_key = 'stripe'
      AND definition_version = 1
      AND definition_digest = 'iVIfICLRt0h1kCAvDIaTfRktEpYRBVnykxdRAHW7iLs'
  ) THEN
    RAISE EXCEPTION 'Unexpected founder provisioning catalogue digest before Stripe migration';
  END IF;
END;
$$;

ALTER TABLE founder_provisioning_workstreams
  DISABLE TRIGGER founder_provisioning_workstreams_immutable;

UPDATE founder_provisioning_workstreams
SET definition_digest = CASE workstream_key
  WHEN 'replit' THEN '6CZMd6E24L_rcXap_XtuwN0ADAaIAjBs1Ya2BfgkdTM'
  WHEN 'stripe' THEN 'AVzvfMHJ-fpTUBtl_EJAnPqFiN8l5BAYeHuI6r5gyfM'
  ELSE definition_digest
END
WHERE workstream_key IN ('replit', 'stripe');

ALTER TABLE founder_provisioning_workstreams
  ENABLE TRIGGER founder_provisioning_workstreams_immutable;

ALTER TABLE commerce_stripe_preflight_records
  DROP CONSTRAINT commerce_stripe_preflight_records_api_version_check,
  ADD CONSTRAINT commerce_stripe_preflight_api_version_check CHECK (
    api_version IN ('2026-02-25.clover', '2026-07-29.dahlia')
  ),
  ADD CONSTRAINT commerce_stripe_preflight_livemode_check CHECK (
    livemode = (environment = 'production')
  );

ALTER TABLE commerce_stripe_initiation_controls
  DROP CONSTRAINT commerce_stripe_initiation_controls_check,
  ADD CONSTRAINT commerce_stripe_initiation_reason_state_check CHECK (
    (state = 'enabled' AND (
      (environment = 'test' AND reason_code = 'founder_test_activation')
      OR (environment = 'production' AND reason_code = 'founder_live_activation')
    ))
    OR (state = 'disabled' AND reason_code NOT IN (
      'founder_test_activation', 'founder_live_activation'
    ))
  );

CREATE FUNCTION enforce_stripe_initiation_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM commerce_stripe_initiation_controls existing
    WHERE existing.environment = NEW.environment
  ) AND NEW.revision <> 1 THEN
    RAISE EXCEPTION 'Stripe initiation control must begin at revision 1';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.revision <> OLD.revision + 1
    OR NEW.changed_at < OLD.changed_at
  ) THEN
    RAISE EXCEPTION 'Stripe initiation control revision must advance exactly once';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER commerce_stripe_initiation_revision_guard
BEFORE INSERT OR UPDATE ON commerce_stripe_initiation_controls
FOR EACH ROW EXECUTE FUNCTION enforce_stripe_initiation_revision();

ALTER TABLE commerce_stripe_cohort_policies
  ADD CONSTRAINT commerce_stripe_cohort_policy_window_check CHECK (
    (state = 'active' AND max_active > 0 AND policy_expires_at > changed_at)
    OR (state = 'expired' AND policy_expires_at <= changed_at)
    OR state = 'disabled'
  ),
  ADD CONSTRAINT commerce_stripe_production_cohort_cap_check CHECK (
    environment <> 'production' OR max_active BETWEEN 0 AND 1
  );

CREATE FUNCTION enforce_stripe_cohort_policy_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM commerce_stripe_cohort_policies existing
    WHERE existing.environment = NEW.environment
  ) AND NEW.revision <> 1 THEN
    RAISE EXCEPTION 'Stripe cohort policy must begin at revision 1';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.revision <> OLD.revision + 1
    OR NEW.changed_at < OLD.changed_at
  ) THEN
    RAISE EXCEPTION 'Stripe cohort policy revision must advance exactly once';
  END IF;
  IF NEW.environment = 'production' AND EXISTS (
    SELECT 1 FROM commerce_stripe_initiation_controls control
    WHERE control.environment = 'production' AND control.state = 'enabled'
  ) AND (
    NEW.state <> 'active'
    OR NEW.live_approved = false
    OR NEW.max_active < 1
    OR NEW.policy_expires_at <= CURRENT_TIMESTAMP
  ) THEN
    RAISE EXCEPTION 'Disable live Stripe initiation before closing its cohort policy';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER commerce_stripe_cohort_policy_revision_guard
BEFORE INSERT OR UPDATE ON commerce_stripe_cohort_policies
FOR EACH ROW EXECUTE FUNCTION enforce_stripe_cohort_policy_revision();

CREATE FUNCTION enforce_stripe_live_initiation_dependencies() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.environment = 'production' AND NEW.state = 'enabled' AND NOT EXISTS (
    SELECT 1 FROM commerce_stripe_cohort_policies policy
    WHERE policy.environment = 'production'
      AND policy.cohort_key = 'founding_household_v1'
      AND policy.benefit_key = 'family_v1_monthly_1499'
      AND policy.state = 'active'
      AND policy.max_active > 0
      AND policy.live_approved = true
      AND policy.policy_expires_at > CURRENT_TIMESTAMP
  ) THEN
    RAISE EXCEPTION 'Live Stripe initiation requires an active approved bounded cohort';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER commerce_stripe_live_initiation_dependency_guard
BEFORE INSERT OR UPDATE ON commerce_stripe_initiation_controls
FOR EACH ROW EXECUTE FUNCTION enforce_stripe_live_initiation_dependencies();

CREATE TABLE commerce_stripe_cohort_policy_events_v2 (
  id text PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('test', 'production')),
  previous_state text NOT NULL CHECK (
    previous_state IN ('absent', 'disabled', 'active', 'expired')
  ),
  next_state text NOT NULL CHECK (next_state IN ('disabled', 'active', 'expired')),
  previous_max_active integer,
  next_max_active integer NOT NULL CHECK (next_max_active BETWEEN 0 AND 1000),
  previous_policy_expires_at timestamptz,
  next_policy_expires_at timestamptz NOT NULL,
  previous_live_approved boolean,
  next_live_approved boolean NOT NULL,
  expected_revision integer NOT NULL CHECK (expected_revision >= 0),
  next_revision integer NOT NULL CHECK (next_revision = expected_revision + 1),
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code IN (
    'cohort_activation', 'cohort_change', 'cohort_expiration',
    'founder_disable', 'incident_stop'
  )),
  correlation_id text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL,
  CHECK (
    (previous_state = 'absent'
      AND previous_max_active IS NULL
      AND previous_policy_expires_at IS NULL
      AND previous_live_approved IS NULL
      AND expected_revision = 0)
    OR (previous_state <> 'absent'
      AND previous_max_active IS NOT NULL
      AND previous_policy_expires_at IS NOT NULL
      AND previous_live_approved IS NOT NULL
      AND expected_revision > 0)
  ),
  CHECK (environment = 'production' OR next_live_approved = false),
  CHECK (environment <> 'production' OR next_max_active <= 1),
  CHECK (
    next_state <> 'active'
    OR (next_max_active > 0 AND next_policy_expires_at > occurred_at)
  )
);

CREATE INDEX commerce_stripe_cohort_policy_events_v2_environment_idx
  ON commerce_stripe_cohort_policy_events_v2(environment, occurred_at DESC, id);

CREATE TRIGGER commerce_stripe_cohort_policy_events_v2_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_cohort_policy_events_v2
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

ALTER TABLE commerce_stripe_session_retry_repair_events
  DROP CONSTRAINT commerce_stripe_session_retry_repair_events_environment_check,
  ADD CONSTRAINT commerce_stripe_session_retry_repair_environment_check CHECK (
    environment IN ('test', 'production')
  );

ALTER TABLE commerce_stripe_reconciliation_repair_events
  DROP CONSTRAINT commerce_stripe_reconciliation_repair_events_environment_check,
  ADD CONSTRAINT commerce_stripe_reconciliation_repair_environment_check CHECK (
    environment IN ('test', 'production')
  );

ALTER TABLE commerce_stripe_preflight_records
  ADD COLUMN portal_payment_method_update_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN account_charges_enabled boolean,
  ADD COLUMN account_payouts_enabled boolean,
  ADD COLUMN account_country text,
  ADD COLUMN account_business_type text;

ALTER TABLE commerce_stripe_preflight_records
  ALTER COLUMN portal_payment_method_update_enabled DROP DEFAULT,
  ADD CONSTRAINT commerce_stripe_preflight_live_account_exact_check CHECK (
    environment <> 'production'
    OR (
      account_charges_enabled IS TRUE
      AND account_payouts_enabled IS TRUE
      AND account_country IS NOT DISTINCT FROM 'US'
      AND account_business_type IS NOT DISTINCT FROM 'company'
    )
  );
