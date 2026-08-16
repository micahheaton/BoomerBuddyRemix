# 18 — Customer Lifecycle Foundation

Status: **deterministic trigger plans, workflow persistence, explainable health, support routing, and suppression records are implemented and tested in isolation; product events and message delivery are not wired**.

## Implemented policy layer

The lifecycle vocabulary covers signup/incomplete signup, first Check, orientation start/abandonment, missing Trusted Circle/practice Check, trial start/end, conversion, failed/recovered payment, renewal, cancellation intent/cancellation, win-back eligibility, and referral success. Each trigger maps to an internal task, approved message, wait, or decision step.

Workflow creation is idempotent when given a trigger event ID. A non-consented win-back produces a suppressed workflow with no steps; marketing consent is required for that path. Communication policy blocks suppression violations, unconsented lifecycle messages, unapproved templates, and unapproved B2B campaigns. Consumer SMS requires professional review; novel safety advice always requires approval.

Customer health is a transparent ruleset. Orientation, Check completion, Trusted Circle, family participation, mobile installation, payment failure, cancellation intent, unresolved incident, open support, and inactivity contribute named points and an explanation. The result is versioned and persisted as a snapshot, not an opaque AI score. Support routing sends high-severity, fraud, or artifact-access cases to Trust & Safety; billing and security/privacy remain specialist classes.

Evidence: [lifecycle and health rules](../../packages/business-os/src/customer-health.ts), [communication policy](../../packages/business-os/src/revenue.ts), [repository](../../packages/persistence/src/business-os.ts), [schema](../../packages/persistence/migrations/0005_run2_business_os.sql), and [tests](../../packages/persistence/src/business-os.test.ts).

## Not yet an operating lifecycle

No signup, orientation, commerce, retention, referral, or product-activity event currently calls `startLifecycle` or refreshes customer health. No worker advances steps. There are no approved production templates, Postmark/Twilio adapters, consent preference center, delivery receipts, bounce/complaint handling, quiet hours, locale rules, experimentation, intervention queue screen, or staff owner. A suppression row is not yet synchronized with any sender.

The Stripe path creates billing-reconciliation attention when evidence is ambiguous, but it does not dispatch customer lifecycle messages. The six-step member orientation is real and documented separately; the lifecycle wrapper around it is not connected.

## Launch gate

Run 3 must map each product event to a content-free versioned envelope, prove replay/idempotency, obtain template and consent/legal approval, connect a sandbox sender, enforce suppressions before enqueue and again before send, and record delivery/failure without artifact content. Health thresholds require customer research and workload validation. Fear, fake urgency, or claims that inactivity makes a household unsafe are prohibited.

See [Member Orientation](./19-member-orientation.md), [Owner Attention](./21-owner-attention.md), and [Known Limitations](./32-known-limitations.md).
