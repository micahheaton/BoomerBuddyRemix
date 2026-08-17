# Migration Off Replit

Status: **portable procedure prepared; external source, PostgreSQL/object restore, OCI target, DNS cutover, and recovery timing remain unproved**

Recorded: 2026-08-16

## Objective

Move the exact same frozen BoomerBuddy release from Replit to a standard OCI/web/API/worker environment without treating Replit as the source of truth. A successful migration must preserve source history, configuration names, PostgreSQL truth, private objects, worker causality, identity/provider bindings, DNS rollback, and audit evidence.

The existing [Dockerfile](../../Dockerfile), [Docker Compose topology](../../docker-compose.yml), and [portability verifier](../../scripts/verify-portability.mjs) are the executable local foundation. They are not proof of a deployed replacement.

## Independent systems required before a drill

| Asset | Independent required custody | Current Run 3 evidence |
| --- | --- | --- |
| Source/history | Company-controlled private Git remote and immutable tag | Blocked pending founder remote |
| Release artifact | OCI registry or alternate platform build tied to commit/digest | Not produced in this run |
| PostgreSQL | Managed standard PostgreSQL export/PITR outside Replit failure domain | Blocked pending provider/database |
| Feedback/media objects | Private S3-compatible bucket plus inventory/hashes/retention | Adapter and provider not yet ready |
| Identity/KMS | Company-managed accounts, MFA/recovery, key versions | Blocked; production refusal remains |
| DNS | Founder-controlled registrar/DNS with exported records | Domain exists; custody/evidence pending |
| Payment/messaging | Stripe/Twilio provider truth independent of host | Provider configuration/evidence pending |
| Mobile signing | Company Apple/Google/Expo custody | Founder in progress; web-first does not wait |

## Freeze and inventory

1. Select the approved Git tag and record its full commit hash.
2. Record schema migration versions, active worker IDs, outbox/job/reconciliation counts, provider modes, public origins, and object inventory.
3. Export a names-only environment manifest from the Provisioning Console. Do not export secret values into the repository.
4. Record current Replit deployment IDs, build/artifact identifiers, DNS records/TTLs, database backup point, object inventory digest, and on-call owner.
5. Engage the global automation stop for the drill. Disable new invitations, checkout, and external sends unless the drill explicitly uses isolated provider-test objects.

## Source and artifact restoration

On a machine/account with no Replit session:

```sh
git clone <company-controlled-repository-url>
cd <repository-directory>
git checkout <frozen-candidate-tag>
git rev-parse HEAD
npm ci
npm run verify
node scripts/verify-portability.mjs
docker build --pull --tag boomerbuddy:<commit> .
```

The founder supplies repository access through the host credential manager; no token belongs in the command history or document. Record the OCI image digest and compare it to the candidate commit. If Docker is unavailable, the OCI gate remains blocked rather than inferred from source builds.

## Environment recreation

1. Create separate replacement API and worker services from the same image digest. Build customer web and HQ from the same commit with their recorded public API origin.
2. Recreate every required environment **name** from [`.env.example`](../../.env.example) and [REPLIT-FIRST-LAUNCH-RUNBOOK.md](./REPLIT-FIRST-LAUNCH-RUNBOOK.md).
3. Inject values through the replacement managed secret/KMS service. Record secret owner, version, rotation date, and recovery owner, never the value.
4. Keep `BB_SEED_DEMO=false`, `BB_ALLOW_DEV_IDENTITY=false`, and runtime `BB_RUN_MIGRATIONS=false`.
5. Keep production unavailable until the managed identity/KMS contract passes. Never replace it with development identity or hard-coded keys during recovery.

## PostgreSQL export and restore

Use provider-approved encrypted transport and least-privilege credentials.

1. Take a provider snapshot/PITR marker and a logical export at a recorded time.
2. Restore into a new isolated standard PostgreSQL database under an independent account or project.
3. Run the migration image once with the replacement migration credential.
4. Reconcile before serving traffic:
   - schema migration IDs/checksums;
   - tenant/household/person and consent state counts;
   - active/revoked/deferred relationship and enrollment counts;
   - canonical subscriptions, grants, allocations, provider inbox, and restrictions;
   - job/outbox state, consumer receipts, replay lineage, dead letters, and causal projections;
   - privacy requests, retention tombstones, and expired/deleted content state;
   - content-free audit/outbox continuity.
5. Run tenant-isolation, authorization, retention, and commerce test-mode smokes.
6. Record rejected/corrupt rows and stop if reconciliation is not exact under the documented policy.

Do not restore over the live source database. Do not call append-only retained evidence “deleted” when policy requires pseudonymized retention.

## Object/media restoration

No production feedback/media object adapter is currently proved, so this phase is blocked. Once implemented:

