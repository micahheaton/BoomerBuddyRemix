# BoomerBuddy 2.0

BoomerBuddy 2.0 is a trust-first commercialization foundation for helping a consenting household decide what to do with a suspicious message or URL string. Run 2 adds a privacy-bounded Public Check, orthogonal Family authority and append-only consent, test-mode commerce adapters, durable jobs, governed fraud evidence, and an owner-only HQ Business OS to the Run 1 product slice.

This is **not a production service**. It performs no live URL fetch, sends no email/SMS/push notification, takes no real payment, and uses no production credentials. Production startup deliberately fails closed until managed identity and KMS exist. Fraud results are rules-based, explicitly not calibrated, and must not be treated as authoritative.

## Local setup

Use Node.js 22.13+ and npm 10.9+.

```powershell
npm install
Copy-Item .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

The combined development command starts:

- customer web: `http://127.0.0.1:3000`
- HQ: `http://127.0.0.1:3001`
- API: `http://127.0.0.1:4000`

Demo seeding is deliberately opt-in and one-shot. `npm run db:seed` creates synthetic personas and fixtures; normal API restarts never overwrite changed consent, access, deletion, or commerce state.

Start the mobile shell separately with `npm run dev:mobile`. This Windows host verifies its TypeScript and Expo web export, but not native iOS/Android bundles, SecureStore behavior, or device accessibility.

Start the database-backed job runner separately with `npm run dev:worker`. Stripe remains disabled unless a complete test-only configuration is supplied; signed fixtures are not provider-executed transactions.

## Verification

```powershell
npm run verify
npm run test:e2e
npm run test:coverage
npm run test:eval
```

`npm run verify` runs type checks, lint, formatting, unit/integration/security/evaluation tests, and production-shaped builds. The Playwright suite starts isolated test services on ports 3100, 3101, and 4100. See the [Build Run 2 report](docs/BUILD-RUN-2-REPORT.md) for exact results and evidence boundaries.

## Repository map

- `apps/api` — Fastify API and server-derived authorization scopes
- `apps/web` — customer Next.js experience
- `apps/hq` — separately authenticated operations surface
- `apps/mobile` — Expo/React Native shell
- `apps/worker` — portable database-backed jobs and reconciliation
- `packages` — contracts, domain, authorization, security, fraud, persistence, integrations, platform, and Business OS logic
- `tests` — integration, security, and Playwright/axe journeys
- `docs` — master specification, ADRs, evidence, risks, and founder decisions
- `reference/boomerbuddy-v1` — read-only legacy evidence; never imported by 2.0

Start with the [Master Spec](docs/BOOMERBUDDY-2.0-MASTER-SPEC.md), [Run 2 report](docs/BUILD-RUN-2-REPORT.md), [local development guide](docs/build-run-1/03-local-development.md), and [Run 2 limitations](docs/run-2/32-known-limitations.md).
