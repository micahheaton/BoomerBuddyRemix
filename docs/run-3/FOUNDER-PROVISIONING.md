# Founder Provisioning

Status: **secret-free Run 3 register; no row implies provider success**

Last repository review: 2026-08-17

## Status vocabulary

- `not_started`: no usable account/configuration evidence exists.
- `founder_in_progress`: the founder reports setup activity, but the verification test has not passed.
- `ready_for_test`: required non-live configuration is available through an approved secret/config system; the test is still pending.
- `test_proven`: the exact bounded provider test passed and retained evidence exists.
- `ready_for_live_review`: test evidence and professional/operational gates are complete enough for the founder to review activation.
- `blocked`: an explicit account, evidence, legal, security, or technical blocker prevents progress.

`ready_for_live_review` is not authorization to purchase, deploy, charge, send, publish, change DNS, submit an app, or open traffic.

## Console and evidence ledger

The founder-only HQ page at `/provisioning` reads the version-1, code-owned catalogue of exactly 23 workstreams. Its API is `GET /v1/hq/provisioning`; status changes use idempotent `POST /v1/hq/provisioning/:workstreamKey/transitions`. Both policy and persistence require the exact configured `BB_FOUNDER_PERSON_ID` plus a current `hq_owner` assignment to an internal organization. A top-level role claim, reviewer/support assignment, suspended assignment, sponsor assignment, or organization-less assignment is insufficient.

The console remains useful before any provider account exists: every row contains exact manual steps, the names of safe identifiers to retain outside the console, currently implemented environment-variable names, a verification test, allowed evidence tiers, a cost gate, a recovery owner, an export/termination procedure, and the next founder action. It stores none of the identifier values.

Evidence and status history are append-only. A transition stores only:

- workstream/status/evidence/blocker enum codes;
- an observation timestamp;
- an optional 43-character SHA-256 base64url manifest digest;
- actor, server-generated correlation, version, and workstream-bound `provisioning:<workstream>:<UUIDv4>` idempotency identifiers; and
- server recording time.

It does not accept notes, URLs, provider/account identifiers, evidence content, credential values, or secrets. A status mutation does not enqueue or invoke an adapter and cannot purchase, deploy, charge, message, change DNS, submit an app, or take any other external action.

The read projection shows the latest bounded evidence codes, observation/recording times, structured blocker, and retained manifest digest when present. The digest supports exact evidence reconciliation without exposing the manifest or its contents.

Upward progress is sequential. `ready_for_test` requires configuration evidence plus a retained manifest digest. `test_proven` requires an allowed external evidence tier and retained digest; repository review, founder report, and local simulation cannot satisfy it. `ready_for_live_review` requires a deployed-staging, human-validation, or professional-review packet. A downgrade requires invalidation evidence. `blocked` requires a bounded blocker code and must normally return through `founder_in_progress`.

Every nonbaseline observation must be at or after the immediately preceding status event. Provider-test/staging proof and live-review packets must also be no more than 24 hours old when the database records them; observations more than five minutes in the future fail closed. One database-authority timestamp binds the operation, evidence recording, and status event. A previously completed exact idempotent retry returns its stored result without reinterpreting the old evidence against a later gate.

Before `test_proven`, the retained external proof manifest whose SHA-256 digest is submitted must bind the workstream key and definition version, provider and test/staging mode, founder/company-owned account/environment identifiers held only in approved external custody, frozen release/commit, the exact `ready_for_test` configuration-manifest digest, verification procedure/version, observation time, result, and artifact checksums. A bare digest, screenshot, founder statement, local simulation, or provider-health row is not proof. The ledger stores only tier/codes/time/digest; manual founder review of the retained manifest remains an explicit gate until a separately reviewed adapter exists.

Before `ready_for_live_review`, the retained packet manifest must reference the exact retained test-proof digest and every required human or professional decision, including its version, scope, conditions, and expiry. Its digest is only a reconciliation handle; the founder must manually review the externally retained packet before recording the transition.

The historical rows in `docs/run-3/02-FOUNDER-PROVISIONING-STATUS.md` remain unchanged as the Run 2 handoff; Run 3 adds only a banner directing updates to this ledger. The initial ledger reconciles those rows conservatively: reported existing/ready/in-progress setup becomes only `founder_in_progress`; unknown/not-started/setup-needed becomes `not_started`; review/disabled/outside-repository/professional-decision states become `blocked`. No historical handoff term becomes `ready_for_test`, `test_proven`, or `ready_for_live_review`.

## Provisioning register

