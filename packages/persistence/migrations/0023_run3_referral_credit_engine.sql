-- Run 3 referral-credit core. This migration deliberately creates no program row,
-- no active state, no provider-application entry kind, and no execution handler.

CREATE TABLE run3_referral_program_identity_mutexes (
  program_key text PRIMARY KEY CHECK (program_key ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  created_at timestamptz NOT NULL
);

CREATE TABLE run3_referral_program_versions (
  program_key text NOT NULL CHECK (program_key ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  program_version integer NOT NULL CHECK (program_version > 0),
  lifecycle_state text NOT NULL CHECK (lifecycle_state IN (
    'draft', 'review_required', 'approved_disabled', 'stopped', 'expired'
  )),
  variant text NOT NULL CHECK (variant IN (
    'one_then_three_total', 'one_plus_three_incremental', 'paid_only_three_total',
    'bounded_founding_benefit', 'share_only_no_credit'
  )),
  attribution_rule text NOT NULL CHECK (attribution_rule = 'first_identity_bound_touch'),
  effective_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > effective_at),
  qualification_milestone text NOT NULL CHECK (qualification_milestone IN (
    'qualified_account', 'trusted_circle_acceptance', 'orientation_ready', 'none'
  )),
  qualified_credit_minor integer NOT NULL CHECK (qualified_credit_minor >= 0),
  paid_credit_total_minor integer NOT NULL CHECK (
    paid_credit_total_minor >= qualified_credit_minor
  ),
  currency text NOT NULL CHECK (currency = 'USD'),
  eligible_offer_key text NOT NULL CHECK (
    eligible_offer_key ~ '^[a-z][a-z0-9_.-]{2,79}$'
  ),
  maximum_participants integer NOT NULL CHECK (maximum_participants BETWEEN 1 AND 10000),
  maximum_referrals_per_referrer integer NOT NULL CHECK (
    maximum_referrals_per_referrer BETWEEN 1 AND 100
    AND maximum_referrals_per_referrer <= maximum_participants
  ),
  maximum_credit_per_referral_minor integer NOT NULL CHECK (
    maximum_credit_per_referral_minor > 0
    AND maximum_credit_per_referral_minor >= paid_credit_total_minor
  ),
  maximum_credit_per_referrer_minor integer NOT NULL CHECK (
    maximum_credit_per_referrer_minor >= maximum_credit_per_referral_minor
  ),
  maximum_credit_per_household_minor integer NOT NULL CHECK (
    maximum_credit_per_household_minor >= maximum_credit_per_referral_minor
  ),
  maximum_program_liability_minor integer NOT NULL CHECK (
    maximum_program_liability_minor >= maximum_credit_per_household_minor
  ),
  attribution_ttl_seconds integer NOT NULL CHECK (
    attribution_ttl_seconds BETWEEN 60 AND 2592000
  ),
  settlement_hold_seconds integer NOT NULL CHECK (
    settlement_hold_seconds BETWEEN 0 AND 15552000
  ),
  credit_expiry_seconds integer NOT NULL CHECK (
    credit_expiry_seconds BETWEEN 3600 AND 63072000
  ),
  terms_version text NOT NULL CHECK (
    terms_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$'
  ),
  privacy_version text NOT NULL CHECK (
    privacy_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$'
  ),
  definition_digest text NOT NULL CHECK (definition_digest ~ '^[A-Za-z0-9_-]{43}$'),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  program_execution_enabled boolean NOT NULL CHECK (program_execution_enabled = false),
  provider_execution_enabled boolean NOT NULL CHECK (provider_execution_enabled = false),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (program_key, program_version),
  UNIQUE (definition_digest),
  CHECK (
    (variant = 'share_only_no_credit' AND qualification_milestone = 'none'
      AND qualified_credit_minor = 0 AND paid_credit_total_minor = 0)
    OR (variant = 'paid_only_three_total' AND qualification_milestone = 'none'
      AND qualified_credit_minor = 0 AND paid_credit_total_minor > 0)
    OR (variant = 'bounded_founding_benefit'
      AND paid_credit_total_minor = qualified_credit_minor)
    OR (variant IN ('one_then_three_total', 'one_plus_three_incremental')
      AND qualification_milestone <> 'none' AND qualified_credit_minor > 0
      AND paid_credit_total_minor > qualified_credit_minor)
  )
);

CREATE TABLE run3_referral_attributions (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 128),
  program_key text NOT NULL,
  program_version integer NOT NULL,
  token_hmac text NOT NULL UNIQUE CHECK (token_hmac ~ '^[A-Za-z0-9_-]{43}$'),
  token_key_version integer NOT NULL CHECK (token_key_version > 0),
  referrer_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  referrer_household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  referrer_payment_identity_hmac text CHECK (
    referrer_payment_identity_hmac IS NULL
    OR referrer_payment_identity_hmac ~ '^[A-Za-z0-9_-]{43}$'
  ),
  operation_key text NOT NULL UNIQUE CHECK (
    operation_key ~ '^referral:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  request_digest text NOT NULL CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > issued_at),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  program_active boolean NOT NULL CHECK (program_active = false),
  message_sent boolean NOT NULL CHECK (message_sent = false),
  external_action_executed boolean NOT NULL CHECK (external_action_executed = false),
  FOREIGN KEY (program_key, program_version)
    REFERENCES run3_referral_program_versions(program_key, program_version) ON DELETE RESTRICT
);

CREATE TABLE run3_referral_attribution_events (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 128),
  attribution_id text NOT NULL REFERENCES run3_referral_attributions(id) ON DELETE RESTRICT,
  program_key text NOT NULL,
  program_version integer NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  event_kind text NOT NULL CHECK (event_kind IN (
    'share_created', 'invitation_opened', 'identity_bound',
    'stopped', 'expired'
  )),
  recipient_person_id text REFERENCES persons(id) ON DELETE RESTRICT,
  recipient_household_id text REFERENCES households(id) ON DELETE RESTRICT,
  recipient_payment_identity_hmac text CHECK (
    recipient_payment_identity_hmac IS NULL
    OR recipient_payment_identity_hmac ~ '^[A-Za-z0-9_-]{43}$'
  ),
  terms_version text CHECK (
    terms_version IS NULL OR terms_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$'
  ),
  privacy_version text CHECK (
    privacy_version IS NULL OR privacy_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$'
  ),
  operation_key text NOT NULL UNIQUE CHECK (
    operation_key ~ '^referral:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  evidence_reference text NOT NULL CHECK (
    evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{2,127}$'
  ),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[A-Za-z0-9_-]{43}$'),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  occurred_at timestamptz NOT NULL,
  UNIQUE (attribution_id, sequence),
  UNIQUE (attribution_id, event_kind),
  FOREIGN KEY (program_key, program_version)
    REFERENCES run3_referral_program_versions(program_key, program_version) ON DELETE RESTRICT,
  CHECK (
    (event_kind = 'identity_bound' AND recipient_person_id IS NOT NULL
      AND recipient_household_id IS NOT NULL AND terms_version IS NOT NULL
      AND privacy_version IS NOT NULL)
    OR (event_kind <> 'identity_bound' AND recipient_person_id IS NULL
      AND recipient_household_id IS NULL AND recipient_payment_identity_hmac IS NULL
      AND terms_version IS NULL AND privacy_version IS NULL)
  )
);

