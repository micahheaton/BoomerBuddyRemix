CREATE TABLE editorial_review_mutex (
  singleton boolean PRIMARY KEY CHECK (singleton),
  schema_version integer NOT NULL CHECK (schema_version = 1)
);

INSERT INTO editorial_review_mutex(singleton, schema_version) VALUES (true, 1);

CREATE TABLE editorial_source_versions (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'),
  source_key text NOT NULL CHECK (source_key ~ '^source_[a-z0-9_]{2,111}$'),
  version integer NOT NULL CHECK (version > 0),
  publisher_key text NOT NULL CHECK (publisher_key ~ '^[a-z][a-z0-9_.:-]{1,119}$'),
  origin_host text NOT NULL CHECK (
    origin_host = lower(origin_host)
    AND origin_host ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
  ),
  path_prefix text NOT NULL CHECK (
    path_prefix ~ '^/[A-Za-z0-9._~/%+-]*$'
    AND path_prefix !~ '[?#]'
  ),
  source_class text NOT NULL CHECK (source_class IN (
    'government', 'regulator', 'law_enforcement', 'court', 'standards_body',
    'provider_advisory', 'financial_institution', 'research_publisher', 'other_reviewed'
  )),
  jurisdiction text NOT NULL CHECK (jurisdiction ~ '^[A-Z][A-Z0-9_-]{1,31}$'),
  locale text NOT NULL CHECK (locale ~ '^[a-z]{2,3}-[A-Z]{2}$'),
  intended_products jsonb NOT NULL CHECK (
    jsonb_typeof(intended_products) = 'array'
    AND jsonb_array_length(intended_products) BETWEEN 1 AND 10
    AND intended_products <@ '[
      "urgent_alert", "daily_tip", "weekly_brief", "family_prompt",
      "recovery_guidance", "learning_update", "founder_video_brief",
      "seo_blog_draft", "partner_bulletin", "internal_support_brief"
    ]'::jsonb
  ),
  authority_reason_code text NOT NULL CHECK (
    authority_reason_code ~ '^[a-z][a-z0-9_.:-]{1,119}$'
  ),
  retention_policy_version text NOT NULL CHECK (
    retention_policy_version ~ '^[a-z][a-z0-9_.:-]{1,119}$'
  ),
  lifecycle text NOT NULL CHECK (lifecycle IN ('proposed', 'disabled', 'retired', 'rejected')),
  effective_at timestamptz NOT NULL,
  review_due_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  external_fetch_enabled boolean NOT NULL CHECK (external_fetch_enabled = false),
  created_by_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  UNIQUE (source_key, version),
  CHECK (review_due_at > effective_at),
  CHECK (expires_at >= review_due_at),
  CHECK (created_at <= effective_at)
);

CREATE TABLE editorial_source_review_events (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'),
  source_version_id text NOT NULL REFERENCES editorial_source_versions(id) ON DELETE RESTRICT,
  review_role text NOT NULL CHECK (review_role IN (
    'primary_source', 'domain', 'rights', 'security', 'final_source'
  )),
  sequence integer NOT NULL CHECK (sequence > 0),
  employee_assignment_id text NOT NULL REFERENCES employee_assignments(id) ON DELETE RESTRICT,
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('approve', 'changes_requested', 'reject')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_.:-]{1,119}$'),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  occurred_at timestamptz NOT NULL,
  UNIQUE (source_version_id, review_role, sequence)
);

CREATE TABLE editorial_artifact_receipts (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'),
  source_version_id text NOT NULL REFERENCES editorial_source_versions(id) ON DELETE RESTRICT,
  artifact_key text NOT NULL CHECK (artifact_key ~ '^artifact_[a-z0-9_]{2,109}$'),
  locator_sha256 text NOT NULL CHECK (locator_sha256 ~ '^[a-f0-9]{64}$'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  source_published_at timestamptz,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  parser_version text NOT NULL CHECK (parser_version = 'local-fixture-metadata-v1'),
  employee_assignment_id text NOT NULL REFERENCES employee_assignments(id) ON DELETE RESTRICT,
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  receipt_kind text NOT NULL CHECK (receipt_kind = 'local_fixture'),
  external_fetch_performed boolean NOT NULL CHECK (external_fetch_performed = false),
  provider_processed boolean NOT NULL CHECK (provider_processed = false),
  raw_artifact_stored boolean NOT NULL CHECK (raw_artifact_stored = false),
  normalized_content_stored boolean NOT NULL CHECK (normalized_content_stored = false),
  created_at timestamptz NOT NULL,
  UNIQUE (source_version_id, artifact_key, locator_sha256, content_sha256),
  CHECK (source_published_at IS NULL OR source_published_at <= observed_at),
  CHECK (expires_at > observed_at),
  CHECK (created_at = observed_at)
);

CREATE TABLE editorial_claim_versions (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'),
  claim_key text NOT NULL CHECK (claim_key ~ '^claim_[a-z0-9_]{2,112}$'),
  version integer NOT NULL CHECK (version > 0),
  artifact_receipt_id text NOT NULL REFERENCES editorial_artifact_receipts(id) ON DELETE RESTRICT,
  artifact_span_sha256 text NOT NULL CHECK (artifact_span_sha256 ~ '^[a-f0-9]{64}$'),
  subject_code text NOT NULL CHECK (subject_code ~ '^[a-z][a-z0-9_.:-]{1,119}$'),
  predicate_code text NOT NULL CHECK (predicate_code ~ '^[a-z][a-z0-9_.:-]{1,119}$'),
  scope_code text NOT NULL CHECK (scope_code ~ '^[a-z][a-z0-9_.:-]{1,119}$'),
  jurisdiction text NOT NULL CHECK (jurisdiction ~ '^[A-Z][A-Z0-9_-]{1,31}$'),
  uncertainty text NOT NULL CHECK (uncertainty IN ('unknown', 'limited', 'moderate', 'strong')),
  valid_from timestamptz NOT NULL,
  valid_through timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  raw_claim_stored boolean NOT NULL CHECK (raw_claim_stored = false),
  model_generated boolean NOT NULL CHECK (model_generated = false),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  employee_assignment_id text NOT NULL REFERENCES employee_assignments(id) ON DELETE RESTRICT,
  created_by_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  UNIQUE (claim_key, version),
  CHECK (valid_through >= valid_from),
  CHECK (expires_at >= valid_through)
);

CREATE TABLE editorial_story_relationship_events (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'),
  relationship_key text NOT NULL CHECK (
    relationship_key ~ '^relationship_[a-z0-9_]{2,105}$'
  ),
  sequence integer NOT NULL CHECK (sequence > 0),
  left_artifact_id text NOT NULL REFERENCES editorial_artifact_receipts(id) ON DELETE RESTRICT,
  right_artifact_id text NOT NULL REFERENCES editorial_artifact_receipts(id) ON DELETE RESTRICT,
  relationship text NOT NULL CHECK (relationship IN (
    'identical_update', 'syndication', 'same_incident', 'similar_mechanism',
    'corroborates', 'contradicts', 'supersedes', 'not_related'
  )),
  decision text NOT NULL CHECK (decision IN ('candidate', 'confirmed', 'rejected', 'split')),
  confidence text NOT NULL CHECK (confidence IN ('limited', 'moderate', 'strong')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_.:-]{1,119}$'),
  employee_assignment_id text NOT NULL REFERENCES employee_assignments(id) ON DELETE RESTRICT,
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  model_generated boolean NOT NULL CHECK (model_generated = false),
  occurred_at timestamptz NOT NULL,
  UNIQUE (relationship_key, sequence),
  CHECK (left_artifact_id <> right_artifact_id)
);

CREATE TABLE editorial_content_versions (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'),
  content_key text NOT NULL CHECK (content_key ~ '^content_[a-z0-9_]{2,110}$'),
  version integer NOT NULL CHECK (version > 0),
  product_kind text NOT NULL CHECK (product_kind IN (
    'urgent_alert', 'daily_tip', 'weekly_brief', 'family_prompt', 'recovery_guidance',
    'learning_update', 'founder_video_brief', 'seo_blog_draft', 'partner_bulletin',
    'internal_support_brief'
  )),
  audience text NOT NULL CHECK (audience IN ('internal', 'customer', 'public', 'partner')),
  channel text NOT NULL CHECK (channel = 'internal_review_only'),
  locale text NOT NULL CHECK (locale ~ '^[a-z]{2,3}-[A-Z]{2}$'),
  jurisdiction text NOT NULL CHECK (jurisdiction ~ '^[A-Z][A-Z0-9_-]{1,31}$'),
  urgency text NOT NULL CHECK (urgency IN ('routine', 'time_sensitive', 'urgent_candidate')),
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[a-f0-9]{64}$'),
  unsupported_statistics boolean NOT NULL,
  unverified_urgency boolean NOT NULL,
  expires_at timestamptz NOT NULL,
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  provider_processed boolean NOT NULL CHECK (provider_processed = false),
  publication_enabled boolean NOT NULL CHECK (publication_enabled = false),
  outbound_delivery_enabled boolean NOT NULL CHECK (outbound_delivery_enabled = false),
  external_action_executed boolean NOT NULL CHECK (external_action_executed = false),
  created_by_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  UNIQUE (content_key, version),
  CHECK (expires_at > created_at)
);

CREATE TABLE editorial_content_payloads (
  content_version_id text PRIMARY KEY REFERENCES editorial_content_versions(id) ON DELETE RESTRICT,
  payload_state text NOT NULL CHECK (payload_state = 'encrypted_local_draft'),
  encrypted_text text NOT NULL CHECK (char_length(encrypted_text) BETWEEN 64 AND 32768),
  encryption_key_version integer NOT NULL CHECK (encryption_key_version > 0),
  created_at timestamptz NOT NULL
);

CREATE TABLE editorial_content_source_links (
  content_version_id text NOT NULL REFERENCES editorial_content_versions(id) ON DELETE RESTRICT,
  source_version_id text NOT NULL REFERENCES editorial_source_versions(id) ON DELETE RESTRICT,
  PRIMARY KEY (content_version_id, source_version_id)
);

CREATE TABLE editorial_content_claim_links (
  content_version_id text NOT NULL REFERENCES editorial_content_versions(id) ON DELETE RESTRICT,
  claim_version_id text NOT NULL REFERENCES editorial_claim_versions(id) ON DELETE RESTRICT,
  PRIMARY KEY (content_version_id, claim_version_id)
);

CREATE TABLE editorial_assignment_events (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'),
  content_version_id text NOT NULL REFERENCES editorial_content_versions(id) ON DELETE RESTRICT,
  review_role text NOT NULL CHECK (review_role IN (
    'fraud_analysis', 'evidence_corroboration', 'safety_action', 'skeptical',
    'accessibility', 'privacy_rights', 'final_human'
  )),
  sequence integer NOT NULL CHECK (sequence > 0),
  employee_assignment_id text NOT NULL REFERENCES employee_assignments(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('assigned', 'withdrawn', 'completed')),
  assigned_by_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_.:-]{1,119}$'),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  occurred_at timestamptz NOT NULL,
  UNIQUE (content_version_id, review_role, sequence)
);

