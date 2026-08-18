### Founder clicks/actions

This is a manual bridge for one free Founding Household. It does not authorize a public launch,
payments, SMS, mobile-store submission, campaigns, DNS changes, or autonomous invitations. Stop at
the first failed gate. Commands must run from the exact clean candidate tag described below.

Replit, Clerk, GitHub, and PostgreSQL actions below are founder-only. The current remediation verdict
does not itself authorize them. The founder may separately authorize a synthetic-data-only
provider-proof deployment to collect missing evidence; that is not external-user activation. No
non-test invitation, sign-in, or customer data is allowed until step 26's independent verdict gate.

1. Open the company GitHub organization. Create or select a **private** BoomerBuddy repository,
   require MFA for administrators, record two recovery owners, and protect deletion or movement of
   release tags. Do not upload an `.env`, database, backup, receipt, or customer data.
2. Add that repository as `origin`, push the reviewed implementation commit, and push the immutable
   annotated tag `run3-1-replit-founding-household-<first-12-commit-characters>`. Verify the tag
   resolves to the full recorded commit. Never move, delete, or reuse this tag.
3. In the Clerk Dashboard, create a **separate customer production application**. Open
   **Restrictions**, enable **Restricted mode**, and save. Public sign-up is a release blocker even
   though the UI hides sign-up. Do not use a shared customer/HQ tenant.
4. In the customer Clerk application, configure only the intended sign-in methods, lock identifier
   changes where practical, set the exact customer Replit HTTPS origin, and configure the standard
   session token to carry audience `boomerbuddy-customer`. Require and record a signed-token lifetime
   no longer than five minutes and a maximum customer session no longer than 24 hours for this beta;
   if the provider cannot enforce and evidence those bounds, stop for review. Do not add authorization
   roles or household IDs to Clerk claims.
5. From customer Clerk **API keys**, record the production Frontend API/issuer origin, publishable
   key, secret key, and PEM public verification key. The secret key and PEM value go only into the
   services listed in the environment manifest. Never paste them into Git or this document.
6. In the Clerk Dashboard, create a **different HQ production application**. Enable restricted
   access. In **Multi-factor**, enable an approved second factor and turn on **Require multi-factor
   authentication**. Replit-managed Clerk is not accepted for HQ unless it independently proves this
   MFA requirement without modifying the frozen source.
7. Configure the HQ token audience as `boomerbuddy-hq`, set the exact HQ Replit HTTPS origin, require
   a signed-token lifetime no longer than five minutes and an HQ session no longer than eight hours,
   and create only the founder account. Record its exact Clerk `user_...` subject. Record the HQ
   issuer, publishable key, secret key, distinct PEM public key, and provider-enforced MFA/session
   settings.
8. Open Replit and import the same private GitHub repository into four founder-owned projects named
   conceptually `boomerbuddy-web`, `boomerbuddy-api`, `boomerbuddy-worker`, and `boomerbuddy-hq`.
   Do not ask Replit Agent to rewrite authentication or application code.
9. In each Replit project Shell, fetch tags, check out the exact candidate tag in detached mode, and
   verify `git rev-parse HEAD`, `git rev-parse refs/tags/<tag>^{commit}`, and `git status --porcelain`.
   The two SHAs must equal the recorded full candidate and status must be empty. Before relying on
   startup, prove that the **published runtime**, not only the project shell/build context, preserves
   `.git`, the annotated tag, and a clean status: the start wrapper checks all three. If Replit strips
   them, startup is expected to fail and the release control needs a reviewed code change/new tag;
   do not bypass it with an environment value.
10. In one founder-controlled Replit project, open **Database** and provision Production PostgreSQL.
    Record the provider database/project identifier, region, connection hostname, database name, and
    the TLS-capable `DATABASE_URL`. The URL must include exactly one `sslmode=require`,
    `sslmode=verify-ca`, or preferably `sslmode=verify-full`. Do not use the deployment filesystem
    for customer truth.