CREATE UNIQUE INDEX run3_referral_first_person_touch_idx
  ON run3_referral_attribution_events(program_key, recipient_person_id)
  WHERE event_kind = 'identity_bound';
CREATE UNIQUE INDEX run3_referral_first_household_touch_idx
  ON run3_referral_attribution_events(program_key, recipient_household_id)
  WHERE event_kind = 'identity_bound';

CREATE TABLE run3_referral_recipient_events (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 128),
  attribution_id text NOT NULL REFERENCES run3_referral_attributions(id) ON DELETE RESTRICT,
  recipient_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  recipient_household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  event_kind text NOT NULL CHECK (event_kind IN (
    'account_eligible', 'trusted_circle_accepted', 'orientation_ready'
  )),
  server_event_reference text NOT NULL CHECK (
    server_event_reference ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{2,127}$'
  ),
  server_event_digest text NOT NULL CHECK (server_event_digest ~ '^[A-Za-z0-9_-]{43}$'),
  operation_key text NOT NULL UNIQUE CHECK (
    operation_key ~ '^referral:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  server_generated boolean NOT NULL CHECK (server_generated = true),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  occurred_at timestamptz NOT NULL,
  UNIQUE (attribution_id, server_event_reference),
  UNIQUE (attribution_id, event_kind)
);

