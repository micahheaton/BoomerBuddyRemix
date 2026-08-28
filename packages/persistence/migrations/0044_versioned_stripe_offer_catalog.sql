-- Versioned Stripe offers, exact seven-day trial evidence, and durable reminder receipts.
-- This migration creates no provider resources and opens no runtime initiation control.

INSERT INTO commerce_plan_versions(
  id, product_version_id, plan_key, version, display_name, state,
  capabilities, allowances, prices, available_from, created_at
) VALUES
  (
    'family_v3', 'consumer_household_v1', 'family', 3, 'Family', 'active',
    '["check:text","check:url","history:read","family:manage","orientation:use"]'::jsonb,
    '[{"kind":"protected_members","limit":3},{"kind":"trusted_circle_participants","limit":6}]'::jsonb,
    '[{"interval":"month","amountMinor":1499,"currency":"USD","kind":"list"},{"interval":"year","amountMinor":14990,"currency":"USD","kind":"list"}]'::jsonb,
    '2026-08-15T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'individual_v3', 'consumer_household_v1', 'plus', 3, 'Individual', 'active',
    '["check:text","check:url","history:read","family:manage","orientation:use"]'::jsonb,
    '[{"kind":"protected_members","limit":1},{"kind":"trusted_circle_participants","limit":2}]'::jsonb,
    '[{"interval":"month","amountMinor":899,"currency":"USD","kind":"list"},{"interval":"year","amountMinor":8990,"currency":"USD","kind":"list"}]'::jsonb,
    '2026-08-15T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  )
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM commerce_plan_versions plan
    WHERE plan.id = 'family_v3'
      AND plan.product_version_id = 'consumer_household_v1'
      AND plan.plan_key = 'family' AND plan.version = 3
      AND plan.display_name = 'Family' AND plan.state = 'active'
      AND plan.prices =
        '[{"interval":"month","amountMinor":1499,"currency":"USD","kind":"list"},{"interval":"year","amountMinor":14990,"currency":"USD","kind":"list"}]'::jsonb
  ) OR NOT EXISTS (
    SELECT 1 FROM commerce_plan_versions plan
    WHERE plan.id = 'individual_v3'
      AND plan.product_version_id = 'consumer_household_v1'
      AND plan.plan_key = 'plus' AND plan.version = 3
      AND plan.display_name = 'Individual' AND plan.state = 'active'
      AND plan.prices =
        '[{"interval":"month","amountMinor":899,"currency":"USD","kind":"list"},{"interval":"year","amountMinor":8990,"currency":"USD","kind":"list"}]'::jsonb
  ) THEN
    RAISE EXCEPTION 'Versioned paid plan catalogue conflict';
  END IF;
END;
$$;

