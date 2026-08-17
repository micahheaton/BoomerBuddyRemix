CREATE TABLE feedback_records (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 128),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  identity_mode text NOT NULL CHECK (
    identity_mode IN ('authenticated', 'anonymous', 'support_conversion')
  ),
  household_id text REFERENCES households(id) ON DELETE RESTRICT,
  actor_person_id text REFERENCES persons(id) ON DELETE RESTRICT,
  source_surface text NOT NULL CHECK (source_surface IN (
    'web_feedback_form', 'in_app_contextual', 'mobile_app', 'post_check',
    'orientation', 'cancellation', 'refund', 'support_conversion'
  )),
  app_version text CHECK (
    app_version IS NULL OR app_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'
  ),
  build_version text CHECK (
    build_version IS NULL OR build_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'
  ),
  locale text CHECK (
    locale IS NULL OR locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$'
  ),
  device_class text NOT NULL CHECK (device_class IN ('desktop', 'tablet', 'phone', 'unknown')),
  feedback_type text NOT NULL CHECK (feedback_type IN (
    'product_feedback', 'bug_report', 'safety_concern', 'accessibility_issue',
    'support_request', 'pricing_feedback', 'feature_request', 'cancellation_reason',
    'refund_feedback', 'research_response'
  )),
  linked_object_type text CHECK (
    linked_object_type IS NULL
    OR linked_object_type IN ('check', 'orientation', 'subscription', 'support_case')
  ),
  linked_object_id text,
  linkage_consent_version text CHECK (
    linkage_consent_version IS NULL OR linkage_consent_version = 'feedback-linkage-v1'
  ),
  origin_interaction_id text CHECK (
    origin_interaction_id IS NULL
    OR origin_interaction_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{2,127}$'
  ),
  correlation_id text NOT NULL CHECK (
    correlation_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,199}$'
  ),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  created_at timestamptz NOT NULL,
  CHECK (
    (linked_object_type IS NULL AND linked_object_id IS NULL AND linkage_consent_version IS NULL)
    OR (linked_object_type IS NOT NULL AND linked_object_id IS NOT NULL)
  ),
  CHECK (
    (identity_mode = 'anonymous' AND household_id IS NULL AND actor_person_id IS NULL
      AND source_surface = 'web_feedback_form' AND linked_object_type IS NULL
      AND origin_interaction_id IS NULL)
    OR (identity_mode = 'authenticated' AND household_id IS NOT NULL
      AND actor_person_id IS NOT NULL AND source_surface <> 'support_conversion')
    OR (identity_mode = 'support_conversion' AND household_id IS NOT NULL
      AND actor_person_id IS NOT NULL AND source_surface = 'support_conversion'
      AND linked_object_type = 'support_case' AND linkage_consent_version IS NULL)
  )
);

CREATE TABLE feedback_payloads (
  feedback_id text PRIMARY KEY REFERENCES feedback_records(id) ON DELETE RESTRICT,
  payload_state text NOT NULL CHECK (
    payload_state IN ('encrypted_minimized', 'discarded_unsafe', 'payload_erased')
  ),
  encrypted_text text,
  encryption_key_version integer CHECK (
    encryption_key_version IS NULL OR encryption_key_version > 0
  ),
  redaction_status text NOT NULL CHECK (
    redaction_status IN ('minimized_clean', 'minimized_redacted', 'quarantined_discarded')
  ),
  detected_classes jsonb NOT NULL CHECK (
    jsonb_typeof(detected_classes) = 'array'
    AND detected_classes <@ '[
      "private_key", "payment_card", "authorization_credential", "one_time_code"
    ]'::jsonb
  ),
  redaction_counts jsonb NOT NULL CHECK (
    jsonb_typeof(redaction_counts) = 'object'
    AND redaction_counts - ARRAY[
      'payment_card', 'authorization_credential', 'one_time_code'
    ] = '{}'::jsonb
    AND (
      NOT redaction_counts ? 'payment_card'
      OR redaction_counts ->> 'payment_card' ~ '^[1-9][0-9]{0,2}$'
    )
    AND (
      NOT redaction_counts ? 'authorization_credential'
      OR redaction_counts ->> 'authorization_credential' ~ '^[1-9][0-9]{0,2}$'
    )
    AND (
      NOT redaction_counts ? 'one_time_code'
      OR redaction_counts ->> 'one_time_code' ~ '^[1-9][0-9]{0,2}$'
    )
  ),
  retention_deadline timestamptz,
  created_at timestamptz NOT NULL,
  erased_at timestamptz,
  CHECK (
    (payload_state = 'encrypted_minimized' AND encrypted_text IS NOT NULL
      AND encryption_key_version IS NOT NULL AND retention_deadline > created_at
      AND retention_deadline <= created_at + interval '24 hours'
      AND erased_at IS NULL AND redaction_status IN ('minimized_clean', 'minimized_redacted'))
    OR (payload_state = 'discarded_unsafe' AND encrypted_text IS NULL
      AND encryption_key_version IS NULL AND retention_deadline IS NULL
      AND erased_at IS NULL AND redaction_status = 'quarantined_discarded')
    OR (payload_state = 'payload_erased' AND encrypted_text IS NULL
      AND encryption_key_version IS NULL AND retention_deadline IS NOT NULL
      AND erased_at >= created_at)
  )
);

CREATE TABLE feedback_state_events (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 128),
  feedback_id text NOT NULL REFERENCES feedback_records(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  from_status text CHECK (from_status IS NULL OR from_status IN (
    'received', 'minimized', 'classified', 'assigned', 'actioned', 'no_action',
    'close_loop_pending', 'closed', 'withdrawn', 'restricted', 'retention_expired',
    'unsafe_unprocessable', 'support_escalated', 'incident_escalated'
  )),
  to_status text NOT NULL CHECK (to_status IN (
    'received', 'minimized', 'classified', 'assigned', 'actioned', 'no_action',
    'close_loop_pending', 'closed', 'withdrawn', 'restricted', 'retention_expired',
    'unsafe_unprocessable', 'support_escalated', 'incident_escalated'
  )),
  severity text NOT NULL CHECK (severity IN ('unassessed', 'low', 'medium', 'high', 'critical')),
  classification text NOT NULL CHECK (classification IN (
    'unclassified', 'individual_preference', 'repeated_usability_pattern',
    'confirmed_bug', 'bug_hypothesis', 'safety_or_fraud_quality',
    'accessibility_blocker', 'support_request', 'pricing_objection',
    'feature_opportunity', 'testimonial_candidate_pending_permission',
    'research_question', 'out_of_scope_or_unsafe'
  )),
  duplicate_of_feedback_id text REFERENCES feedback_records(id) ON DELETE RESTRICT,
  cluster_id text CHECK (
    cluster_id IS NULL OR cluster_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,127}$'
  ),
  customer_impact_code text CHECK (
    customer_impact_code IS NULL OR customer_impact_code ~ '^[a-z][a-z0-9_]{2,79}$'
  ),
  resulting_action_type text CHECK (
    resulting_action_type IS NULL
    OR resulting_action_type IN ('issue', 'experiment', 'content', 'support_action')
  ),
  resulting_action_id text CHECK (
    resulting_action_id IS NULL
    OR resulting_action_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{2,127}$'
  ),
  close_loop_state text NOT NULL CHECK (close_loop_state IN (
    'not_requested', 'ineligible', 'pending_internal_evidence',
    'human_review_required', 'closed_without_contact'
  )),
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  actor_kind text NOT NULL CHECK (
    actor_kind IN ('participant', 'anonymous_participant', 'hq', 'service', 'system')
  ),
  actor_person_id text REFERENCES persons(id) ON DELETE RESTRICT,
  service_key text CHECK (service_key IS NULL OR service_key ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  occurred_at timestamptz NOT NULL,
  UNIQUE (feedback_id, version),
  CHECK (duplicate_of_feedback_id IS NULL OR duplicate_of_feedback_id <> feedback_id),
  CHECK (
    (resulting_action_type IS NULL AND resulting_action_id IS NULL)
    OR (resulting_action_type IS NOT NULL AND resulting_action_id IS NOT NULL)
  ),
  CHECK (
    (actor_kind IN ('participant', 'hq') AND actor_person_id IS NOT NULL AND service_key IS NULL)
    OR (actor_kind = 'anonymous_participant' AND actor_person_id IS NULL AND service_key IS NULL)
    OR (actor_kind IN ('service', 'system') AND actor_person_id IS NULL AND service_key IS NOT NULL)
  )
);

