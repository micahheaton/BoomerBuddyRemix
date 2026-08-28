# Noncharging Release Receipt Template

Status: Template only. This file is not a completed receipt, release authorization, provider
receipt, deployment receipt, or claim that any external action occurred.

Historical terminology retained for audit and regression compatibility only: the former template
used `draft_pre_authorization`, the row `External effects before authorization | Exactly zero`, and
the phrase `CONFIRM NONCHARGING RELEASE SETUP`. It also stated, `The first authorized action is release identity`. Those literals are retired and are not active gates. The preserved invariant is
that later records never alter or replace the authorized snapshot; in current terminology, that is
the immutable scope-bound snapshot and digest.

Use this template only after the paid Family entitlement repair is complete, the exact candidate is
clean and pushed, and its full local and GitHub CI gates are green. The completed receipt must live
outside the versioned candidate so it can bind the candidate without changing it. An active-task
receipt or another approved append-only release log is acceptable. Never put a secret, customer PII,
payment detail, session identifier, safe word, submitted artifact, private recovery value, or raw
provider export in the receipt.

The sole production offer in this packet is Family at USD 14.99 per month for one household. Family
annual, Individual, group, referral, coupon, credit, trial, adaptive pricing, Payment Link, and native
purchase variants remain unavailable. Checkout and Portal initiation remain disabled throughout
this packet. Twilio remains disabled. The separate legacy `BoomerBuddy` Replit project,
`boomerbuddy.net`, its Twilio evidence, and its Stripe webhook remain untouched.

## 1. Receipt state and evidence classes

Use exactly one state at a time:

- `draft_scope`: exact candidate and proposed actions are recorded, but no tag or external write has
  occurred.
- `ready_noncharging`: standing in-scope authorization is recorded and every objective prerequisite
  for the listed actions has been independently verified.
- `executing_noncharging`: the annotated tag is verified and only the listed noncharging actions are
  running.
- `complete_noncharging`: every required receipt is present, every initiation gate is closed, and
  zero customer or money movement is proved.
- `stopped`: a stop condition occurred and no further affected action is allowed.
- `rolled_back`: the bounded rollback finished and remaining unknowns are recorded.

Label every item with one evidence class: `repository`, `local_automated`, `github_ci`,
`provider_read`, `provider_write_receipt`, `deployed_synthetic`, `human_attestation`, or `unknown`.
Never promote a fixture, screenshot, source design, or operator statement to provider, deployment,
device, customer, or payment evidence.

## 2. Scope identity block

Complete this block before external execution. The tag is planned here and becomes executable only
after its exact candidate, tree, and green CI are proved.

| Field | Required value |
| --- | --- |
| Receipt ID | `bb-noncharging-<UTC-date>-<first-12-SHA>-01` |
| Receipt state | `draft_scope` |
| Created at | Exact UTC timestamp |
| Repository root | `C:\Dev\BoomerBuddy` |
| Canonical remote | `https://github.com/micahheaton/BoomerBuddyRemix.git` |
| Candidate branch | Exact `codex/` branch |
| Candidate commit | Exact 40-character lowercase SHA |
| Candidate tree | Exact Git tree SHA |
| Planned annotated tag | `run3-1-replit-founding-household-<first-12-candidate-characters>` |
| Worktree and index | Empty full porcelain status |
| Upstream relationship | Local candidate equals the pushed remote candidate |
| Pull request | Safe PR number and URL, if used |
| GitHub CI | Exact run URL, workflow name, jobs, conclusions, and candidate SHA |
| Local gate | Commands, exit codes, counts, timestamps, and environment class |
| Independent review | Reviewer receipt and GO, NO-GO, or REMEDIATE result |
| Entitlement repair | Exact commit anchors and passing paid-provider entitlement regressions |
| Proposed action manifest | Ordered action IDs from Section 6 |
| Canonical digest placeholder | Exact literal `scope_digest_sha256=EXCLUDED_FROM_CANONICAL_BYTES` |
| Frozen scope snapshot | Immutable safe locator for the exact snapshot used as digest input |
| Scope digest | Separate append-only `scope_digest_sha256=<64 lowercase hex>` record created from the canonical bytes below |
| External effects before execution | Exactly zero |

Build the scope digest without asking the receipt to hash itself:

1. Complete the external receipt in `draft_scope` state, including the proposed action
   manifest and target safe IDs. Make the exact final line of that snapshot
   `scope_digest_sha256=EXCLUDED_FROM_CANONICAL_BYTES`.
2. Freeze that exact scope snapshot in the approved append-only release log. Do not edit,
   replace, reflow, or overwrite it after hashing.
