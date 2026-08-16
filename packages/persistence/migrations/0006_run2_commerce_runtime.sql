ALTER TABLE commerce_provider_subscription_records
  ADD COLUMN provider_customer_id text,
  ADD COLUMN financial_restriction text
    CHECK (financial_restriction IS NULL OR financial_restriction IN ('refunded','disputed')),
  ADD COLUMN financial_restriction_event_id text,
  ADD COLUMN financial_restricted_at timestamptz;

CREATE INDEX commerce_provider_customer_lookup_idx
  ON commerce_provider_subscription_records(
    household_id, provider, environment, provider_customer_id, observed_at DESC
  )
  WHERE provider_customer_id IS NOT NULL;

CREATE TABLE commerce_checkout_intents (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  id text NOT NULL,
  subscription_id text NOT NULL,
  requested_by_person_id text NOT NULL,
  billing_authority_person_id text NOT NULL,
  plan_version_id text NOT NULL REFERENCES commerce_plan_versions(id),
  billing_interval text NOT NULL CHECK (billing_interval IN ('month', 'year')),
  provider_price_id text NOT NULL,
  provider text NOT NULL CHECK (provider = 'stripe'),
  environment text NOT NULL CHECK (environment = 'test'),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 160),
  state text NOT NULL CHECK (state IN ('prepared', 'session_created', 'expired')),
  provider_session_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, idempotency_key),
  UNIQUE (provider, environment, provider_session_id),
  FOREIGN KEY (household_id, subscription_id, plan_version_id)
    REFERENCES commerce_subscriptions(household_id, id, plan_version_id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, requested_by_person_id)
    REFERENCES household_memberships(household_id, person_id),
  FOREIGN KEY (household_id, billing_authority_person_id)
    REFERENCES household_billing_authorities(household_id, person_id),
  CHECK (expires_at > created_at),
  CHECK (
    (state = 'prepared' AND provider_session_id IS NULL)
    OR (state = 'session_created' AND provider_session_id IS NOT NULL)
    OR state = 'expired'
  )
);

CREATE INDEX commerce_checkout_intent_subscription_idx
  ON commerce_checkout_intents(household_id, subscription_id, created_at DESC);

CREATE UNIQUE INDEX commerce_one_open_web_subscription_per_household_idx
  ON commerce_subscriptions(household_id)
  WHERE source = 'web' AND lifecycle IN (
    'pending', 'trialing', 'active', 'grace', 'delinquent', 'paused', 'hold',
    'cancel_at_period_end'
  );

CREATE TABLE commerce_provider_customers (
  provider text NOT NULL CHECK (provider = 'stripe'),
  environment text NOT NULL CHECK (environment = 'test'),
  provider_customer_id text NOT NULL,
  household_id text NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  verified_at timestamptz NOT NULL,
  PRIMARY KEY (provider, environment, provider_customer_id)
);

CREATE INDEX commerce_provider_customer_household_idx
  ON commerce_provider_customers(household_id, provider, environment, verified_at DESC);

ALTER TABLE commerce_reconciliation_runs
  ADD COLUMN trigger_event_id text UNIQUE REFERENCES commerce_event_inbox(id) ON DELETE SET NULL;