CREATE TABLE feedback_consent_events (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 128),
  feedback_id text NOT NULL REFERENCES feedback_records(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('follow_up', 'research_retention', 'object_linkage')),
  sequence integer NOT NULL CHECK (sequence > 0),
  state text NOT NULL CHECK (state IN ('granted', 'declined', 'withdrawn', 'restricted', 'expired')),
  purpose_code text CHECK (
    purpose_code IS NULL
    OR purpose_code IN ('feedback_follow_up', 'product_feedback_research', 'feedback_object_linkage')
  ),
  consent_version text CHECK (
    consent_version IS NULL OR consent_version IN (
      'feedback-follow-up-v1', 'feedback-research-v1', 'feedback-linkage-v1'
    )
  ),
  channel_class text CHECK (
    channel_class IS NULL OR channel_class IN ('account_email', 'account_sms', 'in_app')
  ),
  retain_until timestamptz,
  actor_kind text NOT NULL CHECK (
    actor_kind IN ('participant', 'anonymous_participant', 'hq', 'system')
  ),
  actor_person_id text REFERENCES persons(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  occurred_at timestamptz NOT NULL,
  UNIQUE (feedback_id, purpose, sequence),
  CHECK (
    (actor_kind IN ('participant', 'hq') AND actor_person_id IS NOT NULL)
    OR (actor_kind = 'anonymous_participant' AND actor_person_id IS NULL)
    OR (actor_kind = 'system' AND actor_person_id IS NULL)
  ),
  CHECK (
    (state = 'granted' AND purpose_code IS NOT NULL AND consent_version IS NOT NULL)
    OR (state <> 'granted')
  ),
  CHECK (
    state <> 'granted'
    OR (purpose = 'follow_up' AND purpose_code = 'feedback_follow_up'
      AND consent_version = 'feedback-follow-up-v1')
    OR (purpose = 'research_retention' AND purpose_code = 'product_feedback_research'
      AND consent_version = 'feedback-research-v1')
    OR (purpose = 'object_linkage' AND purpose_code = 'feedback_object_linkage'
      AND consent_version = 'feedback-linkage-v1')
  ),
  CHECK (
    (purpose = 'follow_up' AND (
      (state = 'granted' AND channel_class IS NOT NULL AND retain_until IS NULL)
      OR (state <> 'granted' AND channel_class IS NULL AND retain_until IS NULL)
    ))
    OR (purpose = 'research_retention' AND (
      (state = 'granted' AND retain_until > occurred_at
        AND retain_until <= occurred_at + interval '24 hours' AND channel_class IS NULL)
      OR (state <> 'granted' AND retain_until IS NULL AND channel_class IS NULL)
    ))
    OR (purpose = 'object_linkage' AND channel_class IS NULL AND retain_until IS NULL)
  )
);

CREATE TABLE feedback_assignment_events (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 128),
  feedback_id text NOT NULL REFERENCES feedback_records(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  routing_state text NOT NULL CHECK (routing_state IN ('unassigned', 'assigned')),
  queue text NOT NULL CHECK (queue IN (
    'new_feedback', 'privacy_security', 'safety_fraud', 'accessibility',
    'consented_follow_up', 'duplicate_review', 'product_engineering', 'close_loop_review'
  )),
  employee_assignment_id text REFERENCES employee_assignments(id) ON DELETE RESTRICT,
  assigned_by_person_id text REFERENCES persons(id) ON DELETE RESTRICT,
  service_key text CHECK (service_key ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  occurred_at timestamptz NOT NULL,
  UNIQUE (feedback_id, version),
  CHECK (
    (routing_state = 'unassigned' AND employee_assignment_id IS NULL
      AND assigned_by_person_id IS NULL AND service_key IS NOT NULL
      AND service_key = 'feedback.local_router')
    OR (routing_state = 'assigned' AND employee_assignment_id IS NOT NULL
      AND assigned_by_person_id IS NOT NULL AND service_key IS NULL)
  )
);

CREATE TABLE feedback_intake_operations (
  operation_key text PRIMARY KEY CHECK (
    operation_key ~ '^feedback:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  request_digest text NOT NULL CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
  feedback_id text UNIQUE REFERENCES feedback_records(id) ON DELETE RESTRICT,
  response_status text CHECK (
    response_status IS NULL
    OR response_status IN ('queued_unassigned', 'assigned', 'unsafe_unprocessable')
  ),
  response_redaction_status text CHECK (
    response_redaction_status IS NULL
    OR response_redaction_status IN ('minimized_clean', 'minimized_redacted', 'quarantined_discarded')
  ),
  response_queue text CHECK (response_queue IS NULL OR response_queue IN (
    'new_feedback', 'privacy_security', 'safety_fraud', 'accessibility',
    'consented_follow_up', 'duplicate_review', 'product_engineering', 'close_loop_review'
  )),
  response_retained_until timestamptz,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK (
    (feedback_id IS NULL AND response_status IS NULL AND response_redaction_status IS NULL
      AND response_queue IS NULL AND response_retained_until IS NULL AND completed_at IS NULL)
    OR (feedback_id IS NOT NULL AND response_status IS NOT NULL
      AND response_redaction_status IS NOT NULL AND response_queue IS NOT NULL
      AND completed_at IS NOT NULL)
  )
);

CREATE TABLE feedback_processing_jobs (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 128),
  feedback_id text NOT NULL REFERENCES feedback_records(id) ON DELETE RESTRICT,
  processing_step text NOT NULL CHECK (processing_step IN (
    'redaction_verification', 'classification', 'deduplication', 'internal_draft'
  )),
  durable_job_id text NOT NULL UNIQUE REFERENCES durable_jobs(id) ON DELETE RESTRICT,
  expected_feedback_version integer NOT NULL CHECK (expected_feedback_version > 0),
  receipt_state text NOT NULL CHECK (receipt_state = 'queued'),
  result_code text NOT NULL CHECK (result_code = 'local_processing_not_run'),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  provider_processed boolean NOT NULL CHECK (provider_processed = false),
  external_action_executed boolean NOT NULL CHECK (external_action_executed = false),
  created_at timestamptz NOT NULL,
  UNIQUE (feedback_id, processing_step, expected_feedback_version)
);

CREATE TABLE feedback_payload_erasure_events (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 128),
  feedback_id text NOT NULL REFERENCES feedback_records(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason IN ('consent_withdrawn', 'retention_expired')),
  actor_kind text NOT NULL CHECK (actor_kind IN ('participant', 'system')),
  actor_person_id text REFERENCES persons(id) ON DELETE RESTRICT,
  prior_retention_deadline timestamptz NOT NULL,
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  occurred_at timestamptz NOT NULL,
  UNIQUE (feedback_id),
  CHECK (
    (actor_kind = 'participant' AND actor_person_id IS NOT NULL)
    OR (actor_kind = 'system' AND actor_person_id IS NULL)
  )
);

