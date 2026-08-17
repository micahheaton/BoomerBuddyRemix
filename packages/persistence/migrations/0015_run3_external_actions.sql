CREATE TABLE external_action_provider_acceptance_rules (
  id text PRIMARY KEY,
  provider_key text NOT NULL CHECK (char_length(provider_key) BETWEEN 2 AND 80),
  provider_account_digest text NOT NULL CHECK (
    provider_account_digest ~ '^[A-Za-z0-9_-]{43}$'
  ),
  action_class text NOT NULL CHECK (
    action_class IN ('email', 'sms', 'refund', 'credit', 'paid_tool')
  ),
  provider_response_state text NOT NULL CHECK (char_length(provider_response_state) BETWEEN 2 AND 80),
  normalized_outcome text NOT NULL CHECK (normalized_outcome = 'accepted'),
  provider_supports_idempotency boolean NOT NULL,
  idempotency_key_derivation_version text,
  enabled boolean NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  reviewed_by_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  reviewed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (
    (provider_supports_idempotency
      AND char_length(idempotency_key_derivation_version) BETWEEN 2 AND 80)
    OR (NOT provider_supports_idempotency AND idempotency_key_derivation_version IS NULL)
  ),
  UNIQUE(provider_key, provider_account_digest, action_class, provider_response_state)
);

CREATE TABLE external_action_provider_acceptance_rule_versions (
  id text PRIMARY KEY,
  rule_id text NOT NULL REFERENCES external_action_provider_acceptance_rules(id) ON DELETE RESTRICT,
  provider_key text NOT NULL CHECK (char_length(provider_key) BETWEEN 2 AND 80),
  provider_account_digest text NOT NULL CHECK (
    provider_account_digest ~ '^[A-Za-z0-9_-]{43}$'
  ),
  action_class text NOT NULL CHECK (
    action_class IN ('email', 'sms', 'refund', 'credit', 'paid_tool')
  ),
  provider_response_state text NOT NULL CHECK (char_length(provider_response_state) BETWEEN 2 AND 80),
  normalized_outcome text NOT NULL CHECK (normalized_outcome = 'accepted'),
  provider_supports_idempotency boolean NOT NULL,
  idempotency_key_derivation_version text,
  enabled boolean NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  reviewed_by_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL,
  CHECK (
    (provider_supports_idempotency
      AND char_length(idempotency_key_derivation_version) BETWEEN 2 AND 80)
    OR (NOT provider_supports_idempotency AND idempotency_key_derivation_version IS NULL)
  ),
  UNIQUE(rule_id, version)
);

CREATE TABLE external_action_exposure_authorizations (
  id text PRIMARY KEY,
  budget_reservation_id text NOT NULL UNIQUE
    REFERENCES automation_budget_reservations(id) ON DELETE RESTRICT,
  operation_id text NOT NULL UNIQUE,
  action_class text NOT NULL CHECK (
    action_class IN ('email', 'sms', 'refund', 'credit', 'paid_tool')
  ),
  provider_key text NOT NULL CHECK (char_length(provider_key) BETWEEN 2 AND 80),
  provider_account_digest text NOT NULL CHECK (
    provider_account_digest ~ '^[A-Za-z0-9_-]{43}$'
  ),
  provider_capability_rule_id text NOT NULL,
  provider_capability_rule_version integer NOT NULL CHECK (provider_capability_rule_version > 0),
  provider_supports_idempotency boolean NOT NULL,
  provider_idempotency_key text,
  provider_idempotency_key_derivation_version text,
  financial_exposure_upper_bound_cents integer NOT NULL
    CHECK (financial_exposure_upper_bound_cents >= 0),
  budget_magnitude_kind text NOT NULL CHECK (
    budget_magnitude_kind IN ('provider_cost', 'refund_principal', 'credit_principal')
  ),
  cost_currency text NOT NULL CHECK (cost_currency = 'USD'),
  cost_source_key text NOT NULL CHECK (char_length(cost_source_key) BETWEEN 2 AND 80),
  cost_source_version text NOT NULL CHECK (char_length(cost_source_version) BETWEEN 2 AND 80),
  evidence_level text NOT NULL CHECK (evidence_level = 'local_fixture'),
  capability_digest text NOT NULL CHECK (capability_digest ~ '^[a-f0-9]{64}$'),
  authorized_by_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (used_at IS NULL OR used_at >= created_at),
  FOREIGN KEY(provider_capability_rule_id, provider_capability_rule_version)
    REFERENCES external_action_provider_acceptance_rule_versions(rule_id, version)
    ON DELETE RESTRICT,
  CHECK (
    (provider_supports_idempotency
      AND char_length(provider_idempotency_key) BETWEEN 8 AND 200
      AND char_length(provider_idempotency_key_derivation_version) BETWEEN 2 AND 80)
    OR (NOT provider_supports_idempotency AND provider_idempotency_key IS NULL
      AND provider_idempotency_key_derivation_version IS NULL)
  ),
  CHECK (
    (action_class = 'refund' AND budget_magnitude_kind = 'refund_principal'
      AND financial_exposure_upper_bound_cents > 0)
    OR (action_class = 'credit' AND budget_magnitude_kind = 'credit_principal'
      AND financial_exposure_upper_bound_cents > 0)
    OR (action_class NOT IN ('refund', 'credit') AND budget_magnitude_kind = 'provider_cost')
  )
);

