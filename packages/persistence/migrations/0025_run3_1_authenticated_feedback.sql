ALTER TABLE feedback_records
  DROP CONSTRAINT feedback_records_evidence_tier_check;
ALTER TABLE feedback_records
  ADD CONSTRAINT feedback_records_evidence_tier_check CHECK (
    (evidence_tier = 'local_simulation')
    OR (evidence_tier = 'live_production' AND identity_mode = 'authenticated')
  );

ALTER TABLE feedback_state_events
  DROP CONSTRAINT feedback_state_events_evidence_tier_check;
ALTER TABLE feedback_state_events
  ADD CONSTRAINT feedback_state_events_evidence_tier_check CHECK (
    evidence_tier IN ('local_simulation', 'live_production')
  );

ALTER TABLE feedback_processing_jobs
  DROP CONSTRAINT feedback_processing_jobs_evidence_tier_check;
ALTER TABLE feedback_processing_jobs
  ADD CONSTRAINT feedback_processing_jobs_evidence_tier_check CHECK (
    evidence_tier IN ('local_simulation', 'live_production')
  );

ALTER TABLE feedback_payload_erasure_events
  DROP CONSTRAINT feedback_payload_erasure_events_evidence_tier_check;
ALTER TABLE feedback_payload_erasure_events
  ADD CONSTRAINT feedback_payload_erasure_events_evidence_tier_check CHECK (
    evidence_tier IN ('local_simulation', 'live_production')
  );

CREATE OR REPLACE FUNCTION validate_feedback_evidence_tier_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  record_tier text;
BEGIN
  SELECT evidence_tier INTO record_tier
  FROM feedback_records
  WHERE id = NEW.feedback_id
  FOR UPDATE;
  IF record_tier IS NULL OR NEW.evidence_tier IS DISTINCT FROM record_tier THEN
    RAISE EXCEPTION 'Feedback evidence tier does not match its intake record';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feedback_state_evidence_tier_lineage
BEFORE INSERT ON feedback_state_events
FOR EACH ROW EXECUTE FUNCTION validate_feedback_evidence_tier_lineage();

CREATE TRIGGER feedback_processing_evidence_tier_lineage
BEFORE INSERT ON feedback_processing_jobs
FOR EACH ROW EXECUTE FUNCTION validate_feedback_evidence_tier_lineage();

CREATE TRIGGER feedback_erasure_evidence_tier_lineage
BEFORE INSERT ON feedback_payload_erasure_events
FOR EACH ROW EXECUTE FUNCTION validate_feedback_evidence_tier_lineage();