CREATE TABLE feedback_anonymous_quota_buckets (
  scope text NOT NULL CHECK (scope IN ('global', 'network')),
  bucket_start timestamptz NOT NULL,
  scope_key text NOT NULL CHECK (
    (scope = 'global' AND scope_key = 'global')
    OR (scope = 'network' AND scope_key ~ '^[A-Za-z0-9_-]{43}$')
  ),
  used_count integer NOT NULL CHECK (used_count BETWEEN 1 AND 60),
  PRIMARY KEY (scope, bucket_start, scope_key)
);

CREATE TABLE feedback_anonymous_processing_leases (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 128),
  client_key_hmac text NOT NULL CHECK (client_key_hmac ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);

CREATE TABLE feedback_anonymous_concurrency_mutex (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  schema_version integer NOT NULL CHECK (schema_version = 1)
);

INSERT INTO feedback_anonymous_concurrency_mutex(singleton, schema_version) VALUES (true, 1);

CREATE TABLE feedback_review_concurrency_mutex (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  schema_version integer NOT NULL CHECK (schema_version = 1)
);

INSERT INTO feedback_review_concurrency_mutex(singleton, schema_version) VALUES (true, 1);

CREATE INDEX feedback_records_household_created_idx
  ON feedback_records(household_id, created_at DESC) WHERE household_id IS NOT NULL;
CREATE INDEX feedback_payload_retention_idx
  ON feedback_payloads(retention_deadline, feedback_id)
  WHERE payload_state = 'encrypted_minimized';
CREATE INDEX feedback_assignment_actor_idx
  ON feedback_assignment_events(employee_assignment_id, occurred_at, feedback_id);
CREATE INDEX feedback_anonymous_lease_expiry_idx
  ON feedback_anonymous_processing_leases(expires_at);

CREATE OR REPLACE FUNCTION validate_feedback_record_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1 FROM feedback_review_concurrency_mutex
  WHERE singleton = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Feedback review concurrency control is unavailable'; END IF;
  IF NEW.identity_mode = 'authenticated' THEN
    PERFORM 1 FROM household_memberships
    WHERE household_id = NEW.household_id AND person_id = NEW.actor_person_id
      AND status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Feedback participant membership is unavailable';
    END IF;
    IF NEW.linked_object_type IS NOT NULL AND NEW.linkage_consent_version IS NULL THEN
      RAISE EXCEPTION 'Feedback object linkage requires explicit consent';
    END IF;
    IF NEW.linked_object_type = 'check' THEN
      PERFORM 1 FROM analyses analysis
      JOIN artifacts artifact
        ON artifact.household_id = analysis.household_id AND artifact.id = analysis.artifact_id
      WHERE analysis.household_id = NEW.household_id AND analysis.id = NEW.linked_object_id
        AND analysis.requested_by = NEW.actor_person_id AND analysis.state = 'completed'
        AND artifact.state = 'active' AND artifact.delete_after > NEW.created_at
      FOR UPDATE OF analysis, artifact;
      IF NOT FOUND THEN RAISE EXCEPTION 'Feedback Check linkage is unavailable'; END IF;
    ELSIF NEW.linked_object_type = 'orientation' THEN
      PERFORM 1 FROM orientation_states
      WHERE household_id = NEW.household_id AND person_id = NEW.actor_person_id
        AND person_id = NEW.linked_object_id
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Feedback orientation linkage is unavailable'; END IF;
    ELSIF NEW.linked_object_type = 'subscription' THEN
      PERFORM 1 FROM commerce_subscriptions
      WHERE household_id = NEW.household_id AND id = NEW.linked_object_id
        AND payer_person_id = NEW.actor_person_id
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Feedback subscription linkage is unavailable'; END IF;
    ELSIF NEW.linked_object_type = 'support_case' THEN
      RAISE EXCEPTION 'Customer feedback cannot link directly to a support case';
    END IF;
  ELSIF NEW.identity_mode = 'support_conversion' THEN
    PERFORM 1
    FROM support_cases support_case
    JOIN support_case_assignments case_assignment
      ON case_assignment.household_id = support_case.household_id
      AND case_assignment.case_id = support_case.id
    JOIN employee_assignments employee
      ON employee.id = case_assignment.employee_assignment_id
    JOIN organizations organization ON organization.id = employee.organization_id
    WHERE support_case.household_id = NEW.household_id
      AND support_case.id = NEW.linked_object_id AND support_case.status = 'open'
      AND case_assignment.status = 'active' AND employee.person_id = NEW.actor_person_id
      AND employee.role = 'hq_support' AND employee.status = 'active'
      AND organization.kind = 'internal'
    FOR UPDATE OF support_case, case_assignment, employee, organization;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Feedback support conversion authority is unavailable';
    END IF;
  END IF;
  IF NEW.source_surface = 'post_check' AND NEW.linked_object_type <> 'check' THEN
    RAISE EXCEPTION 'Post-Check feedback requires an exact Check link';
  ELSIF NEW.source_surface = 'orientation' AND NEW.linked_object_type <> 'orientation' THEN
    RAISE EXCEPTION 'Orientation feedback requires an exact orientation link';
  ELSIF NEW.source_surface IN ('cancellation', 'refund')
    AND NEW.linked_object_type <> 'subscription' THEN
    RAISE EXCEPTION 'Commerce feedback requires an exact subscription link';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feedback_record_scope_valid