CREATE TABLE external_actions (
  operation_id text PRIMARY KEY CHECK (char_length(operation_id) BETWEEN 8 AND 200),
  budget_reservation_id text NOT NULL UNIQUE
    REFERENCES automation_budget_reservations(id) ON DELETE RESTRICT,
  exposure_authorization_id text NOT NULL UNIQUE
    REFERENCES external_action_exposure_authorizations(id) ON DELETE RESTRICT,
  budget_envelope_digest text NOT NULL CHECK (budget_envelope_digest ~ '^[a-f0-9]{64}$'),
  automation_action_key text NOT NULL CHECK (char_length(automation_action_key) BETWEEN 2 AND 80),
  automation_tool_key text NOT NULL CHECK (char_length(automation_tool_key) BETWEEN 2 AND 80),
  financial_exposure_upper_bound_cents integer NOT NULL
    CHECK (financial_exposure_upper_bound_cents >= 0),
  budget_magnitude_kind text NOT NULL CHECK (
    budget_magnitude_kind IN ('provider_cost', 'refund_principal', 'credit_principal')
  ),
  cost_currency text NOT NULL CHECK (cost_currency = 'USD'),
  cost_source_key text NOT NULL CHECK (char_length(cost_source_key) BETWEEN 2 AND 80),
  cost_source_version text NOT NULL CHECK (char_length(cost_source_version) BETWEEN 2 AND 80),
  exposure_evidence_level text NOT NULL CHECK (exposure_evidence_level = 'local_fixture'),
  scope_kind text NOT NULL CHECK (scope_kind IN ('company', 'household', 'organization')),
  scope_id text NOT NULL CHECK (char_length(scope_id) BETWEEN 2 AND 200),
  origin_kind text NOT NULL CHECK (origin_kind IN ('durable_job', 'outbox_event')),
  origin_id text NOT NULL CHECK (char_length(origin_id) BETWEEN 2 AND 200),
  registered_by_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  registration_audience text NOT NULL CHECK (registration_audience = 'hq'),
  action_class text NOT NULL CHECK (
    action_class IN ('email', 'sms', 'refund', 'credit', 'paid_tool')
  ),
  provider_key text NOT NULL CHECK (char_length(provider_key) BETWEEN 2 AND 80),
  provider_account_digest text NOT NULL CHECK (
    provider_account_digest ~ '^[A-Za-z0-9_-]{43}$'
  ),
  provider_capability_rule_id text NOT NULL,
  provider_capability_rule_version integer NOT NULL CHECK (provider_capability_rule_version > 0),
  provider_supports_idempotency boolean NOT NULL,
  provider_idempotency_key text,
  provider_idempotency_key_derivation_version text,
  intent_fingerprint text NOT NULL CHECK (char_length(intent_fingerprint) = 43),
  state text NOT NULL CHECK (
    state IN (
      'pending', 'in_flight', 'retry_wait', 'outcome_unknown',
      'succeeded', 'failed_terminal', 'canceled'
    )
  ),
  effect_state text NOT NULL CHECK (
    effect_state IN ('not_dispatched', 'unknown', 'accepted', 'confirmed_no_effect')
  ),
  retry_suppressed boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 5),
  next_attempt_at timestamptz NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  transition_capability_digest text,
  transition_capability_expires_at timestamptz,
  provider_response_id text,
  provider_response_state text,
  provider_normalized_outcome text CHECK (
    provider_normalized_outcome IS NULL OR provider_normalized_outcome = 'accepted'
  ),
  correlation_id text NOT NULL CHECK (char_length(correlation_id) BETWEEN 8 AND 200),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (attempts <= max_attempts),
  CHECK (
    (action_class = 'refund' AND budget_magnitude_kind = 'refund_principal'
      AND financial_exposure_upper_bound_cents > 0)
    OR (action_class = 'credit' AND budget_magnitude_kind = 'credit_principal'
      AND financial_exposure_upper_bound_cents > 0)
    OR (action_class NOT IN ('refund', 'credit') AND budget_magnitude_kind = 'provider_cost')
  ),
  CHECK (
    (provider_supports_idempotency AND provider_idempotency_key IS NOT NULL)
    OR (NOT provider_supports_idempotency AND provider_idempotency_key IS NULL)
  ),
  FOREIGN KEY(provider_capability_rule_id, provider_capability_rule_version)
    REFERENCES external_action_provider_acceptance_rule_versions(rule_id, version)
    ON DELETE RESTRICT,
  CHECK (
    (provider_supports_idempotency
      AND char_length(provider_idempotency_key_derivation_version) BETWEEN 2 AND 80)
    OR (NOT provider_supports_idempotency
      AND provider_idempotency_key_derivation_version IS NULL)
  ),
  CHECK (
    (state = 'in_flight' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL
      AND transition_capability_digest ~ '^[a-f0-9]{64}$'
      AND transition_capability_expires_at IS NOT NULL
      AND transition_capability_expires_at > updated_at
      AND transition_capability_expires_at <= lease_expires_at)
    OR (state <> 'in_flight' AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND transition_capability_digest IS NULL AND transition_capability_expires_at IS NULL)
  ),
  CHECK (
    (provider_response_id IS NULL AND provider_response_state IS NULL
      AND provider_normalized_outcome IS NULL)
    OR (provider_response_id IS NOT NULL AND provider_response_state IS NOT NULL
      AND provider_normalized_outcome = 'accepted')
  ),
  CHECK (
    state <> 'succeeded'
    OR (effect_state = 'accepted' AND provider_normalized_outcome = 'accepted')
  ),
  CHECK (state <> 'outcome_unknown' OR effect_state = 'unknown'),
  CHECK (NOT retry_suppressed OR state IN ('outcome_unknown', 'canceled')),
  CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX external_action_provider_idempotency_idx
  ON external_actions(provider_key, provider_idempotency_key)
  WHERE provider_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX external_action_provider_response_idx
  ON external_actions(provider_key, provider_response_id)
  WHERE provider_response_id IS NOT NULL;

CREATE INDEX external_action_claim_idx
  ON external_actions(state, next_attempt_at, operation_id)
  WHERE state IN ('pending', 'retry_wait', 'in_flight');

