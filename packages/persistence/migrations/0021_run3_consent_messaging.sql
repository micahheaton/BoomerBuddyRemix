CREATE TABLE messaging_local_control (
  id text PRIMARY KEY CHECK (id = 'local-simulation'),
  kill_switch boolean NOT NULL,
  provider_network_permitted boolean NOT NULL CHECK (provider_network_permitted = false),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  updated_at timestamptz NOT NULL
);

INSERT INTO messaging_local_control(
  id, kill_switch, provider_network_permitted, evidence_tier, updated_at
) VALUES ('local-simulation', false, false, 'local_simulation', '2026-08-17T00:00:00.000Z');

CREATE TABLE messaging_destinations (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel = 'sms'),
  encrypted_destination text NOT NULL CHECK (char_length(encrypted_destination) BETWEEN 40 AND 4096),
  destination_fingerprint text NOT NULL UNIQUE CHECK (
    destination_fingerprint ~ '^[A-Za-z0-9_-]{43}$'
  ),
  encryption_key_version integer NOT NULL CHECK (encryption_key_version > 0),
  fingerprint_key_version integer NOT NULL CHECK (fingerprint_key_version > 0),
  time_zone text CHECK (
    time_zone IS NULL OR time_zone ~ '^[A-Za-z_+-]+(/[A-Za-z0-9_+-]+)*$'
  ),
  locale text NOT NULL CHECK (
    locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$'
  ),
  jurisdiction text NOT NULL CHECK (jurisdiction = 'US'),
  verification_state text NOT NULL CHECK (verification_state = 'local_fixture'),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  created_at timestamptz NOT NULL,
  UNIQUE(id, person_id),
  CHECK (actor_person_id = person_id)
);

CREATE TABLE messaging_destination_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  id text PRIMARY KEY,
  destination_id text NOT NULL,
  person_id text NOT NULL,
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('register', 'retire')),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY(destination_id, person_id)
    REFERENCES messaging_destinations(id, person_id) ON DELETE RESTRICT,
  UNIQUE(destination_id, sequence),
  CHECK (actor_person_id = person_id)
);

CREATE UNIQUE INDEX messaging_destination_single_registration_idx
  ON messaging_destination_events(destination_id)
  WHERE action = 'register';

CREATE INDEX messaging_destination_person_timeline_idx
  ON messaging_destination_events(person_id, sequence DESC);

CREATE TABLE messaging_consent_chains (
  person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  destination_id text NOT NULL,
  purpose text NOT NULL CHECK (
    purpose IN ('customer_care', 'account_service', 'fraud_safety')
  ),
  current_evidence_id text,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(person_id, destination_id, purpose),
  FOREIGN KEY(destination_id, person_id)
    REFERENCES messaging_destinations(id, person_id) ON DELETE RESTRICT,
  CHECK (
    (revision = 0 AND current_evidence_id IS NULL)
    OR (revision > 0 AND current_evidence_id IS NOT NULL)
  )
);

CREATE TABLE messaging_consent_evidence (
  id text PRIMARY KEY,
  person_id text NOT NULL,
  destination_id text NOT NULL,
  purpose text NOT NULL CHECK (
    purpose IN ('customer_care', 'account_service', 'fraud_safety')
  ),
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel = 'sms'),
  action text NOT NULL CHECK (action IN ('grant', 'withdraw')),
  disclosure_version text NOT NULL CHECK (
    disclosure_version ~ '^[a-z][a-z0-9_.:-]{1,119}$'
  ),
  disclosure_digest text NOT NULL CHECK (disclosure_digest ~ '^[a-f0-9]{64}$'),
  policy_version text NOT NULL CHECK (policy_version ~ '^[a-z][a-z0-9_.:-]{1,119}$'),
  policy_digest text NOT NULL CHECK (policy_digest ~ '^[a-f0-9]{64}$'),
  source_surface text NOT NULL CHECK (
    source_surface IN ('member_web', 'mobile_app', 'local_fixture')
  ),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  effective_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  supersedes_evidence_id text REFERENCES messaging_consent_evidence(id) ON DELETE RESTRICT,
  FOREIGN KEY(person_id, destination_id, purpose)
    REFERENCES messaging_consent_chains(person_id, destination_id, purpose) ON DELETE RESTRICT,
  CHECK (actor_person_id = person_id)
);