CREATE TABLE run3_referral_qualification_decisions (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 128),
  attribution_id text NOT NULL UNIQUE
    REFERENCES run3_referral_attributions(id) ON DELETE RESTRICT,
  recipient_event_id text NOT NULL UNIQUE
    REFERENCES run3_referral_recipient_events(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('qualified', 'denied', 'held')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  policy_definition_digest text NOT NULL CHECK (
    policy_definition_digest ~ '^[A-Za-z0-9_-]{43}$'
  ),
  operation_key text NOT NULL UNIQUE CHECK (
    operation_key ~ '^referral:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  external_action_executed boolean NOT NULL CHECK (external_action_executed = false),
  occurred_at timestamptz NOT NULL
);

CREATE TABLE run3_referral_financial_events (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 128),
  attribution_id text NOT NULL REFERENCES run3_referral_attributions(id) ON DELETE RESTRICT,
  event_kind text NOT NULL CHECK (event_kind IN (
    'settlement', 'refund', 'dispute', 'cancellation', 'failed_payment'
  )),
  parent_financial_event_id text REFERENCES run3_referral_financial_events(id) ON DELETE RESTRICT,
  source_event_hmac text NOT NULL UNIQUE CHECK (source_event_hmac ~ '^[A-Za-z0-9_-]{43}$'),
  subscription_reference_hmac text NOT NULL CHECK (
    subscription_reference_hmac ~ '^[A-Za-z0-9_-]{43}$'
  ),
  invoice_reference_hmac text NOT NULL CHECK (
    invoice_reference_hmac ~ '^[A-Za-z0-9_-]{43}$'
  ),
  line_reference_hmac text NOT NULL CHECK (
    line_reference_hmac ~ '^[A-Za-z0-9_-]{43}$'
  ),
  canonical_offer_key text NOT NULL CHECK (
    canonical_offer_key ~ '^[a-z][a-z0-9_.-]{2,79}$'
  ),
  currency text NOT NULL CHECK (currency = 'USD'),
  principal_minor integer NOT NULL CHECK (principal_minor > 0),
  source_authenticated boolean NOT NULL CHECK (source_authenticated = true),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  provider_execution_requested boolean NOT NULL CHECK (provider_execution_requested = false),
  provider_credit_applied boolean NOT NULL CHECK (provider_credit_applied = false),
  external_action_executed boolean NOT NULL CHECK (external_action_executed = false),
  operation_key text NOT NULL UNIQUE CHECK (
    operation_key ~ '^referral:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL CHECK (recorded_at >= occurred_at),
  CHECK (
    (event_kind = 'settlement' AND parent_financial_event_id IS NULL)
    OR (event_kind <> 'settlement' AND parent_financial_event_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX run3_referral_single_settlement_idx
  ON run3_referral_financial_events(attribution_id)
  WHERE event_kind = 'settlement';

CREATE TABLE run3_referral_correction_reviews (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 128),
  attribution_id text NOT NULL REFERENCES run3_referral_attributions(id) ON DELETE RESTRICT,
  correction_kind text NOT NULL CHECK (correction_kind IN (
    'correction_debit', 'correction_credit'
  )),
  authorized_amount_minor integer NOT NULL CHECK (authorized_amount_minor > 0),
  target_entry_id text,
  reviewer_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  reviewer_assignment_id text NOT NULL REFERENCES employee_assignments(id) ON DELETE RESTRICT,
  evidence_reference text NOT NULL CHECK (
    evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{2,127}$'
  ),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[A-Za-z0-9_-]{43}$'),
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  operation_key text NOT NULL UNIQUE CHECK (
    operation_key ~ '^referral:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  external_action_executed boolean NOT NULL CHECK (external_action_executed = false),
  occurred_at timestamptz NOT NULL,
  CHECK (
    (correction_kind = 'correction_debit' AND target_entry_id IS NOT NULL)
    OR (correction_kind = 'correction_credit' AND target_entry_id IS NULL)
  )
);

CREATE TABLE run3_referral_credit_entries (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 128),
  attribution_id text NOT NULL REFERENCES run3_referral_attributions(id) ON DELETE RESTRICT,
  program_key text NOT NULL,
  program_version integer NOT NULL,
  receiving_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  receiving_household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  entry_kind text NOT NULL CHECK (entry_kind IN (
    'reserved', 'earned', 'expired', 'reversed',
    'correction_debit', 'correction_credit'
  )),
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency = 'USD'),
  canonical_offer_key text NOT NULL CHECK (
    canonical_offer_key ~ '^[a-z][a-z0-9_.-]{2,79}$'
  ),
  source_type text NOT NULL CHECK (source_type IN (
    'qualification', 'financial', 'expiry', 'reviewed_correction'
  )),
  source_reference text NOT NULL CHECK (
    source_reference ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{2,127}$'
  ),
  source_evidence_digest text NOT NULL CHECK (
    source_evidence_digest ~ '^[A-Za-z0-9_-]{43}$'
  ),
  source_entry_id text REFERENCES run3_referral_credit_entries(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  idempotency_key text NOT NULL UNIQUE CHECK (
    idempotency_key ~ '^referral:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  audit_correlation_id text NOT NULL CHECK (
    audit_correlation_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,199}$'
  ),
  available_at timestamptz,
  expires_at timestamptz,
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  provider_credit_applied boolean NOT NULL CHECK (provider_credit_applied = false),
  external_action_executed boolean NOT NULL CHECK (external_action_executed = false),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (program_key, program_version)
    REFERENCES run3_referral_program_versions(program_key, program_version) ON DELETE RESTRICT,
  UNIQUE (attribution_id, sequence),
  UNIQUE (source_type, source_reference, entry_kind),
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK (
    (entry_kind = 'reserved' AND source_type = 'qualification'
      AND source_entry_id IS NULL AND available_at IS NULL AND expires_at IS NOT NULL)
    OR (entry_kind = 'earned' AND source_type = 'financial'
      AND source_entry_id IS NULL AND available_at IS NOT NULL AND expires_at IS NOT NULL)
    OR (entry_kind = 'reversed' AND source_type = 'financial'
      AND source_entry_id IS NOT NULL AND available_at IS NULL AND expires_at IS NULL)
    OR (entry_kind = 'expired' AND source_type = 'expiry'
      AND source_entry_id IS NOT NULL AND available_at IS NULL AND expires_at IS NULL)
    OR (entry_kind = 'correction_debit' AND source_type = 'reviewed_correction'
      AND source_entry_id IS NOT NULL AND available_at IS NULL AND expires_at IS NULL)
    OR (entry_kind = 'correction_credit' AND source_type = 'reviewed_correction'
      AND source_entry_id IS NULL AND available_at IS NOT NULL AND expires_at IS NOT NULL)
  )
);

CREATE TABLE run3_referral_processing_jobs (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 128),
  attribution_id text NOT NULL REFERENCES run3_referral_attributions(id) ON DELETE RESTRICT,
  processing_step text NOT NULL CHECK (processing_step IN (
    'qualification_recorded', 'financial_reconciled', 'credit_expiry_due'
  )),
  durable_job_id text NOT NULL UNIQUE REFERENCES durable_jobs(id) ON DELETE RESTRICT,
  receipt_state text NOT NULL CHECK (receipt_state = 'queued_not_run'),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  provider_processed boolean NOT NULL CHECK (provider_processed = false),
  provider_credit_applied boolean NOT NULL CHECK (provider_credit_applied = false),
  external_action_executed boolean NOT NULL CHECK (external_action_executed = false),
  created_at timestamptz NOT NULL,
  UNIQUE (attribution_id, processing_step, durable_job_id)
);

CREATE INDEX run3_referral_attribution_expiry_idx
  ON run3_referral_attributions(expires_at, id);
CREATE INDEX run3_referral_financial_attribution_idx
  ON run3_referral_financial_events(attribution_id, occurred_at, id);
CREATE INDEX run3_referral_ledger_balance_idx
  ON run3_referral_credit_entries(program_key, program_version, receiving_household_id, created_at);

CREATE OR REPLACE FUNCTION validate_run3_referral_program_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.created_at > clock_timestamp() THEN
    RAISE EXCEPTION 'Referral program cannot be created in the future';
  END IF;
  INSERT INTO run3_referral_program_identity_mutexes(program_key, created_at)
  VALUES (NEW.program_key, NEW.created_at)
  ON CONFLICT (program_key) DO NOTHING;
  PERFORM 1 FROM run3_referral_program_identity_mutexes
  WHERE program_key = NEW.program_key FOR UPDATE;
  RETURN NEW;
END;
$$;

CREATE TRIGGER run3_referral_program_version_valid
BEFORE INSERT ON run3_referral_program_versions
FOR EACH ROW EXECUTE FUNCTION validate_run3_referral_program_version();

CREATE OR REPLACE FUNCTION validate_run3_referral_attribution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  program run3_referral_program_versions%ROWTYPE;
  participant_count integer;
  referrer_count integer;
BEGIN
  PERFORM 1 FROM run3_referral_program_identity_mutexes
  WHERE program_key = NEW.program_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Referral program identity mutex is unavailable'; END IF;
  SELECT * INTO program FROM run3_referral_program_versions
  WHERE program_key = NEW.program_key AND program_version = NEW.program_version
  FOR UPDATE;
  IF program.program_key IS NULL OR program.lifecycle_state <> 'approved_disabled'
    OR program.program_execution_enabled OR program.provider_execution_enabled
    OR NEW.issued_at < program.created_at OR NEW.issued_at > clock_timestamp()
    OR NEW.issued_at < program.effective_at OR NEW.issued_at >= program.expires_at
    OR NEW.expires_at IS DISTINCT FROM
      NEW.issued_at + make_interval(secs => program.attribution_ttl_seconds) THEN
    RAISE EXCEPTION 'Referral simulation program is unavailable or definition-mismatched';
  END IF;
  PERFORM 1 FROM household_memberships
  WHERE household_id = NEW.referrer_household_id
    AND person_id = NEW.referrer_person_id AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Referral referrer membership is unavailable'; END IF;
  SELECT count(*)::integer INTO participant_count FROM run3_referral_attributions
  WHERE program_key = NEW.program_key AND program_version = NEW.program_version;
  SELECT count(*)::integer INTO referrer_count FROM run3_referral_attributions
  WHERE program_key = NEW.program_key AND program_version = NEW.program_version
    AND referrer_person_id = NEW.referrer_person_id;
  IF participant_count >= program.maximum_participants
    OR referrer_count >= program.maximum_referrals_per_referrer THEN
    RAISE EXCEPTION 'Referral attribution cap is exhausted';
  END IF;
  IF NEW.referrer_payment_identity_hmac IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM run3_referral_attributions prior
      WHERE prior.program_key = NEW.program_key
        AND prior.referrer_payment_identity_hmac = NEW.referrer_payment_identity_hmac
    )
    OR EXISTS (
      SELECT 1 FROM run3_referral_attribution_events bound
      WHERE bound.program_key = NEW.program_key
        AND bound.event_kind = 'identity_bound'
        AND bound.recipient_payment_identity_hmac = NEW.referrer_payment_identity_hmac
    )
  ) THEN
    RAISE EXCEPTION 'Referral payment identity is already used in this program';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER run3_referral_attribution_valid
