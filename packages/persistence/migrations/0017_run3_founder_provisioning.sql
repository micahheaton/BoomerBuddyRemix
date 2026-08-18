CREATE TABLE founder_provisioning_workstreams (
  workstream_key text PRIMARY KEY CHECK (workstream_key IN (
    'company_git', 'replit', 'dns_edge', 'managed_postgresql', 'object_storage',
    'managed_identity', 'kms_secrets', 'stripe', 'stripe_tax', 'twilio',
    'transactional_email', 'feedback_mailbox', 'support_mailbox', 'sentry',
    'posthog', 'apple_developer', 'google_play', 'expo_eas', 'enrichment',
    'dependency_security', 'backup_recovery', 'accounting', 'legal_professional'
  )),
  definition_version integer NOT NULL CHECK (definition_version = 1),
  definition_digest text NOT NULL CHECK (definition_digest ~ '^[A-Za-z0-9_-]{43}$'),
  display_order integer NOT NULL UNIQUE CHECK (display_order BETWEEN 10 AND 230),
  initial_status text NOT NULL CHECK (initial_status IN (
    'not_started', 'founder_in_progress', 'ready_for_test', 'test_proven',
    'ready_for_live_review', 'blocked'
  )),
  allowed_proof_tiers text[] NOT NULL CHECK (cardinality(allowed_proof_tiers) BETWEEN 1 AND 4),
  created_at timestamptz NOT NULL
);