ALTER TABLE messaging_consent_chains
  ADD CONSTRAINT messaging_consent_current_evidence_fk
  FOREIGN KEY(current_evidence_id) REFERENCES messaging_consent_evidence(id) ON DELETE RESTRICT;

CREATE TABLE messaging_suppression_chains (
  person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (
    purpose IN ('customer_care', 'account_service', 'fraud_safety')
  ),
  current_evidence_id text,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(person_id, purpose),
  CHECK (
    (revision = 0 AND current_evidence_id IS NULL)
    OR (revision > 0 AND current_evidence_id IS NOT NULL)
  )
);

CREATE TABLE messaging_suppression_evidence (
  id text PRIMARY KEY,
  person_id text NOT NULL,
  purpose text NOT NULL CHECK (
    purpose IN ('customer_care', 'account_service', 'fraud_safety')
  ),
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('suppress', 'restart_request', 'reactivate')),
  source text NOT NULL CHECK (
    source IN ('recipient_stop', 'recipient_start', 'recipient_settings', 'consent_withdrawal')
  ),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  effective_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  supersedes_evidence_id text REFERENCES messaging_suppression_evidence(id) ON DELETE RESTRICT,
  FOREIGN KEY(person_id, purpose)
    REFERENCES messaging_suppression_chains(person_id, purpose) ON DELETE RESTRICT,
  CHECK (actor_person_id = person_id),
  CHECK (
    (source = 'recipient_stop' AND action = 'suppress')
    OR (source = 'recipient_start' AND action = 'restart_request')
    OR (source = 'recipient_settings' AND action IN ('suppress', 'reactivate'))
    OR (source = 'consent_withdrawal' AND action = 'suppress')
  )
);

ALTER TABLE messaging_suppression_chains
  ADD CONSTRAINT messaging_suppression_current_evidence_fk
  FOREIGN KEY(current_evidence_id) REFERENCES messaging_suppression_evidence(id)
  ON DELETE RESTRICT;

ALTER TABLE restricted_access_grants
  DROP CONSTRAINT restricted_access_grants_resource_type_check;

ALTER TABLE restricted_access_grants
  ADD CONSTRAINT restricted_access_grants_resource_type_check
  CHECK (resource_type IN ('artifact', 'analysis', 'family', 'messaging_inbound'));

CREATE TABLE messaging_inbound_events (
  event_key text PRIMARY KEY CHECK (char_length(event_key) BETWEEN 8 AND 200),
  destination_id text NOT NULL,
  person_id text NOT NULL,
  classification text NOT NULL CHECK (
    classification IN ('stop', 'start', 'help', 'support')
  ),
  household_id text,
  support_case_id text,
  content_state text NOT NULL CHECK (
    content_state IN ('none', 'encrypted_minimized', 'discarded_unsafe')
  ),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  FOREIGN KEY(destination_id, person_id)
    REFERENCES messaging_destinations(id, person_id) ON DELETE RESTRICT,
  FOREIGN KEY(household_id, support_case_id)
    REFERENCES support_cases(household_id, id) ON DELETE RESTRICT,
  CHECK (
    (classification = 'support' AND household_id IS NOT NULL AND support_case_id IS NOT NULL
      AND content_state IN ('encrypted_minimized', 'discarded_unsafe'))
    OR (classification <> 'support' AND household_id IS NULL AND support_case_id IS NULL
      AND content_state = 'none')
  )
);

