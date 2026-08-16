ALTER TABLE commerce_event_inbox
  ADD COLUMN provider_api_version text,
  ADD COLUMN provider_object_id text,
  ADD COLUMN provider_event_created_at timestamptz,
  ADD COLUMN normalized_lifecycle text
    CHECK (normalized_lifecycle IS NULL OR normalized_lifecycle IN (
      'pending', 'trialing', 'active', 'grace', 'delinquent', 'paused', 'hold',
      'cancel_at_period_end', 'canceled', 'expired', 'refunded', 'disputed', 'restored'
    )),
  ADD COLUMN application_state text NOT NULL DEFAULT 'pending'
    CHECK (application_state IN ('pending', 'applied', 'superseded', 'ignored', 'quarantined')),
  ADD COLUMN applied_at timestamptz;

CREATE INDEX commerce_event_inbox_pending_idx
  ON commerce_event_inbox(provider, environment, received_at, external_event_id)
  WHERE application_state = 'pending';

ALTER TABLE commerce_provider_subscription_records
  ADD COLUMN last_external_event_id text,
  ADD COLUMN last_provider_event_created_at timestamptz,
  ADD COLUMN last_provider_api_version text;

CREATE TABLE commerce_storefront_policies (
  id text PRIMARY KEY,
  platform text NOT NULL CHECK (platform IN ('apple', 'google')),
  storefront text NOT NULL,
  jurisdiction text NOT NULL,
  program text NOT NULL,
  app_version text NOT NULL,
  policy_version text NOT NULL,
  checked_at timestamptz NOT NULL,
  stale_after timestamptz NOT NULL,
  external_purchase_link_allowed boolean NOT NULL DEFAULT false,
  native_purchase_required boolean NOT NULL DEFAULT true,
  account_management_allowed boolean NOT NULL DEFAULT false,
  source_uri text NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, storefront, jurisdiction, program, app_version, policy_version),
  CHECK (stale_after > checked_at)
);

CREATE INDEX commerce_storefront_policy_active_idx
  ON commerce_storefront_policies(
    platform, storefront, jurisdiction, program, app_version, checked_at DESC
  ) WHERE state = 'active';

CREATE TABLE durable_jobs (
  id text PRIMARY KEY,
  job_type text NOT NULL,
  job_version integer NOT NULL CHECK (job_version > 0),
  household_id text REFERENCES households(id) ON DELETE SET NULL,
  classification text NOT NULL CHECK (classification IN ('public', 'internal', 'confidential')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_hash text NOT NULL,
  idempotency_key text NOT NULL,
  deduplication_key text,
  state text NOT NULL CHECK (state IN (
    'queued', 'running', 'retry', 'succeeded', 'dead_letter', 'canceled'
  )),
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN -100 AND 100),
  scheduled_at timestamptz NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 50),
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  last_error_code text,
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  replay_of_job_id text REFERENCES durable_jobs(id) ON DELETE SET NULL,
  replay_reason text,
  replay_actor_person_id text REFERENCES persons(id) ON DELETE SET NULL,
  UNIQUE (job_type, idempotency_key),
  CHECK (
    (state = 'running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state <> 'running' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK ((state = 'succeeded') = (completed_at IS NOT NULL)),
  CHECK ((state = 'dead_letter') = (dead_lettered_at IS NOT NULL))
);

CREATE INDEX durable_jobs_claim_idx
  ON durable_jobs(priority DESC, next_attempt_at, id)
  WHERE state IN ('queued', 'retry', 'running');

CREATE INDEX durable_jobs_household_idx
  ON durable_jobs(household_id, created_at DESC)
  WHERE household_id IS NOT NULL;

CREATE TABLE durable_job_attempts (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES durable_jobs(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  worker_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN (
    'claimed', 'heartbeat', 'succeeded', 'retry', 'dead_letter', 'relinquished'
  )),
  error_code text,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX durable_job_attempts_job_idx
  ON durable_job_attempts(job_id, occurred_at, id);

CREATE TABLE durable_consumer_receipts (
  consumer_key text NOT NULL,
  idempotency_key text NOT NULL,
  job_id text NOT NULL REFERENCES durable_jobs(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('processing', 'completed')),
  lease_owner text,
  lease_expires_at timestamptz,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  result_code text,
  PRIMARY KEY (consumer_key, idempotency_key),
  CHECK (
    (state = 'processing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL
      AND completed_at IS NULL)
    OR (state = 'completed' AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND completed_at IS NOT NULL)
  )
);

CREATE TABLE worker_heartbeats (
  worker_id text PRIMARY KEY,
  started_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('running', 'draining', 'stopped')),
  current_job_count integer NOT NULL DEFAULT 0 CHECK (current_job_count >= 0),
  version text NOT NULL
);

ALTER TABLE outbox_events
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 50),
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN heartbeat_at timestamptz,
  ADD COLUMN last_error_code text,
  ADD COLUMN dead_lettered_at timestamptz,
  ADD COLUMN replay_of_event_id text REFERENCES outbox_events(id) ON DELETE SET NULL,
  ADD COLUMN replay_reason text,
  ADD COLUMN replay_actor_person_id text REFERENCES persons(id) ON DELETE SET NULL;

UPDATE outbox_events SET next_attempt_at = available_at WHERE next_attempt_at IS NULL;

ALTER TABLE outbox_events ALTER COLUMN next_attempt_at SET NOT NULL;

DROP INDEX outbox_events_available_idx;

CREATE INDEX outbox_events_available_idx
  ON outbox_events(next_attempt_at, occurred_at, id)
  WHERE processed_at IS NULL AND dead_lettered_at IS NULL;
