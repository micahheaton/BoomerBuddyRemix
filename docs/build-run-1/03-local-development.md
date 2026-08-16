# Local Development

## Prerequisites

- Node.js 22.13 or newer (the build used Node 22); npm 10.9 or newer. The lockfile declares npm 10.9.3.
- A current Microsoft Edge installation for the configured Playwright project.
- No cloud account, production credential, or external provider is needed or permitted.

Native iOS validation requires macOS/Xcode. Android device validation requires a working Java/Android SDK and device or emulator; those toolchains were unavailable on the Run 1 Windows host.

## First start

Run these commands from the repository root:

```powershell
npm install
Copy-Item .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

Open customer web at `http://127.0.0.1:3000`, HQ at `http://127.0.0.1:3001`, and API readiness at `http://127.0.0.1:4000/health/ready`. `npm run dev` starts all three and stops the group when one exits. `npm run dev:mobile` starts Expo separately.

`.env.example` contains deliberately public local keys and leaves demo seed disabled by default. `npm run db:seed` opts into the one-shot local bootstrap explicitly. Never reuse those values outside development. `NODE_ENV=production` always fails startup in Run 1, even if development identity is disabled, because managed identity/KMS are not implemented.

## One-shot local data

The seed is not an upsert loop. On the first empty database it creates every fixture and the `run1-v1` bootstrap marker in one transaction. Later starts see the marker and preserve changes—including revoked relationships, disabled identities, lapsed grants, and deleted or retention-purged Checks. If core tables contain data but no marker, seeding fails with `Demo bootstrap requires an empty local database` rather than overlaying authority.

To start fresh, stop API processes, move `.data/boomerbuddy` to a backup location, then rerun migration and seed. Do not replace or delete a live PGlite directory while a process holds it. The seed CLI's success message is generic even when the marker makes the operation a no-op.

Useful personas:

| Persona                 | Demonstrates                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `owner-alice`           | Sunrise owner **and independently enrolled protected adult**; can run protected workflows.      |
| `protected-pat`         | Sunrise protected member and invitation/sharing subject.                                        |
| `trusted-terry`         | Existing Sunrise Trusted Circle member with explicit shared-Check access.                       |
| `trusted-jordan`        | Authenticated but initially unassigned invite acceptor.                                         |
| `owner-bob`             | Harbor owner without protected enrollment; owner administration does not imply Check authority. |
| `protected-olivia`      | Harbor protected member on the local Free hypothesis.                                           |
| `hq-heidi` / `hq-riley` | HQ owner / review-only employee roles.                                                          |

Protected enrollment itself is not a complete UI flow. Seed fixtures and repository tests exercise self-consent and allowance linkage; a general enrollment endpoint is deferred.

## Verification commands

```powershell
npm run typecheck
npm run lint
npm run format:check
npm run test:unit
npm run test:integration
npm run test:security
npm run test:eval
npm run test:coverage
npm run build
```

`npm test` runs unit, integration, security, and evaluation suites. `npm run verify` adds types, lint, format, and all workspace builds, but it does **not** run Playwright, coverage, dependency audit, or Expo Doctor. Run those separately:

```powershell
npm run test:e2e
npm run audit:deps
npm run doctor -w @boomerbuddy/mobile
```

Playwright starts isolated in-memory services on API 4100, web 3100, and HQ 3101. On the Codex Windows host only, if Playwright fails inside host `os.userInfo()` with `ENOMEM`, use the checked-in host shim:

```powershell
$bbShim = (Resolve-Path .\tests\e2e\os-userinfo-host-shim.cjs).Path
npx cross-env "NODE_OPTIONS=--require=$bbShim" npm run test:e2e
```

That shim addresses the host lookup only; it does not bypass product setup or assertions. If teardown remains idle after Edge reports all tests, stop the runner and confirm ports 4100/3100/3101 are clear before another run.

## Safety boundaries while developing

Submit only synthetic data. The Check path rejects recognizable private keys, Luhn-valid cards, credentials/tokens, contextual one-time codes, and sensitive URL parameters, but heuristic detection is not a license to use real secrets. URL Checks inspect the supplied characters only: do not add `fetch`, DNS, unfurling, redirect following, screenshots, or headless browsing. Do not point the PostgreSQL adapter at production data or enable real billing, messaging, identity, intelligence, or deployment credentials.
