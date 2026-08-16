# 18 — Customer Lifecycle Foundation

Status: **product-event lifecycle projection, durable workflow advancement, explainable health, and approved local-test notifications are implemented; external delivery and observed customer outcomes are blocked**.

## Implemented runtime

The lifecycle vocabulary covers signup, first Check, orientation progress/stall, trial/paid states, payment failure/recovery, cancellation, win-back eligibility, and referral milestones. The growth projector consumes allowlisted content-free product outbox facts, idempotently starts or advances the appropriate lifecycle plan, and recalculates transparent customer-health snapshots. Health interventions can create or update HQ work cases from current local product state; they are not opaque scores or observed retention outcomes.

Durable `lifecycle.advance` and `customer-health.recalculate` jobs run through the shared queue. Approved-message steps can materialize only allowlisted template keys into `notification.dispatch`. Run 2 permits the `local_test` sink only: it writes a durable content-free test receipt and advances the workflow. Dead-letter replay retains one logical request and audited lineage. There is no external destination or provider call.

Communication policy still blocks suppression violations, unconsented win-back, unapproved templates/campaigns, and novel safety advice. Consumer SMS requires professional review. Worker execution rechecks the stored policy boundary rather than treating an event as permanent authority.

Evidence: [lifecycle rules](../../packages/business-os/src/customer-health.ts), [growth projector](../../packages/persistence/src/growth-runtime.ts), [operational dispatch](../../packages/persistence/src/operational-work.ts), and [worker integration tests](../../tests/integration/operational-worker.test.ts).

## External boundary

No Postmark/Twilio account, production template approval, external address, provider delivery, bounce/complaint receipt, quiet-hours/locale policy, preference center, production suppression synchronization, staffed queue, or customer outcome exists. A `test_delivered` receipt means only that the local test sink durably completed; it must never be reported as an email, SMS, push, or customer contact.

Run 3 must select and review a sandbox provider, enforce consent and suppression before enqueue and again before send, prove provider idempotency/reconciliation, and observe delivery/failure without artifact content. Health thresholds need consented research and real workload evidence. Fear, fake urgency, and claims that inactivity makes a household unsafe remain prohibited.

See [Member Orientation](./19-member-orientation.md), [Production Data and Jobs](./24-production-data-and-jobs.md), and [Known Limitations](./32-known-limitations.md).

External delivery and launch remain unauthorized.