ALTER TABLE commerce_stripe_offer_contracts
  DROP CONSTRAINT commerce_stripe_offer_contracts_offer_id_check,
  DROP CONSTRAINT commerce_stripe_offer_contracts_plan_version_id_check,
  DROP CONSTRAINT commerce_stripe_offer_contracts_billing_interval_check,
  DROP CONSTRAINT commerce_stripe_offer_contracts_unit_amount_minor_check,
  ADD COLUMN plan_key text NOT NULL DEFAULT 'family',
  ADD COLUMN display_name text NOT NULL DEFAULT 'Family',
  ADD COLUMN trial_period_days integer NOT NULL DEFAULT 0,
  ADD COLUMN customer_selectable boolean NOT NULL DEFAULT false,
  ADD COLUMN default_acquisition_offer boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT commerce_stripe_offer_id_check CHECK (offer_id IN (
    'founding_family_monthly_v1', 'family_monthly_v2', 'family_annual_v2',
    'individual_monthly_v1', 'individual_annual_v1'
  )),
  ADD CONSTRAINT commerce_stripe_offer_plan_check CHECK (
    (offer_id = 'founding_family_monthly_v1' AND plan_version_id = 'family_v1'
      AND plan_key = 'family' AND display_name = 'Family'
      AND billing_interval = 'month' AND unit_amount_minor = 1499
      AND trial_period_days = 0 AND customer_selectable = false
      AND default_acquisition_offer = false)
    OR (offer_id = 'family_monthly_v2' AND plan_version_id = 'family_v3'
      AND plan_key = 'family' AND display_name = 'Family'
      AND billing_interval = 'month' AND unit_amount_minor = 1499
      AND trial_period_days = 0 AND customer_selectable = true
      AND default_acquisition_offer = false)
    OR (offer_id = 'family_annual_v2' AND plan_version_id = 'family_v3'
      AND plan_key = 'family' AND display_name = 'Family'
      AND billing_interval = 'year' AND unit_amount_minor = 14990
      AND trial_period_days = 7 AND customer_selectable = true
      AND default_acquisition_offer = true)
    OR (offer_id = 'individual_monthly_v1' AND plan_version_id = 'individual_v3'
      AND plan_key = 'individual' AND display_name = 'Individual'
      AND billing_interval = 'month' AND unit_amount_minor = 899
      AND trial_period_days = 0 AND customer_selectable = true
      AND default_acquisition_offer = false)
    OR (offer_id = 'individual_annual_v1' AND plan_version_id = 'individual_v3'
      AND plan_key = 'individual' AND display_name = 'Individual'
      AND billing_interval = 'year' AND unit_amount_minor = 8990
      AND trial_period_days = 7 AND customer_selectable = true
      AND default_acquisition_offer = false)
  ),
  ADD CONSTRAINT commerce_stripe_offer_policy_check CHECK (
    currency = 'usd' AND quantity = 1
    AND promotions_enabled = false AND automatic_tax_enabled = false
    AND adaptive_pricing_enabled = false
  );

ALTER TABLE commerce_stripe_offer_contracts
  ALTER COLUMN plan_key DROP DEFAULT,
  ALTER COLUMN display_name DROP DEFAULT,
  ALTER COLUMN trial_period_days DROP DEFAULT,
  ALTER COLUMN customer_selectable DROP DEFAULT,
  ALTER COLUMN default_acquisition_offer DROP DEFAULT;

INSERT INTO commerce_stripe_offer_contracts(
  offer_id, plan_version_id, plan_key, display_name, billing_interval, currency,
  unit_amount_minor, quantity, trial_period_days, customer_selectable,
  default_acquisition_offer, promotions_enabled, automatic_tax_enabled,
  adaptive_pricing_enabled, created_at
) VALUES
  ('family_monthly_v2','family_v3','family','Family','month','usd',1499,1,0,true,false,
    false,false,false,'2026-08-28T00:00:00.000Z'),
  ('family_annual_v2','family_v3','family','Family','year','usd',14990,1,7,true,true,
    false,false,false,'2026-08-28T00:00:00.000Z'),
  ('individual_monthly_v1','individual_v3','individual','Individual','month','usd',899,1,0,
    true,false,false,false,false,'2026-08-28T00:00:00.000Z'),
  ('individual_annual_v1','individual_v3','individual','Individual','year','usd',8990,1,7,true,
    false,false,false,false,'2026-08-28T00:00:00.000Z');

CREATE UNIQUE INDEX commerce_stripe_one_default_acquisition_offer_idx
  ON commerce_stripe_offer_contracts(default_acquisition_offer)
  WHERE default_acquisition_offer = true;

ALTER TABLE commerce_stripe_preflight_records
  DROP CONSTRAINT commerce_stripe_preflight_records_unit_amount_minor_check,
  DROP CONSTRAINT commerce_stripe_preflight_records_recurring_interval_check,
  ADD COLUMN trial_period_days integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT commerce_stripe_preflight_amount_check
    CHECK (unit_amount_minor IN (899,1499,8990,14990)),
  ADD CONSTRAINT commerce_stripe_preflight_interval_check
    CHECK (recurring_interval IN ('month','year')),
  ADD CONSTRAINT commerce_stripe_preflight_trial_check
    CHECK (trial_period_days IN (0,7));

