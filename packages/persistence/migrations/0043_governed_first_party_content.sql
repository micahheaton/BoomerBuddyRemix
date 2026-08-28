CREATE TABLE governed_content_mutex (
  singleton boolean PRIMARY KEY CHECK (singleton),
  schema_version integer NOT NULL CHECK (schema_version = 1)
);

INSERT INTO governed_content_mutex(singleton, schema_version) VALUES (true, 1);

-- Candidate manifests preserve exact official provenance without fetching or copying source text.
-- They are not approved claims and cannot be consumed by the draft generator. Approved structured
-- facts remain the immutable member_scam_guidance_briefs rows linked below.
CREATE TABLE governed_content_source_candidates (
  source_id text PRIMARY KEY CHECK (source_id ~ '^[a-z][a-z0-9-]{2,119}$'),
  publisher_code text NOT NULL CHECK (publisher_code IN ('ftc','fbi_ic3','cfpb')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  source_url text NOT NULL UNIQUE CHECK (
    char_length(source_url) BETWEEN 10 AND 500 AND source_url ~ '^https://[^[:space:]]+$'
  ),
  source_published_at timestamptz,
  review_state text NOT NULL CHECK (review_state = 'candidate'),
  reviewed_at timestamptz CHECK (reviewed_at IS NULL),
  claim_import_permitted boolean NOT NULL CHECK (claim_import_permitted = false),
  external_fetch_performed boolean NOT NULL CHECK (external_fetch_performed = false),
  raw_content_stored boolean NOT NULL CHECK (raw_content_stored = false),
  proposed_at timestamptz NOT NULL
);

INSERT INTO governed_content_source_candidates(
  source_id, publisher_code, title, source_url, source_published_at, review_state,
  reviewed_at, claim_import_permitted, external_fetch_performed, raw_content_stored, proposed_at
) VALUES
  ('ftc-protecting-older-consumers-2024-2025','ftc',
   'Protecting Older Consumers 2024-2025 Report',
   'https://www.ftc.gov/reports/protecting-older-consumers-2024-2025-report-federal-trade-commission',
   NULL,'candidate',NULL,false,false,false,'2026-08-28T12:00:00.000Z'),
  ('ftc-protecting-older-consumers-2024-2025-pdf','ftc',
   'Protecting Older Consumers 2024-2025 Report PDF',
   'https://www.ftc.gov/system/files/ftc_gov/pdf/P144400-OlderAdultsReportDec2025.pdf',
   NULL,'candidate',NULL,false,false,false,'2026-08-28T12:00:00.000Z'),
  ('ftc-top-scams-affecting-older-adults-2026','ftc',
   'Top Scams Affecting Older Adults',
   'https://www.ftc.gov/news-events/events/2026/05/top-scams-affecting-older-adults',
   NULL,'candidate',NULL,false,false,false,'2026-08-28T12:00:00.000Z'),
  ('ftc-help-fight-imposter-scams-2026','ftc',
   'Help Fight Imposter Scams on World Elder Abuse Awareness Day',
   'https://www.ftc.gov/2026/06/help-fight-imposter-scams-world-elder-abuse-awareness-day',
   NULL,'candidate',NULL,false,false,false,'2026-08-28T12:00:00.000Z'),
  ('fbi-ic3-annual-reports-index','fbi_ic3',
   'Internet Crime Complaint Center Annual Reports',
   'https://www.ic3.gov/AnnualReport/Reports/Reports/',
   NULL,'candidate',NULL,false,false,false,'2026-08-28T12:00:00.000Z'),
  ('fbi-ic3-2025-report','fbi_ic3',
   '2025 Internet Crime Report',
   'https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf',
   NULL,'candidate',NULL,false,false,false,'2026-08-28T12:00:00.000Z'),
  ('cfpb-protecting-older-adults-against-fraud','cfpb',
   'Protecting Older Adults Against Fraud Resources',
   'https://www.consumerfinance.gov/consumer-tools/educator-tools/resources-for-older-adults/protecting-against-fraud/',
   NULL,'candidate',NULL,false,false,false,'2026-08-28T12:00:00.000Z'),
  ('cfpb-common-fraud-and-scams','cfpb',
   'Common Types of Fraud and Scams',
   'https://www.consumerfinance.gov/ask-cfpb/what-are-some-common-types-of-fraud-and-scams-en-2092/',
   NULL,'candidate',NULL,false,false,false,'2026-08-28T12:00:00.000Z');

CREATE TABLE governed_content_slug_claims (
  slug text PRIMARY KEY CHECK (
    char_length(slug) BETWEEN 3 AND 100
    AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  content_key text NOT NULL UNIQUE CHECK (content_key ~ '^content_[a-z0-9_]{2,110}$'),
  claimed_at timestamptz NOT NULL
);

CREATE TABLE governed_content_revisions (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'),
  content_key text NOT NULL CHECK (content_key ~ '^content_[a-z0-9_]{2,110}$'),
  version integer NOT NULL CHECK (version > 0),
  previous_revision_id text REFERENCES governed_content_revisions(id) ON DELETE RESTRICT,
  revision_kind text NOT NULL CHECK (revision_kind IN ('deterministic', 'human', 'correction')),
  source_brief_key text NOT NULL,
  source_brief_version integer NOT NULL,
  source_claim_digest text NOT NULL CHECK (source_claim_digest ~ '^[a-f0-9]{64}$'),
  slug text NOT NULL CHECK (
    char_length(slug) BETWEEN 3 AND 100
    AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  document_sha256 text NOT NULL CHECK (document_sha256 ~ '^[a-f0-9]{64}$'),
  encrypted_document text NOT NULL CHECK (char_length(encrypted_document) BETWEEN 64 AND 65536),
  encryption_key_version integer NOT NULL CHECK (encryption_key_version > 0),
  created_by_person_id text REFERENCES persons(id) ON DELETE RESTRICT,
  created_by_service text CHECK (
    created_by_service IS NULL OR created_by_service = 'governed_content.daily_generator'
  ),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (content_key, version),
  FOREIGN KEY (source_brief_key, source_brief_version)
    REFERENCES member_scam_guidance_briefs(brief_key, version) ON DELETE RESTRICT,
  CHECK (
    (created_by_person_id IS NOT NULL AND created_by_service IS NULL)
    OR (created_by_person_id IS NULL AND created_by_service IS NOT NULL)
  ),
  CHECK (expires_at > created_at),
  CHECK (
    (version = 1 AND previous_revision_id IS NULL AND revision_kind IN ('deterministic', 'human'))
    OR (version > 1 AND previous_revision_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX governed_content_live_slug_version_idx
  ON governed_content_revisions(slug, content_key, version);

CREATE TABLE governed_content_review_assignments (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'),
  revision_id text NOT NULL REFERENCES governed_content_revisions(id) ON DELETE RESTRICT,
  review_role text NOT NULL CHECK (review_role IN (
    'skeptical', 'accessibility', 'privacy_rights', 'final_human'
  )),
  employee_assignment_id text NOT NULL REFERENCES employee_assignments(id) ON DELETE RESTRICT,
  assigned_to_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  assigned_by_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  document_sha256 text NOT NULL CHECK (document_sha256 ~ '^[a-f0-9]{64}$'),
  assigned_at timestamptz NOT NULL,
  UNIQUE (revision_id, review_role)
);

CREATE TABLE governed_content_review_events (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'),
  assignment_id text NOT NULL REFERENCES governed_content_review_assignments(id) ON DELETE RESTRICT,
  revision_id text NOT NULL REFERENCES governed_content_revisions(id) ON DELETE RESTRICT,
  review_role text NOT NULL CHECK (review_role IN (
    'skeptical', 'accessibility', 'privacy_rights', 'final_human'
  )),
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('approve', 'changes_requested', 'reject')),
  reviewed_document_sha256 text NOT NULL CHECK (reviewed_document_sha256 ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  occurred_at timestamptz NOT NULL,
  UNIQUE (revision_id, review_role)
);

CREATE TABLE governed_content_publication_intents (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'),
  action text NOT NULL CHECK (action IN ('publish', 'unpublish', 'retract')),
  revision_id text NOT NULL REFERENCES governed_content_revisions(id) ON DELETE RESTRICT,
  slug text NOT NULL CHECK (
    char_length(slug) BETWEEN 3 AND 100
    AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  exact_document_sha256 text NOT NULL CHECK (exact_document_sha256 ~ '^[a-f0-9]{64}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_key_sha256 text NOT NULL UNIQUE CHECK (idempotency_key_sha256 ~ '^[a-f0-9]{64}$'),
  authorized_by_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  authorization_kind text NOT NULL CHECK (authorization_kind = 'recent_hq_mfa'),
  authorized_at timestamptz NOT NULL
);

CREATE TABLE governed_content_publication_events (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'),
  intent_id text NOT NULL UNIQUE REFERENCES governed_content_publication_intents(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  action text NOT NULL CHECK (action IN ('publish', 'unpublish', 'retract')),
  revision_id text NOT NULL REFERENCES governed_content_revisions(id) ON DELETE RESTRICT,
  slug text NOT NULL CHECK (
    char_length(slug) BETWEEN 3 AND 100
    AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  exact_document_sha256 text NOT NULL CHECK (exact_document_sha256 ~ '^[a-f0-9]{64}$'),
  title text CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 160),
  summary text CHECK (summary IS NULL OR char_length(summary) BETWEEN 1 AND 500),
  body text CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 16000),
  source_title text CHECK (source_title IS NULL OR char_length(source_title) BETWEEN 1 AND 160),
  source_url text CHECK (
    source_url IS NULL OR (
      char_length(source_url) BETWEEN 10 AND 500 AND source_url ~ '^https://[^[:space:]]+$'
    )
  ),
  source_published_at timestamptz,
  reviewed_at timestamptz,
  expires_at timestamptz NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (slug, sequence),
  CHECK (
    (action = 'publish' AND title IS NOT NULL AND summary IS NOT NULL AND body IS NOT NULL
      AND source_title IS NOT NULL AND source_url IS NOT NULL
      AND source_published_at IS NOT NULL AND reviewed_at IS NOT NULL)
    OR (action IN ('unpublish', 'retract') AND title IS NULL AND summary IS NULL AND body IS NULL
      AND source_title IS NULL AND source_url IS NULL
      AND source_published_at IS NULL AND reviewed_at IS NULL)
  )
);

CREATE INDEX governed_content_publication_slug_idx
  ON governed_content_publication_events(slug, sequence DESC);

CREATE TABLE governed_content_generation_runs (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'),
  schedule_date date NOT NULL,
  source_brief_key text NOT NULL,
  source_brief_version integer NOT NULL,
  source_claim_digest text NOT NULL CHECK (source_claim_digest ~ '^[a-f0-9]{64}$'),
  resulting_revision_id text NOT NULL UNIQUE REFERENCES governed_content_revisions(id) ON DELETE RESTRICT,
  generator_version text NOT NULL CHECK (generator_version = 'structured-template-v1'),
  customer_data_accessed boolean NOT NULL CHECK (customer_data_accessed = false),
  external_fetch_performed boolean NOT NULL CHECK (external_fetch_performed = false),
  provider_action_performed boolean NOT NULL CHECK (provider_action_performed = false),
  publication_performed boolean NOT NULL CHECK (publication_performed = false),
  created_at timestamptz NOT NULL,
  UNIQUE (source_brief_key, source_brief_version),
  FOREIGN KEY (source_brief_key, source_brief_version)
    REFERENCES member_scam_guidance_briefs(brief_key, version) ON DELETE RESTRICT
);

CREATE FUNCTION reject_governed_content_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Governed content evidence is immutable; append a new revision or event';
END;
$$;

CREATE FUNCTION validate_governed_content_revision_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  claimed_slug text;
  claimed_content_key text;
  previous governed_content_revisions%ROWTYPE;
BEGIN
  PERFORM 1 FROM governed_content_mutex WHERE singleton FOR UPDATE;

  SELECT slug INTO claimed_slug
  FROM governed_content_slug_claims WHERE content_key = NEW.content_key;
  IF claimed_slug IS NOT NULL AND claimed_slug <> NEW.slug THEN
    RAISE EXCEPTION 'Governed content slug is immutable across a revision lineage';
  END IF;

  INSERT INTO governed_content_slug_claims(slug, content_key, claimed_at)
  VALUES (NEW.slug, NEW.content_key, NEW.created_at)
  ON CONFLICT (slug) DO NOTHING;
  SELECT content_key INTO claimed_content_key
  FROM governed_content_slug_claims WHERE slug = NEW.slug;
  IF claimed_content_key IS DISTINCT FROM NEW.content_key THEN
    RAISE EXCEPTION 'Governed content slug is already claimed by another content lineage';
  END IF;

  IF NEW.version = 1 THEN
    IF EXISTS (
      SELECT 1 FROM governed_content_revisions revision
      WHERE revision.content_key = NEW.content_key
    ) THEN
      RAISE EXCEPTION 'Governed content version one cannot replace an existing lineage';
    END IF;
  ELSE
    SELECT * INTO previous
    FROM governed_content_revisions revision
    WHERE revision.id = NEW.previous_revision_id;
    IF previous.id IS NULL
      OR previous.content_key <> NEW.content_key
      OR previous.version <> NEW.version - 1
      OR previous.slug <> NEW.slug
      OR EXISTS (
        SELECT 1 FROM governed_content_revisions newer
        WHERE newer.content_key = NEW.content_key AND newer.version > previous.version
      ) THEN
      RAISE EXCEPTION 'Governed content revision lineage is invalid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER governed_content_revision_insert_valid
BEFORE INSERT ON governed_content_revisions
FOR EACH ROW EXECUTE FUNCTION validate_governed_content_revision_insert();

CREATE TRIGGER governed_content_source_candidates_immutable
BEFORE UPDATE OR DELETE ON governed_content_source_candidates
FOR EACH ROW EXECUTE FUNCTION reject_governed_content_mutation();

CREATE TRIGGER governed_content_slug_claims_immutable
BEFORE UPDATE OR DELETE ON governed_content_slug_claims
FOR EACH ROW EXECUTE FUNCTION reject_governed_content_mutation();

CREATE TRIGGER governed_content_revisions_immutable
BEFORE UPDATE OR DELETE ON governed_content_revisions
FOR EACH ROW EXECUTE FUNCTION reject_governed_content_mutation();

CREATE TRIGGER governed_content_review_assignments_immutable
BEFORE UPDATE OR DELETE ON governed_content_review_assignments
FOR EACH ROW EXECUTE FUNCTION reject_governed_content_mutation();

CREATE TRIGGER governed_content_review_events_immutable
BEFORE UPDATE OR DELETE ON governed_content_review_events
FOR EACH ROW EXECUTE FUNCTION reject_governed_content_mutation();

CREATE TRIGGER governed_content_publication_intents_immutable
BEFORE UPDATE OR DELETE ON governed_content_publication_intents
FOR EACH ROW EXECUTE FUNCTION reject_governed_content_mutation();

CREATE TRIGGER governed_content_publication_events_immutable
BEFORE UPDATE OR DELETE ON governed_content_publication_events
FOR EACH ROW EXECUTE FUNCTION reject_governed_content_mutation();

CREATE TRIGGER governed_content_generation_runs_immutable
BEFORE UPDATE OR DELETE ON governed_content_generation_runs
FOR EACH ROW EXECUTE FUNCTION reject_governed_content_mutation();