| Provider / asset | Purpose | Account owner | Status | Required safe identifiers / config names | Secret environment names | Verification test | Monthly cost ceiling | MFA / recovery owner | Export / termination | Last evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Company Git host (GitHub preferred) | Canonical source, protected release history, CI evidence | Founder/company | `not_started` | organization, repository slug, default branch, release tag policy | Host credential manager only; no app env required | Independent clone of frozen tag; branch protection/CI/recovery review | Founder must set before paid plan | Founder plus independent recovery owner | Repository mirror/bundle and release artifacts verified outside Replit | 2026-08-16: no remote configured |
| Replit | Development cockpit and candidate API/worker/web/HQ hosting | Founder/company | `founder_in_progress` | workspace ID, project IDs, deployment IDs, plan, region, release tag | Exact version-1 configuration and secret names are enumerated in the `replit` catalogue entry below; values stay in provider Secrets only | Import frozen tag, locked build, staging health/browser/proxy/worker/rollback drill | Founder must set before pay-as-you-go | Founder plus recovery owner | Canonical Git, DB/object export, names-only env manifest, stop/delete procedure | 2026-08-16: existing workflow; no Run 3 deploy |
| Domain registrar and DNS (Cloudflare or equivalent) | `boomerbuddy.net`, TLS routing, WAF/edge custody | Founder/company | `founder_in_progress` | registrar, zone ID, account ID, record export, nameservers, recovery contacts | Provider token only if an approved adapter is later required | Export records; reversible staging hostname/TLS/proxy test; rollback timing | Founder must set before paid services | Founder plus registrar recovery owner | Zone export, registrar transfer/unlock procedure, prior records | 2026-08-16: domain reported existing; custody proof pending |
| Managed PostgreSQL | Canonical customer, consent, commerce, job, audit truth | Founder/company | `not_started` | project/database/branch IDs, region, role names, backup policy | `DATABASE_URL` plus migration credential through secret manager; never in docs | Clean migrations, real-PG concurrency, least privilege, backup and independent restore/reconciliation | Founder must set before provisioning | Founder plus database recovery owner | Logical export, provider snapshot/PITR, restore to independent PostgreSQL | 2026-08-16: PGlite/local config only |
| Private S3-compatible object storage | Feedback screenshots/audio/media and encrypted retained objects | Founder/company | `not_started` | provider, region, bucket IDs, encryption/key refs, lifecycle, CORS | Future object endpoint/bucket/key reference names; adapter not yet final | Upload/quarantine/read/tenant denial/delete/export/restore with synthetic files | Founder must set before provisioning | Founder plus storage recovery owner | Inventory+checksums, encrypted export/replica, lifecycle/termination procedure | 2026-08-16: no production media adapter |
| Managed customer identity | Customer/HQ authentication, MFA, recovery, issuer/audience truth | Founder/company | `not_started` | provider tenant, customer/HQ applications, issuer, audiences, callback/logout URLs, assurance policy | Future identity client/issuer/JWKS secret names; adapter not yet final | Customer/HQ audience separation, MFA/step-up, invite binding, revocation, recovery, outage | Founder must set before provisioning | Founder plus independent identity recovery owner | User/identity mapping export, key rotation, break-glass and termination | 2026-08-16: development issuer only; production refused |
| KMS / managed secret system | Artifact keys, fingerprints, session signing, peppers, provider credentials | Founder/company | `not_started` | KMS project, key aliases/versions, secret names, rotation/disable policy | Production reference names to be defined by adapter; raw local names are not approved KMS evidence | Encrypt/decrypt/sign, denial, rotation, old-version read, revocation, restart/recovery | Founder must set before provisioning | Founder plus security recovery owner | Encrypted backup/reference inventory; rotate/revoke/terminate procedure | 2026-08-16: raw development env keys; production refused |
| Stripe | Default-off Checkout and Billing truth for the max-one Family $14.99/month rollout | Founder/company | `founder_in_progress` | exact account and Family product/price IDs, API version, bounded Portal config, tax decision; `BB_STRIPE_MODE`, `BB_STRIPE_RUNTIME_SURFACE`, `BB_STRIPE_LIVE_INITIATION_ENABLED`, environment-specific resource IDs | test key/secret; live API restricted key, separate live worker restricted key, and live webhook secret in their exact service stores | Signed test lineage plus exact live US-company account/resource preflight, surface-separated custody, and max-one control rehearsal | Provider work requires an explicit scoped execution decision; live initiation defaults off | Founder plus billing/admin recovery owner | Stripe data exports, webhook/key rotation, disable Checkout/Portal, close-account steps | 2026-08-16: founder reports account activated; no authentic provider or live preflight evidence retained |
| Stripe Tax / qualified tax review | Test tax configuration and live registration decision | Founder plus qualified adviser | `blocked` | business location, jurisdictions, registrations, product tax codes, policy decision | Provider-side configuration; no tax secret in repo | Adviser-reviewed test Checkout/tax result and documented live gate | Founder/adviser decision required | Founder | Configuration/export and registration/termination procedure | 2026-08-16: professional review absent |
| Twilio | Consent-aware service SMS/voice and delivery truth | Founder/company | `founder_in_progress` | account/subaccount, verified toll-free number, messaging service, webhook IDs, status callbacks; only `BB_TWILIO_MODE=disabled` is accepted locally | Reserved account/auth/callback names are rejected until a provider adapter and managed-secret contract are reviewed | Test destination only: signature, HELP/STOP, consent/suppression, quiet hours, delivery/failure/unknown reconciliation | Founder must set before provisioning | Founder plus communications recovery owner | Message/consent export, number port/release, key rotation, service disable | 2026-08-16: toll-free verification reported in progress; no provider evidence |
| Transactional email (Postmark or approved equivalent) | Account, support, lifecycle, and feedback email separated from marketing | Founder/company | `not_started` | account/server/stream IDs, verified domains, inbound route, webhook IDs | Future server token/signing names; adapter not yet final | Test inbox only: domain/signature, bounce/suppression, inbound feedback, outcome reconciliation | Founder must set before provisioning | Founder plus email recovery owner | Suppression/event export, domain/key rotation, stream disable/termination | 2026-08-16: no provider selected/proved |
| `feedback@boomerbuddy.net` | Customer feedback intake identity | Founder/company | `not_started` | mailbox/alias, routing owner, retention, inbound adapter | Provider-specific inbound signing/token names later | Send synthetic feedback, minimize/redact, receipt, close-loop routing; no raw content in logs | Included in approved email ceiling | Founder plus support recovery owner | Mailbox export, route disable, retention/deletion procedure | 2026-08-16: desired alias only |
| `support@boomerbuddy.net` | Customer support identity and escalation | Founder/company | `founder_in_progress` | mailbox/alias, routing/on-call owner, stated hours | Provider-specific inbound signing/token names later | Synthetic support case into exact assigned queue, response audit, suppression/privacy behavior | Included in approved email/support ceiling | Founder plus support backup | Mailbox/case export, routing failover, termination | 2026-08-16: existence/routing not verified |
| Sentry or approved error monitor | Redacted errors, releases, alert routing | Founder/company | `not_started` | organization/project IDs, region, release/environment naming, retention/sampling | Future DSN/auth token names; no token in source | Synthetic redacted error, release attribution, alert receipt, content/secret denial, outage behavior | Founder must set before provisioning | Founder plus incident backup | Event/config export, scrub/retention review, DSN revoke/project termination | 2026-08-16: not configured |
| PostHog or approved analytics | Privacy-minimized funnel/feature evidence | Founder/company | `not_started` | project/host IDs, region, allowed event dictionary, retention | Future public project key/server key names; no key in docs | Synthetic Founding Household funnel with no raw content/PII; opt-out/deletion/export | Founder must set before provisioning | Founder plus product-data recovery owner | Event/schema export, deletion/restriction, key revoke/project termination | 2026-08-16: not configured |
| Apple Developer / App Store Connect | iOS signing, TestFlight, later distribution | Founder/company | `founder_in_progress` | legal entity/team ID, bundle ID, App Store Connect app ID, roles | EAS/Apple credential manager only; never source/env docs | Permitted internal build on supported devices, share/deep-link/media/accessibility; no submission | Founder controls program fee decision | Founder plus signing recovery owner | Signing credential recovery/export where allowed, app transfer/termination plan | 2026-08-16: founder setup in progress; web path does not wait |
| Google Play Console | Android signing, internal testing, later distribution | Founder/company | `founder_in_progress` | legal entity, developer ID, package name, app ID, roles | Play/EAS credential manager only | Permitted internal build on supported devices; no production track/submission | Founder controls registration/usage decision | Founder plus signing recovery owner | Upload key recovery, app transfer/export/termination plan | 2026-08-16: founder setup in progress; web path does not wait |
| Expo / EAS | Native build/update and internal distribution tooling | Founder/company | `not_started` | owner/project ID, slug, bundle/package IDs, build profiles | Expo token/signing credentials in provider manager only | Reproducible internal iOS/Android builds tied to frozen commit; device matrix | Founder must set before paid usage | Founder plus mobile recovery owner | Project transfer/export, credential recovery, update disable/termination | 2026-08-16: local Expo web export only |
| Apollo or other enrichment | B2B discovery/enrichment only after separate approval | Founder/company | `blocked` | account/workspace/source IDs and approved data-purpose policy | Future provider key name only if approved | Offline fixtures remain the only proof; real query/outreach requires a separate founder/legal/privacy gate | Zero until separately approved | Founder | Data/export/deletion/opt-out/termination procedure before use | 2026-08-16: real use disabled |
| Dependency/security scanning | Current advisories, reachability, SBOM, licenses, package/image provenance | Company CI/security owner | `blocked` | registry, runner, report artifact IDs, commit/image digests | Registry/CI credentials in company secret manager only | Fresh audit + adjudication, clean candidate SBOM, OCI scan; zero applicable unresolved Critical/High | Founder sets CI/security ceiling | Founder plus security backup | Retained redacted adjudication/SBOM, raw restricted artifact, tool exit | 2026-08-16: local inventory only; fresh audit denied |
| Backup/offsite recovery store | Independent source, PostgreSQL, object, configuration, and evidence custody | Founder/company | `not_started` | storage/account IDs, region, schedule, retention, immutable setting | Backup credentials/KMS refs in approved secret system | Timed restore into independent systems with checksums/reconciliation | Founder must set before provisioning | Founder plus independent recovery owner | Full export/restore and destruction certificate/process | 2026-08-16: no external recovery proof |
| Accounting/bookkeeping | Financial system of record, credits/refunds/tax evidence | Founder/company and accountant | `blocked` | provider/account IDs, chart/policy owner, close cadence | Outside application unless an approved future integration exists | Accountant-reviewed test exports/reconciliation; repository remains subordinate | Founder/accountant decision | Founder plus accountant recovery owner | Provider export/retention/termination | 2026-08-16: deliberately outside repository |
| Legal/privacy/communications review | Terms, privacy, beta, SMS/email/referral, media, tax, institutional claims | Founder plus qualified reviewers | `blocked` | reviewer/engagement IDs safe to record, decision/version/effective date | None in source | Signed/retained review decisions mapped to product/version/jurisdiction | Founder approval required | Founder | Controlled decision/evidence archive and supersession history | 2026-08-16: professional evidence absent |