1. restore the encrypted source inventory to a private replacement bucket;
2. compare object count, version, checksum, encryption/key version, content type, size, quarantine state, retention expiry, and deletion marker;
3. verify tenant-bound access and denial from public/other-tenant identities;
4. verify deleted/quarantined items are not re-exposed; and
5. retain an independently controlled manifest and recovery duration.

Never use deployment-local disk as the migration source of record.

## Worker drain and replacement start

1. Stop creation of new externally consequential work.
2. Let Replit workers drain within `BB_WORKER_SHUTDOWN_MS`, then verify leases are completed or relinquished.
3. Snapshot/reconcile job, receipt, outbox, replay, and external-action states.
4. Start one replacement worker with a new unique `BB_WORKER_ID`.
5. Prove heartbeat, claim, lease renewal, lease-loss reclaim, causal predecessor blocking, dead-letter/replay, and outcome-unknown reconciliation with synthetic/test work.
6. Add another worker only after duplicate/race evidence passes.

Never allow old and new workers to execute the same external action class without the canonical external-action ledger and provider idempotency/reconciliation proof.

## Replacement service validation

Against a non-public staging hostname:

1. `GET /health/live` and `GET /health/ready` pass.
2. Customer and HQ origins remain separate; cross-audience requests fail.
3. Owner, support, reviewer, and household authorization checks retain exact scopes.
4. A synthetic Founding Household completes the approved customer journey without live money or real messaging.
5. Public Check proxy identity, quotas, body limits, redaction, and purge pass behind the actual edge.
6. Stripe test webhooks retain exact signature, binding, invoice-lineage, restriction, duplicate/reorder, outage, and reconciliation behavior.
7. Logs/alerts contain no raw Check, secret, token, safe word, phone/email, or feedback media.
8. The global stop and provider kill switches are exercised.

Record evidence as `deployed_staging`, never `live_production`, unless a later founder gate explicitly authorizes production.

## DNS cutover

DNS remains at the founder-controlled provider.

1. Prepare replacement API, customer web, and HQ records while original Replit records remain active.
2. Verify replacement TLS and origin allowlists on test hostnames.
3. Lower TTL only with founder approval and record prior values.
4. Change the smallest reversible record set, monitor health/errors/jobs/provider callbacks, and keep Replit available for rollback until the acceptance window closes.
5. Update provider webhooks/callbacks only through their founder-controlled consoles and verify test signatures before any live mode.

DNS or provider endpoint cutover is consequential and founder-gated. This document does not authorize it.

## Rollback

Rollback criteria include failed readiness, reconciliation mismatch, authorization regression, lost/duplicated work, unredacted telemetry, provider binding mismatch, elevated errors, or customer-impacting latency.

1. Engage global/provider stops and pause new consequential actions.
2. Drain replacement workers and preserve redacted evidence.
3. Restore original DNS records and provider endpoints under the founder gate.
4. Restart the last verified Replit tag only if its schema/config remains compatible.
5. If data diverged after cutover, do not blindly merge or overwrite. Reconcile canonical records and external provider truth under an incident plan.
6. Record decision owner, timestamps, affected actions, data point, and follow-up remediation.

## Acceptance checklist

The migration-off-Replit gate passes only when an independent operator records:

- exact frozen source hash and replacement artifact digest;
- clean locked install, tests, builds, V1 isolation, and portability;
- restored PostgreSQL point, duration, reconciliation, and retention/deletion truth;
- restored private object inventory and denial tests;
- independent identity/KMS recovery and key versions;
- one- and multi-worker durability behavior;
- non-public service/TLS/edge/browser/provider-test validation;
- DNS cutover and rollback timing;
- alert receipt and founder kill-switch proof; and
- no reliance on a Replit-only source, secret, database, object, domain, or signing key.

## Strongest evidence currently available

The local reconstruction script now refuses to run without both an immutable tag named `run3-local-candidate-<12-hex>` and its exact 40-character commit:

```sh
BB_CANDIDATE_REF=run3-local-candidate-<12-hex> \
BB_CANDIDATE_COMMIT=<40-hex-commit> \
node scripts/clean-clone-check.mjs
```

The external-source loss drill requires the same binding through `BB_CONTINUITY_GIT_REF` and `BB_CONTINUITY_GIT_COMMIT`, in addition to a non-Replit, non-loopback `BB_CONTINUITY_GIT_URL` with no credentials embedded in the URL. Both scripts check out detached, assert exact `HEAD`, and require a clean tree before installing, after all validation, and before emitting success. Authentication may still come from the operator's Git or SSH configuration, so the script proves only its exact URL checks—not credential-free transport or an independent external host.

Run 2 produced a clean-clone source/build check and local portability evidence. Run 3 has not yet performed the candidate-bound reconstruction, a founder-controlled external clone, OCI start, real PostgreSQL restore, object restore, Replit-loss simulation, replacement deployment, or DNS cutover. The procedure is therefore `prepared`, not completed recovery proof.