CREATE TABLE messaging_inbound_payloads (
  event_key text PRIMARY KEY REFERENCES messaging_inbound_events(event_key) ON DELETE RESTRICT,
  payload_state text NOT NULL CHECK (
    payload_state IN ('encrypted_minimized', 'discarded_unsafe', 'payload_erased')
  ),
  encrypted_text text,
  encryption_key_version integer,
  content_fingerprint text,
  fingerprint_key_version integer,
  detected_classes jsonb NOT NULL CHECK (jsonb_typeof(detected_classes) = 'array'),
  retention_deadline timestamptz,
  created_at timestamptz NOT NULL,
  erased_at timestamptz,
  CHECK (
    (payload_state = 'encrypted_minimized' AND encrypted_text IS NOT NULL
      AND encryption_key_version > 0
      AND content_fingerprint ~ '^[A-Za-z0-9_-]{43}$'
      AND fingerprint_key_version > 0
      AND retention_deadline > created_at AND erased_at IS NULL)
    OR (payload_state = 'discarded_unsafe' AND encrypted_text IS NULL
      AND encryption_key_version IS NULL AND content_fingerprint IS NULL
      AND fingerprint_key_version IS NULL AND retention_deadline IS NULL AND erased_at IS NULL)
    OR (payload_state = 'payload_erased' AND encrypted_text IS NULL
      AND encryption_key_version IS NULL AND content_fingerprint IS NULL
      AND fingerprint_key_version IS NULL AND retention_deadline IS NOT NULL
      AND erased_at IS NOT NULL)
  )
);

CREATE TABLE messaging_inbound_effects (
  id text PRIMARY KEY,
  event_key text NOT NULL UNIQUE REFERENCES messaging_inbound_events(event_key) ON DELETE RESTRICT,
  effect text NOT NULL CHECK (
    effect IN (
      'suppressed', 'already_suppressed', 'restart_recorded',
      'help_observed_no_reply', 'support_case_linked', 'support_content_discarded'
    )
  ),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  observed_at timestamptz NOT NULL
);

CREATE TABLE messaging_content_access_evidence (
  id text PRIMARY KEY,
  event_key text NOT NULL REFERENCES messaging_inbound_events(event_key) ON DELETE RESTRICT,
  household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  employee_assignment_id text NOT NULL REFERENCES employee_assignments(id) ON DELETE RESTRICT,
  restricted_access_grant_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose = 'customer_support'),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  observed_at timestamptz NOT NULL,
  FOREIGN KEY(household_id, restricted_access_grant_id)
    REFERENCES restricted_access_grants(household_id, id) ON DELETE RESTRICT
);

CREATE TABLE messaging_payload_erasure_evidence (
  id text PRIMARY KEY,
  event_key text NOT NULL UNIQUE REFERENCES messaging_inbound_events(event_key) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason = 'retention_expired'),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  erased_at timestamptz NOT NULL
);

CREATE TABLE messaging_intents (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 200),
  household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  recipient_person_id text NOT NULL,
  destination_id text NOT NULL,
  purpose text NOT NULL CHECK (
    purpose IN ('customer_care', 'account_service', 'fraud_safety')
  ),
  channel text NOT NULL CHECK (channel = 'sms'),
  template_key text NOT NULL CHECK (
    template_key IN (
      'account.service.v1', 'customer_care.help.v1',
      'customer_care.reply.v1', 'fraud_safety.pause_verify.v1'
    )
  ),
  template_version integer NOT NULL CHECK (template_version = 1),
  template_digest text NOT NULL CHECK (template_digest ~ '^[a-f0-9]{64}$'),
  urgency text NOT NULL CHECK (urgency = 'non_urgent'),
  scope_kind text NOT NULL CHECK (scope_kind IN ('household', 'support_case')),
  scope_id text NOT NULL,
  state text NOT NULL CHECK (
    state IN ('queued', 'local_simulated', 'governance_blocked')
  ),
  blocked_reason text CHECK (
    blocked_reason IS NULL OR blocked_reason IN (
      'global_stop', 'recipient_unavailable', 'destination_unavailable',
      'consent_unavailable', 'suppressed', 'scope_unavailable',
      'timezone_unknown', 'quiet_hours', 'wrong_template',
      'purpose_daily_limit', 'purpose_weekly_limit',
      'global_daily_limit', 'global_weekly_limit'
    )
  ),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  transport_kind text NOT NULL CHECK (transport_kind = 'none'),
  provider_network_permitted boolean NOT NULL CHECK (provider_network_permitted = false),
  external_action_operation_id text CHECK (external_action_operation_id IS NULL),
  scheduled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY(household_id, recipient_person_id)
    REFERENCES household_memberships(household_id, person_id) ON DELETE RESTRICT,
  FOREIGN KEY(destination_id, recipient_person_id)
    REFERENCES messaging_destinations(id, person_id) ON DELETE RESTRICT,
  CHECK (
    (purpose = 'customer_care' AND scope_kind = 'support_case')
    OR (purpose IN ('account_service', 'fraud_safety') AND scope_kind = 'household')
  ),
  CHECK (scope_kind <> 'household' OR scope_id = household_id),
  CHECK (
    (state = 'queued' AND blocked_reason IS NULL)
    OR (state = 'local_simulated' AND blocked_reason IS NULL)
    OR (state = 'governance_blocked' AND blocked_reason IS NOT NULL)
  ),
  CHECK (updated_at >= created_at)
);

