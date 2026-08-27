# Historical Founding Household go-live record

Status: **superseded; not an operational production runbook**

This document is retained to explain the earlier Run 3.1 evidence chain. Do not execute its
numbered actions to create a new production Founding program, sponsorship, credential, invitation,
enrollment, customer account, customer contact, or external-user cohort. Production intentionally
refuses the historical Founding activation routes. The
`founding-household:bootstrap-production` command is maintenance-only historical tooling pending a
separate recovery-use review; do not run it for new production activation.

Current implementation begins with `docs/post-launch-beta/RUN-NEXT-EXECUTION.md` and is controlled
by `docs/post-launch-beta/EXECUTION-PLAN.md`,
`docs/post-launch-beta/NONCHARGING-RELEASE-RECEIPT.md`, and the G0-G15 prompt pack. Their exact
candidate, provider, deployment, payment, and customer gates take precedence over every numbered
action below. The text below is archival evidence, not authority.

### Historical founder clicks/actions

This is a manual bridge for one free Founding Household. It does not authorize a public launch,
payments, SMS, mobile-store submission, campaigns, DNS changes, or autonomous invitations. Stop at
the first failed gate. Commands must run from the exact clean candidate tag described below.

Replit, Clerk, GitHub, and PostgreSQL actions below are founder-only. The current remediation verdict
does not itself authorize them. The founder may separately authorize a synthetic-data-only
provider-proof deployment to collect missing evidence; that is not external-user activation. No
non-test invitation, sign-in, or customer data is allowed until step 26's independent verdict gate.

1. Open the company GitHub organization and confirm read-only that the private canonical repository
   is `micahheaton/BoomerBuddyRemix`, administrator MFA and recovery ownership are current, and release
   tags cannot be moved or deleted casually. Do not create another source repository or upload an
   `.env`, database, backup, receipt, secret, or customer data.
2. Push the reviewed candidate commit to its review branch, run the complete local gate, and require
   every GitHub CI job green on that exact 40-character SHA. Outside the versioned candidate, complete
   `docs/post-launch-beta/NONCHARGING-RELEASE-RECEIPT.md` in state
   `draft_pre_authorization`. Bind the candidate SHA/tree, green CI, planned annotated tag
   `run3-1-replit-founding-household-<first-12-commit-characters>`, ordered action manifest, and scope
   digest while recording that the tag and external effects are absent. Do not create the tag yet.
   After the founder cites that receipt ID and digest and types
   `CONFIRM NONCHARGING RELEASE SETUP`, make tag creation and push the first authorized action. Verify
   the remote tag object is annotated and peels to the exact candidate, append its object ID, peeled
   commit, and tree to the external receipt, and only then perform a provider write. Advance `main`
   only if it preserves the exact candidate commit. A squash, rebase, merge commit, changed tree,
   changed CI result, or changed action scope requires a new candidate, receipt, and confirmation.
   Never move, delete, or reuse a release tag.
3. In the Clerk Dashboard, select the exact existing **Customer production application** whose safe
   application ID is recorded in the external receipt. Stop if the account, environment, application,
   or role is ambiguous, or if more than one application could be the Customer target. Do not create,
   delete, rename, or replace an application unless read-only inventory proves the intended Customer
   application is absent and that exact creation is included in the authorized action manifest. Open
   **Restrictions**, enable **Restricted mode**, and save. Public sign-up is a release blocker even
   though the UI hides sign-up. Do not use a shared customer/HQ tenant.
4. In the customer Clerk application, configure only the intended sign-in methods, lock identifier
   changes where practical, and set the customer application Home URL to exactly
   `https://app.boomerbuddy.net/member`, Unauthorized sign-in URL to exactly
   `https://app.boomerbuddy.net/unauthorized-sign-in`, self-hosted sign-in component URL to exactly
   `https://app.boomerbuddy.net/sign-in`, and Account Portal customer sign-in fallback to exactly
   `https://app.boomerbuddy.net/member`. The deployed component must remain the local Next catch-all
   `/sign-in/[[...sign-in]]` with `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`. Preserve the existing
   root-domain Clerk infrastructure, including `accounts.boomerbuddy.net` and the reviewed Clerk
   Frontend API or OAuth callback domain; do not point any field at the separate legacy
   `BoomerBuddy` Replit project. Configure the standard session token to carry audience
   `boomerbuddy-customer`. Require and record a signed-token lifetime no longer than five minutes and
   a maximum customer session no longer than 24 hours for this beta; if the provider cannot enforce
   and evidence those bounds, stop for review. Do not add authorization roles or household IDs to
   Clerk claims. Record path/configuration evidence without keys, user records, email addresses,
   session identifiers, or other PII.