ALTER TABLE commerce_stripe_preflight_records
  ALTER COLUMN trial_period_days DROP DEFAULT;

CREATE TABLE commerce_stripe_checkout_completions_v2 (
  provider_session_id text PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  household_id text NOT NULL,
  checkout_intent_id text NOT NULL,
  subscription_id text NOT NULL,
  provider_subscription_id text NOT NULL,
  provider_customer_id text NOT NULL,
  provider_payment_intent_id text,
  source_inbox_id text NOT NULL REFERENCES commerce_event_inbox(id) ON DELETE RESTRICT,
  provider_event_id text NOT NULL,
  offer_id text NOT NULL REFERENCES commerce_stripe_offer_contracts(offer_id) ON DELETE RESTRICT,
  payment_status text NOT NULL CHECK (payment_status IN ('paid','no_payment_required')),
  session_status text NOT NULL CHECK (session_status = 'complete'),
  amount_total integer NOT NULL,
  currency text NOT NULL CHECK (currency = 'usd'),
  payment_method_collection text NOT NULL CHECK (payment_method_collection = 'always'),
  completed_at timestamptz NOT NULL,
  provider_expires_at timestamptz NOT NULL,
  FOREIGN KEY (household_id, checkout_intent_id)
    REFERENCES commerce_checkout_intents(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, subscription_id)
    REFERENCES commerce_subscriptions(household_id, id) ON DELETE RESTRICT,
  UNIQUE (source_inbox_id),
  UNIQUE (environment, provider_subscription_id),
  UNIQUE (environment, provider_payment_intent_id),
  CHECK (
    (payment_status = 'paid' AND amount_total IN (899,1499))
    OR (payment_status = 'no_payment_required' AND amount_total = 0)
  ),
  CHECK (completed_at <= provider_expires_at)
);

CREATE TRIGGER commerce_stripe_checkout_completions_v2_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_checkout_completions_v2
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

CREATE TABLE commerce_stripe_trial_reservations (
  id text PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  offer_family text NOT NULL CHECK (offer_family IN ('family','individual')),
  offer_id text NOT NULL REFERENCES commerce_stripe_offer_contracts(offer_id) ON DELETE RESTRICT,
  checkout_intent_id text NOT NULL,
  subscription_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{15,159}$'
  ),
  reserved_at timestamptz NOT NULL,
  FOREIGN KEY (household_id, checkout_intent_id)
    REFERENCES commerce_checkout_intents(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, subscription_id)
    REFERENCES commerce_subscriptions(household_id, id) ON DELETE RESTRICT,
  UNIQUE (household_id, checkout_intent_id),
  UNIQUE (environment, person_id, offer_family),
  UNIQUE (environment, household_id, offer_family),
  CHECK (
    (offer_family = 'family' AND offer_id = 'family_annual_v2')
    OR (offer_family = 'individual' AND offer_id = 'individual_annual_v1')
  )
);

CREATE TABLE commerce_stripe_trial_checkout_attempts (
  id text PRIMARY KEY,
  reservation_id text NOT NULL
    REFERENCES commerce_stripe_trial_reservations(id) ON DELETE RESTRICT,
  household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  checkout_intent_id text NOT NULL,
  subscription_id text NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  idempotency_key text NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{15,159}$'
  ),
  recorded_at timestamptz NOT NULL,
  FOREIGN KEY (household_id, checkout_intent_id)
    REFERENCES commerce_checkout_intents(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, subscription_id)
    REFERENCES commerce_subscriptions(household_id, id) ON DELETE RESTRICT,
  UNIQUE (reservation_id, attempt_number),
  UNIQUE (household_id, checkout_intent_id),
  UNIQUE (household_id, idempotency_key)
);