BEFORE INSERT ON run3_referral_attributions
FOR EACH ROW EXECUTE FUNCTION validate_run3_referral_attribution();

CREATE OR REPLACE FUNCTION validate_run3_referral_attribution_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attribution run3_referral_attributions%ROWTYPE;
  program run3_referral_program_versions%ROWTYPE;
  expected_sequence integer;
BEGIN
  SELECT * INTO attribution FROM run3_referral_attributions
  WHERE id = NEW.attribution_id FOR UPDATE;
  IF attribution.id IS NULL OR NEW.program_key <> attribution.program_key
    OR NEW.program_version <> attribution.program_version THEN
    RAISE EXCEPTION 'Referral event attribution lineage is invalid';
  END IF;
  PERFORM 1 FROM run3_referral_program_identity_mutexes
  WHERE program_key = attribution.program_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Referral program identity mutex is unavailable'; END IF;
  SELECT * INTO program FROM run3_referral_program_versions
  WHERE program_key = attribution.program_key AND program_version = attribution.program_version
  FOR UPDATE;
  SELECT COALESCE(max(sequence), 0) + 1 INTO expected_sequence
  FROM run3_referral_attribution_events WHERE attribution_id = NEW.attribution_id;
  IF NEW.sequence <> expected_sequence OR NEW.occurred_at < attribution.issued_at
    OR NEW.occurred_at < program.created_at OR NEW.occurred_at > clock_timestamp() THEN
    RAISE EXCEPTION 'Referral event sequence or time is invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM run3_referral_attribution_events
    WHERE attribution_id = NEW.attribution_id AND event_kind IN ('stopped', 'expired')
  ) THEN
    RAISE EXCEPTION 'Referral attribution is terminal';
  END IF;
  IF NEW.event_kind = 'share_created' THEN
    IF NEW.sequence <> 1 OR NEW.occurred_at IS DISTINCT FROM attribution.issued_at THEN
      RAISE EXCEPTION 'Referral share creation must be the initial issuance event';
    END IF;
  ELSIF NEW.event_kind = 'invitation_opened' THEN
    IF NEW.occurred_at >= attribution.expires_at OR NOT EXISTS (
      SELECT 1 FROM run3_referral_attribution_events
      WHERE attribution_id = NEW.attribution_id AND event_kind = 'share_created'
    ) THEN RAISE EXCEPTION 'Referral open lacks a fresh share predecessor'; END IF;
  ELSIF NEW.event_kind = 'identity_bound' THEN
    IF NEW.occurred_at >= attribution.expires_at OR NOT EXISTS (
      SELECT 1 FROM run3_referral_attribution_events
      WHERE attribution_id = NEW.attribution_id AND event_kind = 'invitation_opened'
    ) THEN RAISE EXCEPTION 'Referral binding lacks a fresh open predecessor'; END IF;
    IF NEW.recipient_person_id = attribution.referrer_person_id
      OR NEW.recipient_household_id = attribution.referrer_household_id
      OR NEW.terms_version <> program.terms_version
      OR NEW.privacy_version <> program.privacy_version THEN
      RAISE EXCEPTION 'Referral binding has an identity conflict or terms mismatch';
    END IF;
    IF NEW.recipient_payment_identity_hmac IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM run3_referral_attributions prior
        WHERE prior.program_key = NEW.program_key
          AND prior.referrer_payment_identity_hmac = NEW.recipient_payment_identity_hmac
      )
      OR EXISTS (
        SELECT 1 FROM run3_referral_attribution_events prior_bound
        WHERE prior_bound.program_key = NEW.program_key
          AND prior_bound.event_kind = 'identity_bound'
          AND prior_bound.recipient_payment_identity_hmac = NEW.recipient_payment_identity_hmac
      )
    ) THEN
      RAISE EXCEPTION 'Referral payment identity is already used in this program';
    END IF;
    PERFORM 1 FROM household_memberships
    WHERE household_id = NEW.recipient_household_id
      AND person_id = NEW.recipient_person_id AND status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Referral recipient membership is unavailable'; END IF;
  ELSIF NEW.event_kind = 'expired' AND NEW.occurred_at < attribution.expires_at THEN
    RAISE EXCEPTION 'Referral attribution cannot expire early';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER run3_referral_attribution_event_valid
BEFORE INSERT ON run3_referral_attribution_events
FOR EACH ROW EXECUTE FUNCTION validate_run3_referral_attribution_event();

CREATE OR REPLACE FUNCTION validate_run3_referral_recipient_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bound run3_referral_attribution_events%ROWTYPE;
BEGIN
  SELECT * INTO bound FROM run3_referral_attribution_events
  WHERE attribution_id = NEW.attribution_id AND event_kind = 'identity_bound'
  FOR UPDATE;
  IF bound.id IS NULL OR NEW.recipient_person_id <> bound.recipient_person_id
    OR NEW.recipient_household_id <> bound.recipient_household_id
    OR NEW.occurred_at < bound.occurred_at OR NEW.occurred_at > clock_timestamp() THEN
    RAISE EXCEPTION 'Referral recipient evidence is not identity-bound';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER run3_referral_recipient_event_valid
BEFORE INSERT ON run3_referral_recipient_events
FOR EACH ROW EXECUTE FUNCTION validate_run3_referral_recipient_event();

