# ADR-0016: Durable Database-Backed Jobs and Outbox Delivery

Status: **Accepted Run 2 design; local and real-PostgreSQL proof required; production multi-instance operations blocked by staging infrastructure**

Decision date: 2026-08-16

## Context

Run 1 atomically writes domain changes, audit, and outbox intent, but its dispatcher and retention sweep are in-process. Restarts, multiple instances, poison work, and delayed provider callbacks require durable state, leases, idempotency, observable retries, and controlled replay. A proprietary workflow service would undermine the portable baseline before operating needs are measured.

## Supersession

This ADR supersedes the “local dispatcher only” and future-worker portions of [ADR-0005](./0005-transactional-outbox-and-at-least-once-events.md)'s Decision and Verification. ADR-0005's atomic outbox, minimized event envelope, at-least-once delivery, inbox idempotency, and rejection of exactly-once claims remain authoritative.

## Decision

Use standard PostgreSQL as the canonical durable work store. A job records type/version, minimized payload or resource reference, tenant/classification, idempotency and deduplication keys, state, priority, scheduled time, bounded attempt count, next attempt, lease owner/expiry, heartbeat, last content-free failure class, correlation/causation, and completion/dead-letter timestamps.

Workers claim bounded batches transactionally with ordered `FOR UPDATE SKIP LOCKED`, set an expiring lease, then perform work outside the claim transaction. Heartbeats extend only a still-owned lease. Expired leases are reclaimable. Retry uses bounded exponential backoff with jitter and a type-specific ceiling; poison work enters quarantine/dead letter. Replay requires scoped operator authority, reason, audit, fresh idempotency, and a kill switch. Shutdown stops claims, finishes or relinquishes work within a deadline, and records health.

Outbox delivery uses the same lease discipline. Consumers write an inbox receipt/idempotency record before applying a side effect and reconcile with provider truth where available. Where the domain requires ordering, each aggregate has a causal position: an unresolved poison event blocks its successors until an audited replay chain resolves at the original position. Growth projections key their receipt to one immutable canonical root across every replay generation; the root, projected delivery, and replay-parent foreign keys are deletion-restricted while that evidence or a descendant exists. Scheduled retention, invitation expiry, reconciliation, privacy operations, owner briefs, growth projections, approved communications, intelligence refresh, and governed evaluation use typed jobs. In-process timers may wake a worker but are never the durable schedule.

Payloads exclude artifact bodies, URLs, contact destinations, tokens, secrets, raw provider payloads, and unnecessary PII. Workers resolve narrowly authorized resources at execution time and fail closed if consent, entitlement, approval, or grant has changed. Run 2 does not enable external messages merely because the job engine exists.

## Consequences

The team operates a queue schema, worker process, dead-letter tooling, and table retention, but avoids another required service and keeps atomic domain-to-intent writes. At-least-once semantics make idempotency and reconciliation mandatory. `SKIP LOCKED` is suitable for queue-like consumers, not general consistency.

Run 2 registers durable acquisition, lifecycle, customer-health, notification, intelligence-refresh, and evaluation handlers. Approved notifications terminate at a local test sink; intelligence work records governed draft/freshness evidence without activating content; evaluation persists a content-free summary. Durable intent is not external delivery, publication, or provider execution.

## Migration and rollback

The forward migrations add durable job, attempt, receipt, lease, outbox-delivery, causal-position, and canonical replay-lineage state without converting an unrecorded timer into completed work. Migration `0012` backfills the root for an existing projected replay, fails closed on malformed or duplicate lineage, and replaces permissive deletion behavior with restrictive foreign keys. Any pending legacy outbox intent is claimed only through the new idempotent path, and recurring work is registered once with deterministic keys. Before multiple workers start, schema, claim ordering, lease expiry, receipt uniqueness, and retry/dead-letter behavior must pass against the target PostgreSQL version.

Rollback stops new claims, lets owned work complete or explicitly relinquish, records the last safe cursor, and disables external consumers before changing worker code. Job, attempt, receipt, dead-letter, and outbox history remains available for reconciliation; tables are not dropped while effects may exist. A temporary manual or single-worker path may resume only from canonical queued state and the same idempotency contract—never from process memory or by replaying every row blindly.

## Security and privacy consequences

Queues can become a covert data lake or privilege bypass. Payload schemas exclude artifact content, destinations, credentials, URLs, provider payloads, and unnecessary PII; workers use separate least-privilege credentials and reauthorize the referenced resource at execution. Lease, replay, dead-letter, and cancellation operations require scoped operator identity, reason, immutable audit, and rate limits. Error/observability fields stay content-free, and backups, retention, cross-tenant isolation, poison-work inspection, and provider-side reconciliation require security review.

## Rejected alternatives

- Fire-and-forget promises, process memory, or timers as durable state.
- Synchronous vendor calls inside domain transactions.
- One global cron lock without leases or per-item history.
- Exactly-once delivery claims.
- A vendor workflow engine as the only canonical work record.

## Verification

Real-PostgreSQL verification covers competing workers, crash after claim, lease expiry/reclaim, heartbeat ownership, duplicate delivery, scheduled order, consumer receipts, retries/jitter ceilings, dead-letter isolation, audited replay, causal poison blocking/replay, shutdown, and reconciliation intent. Local integration tests cover growth projections and local-test notification/intelligence/evaluation handlers. Security tests cover tenant scope, revoked authority at execution, minimized payloads, log/error redaction, approval gates, and kill switches. Frozen real-server execution evidence remains a release gate.

## Evidence boundary

The schema, worker, causal replay tooling, growth projections, and content-free operational handlers are implemented locally. Production throughput, failover, alert routing, backup/restore, multi-instance shutdown, external delivery, live intelligence refresh, and provider-side reconciliation remain blocked until staging infrastructure, accounts, and accountable operators exist.

## Primary sources

The queue claim design was checked 2026-08-16 against PostgreSQL's current [`SELECT` locking clause](https://www.postgresql.org/docs/current/sql-select.html), which identifies `SKIP LOCKED` as appropriate for queue-like consumers, plus [transaction-isolation](https://www.postgresql.org/docs/current/transaction-iso.html) and [explicit-locking](https://www.postgresql.org/docs/current/explicit-locking.html) documentation.
