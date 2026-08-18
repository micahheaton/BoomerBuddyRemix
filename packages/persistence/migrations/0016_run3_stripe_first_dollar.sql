CREATE TABLE commerce_stripe_offer_contracts (
  offer_id text PRIMARY KEY CHECK (offer_id = 'founding_family_monthly_v1'),
  plan_version_id text NOT NULL CHECK (plan_version_id = 'family_v1'),
  billing_interval text NOT NULL CHECK (billing_interval = 'month'),
  currency text NOT NULL CHECK (currency = 'usd'),
  unit_amount_minor integer NOT NULL CHECK (unit_amount_minor = 1499),
  quantity integer NOT NULL CHECK (quantity = 1),
  promotions_enabled boolean NOT NULL CHECK (promotions_enabled = false),
  automatic_tax_enabled boolean NOT NULL CHECK (automatic_tax_enabled = false),
  adaptive_pricing_enabled boolean NOT NULL CHECK (adaptive_pricing_enabled = false),
  created_at timestamptz NOT NULL
);

INSERT INTO commerce_stripe_offer_contracts(
  offer_id, plan_version_id, billing_interval, currency, unit_amount_minor, quantity,
  promotions_enabled, automatic_tax_enabled, adaptive_pricing_enabled, created_at
) VALUES (
  'founding_family_monthly_v1', 'family_v1', 'month', 'usd', 1499, 1,
  false, false, false, '2026-08-16T00:00:00.000Z'
);

ALTER TABLE commerce_checkout_intents
  DROP CONSTRAINT commerce_checkout_intents_environment_check,
  ADD CONSTRAINT commerce_checkout_intents_environment_check
    CHECK (environment IN ('test', 'production'));

ALTER TABLE commerce_provider_customers
  DROP CONSTRAINT commerce_provider_customers_environment_check,
  ADD CONSTRAINT commerce_provider_customers_environment_check
    CHECK (environment IN ('test', 'production'));

ALTER TABLE commerce_checkout_intents
  ADD COLUMN offer_id text REFERENCES commerce_stripe_offer_contracts(offer_id) ON DELETE RESTRICT,
  ADD COLUMN server_operation_id text,
  ADD COLUMN provider_idempotency_key text,
  ADD COLUMN provider_requested_expires_at timestamptz,
  ADD COLUMN provider_returned_expires_at timestamptz,
  ADD COLUMN dispatch_state text CHECK (dispatch_state IS NULL OR dispatch_state IN (
    'not_dispatched', 'dispatching', 'outcome_unknown', 'session_recorded', 'failed_no_effect'
  )),
  ADD COLUMN dispatch_started_at timestamptz,
  ADD COLUMN dispatch_uncertain_at timestamptz;

CREATE UNIQUE INDEX commerce_checkout_provider_operation_idx
  ON commerce_checkout_intents(provider, environment, provider_idempotency_key)
  WHERE provider_idempotency_key IS NOT NULL;

CREATE TABLE commerce_stripe_initiation_controls (
  environment text PRIMARY KEY CHECK (environment IN ('test', 'production')),
  state text NOT NULL CHECK (state IN ('disabled', 'enabled')),
  revision integer NOT NULL CHECK (revision > 0),
  changed_by_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code IN (
    'founder_test_activation', 'founder_live_activation', 'founder_disable',
    'incident_stop', 'configuration_change'
  )),
  changed_at timestamptz NOT NULL,
  CHECK (environment <> 'production' OR state = 'disabled')
);

CREATE TABLE commerce_stripe_initiation_control_events (
  id text PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('test', 'production')),
  previous_state text NOT NULL CHECK (previous_state IN ('absent', 'disabled', 'enabled')),
  next_state text NOT NULL CHECK (next_state IN ('disabled', 'enabled')),
  revision integer NOT NULL CHECK (revision > 0),
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  reason_code text NOT NULL,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX commerce_stripe_control_events_environment_idx
  ON commerce_stripe_initiation_control_events(environment, occurred_at DESC, id);

CREATE TABLE commerce_stripe_eligible_households (
  household_id text PRIMARY KEY REFERENCES households(id) ON DELETE RESTRICT,
  cohort_key text NOT NULL CHECK (cohort_key = 'founding_household_v1'),
  state text NOT NULL CHECK (state IN ('eligible', 'revoked')),
  invited_by_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  invited_at timestamptz NOT NULL,
  changed_at timestamptz NOT NULL,
  correlation_id text NOT NULL
);