3. For the canonical digest bytes, take only the frozen snapshot, normalize CRLF and bare CR line
   endings to LF, encode as UTF-8 without a byte-order mark, and require exactly one trailing LF after
   the placeholder line. Preserve every other byte exactly. Do not Unicode-normalize, trim trailing
   spaces, reorder fields, or reflow text.
4. Compute SHA-256 over those canonical bytes. Immediately after the frozen snapshot, append
   `scope_digest_sha256=<64 lowercase hex>` and the immutable snapshot locator as separate log
   records. The appended digest record is not part of the frozen snapshot or its canonical bytes.
5. Recompute from the frozen snapshot and require exact equality before execution.
   Later state transitions and execution receipts append new records; they never alter or replace the
    scope-bound snapshot or its digest record.

Record the user's standing in-scope authorization as a safe task reference. This reference does not
waive any technical, security, consent, privacy, qualified legal or tax, provider-access,
account-holder, customer-action, cost-cap, evidence, or rollback prerequisite. If the candidate,
tree, CI result, proposed actions, target accounts, or scope changes after the digest is recorded,
create a new receipt and review it. Do not amend a scope-bound snapshot silently.

## 3. Tag and merge sequence without self-binding

The first scope-bound action is release identity, not a provider write:

1. Reverify the candidate SHA, tree, clean full porcelain status, upstream equality, and green CI.
2. Reverify the standing-authority reference and every objective prerequisite for the action
   manifest, append the evidence locators, and change the state to `ready_noncharging`.
3. Create the annotated tag named in Section 2 on that exact commit. A lightweight tag is forbidden.
4. Push only that tag, then record the tag object SHA, peeled commit, tagged tree, remote tag object,
   and remote peeled commit.
5. Append the verified values to the external receipt and change its state to
   `executing_noncharging` before any provider write, migration, Replit pull, or deployment.
6. Advance `main` only if the operation preserves the exact candidate commit. Do not squash,
   rebase, or create a merge commit after the receipt is bound. If repository protection would
   create a different commit, stop, run the full gates on the new commit, and start a new receipt.

The tag is immutable. Never move, delete, or reuse it. A failed release receives a new candidate and
new tag.

## 4. Human-only attestations

Standing authorization is not an attestation. Record a safe reference, owner role, UTC timestamp, decision,
and expiration or review date for each item. Do not record the person's private identity data.

| Attestation | Required decision before the affected action |
| --- | --- |
| Company and provider custody | Correct company GitHub, Google Cloud, Clerk, Stripe, Replit, DNS, database, and recovery accounts; MFA and recovery owners verified |
| Google OAuth incident | Credential custodian will create the replacement, install it without exposing its value, revoke the exposed secret, and not restore it |
| Clerk topology | Customer and HQ are separate production applications with separate issuers, audiences, keys, cookies, origins, recovery, and MFA policy |
| Legal seller | Correct seller identity and launch geography; provider-required identity, agreement, and business facts completed by the account holder |
| Public policies | Privacy, terms, billing terms, cancellation, refund, account deletion, and accessibility content approved with version and effective date |
| Tax | Qualified tax owner records applicable jurisdictions, registration decision, product tax code, and Price tax behavior |
| Receipts | Account holder records the live receipt email toggles and the intended customer invoice and receipt experience |
| Payouts | Finance owner accepts manual payouts or records an approved schedule change and reconciliation owner |
| Statement descriptor | Account holder approves the exact customer-recognizable descriptor before a first charge |
| Support | `support@boomerbuddy.net`, published hours, one-business-day target, primary owner, backup, and escalation are operationally accepted |
| Database and recovery | Migration, runtime, backup, and restore custody are separate enough for the one-household beta; backup key and runtime crypto recovery are independently escrowed |
| Replit and cost | Four 2.0 projects, plan, monthly ceiling, alert threshold, owner, backup, and termination/export path are accepted |

If the tax decision requires collection in any launch jurisdiction, stop. Current Checkout and
canonical verification require automatic tax to remain disabled and tax to be zero. Do not enable
Stripe Tax merely because Tax settings are active. Add the required registration and repository
support only through a new reviewed candidate. Never guess a Stripe product tax code.

## 5. Fixed external boundary

The completed action manifest may include only:

- annotated tag creation and exact-SHA release binding;
- technically read-only GitHub credentials for the four BoomerBuddy 2.0 Replit projects;
- replacement and revocation of the exposed Google OAuth client secret;
- exact Customer and HQ Clerk path, realm, MFA, recovery, claim, and legal configuration;
- a new isolated Stripe commerce sandbox and synthetic noncharging provider proof;
- one live Family Product, one live USD 14.99 monthly Price, one bounded live Customer Portal
  configuration, one separate 2.0 live webhook, two surface-separated restricted live keys, and
  approved account support, legal, receipt, tax, payout, and descriptor settings;