BEFORE INSERT ON feedback_records
FOR EACH ROW EXECUTE FUNCTION validate_feedback_record_scope();

CREATE OR REPLACE FUNCTION validate_feedback_state_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous feedback_state_events%ROWTYPE;
  transition_allowed boolean;
  record_mode text;
  record_actor text;
  record_created_at timestamptz;
  current_assignee text;
  owner_authorized boolean;
BEGIN
  PERFORM 1 FROM feedback_records WHERE id = NEW.feedback_id FOR UPDATE;
  SELECT identity_mode, actor_person_id, created_at
  INTO record_mode, record_actor, record_created_at
  FROM feedback_records WHERE id = NEW.feedback_id;
  IF NOT EXISTS (
    SELECT 1 FROM feedback_payloads WHERE feedback_id = NEW.feedback_id
  ) THEN
    RAISE EXCEPTION 'Feedback state evidence requires a durable payload decision';
  END IF;
  IF NEW.occurred_at < record_created_at THEN
    RAISE EXCEPTION 'Feedback evidence predates its intake';
  END IF;
  SELECT * INTO previous FROM feedback_state_events
  WHERE feedback_id = NEW.feedback_id ORDER BY version DESC LIMIT 1;
  IF previous.id IS NULL THEN
    IF NEW.version <> 1 OR NEW.from_status IS NOT NULL OR NEW.to_status <> 'received' THEN
      RAISE EXCEPTION 'Feedback evidence must begin at received version one';
    END IF;
    IF NEW.severity <> 'unassessed' OR NEW.classification <> 'unclassified'
      OR NEW.duplicate_of_feedback_id IS NOT NULL OR NEW.cluster_id IS NOT NULL
      OR NEW.customer_impact_code IS NOT NULL OR NEW.resulting_action_type IS NOT NULL
      OR NEW.resulting_action_id IS NOT NULL OR NEW.close_loop_state <> 'not_requested' THEN
      RAISE EXCEPTION 'Initial feedback evidence cannot assert a reviewed outcome';
    END IF;
    IF (record_mode = 'authenticated'
        AND (NEW.actor_kind <> 'participant' OR NEW.actor_person_id IS DISTINCT FROM record_actor))
      OR (record_mode = 'anonymous' AND NEW.actor_kind <> 'anonymous_participant')
      OR (record_mode = 'support_conversion'
        AND (NEW.actor_kind <> 'hq' OR NEW.actor_person_id IS DISTINCT FROM record_actor)) THEN
      RAISE EXCEPTION 'Initial feedback actor provenance is invalid';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.version <> previous.version + 1 OR NEW.from_status IS DISTINCT FROM previous.to_status
    OR NEW.occurred_at < previous.occurred_at THEN
    RAISE EXCEPTION 'Feedback evidence chronology is invalid';
  END IF;
  transition_allowed := CASE previous.to_status
    WHEN 'received' THEN NEW.to_status IN ('minimized', 'unsafe_unprocessable', 'restricted', 'withdrawn')
    WHEN 'minimized' THEN NEW.to_status IN ('classified', 'assigned', 'restricted', 'withdrawn',
      'retention_expired', 'support_escalated', 'incident_escalated')
    WHEN 'classified' THEN NEW.to_status IN ('assigned', 'actioned', 'no_action', 'restricted',
      'withdrawn', 'retention_expired', 'support_escalated', 'incident_escalated')
    WHEN 'assigned' THEN NEW.to_status IN ('actioned', 'no_action', 'restricted', 'withdrawn',
      'retention_expired', 'support_escalated', 'incident_escalated')
    WHEN 'actioned' THEN NEW.to_status IN (
      'close_loop_pending', 'closed', 'restricted', 'withdrawn', 'retention_expired'
    )
    WHEN 'no_action' THEN NEW.to_status IN (
      'close_loop_pending', 'closed', 'restricted', 'withdrawn', 'retention_expired'
    )
    WHEN 'close_loop_pending' THEN NEW.to_status IN ('closed', 'restricted', 'withdrawn', 'retention_expired')
    WHEN 'withdrawn' THEN NEW.to_status IN ('restricted', 'retention_expired')
    WHEN 'restricted' THEN NEW.to_status = 'retention_expired'
    WHEN 'support_escalated' THEN NEW.to_status IN (
      'assigned', 'actioned', 'no_action', 'closed', 'restricted', 'withdrawn',
      'retention_expired'
    )
    WHEN 'incident_escalated' THEN NEW.to_status IN (
      'assigned', 'actioned', 'no_action', 'closed', 'restricted', 'withdrawn',
      'retention_expired'
    )
    ELSE false
  END;
  IF NOT transition_allowed THEN RAISE EXCEPTION 'Feedback state transition is not permitted'; END IF;
  IF NEW.actor_kind = 'anonymous_participant' THEN
    RAISE EXCEPTION 'Anonymous participant evidence is limited to intake';
  ELSIF NEW.actor_kind = 'participant' THEN
    IF record_mode <> 'authenticated' OR NEW.actor_person_id IS DISTINCT FROM record_actor
      OR NEW.to_status <> 'withdrawn'
      OR NEW.severity IS DISTINCT FROM previous.severity
      OR NEW.classification IS DISTINCT FROM previous.classification
      OR NEW.duplicate_of_feedback_id IS DISTINCT FROM previous.duplicate_of_feedback_id
      OR NEW.cluster_id IS DISTINCT FROM previous.cluster_id
      OR NEW.customer_impact_code IS DISTINCT FROM previous.customer_impact_code
      OR NEW.resulting_action_type IS DISTINCT FROM previous.resulting_action_type
      OR NEW.resulting_action_id IS DISTINCT FROM previous.resulting_action_id
      OR NEW.close_loop_state IS DISTINCT FROM previous.close_loop_state THEN
      RAISE EXCEPTION 'Participant feedback evidence authority is invalid';
    END IF;
  ELSIF NEW.actor_kind = 'hq' THEN
    SELECT employee.person_id INTO current_assignee
    FROM (
      SELECT event.* FROM feedback_assignment_events event
      WHERE event.feedback_id = NEW.feedback_id ORDER BY event.version DESC LIMIT 1
    ) assignment
    JOIN employee_assignments employee ON employee.id = assignment.employee_assignment_id
    JOIN organizations organization ON organization.id = employee.organization_id
    WHERE assignment.routing_state = 'assigned' AND employee.status = 'active'
      AND organization.kind = 'internal'
    FOR UPDATE OF employee, organization;
    PERFORM 1 FROM employee_assignments employee
    JOIN organizations organization ON organization.id = employee.organization_id
    WHERE employee.person_id = NEW.actor_person_id AND employee.role = 'hq_owner'
      AND employee.status = 'active' AND organization.kind = 'internal'
    FOR UPDATE OF employee, organization;
    owner_authorized := FOUND;
    IF NEW.actor_person_id IS DISTINCT FROM current_assignee AND NOT owner_authorized THEN
      RAISE EXCEPTION 'Feedback review requires the current exact assignee or owner projection';
    END IF;
  ELSIF NEW.actor_kind IN ('service', 'system') THEN
    IF NEW.service_key = 'feedback.local_minimizer' THEN
      IF previous.to_status <> 'received'
        OR NEW.to_status NOT IN ('minimized', 'unsafe_unprocessable')
        OR NEW.severity <> 'unassessed'
        OR (NEW.to_status = 'minimized' AND NEW.classification <> 'unclassified')
        OR (NEW.to_status = 'unsafe_unprocessable'
          AND NEW.classification <> 'out_of_scope_or_unsafe')
        OR NEW.duplicate_of_feedback_id IS NOT NULL OR NEW.cluster_id IS NOT NULL
        OR NEW.customer_impact_code IS NOT NULL OR NEW.resulting_action_type IS NOT NULL
        OR NEW.resulting_action_id IS NOT NULL OR NEW.close_loop_state <> 'not_requested' THEN
        RAISE EXCEPTION 'Feedback local minimizer evidence exceeded its authority';
      END IF;
    ELSIF NEW.service_key = 'feedback.local_router' THEN
      IF previous.to_status <> 'minimized' OR NEW.to_status <> 'assigned'
        OR NEW.severity IS DISTINCT FROM previous.severity
        OR NEW.classification IS DISTINCT FROM previous.classification
        OR NEW.duplicate_of_feedback_id IS DISTINCT FROM previous.duplicate_of_feedback_id
        OR NEW.cluster_id IS DISTINCT FROM previous.cluster_id
        OR NEW.customer_impact_code IS DISTINCT FROM previous.customer_impact_code
        OR NEW.resulting_action_type IS DISTINCT FROM previous.resulting_action_type
        OR NEW.resulting_action_id IS DISTINCT FROM previous.resulting_action_id
        OR NEW.close_loop_state IS DISTINCT FROM (CASE
          WHEN record_mode = 'support_conversion' THEN 'human_review_required'
          ELSE previous.close_loop_state
        END) THEN
        RAISE EXCEPTION 'Feedback local router evidence exceeded its authority';
      END IF;
    ELSIF NEW.service_key = 'feedback.retention' THEN
      IF NEW.to_status <> 'retention_expired'
        OR NEW.severity IS DISTINCT FROM previous.severity
        OR NEW.classification IS DISTINCT FROM previous.classification
        OR NEW.duplicate_of_feedback_id IS DISTINCT FROM previous.duplicate_of_feedback_id
        OR NEW.cluster_id IS DISTINCT FROM previous.cluster_id
        OR NEW.customer_impact_code IS DISTINCT FROM previous.customer_impact_code
        OR NEW.resulting_action_type IS DISTINCT FROM previous.resulting_action_type
        OR NEW.resulting_action_id IS DISTINCT FROM previous.resulting_action_id
        OR NEW.close_loop_state IS DISTINCT FROM previous.close_loop_state THEN
        RAISE EXCEPTION 'Feedback retention evidence exceeded its authority';
      END IF;
    ELSE
      RAISE EXCEPTION 'Feedback service authority is structurally disabled';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feedback_state_event_valid