<!-- BEGIN CODE-OWNED FOUNDER PROVISIONING CATALOGUE V1 -->
## Exact code-owned catalogue details

This appendix is mechanically rendered from the immutable version-1 catalogue. It is the authoritative source for exact ordered founder steps and exact implemented provider-adapter environment names; the register table above is only a summary. `None` means no provider adapter environment name exists and no name may be invented to advance a status. A fail-closed disabled sentinel or a reserved name that configuration explicitly rejects is not an implemented adapter name and is documented separately in the current provider runbook.

### 10. `company_git` — Company Git host
<!-- catalogue-entry:company_git:v1 -->

- Definition version: `1`
- Purpose: Canonical source, protected release history, and CI evidence outside Replit.
- Account owner: Founder/company
- Conservative initial status: `not_started`
- Adapter state: `external_only`
- Ordered manual founder steps:
  1. `secure_account` — required before `founder_in_progress`: Create or confirm the company account, MFA, and recovery owner.
  2. `create_private_repository` — required before `ready_for_test`: Create the private canonical repository and record its safe organization and repository names.
  3. `protect_release_history` — required before `ready_for_test`: Protect the default branch and frozen release-tag policy.
  4. `independent_clone` — required before `test_proven`: Clone the frozen tag independently and retain the clean verification manifest.
  5. `review_recovery` — required before `ready_for_live_review`: Review repository export, mirror, and account-recovery procedures.
- Required safe identifier names: `organization`, `repository_slug`, `default_branch`, `release_tag_policy`
- Configuration environment names: None — no implemented adapter configuration environment name.
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Independent clean clone of the frozen tag plus branch, CI, and recovery review.
- Allowed retained proof tiers: `deployed_staging`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder plus independent recovery owner
- Export / termination: Repository mirror or bundle and release artifacts verified outside the host.
- Next founder action: Create or confirm the company-controlled private repository and recovery owners.

### 20. `replit` — Replit
<!-- catalogue-entry:replit:v1 -->

- Definition version: `1`
- Purpose: Development cockpit and candidate API, worker, web, and HQ hosting.
- Account owner: Founder/company
- Conservative initial status: `founder_in_progress`
- Adapter state: `provider_managed`
- Ordered manual founder steps:
  1. `secure_workspace` — required before `founder_in_progress`: Confirm company workspace custody, MFA, billing owner, and recovery owner.
  2. `import_frozen_tag` — required before `ready_for_test`: Import only the frozen canonical Git tag into the staging project.
  3. `configure_names_only` — required before `ready_for_test`: Enter required configuration and secret values only in Replit Secrets under the listed names.
  4. `deploy_staging` — required before `test_proven`: Create separate bounded staging API, worker, web, and HQ deployments.
  5. `run_rollback_drill` — required before `ready_for_live_review`: Retain health, proxy, worker, browser, restart, and rollback evidence.
- Required safe identifier names: `workspace_id`, `project_ids`, `deployment_ids`, `plan`, `region`, `release_tag`
- Configuration environment names: `NODE_ENV`, `BB_API_HOST`, `BB_API_PORT`, `BB_TRUSTED_PROXY_HOPS`, `BB_DATABASE_DRIVER`, `BB_PGLITE_PATH`, `BB_RUN_MIGRATIONS`, `BB_SEED_DEMO`, `BB_ALLOW_DEV_IDENTITY`, `BB_FOUNDER_PERSON_ID`, `BB_CUSTOMER_ORIGINS`, `BB_HQ_ORIGINS`, `BB_LOG_LEVEL`, `BB_WORKER_ID`, `BB_WORKER_POLL_MS`, `BB_WORKER_LEASE_MS`, `BB_WORKER_HEARTBEAT_MS`, `BB_WORKER_SHUTDOWN_MS`, `BB_WORKER_BATCH_SIZE`, `BB_WORKER_RETRY_BASE_MS`, `BB_WORKER_RETRY_MAX_MS`, `NEXT_PUBLIC_API_URL`, `EXPO_PUBLIC_API_URL`, `BB_STRIPE_MODE`, `BB_STRIPE_RUNTIME_SURFACE`, `BB_STRIPE_LIVE_INITIATION_ENABLED`, `BB_STRIPE_TEST_ACCOUNT_ID`, `BB_STRIPE_TEST_FOUNDING_PRODUCT_ID`, `BB_STRIPE_TEST_FOUNDING_MONTHLY_PRICE_ID`, `BB_STRIPE_TEST_CANCEL_ONLY_PORTAL_CONFIGURATION_ID`, `BB_STRIPE_LIVE_ACCOUNT_ID`, `BB_STRIPE_LIVE_FOUNDING_PRODUCT_ID`, `BB_STRIPE_LIVE_FOUNDING_MONTHLY_PRICE_ID`, `BB_STRIPE_LIVE_CANCEL_ONLY_PORTAL_CONFIGURATION_ID`
- Secret environment names: `DATABASE_URL`, `BB_SESSION_SECRET`, `BB_ARTIFACT_KEY_BASE64`, `BB_FINGERPRINT_KEY_BASE64`, `BB_SAFE_WORD_PEPPER`, `BB_STRIPE_TEST_API_KEY`, `BB_STRIPE_TEST_WEBHOOK_SECRET`, `BB_STRIPE_LIVE_API_RESTRICTED_KEY`, `BB_STRIPE_LIVE_WORKER_RESTRICTED_KEY`, `BB_STRIPE_LIVE_WEBHOOK_SECRET`
- Verification test: Locked build, staging health/browser/proxy/worker/restart, and rollback drill.
- Allowed retained proof tiers: `deployed_staging`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder plus recovery owner
- Export / termination: Canonical Git, database/object export, names-only environment manifest, and stop/delete procedure.
- Next founder action: Confirm company workspace custody and its monthly ceiling before any paid staging use.

### 30. `dns_edge` — Domain registrar and DNS/edge provider
<!-- catalogue-entry:dns_edge:v1 -->

