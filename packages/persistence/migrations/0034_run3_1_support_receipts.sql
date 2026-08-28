CREATE TABLE support_receipt_gate (
  id smallint PRIMARY KEY CHECK (id = 1)
);

INSERT INTO support_receipt_gate(id) VALUES (1);

CREATE FUNCTION reject_support_receipt_gate_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Support receipt serialization gate is immutable';
END;
$$;

CREATE TRIGGER support_receipt_gate_immutable
BEFORE UPDATE OR DELETE ON support_receipt_gate
FOR EACH ROW EXECUTE FUNCTION reject_support_receipt_gate_mutation();

CREATE TABLE support_receipts (
  receipt_code text PRIMARY KEY CHECK (
    receipt_code ~ '^support_receipt_[A-Za-z0-9_-]{32}$'
  ),
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  opened_by_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN (
    'account_access', 'billing', 'check_experience', 'family_access',
    'mobile_app', 'privacy', 'service_availability'
  )),
  impact text NOT NULL CHECK (impact IN (
    'question', 'degraded', 'blocked', 'safety_concern'
  )),
  created_at timestamptz NOT NULL,
  UNIQUE (household_id, receipt_code),
  FOREIGN KEY (household_id, opened_by_person_id)
    REFERENCES household_memberships(household_id, person_id) ON DELETE RESTRICT
);

CREATE INDEX support_receipts_customer_idx
  ON support_receipts(household_id, opened_by_person_id, created_at DESC, receipt_code);

CREATE TABLE support_receipt_operations (
  operation_key_hmac text PRIMARY KEY CHECK (
    operation_key_hmac ~ '^[A-Za-z0-9_-]{43}$'
  ),
  request_digest text NOT NULL CHECK (
    request_digest ~ '^[A-Za-z0-9_-]{43}$'
  ),
  operation_kind text NOT NULL CHECK (operation_kind IN (
    'create', 'withdraw', 'transition'
  )),
  actor_kind text NOT NULL CHECK (actor_kind IN ('customer', 'hq')),
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  household_id text NOT NULL,
  receipt_code text NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (household_id, receipt_code)
    REFERENCES support_receipts(household_id, receipt_code) ON DELETE CASCADE,
  UNIQUE (operation_key_hmac, household_id, receipt_code, actor_person_id),
  CHECK (
    (actor_kind = 'customer' AND operation_kind IN ('create', 'withdraw'))
    OR (actor_kind = 'hq' AND operation_kind = 'transition')
  )
);

CREATE INDEX support_receipt_operations_receipt_idx
  ON support_receipt_operations(receipt_code, created_at, operation_key_hmac);

CREATE TABLE support_receipt_events (
  receipt_code text NOT NULL,
  household_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  operation_key_hmac text NOT NULL UNIQUE,
  from_state text CHECK (from_state IS NULL OR from_state IN (
    'open', 'acknowledged', 'in_review', 'resolved', 'withdrawn'
  )),
  to_state text NOT NULL CHECK (to_state IN (
    'open', 'acknowledged', 'in_review', 'resolved', 'withdrawn'
  )),
  action text NOT NULL CHECK (action IN (
    'create', 'acknowledge', 'start_review', 'resolve', 'withdraw'
  )),
  actor_kind text NOT NULL CHECK (actor_kind IN ('customer', 'hq')),
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  resolution_code text CHECK (resolution_code IS NULL OR resolution_code IN (
    'completed', 'duplicate', 'insufficient_content_free_evidence',
    'outside_supported_scope'
  )),
  correlation_id text NOT NULL CHECK (
    correlation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'
  ),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (receipt_code, sequence),
  FOREIGN KEY (household_id, receipt_code)
    REFERENCES support_receipts(household_id, receipt_code) ON DELETE CASCADE,
  FOREIGN KEY (
    operation_key_hmac, household_id, receipt_code, actor_person_id
  ) REFERENCES support_receipt_operations(
    operation_key_hmac, household_id, receipt_code, actor_person_id
  ) ON DELETE CASCADE,
  CHECK (
    (action = 'create' AND actor_kind = 'customer'
      AND from_state IS NULL AND to_state = 'open' AND resolution_code IS NULL)
    OR (action = 'acknowledge' AND actor_kind = 'hq'
      AND from_state = 'open' AND to_state = 'acknowledged'
      AND resolution_code IS NULL)
    OR (action = 'start_review' AND actor_kind = 'hq'
      AND from_state = 'acknowledged' AND to_state = 'in_review'
      AND resolution_code IS NULL)
    OR (action = 'resolve' AND actor_kind = 'hq'
      AND from_state IN ('acknowledged', 'in_review') AND to_state = 'resolved'
      AND resolution_code IS NOT NULL)
    OR (action = 'withdraw' AND actor_kind = 'customer'
      AND from_state IN ('open', 'acknowledged', 'in_review')
      AND to_state = 'withdrawn' AND resolution_code IS NULL)
  )
);

CREATE INDEX support_receipt_events_latest_idx
  ON support_receipt_events(receipt_code, sequence DESC);

CREATE INDEX support_receipt_events_queue_idx
  ON support_receipt_events(to_state, occurred_at, receipt_code, sequence DESC);

