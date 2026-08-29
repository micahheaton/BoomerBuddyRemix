ALTER TABLE analyses
  ADD COLUMN reuse_provenance_key text
    CHECK (reuse_provenance_key IS NULL OR length(reuse_provenance_key) BETWEEN 1 AND 100),
  ADD COLUMN reuse_until timestamptz,
  ADD CONSTRAINT analyses_reuse_boundary_check CHECK (
    (reuse_provenance_key IS NULL AND reuse_until IS NULL)
    OR
    (reuse_provenance_key IS NOT NULL AND reuse_until IS NOT NULL
      AND reuse_until > created_at AND reuse_until <= created_at + interval '24 hours')
  );

CREATE INDEX artifacts_active_owner_fingerprint_idx
  ON artifacts(
    household_id,
    owner_person_id,
    kind,
    input_fingerprint,
    fingerprint_key_version,
    created_at DESC
  )
  WHERE state = 'active' AND input_fingerprint IS NOT NULL;

CREATE INDEX analyses_completed_artifact_provenance_idx
  ON analyses(
    household_id,
    requested_by,
    reuse_provenance_key,
    reuse_until,
    created_at DESC,
    artifact_id
  )
  WHERE state = 'completed' AND reuse_provenance_key IS NOT NULL;
