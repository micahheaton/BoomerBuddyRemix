CREATE TABLE private_beta_access_intent_gate (
  id smallint PRIMARY KEY CHECK (id = 1)
);

INSERT INTO private_beta_access_intent_gate(id) VALUES (1);

CREATE TABLE private_beta_access_intent_receipts (
  receipt_code text PRIMARY KEY CHECK (
    receipt_code ~ '^access_intent_[A-Za-z0-9_-]{32}$'
  ),
  operation_key_hmac text NOT NULL UNIQUE CHECK (
    operation_key_hmac ~ '^[A-Za-z0-9_-]{43}$'
  ),
  request_digest text NOT NULL CHECK (
    request_digest ~ '^[A-Za-z0-9_-]{43}$'
  ),
  purpose text NOT NULL CHECK (purpose = 'private_beta_access_request'),
  attribution_source text NOT NULL CHECK (
    attribution_source IN ('direct', 'organic', 'partner', 'campaign')
  ),
  attribution_campaign text NOT NULL CHECK (
    attribution_campaign IN ('none', 'launch_2026', 'trusted_partner')
  ),
  lifecycle_state text NOT NULL CHECK (lifecycle_state = 'intent_created'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at),
  CHECK (expires_at <= created_at + interval '8 days'),
  CHECK (
    (attribution_source = 'direct' AND attribution_campaign = 'none')
    OR (attribution_source = 'organic' AND attribution_campaign = 'none')
    OR (
      attribution_source = 'partner'
      AND attribution_campaign = 'trusted_partner'
    )
    OR (
      attribution_source = 'campaign'
      AND attribution_campaign = 'launch_2026'
    )
  )
);

CREATE INDEX private_beta_access_intent_created_idx
  ON private_beta_access_intent_receipts(created_at DESC, receipt_code);

CREATE INDEX private_beta_access_intent_expiry_idx
  ON private_beta_access_intent_receipts(expires_at, receipt_code);

CREATE TABLE private_beta_access_intent_rate_buckets (
  bucket_start timestamptz NOT NULL,
  scope text NOT NULL CHECK (scope IN ('global', 'network')),
  scope_key_hmac text NOT NULL,
  used_count integer NOT NULL CHECK (used_count > 0),
  PRIMARY KEY (bucket_start, scope, scope_key_hmac),
  CHECK (
    (scope = 'global' AND scope_key_hmac = 'global')
    OR (
      scope = 'network'
      AND scope_key_hmac ~ '^[A-Za-z0-9_-]{43}$'
    )
  )
);

CREATE TABLE private_beta_access_intent_aggregates (
  bucket_start date NOT NULL,
  attribution_source text NOT NULL CHECK (
    attribution_source IN ('direct', 'organic', 'partner', 'campaign')
  ),
  attribution_campaign text NOT NULL CHECK (
    attribution_campaign IN ('none', 'launch_2026', 'trusted_partner')
  ),
  event_kind text NOT NULL CHECK (event_kind = 'intent_created'),
  event_count integer NOT NULL CHECK (event_count > 0),
  PRIMARY KEY (
    bucket_start,
    attribution_source,
    attribution_campaign,
    event_kind
  ),
  CHECK (
    (attribution_source = 'direct' AND attribution_campaign = 'none')
    OR (attribution_source = 'organic' AND attribution_campaign = 'none')
    OR (
      attribution_source = 'partner'
      AND attribution_campaign = 'trusted_partner'
    )
    OR (
      attribution_source = 'campaign'
      AND attribution_campaign = 'launch_2026'
    )
  )
);

CREATE OR REPLACE FUNCTION reject_private_beta_access_intent_receipt_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Private-beta access-intent receipts are immutable';
END;
$$;

CREATE TRIGGER private_beta_access_intent_receipts_immutable
BEFORE UPDATE ON private_beta_access_intent_receipts
FOR EACH ROW EXECUTE FUNCTION reject_private_beta_access_intent_receipt_update();
