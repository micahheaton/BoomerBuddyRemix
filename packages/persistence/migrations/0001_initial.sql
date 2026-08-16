CREATE TABLE persons (
  id text PRIMARY KEY,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identities (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  issuer text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);

CREATE TABLE households (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  kind text NOT NULL CHECK (kind IN ('internal', 'sponsor')),
  verification_state text NOT NULL
    CHECK (verification_state IN ('local_fixture', 'verified', 'unverified')),
  created_at timestamptz NOT NULL
);

CREATE TABLE local_demo_bootstraps (
  bootstrap_key text PRIMARY KEY CHECK (bootstrap_key = 'run1-v1'),
  bootstrap_mode text NOT NULL CHECK (bootstrap_mode = 'empty_database'),
  completed_at timestamptz NOT NULL
);

CREATE TABLE household_memberships (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  id text NOT NULL,
  person_id text NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('household_owner', 'protected_member', 'trusted_circle')),
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, person_id)
);

CREATE TABLE employee_assignments (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  organization_id text REFERENCES organizations(id),
  role text NOT NULL CHECK (role IN ('hq_owner', 'hq_reviewer', 'hq_support')),
  status text NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, organization_id, role)
);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  audience text NOT NULL CHECK (audience IN ('customer', 'mobile', 'hq')),
  issuer text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > issued_at)
);

CREATE INDEX sessions_person_audience_idx ON sessions(person_id, audience);

CREATE TABLE artifacts (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  id text NOT NULL,
  owner_person_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('text', 'url')),
  encrypted_content text,
  input_fingerprint text,
  encryption_key_version integer NOT NULL,
  fingerprint_key_version integer NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'deleted')),
  delete_after timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (household_id, id),
  FOREIGN KEY (household_id, owner_person_id)
    REFERENCES household_memberships(household_id, person_id)
);

CREATE INDEX artifacts_household_owner_created_idx
  ON artifacts(household_id, owner_person_id, created_at DESC);

CREATE TABLE analyses (
  household_id text NOT NULL,
  id text NOT NULL,
  artifact_id text NOT NULL,
  requested_by text NOT NULL,
  risk text NOT NULL CHECK (risk IN ('lower_concern', 'caution', 'high_concern', 'unknown')),
  evidence_sufficiency text NOT NULL CHECK (evidence_sufficiency IN ('limited', 'moderate', 'strong')),
  calibration text NOT NULL CHECK (calibration = 'not_calibrated'),
  summary text NOT NULL,
  evidence jsonb NOT NULL,
  actions jsonb NOT NULL,
  provider_name text NOT NULL,
  provider_state text NOT NULL CHECK (provider_state IN ('mock', 'unknown', 'unavailable', 'verified')),
  provider_version text NOT NULL,
  ruleset_version text NOT NULL,
  state text NOT NULL CHECK (state IN ('completed', 'failed', 'deleted')),
  created_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (household_id, id),
  FOREIGN KEY (household_id, artifact_id) REFERENCES artifacts(household_id, id),
  FOREIGN KEY (household_id, requested_by)
    REFERENCES household_memberships(household_id, person_id)
);

CREATE INDEX analyses_household_requested_created_idx
  ON analyses(household_id, requested_by, created_at DESC);

CREATE TABLE consents (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  id text NOT NULL,
  protected_person_id text NOT NULL,
  granted_by_person_id text NOT NULL,
  purpose text NOT NULL,
  consent_version text NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'revoked')),
  granted_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (household_id, id),
  FOREIGN KEY (household_id, protected_person_id)
    REFERENCES household_memberships(household_id, person_id),
  FOREIGN KEY (household_id, granted_by_person_id)
    REFERENCES household_memberships(household_id, person_id)
);

CREATE TABLE invitations (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  id text NOT NULL,
  invited_by_person_id text NOT NULL,
  protected_person_id text NOT NULL,
  consent_id text NOT NULL,
  invitee_display_name text NOT NULL,
  invite_code_fingerprint text NOT NULL,
  fingerprint_key_version integer NOT NULL,
  permissions jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  accepted_by_person_id text REFERENCES persons(id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (household_id, id),
  UNIQUE (invite_code_fingerprint),
  FOREIGN KEY (household_id, invited_by_person_id)
    REFERENCES household_memberships(household_id, person_id),
  FOREIGN KEY (household_id, protected_person_id)
    REFERENCES household_memberships(household_id, person_id),
  FOREIGN KEY (household_id, consent_id) REFERENCES consents(household_id, id)
);

CREATE TABLE trusted_circle_relationships (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  id text NOT NULL,
  protected_person_id text NOT NULL,
  trusted_person_id text NOT NULL,
  permissions jsonb NOT NULL,
  consent_id text NOT NULL,
  consent_version text NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'revoked')),
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, protected_person_id, trusted_person_id),
  FOREIGN KEY (household_id, protected_person_id)
    REFERENCES household_memberships(household_id, person_id),
  FOREIGN KEY (household_id, trusted_person_id)
    REFERENCES household_memberships(household_id, person_id),
  FOREIGN KEY (household_id, consent_id) REFERENCES consents(household_id, id)
);

