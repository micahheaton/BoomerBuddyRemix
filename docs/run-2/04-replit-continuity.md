# Replit Continuity

Status: **portable configuration implemented and locally inspected; permanent Replit-loss recovery not yet proved**.

## Current result

No application or package imports Replit runtime APIs. `scripts/verify-portability.mjs` checks required non-Replit configuration and rejects known Replit-only runtime identifiers; it passed locally. The repository includes a standard Node 22 build, PostgreSQL adapter and migrations, one OCI `Dockerfile`, local PostgreSQL `docker-compose.yml`, Render service definitions, separate Vercel project files, EAS profiles, and environment-driven configuration.

`.replit` is a development convenience only. It starts `npm run dev` and exposes local ports; it is not an identity, database, secret, DNS, storage, source-history, or deployment dependency.

## Loss-drill status

The prior baseline committed clean-clone script passed from a temporary clone: locked install, portability inventory, workspace typecheck, the then-current unit/integration/security/evaluation suites, and API/worker/web/HQ/Expo-web builds reconstructed successfully. The drill also exposed and fixed a Windows Node 22 process-launch bug in both continuity scripts. It predates the final closure changes and is not evidence that the frozen closure tree passed a clean clone; a fresh post-closure run remains pending. Even the baseline result is source/build portability evidence, not an external recovery test.

`scripts/replit-loss-drill.mjs` is **implemented but not executed successfully against an external remote**. It refuses a Replit URL, clones a supplied external Git remote into a temporary directory, runs locked install, portability checks, types, tests, and builds, then reports only a partial source/build proof. It deliberately reports database restore, object restore, DNS cutover, and mobile signing as unproved.

## Blocking evidence

- **Blocked by founder/external account:** no canonical private GitHub remote or offsite mirror is configured.
- **Blocked by managed infrastructure:** no encrypted managed PostgreSQL backup/restore, object-store restore, or DNS cutover has been exercised.
- **Blocked by device/account:** no EAS/App Store/Play signing recovery has been exercised.
- **Scaffolded only:** Render, Vercel, Neon, Cloudflare, and EAS files have not been deployed.
- **Launch blocker:** production configuration intentionally refuses startup until managed identity and KMS-grade secret handling exist.

The operating procedure and founder actions are in [REPLIT-CONTINUITY-PLAN.md](./REPLIT-CONTINUITY-PLAN.md). A configuration inventory is not a completed business-continuity drill. Run 2 does not launch.