CREATE TABLE commerce_stripe_eligibility_events (
  id text PRIMARY KEY,
  household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  cohort_key text NOT NULL CHECK (cohort_key = 'founding_household_v1'),
  previous_state text NOT NULL CHECK (previous_state IN ('absent', 'eligible', 'revoked')),
  next_state text NOT NULL CHECK (next_state IN ('eligible', 'revoked')),
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE TABLE commerce_stripe_preflight_records (
  id text PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('test', 'production')),
  account_id text NOT NULL,
  livemode boolean NOT NULL,
  api_version text NOT NULL CHECK (api_version = '2026-02-25.clover'),
  offer_id text NOT NULL REFERENCES commerce_stripe_offer_contracts(offer_id) ON DELETE RESTRICT,
  provider_product_id text NOT NULL,
  provider_price_id text NOT NULL,
  portal_configuration_id text NOT NULL,
  currency text NOT NULL CHECK (currency = 'usd'),
  unit_amount_minor integer NOT NULL CHECK (unit_amount_minor = 1499),
  quantity integer NOT NULL CHECK (quantity = 1),
  product_active boolean NOT NULL,
  price_active boolean NOT NULL,
  recurring_interval text NOT NULL CHECK (recurring_interval = 'month'),
  portal_cancel_only boolean NOT NULL,
  promotions_enabled boolean NOT NULL CHECK (promotions_enabled = false),
  automatic_tax_enabled boolean NOT NULL CHECK (automatic_tax_enabled = false),
  adaptive_pricing_enabled boolean NOT NULL CHECK (adaptive_pricing_enabled = false),
  evidence_level text NOT NULL CHECK (evidence_level IN ('local_fixture', 'stripe_test', 'live')),
  evidence_digest text NOT NULL,
  checked_at timestamptz NOT NULL,
  UNIQUE (environment, evidence_digest)
);

CREATE TABLE commerce_stripe_session_operations (
  id text PRIMARY KEY,
  household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  checkout_intent_id text,
  action text NOT NULL CHECK (action IN ('checkout', 'portal')),
  environment text NOT NULL CHECK (environment IN ('test', 'production')),
  server_operation_id text NOT NULL,
  provider_idempotency_key text NOT NULL,
  state text NOT NULL CHECK (state IN (
    'prepared', 'dispatching', 'outcome_unknown', 'succeeded', 'failed_no_effect'
  )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  provider_session_id text,
  requested_expires_at timestamptz,
  returned_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (household_id, checkout_intent_id)
    REFERENCES commerce_checkout_intents(household_id, id) ON DELETE RESTRICT,
  UNIQUE (environment, action, household_id, server_operation_id),
  UNIQUE (environment, provider_idempotency_key),
  UNIQUE (environment, action, provider_session_id),
  CHECK (returned_expires_at IS NULL OR requested_expires_at IS NOT NULL),
  CHECK (returned_expires_at IS NULL OR returned_expires_at <= requested_expires_at),
  CHECK ((state = 'succeeded') = (provider_session_id IS NOT NULL))
);

CREATE TABLE commerce_stripe_checkout_completions (
  provider_session_id text PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('test', 'production')),
  household_id text NOT NULL,
  checkout_intent_id text NOT NULL,
  subscription_id text NOT NULL,
  provider_subscription_id text NOT NULL,
  provider_customer_id text NOT NULL,
  provider_payment_intent_id text,
  source_inbox_id text NOT NULL REFERENCES commerce_event_inbox(id) ON DELETE RESTRICT,
  provider_event_id text NOT NULL,
  payment_status text NOT NULL CHECK (payment_status = 'paid'),
  session_status text NOT NULL CHECK (session_status = 'complete'),
  amount_total integer NOT NULL CHECK (amount_total = 1499),
  currency text NOT NULL CHECK (currency = 'usd'),
  completed_at timestamptz NOT NULL,
  provider_expires_at timestamptz NOT NULL,
  FOREIGN KEY (household_id, checkout_intent_id)
    REFERENCES commerce_checkout_intents(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, subscription_id)
    REFERENCES commerce_subscriptions(household_id, id) ON DELETE RESTRICT,
  UNIQUE (source_inbox_id),
  UNIQUE (environment, provider_subscription_id),
  UNIQUE (environment, provider_payment_intent_id),
  CHECK (completed_at <= provider_expires_at)
);