CREATE INDEX messaging_intent_ready_idx
  ON messaging_intents(state, scheduled_at, id)
  WHERE state = 'queued';

CREATE TABLE messaging_frequency_windows (
  person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (
    purpose IN ('all', 'customer_care', 'account_service', 'fraud_safety')
  ),
  period_kind text NOT NULL CHECK (period_kind IN ('daily', 'weekly')),
  window_key text NOT NULL CHECK (char_length(window_key) BETWEEN 8 AND 16),
  committed_count integer NOT NULL CHECK (committed_count >= 0),
  policy_version text NOT NULL CHECK (policy_version = 'messaging-local-safety-v1'),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(person_id, purpose, period_kind, window_key)
);

CREATE TABLE messaging_delivery_events (
  id text PRIMARY KEY,
  intent_id text NOT NULL REFERENCES messaging_intents(id) ON DELETE RESTRICT,
  job_id text NOT NULL CHECK (char_length(job_id) BETWEEN 8 AND 200),
  event_kind text NOT NULL CHECK (event_kind IN ('local_simulated', 'governance_blocked')),
  blocked_reason text,
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  provider_network_permitted boolean NOT NULL CHECK (provider_network_permitted = false),
  observed_at timestamptz NOT NULL,
  UNIQUE(intent_id, event_kind),
  CHECK (
    (event_kind = 'local_simulated' AND blocked_reason IS NULL)
    OR (event_kind = 'governance_blocked' AND blocked_reason IS NOT NULL)
  )
);

CREATE OR REPLACE FUNCTION reject_run3_messaging_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Run 3 messaging evidence is append-only';
END;
$$;

CREATE TRIGGER messaging_destinations_immutable
BEFORE UPDATE OR DELETE ON messaging_destinations
FOR EACH ROW EXECUTE FUNCTION reject_run3_messaging_evidence_mutation();

CREATE TRIGGER messaging_destination_events_immutable
BEFORE UPDATE OR DELETE ON messaging_destination_events
FOR EACH ROW EXECUTE FUNCTION reject_run3_messaging_evidence_mutation();

CREATE TRIGGER messaging_consent_evidence_immutable
BEFORE UPDATE OR DELETE ON messaging_consent_evidence
FOR EACH ROW EXECUTE FUNCTION reject_run3_messaging_evidence_mutation();

CREATE TRIGGER messaging_suppression_evidence_immutable
BEFORE UPDATE OR DELETE ON messaging_suppression_evidence
FOR EACH ROW EXECUTE FUNCTION reject_run3_messaging_evidence_mutation();

CREATE TRIGGER messaging_inbound_events_immutable
BEFORE UPDATE OR DELETE ON messaging_inbound_events
FOR EACH ROW EXECUTE FUNCTION reject_run3_messaging_evidence_mutation();

CREATE TRIGGER messaging_inbound_effects_immutable
BEFORE UPDATE OR DELETE ON messaging_inbound_effects
FOR EACH ROW EXECUTE FUNCTION reject_run3_messaging_evidence_mutation();

