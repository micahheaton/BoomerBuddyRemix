# Technical Architecture

Status: **selected for Build Run 1 on 2026-08-15; implementation begins only after the recorded readiness gate**.

## Decision

Use a strict TypeScript npm-workspace monorepo with independently deployable customer web, HQ, mobile, and API applications over a **modular monolith** and one canonical PostgreSQL database. This is the smallest design that preserves customer/employee presentation boundaries, transactional domain changes, provider portability, mobile native escape hatches, and credible testability.

Do not use microservices, Kubernetes, a data lake, a custom identity system, a custom billing engine, or an agentic AI architecture in Build Run 1. Domain uncertainty and team size make those operational costs harmful. Extract a service only when a measured scaling/security/isolation requirement outweighs distributed failure modes.

See [ADR-0001](../adr/0001-modular-monolith-and-monorepo.md).

## Repository topology

```text
apps/
  api/                 Fastify HTTP composition root
  web/                 Next.js public + member customer UI
  hq/                  Next.js employee-only UI and audience
  mobile/              Expo/React Native app; native targets later
packages/
  domain/              entities, value objects, policies, domain errors/events
  contracts/           Zod HTTP/event schemas and generated/shared types
  authorization/       principal/action/resource policies
  fraud/               normalization, signals, scoring, action policy, provider ports
  persistence/         PostgreSQL migrations, repositories, encryption adapters, seeds
  config/              typed environment schema; no secrets/default production identity
  observability/       redacted logger, correlation, health interfaces
  design/              accessible tokens/components where platform-appropriate
tests/                  cross-package integration, security, evaluation, end-to-end
docs/                   master spec, ADRs, evidence, runbooks, reports
```

Package imports follow the dependency direction `apps → application/module ports → domain`; domain imports no framework, database, UI, or vendor SDK. Cross-module writes go through application services, not another module’s tables. Read projections may join deliberately through persistence interfaces. Contracts expose stable DTOs rather than ORM rows.

## Runtime and request path

- Node.js 22, strict TypeScript, ES modules, locked npm dependencies.
- Fastify API with Zod request/response contracts, size limits, centralized errors, request/correlation IDs, trusted-origin controls, and structured content-free logs.
- Next.js customer and HQ apps are separate builds/origins. They may share design primitives and contracts, never authorization assumptions or session audience.
- Expo provides the cross-platform mobile shell. Share extensions, message filters, and call capabilities require separate Swift/Kotlin modules and real-device gates.
- PostgreSQL SQL migrations are the production contract. PGlite runs that same schema in memory/filesystem for local tests. CI must also exercise a real supported PostgreSQL version before first-dollar launch because PGlite is not production equivalence.

Request flow:

`TLS edge → API validation/rate limit → session authentication → audience/action/resource authorization → application service → transaction/repository → audit + outbox → response contract`

The client never sends a trusted actor ID or role. Browser development sessions use distinct signed, HttpOnly customer/HQ cookies. Mobile uses an opaque, audience-scoped, expiring and revocable development bearer; its server-side session resolves the actor and current roles. Native stores it through Expo SecureStore, Expo web holds it in memory only, and the storage behavior is device-unverified on this Windows host. Production refuses the development issuer. Repositories accept an authorized scope and include tenant/resource predicates. Tenant-owned parents expose unique `(tenant_id, id)` keys; children use composite tenant foreign keys so a reference cannot cross a boundary. Uniqueness/check constraints, lifecycle versions, and optional later RLS add defense; UUID/opaque IDs are not authorization.

Restricted input is bounded and transiently checked before storage. Recognizable private-key blocks, Luhn-valid payment-card numbers, credential/authorization tokens, and one-time-code patterns are rejected or redacted before fingerprinting, encryption, persistence, logs, audit, outbox, fixtures, analytics, or providers. Only the minimized representation may be field-encrypted. Its duplicate fingerprint is a tenant-/purpose-scoped keyed HMAC under a separate versioned rotating key; no unkeyed content digest is stored.

## Bounded modules