11. Provision a **new, empty, disposable** provider PostgreSQL database whose name has a delimited
    `ci` or `test` segment, for example `boomerbuddy_run31_test`. In a dedicated verification shell,
    use only that database's TLS URL and run:

    ```text
    BB_ALLOW_POSTGRES_VERIFICATION=true DATABASE_URL='<disposable-TLS-URL>' npm run verify:postgres
    ```

    Confirm the database name without printing the URL, retain content-free stdout plus provider and
    PostgreSQL-version receipts, then destroy the database and remove the allow flag. **Never run this
    command against the live database:** it writes destructive fixtures, requires a new empty
    database, and refuses a name without a delimited `ci` or `test` segment.

12. Create a migration credential and runtime credential with the narrowest provider-supported
    separation. Runtime API/worker configuration must use `BB_RUN_MIGRATIONS=false`. Until Replit
    proves separate roles and least privilege, this is an external gate, not a completed control.
13. In every Replit project, open **Publish** (or **Publishing**) and then **Edit commands and
    secrets**. Add only the variables for that service from
    `REPLIT-ENVIRONMENT-MANIFEST.md`. Replit project-editor secrets are not assumed to be available
    to a published app; confirm each value appears in **Published app secrets**. Generate the artifact
    key, fingerprint key, and safe-word pepper outside source, store their exact versioned values in an
    encrypted founder-controlled recovery escrow outside Replit, and have a second recovery owner or
    independently recoverable access confirm custody without exposing the values.
14. For customer web choose **Autoscale**, build command `npm run replit:build`, run command
    `npm run replit:start`, one external web port, and the customer Replit HTTPS origin. Set
    `BB_REPLIT_SERVICE=web`.
15. For API choose **Reserved VM**, the same build/run commands, web-server mode, and one external
    port. Set `BB_REPLIT_SERVICE=api` and `BB_API_HOST=0.0.0.0`. Do not configure `BB_API_PORT`
    separately: the reviewed wrapper derives it from the provider's automatic `PORT`, and any explicit
    mismatch refuses startup. Do not set a trusted-proxy count above zero without a deployed
    header-spoofing test.
16. For worker choose **Reserved VM** and **Background worker** (no public endpoint). Set
    `BB_REPLIT_SERVICE=worker` and a stable content-free `BB_WORKER_ID`. Do not expose a port.
17. For HQ choose **Autoscale** with **Only you** or the narrowest Replit private-deployment access
    available, plus the separate HQ Clerk MFA boundary. Set `BB_REPLIT_SERVICE=hq`. Obscurity of the
    URL is not authentication.
18. Before publishing API or worker, use a one-off founder-controlled shell with the migration
    credential and the complete production configuration. Run `npm ci --ignore-scripts`, then
    `npm run db:migrate` twice. The first run must record exactly the 0001–0027 forward chain, and the
    second must report no migrations to apply. Never enable per-startup migrations.
19. With that same controlled database connection, run `npm run identity:bootstrap-founder` once.
    Confirm the content-free receipt names `production-founder-v1`, the configured founder person,
    identity, organization, and employee assignment. An exact replay may report `exact_replay`; a
    semantic conflict is a hard stop.
20. Choose reviewed finite dates, a privacy-policy version, a maximum of **1**, and a fresh lowercase
    UUID v4. Invitation TTL must be 1–14 days; access duration 1–180 days; program end must be after
    database time and within 180 days; sponsorship must already be active and end no earlier than the
    program. Access and invitation expiry may be clipped by the program end. Run:

    ```text
    npm run founding-household:bootstrap-production -- --operation-id <uuid-v4> --confirm-operation-id <same-uuid> --benefit-key family_beta_v1 --max-households 1 --invitation-ttl-days <finite-days> --access-duration-days <finite-days> --program-ends-at <ISO-UTC> --sponsorship-starts-at <ISO-UTC> --sponsorship-ends-at <ISO-UTC> --privacy-policy-version <reviewed-version> --confirm-production FOUNDING_HOUSEHOLD_PRODUCTION
    ```

    Record only returned IDs/state. A changed replay or cap above the reviewed cohort is a hard stop.