5. From customer Clerk **API keys**, record the production Frontend API/issuer origin, publishable
   key, secret key, and PEM public verification key. The secret key and PEM value go only into the
   services listed in the environment manifest. Never paste them into Git or this document.
6. In the Clerk Dashboard, select the exact existing **HQ production application** whose different
   safe application ID is recorded in the external receipt. Stop on account, environment,
   application, role, or Customer/HQ ambiguity. Do not create, delete, rename, or replace an HQ
   application unless read-only inventory proves the intended HQ application is absent and that exact
   creation is included in the authorized action manifest. Enable restricted access. In
   **Multi-factor**, enable an approved second factor and turn on **Require multi-factor
   authentication**. Replit-managed Clerk is not accepted for HQ unless it independently proves this
   MFA requirement without modifying the frozen source.
7. Configure the HQ token audience as `boomerbuddy-hq` and authorized party as exactly
   `https://hq.boomerbuddy.net`. Set Application Home and Account Portal fallback to exactly
   `https://hq.boomerbuddy.net/`. Set Unauthorized sign-in and the self-hosted sign-in component to
   exactly `https://hq.boomerbuddy.net/sign-in`; the deployment uses
   `/sign-in/[[...sign-in]]`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, and redirects successful HQ
   sign-in to `/`. Require a signed-token lifetime no longer than five minutes and an HQ session no
   longer than eight hours, and create only the founder account. Record its exact Clerk `user_...`
   subject only in the approved sensitive evidence store. Record the HQ issuer, key fingerprints,
   distinct PEM fingerprint, path values, and provider-enforced MFA/session settings separately from
   Customer evidence. Do not point any HQ field at Customer Clerk infrastructure or legacy
   `boomerbuddy.net`. Stop on a loop, 404, wrong issuer/audience/authorized party, realm crossover, or
   unavailable MFA/recovery.
8. Open Replit and import the same private GitHub repository into four founder-owned projects named
   conceptually `boomerbuddy-web`, `boomerbuddy-api`, `boomerbuddy-worker`, and `boomerbuddy-hq`.
   Do not ask Replit Agent to rewrite authentication or application code. GitHub is the source of
   truth: each service pulls the exact approved commit from `BoomerBuddyRemix`, and no Replit
   project ever pushes code or editor checkpoints back to GitHub. The separate `BoomerBuddy`
   project serving legacy `boomerbuddy.net` is outside this deployment set and stays untouched. Give
   each 2.0 project a different credential scoped only to `micahheaton/BoomerBuddyRemix`. Prefer a
   unique deploy key with **Allow write access** unchecked. A repository-scoped GitHub App or
   fine-grained token is acceptable only with `Contents: Read-only`, `Metadata: Read-only`, and no
   repository, organization, or user write permission. Store the private value only in the matching
   Replit credential store, keep the remote URL credential-free, and remove any write-capable Replit
   GitHub connection. The checkout remote must use exactly either
   `https://github.com/micahheaton/BoomerBuddyRemix.git` or
   `https://github.com/micahheaton/BoomerBuddyRemix` for an HTTPS-compatible read-only credential,
   or exactly `git@github.com:micahheaton/BoomerBuddyRemix.git` for the preferred read-only deploy
   key. The deployment wrapper rejects credentials embedded in a URL, forks, host aliases, any other
   URL spelling, multiple origin URLs, and noncanonical push metadata without
   printing the observed URL.
