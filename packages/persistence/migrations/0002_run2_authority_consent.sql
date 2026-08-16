CREATE TABLE household_administrator_assignments (
  household_id text NOT NULL,
  person_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
  granted_by_person_id text NOT NULL,
  granted_at timestamptz NOT NULL,
  suspended_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (household_id, person_id),
  FOREIGN KEY (household_id, person_id)
    REFERENCES household_memberships(household_id, person_id),
  FOREIGN KEY (household_id, granted_by_person_id)
    REFERENCES household_memberships(household_id, person_id),
  CHECK (
    (status = 'active' AND suspended_at IS NULL AND revoked_at IS NULL)
    OR (status = 'suspended' AND suspended_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE TABLE household_payers (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('legacy_subscription', 'local', 'provider', 'support')),
  status text NOT NULL CHECK (status IN ('active', 'ended')),
  effective_at timestamptz NOT NULL,
  ended_at timestamptz,
  PRIMARY KEY (household_id, person_id),
  CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR (status = 'ended' AND ended_at IS NOT NULL)
  )
);

CREATE TABLE household_billing_authorities (
  household_id text NOT NULL,
  person_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
  granted_by_person_id text NOT NULL,
  granted_at timestamptz NOT NULL,
  suspended_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (household_id, person_id),
  FOREIGN KEY (household_id, person_id)
    REFERENCES household_memberships(household_id, person_id),
  FOREIGN KEY (household_id, granted_by_person_id)
    REFERENCES household_memberships(household_id, person_id),
  CHECK (
    (status = 'active' AND suspended_at IS NULL AND revoked_at IS NULL)
    OR (status = 'suspended' AND suspended_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

INSERT INTO household_administrator_assignments(
  household_id, person_id, status, granted_by_person_id, granted_at
)
SELECT household_id, person_id, 'active', person_id, created_at
FROM household_memberships
WHERE role = 'household_owner';

INSERT INTO household_billing_authorities(
  household_id, person_id, status, granted_by_person_id, granted_at
)
SELECT household_id, person_id, 'active', person_id, created_at
FROM household_memberships
WHERE role = 'household_owner';

INSERT INTO household_payers(household_id, person_id, source, status, effective_at)
SELECT s.household_id, s.payer_person_id, 'legacy_subscription', 'active', min(s.created_at)
FROM commerce_subscriptions s
WHERE s.payer_person_id IS NOT NULL
GROUP BY s.household_id, s.payer_person_id;

ALTER TABLE household_memberships
  DROP CONSTRAINT household_memberships_role_check;
ALTER TABLE household_memberships RENAME COLUMN role TO membership_kind;
UPDATE household_memberships SET membership_kind = 'member';
ALTER TABLE household_memberships
  ADD CONSTRAINT household_memberships_kind_check CHECK (membership_kind = 'member');
ALTER TABLE household_memberships DROP COLUMN permissions;

ALTER TABLE invitations
  DROP CONSTRAINT invitations_state_check;
ALTER TABLE invitations
  ADD CONSTRAINT invitations_state_check
  CHECK (state IN ('pending', 'accepted', 'expired', 'revoked', 'withdrawn'));
ALTER TABLE invitations
  ADD COLUMN identity_binding_state text NOT NULL DEFAULT 'development_unbound'
    CHECK (identity_binding_state IN ('development_unbound', 'verified_identity')),
  ADD COLUMN intended_identity_issuer text,
  ADD COLUMN intended_identity_subject text,
  ADD COLUMN accepted_identity_id text REFERENCES identities(id),
  ADD COLUMN accepted_identity_issuer text,
  ADD COLUMN accepted_identity_subject text,
  ADD COLUMN ended_by_person_id text REFERENCES persons(id),
  ADD COLUMN ended_action text
    CHECK (ended_action IN ('withdraw', 'revoke', 'expire'));

UPDATE invitations i
SET accepted_identity_id = (
      SELECT identity.id FROM identities identity
      WHERE identity.person_id = i.accepted_by_person_id
      ORDER BY identity.created_at, identity.id LIMIT 1
    ),
    accepted_identity_issuer = (
      SELECT identity.issuer FROM identities identity
      WHERE identity.person_id = i.accepted_by_person_id
      ORDER BY identity.created_at, identity.id LIMIT 1
    ),
    accepted_identity_subject = (
      SELECT identity.subject FROM identities identity
      WHERE identity.person_id = i.accepted_by_person_id
      ORDER BY identity.created_at, identity.id LIMIT 1
    )
WHERE i.state = 'accepted';

ALTER TABLE invitations
  ADD CONSTRAINT invitations_identity_binding_check CHECK (
    (
      identity_binding_state = 'development_unbound'
      AND intended_identity_issuer IS NULL
      AND intended_identity_subject IS NULL
    )
    OR (
      identity_binding_state = 'verified_identity'
      AND intended_identity_issuer IS NOT NULL
      AND intended_identity_subject IS NOT NULL
      AND intended_identity_issuer <> 'boomerbuddy-dev'
    )
  ),
  ADD CONSTRAINT invitations_acceptance_identity_check CHECK (
    (
      state = 'accepted'
      AND accepted_by_person_id IS NOT NULL
      AND accepted_at IS NOT NULL
      AND accepted_identity_id IS NOT NULL
      AND accepted_identity_issuer IS NOT NULL
      AND accepted_identity_subject IS NOT NULL
    )
    OR state <> 'accepted'
  ),
  ADD CONSTRAINT invitations_verified_acceptance_check CHECK (
    identity_binding_state <> 'verified_identity'
    OR state <> 'accepted'
    OR (
      accepted_identity_issuer = intended_identity_issuer
      AND accepted_identity_subject = intended_identity_subject
    )
  );

ALTER TABLE trusted_circle_relationships
  DROP CONSTRAINT trusted_circle_relationships_state_check;
ALTER TABLE trusted_circle_relationships
  ADD CONSTRAINT trusted_circle_relationships_state_check
  CHECK (state IN ('active', 'withdrawn', 'relinquished', 'suspended', 'revoked')),
  ADD COLUMN ended_by_person_id text REFERENCES persons(id),
  ADD COLUMN ended_action text
    CHECK (ended_action IN ('withdraw', 'relinquish', 'suspend', 'legacy_revoke')),
  ADD COLUMN ended_at timestamptz;

UPDATE trusted_circle_relationships
SET ended_action = 'legacy_revoke', ended_at = revoked_at
WHERE state = 'revoked';

UPDATE consents
SET purpose = 'trusted_circle_relationship'
WHERE purpose = 'trusted_circle';

INSERT INTO consents(
  household_id, id, protected_person_id, granted_by_person_id, purpose,
  consent_version, state, granted_at, revoked_at
)
SELECT
  p.household_id,
  'consent-protected-' || p.household_id || '-' || p.person_id,
  p.person_id,
  p.consented_by_person_id,
  'protected_enrollment',
  p.consent_version,
  CASE WHEN p.status = 'revoked' THEN 'revoked' ELSE 'active' END,
  COALESCE(p.accepted_at, p.deferred_at, p.created_at),
  p.revoked_at
FROM protected_members p
ON CONFLICT (household_id, id) DO NOTHING;

ALTER TABLE protected_members ADD COLUMN consent_id text;
UPDATE protected_members
SET consent_id = 'consent-protected-' || household_id || '-' || person_id;
ALTER TABLE protected_members ALTER COLUMN consent_id SET NOT NULL;
ALTER TABLE protected_members
  ADD CONSTRAINT protected_members_consent_fk
  FOREIGN KEY (household_id, consent_id) REFERENCES consents(household_id, id);

CREATE TABLE consent_evidence (
  household_id text NOT NULL,
  id text NOT NULL,
  consent_id text NOT NULL,
  actor_person_id text NOT NULL,
  subject_person_id text NOT NULL,
  recipient_person_id text,
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 80),
  scope jsonb NOT NULL,
  action text NOT NULL CHECK (action IN (
    'propose', 'accept', 'expand', 'narrow', 'withdraw', 'relinquish',
    'suspend', 'reactivate', 'revoke', 'expire', 'defer'
  )),
  disclosure_version text NOT NULL CHECK (char_length(disclosure_version) BETWEEN 1 AND 120),
  disclosure_digest text NOT NULL CHECK (char_length(disclosure_digest) = 64),
  policy_version text NOT NULL CHECK (char_length(policy_version) BETWEEN 1 AND 120),
  policy_digest text NOT NULL CHECK (char_length(policy_digest) = 64),
  source_interaction text NOT NULL CHECK (char_length(source_interaction) BETWEEN 1 AND 120),
  session_id text REFERENCES sessions(id),
  actor_identity_id text REFERENCES identities(id),
  actor_identity_issuer text,
  actor_identity_subject text,
  assurance text NOT NULL CHECK (assurance IN ('legacy_unverified', 'development', 'verified')),
  effective_at timestamptz NOT NULL,
  expires_at timestamptz,
  recorded_at timestamptz NOT NULL,
  supersedes_evidence_id text,
  correlation_id text,
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, consent_id, id),
  FOREIGN KEY (household_id, consent_id) REFERENCES consents(household_id, id),
  FOREIGN KEY (household_id, actor_person_id)
    REFERENCES household_memberships(household_id, person_id),
  FOREIGN KEY (household_id, subject_person_id)
    REFERENCES household_memberships(household_id, person_id),
  FOREIGN KEY (household_id, recipient_person_id)
    REFERENCES household_memberships(household_id, person_id),
  FOREIGN KEY (household_id, supersedes_evidence_id)
    REFERENCES consent_evidence(household_id, id),
  CHECK (expires_at IS NULL OR expires_at > effective_at),
  CHECK (
    (actor_identity_id IS NULL AND actor_identity_issuer IS NULL AND actor_identity_subject IS NULL)
    OR (
      actor_identity_id IS NOT NULL
      AND actor_identity_issuer IS NOT NULL
      AND actor_identity_subject IS NOT NULL
    )
  )
);

CREATE INDEX consent_evidence_consent_recorded_idx
  ON consent_evidence(household_id, consent_id, recorded_at, id);

CREATE TABLE consent_current_projections (
  household_id text NOT NULL,
  consent_id text NOT NULL,
  latest_evidence_id text NOT NULL,
  actor_person_id text NOT NULL,
  subject_person_id text NOT NULL,
  recipient_person_id text,
  purpose text NOT NULL,
  scope jsonb NOT NULL,
  state text NOT NULL CHECK (state IN (
    'proposed', 'active', 'deferred', 'withdrawn', 'relinquished',
    'suspended', 'revoked', 'expired'
  )),
  effective_at timestamptz NOT NULL,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, consent_id),
  FOREIGN KEY (household_id, consent_id) REFERENCES consents(household_id, id),
  FOREIGN KEY (household_id, consent_id, latest_evidence_id)
    REFERENCES consent_evidence(household_id, consent_id, id),
  FOREIGN KEY (household_id, actor_person_id)
    REFERENCES household_memberships(household_id, person_id),
  FOREIGN KEY (household_id, subject_person_id)
    REFERENCES household_memberships(household_id, person_id),
  FOREIGN KEY (household_id, recipient_person_id)
    REFERENCES household_memberships(household_id, person_id),
  CHECK (expires_at IS NULL OR expires_at > effective_at)
);

INSERT INTO consent_evidence(
  household_id, id, consent_id, actor_person_id, subject_person_id,
  recipient_person_id, purpose, scope, action, disclosure_version,
  disclosure_digest, policy_version, policy_digest, source_interaction,
  assurance, effective_at, expires_at, recorded_at
)
SELECT
  c.household_id,
  'evidence-migrated-' || c.id,
  c.id,
  c.granted_by_person_id,
  c.protected_person_id,
  (
    SELECT t.trusted_person_id
    FROM trusted_circle_relationships t
    WHERE t.household_id = c.household_id AND t.consent_id = c.id
    ORDER BY t.created_at, t.id
    LIMIT 1
  ),
  c.purpose,
  jsonb_build_object('legacy', true),
  CASE
    WHEN c.state = 'revoked' THEN 'revoke'
    WHEN EXISTS (
      SELECT 1 FROM invitations i
      WHERE i.household_id = c.household_id AND i.consent_id = c.id AND i.state = 'pending'
    ) THEN 'propose'
    ELSE 'accept'
  END,
  'legacy-unavailable',
  repeat('0', 64),
  c.consent_version,
  repeat('0', 64),
  'run2_migration',
  'legacy_unverified',
  c.granted_at,
  NULL,
  COALESCE(c.revoked_at, c.granted_at)
FROM consents c;

INSERT INTO consent_current_projections(
  household_id, consent_id, latest_evidence_id, actor_person_id,
  subject_person_id, recipient_person_id, purpose, scope, state,
  effective_at, expires_at, updated_at
)
SELECT
  e.household_id,
  e.consent_id,
  e.id,
  e.actor_person_id,
  e.subject_person_id,
  e.recipient_person_id,
  e.purpose,
  e.scope,
  CASE e.action
    WHEN 'propose' THEN 'proposed'
    WHEN 'revoke' THEN 'revoked'
    ELSE 'active'
  END,
  e.effective_at,
  e.expires_at,
  e.recorded_at
FROM consent_evidence e;

ALTER TABLE invitations ADD COLUMN latest_consent_evidence_id text;
UPDATE invitations i
SET latest_consent_evidence_id = p.latest_evidence_id
FROM consent_current_projections p
WHERE p.household_id = i.household_id AND p.consent_id = i.consent_id;
ALTER TABLE invitations ALTER COLUMN latest_consent_evidence_id SET NOT NULL;
ALTER TABLE invitations
  ADD CONSTRAINT invitations_latest_consent_evidence_fk
  FOREIGN KEY (household_id, consent_id, latest_consent_evidence_id)
  REFERENCES consent_evidence(household_id, consent_id, id);

ALTER TABLE trusted_circle_relationships ADD COLUMN latest_consent_evidence_id text;
UPDATE trusted_circle_relationships t
SET latest_consent_evidence_id = p.latest_evidence_id
FROM consent_current_projections p
WHERE p.household_id = t.household_id AND p.consent_id = t.consent_id;
ALTER TABLE trusted_circle_relationships ALTER COLUMN latest_consent_evidence_id SET NOT NULL;
ALTER TABLE trusted_circle_relationships
  ADD CONSTRAINT trusted_relationship_latest_consent_evidence_fk
  FOREIGN KEY (household_id, consent_id, latest_consent_evidence_id)
  REFERENCES consent_evidence(household_id, consent_id, id);

ALTER TABLE protected_members ADD COLUMN latest_consent_evidence_id text;
UPDATE protected_members p
SET latest_consent_evidence_id = projection.latest_evidence_id
FROM consent_current_projections projection
WHERE projection.household_id = p.household_id AND projection.consent_id = p.consent_id;
ALTER TABLE protected_members ALTER COLUMN latest_consent_evidence_id SET NOT NULL;
ALTER TABLE protected_members
  ADD CONSTRAINT protected_members_latest_consent_evidence_fk
  FOREIGN KEY (household_id, consent_id, latest_consent_evidence_id)
  REFERENCES consent_evidence(household_id, consent_id, id);

CREATE FUNCTION reject_consent_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'consent evidence is append-only';
END;
$$;

CREATE TRIGGER consent_evidence_append_only
BEFORE UPDATE OR DELETE ON consent_evidence
FOR EACH ROW EXECUTE FUNCTION reject_consent_evidence_mutation();

CREATE FUNCTION reject_legacy_consent_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'consent origin records are immutable; append evidence instead';
END;
$$;

CREATE TRIGGER consent_origin_immutable
BEFORE UPDATE OR DELETE ON consents
FOR EACH ROW EXECUTE FUNCTION reject_legacy_consent_mutation();

CREATE FUNCTION require_relationship_evidence_advance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND (
      NEW.permissions IS DISTINCT FROM OLD.permissions
      OR NEW.state IS DISTINCT FROM OLD.state
      OR NEW.consent_id IS DISTINCT FROM OLD.consent_id
    )
    AND NEW.latest_consent_evidence_id IS NOT DISTINCT FROM OLD.latest_consent_evidence_id
  THEN
    RAISE EXCEPTION 'relationship authority changes require new consent evidence';
  END IF;
  IF TG_OP = 'UPDATE'
    AND (
      NEW.permissions IS DISTINCT FROM OLD.permissions
      OR NEW.state IS DISTINCT FROM OLD.state
      OR NEW.consent_id IS DISTINCT FROM OLD.consent_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM consent_current_projections projection
      JOIN consent_evidence evidence
        ON evidence.household_id = projection.household_id
       AND evidence.consent_id = projection.consent_id
       AND evidence.id = projection.latest_evidence_id
      WHERE projection.household_id = NEW.household_id
        AND projection.consent_id = NEW.consent_id
        AND projection.latest_evidence_id = NEW.latest_consent_evidence_id
        AND projection.subject_person_id = NEW.protected_person_id
        AND projection.recipient_person_id = NEW.trusted_person_id
        AND projection.scope -> 'permissions' = NEW.permissions
        AND projection.state = NEW.state
    )
  THEN
    RAISE EXCEPTION 'relationship authority must match current consent evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trusted_relationship_evidence_guard
BEFORE UPDATE ON trusted_circle_relationships
FOR EACH ROW EXECUTE FUNCTION require_relationship_evidence_advance();

CREATE FUNCTION require_invitation_evidence_advance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (
      NEW.permissions IS DISTINCT FROM OLD.permissions
      OR NEW.state IS DISTINCT FROM OLD.state
      OR NEW.identity_binding_state IS DISTINCT FROM OLD.identity_binding_state
      OR NEW.intended_identity_issuer IS DISTINCT FROM OLD.intended_identity_issuer
      OR NEW.intended_identity_subject IS DISTINCT FROM OLD.intended_identity_subject
      OR NEW.accepted_by_person_id IS DISTINCT FROM OLD.accepted_by_person_id
      OR NEW.accepted_identity_id IS DISTINCT FROM OLD.accepted_identity_id
      OR NEW.ended_by_person_id IS DISTINCT FROM OLD.ended_by_person_id
      OR NEW.ended_action IS DISTINCT FROM OLD.ended_action
    )
    AND NEW.latest_consent_evidence_id IS NOT DISTINCT FROM OLD.latest_consent_evidence_id
  THEN
    RAISE EXCEPTION 'invitation lifecycle changes require new consent evidence';
  END IF;
  IF (
      NEW.permissions IS DISTINCT FROM OLD.permissions
      OR NEW.state IS DISTINCT FROM OLD.state
      OR NEW.identity_binding_state IS DISTINCT FROM OLD.identity_binding_state
      OR NEW.intended_identity_issuer IS DISTINCT FROM OLD.intended_identity_issuer
      OR NEW.intended_identity_subject IS DISTINCT FROM OLD.intended_identity_subject
      OR NEW.accepted_by_person_id IS DISTINCT FROM OLD.accepted_by_person_id
      OR NEW.accepted_identity_id IS DISTINCT FROM OLD.accepted_identity_id
      OR NEW.ended_by_person_id IS DISTINCT FROM OLD.ended_by_person_id
      OR NEW.ended_action IS DISTINCT FROM OLD.ended_action
    )
    AND NOT EXISTS (
      SELECT 1
      FROM consent_current_projections projection
      WHERE projection.household_id = NEW.household_id
        AND projection.consent_id = NEW.consent_id
        AND projection.latest_evidence_id = NEW.latest_consent_evidence_id
        AND projection.subject_person_id = NEW.protected_person_id
        AND projection.scope -> 'permissions' = NEW.permissions
        AND (
          (NEW.state = 'pending' AND projection.state = 'proposed')
          OR (NEW.state = 'accepted' AND projection.state = 'active'
            AND projection.recipient_person_id = NEW.accepted_by_person_id)
          OR (NEW.state = 'withdrawn' AND projection.state = 'withdrawn')
          OR (NEW.state = 'revoked' AND projection.state = 'revoked')
          OR (NEW.state = 'expired' AND projection.state = 'expired')
        )
    )
  THEN
    RAISE EXCEPTION 'invitation lifecycle must match current consent evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invitation_evidence_guard
BEFORE UPDATE ON invitations
FOR EACH ROW EXECUTE FUNCTION require_invitation_evidence_advance();

CREATE FUNCTION require_protected_enrollment_evidence_advance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (
      NEW.status IS DISTINCT FROM OLD.status
      OR NEW.consent_id IS DISTINCT FROM OLD.consent_id
      OR NEW.consent_version IS DISTINCT FROM OLD.consent_version
    )
    AND NEW.latest_consent_evidence_id IS NOT DISTINCT FROM OLD.latest_consent_evidence_id
  THEN
    RAISE EXCEPTION 'protected enrollment changes require new consent evidence';
  END IF;
  IF (
      NEW.status IS DISTINCT FROM OLD.status
      OR NEW.consent_id IS DISTINCT FROM OLD.consent_id
      OR NEW.consent_version IS DISTINCT FROM OLD.consent_version
    )
    AND NOT EXISTS (
      SELECT 1
      FROM consent_current_projections projection
      WHERE projection.household_id = NEW.household_id
        AND projection.consent_id = NEW.consent_id
        AND projection.latest_evidence_id = NEW.latest_consent_evidence_id
        AND projection.subject_person_id = NEW.person_id
        AND projection.purpose = 'protected_enrollment'
        AND (
          (NEW.status = 'accepted' AND projection.state = 'active')
          OR (NEW.status = 'deferred' AND projection.state = 'deferred')
          OR (NEW.status = 'revoked' AND projection.state IN ('withdrawn', 'revoked'))
        )
    )
  THEN
    RAISE EXCEPTION 'protected enrollment must match current consent evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protected_enrollment_evidence_guard
BEFORE UPDATE ON protected_members
FOR EACH ROW EXECUTE FUNCTION require_protected_enrollment_evidence_advance();

CREATE TABLE support_cases (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  id text NOT NULL,
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 160),
  status text NOT NULL CHECK (status IN ('open', 'resolved', 'closed')),
  opened_by_person_id text NOT NULL REFERENCES persons(id),
  opened_at timestamptz NOT NULL,
  resolved_at timestamptz,
  closed_at timestamptz,
  PRIMARY KEY (household_id, id),
  CHECK (
    (status = 'open' AND resolved_at IS NULL AND closed_at IS NULL)
    OR (status = 'resolved' AND resolved_at IS NOT NULL AND closed_at IS NULL)
    OR (status = 'closed' AND closed_at IS NOT NULL)
  )
);

