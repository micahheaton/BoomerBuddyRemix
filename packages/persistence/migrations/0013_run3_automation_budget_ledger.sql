ALTER TABLE autonomy_policies
  RENAME COLUMN budget_cents TO max_cost_per_operation_cents;

ALTER TABLE autonomy_policy_versions
  RENAME COLUMN budget_cents TO max_cost_per_operation_cents;

ALTER TABLE automation_global_control
  ADD COLUMN version integer;

ALTER TABLE automation_global_control_history
  ADD COLUMN control_version integer;

WITH ordered_history AS (
  SELECT id, row_number() OVER (ORDER BY recorded_at, id)::integer AS control_version
  FROM automation_global_control_history
)
UPDATE automation_global_control_history AS history
SET control_version = ordered_history.control_version
FROM ordered_history
WHERE history.id = ordered_history.id;

UPDATE automation_global_control
SET version = COALESCE(
  (SELECT max(control_version) + 1 FROM automation_global_control_history),
  1
);

INSERT INTO automation_global_control_history(
  id, kill_switch, updated_by_person_id, recorded_at, control_version
)
SELECT
  'automation-global-control-migration-snapshot-0013', kill_switch,
  updated_by_person_id, updated_at, version
FROM automation_global_control
WHERE control_key = 'global';

ALTER TABLE automation_global_control
  ALTER COLUMN version SET NOT NULL;

ALTER TABLE automation_global_control
  ADD CONSTRAINT automation_global_control_version_positive CHECK (version > 0);

ALTER TABLE automation_global_control_history
  ALTER COLUMN control_version SET NOT NULL;

ALTER TABLE automation_global_control_history
  ADD CONSTRAINT automation_global_control_history_version_positive
  CHECK (control_version > 0);

CREATE UNIQUE INDEX automation_global_control_history_version_idx
  ON automation_global_control_history(control_version);

ALTER TABLE automation_runs
  ADD COLUMN evaluation_only boolean NOT NULL DEFAULT true;

ALTER TABLE automation_runs
  ALTER COLUMN actual_cost_cents TYPE bigint;

