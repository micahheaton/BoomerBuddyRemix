# CI and Deployment

Status: **host-independent CI and deployment configuration implemented; remote CI and provider deployment have not run**.

## Continuous integration

`.github/workflows/ci.yml` defines read-only GitHub Actions permissions and three bounded jobs:

1. `verify` performs `npm ci`, portability, format, lint, type, unit/integration/security/evaluation tests, API/worker/web/HQ/mobile builds, and a production-tree critical dependency audit.
2. `postgres` runs PostgreSQL 17.6, applies migrations twice to prove forward idempotency, and exercises competing `SKIP LOCKED` worker claims.
3. `containers` builds the OCI image without pushing it.

Locally, `scripts/verify-portability.mjs` passed, and a committed temporary clean clone completed locked install, typecheck, all test projects, and all production builds. No GitHub remote is configured, so none of these workflow jobs has external run evidence. Playwright/axe, coverage thresholds, SBOM/license checks, secret scanning, signed releases, artifact attestation, and deployment approvals are not in the workflow.

## Deployment scaffolds

`Dockerfile` defines API and worker artifact builds on Node 22.13.1 and an unprivileged `node` runtime. `docker-compose.yml` describes local PostgreSQL, one-shot migration, API, and worker services. `render.yaml` separates API and worker and runs migrations before API deploy. Customer web and HQ have separate Vercel project files; mobile has EAS preview profiles.

These files are **scaffolded, not deployed**. `render.yaml` requests production mode, while application configuration intentionally refuses production startup until managed identity and KMS controls exist. Thus the Render blueprint cannot presently constitute a successful deployment.

## Release blockers

Create the founder-controlled private GitHub remote, protect `main`, require reviews/checks, configure environment-scoped secrets and approvals, add tagged/reproducible release artifacts, execute CI, add E2E/accessibility and supply-chain gates, deploy non-public staging, verify migrations/rollback/health/observability, and rehearse recovery. Vercel, Render, Neon, identity, DNS, Stripe, EAS, and monitoring accounts are **blocked by founder authorization and external setup**. No production deployment or public launch occurred.