CREATE TRIGGER messaging_content_access_evidence_immutable
BEFORE UPDATE OR DELETE ON messaging_content_access_evidence
FOR EACH ROW EXECUTE FUNCTION reject_run3_messaging_evidence_mutation();

CREATE TRIGGER messaging_payload_erasure_evidence_immutable
BEFORE UPDATE OR DELETE ON messaging_payload_erasure_evidence
FOR EACH ROW EXECUTE FUNCTION reject_run3_messaging_evidence_mutation();

CREATE TRIGGER messaging_delivery_events_immutable
BEFORE UPDATE OR DELETE ON messaging_delivery_events
FOR EACH ROW EXECUTE FUNCTION reject_run3_messaging_evidence_mutation();

CREATE OR REPLACE FUNCTION validate_messaging_consent_chain_advance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evidence_person text;
  evidence_destination text;
  evidence_purpose text;
  evidence_supersedes text;
BEGIN
  IF NEW.person_id IS DISTINCT FROM OLD.person_id
    OR NEW.destination_id IS DISTINCT FROM OLD.destination_id
    OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.revision <> OLD.revision + 1
    OR NEW.current_evidence_id IS NULL
  THEN
    RAISE EXCEPTION 'Messaging consent projection advance is invalid';
  END IF;
  SELECT person_id, destination_id, purpose, supersedes_evidence_id
  INTO evidence_person, evidence_destination, evidence_purpose, evidence_supersedes
  FROM messaging_consent_evidence WHERE id = NEW.current_evidence_id;
  IF evidence_person IS DISTINCT FROM OLD.person_id
    OR evidence_destination IS DISTINCT FROM OLD.destination_id
    OR evidence_purpose IS DISTINCT FROM OLD.purpose
    OR evidence_supersedes IS DISTINCT FROM OLD.current_evidence_id
  THEN
    RAISE EXCEPTION 'Messaging consent projection must follow its append-only chain';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messaging_consent_chain_advance_guard
BEFORE UPDATE ON messaging_consent_chains
FOR EACH ROW EXECUTE FUNCTION validate_messaging_consent_chain_advance();

CREATE TRIGGER messaging_consent_chains_no_delete
BEFORE DELETE ON messaging_consent_chains
FOR EACH ROW EXECUTE FUNCTION reject_run3_messaging_evidence_mutation();

CREATE OR REPLACE FUNCTION validate_messaging_suppression_chain_advance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evidence_person text;
  evidence_purpose text;
  evidence_supersedes text;
  evidence_action text;
  evidence_source text;
  prior_action text;
BEGIN
  IF NEW.person_id IS DISTINCT FROM OLD.person_id
    OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.revision <> OLD.revision + 1
    OR NEW.current_evidence_id IS NULL
  THEN
    RAISE EXCEPTION 'Messaging suppression projection advance is invalid';
  END IF;
  SELECT action INTO prior_action
  FROM messaging_suppression_evidence WHERE id = OLD.current_evidence_id;
  SELECT person_id, purpose, supersedes_evidence_id, action, source
  INTO evidence_person, evidence_purpose, evidence_supersedes,
       evidence_action, evidence_source
  FROM messaging_suppression_evidence WHERE id = NEW.current_evidence_id;
  IF evidence_person IS DISTINCT FROM OLD.person_id
    OR evidence_purpose IS DISTINCT FROM OLD.purpose
    OR evidence_supersedes IS DISTINCT FROM OLD.current_evidence_id
  THEN
    RAISE EXCEPTION 'Messaging suppression projection must follow its append-only chain';
  END IF;
  IF NOT (
    (evidence_action = 'suppress'
      AND evidence_source IN ('recipient_stop', 'recipient_settings', 'consent_withdrawal')
      AND prior_action IS DISTINCT FROM 'suppress')
    OR (evidence_action = 'restart_request'
      AND evidence_source = 'recipient_start' AND prior_action = 'suppress')
    OR (evidence_action = 'reactivate'
      AND evidence_source = 'recipient_settings' AND prior_action = 'restart_request')
  ) THEN
    RAISE EXCEPTION 'Messaging suppression transition is semantically invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messaging_suppression_chain_advance_guard
