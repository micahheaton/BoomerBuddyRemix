# Data Model

Status: **canonical design selected; Build Run 1 implements the bolded subset needed for the vertical slice**.

## Modeling rules

Model people, relationships, protection, commerce, and operations separately. Payment, age, kinship, household ownership, sponsor eligibility, and employee status never imply permission. Every sensitive row has an explicit tenant/boundary and lifecycle. Use opaque UUIDs, UTC timestamps plus user timezone where needed, immutable created facts, optimistic `version`, foreign keys, unique/check constraints, and explicit status enums.

Application authorization remains mandatory. Repositories require a scope object and filter by household/organization/resource. Every tenant-owned parent has unique `(tenant_id, id)`; every tenant-owned child repeats `tenant_id` and uses a composite foreign key to that pair. This prevents a valid child ID from being attached across tenants. Constraints prevent orphaned or impossible state; negative security tests prove isolation. Do not recreate v1’s single `users` record or free-form status/table proliferation.

## Identity and relationships

| Entity | Essential fields and constraints |
|---|---|
| **Person** | id, display preferences, locale/timezone, status; no payment/admin booleans |
| **Identity** | person, issuer, subject, assurance/status; unique `(issuer, subject)` |
| **Session** | identity, issuer, audience, opaque credential digest, issue/expiry/revocation, minimized device reference or purpose-scoped keyed HMAC; server resolves actor/current roles and no actor ID, role, raw device fingerprint, or provider token is client-trusted |
| **Household** | owner membership reference, status, version; ownership does not grant artifact visibility |
| **HouseholdMembership** | household, person, role, accepted/revoked times; unique active membership |
| **ProtectedMember** | household, person, protection consent status/version; person may be payer/owner independently |
| **TrustedCircleRelationship** | household, protected person, trusted person, status, permission set/version, accepted/revoked times |
| **Invitation** | household, inviter, intended role/scope, token digest, expiry, consumed/revoked state; single use |
| **ConsentRecord** | subject, actor, purpose, scope, policy version, source, granted/revoked time; append-only facts |
| **VerificationSecret** | protected person/household, verifier algorithm/parameters/salt/output, attempt state, replaced time; never plaintext |
| Organization / OrganizationMembership | sponsor or employer boundary and roles; not the BoomerBuddy employee boundary |
| EmployeeAssignment | person, HQ role/scope, employment status; separate identity audience and access grants |

Trusted Circle permission sets initially allow `receive_escalation`, `view_shared_result`, and `help_with_incident`. Raw-artifact sharing is a separate, explicit, expiring grant—not implied by any of these.

## Check and intelligence

| Entity | Essential fields and constraints |
|---|---|
| **Artifact** | owner person, household boundary, kind, encrypted minimized-content reference/value, `content_fingerprint` (tenant-/purpose-scoped keyed HMAC over that minimized form) plus `fingerprint_key_version`, size, source, classification, retention/deletion state; no unkeyed content-digest column |
| **AnalysisRun** | artifact, pipeline/rules version, state, start/end, risk/confidence, failure/uncertainty, review state |
| **Signal** | analysis, typed signal key/value, deterministic extractor/version, strength and limitations |
| **Evidence** | analysis, source class/name/version, observed/expiry, keyed-fingerprint reference, typed claim, provenance/limitation; no unkeyed artifact digest or unbounded provider blob |
| **ProviderRun** | analysis, provider kind/name/version, tenant-/purpose-scoped keyed request fingerprint plus key version, status, latency/cost units, freshness; minimized encrypted/raw response only if required |
| **Decision** | analysis, risk enum, confidence enum, policy version, reason references; one approved current decision plus history |
| **SafeAction** | decision, policy action key, priority, official-source reference, required/prohibited status |
| AnalysisFeedback | decision, reporter, issue type, consent to follow-up/corpus use, review outcome; not automatic ground truth |
| ScamType / IntelligenceCampaign | versioned editorial taxonomy/campaign evidence and source rights |
| Incident / RecoveryPlan | user-opened case, affected scope, state, steps and verified destinations; deferred |