- managed PostgreSQL migration, encrypted backup, independent restore, and synthetic verification;
- exact-tag pulls, builds, and initiation-disabled deployments for web, API, worker, and HQ;
- bounded synthetic health, authentication, private-beta access-intent, content-free support,
  monitoring, alert, drain, and rollback drills with every temporary control returned to false; and
- read-only provider inventory and reconciliation.

It never includes customer contact, customer consent, a live or production customer account, a live
Checkout or Portal Session, a live Customer, Subscription, Invoice, PaymentIntent, Charge, Refund,
Dispute, payout, public store submission, paid infrastructure expansion outside the recorded
ceiling, or Twilio. Fresh synthetic identities and sandbox payment objects are allowed only inside
the isolated nonproduction rehearsals expressly listed below and must be torn down safely.

## 6. Exact noncharging action order

Record each action with an operation ID, target account and environment, actor role, start/end UTC,
expected result, observed result, evidence class, safe evidence locator, stop result, and rollback
result.

### A. Freeze and bind release identity

1. Close every P0 and launch-critical P1 that can be closed locally, including paid Family
   entitlement effectiveness.
2. Run the full local, browser, mobile, dependency, copy, secret, migration, and clean-diff gates.
3. Require all GitHub CI jobs green for the exact candidate SHA.
4. Complete Sections 1 through 5, verify every objective prerequisite for the listed scope, and perform Section 3.

### B. Enforce GitHub pull-only credentials

For each of `boomerbuddy-web`, `boomerbuddy-api`, `boomerbuddy-worker`, and `boomerbuddy-hq`:

1. Use a distinct credential scoped only to `micahheaton/BoomerBuddyRemix`.
2. Prefer a unique GitHub deploy key with **Allow write access** unchecked. A repository-scoped
   GitHub App installation or fine-grained token is acceptable only when its retained permission
   export shows `Contents: Read-only`, `Metadata: Read-only`, no repository write permission, and no
   organization or user permission.
3. Store the private value only in that Replit project's protected credential store. Do not share a
   credential between projects or embed it in a remote URL, command, log, screenshot, or receipt.
4. Disable or remove any Replit GitHub connection that retains write permission.
5. With the same credential used for deployment, prove the exact tag fetch succeeds.
6. Run only this nonmutating negative proof against a new receipt-specific branch name:

   ```text
   git push --dry-run origin HEAD:refs/heads/bb-denied-write-proof-<receipt-id>
   ```

   The command must exit nonzero because the credential lacks write access. Exit zero is a hard stop
   even though `--dry-run` created no ref. Never rerun without `--dry-run`; never test force, delete,
   or tag writes.
7. Record credential type, safe key or token ID/fingerprint, repository scope, permission export,
   expiry/rotation date, fetch result, denied-write result, and recovery owner without the value.

### C. Rotate the exposed Google OAuth client secret

1. Confirm the Customer production Google OAuth client and expected Clerk callback without opening,
   copying, logging, or photographing any secret value.
2. The credential custodian creates one replacement in Google Cloud and enters it directly into the
   Customer Clerk production Google connection through the approved secret channel.
3. Revoke the exposed secret. Record only safe credential IDs, timestamps, states, and a
   no-secret-captured attestation.
4. Do not perform any Google production sign-in until replacement and revocation are both complete.
5. After the exact web deployment and Clerk paths are ready, use an account-holder-controlled synthetic test
   identity to prove sign-in, callback, `/member` return, sign-out, and return sign-in without PII in
   evidence.
6. If the replacement fails, keep the exposed secret revoked, disable Google sign-in, and create a
   different fresh replacement. Never restore the exposed value.

### D. Prove managed PostgreSQL and recovery

1. Derive the exact ordered migration names and Git blob IDs from the annotated tag. Verify strict
   four-digit contiguous prefixes, unique names, and the expected checksums in
   `schema_migrations`.
2. Run `npm run verify:postgres` only against a new empty disposable database whose name contains a
   delimited `ci` or `test` segment and only with `BB_ALLOW_POSTGRES_VERIFICATION=true`.
3. Quiesce mutations. Prove Stripe initiation, cohort, and eligibility are closed and Twilio is
   disabled. Take a provider snapshot and encrypted external logical backup before migration.
4. Restore that backup into a separate disposable database and prove it before touching production.
5. Use the direct migration credential, TLS, and `BB_POSTGRES_POOL_MAX=1` to run
   `npm run db:migrate` once. The applied names must equal exactly the candidate manifest minus the
   pre-migration database manifest.
