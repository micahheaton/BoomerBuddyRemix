CREATE TABLE growth_event_receipts (
  event_id text PRIMARY KEY REFERENCES outbox_events(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  projection_version text NOT NULL CHECK (projection_version = 'run2-growth-v1'),
  disposition text NOT NULL CHECK (disposition IN ('projected', 'ignored')),
  projected_at timestamptz NOT NULL
);

CREATE INDEX growth_event_receipts_projected_idx
  ON growth_event_receipts(projected_at, event_id);

ALTER TABLE lifecycle_steps
  ADD COLUMN step_order integer NOT NULL DEFAULT 0 CHECK (step_order >= 0);

ALTER TABLE lifecycle_workflows
  ADD COLUMN recipient_person_id text,
  ADD CONSTRAINT lifecycle_workflows_recipient_membership_fk
    FOREIGN KEY (household_id, recipient_person_id)
    REFERENCES household_memberships(household_id, person_id);

CREATE INDEX lifecycle_workflows_recipient_idx
  ON lifecycle_workflows(household_id, recipient_person_id, state);

CREATE UNIQUE INDEX lifecycle_steps_workflow_order_idx
  ON lifecycle_steps(workflow_id, step_order);

CREATE TABLE growth_referral_links (
  invitation_id text PRIMARY KEY,
  household_id text NOT NULL,
  referral_id text NOT NULL UNIQUE REFERENCES referrals(id) ON DELETE CASCADE,
  created_event_id text NOT NULL UNIQUE REFERENCES outbox_events(id) ON DELETE RESTRICT,
  activated_event_id text UNIQUE REFERENCES outbox_events(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (household_id, invitation_id)
    REFERENCES invitations(household_id, id) ON DELETE CASCADE
);

CREATE INDEX growth_referral_links_household_idx
  ON growth_referral_links(household_id, updated_at DESC);

CREATE TABLE growth_orientation_measurements (
  household_id text NOT NULL,
  person_id text NOT NULL,
  started_at timestamptz,
  last_step_at timestamptz,
  completed_at timestamptz,
  attention_observed_at timestamptz,
  stalled_observed_at timestamptz,
  first_check_after_start_at timestamptz,
  first_check_after_completion_at timestamptz,
  last_event_id text NOT NULL REFERENCES outbox_events(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, person_id),
  FOREIGN KEY (household_id, person_id)
    REFERENCES orientation_states(household_id, person_id) ON DELETE CASCADE,
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at),
  CHECK (
    first_check_after_start_at IS NULL
    OR started_at IS NOT NULL AND first_check_after_start_at >= started_at
  ),
  CHECK (
    first_check_after_completion_at IS NULL
    OR completed_at IS NOT NULL AND first_check_after_completion_at >= completed_at
  )
);

CREATE INDEX growth_orientation_completion_idx
  ON growth_orientation_measurements(completed_at, first_check_after_completion_at);

CREATE TABLE growth_health_interventions (
  household_id text PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  work_case_id text NOT NULL UNIQUE REFERENCES hq_work_cases(id) ON DELETE CASCADE,
  latest_snapshot_id text NOT NULL REFERENCES customer_health_snapshots(id) ON DELETE RESTRICT,
  latest_source_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('open', 'resolved')),
  opened_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CHECK (
    (state = 'open' AND resolved_at IS NULL)
    OR (state = 'resolved' AND resolved_at IS NOT NULL)
  )
);