CREATE TABLE support_case_assignments (
  household_id text NOT NULL,
  case_id text NOT NULL,
  employee_assignment_id text NOT NULL REFERENCES employee_assignments(id),
  status text NOT NULL CHECK (status IN ('active', 'ended')),
  assigned_at timestamptz NOT NULL,
  ended_at timestamptz,
  PRIMARY KEY (household_id, case_id, employee_assignment_id),
  FOREIGN KEY (household_id, case_id) REFERENCES support_cases(household_id, id),
  CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR (status = 'ended' AND ended_at IS NOT NULL)
  )
);

CREATE TABLE restricted_access_grants (
  household_id text NOT NULL,
  id text NOT NULL,
  case_id text NOT NULL,
  employee_assignment_id text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('artifact', 'analysis', 'family')),
  resource_id text NOT NULL,
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 160),
  assurance text NOT NULL CHECK (assurance IN ('step_up_verified')),
  status text NOT NULL CHECK (status IN ('active', 'expired', 'revoked')),
  granted_by_person_id text NOT NULL REFERENCES persons(id),
  granted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (household_id, id),
  FOREIGN KEY (household_id, case_id, employee_assignment_id)
    REFERENCES support_case_assignments(household_id, case_id, employee_assignment_id),
  CHECK (expires_at > granted_at),
  CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status = 'expired')
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX restricted_access_active_lookup_idx
  ON restricted_access_grants(employee_assignment_id, household_id, case_id, expires_at)
  WHERE status = 'active';