BEFORE INSERT ON feedback_state_events
FOR EACH ROW EXECUTE FUNCTION validate_feedback_state_event();

CREATE OR REPLACE FUNCTION validate_feedback_consent_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prior_sequence integer;
  prior_state text;
  prior_occurred_at timestamptz;
  record_mode text;
  record_actor text;
  record_created_at timestamptz;
  record_link_id text;
  record_link_version text;
  payload_state text;
  payload_deadline timestamptz;
BEGIN
  PERFORM 1 FROM feedback_records WHERE id = NEW.feedback_id FOR UPDATE;
  SELECT record.identity_mode, record.actor_person_id, record.created_at,
         record.linked_object_id, record.linkage_consent_version,
         payload.payload_state, payload.retention_deadline
  INTO record_mode, record_actor, record_created_at, record_link_id,
       record_link_version, payload_state, payload_deadline
  FROM feedback_records record
  JOIN feedback_payloads payload ON payload.feedback_id = record.id
  WHERE record.id = NEW.feedback_id;
  IF record_mode IS NULL OR payload_state IS NULL THEN
    RAISE EXCEPTION 'Feedback consent requires a durable payload decision';
  END IF;
  SELECT sequence, state, occurred_at INTO prior_sequence, prior_state, prior_occurred_at
  FROM feedback_consent_events
  WHERE feedback_id = NEW.feedback_id AND purpose = NEW.purpose
  ORDER BY sequence DESC LIMIT 1;
  IF NEW.sequence <> COALESCE(prior_sequence, 0) + 1 THEN
    RAISE EXCEPTION 'Feedback consent evidence sequence is invalid';
  END IF;
  IF (prior_sequence IS NULL AND NEW.occurred_at < record_created_at)
    OR (prior_sequence IS NOT NULL AND NEW.occurred_at < prior_occurred_at) THEN
    RAISE EXCEPTION 'Feedback consent evidence chronology is invalid';
  END IF;
  IF NEW.state <> 'granted' AND (
    NEW.purpose_code IS NOT NULL OR NEW.consent_version IS NOT NULL
    OR NEW.channel_class IS NOT NULL OR NEW.retain_until IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Non-granted feedback consent cannot retain purpose metadata';
  END IF;
  IF prior_sequence IS NULL THEN
    IF record_mode = 'authenticated' AND (
      NEW.actor_kind <> 'participant' OR NEW.actor_person_id IS DISTINCT FROM record_actor
      OR NEW.state NOT IN ('granted', 'declined')
      OR (NEW.purpose = 'object_linkage' AND NEW.state <> 'granted')
    ) THEN
      RAISE EXCEPTION 'Authenticated feedback consent provenance is invalid';
    ELSIF record_mode = 'anonymous' AND (
      NEW.actor_kind <> 'anonymous_participant' OR NEW.actor_person_id IS NOT NULL
      OR NEW.purpose = 'object_linkage' OR NEW.state NOT IN ('granted', 'declined')
      OR (NEW.purpose = 'follow_up' AND NEW.state <> 'declined')
    ) THEN
      RAISE EXCEPTION 'Anonymous feedback consent provenance is invalid';
    ELSIF record_mode = 'support_conversion' AND (
      NEW.actor_kind <> 'system' OR NEW.actor_person_id IS NOT NULL
      OR NEW.purpose NOT IN ('follow_up', 'research_retention') OR NEW.state <> 'declined'
    ) THEN
      RAISE EXCEPTION 'Support feedback consent provenance is invalid';
    END IF;
    IF NEW.purpose = 'object_linkage' AND (
      record_mode <> 'authenticated' OR record_link_id IS NULL
      OR NEW.consent_version IS DISTINCT FROM record_link_version
    ) THEN
      RAISE EXCEPTION 'Feedback object-linkage consent does not match the linked record';
    END IF;
    IF NEW.purpose = 'research_retention' AND NEW.state = 'granted'
      AND payload_state = 'encrypted_minimized'
      AND NEW.retain_until IS DISTINCT FROM payload_deadline THEN
      RAISE EXCEPTION 'Feedback research consent does not match payload retention';
    END IF;
  ELSIF NEW.state = 'withdrawn' THEN
    IF record_mode <> 'authenticated' OR prior_state <> 'granted'
      OR NEW.actor_kind <> 'participant' OR NEW.actor_person_id IS DISTINCT FROM record_actor THEN
      RAISE EXCEPTION 'Feedback consent withdrawal authority is invalid';
    END IF;
  ELSIF NEW.state IN ('restricted', 'expired') THEN
    IF NEW.actor_kind <> 'system' OR NEW.actor_person_id IS NOT NULL OR prior_state <> 'granted' THEN
      RAISE EXCEPTION 'Feedback consent lifecycle authority is invalid';
    END IF;
  ELSE
    RAISE EXCEPTION 'Feedback consent lifecycle transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feedback_consent_event_valid
BEFORE INSERT ON feedback_consent_events
FOR EACH ROW EXECUTE FUNCTION validate_feedback_consent_event();

CREATE OR REPLACE FUNCTION validate_feedback_assignment_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prior_version integer;
  prior_occurred_at timestamptz;
  assigned_role text;
  assigned_person text;
  record_mode text;
  record_actor text;
  record_household text;
  record_link_type text;
  record_link_id text;
  record_feedback_type text;
  record_created_at timestamptz;
  payload_redaction text;
  expected_queue text;
  prior_routing_state text;
  prior_assigned_person text;
  assigning_role text;
BEGIN
  PERFORM 1 FROM feedback_review_concurrency_mutex
  WHERE singleton = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Feedback review concurrency control is unavailable'; END IF;
  PERFORM 1 FROM feedback_records WHERE id = NEW.feedback_id FOR UPDATE;
  SELECT version, occurred_at INTO prior_version, prior_occurred_at
  FROM feedback_assignment_events
  WHERE feedback_id = NEW.feedback_id ORDER BY version DESC LIMIT 1;
  IF NEW.version <> COALESCE(prior_version, 0) + 1 THEN
    RAISE EXCEPTION 'Feedback assignment evidence sequence is invalid';
  END IF;
  SELECT record.identity_mode, record.actor_person_id, record.household_id,
         record.linked_object_type, record.linked_object_id, record.feedback_type,
         record.created_at, payload.redaction_status
  INTO record_mode, record_actor, record_household, record_link_type, record_link_id,
       record_feedback_type, record_created_at, payload_redaction
  FROM feedback_records record
  JOIN feedback_payloads payload ON payload.feedback_id = record.id
  WHERE record.id = NEW.feedback_id;
  IF record_mode IS NULL OR payload_redaction IS NULL THEN
    RAISE EXCEPTION 'Feedback routing requires a durable payload decision';
  END IF;
  IF (prior_version IS NULL AND NEW.occurred_at < record_created_at)
    OR (prior_version IS NOT NULL AND NEW.occurred_at < prior_occurred_at) THEN
    RAISE EXCEPTION 'Feedback routing evidence chronology is invalid';
  END IF;
  expected_queue := CASE
    WHEN payload_redaction = 'quarantined_discarded' THEN 'privacy_security'
    WHEN record_feedback_type = 'safety_concern' THEN 'safety_fraud'
    WHEN record_feedback_type = 'accessibility_issue' THEN 'accessibility'
    ELSE 'new_feedback'
  END;
  IF NEW.version = 1 AND NEW.queue <> expected_queue THEN
    RAISE EXCEPTION 'Initial feedback queue is not code-owned';
  END IF;
  IF NEW.routing_state = 'unassigned' THEN
    IF NEW.version <> 1 OR NEW.service_key IS DISTINCT FROM 'feedback.local_router'
      OR (record_mode = 'support_conversion' AND payload_redaction <> 'quarantined_discarded') THEN
      RAISE EXCEPTION 'Unassigned feedback routing authority is invalid';
    END IF;
    RETURN NEW;
  END IF;
  SELECT employee.role, employee.person_id INTO assigned_role, assigned_person
  FROM employee_assignments employee
  JOIN organizations organization ON organization.id = employee.organization_id
  WHERE employee.id = NEW.employee_assignment_id AND employee.status = 'active'
    AND organization.kind = 'internal'
  FOR UPDATE OF employee, organization;
  IF assigned_person IS NULL THEN RAISE EXCEPTION 'Feedback assignee is unavailable'; END IF;
  SELECT assigning_employee.role INTO assigning_role
  FROM employee_assignments assigning_employee
  JOIN organizations organization ON organization.id = assigning_employee.organization_id
  WHERE assigning_employee.person_id = NEW.assigned_by_person_id
    AND assigning_employee.status = 'active' AND organization.kind = 'internal'
  ORDER BY CASE WHEN assigning_employee.role = 'hq_owner' THEN 0 ELSE 1 END,
    assigning_employee.id LIMIT 1
  FOR UPDATE OF assigning_employee, organization;
  IF assigning_role IS NULL THEN RAISE EXCEPTION 'Feedback assignment authority is unavailable'; END IF;
  IF NEW.version = 1 THEN
    IF record_mode <> 'support_conversion' OR payload_redaction = 'quarantined_discarded'
      OR assigned_role <> 'hq_support' OR assigning_role <> 'hq_support'
      OR assigned_person IS DISTINCT FROM record_actor
      OR NEW.assigned_by_person_id IS DISTINCT FROM record_actor
      OR record_link_type <> 'support_case'
      OR NOT EXISTS (
        SELECT 1 FROM support_case_assignments support_assignment
        WHERE support_assignment.household_id = record_household
          AND support_assignment.case_id = record_link_id
          AND support_assignment.employee_assignment_id = NEW.employee_assignment_id
          AND support_assignment.status = 'active'
      ) THEN
      RAISE EXCEPTION 'Support conversion cannot broaden feedback visibility';
    END IF;
  ELSE
    SELECT prior.routing_state, employee.person_id
    INTO prior_routing_state, prior_assigned_person
    FROM feedback_assignment_events prior
    LEFT JOIN employee_assignments employee ON employee.id = prior.employee_assignment_id
    WHERE prior.feedback_id = NEW.feedback_id AND prior.version = NEW.version - 1;
    IF prior_routing_state = 'unassigned' AND assigning_role <> 'hq_owner' THEN
      RAISE EXCEPTION 'Unassigned feedback may only be claimed through the owner projection';
    ELSIF prior_routing_state = 'assigned' AND assigning_role <> 'hq_owner'
      AND NEW.assigned_by_person_id IS DISTINCT FROM prior_assigned_person THEN
      RAISE EXCEPTION 'Feedback reassignment requires the current assignee or an owner';
    END IF;
  END IF;
  IF NEW.queue = 'privacy_security' AND assigned_role <> 'hq_owner' THEN
    RAISE EXCEPTION 'Privacy feedback requires the narrow owner queue';
  END IF;
  IF NEW.queue = 'consented_follow_up' AND assigned_role NOT IN ('hq_owner', 'hq_support') THEN
    RAISE EXCEPTION 'Follow-up feedback requires owner or support assignment';
  END IF;
  IF NEW.queue NOT IN ('privacy_security', 'consented_follow_up')
    AND assigned_role NOT IN ('hq_owner', 'hq_reviewer', 'hq_support') THEN
    RAISE EXCEPTION 'Feedback assignment role is unavailable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feedback_assignment_event_valid
BEFORE INSERT ON feedback_assignment_events
FOR EACH ROW EXECUTE FUNCTION validate_feedback_assignment_event();

CREATE OR REPLACE FUNCTION validate_feedback_processing_job()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  durable durable_jobs%ROWTYPE;
  expected_type text;
BEGIN
  SELECT * INTO durable FROM durable_jobs WHERE id = NEW.durable_job_id FOR UPDATE;
  expected_type := CASE NEW.processing_step
    WHEN 'redaction_verification' THEN 'feedback.redaction.verify'
    WHEN 'classification' THEN 'feedback.classify.local'
    WHEN 'deduplication' THEN 'feedback.deduplicate.local'
    WHEN 'internal_draft' THEN 'feedback.draft.local'
    ELSE NULL
  END;
  IF durable.id IS NULL OR durable.job_type <> expected_type OR durable.job_version <> 1
    OR durable.classification <> 'confidential' OR durable.state <> 'queued'
    OR durable.payload IS DISTINCT FROM jsonb_build_object(
      'feedbackId', NEW.feedback_id,
      'expectedVersion', NEW.expected_feedback_version,
      'processingStep', NEW.processing_step,
      'localOnly', true
    )
    OR NOT EXISTS (
      SELECT 1 FROM feedback_state_events state
      WHERE state.feedback_id = NEW.feedback_id
        AND state.version = NEW.expected_feedback_version
    ) THEN
    RAISE EXCEPTION 'Feedback processing receipt does not match a content-free local job';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feedback_processing_job_valid
BEFORE INSERT ON feedback_processing_jobs
FOR EACH ROW EXECUTE FUNCTION validate_feedback_processing_job();

CREATE OR REPLACE FUNCTION validate_feedback_erasure_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  payload feedback_payloads%ROWTYPE;
  record_actor text;
BEGIN
  SELECT * INTO payload FROM feedback_payloads
  WHERE feedback_id = NEW.feedback_id FOR UPDATE;
  SELECT actor_person_id INTO record_actor FROM feedback_records WHERE id = NEW.feedback_id;
  IF payload.feedback_id IS NULL OR payload.payload_state <> 'payload_erased'
    OR payload.encrypted_text IS NOT NULL OR payload.encryption_key_version IS NOT NULL
    OR payload.retention_deadline IS DISTINCT FROM NEW.prior_retention_deadline
    OR payload.erased_at IS DISTINCT FROM NEW.occurred_at THEN
    RAISE EXCEPTION 'Feedback erasure evidence does not match the erased payload';
  END IF;
  IF NEW.reason = 'consent_withdrawn' AND (
    NEW.actor_kind <> 'participant' OR NEW.actor_person_id IS DISTINCT FROM record_actor
    OR NOT EXISTS (
      SELECT 1 FROM feedback_consent_events consent
      WHERE consent.feedback_id = NEW.feedback_id AND consent.state = 'withdrawn'
        AND consent.actor_kind = 'participant'
        AND consent.actor_person_id = NEW.actor_person_id
    )
  ) THEN
    RAISE EXCEPTION 'Feedback consent erasure authority is invalid';
  ELSIF NEW.reason = 'retention_expired' AND (
    NEW.actor_kind <> 'system' OR NEW.actor_person_id IS NOT NULL
    OR NEW.occurred_at < NEW.prior_retention_deadline
  ) THEN
    RAISE EXCEPTION 'Feedback retention erasure authority is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feedback_erasure_event_valid
BEFORE INSERT ON feedback_payload_erasure_events
FOR EACH ROW EXECUTE FUNCTION validate_feedback_erasure_event();

CREATE OR REPLACE FUNCTION require_feedback_payload_erasure_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.payload_state = 'payload_erased' AND NOT EXISTS (
    SELECT 1 FROM feedback_payload_erasure_events evidence
    WHERE evidence.feedback_id = NEW.feedback_id
      AND evidence.prior_retention_deadline IS NOT DISTINCT FROM NEW.retention_deadline
      AND evidence.occurred_at IS NOT DISTINCT FROM NEW.erased_at
  ) THEN
    RAISE EXCEPTION 'Feedback payload erasure requires same-transaction durable evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER feedback_payload_erasure_evidence_required
AFTER INSERT OR UPDATE ON feedback_payloads
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW.payload_state = 'payload_erased')
EXECUTE FUNCTION require_feedback_payload_erasure_evidence();