9. In each Replit project Shell, explicitly fetch the exact tag ref with
   `git fetch origin refs/tags/<tag>:refs/tags/<tag>` because Replit's Pull action does not fetch tags,
   then check out the candidate tag in detached mode. Verify that
   `git cat-file -t refs/tags/<tag>` returns exactly `tag`,
   `git rev-parse refs/tags/<tag>^{commit}` equals `BB_RUN3_1_RELEASE_COMMIT`,
   `git rev-parse HEAD` equals `BB_RUN3_1_RELEASE_COMMIT`,
   `git rev-parse HEAD^{tree}` equals `git rev-parse refs/tags/<tag>^{tree}`, and
   `git status --porcelain=v1 --untracked-files=all` is empty. Before relying on publication, prove
   that the **published build context**, not only the project shell, preserves `.git`, the
   annotated tag, exact commit and tree equality, and the empty full-porcelain status: the provenance
   wrapper checks all of them. A different Replit snapshot commit is rejected even when its tree
   matches the tag. A lightweight or moved tag, a tag resolving to another commit, a changed tree, or any staged,
   unstaged, or nonignored untracked content must fail. For API, web, and HQ only, Replit may append
   its documented `deploymentTarget = "cloudrun"` Autoscale line to the tracked `.replit` file.
   The wrapper accepts that provider input only when raw porcelain is exactly one unstaged
   `.replit` record, the tagged and rewritten blobs equal the reviewed exact byte hashes, and no
   mode change exists; it then restores the canonical indexed file and reruns the required status
   command to prove the checkout is empty before building. The Reserved VM worker never receives
   this normalization. Any other byte, path, status, mode, or target fails closed. A dirty-checkout
   failure may emit a bounded status-and-filename diagnostic (at most 50 paths and 256 bytes per
   rendered path); it never emits file contents. After the production-only npm install, web and HQ
   may contain exactly the lockfile-pinned optional Sharp WASM artifacts
   `@img/sharp-wasm32@0.35.3` and `@emnapi/runtime@1.11.3` as npm-reported extraneous entries.
   The wrapper accepts only that exact two-entry set with reviewed versions, literal root
   `node_modules` paths, resolved registry URLs, and complete npm dependency-node metadata. It also
   requires lockfile version 3 and the exact optional flags, package paths, integrity hashes, and
   dependency ranges from the tagged `package-lock.json`. API, worker, malformed or nested problems,
   altered metadata, or any partial, duplicate, or additional npm problem fails closed. If the published build context cannot provide evidence, publication is
   expected to fail and the release control needs a reviewed code change/new tag; do not bypass it
   with an environment value. With the same per-project credential, run
   `git push --dry-run origin HEAD:refs/heads/bb-denied-write-proof-<receipt-id>` and require a nonzero
   exit caused by denied write access. Exit zero is a hard stop even though `--dry-run` creates no
   ref. Never remove `--dry-run` or test a force, delete, branch, or tag write. Record only the safe
   credential ID/fingerprint, type, repository scope, permission export, expiry/rotation date,
   successful exact-tag fetch, nonzero denial classification, and recovery owner. Do not record the
   value.
10. Select the exact existing managed Production PostgreSQL project and database whose safe IDs are
    recorded in the external receipt. Stop on account, project, region, database, ownership, or
    application ambiguity. Provision a new production database only when read-only inventory proves
    the intended database is absent and the authorized action manifest records the provider, region,
    cost ceiling, owner, backup boundary, and rollback. Never create a second database merely because
    a Replit project exposes a **Database** button. Record the provider database/project identifier,
    region, connection hostname, database name, and the TLS-capable `DATABASE_URL`. The URL must
    include exactly one `sslmode=require`, `sslmode=verify-ca`, or preferably
    `sslmode=verify-full`. Do not use the deployment filesystem for customer truth.
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

    The verifier pins its own PostgreSQL pool to 2 and requires at least 180 database-clock seconds
    in one quota bucket. Any SQLSTATE `53200` is a capacity failure, not an allowed quota rejection:
    retain the content-free diagnostic, stop retrying, lower concurrent database work, and repeat on
    a new empty disposable database. Before customer traffic, either prove three consecutive exact
    20-accepted/1-quota-rejected runs with the production caps or raise the production compute to at
    least 0.5 CU (prefer bounded 0.5-1 CU autoscaling where available) and repeat the same gate.

12. Create a migration credential and runtime credential with the narrowest provider-supported
    separation. Use the direct database URL and `BB_POSTGRES_POOL_MAX=1` only for the controlled
    migration step. Runtime API/worker configuration must use pooled URLs and
    `BB_RUN_MIGRATIONS=false`. Until Replit proves separate roles and least privilege, this is an
    external gate, not a completed control.
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
16. For worker choose **Reserved VM** with **Only you** (or the narrowest private access) and
    web-server mode so Replit supplies `PORT`; attach no custom domain. Set
    `BB_REPLIT_SERVICE=worker` and a stable content-free `BB_WORKER_ID`. The worker listens on
    `0.0.0.0` only for static `/` and `/health/live` liveness. This is not readiness, and the
    listener must open before configuration, database, and founder-binding preflight.
