# CI and Deployment

Status: **expanded local verification passed on the frozen tree; remote CI, real PostgreSQL, post-closure clean clone, OCI, and provider deployment remain pending or blocked**.

## Continuous integration

`.github/workflows/ci.yml` defines bounded verification, disposable PostgreSQL, and container-build jobs. The repository verification surface now includes:

- a temporary `git clone --no-local` drill with locked install, migration/seed, portability/V1 guards, typecheck, tests, API/worker/web/HQ/mobile builds, and optional Buildx artifact;
- a TypeScript-aware portability guard that rejects direct imports and statically decodable normalized/concatenated/URI-encoded paths into `reference/boomerbuddy-v1/`; and
- an expanded PostgreSQL verifier for repeatable migrations, competing claims, idempotency, heartbeat/reclaim, scheduled order, receipts, retry/dead letter/audited replay, shutdown, causal outbox poison replay, and reconciliation intent.

The frozen root run passed workspace typecheck, ESLint, Prettier, all unit/integration/security/evaluation suites, aggregate coverage, API/worker/web/HQ/Expo-web builds, Edge 15/15, portability, `git diff --check`, and the V1 path status/diff check. Exact counts and the honest Windows teardown note are in the [Run 2 report](../BUILD-RUN-2-REPORT.md).

The clean-clone script fails if a required OCI build is unavailable; in optional local mode it records the Docker/Buildx boundary instead of pretending an image was built. A prior baseline clean-clone reconstruction passed and produced the install summary recorded in the [dependency review](./27-dependency-review.md), but the fresh post-closure clean clone has not run. The real-PostgreSQL verifier and OCI build are also pending host/CI evidence. No GitHub-hosted run, release artifact, or registry result is claimed.

## Deployment scaffolds

`Dockerfile` defines separate API/worker artifacts and an unprivileged runtime. `docker-compose.yml` describes local PostgreSQL, migration, API, and worker services. `render.yaml` separates API and worker; customer web and HQ have distinct Vercel project files; mobile has EAS preview profiles.

These files are **scaffolded, not deployed**. Production configuration intentionally refuses startup until managed identity and KMS controls exist. A blueprint or successful local build is not a hosted system.

## Release blockers

Create a founder-controlled remote, protect release history, configure scoped secrets/approvals, run remote CI, adjudicate current machine-readable dependency/SBOM/license/provenance evidence, produce signed/reproducible artifacts, deploy non-public staging, and prove migration/rollback/health/observability/recovery. Vercel, Render, Neon, identity, DNS, Stripe, EAS, telemetry, messaging, and intelligence accounts remain **blocked by authorization and external setup**. No production deployment or public launch occurred.