CREATE OR REPLACE FUNCTION require_feedback_retention_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  payload feedback_payloads%ROWTYPE;
  record_mode text;
  record_created_at timestamptz;
  consent_state text;
  consent_retain_until timestamptz;
  consent_occurred_at timestamptz;
BEGIN
  SELECT * INTO payload FROM feedback_payloads WHERE feedback_id = NEW.feedback_id;
  IF payload.feedback_id IS NULL OR payload.payload_state = 'discarded_unsafe' THEN
    RETURN NEW;
  END IF;
  SELECT identity_mode, created_at INTO record_mode, record_created_at
  FROM feedback_records WHERE id = NEW.feedback_id;
  SELECT state, retain_until, occurred_at
  INTO consent_state, consent_retain_until, consent_occurred_at
  FROM feedback_consent_events
  WHERE feedback_id = NEW.feedback_id AND purpose = 'research_retention' AND sequence = 1;
  IF record_mode IS NULL OR consent_state IS NULL
    OR payload.created_at IS DISTINCT FROM record_created_at
    OR consent_occurred_at IS DISTINCT FROM record_created_at THEN
    RAISE EXCEPTION 'Feedback payload retention requires matching initial consent evidence';
  END IF;
  IF consent_state = 'declined' THEN
    IF payload.retention_deadline IS DISTINCT FROM record_created_at + interval '1 hour' THEN
      RAISE EXCEPTION 'Declined feedback research retention is exactly one hour';
    END IF;
  ELSIF consent_state = 'granted' THEN
    IF record_mode = 'support_conversion'
      OR payload.retention_deadline IS DISTINCT FROM consent_retain_until
      OR payload.retention_deadline <= record_created_at
      OR payload.retention_deadline > record_created_at + interval '24 hours' THEN
      RAISE EXCEPTION 'Granted feedback research retention must match a bounded consent';
    END IF;
  ELSE
    RAISE EXCEPTION 'Feedback payload retention requires granted or declined initial consent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER feedback_payload_retention_contract_required