21. Publish API first. Record deployment ID, snapshot/build ID, region, immutable commit/tag, URL,
    start log, and `GET /health/live` plus `GET /health/ready` results. Missing founder binding,
    database TLS, Clerk, or cryptographic configuration must prevent startup.
22. Publish worker. Confirm one running process, exact founder-binding startup success, no listening
    port, one durable retention job after restart, and no Stripe, Twilio, media, classification,
    transcription, or outbound handler.
23. Publish customer web and HQ. Record deployment IDs, build IDs, origins, and response headers.
    Verify HTTPS, `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, and
    `X-Content-Type-Options: nosniff`. Confirm missing Clerk configuration returns a no-store 503.
24. In an incognito browser, verify `/check` remains anonymous and `/member` is protected. Inspect
    Clerk's `__session` behavior for HTTPS, Secure, HttpOnly, SameSite, short expiry/refresh, logout,
    and a disabled founder-owned test account. Use two founder-controlled test customer identities and
    synthetic records to exercise wrong-realm, cross-household, guessed-ID, logout/new-session,
    Founding revoke/offboard, and identity disable/recovery paths before any non-test invite. Actual
    Founding expiry by wall-clock passage remains blocked until observed; never alter the live clock or
    Customer #1 to manufacture it. Record observations as provider/deployed synthetic-data evidence;
    local tests are not a substitute.
25. Sign into HQ as the founder and complete MFA. Confirm the founder path works. Retain the
    candidate-bound local least-privilege tests for support and reviewer roles; do not invent provider
    accounts or a provisioning path that the frozen candidate does not implement. Provider-role proof
    remains unavailable until a separately reviewed provisioning mechanism exists. Do not create
    additional HQ owners.
26. **STOP. The current verdict is `REMEDIATE_BEFORE_EXTERNAL_USER`. Do not perform the next action or
    let a non-test customer sign in until `EXTERNAL-BETA-EVIDENCE.md` has been completed for the exact
    immutable runtime candidate and an independent reviewer has reissued the verdict as
    `READY_FOR_FOUNDING_HOUSEHOLD`.** This is the pre-invitation activation gate. Evidence that can
    exist only after the single controlled invitation is post-activation acceptance evidence, not a
    circular prerequisite for the invitation.
27. In customer Clerk **Invitations**, manually invite exactly the first trusted customer while
    restricted mode remains enabled. This founder click is the only external invitation action.
    BoomerBuddy itself sends no email or SMS.
28. Ask the customer to sign in once and open `/member`. This creates only an empty, identity-bound
    bootstrap household; it creates no Founding entitlement. Copy the exact customer Clerk subject
    from the Clerk user record. Invitation-before-first-authentication will fail closed.
29. In HQ, enter that exact customer subject and issue one finite Founding Household credential.
    Deliver the one-time credential manually in person or by a founder-chosen channel. Do not place
    it in logs, screenshots, tickets, or this repository. If it is lost, revoke it before replacing
    it.
30. Have the customer enter the credential, review the current consent, and accept. Confirm no card,
    Stripe, SMS, referral reward, or transferable consent appears. Confirm the household is the exact
    server-selected bootstrap household and the cohort occupancy is 1/1.
31. Execute the Customer #1 acceptance checklist: one Check and safe idempotent replay; persisted
    history after sign-out/sign-in and API restart; text-only feedback; founder-only feedback claim
    and minimized read; Trusted Circle invite does not authorize until accepted; revoke stops access;
    guessed household/check/feedback IDs and a second identity all deny without existence leakage.
32. Restart worker and API separately. Confirm durable jobs/leases converge without duplicate
    external actions. Stripe and Twilio must remain disabled and no provider result may be described
    as exactly-once.
33. From a trusted founder machine with PostgreSQL client tools, an exact clean candidate checkout,
    the production `DATABASE_URL`, and a separately generated 32-byte backup key held outside
    Replit, create an encrypted external backup:

    ```text
    npm run run3-1:backup -- --candidate-sha <40-char-runtime-sha> --output <outside-repo/founder-controlled/customer-1.bbbackup>
    ```

    Store the `.bbbackup`, generated receipt, and key in separate founder-controlled locations. The
    provisional one-household recommendation is one export immediately after enrollment and material
    administrative changes, then at least daily: retain seven daily and four weekly encrypted copies,
    subject to privacy/legal review. Until automation and the restore drill are proved, maximum data
    loss is everything since the most recent successful export (up to 24 hours under this cadence) and
    recovery time is unmeasured. Deleted data can remain in retained backups until those copies expire;
    losing either the backup key or the separately escrowed runtime crypto values makes recovery
    incomplete.

34. Provision a disposable nonproduction PostgreSQL database whose name includes `test`, `restore`,
    or `drill`. With its TLS URL, restore using:

    ```text
    npm run run3-1:restore -- --candidate-sha <same-sha> --input <customer-1.bbbackup> --confirm RESTORE-DISPOSABLE:<exact-database-name>
    ```

    Configure the disposable application with the exact versioned artifact key, fingerprint key, and
    safe-word pepper from external recovery escrow. Retain the authenticated receipt, migration
    manifest comparison, and critical-table counts, then prove application-level encrypted-record
    readability plus fingerprint and safe-word behavior without logging content or keys. Never point
    restore at production. Verify customer truth manually, then destroy the disposable DB.

35. Using a founder-owned **test customer identity**, test one disable incident: disable that user in
    Clerk and run
    `npm run identity:disable -- --audience customer --subject <exact-test-subject> --confirm-subject <exact-test-subject>`.
    Confirm current provider/session access stops. Do not disable Customer #1 merely as a drill. The
    founder identity uses a separate reviewed recovery procedure and the CLI intentionally refuses to
    disable it.
36. Verify from Wi-Fi and cellular/VPN transitions that Public Check continuation remains usable,
    while forged cross-household identifiers and forged forwarding headers deny, and distinct clients
    receive separate current-network abuse accounting. Keep `BB_TRUSTED_PROXY_HOPS=0` until an exact
    Replit proxy/header test proves a different count. A required nonzero value is a code change and a
    new candidate tag because the current production config rejects it; it is not an environment-only
    adjustment.

## Required setting map

| Setting                       | Replit location                         | Exact variable/name                         | Secret?                       | Example format                             | Required for                                                    |
| ----------------------------- | --------------------------------------- | ------------------------------------------- | ----------------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| Runtime mode                  | Published app secrets                   | `NODE_ENV`                                  | No                            | `production`                               | web, API, worker, HQ, controlled CLI                            |
| Service selector              | Published app secrets                   | `BB_REPLIT_SERVICE`                         | No                            | `web`, `api`, `worker`, `hq`               | matching published service                                      |
| Candidate commit              | Published app secrets                   | `BB_RUN3_1_RELEASE_COMMIT`                  | No                            | 40 lowercase hex                           | web, API, worker, HQ                                            |
| Candidate tag                 | Published app secrets                   | `BB_RUN3_1_RELEASE_TAG`                     | No                            | `run3-1-replit-founding-household-<12hex>` | web, API, worker, HQ                                            |
| Deployment marker             | Replit automatic                        | `REPLIT_DEPLOYMENT`                         | No                            | `1`                                        | published start gate                                            |
| Provider port                 | Replit automatic                        | `PORT`                                      | No                            | integer                                    | web, API, HQ                                                    |
| Customer/HQ visible origin    | Published app secrets                   | `BB_PUBLIC_ORIGIN`                          | No                            | exact HTTPS origin                         | web or HQ, distinct values                                      |
| API proxy origin              | Published app secrets                   | `BB_API_INTERNAL_ORIGIN`                    | No                            | exact API HTTPS origin                     | web, HQ                                                         |
| Clerk browser key             | Published app secrets                   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`         | No                            | matching `pk_live_...`                     | web or HQ, distinct tenants                                     |
| Clerk server key              | Published app secrets                   | `CLERK_SECRET_KEY`                          | Yes                           | matching provider value                    | web or HQ, distinct tenants                                     |
| API bind                      | Published app secrets                   | `BB_API_HOST`                               | No                            | `0.0.0.0`                                  | API                                                             |
| API port                      | Derived by start wrapper                | `BB_API_PORT`                               | No                            | provider `PORT`                            | API child; do not configure separately                          |
| Trusted proxy count           | Published app secrets                   | `BB_TRUSTED_PROXY_HOPS`                     | No                            | `0`                                        | API, worker, controlled CLI                                     |
| Database driver               | Published app secrets                   | `BB_DATABASE_DRIVER`                        | No                            | `postgres`                                 | API, worker, controlled CLI                                     |
| PostgreSQL                    | Database / Published app secrets        | `DATABASE_URL`                              | Yes                           | `postgresql://...?...sslmode=verify-full`  | API, worker, controlled CLI; separate disposable/backup targets |
| Runtime migrations            | Published app secrets                   | `BB_RUN_MIGRATIONS`                         | No                            | `false`                                    | API, worker, controlled CLI                                     |
| Demo seed                     | Published app secrets                   | `BB_SEED_DEMO`                              | No                            | `false`                                    | API, worker, controlled CLI                                     |
| Development identity          | Published app secrets                   | `BB_ALLOW_DEV_IDENTITY`                     | No                            | `false`                                    | API, worker, controlled CLI                                     |
| Founder person binding        | Published app secrets                   | `BB_FOUNDER_PERSON_ID`                      | No, sensitive ID              | stable internal ID                         | API, worker, controlled CLI                                     |
| Founder Clerk binding         | Published app secrets                   | `BB_FOUNDER_CLERK_SUBJECT`                  | No, sensitive ID              | exact HQ `user_...`                        | API, worker, controlled CLI                                     |
| Customer origins              | Published app secrets                   | `BB_CUSTOMER_ORIGINS`                       | No                            | exact customer HTTPS origin                | API, worker, controlled CLI                                     |
| HQ origins                    | Published app secrets                   | `BB_HQ_ORIGINS`                             | No                            | exact HQ HTTPS origin                      | API, worker, controlled CLI                                     |
| Customer issuer               | Published app secrets                   | `BB_CLERK_CUSTOMER_ISSUER`                  | No                            | customer Clerk HTTPS issuer                | API, worker, controlled CLI                                     |
| Customer audience             | Published app secrets                   | `BB_CLERK_CUSTOMER_AUDIENCE`                | No                            | `boomerbuddy-customer`                     | API, worker, controlled CLI                                     |
| Customer JWT verification key | Published app secrets                   | `BB_CLERK_CUSTOMER_JWT_KEY`                 | Public key; protect integrity | PEM public key                             | API, worker, controlled CLI                                     |
| HQ issuer                     | Published app secrets                   | `BB_CLERK_HQ_ISSUER`                        | No                            | HQ Clerk HTTPS issuer                      | API, worker, controlled CLI                                     |
| HQ audience                   | Published app secrets                   | `BB_CLERK_HQ_AUDIENCE`                      | No                            | `boomerbuddy-hq`                           | API, worker, controlled CLI                                     |
| HQ JWT verification key       | Published app secrets                   | `BB_CLERK_HQ_JWT_KEY`                       | Public key; protect integrity | distinct PEM public key                    | API, worker, controlled CLI                                     |
| HQ second-factor age          | Published app secrets                   | `BB_CLERK_HQ_MAX_SECOND_FACTOR_AGE_SECONDS` | No                            | `600`                                      | API, worker, controlled CLI                                     |
| Artifact encryption           | Published app secrets + external escrow | `BB_ARTIFACT_KEY_BASE64`                    | Yes                           | canonical 32-byte base64                   | API, worker, controlled CLI                                     |
| Fingerprint/HMAC              | Published app secrets + external escrow | `BB_FINGERPRINT_KEY_BASE64`                 | Yes                           | distinct canonical 32-byte base64          | API, worker, controlled CLI                                     |
| Safe-word hardening           | Published app secrets + external escrow | `BB_SAFE_WORD_PEPPER`                       | Yes                           | distinct high-entropy 16+ chars            | API, worker, controlled CLI                                     |
| Log threshold                 | Published app secrets                   | `BB_LOG_LEVEL`                              | No                            | `info`                                     | API, worker, controlled CLI                                     |
| Stripe disabled               | Published app secrets                   | `BB_STRIPE_MODE`                            | No                            | `disabled`                                 | API, worker, controlled CLI                                     |
| Twilio disabled               | Published app secrets                   | `BB_TWILIO_MODE`                            | No                            | `disabled`                                 | API, worker, controlled CLI                                     |
| Worker identity               | Published app secrets                   | `BB_WORKER_ID`                              | No                            | `run3-1-worker-01`                         | worker                                                          |
| Worker poll                   | Published app secrets                   | `BB_WORKER_POLL_MS`                         | No                            | `1000`                                     | worker                                                          |
| Worker lease                  | Published app secrets                   | `BB_WORKER_LEASE_MS`                        | No                            | `30000`                                    | worker                                                          |
| Worker heartbeat              | Published app secrets                   | `BB_WORKER_HEARTBEAT_MS`                    | No                            | `10000`                                    | worker                                                          |
| Worker shutdown               | Published app secrets                   | `BB_WORKER_SHUTDOWN_MS`                     | No                            | `20000`                                    | worker                                                          |
| Worker batch                  | Published app secrets                   | `BB_WORKER_BATCH_SIZE`                      | No                            | `10`                                       | worker                                                          |
| Worker retry base             | Published app secrets                   | `BB_WORKER_RETRY_BASE_MS`                   | No                            | `1000`                                     | worker                                                          |
| Worker retry maximum          | Published app secrets                   | `BB_WORKER_RETRY_MAX_MS`                    | No                            | `300000`                                   | worker                                                          |
| Destructive real-PG verifier  | Disposable provider-test shell only     | `BB_ALLOW_POSTGRES_VERIFICATION`            | No                            | `true` only during command                 | `verify:postgres`; never runtime/live DB                        |
| Backup key                    | Founder machine only                    | `BB_RUN3_1_BACKUP_KEY_BASE64`               | Yes                           | independent canonical 32-byte base64       | backup/restore only                                             |

