# Architecture as Built

## System shape

BoomerBuddy 2.0 is a strict-TypeScript npm-workspaces modular monolith. Four runtime surfaces share contracts and design primitives but keep audience boundaries:

| Runtime       | Technology             | Responsibility                                                                                                        |
| ------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `apps/api`    | Fastify 5              | Authentication, policy enforcement, application orchestration, repositories, health, audit, and retention scheduling. |
| `apps/web`    | Next.js 16             | Public and customer/member experience on port 3000.                                                                   |
| `apps/hq`     | Next.js 16             | Separate employee experience on port 3001; never a customer-session admin mode.                                       |
| `apps/mobile` | Expo 57 / React Native | Customer mobile flows and secure-store adapter; native extension work remains outside Run 1.                          |

This implements the direction in [ADR-0001](../adr/0001-modular-monolith-and-monorepo.md) and [ADR-0010](../adr/0010-separate-customer-and-hq-applications.md). The API imports framework-neutral `domain`, `contracts`, `authorization`, `security`, `fraud`, `persistence`, `config`, and `observability` packages. Domain packages do not import UI or database code.

## Request and data flow

1. A customer, mobile, or HQ client sends a schema-bounded request.
2. The API validates the signed development credential, resolves its database session, current identity, memberships, employee assignments, effective commerce portfolio, and per-household capabilities.
3. `X-BB-Household-Id` selects only one of those resolved active memberships; it never creates authority.
4. Shared authorization evaluates audience, action, capability, tenant, protected enrollment, ownership, relationship, and permission.
5. The application route passes exact actor/tenant/resource scope to a repository.
6. Mutations commit domain state, content-free audit, and outbox intent in one transaction.
7. Zod response contracts project only the data required by that audience.

For Check creation, the API normalizes and rejects restricted input **before** deterministic analysis or provider invocation. The repository repeats minimization defensively, verifies effective protected enrollment under lock, encrypts the minimized content, creates a purpose-scoped keyed fingerprint, and commits artifact, analysis, audit, and outbox together. The only provider is `LocalUnknownProvider`; URL analysis parses characters and structural properties without DNS, HTTP, previews, redirects, or browser navigation, as required by [ADR-0006](../adr/0006-no-url-fetch-and-isolated-future-acquisition.md).

## Persistence

`packages/persistence/migrations/0001_initial.sql` is the canonical forward SQL migration. It includes identities/sessions, household and organization scope, Checks, consent and Trusted Circle, orientation/safe-word verifiers, normalized commerce, protected enrollment, commerce inbox/reconciliation, audit/outbox, and HQ fixture projections. Tenant-owned relationships use repeated household IDs and composite foreign keys. Product and plan versions are immutable by trigger.

PGlite executes this PostgreSQL schema locally and in tests. A `pg` pool adapter exists for PostgreSQL, but real-server concurrency, migrations, backup, and restore are **unverified and required before launch**; PGlite is not production equivalence ([ADR-0002](../adr/0002-postgresql-canonical-pglite-local.md)). There is no row-level security; central policy, scoped queries, composite constraints, and negative tests are the implemented layers.

## Independent protected enrollment

Household role and protected-person consent are separate facts. `protected_members` records self-consent and links to an exact allowance allocation. Database triggers reject an accepted enrollment whose active allocation has the wrong tenant, subject, kind, or state, and prevent releasing a linked allowance before revocation. Session resolution sets `isProtectedMember` only when that allocation is backed by a grant contributing to the household's effective portfolio at request time. Role strings alone fail closed.

Self-enrollment and withdrawal transactions exist in `EntitlementRepository`; they enforce self-consent, active membership, allowance limits, locks, and release ordering. **No general enrollment HTTP endpoint or non-fixture enrollment UI ships in Run 1.** Seeded accepted enrollments and repository/integration tests prove the architecture without pretending onboarding is complete.

## Startup and background work

Startup loads typed configuration, connects the database, optionally runs checksum-guarded migrations, optionally performs the atomic one-shot demo bootstrap, drains up to ten 100-row retention batches, then starts the API. A zero-delay continuation drains further due records, and an overlap-guarded hourly in-process sweep handles later expiry. Deletion removes shares, nulls ciphertext/fingerprints, scrubs structured findings, and leaves content-free tombstone/audit/outbox records.

The seed transaction writes `local_demo_bootstraps.run1-v1` only after all fixtures and shares succeed. Existing marker means no reseed; any unmarked occupied core table causes refusal. This prevents routine restarts from recreating revoked authority or deleted content.

Audit/outbox persistence is **implemented**. External dispatch, leases, consumer inboxes beyond commerce, retry/dead-letter operations, and durable production retention orchestration are **deferred**, narrowing the as-built claim relative to [ADR-0005](../adr/0005-transactional-outbox-and-at-least-once-events.md).

## Deliberate production refusal

Configuration rejects every `NODE_ENV=production` startup because managed identity and KMS adapters do not exist. Browser cookies are local-only, commerce/provider data is synthetic or unknown, and HQ metrics are labeled `local_development`/`seeded`. No production deployment path, URL acquisition service, real messaging, billing, AI, or app-store integration is present.
