# Repository Guidelines

## Project Structure & Module Organization

BoomerBuddy 2.0 is an npm-workspaces TypeScript monorepo. Runtime surfaces live in `apps/`: Fastify `api`, Next.js `web`, separate operations `hq`, and Expo `mobile`. Reusable logic belongs in `packages/`, especially `domain`, `contracts`, `authorization`, `security`, `fraud`, and `persistence`. Canonical SQL migrations are under `packages/persistence/migrations/`. Integration, security, and browser tests live in `tests/`; unit tests stay beside source as `*.test.ts`. Product decisions and run evidence are in `docs/`. Treat `reference/boomerbuddy-v1/` as read-only research—2.0 must not import it.

## Deployment Topology and Source of Truth

`https://github.com/micahheaton/BoomerBuddyRemix.git` is the only source repository for BoomerBuddy 2.0. The four 2.0 Replit service projects are deployment consumers of this repository: `boomerbuddy-web` serves the customer web application at `app.boomerbuddy.net`, `boomerbuddy-api` serves `api.boomerbuddy.net`, `boomerbuddy-worker` runs background work, and `boomerbuddy-hq` serves `hq.boomerbuddy.net`. Make product changes in this repository, commit and push them to GitHub, then make each Replit service pull the exact approved commit. Never push code from a Replit service back to GitHub and never treat a Replit editor checkpoint as source truth.

The separate Replit project named `BoomerBuddy`, serving `boomerbuddy.net`, is the legacy site used for Twilio registration, privacy, terms, and messaging opt-in evidence. It is outside the BoomerBuddy 2.0 deployment set. Do not edit, synchronize, republish, or retire that legacy project unless the user explicitly names the legacy project and requests that exact action. Do not point Stripe, Clerk, customer application, API, worker, or HQ configuration at the legacy project.

## Build, Test, and Development Commands

- `npm install` installs the pinned workspace graph (Node 22.13+ and npm 10.9+).
- `npm run dev` starts API, web, and HQ together on ports 4000, 3000, and 3001.
- `npm run dev:worker` runs durable jobs and commerce reconciliation separately.
- `npm run dev:mobile` starts Expo; native device validation still requires an appropriate host toolchain.
- `npm run db:migrate && npm run db:seed` creates deterministic local PGlite data.
- `npm test` runs unit, integration, security, and fraud-evaluation checks.
- `npm run test:e2e` runs the Edge Playwright journey suite.
- `npm run verify` runs types, lint, format checks, tests, and builds.

## Coding Style & Naming Conventions

Use strict TypeScript, ES modules, two-space indentation, single quotes, and semicolons. Prettier and ESLint are authoritative. Use `PascalCase` for components and types, `camelCase` for functions and variables, and `kebab-case` for route folders. Keep domain rules pure, validate boundaries with shared Zod contracts, and access tenant data only through scoped repositories.

## Testing Guidelines

Vitest covers packages and API behavior; Playwright plus axe covers user journeys and accessibility. Add a regression test with every fix. Authorization, security, and fraud packages target at least 80% coverage. Tests must not depend on production credentials or live URL fetching.

## Commit & Pull Request Guidelines

Use short, imperative, sentence-case subjects such as `Fix duplicate scam alert aggregation`; avoid automation checkpoint text and unnecessary Conventional Commit prefixes. Pull requests should explain user impact, security or schema implications, validation performed, and remaining limitations. Link relevant issues when applicable and include screenshots for visible web, HQ, or mobile changes.

## Security & Configuration

Copy `.env.example` for local configuration. Never commit secrets, plaintext submitted artifacts, tokens, safe words, or local database files. Keep customer and HQ audiences separate, preserve consent boundaries, and do not add outbound URL fetching to Check analysis.
