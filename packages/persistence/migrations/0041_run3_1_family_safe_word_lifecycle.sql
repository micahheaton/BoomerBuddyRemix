ALTER TABLE safe_word_verifiers
  ADD COLUMN lifecycle_revision integer NOT NULL DEFAULT 1
    CHECK (lifecycle_revision > 0);

ALTER TABLE safe_word_verifiers
  DROP CONSTRAINT safe_word_verifiers_household_id_protected_person_id_fkey,
  ADD CONSTRAINT safe_word_verifiers_household_id_protected_person_id_fkey
    FOREIGN KEY (household_id, protected_person_id)
    REFERENCES household_memberships(household_id, person_id) ON DELETE CASCADE;

CREATE TABLE family_safe_word_rate_buckets (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  protected_person_id text NOT NULL,
  actor_person_id text NOT NULL,
  bucket_starts_at timestamptz NOT NULL,
  used_count integer NOT NULL CHECK (used_count > 0 AND used_count <= 5),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, protected_person_id, actor_person_id, bucket_starts_at),
  FOREIGN KEY (household_id, protected_person_id)
    REFERENCES household_memberships(household_id, person_id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, actor_person_id)
    REFERENCES household_memberships(household_id, person_id) ON DELETE CASCADE
);

CREATE INDEX family_safe_word_rate_buckets_retention_idx
  ON family_safe_word_rate_buckets(bucket_starts_at);

CREATE TABLE family_safe_word_lifecycle_events (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  id text NOT NULL,
  protected_person_id text NOT NULL,
  actor_person_id text NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('protected_member', 'trusted_person')),
  event_kind text NOT NULL CHECK (
    event_kind IN (
      'configured',
      'replaced',
      'disabled',
      'verification_succeeded',
      'verification_failed'
    )
  ),
  lifecycle_revision integer CHECK (lifecycle_revision IS NULL OR lifecycle_revision > 0),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, id),
  FOREIGN KEY (household_id, protected_person_id)
    REFERENCES household_memberships(household_id, person_id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, actor_person_id)
    REFERENCES household_memberships(household_id, person_id) ON DELETE CASCADE,
  CHECK (
    (event_kind IN ('configured', 'replaced', 'disabled') AND lifecycle_revision IS NOT NULL)
    OR
    (event_kind IN ('verification_succeeded', 'verification_failed'))
  )
);

CREATE INDEX family_safe_word_lifecycle_events_target_idx
  ON family_safe_word_lifecycle_events(
    household_id, protected_person_id, occurred_at DESC, id
  );

CREATE FUNCTION enforce_family_safe_word_lifecycle_event_actor() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.actor_kind = 'protected_member'
    AND NEW.actor_person_id IS DISTINCT FROM NEW.protected_person_id THEN
    RAISE EXCEPTION 'Protected-member verification-aid events require the protected person';
  END IF;
  IF NEW.actor_kind = 'trusted_person'
    AND (
      NEW.event_kind IN ('configured', 'replaced', 'disabled')
      OR NOT EXISTS (
        SELECT 1
        FROM trusted_circle_relationships relationship
        JOIN consent_current_projections consent
          ON consent.household_id = relationship.household_id
         AND consent.consent_id = relationship.consent_id
         AND consent.latest_evidence_id = relationship.latest_consent_evidence_id
        JOIN household_memberships protected_membership
          ON protected_membership.household_id = relationship.household_id
         AND protected_membership.person_id = relationship.protected_person_id
        JOIN household_memberships trusted_membership
          ON trusted_membership.household_id = relationship.household_id
         AND trusted_membership.person_id = relationship.trusted_person_id
        WHERE relationship.household_id = NEW.household_id
          AND relationship.protected_person_id = NEW.protected_person_id
          AND relationship.trusted_person_id = NEW.actor_person_id
          AND relationship.state = 'active'
          AND protected_membership.status = 'active'
          AND trusted_membership.status = 'active'
          AND consent.subject_person_id = relationship.protected_person_id
          AND consent.recipient_person_id = relationship.trusted_person_id
          AND consent.purpose = 'trusted_circle_relationship'
          AND consent.state = 'active'
          AND (consent.expires_at IS NULL OR consent.expires_at > NEW.occurred_at)
      )
    ) THEN
    RAISE EXCEPTION 'Trusted-person verification-aid event requires the exact active relationship';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER family_safe_word_lifecycle_events_exact_actor
BEFORE INSERT OR UPDATE ON family_safe_word_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION enforce_family_safe_word_lifecycle_event_actor();

CREATE FUNCTION reject_family_safe_word_lifecycle_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Family verification-aid lifecycle events are append-only';
END;
$$;

CREATE TRIGGER family_safe_word_lifecycle_events_append_only
BEFORE UPDATE OR DELETE ON family_safe_word_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION reject_family_safe_word_lifecycle_event_mutation();

COMMENT ON TABLE family_safe_word_rate_buckets IS
  'Content-free, authenticated per-pair verification attempt counters. No submitted phrase, verifier, contact detail, or customer content is stored.';

COMMENT ON TABLE family_safe_word_lifecycle_events IS
  'Append-only, content-free evidence for a Family verification aid. Submitted phrases and derived verifier material are forbidden from this table.';