17. For HQ choose **Autoscale** with **Only you** or the narrowest Replit private-deployment access
    available, plus the separate HQ Clerk MFA boundary. Set `BB_REPLIT_SERVICE=hq`. Obscurity of the
    URL is not authentication. Replit promotes Autoscale by probing `GET /` through a
    provider-selected loopback mapping while Next listens on the separate automatic `PORT`. After
    proving the two Clerk keys are present, HQ returns fixed content-free liveness only when the
    published-runtime marker, canonical listener port, canonical mapped raw Host, Next-normalized
    listener URL, GET/HEAD method, empty query, either the complete exact Next-derived loopback
    forwarding tuple or complete absence of all four `X-Forwarded-*` headers, and absence of a raw
    `Forwarded` header all match that exact direct probe. Every external `/`, API path, and operator route still crosses the HQ Clerk boundary. Mixed or malformed forwarding metadata and any
    changed provider probe must fail promotion until this exact predicate is reviewed; do not widen
    the anonymous HQ surface.
18. Before publishing API or worker, keep Stripe initiation and Twilio disabled, quiesce API and
    worker mutations, create an encrypted pre-migration backup outside the repository, and prove that
    backup in a disposable restore. Derive the migration manifest from the verified annotated tag,
    never from a mutable branch, stale runbook ceiling, or working-tree glob. From the detached tag,
    retain the safe output of both commands:

    ```text
    git ls-tree -r --name-only refs/tags/<tag> -- packages/persistence/migrations
    git ls-tree -r refs/tags/<tag> -- packages/persistence/migrations
    ```

    Accept only SQL paths matching
    `packages/persistence/migrations/[0-9][0-9][0-9][0-9]_[a-z0-9_]+.sql`. Require exactly one file
    for every contiguous numeric prefix beginning at `0001`, lexicographic order equal to numeric
    order, no duplicate version, and no unexpected migration path. Record the ordered filenames, Git
    blob IDs, and a manifest digest. Compute the expected database checksum for each tagged SQL file
    as lowercase SHA-256 after normalizing CRLF and CR line endings to LF, matching
    `packages/persistence/src/migrations.ts`. Compare the ordered `schema_migrations` names and
    checksums before the run. They must be an exact checksum-valid prefix of the tagged manifest;
    an unknown row, missing interior row, duplicate prefix, checksum mismatch, or non-prefix state is
    a hard stop.

    The current documented repository chain ends at:

    ```text
    0033_run3_1_billing_recovery_evidence.sql
    0034_run3_1_support_receipts.sql
    0035_run3_1_paid_family_catalog.sql
    0036_run3_1_protected_self_enrollment.sql
    ```

    Therefore, for an exact `0027` production prefix and a candidate whose manifest still ends at
    `0036`, the pending suffix is exactly
    `0028_run3_1_billing_authority_workflow.sql`,
    `0029_run3_1_stripe_live_control_plane.sql`,
    `0030_run3_1_billing_reverification_binding.sql`,
    `0031_run3_1_mobile_session_retention.sql`,
    `0032_run3_1_private_beta_access_intents.sql`,
    `0033_run3_1_billing_recovery_evidence.sql`,
    `0034_run3_1_support_receipts.sql`, and
    `0035_run3_1_paid_family_catalog.sql`, and
    `0036_run3_1_protected_self_enrollment.sql`. For an exact `0032` prefix, it is exactly `0033`
    through `0036`. A genuinely empty database receives the entire tagged `0001` through final-candidate
    manifest. If paid-entitlement repair requires a future forward migration, it must be the next
    contiguous entry in the exact tagged manifest and must appear in the external receipt. Do not
    guess its filename, hardcode `0036` as the release ceiling, or run an untagged migration. The only
    allowed pending set is the tagged candidate manifest minus the exact database prefix.

    Use a one-off founder-controlled shell with the migration credential, direct TLS database URL,
    `BB_POSTGRES_POOL_MAX=1`, and the complete production configuration. Run
    `npm ci --ignore-scripts`, then `npm run db:migrate` twice. The first run's ordered applied list
    must equal the derived pending suffix exactly. The second run must report
    `Applied 0 migration(s): none`. Verify that the final `schema_migrations` names and canonical
    checksums equal the entire tagged manifest, then create a post-migration backup bound to the exact
    release commit. Restore it into a fresh disposable database and prove the same manifest plus
    billing authority, Stripe controls, reverification, mobile retention, privacy-minimized access
    intent, billing recovery evidence, support receipts, paid Family catalogue, protected-self
    enrollment operation evidence, and any later tagged
    repair structures before publishing. Never enable per-startup migrations.

    Migration `0036` keeps protected-self mutation receipts append-only for durable temporal
    idempotency: replaying an old key must return its original result without repeating or undoing a
    later mutation. Receipts contain only bounded identifiers, action/result facts, and a request
    digest; never submitted Check content or PII. The exact household/member foreign key preserves
    tenant and actor lineage, and the household-gate foreign key preserves the receipt's serialization
    lineage. The repository resolves an existing key first, caps no-effect receipts at 16 per action
    and actor/household, and caps state-changing general enrollments at 64. A genuinely enrolled
    member's state-changing withdrawal is never blocked by those quotas; each such receipt requires a
    prior accepted enrollment, so the successful-enrollment cap bounds public-route withdrawal cycles
    and storage. Gate locks are household-scoped; unrelated households do not share a singleton lock.
    Retain these rows with consent and audit history rather than deleting them and reopening stale-key
    effects.

    The same migration preserves the original exact Founding protected-consent acceptance as
    historical evidence while allowing a later independently versioned general self-consent after
    exact self-withdrawal, including after Founding offboarding when another effective entitlement
    exists. If offboarding rebinds the original allocation, its append-only allowance transition
    supplies the exact original enrollment/allocation/grant proof without rewriting history. It does
    not weaken Founding service-consent termination or sponsor-chain evidence. The
    automated protected-enrollment fixtures use only a synthetic local Family entitlement. Passing
    them does not prove Stripe integration, a live payment, or production paid-entitlement readiness.

    After `0029`, do not deploy the old pre-`0029` application as a binary-only rollback. Prefer a
    schema-compatible corrective tag with initiation and invitations disabled or a forward
    corrective migration. A database rollback is allowed only before any post-migration durable
    write and must be coordinated: stop and drain all services, prove the pre-migration backup in
    disposable infrastructure, restore the complete database at the verified zero-write point,
    deploy the matching pre-`0029` API, worker, web, and HQ set, and only then reopen traffic. Never
    destructively down-migrate or discard consent, billing, audit, webhook, refund, dispute, job, or
    reconciliation evidence.

    **NONCHARGING AUTHORITY ENDS BEFORE STEP 19.** The receipt and phrase from step 2 authorize only
    the exact noncharging manifest. They do not authorize a production founder-identity bootstrap, a
    Founding Household program or sponsorship write, a real customer account or invitation, customer
    contact, consent, entitlement, Checkout, payment, or feedback.

    Before step 19 or 20, create a separate immutable `founding_program_activation` receipt outside
    the candidate. Bind it to the exact candidate SHA/tree/tag, the completed noncharging receipt ID
    and digest, the exact production database safe IDs and pre-state, the exact commands and operation
    IDs, maximum-one cap, finite dates, expected database deltas, evidence gates, stop conditions, and
    rollback or forward-containment path. Its canonical digest must use the same frozen-snapshot rules
    as `NONCHARGING-RELEASE-RECEIPT.md`. An independent reviewer must record GO, and the account holder
    must cite the activation receipt ID and digest and explicitly authorize the exact numbered actions
    in the active task. Step 19 and step 20 must each be named; neither may be inferred from
    `CONFIRM NONCHARGING RELEASE SETUP`. If this receipt or authorization is absent, do not run either
    step. Continue only unrelated actions that remain explicitly listed in the noncharging manifest
    and do not depend on these production writes.
