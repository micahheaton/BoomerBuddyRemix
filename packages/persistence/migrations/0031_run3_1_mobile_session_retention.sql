CREATE INDEX sessions_mobile_jti_retention_idx
  ON sessions(expires_at, id)
  WHERE audience = 'mobile' AND provider_session_id <> id;

CREATE INDEX consent_evidence_session_retention_idx
  ON consent_evidence(session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX founding_household_enrollments_session_retention_idx
  ON founding_household_enrollments(accepted_session_id);
