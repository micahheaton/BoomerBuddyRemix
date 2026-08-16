# Production Data and Jobs

Status: **durable queue/outbox mechanics implemented and focused-test verified on PGlite; managed PostgreSQL and production operations are unproved**.

## Data contract

Forward SQL migrations remain canonical. PGlite provides deterministic local integration evidence; a standard `pg` adapter supports PostgreSQL. Job envelopes are versioned, classified, household-scoped where applicable, content-bounded, hashed, and idempotent. Restricted keys and credential-, URL-, or content-shaped values are rejected before persistence.

## Durable execution

The database queue implements queued, running, retry, succeeded, dead-letter, and canceled states; `FOR UPDATE SKIP LOCKED` claims; expiring leases; bounded jittered retry; attempt history; content-free errors; operator-attributed dead-letter replay; worker heartbeats; and graceful lease relinquishment. Consumer receipts give handler-level idempotency. Job and receipt heartbeat renewal is one transaction, and completion fails if either lease was lost.

The transactional outbox has equivalent claim, heartbeat, completion, retry/dead-letter, replay, and shutdown behavior. The portable worker currently registers retention and, when Stripe test configuration exists, commerce reconciliation. There is no production email/SMS/analytics dispatcher; outbox durability should not be confused with delivered external messages.

Retention runs in bounded batches, nulls Check ciphertext/fingerprints/analysis details at the 30-day due time, leaves content-free proof, and physically purges terminal anonymous Public Check rows after their shorter horizon.

## Evidence

- `packages/persistence/src/jobs.test.ts` covers conflicting idempotency evidence, leases, retries/dead-letter, restricted payloads, atomic receipt heartbeat, double-claim prevention, and lost completion.
- `packages/platform/src/worker.test.ts` covers long-running heartbeat, lost outbox leases, and one shared shutdown.
- `packages/platform/src/retention.test.ts` covers collision-free continuation scheduling.
- `tests/security/retention.test.ts` covers content destruction, audit/outbox proof, and multi-batch continuation.

## Production boundary

GitHub Actions defines PostgreSQL 17.6 migration idempotency and competing-worker claim verification, but it was not executed on this local host. Neon, connection pooling, capacity/load tests, failover, point-in-time recovery, replicas, backup encryption, restore, migration rollback rehearsal, worker autoscaling, alerting, and operator runbooks are **blocked by managed infrastructure and staging evidence**. No production data exists; no launch.

See [ADR-0016](../adr/0016-durable-database-backed-jobs-and-outbox.md).