| Module | Owns | May publish |
|---|---|---|
| Identity/Access | person/identity link, session principal, employee assignment | account/session/security facts |
| Household | membership, protected member, invitation, Trusted Circle, consent, safe-word verifier | relationship/consent changes |
| Check | artifact lifecycle, signals/evidence, provider runs, decision/actions, feedback | submitted/completed/high-concern/deleted facts without content |
| Orientation | workflow and versioned steps | started/step/completed/needs-attention |
| Commerce | plan versions, subscription records, entitlement grants/allowances | lifecycle/grant/reconciliation facts |
| Sponsor | organization eligibility and sponsored grants | eligibility/grant aggregate facts |
| Operations | audit, inbox/outbox/jobs, review case, provider health | operational alerts |

HQ uses the same modules through employee-specific application services and redacted projections; it is not a bypass around policies.

## Fraud and provider boundaries

Build Run 1’s Check pipeline is local and deterministic. URL input is parsed as a string and is never resolved/fetched/rendered. Reputation and model adapters return explicit `mock`, `unknown`, `unavailable`, or verified observations with provenance. The optional AI adapter is off without credentials and cannot choose actions or call tools. See [ADR-0006](../adr/0006-no-url-fetch-and-isolated-future-acquisition.md) and [ADR-0007](../adr/0007-deterministic-fraud-core-and-optional-ai.md).

Other ports cover identity, commerce, notifications, object storage/scanning, analytics, error telemetry, and business integrations. Vendor-specific raw payloads live at the edge and are normalized into internal contracts. A provider switch must not rewrite household, consent, Check, or entitlement rules.

## Transactions, events, and work

Domain state, security audit, and outbox rows commit atomically. A dispatcher provides at-least-once delivery; consumers use inbox/idempotency records. Build Run 1 may process local jobs in the API process for proof, but never represents that as durable production messaging. External communications stay disabled. A separate durable worker deployment and dead-letter/operator tooling are required before production side effects.

Events contain IDs/classification, not raw artifacts, URLs, contact destinations, or secrets. Analytics events are derived from approved domain facts rather than dual-written inside requests. See [ADR-0005](../adr/0005-transactional-outbox-and-at-least-once-events.md).

## Environments and deployment direction

Local uses seeded synthetic personas, PGlite, local/mock providers, and fixed non-secret development configuration. CI uses isolated databases and no production credentials. Staging and production require separate accounts, identity clients/audiences, databases, KMS keys, domains, provider projects, telemetry, and retention policies; production data never populates development.

Managed deployment direction is stateless API/web/HQ containers or platform runtimes, managed PostgreSQL, managed secrets/KMS, object quarantine when files arrive, and OpenTelemetry-compatible export. A specific host is a procurement decision; architecture does not require provisioning tonight.

## Reliability and evolution

Every provider call has timeout, bounded retry, circuit/open state, cost/latency/error metrics, and an honest unavailable result. Health distinguishes liveness from readiness; readiness does not require optional providers. Migrations are forward-only in normal operation with tested backup/restore and expand-migrate-contract for destructive changes.

Initial operational objectives are hypotheses to validate: core local Check p95 under one second excluding external providers, no cross-tenant authorization success, and graceful provider outage. Production SLO/RPO/RTO values require traffic, support ownership, and deployment evidence.

Extraction triggers include independently scaling URL acquisition, a hard network-isolation boundary for hostile files/pages, materially different data residency, or a durable communications workload. Until then, modules and ports—not network calls—are the separation.

## Verification gate

Build Run 1 must pass strict typecheck, unit/integration/security/evaluation tests, real migrations, development identity refusal in production mode, encryption/log-redaction tests, object-level cross-household tests, web E2E, mobile static/unit checks, and no-URL-network assertions. First-dollar launch additionally requires production identity/KMS/workers/monitoring/backups, real Postgres and provider sandboxes, device tests, external security/accessibility review, and incident drills.

## Evidence

Accessed 2026-08-15:

- [Node.js release status](https://nodejs.org/en/about/previous-releases)
- [Fastify v5 migration and schema requirements](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/)
- [Next.js documentation](https://nextjs.org/docs)
- [Expo SDK reference](https://docs.expo.dev/versions/latest/)
- [PGlite documentation](https://pglite.dev/docs/)
- [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [OpenTelemetry overview](https://opentelemetry.io/docs/what-is-opentelemetry/)
- [NIST Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final)