- Definition version: `1`
- Purpose: boomerbuddy.net custody, reversible staging routing, TLS, WAF, and proxy truth.
- Account owner: Founder/company
- Conservative initial status: `founder_in_progress`
- Adapter state: `external_only`
- Ordered manual founder steps:
  1. `confirm_custody` — required before `founder_in_progress`: Confirm registrar and DNS account custody, MFA, recovery contacts, and transfer controls.
  2. `export_zone` — required before `ready_for_test`: Export current records and retain the pre-change rollback manifest.
  3. `create_staging_records` — required before `test_proven`: After the explicit DNS gate, create only reversible staging host records.
  4. `verify_edge` — required before `test_proven`: Verify TLS, proxy-hop configuration, body limits, WAF behavior, and rollback timing.
  5. `review_termination` — required before `ready_for_live_review`: Review record export, nameserver rollback, and registrar transfer procedure.
- Required safe identifier names: `registrar`, `zone_id`, `account_id`, `nameservers`, `recovery_contacts`
- Configuration environment names: `BB_TRUSTED_PROXY_HOPS`, `BB_CUSTOMER_ORIGINS`, `BB_HQ_ORIGINS`, `NEXT_PUBLIC_API_URL`, `EXPO_PUBLIC_API_URL`
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Zone export plus reversible staging hostname, TLS, proxy, WAF, and rollback proof.
- Allowed retained proof tiers: `deployed_staging`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder plus registrar recovery owner
- Export / termination: Zone export, prior-record manifest, and registrar transfer/unlock procedure.
- Next founder action: Confirm registrar/DNS custody and export the existing zone without changing records.

### 40. `managed_postgresql` — Managed PostgreSQL
<!-- catalogue-entry:managed_postgresql:v1 -->

- Definition version: `1`
- Purpose: Canonical customer, consent, commerce, job, and audit truth.
- Account owner: Founder/company
- Conservative initial status: `not_started`
- Adapter state: `test_configurable`
- Ordered manual founder steps:
  1. `select_provider_region` — required before `founder_in_progress`: Select a standard PostgreSQL provider and approved region.
  2. `create_roles` — required before `ready_for_test`: Create separate migration, runtime, and backup roles with least privilege.
  3. `store_database_url` — required before `ready_for_test`: Store DATABASE_URL only in the approved secret manager.
  4. `run_postgres_suite` — required before `test_proven`: Run clean migrations, concurrency, pool/direct, lease, and failure tests.
  5. `restore_independently` — required before `ready_for_live_review`: Restore an export into independent PostgreSQL and reconcile rows and projections.
- Required safe identifier names: `project_id`, `database_id`, `branch_id`, `region`, `role_names`, `backup_policy`
- Configuration environment names: `BB_DATABASE_DRIVER`, `BB_RUN_MIGRATIONS`
- Secret environment names: `DATABASE_URL`
- Verification test: Clean migrations, real-PostgreSQL concurrency, least privilege, backup, restore, and reconciliation.
- Allowed retained proof tiers: `deployed_staging`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder plus database recovery owner
- Export / termination: Logical export, provider snapshot/PITR, and restore to independent PostgreSQL.
- Next founder action: Choose the founder-owned provider, region, ceiling, and recovery owner.

### 50. `object_storage` — Private S3-compatible object storage
<!-- catalogue-entry:object_storage:v1 -->

- Definition version: `1`
- Purpose: Feedback media and encrypted retained objects with private lifecycle controls.
- Account owner: Founder/company
- Conservative initial status: `not_started`
- Adapter state: `not_implemented`
- Ordered manual founder steps:
  1. `select_private_storage` — required before `founder_in_progress`: Select a private S3-compatible provider, region, and cost ceiling.
  2. `define_buckets` — required before `ready_for_test`: Define private quarantine/media buckets, encryption, lifecycle, and CORS policy.
  3. `wait_for_adapter_names` — required before `ready_for_test`: Do not create application credentials until the reviewed adapter defines exact names and scopes.
  4. `test_synthetic_media` — required before `test_proven`: With the adapter present, prove upload, quarantine, read denial, delete, export, and restore using synthetic files.
  5. `review_exit` — required before `ready_for_live_review`: Review inventory/checksum export, replica, key rotation, and termination procedure.
- Required safe identifier names: `provider`, `region`, `bucket_ids`, `encryption_key_references`, `lifecycle_policy`, `cors_policy`
- Configuration environment names: None — no implemented adapter configuration environment name.
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Synthetic upload/quarantine/read/tenant denial/delete/export/restore after an adapter exists.
- Allowed retained proof tiers: `deployed_staging`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder plus storage recovery owner
- Export / termination: Inventory with checksums, encrypted export/replica, lifecycle, and termination procedure.
- Next founder action: Select a private provider and region; do not invent adapter credentials.

### 60. `managed_identity` — Managed customer identity
<!-- catalogue-entry:managed_identity:v1 -->

- Definition version: `1`
- Purpose: Customer/HQ authentication, MFA, recovery, issuer, audience, and assurance truth.
- Account owner: Founder/company
- Conservative initial status: `not_started`
- Adapter state: `not_implemented`
- Ordered manual founder steps:
  1. `select_identity_provider` — required before `founder_in_progress`: Select a managed identity provider, region, terms, and recovery owner.
  2. `create_separate_apps` — required before `ready_for_test`: Create separate customer and HQ applications, issuers, audiences, callbacks, and logout URLs.
  3. `define_assurance` — required before `ready_for_test`: Configure MFA, step-up, revocation, invitation binding, and recovery policy.
  4. `wait_for_identity_adapter` — required before `ready_for_test`: Keep production refused until the reviewed adapter defines exact configuration names.
  5. `run_identity_suite` — required before `test_proven`: Prove audience separation, MFA/step-up, invitation binding, revocation, recovery, and outage behavior.
- Required safe identifier names: `provider_tenant`, `customer_application`, `hq_application`, `issuer`, `audiences`, `callback_urls`, `assurance_policy`
- Configuration environment names: None — no implemented adapter configuration environment name.
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Managed customer/HQ separation, MFA/step-up, invite binding, revocation, recovery, and outage proof.
- Allowed retained proof tiers: `deployed_staging`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder plus independent identity recovery owner
- Export / termination: Identity mapping export, key rotation, break-glass, and tenant termination procedure.
- Next founder action: Choose a provider and assurance policy; production remains refused without an adapter.

### 70. `kms_secrets` — KMS and managed secret system
<!-- catalogue-entry:kms_secrets:v1 -->

- Definition version: `1`
- Purpose: Company custody and rotation of keys, peppers, session signing, and provider credentials.
- Account owner: Founder/company
- Conservative initial status: `not_started`
- Adapter state: `not_implemented`
- Ordered manual founder steps:
  1. `select_kms` — required before `founder_in_progress`: Select a managed KMS/secret system, region, billing ceiling, and recovery owner.
  2. `define_key_separation` — required before `ready_for_test`: Create separate aliases, versions, grants, rotation, disable, and recovery policies.
  3. `keep_raw_keys_nonproduction` — required before `ready_for_test`: Treat current raw environment key names as local-only and not KMS evidence.
  4. `implement_kms_adapter` — required before `test_proven`: Keep production refused until managed key references replace raw key material.
  5. `run_rotation_recovery` — required before `ready_for_live_review`: Prove denial, rotation, old-version read, revocation, restart, and recovery.
