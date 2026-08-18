# ADR 0023: Founder provisioning uses a secret-free append-only evidence ledger

- Status: Accepted
- Date: 2026-08-16

## Context

Run 3 needs a short, reliable route from the frozen Run 2 repository to founder-owned source, staging, provider test accounts, recovery custody, and first-dollar review. Most remaining evidence depends on accounts, credentials, payments, legal decisions, or irreversible actions that only the founder can authorize. A prose checklist alone can drift, blur evidence tiers, lose history, or accidentally invite secrets into source and logs. Existing provider-health rows describe runtime adapter state and cannot truthfully represent founder setup or professional review.

The historical Run 2 handoff uses intentionally informal provider statuses. Those reports are useful inputs but are not provider test, deployed staging, human-validation, professional-review, or live-production evidence.

## Decision

BoomerBuddy owns a versioned catalogue of exactly 23 founder-provisioning workstreams in the domain package. Catalogue text and manual steps are code-owned. The database pins a canonical SHA-256 digest over every definition field, including the key/version/order, provider/purpose/owner, initial status, adapter state, ordered steps and gates, identifier/environment names, verification test, proof tiers, cost ceiling, recovery owner, export/termination procedure, and next founder action. Repository reads and transitions recompute the digest and fail closed on any unversioned catalogue drift.

The canonical status vocabulary is exactly:

- `not_started`
- `founder_in_progress`
- `ready_for_test`
- `test_proven`
- `ready_for_live_review`
- `blocked`

Evidence distinguishes repository review, founder report, local simulation, provider test, deployed staging, human validation, professional review, and live production. Status changes are ordered and evidence-gated. Provider proof and live-review readiness cannot be inferred from local or reported evidence. Blocking and invalidation use bounded system codes.

Provisioning evidence, idempotency operations, and status events are append-only. Each workstream row is locked before a transition; its next version and previous status are enforced by a database trigger. Every nonbaseline observation must be at or after its predecessor status. Provider/staging proof and live-review packets must be no older than 24 hours at recording, and observations beyond five minutes of future clock skew fail closed. One captured database-authority time is stored identically on the operation, evidence, and status event. An operation record makes retries idempotent, detects request drift, and returns an already stored exact result without re-evaluating it against later chronology. Evidence, status, and audit writes commit atomically. Catalogue, evidence, operation, and status history reject update and delete.

A `test_proven` digest is only a reconciliation handle for a retained external proof manifest. Before that gate, the founder manually verifies that the manifest binds the workstream definition, provider/test environment held in approved custody, frozen release, exact `ready_for_test` configuration digest, verification version, observation/result, and artifact checksums. A live-review packet must reference the exact retained test-proof digest and any required human or professional decision/version/expiry. No bare digest, screenshot, statement, local simulation, or provider-health row satisfies either gate; this remains a manual external-custody control until a separately reviewed adapter exists.

The mutation contract accepts only enums, timestamps, an optional SHA-256 base64url manifest digest, and a workstream-bound `provisioning:<workstream>:<UUIDv4>` idempotency key. Contract, repository, and database constraints reject arbitrary or secret-shaped operation keys as well as free text, URLs, identifier values, evidence content, and secrets. The response says `externalActionExecuted: false` as an invariant, not as provider evidence. No provisioning mutation emits an outbox event or calls an adapter.

Both authorization policy and persistence require:

1. an HQ-audience session;
2. exact equality with configured `BB_FOUNDER_PERSON_ID`; and
3. a current `hq_owner` employee assignment joined to an organization whose kind is `internal`.

Reviewer, support, suspended, sponsor, organization-less, unconfigured-founder, and merely claimed roles fail closed. The repository locks and rechecks the assignment and its internal organization during every read and mutation, so a prior session or successful read cannot survive suspension, repointing, or an organization-kind change. Reads are audited before the projection is released; mutations and exact retries are audited inside their transaction.

`ready_for_live_review` is only a review threshold. It never authorizes a purchase, deployment, payment, message, DNS change, app submission, traffic opening, or live activation.

## Consequences

- The founder has one secret-free HQ projection with exact manual steps even when no provider account exists.
- The repository can preserve honest distinctions among local, provider-test, staging, human, professional, and live evidence.
- Provider/account identifier values and evidence artifacts must remain in approved founder/company custody; only their names and retained-manifest digests appear here.
- A new catalogue definition requires a forward versioning decision and migration rather than editing historical rows.
- A status cannot enable runtime behavior. Each adapter retains its separate fail-closed configuration and explicit founder activation gate.
- The unchanged Run 2 handoff remains historical input; its informal statuses are conservatively reconciled and never promoted to provider proof.

## Rejected alternatives

- Reusing `provider_health`: it conflates runtime adapter health with accounts, custody, evidence, professional decisions, and recovery.
- A mutable current-status table: it loses provenance and permits silent evidence rewriting.
- Free-form notes or links: they create an unnecessary secret, personal-data, and fabricated-evidence ingress.
- Letting every HQ owner manage provisioning: it does not preserve the explicit configured-founder gate.
- Emitting automation/outbox work on status change: governance status is not authorization for an external side effect.