CREATE TABLE editorial_review_events (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'),
  content_version_id text NOT NULL REFERENCES editorial_content_versions(id) ON DELETE RESTRICT,
  review_role text NOT NULL CHECK (review_role IN (
    'fraud_analysis', 'evidence_corroboration', 'safety_action', 'skeptical',
    'accessibility', 'privacy_rights', 'final_human'
  )),
  sequence integer NOT NULL CHECK (sequence > 0),
  assignment_event_id text NOT NULL REFERENCES editorial_assignment_events(id) ON DELETE RESTRICT,
  employee_assignment_id text NOT NULL REFERENCES employee_assignments(id) ON DELETE RESTRICT,
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('approve', 'changes_requested', 'reject')),
  reviewed_body_sha256 text NOT NULL CHECK (reviewed_body_sha256 ~ '^[a-f0-9]{64}$'),
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_.:-]{1,119}$'),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  occurred_at timestamptz NOT NULL,
  UNIQUE (content_version_id, review_role, sequence)
);

CREATE TABLE editorial_content_state_events (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'),
  content_version_id text NOT NULL REFERENCES editorial_content_versions(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  to_state text NOT NULL CHECK (to_state IN (
    'draft', 'under_review', 'approved_internal', 'correction_pending',
    'corrected', 'retracted', 'expired', 'archived'
  )),
  actor_person_id text REFERENCES persons(id) ON DELETE RESTRICT,
  service_key text CHECK (service_key IS NULL OR service_key = 'editorial.local_repository'),
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_.:-]{1,119}$'),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  occurred_at timestamptz NOT NULL,
  UNIQUE (content_version_id, sequence),
  CHECK ((actor_person_id IS NULL) <> (service_key IS NULL))
);