CREATE TABLE external_action_reconciliation_authorizations (
  id text PRIMARY KEY,
  operation_id text NOT NULL REFERENCES external_actions(operation_id) ON DELETE RESTRICT,
  budget_reservation_id text NOT NULL REFERENCES automation_budget_reservations(id) ON DELETE RESTRICT,
  scope_kind text NOT NULL CHECK (scope_kind IN ('company', 'household', 'organization')),
  scope_id text NOT NULL,
  requested_outcome text NOT NULL CHECK (
    requested_outcome IN ('confirmed_succeeded', 'confirmed_no_effect', 'still_unknown', 'canceled')
  ),
  capability_digest text NOT NULL CHECK (capability_digest ~ '^[a-f0-9]{64}$'),
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  audience text NOT NULL CHECK (audience = 'hq'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (used_at IS NULL OR used_at >= created_at)
);

CREATE TABLE external_action_attempts (
  id text PRIMARY KEY,
  operation_id text NOT NULL REFERENCES external_actions(operation_id) ON DELETE RESTRICT,
  attempt integer NOT NULL CHECK (attempt > 0),
  event_kind text NOT NULL CHECK (
    event_kind IN (
      'claimed', 'provider_accepted', 'outcome_unknown', 'lease_expired_unknown',
      'reconciliation_confirmed_success', 'reconciliation_confirmed_no_effect',
      'reconciliation_still_unknown', 'reconciliation_canceled',
      'retry_exhausted', 'canceled'
    )
  ),
  worker_id text NOT NULL CHECK (char_length(worker_id) BETWEEN 2 AND 100),
  transition_capability_digest text,
  budget_reservation_id text REFERENCES automation_budget_reservations(id) ON DELETE RESTRICT,
  budget_control_version integer CHECK (budget_control_version IS NULL OR budget_control_version > 0),
  budget_rechecked_at timestamptz,
  budget_authorization_expires_at timestamptz,
  provider_response_id text,
  provider_response_state text,
  provider_normalized_outcome text CHECK (
    provider_normalized_outcome IS NULL OR provider_normalized_outcome = 'accepted'
  ),
  acceptance_rule_id text,
  acceptance_rule_version integer,
  error_code text,
  actual_financial_exposure_cents bigint CHECK (
    actual_financial_exposure_cents IS NULL OR actual_financial_exposure_cents >= 0
  ),
  budget_magnitude_kind text CHECK (
    budget_magnitude_kind IS NULL
    OR budget_magnitude_kind IN ('provider_cost', 'refund_principal', 'credit_principal')
  ),
  cost_currency text CHECK (cost_currency IS NULL OR cost_currency = 'USD'),
  cost_source_key text,
  cost_source_version text,
  cost_evidence_level text CHECK (
    cost_evidence_level IS NULL OR cost_evidence_level = 'local_fixture'
  ),
  cost_evidence_reference text,
  cost_evidence_digest text,
  reconciliation_evidence_kind text CHECK (
    reconciliation_evidence_kind IS NULL
    OR reconciliation_evidence_kind IN ('provider_query', 'provider_webhook', 'operator_review')
  ),
  reconciliation_evidence_reference text,
  reconciliation_evidence_digest text,
  reconciliation_evidence_observed_at timestamptz,
  reconciliation_provider_key text,
  reconciliation_provider_account_digest text,
  reconciliation_authorization_id text
    REFERENCES external_action_reconciliation_authorizations(id) ON DELETE RESTRICT,
  reconciliation_actor_person_id text REFERENCES persons(id) ON DELETE RESTRICT,
  reconciliation_audience text CHECK (
    reconciliation_audience IS NULL OR reconciliation_audience = 'hq'
  ),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY(acceptance_rule_id, acceptance_rule_version)
    REFERENCES external_action_provider_acceptance_rule_versions(rule_id, version)
    ON DELETE RESTRICT,
  CHECK (
    (provider_response_id IS NULL AND provider_response_state IS NULL
      AND provider_normalized_outcome IS NULL)
    OR (provider_response_id IS NOT NULL AND provider_response_state IS NOT NULL
      AND provider_normalized_outcome = 'accepted')
  ),
  CHECK (
    (acceptance_rule_id IS NULL AND acceptance_rule_version IS NULL)
    OR (acceptance_rule_id IS NOT NULL AND acceptance_rule_version IS NOT NULL)
  ),
  CHECK (
    (actual_financial_exposure_cents IS NULL AND budget_magnitude_kind IS NULL
      AND cost_currency IS NULL AND cost_source_key IS NULL
      AND cost_source_version IS NULL AND cost_evidence_level IS NULL
      AND cost_evidence_reference IS NULL
      AND cost_evidence_digest IS NULL)
    OR (actual_financial_exposure_cents IS NOT NULL AND budget_magnitude_kind IS NOT NULL
      AND cost_currency = 'USD'
      AND cost_source_key IS NOT NULL AND cost_source_version IS NOT NULL
      AND cost_evidence_level = 'local_fixture'
      AND cost_evidence_reference IS NOT NULL
      AND cost_evidence_digest ~ '^[A-Za-z0-9_-]{43}$')
  ),
  CHECK (
    event_kind NOT IN ('provider_accepted', 'reconciliation_confirmed_success')
    OR (actual_financial_exposure_cents IS NOT NULL
      AND budget_reservation_id IS NOT NULL
      AND acceptance_rule_id IS NOT NULL AND acceptance_rule_version IS NOT NULL)
  ),
  CHECK (
    event_kind <> 'claimed'
    OR (transition_capability_digest ~ '^[a-f0-9]{64}$'
      AND budget_reservation_id IS NOT NULL AND budget_control_version IS NOT NULL
      AND acceptance_rule_id IS NOT NULL AND acceptance_rule_version IS NOT NULL
      AND budget_rechecked_at IS NOT NULL AND budget_authorization_expires_at IS NOT NULL
      AND budget_rechecked_at <= occurred_at
      AND occurred_at <= budget_authorization_expires_at)
  ),
  CHECK (
    (reconciliation_evidence_kind IS NULL AND reconciliation_evidence_reference IS NULL
      AND reconciliation_evidence_digest IS NULL AND reconciliation_evidence_observed_at IS NULL
      AND reconciliation_provider_key IS NULL
      AND reconciliation_provider_account_digest IS NULL
      AND reconciliation_authorization_id IS NULL AND reconciliation_actor_person_id IS NULL
      AND reconciliation_audience IS NULL)
    OR (reconciliation_evidence_kind IS NOT NULL
      AND reconciliation_evidence_reference IS NOT NULL
      AND reconciliation_evidence_digest ~ '^[A-Za-z0-9_-]{43}$'
      AND reconciliation_evidence_observed_at IS NOT NULL
      AND reconciliation_provider_key IS NOT NULL
      AND reconciliation_provider_account_digest ~ '^[A-Za-z0-9_-]{43}$'
      AND reconciliation_authorization_id IS NOT NULL
      AND reconciliation_actor_person_id IS NOT NULL
      AND reconciliation_audience = 'hq')
  )
);

CREATE INDEX external_action_attempt_timeline_idx
  ON external_action_attempts(operation_id, attempt, occurred_at, id);

CREATE UNIQUE INDEX external_action_single_confirmed_effect_idx
  ON external_action_attempts(operation_id)
  WHERE event_kind IN ('provider_accepted', 'reconciliation_confirmed_success');

CREATE UNIQUE INDEX external_action_single_claim_snapshot_idx
  ON external_action_attempts(operation_id, attempt)
  WHERE event_kind = 'claimed';

CREATE OR REPLACE FUNCTION validate_external_action_attempt_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  action_magnitude_kind text;
  action_kind text;
  action_evidence_level text;
  action_provider text;
  action_provider_account_digest text;
  action_provider_capability_rule_id text;
  action_provider_capability_rule_version integer;
  action_provider_supports_idempotency boolean;
  action_provider_idempotency_key_derivation_version text;
  action_budget_reservation_id text;
  action_cost_currency text;
  action_cost_source_key text;
  action_cost_source_version text;
  action_state text;
  action_effect_state text;
  action_provider_response_id text;
  action_provider_response_state text;
  rule_valid boolean;
  current_rule_valid boolean;
  latest_unknown_at timestamptz;
BEGIN
  SELECT budget_magnitude_kind, action_class, exposure_evidence_level, provider_key,
    provider_account_digest, provider_capability_rule_id, provider_capability_rule_version,
    provider_supports_idempotency, provider_idempotency_key_derivation_version,
    budget_reservation_id,
    cost_currency, cost_source_key, cost_source_version, state, effect_state,
    provider_response_id, provider_response_state
  INTO action_magnitude_kind, action_kind, action_evidence_level, action_provider,
    action_provider_account_digest, action_provider_capability_rule_id,
    action_provider_capability_rule_version, action_provider_supports_idempotency,
    action_provider_idempotency_key_derivation_version, action_budget_reservation_id,
    action_cost_currency, action_cost_source_key, action_cost_source_version,
    action_state, action_effect_state, action_provider_response_id,
    action_provider_response_state
  FROM external_actions WHERE operation_id = NEW.operation_id FOR UPDATE;

  IF NEW.reconciliation_evidence_kind IS NOT NULL THEN
    SELECT occurred_at INTO latest_unknown_at
    FROM external_action_attempts
    WHERE operation_id = NEW.operation_id
      AND event_kind IN ('outcome_unknown', 'lease_expired_unknown')
    ORDER BY occurred_at DESC, id DESC LIMIT 1;
    IF action_provider IS DISTINCT FROM NEW.reconciliation_provider_key
      OR action_provider_account_digest IS DISTINCT FROM NEW.reconciliation_provider_account_digest
      OR latest_unknown_at IS NULL
      OR NEW.reconciliation_evidence_observed_at < latest_unknown_at
      OR NEW.reconciliation_evidence_observed_at > NEW.occurred_at
    THEN
      RAISE EXCEPTION 'External action reconciliation evidence scope or chronology is invalid';
    END IF;
  END IF;

  IF NEW.event_kind = 'claimed' THEN
    SELECT EXISTS (
      SELECT 1
      FROM external_action_provider_acceptance_rules current_rule
      JOIN external_action_provider_acceptance_rule_versions rule
        ON rule.rule_id = current_rule.id AND rule.version = current_rule.version
      WHERE current_rule.id = NEW.acceptance_rule_id
        AND current_rule.version = NEW.acceptance_rule_version
        AND current_rule.provider_key = action_provider
        AND current_rule.provider_account_digest = action_provider_account_digest
        AND current_rule.action_class = action_kind
        AND current_rule.id = action_provider_capability_rule_id
        AND current_rule.version = action_provider_capability_rule_version
        AND current_rule.provider_supports_idempotency = action_provider_supports_idempotency
        AND current_rule.idempotency_key_derivation_version
          IS NOT DISTINCT FROM action_provider_idempotency_key_derivation_version
        AND current_rule.enabled = true
        AND rule.enabled = true
    ) INTO current_rule_valid;
    IF NOT COALESCE(current_rule_valid, false) THEN
      RAISE EXCEPTION 'External action claim lacks a current reviewed acceptance rule';
    END IF;
  END IF;

  IF NEW.actual_financial_exposure_cents IS NOT NULL THEN
    IF action_magnitude_kind IS DISTINCT FROM NEW.budget_magnitude_kind
      OR action_evidence_level IS DISTINCT FROM NEW.cost_evidence_level
      OR action_cost_currency IS DISTINCT FROM NEW.cost_currency
      OR action_cost_source_key IS DISTINCT FROM NEW.cost_source_key
      OR action_cost_source_version IS DISTINCT FROM NEW.cost_source_version
      OR (action_kind IN ('refund', 'credit') AND NEW.actual_financial_exposure_cents <= 0)
    THEN
      RAISE EXCEPTION 'External action financial exposure evidence is invalid';
    END IF;
    IF NEW.event_kind IN ('provider_accepted', 'reconciliation_confirmed_success') THEN
      SELECT EXISTS (
        SELECT 1 FROM external_action_provider_acceptance_rule_versions rule
        WHERE rule.rule_id = NEW.acceptance_rule_id
          AND rule.version = NEW.acceptance_rule_version
          AND rule.rule_id = action_provider_capability_rule_id
          AND rule.version = action_provider_capability_rule_version
          AND rule.provider_key = action_provider
          AND rule.provider_account_digest = action_provider_account_digest
          AND rule.action_class = action_kind
          AND rule.provider_supports_idempotency = action_provider_supports_idempotency
          AND rule.idempotency_key_derivation_version
            IS NOT DISTINCT FROM action_provider_idempotency_key_derivation_version
          AND rule.provider_response_state = NEW.provider_response_state
          AND rule.normalized_outcome = 'accepted' AND rule.enabled = true
      ) INTO rule_valid;
      IF action_state IS DISTINCT FROM 'succeeded'
        OR action_effect_state IS DISTINCT FROM 'accepted'
        OR action_budget_reservation_id IS DISTINCT FROM NEW.budget_reservation_id
        OR action_provider_response_id IS DISTINCT FROM NEW.provider_response_id
        OR action_provider_response_state IS DISTINCT FROM NEW.provider_response_state
        OR NEW.provider_normalized_outcome IS DISTINCT FROM 'accepted'
        OR NOT COALESCE(rule_valid, false)
      THEN
        RAISE EXCEPTION 'External action provider acceptance normalization is invalid';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER external_action_attempt_evidence_valid
BEFORE INSERT ON external_action_attempts
FOR EACH ROW EXECUTE FUNCTION validate_external_action_attempt_evidence();

CREATE OR REPLACE FUNCTION account_confirmed_external_action_effect()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reservation_state text;
  reservation_operation text;
  reservation_run_id text;
  reservation_correlation_id text;
  reservation_estimate integer;
  reservation_control_version integer;
  authorization_valid boolean;
  cap_overrun boolean;
  effect_overrun boolean;
  detected_authorization_breach boolean;
  control_kill_switch boolean;
  resulting_control_version integer;
  allocation_count integer;
  updated_window_count integer;
BEGIN
  IF NEW.event_kind NOT IN ('provider_accepted', 'reconciliation_confirmed_success') THEN
    RETURN NEW;
  END IF;

  SELECT state, operation_key, automation_run_id, correlation_id, estimated_cost_cents,
    control_version
  INTO reservation_state, reservation_operation, reservation_run_id,
    reservation_correlation_id, reservation_estimate, reservation_control_version
  FROM automation_budget_reservations
  WHERE id = NEW.budget_reservation_id
  FOR UPDATE;

  IF reservation_state = 'committed' THEN
    IF NOT EXISTS (
      SELECT 1 FROM automation_budget_reservations
      WHERE id = NEW.budget_reservation_id
        AND actual_cost_cents = NEW.actual_financial_exposure_cents
        AND commit_evidence_kind = 'external_action'
        AND commit_evidence_reference = NEW.operation_id
    ) THEN
      RAISE EXCEPTION 'External action accounting conflicts with committed budget truth';
    END IF;
    RETURN NEW;
  END IF;
  IF reservation_state IS DISTINCT FROM 'reserved'
    OR reservation_operation IS DISTINCT FROM NEW.operation_id
  THEN
    RAISE EXCEPTION 'External action accepted effect lacks reserved budget authority';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM external_action_attempts claim
    WHERE claim.operation_id = NEW.operation_id
      AND claim.attempt = NEW.attempt
      AND claim.event_kind = 'claimed'
      AND claim.budget_reservation_id = NEW.budget_reservation_id
      AND claim.budget_control_version = reservation_control_version
      AND claim.budget_rechecked_at <= claim.occurred_at
      AND claim.occurred_at <= claim.budget_authorization_expires_at
      AND claim.occurred_at <= NEW.occurred_at
      AND claim.acceptance_rule_id = NEW.acceptance_rule_id
      AND claim.acceptance_rule_version = NEW.acceptance_rule_version
  ) INTO authorization_valid;
  detected_authorization_breach := NOT COALESCE(authorization_valid, false);

  PERFORM cap.id
  FROM automation_budget_reservation_allocations allocation
  JOIN automation_budget_caps cap ON cap.id = allocation.cap_id
  WHERE allocation.reservation_id = NEW.budget_reservation_id
  ORDER BY cap.id
  FOR UPDATE OF cap;

  PERFORM budget_window.cap_id
  FROM automation_budget_reservation_allocations allocation
  JOIN automation_budget_windows budget_window
    ON budget_window.cap_id = allocation.cap_id
    AND budget_window.period_start = allocation.period_start
  WHERE allocation.reservation_id = NEW.budget_reservation_id
  ORDER BY budget_window.cap_id
  FOR UPDATE OF budget_window;

  SELECT COALESCE(bool_or(
    budget_window.committed_cents + NEW.actual_financial_exposure_cents
      > cap.limit_cents::bigint + budget_window.override_cents
  ), false)
  INTO cap_overrun
  FROM automation_budget_reservation_allocations allocation
  JOIN automation_budget_caps cap ON cap.id = allocation.cap_id
  JOIN automation_budget_windows budget_window
    ON budget_window.cap_id = allocation.cap_id
    AND budget_window.period_start = allocation.period_start
  WHERE allocation.reservation_id = NEW.budget_reservation_id;
  effect_overrun := NEW.actual_financial_exposure_cents > reservation_estimate OR cap_overrun;

  SELECT count(*)::integer INTO allocation_count
  FROM automation_budget_reservation_allocations
  WHERE reservation_id = NEW.budget_reservation_id;

  UPDATE automation_budget_windows budget_window
  SET reserved_cents = budget_window.reserved_cents - allocation.reserved_cents,
      committed_cents = budget_window.committed_cents + NEW.actual_financial_exposure_cents,
      updated_at = NEW.occurred_at
  FROM automation_budget_reservation_allocations allocation
  WHERE allocation.reservation_id = NEW.budget_reservation_id
    AND budget_window.cap_id = allocation.cap_id
    AND budget_window.period_start = allocation.period_start
    AND budget_window.reserved_cents >= allocation.reserved_cents;
  GET DIAGNOSTICS updated_window_count = ROW_COUNT;
  IF allocation_count = 0 OR updated_window_count <> allocation_count THEN
    RAISE EXCEPTION 'External action budget allocation is inconsistent';
  END IF;

  UPDATE automation_budget_reservations
  SET state = 'committed', actual_cost_cents = NEW.actual_financial_exposure_cents,
      committed_at = NEW.occurred_at, commit_evidence_kind = 'external_action',
      commit_evidence_reference = NEW.operation_id, overrun_detected = effect_overrun,
      authorization_breach = detected_authorization_breach
  WHERE id = NEW.budget_reservation_id AND state = 'reserved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'External action budget commit lost its reservation';
  END IF;

  UPDATE automation_runs
  SET state = 'completed', actual_cost_cents = NEW.actual_financial_exposure_cents,
      completed_at = NEW.occurred_at
  WHERE id = reservation_run_id;

  SELECT kill_switch, version INTO control_kill_switch, resulting_control_version
  FROM automation_global_control WHERE control_key = 'global' FOR UPDATE;
  IF (effect_overrun OR detected_authorization_breach) AND NOT control_kill_switch THEN
    UPDATE automation_global_control
    SET kill_switch = true, updated_by_person_id = NULL, updated_at = NEW.occurred_at,
        version = version + 1
    WHERE control_key = 'global'
    RETURNING version INTO resulting_control_version;
    INSERT INTO automation_global_control_history(
      id, kill_switch, updated_by_person_id, recorded_at, control_version
    ) VALUES (
      NEW.id || ':external-effect-stop', true, NULL, NEW.occurred_at,
      resulting_control_version
    );
  END IF;

  INSERT INTO automation_budget_events(
    id, event_kind, reservation_id, operation_key, amount_cents, control_version,
    actor_person_id, correlation_id, recorded_at
  ) VALUES (
    NEW.id || ':budget-committed', 'committed', NEW.budget_reservation_id,
    NEW.operation_id, NEW.actual_financial_exposure_cents, resulting_control_version,
    NULL, reservation_correlation_id, NEW.occurred_at
  );
  IF effect_overrun THEN
    INSERT INTO automation_budget_events(
      id, event_kind, reservation_id, operation_key, amount_cents, control_version,
      actor_person_id, reason_code, correlation_id, recorded_at
    ) VALUES (
      NEW.id || ':budget-overrun', 'overrun', NEW.budget_reservation_id,
      NEW.operation_id,
      GREATEST(NEW.actual_financial_exposure_cents - reservation_estimate, 0),
      resulting_control_version, NULL, 'actual_exposure_exceeded_reservation',
      reservation_correlation_id, NEW.occurred_at
    );
  END IF;
  IF detected_authorization_breach THEN
    INSERT INTO automation_budget_events(
      id, event_kind, reservation_id, operation_key, amount_cents, control_version,
      actor_person_id, reason_code, correlation_id, recorded_at
    ) VALUES (
      NEW.id || ':budget-authorization-breach', 'authorization_breach',
      NEW.budget_reservation_id, NEW.operation_id,
      NEW.actual_financial_exposure_cents, resulting_control_version, NULL,
      'external_dispatch_authority_unproven', reservation_correlation_id, NEW.occurred_at
    );
  END IF;

  INSERT INTO audit_events(
    id, household_id, actor_person_id, session_audience, action, resource_type,
    resource_id, outcome, metadata, correlation_id, occurred_at
  ) VALUES (
    NEW.id || ':budget-audit', NULL, NULL, NULL,
    'business_os.automation_budget_committed', 'automation_budget_reservation',
    NEW.budget_reservation_id, 'completed',
    jsonb_build_object(
      'actualCostCents', NEW.actual_financial_exposure_cents,
      'authorizationBreach', detected_authorization_breach,
      'overrun', effect_overrun
    ),
    reservation_correlation_id, NEW.occurred_at
  );
  INSERT INTO outbox_events(
    id, event_type, event_version, aggregate_type, aggregate_id, household_id,
    actor_person_id, correlation_id, classification, payload, occurred_at,
    available_at, next_attempt_at
  ) VALUES (
    NEW.id || ':budget-event', 'business_os.automation_budget_committed', 1,
    'automation_budget_reservation', NEW.budget_reservation_id, NULL, NULL,
    reservation_correlation_id, 'internal',
    jsonb_build_object(
      'actualCostCents', NEW.actual_financial_exposure_cents,
      'authorizationBreach', detected_authorization_breach,
      'overrun', effect_overrun
    ),
    NEW.occurred_at, NEW.occurred_at, NEW.occurred_at
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER external_action_accepted_effect_accounted
AFTER INSERT ON external_action_attempts
FOR EACH ROW EXECUTE FUNCTION account_confirmed_external_action_effect();

CREATE OR REPLACE FUNCTION validate_external_action_registration()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reservation_operation text;
  reservation_digest text;
  reservation_action text;
  reservation_tool text;
  reservation_estimated_cost integer;
  reservation_state text;
  reservation_expires_at timestamptz;
  exposure_operation text;
  exposure_reservation text;
  exposure_action text;
  exposure_provider text;
  exposure_provider_account_digest text;
  exposure_provider_capability_rule_id text;
  exposure_provider_capability_rule_version integer;
  exposure_provider_supports_idempotency boolean;
  exposure_provider_idempotency_key text;
  exposure_provider_idempotency_key_derivation_version text;
  exposure_upper_bound integer;
  exposure_magnitude text;
  exposure_currency text;
  exposure_source_key text;
  exposure_source_version text;
  exposure_level text;
  exposure_expires_at timestamptz;
  exposure_used_at timestamptz;
BEGIN
  PERFORM employee.id
  FROM employee_assignments employee
  JOIN organizations organization ON organization.id = employee.organization_id
  WHERE employee.person_id = NEW.registered_by_person_id
    AND employee.role = 'hq_owner' AND employee.status = 'active'
    AND organization.kind = 'internal'
  ORDER BY employee.id LIMIT 1
  FOR UPDATE OF employee, organization;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'External action registration authority is unavailable';
  END IF;
  SELECT operation_key, envelope_digest, action_key, tool_key, estimated_cost_cents, state, expires_at
  INTO reservation_operation, reservation_digest, reservation_action, reservation_tool,
    reservation_estimated_cost, reservation_state, reservation_expires_at
  FROM automation_budget_reservations
  WHERE id = NEW.budget_reservation_id
  FOR UPDATE;
  IF reservation_operation IS NULL
    OR reservation_operation IS DISTINCT FROM NEW.operation_id
    OR reservation_digest IS DISTINCT FROM NEW.budget_envelope_digest
    OR reservation_action IS DISTINCT FROM NEW.automation_action_key
    OR reservation_tool IS DISTINCT FROM NEW.automation_tool_key
    OR reservation_estimated_cost IS DISTINCT FROM NEW.financial_exposure_upper_bound_cents
    OR reservation_state IS DISTINCT FROM 'reserved'
    OR reservation_expires_at <= clock_timestamp()
  THEN
    RAISE EXCEPTION 'External action budget envelope is invalid';
  END IF;
  SELECT operation_id, budget_reservation_id, action_class, provider_key,
    provider_account_digest,
    provider_capability_rule_id, provider_capability_rule_version,
    provider_supports_idempotency, provider_idempotency_key,
    provider_idempotency_key_derivation_version,
    financial_exposure_upper_bound_cents, budget_magnitude_kind, cost_currency,
    cost_source_key, cost_source_version, evidence_level, expires_at, used_at
  INTO exposure_operation, exposure_reservation, exposure_action, exposure_provider,
    exposure_provider_account_digest,
    exposure_provider_capability_rule_id, exposure_provider_capability_rule_version,
    exposure_provider_supports_idempotency, exposure_provider_idempotency_key,
    exposure_provider_idempotency_key_derivation_version,
    exposure_upper_bound, exposure_magnitude, exposure_currency, exposure_source_key,
    exposure_source_version, exposure_level, exposure_expires_at, exposure_used_at
  FROM external_action_exposure_authorizations
  WHERE id = NEW.exposure_authorization_id
  FOR UPDATE;
  IF exposure_operation IS NULL
    OR exposure_operation IS DISTINCT FROM NEW.operation_id
    OR exposure_reservation IS DISTINCT FROM NEW.budget_reservation_id
    OR exposure_action IS DISTINCT FROM NEW.action_class
    OR exposure_provider IS DISTINCT FROM NEW.provider_key
    OR exposure_provider_account_digest IS DISTINCT FROM NEW.provider_account_digest
    OR exposure_provider_capability_rule_id IS DISTINCT FROM NEW.provider_capability_rule_id
    OR exposure_provider_capability_rule_version
      IS DISTINCT FROM NEW.provider_capability_rule_version
    OR exposure_provider_supports_idempotency
      IS DISTINCT FROM NEW.provider_supports_idempotency
    OR exposure_provider_idempotency_key IS DISTINCT FROM NEW.provider_idempotency_key
    OR exposure_provider_idempotency_key_derivation_version
      IS DISTINCT FROM NEW.provider_idempotency_key_derivation_version
    OR exposure_upper_bound IS DISTINCT FROM NEW.financial_exposure_upper_bound_cents
    OR exposure_magnitude IS DISTINCT FROM NEW.budget_magnitude_kind
    OR exposure_currency IS DISTINCT FROM NEW.cost_currency
    OR exposure_source_key IS DISTINCT FROM NEW.cost_source_key
    OR exposure_source_version IS DISTINCT FROM NEW.cost_source_version
    OR exposure_level IS DISTINCT FROM NEW.exposure_evidence_level
    OR exposure_expires_at <= clock_timestamp()
    OR exposure_used_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'External action exposure authority is invalid';
  END IF;
  IF NEW.scope_kind = 'company' AND NEW.scope_id <> 'global' THEN
    RAISE EXCEPTION 'External action company scope is invalid';
  ELSIF NEW.scope_kind = 'household'
    AND NOT EXISTS (SELECT 1 FROM households WHERE id = NEW.scope_id) THEN
    RAISE EXCEPTION 'External action household scope is invalid';
  ELSIF NEW.scope_kind = 'organization'
    AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = NEW.scope_id) THEN
    RAISE EXCEPTION 'External action organization scope is invalid';
  END IF;
  IF NEW.origin_kind = 'durable_job'
    AND NOT EXISTS (SELECT 1 FROM durable_jobs WHERE id = NEW.origin_id) THEN
    RAISE EXCEPTION 'External action origin is invalid';
  ELSIF NEW.origin_kind = 'outbox_event'
    AND NOT EXISTS (SELECT 1 FROM outbox_events WHERE id = NEW.origin_id) THEN
    RAISE EXCEPTION 'External action origin is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER external_action_registration_valid
