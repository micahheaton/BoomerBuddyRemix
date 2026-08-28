CREATE TABLE member_learning_operation_receipts (
  household_id text NOT NULL,
  person_id text NOT NULL,
  operation_key_hash text NOT NULL CHECK (operation_key_hash ~ '^[a-f0-9]{64}$'),
  action_kind text NOT NULL CHECK (action_kind IN (
    'lesson_start',
    'lesson_answer',
    'preferences_update',
    'weekly_rehearsal_complete',
    'feed_item_update'
  )),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  canonical_result jsonb NOT NULL CHECK (
    (action_kind = 'lesson_answer'
      AND jsonb_typeof(canonical_result) = 'object'
      AND jsonb_typeof(canonical_result -> 'correct') = 'boolean'
      AND jsonb_typeof(canonical_result -> 'feedback') = 'string'
      AND char_length(canonical_result ->> 'feedback') BETWEEN 1 AND 500
      AND jsonb_typeof(canonical_result -> 'appliedAt') = 'string'
      AND canonical_result - ARRAY['schemaVersion', 'correct', 'feedback', 'appliedAt'] = '{}'::jsonb
      AND canonical_result ->> 'schemaVersion' = '1')
    OR
    (action_kind <> 'lesson_answer'
      AND jsonb_typeof(canonical_result) = 'object'
      AND jsonb_typeof(canonical_result -> 'appliedAt') = 'string'
      AND canonical_result - ARRAY['schemaVersion', 'appliedAt'] = '{}'::jsonb
      AND canonical_result ->> 'schemaVersion' = '1')
  ),
  contains_customer_content boolean NOT NULL DEFAULT false
    CHECK (contains_customer_content = false),
  created_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, person_id, operation_key_hash),
  UNIQUE (operation_key_hash),
  FOREIGN KEY (household_id, person_id)
    REFERENCES household_memberships(household_id, person_id) ON DELETE CASCADE,
  CHECK (created_at = completed_at),
  CHECK ((canonical_result ->> 'appliedAt')::timestamptz = completed_at)
);

CREATE INDEX member_learning_operation_receipts_person_idx
  ON member_learning_operation_receipts(household_id, person_id, completed_at DESC);

CREATE FUNCTION reject_member_learning_operation_receipt_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Member learning operation receipts are immutable';
END;
$$;

CREATE TRIGGER member_learning_operation_receipts_immutable
BEFORE UPDATE OR DELETE ON member_learning_operation_receipts
FOR EACH ROW EXECUTE FUNCTION reject_member_learning_operation_receipt_mutation();