CREATE FUNCTION validate_stripe_trial_checkout_attempt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM commerce_stripe_trial_reservations reservation
    JOIN commerce_checkout_intents intent
      ON intent.household_id = NEW.household_id
     AND intent.id = NEW.checkout_intent_id
    JOIN commerce_subscriptions subscription
      ON subscription.household_id = NEW.household_id
     AND subscription.id = NEW.subscription_id
    WHERE reservation.id = NEW.reservation_id
      AND reservation.environment = intent.environment
      AND reservation.household_id = NEW.household_id
      AND reservation.person_id = intent.requested_by_person_id
      AND reservation.person_id = intent.billing_authority_person_id
      AND reservation.offer_id = intent.offer_id
      AND intent.subscription_id = NEW.subscription_id
      AND intent.idempotency_key = NEW.idempotency_key
      AND intent.billing_interval = 'year'
      AND subscription.plan_version_id = intent.plan_version_id
      AND subscription.payer_person_id = reservation.person_id
      AND subscription.source = 'web'
  ) THEN
    RAISE EXCEPTION 'Annual trial Checkout attempt lineage is invalid';
  END IF;
  IF NEW.attempt_number <> (
    SELECT count(*)::integer + 1
    FROM commerce_stripe_trial_checkout_attempts prior
    WHERE prior.reservation_id = NEW.reservation_id
  ) THEN
    RAISE EXCEPTION 'Annual trial Checkout attempt sequence is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER commerce_stripe_trial_checkout_attempt_lineage_guard
BEFORE INSERT ON commerce_stripe_trial_checkout_attempts
FOR EACH ROW EXECUTE FUNCTION validate_stripe_trial_checkout_attempt();

CREATE TABLE commerce_stripe_trial_consumptions (
  id text PRIMARY KEY,
  reservation_id text NOT NULL UNIQUE
    REFERENCES commerce_stripe_trial_reservations(id) ON DELETE RESTRICT,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  offer_family text NOT NULL CHECK (offer_family IN ('family','individual')),
  offer_id text NOT NULL REFERENCES commerce_stripe_offer_contracts(offer_id) ON DELETE RESTRICT,
  provider_session_id text NOT NULL UNIQUE
    REFERENCES commerce_stripe_checkout_completions_v2(provider_session_id) ON DELETE RESTRICT,
  provider_subscription_id text NOT NULL,
  source_inbox_id text NOT NULL UNIQUE
    REFERENCES commerce_event_inbox(id) ON DELETE RESTRICT,
  consumed_at timestamptz NOT NULL,
  UNIQUE (environment, provider_subscription_id),
  CHECK (
    (offer_family = 'family' AND offer_id = 'family_annual_v2')
    OR (offer_family = 'individual' AND offer_id = 'individual_annual_v1')
  )
);

CREATE TABLE commerce_stripe_trial_period_evidence (
  id text PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  subscription_id text NOT NULL,
  provider_subscription_id text NOT NULL,
  offer_id text NOT NULL REFERENCES commerce_stripe_offer_contracts(offer_id) ON DELETE RESTRICT,
  trial_starts_at timestamptz NOT NULL,
  trial_ends_at timestamptz NOT NULL,
  payment_method_present boolean NOT NULL CHECK (payment_method_present = true),
  source_inbox_id text NOT NULL REFERENCES commerce_event_inbox(id) ON DELETE RESTRICT,
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[A-Za-z0-9_-]{43}$'),
  recorded_at timestamptz NOT NULL,
  FOREIGN KEY (household_id, subscription_id)
    REFERENCES commerce_subscriptions(household_id, id) ON DELETE RESTRICT,
  UNIQUE (environment, provider_subscription_id),
  UNIQUE (source_inbox_id),
  CHECK (offer_id IN ('family_annual_v2','individual_annual_v1')),
  CHECK (trial_ends_at = trial_starts_at + interval '7 days')
);

CREATE TRIGGER commerce_stripe_trial_reservations_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_trial_reservations
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

CREATE TRIGGER commerce_stripe_trial_checkout_attempts_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_trial_checkout_attempts
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

CREATE TRIGGER commerce_stripe_trial_consumptions_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_trial_consumptions
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

CREATE TRIGGER commerce_stripe_trial_period_evidence_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_trial_period_evidence
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