CREATE TABLE automation_budget_caps (
  id text PRIMARY KEY,
  scope_kind text NOT NULL
    CHECK (scope_kind IN ('company', 'agent', 'action', 'tool', 'policy')),
  scope_key text NOT NULL,
  period_kind text NOT NULL CHECK (period_kind IN ('day', 'month')),
  limit_cents integer NOT NULL CHECK (limit_cents >= 0),
  enabled boolean NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  approved_by_person_id text NOT NULL REFERENCES persons(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(scope_kind, scope_key, period_kind),
  CHECK (scope_kind <> 'company' OR scope_key = 'global')
);

CREATE TABLE automation_budget_windows (
  cap_id text NOT NULL REFERENCES automation_budget_caps(id) ON DELETE RESTRICT,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  reserved_cents integer NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0),
  committed_cents bigint NOT NULL DEFAULT 0 CHECK (committed_cents >= 0),
  override_cents bigint NOT NULL DEFAULT 0 CHECK (override_cents >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(cap_id, period_start),
  CHECK (period_end > period_start)
);

CREATE TABLE automation_budget_reservations (
  id text PRIMARY KEY,
  operation_key text NOT NULL UNIQUE,
  envelope_digest text NOT NULL CHECK (envelope_digest ~ '^[a-f0-9]{64}$'),
  automation_run_id text NOT NULL UNIQUE REFERENCES automation_runs(id) ON DELETE RESTRICT,
  policy_id text NOT NULL REFERENCES autonomy_policies(id) ON DELETE RESTRICT,
  policy_version integer NOT NULL CHECK (policy_version > 0),
  agent_key text NOT NULL,
  action_key text NOT NULL,
  tool_key text NOT NULL,
  data_classes jsonb NOT NULL CHECK (jsonb_typeof(data_classes) = 'array'),
  estimated_cost_cents integer NOT NULL CHECK (estimated_cost_cents >= 0),
  state text NOT NULL CHECK (state IN ('reserved', 'committed', 'released')),
  actual_cost_cents bigint CHECK (actual_cost_cents IS NULL OR actual_cost_cents >= 0),
  reserved_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  execution_rechecked_at timestamptz,
  execution_authorization_expires_at timestamptz,
  control_version integer,
  committed_at timestamptz,
  released_at timestamptz,
  terminal_reason_code text,
  commit_evidence_kind text CHECK (
    commit_evidence_kind IS NULL OR commit_evidence_kind IN ('local_simulation', 'external_action')
  ),
  commit_evidence_reference text,
  overrun_detected boolean NOT NULL DEFAULT false,
  authorization_breach boolean NOT NULL DEFAULT false,
  correlation_id text NOT NULL,
  CHECK (expires_at > reserved_at),
  CHECK (
    (execution_rechecked_at IS NULL AND execution_authorization_expires_at IS NULL AND control_version IS NULL)
    OR
    (execution_rechecked_at IS NOT NULL AND execution_authorization_expires_at > execution_rechecked_at
      AND control_version IS NOT NULL)
  ),
  CHECK (
    (state = 'reserved' AND actual_cost_cents IS NULL AND committed_at IS NULL AND released_at IS NULL)
    OR
    (state = 'committed' AND actual_cost_cents IS NOT NULL AND committed_at IS NOT NULL
      AND released_at IS NULL AND terminal_reason_code IS NULL
      AND commit_evidence_kind IS NOT NULL AND commit_evidence_reference IS NOT NULL)
    OR
    (state = 'released' AND actual_cost_cents IS NULL AND committed_at IS NULL
      AND released_at IS NOT NULL AND terminal_reason_code IS NOT NULL)
  )
);

CREATE TABLE automation_budget_reservation_allocations (
  reservation_id text NOT NULL REFERENCES automation_budget_reservations(id) ON DELETE RESTRICT,
  cap_id text NOT NULL,
  period_start timestamptz NOT NULL,
  cap_version integer NOT NULL CHECK (cap_version > 0),
  reserved_cents integer NOT NULL CHECK (reserved_cents >= 0),
  PRIMARY KEY(reservation_id, cap_id),
  FOREIGN KEY(cap_id, period_start)
    REFERENCES automation_budget_windows(cap_id, period_start) ON DELETE RESTRICT
);

CREATE TABLE automation_budget_events (
  id text PRIMARY KEY,
  event_kind text NOT NULL CHECK (event_kind IN (
    'cap_created', 'cap_changed', 'cap_disabled', 'window_override',
    'reservation_denied', 'reserved', 'execution_rechecked',
    'committed', 'released', 'overrun', 'authorization_breach'
  )),
  reservation_id text REFERENCES automation_budget_reservations(id) ON DELETE RESTRICT,
  cap_id text REFERENCES automation_budget_caps(id) ON DELETE RESTRICT,
  period_start timestamptz,
  operation_key text,
  amount_cents bigint CHECK (amount_cents IS NULL OR amount_cents >= 0),
  cap_version integer CHECK (cap_version IS NULL OR cap_version > 0),
  control_version integer CHECK (control_version IS NULL OR control_version > 0),
  actor_person_id text REFERENCES persons(id),
  reason_code text,
  correlation_id text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CHECK ((cap_id IS NULL AND period_start IS NULL) OR cap_id IS NOT NULL)
);

CREATE INDEX automation_budget_events_reservation_idx
  ON automation_budget_events(reservation_id, recorded_at);

CREATE INDEX automation_budget_events_cap_window_idx
  ON automation_budget_events(cap_id, period_start, recorded_at);

CREATE UNIQUE INDEX automation_budget_override_operation_idx
  ON automation_budget_events(operation_key)
  WHERE event_kind = 'window_override';

CREATE FUNCTION reject_automation_budget_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Automation budget evidence is append-only';
END;
$$;

CREATE TRIGGER automation_budget_events_immutable
BEFORE UPDATE OR DELETE ON automation_budget_events
FOR EACH ROW EXECUTE FUNCTION reject_automation_budget_history_mutation();

CREATE TRIGGER automation_budget_allocations_immutable
BEFORE UPDATE OR DELETE ON automation_budget_reservation_allocations
FOR EACH ROW EXECUTE FUNCTION reject_automation_budget_history_mutation();

CREATE FUNCTION protect_automation_budget_cap_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Automation budget cap cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
    OR NEW.scope_key IS DISTINCT FROM OLD.scope_key
    OR NEW.period_kind IS DISTINCT FROM OLD.period_kind
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.version <> OLD.version + 1
    OR NEW.updated_at < OLD.updated_at
  THEN
    RAISE EXCEPTION 'Automation budget cap identity/version is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER automation_budget_caps_identity_protected
BEFORE UPDATE OR DELETE ON automation_budget_caps
FOR EACH ROW EXECUTE FUNCTION protect_automation_budget_cap_identity();

CREATE FUNCTION protect_automation_budget_reservation_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Automation budget reservation cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.operation_key IS DISTINCT FROM OLD.operation_key
    OR NEW.envelope_digest IS DISTINCT FROM OLD.envelope_digest
    OR NEW.automation_run_id IS DISTINCT FROM OLD.automation_run_id
    OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
    OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
    OR NEW.agent_key IS DISTINCT FROM OLD.agent_key
    OR NEW.action_key IS DISTINCT FROM OLD.action_key
    OR NEW.tool_key IS DISTINCT FROM OLD.tool_key
    OR NEW.data_classes IS DISTINCT FROM OLD.data_classes
    OR NEW.estimated_cost_cents IS DISTINCT FROM OLD.estimated_cost_cents
    OR NEW.reserved_at IS DISTINCT FROM OLD.reserved_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
  THEN
    RAISE EXCEPTION 'Automation budget reservation envelope is immutable';
  END IF;
  IF OLD.state <> 'reserved' THEN
    RAISE EXCEPTION 'Terminal automation budget reservation is immutable';
  END IF;
  IF NEW.state NOT IN ('reserved', 'committed', 'released') THEN
    RAISE EXCEPTION 'Automation budget reservation transition is invalid';
  END IF;
  IF NEW.state = 'reserved' AND (
    NEW.actual_cost_cents IS NOT NULL
    OR NEW.committed_at IS NOT NULL
    OR NEW.released_at IS NOT NULL
    OR NEW.terminal_reason_code IS NOT NULL
    OR NEW.commit_evidence_kind IS NOT NULL
    OR NEW.commit_evidence_reference IS NOT NULL
    OR NEW.overrun_detected
    OR NEW.authorization_breach
  ) THEN
    RAISE EXCEPTION 'Reserved automation budget lifecycle evidence is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER automation_budget_reservations_identity_protected
BEFORE UPDATE OR DELETE ON automation_budget_reservations
FOR EACH ROW EXECUTE FUNCTION protect_automation_budget_reservation_identity();

CREATE TRIGGER autonomy_policy_versions_immutable
BEFORE UPDATE OR DELETE ON autonomy_policy_versions
FOR EACH ROW EXECUTE FUNCTION reject_automation_budget_history_mutation();

CREATE TRIGGER automation_global_control_history_immutable
BEFORE UPDATE OR DELETE ON automation_global_control_history
FOR EACH ROW EXECUTE FUNCTION reject_automation_budget_history_mutation();
