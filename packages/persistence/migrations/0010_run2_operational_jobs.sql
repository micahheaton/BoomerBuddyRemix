CREATE TABLE notification_dispatch_requests (
  id text PRIMARY KEY,
  household_id text NOT NULL,
  recipient_person_id text NOT NULL,
  template_key text NOT NULL CHECK (template_key ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  channel text NOT NULL CHECK (channel IN ('local_test', 'push', 'email', 'sms')),
  consent_basis text NOT NULL CHECK (consent_basis ~ '^[a-z][a-z0-9_.:-]{1,119}$'),
  state text NOT NULL CHECK (
    state IN ('queued', 'test_delivered', 'blocked_external', 'failed')
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (household_id, recipient_person_id)
    REFERENCES household_memberships(household_id, person_id)
);

CREATE INDEX notification_dispatch_state_idx
  ON notification_dispatch_requests(state, created_at, id);

CREATE TABLE operational_job_evidence (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES durable_jobs(id) ON DELETE RESTRICT,
  evidence_kind text NOT NULL CHECK (
    evidence_kind IN ('notification_dispatch', 'intelligence_refresh', 'evaluation_run')
  ),
  outcome text NOT NULL CHECK (
    outcome IN ('completed', 'test_delivered', 'blocked_external', 'attention')
  ),
  summary jsonb NOT NULL CHECK (jsonb_typeof(summary) = 'object'),
  observed_at timestamptz NOT NULL,
  UNIQUE (job_id, evidence_kind)
);

CREATE INDEX operational_job_evidence_kind_idx
  ON operational_job_evidence(evidence_kind, observed_at DESC, id);

CREATE OR REPLACE FUNCTION reject_operational_job_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Operational job evidence is append-only';
END;
$$;

CREATE TRIGGER operational_job_evidence_immutable
BEFORE UPDATE OR DELETE ON operational_job_evidence
FOR EACH ROW EXECUTE FUNCTION reject_operational_job_evidence_mutation();