BEFORE UPDATE ON messaging_suppression_chains
FOR EACH ROW EXECUTE FUNCTION validate_messaging_suppression_chain_advance();

CREATE TRIGGER messaging_suppression_chains_no_delete
BEFORE DELETE ON messaging_suppression_chains
FOR EACH ROW EXECUTE FUNCTION reject_run3_messaging_evidence_mutation();

CREATE OR REPLACE FUNCTION validate_messaging_inbound_support_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.classification = 'support' AND NOT EXISTS (
    SELECT 1 FROM support_cases support_case
    WHERE support_case.household_id = NEW.household_id
      AND support_case.id = NEW.support_case_id
      AND support_case.opened_by_person_id = NEW.person_id
      AND support_case.status = 'open'
      AND EXISTS (
        SELECT 1 FROM support_case_assignments assignment
        JOIN employee_assignments employee
          ON employee.id = assignment.employee_assignment_id
        JOIN organizations organization ON organization.id = employee.organization_id
        WHERE assignment.household_id = support_case.household_id
          AND assignment.case_id = support_case.id
          AND assignment.status = 'active'
          AND employee.status = 'active'
          AND employee.role = 'hq_support'
          AND organization.kind = 'internal'
      )
  ) THEN
    RAISE EXCEPTION 'Messaging support intake requires the exact open assigned case';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messaging_inbound_support_scope_guard
BEFORE INSERT ON messaging_inbound_events
FOR EACH ROW EXECUTE FUNCTION validate_messaging_inbound_support_scope();

CREATE OR REPLACE FUNCTION validate_messaging_payload_erasure_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_state text;
  current_encrypted_text text;
  current_encryption_key_version integer;
  current_content_fingerprint text;
  current_fingerprint_key_version integer;
  current_retention_deadline timestamptz;
BEGIN
  SELECT payload_state, encrypted_text, encryption_key_version,
         content_fingerprint, fingerprint_key_version, retention_deadline
  INTO current_state, current_encrypted_text, current_encryption_key_version,
       current_content_fingerprint, current_fingerprint_key_version,
       current_retention_deadline
  FROM messaging_inbound_payloads
  WHERE event_key = NEW.event_key
  FOR UPDATE;
  IF NOT FOUND
    OR current_state <> 'encrypted_minimized'
    OR current_encrypted_text IS NULL
    OR current_encryption_key_version IS NULL
    OR current_content_fingerprint IS NULL
    OR current_fingerprint_key_version IS NULL
    OR current_retention_deadline IS NULL
    OR current_retention_deadline > NEW.erased_at
  THEN
    RAISE EXCEPTION 'Messaging erasure evidence requires the exact due encrypted payload';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messaging_payload_erasure_evidence_insert_guard
BEFORE INSERT ON messaging_payload_erasure_evidence
FOR EACH ROW EXECUTE FUNCTION validate_messaging_payload_erasure_evidence();

CREATE OR REPLACE FUNCTION require_messaging_payload_erasure_applied()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM messaging_inbound_payloads payload
    WHERE payload.event_key = NEW.event_key
      AND payload.payload_state = 'payload_erased'
      AND payload.encrypted_text IS NULL
      AND payload.encryption_key_version IS NULL
      AND payload.content_fingerprint IS NULL
      AND payload.fingerprint_key_version IS NULL
      AND payload.retention_deadline <= NEW.erased_at
      AND payload.erased_at IS NOT DISTINCT FROM NEW.erased_at
  ) THEN
    RAISE EXCEPTION 'Messaging erasure evidence must be applied in the same transaction';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER messaging_payload_erasure_applied_guard
AFTER INSERT ON messaging_payload_erasure_evidence
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_messaging_payload_erasure_applied();

