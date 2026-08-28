-- Run 3.1 billing recovery evidence. Failed invoice attempts are append-only per
-- signed provider event while dunning remains bounded to one window per invoice.
-- Pending feedback or support migrations must use 0034 or later.

ALTER TABLE commerce_stripe_failed_invoice_evidence
  DROP CONSTRAINT commerce_stripe_failed_invoice_evidence_pkey,
  DROP CONSTRAINT commerce_stripe_failed_invoice_evidence_source_inbox_id_key;

DROP INDEX commerce_stripe_failed_invoice_payment_id_idx;

ALTER TABLE commerce_stripe_failed_invoice_evidence
  ADD PRIMARY KEY (source_inbox_id);

CREATE INDEX commerce_stripe_failed_invoice_attempt_idx
  ON commerce_stripe_failed_invoice_evidence(
    environment, provider_invoice_id, attempt_count, occurred_at, source_inbox_id
  );

CREATE INDEX commerce_stripe_failed_invoice_payment_id_idx
  ON commerce_stripe_failed_invoice_evidence(environment, provider_invoice_payment_id)
  WHERE provider_invoice_payment_id IS NOT NULL;

ALTER TABLE commerce_stripe_preflight_records
  ADD COLUMN portal_invoice_history_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE commerce_stripe_invoice_recovery_events (
  id text PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  source_inbox_id text NOT NULL UNIQUE
    REFERENCES commerce_event_inbox(id) ON DELETE RESTRICT,
  provider_invoice_id text NOT NULL,
  provider_subscription_id text,
  household_id text,
  subscription_id text,
  event_kind text NOT NULL CHECK (event_kind = 'finalization_failed'),
  recovery_state text NOT NULL CHECK (recovery_state IN ('attention','resolved')),
  provider_event_created_at timestamptz NOT NULL,
  evidence_digest text NOT NULL,
  observed_at timestamptz NOT NULL,
  CHECK (
    (household_id IS NULL AND subscription_id IS NULL)
    OR (household_id IS NOT NULL AND subscription_id IS NOT NULL)
  ),
  FOREIGN KEY (household_id, subscription_id)
    REFERENCES commerce_subscriptions(household_id, id) ON DELETE RESTRICT
);

CREATE INDEX commerce_stripe_invoice_recovery_household_idx
  ON commerce_stripe_invoice_recovery_events(
    environment, household_id, recovery_state, observed_at DESC, id
  );

CREATE TRIGGER commerce_stripe_invoice_recovery_events_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_invoice_recovery_events
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();
