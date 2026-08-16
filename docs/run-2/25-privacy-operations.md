# Privacy Operations

Status: **data minimization plus content-free request verification, review, and planning are implemented locally; rights fulfillment and compliance operations are not**.

## Implemented controls

Member Check input is safely redacted or rejected before analysis, then stored with contextual AES-256-GCM encryption. Fingerprints use a separate scoped keyed digest. Logs recursively sanitize sensitive values, and audit/outbox/job envelopes are content-free by contract. Retention and deletion paths remove Check ciphertext, fingerprints, explanations, and actions while retaining only minimized operational proof. Public Check uses short-lived encrypted handoff state, explicit save consent, append-only conversion evidence, and physical terminal purge.

Authenticated customer/mobile users can submit access, export, deletion, correction, or restriction requests. Append-only request events preserve history. Authorized HQ actions can:

1. record identity verification;
2. begin human review; and
3. create an immutable, idempotent, content-free evidence plan.

The plan records only categories and counts for bounded data locations, sets `contains_customer_content=false`, and requires professional review. Opaque evidence references pass restricted-input validation. Audit and outbox facts contain no customer submission. The API labels this boundary `evidence_plan_only` and `fulfillmentPerformed: false`.

Evidence: [privacy/public-abuse migration](../../packages/persistence/migrations/0008_run2_public_abuse_privacy.sql), the owner/customer privacy routes, and the focused integration/security tests included in the frozen [Run 2 report](../BUILD-RUN-2-REPORT.md).

## Operational gaps

No code exports a subject package, deletes/corrects/restricts every discovered record, propagates a request to processors/backups, records a legally reviewed exemption, sends a notice, or completes fulfillment. Verification and an evidence plan are preparation, not a fulfilled data-subject right.

There is also no approved processor inventory, complete retention schedule, DPA set, records of processing, jurisdiction/region decision, production KMS/rotation, object-store lifecycle, backup deletion policy, legal hold workflow, breach exercise, or qualified privacy adjudication. These are **first-customer/first-dollar blockers** requiring managed infrastructure and accountable humans. The current code is not compliance certification. Run 2 does not launch.