CREATE TABLE editorial_correction_events (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'),
  original_content_version_id text NOT NULL REFERENCES editorial_content_versions(id) ON DELETE RESTRICT,
  replacement_content_version_id text REFERENCES editorial_content_versions(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  disposition text NOT NULL CHECK (disposition IN ('correction', 'retraction')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_.:-]{1,119}$'),
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  external_action_executed boolean NOT NULL CHECK (external_action_executed = false),
  occurred_at timestamptz NOT NULL,
  UNIQUE (original_content_version_id, sequence),
  CHECK (
    (disposition = 'correction' AND replacement_content_version_id IS NOT NULL)
    OR (disposition = 'retraction' AND replacement_content_version_id IS NULL)
  ),
  CHECK (replacement_content_version_id IS NULL OR replacement_content_version_id <> original_content_version_id)
);

CREATE TABLE editorial_calendar_events (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'),
  content_version_id text NOT NULL REFERENCES editorial_content_versions(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  state text NOT NULL CHECK (state IN ('internal_review_planned', 'blocked', 'cancelled')),
  planned_for timestamptz NOT NULL,
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_.:-]{1,119}$'),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  external_action_enabled boolean NOT NULL CHECK (external_action_enabled = false),
  occurred_at timestamptz NOT NULL,
  UNIQUE (content_version_id, sequence)
);

CREATE TABLE editorial_preference_events (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'),
  subject_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  product_kind text NOT NULL CHECK (product_kind IN (
    'urgent_alert', 'daily_tip', 'weekly_brief', 'family_prompt', 'recovery_guidance',
    'learning_update', 'founder_video_brief', 'seo_blog_draft', 'partner_bulletin',
    'internal_support_brief'
  )),
  channel text NOT NULL CHECK (channel IN ('in_app', 'email', 'sms', 'push')),
  sequence integer NOT NULL CHECK (sequence > 0),
  state text NOT NULL CHECK (state IN ('granted', 'withdrawn')),
  consent_version text,
  locale text CHECK (locale IS NULL OR locale ~ '^[a-z]{2,3}-[A-Z]{2}$'),
  timezone_name text CHECK (
    timezone_name IS NULL OR timezone_name ~ '^[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+$'
  ),
  quiet_hours_start smallint CHECK (quiet_hours_start IS NULL OR quiet_hours_start BETWEEN 0 AND 1439),
  quiet_hours_end smallint CHECK (quiet_hours_end IS NULL OR quiet_hours_end BETWEEN 0 AND 1439),
  frequency text CHECK (frequency IS NULL OR frequency IN ('urgent_only', 'daily', 'weekly', 'monthly')),
  expires_at timestamptz,
  source_surface text NOT NULL CHECK (source_surface = 'local_fixture'),
  evidence_tier text NOT NULL CHECK (evidence_tier = 'local_simulation'),
  external_delivery_enabled boolean NOT NULL CHECK (external_delivery_enabled = false),
  occurred_at timestamptz NOT NULL,
  UNIQUE (subject_person_id, product_kind, channel, sequence),
  CHECK (subject_person_id = actor_person_id),
  CHECK (
    (state = 'granted'
      AND consent_version = 'editorial-preference-local-fixture-v1'
      AND locale IS NOT NULL AND timezone_name IS NOT NULL
      AND quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL
      AND frequency IS NOT NULL AND expires_at > occurred_at)
    OR (state = 'withdrawn' AND consent_version IS NULL AND expires_at IS NULL)
  )
);

CREATE INDEX editorial_source_review_queue_idx
  ON editorial_source_versions(review_due_at, source_key, version);
CREATE INDEX editorial_content_expiry_idx
  ON editorial_content_versions(expires_at, content_key, version);
CREATE INDEX editorial_assignment_actor_idx
  ON editorial_assignment_events(employee_assignment_id, occurred_at, content_version_id);
CREATE INDEX editorial_correction_queue_idx
  ON editorial_correction_events(occurred_at, original_content_version_id);

CREATE OR REPLACE FUNCTION reject_editorial_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Editorial intelligence evidence is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION editorial_internal_employee_role(
  target_assignment_id text,
  target_person_id text
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT employee.role
  FROM employee_assignments employee
  JOIN organizations organization ON organization.id = employee.organization_id
  WHERE employee.id = target_assignment_id
    AND employee.person_id = target_person_id
    AND employee.status = 'active'
    AND organization.kind = 'internal'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION editorial_person_has_internal_owner(target_person_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employee_assignments employee
    JOIN organizations organization ON organization.id = employee.organization_id
    WHERE employee.person_id = target_person_id
      AND employee.role = 'hq_owner' AND employee.status = 'active'
      AND organization.kind = 'internal'
  )
$$;

CREATE OR REPLACE FUNCTION editorial_database_authority_time(candidate_time timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  authority_now timestamptz := clock_timestamp();
BEGIN
  IF candidate_time < date_trunc('milliseconds', transaction_timestamp())
    OR candidate_time > authority_now THEN
    RAISE EXCEPTION 'Editorial event time must come from the current database transaction';
  END IF;
  RETURN authority_now;
END;
$$;

CREATE OR REPLACE FUNCTION editorial_source_is_approved(
  target_source_version_id text,
  evaluated_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM editorial_source_versions source
    WHERE source.id = target_source_version_id
      AND source.lifecycle = 'proposed'
      AND source.effective_at <= evaluated_at
      AND source.review_due_at > evaluated_at
      AND source.expires_at > evaluated_at
      AND NOT EXISTS (
        SELECT 1 FROM editorial_source_versions newer
        WHERE newer.source_key = source.source_key AND newer.version > source.version
      )
      AND (
        SELECT count(*) FROM (
          SELECT DISTINCT ON (review.review_role)
            review.review_role, review.decision, review.actor_person_id,
            review.employee_assignment_id
          FROM editorial_source_review_events review
          WHERE review.source_version_id = source.id
          ORDER BY review.review_role, review.sequence DESC
        ) latest
        WHERE latest.decision = 'approve'
          AND editorial_internal_employee_role(
            latest.employee_assignment_id,
            latest.actor_person_id
          ) IN ('hq_owner', 'hq_reviewer')
          AND (
            latest.review_role <> 'final_source'
            OR editorial_internal_employee_role(
              latest.employee_assignment_id,
              latest.actor_person_id
            ) = 'hq_owner'
          )
      ) = 5
      AND (
        SELECT count(DISTINCT latest.actor_person_id) FROM (
          SELECT DISTINCT ON (review.review_role)
            review.review_role, review.decision, review.actor_person_id,
            review.employee_assignment_id
          FROM editorial_source_review_events review
          WHERE review.source_version_id = source.id
          ORDER BY review.review_role, review.sequence DESC
        ) latest
        WHERE latest.decision = 'approve'
          AND editorial_internal_employee_role(
            latest.employee_assignment_id,
            latest.actor_person_id
          ) IN ('hq_owner', 'hq_reviewer')
      ) >= 2
  )
$$;

CREATE OR REPLACE FUNCTION validate_editorial_source_review_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous editorial_source_review_events%ROWTYPE;
  employee_role text;
  expected_sequence integer;
  prerequisite_approvals integer;
  approving_people integer;
BEGIN
  PERFORM 1 FROM editorial_review_mutex WHERE singleton FOR UPDATE;
  PERFORM 1 FROM editorial_source_versions WHERE id = NEW.source_version_id FOR UPDATE;
  PERFORM editorial_database_authority_time(NEW.occurred_at);
  SELECT * INTO previous FROM editorial_source_review_events
  WHERE source_version_id = NEW.source_version_id AND review_role = NEW.review_role
  ORDER BY sequence DESC LIMIT 1;
  IF previous.id IS NOT NULL AND NEW.occurred_at < previous.occurred_at THEN
    RAISE EXCEPTION 'Editorial source review chronology is invalid';
  END IF;
  SELECT COALESCE(max(sequence), 0) + 1 INTO expected_sequence
  FROM editorial_source_review_events
  WHERE source_version_id = NEW.source_version_id AND review_role = NEW.review_role;
  IF NEW.sequence <> expected_sequence THEN
    RAISE EXCEPTION 'Editorial source review sequence is invalid';
  END IF;
  employee_role := editorial_internal_employee_role(
    NEW.employee_assignment_id,
    NEW.actor_person_id
  );
  IF employee_role IS NULL OR employee_role NOT IN ('hq_owner', 'hq_reviewer') THEN
    RAISE EXCEPTION 'Editorial source review requires current internal review authority';
  END IF;
  IF NEW.review_role = 'final_source' AND employee_role <> 'hq_owner' THEN
    RAISE EXCEPTION 'Final source review requires current internal owner authority';
  END IF;
  IF NEW.review_role = 'final_source' AND NEW.decision = 'approve' THEN
    SELECT count(*) INTO prerequisite_approvals FROM (
      SELECT DISTINCT ON (review.review_role) review.review_role, review.decision
      FROM editorial_source_review_events review
      WHERE review.source_version_id = NEW.source_version_id
        AND review.review_role IN ('primary_source', 'domain', 'rights', 'security')
      ORDER BY review.review_role, review.sequence DESC
    ) latest WHERE latest.decision = 'approve';
    SELECT count(DISTINCT actor_person_id) INTO approving_people
    FROM editorial_source_review_events review
    WHERE review.source_version_id = NEW.source_version_id
      AND review.review_role IN ('primary_source', 'domain', 'rights', 'security')
      AND review.decision = 'approve';
    IF prerequisite_approvals <> 4 OR approving_people < 1 OR EXISTS (
      SELECT 1 FROM editorial_source_review_events review
      WHERE review.source_version_id = NEW.source_version_id
        AND review.review_role = 'primary_source'
        AND review.actor_person_id = NEW.actor_person_id
        AND review.decision = 'approve'
        AND NOT EXISTS (
          SELECT 1 FROM editorial_source_review_events newer
          WHERE newer.source_version_id = review.source_version_id
            AND newer.review_role = review.review_role
            AND newer.sequence > review.sequence
        )
    ) THEN
      RAISE EXCEPTION 'Final source review requires complete independent prerequisite approvals';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER editorial_source_review_valid
BEFORE INSERT ON editorial_source_review_events
FOR EACH ROW EXECUTE FUNCTION validate_editorial_source_review_event();

CREATE OR REPLACE FUNCTION validate_editorial_artifact_receipt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  employee_role text;
  authority_now timestamptz;
BEGIN
  PERFORM 1 FROM editorial_review_mutex WHERE singleton FOR UPDATE;
  PERFORM 1 FROM editorial_source_versions WHERE id = NEW.source_version_id FOR UPDATE;
  authority_now := editorial_database_authority_time(NEW.observed_at);
  employee_role := editorial_internal_employee_role(
    NEW.employee_assignment_id,
    NEW.actor_person_id
  );
  IF employee_role IS NULL OR employee_role NOT IN ('hq_owner', 'hq_reviewer') THEN
    RAISE EXCEPTION 'Editorial artifact receipt requires current internal review authority';
  END IF;
  IF NEW.expires_at <= authority_now
    OR NOT editorial_source_is_approved(NEW.source_version_id, authority_now) THEN
    RAISE EXCEPTION 'Editorial artifact receipt requires an exact current approved source version';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER editorial_artifact_receipt_valid
BEFORE INSERT ON editorial_artifact_receipts
FOR EACH ROW EXECUTE FUNCTION validate_editorial_artifact_receipt();

CREATE OR REPLACE FUNCTION validate_editorial_claim_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  artifact editorial_artifact_receipts%ROWTYPE;
  source editorial_source_versions%ROWTYPE;
  employee_role text;
  authority_now timestamptz;
BEGIN
  PERFORM 1 FROM editorial_review_mutex WHERE singleton FOR UPDATE;
  authority_now := editorial_database_authority_time(NEW.created_at);
  SELECT * INTO artifact FROM editorial_artifact_receipts
  WHERE id = NEW.artifact_receipt_id FOR UPDATE;
  SELECT * INTO source FROM editorial_source_versions
  WHERE id = artifact.source_version_id FOR UPDATE;
  PERFORM employee.id FROM employee_assignments employee
  JOIN organizations organization ON organization.id = employee.organization_id
  WHERE employee.id = NEW.employee_assignment_id
    AND employee.person_id = NEW.created_by_person_id
  FOR UPDATE OF employee, organization;
  employee_role := editorial_internal_employee_role(
    NEW.employee_assignment_id,
    NEW.created_by_person_id
  );
  IF employee_role IS NULL OR employee_role NOT IN ('hq_owner', 'hq_reviewer') THEN
    RAISE EXCEPTION 'Editorial claim requires current internal review authority';
  END IF;
  IF artifact.id IS NULL OR source.id IS NULL
    OR NEW.jurisdiction <> source.jurisdiction
    OR artifact.observed_at > authority_now
    OR artifact.expires_at <= authority_now
    OR NEW.created_at < artifact.observed_at
    OR NEW.created_at >= artifact.expires_at
    OR NEW.valid_from < artifact.observed_at
    OR NEW.valid_through > artifact.expires_at
    OR NEW.expires_at > artifact.expires_at
    OR NEW.created_at < source.effective_at
    OR NEW.created_at >= source.review_due_at
    OR NEW.created_at >= source.expires_at
    OR NEW.valid_from < source.effective_at
    OR NEW.valid_through > source.review_due_at
    OR NEW.valid_through > source.expires_at
    OR NEW.expires_at > source.review_due_at
    OR NEW.expires_at > source.expires_at
    OR NEW.valid_through < NEW.created_at
    OR NEW.expires_at <= NEW.created_at
    OR NOT editorial_source_is_approved(source.id, authority_now) THEN
    RAISE EXCEPTION 'Editorial claim must remain inside exact current artifact and source authority';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER editorial_claim_version_valid
BEFORE INSERT ON editorial_claim_versions
FOR EACH ROW EXECUTE FUNCTION validate_editorial_claim_version();

CREATE OR REPLACE FUNCTION validate_editorial_story_relationship_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous editorial_story_relationship_events%ROWTYPE;
  employee_role text;
  expected_sequence integer;
  left_source text;
  right_source text;
BEGIN
  PERFORM 1 FROM editorial_review_mutex WHERE singleton FOR UPDATE;
  PERFORM editorial_database_authority_time(NEW.occurred_at);
  SELECT * INTO previous FROM editorial_story_relationship_events
  WHERE relationship_key = NEW.relationship_key
  ORDER BY sequence DESC LIMIT 1;
  expected_sequence := COALESCE(previous.sequence, 0) + 1;
  IF NEW.sequence <> expected_sequence THEN
    RAISE EXCEPTION 'Editorial story relationship sequence is invalid';
  END IF;
  IF previous.id IS NOT NULL AND (
    NEW.left_artifact_id IS DISTINCT FROM previous.left_artifact_id
    OR NEW.right_artifact_id IS DISTINCT FROM previous.right_artifact_id
    OR NEW.relationship IS DISTINCT FROM previous.relationship
  ) THEN
    RAISE EXCEPTION 'Editorial story relationship identity is immutable';
  END IF;
  IF previous.id IS NOT NULL AND NEW.occurred_at < previous.occurred_at THEN
    RAISE EXCEPTION 'Editorial story relationship chronology is invalid';
  END IF;
  employee_role := editorial_internal_employee_role(
    NEW.employee_assignment_id,
    NEW.actor_person_id
  );
  IF employee_role IS NULL OR employee_role NOT IN ('hq_owner', 'hq_reviewer') THEN
    RAISE EXCEPTION 'Editorial story relationship requires current internal review authority';
  END IF;
  IF NEW.decision = 'confirmed'
    AND NEW.relationship IN ('corroborates', 'identical_update', 'syndication') THEN
    IF NEW.relationship = 'corroborates' THEN
      SELECT source_version_id INTO left_source
      FROM editorial_artifact_receipts WHERE id = NEW.left_artifact_id;
      SELECT source_version_id INTO right_source
      FROM editorial_artifact_receipts WHERE id = NEW.right_artifact_id;
      IF left_source = right_source THEN
        RAISE EXCEPTION 'One source cannot independently corroborate itself';
      END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM (
        SELECT DISTINCT ON (relationship_key)
          left_artifact_id, right_artifact_id, relationship, decision
        FROM editorial_story_relationship_events
        WHERE (left_artifact_id = NEW.left_artifact_id AND right_artifact_id = NEW.right_artifact_id)
           OR (left_artifact_id = NEW.right_artifact_id AND right_artifact_id = NEW.left_artifact_id)
        ORDER BY relationship_key, sequence DESC
      ) latest
      WHERE latest.decision = 'confirmed'
        AND (
          (NEW.relationship = 'corroborates'
            AND latest.relationship IN ('identical_update', 'syndication'))
          OR (NEW.relationship IN ('identical_update', 'syndication')
            AND latest.relationship = 'corroborates')
        )
    ) THEN
      RAISE EXCEPTION 'Corroboration conflicts with confirmed duplicate or syndicated evidence';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER editorial_story_relationship_valid
BEFORE INSERT ON editorial_story_relationship_events
FOR EACH ROW EXECUTE FUNCTION validate_editorial_story_relationship_event();

CREATE OR REPLACE FUNCTION validate_editorial_assignment_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous editorial_assignment_events%ROWTYPE;
  assignee_role text;
BEGIN
  PERFORM 1 FROM editorial_review_mutex WHERE singleton FOR UPDATE;
  PERFORM 1 FROM editorial_content_versions WHERE id = NEW.content_version_id FOR UPDATE;
  PERFORM editorial_database_authority_time(NEW.occurred_at);
  IF NOT editorial_person_has_internal_owner(NEW.assigned_by_person_id) THEN
    RAISE EXCEPTION 'Editorial assignment requires current internal owner authority';
  END IF;
  SELECT * INTO previous FROM editorial_assignment_events
  WHERE content_version_id = NEW.content_version_id AND review_role = NEW.review_role
  ORDER BY sequence DESC LIMIT 1;
  IF NEW.sequence <> COALESCE(previous.sequence, 0) + 1 THEN
    RAISE EXCEPTION 'Editorial assignment sequence is invalid';
  END IF;
  IF previous.id IS NOT NULL AND NEW.occurred_at < previous.occurred_at THEN
    RAISE EXCEPTION 'Editorial assignment chronology is invalid';
  END IF;
  assignee_role := (
    SELECT employee.role FROM employee_assignments employee
    JOIN organizations organization ON organization.id = employee.organization_id
    WHERE employee.id = NEW.employee_assignment_id
      AND employee.status = 'active' AND organization.kind = 'internal'
    LIMIT 1
  );
  IF assignee_role IS NULL OR assignee_role NOT IN ('hq_owner', 'hq_reviewer') THEN
    RAISE EXCEPTION 'Editorial assignment requires an active internal reviewer';
  END IF;
  IF NEW.review_role = 'final_human' AND assignee_role <> 'hq_owner' THEN
    RAISE EXCEPTION 'Final human assignment requires an internal owner';
  END IF;
  IF previous.id IS NULL AND NEW.state <> 'assigned' THEN
    RAISE EXCEPTION 'Initial editorial assignment must be assigned';
  END IF;
  IF previous.id IS NOT NULL AND previous.state <> 'assigned' AND NEW.state <> 'assigned' THEN
    RAISE EXCEPTION 'Inactive editorial assignment must be explicitly reassigned first';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER editorial_assignment_valid
BEFORE INSERT ON editorial_assignment_events
FOR EACH ROW EXECUTE FUNCTION validate_editorial_assignment_event();

CREATE OR REPLACE FUNCTION editorial_content_has_current_approvals(
  target_content_version_id text,
  evaluated_at timestamptz,
  candidate_final_person_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM editorial_content_versions content
    WHERE content.id = target_content_version_id
      AND content.expires_at > evaluated_at
      AND content.unsupported_statistics = false
      AND content.unverified_urgency = false
      AND NOT EXISTS (
        SELECT 1 FROM editorial_content_source_links link
        JOIN editorial_source_versions source ON source.id = link.source_version_id
        WHERE link.content_version_id = content.id
          AND (
            NOT editorial_source_is_approved(link.source_version_id, evaluated_at)
            OR NOT (source.intended_products ? content.product_kind)
            OR source.locale <> content.locale
            OR source.jurisdiction <> content.jurisdiction
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM editorial_content_claim_links link
        JOIN editorial_claim_versions claim ON claim.id = link.claim_version_id
        JOIN editorial_artifact_receipts artifact ON artifact.id = claim.artifact_receipt_id
        JOIN editorial_source_versions source ON source.id = artifact.source_version_id
        WHERE link.content_version_id = content.id
          AND (
            claim.valid_from > evaluated_at
            OR claim.valid_through < evaluated_at
            OR claim.expires_at <= evaluated_at
            OR claim.jurisdiction <> content.jurisdiction
            OR claim.jurisdiction <> source.jurisdiction
            OR artifact.observed_at > evaluated_at
            OR artifact.expires_at <= evaluated_at
            OR claim.valid_from < artifact.observed_at
            OR claim.valid_through > artifact.expires_at
            OR claim.expires_at > artifact.expires_at
            OR claim.valid_from < source.effective_at
            OR claim.valid_through > source.review_due_at
            OR claim.valid_through > source.expires_at
            OR claim.expires_at > source.review_due_at
            OR claim.expires_at > source.expires_at
            OR NOT editorial_source_is_approved(source.id, evaluated_at)
            OR NOT (source.intended_products ? content.product_kind)
            OR source.locale <> content.locale
            OR source.jurisdiction <> content.jurisdiction
            OR NOT EXISTS (
              SELECT 1 FROM editorial_content_source_links source_link
              WHERE source_link.content_version_id = content.id
                AND source_link.source_version_id = source.id
            )
            OR EXISTS (
            SELECT 1 FROM editorial_claim_versions newer
            WHERE newer.claim_key = claim.claim_key AND newer.version > claim.version
            )
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM (
          SELECT DISTINCT ON (relationship.relationship_key)
            relationship.left_artifact_id, relationship.right_artifact_id,
            relationship.relationship, relationship.decision
          FROM editorial_story_relationship_events relationship
          ORDER BY relationship.relationship_key, relationship.sequence DESC
        ) latest
        WHERE latest.relationship = 'contradicts' AND latest.decision = 'confirmed'
          AND EXISTS (
            SELECT 1 FROM editorial_content_claim_links link
            JOIN editorial_claim_versions claim ON claim.id = link.claim_version_id
            WHERE link.content_version_id = content.id
              AND claim.artifact_receipt_id IN (latest.left_artifact_id, latest.right_artifact_id)
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM (
          SELECT DISTINCT ON (relationship.relationship_key)
            relationship.left_artifact_id, relationship.right_artifact_id,
            relationship.relationship, relationship.decision
          FROM editorial_story_relationship_events relationship
          ORDER BY relationship.relationship_key, relationship.sequence DESC
        ) latest
        WHERE latest.relationship IN ('identical_update', 'syndication')
          AND latest.decision = 'confirmed'
          AND EXISTS (
            SELECT 1 FROM editorial_content_claim_links link
            JOIN editorial_claim_versions claim ON claim.id = link.claim_version_id
            WHERE link.content_version_id = content.id
              AND claim.artifact_receipt_id = latest.left_artifact_id
          )
          AND EXISTS (
            SELECT 1 FROM editorial_content_claim_links link
            JOIN editorial_claim_versions claim ON claim.id = link.claim_version_id
            WHERE link.content_version_id = content.id
              AND claim.artifact_receipt_id = latest.right_artifact_id
          )
      )
      AND (
        SELECT count(*) FROM (
          SELECT DISTINCT ON (review.review_role)
            review.review_role, review.decision, review.actor_person_id
          FROM editorial_review_events review
          WHERE review.content_version_id = content.id
            AND review.review_role IN (
              'fraud_analysis', 'evidence_corroboration', 'safety_action',
              'skeptical', 'accessibility', 'privacy_rights'
            )
          ORDER BY review.review_role, review.sequence DESC
        ) latest
        WHERE latest.decision = 'approve'
      ) = 6
      AND NOT EXISTS (
        SELECT 1 FROM (
          SELECT DISTINCT ON (review.review_role)
            review.review_role, review.decision, review.actor_person_id,
            review.assignment_event_id, review.employee_assignment_id
          FROM editorial_review_events review
          WHERE review.content_version_id = content.id
            AND review.review_role IN (
              'fraud_analysis', 'evidence_corroboration', 'safety_action',
              'skeptical', 'accessibility', 'privacy_rights'
            )
          ORDER BY review.review_role, review.sequence DESC
        ) latest_review
        LEFT JOIN LATERAL (
          SELECT assignment.id, assignment.employee_assignment_id, assignment.state
          FROM editorial_assignment_events assignment
          WHERE assignment.content_version_id = content.id
            AND assignment.review_role = latest_review.review_role
          ORDER BY assignment.sequence DESC LIMIT 1
        ) latest_assignment ON true
        WHERE latest_review.decision <> 'approve'
          OR latest_assignment.state IS DISTINCT FROM 'assigned'
          OR latest_assignment.id IS DISTINCT FROM latest_review.assignment_event_id
          OR latest_assignment.employee_assignment_id IS DISTINCT FROM
             latest_review.employee_assignment_id
          OR COALESCE(
            editorial_internal_employee_role(
              latest_review.employee_assignment_id,
              latest_review.actor_person_id
            ) NOT IN ('hq_owner', 'hq_reviewer'),
            true
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM editorial_review_events review
        WHERE review.content_version_id = content.id
          AND review.review_role = 'skeptical'
          AND review.actor_person_id = candidate_final_person_id
          AND review.decision = 'approve'
          AND NOT EXISTS (
            SELECT 1 FROM editorial_review_events newer
            WHERE newer.content_version_id = review.content_version_id
              AND newer.review_role = review.review_role
              AND newer.sequence > review.sequence
          )
      )
  )
$$;

CREATE OR REPLACE FUNCTION editorial_content_has_current_final_approval(
  target_content_version_id text,
  target_final_person_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM editorial_review_events final_review
    WHERE final_review.content_version_id = target_content_version_id
      AND final_review.review_role = 'final_human'
      AND final_review.decision = 'approve'
      AND final_review.actor_person_id = target_final_person_id
      AND NOT EXISTS (
        SELECT 1 FROM editorial_review_events newer
        WHERE newer.content_version_id = final_review.content_version_id
          AND newer.review_role = final_review.review_role
          AND newer.sequence > final_review.sequence
      )
      AND EXISTS (
        SELECT 1 FROM editorial_assignment_events assignment
        WHERE assignment.content_version_id = final_review.content_version_id
          AND assignment.review_role = 'final_human'
          AND assignment.state = 'assigned'
          AND assignment.id = final_review.assignment_event_id
          AND assignment.employee_assignment_id = final_review.employee_assignment_id
          AND NOT EXISTS (
            SELECT 1 FROM editorial_assignment_events newer
            WHERE newer.content_version_id = assignment.content_version_id
              AND newer.review_role = assignment.review_role
              AND newer.sequence > assignment.sequence
          )
      )
      AND editorial_internal_employee_role(
        final_review.employee_assignment_id,
        final_review.actor_person_id
      ) = 'hq_owner'
  )
$$;

CREATE OR REPLACE FUNCTION validate_editorial_review_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  latest_assignment editorial_assignment_events%ROWTYPE;
  previous_review editorial_review_events%ROWTYPE;
  employee_role text;
  expected_sequence integer;
  expected_digest text;
  content_created_at timestamptz;
  authority_now timestamptz;
BEGIN
  PERFORM 1 FROM editorial_review_mutex WHERE singleton FOR UPDATE;
  PERFORM 1 FROM editorial_content_versions WHERE id = NEW.content_version_id FOR UPDATE;
  authority_now := editorial_database_authority_time(NEW.occurred_at);
  SELECT * INTO latest_assignment FROM editorial_assignment_events
  WHERE content_version_id = NEW.content_version_id AND review_role = NEW.review_role
  ORDER BY sequence DESC LIMIT 1;
  IF latest_assignment.id IS NULL OR latest_assignment.state <> 'assigned'
    OR latest_assignment.id <> NEW.assignment_event_id
    OR latest_assignment.employee_assignment_id <> NEW.employee_assignment_id THEN
    RAISE EXCEPTION 'Editorial review requires the exact current assignment';
  END IF;
  employee_role := editorial_internal_employee_role(
    NEW.employee_assignment_id,
    NEW.actor_person_id
  );
  IF employee_role IS NULL OR employee_role NOT IN ('hq_owner', 'hq_reviewer') THEN
    RAISE EXCEPTION 'Editorial review requires current internal review authority';
  END IF;
  IF NEW.review_role = 'final_human' AND employee_role <> 'hq_owner' THEN
    RAISE EXCEPTION 'Final human review requires current internal owner authority';
  END IF;
  SELECT * INTO previous_review FROM editorial_review_events
  WHERE content_version_id = NEW.content_version_id AND review_role = NEW.review_role
  ORDER BY sequence DESC LIMIT 1;
  SELECT COALESCE(max(sequence), 0) + 1 INTO expected_sequence
  FROM editorial_review_events
  WHERE content_version_id = NEW.content_version_id AND review_role = NEW.review_role;
  IF NEW.sequence <> expected_sequence THEN
    RAISE EXCEPTION 'Editorial review sequence is invalid';
  END IF;
  IF NEW.occurred_at < latest_assignment.occurred_at
    OR (previous_review.id IS NOT NULL AND NEW.occurred_at < previous_review.occurred_at) THEN
    RAISE EXCEPTION 'Editorial review chronology is invalid';
  END IF;
  SELECT body_sha256, created_at INTO expected_digest, content_created_at
  FROM editorial_content_versions WHERE id = NEW.content_version_id;
  IF NEW.occurred_at < content_created_at THEN
    RAISE EXCEPTION 'Editorial review chronology is invalid';
  END IF;
  IF NEW.reviewed_body_sha256 <> expected_digest THEN
    RAISE EXCEPTION 'Editorial review does not match the immutable draft digest';
  END IF;
  IF NEW.review_role = 'final_human' AND NEW.decision = 'approve'
    AND NOT editorial_content_has_current_approvals(
      NEW.content_version_id,
      authority_now,
      NEW.actor_person_id
    ) THEN
    RAISE EXCEPTION 'Final human review requires complete current independent evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER editorial_review_valid
BEFORE INSERT ON editorial_review_events
FOR EACH ROW EXECUTE FUNCTION validate_editorial_review_event();

CREATE OR REPLACE FUNCTION validate_editorial_content_state_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous editorial_content_state_events%ROWTYPE;
  allowed boolean := false;
  final_review editorial_review_events%ROWTYPE;
  content_created_at timestamptz;
  authority_now timestamptz;
BEGIN
  PERFORM 1 FROM editorial_review_mutex WHERE singleton FOR UPDATE;
  PERFORM 1 FROM editorial_content_versions WHERE id = NEW.content_version_id FOR UPDATE;
  authority_now := editorial_database_authority_time(NEW.occurred_at);
  SELECT created_at INTO content_created_at
  FROM editorial_content_versions WHERE id = NEW.content_version_id;
  SELECT * INTO previous FROM editorial_content_state_events
  WHERE content_version_id = NEW.content_version_id ORDER BY sequence DESC LIMIT 1;
  IF NEW.sequence <> COALESCE(previous.sequence, 0) + 1 THEN
    RAISE EXCEPTION 'Editorial content state sequence is invalid';
  END IF;
  IF NEW.occurred_at < content_created_at
    OR (previous.id IS NOT NULL AND NEW.occurred_at < previous.occurred_at) THEN
    RAISE EXCEPTION 'Editorial content state chronology is invalid';
  END IF;
  IF previous.id IS NULL THEN
    IF NEW.to_state <> 'draft' OR NEW.service_key <> 'editorial.local_repository'
      OR NEW.actor_person_id IS NOT NULL THEN
      RAISE EXCEPTION 'Initial editorial content state must be a code-owned local draft';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.actor_person_id IS NULL OR NEW.service_key IS NOT NULL THEN
    RAISE EXCEPTION 'Editorial content transitions require a current human actor';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM employee_assignments employee
    JOIN organizations organization ON organization.id = employee.organization_id
    WHERE employee.person_id = NEW.actor_person_id
      AND employee.status = 'active' AND organization.kind = 'internal'
      AND employee.role IN ('hq_owner', 'hq_reviewer')
  ) THEN
    RAISE EXCEPTION 'Editorial content transition requires current internal review authority';
  END IF;
  allowed := CASE previous.to_state
    WHEN 'draft' THEN NEW.to_state IN ('under_review', 'retracted', 'expired', 'archived')
    WHEN 'under_review' THEN NEW.to_state IN (
      'approved_internal', 'correction_pending', 'retracted', 'expired', 'archived'
    )
    WHEN 'approved_internal' THEN NEW.to_state IN (
      'correction_pending', 'retracted', 'expired', 'archived'
    )
    WHEN 'correction_pending' THEN NEW.to_state IN ('corrected', 'retracted', 'expired', 'archived')
    WHEN 'corrected' THEN NEW.to_state IN ('correction_pending', 'retracted', 'expired', 'archived')
    WHEN 'retracted' THEN NEW.to_state = 'archived'
    WHEN 'expired' THEN NEW.to_state = 'archived'
    ELSE false
  END;
  IF NOT allowed THEN
    RAISE EXCEPTION 'Editorial content state transition is invalid';
  END IF;
  IF NEW.to_state = 'under_review' AND NOT EXISTS (
    SELECT 1 FROM editorial_assignment_events assignment
    WHERE assignment.content_version_id = NEW.content_version_id
      AND assignment.state = 'assigned'
      AND NOT EXISTS (
        SELECT 1 FROM editorial_assignment_events newer
        WHERE newer.content_version_id = assignment.content_version_id
          AND newer.review_role = assignment.review_role
          AND newer.sequence > assignment.sequence
      )
  ) THEN
    RAISE EXCEPTION 'Editorial review cannot start without an exact current assignment';
  END IF;
  IF NEW.to_state = 'approved_internal' THEN
    SELECT * INTO final_review FROM editorial_review_events review
    WHERE review.content_version_id = NEW.content_version_id
      AND review.review_role = 'final_human'
    ORDER BY review.sequence DESC LIMIT 1;
    IF final_review.id IS NULL OR final_review.decision <> 'approve'
      OR final_review.actor_person_id <> NEW.actor_person_id
      OR final_review.occurred_at > NEW.occurred_at
      OR NOT editorial_content_has_current_final_approval(
        NEW.content_version_id,
        NEW.actor_person_id
      )
      OR NOT editorial_content_has_current_approvals(
        NEW.content_version_id,
        authority_now,
        NEW.actor_person_id
      ) THEN
      RAISE EXCEPTION 'Internal approval requires the exact current final human evidence';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER editorial_content_state_valid
BEFORE INSERT ON editorial_content_state_events
FOR EACH ROW EXECUTE FUNCTION validate_editorial_content_state_event();

CREATE OR REPLACE FUNCTION validate_editorial_correction_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  original editorial_content_versions%ROWTYPE;
  replacement editorial_content_versions%ROWTYPE;
  previous editorial_correction_events%ROWTYPE;
  final_review editorial_review_events%ROWTYPE;
  replacement_state text;
  expected_sequence integer;
  authority_now timestamptz;
BEGIN
  PERFORM 1 FROM editorial_review_mutex WHERE singleton FOR UPDATE;
  authority_now := editorial_database_authority_time(NEW.occurred_at);
  SELECT * INTO original FROM editorial_content_versions
  WHERE id = NEW.original_content_version_id FOR UPDATE;
  IF NOT editorial_person_has_internal_owner(NEW.actor_person_id) THEN
    RAISE EXCEPTION 'Editorial correction requires current internal owner authority';
  END IF;
  SELECT * INTO previous FROM editorial_correction_events
  WHERE original_content_version_id = NEW.original_content_version_id
  ORDER BY sequence DESC LIMIT 1;
  expected_sequence := COALESCE(previous.sequence, 0) + 1;
  IF NEW.sequence <> expected_sequence THEN
    RAISE EXCEPTION 'Editorial correction sequence is invalid';
  END IF;
  IF NEW.occurred_at < original.created_at
    OR (previous.id IS NOT NULL AND NEW.occurred_at < previous.occurred_at) THEN
    RAISE EXCEPTION 'Editorial correction chronology is invalid';
  END IF;
  IF NEW.disposition = 'correction' THEN
    SELECT * INTO replacement FROM editorial_content_versions
    WHERE id = NEW.replacement_content_version_id FOR UPDATE;
    IF replacement.id IS NULL OR replacement.content_key <> original.content_key
      OR replacement.version <= original.version THEN
      RAISE EXCEPTION 'Editorial correction must point to a newer immutable version';
    END IF;
    IF replacement.product_kind <> original.product_kind
      OR replacement.audience <> original.audience
      OR replacement.locale <> original.locale
      OR replacement.jurisdiction <> original.jurisdiction THEN
      RAISE EXCEPTION 'Editorial correction replacement scope must match the original';
    END IF;
    IF NEW.occurred_at < replacement.created_at THEN
      RAISE EXCEPTION 'Editorial correction chronology is invalid';
    END IF;
    SELECT state.to_state INTO replacement_state
    FROM editorial_content_state_events state
    WHERE state.content_version_id = replacement.id
    ORDER BY state.sequence DESC LIMIT 1;
    SELECT * INTO final_review FROM editorial_review_events review
    WHERE review.content_version_id = replacement.id
      AND review.review_role = 'final_human'
    ORDER BY review.sequence DESC LIMIT 1;
    IF replacement_state <> 'approved_internal'
      OR final_review.id IS NULL OR final_review.decision <> 'approve'
      OR final_review.occurred_at > NEW.occurred_at
      OR EXISTS (
        SELECT 1 FROM editorial_content_versions newer
        WHERE newer.content_key = replacement.content_key
          AND newer.version > replacement.version
      )
      OR NOT editorial_content_has_current_final_approval(
        replacement.id,
        final_review.actor_person_id
      )
      OR NOT editorial_content_has_current_approvals(
        replacement.id,
        authority_now,
        final_review.actor_person_id
      ) THEN
      RAISE EXCEPTION 'Editorial correction replacement requires current approved evidence';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER editorial_correction_valid
BEFORE INSERT ON editorial_correction_events
FOR EACH ROW EXECUTE FUNCTION validate_editorial_correction_event();

CREATE OR REPLACE FUNCTION validate_editorial_calendar_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous editorial_calendar_events%ROWTYPE;
  expected_sequence integer;
BEGIN
  PERFORM 1 FROM editorial_review_mutex WHERE singleton FOR UPDATE;
  PERFORM 1 FROM editorial_content_versions WHERE id = NEW.content_version_id FOR UPDATE;
  PERFORM editorial_database_authority_time(NEW.occurred_at);
  IF NOT editorial_person_has_internal_owner(NEW.actor_person_id) THEN
    RAISE EXCEPTION 'Editorial calendar changes require current internal owner authority';
  END IF;
  SELECT * INTO previous FROM editorial_calendar_events
  WHERE content_version_id = NEW.content_version_id
  ORDER BY sequence DESC LIMIT 1;
  expected_sequence := COALESCE(previous.sequence, 0) + 1;
  IF NEW.sequence <> expected_sequence THEN
    RAISE EXCEPTION 'Editorial calendar sequence is invalid';
  END IF;
  IF previous.id IS NOT NULL AND NEW.occurred_at < previous.occurred_at THEN
    RAISE EXCEPTION 'Editorial calendar chronology is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER editorial_calendar_valid
BEFORE INSERT ON editorial_calendar_events
FOR EACH ROW EXECUTE FUNCTION validate_editorial_calendar_event();

CREATE OR REPLACE FUNCTION validate_editorial_preference_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous editorial_preference_events%ROWTYPE;
BEGIN
  PERFORM 1 FROM editorial_review_mutex WHERE singleton FOR UPDATE;
  PERFORM editorial_database_authority_time(NEW.occurred_at);
  SELECT * INTO previous FROM editorial_preference_events
  WHERE subject_person_id = NEW.subject_person_id
    AND product_kind = NEW.product_kind AND channel = NEW.channel
  ORDER BY sequence DESC LIMIT 1;
  IF NEW.sequence <> COALESCE(previous.sequence, 0) + 1 THEN
    RAISE EXCEPTION 'Editorial preference sequence is invalid';
  END IF;
  IF previous.id IS NOT NULL AND NEW.occurred_at < previous.occurred_at THEN
    RAISE EXCEPTION 'Editorial preference chronology is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER editorial_preference_valid
BEFORE INSERT ON editorial_preference_events
FOR EACH ROW EXECUTE FUNCTION validate_editorial_preference_event();

CREATE OR REPLACE FUNCTION require_complete_editorial_content_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  authority_now timestamptz;
BEGIN
  authority_now := editorial_database_authority_time(NEW.created_at);
  IF NOT EXISTS (
    SELECT 1 FROM editorial_content_payloads payload
    WHERE payload.content_version_id = NEW.id
  ) OR NOT EXISTS (
    SELECT 1 FROM editorial_content_source_links source
    WHERE source.content_version_id = NEW.id
  ) OR NOT EXISTS (
    SELECT 1 FROM editorial_content_claim_links claim
    WHERE claim.content_version_id = NEW.id
  ) OR NOT EXISTS (
    SELECT 1 FROM editorial_content_state_events state
    WHERE state.content_version_id = NEW.id AND state.sequence = 1 AND state.to_state = 'draft'
  ) THEN
    RAISE EXCEPTION 'Editorial content version requires payload, source, claim, and initial-state evidence';
  END IF;
  IF EXISTS (
    SELECT 1 FROM editorial_content_source_links link
    JOIN editorial_source_versions source ON source.id = link.source_version_id
    WHERE link.content_version_id = NEW.id
      AND (
        NOT (source.intended_products ? NEW.product_kind)
        OR source.locale <> NEW.locale
        OR source.jurisdiction <> NEW.jurisdiction
        OR NOT editorial_source_is_approved(source.id, authority_now)
      )
  ) THEN
    RAISE EXCEPTION 'Editorial source scope is incompatible with draft product, locale, jurisdiction, or authority';
  END IF;
  IF EXISTS (
    SELECT 1 FROM editorial_content_claim_links link
    JOIN editorial_claim_versions claim ON claim.id = link.claim_version_id
    JOIN editorial_artifact_receipts artifact ON artifact.id = claim.artifact_receipt_id
    JOIN editorial_source_versions source ON source.id = artifact.source_version_id
    WHERE link.content_version_id = NEW.id
      AND (
        claim.jurisdiction <> NEW.jurisdiction
        OR claim.jurisdiction <> source.jurisdiction
        OR artifact.observed_at > authority_now
        OR artifact.expires_at <= authority_now
        OR claim.valid_from > authority_now
        OR claim.valid_through < authority_now
        OR claim.expires_at <= authority_now
        OR claim.valid_from < artifact.observed_at
        OR claim.valid_through > artifact.expires_at
        OR claim.expires_at > artifact.expires_at
        OR claim.valid_from < source.effective_at
        OR claim.valid_through > source.review_due_at
        OR claim.valid_through > source.expires_at
        OR claim.expires_at > source.review_due_at
        OR claim.expires_at > source.expires_at
        OR NOT editorial_source_is_approved(source.id, authority_now)
        OR NOT (source.intended_products ? NEW.product_kind)
        OR source.locale <> NEW.locale
        OR source.jurisdiction <> NEW.jurisdiction
        OR NOT EXISTS (
          SELECT 1 FROM editorial_content_source_links source_link
          WHERE source_link.content_version_id = NEW.id
            AND source_link.source_version_id = artifact.source_version_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'Editorial claim provenance must resolve to current compatible artifact and source authority';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER editorial_content_version_complete
AFTER INSERT ON editorial_content_versions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_complete_editorial_content_version();

CREATE TRIGGER editorial_review_mutex_immutable
BEFORE UPDATE OR DELETE ON editorial_review_mutex
FOR EACH ROW EXECUTE FUNCTION reject_editorial_evidence_mutation();
CREATE TRIGGER editorial_source_versions_immutable
BEFORE UPDATE OR DELETE ON editorial_source_versions
FOR EACH ROW EXECUTE FUNCTION reject_editorial_evidence_mutation();
CREATE TRIGGER editorial_source_reviews_immutable
BEFORE UPDATE OR DELETE ON editorial_source_review_events
FOR EACH ROW EXECUTE FUNCTION reject_editorial_evidence_mutation();
CREATE TRIGGER editorial_artifacts_immutable
BEFORE UPDATE OR DELETE ON editorial_artifact_receipts
FOR EACH ROW EXECUTE FUNCTION reject_editorial_evidence_mutation();
CREATE TRIGGER editorial_claims_immutable
BEFORE UPDATE OR DELETE ON editorial_claim_versions
FOR EACH ROW EXECUTE FUNCTION reject_editorial_evidence_mutation();
CREATE TRIGGER editorial_story_relationships_immutable
BEFORE UPDATE OR DELETE ON editorial_story_relationship_events
FOR EACH ROW EXECUTE FUNCTION reject_editorial_evidence_mutation();
CREATE TRIGGER editorial_content_versions_immutable
BEFORE UPDATE OR DELETE ON editorial_content_versions
FOR EACH ROW EXECUTE FUNCTION reject_editorial_evidence_mutation();
CREATE TRIGGER editorial_content_payloads_immutable
BEFORE UPDATE OR DELETE ON editorial_content_payloads
FOR EACH ROW EXECUTE FUNCTION reject_editorial_evidence_mutation();
CREATE TRIGGER editorial_content_source_links_immutable
BEFORE UPDATE OR DELETE ON editorial_content_source_links
FOR EACH ROW EXECUTE FUNCTION reject_editorial_evidence_mutation();
CREATE TRIGGER editorial_content_claim_links_immutable
BEFORE UPDATE OR DELETE ON editorial_content_claim_links
FOR EACH ROW EXECUTE FUNCTION reject_editorial_evidence_mutation();
CREATE TRIGGER editorial_assignments_immutable
BEFORE UPDATE OR DELETE ON editorial_assignment_events
FOR EACH ROW EXECUTE FUNCTION reject_editorial_evidence_mutation();
CREATE TRIGGER editorial_reviews_immutable
BEFORE UPDATE OR DELETE ON editorial_review_events
FOR EACH ROW EXECUTE FUNCTION reject_editorial_evidence_mutation();
CREATE TRIGGER editorial_states_immutable
BEFORE UPDATE OR DELETE ON editorial_content_state_events
FOR EACH ROW EXECUTE FUNCTION reject_editorial_evidence_mutation();
CREATE TRIGGER editorial_corrections_immutable
BEFORE UPDATE OR DELETE ON editorial_correction_events
FOR EACH ROW EXECUTE FUNCTION reject_editorial_evidence_mutation();
CREATE TRIGGER editorial_calendar_immutable
BEFORE UPDATE OR DELETE ON editorial_calendar_events
FOR EACH ROW EXECUTE FUNCTION reject_editorial_evidence_mutation();
CREATE TRIGGER editorial_preferences_immutable
BEFORE UPDATE OR DELETE ON editorial_preference_events
FOR EACH ROW EXECUTE FUNCTION reject_editorial_evidence_mutation();

ALTER TABLE governed_content_items
  DROP CONSTRAINT IF EXISTS governed_content_items_published_at_disabled;
ALTER TABLE governed_content_items
  ADD CONSTRAINT governed_content_items_published_at_disabled CHECK (published_at IS NULL);