- Required safe identifier names: `kms_project`, `key_aliases`, `key_versions`, `secret_names`, `rotation_policy`, `recovery_policy`
- Configuration environment names: None — no implemented adapter configuration environment name.
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Managed encrypt/decrypt/sign, denial, rotation, old-version read, revocation, restart, and recovery.
- Allowed retained proof tiers: `deployed_staging`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder plus security recovery owner
- Export / termination: Encrypted backup/reference inventory plus rotate, revoke, and terminate procedure.
- Next founder action: Select the founder-owned managed KMS/secret system; raw env keys remain non-production.

### 80. `stripe` — Stripe
<!-- catalogue-entry:stripe:v1 -->

- Definition version: `1`
- Purpose: Default-off Stripe Checkout and Billing truth for an operator-approved, max-one Family $14.99/month rollout.
- Account owner: Founder/company
- Conservative initial status: `founder_in_progress`
- Adapter state: `implemented_disabled`
- Ordered manual founder steps:
  1. `secure_stripe_account` — required before `founder_in_progress`: Confirm company account custody, MFA, billing/admin roles, and recovery owner.
  2. `create_test_resources` — required before `ready_for_test`: Create separate test and live Family $14.99/month products, prices, signed webhooks, and bounded portal configurations; keep live initiation off.
  3. `store_test_names` — required before `ready_for_test`: Store test credentials and each live runtime surface restricted key only in its approved service secret store under the listed exact names.
  4. `run_test_runbook` — required before `test_proven`: Run signed test Checkout, invoice, cancel, grace, recovery, refund, dispute, reorder, outage, and reconciliation evidence, then complete live read-only preflight.
  5. `retain_live_gate` — required before `ready_for_live_review`: Keep BB_STRIPE_LIVE_INITIATION_ENABLED=false until the active operator-approved cohort is unexpired, capped at one household, and exact live account/resource preflight passes.
- Required safe identifier names: `account_id`, `test_product_id`, `test_price_id`, `test_webhook_endpoint_id`, `live_product_id`, `live_price_id`, `live_webhook_endpoint_id`, `api_version`, `cancel_only_portal_configuration_id`, `tax_decision`
- Configuration environment names: `BB_STRIPE_MODE`, `BB_STRIPE_RUNTIME_SURFACE`, `BB_STRIPE_LIVE_INITIATION_ENABLED`, `BB_STRIPE_TEST_ACCOUNT_ID`, `BB_STRIPE_TEST_FOUNDING_PRODUCT_ID`, `BB_STRIPE_TEST_FOUNDING_MONTHLY_PRICE_ID`, `BB_STRIPE_TEST_CANCEL_ONLY_PORTAL_CONFIGURATION_ID`, `BB_STRIPE_LIVE_ACCOUNT_ID`, `BB_STRIPE_LIVE_FOUNDING_PRODUCT_ID`, `BB_STRIPE_LIVE_FOUNDING_MONTHLY_PRICE_ID`, `BB_STRIPE_LIVE_CANCEL_ONLY_PORTAL_CONFIGURATION_ID`
- Secret environment names: `BB_STRIPE_TEST_API_KEY`, `BB_STRIPE_TEST_WEBHOOK_SECRET`, `BB_STRIPE_LIVE_API_RESTRICTED_KEY`, `BB_STRIPE_LIVE_WORKER_RESTRICTED_KEY`, `BB_STRIPE_LIVE_WEBHOOK_SECRET`
- Verification test: Authentic signed test lineage plus exact live US-company account/resource preflight, surface-separated restricted-key custody, default-off initiation, and max-one cohort rehearsal.
- Allowed retained proof tiers: `provider_test`, `deployed_staging`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder plus billing/admin recovery owner
- Export / termination: Stripe exports, webhook/key rotation, Checkout/portal disable, and account closure steps.
- Next founder action: Create and verify the exact Family monthly resources and service-specific restricted keys while live initiation remains false.

### 90. `stripe_tax` — Stripe Tax and qualified tax review
<!-- catalogue-entry:stripe_tax:v1 -->

- Definition version: `1`
- Purpose: Test tax configuration and live registration decision.
- Account owner: Founder plus qualified adviser
- Conservative initial status: `blocked`
- Adapter state: `external_only`
- Ordered manual founder steps:
  1. `engage_tax_adviser` — required before `founder_in_progress`: Engage a qualified adviser for business location, jurisdiction, registration, and product-code decisions.
  2. `record_tax_decision` — required before `ready_for_test`: Retain the signed decision/version outside the repository without taxpayer secrets.
  3. `configure_test_tax` — required before `test_proven`: Configure only the adviser-approved test settings.
  4. `review_live_registration` — required before `ready_for_live_review`: Complete the live registration and filing-owner review before live review.
- Required safe identifier names: `business_location_decision`, `jurisdictions`, `registrations`, `product_tax_codes`, `decision_version`
- Configuration environment names: None — no implemented adapter configuration environment name.
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Adviser-reviewed test Checkout/tax result and documented live gate.
- Allowed retained proof tiers: `professional_review`, `provider_test`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder
- Export / termination: Tax configuration/export and registration/termination procedure.
- Next founder action: Engage a qualified tax adviser; no live tax configuration is authorized.

### 100. `twilio` — Twilio
<!-- catalogue-entry:twilio:v1 -->

- Definition version: `1`
- Purpose: Consent-aware service SMS/voice and reconciled delivery truth.
- Account owner: Founder/company
- Conservative initial status: `founder_in_progress`
- Adapter state: `not_implemented`
- Ordered manual founder steps:
  1. `secure_twilio` — required before `founder_in_progress`: Confirm account/subaccount custody, MFA, billing ceiling, and recovery owner.
  2. `finish_toll_free` — required before `ready_for_test`: Complete toll-free verification and record safe service/webhook identifier names.
  3. `wait_for_twilio_adapter` — required before `ready_for_test`: Do not create app credentials until the reviewed adapter defines exact names and signature policy.
  4. `test_designated_recipient` — required before `test_proven`: Using only a designated test recipient, prove signature, HELP/STOP, consent, quiet hours, delivery, failure, and reconciliation.
  5. `review_number_exit` — required before `ready_for_live_review`: Review message/consent export, number port/release, key rotation, and disable procedure.
- Required safe identifier names: `account_id`, `subaccount_id`, `verified_number_id`, `messaging_service_id`, `webhook_ids`, `status_callback_ids`
- Configuration environment names: None — no implemented adapter configuration environment name.
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Designated test recipient only: signature, HELP/STOP, consent/suppression, quiet hours, and outcome reconciliation.
- Allowed retained proof tiers: `provider_test`, `deployed_staging`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder plus communications recovery owner
- Export / termination: Message/consent export, number port/release, key rotation, and service disable.
- Next founder action: Finish toll-free verification; do not paste or invent adapter credentials.

### 110. `transactional_email` — Transactional email provider
<!-- catalogue-entry:transactional_email:v1 -->