CREATE OR REPLACE FUNCTION validate_run3_referral_qualification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attribution run3_referral_attributions%ROWTYPE;
  program run3_referral_program_versions%ROWTYPE;
  evidence run3_referral_recipient_events%ROWTYPE;
  expected_event text;
  should_qualify boolean;
BEGIN
  SELECT * INTO attribution FROM run3_referral_attributions
  WHERE id = NEW.attribution_id FOR UPDATE;
  SELECT * INTO program FROM run3_referral_program_versions
  WHERE program_key = attribution.program_key AND program_version = attribution.program_version
  FOR UPDATE;
  SELECT * INTO evidence FROM run3_referral_recipient_events
  WHERE id = NEW.recipient_event_id FOR UPDATE;
  expected_event := CASE program.qualification_milestone
    WHEN 'qualified_account' THEN 'account_eligible'
    WHEN 'trusted_circle_acceptance' THEN 'trusted_circle_accepted'
    WHEN 'orientation_ready' THEN 'orientation_ready'
    ELSE NULL
  END;
  IF attribution.id IS NULL OR program.program_key IS NULL OR evidence.id IS NULL
    OR NEW.occurred_at < evidence.occurred_at
    OR NEW.occurred_at < attribution.issued_at
    OR NEW.occurred_at < program.created_at
    OR NEW.occurred_at > clock_timestamp() THEN
    RAISE EXCEPTION 'Referral qualification authority time is invalid';
  END IF;
  should_qualify := attribution.id IS NOT NULL AND evidence.id IS NOT NULL
    AND evidence.attribution_id = attribution.id
    AND program.lifecycle_state = 'approved_disabled'
    AND NOT program.program_execution_enabled AND NOT program.provider_execution_enabled
    AND evidence.occurred_at >= program.effective_at AND evidence.occurred_at < program.expires_at
    AND evidence.event_kind = expected_event
    AND NEW.policy_definition_digest = program.definition_digest;
  IF (NEW.decision = 'qualified') <> should_qualify THEN
    RAISE EXCEPTION 'Referral qualification decision does not match deterministic evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER run3_referral_qualification_valid
BEFORE INSERT ON run3_referral_qualification_decisions
FOR EACH ROW EXECUTE FUNCTION validate_run3_referral_qualification();

CREATE OR REPLACE FUNCTION validate_run3_referral_financial_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attribution run3_referral_attributions%ROWTYPE;
  program run3_referral_program_versions%ROWTYPE;
  parent run3_referral_financial_events%ROWTYPE;
  prior_reversal_minor bigint;
  bound_at timestamptz;
  qualification_at timestamptz;
BEGIN
  SELECT * INTO attribution FROM run3_referral_attributions
  WHERE id = NEW.attribution_id FOR UPDATE;
  SELECT * INTO program FROM run3_referral_program_versions
  WHERE program_key = attribution.program_key AND program_version = attribution.program_version
  FOR UPDATE;
  SELECT occurred_at INTO bound_at FROM run3_referral_attribution_events
  WHERE attribution_id = NEW.attribution_id AND event_kind = 'identity_bound'
  FOR UPDATE;
  SELECT occurred_at INTO qualification_at FROM run3_referral_qualification_decisions
  WHERE attribution_id = NEW.attribution_id AND decision = 'qualified'
  FOR UPDATE;
  IF attribution.id IS NULL OR program.program_key IS NULL
    OR program.lifecycle_state <> 'approved_disabled'
    OR NEW.canonical_offer_key <> program.eligible_offer_key
    OR NEW.currency <> program.currency OR program.paid_credit_total_minor = 0
    OR bound_at IS NULL
    OR NEW.occurred_at < program.created_at
    OR NEW.occurred_at < attribution.issued_at
    OR NEW.occurred_at < bound_at
    OR NEW.recorded_at < NEW.occurred_at
    OR NEW.recorded_at > clock_timestamp()
    OR NOT (
      (program.qualification_milestone <> 'none'
        AND qualification_at IS NOT NULL AND NEW.occurred_at >= qualification_at)
      OR program.qualification_milestone = 'none'
    ) THEN
    RAISE EXCEPTION 'Referral financial event lacks exact qualified canonical lineage';
  END IF;
  IF NEW.event_kind = 'settlement' THEN
    IF NEW.parent_financial_event_id IS NOT NULL THEN
      RAISE EXCEPTION 'Referral settlement cannot have a financial parent';
    END IF;
  ELSE
    SELECT * INTO parent FROM run3_referral_financial_events
    WHERE id = NEW.parent_financial_event_id FOR UPDATE;
    IF parent.id IS NULL OR parent.event_kind <> 'settlement'
      OR parent.attribution_id <> NEW.attribution_id
      OR parent.subscription_reference_hmac <> NEW.subscription_reference_hmac
      OR parent.invoice_reference_hmac <> NEW.invoice_reference_hmac
      OR parent.line_reference_hmac <> NEW.line_reference_hmac
      OR parent.canonical_offer_key <> NEW.canonical_offer_key
      OR parent.currency <> NEW.currency OR NEW.occurred_at < parent.occurred_at
      OR NEW.recorded_at < parent.recorded_at THEN
      RAISE EXCEPTION 'Referral post-settlement lineage is invalid';
    END IF;
    SELECT COALESCE(sum(principal_minor), 0) INTO prior_reversal_minor
    FROM run3_referral_financial_events
    WHERE parent_financial_event_id = parent.id
      AND event_kind IN ('refund', 'dispute');
    IF NEW.event_kind IN ('refund', 'dispute')
      AND prior_reversal_minor + NEW.principal_minor > parent.principal_minor THEN
      RAISE EXCEPTION 'Referral refund or dispute exceeds settled principal';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER run3_referral_financial_event_valid
BEFORE INSERT ON run3_referral_financial_events
FOR EACH ROW EXECUTE FUNCTION validate_run3_referral_financial_event();

CREATE OR REPLACE FUNCTION validate_run3_referral_correction_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attribution run3_referral_attributions%ROWTYPE;
  target run3_referral_credit_entries%ROWTYPE;