BEFORE INSERT ON external_actions
FOR EACH ROW EXECUTE FUNCTION validate_external_action_registration();

CREATE OR REPLACE FUNCTION consume_external_action_exposure_authorization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE external_action_exposure_authorizations
  SET used_at = NEW.created_at
  WHERE id = NEW.exposure_authorization_id AND used_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'External action exposure authority is unavailable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER external_action_exposure_authorization_consumed
AFTER INSERT ON external_actions
FOR EACH ROW EXECUTE FUNCTION consume_external_action_exposure_authorization();

CREATE OR REPLACE FUNCTION validate_external_action_owner_authority()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor_id text;
BEGIN
  actor_id := CASE
    WHEN TG_TABLE_NAME IN (
      'external_action_provider_acceptance_rules',
      'external_action_provider_acceptance_rule_versions'
    )
      THEN to_jsonb(NEW)->>'reviewed_by_person_id'
    WHEN TG_TABLE_NAME = 'external_action_reconciliation_authorizations'
      THEN to_jsonb(NEW)->>'actor_person_id'
    WHEN TG_TABLE_NAME = 'external_action_exposure_authorizations'
      THEN to_jsonb(NEW)->>'authorized_by_person_id'
    ELSE NULL
  END;
  PERFORM employee.id
  FROM employee_assignments employee
  JOIN organizations organization ON organization.id = employee.organization_id
  WHERE employee.person_id = actor_id
    AND employee.role = 'hq_owner' AND employee.status = 'active'
    AND organization.kind = 'internal'
  ORDER BY employee.id LIMIT 1
  FOR UPDATE OF employee, organization;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'External action owner authority is unavailable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER external_action_acceptance_rules_owner_valid