- Definition version: `1`
- Purpose: Account, support, lifecycle, and feedback email separated from marketing.
- Account owner: Founder/company
- Conservative initial status: `not_started`
- Adapter state: `not_implemented`
- Ordered manual founder steps:
  1. `select_email_provider` — required before `founder_in_progress`: Select an approved transactional provider, region, terms, and ceiling.
  2. `separate_streams` — required before `ready_for_test`: Create transactional server/stream and verified domain separate from marketing.
  3. `wait_for_email_adapter` — required before `ready_for_test`: Do not create app credentials until the reviewed adapter defines exact token/signature names.
  4. `test_inbox_only` — required before `test_proven`: Using only a test inbox, prove domain/signature, bounce/suppression, inbound feedback, and reconciliation.
  5. `review_email_exit` — required before `ready_for_live_review`: Review suppression/event export, domain/key rotation, stream disable, and termination.
- Required safe identifier names: `provider_account_id`, `server_id`, `stream_id`, `verified_domains`, `inbound_route_id`, `webhook_ids`
- Configuration environment names: None — no implemented adapter configuration environment name.
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Test inbox only: domain/signature, bounce/suppression, inbound feedback, and outcome reconciliation.
- Allowed retained proof tiers: `provider_test`, `deployed_staging`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder plus email recovery owner
- Export / termination: Suppression/event export, domain/key rotation, stream disable, and termination.
- Next founder action: Select a transactional provider and keep it separate from marketing.

### 120. `feedback_mailbox` — feedback@boomerbuddy.net
<!-- catalogue-entry:feedback_mailbox:v1 -->

- Definition version: `1`
- Purpose: Customer feedback intake identity and bounded routing.
- Account owner: Founder/company
- Conservative initial status: `not_started`
- Adapter state: `not_implemented`
- Ordered manual founder steps:
  1. `create_feedback_mailbox` — required before `founder_in_progress`: Create the mailbox or alias and assign a recovery owner.
  2. `define_retention_route` — required before `ready_for_test`: Define retention, inbound route, accountable owner, and deletion procedure.
  3. `wait_for_feedback_adapter` — required before `ready_for_test`: Keep inbound automation disabled until the normalized adapter is reviewed.
  4. `test_synthetic_feedback` — required before `test_proven`: Send synthetic feedback and prove minimization, redaction, receipt, and close-loop routing.
  5. `review_mailbox_exit` — required before `ready_for_live_review`: Review mailbox export, route disable, retention, and deletion.
- Required safe identifier names: `mailbox_or_alias`, `routing_owner`, `retention_policy`, `inbound_route_id`
- Configuration environment names: None — no implemented adapter configuration environment name.
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Synthetic feedback minimization/redaction, receipt, and close-loop routing with no raw content in logs.
- Allowed retained proof tiers: `provider_test`, `deployed_staging`
- Monthly cost ceiling: `included_in_parent_workstream`
- Recovery owner: Founder plus support recovery owner
- Export / termination: Mailbox export, route disable, retention, and deletion procedure.
- Next founder action: Create the alias/mailbox and assign its accountable routing and recovery owners.

### 130. `support_mailbox` — support@boomerbuddy.net
<!-- catalogue-entry:support_mailbox:v1 -->

- Definition version: `1`
- Purpose: Customer support identity, routing, and escalation.
- Account owner: Founder/company
- Conservative initial status: `founder_in_progress`
- Adapter state: `not_implemented`
- Ordered manual founder steps:
  1. `confirm_support_mailbox` — required before `founder_in_progress`: Confirm mailbox/alias existence, custody, routing owner, backup, and recovery.
  2. `set_support_hours` — required before `ready_for_test`: Record truthful stated hours and escalation/on-call ownership.
  3. `wait_for_support_adapter` — required before `ready_for_test`: Keep external intake disabled until the reviewed adapter is implemented.
  4. `test_synthetic_case` — required before `test_proven`: Route a synthetic request into one exact assigned support queue and prove audit/privacy behavior.
  5. `review_support_exit` — required before `ready_for_live_review`: Review mailbox/case export, routing failover, and termination.
- Required safe identifier names: `mailbox_or_alias`, `routing_owner`, `backup_owner`, `stated_hours`
- Configuration environment names: None — no implemented adapter configuration environment name.
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Synthetic request into one exact assigned support queue with response audit and privacy behavior.
- Allowed retained proof tiers: `provider_test`, `deployed_staging`
- Monthly cost ceiling: `included_in_parent_workstream`
- Recovery owner: Founder plus support backup
- Export / termination: Mailbox/case export, routing failover, and termination.
- Next founder action: Confirm the mailbox, routing owner, backup, and truthful stated support hours.

### 140. `sentry` — Sentry or approved error monitor
<!-- catalogue-entry:sentry:v1 -->

- Definition version: `1`
- Purpose: Redacted errors, release attribution, and accountable alert routing.
- Account owner: Founder/company
- Conservative initial status: `not_started`
- Adapter state: `not_implemented`
- Ordered manual founder steps:
  1. `create_error_monitor` — required before `founder_in_progress`: Create the company project, approved region, retention, sampling, and recovery owner.
  2. `define_scrubbing` — required before `ready_for_test`: Define release/environment naming, scrub rules, and alert routing.
  3. `wait_for_sentry_adapter` — required before `ready_for_test`: Do not create app tokens until the reviewed adapter defines exact names and data policy.
  4. `test_redacted_error` — required before `test_proven`: Generate a synthetic redacted error and prove alert receipt plus content/secret denial.
  5. `review_monitor_exit` — required before `ready_for_live_review`: Review event/config export, scrub/retention, DSN revoke, and project termination.
- Required safe identifier names: `organization_id`, `project_id`, `region`, `release_naming`, `retention_policy`, `sampling_policy`
- Configuration environment names: None — no implemented adapter configuration environment name.
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Synthetic redacted error, release attribution, alert receipt, secret/content denial, and outage behavior.
- Allowed retained proof tiers: `provider_test`, `deployed_staging`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder plus incident backup
- Export / termination: Event/config export, scrub/retention review, credential revoke, and project termination.
- Next founder action: Create the company project only after region, retention, ceiling, and data policy are approved.

### 150. `posthog` — PostHog or approved analytics
<!-- catalogue-entry:posthog:v1 -->

- Definition version: `1`
- Purpose: Privacy-minimized funnel and feature evidence.
- Account owner: Founder/company
- Conservative initial status: `not_started`
- Adapter state: `not_implemented`
- Ordered manual founder steps:
  1. `create_analytics_project` — required before `founder_in_progress`: Create the company project with approved region, retention, and ceiling.
  2. `approve_event_dictionary` — required before `ready_for_test`: Approve the content-free event dictionary, opt-out, deletion, and export policy.
  3. `wait_for_analytics_adapter` — required before `ready_for_test`: Do not create server credentials until the reviewed adapter defines exact names.
  4. `test_synthetic_funnel` — required before `test_proven`: Run a synthetic Founding Household funnel and prove no raw content or unnecessary PII.
  5. `review_analytics_exit` — required before `ready_for_live_review`: Review schema/event export, deletion, restrictions, key revoke, and termination.
- Required safe identifier names: `project_id`, `host`, `region`, `event_dictionary_version`, `retention_policy`
- Configuration environment names: None — no implemented adapter configuration environment name.
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Synthetic Founding Household funnel with no raw content/PII plus opt-out, deletion, and export.
- Allowed retained proof tiers: `provider_test`, `deployed_staging`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder plus product-data recovery owner
- Export / termination: Event/schema export, deletion/restriction, credential revoke, and project termination.
- Next founder action: Approve region, retention, event dictionary, and ceiling before account creation.