19. With that same controlled database connection, run `npm run identity:bootstrap-founder` once.
    Confirm the content-free receipt names `production-founder-v1`, the configured founder person,
    identity, organization, and employee assignment. An exact replay may report `exact_replay`; a
    semantic conflict is a hard stop.
20. Choose reviewed finite dates, a privacy-policy version, a maximum of **1**, and a fresh lowercase
    UUID v4. Invitation TTL must be 1-14 days; access duration 1-180 days; program end must be after
    database time and within 180 days; sponsorship must already be active and end no earlier than the
    program. Access and invitation expiry may be clipped by the program end. Run:

    ```text
    npm run founding-household:bootstrap-production -- --operation-id <uuid-v4> --confirm-operation-id <same-uuid> --benefit-key family_beta_v1 --max-households 1 --invitation-ttl-days <finite-days> --access-duration-days <finite-days> --program-ends-at <ISO-UTC> --sponsorship-starts-at <ISO-UTC> --sponsorship-ends-at <ISO-UTC> --privacy-policy-version <reviewed-version> --confirm-production FOUNDING_HOUSEHOLD_PRODUCTION
    ```

    Record only returned IDs/state. A changed replay or cap above the reviewed cohort is a hard stop.

21. Publish API first. Record deployment ID, snapshot/build ID, region, immutable commit/tag, URL,
    start log, and `GET /health/live` plus `GET /health/ready` results. Missing founder binding,
    database TLS, Clerk, or cryptographic configuration must prevent startup.
