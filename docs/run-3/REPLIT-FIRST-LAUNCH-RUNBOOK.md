# Replit-First Launch Runbook

Status: **prepared locally; founder account, canonical remote, production identity/KMS, managed PostgreSQL, and deployed evidence remain blocked**

Recorded: 2026-08-16

## Purpose and stop rule

This is the shortest intended Replit-first path for the frozen BoomerBuddy launch candidate. Replit is a replaceable development and initial hosting surface. It is not the canonical source, DNS registrar, payment system of record, only backup, only secret-recovery location, or only operating runbook.

Do not publish a public customer surface until the frozen candidate's executive verdict and founder activation checklist allow it. The current code deliberately rejects `NODE_ENV=production` until managed identity and KMS adapters are real. Do not change that refusal to make this runbook appear complete.

Replit's current official documentation supports importing public or private GitHub repositories, while secrets and database contents are not imported. It also distinguishes Autoscale, Reserved VM, Scheduled, and Static deployment types. Recheck the live provider UI and documentation before spending or publishing:

- [Import from a provider](https://docs.replit.com/build/import-from-providers)
- [Deployment types](https://docs.replit.com/features/publishing/deployment-types)
- [Secrets](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets)
- [Custom domains](https://docs.replit.com/features/publishing/custom-domains)
- [Deployment monitoring](https://docs.replit.com/features/publishing/monitoring-a-deployment)
- [Publishing costs](https://docs.replit.com/billing/deployment-pricing)

## Company-custody prerequisites

The founder must complete these without placing credentials in git, prompts, screenshots, or logs:

1. Create or confirm a company-controlled private Git remote with MFA, recovery owners, protected `main`, and immutable release tags.
2. Confirm founder-controlled `boomerbuddy.net` registrar/DNS custody and recovery.
3. Provision an external standard PostgreSQL staging database with backup/export capability. Replit-native PostgreSQL is acceptable only if the independent restore drill passes before activation.
4. Provision managed identity and KMS/secret custody. Until adapters and evidence exist, production startup must keep refusing.
5. Set a Replit monthly spending ceiling and billing-alert owner. Do not assume plan credits are a hard cap.
6. Record Replit account owner, MFA owner, recovery owner, workspace/project identifiers, plan, region where selectable, and termination/export procedure in [FOUNDER-PROVISIONING.md](./FOUNDER-PROVISIONING.md).

## Import the canonical source

1. In the company-controlled Git host, verify the intended frozen tag and commit. Copy only the repository URL and tag name, never a token.
2. In Replit, use **Import → GitHub**, connect the company organization with least repository scope, select the private repository, and import it.
3. In the Replit Git pane or shell, fetch tags and check out the exact frozen candidate tag. Verify:

   ```sh
   git rev-parse HEAD
   git status --short
   ```

4. Compare the hash to the dossier. A mismatch stops the deployment.
5. Run `npm ci`. Do not use an uncommitted Replit checkpoint as the release source.
6. Run `npm run verify`, `node scripts/verify-portability.mjs`, and the candidate-specific evidence checks. Record outputs and the Replit project/deployment IDs without secret values.
7. Configure Replit Git to push only to the company canonical remote. Any emergency Replit edit must become a reviewed commit in that remote before redeployment.

The existing [`.replit`](../../.replit) file is a local development convenience (`npm run dev`); it is not a production deployment definition.

## Intended deployment topology

Use separate deployable processes from the same frozen commit. Final provider type selection remains a staging measurement, not a permanent architecture decision.

| Surface | Initial Replit hypothesis | Build command | Start command | Public exposure |
| --- | --- | --- | --- | --- |
| API | Reserved VM for predictable health/webhooks; compare Autoscale in staging | `npm run build -w @boomerbuddy/api` | `npm run start -w @boomerbuddy/api` | HTTPS API only |
| Worker | Reserved VM because leases, schedules, and reconciliation are continuous | `npm run build -w @boomerbuddy/worker` | `npm run start -w @boomerbuddy/worker` | None |
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

The raw secret names above are development/test inputs today, not an approved production KMS design. `BB_FOUNDER_PERSON_ID` must come from the provisioned identity and match the exact founder; leaving it unset keeps founder-only controls closed. Production must use the final managed references and key-version contract once implemented. Never invent an identity or paste values into this file.

### API-only names

- `BB_API_HOST`
- `BB_API_PORT`

### Stripe names consumed by the API and worker

- `BB_STRIPE_MODE`

| Resource | Test name | Live manifest name |
| --- | --- | --- |
| Account | `BB_STRIPE_TEST_ACCOUNT_ID` | `BB_STRIPE_LIVE_ACCOUNT_ID` |
| API credential | `BB_STRIPE_TEST_API_KEY` | `BB_STRIPE_LIVE_API_KEY` |
| Webhook endpoint secret | `BB_STRIPE_TEST_WEBHOOK_SECRET` | `BB_STRIPE_LIVE_WEBHOOK_SECRET` |
| Founding product | `BB_STRIPE_TEST_FOUNDING_PRODUCT_ID` | `BB_STRIPE_LIVE_FOUNDING_PRODUCT_ID` |
| Founding monthly price | `BB_STRIPE_TEST_FOUNDING_MONTHLY_PRICE_ID` | `BB_STRIPE_LIVE_FOUNDING_MONTHLY_PRICE_ID` |
| Cancel-only portal configuration | `BB_STRIPE_TEST_CANCEL_ONLY_PORTAL_CONFIGURATION_ID` | `BB_STRIPE_LIVE_CANCEL_ONLY_PORTAL_CONFIGURATION_ID` |

The API and worker must receive the same complete manifest for the selected environment; do not mix test and live resources. The Stripe API version is code-owned and is not an environment variable. Run 3 permits test configuration only after the applicable founder gate, and `BB_STRIPE_MODE=test` is not evidence that Stripe was actually exercised. Live resource names remain an offline custody manifest: raw `BB_STRIPE_LIVE_API_KEY` and `BB_STRIPE_LIVE_WEBHOOK_SECRET` values are refused, and API and worker startup in live mode remains refused until managed identity/KMS custody and its adapter exist. Do not set or invent live values to bypass those controls.

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
- `BB_WORKER_POLL_MS`
- `BB_WORKER_LEASE_MS`
- `BB_WORKER_HEARTBEAT_MS`
- `BB_WORKER_SHUTDOWN_MS`
- `BB_WORKER_BATCH_SIZE`
- `BB_WORKER_RETRY_BASE_MS`
- `BB_WORKER_RETRY_MAX_MS`

Every worker instance needs a distinct stable `BB_WORKER_ID`.

### Customer web, HQ, and mobile build names

- `NEXT_PUBLIC_API_URL`
- `EXPO_PUBLIC_API_URL`

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
2. Start one API and one worker. Confirm `GET /health/live` and `GET /health/ready` return success through the deployment URL.
3. Confirm the worker heartbeat becomes current and a synthetic local-only job is claimed, completed, and reconciled.
4. Verify customer and HQ origins are disjoint and cross-audience requests fail.
5. Run the full Edge suite against staging with synthetic personas only.
6. Exercise Public Check behind the actual proxy path and validate `BB_TRUSTED_PROXY_HOPS` against observed addresses; forged forwarding headers must not bypass quotas.
7. Verify redacted logs and alerts without submitting real scam content, secrets, or customer data.
8. If Stripe test configuration exists, use signed test webhooks and test-mode objects only. Confirm no live key or live product ID is loaded.
9. Stop one worker during a leased test job and prove reclaim/reconciliation before adding another worker.

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

Local Run 2/Run 3 gates prove standard Node builds and portability checks, not Replit deployment. No Replit project import, provider build, managed database connection, custom domain, TLS, staging proxy, alert, rollback, or cost-control evidence has been produced in this run. Production startup remains deliberately blocked on managed identity/KMS.

Therefore this runbook is `prepared`, not `test_proven` or `ready_for_live_review`.