CREATE TABLE founder_provisioning_evidence (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  workstream_key text NOT NULL
    REFERENCES founder_provisioning_workstreams(workstream_key) ON DELETE RESTRICT,
  actor_person_id text REFERENCES persons(id) ON DELETE RESTRICT,
  tier text NOT NULL CHECK (tier IN (
    'repository_review', 'founder_report', 'local_simulation', 'provider_test',
    'deployed_staging', 'human_validation', 'professional_review', 'live_production'
  )),
  kind text NOT NULL CHECK (kind IN (
    'baseline_reconciliation', 'setup_started', 'configuration_ready',
    'verification_passed', 'verification_failed', 'blocker_recorded',
    'blocker_cleared', 'configuration_revoked', 'evidence_invalidated',
    'provider_unavailable', 'account_removed', 'live_review_packet_complete'
  )),
  result text NOT NULL CHECK (result IN (
    'reported', 'passed', 'failed', 'blocked', 'invalidated'
  )),
  blocker_code text CHECK (blocker_code IS NULL OR blocker_code IN (
    'founder_account_required', 'founder_credential_required',
    'founder_cost_decision_required', 'provider_verification_pending',
    'adapter_not_implemented', 'legal_review_required',
    'professional_review_required', 'security_review_required',
    'external_evidence_required', 'technical_failure'
  )),
  manifest_digest text CHECK (
    manifest_digest IS NULL OR manifest_digest ~ '^[A-Za-z0-9_-]{43}$'
  ),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  correlation_id text NOT NULL CHECK (
    correlation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  UNIQUE (workstream_key, id),
  UNIQUE (id, actor_person_id),
  CHECK (result <> 'blocked' OR blocker_code IS NOT NULL),
  CHECK (blocker_code IS NULL OR result IN ('blocked', 'failed'))
);

CREATE INDEX founder_provisioning_evidence_workstream_idx
  ON founder_provisioning_evidence(workstream_key, recorded_at DESC, id DESC);

CREATE TABLE founder_provisioning_operations (
  operation_key text PRIMARY KEY CHECK (
    operation_key ~ '^provisioning:(company_git|replit|dns_edge|managed_postgresql|object_storage|managed_identity|kms_secrets|stripe|stripe_tax|twilio|transactional_email|feedback_mailbox|support_mailbox|sentry|posthog|apple_developer|google_play|expo_eas|enrichment|dependency_security|backup_recovery|accounting|legal_professional):[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  workstream_key text NOT NULL
    REFERENCES founder_provisioning_workstreams(workstream_key) ON DELETE RESTRICT,
  request_digest text NOT NULL CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
  actor_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  UNIQUE (workstream_key, operation_key),
  UNIQUE (operation_key, actor_person_id),
  CHECK (operation_key LIKE ('provisioning:' || workstream_key || ':%'))
);

CREATE TABLE founder_provisioning_status_events (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  workstream_key text NOT NULL
    REFERENCES founder_provisioning_workstreams(workstream_key) ON DELETE RESTRICT,
  from_status text CHECK (from_status IS NULL OR from_status IN (
    'not_started', 'founder_in_progress', 'ready_for_test', 'test_proven',
    'ready_for_live_review', 'blocked'
  )),
  to_status text NOT NULL CHECK (to_status IN (
    'not_started', 'founder_in_progress', 'ready_for_test', 'test_proven',
    'ready_for_live_review', 'blocked'
  )),
  version integer NOT NULL CHECK (version > 0),
  evidence_id text NOT NULL,
  actor_person_id text REFERENCES persons(id) ON DELETE RESTRICT,
  operation_key text UNIQUE,
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (workstream_key, evidence_id)
    REFERENCES founder_provisioning_evidence(workstream_key, id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_id, actor_person_id)
    REFERENCES founder_provisioning_evidence(id, actor_person_id) ON DELETE RESTRICT,
  FOREIGN KEY (workstream_key, operation_key)
    REFERENCES founder_provisioning_operations(workstream_key, operation_key) ON DELETE RESTRICT,
  FOREIGN KEY (operation_key, actor_person_id)
    REFERENCES founder_provisioning_operations(operation_key, actor_person_id) ON DELETE RESTRICT,
  UNIQUE (workstream_key, version),
  UNIQUE (evidence_id),
  CHECK ((version = 1) = (from_status IS NULL)),
  CHECK ((version = 1) = (actor_person_id IS NULL)),
  CHECK ((version = 1) = (operation_key IS NULL))
);

CREATE INDEX founder_provisioning_status_current_idx
  ON founder_provisioning_status_events(workstream_key, version DESC);

CREATE FUNCTION validate_founder_provisioning_status_sequence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allowed_proof_tiers text[];
  authority_now timestamptz;
  evidence_blocker_code text;
  evidence_kind text;
  evidence_manifest_digest text;
  evidence_observed_at timestamptz;
  evidence_recorded_at timestamptz;
  evidence_result text;
  evidence_tier text;
  from_order integer;
  initial_status text;
  latest_occurred_at timestamptz;
  latest_status text;
  latest_version integer;
  operation_created_at timestamptz;
  to_order integer;
BEGIN
  SELECT workstream.initial_status, workstream.allowed_proof_tiers
    INTO initial_status, allowed_proof_tiers
    FROM founder_provisioning_workstreams
    AS workstream
    WHERE workstream.workstream_key = NEW.workstream_key
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown founder provisioning workstream';
  END IF;

  SELECT evidence.tier, evidence.kind, evidence.result,
         evidence.blocker_code, evidence.manifest_digest,
         evidence.observed_at, evidence.recorded_at
    INTO evidence_tier, evidence_kind, evidence_result,
         evidence_blocker_code, evidence_manifest_digest,
         evidence_observed_at, evidence_recorded_at
    FROM founder_provisioning_evidence AS evidence
    WHERE evidence.workstream_key = NEW.workstream_key
      AND evidence.id = NEW.evidence_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Founder provisioning status requires same-workstream evidence';
  END IF;

  SELECT to_status, version, occurred_at
    INTO latest_status, latest_version, latest_occurred_at
    FROM founder_provisioning_status_events
    WHERE workstream_key = NEW.workstream_key
    ORDER BY version DESC
    LIMIT 1;

  IF latest_version IS NULL THEN
    IF NEW.version <> 1 OR NEW.from_status IS NOT NULL THEN
      RAISE EXCEPTION 'Initial founder provisioning status must be version 1';
    END IF;
    IF NEW.to_status <> initial_status OR evidence_kind <> 'baseline_reconciliation' THEN
      RAISE EXCEPTION 'Initial founder provisioning status must match the code-owned baseline';
    END IF;
    IF NEW.occurred_at <> evidence_recorded_at THEN
      RAISE EXCEPTION 'Initial founder provisioning status and evidence time must match';
    END IF;
    IF NEW.to_status = 'blocked' THEN
      IF evidence_result <> 'blocked' OR evidence_blocker_code IS NULL THEN
        RAISE EXCEPTION 'Blocked baseline requires structured blocker evidence';
      END IF;
    ELSIF evidence_result <> 'reported' OR evidence_blocker_code IS NOT NULL THEN
      RAISE EXCEPTION 'Non-blocked baseline requires reported reconciliation evidence';
    END IF;
    RETURN NEW;
  ELSIF NEW.version <> latest_version + 1 OR NEW.from_status <> latest_status THEN
    RAISE EXCEPTION 'Founder provisioning status sequence is stale or invalid';
  END IF;

  SELECT operation.created_at
    INTO operation_created_at
    FROM founder_provisioning_operations AS operation
    WHERE operation.operation_key = NEW.operation_key
      AND operation.workstream_key = NEW.workstream_key
      AND operation.actor_person_id = NEW.actor_person_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Founder provisioning status requires the exact actor operation';
  END IF;

  authority_now := clock_timestamp();
  IF evidence_recorded_at <> NEW.occurred_at
     OR evidence_recorded_at <> operation_created_at THEN
    RAISE EXCEPTION 'Founder provisioning operation, evidence, and status time must match';
  END IF;
  IF evidence_recorded_at < authority_now - interval '5 minutes'
     OR evidence_recorded_at > authority_now + interval '5 minutes' THEN
    RAISE EXCEPTION 'Founder provisioning recording time must be current database time';
  END IF;
  IF latest_occurred_at > evidence_recorded_at THEN
    RAISE EXCEPTION 'Founder provisioning status chronology exceeds recording time';
  END IF;
  IF evidence_observed_at > authority_now + interval '5 minutes' THEN
    RAISE EXCEPTION 'Founder provisioning evidence cannot be future-dated';
  END IF;
  IF NEW.to_status IN ('test_proven', 'ready_for_live_review')
     AND evidence_observed_at < evidence_recorded_at - interval '24 hours' THEN
    RAISE EXCEPTION 'Founder provisioning external proof exceeds the 24-hour freshness bound';
  END IF;
  IF evidence_observed_at < latest_occurred_at THEN
    RAISE EXCEPTION 'Founder provisioning evidence predates the current status gate';
  END IF;

  IF NEW.to_status = NEW.from_status THEN
    RAISE EXCEPTION 'Founder provisioning status transitions cannot be no-ops';
  END IF;

  IF NEW.to_status = 'blocked' THEN
    IF evidence_kind NOT IN ('blocker_recorded', 'verification_failed', 'provider_unavailable')
       OR evidence_result NOT IN ('blocked', 'failed')
       OR evidence_blocker_code IS NULL THEN
      RAISE EXCEPTION 'Blocked status requires structured blocker evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.from_status = 'blocked' THEN
    IF NEW.to_status = 'not_started' THEN
      IF evidence_kind <> 'account_removed'
         OR evidence_result NOT IN ('reported', 'invalidated') THEN
        RAISE EXCEPTION 'Blocked reset requires account-removed evidence';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.to_status <> 'founder_in_progress'
       OR evidence_kind <> 'blocker_cleared'
       OR evidence_result NOT IN ('reported', 'passed') THEN
      RAISE EXCEPTION 'Blocked status must return through founder progress';
    END IF;
    RETURN NEW;
  END IF;

  from_order := CASE NEW.from_status
    WHEN 'not_started' THEN 0
    WHEN 'founder_in_progress' THEN 1
    WHEN 'ready_for_test' THEN 2
    WHEN 'test_proven' THEN 3
    WHEN 'ready_for_live_review' THEN 4
    ELSE NULL
  END;
  to_order := CASE NEW.to_status
    WHEN 'not_started' THEN 0
    WHEN 'founder_in_progress' THEN 1
    WHEN 'ready_for_test' THEN 2
    WHEN 'test_proven' THEN 3
    WHEN 'ready_for_live_review' THEN 4
    ELSE NULL
  END;

  IF to_order < from_order THEN
    IF evidence_kind NOT IN (
         'configuration_revoked', 'evidence_invalidated',
         'provider_unavailable', 'account_removed'
       ) OR evidence_result NOT IN ('failed', 'invalidated', 'reported') THEN
      RAISE EXCEPTION 'Provisioning downgrade requires invalidation evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF to_order <> from_order + 1 THEN
    RAISE EXCEPTION 'Founder provisioning status cannot skip an evidence gate';
  END IF;

  IF NEW.to_status = 'founder_in_progress' THEN
    IF evidence_kind <> 'setup_started' OR evidence_result <> 'reported' THEN
      RAISE EXCEPTION 'Founder progress requires setup-started evidence';
    END IF;
  ELSIF NEW.to_status = 'ready_for_test' THEN
    IF evidence_kind <> 'configuration_ready' OR evidence_result <> 'passed'
       OR evidence_manifest_digest IS NULL THEN
      RAISE EXCEPTION 'Ready for test requires configuration evidence and a manifest digest';
    END IF;
  ELSIF NEW.to_status = 'test_proven' THEN
    IF evidence_kind <> 'verification_passed' OR evidence_result <> 'passed'
       OR evidence_manifest_digest IS NULL
       OR NOT (evidence_tier = ANY(allowed_proof_tiers))
       OR evidence_tier IN (
         'repository_review', 'founder_report', 'local_simulation', 'live_production'
       ) THEN
      RAISE EXCEPTION 'Test proven requires allowed external evidence and a manifest digest';
    END IF;
  ELSIF NEW.to_status = 'ready_for_live_review' THEN
    IF evidence_kind <> 'live_review_packet_complete' OR evidence_result <> 'passed'
       OR evidence_manifest_digest IS NULL
       OR evidence_tier NOT IN (
         'deployed_staging', 'human_validation', 'professional_review'
       ) THEN
      RAISE EXCEPTION 'Live review requires deployed, human, or professional packet evidence';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER founder_provisioning_status_sequence_valid
BEFORE INSERT ON founder_provisioning_status_events
FOR EACH ROW EXECUTE FUNCTION validate_founder_provisioning_status_sequence();

CREATE FUNCTION reject_founder_provisioning_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Founder provisioning catalogue and history are immutable';
END;
$$;

CREATE TRIGGER founder_provisioning_workstreams_immutable
BEFORE UPDATE OR DELETE ON founder_provisioning_workstreams
FOR EACH ROW EXECUTE FUNCTION reject_founder_provisioning_mutation();

CREATE TRIGGER founder_provisioning_evidence_immutable
BEFORE UPDATE OR DELETE ON founder_provisioning_evidence
FOR EACH ROW EXECUTE FUNCTION reject_founder_provisioning_mutation();

CREATE TRIGGER founder_provisioning_operations_immutable
BEFORE UPDATE OR DELETE ON founder_provisioning_operations
FOR EACH ROW EXECUTE FUNCTION reject_founder_provisioning_mutation();

CREATE TRIGGER founder_provisioning_status_events_immutable
BEFORE UPDATE OR DELETE ON founder_provisioning_status_events
FOR EACH ROW EXECUTE FUNCTION reject_founder_provisioning_mutation();

INSERT INTO founder_provisioning_workstreams(
  workstream_key, definition_version, definition_digest, display_order, initial_status,
  allowed_proof_tiers, created_at
) VALUES
  ('company_git', 1, 'tK6dx3KMQ03vGa9Vf-6iii02RSlWEf6zxN8zqqur0Nk', 10, 'not_started', ARRAY['deployed_staging'], '2026-08-16T00:00:00.000Z'),
  ('replit', 1, 'vVZsCo6BGaVr9JmIW9nOrmHHYh_OmvtZ_H0o_NvWQcQ', 20, 'founder_in_progress', ARRAY['deployed_staging'], '2026-08-16T00:00:00.000Z'),
  ('dns_edge', 1, 'fYFfnpjdSIkM1-Qu_6hRUPEBv-yNIy6HjiPsM0LI5IM', 30, 'founder_in_progress', ARRAY['deployed_staging'], '2026-08-16T00:00:00.000Z'),
  ('managed_postgresql', 1, 'NO3HgaFTFuplAaIHijgNswGulJq-0WhuEt-WFYsgXLs', 40, 'not_started', ARRAY['deployed_staging'], '2026-08-16T00:00:00.000Z'),
  ('object_storage', 1, 'iZT3Uq1GfkviarBDNmEf5jEhw02rzsUFECEPZHIb5X4', 50, 'not_started', ARRAY['deployed_staging'], '2026-08-16T00:00:00.000Z'),
  ('managed_identity', 1, 'YFycq_E5dcvYks4ULmlh2PZxsFuqUTNDTZr1C8PCVNQ', 60, 'not_started', ARRAY['deployed_staging'], '2026-08-16T00:00:00.000Z'),
  ('kms_secrets', 1, 'Ce4gZSnd_ikNFtW3dWlvIekdzm8SJEzbGARz3i5MmPM', 70, 'not_started', ARRAY['deployed_staging'], '2026-08-16T00:00:00.000Z'),
  ('stripe', 1, 'iVIfICLRt0h1kCAvDIaTfRktEpYRBVnykxdRAHW7iLs', 80, 'founder_in_progress', ARRAY['provider_test','deployed_staging'], '2026-08-16T00:00:00.000Z'),
  ('stripe_tax', 1, '2iZotCTPBoNNkKKfvnIOOuVS7XE9E2O295e_jDQpj00', 90, 'blocked', ARRAY['professional_review','provider_test'], '2026-08-16T00:00:00.000Z'),
  ('twilio', 1, 'DzDJzdNeDPmUIYhd-63wjRKfxGhWh5AD56dZVK9HP3c', 100, 'founder_in_progress', ARRAY['provider_test','deployed_staging'], '2026-08-16T00:00:00.000Z'),
  ('transactional_email', 1, 'AaD5OgiSGoQp-mnJ4TI5Wrcd0u69AVjCp0XHQu79j9U', 110, 'not_started', ARRAY['provider_test','deployed_staging'], '2026-08-16T00:00:00.000Z'),
  ('feedback_mailbox', 1, 'XPiUrnXI11pKloCO-Pijf0KISN-xzWaw4UZ4HXOO7j8', 120, 'not_started', ARRAY['provider_test','deployed_staging'], '2026-08-16T00:00:00.000Z'),
  ('support_mailbox', 1, 'IJ8HTBiyZQcXmE5JrRbgP0a_wmcld9CStHSt7wb3PfE', 130, 'founder_in_progress', ARRAY['provider_test','deployed_staging'], '2026-08-16T00:00:00.000Z'),
  ('sentry', 1, 'BSWP9_0c_f1_9k8uiaNXYiunP3HhNuMSpa2KMTiIbx0', 140, 'not_started', ARRAY['provider_test','deployed_staging'], '2026-08-16T00:00:00.000Z'),
  ('posthog', 1, 'vJEGqJLcBScygB0kJPgfx4vCX8P8XJFEBJJnZqD4rDQ', 150, 'not_started', ARRAY['provider_test','deployed_staging'], '2026-08-16T00:00:00.000Z'),
  ('apple_developer', 1, 'pNgdEmqiQaXwCgUXE5kJnN43IY4FiyTlZsLioA0npIQ', 160, 'founder_in_progress', ARRAY['provider_test','human_validation'], '2026-08-16T00:00:00.000Z'),
  ('google_play', 1, 'Kw-OC85drwuRJRUnfVVeTsiBZO0PoF0gCIhUXK4Velw', 170, 'founder_in_progress', ARRAY['provider_test','human_validation'], '2026-08-16T00:00:00.000Z'),
  ('expo_eas', 1, 'kGcvbK8uGVHg6OVfst33YWReGpI9grFjTgX1kf4L7gI', 180, 'not_started', ARRAY['provider_test','human_validation'], '2026-08-16T00:00:00.000Z'),
  ('enrichment', 1, 'Vvdd0SC26d074Pdz8SZh-vDm-kMMcLvsn3pCg4tTFFI', 190, 'blocked', ARRAY['professional_review','provider_test'], '2026-08-16T00:00:00.000Z'),
  ('dependency_security', 1, 'Y1KcB-6TBuvD3x887rxEUDIUjEVGzWHLVj7NWWBQWSE', 200, 'blocked', ARRAY['deployed_staging','professional_review'], '2026-08-16T00:00:00.000Z'),
  ('backup_recovery', 1, '1-rtMNwXCSWvTMtruLE_gWZvINmQ4HIImdW4OLVXuOA', 210, 'not_started', ARRAY['deployed_staging'], '2026-08-16T00:00:00.000Z'),
  ('accounting', 1, 'pYrRSIZ9m-VLwt7UKwycXzcoPNbcx2PwSMsvKYHtzgw', 220, 'blocked', ARRAY['professional_review'], '2026-08-16T00:00:00.000Z'),
  ('legal_professional', 1, 'SxwniSlxsA2eRBFJPPZXO7b3Jo6hZE-EDQGYwgoRiX8', 230, 'blocked', ARRAY['professional_review'], '2026-08-16T00:00:00.000Z');

INSERT INTO founder_provisioning_evidence(
  id, workstream_key, actor_person_id, tier, kind, result, blocker_code,
  manifest_digest, observed_at, recorded_at, correlation_id
) VALUES
  ('run3-provisioning-evidence-company-git-v1', 'company_git', NULL, 'repository_review', 'baseline_reconciliation', 'reported', NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-replit-v1', 'replit', NULL, 'founder_report', 'baseline_reconciliation', 'reported', NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-dns-edge-v1', 'dns_edge', NULL, 'founder_report', 'baseline_reconciliation', 'reported', NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-managed-postgresql-v1', 'managed_postgresql', NULL, 'repository_review', 'baseline_reconciliation', 'reported', NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-object-storage-v1', 'object_storage', NULL, 'repository_review', 'baseline_reconciliation', 'reported', NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-managed-identity-v1', 'managed_identity', NULL, 'repository_review', 'baseline_reconciliation', 'reported', NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-kms-secrets-v1', 'kms_secrets', NULL, 'repository_review', 'baseline_reconciliation', 'reported', NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-stripe-v1', 'stripe', NULL, 'founder_report', 'baseline_reconciliation', 'reported', NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-stripe-tax-v1', 'stripe_tax', NULL, 'repository_review', 'baseline_reconciliation', 'blocked', 'professional_review_required', NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-twilio-v1', 'twilio', NULL, 'founder_report', 'baseline_reconciliation', 'reported', NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-transactional-email-v1', 'transactional_email', NULL, 'repository_review', 'baseline_reconciliation', 'reported', NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-feedback-mailbox-v1', 'feedback_mailbox', NULL, 'repository_review', 'baseline_reconciliation', 'reported', NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-support-mailbox-v1', 'support_mailbox', NULL, 'founder_report', 'baseline_reconciliation', 'reported', NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-sentry-v1', 'sentry', NULL, 'repository_review', 'baseline_reconciliation', 'reported', NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-posthog-v1', 'posthog', NULL, 'repository_review', 'baseline_reconciliation', 'reported', NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-apple-developer-v1', 'apple_developer', NULL, 'founder_report', 'baseline_reconciliation', 'reported', NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-google-play-v1', 'google_play', NULL, 'founder_report', 'baseline_reconciliation', 'reported', NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-expo-eas-v1', 'expo_eas', NULL, 'repository_review', 'baseline_reconciliation', 'reported', NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-enrichment-v1', 'enrichment', NULL, 'repository_review', 'baseline_reconciliation', 'blocked', 'legal_review_required', NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-dependency-security-v1', 'dependency_security', NULL, 'repository_review', 'baseline_reconciliation', 'blocked', 'security_review_required', NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-backup-recovery-v1', 'backup_recovery', NULL, 'repository_review', 'baseline_reconciliation', 'reported', NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-accounting-v1', 'accounting', NULL, 'repository_review', 'baseline_reconciliation', 'blocked', 'professional_review_required', NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline'),
  ('run3-provisioning-evidence-legal-professional-v1', 'legal_professional', NULL, 'repository_review', 'baseline_reconciliation', 'blocked', 'professional_review_required', NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z', 'run3-founder-provisioning-baseline');

INSERT INTO founder_provisioning_status_events(
  id, workstream_key, from_status, to_status, version, evidence_id,
  actor_person_id, operation_key, occurred_at
) VALUES
  ('run3-provisioning-status-company-git-v1', 'company_git', NULL, 'not_started', 1, 'run3-provisioning-evidence-company-git-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-replit-v1', 'replit', NULL, 'founder_in_progress', 1, 'run3-provisioning-evidence-replit-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-dns-edge-v1', 'dns_edge', NULL, 'founder_in_progress', 1, 'run3-provisioning-evidence-dns-edge-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-managed-postgresql-v1', 'managed_postgresql', NULL, 'not_started', 1, 'run3-provisioning-evidence-managed-postgresql-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-object-storage-v1', 'object_storage', NULL, 'not_started', 1, 'run3-provisioning-evidence-object-storage-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-managed-identity-v1', 'managed_identity', NULL, 'not_started', 1, 'run3-provisioning-evidence-managed-identity-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-kms-secrets-v1', 'kms_secrets', NULL, 'not_started', 1, 'run3-provisioning-evidence-kms-secrets-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-stripe-v1', 'stripe', NULL, 'founder_in_progress', 1, 'run3-provisioning-evidence-stripe-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-stripe-tax-v1', 'stripe_tax', NULL, 'blocked', 1, 'run3-provisioning-evidence-stripe-tax-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-twilio-v1', 'twilio', NULL, 'founder_in_progress', 1, 'run3-provisioning-evidence-twilio-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-transactional-email-v1', 'transactional_email', NULL, 'not_started', 1, 'run3-provisioning-evidence-transactional-email-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-feedback-mailbox-v1', 'feedback_mailbox', NULL, 'not_started', 1, 'run3-provisioning-evidence-feedback-mailbox-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-support-mailbox-v1', 'support_mailbox', NULL, 'founder_in_progress', 1, 'run3-provisioning-evidence-support-mailbox-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-sentry-v1', 'sentry', NULL, 'not_started', 1, 'run3-provisioning-evidence-sentry-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-posthog-v1', 'posthog', NULL, 'not_started', 1, 'run3-provisioning-evidence-posthog-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-apple-developer-v1', 'apple_developer', NULL, 'founder_in_progress', 1, 'run3-provisioning-evidence-apple-developer-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-google-play-v1', 'google_play', NULL, 'founder_in_progress', 1, 'run3-provisioning-evidence-google-play-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-expo-eas-v1', 'expo_eas', NULL, 'not_started', 1, 'run3-provisioning-evidence-expo-eas-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-enrichment-v1', 'enrichment', NULL, 'blocked', 1, 'run3-provisioning-evidence-enrichment-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-dependency-security-v1', 'dependency_security', NULL, 'blocked', 1, 'run3-provisioning-evidence-dependency-security-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-backup-recovery-v1', 'backup_recovery', NULL, 'not_started', 1, 'run3-provisioning-evidence-backup-recovery-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-accounting-v1', 'accounting', NULL, 'blocked', 1, 'run3-provisioning-evidence-accounting-v1', NULL, NULL, '2026-08-16T00:00:00.000Z'),
  ('run3-provisioning-status-legal-professional-v1', 'legal_professional', NULL, 'blocked', 1, 'run3-provisioning-evidence-legal-professional-v1', NULL, NULL, '2026-08-16T00:00:00.000Z');
