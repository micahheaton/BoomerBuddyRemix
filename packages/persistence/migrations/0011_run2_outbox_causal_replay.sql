CREATE SEQUENCE outbox_events_causal_order_position_seq AS bigint;

ALTER TABLE outbox_events
  ADD COLUMN causal_order_position bigint,
  ADD COLUMN replay_resolved_at timestamptz;

WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY occurred_at, id) AS position
  FROM outbox_events
)
UPDATE outbox_events AS event
SET causal_order_position = ordered.position
FROM ordered
WHERE event.id = ordered.id;

SELECT setval(
  'outbox_events_causal_order_position_seq',
  COALESCE((SELECT max(causal_order_position) FROM outbox_events), 0) + 1,
  false
);

ALTER TABLE outbox_events
  ALTER COLUMN causal_order_position
    SET DEFAULT nextval('outbox_events_causal_order_position_seq'),
  ALTER COLUMN causal_order_position SET NOT NULL,
  ADD CONSTRAINT outbox_replay_resolution_requires_dead_letter
    CHECK (replay_resolved_at IS NULL OR dead_lettered_at IS NOT NULL);

ALTER SEQUENCE outbox_events_causal_order_position_seq
  OWNED BY outbox_events.causal_order_position;

CREATE UNIQUE INDEX outbox_events_single_replay_idx
  ON outbox_events(replay_of_event_id)
  WHERE replay_of_event_id IS NOT NULL;

CREATE INDEX outbox_events_causal_order_idx
  ON outbox_events(
    household_id,
    aggregate_type,
    aggregate_id,
    causal_order_position
  )
  WHERE processed_at IS NULL;
