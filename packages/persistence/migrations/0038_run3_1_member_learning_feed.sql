CREATE TABLE member_learning_progress (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  lesson_key text NOT NULL CHECK (
    lesson_key IN (
      'pause_under_pressure',
      'verify_independently',
      'protect_codes_and_passwords',
      'question_unusual_payments',
      'confirm_family_emergencies',
      'refuse_remote_access',
      'recover_after_a_mistake'
    )
  ),
  lesson_version integer NOT NULL CHECK (lesson_version > 0),
  state text NOT NULL CHECK (state IN ('in_progress', 'completed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  review_count integer NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  last_answer_correct boolean,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  last_reviewed_at timestamptz,
  review_due_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, person_id, lesson_key, lesson_version),
  FOREIGN KEY (household_id, person_id)
    REFERENCES household_memberships(household_id, person_id) ON DELETE CASCADE,
  CHECK (
    (state = 'in_progress' AND completed_at IS NULL)
    OR (state = 'completed' AND completed_at IS NOT NULL)
  ),
  CHECK (started_at <= updated_at),
  CHECK (completed_at IS NULL OR completed_at >= started_at),
  CHECK (last_reviewed_at IS NULL OR completed_at IS NOT NULL),
  CHECK (review_due_at IS NULL OR completed_at IS NOT NULL),
  CHECK (
    review_due_at IS NULL OR last_reviewed_at IS NULL OR review_due_at >= last_reviewed_at
  )
);

CREATE INDEX member_learning_progress_resume_idx
  ON member_learning_progress(household_id, person_id, state, review_due_at, updated_at);

CREATE TABLE member_learning_preferences (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  coarse_region text NOT NULL DEFAULT 'US' CHECK (coarse_region IN (
    'US', 'US-AL', 'US-AK', 'US-AZ', 'US-AR', 'US-CA', 'US-CO', 'US-CT',
    'US-DE', 'US-DC', 'US-FL', 'US-GA', 'US-HI', 'US-ID', 'US-IL', 'US-IN',
    'US-IA', 'US-KS', 'US-KY', 'US-LA', 'US-ME', 'US-MD', 'US-MA', 'US-MI',
    'US-MN', 'US-MS', 'US-MO', 'US-MT', 'US-NE', 'US-NV', 'US-NH', 'US-NJ',
    'US-NM', 'US-NY', 'US-NC', 'US-ND', 'US-OH', 'US-OK', 'US-OR', 'US-PA',
    'US-RI', 'US-SC', 'US-SD', 'US-TN', 'US-TX', 'US-UT', 'US-VT', 'US-VA',
    'US-WA', 'US-WV', 'US-WI', 'US-WY'
  )),
  weekly_rehearsal_enabled boolean NOT NULL DEFAULT false,
  weekly_rehearsal_enabled_at timestamptz,
  last_rehearsed_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, person_id),
  FOREIGN KEY (household_id, person_id)
    REFERENCES household_memberships(household_id, person_id) ON DELETE CASCADE,
  CHECK (
    (weekly_rehearsal_enabled AND weekly_rehearsal_enabled_at IS NOT NULL)
    OR (NOT weekly_rehearsal_enabled AND weekly_rehearsal_enabled_at IS NULL)
  ),
  CHECK (
    last_rehearsed_at IS NULL OR last_rehearsed_at <= updated_at
  )
);

CREATE TABLE member_in_app_feed_receipts (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  item_key text NOT NULL CHECK (item_key ~ '^[a-z][a-z0-9:_-]{2,190}$'),
  item_version integer NOT NULL CHECK (item_version > 0),
  state text NOT NULL CHECK (state IN ('read', 'dismissed')),
  read_at timestamptz,
  dismissed_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, person_id, item_key, item_version),
  FOREIGN KEY (household_id, person_id)
    REFERENCES household_memberships(household_id, person_id) ON DELETE CASCADE,
  CHECK (
    (state = 'read' AND read_at IS NOT NULL AND dismissed_at IS NULL)
    OR (state = 'dismissed' AND dismissed_at IS NOT NULL)
  )
);

CREATE INDEX member_in_app_feed_receipts_person_idx
  ON member_in_app_feed_receipts(household_id, person_id, updated_at DESC);