CREATE VIEW commerce_stripe_checkout_completion_bindings AS
SELECT provider_session_id, environment, household_id, checkout_intent_id,
       subscription_id, provider_subscription_id, provider_customer_id,
       provider_payment_intent_id, source_inbox_id, provider_event_id,
       'founding_family_monthly_v1'::text AS offer_id,
       payment_status, session_status, amount_total, currency,
       'always'::text AS payment_method_collection, completed_at, provider_expires_at
FROM commerce_stripe_checkout_completions
UNION ALL
SELECT provider_session_id, environment, household_id, checkout_intent_id,
       subscription_id, provider_subscription_id, provider_customer_id,
       provider_payment_intent_id, source_inbox_id, provider_event_id,
       offer_id, payment_status, session_status, amount_total, currency,
       payment_method_collection, completed_at, provider_expires_at
FROM commerce_stripe_checkout_completions_v2;

ALTER TABLE commerce_stripe_paid_invoice_evidence
  DROP CONSTRAINT commerce_stripe_paid_invoice_evidence_amount_paid_check,
  ADD CONSTRAINT commerce_stripe_paid_invoice_amount_check
    CHECK (amount_paid IN (899,1499,8990,14990));

ALTER TABLE commerce_stripe_failed_invoice_evidence
  DROP CONSTRAINT commerce_stripe_failed_invoice_evidence_amount_due_check,
  ADD CONSTRAINT commerce_stripe_failed_invoice_amount_check
    CHECK (amount_due IN (899,1499,8990,14990));

ALTER TABLE commerce_stripe_financial_restriction_events
  DROP CONSTRAINT commerce_stripe_financial_restriction_events_check,
  ADD CONSTRAINT commerce_stripe_financial_restriction_amount_check CHECK (
    provider_charge_amount IN (899,1499,8990,14990)
    AND restriction_amount BETWEEN 1 AND provider_charge_amount
    AND currency = 'usd'
  );

ALTER TABLE commerce_billing_reverification_bindings
  DROP CONSTRAINT commerce_billing_reverification_bindings_offer_id_check,
  DROP CONSTRAINT commerce_billing_reverification_bindings_amount_minor_check,
  DROP CONSTRAINT commerce_billing_reverification_bindings_action_check,
  DROP CONSTRAINT commerce_billing_reverification_bindings_check,
  ADD CONSTRAINT commerce_billing_reverification_action_kind_check CHECK (
    action IN ('checkout','portal','billing_authority_grant','billing_authority_revoke')
  ),
  ADD CONSTRAINT commerce_billing_reverification_offer_check CHECK (
    offer_id IN (
      'founding_family_monthly_v1', 'family_monthly_v2', 'family_annual_v2',
      'individual_monthly_v1', 'individual_annual_v1', 'cancel_only_portal_v1',
      'billing_authority_self_v1'
    )
  ),
  ADD CONSTRAINT commerce_billing_reverification_amount_check
    CHECK (amount_minor IN (0,899,1499,8990,14990)),
  ADD CONSTRAINT commerce_billing_reverification_action_check CHECK (
    (action = 'portal' AND offer_id = 'cancel_only_portal_v1' AND amount_minor = 0)
    OR (action IN ('billing_authority_grant','billing_authority_revoke')
      AND offer_id = 'billing_authority_self_v1' AND amount_minor = 0)
    OR (action = 'checkout' AND (
      (offer_id IN ('founding_family_monthly_v1','family_monthly_v2') AND amount_minor = 1499)
      OR (offer_id = 'family_annual_v2' AND amount_minor = 14990)
      OR (offer_id = 'individual_monthly_v1' AND amount_minor = 899)
      OR (offer_id = 'individual_annual_v1' AND amount_minor = 8990)
    ))
  );