### 160. `apple_developer` — Apple Developer and App Store Connect
<!-- catalogue-entry:apple_developer:v1 -->

- Definition version: `1`
- Purpose: iOS signing, internal testing, and later distribution without blocking web Customer #1.
- Account owner: Founder/company
- Conservative initial status: `founder_in_progress`
- Adapter state: `provider_managed`
- Ordered manual founder steps:
  1. `complete_apple_entity` — required before `founder_in_progress`: Complete the company legal entity, account roles, MFA, and signing recovery owner.
  2. `record_apple_ids` — required before `ready_for_test`: Record only safe team, bundle, and App Store Connect application identifiers.
  3. `store_signing_provider_side` — required before `ready_for_test`: Keep signing credentials only in approved Apple/EAS credential managers.
  4. `run_internal_ios_build` — required before `test_proven`: Run a permitted internal build on supported devices; do not submit it.
  5. `review_ios_exit` — required before `ready_for_live_review`: Review credential recovery where allowed, app transfer, update disable, and termination.
- Required safe identifier names: `legal_entity`, `team_id`, `bundle_id`, `app_store_connect_app_id`, `roles`
- Configuration environment names: None — no implemented adapter configuration environment name.
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Permitted internal iOS build on supported devices covering share, deep-link, media, and accessibility; no submission.
- Allowed retained proof tiers: `provider_test`, `human_validation`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder plus signing recovery owner
- Export / termination: Signing credential recovery where allowed plus app transfer and termination plan.
- Next founder action: Complete the company account and recovery path without delaying the web-first path.

### 170. `google_play` — Google Play Console
<!-- catalogue-entry:google_play:v1 -->

- Definition version: `1`
- Purpose: Android signing, internal testing, and later distribution without blocking web Customer #1.
- Account owner: Founder/company
- Conservative initial status: `founder_in_progress`
- Adapter state: `provider_managed`
- Ordered manual founder steps:
  1. `complete_google_entity` — required before `founder_in_progress`: Complete the company legal entity, account roles, MFA, and signing recovery owner.
  2. `record_google_ids` — required before `ready_for_test`: Record only safe developer, package, and application identifiers.
  3. `store_play_signing` — required before `ready_for_test`: Keep Play/EAS signing credentials only in approved credential managers.
  4. `run_internal_android_build` — required before `test_proven`: Run a permitted internal build on supported devices; do not submit a production track.
  5. `review_android_exit` — required before `ready_for_live_review`: Review upload-key recovery, app transfer, update disable, and termination.
- Required safe identifier names: `legal_entity`, `developer_id`, `package_name`, `app_id`, `roles`
- Configuration environment names: None — no implemented adapter configuration environment name.
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Permitted internal Android build on supported devices; no production-track submission.
- Allowed retained proof tiers: `provider_test`, `human_validation`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder plus signing recovery owner
- Export / termination: Upload-key recovery plus app transfer/export and termination plan.
- Next founder action: Complete the company account and recovery path without delaying the web-first path.

### 180. `expo_eas` — Expo and EAS
<!-- catalogue-entry:expo_eas:v1 -->

- Definition version: `1`
- Purpose: Native build/update and internal distribution tooling.
- Account owner: Founder/company
- Conservative initial status: `not_started`
- Adapter state: `provider_managed`
- Ordered manual founder steps:
  1. `create_expo_project` — required before `founder_in_progress`: Create or transfer the company Expo owner/project and assign recovery.
  2. `record_expo_ids` — required before `ready_for_test`: Record safe owner, project, slug, bundle/package, and build-profile names.
  3. `store_expo_credentials` — required before `ready_for_test`: Keep tokens and signing credentials only in the approved provider manager.
  4. `build_frozen_commit` — required before `test_proven`: Produce reproducible internal iOS/Android builds tied to the frozen commit.
  5. `review_expo_exit` — required before `ready_for_live_review`: Review project transfer/export, credential recovery, update disable, and termination.
- Required safe identifier names: `owner`, `project_id`, `slug`, `bundle_id`, `package_name`, `build_profiles`
- Configuration environment names: `EXPO_PUBLIC_API_URL`
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Reproducible internal iOS/Android builds tied to the frozen commit and device matrix.
- Allowed retained proof tiers: `provider_test`, `human_validation`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder plus mobile recovery owner
- Export / termination: Project transfer/export, credential recovery, update disable, and termination.
- Next founder action: Provision only when the Apple/Google internal-build path is ready; web does not wait.

### 190. `enrichment` — Apollo or approved enrichment provider
<!-- catalogue-entry:enrichment:v1 -->

- Definition version: `1`
- Purpose: B2B discovery/enrichment only after separate founder, legal, and privacy approval.
- Account owner: Founder/company
- Conservative initial status: `blocked`
- Adapter state: `not_implemented`
- Ordered manual founder steps:
  1. `retain_real_use_block` — required before `founder_in_progress`: Keep all real enrichment and outreach disabled.
  2. `approve_data_purpose` — required before `ready_for_test`: Obtain separate founder/legal/privacy approval for purpose, sources, suppression, deletion, and opt-out.
  3. `define_adapter_names` — required before `ready_for_test`: Define exact least-privilege adapter names only after approval.
  4. `run_bounded_provider_test` — required before `test_proven`: Run only the separately approved bounded provider test; offline fixtures are not provider proof.
  5. `review_enrichment_exit` — required before `ready_for_live_review`: Review data/export/deletion/opt-out and provider termination before live review.
- Required safe identifier names: `workspace_id`, `approved_source_ids`, `data_purpose_policy_version`, `suppression_policy_version`
- Configuration environment names: None — no implemented adapter configuration environment name.
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Separately approved bounded provider test; real outreach remains a separate gate.
- Allowed retained proof tiers: `professional_review`, `provider_test`
- Monthly cost ceiling: `zero_until_approved`
- Recovery owner: Founder
- Export / termination: Data export/deletion/opt-out and provider termination procedure before use.
- Next founder action: Take no provider action unless a separate founder/legal/privacy gate authorizes it.

### 200. `dependency_security` — Dependency and security scanning
<!-- catalogue-entry:dependency_security:v1 -->

- Definition version: `1`
- Purpose: Fresh advisories, reachability, SBOM, licenses, package/image provenance, and adjudication.
- Account owner: Company CI/security owner
- Conservative initial status: `blocked`
- Adapter state: `external_only`
- Ordered manual founder steps:
  1. `provision_company_ci` — required before `founder_in_progress`: Provision a company-controlled runner/registry with MFA, recovery, and a cost ceiling.
  2. `configure_private_credentials` — required before `ready_for_test`: Store registry/CI credentials only in the company secret manager.
  3. `run_fresh_scans` — required before `test_proven`: Run fresh advisory, reachability, SBOM/license, package provenance, and OCI image scans.
  4. `retain_adjudication` — required before `test_proven`: Retain the redacted adjudication mapped to commit and image digests.
  5. `review_exit` — required before `ready_for_live_review`: Review artifact retention/export and runner/credential termination.
