SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

CREATE TABLE feedback_authenticated_quota_buckets (
  scope_kind text NOT NULL CHECK (scope_kind IN ('person', 'household')),
  scope_id text NOT NULL CHECK (char_length(scope_id) BETWEEN 3 AND 128),
  bucket_starts_at timestamptz NOT NULL,
  accepted_count integer NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (scope_kind, scope_id, bucket_starts_at),
  CHECK (bucket_starts_at = date_trunc('hour', bucket_starts_at)),
  CHECK (
    (scope_kind = 'person' AND accepted_count BETWEEN 1 AND 20)
    OR (scope_kind = 'household' AND accepted_count BETWEEN 1 AND 50)
  ),
  CHECK (updated_at >= bucket_starts_at)
);

CREATE TABLE feedback_authenticated_quota_charges (
  operation_key text PRIMARY KEY
    REFERENCES feedback_intake_operations(operation_key) ON DELETE RESTRICT,
  person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  bucket_starts_at timestamptz NOT NULL,
  charged_at timestamptz NOT NULL,
  CHECK (bucket_starts_at = date_trunc('hour', bucket_starts_at)),
  CHECK (charged_at >= bucket_starts_at),
  CHECK (charged_at < bucket_starts_at + interval '1 hour')
);

CREATE INDEX feedback_authenticated_quota_charge_household_idx
  ON feedback_authenticated_quota_charges(household_id, bucket_starts_at, operation_key);
CREATE INDEX feedback_authenticated_quota_charge_person_idx
  ON feedback_authenticated_quota_charges(person_id, bucket_starts_at, operation_key);