BEGIN
  SELECT * INTO attribution FROM run3_referral_attributions
  WHERE id = NEW.attribution_id FOR UPDATE;
  IF attribution.id IS NULL OR NEW.occurred_at < attribution.issued_at
    OR NEW.occurred_at > clock_timestamp() THEN
    RAISE EXCEPTION 'Referral correction review authority time is invalid';
  END IF;
  PERFORM 1
  FROM employee_assignments employee
  JOIN organizations organization ON organization.id = employee.organization_id
  WHERE employee.id = NEW.reviewer_assignment_id
    AND employee.person_id = NEW.reviewer_person_id
    AND employee.status = 'active' AND employee.role IN ('hq_owner', 'hq_reviewer')
    AND organization.kind = 'internal'
  FOR UPDATE OF employee, organization;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral correction review requires active internal authority';
  END IF;
  IF NEW.correction_kind = 'correction_debit' THEN
    SELECT * INTO target FROM run3_referral_credit_entries
    WHERE id = NEW.target_entry_id FOR UPDATE;
    IF target.id IS NULL OR target.attribution_id <> NEW.attribution_id
      OR target.entry_kind NOT IN ('reserved', 'earned', 'correction_credit')
      OR target.created_at > NEW.occurred_at
      OR NEW.authorized_amount_minor > target.amount_minor THEN
      RAISE EXCEPTION 'Referral correction debit target is invalid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER run3_referral_correction_review_valid
BEFORE INSERT ON run3_referral_correction_reviews
FOR EACH ROW EXECUTE FUNCTION validate_run3_referral_correction_review();

CREATE OR REPLACE FUNCTION validate_run3_referral_credit_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attribution run3_referral_attributions%ROWTYPE;
  program run3_referral_program_versions%ROWTYPE;
  financial run3_referral_financial_events%ROWTYPE;
  parent_financial run3_referral_financial_events%ROWTYPE;
  decision run3_referral_qualification_decisions%ROWTYPE;
  recipient_evidence run3_referral_recipient_events%ROWTYPE;
  correction run3_referral_correction_reviews%ROWTYPE;
  source_entry run3_referral_credit_entries%ROWTYPE;
  current_referral bigint;
  current_referrer bigint;
  current_household bigint;
  current_program bigint;
  prior_source_debits bigint;
  prior_financial_debits bigint;
  prior_processed_principal bigint;
  target_cumulative_debit bigint;
  source_remaining bigint;
  expected_amount bigint;
  signed_new bigint;
  expected_sequence integer;