AFTER INSERT OR UPDATE ON feedback_payloads
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_feedback_retention_contract();

CREATE CONSTRAINT TRIGGER feedback_research_retention_contract_required
AFTER INSERT ON feedback_consent_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW.purpose = 'research_retention')
EXECUTE FUNCTION require_feedback_retention_contract();

CREATE OR REPLACE FUNCTION reject_feedback_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Feedback evidence is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION protect_feedback_record()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Feedback evidence is append-only'; END IF;
  IF OLD.identity_mode <> 'authenticated' OR OLD.linked_object_id IS NULL
    OR NEW.linked_object_type IS NOT NULL OR NEW.linked_object_id IS NOT NULL
    OR NEW.linkage_consent_version IS NOT NULL
    OR (to_jsonb(NEW) - ARRAY[
      'linked_object_type', 'linked_object_id', 'linkage_consent_version'
    ]) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY[
      'linked_object_type', 'linked_object_id', 'linkage_consent_version'
    ])
    OR NOT EXISTS (
      SELECT 1 FROM feedback_consent_events consent
      WHERE consent.feedback_id = OLD.id AND consent.purpose = 'object_linkage'
        AND (
          (consent.state = 'withdrawn' AND consent.actor_kind = 'participant'
            AND consent.actor_person_id = OLD.actor_person_id)
          OR (consent.state = 'expired' AND consent.actor_kind = 'system'
            AND consent.actor_person_id IS NULL)
        )
      ORDER BY consent.sequence DESC LIMIT 1
    ) THEN
    RAISE EXCEPTION 'Feedback record mutation is not a consent-backed linkage erasure';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feedback_records_immutable