CREATE TABLE commerce_stripe_paid_invoice_evidence (
  provider_invoice_id text PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('test', 'production')),
  household_id text NOT NULL,
  subscription_id text NOT NULL,
  checkout_intent_id text NOT NULL,
  provider_subscription_id text NOT NULL,
  provider_subscription_item_id text NOT NULL,
  provider_payment_intent_id text NOT NULL,
  source_inbox_id text NOT NULL REFERENCES commerce_event_inbox(id) ON DELETE RESTRICT,
  billing_reason text NOT NULL CHECK (billing_reason IN ('subscription_create', 'subscription_cycle')),
  amount_paid integer NOT NULL CHECK (amount_paid = 1499),
  amount_remaining integer NOT NULL CHECK (amount_remaining = 0),
  currency text NOT NULL CHECK (currency = 'usd'),
  quantity integer NOT NULL CHECK (quantity = 1),
  discount_amount integer NOT NULL CHECK (discount_amount = 0),
  tax_amount integer NOT NULL CHECK (tax_amount = 0),
  period_starts_at timestamptz NOT NULL,
  period_ends_at timestamptz NOT NULL,
  provider_paid_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  evidence_digest text NOT NULL,
  FOREIGN KEY (household_id, checkout_intent_id)
    REFERENCES commerce_checkout_intents(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, subscription_id)
    REFERENCES commerce_subscriptions(household_id, id) ON DELETE RESTRICT,
  UNIQUE (environment, provider_payment_intent_id),
  UNIQUE (source_inbox_id),
  CHECK (period_ends_at > period_starts_at)
);

CREATE TABLE commerce_stripe_failed_invoice_evidence (
  provider_invoice_id text PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('test', 'production')),
  household_id text NOT NULL,
  subscription_id text NOT NULL,
  provider_subscription_id text NOT NULL,
  provider_subscription_item_id text NOT NULL,
  source_inbox_id text NOT NULL REFERENCES commerce_event_inbox(id) ON DELETE RESTRICT,
  provider_payment_intent_id text,
  billing_reason text NOT NULL CHECK (billing_reason IN ('subscription_create', 'subscription_cycle')),
  amount_due integer NOT NULL CHECK (amount_due = 1499),
  currency text NOT NULL CHECK (currency = 'usd'),
  quantity integer NOT NULL CHECK (quantity = 1),
  attempt_count integer NOT NULL CHECK (attempt_count > 0),
  failure_status text NOT NULL CHECK (failure_status IN (
    'requires_payment_method', 'requires_action', 'canceled', 'failed'
  )),
  occurred_at timestamptz NOT NULL,
  evidence_digest text NOT NULL,
  FOREIGN KEY (household_id, subscription_id)
    REFERENCES commerce_subscriptions(household_id, id) ON DELETE RESTRICT,
  UNIQUE (source_inbox_id)
);

CREATE TABLE commerce_stripe_financial_restriction_resolutions (
  id text PRIMARY KEY,
  provider_record_id text NOT NULL REFERENCES commerce_provider_subscription_records(id) ON DELETE RESTRICT,
  household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  subscription_id text NOT NULL,
  restriction text NOT NULL CHECK (restriction IN ('refunded', 'disputed')),
  resolution text NOT NULL CHECK (resolution IN (
    'provider_dispute_won', 'provider_dispute_lost', 'refund_failed', 'manual_retain'
  )),
  source_inbox_id text NOT NULL REFERENCES commerce_event_inbox(id) ON DELETE RESTRICT,
  actor_person_id text REFERENCES persons(id) ON DELETE RESTRICT,
  evidence_digest text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('cleared', 'retained')),
  observed_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  UNIQUE (provider_record_id, source_inbox_id)
);

CREATE TABLE commerce_stripe_inventory_reconciliation_runs (
  id text PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('test', 'production')),
  state text NOT NULL CHECK (state IN ('running', 'completed', 'attention')),
  provider_count integer NOT NULL DEFAULT 0 CHECK (provider_count >= 0),
  canonical_count integer NOT NULL DEFAULT 0 CHECK (canonical_count >= 0),
  mismatch_count integer NOT NULL DEFAULT 0 CHECK (mismatch_count >= 0),
  cursor_complete boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE TABLE commerce_stripe_inventory_mismatches (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES commerce_stripe_inventory_reconciliation_runs(id) ON DELETE RESTRICT,
  mismatch_kind text NOT NULL CHECK (mismatch_kind IN (
    'provider_only', 'canonical_only', 'state_mismatch', 'pagination_incomplete'
  )),
  provider_subscription_id text,
  evidence_digest text NOT NULL,
  observed_at timestamptz NOT NULL
);

CREATE FUNCTION reject_stripe_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Stripe control and evidence history is append-only';
END;
$$;

CREATE TRIGGER commerce_stripe_control_events_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_initiation_control_events
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

CREATE TRIGGER commerce_stripe_offer_contracts_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_offer_contracts
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

CREATE TRIGGER commerce_stripe_eligibility_events_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_eligibility_events
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

CREATE TRIGGER commerce_stripe_preflight_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_preflight_records
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

CREATE TRIGGER commerce_stripe_checkout_completion_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_checkout_completions
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

CREATE TRIGGER commerce_stripe_paid_invoice_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_paid_invoice_evidence
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

CREATE TRIGGER commerce_stripe_failed_invoice_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_failed_invoice_evidence
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

CREATE TRIGGER commerce_stripe_restriction_resolution_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_financial_restriction_resolutions
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();