Artifact content, evidence, and history have independent retention/deletion state. Before any row or fingerprint is created, transient minimization rejects or redacts recognizable private-key blocks, Luhn-valid card numbers, credential/authorization tokens, and one-time-code patterns; only non-sensitive signal flags may survive. Keyed fingerprints cover the minimized form, use a key separate from field-encryption and safe-word keys, include tenant/purpose in the MAC input, carry a key version, and never enter analytics/provider requests. Any duplicate-detection index includes tenant, purpose, fingerprint-key version, and fingerprint; it is never globally unique. This prevents offline guessing of common messages/URLs from a leaked unkeyed digest while preserving bounded duplicate detection. `artifact_id` is omitted from analytics payloads where a less specific analysis event suffices. Deletion preserves the minimum content-free audit proof and severs encrypted material/provider payloads.

Build Run 1 browser sessions are signed HttpOnly customer/HQ cookies. Native mobile uses an opaque, audience-scoped, expiring/revocable development bearer backed by this server-side Session; Expo SecureStore is the intended native store and web storage is memory-only. The native behavior is device-unverified until real-device testing. Production rejects the development issuer.

## Orientation

- **OrientationWorkflow:** protected member, workflow version, `not_started|in_progress|ready`, independent `needs_attention`, timestamps.
- **OrientationStep:** workflow, step key/version, `not_started|in_progress|completed|skipped|needs_attention`, evidence reference and timestamps; unique per workflow/key/version.
- Practice Check links to a synthetic/labeled artifact flag so it never enters real safety metrics.

Transitions are server-validated, idempotent, and append security/audit facts for consent-sensitive steps.

## Commerce and sponsor

| Entity | Purpose |
|---|---|
| **Product / PlanVersion** | Immutable offer/version, interval/price hypothesis, capability and allowance definitions. |
| **Subscription** | Payer, subject household/org, source, normalized lifecycle, service period, cancellation/trial/grace. |
| **ProviderSubscriptionRecord** | Provider/environment external IDs and raw state; unique and non-authoritative for access. |
| **EntitlementGrant** | Subject, capability/allowance, source/ref, effective interval, revocation. |
| **SeatAssignment / ProtectedMemberAllocation** | Explicit consumption of an allowance without relationship permission. |
| Sponsorship / Eligibility | Organization-funded grant and reporting/eligibility policy. |
| Transaction / Refund / Dispute | Financial ledger references; no card data. |
| **CommerceEventInbox / ReconciliationRun** | Idempotent provider events and drift evidence. |

## Operations

- **AuditEvent:** actor/principal, audience, action, target type/opaque ID, tenant, result, reason, occurred time, correlation, classification; content-free and append-only.
- **OutboxEvent / InboxReceipt:** versioned envelope/payload, aggregate sequence, attempts/status, dedupe key.
- Job / DeadLetter: handler, reference, schedule/lease/attempt/error code; no artifact body.
- ReviewCase / SupportCase: queue, reason, redacted references, assignment/SLA/access-grant link.
- ProviderHealth: provider/env, status, sample window, latency/error/cost; no secret.
- PrivacyRequest: authenticated request scope/state, export/delete evidence, exceptions and processor propagation.
- IntegrationConnection: vendor/environment/purpose/status/secret reference, never the secret itself.

## Ownership and invariants

- Artifact owner and household boundary are immutable except through an audited transfer workflow (not in Run 1).
- A Trusted Circle relationship requires an accepted protected member and two distinct people; permissions cannot exceed the invitation/actor grant.
- Revoked consent invalidates future sharing; it does not rewrite historical audit facts.
- Invitation token plaintext is never stored; consumption and revocation are mutually exclusive.
- One active safe-word verifier per scope; replacement invalidates the old verifier atomically.
- Provider event IDs are unique per provider/environment; entitlement grants reference a verified source.
- Audit/outbox writes share the domain transaction.
- Content deletion and legal/accounting retention exceptions are separate, visible states.
- No persisted table, fixture, event, audit record, or job payload may contain plaintext safe words, private keys, payment-card/authentication credentials, provider secrets, or detectable one-time codes.

## Retention partitions

Keep identity/relationships, restricted user artifacts, fraud evidence, commerce, business operations, and evaluation corpora logically separated even in one database. Use separate schemas or strict repository modules and database roles when operationally practical. Never place raw customer submissions in the analytics warehouse, event bus, support vendor, or evaluation corpus by default. Exact periods remain policy/counsel decisions; the working restricted-artifact default is no more than 30 days with earlier deletion.

## Deferred entities

Do not create empty tables in Run 1 for every future lead, opportunity, contractor, payroll, accounting, intelligence campaign, or recovery concept. HQ may use typed seeded projections. Add a durable entity only when a workflow owns its lifecycle, constraints, retention, authorization, and events.
