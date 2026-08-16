# Repository Map

## Runtime applications

| Path                   | Contents and ownership                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/app.ts`  | Fastify composition, health/readiness, CORS/headers, error envelopes, retention scheduler, migration/seed initialization.    |
| `apps/api/src/auth.ts` | Credential selection, origin checks, current-session resolution, principal projection, household selection.                  |
| `apps/api/src/routes/` | `sessions`, `checks`, `family`, `orientation`/entitlements, and `hq` application routes.                                     |
| `apps/web/src/app/`    | Public pages plus the authenticated member route tree. Household scope is centralized in `components/household-context.tsx`. |
| `apps/hq/src/`         | Separate Next.js employee shell and API client for overview, customers, fraud, revenue, and system views.                    |
| `apps/mobile/`         | Expo entry, navigation, screens, API/session adapters, native SecureStore intent, and platform theme.                        |

Customer/HQ styling is in each app's `globals.css`; mobile styling is in `apps/mobile/src/theme.ts`. Shared visual constants are in `packages/design`. There is no standalone production media/marketing asset library in Run 1.

## Shared packages

| Package                  | Purpose                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`        | Branded identifiers, entities, commerce portfolio resolution, allowances, orientation transitions, and domain errors.   |
| `packages/contracts`     | Zod request/response schemas shared by API and clients. Contracts are transport shapes, not database rows.              |
| `packages/authorization` | Deny-by-default action/resource policy for customer, mobile, household, Trusted Circle, and HQ scopes.                  |
| `packages/security`      | Input minimization, AES-GCM fields, HMAC fingerprints, scrypt safe-word verifiers, development sessions, and redaction. |
| `packages/fraud`         | Deterministic signals, evidence, scoring, safe actions, and the provider-neutral local-unknown adapter.                 |
| `packages/persistence`   | Database adapters, repositories, seed, migrations, audit/outbox, entitlement and HQ projections.                        |
| `packages/config`        | Typed environment parsing and production refusal.                                                                       |
| `packages/observability` | Structured redacted logging and request IDs.                                                                            |
| `packages/design`        | Cross-surface design tokens.                                                                                            |
| `packages/eval-lab`      | Versioned local fraud fixtures, runner, and report schema. It proves harness behavior, not field accuracy.              |
| `packages/testkit`       | Deterministic test configuration and keys.                                                                              |

## Database and scripts

- `packages/persistence/migrations/` contains canonical forward SQL. Add a new numbered migration; never edit an applied migration because checksum verification rejects drift.
- `scripts/run-sql-migrations.ts` applies pending migrations to configured PGlite/PostgreSQL.
- `scripts/seed-local.ts` invokes the one-shot demo bootstrap, which requires its checked root/domain tables to be empty and records a durable marker.
- `scripts/eval-report.ts` runs the local fraud evaluation fixture set.
- `.env.example` contains intentionally known local values. `.env` and `.data/` are ignored.

The current bootstrap owns synthetic personas, two households, consent/relationships, Checks, local commerce states, and HQ fixtures. `local_demo_bootstraps.run1-v1` makes it one-shot: restarts preserve mutations; an unmarked database with occupied checked root/domain tables is rejected rather than merged. The remaining operational-table edge case is recorded in [Known Limitations](./12-known-limitations.md).

## Tests and evidence

| Path                    | Scope                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `packages/**/*.test.ts` | Unit tests beside domain/security/configuration source.                                                           |
| `tests/integration/`    | API, persistence, commerce, household, Family, orientation, and HQ workflows.                                     |
| `tests/security/`       | Origin/audience, restricted-input persistence, no-fetch, atomicity, retention, and restart/bootstrap regressions. |
| `tests/e2e/`            | Single-worker Edge journeys and axe checks against isolated ports 4100/3100/3101.                                 |
| `vitest.config.ts`      | Unit/integration/security projects and coverage thresholds.                                                       |
| `playwright.config.ts`  | Browser servers, Edge project, traces, and reports.                                                               |

Generated `dist/`, `.next/`, `.expo/`, `coverage/`, Playwright reports, dependencies, local logs, and local databases are ignored.

## Where changes belong

- Add a business rule to `domain` first; add transport validation to `contracts`; keep policy in `authorization`.
- Add an API use case under `apps/api/src/routes/`, then call a household/resource-scoped repository. Do not query from web, mobile, or HQ directly.
- Put vendor-specific translation behind a narrow provider adapter; never leak provider states into canonical domain enums.
- Add every schema change as a forward SQL migration and test its constraints with PGlite plus later real PostgreSQL staging.
- Add a regression test for each defect, including a negative tenant/object case for authorization changes.
- Treat `reference/boomerbuddy-v1/` as read-only research. BoomerBuddy 2.0 has no runtime import from it.

Architecture rationale is in `docs/adr/`; requirements and current boundaries are in [the Build Run 1 plan](../BUILD-RUN-1-PLAN.md).