The complete service-by-service inventory and failure behavior is in
`REPLIT-ENVIRONMENT-MANIFEST.md`.

## Hard stops

- Customer Clerk is public rather than Restricted.
- HQ MFA cannot be required and freshly proven.
- Customer/HQ token and maximum-session bounds cannot be configured and retained as provider proof.
- Any deployment is not the exact clean tag/commit.
- Published runtime does not preserve the exact `.git` metadata, annotated tag, and clean-status
  evidence required by the startup wrapper.
- API/worker can start without founder binding or with runtime migrations/demo identities.
- The destructive PostgreSQL verifier is pointed at live, a nonempty DB, or a DB without a delimited
  `ci`/`test` name, or `BB_ALLOW_POSTGRES_VERIFICATION` is present in a runtime service.
- Database TLS, real PostgreSQL semantics, encrypted backup, disposable restore, application-level
  restore readability, or external runtime-key recovery escrow is unproved.
- Any reachable deployable Critical/High dependency remains unremediated or unaccepted.
- Stripe/Twilio credentials are present, a live charge/send is possible, or media upload is enabled.
- The customer journey, cross-household denials, offboarding, or restart persistence fails.
- The final verdict remains `REMEDIATE_BEFORE_EXTERNAL_USER`.

## Current provider references

- Replit: [Publishing and deployment types](https://docs.replit.com/learn/projects-and-artifacts/replit-deployments),
  [Secrets](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets), and
  [deployment troubleshooting](https://docs.replit.com/build/troubleshooting).
- Clerk: [Restricted sign-up mode](https://clerk.com/docs/guides/secure/restricting-access),
  [MFA configuration](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options),
  and [session options](https://clerk.com/docs/guides/secure/session-options).
