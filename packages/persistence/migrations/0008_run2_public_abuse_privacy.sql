ALTER TABLE public_check_contexts
  ADD COLUMN client_key_hmac text;

UPDATE public_check_contexts
SET client_key_hmac = 'legacy:' || id
WHERE client_key_hmac IS NULL;

ALTER TABLE public_check_contexts
  ALTER COLUMN client_key_hmac SET NOT NULL;

CREATE INDEX public_check_context_client_idx
  ON public_check_contexts(client_key_hmac, created_at DESC);

ALTER TABLE public_check_quota_buckets
  ADD COLUMN scope_key text NOT NULL DEFAULT 'global';

ALTER TABLE public_check_quota_buckets
  DROP CONSTRAINT public_check_quota_buckets_pkey;

ALTER TABLE public_check_quota_buckets
  ADD PRIMARY KEY (bucket_start, scope, scope_key);

CREATE TABLE public_check_concurrency_gate (
  id smallint PRIMARY KEY CHECK (id = 1)
);

INSERT INTO public_check_concurrency_gate(id) VALUES (1);

CREATE TABLE public_check_analysis_leases (
  id text PRIMARY KEY,
  client_key_hmac text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX public_check_analysis_lease_expiry_idx
  ON public_check_analysis_leases(expires_at, id);

CREATE INDEX public_check_analysis_lease_client_idx
  ON public_check_analysis_leases(client_key_hmac, expires_at);

CREATE UNIQUE INDEX privacy_request_open_subject_kind_idx
  ON privacy_requests(
    COALESCE(person_id, ''), COALESCE(household_id, ''), request_kind
  )
  WHERE state NOT IN ('completed', 'denied');

CREATE TABLE privacy_request_events (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES privacy_requests(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  event_kind text NOT NULL CHECK (
    event_kind IN (
      'received', 'identity_verified', 'review_started', 'plan_recorded',
      'completed', 'denied'
    )
  ),
  actor_person_id text NOT NULL REFERENCES persons(id),
  actor_audience text NOT NULL CHECK (actor_audience IN ('customer', 'mobile', 'hq')),
  evidence_reference text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (request_id, sequence)
);

CREATE INDEX privacy_request_event_timeline_idx
  ON privacy_request_events(request_id, sequence);

CREATE TABLE privacy_request_plans (
  id text PRIMARY KEY,
  request_id text NOT NULL UNIQUE REFERENCES privacy_requests(id),
  plan_kind text NOT NULL CHECK (
    plan_kind IN ('access_summary', 'export_manifest', 'deletion_plan', 'correction_plan', 'restriction_plan')
  ),
  data_categories jsonb NOT NULL CHECK (jsonb_typeof(data_categories) = 'array'),
  record_counts jsonb NOT NULL CHECK (jsonb_typeof(record_counts) = 'object'),
  contains_customer_content boolean NOT NULL CHECK (contains_customer_content = false),
  requires_professional_review boolean NOT NULL,
  created_by_person_id text NOT NULL REFERENCES persons(id),
  created_at timestamptz NOT NULL
);

CREATE OR REPLACE FUNCTION reject_privacy_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Privacy request evidence is append-only';
END;
$$;

CREATE TRIGGER privacy_request_events_immutable
BEFORE UPDATE OR DELETE ON privacy_request_events
FOR EACH ROW EXECUTE FUNCTION reject_privacy_evidence_mutation();

CREATE TRIGGER privacy_request_plans_immutable
BEFORE UPDATE OR DELETE ON privacy_request_plans
FOR EACH ROW EXECUTE FUNCTION reject_privacy_evidence_mutation();
