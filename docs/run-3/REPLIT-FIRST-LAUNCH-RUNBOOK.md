# Replit-First Launch Runbook

> Historical pre-deployment runbook recorded 2026-08-16. Do not repeat its tag, migration, pull, or
> publish sequence for the healthy exact `d0c22310` release. Current deployment and backup evidence
> is recorded in
> [PRODUCTION-NONCHARGING-RELEASE-EVIDENCE.md](../run-3-1/PRODUCTION-NONCHARGING-RELEASE-EVIDENCE.md).
> Use this file only for controls that a later bounded change explicitly carries forward.

Status: **prepared locally; provider resources, managed PostgreSQL, exact deployment configuration, and deployed evidence remain open**

Recorded: 2026-08-16

## Purpose and stop rule

This is the shortest intended Replit-first path for the frozen BoomerBuddy launch candidate. Replit is a replaceable development and initial hosting surface. It is not the canonical source, DNS registrar, payment system of record, only backup, only secret-recovery location, or only operating runbook.

Do not publish a public customer surface until the frozen candidate's release checks pass. Production
configuration is structurally supported for the bounded one-household rollout, but it remains
default-off and must fail closed when identity, secret custody, database, or provider evidence drifts.

Before authorization, this runbook permits only read-only inventory. Do not create a tag until items
1 through 3 below are true. Item 4 is then the first authorized external write. Do not make any
Replit import or pull, provider configuration, database provision or migration, deployment, DNS
change, message, spend, or other external write until item 4 is complete and recorded:

1. The paid Family entitlement repair and applicable repository gates are complete on one clean,
   pushed candidate whose exact 40-character SHA, tree, and green exact-SHA GitHub CI are recorded.
2. Outside the candidate, an immutable `draft_pre_authorization` receipt based on
   [NONCHARGING-RELEASE-RECEIPT.md](../post-launch-beta/NONCHARGING-RELEASE-RECEIPT.md) records the
   candidate, planned annotated tag, exact ordered action manifest, target safe IDs, canonical scope
   digest, and zero external effects.
3. The account holder cites that receipt ID and digest and types
   `CONFIRM NONCHARGING RELEASE SETUP` in the active task.
4. As the first authorized external write, the operator creates and pushes the planned annotated tag,
   proves its remote tag object peels to the exact candidate and tree, and appends that evidence to the
   frozen external receipt before any provider write, Replit pull, migration, or deployment.

A changed candidate, tree, CI result, target, action order, provider inventory, or scope requires a new
receipt, digest, and confirmation. The phrase authorizes only the listed noncharging actions. It does
not authorize a customer account or contact, Checkout or Portal Session, charge, refund, first-payment
window, mobile-store submission, legal or provider attestation, or an action absent from the manifest.

The only canonical source is `https://github.com/micahheaton/BoomerBuddyRemix.git`. The four 2.0
Replit consumers are `boomerbuddy-web`, `boomerbuddy-api`, `boomerbuddy-worker`, and
`boomerbuddy-hq`; they pull the exact approved tag and never push. The separate legacy Replit project
`BoomerBuddy`, its root site `boomerbuddy.net`, Twilio evidence, and legacy Stripe webhook are outside
this runbook and remain untouched.

Replit's current official documentation supports importing public or private GitHub repositories, while secrets and database contents are not imported. It also distinguishes Autoscale, Reserved VM, Scheduled, and Static deployment types. Recheck the live provider UI and documentation before spending or publishing:

- [Import from a provider](https://docs.replit.com/build/import-from-providers)
- [Deployment types](https://docs.replit.com/features/publishing/deployment-types)
- [Secrets](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets)
- [Custom domains](https://docs.replit.com/features/publishing/custom-domains)
- [Deployment monitoring](https://docs.replit.com/features/publishing/monitoring-a-deployment)
- [Publishing costs](https://docs.replit.com/billing/deployment-pricing)

## Company-custody prerequisites

Before authorization, perform only read-only inventory for these prerequisites. After authorization,
perform only the exact actions named in the receipt without placing credentials in Git, prompts,
screenshots, or logs:

1. Confirm read-only that the company-controlled private remote is exactly
   `https://github.com/micahheaton/BoomerBuddyRemix.git`, with MFA, recovery owners, protected `main`,
   and immutable release tags. Do not create or select another source repository.
2. Confirm read-only the company-controlled registrar/DNS custody and recovery for the three 2.0
   public hosts. Do not change the root legacy `boomerbuddy.net` site, its routing, or its Replit
   project.
3. Inventory every existing managed PostgreSQL project and database in the intended company account.
   Select the exact existing staging or production database only when its safe IDs, environment,
   region, ownership, backup boundary, and application mapping match the receipt. Provision a new
   database only when read-only inventory proves the intended target is absent and the authorized
   action manifest names its provider, region, cost ceiling, owner, backup boundary, verification,
   and rollback. Never create a second database merely because Replit exposes a Database button.
   Replit-native PostgreSQL is acceptable only if the independent restore drill passes before
   activation.
4. Inventory the existing production identity applications and surface-separated secret custody.
   Select the exact existing Customer and HQ applications by safe ID. Create, rename, delete, or
   replace an application only when absence is proved and that exact operation appears in the
   authorized manifest. For the
   bounded beta, the matching Replit project's encrypted Secrets store is accepted with the documented
   residual risk; do not share API and worker provider credentials or store any secret in source.
5. Record the Replit monthly spending ceiling and billing-alert owner. Make a billing or limit change
   only when the exact value and cost boundary are in the authorized manifest. Do not assume plan
   credits are a hard cap.
6. Record Replit account owner, MFA owner, recovery owner, workspace/project identifiers, plan, region where selectable, and termination/export procedure in [FOUNDER-PROVISIONING.md](./FOUNDER-PROVISIONING.md).

## Import the canonical source

1. In the company-controlled Git host, verify the authorized annotated tag and commit from the
   external receipt. Confirm the canonical repository identity is exactly
   `https://github.com/micahheaton/BoomerBuddyRemix.git`. For the checkout remote, use exactly that
   credential-free HTTPS URL with an HTTPS-compatible read-only credential or exactly
   `git@github.com:micahheaton/BoomerBuddyRemix.git` with the preferred read-only deploy key. Copy
   only the repository URL and tag name, never a token. A planned tag is not evidence before the
   two-stage sequence above finishes.
2. Only when Replit import is the next authorized action, use **Import → GitHub**, connect the company
   organization with least repository scope, select only `micahheaton/BoomerBuddyRemix`, and import it
   into the exact 2.0 project named in the receipt. Never import, connect, or synchronize the legacy
   `BoomerBuddy` project.
3. In the Replit Git pane or shell, fetch tags and check out the exact frozen candidate tag. Verify:

   ```sh
   git rev-parse HEAD
   git status --short
   ```

4. Compare the hash to the dossier. A mismatch stops the deployment.
5. Run `npm ci`. Do not use an uncommitted Replit checkpoint as the release source.
6. Run `npm run verify`, `node scripts/verify-portability.mjs`, and the candidate-specific evidence checks. Record outputs and the Replit project/deployment IDs without secret values.
7. Treat every Replit project as a pull-only deployment consumer. Do not make emergency source edits in Replit and never push code or editor checkpoints from Replit. Make and review every change in the canonical GitHub repository, then have each service pull the exact approved commit before redeployment.

The existing [`.replit`](../../.replit) file is canonical shared service configuration. It defines
the repository-owned entrypoint and deployment commands used by the exact-tag wrapper, while the
wrapper selects the specific web, API, worker, or HQ service. Replit-local provider type, domain,
cost, alert, secret, and published-environment settings do not belong in source or in local Replit
checkpoint commits.

## Technically enforced GitHub pull-only credentials

Policy language is not sufficient. Before any Replit pull or deployment, give each 2.0 project its
own repository-scoped read-only credential:

| Replit project | Required credential boundary |
| --- | --- |
| `boomerbuddy-web` | Unique credential for `micahheaton/BoomerBuddyRemix`; fetch only |
| `boomerbuddy-api` | Unique credential for `micahheaton/BoomerBuddyRemix`; fetch only |
| `boomerbuddy-worker` | Unique credential for `micahheaton/BoomerBuddyRemix`; fetch only |
| `boomerbuddy-hq` | Unique credential for `micahheaton/BoomerBuddyRemix`; fetch only |

Prefer one unique GitHub deploy key per project with **Allow write access** unchecked. If provider
constraints require a GitHub App installation or fine-grained token, retain an export proving that it
is scoped only to this repository, has `Contents: Read-only` and `Metadata: Read-only`, and has no
repository, organization, or user write permission. Do not reuse one credential across projects.
Store the private value only in the matching Replit protected credential store. Keep the Git remote
credential-free, and never place a private key, token, authenticated URL, or raw provider export in
Git, a command transcript, screenshot, receipt, or application environment variable.

Disable or remove any Replit GitHub connection that retains write permission. With the exact
credential used by that project, prove the approved tag fetch succeeds. Then run only this
nonmutating negative proof with a new receipt-specific branch name:

```sh
git push --dry-run origin HEAD:refs/heads/bb-denied-write-proof-<receipt-id>
```

It must exit nonzero because the credential cannot write. Exit zero is a hard stop, even though
`--dry-run` did not create the ref. Never remove `--dry-run`, and never test a force, delete, branch,
or tag write. Record only project name, safe credential ID or fingerprint, credential type,
repository scope, permission export, expiry/rotation date, successful exact-tag fetch, nonzero denial
classification, UTC timestamp, and recovery owner. A credential value or a user identity is not
evidence.

## Intended deployment topology

Use separate deployable processes from the same frozen commit. Final provider type selection remains a staging measurement, not a permanent architecture decision.

| Surface | Initial Replit hypothesis | Build command | Start command | Public exposure |
| --- | --- | --- | --- | --- |
| API | Reserved VM for predictable health/webhooks; compare Autoscale in staging | `npm run build -w @boomerbuddy/api` | `npm run start -w @boomerbuddy/api` | HTTPS API only |
| Worker | Reserved VM because leases, schedules, and reconciliation are continuous | `npm run build -w @boomerbuddy/worker` | `npm run start -w @boomerbuddy/worker` | Private provider liveness only; no custom domain |
| Customer web | Autoscale | `npm run build -w @boomerbuddy/web` | `npm run start -w @boomerbuddy/web` | Customer HTTPS origin |
| HQ | Private Autoscale or Reserved VM plus application auth; never rely only on Replit visibility | `npm run build -w @boomerbuddy/hq` | `npm run start -w @boomerbuddy/hq` | Separate restricted HTTPS origin |
| Migration | One founder-controlled release step before API/worker rollout | `npm run build -w @boomerbuddy/worker` | `node apps/worker/dist/migrate.js` | None; run once |

If one Replit project cannot publish these processes independently, import the same canonical repository into separate company workspace projects, pin every project to the same frozen commit, and record the mapping. Do not copy source manually between projects.

## Environment-variable inventory

The authoritative current inventory is [`.env.example`](../../.env.example). Replit secret values belong only in its encrypted Secrets interface or the selected managed secret system. Repository documents contain names only.

### Common API and worker names

- `NODE_ENV`
- `BB_DATABASE_DRIVER`
- `DATABASE_URL`
- `BB_POSTGRES_POOL_MAX`
- `BB_RUN_MIGRATIONS`
- `BB_SEED_DEMO`
- `BB_ALLOW_DEV_IDENTITY`
- `BB_FOUNDER_PERSON_ID`
- `BB_CUSTOMER_ORIGINS`
- `BB_HQ_ORIGINS`
- `BB_TRUSTED_PROXY_HOPS`
- `BB_SESSION_SECRET`
- `BB_ARTIFACT_KEY_BASE64`
- `BB_FINGERPRINT_KEY_BASE64`
- `BB_SAFE_WORD_PEPPER`
- `BB_LOG_LEVEL`

Secret values stay only in the matching Replit project Secrets or an approved stronger vault; this is a bounded one-household custody decision, not a KMS claim. `BB_FOUNDER_PERSON_ID` must come from the provisioned identity and match the exact founder; leaving it unset keeps operator controls closed. Never invent an identity or paste values into this file.

### API-only names

- `BB_API_HOST`
- `BB_API_PORT`
- `BB_STRIPE_LIVE_API_RESTRICTED_KEY`
- `BB_STRIPE_LIVE_WEBHOOK_SECRET`

### Default-off acquisition and support names

| Variable | API | Customer web | Worker/HQ |
| --- | --- | --- | --- |
| `BB_PRIVATE_BETA_ACCESS_INTENTS_ENABLED` | `false` baseline | `false` baseline | absent |
| `BB_PRIVATE_BETA_ACCESS_INTENTS_EDGE_GUARD_CONFIRMED` | `false` baseline | `false` baseline | absent |
| `BB_SUPPORT_RECEIPTS_CUSTOMER_ACCESS_ENABLED` | `false` baseline | absent | absent |
| `BB_SUPPORT_RECEIPTS_HQ_QUEUE_ENABLED` | `false` baseline | absent | absent |
| `BB_SUPPORT_RECEIPTS_INTAKE_ENABLED` | `false` baseline | absent | absent |

Do not rely on omission as the deployment record. Bind these exact names and false values to the
release receipt. For private-beta access intents, follow
`PRIVATE-BETA-ACCESS-INTENTS.md`: prove the edge and mailbox gates, then set both access-intent
variables true on API and customer web together. On rollback, set the enabled variable false on
both services first, then return the edge confirmation to false.

For content-free support receipts, keep intake false; set customer access and HQ queue true on API;
redeploy and prove both read paths with separate synthetic sessions; then set intake true and run
the bounded drill. Roll back intake first, then return all three support variables to false. Never
place these variables on worker, customer web, or HQ, and never use customer PII in the drill.

### Stripe surface-separated names

- `BB_STRIPE_MODE`
- `BB_STRIPE_RUNTIME_SURFACE`
- `BB_STRIPE_LIVE_INITIATION_ENABLED`

| Resource/control | API project | Worker project |
| --- | --- | --- |
| Runtime surface | `BB_STRIPE_RUNTIME_SURFACE=api` | `BB_STRIPE_RUNTIME_SURFACE=worker` |
| Initiation | `BB_STRIPE_LIVE_INITIATION_ENABLED=false` by default; true only after exact preflight and an active, unexpired, operator-approved max-one cohort | exactly `false` |
| Account | `BB_STRIPE_LIVE_ACCOUNT_ID` | same identifier |
| API credential | `BB_STRIPE_LIVE_API_RESTRICTED_KEY` only | absent |
| Worker credential | absent | `BB_STRIPE_LIVE_WORKER_RESTRICTED_KEY` only |
| Webhook endpoint secret | `BB_STRIPE_LIVE_WEBHOOK_SECRET` only | absent |
| Family product | `BB_STRIPE_LIVE_FOUNDING_PRODUCT_ID` | same identifier |
| Family monthly price | `BB_STRIPE_LIVE_FOUNDING_MONTHLY_PRICE_ID` | same identifier |
| Bounded Portal configuration | `BB_STRIPE_LIVE_CANCEL_ONLY_PORTAL_CONFIGURATION_ID` | same identifier |

The API and worker must use the same exact live account and Family $14.99/month resource identifiers,
but must never receive the same credential manifest. Both keys are restricted `rk_live_` credentials
with least privilege for their surface. The deprecated shared `BB_STRIPE_LIVE_API_KEY` is always
absent and rejected. The Stripe API version is code-owned. Production refuses every
`BB_STRIPE_TEST_*` value. Live mode is structurally supported but default-off: configuration,
database initiation control, household eligibility, the active approved max-one cohort, recent HQ
MFA, and exact live US-company account/resource preflight must all agree before Checkout can start.

### Messaging disabled sentinel and reserved names

- `BB_TWILIO_MODE=disabled`
- `BB_TWILIO_ACCOUNT_SID`
- `BB_TWILIO_AUTH_TOKEN`
- `BB_TWILIO_MESSAGING_SERVICE_SID`
- `BB_TWILIO_TOLL_FREE_NUMBER_SID`
- `BB_TWILIO_INBOUND_WEBHOOK_BASE_URL`
- `BB_TWILIO_STATUS_CALLBACK_BASE_URL`

Only the literal disabled mode is accepted. The current configuration rejects every reserved
credential, identifier, and callback value, and no Twilio adapter or provider network path exists.
Do not provision these names into Replit until a future reviewed provider-test adapter defines and
accepts its exact managed-secret contract.

### Worker-only names

- `BB_WORKER_ID`
- `BB_STRIPE_LIVE_WORKER_RESTRICTED_KEY`
- `BB_WORKER_POLL_MS`
- `BB_WORKER_LEASE_MS`
- `BB_WORKER_HEARTBEAT_MS`
- `BB_WORKER_SHUTDOWN_MS`
- `BB_WORKER_BATCH_SIZE`
- `BB_WORKER_RETRY_BASE_MS`
- `BB_WORKER_RETRY_MAX_MS`

Every worker instance needs a distinct stable `BB_WORKER_ID`.
For the initial 0.25-CU beta, configure API `BB_POSTGRES_POOL_MAX=2`, worker
`BB_POSTGRES_POOL_MAX=1`, and `BB_WORKER_BATCH_SIZE=1`; use pool max 1 for the controlled migration
process. These values are capacity backpressure, not credentials. Any PostgreSQL SQLSTATE `53200`
stops launch verification and requires lower concurrency or a larger compute before retry.

### Customer web, HQ, and mobile build names

- `NEXT_PUBLIC_API_URL`
- `EXPO_PUBLIC_API_URL`

Customer web also requires
`BB_CUSTOMER_CLERK_SELF_DELETION_DISABLED_CONFIRMED=false` at baseline. Set it true only after the
Customer Clerk instance proves direct self-deletion disabled and the protected BoomerBuddy deletion
workflow remains canonical. While false, `/member/account-security` intentionally does not mount
the broader Clerk profile. Omit this variable from API, worker, HQ, and mobile.

Public build variables are not secrets. They must contain only the intended HTTPS API origin and must be set before building each client.

## Persistent data and filesystem rules

- Use `BB_DATABASE_DRIVER=postgres`; never use PGlite or deployment-local files for customer truth.
- Set `BB_RUN_MIGRATIONS=false` in API and worker. Run the migration release step once with a least-privilege migration credential, then remove that credential from runtime processes.
- Set `BB_SEED_DEMO=false` and `BB_ALLOW_DEV_IDENTITY=false` for every deployed environment.
- No customer upload or feedback media may rely on the Replit filesystem. Media intake remains disabled until the private object-storage adapter, malware/quarantine path, retention, backup, and restore evidence exist.
- Take and verify a logical database export outside Replit before every material migration and on the founder-approved schedule.

## Pre-publish checks

From the exact candidate commit:

```sh
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
node scripts/verify-portability.mjs
```

Then bind the local clean-clone proof to the immutable candidate tag and commit:

```sh
BB_CANDIDATE_REF=run3-local-candidate-<12-hex> \
BB_CANDIDATE_COMMIT=<40-hex-commit> \
node scripts/clean-clone-check.mjs
```

Run the dependency/SBOM, real-PostgreSQL, restore, and browser evidence gates separately. A local PGlite pass is insufficient for PostgreSQL or deployed-edge claims.

## Health and smoke checks

Before DNS or customer invitation:

1. Run migrations against a disposable/empty staging database and verify the schema version.
2. Start one API and one worker. Confirm the API's `GET /health/live` and `GET /health/ready` return success through its deployment URL. Confirm the private worker liveness listener returns only static success at `/` and `/health/live`.
3. Confirm the worker database heartbeat becomes current and a synthetic local-only job is claimed, completed, and reconciled; the static HTTP listener is liveness, not worker readiness.
4. Verify customer and HQ origins are disjoint and cross-audience requests fail.
5. Run the full Edge suite against staging with synthetic personas only.
6. Exercise Public Check behind the actual proxy path and validate `BB_TRUSTED_PROXY_HOPS` against observed addresses; forged forwarding headers must not bypass quotas.
7. Verify redacted logs and alerts without submitting real scam content, secrets, or customer data.
8. Confirm all five acquisition/support variables match the recorded false baseline. If their
   synthetic drills are in scope, follow the exact staged activation and rollback order above and
   finish with the receipt-recorded values.
9. If Stripe test configuration exists, use signed test webhooks and test-mode objects only. Confirm no live key or live product ID is loaded.
10. Stop one worker during a leased test job and prove reclaim/reconciliation before adding another worker.

Record deployment ID, exact commit, schema version, image/build digest where available, timestamp, operator, and evidence category (`local`, `provider_test`, or `deployed_staging`).

## Custom domain and DNS

The founder retains DNS at the company-controlled provider. Replit documents custom-domain connection and certificate management, but the exact current records must be copied from the provider UI at activation time.

1. Prepare separate hostnames for customer web, API, and HQ. Keep HQ non-indexed and access-controlled.
2. Lower TTL only after founder approval and record the original value/records.
3. Add the provider-specified verification and routing records in a reversible change set.
4. Wait for provider verification and TLS issuance. Verify certificate hostname, redirect behavior, HSTS policy, CORS origins, cookie scope, API health, and audience separation.
5. Do not move registrar custody or nameservers to Replit merely for convenience.
6. Preserve the previous records and rollback deadline. DNS activation is a founder-only consequential action.

## Monitoring, alerts, and cost controls

Replit's deployment monitoring provides provider-side request/resource/log views, but it is not the only incident record. Configure the approved external error/uptime system once provisioned, keep logs redacted, and test alert receipt to the named founder/on-call owner.

Before enabling pay-as-you-go publishing:

- founder records the plan and current provider pricing;
- founder sets the smallest available workspace/deployment spending limit and a lower internal alert threshold;
- every deployment has an accountable cost owner and monthly ceiling in the Provisioning Console;
- worker and API machine sizes start at the smallest measured safe setting;
- autoscaling maximums are bounded; and
- usage is reviewed after the first synthetic staging session and each Founding Household.

Pricing and credits are provider state and may change. This runbook does not authorize a purchase or quote a guaranteed monthly bill.

## Deploy and redeploy a frozen tag

1. Founder selects an approved candidate tag in the canonical remote.
2. Replit projects fetch that tag and verify identical commit hashes.
3. Build all surfaces with the recorded environment-name manifest.
4. Run the migration step once and capture its result.
5. Deploy API, then one worker, then customer web, then HQ.
6. Execute readiness and synthetic smoke checks before adding traffic or another worker.
7. Record deployment IDs/build hashes beside the Git tag. Never deploy an uncommitted workspace state.

## Rollback and emergency stop

Rollback is application-version rollback plus forward-compatible data handling; do not destructively down-migrate.

1. Engage BoomerBuddy's global automation stop and disable provider adapters where supported.
2. Stop new customer invitations/checkout at the application gate.
3. Drain or relinquish workers within the configured shutdown deadline; verify no leases remain orphaned.
4. Redeploy the last verified tag against the current compatible schema, or keep services unavailable if compatibility is uncertain.
5. For suspected data corruption, isolate traffic and restore a verified database copy into a separate database before deciding cutover.
6. Restore prior DNS records only under the founder rollback gate.
7. Preserve redacted incident evidence, provider event IDs, schema/build versions, and recovery decisions.

To disable Replit production quickly, the founder stops/pauses the customer web, API, worker, and HQ deployments; leaves DNS under company control; disables provider webhooks/keys from provider consoles if compromised; and keeps database/object systems private for investigation. Never delete the only data copy as an emergency action.

## Current evidence and blocker decision

Local Run 2/Run 3 gates prove standard Node builds and portability checks, not Replit deployment. No Replit project import, provider build, managed database connection, custom domain, TLS, staging proxy, alert, rollback, or cost-control evidence has been produced in this run. Stripe is not production-capable and remains default-off; the paid Family entitlement mismatch and every deployment/provider proof gate remain open. Twilio remains disabled.

Therefore this runbook is `prepared`, not `test_proven` or `ready_for_live_review`.
