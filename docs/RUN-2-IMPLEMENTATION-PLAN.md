# Run 2 Implementation Plan

Status: **authorized for bounded local/staging-foundation implementation; launch prohibited**

Decision date: 2026-08-16

This plan implements the [Run 2 Master amendment](./BOOMERBUDDY-2.0-MASTER-SPEC.md) after the [external-review adjudication](./run-2/01-external-review-adjudication.md). It preserves the modular monolith and advances only work that can be proven without customers, production credentials, paid services, public deployment, outreach, or app-store submission.

## Gate and evidence rules

- Use only `implemented`, `implemented with mock provider`, `scaffolded`, `designed`, `blocked`, `deferred`, or `rejected` status.
- Deterministic fixtures validate contracts, not external vendors. Stripe, identity, managed PostgreSQL, storage, telemetry, messaging, native stores/devices, DNS, and hosting stay `blocked by account` until independently exercised.
- No result may be called calibrated, safe, fraud prevented, a customer outcome, partner intent, or traction.
- The V1 tree remains read-only and is never imported at runtime. Curation creates reviewed 2.0 records with independent provenance.
- Every mutation is tenant-scoped, current-state authorized, idempotent where replayable, audited, and content-minimized.

## Build waves

### Wave 0 — authority and portability

1. Add forward-only migrations for neutral membership, independent administration/billing, pairwise trust, append-only consent, identity-bound invitation fields, support cases/grants, and exact lifecycle projections.
2. Refactor principals and authorization away from singular household-role and membership-wide Trusted Circle permissions.
3. Add portable environment contracts, OCI builds, real-PostgreSQL CI, GitHub Actions, Replit configuration, and clean-clone/loss-drill scripts. Do not create the external remote or provider projects.

### Wave 1 — fraud and public acquisition

1. Implement typed sensitive-span redaction and active `unknown/caution/high_concern` semantics.
2. Replace the generic provider port with role-specific least-data contracts, data-use policy, kill switches, budgets, and normalized evidence.
3. Create governed taxonomy/source/action records and adjudication-capable evaluation objects; seed only a small reviewed candidate set.
4. Implement short-lived anonymous Check contexts, shared quotas, transient results, content-free attribution, and explicit save-after-signup consent.

### Wave 2 — commerce, data, jobs, and privacy

1. Add explicit payer/billing authority, Stripe test adapter, raw-body signature verification, idempotent inbox normalization, lifecycle/reconciliation fixtures, and portal/checkout abstractions.
2. Add Apple/Google server-notification contracts and a versioned, default-deny storefront policy registry; no app submission or purchase UI claim.
3. Add a portable database-backed worker with leases, retry/backoff, dead letters, replay audit, heartbeat, and shutdown handling.
4. Add privacy export/erasure/consent-withdrawal cases, data inventory, deletion evidence, and artifact-blind support boundaries.

### Wave 3 — commercial and operating system

1. Add privacy-bounded acquisition events, governed content records, referral relationships/reward ledger, and disabled-by-default external delivery.
2. Import official credit-union snapshot fixtures with checksum/provenance; add enrichment adapter contracts without an Apollo account or fabricated contact data.
3. Add organizations, contacts, leads, opportunities, activities, tasks/next actions, staleness, customer health, lifecycle workflow, support/fraud cases, owner attention, owner brief, and autonomy approvals.
4. Extend web/HQ/mobile only after contracts and authorization are green; preserve content exclusions, truthful provider status, accessible flows, and no fake completeness.

## Verification matrix

The frozen tree must pass:

- strict workspace typecheck, ESLint, Prettier, unit coverage, integration, security, evaluation, and production builds;
- real PostgreSQL migration/concurrency tests in Docker or CI in addition to PGlite;
- authorization regressions for spouses with orthogonal authority, payer-only denial, pairwise revocation, lapsed consent, case-bound support, public-context isolation, and cross-tenant direct IDs;
- redaction and provider-egress property/snapshot tests proving original sensitive values reach no persistence or telemetry sink;
- public Check expiry, replay, quota, no-retention, conversion-consent, and no-content-attribution tests;
- signed commerce fixture, duplicate/out-of-order event, reconciliation, lifecycle, authority, and redirect non-authority tests;
- competing-worker, crash/lease recovery, duplicate consumer, poison-event, replay, and graceful-shutdown tests;
- browser accessibility and customer/HQ journey tests; native behavior remains blocked unless real devices/accounts become available.

Independent reviewers must challenge architecture, authorization, security, privacy, fraud, Family consent, payments, portability/Replit, mobile, accessibility, acquisition, revenue operations, customer success, automation, economics, staffing, and strategic value. Every in-scope Critical or High finding is fixed or the affected capability is removed from Run 2.

## Stop boundary

Run 2 stops after local/staging-foundation evidence, documentation, and reproducible setup are complete. It does not push a remote, deploy, alter DNS, provision paid infrastructure, charge a card, contact anyone, publish content, submit an app, hire staff, migrate users, or begin Run 3.