BEGIN
  SELECT * INTO attribution FROM run3_referral_attributions
  WHERE id = NEW.attribution_id FOR UPDATE;
  SELECT * INTO program FROM run3_referral_program_versions
  WHERE program_key = attribution.program_key AND program_version = attribution.program_version
  FOR UPDATE;
  IF attribution.id IS NULL OR program.program_key IS NULL
    OR NEW.program_key <> attribution.program_key
    OR NEW.program_version <> attribution.program_version
    OR NEW.receiving_person_id <> attribution.referrer_person_id
    OR NEW.receiving_household_id <> attribution.referrer_household_id
    OR NEW.currency <> program.currency
    OR NEW.canonical_offer_key <> program.eligible_offer_key
    OR NEW.created_at < attribution.issued_at
    OR NEW.created_at < program.created_at
    OR NEW.created_at > clock_timestamp() THEN
    RAISE EXCEPTION 'Referral ledger entry crosses immutable program or recipient lineage';
  END IF;
  SELECT COALESCE(max(sequence), 0) + 1 INTO expected_sequence
  FROM run3_referral_credit_entries WHERE attribution_id = NEW.attribution_id;
  IF NEW.sequence <> expected_sequence THEN
    RAISE EXCEPTION 'Referral ledger sequence is invalid';
  END IF;
  IF NEW.entry_kind = 'reserved' THEN
    SELECT * INTO decision FROM run3_referral_qualification_decisions
    WHERE id = NEW.source_reference FOR UPDATE;
    SELECT * INTO recipient_evidence FROM run3_referral_recipient_events
    WHERE id = decision.recipient_event_id FOR UPDATE;
    IF decision.id IS NULL OR decision.attribution_id <> NEW.attribution_id
      OR decision.decision <> 'qualified'
      OR recipient_evidence.id IS NULL
      OR recipient_evidence.attribution_id <> NEW.attribution_id
      OR NEW.amount_minor <> program.qualified_credit_minor
      OR NEW.source_evidence_digest <> recipient_evidence.server_event_digest
      OR NEW.reason_code <> 'exact_server_milestone'
      OR NEW.created_at IS DISTINCT FROM decision.occurred_at
      OR NEW.expires_at IS DISTINCT FROM
        NEW.created_at + make_interval(secs => program.credit_expiry_seconds) THEN
      RAISE EXCEPTION 'Referral reservation lacks exact qualified source evidence';
    END IF;
  ELSIF NEW.entry_kind IN ('earned', 'reversed') THEN
    SELECT * INTO financial FROM run3_referral_financial_events
    WHERE id = NEW.source_reference FOR UPDATE;
    IF financial.id IS NULL OR financial.attribution_id <> NEW.attribution_id
      OR NEW.source_evidence_digest <> financial.source_event_hmac
      OR NEW.created_at IS DISTINCT FROM financial.recorded_at THEN
      RAISE EXCEPTION 'Referral financial ledger entry lacks authenticated lineage';
    END IF;
    IF NEW.entry_kind = 'earned' THEN
      expected_amount := LEAST(program.paid_credit_total_minor, financial.principal_minor);
      IF financial.event_kind <> 'settlement'
        OR NEW.amount_minor <> expected_amount
        OR NEW.reason_code <> 'eligible_paid_settlement'
        OR NEW.available_at IS DISTINCT FROM
          NEW.created_at + make_interval(secs => program.settlement_hold_seconds)
        OR NEW.expires_at IS DISTINCT FROM
          NEW.available_at + make_interval(secs => program.credit_expiry_seconds) THEN
        RAISE EXCEPTION 'Referral earning does not exactly match authenticated settlement';
      END IF;
    ELSE
      SELECT * INTO source_entry FROM run3_referral_credit_entries
      WHERE id = NEW.source_entry_id FOR UPDATE;
      SELECT COALESCE(sum(amount_minor), 0) INTO prior_source_debits
      FROM run3_referral_credit_entries
      WHERE source_entry_id = NEW.source_entry_id
        AND entry_kind IN ('expired', 'reversed', 'correction_debit');
      source_remaining := COALESCE(source_entry.amount_minor, 0) - prior_source_debits;
      IF source_entry.id IS NULL OR source_entry.attribution_id <> NEW.attribution_id
        OR source_entry.entry_kind NOT IN ('reserved', 'earned', 'correction_credit')
        OR source_entry.created_at > financial.recorded_at OR source_remaining <= 0 THEN
        RAISE EXCEPTION 'Referral reversal target is unavailable';
      END IF;
      IF financial.event_kind = 'settlement' THEN
        expected_amount := source_remaining;
        IF source_entry.entry_kind <> 'reserved'
          OR NEW.reason_code <> 'reservation_superseded_by_settlement' THEN
          RAISE EXCEPTION 'Referral settlement reversal target is invalid';
        END IF;
      ELSIF financial.event_kind IN ('refund', 'dispute') THEN
        SELECT * INTO parent_financial FROM run3_referral_financial_events
        WHERE id = financial.parent_financial_event_id FOR UPDATE;
        SELECT COALESCE(sum(prior_ledger.amount_minor), 0)
        INTO prior_financial_debits
        FROM run3_referral_credit_entries prior_ledger
        JOIN run3_referral_financial_events prior_financial
          ON prior_financial.id = prior_ledger.source_reference
        WHERE prior_ledger.source_entry_id = source_entry.id
          AND prior_ledger.entry_kind = 'reversed'
          AND prior_financial.parent_financial_event_id = parent_financial.id
          AND prior_financial.event_kind IN ('refund', 'dispute')
          AND prior_financial.id <> financial.id;
        SELECT COALESCE(sum(prior_financial.principal_minor), 0)
        INTO prior_processed_principal
        FROM run3_referral_financial_events prior_financial
        WHERE prior_financial.parent_financial_event_id = parent_financial.id
          AND prior_financial.event_kind IN ('refund', 'dispute')
          AND prior_financial.id <> financial.id;
        target_cumulative_debit := LEAST(
          source_entry.amount_minor,
          source_entry.amount_minor::bigint
            * (prior_processed_principal + financial.principal_minor)
            / parent_financial.principal_minor
        );
        expected_amount := LEAST(
          source_remaining,
          target_cumulative_debit - prior_financial_debits
        );
        IF parent_financial.id IS NULL OR parent_financial.event_kind <> 'settlement'
          OR source_entry.entry_kind <> 'earned'
          OR source_entry.source_reference <> parent_financial.id
          OR NEW.reason_code <> ('authenticated_' || financial.event_kind) THEN
          RAISE EXCEPTION 'Referral refund or dispute reversal target is invalid';
        END IF;
      ELSIF financial.event_kind IN ('cancellation', 'failed_payment') THEN
        expected_amount := source_remaining;
        IF source_entry.entry_kind <> 'earned'
          OR source_entry.source_reference <> financial.parent_financial_event_id
          OR NEW.reason_code <> ('authenticated_' || financial.event_kind) THEN
          RAISE EXCEPTION 'Referral terminal financial reversal target is invalid';
        END IF;
      ELSE
        RAISE EXCEPTION 'Referral reversal source is invalid';
      END IF;
      IF expected_amount <= 0 OR NEW.amount_minor <> expected_amount THEN
        RAISE EXCEPTION 'Referral reversal amount does not match its exact source';
      END IF;
    END IF;
  ELSIF NEW.entry_kind = 'expired' THEN
    SELECT * INTO source_entry FROM run3_referral_credit_entries
    WHERE id = NEW.source_entry_id FOR UPDATE;
    SELECT COALESCE(sum(amount_minor), 0) INTO prior_source_debits
    FROM run3_referral_credit_entries
    WHERE source_entry_id = NEW.source_entry_id
      AND entry_kind IN ('expired', 'reversed', 'correction_debit');
    source_remaining := COALESCE(source_entry.amount_minor, 0) - prior_source_debits;
    IF source_entry.id IS NULL OR source_entry.attribution_id <> NEW.attribution_id
      OR source_entry.entry_kind NOT IN ('reserved', 'earned', 'correction_credit')
      OR source_entry.expires_at IS NULL OR NEW.created_at < source_entry.expires_at
      OR NEW.source_reference <> source_entry.id
      OR NEW.source_evidence_digest <> source_entry.source_evidence_digest
      OR NEW.reason_code <> 'disclosed_credit_expiration'
      OR source_remaining <= 0 OR NEW.amount_minor <> source_remaining THEN
      RAISE EXCEPTION 'Referral expiration lacks a due positive source entry';
    END IF;
  ELSIF NEW.entry_kind IN ('correction_debit', 'correction_credit') THEN
    SELECT * INTO correction FROM run3_referral_correction_reviews
    WHERE id = NEW.source_reference FOR UPDATE;
    IF correction.id IS NULL OR correction.attribution_id <> NEW.attribution_id
      OR correction.correction_kind <> NEW.entry_kind
      OR correction.authorized_amount_minor <> NEW.amount_minor
      OR correction.evidence_digest <> NEW.source_evidence_digest
      OR correction.reason_code <> NEW.reason_code
      OR NEW.created_at IS DISTINCT FROM correction.occurred_at THEN
      RAISE EXCEPTION 'Referral correction lacks exact reviewed evidence';
    END IF;
    IF NEW.entry_kind = 'correction_debit' THEN
      SELECT * INTO source_entry FROM run3_referral_credit_entries
      WHERE id = NEW.source_entry_id FOR UPDATE;
      SELECT COALESCE(sum(amount_minor), 0) INTO prior_source_debits
      FROM run3_referral_credit_entries
      WHERE source_entry_id = NEW.source_entry_id
        AND entry_kind IN ('expired', 'reversed', 'correction_debit');
      source_remaining := COALESCE(source_entry.amount_minor, 0) - prior_source_debits;
      IF source_entry.id IS NULL OR source_entry.attribution_id <> NEW.attribution_id
        OR correction.target_entry_id <> source_entry.id
        OR source_entry.entry_kind NOT IN ('reserved', 'earned', 'correction_credit')
        OR source_remaining < NEW.amount_minor THEN
        RAISE EXCEPTION 'Referral correction debit exceeds its exact positive source';
      END IF;
    ELSIF NEW.available_at IS DISTINCT FROM NEW.created_at
      OR NEW.expires_at IS DISTINCT FROM
        NEW.created_at + make_interval(secs => program.credit_expiry_seconds) THEN
      RAISE EXCEPTION 'Referral correction credit timing is invalid';
    END IF;
  END IF;
  signed_new := CASE WHEN NEW.entry_kind IN (
    'expired', 'reversed', 'correction_debit'
  ) THEN -NEW.amount_minor ELSE NEW.amount_minor END;
  SELECT COALESCE(sum(CASE WHEN entry_kind IN (
    'expired', 'reversed', 'correction_debit'
  ) THEN -amount_minor ELSE amount_minor END), 0) INTO current_referral
  FROM run3_referral_credit_entries WHERE attribution_id = NEW.attribution_id;
  SELECT COALESCE(sum(CASE WHEN entry_kind IN (
    'expired', 'reversed', 'correction_debit'
  ) THEN -amount_minor ELSE amount_minor END), 0) INTO current_referrer
  FROM run3_referral_credit_entries
  WHERE program_key = NEW.program_key AND program_version = NEW.program_version
    AND receiving_person_id = NEW.receiving_person_id;
  SELECT COALESCE(sum(CASE WHEN entry_kind IN (
    'expired', 'reversed', 'correction_debit'
  ) THEN -amount_minor ELSE amount_minor END), 0) INTO current_household
  FROM run3_referral_credit_entries
  WHERE program_key = NEW.program_key AND program_version = NEW.program_version
    AND receiving_household_id = NEW.receiving_household_id;
  SELECT COALESCE(sum(CASE WHEN entry_kind IN (
    'expired', 'reversed', 'correction_debit'
  ) THEN -amount_minor ELSE amount_minor END), 0) INTO current_program
  FROM run3_referral_credit_entries
  WHERE program_key = NEW.program_key AND program_version = NEW.program_version;
  IF current_referral + signed_new < 0
    OR current_referral + signed_new > program.maximum_credit_per_referral_minor
    OR current_referrer + signed_new > program.maximum_credit_per_referrer_minor
    OR current_household + signed_new > program.maximum_credit_per_household_minor
    OR current_program + signed_new > program.maximum_program_liability_minor THEN
    RAISE EXCEPTION 'Referral ledger entry exceeds balance or cumulative cap';
  END IF;
  IF NEW.entry_kind = 'earned'
    AND current_referral + signed_new > program.paid_credit_total_minor THEN
    RAISE EXCEPTION 'Referral earned credit exceeds immutable paid target';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER run3_referral_credit_entry_valid