- Required safe identifier names: `registry`, `runner_id`, `report_artifact_ids`, `commit_digest`, `image_digest`
- Configuration environment names: None — no implemented adapter configuration environment name.
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Fresh audit and adjudication, clean candidate SBOM/licenses/provenance, and image scan with zero applicable unresolved Critical/High.
- Allowed retained proof tiers: `deployed_staging`, `professional_review`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder plus security backup
- Export / termination: Retained redacted adjudication/SBOM, restricted raw artifact, and tool exit.
- Next founder action: Authorize a company-controlled CI/security ceiling and retain credentials outside prompts/source.

### 210. `backup_recovery` — Independent backup and recovery store
<!-- catalogue-entry:backup_recovery:v1 -->

- Definition version: `1`
- Purpose: Independent source, PostgreSQL, object, configuration, and evidence custody.
- Account owner: Founder/company
- Conservative initial status: `not_started`
- Adapter state: `external_only`
- Ordered manual founder steps:
  1. `select_independent_store` — required before `founder_in_progress`: Select an account and region independent of the primary hosts, with recovery ownership.
  2. `set_backup_policy` — required before `ready_for_test`: Set schedule, retention, immutability, encryption, and destruction policy.
  3. `store_backup_credentials` — required before `ready_for_test`: Store backup credentials and KMS references only in the approved secret system.
  4. `run_timed_restore` — required before `test_proven`: Perform a timed source/database/object/config restore with checksums and reconciliation.
  5. `review_destruction` — required before `ready_for_live_review`: Review full export/restore plus termination and destruction-certificate procedure.
- Required safe identifier names: `account_id`, `storage_id`, `region`, `schedule`, `retention_policy`, `immutable_setting`
- Configuration environment names: None — no implemented adapter configuration environment name.
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Timed restore into independent systems with checksums and row/projection reconciliation.
- Allowed retained proof tiers: `deployed_staging`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder plus independent recovery owner
- Export / termination: Full export/restore plus provider termination and destruction-certificate process.
- Next founder action: Choose a recovery store independent of the primary hosting/database accounts.

### 220. `accounting` — Accounting and bookkeeping system
<!-- catalogue-entry:accounting:v1 -->

- Definition version: `1`
- Purpose: External financial system of record for credits, refunds, tax evidence, and close.
- Account owner: Founder/company and accountant
- Conservative initial status: `blocked`
- Adapter state: `external_only`
- Ordered manual founder steps:
  1. `select_accountant_system` — required before `founder_in_progress`: Select the external accountant/system, owner, backup, ceiling, and close cadence.
  2. `define_chart_policy` — required before `ready_for_test`: Approve chart, refund/credit, retention, and reconciliation policy.
  3. `test_exports` — required before `test_proven`: Have the accountant review synthetic/test commerce exports and reconciliation.
  4. `review_financial_exit` — required before `ready_for_live_review`: Review provider export, retention, access recovery, and termination.
- Required safe identifier names: `provider_account_id`, `chart_policy_version`, `accountant_owner`, `close_cadence`
- Configuration environment names: None — no implemented adapter configuration environment name.
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Accountant-reviewed test exports and reconciliation; HQ remains subordinate.
- Allowed retained proof tiers: `professional_review`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder plus accountant recovery owner
- Export / termination: Provider export, retention, access recovery, and termination.
- Next founder action: Select the external accountant/system; do not rebuild it in HQ.

### 230. `legal_professional` — Legal, privacy, tax, communications, and security reviewers
<!-- catalogue-entry:legal_professional:v1 -->

- Definition version: `1`
- Purpose: Qualified decisions for terms, privacy, beta, communications, media, tax, and claims.
- Account owner: Founder plus qualified reviewers
- Conservative initial status: `blocked`
- Adapter state: `external_only`
- Ordered manual founder steps:
  1. `engage_reviewers` — required before `founder_in_progress`: Engage qualified reviewers with defined scope, jurisdiction, owner, and ceiling.
  2. `prepare_versioned_packet` — required before `ready_for_test`: Prepare the versioned product, policy, claims, consent, media, communications, and tax review packet.
  3. `retain_signed_decisions` — required before `test_proven`: Retain signed decisions mapped to product/version/jurisdiction outside the repository.
  4. `map_conditions` — required before `ready_for_live_review`: Map every condition, expiry, and supersession requirement into the activation checklist.
- Required safe identifier names: `reviewer_or_engagement_ids`, `decision_version`, `effective_date`, `jurisdictions`
- Configuration environment names: None — no implemented adapter configuration environment name.
- Secret environment names: None — no implemented adapter secret environment name.
- Verification test: Signed retained professional decisions mapped to product, policy version, jurisdiction, conditions, and expiry.
- Allowed retained proof tiers: `professional_review`
- Monthly cost ceiling: `founder_decision_required`
- Recovery owner: Founder
- Export / termination: Controlled decision/evidence archive with retention and supersession history.
- Next founder action: Engage qualified reviewers; agent output cannot satisfy this workstream.

<!-- END CODE-OWNED FOUNDER PROVISIONING CATALOGUE V1 -->

## Founder steps by critical path

These actions are manual and consequential. They are not authorized by this document.

1. **Source custody:** create/confirm the company Git repository, MFA/recovery owners, protected `main`, and candidate-release policy. Then run an independent clean clone.
2. **Non-public staging:** choose and provision standard PostgreSQL, identity, KMS/secrets, Replit workspace/deployments, and DNS test hostnames. Record safe IDs only.
3. **Payment test:** load test values through the secret manager under `BB_STRIPE_TEST_ACCOUNT_ID`, `BB_STRIPE_TEST_API_KEY`, `BB_STRIPE_TEST_WEBHOOK_SECRET`, `BB_STRIPE_TEST_FOUNDING_PRODUCT_ID`, `BB_STRIPE_TEST_FOUNDING_MONTHLY_PRICE_ID`, and `BB_STRIPE_TEST_CANCEL_ONLY_PORTAL_CONFIGURATION_ID`; set `BB_STRIPE_MODE` only as the separately reviewed runbook permits. Execute `docs/run-3/STRIPE-FIRST-DOLLAR-RUNBOOK.md` without pasting a value into a prompt or file. Live names remain blocked.
4. **Communications test:** finish Twilio toll-free/account setup and approved transactional email setup, then use only designated test recipients under the messaging runbook.
5. **Recovery:** enable independent database/source/object backups and perform a timed restore before any GO verdict.
6. **Human/professional:** recruit consented research participants and qualified security/privacy/tax/communications reviewers without treating research as marketing.

## Secret handling

For every secret:

1. create it in the founder-owned provider;
2. store it only in the approved Replit/provider/company secret system under the exact documented environment name;
3. restrict it to the required environment/surface and least privilege;
4. record owner/version/rotation/recovery metadata, not value;
5. verify logs, screenshots, analytics, fixtures, issue trackers, prompts, and git contain no value; and
6. rotate immediately if exposure is suspected.

## Current provisioning decision

No provider row is `test_proven` or `ready_for_live_review` as of this repository review. Stripe/Replit/Twilio/domain/mobile setup reports are founder-status inputs, not retained provider evidence. Missing provider state must keep its runtime action fail-closed while independent local engineering continues.

The repository now implements the secret-free catalogue, ledger, API, and HQ projection. That is local/repository implementation evidence only. It does not change any provider row to `ready_for_test`, prove a provider test, establish deployed staging, validate a human workflow, or authorize live activation.