CREATE TABLE check_shares (
  household_id text NOT NULL,
  analysis_id text NOT NULL,
  relationship_id text NOT NULL,
  shared_with_person_id text NOT NULL,
  shared_by_person_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, analysis_id, shared_with_person_id),
  FOREIGN KEY (household_id, analysis_id) REFERENCES analyses(household_id, id),
  FOREIGN KEY (household_id, relationship_id)
    REFERENCES trusted_circle_relationships(household_id, id),
  FOREIGN KEY (household_id, shared_with_person_id)
    REFERENCES household_memberships(household_id, person_id),
  FOREIGN KEY (household_id, shared_by_person_id)
    REFERENCES household_memberships(household_id, person_id)
);

CREATE TABLE orientation_states (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  person_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('not_started', 'in_progress', 'ready')),
  completed_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  safe_word_disposition text NOT NULL
    CHECK (safe_word_disposition IN ('unanswered', 'configured', 'informed_deferral')),
  needs_attention boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, person_id),
  FOREIGN KEY (household_id, person_id)
    REFERENCES household_memberships(household_id, person_id)
);

CREATE TABLE safe_word_verifiers (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  protected_person_id text NOT NULL,
  verifier text NOT NULL,
  version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, protected_person_id),
  FOREIGN KEY (household_id, protected_person_id)
    REFERENCES household_memberships(household_id, person_id)
);

CREATE TABLE commerce_product_versions (
  id text PRIMARY KEY,
  product_key text NOT NULL CHECK (product_key = 'consumer_household'),
  version integer NOT NULL CHECK (version > 0),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  available_from timestamptz NOT NULL,
  available_until timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (product_key, version),
  CHECK (available_until IS NULL OR available_until > available_from)
);

CREATE TABLE commerce_plan_versions (
  id text PRIMARY KEY,
  product_version_id text NOT NULL REFERENCES commerce_product_versions(id),
  plan_key text NOT NULL CHECK (plan_key IN ('free', 'plus', 'family')),
  version integer NOT NULL CHECK (version > 0),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  state text NOT NULL CHECK (state IN ('hypothesis', 'active', 'retired')),
  capabilities jsonb NOT NULL,
  allowances jsonb NOT NULL,
  prices jsonb NOT NULL,
  available_from timestamptz NOT NULL,
  available_until timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (product_version_id, plan_key, version),
  CHECK (available_until IS NULL OR available_until > available_from)
);

CREATE FUNCTION reject_commerce_version_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'commerce product and plan versions are immutable';
END;
$$;

CREATE TRIGGER commerce_product_versions_immutable
BEFORE UPDATE OR DELETE ON commerce_product_versions
FOR EACH ROW EXECUTE FUNCTION reject_commerce_version_mutation();

CREATE TRIGGER commerce_plan_versions_immutable
BEFORE UPDATE OR DELETE ON commerce_plan_versions
FOR EACH ROW EXECUTE FUNCTION reject_commerce_version_mutation();

CREATE TABLE commerce_subscriptions (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  id text NOT NULL,
  payer_person_id text REFERENCES persons(id) ON DELETE SET NULL,
  plan_version_id text NOT NULL REFERENCES commerce_plan_versions(id),
  source text NOT NULL CHECK (source IN ('local', 'web', 'apple', 'google', 'sponsor', 'support')),
  lifecycle text NOT NULL CHECK (lifecycle IN (
    'pending', 'trialing', 'active', 'grace', 'delinquent', 'paused', 'hold',
    'cancel_at_period_end', 'canceled', 'expired', 'refunded', 'disputed', 'restored'
  )),
  source_verified boolean NOT NULL,
  precedence integer NOT NULL CHECK (precedence >= 0),
  current_period_starts_at timestamptz NOT NULL,
  current_period_ends_at timestamptz,
  trial_ends_at timestamptz,
  grace_ends_at timestamptz,
  cancel_at timestamptz,
  ended_at timestamptz,
  reconciliation_state text NOT NULL
    CHECK (reconciliation_state IN ('not_required', 'pending', 'reconciled', 'attention')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, id, plan_version_id),
  CHECK (current_period_ends_at IS NULL OR current_period_ends_at > current_period_starts_at)
);