CREATE OR REPLACE FUNCTION validate_billing_authority_grant_source() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status <> 'active' THEN
    IF NEW.grant_source IS DISTINCT FROM OLD.grant_source
      OR NEW.granted_by_person_id IS DISTINCT FROM OLD.granted_by_person_id
      OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
      OR NEW.household_id IS DISTINCT FROM OLD.household_id
      OR NEW.person_id IS DISTINCT FROM OLD.person_id
    THEN
      RAISE EXCEPTION 'Closed billing authority cannot rewrite grant evidence';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.grant_source = 'household_member' AND (
    NEW.granted_by_person_id <> NEW.person_id
    OR NOT EXISTS (
      SELECT 1 FROM household_memberships membership
      JOIN household_administrator_assignments administrator
        ON administrator.household_id = membership.household_id
       AND administrator.person_id = membership.person_id
       AND administrator.status = 'active'
      WHERE membership.household_id = NEW.household_id
        AND membership.person_id = NEW.person_id
        AND membership.status = 'active'
    )
  ) THEN
    RAISE EXCEPTION 'Household billing authority requires exact administrator self-grant';
  END IF;
  IF NEW.grant_source = 'hq_operator' AND NOT EXISTS (
    SELECT 1 FROM employee_assignments employee
    JOIN organizations organization ON organization.id = employee.organization_id
    WHERE employee.person_id = NEW.granted_by_person_id
      AND employee.role = 'hq_owner' AND employee.status = 'active'
      AND organization.kind = 'internal'
  ) THEN
    RAISE EXCEPTION 'HQ billing authority grantor lacks active internal owner authority';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE household_billing_authority_events
  ADD COLUMN transition_source text NOT NULL DEFAULT 'hq_operator'
    CHECK (transition_source IN ('hq_operator','customer_self')),
  ADD COLUMN request_digest text CHECK (
    request_digest IS NULL OR request_digest ~ '^[0-9a-f]{64}$'
  ),
  ADD COLUMN actor_session_id text REFERENCES sessions(id) ON DELETE RESTRICT,
  ADD COLUMN billing_reverification_binding_id text
    REFERENCES commerce_billing_reverification_bindings(id) ON DELETE RESTRICT,
  ADD COLUMN consent_document_version text,
  ADD COLUMN consent_document_digest text CHECK (
    consent_document_digest IS NULL OR consent_document_digest ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT household_billing_authority_event_source_evidence_check CHECK (
    (transition_source = 'hq_operator'
      AND request_digest IS NULL AND actor_session_id IS NULL
      AND billing_reverification_binding_id IS NULL
      AND consent_document_version IS NULL AND consent_document_digest IS NULL)
    OR
    (transition_source = 'customer_self'
      AND request_digest IS NOT NULL AND actor_session_id IS NOT NULL
      AND billing_reverification_binding_id IS NOT NULL
      AND consent_document_version IS NOT NULL AND consent_document_digest IS NOT NULL
      AND actor_person_id = person_id
      AND (
        (action = 'grant' AND reason_code = 'customer_billing_consent_verified'
          AND consent_document_version = 'billing-authority-self-consent-v1')
        OR
        (action = 'revoke' AND reason_code = 'customer_billing_consent_withdrawn'
          AND consent_document_version = 'billing-authority-self-withdrawal-v1')
      ))
  );

ALTER TABLE household_billing_authority_events
  ALTER COLUMN transition_source DROP DEFAULT;

CREATE INDEX household_billing_authority_events_session_retention_idx
  ON household_billing_authority_events(actor_session_id)
  WHERE actor_session_id IS NOT NULL;

CREATE FUNCTION validate_customer_self_billing_authority_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.transition_source <> 'customer_self' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM household_memberships membership
    JOIN household_administrator_assignments administrator
      ON administrator.household_id = membership.household_id
     AND administrator.person_id = membership.person_id
     AND administrator.status = 'active'
    JOIN sessions session
      ON session.id = NEW.actor_session_id
     AND session.person_id = NEW.actor_person_id
     AND session.audience = 'customer'
     AND session.issued_at <= NEW.occurred_at
     AND session.expires_at > NEW.occurred_at
     AND session.revoked_at IS NULL
    JOIN identities identity
      ON identity.id = session.identity_id
     AND identity.person_id = session.person_id
     AND identity.status = 'active'
    JOIN commerce_billing_reverification_bindings binding
      ON binding.id = NEW.billing_reverification_binding_id
     AND binding.person_id = NEW.actor_person_id
     AND binding.household_id = NEW.household_id
     AND binding.server_operation_id = NEW.operation_key
     AND binding.offer_id = 'billing_authority_self_v1'
     AND binding.amount_minor = 0 AND binding.currency = 'usd'
     AND binding.factor_level = 'multi_factor'
     AND binding.created_at <= NEW.occurred_at
     AND binding.created_at > NEW.occurred_at - interval '10 minutes'
     AND binding.action = CASE NEW.action
       WHEN 'grant' THEN 'billing_authority_grant'
       ELSE 'billing_authority_revoke'
     END
    WHERE membership.household_id = NEW.household_id
      AND membership.person_id = NEW.person_id
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Customer self billing authority evidence is invalid';
  END IF;
  IF NEW.action = 'grant' AND NOT EXISTS (
    SELECT 1 FROM household_billing_authorities authority
    WHERE authority.household_id = NEW.household_id
      AND authority.person_id = NEW.person_id
      AND authority.status = 'active'
      AND authority.grant_source = 'household_member'
      AND authority.granted_by_person_id = NEW.person_id
  ) THEN
    RAISE EXCEPTION 'Customer self billing authority grant state is invalid';
  END IF;
  IF NEW.action = 'revoke' AND NOT EXISTS (
    SELECT 1 FROM household_billing_authorities authority
    WHERE authority.household_id = NEW.household_id
      AND authority.person_id = NEW.person_id
      AND authority.status = 'revoked'
  ) THEN
    RAISE EXCEPTION 'Customer self billing authority revoke state is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER household_billing_authority_customer_self_guard
BEFORE INSERT ON household_billing_authority_events
FOR EACH ROW EXECUTE FUNCTION validate_customer_self_billing_authority_event();

CREATE TABLE commerce_stripe_trial_reminder_intents (
  id text PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  subscription_id text NOT NULL,
  provider_subscription_id text NOT NULL,
  source_inbox_id text NOT NULL REFERENCES commerce_event_inbox(id) ON DELETE RESTRICT,
  offer_id text NOT NULL REFERENCES commerce_stripe_offer_contracts(offer_id) ON DELETE RESTRICT,
  trial_ends_at timestamptz NOT NULL,
  charge_amount_minor integer NOT NULL CHECK (charge_amount_minor IN (8990,14990)),
  currency text NOT NULL CHECK (currency = 'usd'),
  disclosure text NOT NULL CHECK (disclosure IN (
    '7 days free, then $149.90/year unless canceled.',
    '7 days free, then $89.90/year unless canceled.'
  )),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (household_id, subscription_id)
    REFERENCES commerce_subscriptions(household_id, id) ON DELETE RESTRICT,
  UNIQUE (source_inbox_id),
  UNIQUE (environment, provider_subscription_id, trial_ends_at),
  CHECK (trial_ends_at > created_at)
);

CREATE TABLE commerce_stripe_trial_reminder_acknowledgements (
  id text PRIMARY KEY,
  reminder_intent_id text NOT NULL
    REFERENCES commerce_stripe_trial_reminder_intents(id) ON DELETE RESTRICT,
  household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  acknowledged_by_person_id text NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{15,159}$'),
  acknowledged_at timestamptz NOT NULL,
  UNIQUE (reminder_intent_id),
  UNIQUE (household_id, idempotency_key)
);

CREATE TRIGGER commerce_stripe_trial_reminder_intents_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_trial_reminder_intents
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();

CREATE TRIGGER commerce_stripe_trial_reminder_acknowledgements_append_only
BEFORE UPDATE OR DELETE ON commerce_stripe_trial_reminder_acknowledgements
FOR EACH ROW EXECUTE FUNCTION reject_stripe_evidence_mutation();