BEFORE INSERT OR UPDATE ON external_action_provider_acceptance_rules
FOR EACH ROW EXECUTE FUNCTION validate_external_action_owner_authority();

CREATE TRIGGER external_action_acceptance_rule_versions_owner_valid
BEFORE INSERT ON external_action_provider_acceptance_rule_versions
FOR EACH ROW EXECUTE FUNCTION validate_external_action_owner_authority();

CREATE OR REPLACE FUNCTION validate_external_action_acceptance_rule_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_rule external_action_provider_acceptance_rules%ROWTYPE;
BEGIN
  SELECT * INTO current_rule
  FROM external_action_provider_acceptance_rules
  WHERE id = NEW.rule_id FOR UPDATE;
  IF current_rule.id IS NULL
    OR NEW.provider_key IS DISTINCT FROM current_rule.provider_key
    OR NEW.provider_account_digest IS DISTINCT FROM current_rule.provider_account_digest
    OR NEW.action_class IS DISTINCT FROM current_rule.action_class
    OR NEW.provider_response_state IS DISTINCT FROM current_rule.provider_response_state
    OR NEW.normalized_outcome IS DISTINCT FROM current_rule.normalized_outcome
    OR NEW.provider_supports_idempotency
      IS DISTINCT FROM current_rule.provider_supports_idempotency
    OR NEW.idempotency_key_derivation_version
      IS DISTINCT FROM current_rule.idempotency_key_derivation_version
    OR NEW.enabled IS DISTINCT FROM current_rule.enabled
    OR NEW.version IS DISTINCT FROM current_rule.version
    OR NEW.reviewed_by_person_id IS DISTINCT FROM current_rule.reviewed_by_person_id
  THEN
    RAISE EXCEPTION 'External action acceptance rule version conflicts with its projection';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER external_action_acceptance_rule_versions_projection_valid
