# ADR-0005: Transactional Outbox and At-Least-Once Delivery

Status: **Accepted; local dispatcher only in Build Run 1**

Decision date: 2026-08-15

## Context

Consent, entitlements, analysis, audit, notifications, provider callbacks, and analytics must not drift because a database commit succeeds while a message publish fails. Exactly-once delivery is not a credible general promise.

## Decision

Commit domain state, content-free security audit, and versioned outbox rows in one PostgreSQL transaction. A dispatcher leases outbox records and delivers at least once. Consumers record inbox receipts/idempotency keys before applying side effects. Preserve per-aggregate sequence where ordering matters; retries use bounded backoff, then a dead-letter state with operator replay.

Events use the envelope in `32-event-model.md`: opaque IDs, type/version, aggregate, tenant, actor reference, correlation/causation, occurrence time, classification, and a minimized schema payload. They contain no artifact body, URL, contact destination, secret, token, model prompt/output, or payment instrument. Consumers tolerate additive fields and explicitly migrate breaking versions.

Build Run 1 may dispatch content-free local work in process. External communications remain disabled; this is not durable production delivery. Before side effects, deploy a durable worker, alerting, dead-letter tooling, replay authorization, and reconciliation.

## Consequences

State and publish intent remain atomic and vendors are isolated from request transactions. Duplicate delivery is normal, so every consumer needs idempotency and reconciliation. The outbox adds storage/operations and requires retention controls.

Rejected: synchronous vendor calls inside transactions, dual writes, fire-and-forget tasks, database polling without leases, and “exactly once” claims.

## Verification

Crash/retry tests prove no missing intent, duplicate safety, sequence behavior, redaction, poison-message isolation, and replay audit.