6. Run the command again and require `Applied 0 migration(s): none`.
7. Require the post-migration `schema_migrations` names and checksums to equal the tagged candidate
   manifest exactly. Take a post-migration encrypted backup.
8. Restore the post-migration backup into a different disposable database. Start one exact-tag test
   API and worker against it and prove encrypted record readability, authorization, job leases,
   commerce controls, support receipts, and retention with synthetic records only.
9. Record source/restore safe IDs, PostgreSQL version, region, TLS mode, role separation, schema
   manifest digest, backup artifact digest, key-custody separation, RPO, RTO, differences, and
   disposition. Never record a database URL or backup key.

### E. Pull and deploy the exact tag with providers closed

1. Each of the four Replit consumers fetches the annotated tag with its own read-only credential and
   checks it out detached.
2. Require tag object type `tag`, peeled commit equality, published checkout HEAD equality to the
   exact release commit, exact tag-tree equality, and empty
   `git status --porcelain=v1 --untracked-files=all` in the project and published build context. A
   different snapshot commit is rejected even when its tree is identical.
3. Build and deploy API, then one worker, then customer web, then HQ. Initial deployment keeps
   `BB_STRIPE_MODE=disabled`, `BB_TWILIO_MODE=disabled`, every production migration switch false,
   and these exact default-off controls:

   ```text
   API: BB_PRIVATE_BETA_ACCESS_INTENTS_ENABLED=false
   API: BB_PRIVATE_BETA_ACCESS_INTENTS_EDGE_GUARD_CONFIRMED=false
   API: BB_SUPPORT_RECEIPTS_CUSTOMER_ACCESS_ENABLED=false
   API: BB_SUPPORT_RECEIPTS_HQ_QUEUE_ENABLED=false
   API: BB_SUPPORT_RECEIPTS_INTAKE_ENABLED=false
   customer web: BB_PRIVATE_BETA_ACCESS_INTENTS_ENABLED=false
   customer web: BB_PRIVATE_BETA_ACCESS_INTENTS_EDGE_GUARD_CONFIRMED=false
   customer web: BB_CUSTOMER_CLERK_SELF_DELETION_DISABLED_CONFIRMED=false
   worker and HQ: all five variable names absent
   API, worker, HQ, and mobile: BB_CUSTOMER_CLERK_SELF_DELETION_DISABLED_CONFIRMED absent
   ```

   Record names and booleans only. Do not rely on an omitted default.
4. Record project, service, credential safe ID, release SHA/tag/tree, build ID, deployment ID, region,
   origin, manifest-name digest, start result, and prior rollback deployment. Record no secret value.
5. Prove API live and ready health, private worker liveness plus current database heartbeat, public
   customer routes, private HQ protection, TLS, security headers, exact origins, proxy spoof denial,
   redacted logs, restart recovery, and worker drain.

### F. Configure and prove separate Clerk realms

Customer production application:

- keep existing root-domain Clerk infrastructure, including `accounts.boomerbuddy.net` and the
  reviewed OAuth callback domain;
- use `https://app.boomerbuddy.net/member` for Application Home and Account Portal fallback;
- use `https://app.boomerbuddy.net/unauthorized-sign-in` for Unauthorized sign-in;
- use `https://app.boomerbuddy.net/sign-in` for the self-hosted catch-all component;
- restrict sign-up and, after staged proof, restrict allowed subdomains to only the required Customer
  app subdomain or subdomains;
- configure exact Customer issuer, `boomerbuddy-customer` audience, Customer-only keys and cookies,
  the operation-bound `reverification_id` claim, authenticator-app MFA, backup recovery, and the
  required MFA policy; and
- disable direct Clerk self-deletion so all customer deletion continues through BoomerBuddy's
  protected deletion workflow; only after provider and deployed-route proof set
  `BB_CUSTOMER_CLERK_SELF_DELETION_DISABLED_CONFIRMED=true` on customer web and redeploy it; and
- configure approved privacy and terms URLs plus the separately reviewed `boomerbuddy-mobile` JWT
  template before claiming native authentication.

HQ production application:

- keep it a different Clerk application with a different issuer, audience, keys, cookies, origin,
  recovery boundary, and account population;
- use `https://hq.boomerbuddy.net/` for Application Home and Account Portal fallback;
- use `https://hq.boomerbuddy.net/sign-in` for both Unauthorized sign-in and the self-hosted
  catch-all component;
- use only `boomerbuddy-hq` audience and `https://hq.boomerbuddy.net` authorized party;
- require MFA, enforce recent second-factor age through the application, keep HQ private, and bind
  only the reviewed operations identity; and