BEFORE INSERT ON external_action_provider_acceptance_rule_versions
FOR EACH ROW EXECUTE FUNCTION validate_external_action_acceptance_rule_version();

CREATE TRIGGER external_action_reconciliation_authorizations_owner_valid
BEFORE INSERT ON external_action_reconciliation_authorizations
FOR EACH ROW EXECUTE FUNCTION validate_external_action_owner_authority();

CREATE TRIGGER external_action_exposure_authorizations_owner_valid
BEFORE INSERT ON external_action_exposure_authorizations
FOR EACH ROW EXECUTE FUNCTION validate_external_action_owner_authority();

CREATE OR REPLACE FUNCTION validate_external_action_provider_capability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  capability_valid boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM external_action_provider_acceptance_rules current_rule
    JOIN external_action_provider_acceptance_rule_versions rule
      ON rule.rule_id = current_rule.id AND rule.version = current_rule.version
    WHERE current_rule.id = NEW.provider_capability_rule_id
      AND current_rule.version = NEW.provider_capability_rule_version
      AND current_rule.provider_key = NEW.provider_key
      AND current_rule.provider_account_digest = NEW.provider_account_digest
      AND current_rule.action_class = NEW.action_class
      AND current_rule.normalized_outcome = 'accepted'
      AND current_rule.provider_supports_idempotency = NEW.provider_supports_idempotency
      AND current_rule.idempotency_key_derivation_version
        IS NOT DISTINCT FROM NEW.provider_idempotency_key_derivation_version
      AND current_rule.enabled = true
      AND rule.enabled = true
  ) INTO capability_valid;
  IF NOT COALESCE(capability_valid, false) THEN
    RAISE EXCEPTION 'External action provider capability is unavailable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER external_action_exposure_provider_capability_valid
