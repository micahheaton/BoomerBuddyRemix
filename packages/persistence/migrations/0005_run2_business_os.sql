CREATE TABLE acquisition_touchpoints (
  id text PRIMARY KEY,
  subject_kind text NOT NULL
    CHECK (subject_kind IN ('anonymous_context', 'person', 'household')),
  subject_id text NOT NULL,
  channel text NOT NULL
    CHECK (channel IN (
      'organic_search', 'paid_search', 'paid_social', 'referral', 'partner',
      'affiliate', 'direct', 'content', 'campaign', 'newsletter'
    )),
  milestone text NOT NULL
    CHECK (milestone IN (
      'landing', 'first_check', 'signup', 'activation', 'orientation', 'trial',
      'paid', 'retention', 'referral'
    )),
  source_token text,
  medium_token text,
  campaign_token text,
  content_token text,
  partner_token text,
  referrer_host text,
  occurred_at timestamptz NOT NULL,
  CHECK (char_length(subject_id) BETWEEN 1 AND 160)
);

CREATE INDEX acquisition_touchpoints_subject_occurred_idx
  ON acquisition_touchpoints(subject_kind, subject_id, occurred_at);

CREATE TABLE content_sources (
  id text PRIMARY KEY,
  source_kind text NOT NULL
    CHECK (source_kind IN ('official', 'adjudicated_incident', 'founder_original', 'partner')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  canonical_url text,
  source_fingerprint text NOT NULL,
  evidence_state text NOT NULL
    CHECK (evidence_state IN ('candidate', 'verified', 'rejected', 'retired')),
  captured_at timestamptz NOT NULL,
  fresh_until timestamptz,
  created_by_person_id text REFERENCES persons(id),
  UNIQUE (source_fingerprint)
);

CREATE TABLE governed_content_items (
  id text PRIMARY KEY,
  content_kind text NOT NULL
    CHECK (content_kind IN (
      'scam_page', 'explainer', 'alert', 'newsletter', 'social_draft', 'faq',
      'video_talking_points', 'founder_derivative'
    )),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  review_state text NOT NULL
    CHECK (review_state IN (
      'draft', 'evidence_review', 'founder_approval', 'approved', 'rejected', 'retired'
    )),
  source_content_item_id text REFERENCES governed_content_items(id),
  founder_source_id text REFERENCES content_sources(id),
  claim_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_person_id text REFERENCES persons(id),
  approved_by_person_id text REFERENCES persons(id),
  created_at timestamptz NOT NULL,
  approved_at timestamptz,
  published_at timestamptz,
  CHECK (published_at IS NULL OR review_state = 'approved'),
  CHECK (approved_at IS NULL OR approved_by_person_id IS NOT NULL)
);

CREATE TABLE governed_content_evidence (
  content_item_id text NOT NULL REFERENCES governed_content_items(id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES content_sources(id),
  supported_claim text NOT NULL CHECK (char_length(supported_claim) BETWEEN 1 AND 500),
  PRIMARY KEY (content_item_id, source_id, supported_claim)
);

CREATE TABLE referrals (
  id text PRIMARY KEY,
  referral_kind text NOT NULL
    CHECK (referral_kind IN ('family_invitation', 'trusted_circle', 'friend', 'gift_trial')),
  referrer_person_id text REFERENCES persons(id),
  referrer_household_id text REFERENCES households(id),
  referred_person_id text REFERENCES persons(id),
  referred_household_id text REFERENCES households(id),
  attribution_touchpoint_id text REFERENCES acquisition_touchpoints(id),
  state text NOT NULL
    CHECK (state IN ('created', 'accepted', 'activated', 'paid', 'revoked', 'abuse_review')),
  created_at timestamptz NOT NULL,
  accepted_at timestamptz,
  activated_at timestamptz,
  paid_at timestamptz,
  CHECK (referrer_person_id IS NOT NULL OR referrer_household_id IS NOT NULL)
);

CREATE TABLE referral_reward_ledger (
  id text PRIMARY KEY,
  referral_id text NOT NULL REFERENCES referrals(id),
  reward_code text NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('approved', 'issued', 'reversed')),
  approved_by_person_id text NOT NULL REFERENCES persons(id),
  amount_minor integer NOT NULL CHECK (amount_minor >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (referral_id, reward_code, disposition)
);

CREATE TABLE ncua_snapshots (
  id text PRIMARY KEY,
  cycle_date date NOT NULL,
  source_url text NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  downloaded_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL,
  row_count integer NOT NULL CHECK (row_count >= 0),
  state text NOT NULL CHECK (state IN ('imported', 'superseded', 'rejected')),
  UNIQUE (cycle_date, source_sha256)
);

CREATE TABLE ncua_credit_unions (
  snapshot_id text NOT NULL REFERENCES ncua_snapshots(id) ON DELETE CASCADE,
  charter_number integer NOT NULL,
  internal_join_number integer NOT NULL,
  name text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  charter_state text NOT NULL,
  zip_code text NOT NULL,
  ncua_region text NOT NULL,
  source_type_code text NOT NULL,
  low_income_designation boolean NOT NULL,
  peer_group integer NOT NULL,
  members bigint NOT NULL CHECK (members >= 0),
  assets bigint NOT NULL CHECK (assets >= 0),
  loans bigint NOT NULL CHECK (loans >= 0),
  deposits bigint NOT NULL CHECK (deposits >= 0),
  member_segment text NOT NULL
    CHECK (member_segment IN ('under_10k', '10k_50k', '50k_250k', '250k_plus')),
  fit_score integer NOT NULL CHECK (fit_score BETWEEN 0 AND 100),
  fit_reasons jsonb NOT NULL,
  PRIMARY KEY (snapshot_id, charter_number)
);

CREATE INDEX ncua_credit_unions_segment_score_idx
  ON ncua_credit_unions(snapshot_id, member_segment, fit_score DESC, charter_number);

CREATE TABLE crm_organizations (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 240),
  organization_kind text NOT NULL
    CHECK (organization_kind IN ('credit_union', 'partner', 'vendor', 'other')),
  verification_state text NOT NULL
    CHECK (verification_state IN ('public_source', 'enriched_fixture', 'verified', 'unverified')),
  source_name text NOT NULL,
  source_external_id text,
  source_snapshot_id text REFERENCES ncua_snapshots(id),
  source_charter_number integer,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (source_snapshot_id, source_charter_number)
    REFERENCES ncua_credit_unions(snapshot_id, charter_number),
  CHECK ((source_snapshot_id IS NULL) = (source_charter_number IS NULL))
);

CREATE UNIQUE INDEX crm_organizations_source_external_unique_idx
  ON crm_organizations(source_name, source_external_id)
  WHERE source_external_id IS NOT NULL;

CREATE TABLE crm_contacts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES crm_organizations(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  role_title text,
  source_name text NOT NULL,
  source_external_id text,
  verification_state text NOT NULL
    CHECK (verification_state IN ('fixture', 'public_source', 'verified', 'unverified')),
  contact_channels jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE crm_opportunities (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES crm_organizations(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 240),
  stage text NOT NULL
    CHECK (stage IN (
      'target', 'prospecting', 'engaged', 'discovery', 'qualified', 'pilot',
      'business_case', 'contracting', 'closed_won', 'closed_lost',
      'implementation', 'active_partner', 'expansion'
    )),
  owner_person_id text REFERENCES persons(id),
  amount_minor bigint CHECK (amount_minor IS NULL OR amount_minor >= 0),
  currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  forecast_probability integer CHECK (forecast_probability BETWEEN 0 AND 100),
  use_case text,
  champion_contact_id text REFERENCES crm_contacts(id),
  economic_buyer_contact_id text REFERENCES crm_contacts(id),
  pilot_state text,
  contract_state text,
  next_action text,
  next_action_at timestamptz,
  last_meaningful_activity_at timestamptz NOT NULL,
  snoozed_until timestamptz,
  suppression_reason text,
  closed_lost_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((next_action IS NULL) = (next_action_at IS NULL))
);

CREATE INDEX crm_opportunities_stage_next_action_idx
  ON crm_opportunities(stage, next_action_at, last_meaningful_activity_at);

CREATE TABLE crm_opportunity_stage_history (
  id text PRIMARY KEY,
  opportunity_id text NOT NULL REFERENCES crm_opportunities(id) ON DELETE CASCADE,
  from_stage text,
  to_stage text NOT NULL,
  reason text NOT NULL,
  changed_by_person_id text REFERENCES persons(id),
  changed_at timestamptz NOT NULL
);

CREATE TABLE crm_activities (
  id text PRIMARY KEY,
  opportunity_id text REFERENCES crm_opportunities(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES crm_organizations(id) ON DELETE CASCADE,
  activity_kind text NOT NULL
    CHECK (activity_kind IN ('note', 'meeting', 'call', 'email_draft', 'research', 'status_change')),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 1000),
  source text NOT NULL,
  actor_person_id text REFERENCES persons(id),
  occurred_at timestamptz NOT NULL
);

CREATE TABLE crm_tasks (
  id text PRIMARY KEY,
  opportunity_id text REFERENCES crm_opportunities(id) ON DELETE CASCADE,
  organization_id text REFERENCES crm_organizations(id) ON DELETE CASCADE,
  task_kind text NOT NULL,
  title text NOT NULL,
  owner_person_id text REFERENCES persons(id),
  due_at timestamptz,
  state text NOT NULL CHECK (state IN ('open', 'completed', 'suppressed', 'cancelled')),
  generated_by_rule text,
  created_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE TABLE communication_suppressions (
  id text PRIMARY KEY,
  subject_kind text NOT NULL CHECK (subject_kind IN ('person', 'contact', 'organization', 'address')),
  subject_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'phone', 'all')),
  scope text NOT NULL CHECK (scope IN ('transactional', 'lifecycle', 'b2b', 'all')),
  reason text NOT NULL,
  source text NOT NULL,
  effective_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX communication_suppressions_subject_idx
  ON communication_suppressions(subject_kind, subject_id, channel, scope);

CREATE TABLE lifecycle_workflows (
  id text PRIMARY KEY,
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  workflow_kind text NOT NULL
    CHECK (workflow_kind IN (
      'signup', 'activation', 'orientation', 'trial', 'payment_recovery',
      'renewal', 'cancellation', 'win_back', 'referral'
    )),
  state text NOT NULL CHECK (state IN ('active', 'completed', 'suppressed', 'cancelled')),
  trigger_event_id text,
  current_step_key text,
  consent_basis text,
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE TABLE lifecycle_steps (
  id text PRIMARY KEY,
  workflow_id text NOT NULL REFERENCES lifecycle_workflows(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  action_kind text NOT NULL CHECK (action_kind IN ('internal_task', 'approved_message', 'wait', 'decision')),
  state text NOT NULL CHECK (state IN ('pending', 'ready', 'completed', 'suppressed', 'failed')),
  scheduled_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  UNIQUE (workflow_id, step_key)
);

CREATE UNIQUE INDEX lifecycle_workflows_trigger_event_unique_idx
  ON lifecycle_workflows(trigger_event_id)
  WHERE trigger_event_id IS NOT NULL;

CREATE TABLE customer_health_snapshots (
  id text PRIMARY KEY,
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('healthy', 'needs_attention', 'at_risk')),
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  components jsonb NOT NULL,
  calculated_at timestamptz NOT NULL,
  ruleset_version text NOT NULL
);

CREATE INDEX customer_health_household_calculated_idx
  ON customer_health_snapshots(household_id, calculated_at DESC);

CREATE TABLE hq_work_cases (
  id text PRIMARY KEY,
  case_kind text NOT NULL
    CHECK (case_kind IN ('support', 'fraud', 'billing', 'security_privacy', 'customer_success', 'system')),
  household_id text REFERENCES households(id),
  organization_id text REFERENCES crm_organizations(id),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  state text NOT NULL CHECK (state IN ('open', 'triaged', 'in_progress', 'resolved', 'closed')),
  routing_class text NOT NULL
    CHECK (routing_class IN ('self_service', 'ai_assisted', 'l1_human', 'trust_safety', 'billing', 'security_privacy', 'founder')),
  summary text NOT NULL,
  assigned_person_id text REFERENCES persons(id),
  due_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  resolved_at timestamptz
);

CREATE TABLE owner_attention_items (
  id text PRIMARY KEY,
  attention_kind text NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  dedupe_key text NOT NULL,
  why_founder_required text NOT NULL,
  recommended_action text NOT NULL,
  consequence_of_inaction text NOT NULL,
  deadline timestamptz,
  state text NOT NULL CHECK (state IN ('open', 'snoozed', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  resolved_at timestamptz
);

CREATE UNIQUE INDEX owner_attention_open_dedupe_idx
  ON owner_attention_items(dedupe_key)
  WHERE state IN ('open', 'snoozed');

CREATE TABLE owner_briefs (
  id text PRIMARY KEY,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  metrics jsonb NOT NULL,
  changes jsonb NOT NULL,
  attention_item_ids jsonb NOT NULL,
  evidence_state text NOT NULL CHECK (evidence_state IN ('local_fixture', 'runtime', 'production')),
  created_at timestamptz NOT NULL,
  CHECK (period_end > period_start)
);

CREATE TABLE autonomy_policies (
  id text PRIMARY KEY,
  action_key text NOT NULL UNIQUE,
  autonomy_class text NOT NULL CHECK (autonomy_class IN ('auto', 'approval', 'human', 'professional')),
  allowed_data_classes jsonb NOT NULL,
  allowed_tools jsonb NOT NULL,
  budget_cents integer NOT NULL CHECK (budget_cents >= 0),
  requires_audit boolean NOT NULL,
  enabled boolean NOT NULL,
  approved_by_person_id text REFERENCES persons(id),
  version integer NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE autonomy_policy_versions (
  id text PRIMARY KEY,
  policy_id text NOT NULL REFERENCES autonomy_policies(id),
  action_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  autonomy_class text NOT NULL CHECK (autonomy_class IN ('auto', 'approval', 'human', 'professional')),
  allowed_data_classes jsonb NOT NULL,
  allowed_tools jsonb NOT NULL,
  budget_cents integer NOT NULL CHECK (budget_cents >= 0),
  requires_audit boolean NOT NULL,
  enabled boolean NOT NULL,
  approved_by_person_id text REFERENCES persons(id),
  recorded_at timestamptz NOT NULL,
  UNIQUE(action_key, version)
);

CREATE TABLE automation_global_control (
  control_key text PRIMARY KEY CHECK (control_key = 'global'),
  kill_switch boolean NOT NULL,
  updated_by_person_id text REFERENCES persons(id),
  updated_at timestamptz NOT NULL
);

CREATE TABLE automation_global_control_history (
  id text PRIMARY KEY,
  kill_switch boolean NOT NULL,
  updated_by_person_id text REFERENCES persons(id),
  recorded_at timestamptz NOT NULL
);

INSERT INTO automation_global_control(control_key, kill_switch, updated_at)
VALUES ('global', true, '2026-08-16T00:00:00.000Z');

CREATE TABLE automation_approvals (
  id text PRIMARY KEY,
  policy_id text NOT NULL REFERENCES autonomy_policies(id),
  requested_action jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'approved', 'rejected', 'expired')),
  requested_at timestamptz NOT NULL,
  decided_at timestamptz,
  decided_by_person_id text REFERENCES persons(id),
  decision_reason text
);

CREATE TABLE automation_runs (
  id text PRIMARY KEY,
  policy_id text REFERENCES autonomy_policies(id),
  approval_id text REFERENCES automation_approvals(id),
  action_key text NOT NULL,
  tool_key text NOT NULL,
  data_classes jsonb NOT NULL,
  estimated_cost_cents integer NOT NULL CHECK (estimated_cost_cents >= 0),
  actual_cost_cents integer CHECK (actual_cost_cents IS NULL OR actual_cost_cents >= 0),
  state text NOT NULL CHECK (state IN ('blocked', 'approved', 'running', 'completed', 'failed', 'cancelled')),
  audit_reference text NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE privacy_requests (
  id text PRIMARY KEY,
  person_id text REFERENCES persons(id),
  household_id text REFERENCES households(id),
  request_kind text NOT NULL CHECK (request_kind IN ('access', 'export', 'delete', 'correct', 'restrict')),
  identity_verification_state text NOT NULL
    CHECK (identity_verification_state IN ('pending', 'verified', 'failed')),
  state text NOT NULL CHECK (state IN ('received', 'verified', 'in_progress', 'completed', 'denied')),
  due_at timestamptz NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK (person_id IS NOT NULL OR household_id IS NOT NULL)
);