- do not point any HQ field at Customer Clerk infrastructure or legacy `boomerbuddy.net`.

Record Customer and HQ safe application IDs, before/after path values, issuer and key fingerprints,
audiences, origin and allowed-subdomain sets, sign-in methods, MFA/recovery policy, session bounds,
claim/template digests, legal URLs, and test outcomes separately. Prove Google and email sign-in,
Device Trust routing, true MFA, recovery, sign-out, wrong realm, wrong origin, stale MFA, and callback
paths with account-holder-controlled synthetic identities. Stop on a loop, 404, issuer/audience crossover,
unexpected `azp`, or customer access to HQ.

### G. Complete authentic Stripe sandbox proof

1. Create a new isolated BoomerBuddy 2.0 commerce sandbox. Do not select or modify the sandbox that
   contains the enabled legacy webhook at `https://boomerbuddy.net/api/webhooks/stripe`.
2. Create only one sandbox Family Product, one active recurring USD 14.99 monthly Price, one bounded
   Portal configuration, one restricted test key, and one separate 2.0 staging webhook.
3. Use a nonproduction deployment and synthetic identities to prove exact initial settlement,
   action-required and asynchronous payment, duplicate and out-of-order delivery, ambiguity with the
   same idempotency key, failure and recovery, cancellation, full and partial refund, dispute,
   Portal limits, worker restart, complete inventory, webhook replay, and rollback.
4. Confirm no annual, Individual, group, referral, coupon, Promotion Code, trial, Payment Link,
   adaptive price, live object, real identity, or real payment instrument participated.
5. Keep sandbox evidence separate from live and from the research sandbox in
   `REVENUE-EXPERIMENT-ACTION-PACKET.md`.

### H. Configure minimum live Stripe with initiation disabled

Use the live US company account only after Section G passes:

1. In the same authenticated live-account custody session and before any live POST, PATCH, DELETE,
   archive, or other write, run a fresh read-only inventory. Record the safe account ID and charges
   and payouts states; bounded counts and safe IDs for Products, Prices, Coupons, Promotion Codes,
   Portal configurations, webhooks, Customers, Subscriptions, Checkout Sessions, Invoices,
   PaymentIntents, Charges, Refunds, Disputes, and payouts; Tax settings and registrations; receipt
   toggles; payout schedule; support, privacy, and terms fields; statement descriptor disposition;
   and the relevant provider request-log baseline. Provider logs must show GETs only.

   Continue only when that same-session inventory proves the expected zero live commerce resources
   and the recorded account-setting unknowns are closed, or when the scope-bound action manifest
   names an exact safe existing resource disposition. An existing desired Product, Price, Portal
   configuration, webhook, or key may be adopted only when every required field and custody boundary
   matches and the manifest explicitly says `adopt_existing`; never create a duplicate, delete or
   archive the existing object, or silently reuse it. Any new, changed, ambiguous, or unexpected
   resource or account value is scope drift: stop before the first write, freeze the observed state,
   prepare and review a new receipt and digest.
2. Create one active Family Product and one active Price with `livemode=true`, `currency=usd`,
   `unit_amount=1499`, `type=recurring`, `recurring.interval=month`,
   `recurring.interval_count=1`, `recurring.usage_type=licensed`,
   `billing_scheme=per_unit`, `custom_unit_amount=null`, `tiers_mode=null`,
   `transform_quantity=null`, and no trial.
3. Apply only the qualified tax code and Price tax behavior recorded in Section 4. Keep Checkout
   `automatic_tax` disabled. Zero registrations are acceptable only when the qualified decision says
   no registration is currently required for the launch geography.
4. Create one active Portal configuration with payment-method update and cancel-at-period-end
   enabled. Disable price/plan changes, promotions, proration, pause, trials, and retention offers.
5. Create one enabled webhook at exactly
   `https://api.boomerbuddy.net/v1/webhooks/stripe`, API version `2026-07-29.dahlia`, with only:

   ```text
   checkout.session.completed
   checkout.session.async_payment_succeeded
   checkout.session.async_payment_failed
   checkout.session.expired
   customer.subscription.created
   customer.subscription.updated
   customer.subscription.deleted
   invoice.paid
   invoice.payment_failed
   invoice.payment_action_required
   invoice.finalization_failed
   charge.refunded
   refund.created
   refund.updated
   refund.failed
   charge.dispute.created
   charge.dispute.closed
   ```

6. Keep the legacy webhook unchanged. Store the new webhook secret only in the API project.
7. Create two different least-privilege `rk_live_` keys. API receives account, Product, Price, and
   Portal reads plus Checkout and Portal Session writes and required reconciliation reads. Worker
   receives only account, subscription, invoice, payment, refund, dispute, and inventory reads. The
   keys are never shared. The full secret key is not used.