BEFORE UPDATE OR DELETE ON feedback_records
FOR EACH ROW EXECUTE FUNCTION protect_feedback_record();
CREATE TRIGGER feedback_state_events_immutable
BEFORE UPDATE OR DELETE ON feedback_state_events
FOR EACH ROW EXECUTE FUNCTION reject_feedback_evidence_mutation();
CREATE TRIGGER feedback_consent_events_immutable
BEFORE UPDATE OR DELETE ON feedback_consent_events
FOR EACH ROW EXECUTE FUNCTION reject_feedback_evidence_mutation();
CREATE TRIGGER feedback_assignment_events_immutable
BEFORE UPDATE OR DELETE ON feedback_assignment_events
FOR EACH ROW EXECUTE FUNCTION reject_feedback_evidence_mutation();
CREATE TRIGGER feedback_processing_jobs_immutable
BEFORE UPDATE OR DELETE ON feedback_processing_jobs
FOR EACH ROW EXECUTE FUNCTION reject_feedback_evidence_mutation();
CREATE TRIGGER feedback_payload_erasure_events_immutable
BEFORE UPDATE OR DELETE ON feedback_payload_erasure_events
FOR EACH ROW EXECUTE FUNCTION reject_feedback_evidence_mutation();

CREATE OR REPLACE FUNCTION protect_feedback_payload()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Feedback payload cannot be deleted without evidence'; END IF;
  IF OLD.payload_state <> 'encrypted_minimized' OR NEW.payload_state <> 'payload_erased'
    OR NEW.feedback_id IS DISTINCT FROM OLD.feedback_id
    OR NEW.encrypted_text IS NOT NULL OR NEW.encryption_key_version IS NOT NULL
    OR NEW.redaction_status IS DISTINCT FROM OLD.redaction_status
    OR NEW.detected_classes IS DISTINCT FROM OLD.detected_classes
    OR NEW.redaction_counts IS DISTINCT FROM OLD.redaction_counts
    OR NEW.retention_deadline IS DISTINCT FROM OLD.retention_deadline
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.erased_at IS NULL OR NEW.erased_at < OLD.created_at THEN
    RAISE EXCEPTION 'Feedback payload mutation is not a valid active-store ciphertext erasure';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feedback_payloads_protected
BEFORE UPDATE OR DELETE ON feedback_payloads
FOR EACH ROW EXECUTE FUNCTION protect_feedback_payload();

CREATE OR REPLACE FUNCTION protect_feedback_intake_operation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  payload feedback_payloads%ROWTYPE;
  routing feedback_assignment_events%ROWTYPE;
  state feedback_state_events%ROWTYPE;
  expected_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Feedback intake evidence is append-only'; END IF;
  IF OLD.feedback_id IS NOT NULL OR NEW.operation_key IS DISTINCT FROM OLD.operation_key
    OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.feedback_id IS NULL OR NEW.response_status IS NULL
    OR NEW.response_redaction_status IS NULL OR NEW.response_queue IS NULL
    OR NEW.completed_at IS NULL OR NEW.completed_at < OLD.created_at THEN
    RAISE EXCEPTION 'Feedback intake operation completion is invalid';
  END IF;
  SELECT * INTO payload FROM feedback_payloads WHERE feedback_id = NEW.feedback_id;
  SELECT * INTO routing FROM feedback_assignment_events
  WHERE feedback_id = NEW.feedback_id ORDER BY version DESC LIMIT 1;
  SELECT * INTO state FROM feedback_state_events
  WHERE feedback_id = NEW.feedback_id ORDER BY version DESC LIMIT 1;
  expected_status := CASE
    WHEN state.to_status = 'unsafe_unprocessable' THEN 'unsafe_unprocessable'
    WHEN routing.routing_state = 'assigned' AND state.to_status = 'assigned' THEN 'assigned'
    WHEN routing.routing_state = 'unassigned' AND state.to_status = 'minimized'
      THEN 'queued_unassigned'
    ELSE NULL
  END;
  IF payload.feedback_id IS NULL OR routing.feedback_id IS NULL OR state.feedback_id IS NULL
    OR NEW.response_status IS DISTINCT FROM expected_status
    OR NEW.response_redaction_status IS DISTINCT FROM payload.redaction_status
    OR NEW.response_queue IS DISTINCT FROM routing.queue
    OR NEW.response_retained_until IS DISTINCT FROM payload.retention_deadline THEN
    RAISE EXCEPTION 'Feedback intake response does not match durable evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feedback_intake_operations_protected
BEFORE UPDATE OR DELETE ON feedback_intake_operations
FOR EACH ROW EXECUTE FUNCTION protect_feedback_intake_operation();

CREATE TRIGGER feedback_anonymous_concurrency_mutex_immutable
BEFORE UPDATE OR DELETE ON feedback_anonymous_concurrency_mutex
FOR EACH ROW EXECUTE FUNCTION reject_feedback_evidence_mutation();
CREATE TRIGGER feedback_review_concurrency_mutex_immutable
BEFORE UPDATE OR DELETE ON feedback_review_concurrency_mutex
FOR EACH ROW EXECUTE FUNCTION reject_feedback_evidence_mutation();
