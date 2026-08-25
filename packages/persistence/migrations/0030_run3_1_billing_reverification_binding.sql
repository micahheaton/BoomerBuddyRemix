CREATE TABLE commerce_billing_reverification_mutex (
  mutex_key text PRIMARY KEY CHECK (mutex_key = 'global')
);

INSERT INTO commerce_billing_reverification_mutex(mutex_key) VALUES ('global');

CREATE TABLE commerce_billing_reverification_bindings (
  id text PRIMARY KEY,
  reverification_fingerprint text NOT NULL UNIQUE CHECK (
    reverification_fingerprint ~ '^[A-Za-z0-9_-]{43}$'
  ),
  binding_fingerprint text NOT NULL UNIQUE CHECK (
    binding_fingerprint ~ '^[A-Za-z0-9_-]{43}$'
  ),
  fingerprint_key_version integer NOT NULL CHECK (fingerprint_key_version = 1),
  person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  household_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('checkout', 'portal')),
  environment text NOT NULL CHECK (environment IN ('test', 'production')),
  server_operation_id text NOT NULL CHECK (
    server_operation_id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{15,159}$'
  ),
  offer_id text NOT NULL CHECK (
    offer_id IN ('founding_family_monthly_v1', 'cancel_only_portal_v1')
  ),
  amount_minor integer NOT NULL CHECK (amount_minor IN (0, 1499)),
  currency text NOT NULL CHECK (currency = 'usd'),
  factor_level text NOT NULL CHECK (factor_level = 'multi_factor'),
  effective_factor_age_seconds integer NOT NULL CHECK (
    effective_factor_age_seconds >= 0 AND effective_factor_age_seconds < 600
  ),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (household_id, person_id)
    REFERENCES household_memberships(household_id, person_id) ON DELETE RESTRICT,
  UNIQUE (environment, action, household_id, server_operation_id),
  CHECK (
    (action = 'checkout' AND offer_id = 'founding_family_monthly_v1'
      AND amount_minor = 1499)
    OR
    (action = 'portal' AND offer_id = 'cancel_only_portal_v1'
      AND amount_minor = 0)
  )
);

CREATE INDEX commerce_billing_reverification_person_idx
  ON commerce_billing_reverification_bindings(person_id, created_at DESC, id);

CREATE FUNCTION reject_billing_reverification_binding_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Billing reverification binding evidence is immutable';
END;
$$;

CREATE TRIGGER commerce_billing_reverification_mutex_immutable
BEFORE UPDATE OR DELETE ON commerce_billing_reverification_mutex
FOR EACH ROW EXECUTE FUNCTION reject_billing_reverification_binding_mutation();

CREATE TRIGGER commerce_billing_reverification_bindings_immutable
BEFORE UPDATE OR DELETE ON commerce_billing_reverification_bindings
FOR EACH ROW EXECUTE FUNCTION reject_billing_reverification_binding_mutation();