8. Set Stripe support email to the approved company mailbox, support URL to
   `https://app.boomerbuddy.net/support`, privacy URL to
   `https://app.boomerbuddy.net/privacy`, and terms URL to
   `https://app.boomerbuddy.net/terms`. Record receipt-toggle, payout-schedule, tax, and statement
   descriptor decisions. Do not change a bank destination or move money in this packet.
9. Configure API and worker with the same live account/Product/Price/Portal IDs and their separate
   credentials. API and worker both keep `BB_STRIPE_LIVE_INITIATION_ENABLED=false`; worker must
   always keep false. Require the production database initiation control disabled or absent, the
   production cohort closed or absent, zero eligible customer households, and no customer billing
   authority activation.
10. Redeploy API and worker from the same exact tag. From same-origin HQ with recent MFA, run only the
   read-only resource preflight. Provider logs must show exactly the expected account, Product,
   Price, and Portal GETs and no resource, Checkout Session, Portal Session, Customer, Subscription,
   Invoice, PaymentIntent, Charge, Refund, Dispute, or payout POST.
11. Before leaving the same controlled session, repeat the complete inventory and retain exact
    before/after counts, safe-ID sets, request-log boundaries, and deltas. The only nonzero deltas may
    be the exact create or `adopt_existing` actions named in the scope-bound manifest. Stop and contain
    on any unexpected resource, write, field change, request, or unresolved outcome.

Stripe-hosted Checkout plus Billing remains the payment architecture, but this packet creates no
Checkout Session. The future Checkout request must omit `payment_method_types` so Stripe can use
dynamic eligible payment methods. Webhook signature verification, durable inbox processing, and
canonical invoice-paid entitlement remain mandatory.

### I. Prove monitoring, support, rollback, and zero effect

1. Send only approved synthetic health and alert probes to company-owned destinations. Do not
   contact a customer.
2. Prove API and worker health, worker heartbeat age, inventory completion, webhook endpoint health,
   redacted logs, hosted alert receipt, acknowledgement by primary and backup, database backup age,
   and support queue handling.
3. Rehearse private-beta access intents only after the deployed edge guard, owned mailbox,
   retention, and rollback gates in `docs/run-3/PRIVATE-BETA-ACCESS-INTENTS.md` pass. Set both access
   variables true on API and web together, prove one bounded synthetic receipt, then set the enabled
   variable false on both services and return the edge confirmation to false.
4. Keep support intake false. Set `BB_SUPPORT_RECEIPTS_CUSTOMER_ACCESS_ENABLED=true` and
   `BB_SUPPORT_RECEIPTS_HQ_QUEUE_ENABLED=true` on API first; redeploy and prove both read paths with
   separate synthetic customer and HQ sessions. Then set `BB_SUPPORT_RECEIPTS_INTAKE_ENABLED=true`
   and confirm intake, acknowledgement, transition, withdrawal, tenant denial, retry, and rollback.
   Roll back intake first, then return all three support variables to false. Do not promise 24-hour
   human service.
5. Run two clean synthetic first-customer rehearsals only in approved isolated nonproduction
   customer and HQ test realms with the isolated Stripe commerce sandbox. Each run uses fresh,
   separate customer and HQ sessions, starts from reset synthetic state, includes only sandbox
   Checkout/webhook/cancel/refund objects, ends in a safe teardown, and has its own candidate-bound
   receipt. No live customer account, live payment object, customer contact, or customer data is
   allowed. A pass from one run cannot close the other.
6. Time a rollback only to an exact deployment proved compatible with the current schema. Before any
   post-migration durable write, a rollback to a pre-migration deployment requires stopping all four
   services and restoring the proved matching pre-migration database first. After any post-migration
   durable write, use a new-schema-compatible corrective tag or keep the affected service
   unavailable. Then redeploy the exact candidate while all Stripe initiation controls remain closed.
   Do not down-migrate.
7. Reconcile Stripe request logs, inventory, application controls, Replit deployment IDs, database
   state, Clerk audit logs, and GitHub refs. Prove no customer contact, customer data, live
   production Checkout or Portal Session, live payment object, live money movement, Twilio action,
   legacy change, or mobile-store action occurred. Separately reconcile the named isolated sandbox
   objects to the two rehearsal receipts and prove their required safe teardown.

## 7. Per-service Replit receipt

Repeat this table for each service.

