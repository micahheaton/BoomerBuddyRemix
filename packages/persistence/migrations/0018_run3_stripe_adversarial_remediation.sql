-- Run 3 Stripe adversarial remediation. This migration is intentionally forward-only:
-- 0017 belongs to the Founder Provisioning lane.

ALTER TABLE commerce_checkout_intents
  ADD COLUMN legacy_short_material_expiry boolean NOT NULL DEFAULT false;

UPDATE commerce_checkout_intents
SET legacy_short_material_expiry = true
WHERE offer_id IS NOT NULL
  AND expires_at < created_at + interval '4 hours';

ALTER TABLE commerce_checkout_intents
  ADD CONSTRAINT commerce_checkout_material_expiry_check
    CHECK (
      (offer_id IS NULL AND legacy_short_material_expiry = false)
      OR (
        offer_id IS NOT NULL
        AND (
          legacy_short_material_expiry = true
          OR expires_at >= created_at + interval '4 hours'
        )
      )
    );

ALTER TABLE commerce_stripe_session_operations
  DROP CONSTRAINT commerce_stripe_session_operations_check2,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN next_retry_at timestamptz,
  ADD COLUMN provider_session_url text,
  ADD COLUMN actor_person_id text REFERENCES persons(id) ON DELETE RESTRICT,
  ADD COLUMN canonical_subscription_id text,
  ADD COLUMN provider_price_id text,
  ADD COLUMN provider_customer_id text,
  ADD COLUMN provider_configuration_id text,
  ADD COLUMN success_url text,
  ADD COLUMN cancel_url text,
  ADD COLUMN return_url text,
  ADD COLUMN terminal_at timestamptz,
  ADD COLUMN authorized_attempt_limit integer NOT NULL DEFAULT 6
    CHECK (authorized_attempt_limit BETWEEN 6 AND 7),
  ADD COLUMN manual_retry_revision integer NOT NULL DEFAULT 0
    CHECK (manual_retry_revision BETWEEN 0 AND 1),
  ADD CONSTRAINT commerce_stripe_operation_lease_check CHECK (
    (state = 'dispatching' AND lease_expires_at IS NOT NULL)
    OR (state <> 'dispatching' AND lease_expires_at IS NULL)
  ),
  ADD CONSTRAINT commerce_stripe_operation_retry_check CHECK (
    next_retry_at IS NULL OR state IN ('dispatching','outcome_unknown')
  ),
  ADD CONSTRAINT commerce_stripe_operation_session_truth_check CHECK (
    (state = 'succeeded' AND provider_session_id IS NOT NULL)
    OR state = 'failed_no_effect'
    OR (state IN ('prepared','dispatching','outcome_unknown') AND provider_session_id IS NULL)
  ),
  ADD CONSTRAINT commerce_stripe_operation_session_url_check CHECK (
    provider_session_url IS NULL OR provider_session_id IS NOT NULL
  ),
  ADD CONSTRAINT commerce_stripe_operation_attempt_budget_check CHECK (
    attempt_count <= authorized_attempt_limit
  );

CREATE TABLE commerce_stripe_session_operation_attempts (
  id text PRIMARY KEY,
  operation_id text NOT NULL REFERENCES commerce_stripe_session_operations(id) ON DELETE RESTRICT,
  attempt integer NOT NULL CHECK (attempt > 0),
  event_kind text NOT NULL CHECK (event_kind IN (
    'dispatch_started', 'outcome_unknown', 'lease_expired', 'succeeded', 'failed_no_effect'
  )),
  provider_idempotency_key text NOT NULL,
  provider_session_id text,
  error_code text,
  occurred_at timestamptz NOT NULL,
  UNIQUE (operation_id, attempt, event_kind)
);

CREATE INDEX commerce_stripe_operation_retry_idx
  ON commerce_stripe_session_operations(next_retry_at, id)
  WHERE state IN ('dispatching','outcome_unknown');

