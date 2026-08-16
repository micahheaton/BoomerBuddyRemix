# 21 — Owner Attention Queue

Status: **deduplicated founder-attention persistence, owner-only retrieval, HQ presentation, and Stripe reconciliation producers are implemented and tested locally; disposition controls, delivery, and operating ownership are incomplete**.

## Working contract

Every item records:

- attention kind and source reference;
- why founder involvement is required;
- recommended action;
- consequence of inaction;
- optional deadline;
- open/snoozed/resolved/dismissed state; and
- creation/update timestamps.

An active deduplication key prevents repeated failures from flooding the founder. Re-observation refreshes the reason, recommendation, consequence, deadline, and update time on the existing item. The queue returns open and snoozed records ordered by deadline and then creation time.

The real producer is Stripe test reconciliation. Missing canonical binding, unsupported invoice events, evidence mismatch, partial refund, and dispute can create a `billing_reconciliation` item while canonical access remains unchanged or safely restricted. This connects an operational exception to a founder-visible consequence rather than silently granting access.

Evidence: [repository](../../packages/persistence/src/business-os.ts), [commerce producer](../../apps/api/src/routes/commerce.ts), [worker producer](../../apps/worker/src/commerce-reconciliation.ts), [HQ view](../../apps/hq/src/components/business-os.tsx), [persistence test](../../packages/persistence/src/business-os.test.ts), and [Stripe integration test](../../tests/integration/stripe-commerce.test.ts).

## What the queue does not do

The public API is read-only. There is no owner endpoint to resolve, dismiss, snooze, assign, comment, attach evidence, or record a decision. The schema supports those states, but transitions are not implemented. There is no email/SMS/push delivery, escalation timer, backup executive, acknowledgement SLA, calendar, or incident paging. Content, privacy, hiring, spend, partner, and policy workflows do not yet produce live items.

The queue is owner-only. That is the correct Run 2 least-privilege default, not the final staffing model. A queue entry does not itself supply professional judgment, perform reconciliation, or make a safe action happen.

## Operating gate

Run 3 should add explicit state-transition evidence, actor/reason, linked audit/outbox, assignment/backup, due/overdue semantics, and source-specific resolution checks. Notifications must contain no customer artifact or sensitive provider payload. Test deduplication under repeated failures and tune noise in an owner rehearsal before relying on it.

Only matters that genuinely need founder credibility, capital authority, material risk acceptance, or a founder relationship belong here. Routine tasks should route to a system or named staff queue; legal, tax, accounting, privacy, and security accountability remains `PROFESSIONAL`, not disguised founder approval. See the [Autonomy Matrix](./AUTONOMY-MATRIX.md).
