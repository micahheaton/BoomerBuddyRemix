# Repository Guidelines

## Project Structure & Module Organization

BoomerBuddy 2.0 is an npm-workspaces TypeScript monorepo. Runtime surfaces live in `apps/`: Fastify `api`, Next.js `web`, separate operations `hq`, and Expo `mobile`. Reusable logic belongs in `packages/`, especially `domain`, `contracts`, `authorization`, `security`, `fraud`, and `persistence`. Canonical SQL migrations are under `packages/persistence/migrations/`. Integration, security, and browser tests live in `tests/`; unit tests stay beside source as `*.test.ts`. Product decisions and run evidence are in `docs/`. Treat `reference/boomerbuddy-v1/` as read-only research—2.0 must not import it.

## Build, Test, and Development Commands

- `npm install` installs the pinned workspace graph (Node 22.13+ and npm 10.9+).
- `npm run dev` starts API, web, and HQ together on ports 4000, 3000, and 3001.
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