CREATE FUNCTION reject_stripe_checkout_expiry_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'Stripe Checkout original expiry is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION reject_stripe_checkout_legacy_marker_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.legacy_short_material_expiry THEN
    RAISE EXCEPTION 'Stripe Checkout legacy expiry marker is migration-owned';
  END IF;
  IF TG_OP = 'UPDATE'
    AND NEW.legacy_short_material_expiry IS DISTINCT FROM OLD.legacy_short_material_expiry THEN
    RAISE EXCEPTION 'Stripe Checkout legacy expiry marker is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER commerce_stripe_checkout_expiry_immutable
BEFORE UPDATE ON commerce_checkout_intents
FOR EACH ROW EXECUTE FUNCTION reject_stripe_checkout_expiry_mutation();

CREATE TRIGGER commerce_stripe_checkout_legacy_marker_immutable
BEFORE INSERT OR UPDATE ON commerce_checkout_intents
FOR EACH ROW EXECUTE FUNCTION reject_stripe_checkout_legacy_marker_mutation();

CREATE TRIGGER commerce_stripe_operation_attempts_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_session_operation_attempts
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

CREATE TABLE commerce_stripe_session_retry_repair_events (
  id text PRIMARY KEY,
  operation_id text NOT NULL
    REFERENCES commerce_stripe_session_operations(id) ON DELETE RESTRICT,
  checkout_intent_id text NOT NULL,
  household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  environment text NOT NULL CHECK (environment = 'test'),
  action text NOT NULL CHECK (action = 'checkout'),
  expected_revision integer NOT NULL CHECK (expected_revision = 0),
  next_revision integer NOT NULL CHECK (next_revision = 1),
  previous_attempt_limit integer NOT NULL CHECK (previous_attempt_limit = 6),
  next_attempt_limit integer NOT NULL CHECK (next_attempt_limit = 7),
  provider_idempotency_key text NOT NULL,
  provider_deadline timestamptz NOT NULL,
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code = 'founder_bounded_same_key_retry'),
  correlation_id text NOT NULL,
  repair_job_id text NOT NULL REFERENCES durable_jobs(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL,
  UNIQUE (operation_id),
  UNIQUE (correlation_id),
  FOREIGN KEY (household_id, checkout_intent_id)
    REFERENCES commerce_checkout_intents(household_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER commerce_stripe_session_retry_repair_events_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_session_retry_repair_events
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

ALTER TABLE commerce_stripe_preflight_records
  DROP CONSTRAINT IF EXISTS commerce_stripe_preflight_records_environment_evidence_digest_k,
  DROP CONSTRAINT IF EXISTS commerce_stripe_preflight_recor_environment_evidence_digest_key,
  DROP CONSTRAINT commerce_stripe_preflight_records_evidence_level_check,
  ADD COLUMN transport_kind text NOT NULL DEFAULT 'injected_fixture' CHECK (
    transport_kind IN ('injected_fixture','stripe_https')
  ),
  ADD COLUMN runtime_run_id text NOT NULL DEFAULT 'migration-backfill',
  ADD COLUMN authenticity_kind text NOT NULL DEFAULT 'fixture_assertion' CHECK (
    authenticity_kind IN ('fixture_assertion','provider_read')
  ),
  ADD COLUMN portal_mutation_controls_exact boolean NOT NULL DEFAULT false,
  ADD COLUMN portal_cancellation_mode text NOT NULL DEFAULT 'at_period_end'
    CHECK (portal_cancellation_mode = 'at_period_end'),
  ADD COLUMN portal_proration_behavior text NOT NULL DEFAULT 'none'
    CHECK (portal_proration_behavior = 'none'),
  ADD COLUMN portal_subscription_update_defaults_empty boolean NOT NULL DEFAULT false,
  ADD COLUMN retention_coupon_evidence text NOT NULL DEFAULT 'manual_founder_browser_required'
    CHECK (retention_coupon_evidence = 'manual_founder_browser_required'),
  ADD CONSTRAINT commerce_stripe_preflight_evidence_tier_check CHECK (
    evidence_level IN ('local_fixture','stripe_test','deployed_staging','live_production')
  ),
  ADD CONSTRAINT commerce_stripe_preflight_authenticity_check CHECK (
    (evidence_level = 'local_fixture' AND transport_kind = 'injected_fixture'
      AND authenticity_kind = 'fixture_assertion')
    OR (evidence_level <> 'local_fixture' AND transport_kind = 'stripe_https'
      AND authenticity_kind = 'provider_read')
  );

ALTER TABLE commerce_stripe_preflight_records
  ALTER COLUMN transport_kind DROP DEFAULT,
  ALTER COLUMN runtime_run_id DROP DEFAULT,
  ALTER COLUMN authenticity_kind DROP DEFAULT,
  ALTER COLUMN portal_mutation_controls_exact DROP DEFAULT,
  ALTER COLUMN retention_coupon_evidence DROP DEFAULT;

CREATE INDEX commerce_stripe_preflight_observation_idx
  ON commerce_stripe_preflight_records(environment, evidence_digest, checked_at DESC, id);

ALTER TABLE commerce_event_inbox
  ADD COLUMN evidence_tier text CHECK (
    evidence_tier IS NULL OR evidence_tier IN (
      'local_fixture','stripe_test','deployed_staging','live_production'
    )
  ),
  ADD COLUMN transport_kind text CHECK (
    transport_kind IS NULL OR transport_kind IN ('injected_fixture','stripe_https')
  ),
  ADD COLUMN transport_livemode boolean,
  ADD COLUMN runtime_run_id text,
  ADD COLUMN signature_verified_at timestamptz,
  ADD CONSTRAINT commerce_stripe_event_provenance_check CHECK (
    provider <> 'stripe'
    OR (
      evidence_tier IS NULL AND transport_kind IS NULL
      AND transport_livemode IS NULL AND runtime_run_id IS NULL
    )
    OR (
      evidence_tier IS NOT NULL AND transport_kind IS NOT NULL
      AND transport_livemode IS NOT NULL AND runtime_run_id IS NOT NULL
      AND length(runtime_run_id) > 0
      AND transport_livemode = (environment = 'production')
      AND (
        (evidence_tier = 'local_fixture' AND transport_kind = 'injected_fixture')
        OR (evidence_tier <> 'local_fixture' AND transport_kind = 'stripe_https')
      )
    )
  );

ALTER TABLE commerce_stripe_eligible_households
  ADD COLUMN environment text NOT NULL DEFAULT 'test' CHECK (environment IN ('test','production')),
  ADD COLUMN benefit_key text NOT NULL DEFAULT 'family_v1_monthly_1499'
    CHECK (benefit_key = 'family_v1_monthly_1499'),
  ADD COLUMN eligibility_expires_at timestamptz NOT NULL DEFAULT '2026-09-15T00:00:00.000Z',
  DROP CONSTRAINT commerce_stripe_eligible_households_pkey,
  ADD PRIMARY KEY (environment, household_id),
  ADD CONSTRAINT commerce_stripe_eligibility_window_check
    CHECK (eligibility_expires_at > invited_at);

ALTER TABLE commerce_stripe_eligible_households
  ALTER COLUMN environment DROP DEFAULT,
  ALTER COLUMN benefit_key DROP DEFAULT,
  ALTER COLUMN eligibility_expires_at DROP DEFAULT;

ALTER TABLE commerce_stripe_eligibility_events
  ADD COLUMN environment text NOT NULL DEFAULT 'test' CHECK (environment IN ('test','production')),
  ADD COLUMN benefit_key text NOT NULL DEFAULT 'family_v1_monthly_1499'
    CHECK (benefit_key = 'family_v1_monthly_1499'),
  ADD COLUMN eligibility_expires_at timestamptz NOT NULL DEFAULT '2026-09-15T00:00:00.000Z';

ALTER TABLE commerce_stripe_eligibility_events
  ALTER COLUMN environment DROP DEFAULT,
  ALTER COLUMN benefit_key DROP DEFAULT,
  ALTER COLUMN eligibility_expires_at DROP DEFAULT;

CREATE TABLE commerce_stripe_cohort_policies (
  environment text PRIMARY KEY CHECK (environment IN ('test','production')),
  cohort_key text NOT NULL CHECK (cohort_key = 'founding_household_v1'),
  benefit_key text NOT NULL CHECK (benefit_key = 'family_v1_monthly_1499'),
  state text NOT NULL CHECK (state IN ('disabled','active','expired')),
  max_active integer NOT NULL CHECK (max_active >= 0 AND max_active <= 1000),
  policy_expires_at timestamptz NOT NULL,
  live_approved boolean NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  changed_by_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL,
  CHECK (environment = 'production' OR live_approved = false),
  CHECK (environment <> 'production' OR state <> 'active' OR live_approved = true)
);

CREATE TABLE commerce_stripe_cohort_policy_events (
  id text PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  previous_live_approved boolean NOT NULL,
  next_live_approved boolean NOT NULL,
  revision integer NOT NULL CHECK (revision > 1),
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE TRIGGER commerce_stripe_cohort_policy_events_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_cohort_policy_events
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

CREATE TABLE commerce_stripe_invoice_authority_facts (
  provider_invoice_id text PRIMARY KEY
    REFERENCES commerce_stripe_paid_invoice_evidence(provider_invoice_id) ON DELETE RESTRICT,
  provider_invoice_line_id text NOT NULL,
  provider_subscription_item_id text NOT NULL,
  provider_product_id text NOT NULL,
  provider_price_id text NOT NULL,
  invoice_discounts_empty boolean NOT NULL CHECK (invoice_discounts_empty = true),
  invoice_taxes_empty boolean NOT NULL CHECK (invoice_taxes_empty = true),
  invoice_credits_empty boolean NOT NULL CHECK (invoice_credits_empty = true),
  subscription_page_complete boolean NOT NULL CHECK (subscription_page_complete = true),
  recorded_at timestamptz NOT NULL
);

ALTER TABLE commerce_stripe_paid_invoice_evidence
  ADD COLUMN provider_invoice_payment_id text;

CREATE UNIQUE INDEX commerce_stripe_paid_invoice_payment_id_idx
  ON commerce_stripe_paid_invoice_evidence(environment, provider_invoice_payment_id)
  WHERE provider_invoice_payment_id IS NOT NULL;

CREATE TRIGGER commerce_stripe_invoice_authority_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_invoice_authority_facts
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

ALTER TABLE commerce_stripe_failed_invoice_evidence
  ADD COLUMN provider_invoice_payment_id text,
  ADD COLUMN provider_invoice_line_id text,
  ADD COLUMN provider_product_id text,
  ADD COLUMN provider_price_id text,
  ADD COLUMN line_proration boolean,
  ADD COLUMN period_starts_at timestamptz,
  ADD COLUMN period_ends_at timestamptz,
  ADD CONSTRAINT commerce_stripe_failed_period_check CHECK (
    period_starts_at IS NULL OR (period_ends_at > period_starts_at AND line_proration = false)
  );

CREATE UNIQUE INDEX commerce_stripe_failed_invoice_payment_id_idx
  ON commerce_stripe_failed_invoice_evidence(environment, provider_invoice_payment_id)
  WHERE provider_invoice_payment_id IS NOT NULL;

CREATE TABLE commerce_stripe_dunning_events (
  id text PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  subscription_id text NOT NULL,
  provider_invoice_id text NOT NULL,
  dunning_window_key text NOT NULL,
  event_kind text NOT NULL CHECK (event_kind IN ('opened','recovered','expired')),
  paid_through_at timestamptz NOT NULL,
  grace_starts_at timestamptz NOT NULL,
  grace_ends_at timestamptz NOT NULL,
  source_inbox_id text NOT NULL REFERENCES commerce_event_inbox(id) ON DELETE RESTRICT,
  evidence_digest text NOT NULL,
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (household_id, subscription_id)
    REFERENCES commerce_subscriptions(household_id, id) ON DELETE RESTRICT,
  UNIQUE (source_inbox_id, event_kind),
  UNIQUE (dunning_window_key, event_kind),
  CHECK (grace_starts_at = paid_through_at),
  CHECK (grace_ends_at = grace_starts_at + interval '3 days')
);

CREATE TRIGGER commerce_stripe_dunning_events_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_dunning_events
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

CREATE TABLE commerce_stripe_financial_restriction_events (
  id text PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  subscription_id text NOT NULL,
  provider_subscription_id text NOT NULL,
  restriction_kind text NOT NULL CHECK (restriction_kind IN ('refund','dispute')),
  provider_restriction_id text NOT NULL,
  provider_charge_id text NOT NULL,
  provider_payment_intent_id text NOT NULL,
  provider_invoice_id text NOT NULL,
  provider_charge_amount integer,
  restriction_amount integer,
  currency text,
  event_state text NOT NULL CHECK (event_state IN ('opened','cleared','retained')),
  resolution text CHECK (resolution IS NULL OR resolution IN (
    'provider_dispute_won','provider_dispute_prevented','provider_dispute_warning_closed',
    'provider_dispute_lost','refund_failed','refund_canceled'
  )),
  source_inbox_id text NOT NULL REFERENCES commerce_event_inbox(id) ON DELETE RESTRICT,
  evidence_digest text NOT NULL,
  observed_at timestamptz NOT NULL,
  FOREIGN KEY (household_id, subscription_id)
    REFERENCES commerce_subscriptions(household_id, id) ON DELETE RESTRICT,
  UNIQUE (source_inbox_id, provider_restriction_id),
  CHECK ((event_state = 'opened') = (resolution IS NULL)),
  CHECK (
    provider_charge_amount = 1499
    AND restriction_amount BETWEEN 1 AND provider_charge_amount
    AND currency = 'usd'
  )
);

CREATE INDEX commerce_stripe_unresolved_restriction_idx
  ON commerce_stripe_financial_restriction_events(
    environment, household_id, subscription_id, restriction_kind, provider_restriction_id,
    observed_at DESC, id DESC
  );

CREATE TRIGGER commerce_stripe_financial_restriction_events_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_financial_restriction_events
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

ALTER TABLE commerce_stripe_inventory_reconciliation_runs
  ADD COLUMN account_id text,
  ADD COLUMN api_version text,
  ADD COLUMN evidence_tier text CHECK (
    evidence_tier IS NULL OR evidence_tier IN (
      'local_fixture','stripe_test','deployed_staging','live_production'
    )
  ),
  ADD COLUMN transport_kind text CHECK (
    transport_kind IS NULL OR transport_kind IN ('injected_fixture','stripe_https')
  ),
  ADD COLUMN runtime_run_id text,
  ADD COLUMN operation_key text,
  ADD COLUMN verified_account_id text,
  ADD COLUMN account_verified_at timestamptz,
  ADD COLUMN failure_code text,
  ADD CONSTRAINT commerce_stripe_inventory_provenance_check CHECK (
    (
      account_id IS NULL AND api_version IS NULL AND evidence_tier IS NULL
      AND transport_kind IS NULL AND runtime_run_id IS NULL
    )
    OR (
      account_id IS NOT NULL AND api_version IS NOT NULL AND evidence_tier IS NOT NULL
      AND transport_kind IS NOT NULL AND runtime_run_id IS NOT NULL
      AND operation_key IS NOT NULL AND length(operation_key) > 0
      AND length(account_id) > 0 AND length(api_version) > 0 AND length(runtime_run_id) > 0
      AND (
        (evidence_tier = 'local_fixture' AND transport_kind = 'injected_fixture')
        OR (evidence_tier <> 'local_fixture' AND transport_kind = 'stripe_https')
      )
    )
  );

CREATE UNIQUE INDEX commerce_stripe_inventory_operation_idx
  ON commerce_stripe_inventory_reconciliation_runs(environment, operation_key)
  WHERE operation_key IS NOT NULL;

CREATE TABLE commerce_stripe_inventory_run_attempts (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES commerce_stripe_inventory_reconciliation_runs(id) ON DELETE RESTRICT,
  runtime_run_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  attempted_at timestamptz NOT NULL,
  UNIQUE (run_id, attempt)
);

CREATE TRIGGER commerce_stripe_inventory_run_attempts_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_inventory_run_attempts
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

CREATE TABLE commerce_stripe_inventory_page_receipts (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES commerce_stripe_inventory_reconciliation_runs(id) ON DELETE RESTRICT,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  account_id text NOT NULL,
  page_number integer NOT NULL CHECK (page_number > 0),
  request_cursor text,
  next_cursor text,
  has_more boolean NOT NULL,
  subscription_count integer NOT NULL CHECK (subscription_count BETWEEN 0 AND 100),
  evidence_digest text NOT NULL,
  observed_at timestamptz NOT NULL,
  UNIQUE (run_id, page_number),
  UNIQUE (run_id, request_cursor)
);

CREATE TRIGGER commerce_stripe_inventory_page_receipts_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_inventory_page_receipts
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

ALTER TABLE commerce_reconciliation_runs
  ADD COLUMN failure_code text,
  ADD COLUMN last_attempted_at timestamptz,
  ADD COLUMN repair_generation integer NOT NULL DEFAULT 0 CHECK (repair_generation >= 0),
  ADD COLUMN automatic_attempt_count integer NOT NULL DEFAULT 0
    CHECK (automatic_attempt_count BETWEEN 0 AND 16),
  ADD COLUMN authorized_attempt_limit integer NOT NULL DEFAULT 12
    CHECK (authorized_attempt_limit BETWEEN 12 AND 16),
  ADD COLUMN manual_repair_revision integer NOT NULL DEFAULT 0
    CHECK (manual_repair_revision BETWEEN 0 AND 1),
  ADD CONSTRAINT commerce_reconciliation_runs_authorized_attempts_check
    CHECK (automatic_attempt_count <= authorized_attempt_limit);

CREATE TABLE commerce_stripe_reconciliation_repair_events (
  id text PRIMARY KEY,
  reconciliation_run_id text NOT NULL
    REFERENCES commerce_reconciliation_runs(id) ON DELETE RESTRICT,
  trigger_event_id text NOT NULL REFERENCES commerce_event_inbox(id) ON DELETE RESTRICT,
  environment text NOT NULL CHECK (environment = 'test'),
  expected_revision integer NOT NULL CHECK (expected_revision = 0),
  next_revision integer NOT NULL CHECK (next_revision = 1),
  previous_attempt_limit integer NOT NULL CHECK (previous_attempt_limit = 12),
  next_attempt_limit integer NOT NULL CHECK (next_attempt_limit = 16),
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code = 'founder_bounded_provider_repair'),
  correlation_id text NOT NULL,
  repair_job_id text NOT NULL REFERENCES durable_jobs(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL,
  UNIQUE (reconciliation_run_id),
  UNIQUE (correlation_id)
);

CREATE TRIGGER commerce_stripe_reconciliation_repair_events_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_reconciliation_repair_events
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

CREATE TABLE commerce_stripe_checkout_dependency_wakes (
  id text PRIMARY KEY,
  reconciliation_run_id text NOT NULL
    REFERENCES commerce_reconciliation_runs(id) ON DELETE RESTRICT,
  trigger_event_id text NOT NULL REFERENCES commerce_event_inbox(id) ON DELETE RESTRICT,
  provider_session_id text NOT NULL
    REFERENCES commerce_stripe_checkout_completions(provider_session_id) ON DELETE RESTRICT,
  wake_job_id text NOT NULL REFERENCES durable_jobs(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL,
  UNIQUE (reconciliation_run_id),
  UNIQUE (wake_job_id)
);

CREATE TRIGGER commerce_stripe_checkout_dependency_wakes_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_checkout_dependency_wakes
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();