| Field | Required value |
| --- | --- |
| Project | Exact one of `boomerbuddy-web`, `boomerbuddy-api`, `boomerbuddy-worker`, `boomerbuddy-hq` |
| Service | Exact one of `web`, `api`, `worker`, `hq` |
| Git credential | Safe unique ID, type, repository-only scope, read-only permission export, expiry |
| Pull proof | Exact annotated tag, peeled commit, exact checkout HEAD equality, tree equality, empty full porcelain |
| Denied-write proof | Exact dry-run command, nonzero exit, safe denial classification |
| Build | Command, build ID, exact SHA/tag/tree, UTC, result |
| Deployment | Deployment ID, region, origin or private liveness class, UTC |
| Environment | Names-only manifest digest and explicit forbidden-name absence |
| Health | Live, ready, heartbeat, headers, proxy, auth, or private-liveness evidence applicable to the service |
| Logs and alerts | Redaction sample, alert ID, receipt and acknowledgement without content or PII |
| Rollback | Prior deployment ID/tag, compatibility decision, measured stop and restore time |

## 8. Provider and database evidence fields

Record safe IDs or redacted fingerprints, never values.

### Google and Clerk

- Customer and HQ safe application IDs and environments;
- Google OAuth client safe ID, replacement safe secret ID, exposed secret revoked state, and
  no-secret-captured attestation;
- before/after Home, Unauthorized sign-in, self-hosted sign-in, and Account Portal fallback values;
- issuer, audience, key fingerprint, origin, allowed-subdomain, method, MFA, recovery, session,
  reverification-claim, mobile-template, and legal-URL digests;
- Google, email, Device Trust, MFA, recovery, sign-out, callback, wrong-realm, and wrong-origin results;
  and
- rollback or disabled-method disposition.

### Stripe

- safe live account ID, mode, country/business-type disposition, charges/payouts enabled states;
- before/after counts for Products, Prices, Coupons, Promotion Codes, Portal configurations,
  webhooks, Customers, Subscriptions, Checkout Sessions, Invoices, PaymentIntents, Charges, Refunds,
  Disputes, and payouts where the provider supports a bounded inventory;
- Family Product and Price safe IDs plus the exact fields in Section H;
- Portal safe ID and exact feature matrix;
- 2.0 webhook safe ID, URL, API version, enabled state, event-list digest, delivery status, and secret
  custody location class;
- API and worker restricted-key safe IDs, permission exports, custody classes, and rotation dates;
- Tax settings status, registrations, qualified decision reference, product tax code, Price tax
  behavior, and Checkout automatic-tax state;
- receipt toggles, support/legal URLs, payout schedule, reconciliation owner, and statement descriptor;
- API runtime switch, database initiation revision/state, cohort revision/state/cap/expiry,
  eligibility count, and billing-authority activation count; and
- request-log proof of expected GETs, zero prohibited POSTs, and zero money movement.

### PostgreSQL and recovery

- provider/project/region/version safe identifiers and TLS disposition;
- migration and runtime role separation;
- tagged migration names/blob IDs, pre/post database names/checksums, exact applied set, second-run
  no-op, and schema manifest digest;
- pre/post encrypted backup digests, key escrow class, independent restore safe ID, differences,
  application readability, RPO, and RTO; and
- worker lease/drain/restart, outbox, webhook inbox, entitlement, support, retention, and rollback
  results using synthetic records only.

## 9. Stop conditions

Stop the affected lane immediately on:

- missing entitlement repair, dirty Git state, candidate/upstream drift, non-green exact-SHA CI,
  tag mismatch, lightweight tag, different merge commit, or receipt scope drift;
- absent or mismatched standing-authority reference, receipt ID, scope digest, exact target, or objective prerequisite;
- a write-capable or shared Replit Git credential, credential in a URL/log, failed exact-tag fetch, or
  a denied-write proof that exits zero;
- wrong GitHub repository, Replit project, Clerk app, Google OAuth client, Stripe account/mode,
  database, domain, or provider environment;
- any legacy `BoomerBuddy`, `boomerbuddy.net`, legacy webhook, or Twilio change;
- a secret, PII, payment detail, submitted artifact, token, safe word, database URL, or backup key in
  evidence;
- Google production sign-in before exposed-secret revocation, or any attempted reuse of the exposed
  secret;
- auth loop, callback 404, wrong issuer/audience/origin/`azp`, realm crossover, unavailable recovery,
  or missing true MFA where required;
- migration manifest gap, duplicate, unknown applied migration, checksum mismatch, non-prefix
  database state, unproved backup/restore, live destructive verifier target, or SQLSTATE `53200`;
- unexpected Stripe resource, annual/Individual/referral object, wrong price field, Tax mismatch,
  unknown receipt setting, missing legal/support setting, wrong webhook/event/version, key custody
  crossover, provider ambiguity, or legacy endpoint contact;
