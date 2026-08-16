# Build Run 1 Plan

Status: **authorized on 2026-08-15 by the bounded Gauntlet Zero PASS in [45-readiness-gate.md](./gauntlet-zero/45-readiness-gate.md)**.

## Objective

Prove one trustworthy path—`Check with BoomerBuddy` for text and URLs—on a foundation that can support consumer web/mobile, Family, sponsor entitlements, and HQ without production credentials. This is not a public launch.

## Selected foundation

- Node 22, TypeScript strict mode, npm workspaces; modular monolith rather than microservices.
- Deployable apps: `api`, customer `web`, employee `hq`, and Expo `mobile`.
- Shared packages: domain, contracts, authorization, fraud, persistence, configuration, and design tokens.
- PostgreSQL SQL migrations; PGlite runs the same PostgreSQL schema locally/in tests; managed PostgreSQL is the production path.
- Fastify API with Zod contracts, structured logs, health/readiness, request IDs, central errors, audit, and a transactional outbox.
- Next.js web/HQ surfaces; Expo mobile source. Native iOS builds/share extensions require later macOS/Xcode validation.
- Vitest unit/integration tests and Playwright critical web flow where the host permits.

## Security design to prove

The client never supplies a trusted user ID or role. A development-only identity adapter exchanges an allow-listed seeded persona for a server-side session. Browser sessions use distinct signed, HttpOnly customer/HQ cookies. Mobile cannot rely on that browser contract, so it uses an opaque, audience-scoped, expiring and revocable development bearer; the server-side session resolves the actor and current roles. Native stores it through Expo SecureStore and Expo web keeps it in memory only. Production refuses every development issuer; native storage remains device-unverified on this Windows host. Central authorization verifies current role plus household/resource scope. Tenant-owned children use composite tenant foreign keys, and scoped repositories always include tenant/resource predicates. Mutations enforce trusted origins and SameSite cookies. Sensitive artifact content is AES-256-GCM field-encrypted with a configured development key; `content_fingerprint` is a separate tenant-/purpose-scoped keyed HMAC with a versioned rotating key, and unkeyed content-digest fields are prohibited; logs/analytics receive only IDs and redacted metadata. Safe words use a salted memory-hard verifier and are never retrievable.

## Vertical slice

1. Sign in as an allow-listed seeded member persona, then submit labeled text or URL. Public Check routes to sign-in; Run 1 has no anonymous persisted Check. A future anonymous Check is ephemeral/no-history under a server-minted anonymous context, never a client actor ID.
2. Normalize transiently with type/size limits and safe URL parsing; never fetch user URLs in Run 1.
3. Before persistence, deterministically reject or redact recognizable private-key blocks, Luhn-valid payment-card numbers, credential/authorization tokens, and one-time-code patterns where feasible. Analyze only the minimum transient representation needed; fingerprint and persist the minimized form.
4. Extract deterministic social-engineering and URL signals.
5. Call a provider interface whose local reputation adapter returns visibly `mock/unknown` data.
6. Produce risk, evidence-sufficiency/confidence, evidence provenance, plain-language explanation, and prioritized safe actions.
7. Persist only the minimized artifact under field encryption plus structured analysis and retention metadata.
8. Show member history; enforce cross-household isolation; allow deletion.
9. Emit content-free audit/outbox events without sending real messages.

## Family and orientation proof

Implement household membership, protected member, scoped Trusted Circle relationship, expiring local invitation, consent state, safe-word verifier, and authorization tests. Implement resumable orientation through protection subject, Trusted Circle, safe word, practice check, capabilities, and completion.

## Product surfaces

- Public web: home, how it works, pricing hypothesis, trust boundaries, Check entry; no invented proof.
- Member: protection status, Check, history, orientation, Family.
- Mobile: navigation, tokens/contracts, text/URL Check, clear statement that native sharing is not implemented.
- HQ: seeded owner metrics, customers, fraud/review, revenue pipeline, provider/system health, and audit; seeded labels on every business metric.

## Tests and gates

- Unit: identifiers, value objects, entitlement, permissions, orientation transitions, signal/scoring/action rules, encryption/safe word.
- Integration: migrations/repositories, sessions, API validation, audit/outbox, deletion, authorization.
- Security regression: another household cannot read, delete, invite into, or analyze against a protected resource.
- Secret-minimization regression: private keys, Luhn-valid card numbers, credential/token patterns, and detectable one-time codes never reach the database, logs, audit, or outbox; tests also verify no URL network access.
- Evaluation: versioned legitimate/malicious/borderline fixtures; report confusion matrix, exploratory evidence-sufficiency/calibration buckets, action-safety assertions, and latency without claiming empirical calibration.
- E2E: development login → check → result → history; orientation and Family happy path if stable.
- Static/accessibility: strict TypeScript, lint/format, dependency audit, axe/keyboard/reflow checks.

## Explicit exclusions

Real payments, Apple/Google commerce, production identity, real email/SMS/push, URL fetching, file/image/audio pipelines, production threat/LLM credentials, deployment, app-store submission, CRM/accounting/payroll connections, and staffed service.

## Completion evidence

All local commands pass; no critical/high defect remains in scoped independent review; Build Run 1 reports distinguish implemented, mock, scaffolded, deferred, and host-blocked behavior; the master spec records any legitimate change.
