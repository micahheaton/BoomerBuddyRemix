# Known Limitations

Status: **the bounded local Build Run 1 passed; the product remains blocked for production, public beta, and first-dollar use.**

No unresolved Critical/High application defect was identified in the frozen reviewed scope. The following limitations are explicit and must not be converted into readiness claims.

## Open local correctness and lifecycle work

- **Invitation expiry is enforced but not materialized.** Preview, acceptance, and cancellation reject an invitation after `expires_at`, but the stored invitation can remain `pending` and its consent row can remain active. Add a transactional expiry transition and consent cleanup, then test repeated sweeps and race boundaries.
- **Seed occupancy preflight is not exhaustive.** The explicit, one-shot seed checks root and selected domain tables and writes its durable marker last. Normal marked restarts cannot mutate data or resurrect deleted/revoked state. An exotic unmarked database containing only standalone operational rows—such as inbox, reconciliation, or nullable-scope audit/outbox data—could still receive fixtures. Make the empty-database proof schema-wide before relying on this outside disposable development data.
- **Mutation idempotency is incomplete.** Commerce ingestion has event deduplication, but Check create/share/delete and other request mutations do not expose a general idempotency-key contract.
- **Consent history is mutable.** Current consent rows support enforcement, but changes update state in place rather than producing a complete append-only consent/withdrawal registry suitable for legal evidence.
- **Subscription clocks are generalized.** Trial, grace, cancellation, refund, and provider-specific deadline semantics need explicit lifecycle rules and tests before real commerce.
- **Permission vocabulary has drift.** Runtime permission identifiers and the master taxonomy are directionally aligned but not one canonical generated vocabulary. Reconcile names before external integrations depend on them.

## Evidence gaps

- Expo source and web export pass, but no iOS or Android device/emulator target was executed. SecureStore, sharing, deep links, notifications, accessibility services, and store behavior are unproven.
- PGlite exercises PostgreSQL-compatible SQL, not managed PostgreSQL concurrency, migration locking, network failure, backup/restore, extensions, or row-level security.
- The fraud corpus is synthetic and single-author. The 12/12 result has zero forbidden actions but is explicitly `not_calibrated`; no live reputation provider was evaluated.
- Automated Edge/axe checks are not WCAG conformance. There has been no moderated testing with older adults, assistive-technology study, or high-stress recovery research.
- Verified safe-action completion and time-to-first-safe-action are not instrumented. HQ therefore cannot truthfully report the proposed north-star outcome or partner impact.

## First-dollar blockers

Production still lacks real identity/MFA and account recovery; identity-bound protected enrollment and withdrawal; managed KMS, rotation, and secret custody; durable retention/outbox workers; hosted PostgreSQL qualification and restore evidence; complete export/erasure; authentic payments, billing reconciliation, tax, refund, and cancellation operations; production observability and incident response; and qualified legal, security, fraud, privacy, and accessibility review. The unresolved dependency advisories in [Test Results](./11-test-results.md) also block release.

These items are intentionally separated from the local pass. See [Deferred Integrations](./13-deferred-integrations.md) and [Technical Debt](./14-tech-debt.md) for ownership boundaries and closure evidence.
