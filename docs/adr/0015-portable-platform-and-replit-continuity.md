# ADR-0015: Portable Platform and Replit Continuity

Status: **Accepted Run 2 design; local portability proof required; external-remote, backup, restore, and Replit-loss proof blocked by accounts**

Decision date: 2026-08-16

## Context

Replit is useful for development but must not become the only copy of source, history, identity, secrets, data, deployment configuration, DNS, artifacts, or recovery knowledge. The same protection applies to every preferred vendor. Run 2 needs a reconstructable platform contract without provisioning paid services or pretending that unexecuted recovery works.

## Supersession

This ADR supersedes [ADR-0001](./0001-modular-monolith-and-monorepo.md)'s deployment description where it lacked a portability and recovery contract, while preserving the modular monolith and separate deployable surfaces. It supersedes [ADR-0002](./0002-postgresql-canonical-pglite-local.md)'s general managed-PostgreSQL direction with explicit real-server, backup, and restore qualification; canonical SQL and PGlite remain unchanged.

## Decision

Replit is a replaceable development workspace, never a system of record. A founder-controlled external Git remote is the canonical history hypothesis, with GitHub preferred but unprovisioned in Run 2. A clean clone plus documented prerequisites must install, migrate, seed, test, build, and produce standard Linux/OCI artifacts without Replit APIs or filesystem assumptions.

Runtime configuration uses validated environment contracts and vendor-neutral ports. Secrets are injected, never committed or made Replit-only. PostgreSQL-compatible forward SQL remains canonical; applications support direct and pooled standard PostgreSQL URLs. User objects use an S3-capability abstraction only after retention, encryption, region, and restore review. DNS and identity are external boundaries with recorded export/recovery ownership.

The current production topology is a hypothesis, not a commitment: Vercel for separate customer web/HQ projects; Render for API and worker; Neon PostgreSQL; Clerk identity; Stripe web; Apple/Google mobile commerce; Cloudflare DNS; reviewed S3-capability storage; Sentry; PostHog; Postmark; Twilio; and Expo/EAS. Every adapter must have an exit path, data export, credential rotation, failure behavior, and replacement test. No provider's metadata becomes the canonical domain model.

CI is host-independent and runs locked install, formatting/lint/types, unit/integration/security/evaluation, real PostgreSQL migrations/tests, web/HQ builds, Expo static checks, dependency review, and OCI builds. Recovery evidence includes a mirrored source copy, encrypted database/object backups, restore verification, environment inventory, DNS/identity recovery ownership, and a timed Replit-loss drill from an independent machine/context.

## Consequences

The architecture accepts adapter and documentation overhead in exchange for avoiding a workspace/vendor single point of failure. Preferred vendors can still accelerate staging. Some vendor-specific features may be used behind ports, but only with export and fallback evidence.

## Migration and rollback

Platform migration is staged by surface: establish the external source and recovery owners, reproduce locked builds, provision non-public environments, restore a disposable database/object copy, validate identity/DNS/telemetry boundaries, then move one traffic or worker role at a time. No provider metadata replaces canonical IDs or PostgreSQL state, and no production cutover occurs until rollback evidence exists.

Rollback uses the last verified image/config plus independently controlled database/object recovery and DNS records. A provider change must preserve export, credential rotation, schema compatibility, and an explicit return path; Replit is never the rollback system of record. Database rollback prefers restore to a disposable verified point or a forward corrective migration over destructive down-migration. Failed recovery or missing custody leaves the affected surface unavailable rather than silently falling back to development identity, secrets, or storage.

## Security and privacy consequences

Every provider adds account ownership, region, subprocessor, DPA, retention, access, secret, billing, export, and termination risk. Company-owned MFA/recovery, least privilege, environment separation, KMS/rotation, private storage, encrypted backups, redacted telemetry, incident notification, and access review are launch gates. Backup copies and source bundles need their own encryption, retention, custody, and restore audit. Portability must not become uncontrolled replication of customer data or secrets.

## Rejected alternatives

- Replit checkpoints, workspace storage, database, secrets, or deployments as the only copy.
- A second cloud copy without tested reconstruction.
- Vendor-native schema/identity claims as core domain truth.
- Kubernetes or multi-cloud active/active before measured need.
- Declaring continuity passed from documents or local archives alone.

## Verification

Automated checks reject imports/configuration tied to a development host, exercise standard PostgreSQL, build OCI images on Linux, and recreate from a clean clone. The continuity drill must remove Replit from the assumed dependency graph and demonstrate source/history recovery, secret re-entry, data/object restore, migration, build, test, and a non-public smoke deployment with timestamps and owners.

## Evidence boundary

Local clean-clone and container evidence can pass in Run 2. An independent canonical remote, managed backup copies, staging deploys, DNS recovery, and an authentic Replit-loss drill are **BLOCKED BY ACCOUNT / EXTERNAL STATE** until the founder provisions and controls them. A plan is not a completed drill.

## Primary sources

Portability behavior was rechecked 2026-08-16 in Replit's official [version-control documentation](https://docs.replit.com/learn/projects-and-artifacts/version-control), GitHub's [repository cloning](https://docs.github.com/en/repositories/creating-and-managing-repositories/cloning-a-repository) and [repository duplication](https://docs.github.com/en/repositories/creating-and-managing-repositories/duplicating-a-repository) guidance, the [OCI Image Specification](https://github.com/opencontainers/image-spec), and PostgreSQL's [backup and restore documentation](https://www.postgresql.org/docs/current/backup.html).
