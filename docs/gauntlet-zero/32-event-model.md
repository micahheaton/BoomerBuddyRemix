# Event Model

Status: **designed; Build Run 1 proves transactional outbox/inbox patterns with local handlers and no external customer messaging**.

## Purpose and boundary

Events decouple state transitions from follow-up work without turning the modular monolith into accidental distributed spaghetti. The database record remains authoritative; an event states that an accepted transition occurred. Commands request change; events use past tense.

Raw artifacts, URLs, messages, safe words, private keys, payment-card/authentication credentials, one-time codes, contact destinations, provider secrets/tokens, keyed fingerprints, and unrestricted PII are forbidden in events. Consumers receive opaque references and fetch only through their own authorization/service boundary.

## Envelope

```json
{
  "eventId": "uuid",
  "eventType": "check.analysis.completed",
  "schemaVersion": 1,
  "aggregateType": "analysis",
  "aggregateId": "opaque-id",
  "aggregateSequence": 3,
  "tenant": { "kind": "household", "id": "opaque-id" },
  "actor": { "kind": "person", "id": "opaque-id", "audience": "customer" },
  "occurredAt": "RFC3339 UTC",
  "recordedAt": "RFC3339 UTC",
  "correlationId": "uuid",
  "causationId": "uuid",
  "classification": "internal",
  "payload": {}
}
```

Event type and `schemaVersion` are separate so consumers can route stably and reject/upgrade unsupported payloads. System actors identify the job/provider, not a fabricated person. Trace IDs may correlate telemetry but are not business identities.

## Initial catalog

| Module | Events |
|---|---|
| Identity/security | `account.created`, `session.revoked`, `security.step_up_completed`, `privacy_request.created` |
| Household | `household.created`, `membership.accepted`, `trusted_circle.invited`, `trusted_circle.accepted`, `trusted_circle.permissions_changed`, `trusted_circle.revoked`, `consent.granted`, `consent.revoked`, `safe_word.replaced` |
| Orientation | `orientation.started`, `orientation.step_completed`, `orientation.needs_attention`, `orientation.completed` |
| Check | `check.artifact_submitted`, `check.analysis_completed`, `check.high_concern_detected`, `check.analysis_failed`, `check.result_shared`, `check.artifact_deleted`, `check.feedback_received` |
| Commerce | `subscription.started`, `subscription.lifecycle_changed`, `subscription.cancelled`, `payment.failed`, `payment.recovered`, `entitlement.granted`, `entitlement.revoked`, `commerce.reconciliation_mismatch` |
| Sponsor | `sponsor.eligibility_verified`, `sponsor.entitlement_granted`, `sponsor.eligibility_ended` |
| Operations | `review_case.created`, `support_case.created`, `provider.degraded`, `job.dead_lettered`, `opportunity.stale` (later CRM) |

`check.high_concern_detected` contains analysis/risk/action-policy references only. It does not itself authorize or send an alert. A consent/permission-aware workflow evaluates whether an escalation is allowed and records a separate notification intent/delivery outcome. High-risk detection never silently shares family content.

## Delivery and idempotency

The application transaction writes domain state, audit facts, and an outbox row. A dispatcher leases unpublished rows, emits them, and marks delivery metadata. Delivery is **at least once**: consumers insert an inbox receipt keyed by `(consumer, eventId)` in the same transaction as their effect. Side-effect adapters also use a stable idempotency key.

Ordering is guaranteed only per aggregate using `aggregateSequence`. Consumers ignore duplicates and detect gaps; they must not assume global ordering. Cross-aggregate workflows use explicit process state and correlation/causation, not timestamp guesses. Provider webhooks first enter a signed, deduplicated provider inbox and may then create canonical domain events.

Retry only classified transient failures with capped exponential backoff and jitter. Permanent schema/policy failures move to a dead-letter queue with content-free error code, operator owner, retry/replay action, and audit. Circuit breakers stop provider storms. No infinite retry.

## Replay and evolution

Outbox retention and replay are operational tools, not an event-sourced database. Replaying cannot re-run irreversible side effects blindly. Each handler declares replay behavior: pure projection rebuild, idempotent re-evaluation, operator approval, or prohibited. Dry-run shows planned effects and counts first.

Schemas are append-compatible within a version. Breaking changes create a new version and an upcaster/parallel consumer. Never change historical payload meaning. Contract tests pin examples, unknown fields are tolerated where safe, and unsupported versions fail visibly. Redaction/deletion rules apply to event payloads and archives; the ban on artifact content prevents most conflicts.

## Domain, audit, analytics, and integration events

These are related but distinct:

- **Domain event:** a business transition used by trusted internal workflows.
- **Audit event:** security/compliance evidence including denied attempts; append-only and not a workflow trigger by default.
- **Analytics event:** purpose-limited measurement derived from approved facts, with consent and aggregation rules.
- **Integration event:** minimized stable contract released to another service/partner after security/privacy review.

Do not broadcast the full domain envelope to analytics, sponsors, or partners. Map to a purpose-specific projection and suppress small cells/identifiers.

## Build Run 1 proof

Tests must demonstrate atomic state+outbox+audit, duplicate delivery, handler retry, poison/dead-letter behavior, aggregate ordering/gap detection, schema validation, redaction, and replay-safe projection rebuild. The local dispatcher may run in-process, labeled non-durable. Production notifications, billing, CRM, and partner exports stay disabled until a durable worker and operator controls exist.