BEFORE INSERT ON external_action_exposure_authorizations
FOR EACH ROW EXECUTE FUNCTION validate_external_action_provider_capability();

CREATE OR REPLACE FUNCTION reject_external_action_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'External action evidence is append-only';
END;
$$;

CREATE TRIGGER external_action_attempts_immutable
BEFORE UPDATE OR DELETE ON external_action_attempts
FOR EACH ROW EXECUTE FUNCTION reject_external_action_evidence_mutation();

CREATE TRIGGER external_action_acceptance_rule_versions_immutable
BEFORE UPDATE OR DELETE ON external_action_provider_acceptance_rule_versions
FOR EACH ROW EXECUTE FUNCTION reject_external_action_evidence_mutation();

CREATE OR REPLACE FUNCTION protect_external_action_exposure_authorization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'External action exposure authorization is append-only';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.budget_reservation_id IS DISTINCT FROM OLD.budget_reservation_id
    OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
    OR NEW.action_class IS DISTINCT FROM OLD.action_class
    OR NEW.provider_key IS DISTINCT FROM OLD.provider_key
    OR NEW.provider_account_digest IS DISTINCT FROM OLD.provider_account_digest
    OR NEW.provider_capability_rule_id IS DISTINCT FROM OLD.provider_capability_rule_id
    OR NEW.provider_capability_rule_version
      IS DISTINCT FROM OLD.provider_capability_rule_version
    OR NEW.provider_supports_idempotency IS DISTINCT FROM OLD.provider_supports_idempotency
    OR NEW.provider_idempotency_key IS DISTINCT FROM OLD.provider_idempotency_key
    OR NEW.provider_idempotency_key_derivation_version
      IS DISTINCT FROM OLD.provider_idempotency_key_derivation_version
    OR NEW.financial_exposure_upper_bound_cents
      IS DISTINCT FROM OLD.financial_exposure_upper_bound_cents
    OR NEW.budget_magnitude_kind IS DISTINCT FROM OLD.budget_magnitude_kind
    OR NEW.cost_currency IS DISTINCT FROM OLD.cost_currency
    OR NEW.cost_source_key IS DISTINCT FROM OLD.cost_source_key
    OR NEW.cost_source_version IS DISTINCT FROM OLD.cost_source_version
    OR NEW.evidence_level IS DISTINCT FROM OLD.evidence_level
    OR NEW.capability_digest IS DISTINCT FROM OLD.capability_digest
    OR NEW.authorized_by_person_id IS DISTINCT FROM OLD.authorized_by_person_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR OLD.used_at IS NOT NULL
    OR NEW.used_at IS NULL
  THEN
    RAISE EXCEPTION 'External action exposure authorization is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER external_action_exposure_authorizations_protected
