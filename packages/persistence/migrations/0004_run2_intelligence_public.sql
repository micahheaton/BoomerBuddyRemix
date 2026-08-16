ALTER TABLE analyses DROP CONSTRAINT IF EXISTS analyses_risk_check;
ALTER TABLE analyses
  ADD COLUMN risk_semantics_version text NOT NULL DEFAULT 'active_v2';
UPDATE analyses
SET risk_semantics_version = 'legacy_reserved'
WHERE risk = 'lower_concern';
ALTER TABLE analyses
  ADD CONSTRAINT analyses_active_risk_check CHECK (
    (risk_semantics_version = 'active_v2'
      AND risk IN ('unknown', 'caution', 'high_concern'))
    OR (risk_semantics_version = 'legacy_reserved' AND risk = 'lower_concern')
  );

CREATE TABLE public_check_contexts (
  id text PRIMARY KEY,
  token_hmac text NOT NULL UNIQUE,
  hmac_key_version integer NOT NULL CHECK (hmac_key_version > 0),
  attribution_source text NOT NULL CHECK (
    attribution_source IN ('direct', 'organic', 'partner', 'campaign')
  ),
  attribution_campaign text NOT NULL CHECK (
    attribution_campaign IN ('none', 'launch_2026', 'trusted_partner')
  ),
  remaining_checks integer NOT NULL CHECK (remaining_checks BETWEEN 0 AND 3),
  state text NOT NULL CHECK (state IN ('active', 'exhausted', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (expires_at > created_at),
  CHECK (state <> 'exhausted' OR remaining_checks = 0)
);

CREATE INDEX public_check_context_expiry_idx
  ON public_check_contexts(expires_at, id) WHERE state = 'active';

CREATE TABLE public_check_quota_buckets (
  bucket_start timestamptz NOT NULL,
  scope text NOT NULL CHECK (scope IN ('global_public_context', 'global_public_check')),
  used_count integer NOT NULL CHECK (used_count >= 0),
  PRIMARY KEY (bucket_start, scope)
);

CREATE TABLE public_check_attribution_aggregates (
  bucket_start date NOT NULL,
  source text NOT NULL CHECK (source IN ('direct', 'organic', 'partner', 'campaign')),
  campaign text NOT NULL CHECK (campaign IN ('none', 'launch_2026', 'trusted_partner')),
  event_kind text NOT NULL CHECK (event_kind IN ('context_issued', 'check_completed')),
  event_count integer NOT NULL CHECK (event_count >= 0),
  PRIMARY KEY (bucket_start, source, campaign, event_kind)
);

CREATE TABLE public_check_results (
  id text PRIMARY KEY,
  conversion_hmac text UNIQUE,
  hmac_key_version integer NOT NULL CHECK (hmac_key_version > 0),
  encrypted_payload text,
  encryption_key_version integer NOT NULL CHECK (encryption_key_version > 0),
  state text NOT NULL CHECK (state IN ('active', 'consumed', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (
    (state = 'active' AND conversion_hmac IS NOT NULL
      AND encrypted_payload IS NOT NULL AND consumed_at IS NULL)
    OR (state IN ('consumed', 'expired') AND conversion_hmac IS NULL
      AND encrypted_payload IS NULL)
  )
);

CREATE INDEX public_check_result_expiry_idx
  ON public_check_results(expires_at, id) WHERE state = 'active';

CREATE TABLE knowledge_assets (
  id text PRIMARY KEY,
  asset_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  locale text NOT NULL,
  jurisdiction text NOT NULL,
  lifecycle text NOT NULL CHECK (lifecycle IN ('draft', 'active', 'retired')),
  review_state text NOT NULL CHECK (
    review_state IN ('authored', 'source_verified', 'independently_reviewed')
  ),
  source_publisher text NOT NULL,
  source_url text NOT NULL,
  source_retrieved_at timestamptz NOT NULL,
  rights_basis text NOT NULL,
  authoring_version text NOT NULL,
  v1_runtime_import boolean NOT NULL CHECK (v1_runtime_import = false),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  content_sha256 text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (asset_key, version),
  CHECK (lifecycle <> 'active' OR review_state = 'independently_reviewed')
);

CREATE TABLE knowledge_asset_reviews (
  id text PRIMARY KEY,
  knowledge_asset_id text NOT NULL REFERENCES knowledge_assets(id),
  reviewer_reference text NOT NULL,
  review_kind text NOT NULL CHECK (review_kind IN ('source', 'domain', 'editorial', 'rights')),
  decision text NOT NULL CHECK (decision IN ('approve', 'changes_requested', 'reject')),
  notes text NOT NULL,
  reviewed_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX knowledge_asset_reviewer_kind_idx
  ON knowledge_asset_reviews(knowledge_asset_id, reviewer_reference, review_kind);

CREATE TABLE evaluation_corpora (
  id text PRIMARY KEY,
  corpus_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  purpose text NOT NULL,
  provenance text NOT NULL,
  rights_basis text NOT NULL,
  split_state text NOT NULL CHECK (split_state IN ('unsealed', 'sealed')),
  lifecycle text NOT NULL CHECK (lifecycle IN ('draft', 'candidate', 'released', 'retired')),
  created_at timestamptz NOT NULL,
  UNIQUE (corpus_key, version),
  CHECK (lifecycle <> 'released' OR split_state = 'sealed')
);

CREATE TABLE evaluation_cases (
  id text PRIMARY KEY,
  corpus_id text NOT NULL REFERENCES evaluation_corpora(id),
  case_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  artifact_kind text NOT NULL CHECK (artifact_kind IN ('text', 'url')),
  artifact jsonb NOT NULL CHECK (jsonb_typeof(artifact) = 'object'),
  source_kind text NOT NULL CHECK (source_kind IN ('project_authored', 'consented', 'licensed')),
  sensitivity text NOT NULL CHECK (sensitivity IN ('non_sensitive', 'restricted')),
  split text NOT NULL CHECK (split IN ('development', 'validation', 'sealed_test')),
  created_at timestamptz NOT NULL,
  UNIQUE (corpus_id, case_key, version)
);

CREATE TABLE evaluation_reviewer_assignments (
  id text PRIMARY KEY,
  corpus_id text NOT NULL REFERENCES evaluation_corpora(id),
  reviewer_reference text NOT NULL,
  reviewer_role text NOT NULL CHECK (reviewer_role IN ('reviewer', 'adjudicator')),
  state text NOT NULL CHECK (state IN ('assigned', 'completed', 'withdrawn')),
  assigned_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (corpus_id, reviewer_reference, reviewer_role),
  CHECK ((state = 'completed') = (completed_at IS NOT NULL))
);

CREATE TABLE evaluation_case_reviews (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES evaluation_cases(id),
  assignment_id text NOT NULL REFERENCES evaluation_reviewer_assignments(id),
  verdict text NOT NULL CHECK (verdict IN ('malicious', 'legitimate', 'borderline', 'abstain')),
  confidence text NOT NULL CHECK (confidence IN ('limited', 'moderate', 'strong')),
  rationale text NOT NULL,
  reviewed_at timestamptz NOT NULL,
  UNIQUE (case_id, assignment_id)
);

CREATE TABLE evaluation_case_adjudications (
  id text PRIMARY KEY,
  case_id text NOT NULL UNIQUE REFERENCES evaluation_cases(id),
  assignment_id text NOT NULL REFERENCES evaluation_reviewer_assignments(id),
  final_verdict text NOT NULL CHECK (
    final_verdict IN ('malicious', 'legitimate', 'borderline', 'excluded')
  ),
  disagreement_summary text NOT NULL,
  rationale text NOT NULL,
  adjudicated_at timestamptz NOT NULL
);

CREATE TABLE evaluation_release_gates (
  id text PRIMARY KEY,
  corpus_id text NOT NULL REFERENCES evaluation_corpora(id),
  system_version text NOT NULL,
  minimum_reviews_per_case integer NOT NULL CHECK (minimum_reviews_per_case >= 2),
  disagreements_total integer NOT NULL CHECK (disagreements_total >= 0),
  disagreements_adjudicated integer NOT NULL CHECK (disagreements_adjudicated >= 0),
  forbidden_action_violations integer NOT NULL CHECK (forbidden_action_violations >= 0),
  split_was_sealed boolean NOT NULL,
  decision text NOT NULL CHECK (decision IN ('blocked', 'passed')),
  evaluated_at timestamptz NOT NULL,
  UNIQUE (corpus_id, system_version),
  CHECK (disagreements_adjudicated <= disagreements_total),
  CHECK (
    decision <> 'passed'
    OR (split_was_sealed AND forbidden_action_violations = 0
      AND disagreements_adjudicated = disagreements_total)
  )
);

CREATE OR REPLACE FUNCTION reject_intelligence_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Governed intelligence and evaluation evidence is append-only';
END;
$$;

CREATE TRIGGER knowledge_assets_immutable
BEFORE UPDATE OR DELETE ON knowledge_assets
FOR EACH ROW EXECUTE FUNCTION reject_intelligence_evidence_mutation();

CREATE TRIGGER knowledge_asset_reviews_immutable
BEFORE UPDATE OR DELETE ON knowledge_asset_reviews
FOR EACH ROW EXECUTE FUNCTION reject_intelligence_evidence_mutation();

CREATE TRIGGER evaluation_case_reviews_immutable
BEFORE UPDATE OR DELETE ON evaluation_case_reviews
FOR EACH ROW EXECUTE FUNCTION reject_intelligence_evidence_mutation();

CREATE TRIGGER evaluation_cases_immutable
BEFORE UPDATE OR DELETE ON evaluation_cases
FOR EACH ROW EXECUTE FUNCTION reject_intelligence_evidence_mutation();

CREATE TRIGGER evaluation_case_adjudications_immutable
BEFORE UPDATE OR DELETE ON evaluation_case_adjudications
FOR EACH ROW EXECUTE FUNCTION reject_intelligence_evidence_mutation();

CREATE TRIGGER evaluation_release_gates_immutable
BEFORE UPDATE OR DELETE ON evaluation_release_gates
FOR EACH ROW EXECUTE FUNCTION reject_intelligence_evidence_mutation();

INSERT INTO knowledge_assets(
  id, asset_key, version, locale, jurisdiction, lifecycle, review_state,
  source_publisher, source_url, source_retrieved_at, rights_basis,
  authoring_version, v1_runtime_import, content, content_sha256, created_at
) VALUES
  (
    'knowledge_government_impersonation_v1', 'knowledge_government_impersonation', 1,
    'en-US', 'US', 'draft', 'source_verified', 'United States Federal Trade Commission',
    'https://consumer.ftc.gov/articles/how-avoid-government-impersonation-scam',
    '2026-08-16T00:00:00Z',
    'Official public consumer guidance; independently authored paraphrase',
    'run-2-curation-v1', false,
    '{"title":"Government impersonation warning signs","summary":"Unexpected threats, demands for secrecy, or requests for unusual payment should be paused and verified through an independently found official channel.","defensiveActions":["Do not use contact details supplied by the caller or message.","Do not send money, gift cards, cryptocurrency, or account credentials."]}'::jsonb,
    'sha256:7cef31ecb1a909b592f0eacaaaff9823c81d3de22624e90fe5a9179b26cafc90',
    '2026-08-16T00:00:00Z'
  ),
  (
    'knowledge_gift_card_v1', 'knowledge_gift_card', 1,
    'en-US', 'US', 'draft', 'source_verified', 'United States Federal Trade Commission',
    'https://consumer.ftc.gov/articles/avoiding-and-reporting-gift-card-scams',
    '2026-08-16T00:00:00Z',
    'Official public consumer guidance; independently authored paraphrase',
    'run-2-curation-v1', false,
    '{"title":"Gift card payment warning","summary":"A demand to buy gift cards and share their numbers is a strong warning sign; legitimate organizations do not require this form of payment.","defensiveActions":["Stop before buying or sharing a gift card number.","Contact the gift card issuer and report the request through an official channel."]}'::jsonb,
    'sha256:581f53c6361a2b504437f1464afc5c3bcdb716209a34224266afb1b378297ed4',
    '2026-08-16T00:00:00Z'
  );

INSERT INTO knowledge_asset_reviews(
  id, knowledge_asset_id, reviewer_reference, review_kind, decision, notes, reviewed_at
) VALUES
  (
    'knowledge_review_government_source_v1', 'knowledge_government_impersonation_v1',
    'run-2-source-verification', 'source', 'approve',
    'Official source retrieved and paraphrase compared; independent domain review remains required.',
    '2026-08-16T00:00:00Z'
  ),
  (
    'knowledge_review_gift_card_source_v1', 'knowledge_gift_card_v1',
    'run-2-source-verification', 'source', 'approve',
    'Official source retrieved and paraphrase compared; independent domain review remains required.',
    '2026-08-16T00:00:00Z'
  );
