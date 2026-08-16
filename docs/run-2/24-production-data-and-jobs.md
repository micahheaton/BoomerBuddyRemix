# Production Data and Jobs

Status: **durable queue, causal outbox, growth, notification, intelligence, and evaluation mechanics are implemented locally; managed PostgreSQL and production operations are unproved**.

## Data contract

Forward SQL migrations remain canonical. PGlite provides deterministic local integration behavior; a standard `pg` adapter supports PostgreSQL. Job envelopes are versioned, classified, tenant-scoped where applicable, content-bounded, hashed, and idempotent. Restricted keys and credential-, URL-, destination-, or artifact-shaped values are rejected before persistence.

## Durable execution

The database queue implements transactional `FOR UPDATE SKIP LOCKED` claims, expiring leases, heartbeats, consumer receipts, bounded retry, content-free attempt history, dead letter, audited replay, and graceful relinquishment. Completion fails if ownership or receipt evidence is lost.

The outbox uses equivalent durability and adds per-aggregate causal positions. A poison predecessor blocks later same-aggregate growth work until an audited replay chain completes; replay preserves original ordering and lineage rather than moving a failure behind its successors. Growth receipts use one deletion-restricted canonical root for every replay generation, preventing an already-projected event from repeating durable effects. This is at-least-once execution with idempotent consumers, not an exactly-once claim.

The worker registers retention and test-mode commerce reconciliation plus durable growth and operational work:

- `attribution.process`, `lifecycle.advance`, and `customer-health.recalculate` project allowlisted product facts;
- `notification.dispatch` permits approved templates only and currently terminates at a local test sink;
- `intelligence.refresh` records governed source freshness/draft state without publishing or activating an asset; and
- `evaluation.run` executes the governed local synthetic corpus and persists a content-free summary.

Retention still removes due Check content and terminal anonymous Public Check state in bounded batches. None of these jobs sends an external message, calls a live intelligence provider, publishes content, or proves a customer outcome.

## Checked-in verification surfaces

Focused repository and worker tests cover idempotency, claims, lease loss, retries/dead letter, replay lineage, causal poison blocking, local notification receipts, intelligence/evaluation evidence, restricted payloads, retention, and shutdown; they passed within the frozen unit/integration/security suites summarized in the [Run 2 report](../BUILD-RUN-2-REPORT.md). `scripts/verify-postgres.ts` is expanded to verify migration idempotency, competing claims, heartbeat/reclaim, receipts, scheduled ordering, dead letter/replay, causal outbox poison chains, shutdown, and reconciliation intent against disposable PostgreSQL. The real-PostgreSQL execution remains pending external/CI host availability.

## Production boundary

No hosted PostgreSQL, pool/role design, multi-instance soak, point-in-time recovery, independently restored backup, alert route, provider outage exercise, or staffed dead-letter shift exists. Remote CI and the PostgreSQL verifier still require frozen external execution evidence. No production data exists; no launch.

See [ADR-0016](../adr/0016-durable-database-backed-jobs-and-outbox.md).