CREATE OR REPLACE FUNCTION restrict_messaging_payload_erasure()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.payload_state <> 'encrypted_minimized'
    OR OLD.encrypted_text IS NULL
    OR OLD.encryption_key_version IS NULL
    OR OLD.content_fingerprint IS NULL
    OR OLD.fingerprint_key_version IS NULL
    OR OLD.retention_deadline IS NULL
    OR NEW.payload_state <> 'payload_erased'
    OR NEW.event_key IS DISTINCT FROM OLD.event_key
    OR NEW.encrypted_text IS NOT NULL
    OR NEW.encryption_key_version IS NOT NULL
    OR NEW.content_fingerprint IS NOT NULL
    OR NEW.fingerprint_key_version IS NOT NULL
    OR NEW.detected_classes IS DISTINCT FROM OLD.detected_classes
    OR NEW.retention_deadline IS DISTINCT FROM OLD.retention_deadline
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.erased_at IS NULL
    OR OLD.retention_deadline > NEW.erased_at
    OR NOT EXISTS (
      SELECT 1 FROM messaging_payload_erasure_evidence evidence
      WHERE evidence.event_key = OLD.event_key AND evidence.erased_at = NEW.erased_at
        AND evidence.reason = 'retention_expired'
        AND evidence.evidence_tier = 'local_simulation'
    )
  THEN
    RAISE EXCEPTION 'Messaging payload mutation is limited to truthful erasure';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messaging_inbound_payload_update_guard
BEFORE UPDATE ON messaging_inbound_payloads
FOR EACH ROW EXECUTE FUNCTION restrict_messaging_payload_erasure();

CREATE TRIGGER messaging_inbound_payload_no_delete
BEFORE DELETE ON messaging_inbound_payloads
FOR EACH ROW EXECUTE FUNCTION reject_run3_messaging_evidence_mutation();

CREATE OR REPLACE FUNCTION restrict_messaging_intent_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.state <> 'queued'
    OR NEW.state NOT IN ('local_simulated', 'governance_blocked')
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.household_id IS DISTINCT FROM OLD.household_id
    OR NEW.recipient_person_id IS DISTINCT FROM OLD.recipient_person_id
    OR NEW.destination_id IS DISTINCT FROM OLD.destination_id
    OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.channel IS DISTINCT FROM OLD.channel
    OR NEW.template_key IS DISTINCT FROM OLD.template_key
    OR NEW.template_version IS DISTINCT FROM OLD.template_version
    OR NEW.template_digest IS DISTINCT FROM OLD.template_digest
    OR NEW.urgency IS DISTINCT FROM OLD.urgency
    OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
    OR NEW.scope_id IS DISTINCT FROM OLD.scope_id
    OR NEW.evidence_tier IS DISTINCT FROM OLD.evidence_tier
    OR NEW.transport_kind IS DISTINCT FROM OLD.transport_kind
    OR NEW.provider_network_permitted IS DISTINCT FROM OLD.provider_network_permitted
    OR NEW.external_action_operation_id IS DISTINCT FROM OLD.external_action_operation_id
    OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Messaging intent transition is local and terminal';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messaging_intent_transition_guard
BEFORE UPDATE ON messaging_intents
FOR EACH ROW EXECUTE FUNCTION restrict_messaging_intent_transition();

CREATE TRIGGER messaging_intent_no_delete
BEFORE DELETE ON messaging_intents
FOR EACH ROW EXECUTE FUNCTION reject_run3_messaging_evidence_mutation();

CREATE OR REPLACE FUNCTION restrict_messaging_frequency_increment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.person_id IS DISTINCT FROM OLD.person_id
    OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.period_kind IS DISTINCT FROM OLD.period_kind
    OR NEW.window_key IS DISTINCT FROM OLD.window_key
    OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
    OR NEW.evidence_tier IS DISTINCT FROM OLD.evidence_tier
    OR NEW.committed_count <> OLD.committed_count + 1
  THEN
    RAISE EXCEPTION 'Messaging frequency evidence advances one local simulation at a time';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messaging_frequency_increment_guard
BEFORE UPDATE ON messaging_frequency_windows
FOR EACH ROW EXECUTE FUNCTION restrict_messaging_frequency_increment();

CREATE TRIGGER messaging_frequency_no_delete
BEFORE DELETE ON messaging_frequency_windows
FOR EACH ROW EXECUTE FUNCTION reject_run3_messaging_evidence_mutation();
