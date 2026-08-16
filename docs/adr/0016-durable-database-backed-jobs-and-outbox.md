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

Outbox delivery uses the same lease discipline. Consumers write an inbox receipt/idempotency record before applying a side effect and reconcile with provider truth where available. Per-aggregate sequence is enforced only where the domain requires it. Scheduled retention, invitation expiry, reconciliation, privacy operations, owner briefs, and approved communications use typed jobs. In-process timers may wake a worker but are never the durable schedule.

Payloads exclude artifact bodies, URLs, contact destinations, tokens, secrets, raw provider payloads, and unnecessary PII. Workers resolve narrowly authorized resources at execution time and fail closed if consent, entitlement, approval, or grant has changed. Run 2 does not enable external messages merely because the job engine exists.

## Consequences

The team operates a queue schema, worker process, dead-letter tooling, and table retention, but avoids another required service and keeps atomic domain-to-intent writes. At-least-once semantics make idempotency and reconciliation mandatory. `SKIP LOCKED` is suitable for queue-like consumers, not general consistency.

## Rejected alternatives

- Fire-and-forget promises, process memory, or timers as durable state.
- Synchronous vendor calls inside domain transactions.
- One global cron lock without leases or per-item history.
- Exactly-once delivery claims.
- A vendor workflow engine as the only canonical work record.

## Verification

Real-PostgreSQL concurrency tests cover competing workers, crash after claim, lease expiry/reclaim, heartbeat ownership, duplicate delivery, ordered aggregates, retries/jitter ceilings, dead-letter isolation, audited replay, shutdown, and reconciliation. Security tests cover tenant scope, revoked authority at execution, minimized payloads, log/error redaction, approval gates, and kill switches. CI exercises migrations and locking on a real server, not only PGlite.

## Evidence boundary

The schema, worker, concurrency tests, and local replay tooling are not account-blocked. Production throughput, failover, alert routing, backup/restore, multi-instance shutdown, and provider-side reconciliation remain blocked until staging infrastructure and provider accounts exist.

## Primary sources

The queue claim design was checked 2026-08-16 against PostgreSQL's current [`SELECT` locking clause](https://www.postgresql.org/docs/current/sql-select.html), which identifies `SKIP LOCKED` as appropriate for queue-like consumers, plus [transaction-isolation](https://www.postgresql.org/docs/current/transaction-iso.html) and [explicit-locking](https://www.postgresql.org/docs/current/explicit-locking.html) documentation.
