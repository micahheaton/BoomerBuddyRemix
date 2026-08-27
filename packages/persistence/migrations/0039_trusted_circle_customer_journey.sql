CREATE TABLE trusted_circle_recipient_codes (
  id text PRIMARY KEY,
  identity_id text NOT NULL REFERENCES identities(id),
  person_id text NOT NULL REFERENCES persons(id),
  code_fingerprint text NOT NULL,
  fingerprint_key_version integer NOT NULL CHECK (fingerprint_key_version > 0),
  state text NOT NULL CHECK (state IN ('active', 'consumed', 'rotated')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  ended_at timestamptz,
  CHECK (
    (state = 'active' AND ended_at IS NULL)
    OR (state IN ('consumed', 'rotated') AND ended_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX trusted_circle_recipient_codes_one_active_identity
  ON trusted_circle_recipient_codes(identity_id)
  WHERE state = 'active';

CREATE UNIQUE INDEX trusted_circle_recipient_codes_fingerprint_unique
  ON trusted_circle_recipient_codes(fingerprint_key_version, code_fingerprint);

CREATE UNIQUE INDEX trusted_circle_recipient_codes_exact_identity_unique
  ON trusted_circle_recipient_codes(id, identity_id, person_id);

ALTER TABLE invitations
  ADD COLUMN recipient_code_id text REFERENCES trusted_circle_recipient_codes(id);

CREATE UNIQUE INDEX invitations_recipient_code_unique
  ON invitations(recipient_code_id)
  WHERE recipient_code_id IS NOT NULL;

CREATE FUNCTION enforce_invitation_recipient_code_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.recipient_code_id IS DISTINCT FROM OLD.recipient_code_id THEN
    RAISE EXCEPTION 'Trusted Circle invitation recipient binding is immutable';
  END IF;
  IF NEW.recipient_code_id IS NOT NULL
    AND (
      NEW.identity_binding_state <> 'verified_identity'
      OR NOT EXISTS (
        SELECT 1
        FROM trusted_circle_recipient_codes code
        JOIN identities identity
          ON identity.id = code.identity_id
         AND identity.person_id = code.person_id
        WHERE code.id = NEW.recipient_code_id
          AND identity.issuer = NEW.intended_identity_issuer
          AND identity.subject = NEW.intended_identity_subject
      )
    ) THEN
    RAISE EXCEPTION 'Trusted Circle invitation recipient code must match the intended identity';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invitations_recipient_code_binding
BEFORE INSERT OR UPDATE ON invitations
FOR EACH ROW EXECUTE FUNCTION enforce_invitation_recipient_code_binding();

CREATE TABLE trusted_circle_authenticated_rate_buckets (
  person_id text NOT NULL REFERENCES persons(id),
  action_kind text NOT NULL
    CHECK (action_kind IN ('recipient_code_generation', 'recipient_code_lookup')),
  bucket_starts_at timestamptz NOT NULL,
  used_count integer NOT NULL CHECK (used_count > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (person_id, action_kind, bucket_starts_at)
);

CREATE TABLE household_member_invitations (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  id text NOT NULL,
  invited_by_person_id text NOT NULL,
  intended_identity_id text NOT NULL,
  intended_person_id text NOT NULL,
  intended_identity_issuer text NOT NULL,
  intended_identity_subject text NOT NULL,
  invitee_display_name text NOT NULL CHECK (char_length(invitee_display_name) BETWEEN 1 AND 120),
  recipient_code_id text NOT NULL REFERENCES trusted_circle_recipient_codes(id),
  invitation_code_fingerprint text NOT NULL,
  fingerprint_key_version integer NOT NULL CHECK (fingerprint_key_version > 0),
  preview_version text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  accepted_membership_id text,
  accepted_by_person_id text,
  accepted_identity_id text,
  accepted_at timestamptz,
  revoked_by_person_id text,
  revoked_at timestamptz,
  expired_at timestamptz,
  PRIMARY KEY (household_id, id),
  FOREIGN KEY (household_id, invited_by_person_id)
    REFERENCES household_memberships(household_id, person_id),
  FOREIGN KEY (
    intended_identity_id, intended_person_id,
    intended_identity_issuer, intended_identity_subject
  ) REFERENCES identities(id, person_id, issuer, subject),
  FOREIGN KEY (recipient_code_id, intended_identity_id, intended_person_id)
    REFERENCES trusted_circle_recipient_codes(id, identity_id, person_id),
  FOREIGN KEY (household_id, accepted_membership_id, accepted_by_person_id)
    REFERENCES household_memberships(household_id, id, person_id),
  FOREIGN KEY (
    accepted_identity_id, accepted_by_person_id,
    intended_identity_issuer, intended_identity_subject
  ) REFERENCES identities(id, person_id, issuer, subject),
  FOREIGN KEY (revoked_by_person_id) REFERENCES persons(id),
  CHECK (
    (state = 'pending'
      AND accepted_membership_id IS NULL
      AND accepted_by_person_id IS NULL
      AND accepted_identity_id IS NULL
      AND accepted_at IS NULL
      AND revoked_by_person_id IS NULL
      AND revoked_at IS NULL
      AND expired_at IS NULL)
    OR (state = 'accepted'
      AND accepted_membership_id IS NOT NULL
      AND accepted_by_person_id = intended_person_id
      AND accepted_identity_id = intended_identity_id
      AND accepted_at IS NOT NULL
      AND revoked_by_person_id IS NULL
      AND revoked_at IS NULL
      AND expired_at IS NULL)
    OR (state = 'revoked'
      AND accepted_membership_id IS NULL
      AND accepted_by_person_id IS NULL
      AND accepted_identity_id IS NULL
      AND accepted_at IS NULL
      AND revoked_by_person_id IS NOT NULL
      AND revoked_at IS NOT NULL
      AND expired_at IS NULL)
    OR (state = 'expired'
      AND accepted_membership_id IS NULL
      AND accepted_by_person_id IS NULL
      AND accepted_identity_id IS NULL
      AND accepted_at IS NULL
      AND revoked_by_person_id IS NULL
      AND revoked_at IS NULL
      AND expired_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX household_member_invitations_one_pending_recipient
  ON household_member_invitations(household_id, intended_person_id)
  WHERE state = 'pending';

CREATE UNIQUE INDEX household_member_invitations_fingerprint_unique
  ON household_member_invitations(fingerprint_key_version, invitation_code_fingerprint);

CREATE UNIQUE INDEX household_member_invitations_recipient_code_unique
  ON household_member_invitations(recipient_code_id);

CREATE FUNCTION enforce_household_member_invitation_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.household_id IS DISTINCT FROM OLD.household_id
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.invited_by_person_id IS DISTINCT FROM OLD.invited_by_person_id
    OR NEW.intended_identity_id IS DISTINCT FROM OLD.intended_identity_id
    OR NEW.intended_person_id IS DISTINCT FROM OLD.intended_person_id
    OR NEW.intended_identity_issuer IS DISTINCT FROM OLD.intended_identity_issuer
    OR NEW.intended_identity_subject IS DISTINCT FROM OLD.intended_identity_subject
    OR NEW.invitee_display_name IS DISTINCT FROM OLD.invitee_display_name
    OR NEW.recipient_code_id IS DISTINCT FROM OLD.recipient_code_id
    OR NEW.invitation_code_fingerprint IS DISTINCT FROM OLD.invitation_code_fingerprint
    OR NEW.fingerprint_key_version IS DISTINCT FROM OLD.fingerprint_key_version
    OR NEW.preview_version IS DISTINCT FROM OLD.preview_version
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Household member invitation identity evidence is immutable';
  END IF;
  IF OLD.state <> 'pending' OR NEW.state NOT IN ('accepted', 'revoked', 'expired') THEN
    RAISE EXCEPTION 'Household member invitation lifecycle cannot regress';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER household_member_invitations_monotonic
BEFORE UPDATE ON household_member_invitations
FOR EACH ROW EXECUTE FUNCTION enforce_household_member_invitation_lifecycle();

CREATE FUNCTION enforce_recipient_code_monotonic_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.identity_id IS DISTINCT FROM OLD.identity_id
    OR NEW.person_id IS DISTINCT FROM OLD.person_id
    OR NEW.code_fingerprint IS DISTINCT FROM OLD.code_fingerprint
    OR NEW.fingerprint_key_version IS DISTINCT FROM OLD.fingerprint_key_version
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Trusted Circle recipient code identity evidence is immutable';
  END IF;
  IF OLD.state <> 'active' OR NEW.state NOT IN ('consumed', 'rotated') THEN
    RAISE EXCEPTION 'Trusted Circle recipient code lifecycle cannot regress';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trusted_circle_recipient_codes_monotonic
BEFORE UPDATE ON trusted_circle_recipient_codes
FOR EACH ROW EXECUTE FUNCTION enforce_recipient_code_monotonic_lifecycle();

ALTER TABLE check_shares
  ADD COLUMN lifecycle_state text NOT NULL DEFAULT 'shared'
    CHECK (lifecycle_state IN ('shared', 'acknowledged', 'closed')),
  ADD COLUMN acknowledged_by_person_id text,
  ADD COLUMN acknowledged_at timestamptz,
  ADD COLUMN closed_by_person_id text,
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN closure_reason text
    CHECK (closure_reason IN ('safer_action_completed', 'no_longer_needs_help')),
  ADD CONSTRAINT check_shares_acknowledgement_pair
    CHECK ((acknowledged_by_person_id IS NULL) = (acknowledged_at IS NULL)),
  ADD CONSTRAINT check_shares_exact_acknowledgement_actor
    CHECK (
      acknowledged_by_person_id IS NULL
      OR acknowledged_by_person_id = shared_with_person_id
    ),
  ADD CONSTRAINT check_shares_exact_closure_actor
    CHECK (closed_by_person_id IS NULL OR closed_by_person_id = shared_by_person_id),
  ADD CONSTRAINT check_shares_closure_fields
    CHECK (
      (lifecycle_state = 'shared'
        AND acknowledged_by_person_id IS NULL
        AND closed_by_person_id IS NULL
        AND closed_at IS NULL
        AND closure_reason IS NULL)
      OR (lifecycle_state = 'acknowledged'
        AND acknowledged_by_person_id IS NOT NULL
        AND acknowledged_at IS NOT NULL
        AND closed_by_person_id IS NULL
        AND closed_at IS NULL
        AND closure_reason IS NULL)
      OR (lifecycle_state = 'closed'
        AND acknowledged_by_person_id IS NOT NULL
        AND acknowledged_at IS NOT NULL
        AND closed_by_person_id IS NOT NULL
        AND closed_at IS NOT NULL
        AND closure_reason IS NOT NULL)
    ),
  ADD CONSTRAINT check_shares_acknowledged_member_fk
    FOREIGN KEY (household_id, acknowledged_by_person_id)
    REFERENCES household_memberships(household_id, person_id),
  ADD CONSTRAINT check_shares_closed_member_fk
    FOREIGN KEY (household_id, closed_by_person_id)
    REFERENCES household_memberships(household_id, person_id);

CREATE FUNCTION enforce_check_share_monotonic_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.household_id IS DISTINCT FROM OLD.household_id
    OR NEW.analysis_id IS DISTINCT FROM OLD.analysis_id
    OR NEW.relationship_id IS DISTINCT FROM OLD.relationship_id
    OR NEW.shared_with_person_id IS DISTINCT FROM OLD.shared_with_person_id
    OR NEW.shared_by_person_id IS DISTINCT FROM OLD.shared_by_person_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Check share identity evidence is immutable';
  END IF;
  IF (OLD.lifecycle_state = 'shared' AND NEW.lifecycle_state NOT IN ('shared', 'acknowledged'))
    OR (OLD.lifecycle_state = 'acknowledged'
      AND NEW.lifecycle_state NOT IN ('acknowledged', 'closed'))
    OR (OLD.lifecycle_state = 'closed' AND NEW.lifecycle_state <> 'closed') THEN
    RAISE EXCEPTION 'Check share lifecycle cannot regress or skip acknowledgement';
  END IF;
  IF OLD.acknowledged_by_person_id IS NOT NULL
    AND (NEW.acknowledged_by_person_id IS DISTINCT FROM OLD.acknowledged_by_person_id
      OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at) THEN
    RAISE EXCEPTION 'Check share acknowledgement evidence is immutable';
  END IF;
  IF OLD.closed_by_person_id IS NOT NULL
    AND (NEW.closed_by_person_id IS DISTINCT FROM OLD.closed_by_person_id
      OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
      OR NEW.closure_reason IS DISTINCT FROM OLD.closure_reason) THEN
    RAISE EXCEPTION 'Check share closure evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER check_shares_monotonic_lifecycle
BEFORE UPDATE ON check_shares
FOR EACH ROW EXECUTE FUNCTION enforce_check_share_monotonic_lifecycle();

CREATE TABLE check_share_lifecycle_events (
  id text PRIMARY KEY,
  household_id text NOT NULL,
  analysis_id text NOT NULL,
  shared_with_person_id text NOT NULL,
  actor_person_id text NOT NULL,
  event_kind text NOT NULL CHECK (event_kind IN ('shared', 'acknowledged', 'closed')),
  state_after text NOT NULL CHECK (state_after IN ('shared', 'acknowledged', 'closed')),
  closure_reason text
    CHECK (closure_reason IN ('safer_action_completed', 'no_longer_needs_help')),
  created_at timestamptz NOT NULL,
  UNIQUE (household_id, analysis_id, shared_with_person_id, event_kind),
  FOREIGN KEY (household_id, analysis_id, shared_with_person_id)
    REFERENCES check_shares(household_id, analysis_id, shared_with_person_id)
    ON DELETE CASCADE,
  FOREIGN KEY (household_id, actor_person_id)
    REFERENCES household_memberships(household_id, person_id),
  CHECK (
    (event_kind = 'closed' AND state_after = 'closed' AND closure_reason IS NOT NULL)
    OR (event_kind <> 'closed' AND event_kind = state_after AND closure_reason IS NULL)
  )
);

INSERT INTO check_share_lifecycle_events(
  id, household_id, analysis_id, shared_with_person_id, actor_person_id,
  event_kind, state_after, closure_reason, created_at
)
SELECT
  'share_event_backfill_' || md5(
    share.household_id || ':' || share.analysis_id || ':' || share.shared_with_person_id
  ),
  share.household_id,
  share.analysis_id,
  share.shared_with_person_id,
  share.shared_by_person_id,
  'shared',
  'shared',
  NULL,
  share.created_at
FROM check_shares share
ON CONFLICT (household_id, analysis_id, shared_with_person_id, event_kind) DO NOTHING;

CREATE FUNCTION enforce_check_share_lifecycle_event_actor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_actor_person_id text;
  current_lifecycle_state text;
  current_closure_reason text;
BEGIN
  SELECT
    CASE
      WHEN NEW.event_kind = 'acknowledged' THEN share.shared_with_person_id
      ELSE share.shared_by_person_id
    END,
    share.lifecycle_state,
    share.closure_reason
  INTO expected_actor_person_id, current_lifecycle_state, current_closure_reason
  FROM check_shares share
  WHERE share.household_id = NEW.household_id
    AND share.analysis_id = NEW.analysis_id
    AND share.shared_with_person_id = NEW.shared_with_person_id;

  IF expected_actor_person_id IS NULL
    OR NEW.actor_person_id IS DISTINCT FROM expected_actor_person_id THEN
    RAISE EXCEPTION 'Check share lifecycle event actor must match the exact participant';
  END IF;
  IF (NEW.event_kind = 'shared' AND NEW.created_at IS DISTINCT FROM (
        SELECT share.created_at FROM check_shares share
        WHERE share.household_id = NEW.household_id
          AND share.analysis_id = NEW.analysis_id
          AND share.shared_with_person_id = NEW.shared_with_person_id
      ))
    OR (NEW.event_kind = 'acknowledged'
      AND current_lifecycle_state NOT IN ('acknowledged', 'closed'))
    OR (NEW.event_kind = 'closed'
      AND (current_lifecycle_state <> 'closed'
        OR NEW.closure_reason IS DISTINCT FROM current_closure_reason)) THEN
    RAISE EXCEPTION 'Check share lifecycle event does not match the retained share state';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER check_share_lifecycle_events_exact_actor
BEFORE INSERT OR UPDATE ON check_share_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION enforce_check_share_lifecycle_event_actor();

CREATE FUNCTION prevent_check_share_lifecycle_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Check share lifecycle events are append-only';
END;
$$;

CREATE TRIGGER check_share_lifecycle_events_append_only
BEFORE UPDATE OR DELETE ON check_share_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION prevent_check_share_lifecycle_event_mutation();