BEFORE UPDATE OR DELETE ON external_action_exposure_authorizations
FOR EACH ROW EXECUTE FUNCTION protect_external_action_exposure_authorization();

CREATE OR REPLACE FUNCTION protect_external_action_acceptance_rule()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'External action acceptance rule cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.provider_key IS DISTINCT FROM OLD.provider_key
    OR NEW.provider_account_digest IS DISTINCT FROM OLD.provider_account_digest
    OR NEW.action_class IS DISTINCT FROM OLD.action_class
    OR NEW.provider_response_state IS DISTINCT FROM OLD.provider_response_state
    OR NEW.normalized_outcome IS DISTINCT FROM OLD.normalized_outcome
    OR NEW.version <> OLD.version + 1
    OR NEW.updated_at < OLD.updated_at
  THEN
    RAISE EXCEPTION 'External action acceptance rule identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER external_action_acceptance_rules_protected
BEFORE UPDATE OR DELETE ON external_action_provider_acceptance_rules
FOR EACH ROW EXECUTE FUNCTION protect_external_action_acceptance_rule();

CREATE OR REPLACE FUNCTION protect_external_action_reconciliation_authorization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'External action reconciliation authorization is append-only';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
    OR NEW.budget_reservation_id IS DISTINCT FROM OLD.budget_reservation_id
    OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
    OR NEW.scope_id IS DISTINCT FROM OLD.scope_id
    OR NEW.requested_outcome IS DISTINCT FROM OLD.requested_outcome
    OR NEW.capability_digest IS DISTINCT FROM OLD.capability_digest
    OR NEW.actor_person_id IS DISTINCT FROM OLD.actor_person_id
    OR NEW.audience IS DISTINCT FROM OLD.audience
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR OLD.used_at IS NOT NULL
    OR NEW.used_at IS NULL
  THEN
    RAISE EXCEPTION 'External action reconciliation authorization is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER external_action_reconciliation_authorizations_protected
BEFORE UPDATE OR DELETE ON external_action_reconciliation_authorizations
FOR EACH ROW EXECUTE FUNCTION protect_external_action_reconciliation_authorization();

CREATE OR REPLACE FUNCTION protect_external_action_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'External action ledger cannot be deleted';
  END IF;
  IF NEW.operation_id IS DISTINCT FROM OLD.operation_id
    OR NEW.budget_reservation_id IS DISTINCT FROM OLD.budget_reservation_id
    OR NEW.exposure_authorization_id IS DISTINCT FROM OLD.exposure_authorization_id
    OR NEW.budget_envelope_digest IS DISTINCT FROM OLD.budget_envelope_digest
    OR NEW.automation_action_key IS DISTINCT FROM OLD.automation_action_key
    OR NEW.automation_tool_key IS DISTINCT FROM OLD.automation_tool_key
    OR NEW.financial_exposure_upper_bound_cents
      IS DISTINCT FROM OLD.financial_exposure_upper_bound_cents
    OR NEW.budget_magnitude_kind IS DISTINCT FROM OLD.budget_magnitude_kind
    OR NEW.cost_currency IS DISTINCT FROM OLD.cost_currency
    OR NEW.cost_source_key IS DISTINCT FROM OLD.cost_source_key
    OR NEW.cost_source_version IS DISTINCT FROM OLD.cost_source_version
    OR NEW.exposure_evidence_level IS DISTINCT FROM OLD.exposure_evidence_level
    OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
    OR NEW.scope_id IS DISTINCT FROM OLD.scope_id
    OR NEW.origin_kind IS DISTINCT FROM OLD.origin_kind
    OR NEW.origin_id IS DISTINCT FROM OLD.origin_id
    OR NEW.registered_by_person_id IS DISTINCT FROM OLD.registered_by_person_id
    OR NEW.registration_audience IS DISTINCT FROM OLD.registration_audience
    OR NEW.action_class IS DISTINCT FROM OLD.action_class
    OR NEW.provider_key IS DISTINCT FROM OLD.provider_key
    OR NEW.provider_account_digest IS DISTINCT FROM OLD.provider_account_digest
    OR NEW.provider_capability_rule_id IS DISTINCT FROM OLD.provider_capability_rule_id
    OR NEW.provider_capability_rule_version
      IS DISTINCT FROM OLD.provider_capability_rule_version
    OR NEW.provider_supports_idempotency IS DISTINCT FROM OLD.provider_supports_idempotency
    OR NEW.provider_idempotency_key IS DISTINCT FROM OLD.provider_idempotency_key
    OR NEW.provider_idempotency_key_derivation_version
      IS DISTINCT FROM OLD.provider_idempotency_key_derivation_version
    OR NEW.intent_fingerprint IS DISTINCT FROM OLD.intent_fingerprint
    OR NEW.max_attempts IS DISTINCT FROM OLD.max_attempts
    OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'External action identity and retry policy are immutable';
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'External action time cannot move backward';
  END IF;
  IF NOT (
    (OLD.state IN ('pending', 'retry_wait') AND NEW.state IN ('in_flight', 'canceled', 'failed_terminal'))
    OR (OLD.state = 'in_flight' AND NEW.state IN (
      'outcome_unknown', 'succeeded', 'failed_terminal', 'canceled'
    ))
    OR (OLD.state = 'outcome_unknown' AND NEW.state IN (
      'outcome_unknown', 'retry_wait', 'succeeded', 'failed_terminal', 'canceled'
    ))
  ) THEN
    RAISE EXCEPTION 'External action state transition is not permitted';
  END IF;
  IF NEW.state = 'in_flight' THEN
    IF NEW.attempts <> OLD.attempts + 1 OR NEW.effect_state <> 'unknown' THEN
      RAISE EXCEPTION 'External action claims increment once and become outcome-unknown';
    END IF;
  ELSIF NEW.attempts <> OLD.attempts THEN
    RAISE EXCEPTION 'External action attempts change only when claimed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER external_actions_identity_immutable
BEFORE UPDATE OR DELETE ON external_actions
FOR EACH ROW EXECUTE FUNCTION protect_external_action_identity();