- any live production Checkout or Portal Session, Customer, Subscription, Invoice, PaymentIntent,
  Charge, Refund, Dispute, payout, customer contact, mobile-store action, or money movement;
- any sandbox object outside the named isolated commerce sandbox and rehearsal receipts, or any
  incomplete sandbox teardown;
- any API/worker initiation switch true, enabled database initiation, open cohort, eligible customer
  household, or customer billing-authority activation;
- failed health, worker heartbeat, raw-body signature, inventory, redaction, alert, support, drain,
  backup, restore, or rollback evidence; or
- any unresolved P0 or launch-critical P1.

Record `stopped`, the last known external state, every unknown outcome, containment, owner, and next
closure gate. Continue only unrelated safe lanes.

## 10. Rollback

1. Disable the database initiation control first if it is unexpectedly enabled. Keep webhook
   ingestion and reconciliation running while any provider outcome may exist.
2. Return the API runtime switch to false. Worker remains false. Close cohort and eligibility only
   through revisioned audited controls.
3. Disable new support intake or the affected Clerk sign-in method when its boundary fails. Keep the
   exposed Google secret revoked; never restore it.
4. Disable the new 2.0 webhook or revoke the affected restricted key only when compromise or routing
   ambiguity requires it and a reconciliation plan is recorded. Never edit the legacy webhook.
5. Mark new Stripe Product and Price inactive and Portal configuration inactive when provider setup
   must be withdrawn. Do not delete provider evidence or create replacements during ambiguity.
6. Drain the worker and redeploy the prior exact compatible tag. Keep services unavailable when
   schema compatibility is uncertain.
7. Before any post-migration durable write, a coordinated restore to the verified pre-migration
   backup is allowed only after all services stop and the restore is independently proved. After any
   durable write, never down-migrate or erase the new evidence; use a forward corrective migration
   or remain unavailable.
8. Restore prior Clerk path/subdomain settings only from the recorded before-state and only when that
   does not reintroduce an exposed credential or realm crossover.
9. Preserve immutable Git tags, payment/consent/audit/support/reconciliation evidence, redacted
   incident facts, provider request IDs, and measured recovery times.

## 11. Verifiable noncharging completion

Set `complete_noncharging` only when all fields are closed and the final independent reviewer records
GO for noncharging readiness. The receipt must end with this exact summary, completed with measured
values:

```text
candidate_sha=<40 lowercase hex>
candidate_tree=<exact tree>
annotated_tag=<exact tag>
tag_object=<exact tag object>
tag_peeled_commit=<same candidate SHA>
github_ci=<exact green run URL>
standing_authority_reference=<safe task reference>
scope_receipt_id=<receipt ID>
scope_digest=<SHA-256>
replit_exact_tag_deployments=4/4
replit_read_only_credentials=4/4
replit_denied_write_proofs=4/4
google_exposed_secret_revoked=true
customer_hq_clerk_realms_separate=true
managed_postgres_migration_exact=true
independent_restore_passed=true
stripe_family_live_products=1
stripe_family_live_monthly_prices=1
stripe_live_annual_or_individual_prices=0
stripe_live_coupons_or_promotion_codes=0
stripe_2_0_live_webhooks=1
stripe_legacy_webhook_changes=0
stripe_api_runtime_initiation=false
stripe_worker_runtime_initiation=false
stripe_database_initiation=false
stripe_active_cohort=0
stripe_eligible_customer_households=0
stripe_live_checkout_or_portal_sessions_created=0
stripe_live_customers_or_subscriptions_created=0
stripe_live_money_moved=false
stripe_sandbox_rehearsal_receipts=<two separate safe receipt IDs>
stripe_sandbox_rehearsal_objects_torn_down=true
customer_contacted=false
customer_pii_retained=false
twilio_enabled=false
legacy_boomerbuddy_changed=false
monitoring_alert_receipt=passed
support_rehearsal=passed
support_receipts_customer_access=false
support_receipts_hq_queue=false
support_receipts_intake=false
customer_clerk_self_deletion_disabled_confirmed=true
private_beta_access_intents_api=false
private_beta_access_intents_web=false
private_beta_access_intents_edge_guard_api=false
private_beta_access_intents_edge_guard_web=false
first_customer_rehearsal_1=<separate receipt ID>:passed
first_customer_rehearsal_2=<separate receipt ID>:passed
timed_rollback=passed
final_disposition=NONCHARGING_READY_CHECKOUT_CLOSED
```

This disposition does not authorize Customer 1, a live Checkout window, a charge, refund, customer
consent, customer communication, or a claim of recurring revenue. Those require the separately
reviewed first-charge and live-onboarding gates.
