ALTER TABLE growth_event_receipts
  ADD COLUMN root_event_id text;

WITH RECURSIVE receipt_lineage AS (
  SELECT receipt.event_id AS receipt_event_id,
         event.id,
         event.replay_of_event_id
  FROM growth_event_receipts receipt
  JOIN outbox_events event ON event.id = receipt.event_id

  UNION

  SELECT lineage.receipt_event_id,
         parent.id,
         parent.replay_of_event_id
  FROM receipt_lineage lineage
  JOIN outbox_events parent ON parent.id = lineage.replay_of_event_id
), receipt_roots AS (
  SELECT receipt_event_id, id AS root_event_id
  FROM receipt_lineage
  WHERE replay_of_event_id IS NULL
)
UPDATE growth_event_receipts receipt
SET root_event_id = root.root_event_id
FROM receipt_roots root
WHERE receipt.event_id = root.receipt_event_id;

ALTER TABLE growth_event_receipts
  ALTER COLUMN root_event_id SET NOT NULL,
  DROP CONSTRAINT growth_event_receipts_event_id_fkey,
  ADD CONSTRAINT growth_event_receipts_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES outbox_events(id) ON DELETE RESTRICT,
  ADD CONSTRAINT growth_event_receipts_root_event_unique UNIQUE (root_event_id),
  ADD CONSTRAINT growth_event_receipts_root_event_id_fkey
    FOREIGN KEY (root_event_id) REFERENCES outbox_events(id) ON DELETE RESTRICT;

ALTER TABLE outbox_events
  DROP CONSTRAINT outbox_events_replay_of_event_id_fkey,
  ADD CONSTRAINT outbox_events_replay_of_event_id_fkey
    FOREIGN KEY (replay_of_event_id) REFERENCES outbox_events(id) ON DELETE RESTRICT;
