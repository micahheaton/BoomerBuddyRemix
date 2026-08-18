ALTER TABLE identities
  ADD CONSTRAINT identities_exact_binding_unique
  UNIQUE (id, person_id, issuer, subject);

ALTER TABLE household_memberships
  ADD CONSTRAINT household_memberships_exact_identity_unique
  UNIQUE (household_id, id, person_id);

ALTER TABLE employee_assignments
  ADD CONSTRAINT employee_assignments_exact_owner_unique
  UNIQUE (id, person_id, organization_id, role);

ALTER TABLE organizations
  ADD CONSTRAINT organizations_exact_verification_unique
  UNIQUE (id, kind, verification_state);

ALTER TABLE sessions
  ADD COLUMN identity_id text,
  ADD COLUMN identity_subject text,
  ADD COLUMN provider_session_id text,
  ADD COLUMN last_verified_at timestamptz;

UPDATE sessions session
SET identity_id = (
      SELECT identity.id
      FROM identities identity
      WHERE identity.person_id = session.person_id AND identity.issuer = session.issuer
      ORDER BY identity.id LIMIT 1
    ),
    identity_subject = (
      SELECT identity.subject
      FROM identities identity
      WHERE identity.person_id = session.person_id AND identity.issuer = session.issuer
      ORDER BY identity.id LIMIT 1
    ),
    provider_session_id = session.id,
    last_verified_at = session.issued_at;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sessions
    WHERE identity_id IS NULL OR identity_subject IS NULL
      OR provider_session_id IS NULL OR last_verified_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Existing sessions cannot be bound to an exact identity';
  END IF;
END;
$$;

ALTER TABLE sessions
  ALTER COLUMN identity_id SET NOT NULL,
  ALTER COLUMN identity_subject SET NOT NULL,
  ALTER COLUMN provider_session_id SET NOT NULL,
  ALTER COLUMN last_verified_at SET NOT NULL,
  ADD CONSTRAINT sessions_exact_identity_fk
    FOREIGN KEY (identity_id, person_id, issuer, identity_subject)
    REFERENCES identities(id, person_id, issuer, subject) ON DELETE RESTRICT,
  ADD CONSTRAINT sessions_provider_identity_unique
    UNIQUE (issuer, provider_session_id),
  ADD CONSTRAINT sessions_exact_revocation_binding_unique
    UNIQUE (id, issuer, provider_session_id, identity_id);

CREATE INDEX sessions_exact_identity_audience_idx
  ON sessions(identity_id, audience, expires_at DESC);

CREATE TABLE provider_session_revocations (
  issuer text NOT NULL,
  provider_session_id text NOT NULL,
  identity_id text NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  session_id text NOT NULL UNIQUE,
  revoked_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (reason IN ('local_logout', 'administrative')),
  PRIMARY KEY (issuer, provider_session_id),
  CONSTRAINT provider_session_revocations_exact_session_fk
    FOREIGN KEY (session_id, issuer, provider_session_id, identity_id)
    REFERENCES sessions(id, issuer, provider_session_id, identity_id) ON DELETE RESTRICT
);

CREATE TABLE production_identity_bootstrap_mutex (
  singleton text PRIMARY KEY CHECK (singleton = 'production-identity-v1'),
  created_at timestamptz NOT NULL
);

INSERT INTO production_identity_bootstrap_mutex(singleton, created_at)
VALUES ('production-identity-v1', transaction_timestamp());

CREATE TABLE production_customer_bootstraps (
  identity_id text PRIMARY KEY,
  issuer text NOT NULL,
  subject text NOT NULL,
  person_id text NOT NULL UNIQUE REFERENCES persons(id) ON DELETE RESTRICT,
  household_id text NOT NULL UNIQUE REFERENCES households(id) ON DELETE RESTRICT,
  membership_id text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT production_customer_bootstrap_identity_fk
    FOREIGN KEY (identity_id, person_id, issuer, subject)
    REFERENCES identities(id, person_id, issuer, subject) ON DELETE RESTRICT,
  CONSTRAINT production_customer_bootstrap_membership_fk
    FOREIGN KEY (household_id, membership_id, person_id)
    REFERENCES household_memberships(household_id, id, person_id) ON DELETE RESTRICT,
  CONSTRAINT production_customer_bootstrap_issuer_subject_unique UNIQUE (issuer, subject)
);

CREATE TABLE production_founder_bootstraps (
  bootstrap_key text PRIMARY KEY CHECK (bootstrap_key = 'production-founder-v1'),
  identity_id text NOT NULL UNIQUE,
  issuer text NOT NULL,
  subject text NOT NULL,
  person_id text NOT NULL UNIQUE REFERENCES persons(id) ON DELETE RESTRICT,
  organization_id text NOT NULL UNIQUE,
  organization_kind text NOT NULL CHECK (organization_kind = 'internal'),
  organization_verification_state text NOT NULL CHECK (organization_verification_state = 'verified'),
  employee_assignment_id text NOT NULL UNIQUE,
  employee_role text NOT NULL CHECK (employee_role = 'hq_owner'),
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT production_founder_bootstrap_identity_fk
    FOREIGN KEY (identity_id, person_id, issuer, subject)
    REFERENCES identities(id, person_id, issuer, subject) ON DELETE RESTRICT,
  CONSTRAINT production_founder_bootstrap_organization_fk
    FOREIGN KEY (organization_id, organization_kind, organization_verification_state)
    REFERENCES organizations(id, kind, verification_state) ON DELETE RESTRICT,
  CONSTRAINT production_founder_bootstrap_assignment_fk
    FOREIGN KEY (employee_assignment_id, person_id, organization_id, employee_role)
    REFERENCES employee_assignments(id, person_id, organization_id, role) ON DELETE RESTRICT
);

CREATE FUNCTION prevent_production_identity_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Production identity bootstrap and revocation evidence is immutable';
END;
$$;

CREATE TRIGGER provider_session_revocations_immutable
BEFORE UPDATE OR DELETE ON provider_session_revocations
FOR EACH ROW EXECUTE FUNCTION prevent_production_identity_evidence_mutation();

CREATE TRIGGER production_identity_bootstrap_mutex_immutable
BEFORE UPDATE OR DELETE ON production_identity_bootstrap_mutex
FOR EACH ROW EXECUTE FUNCTION prevent_production_identity_evidence_mutation();

CREATE TRIGGER production_customer_bootstraps_immutable
BEFORE UPDATE OR DELETE ON production_customer_bootstraps
FOR EACH ROW EXECUTE FUNCTION prevent_production_identity_evidence_mutation();

CREATE TRIGGER production_founder_bootstraps_immutable
BEFORE UPDATE OR DELETE ON production_founder_bootstraps
FOR EACH ROW EXECUTE FUNCTION prevent_production_identity_evidence_mutation();
