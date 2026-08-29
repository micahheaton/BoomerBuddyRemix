DO $$
DECLARE
  canonical_result_constraint text;
BEGIN
  SELECT constraint_record.conname
  INTO canonical_result_constraint
  FROM pg_constraint constraint_record
  JOIN pg_class relation_record
    ON relation_record.oid = constraint_record.conrelid
  JOIN pg_namespace namespace_record
    ON namespace_record.oid = relation_record.relnamespace
  WHERE namespace_record.nspname = 'public'
    AND relation_record.relname = 'member_learning_operation_receipts'
    AND constraint_record.contype = 'c'
    AND pg_get_constraintdef(constraint_record.oid) LIKE '%action_kind%'
    AND pg_get_constraintdef(constraint_record.oid) LIKE '%canonical_result%'
  LIMIT 1;

  IF canonical_result_constraint IS NULL THEN
    RAISE EXCEPTION 'Member learning canonical result constraint is unavailable';
  END IF;

  EXECUTE 'ALTER TABLE member_learning_operation_receipts DROP CONSTRAINT '
    || quote_ident(canonical_result_constraint);
END;
$$;

ALTER TABLE member_learning_operation_receipts
  ADD CONSTRAINT member_learning_operation_receipts_canonical_result_check CHECK (
    (action_kind = 'lesson_answer'
      AND jsonb_typeof(canonical_result) = 'object'
      AND jsonb_typeof(canonical_result -> 'correct') = 'boolean'
      AND jsonb_typeof(canonical_result -> 'feedback') = 'string'
      AND char_length(canonical_result ->> 'feedback') BETWEEN 1 AND 500
      AND jsonb_typeof(canonical_result -> 'appliedAt') = 'string'
      AND canonical_result - ARRAY['schemaVersion', 'correct', 'feedback', 'appliedAt'] = '{}'::jsonb
      AND canonical_result ->> 'schemaVersion' = '1')
    OR
    (action_kind = 'weekly_rehearsal_complete'
      AND jsonb_typeof(canonical_result) = 'object'
      AND jsonb_typeof(canonical_result -> 'saferChoice') = 'boolean'
      AND jsonb_typeof(canonical_result -> 'feedback') = 'string'
      AND char_length(canonical_result ->> 'feedback') BETWEEN 1 AND 500
      AND jsonb_typeof(canonical_result -> 'appliedAt') = 'string'
      AND canonical_result - ARRAY['schemaVersion', 'saferChoice', 'feedback', 'appliedAt'] = '{}'::jsonb
      AND canonical_result ->> 'schemaVersion' = '1')
    OR
    (action_kind = 'weekly_rehearsal_complete'
      AND jsonb_typeof(canonical_result) = 'object'
      AND jsonb_typeof(canonical_result -> 'appliedAt') = 'string'
      AND canonical_result - ARRAY['schemaVersion', 'appliedAt'] = '{}'::jsonb
      AND canonical_result ->> 'schemaVersion' = '1')
    OR
    (action_kind NOT IN ('lesson_answer', 'weekly_rehearsal_complete')
      AND jsonb_typeof(canonical_result) = 'object'
      AND jsonb_typeof(canonical_result -> 'appliedAt') = 'string'
      AND canonical_result - ARRAY['schemaVersion', 'appliedAt'] = '{}'::jsonb
      AND canonical_result ->> 'schemaVersion' = '1')
  );