CREATE TABLE commerce_provider_subscription_records (
  id text PRIMARY KEY,
  household_id text NOT NULL,
  subscription_id text NOT NULL,
  provider text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('local', 'test', 'sandbox', 'production')),
  external_subscription_id text NOT NULL,
  raw_state text NOT NULL,
  provider_version text,
  observed_at timestamptz NOT NULL,
  verified_at timestamptz,
  FOREIGN KEY (household_id, subscription_id)
    REFERENCES commerce_subscriptions(household_id, id) ON DELETE CASCADE,
  UNIQUE (provider, environment, external_subscription_id)
);

CREATE TABLE commerce_sponsorships (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  plan_version_id text NOT NULL REFERENCES commerce_plan_versions(id),
  state text NOT NULL CHECK (state IN ('hypothesis', 'active', 'ended', 'revoked')),
  privacy_policy_version text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (id, plan_version_id),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE commerce_sponsorship_allocations (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  id text NOT NULL,
  sponsorship_id text NOT NULL REFERENCES commerce_sponsorships(id),
  plan_version_id text NOT NULL REFERENCES commerce_plan_versions(id),
  eligibility_reference text NOT NULL,
  state text NOT NULL CHECK (state IN ('eligible', 'active', 'ended', 'revoked')),
  source_verified boolean NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, id, plan_version_id),
  FOREIGN KEY (sponsorship_id, plan_version_id)
    REFERENCES commerce_sponsorships(id, plan_version_id),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE entitlement_grants (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  id text NOT NULL,
  source text NOT NULL CHECK (source IN ('local', 'web', 'apple', 'google', 'sponsor', 'support')),
  capabilities jsonb NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  revoked_at timestamptz,
  source_verified boolean NOT NULL,
  precedence integer NOT NULL DEFAULT 0,
  plan_version_id text NOT NULL REFERENCES commerce_plan_versions(id),
  subscription_id text,
  sponsorship_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  FOREIGN KEY (household_id, subscription_id, plan_version_id)
    REFERENCES commerce_subscriptions(household_id, id, plan_version_id),
  FOREIGN KEY (household_id, sponsorship_id, plan_version_id)
    REFERENCES commerce_sponsorship_allocations(household_id, id, plan_version_id),
  CHECK (
    (source = 'sponsor' AND subscription_id IS NOT NULL AND sponsorship_id IS NOT NULL)
    OR
    (source <> 'sponsor' AND subscription_id IS NOT NULL AND sponsorship_id IS NULL)
  )
);

CREATE TABLE commerce_allowance_allocations (
  household_id text NOT NULL,
  id text NOT NULL,
  entitlement_grant_id text NOT NULL,
  allowance_key text NOT NULL
    CHECK (allowance_key IN ('protected_members', 'trusted_circle_participants')),
  subject_kind text NOT NULL
    CHECK (subject_kind IN ('protected_member', 'trusted_circle_person')),
  subject_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'released')),
  allocated_at timestamptz NOT NULL,
  released_at timestamptz,
  PRIMARY KEY (household_id, id),
  FOREIGN KEY (household_id, entitlement_grant_id)
    REFERENCES entitlement_grants(household_id, id),
  FOREIGN KEY (household_id, subject_id)
    REFERENCES household_memberships(household_id, person_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (
    (allowance_key = 'protected_members' AND subject_kind = 'protected_member')
    OR
    (allowance_key = 'trusted_circle_participants' AND subject_kind = 'trusted_circle_person')
  ),
  CHECK (
    (state = 'active' AND released_at IS NULL)
    OR (state = 'released' AND released_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX commerce_allowance_active_subject_idx
  ON commerce_allowance_allocations(household_id, allowance_key, subject_kind, subject_id)
  WHERE state = 'active';

CREATE TABLE protected_members (
  household_id text NOT NULL,
  person_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted', 'deferred', 'revoked')),
  consented_by_person_id text NOT NULL,
  consent_version text NOT NULL CHECK (char_length(consent_version) BETWEEN 1 AND 80),
  allowance_allocation_id text,
  accepted_at timestamptz,
  deferred_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, person_id),
  UNIQUE (household_id, allowance_allocation_id),
  FOREIGN KEY (household_id, person_id)
    REFERENCES household_memberships(household_id, person_id),
  FOREIGN KEY (household_id, consented_by_person_id)
    REFERENCES household_memberships(household_id, person_id),
  FOREIGN KEY (household_id, allowance_allocation_id)
    REFERENCES commerce_allowance_allocations(household_id, id),
  CHECK (consented_by_person_id = person_id),
  CHECK (
    (status = 'accepted' AND allowance_allocation_id IS NOT NULL
      AND accepted_at IS NOT NULL AND deferred_at IS NULL AND revoked_at IS NULL)
    OR
    (status = 'deferred' AND allowance_allocation_id IS NULL
      AND accepted_at IS NULL AND deferred_at IS NOT NULL AND revoked_at IS NULL)
    OR
    (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE FUNCTION validate_protected_member_enrollment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'accepted' AND NOT EXISTS (
    SELECT 1 FROM commerce_allowance_allocations a
    WHERE a.household_id = NEW.household_id
      AND a.id = NEW.allowance_allocation_id
      AND a.allowance_key = 'protected_members'
      AND a.subject_kind = 'protected_member'
      AND a.subject_id = NEW.person_id
      AND a.state = 'active'
  ) THEN
    RAISE EXCEPTION 'accepted protected enrollment requires its active protected allowance';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protected_members_validate_enrollment
BEFORE INSERT OR UPDATE ON protected_members
FOR EACH ROW EXECUTE FUNCTION validate_protected_member_enrollment();

CREATE FUNCTION guard_linked_protected_allowance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.allowance_key = 'protected_members'
    AND OLD.subject_kind = 'protected_member'
    AND OLD.state = 'active'
    AND (TG_OP = 'DELETE' OR NEW.state <> 'active')
    AND EXISTS (
      SELECT 1 FROM protected_members p
      WHERE p.household_id = OLD.household_id
        AND p.allowance_allocation_id = OLD.id
        AND p.status = 'accepted'
    ) THEN
    RAISE EXCEPTION 'accepted protected enrollment must be revoked before allowance release';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER commerce_allowance_guard_protected_enrollment
BEFORE UPDATE OR DELETE ON commerce_allowance_allocations
FOR EACH ROW EXECUTE FUNCTION guard_linked_protected_allowance();

CREATE TABLE commerce_event_inbox (
  id text PRIMARY KEY,
  provider text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('local', 'test', 'sandbox', 'production')),
  external_event_id text NOT NULL,
  event_type text NOT NULL,
  payload_hmac text NOT NULL,
  fingerprint_key_version integer NOT NULL CHECK (fingerprint_key_version > 0),
  authenticity text NOT NULL CHECK (authenticity IN ('local_fixture', 'verified', 'unverified')),
  status text NOT NULL CHECK (status IN ('received', 'processing', 'processed', 'retry', 'quarantined')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  received_at timestamptz NOT NULL,
  processed_at timestamptz,
  error_code text,
  UNIQUE (provider, environment, external_event_id)
);

CREATE TABLE commerce_reconciliation_runs (
  id text PRIMARY KEY,
  provider text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('local', 'test', 'sandbox', 'production')),
  state text NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'attention', 'failed')),
  checked_count integer NOT NULL DEFAULT 0 CHECK (checked_count >= 0),
  mismatch_count integer NOT NULL DEFAULT 0 CHECK (mismatch_count >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE audit_events (
  id text PRIMARY KEY,
  household_id text REFERENCES households(id) ON DELETE SET NULL,
  actor_person_id text REFERENCES persons(id) ON DELETE SET NULL,
  session_audience text CHECK (session_audience IN ('customer', 'mobile', 'hq')),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied', 'completed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX audit_events_occurred_idx ON audit_events(occurred_at DESC);

CREATE TABLE outbox_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  event_version integer NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  household_id text REFERENCES households(id) ON DELETE SET NULL,
  actor_person_id text REFERENCES persons(id) ON DELETE SET NULL,
  correlation_id text NOT NULL,
  classification text NOT NULL CHECK (classification IN ('public', 'internal', 'confidential')),
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  processed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);

CREATE INDEX outbox_events_available_idx
  ON outbox_events(available_at) WHERE processed_at IS NULL;

CREATE TABLE provider_health (
  key text PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('mock', 'unknown', 'unavailable', 'verified')),
  detail text NOT NULL,
  checked_at timestamptz NOT NULL
);

CREATE TABLE saved_searches (
  id text PRIMARY KEY,
  name text NOT NULL,
  source text NOT NULL,
  result_count integer NOT NULL CHECK (result_count >= 0),
  refreshed_at timestamptz NOT NULL
);

CREATE TABLE target_accounts (
  id text PRIMARY KEY,
  name text NOT NULL,
  segment text NOT NULL,
  verification_state text NOT NULL,
  source_reference text NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE opportunities (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES target_accounts(id) ON DELETE CASCADE,
  stage text NOT NULL,
  owner text NOT NULL,
  next_action text NOT NULL,
  next_action_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