CREATE TABLE member_scam_guidance_briefs (
  brief_key text NOT NULL CHECK (brief_key ~ '^[a-z][a-z0-9_-]{2,79}$'),
  version integer NOT NULL CHECK (version > 0),
  region_code text NOT NULL CHECK (region_code IN (
    'US', 'US-AL', 'US-AK', 'US-AZ', 'US-AR', 'US-CA', 'US-CO', 'US-CT',
    'US-DE', 'US-DC', 'US-FL', 'US-GA', 'US-HI', 'US-ID', 'US-IL', 'US-IN',
    'US-IA', 'US-KS', 'US-KY', 'US-LA', 'US-ME', 'US-MD', 'US-MA', 'US-MI',
    'US-MN', 'US-MS', 'US-MO', 'US-MT', 'US-NE', 'US-NV', 'US-NH', 'US-NJ',
    'US-NM', 'US-NY', 'US-NC', 'US-ND', 'US-OH', 'US-OK', 'US-OR', 'US-PA',
    'US-RI', 'US-SC', 'US-SD', 'US-TN', 'US-TX', 'US-UT', 'US-VT', 'US-VA',
    'US-WA', 'US-WV', 'US-WI', 'US-WY'
  )),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 800),
  safe_actions jsonb NOT NULL CHECK (
    jsonb_typeof(safe_actions) = 'array' AND jsonb_array_length(safe_actions) BETWEEN 1 AND 8
  ),
  source_title text NOT NULL CHECK (char_length(source_title) BETWEEN 1 AND 160),
  source_url text NOT NULL CHECK (
    char_length(source_url) BETWEEN 10 AND 500 AND source_url ~ '^https://[^[:space:]]+$'
  ),
  source_published_at timestamptz NOT NULL,
  reviewed_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  source_kind text NOT NULL CHECK (source_kind = 'public_official'),
  review_state text NOT NULL CHECK (review_state = 'approved'),
  publication_state text NOT NULL CHECK (publication_state = 'in_app_only'),
  automation_generated boolean NOT NULL CHECK (automation_generated = false),
  external_delivery_permitted boolean NOT NULL CHECK (external_delivery_permitted = false),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (brief_key, version),
  CHECK (source_published_at <= reviewed_at),
  CHECK (reviewed_at <= published_at),
  CHECK (published_at < expires_at)
);

CREATE INDEX member_scam_guidance_region_freshness_idx
  ON member_scam_guidance_briefs(region_code, published_at DESC, expires_at DESC);

CREATE FUNCTION validate_member_learning_active_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM household_memberships membership
    WHERE membership.household_id = NEW.household_id
      AND membership.person_id = NEW.person_id
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Member learning requires active household membership';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER member_learning_progress_active_membership
BEFORE INSERT OR UPDATE ON member_learning_progress
FOR EACH ROW EXECUTE FUNCTION validate_member_learning_active_membership();

CREATE TRIGGER member_learning_preferences_active_membership
BEFORE INSERT OR UPDATE ON member_learning_preferences
FOR EACH ROW EXECUTE FUNCTION validate_member_learning_active_membership();

CREATE TRIGGER member_in_app_feed_receipts_active_membership
BEFORE INSERT OR UPDATE ON member_in_app_feed_receipts
FOR EACH ROW EXECUTE FUNCTION validate_member_learning_active_membership();

CREATE FUNCTION reject_member_scam_guidance_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published member scam guidance is immutable; add a new version';
END;
$$;

CREATE TRIGGER member_scam_guidance_immutable
BEFORE UPDATE OR DELETE ON member_scam_guidance_briefs
FOR EACH ROW EXECUTE FUNCTION reject_member_scam_guidance_mutation();

INSERT INTO member_scam_guidance_briefs(
  brief_key, version, region_code, title, summary, safe_actions,
  source_title, source_url, source_published_at, reviewed_at,
  published_at, expires_at, source_kind, review_state, publication_state,
  automation_generated, external_delivery_permitted, created_at
) VALUES (
  'us-imposter-scam-trends',
  1,
  'US',
  'Imposter messages: pause and verify outside the message',
  'The FTC describes imposter schemes that may mimic familiar programs or build trust before asking for money. Treat an urgent claim as unverified until you reach the relevant organization through a channel you find independently.',
  '["Do not use the phone number or link in the message.","Find the organization through its official app, statement, card, or known website.","Do not send money to a new online contact you have not verified independently.","Report suspected fraud through ReportFraud.ftc.gov when it is safe to do so."]'::jsonb,
  'FTC: New trends in reports of imposter scams',
  'https://consumer.ftc.gov/consumer-alerts/2026/05/new-trends-reports-imposter-scams',
  '2026-05-07T12:00:00.000Z',
  '2026-08-27T12:00:00.000Z',
  '2026-08-27T12:00:00.000Z',
  '2026-11-25T12:00:00.000Z',
  'public_official',
  'approved',
  'in_app_only',
  false,
  false,
  '2026-08-27T12:00:00.000Z'
), (
  'ca-court-notice-payment-scam',
  1,
  'US-CA',
  'California: fake court and toll payment notices',
  'The California Department of Justice warns about texts or emails that pretend to be court notices, claim an unpaid traffic or toll matter, and demand immediate payment. Do not treat the message or its payment link as an official court channel.',
  '["Do not click a link or scan a QR code in the notice.","Check for a real case through the California Courts website or a court number you find independently.","Do not send payment or financial information by reply.","If you already paid or shared information, contact the financial institution and secure affected accounts."]'::jsonb,
  'California DOJ: Court notice scam warning',
  'https://oag.ca.gov/news/press-releases/pay-you%E2%80%99re-trouble-attorney-general-bonta-warns-californians-court-notice-scams',
  '2026-03-30T12:00:00.000Z',
  '2026-08-27T12:00:00.000Z',
  '2026-08-27T12:00:00.000Z',
  '2026-11-25T12:00:00.000Z',
  'public_official',
  'approved',
  'in_app_only',
  false,
  false,
  '2026-08-27T12:00:00.000Z'
);