BEFORE INSERT ON run3_referral_credit_entries
FOR EACH ROW EXECUTE FUNCTION validate_run3_referral_credit_entry();

CREATE OR REPLACE FUNCTION validate_run3_referral_processing_job()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attribution run3_referral_attributions%ROWTYPE;
  durable durable_jobs%ROWTYPE;
BEGIN
  SELECT * INTO attribution FROM run3_referral_attributions
  WHERE id = NEW.attribution_id FOR UPDATE;
  SELECT * INTO durable FROM durable_jobs WHERE id = NEW.durable_job_id FOR UPDATE;
  IF attribution.id IS NULL OR durable.id IS NULL
    OR durable.job_type <> 'referral.credit.evaluate' OR durable.job_version <> 1
    OR durable.classification <> 'internal' OR durable.state <> 'queued'
    OR durable.payload IS DISTINCT FROM jsonb_build_object(
      'attributionId', NEW.attribution_id,
      'programKey', attribution.program_key,
      'programVersion', attribution.program_version,
      'step', NEW.processing_step,
      'localOnly', true
    ) THEN
    RAISE EXCEPTION 'Referral processing receipt does not match a content-free local job';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER run3_referral_processing_job_valid
BEFORE INSERT ON run3_referral_processing_jobs
FOR EACH ROW EXECUTE FUNCTION validate_run3_referral_processing_job();

CREATE OR REPLACE FUNCTION reject_run3_referral_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Run 3 referral evidence is append-only';
END;
$$;

CREATE TRIGGER run3_referral_program_versions_immutable
BEFORE UPDATE OR DELETE ON run3_referral_program_versions
FOR EACH ROW EXECUTE FUNCTION reject_run3_referral_evidence_mutation();
CREATE TRIGGER run3_referral_program_identity_mutexes_immutable
BEFORE UPDATE OR DELETE ON run3_referral_program_identity_mutexes
FOR EACH ROW EXECUTE FUNCTION reject_run3_referral_evidence_mutation();
CREATE TRIGGER run3_referral_attributions_immutable
BEFORE UPDATE OR DELETE ON run3_referral_attributions
FOR EACH ROW EXECUTE FUNCTION reject_run3_referral_evidence_mutation();
CREATE TRIGGER run3_referral_attribution_events_immutable
BEFORE UPDATE OR DELETE ON run3_referral_attribution_events
FOR EACH ROW EXECUTE FUNCTION reject_run3_referral_evidence_mutation();
CREATE TRIGGER run3_referral_recipient_events_immutable
BEFORE UPDATE OR DELETE ON run3_referral_recipient_events
FOR EACH ROW EXECUTE FUNCTION reject_run3_referral_evidence_mutation();
CREATE TRIGGER run3_referral_qualification_decisions_immutable
BEFORE UPDATE OR DELETE ON run3_referral_qualification_decisions
FOR EACH ROW EXECUTE FUNCTION reject_run3_referral_evidence_mutation();
CREATE TRIGGER run3_referral_financial_events_immutable
BEFORE UPDATE OR DELETE ON run3_referral_financial_events
FOR EACH ROW EXECUTE FUNCTION reject_run3_referral_evidence_mutation();
CREATE TRIGGER run3_referral_correction_reviews_immutable
BEFORE UPDATE OR DELETE ON run3_referral_correction_reviews
FOR EACH ROW EXECUTE FUNCTION reject_run3_referral_evidence_mutation();
CREATE TRIGGER run3_referral_credit_entries_immutable
BEFORE UPDATE OR DELETE ON run3_referral_credit_entries
FOR EACH ROW EXECUTE FUNCTION reject_run3_referral_evidence_mutation();
CREATE TRIGGER run3_referral_processing_jobs_immutable
BEFORE UPDATE OR DELETE ON run3_referral_processing_jobs
FOR EACH ROW EXECUTE FUNCTION reject_run3_referral_evidence_mutation();