CREATE FUNCTION feedback_live_founding_enrollment_id(
  target_household_id text,
  target_actor_person_id text,
  target_at timestamptz
) RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  matched_enrollment_id text;
BEGIN
  SELECT enrollment.id
  INTO matched_enrollment_id
  FROM founding_household_enrollments enrollment
  JOIN household_memberships membership
    ON membership.household_id = enrollment.household_id
   AND membership.person_id = target_actor_person_id
  JOIN identities identity
    ON identity.id = enrollment.accepted_identity_id
   AND identity.person_id = enrollment.accepted_by_person_id
   AND identity.issuer = enrollment.accepted_identity_issuer
   AND identity.subject = enrollment.accepted_identity_subject
  JOIN founding_household_sponsor_backings backing
    ON backing.cohort_key = enrollment.cohort_key
   AND backing.environment = enrollment.environment
   AND backing.benefit_key = enrollment.benefit_key
   AND backing.sponsorship_id = enrollment.sponsorship_id
   AND backing.plan_version_id = enrollment.plan_version_id
  JOIN commerce_sponsorships sponsorship
    ON sponsorship.id = backing.sponsorship_id
   AND sponsorship.organization_id = backing.organization_id
   AND sponsorship.plan_version_id = backing.plan_version_id
  JOIN organizations sponsor
    ON sponsor.id = backing.organization_id
  JOIN commerce_plan_versions plan
    ON plan.id = enrollment.plan_version_id
  JOIN commerce_subscriptions subscription
    ON subscription.household_id = enrollment.household_id
   AND subscription.id = enrollment.subscription_id
   AND subscription.plan_version_id = enrollment.plan_version_id
  JOIN commerce_sponsorship_allocations allocation
    ON allocation.household_id = enrollment.household_id
   AND allocation.id = enrollment.sponsorship_allocation_id
   AND allocation.plan_version_id = enrollment.plan_version_id
  JOIN entitlement_grants grant_record
    ON grant_record.household_id = enrollment.household_id
   AND grant_record.id = enrollment.entitlement_grant_id
  JOIN consents service_consent
    ON service_consent.household_id = enrollment.household_id
   AND service_consent.id = enrollment.service_consent_id
  JOIN consent_current_projections service_projection
    ON service_projection.household_id = service_consent.household_id
   AND service_projection.consent_id = service_consent.id
  JOIN consent_evidence service_evidence
    ON service_evidence.household_id = service_projection.household_id
   AND service_evidence.consent_id = service_projection.consent_id
   AND service_evidence.id = service_projection.latest_evidence_id
  JOIN sessions accepted_session
    ON accepted_session.id = enrollment.accepted_session_id
   AND accepted_session.identity_id = enrollment.accepted_identity_id
   AND accepted_session.person_id = enrollment.accepted_by_person_id
   AND accepted_session.issuer = enrollment.accepted_identity_issuer
   AND accepted_session.identity_subject = enrollment.accepted_identity_subject
   AND accepted_session.audience IN ('customer', 'mobile')
  WHERE enrollment.environment = 'production'
    AND enrollment.evidence_tier = 'live_production'
    AND enrollment.household_id = target_household_id
    AND enrollment.state = 'active'
    AND enrollment.revoked_at IS NULL
    AND enrollment.revoked_by_person_id IS NULL
    AND enrollment.revoked_reason IS NULL
    AND enrollment.revocation_operation_key IS NULL
    AND enrollment.starts_at <= target_at
    AND enrollment.ends_at > target_at
    AND membership.status = 'active'
    AND identity.status = 'active'
    AND identity.issuer <> 'boomerbuddy-dev'
    AND backing.environment = 'production'
    AND backing.evidence_tier = 'live_production'
    AND sponsor.kind = 'sponsor'
    AND sponsor.verification_state = 'verified'
    AND plan.state = 'active'
    AND sponsorship.state = 'active'
    AND sponsorship.starts_at <= enrollment.starts_at
    AND sponsorship.starts_at <= target_at
    AND (sponsorship.ends_at IS NULL OR sponsorship.ends_at >= enrollment.ends_at)
    AND (sponsorship.ends_at IS NULL OR sponsorship.ends_at > target_at)
    AND subscription.payer_person_id IS NULL
    AND subscription.source = 'sponsor'
    AND subscription.lifecycle = 'active'
    AND subscription.source_verified = true
    AND subscription.reconciliation_state = 'not_required'
    AND subscription.current_period_starts_at = enrollment.starts_at
    AND subscription.current_period_ends_at = enrollment.ends_at
    AND subscription.current_period_starts_at <= target_at
    AND subscription.current_period_ends_at > target_at
    AND subscription.ended_at IS NULL
    AND allocation.sponsorship_id = enrollment.sponsorship_id
    AND allocation.plan_version_id = enrollment.plan_version_id
    AND allocation.state = 'active'
    AND allocation.source_verified = true
    AND allocation.starts_at = enrollment.starts_at
    AND allocation.ends_at = enrollment.ends_at
    AND allocation.starts_at <= target_at
    AND allocation.ends_at > target_at
    AND grant_record.source = 'sponsor'
    AND grant_record.source_verified = true
    AND grant_record.plan_version_id = enrollment.plan_version_id
    AND grant_record.subscription_id = enrollment.subscription_id
    AND grant_record.sponsorship_id = enrollment.sponsorship_allocation_id
    AND grant_record.starts_at = enrollment.starts_at
    AND grant_record.ends_at = enrollment.ends_at
    AND grant_record.starts_at <= target_at
    AND grant_record.ends_at > target_at
    AND grant_record.revoked_at IS NULL
    AND grant_record.capabilities = plan.capabilities
    AND service_consent.protected_person_id = enrollment.accepted_by_person_id
    AND service_consent.granted_by_person_id = enrollment.accepted_by_person_id
    AND service_consent.purpose = 'founding_household_service_beta'
    AND service_consent.consent_version = 'founding-household-service-beta-v2'
    AND service_consent.state = 'active'
    AND service_consent.granted_at = enrollment.starts_at
    AND service_consent.revoked_at IS NULL
    AND service_projection.actor_person_id = enrollment.accepted_by_person_id
    AND service_projection.subject_person_id = enrollment.accepted_by_person_id
    AND service_projection.recipient_person_id IS NULL
    AND service_projection.purpose = 'founding_household_service_beta'
    AND service_projection.scope = jsonb_build_object(
      'accessEndsAt', to_char(
        enrollment.ends_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'benefitKey', enrollment.benefit_key,
      'cohortKey', enrollment.cohort_key,
      'followUpConsent', false,
      'marketingConsent', false,
      'researchConsent', false
    )
    AND service_projection.state = 'active'
    AND service_projection.effective_at = enrollment.starts_at
    AND service_projection.expires_at = enrollment.ends_at
    AND service_projection.updated_at = service_evidence.recorded_at
    AND service_evidence.actor_person_id = enrollment.accepted_by_person_id
    AND service_evidence.subject_person_id = enrollment.accepted_by_person_id
    AND service_evidence.recipient_person_id IS NULL
    AND service_evidence.purpose = service_projection.purpose
    AND service_evidence.scope = service_projection.scope
    AND service_evidence.action = 'accept'
    AND service_evidence.disclosure_version = 'founding-household-service-beta-v2'
    AND service_evidence.disclosure_digest =
      'b120fec99dab8271bf106c5a44fbff7640f3cb179a72b63957d34978cc41f137'
    AND service_evidence.policy_version = 'founding-household-service-beta-v2-policy'
    AND service_evidence.policy_digest =
      '815a516d88fef3be88b960c5f12a6b36c7be2f1c020610bfab16f7746ba197df'
    AND service_evidence.source_interaction = 'founding_household_acceptance'
    AND service_evidence.session_id = enrollment.accepted_session_id
    AND service_evidence.actor_identity_id = enrollment.accepted_identity_id
    AND service_evidence.actor_identity_issuer = enrollment.accepted_identity_issuer
    AND service_evidence.actor_identity_subject = enrollment.accepted_identity_subject
    AND service_evidence.assurance = 'verified'
    AND service_evidence.effective_at = enrollment.starts_at
    AND service_evidence.expires_at = enrollment.ends_at
    AND service_evidence.recorded_at = enrollment.starts_at
    AND accepted_session.issued_at <= enrollment.starts_at
    AND accepted_session.expires_at > enrollment.starts_at
  ORDER BY enrollment.id
  LIMIT 1
  FOR UPDATE OF enrollment, membership, identity, sponsorship, sponsor,
    subscription, allocation, grant_record, service_consent, service_projection;

  RETURN matched_enrollment_id;
END;
$$;

CREATE FUNCTION charge_feedback_authenticated_quota(
  target_operation_key text,
  target_person_id text,
  target_household_id text,
  observed_authority_now timestamptz
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  charge_now timestamptz := CASE
    WHEN position('(PGlite ' in version()) > 0 THEN observed_authority_now
    ELSE clock_timestamp()
  END;
  bucket_start timestamptz := date_trunc('hour', charge_now);
  accepted boolean;
BEGIN
  PERFORM 1
  FROM feedback_intake_operations operation
  WHERE operation.operation_key = target_operation_key
    AND operation.feedback_id IS NULL
    AND operation.completed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Feedback quota charge requires an exact incomplete intake operation';
  END IF;

  BEGIN
    accepted := false;
    INSERT INTO feedback_authenticated_quota_buckets(
      scope_kind, scope_id, bucket_starts_at, accepted_count, updated_at
    ) VALUES ('person', target_person_id, bucket_start, 1, charge_now)
    ON CONFLICT (scope_kind, scope_id, bucket_starts_at) DO UPDATE
      SET accepted_count = feedback_authenticated_quota_buckets.accepted_count + 1,
          updated_at = EXCLUDED.updated_at
      WHERE feedback_authenticated_quota_buckets.accepted_count < 20
    RETURNING true INTO accepted;
    IF accepted IS DISTINCT FROM true THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'Feedback person quota exhausted';
    END IF;

    accepted := false;
    INSERT INTO feedback_authenticated_quota_buckets(
      scope_kind, scope_id, bucket_starts_at, accepted_count, updated_at
    ) VALUES ('household', target_household_id, bucket_start, 1, charge_now)
    ON CONFLICT (scope_kind, scope_id, bucket_starts_at) DO UPDATE
      SET accepted_count = feedback_authenticated_quota_buckets.accepted_count + 1,
          updated_at = EXCLUDED.updated_at
      WHERE feedback_authenticated_quota_buckets.accepted_count < 50
    RETURNING true INTO accepted;
    IF accepted IS DISTINCT FROM true THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'Feedback household quota exhausted';
    END IF;

    INSERT INTO feedback_authenticated_quota_charges(
      operation_key, person_id, household_id, bucket_starts_at, charged_at
    ) VALUES (
      target_operation_key, target_person_id, target_household_id, bucket_start, charge_now
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    RETURN false;
  END;

  RETURN true;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM feedback_records record
    WHERE record.evidence_tier = 'live_production'
      AND feedback_live_founding_enrollment_id(
        record.household_id,
        record.actor_person_id,
        record.created_at
      ) IS NULL
  ) THEN
    RAISE EXCEPTION 'Existing live feedback lacks an exact Founding Household entitlement';
  END IF;
END;
$$;

CREATE FUNCTION validate_feedback_live_founding_access()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.evidence_tier = 'live_production'
    AND feedback_live_founding_enrollment_id(
      NEW.household_id,
      NEW.actor_person_id,
      clock_timestamp()
    ) IS NULL THEN
    RAISE EXCEPTION 'Live feedback requires an exact current Founding Household entitlement';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feedback_live_founding_access_guard
BEFORE INSERT ON feedback_records
FOR EACH ROW EXECUTE FUNCTION validate_feedback_live_founding_access();

CREATE FUNCTION protect_feedback_authenticated_quota_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Feedback authenticated quota evidence is append-only';
END;
$$;

CREATE TRIGGER feedback_authenticated_quota_charges_immutable
BEFORE UPDATE OR DELETE ON feedback_authenticated_quota_charges
FOR EACH ROW EXECUTE FUNCTION protect_feedback_authenticated_quota_evidence();

CREATE FUNCTION protect_feedback_authenticated_quota_bucket()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
    OR NEW.scope_id IS DISTINCT FROM OLD.scope_id
    OR NEW.bucket_starts_at IS DISTINCT FROM OLD.bucket_starts_at
    OR NEW.accepted_count <> OLD.accepted_count + 1
    OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Feedback authenticated quota bucket mutation is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feedback_authenticated_quota_buckets_guard
BEFORE UPDATE OR DELETE ON feedback_authenticated_quota_buckets
FOR EACH ROW EXECUTE FUNCTION protect_feedback_authenticated_quota_bucket();
