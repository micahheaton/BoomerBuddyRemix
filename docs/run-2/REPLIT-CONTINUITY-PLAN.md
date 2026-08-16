# Replit Continuity Plan

Status: **approved design and executable partial drill; external recovery proof is blocked**.

## Objective and boundary

BoomerBuddy must remain reconstructable after permanent loss of the Replit account, workspace, secrets, deployments, and storage. Replit is an optional development host, never the source of truth. This plan does not claim recovery until an independent operator executes the full drill with founder-controlled external systems.

## Systems of record

| Asset | Required independent system | Run 2 state |
| --- | --- | --- |
| Source and history | Private founder-controlled GitHub repository | **Blocked:** no remote configured |
| Release artifacts | Tagged, immutable external CI artifacts plus hashes | **Not implemented** |
| Database | Managed standard PostgreSQL with PITR and encrypted off-provider export | **Blocked:** no Neon project/backup |
| Sensitive objects | Private encrypted S3-compatible bucket plus tested replica/export | **Not implemented; no production objects** |
| Identity | Founder-controlled managed IdP with recovery owners/export plan | **Not selected or provisioned** |
| DNS/domain | LLC-controlled registrar and Cloudflare zone with independent recovery | **Blocked:** no zone evidence |
| Secrets | Managed environment/KMS, documented by name and owner, never value | **Not implemented** |
| Mobile | LLC-owned Apple/Google/Expo accounts and recoverable signing credentials | **Blocked by accounts/devices** |

## Founder setup actions

1. Create the private GitHub repository under a BoomerBuddy LLC-controlled organization. Require MFA, two recovery owners, protected `main`, passing CI, review, and signed/tagged releases. Add the remote without copying credentials into Replit.
2. Configure a separate encrypted source mirror or regularly verified repository bundle under a different failure domain.
3. Provision non-public staging accounts for the selected PostgreSQL, identity, hosting, DNS, object-storage, monitoring, and commerce providers. Record legal owner, billing owner, technical owner, recovery contacts, export method, credential-rotation method, and exit procedure.
4. Choose database recovery-point and recovery-time objectives. Enable provider PITR and a separately encrypted logical backup; schedule restores into an isolated database.
5. Keep domain registrar recovery independent from Replit and hosting. Export DNS records after every material change.
6. Establish LLC-owned Apple, Google, and Expo accounts with documented team roles, recovery codes, bundle/package identifiers, and signing-credential continuity.
7. Store this inventory and recovery evidence in a controlled system available without Replit. Never store secret values in this repository.

## Environment inventory

The authoritative non-secret names start in [`.env.example`](../../.env.example). Recovery must supply and validate:

- runtime/environment, API host/port, customer/HQ origins, database driver/URL, migration and seed flags;
- independent session, artifact-encryption, fingerprint, and safe-word key references;
- Stripe test mode, key, endpoint secret, API version, cancel-only portal configuration, and four plan price IDs;
- worker identity, lease, heartbeat, polling, retry, batch, and shutdown settings; and
- customer web/mobile API origins.

Production must replace raw development key values with managed identity and KMS/secret references. Record key versions and rotation/recovery owners, not key material.

## Replit Loss Drill

### Phase A — source/build proof

From a machine and account with no Replit session:

```powershell
$env:BB_CONTINUITY_GIT_URL = 'https://github.com/OWNER/PRIVATE-REPOSITORY.git'
node scripts/replit-loss-drill.mjs
```

The script must clone the non-Replit remote into a new temporary directory, run `npm ci`, portability, types, tests, and builds, and emit `partial_source_build_proof_only`. Preserve timestamp, commit/tag, runner identity, command output, and artifact hashes. A pass proves source/build recovery only.

### Phase B — data recovery

1. Restore the selected point-in-time PostgreSQL backup into an isolated standard PostgreSQL instance.
2. Apply only pending forward migrations; run readiness and tenant-isolation smoke checks.
3. Restore the object inventory into a private replacement bucket and verify count, hashes, encryption, IAM denial, and lifecycle dates.
4. Record recovery duration, chosen recovery point, rejected/corrupt records, and approval. Do not use customer production traffic.

### Phase C — service and domain recovery

1. Inject staging secrets through the replacement environment; never copy Replit secrets.
2. Build the OCI image and start migration, API, and worker. Deploy customer web and HQ separately.
3. Verify health, database connectivity, audience separation, one synthetic Check, one synthetic job, retention, and Stripe **test** webhook reconciliation.
4. Lower DNS TTL in advance, prepare replacement records, verify TLS and origin allowlists, then perform a non-public/test-hostname cutover. Restore the original records after evidence capture.

### Phase D — mobile continuity

Build signed internal iOS and Android previews from the recovered source using LLC-owned accounts. Verify identity session storage, API environment, restore-account path, and store sandbox entitlement synchronization on supported devices. Do not submit or release.

## Acceptance record

The drill passes only when evidence shows source/history, reproducible artifacts, database and object restore, independent secrets, API/worker/web/HQ startup, DNS/TLS recovery, and signed mobile preview continuity without Replit. Record responsible people, timestamps, commit and schema versions, backup point, artifact hashes, recovery duration, discrepancies, and corrective actions. Repeat after material platform changes and on a founder-approved cadence.

## Current verdict

`scripts/verify-portability.mjs` passed locally, and required platform configuration exists. The external Git source, backup/restore, DNS, vendor, and mobile phases have not run. Therefore BoomerBuddy has reduced Replit coupling but **cannot yet claim survival of permanent Replit loss**. This is a Run 3 launch-enablement blocker; Run 2 does not launch.