22. Publish worker. Confirm one running process, `GET /health/live` returns 200 on the private
    deployment, exact founder-binding startup success occurs before any durable worker heartbeat or
    job loop, one durable retention job remains after restart, and no Stripe, Twilio, media,
    classification, transcription, or outbound handler is present.
23. Publish customer web, complete its smoke gates, and only then publish HQ and complete its smoke
    gates. Record deployment IDs, build IDs, origins, and response headers for each surface. Verify
    HTTPS, `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, and
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

    `READY_FOR_FOUNDING_HOUSEHOLD` is evidence, not authority. Before step 27 or any later customer
    action, create a separate immutable `founding_customer_activation` receipt bound to the exact
    candidate, completed noncharging receipt, completed program-activation receipt, exact deployed
    service and database safe IDs, support window and backup, maximum one invitation, allowed steps,
    stop conditions, and rollback or offboarding path. Keep the customer's identity and contact data
    out of the receipt. After independent GO, the account holder must cite that receipt ID and digest
    and explicitly authorize the exact customer-contact and activation actions in the active task.
    The noncharging phrase, the program-activation authorization, and the readiness verdict do not
    authorize customer contact, an invitation, consent, entitlement, feedback, or payment. This
    founding activation receipt never authorizes a charge.
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
| Clerk sign-in route           | Published app secrets                   | `NEXT_PUBLIC_CLERK_SIGN_IN_URL`             | No                            | exactly `/sign-in`                         | web and HQ; any other value fails closed                        |
| API bind                      | Published app secrets                   | `BB_API_HOST`                               | No                            | `0.0.0.0`                                  | API                                                             |
| API port                      | Derived by start wrapper                | `BB_API_PORT`                               | No                            | provider `PORT`                            | API child; do not configure separately                          |
| Trusted proxy count           | Published app secrets                   | `BB_TRUSTED_PROXY_HOPS`                     | No                            | `0`                                        | API, worker, controlled CLI                                     |
| Database driver               | Published app secrets                   | `BB_DATABASE_DRIVER`                        | No                            | `postgres`                                 | API, worker, controlled CLI                                     |
| PostgreSQL                    | Database / Published app secrets        | `DATABASE_URL`                              | Yes                           | `postgresql://...?...sslmode=verify-full`  | API, worker, controlled CLI; separate disposable/backup targets |
| PostgreSQL pool cap           | Published app secrets                   | `BB_POSTGRES_POOL_MAX`                      | No                            | API `2`; worker `1`; migration `1`         | API, worker, controlled CLI                                     |
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
| Worker batch                  | Published app secrets                   | `BB_WORKER_BATCH_SIZE`                      | No                            | `1`                                        | worker; initial 0.25-CU beta                                    |
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
- The configured release ref is not an annotated tag that dereferences to
  `BB_RUN3_1_RELEASE_COMMIT`, the published build-context HEAD is not exactly that commit, or its tree
  does not exactly match the tag tree. A different Replit snapshot commit is never permitted.
- Published build context does not preserve the required `.git` metadata, annotated tag, exact-tree
  equality, and empty `git status --porcelain=v1 --untracked-files=all` evidence.
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