CREATE TABLE support_receipt_rate_buckets (
  bucket_start date NOT NULL,
  scope text NOT NULL CHECK (scope IN ('person', 'household')),
  scope_key_hmac text NOT NULL CHECK (
    scope_key_hmac ~ '^[A-Za-z0-9_-]{43}$'
  ),
  used_count integer NOT NULL CHECK (used_count > 0),
  PRIMARY KEY (bucket_start, scope, scope_key_hmac)
);

CREATE FUNCTION validate_support_receipt_origin() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM household_memberships membership
    WHERE membership.household_id = NEW.household_id
      AND membership.person_id = NEW.opened_by_person_id
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Support receipt origin requires active household membership';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER support_receipt_origin_valid
BEFORE INSERT ON support_receipts
FOR EACH ROW EXECUTE FUNCTION validate_support_receipt_origin();

CREATE FUNCTION validate_support_receipt_operation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  opener text;
BEGIN
  SELECT receipt.opened_by_person_id INTO opener
  FROM support_receipts receipt
  WHERE receipt.household_id = NEW.household_id
    AND receipt.receipt_code = NEW.receipt_code
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Support receipt operation origin is unavailable';
  END IF;
  IF NEW.actor_kind = 'customer' THEN
    IF opener <> NEW.actor_person_id OR NOT EXISTS (
      SELECT 1 FROM household_memberships membership
      WHERE membership.household_id = NEW.household_id
        AND membership.person_id = NEW.actor_person_id
        AND membership.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Support receipt customer operation lacks current self authority';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM employee_assignments employee
    JOIN organizations organization ON organization.id = employee.organization_id
    WHERE employee.person_id = NEW.actor_person_id
      AND employee.role = 'hq_owner'
      AND employee.status = 'active'
      AND organization.kind = 'internal'
  ) THEN
    RAISE EXCEPTION 'Support receipt HQ operation lacks current owner authority';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER support_receipt_operation_valid
BEFORE INSERT ON support_receipt_operations
FOR EACH ROW EXECUTE FUNCTION validate_support_receipt_operation();

CREATE FUNCTION validate_support_receipt_event_sequence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  latest_sequence integer;
  latest_state text;
  latest_time timestamptz;
  operation_kind text;
  receipt_created_at timestamptz;
BEGIN
  SELECT receipt.created_at INTO receipt_created_at
  FROM support_receipts receipt
  WHERE receipt.household_id = NEW.household_id
    AND receipt.receipt_code = NEW.receipt_code
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Support receipt event origin is unavailable';
  END IF;
  SELECT operation.operation_kind INTO operation_kind
  FROM support_receipt_operations operation
  WHERE operation.operation_key_hmac = NEW.operation_key_hmac;
  IF NOT FOUND OR (
    (NEW.action = 'create' AND operation_kind <> 'create')
    OR (NEW.action = 'withdraw' AND operation_kind <> 'withdraw')
    OR (NEW.action NOT IN ('create', 'withdraw') AND operation_kind <> 'transition')
  ) THEN
    RAISE EXCEPTION 'Support receipt event operation lineage is invalid';
  END IF;
  SELECT event.sequence, event.to_state, event.occurred_at
    INTO latest_sequence, latest_state, latest_time
  FROM support_receipt_events event
  WHERE event.receipt_code = NEW.receipt_code
  ORDER BY event.sequence DESC
  LIMIT 1;
  IF latest_sequence IS NULL THEN
    IF NEW.sequence <> 1 OR NEW.action <> 'create'
      OR NEW.from_state IS NOT NULL OR NEW.occurred_at <> receipt_created_at
    THEN
      RAISE EXCEPTION 'Support receipt initial event is invalid';
    END IF;
  ELSIF NEW.sequence <> latest_sequence + 1
    OR NEW.from_state IS DISTINCT FROM latest_state
    OR NEW.occurred_at < latest_time
  THEN
    RAISE EXCEPTION 'Support receipt event sequence is stale or invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER support_receipt_event_sequence_valid
BEFORE INSERT ON support_receipt_events
FOR EACH ROW EXECUTE FUNCTION validate_support_receipt_event_sequence();

CREATE FUNCTION reject_support_receipt_origin_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  latest_state text;
  terminal_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Support receipt origin is immutable';
  END IF;
  SELECT event.to_state, event.occurred_at INTO latest_state, terminal_at
  FROM support_receipt_events event
  WHERE event.receipt_code = OLD.receipt_code
  ORDER BY event.sequence DESC
  LIMIT 1;
  IF latest_state IS NULL OR terminal_at IS NULL
    OR latest_state NOT IN ('resolved', 'withdrawn')
    OR terminal_at > clock_timestamp() - interval '90 days'
  THEN
    RAISE EXCEPTION 'Support receipt is not due for terminal retention';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER support_receipt_origin_immutable
BEFORE UPDATE OR DELETE ON support_receipts
FOR EACH ROW EXECUTE FUNCTION reject_support_receipt_origin_mutation();

CREATE FUNCTION reject_support_receipt_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Support receipt operation and event history is append-only';
END;
$$;

CREATE TRIGGER support_receipt_operations_append_only
BEFORE UPDATE OR DELETE ON support_receipt_operations
FOR EACH ROW EXECUTE FUNCTION reject_support_receipt_history_mutation();

CREATE TRIGGER support_receipt_events_append_only
BEFORE UPDATE OR DELETE ON support_receipt_events
FOR EACH ROW EXECUTE FUNCTION reject_support_receipt_history_mutation();
