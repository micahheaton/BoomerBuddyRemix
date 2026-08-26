# BoomerBuddy Revenue Acceleration and Autonomous Beta Plan

Status: Living execution plan. The 2026-08-24 audit is historical; the current closure ledger in Section 3 controls.

Evidence date: 2026-08-24

Release audited: `9b5d585e89e4a691a113b9cd4264c1edbb3cdfdf`

Annotated release tag: `run3-1-replit-founding-household-9b5d585e89e4`

Last immutable candidate with complete local and GitHub CI evidence: `1fbd079de126aabccd788bfa3a854a77d1f6c1a3`

Current repository state: later canonical-origin, billing-recovery, paid-feedback, support, mobile, and documentation closure work may be uncommitted. No historical receipt or `1fbd079` result covers that later work until a new exact SHA passes the full gate.

Primary outcome: Onboard the first genuine paying household within seven calendar days if every objective safety, payment, support, consent, and evidence gate passes, then operate a controlled 30-day beta that earns greater autonomy from measured results.

This plan does not claim that a two-year product can be completed in seven days. It compresses the path to the first recurring revenue and starts the product, mobile, support, growth, and learning loops that can compound toward that target.

## 1. Executive decision

### 1.1 Current execution authority

Local repository edits, local tests, reviewable commits, branch pushes, and CI are authorized. A separate release gate now controls external effects. Do not merge, tag, make any Replit pull, deploy, run a production migration, write Clerk or Stripe state in any environment, write EAS or other provider identity/account state, send an external message, spend money, charge, refund, or alter production until the founder types this exact phrase in the active task:

`CONFIRM NONCHARGING RELEASE SETUP`

That phrase authorizes only the reviewed noncharging release-setup scope described by the then-current exact-SHA packet. It does not authorize a customer charge, refund, customer consent, customer plan choice, customer communication, legal attestation, tax or bank attestation, or an action outside that packet. Before every external or irreversible action, the responsible agent must still verify the exact target and environment, preserve secrets and customer PII, satisfy applicable legal and provider requirements, capture evidence, define a bounded cap, and have a tested rollback or containment path. Agents may prepare and guide human-only steps but may not impersonate another person or fabricate evidence.

The fastest defensible revenue path is an assisted direct-to-household subscription. The first payer is an adult child, caregiver, household organizer, or older adult who already faces suspicious messages and wants a calm family response path. The paid job is recurring household coordination and safer follow-through, not access to an infallible scam detector.

The seven-day wedge is:

`risk moment -> useful Check -> customer account -> protected-adult consent -> household setup -> safer action -> optional Trusted Circle help -> recurring payment -> support -> return use`

Run five P0 tracks in parallel:

1. Revenue-ready member web path.
2. Live-capable Stripe path with canonical reconciliation.
3. Signed iOS and Android internal beta.
4. Support, incident, backup, privacy, and observability readiness.
5. Copy, accessibility, browser, and device quality.

The web path must remain sufficient for Customer 1 because Apple and Google review timing is outside BoomerBuddy's control. Mobile is still P0. Its initial target is a signed internal build and physical-device proof, not a guaranteed public store listing inside seven days.

Do not use a Payment Link, manual invoice, database entitlement edit, or dashboard-only payment as a shortcut. The current product deliberately treats Stripe provider truth and BoomerBuddy entitlement truth as separate, reconciled facts. A shortcut would produce money that the application cannot safely honor.

## 2. Non-negotiable boundaries

- Use only `C:\Dev\BoomerBuddy`. Do not inspect Downloads, OneDrive, another checkout, or another worktree.
- Keep the separate legacy Replit project `BoomerBuddy`, which serves `boomerbuddy.net`, untouched. It exists for legacy Twilio registration, privacy, terms, and messaging opt-in evidence and is not a BoomerBuddy 2.0 deployment target. Do not point Clerk, Stripe, API, worker, customer web, or HQ at it.
- Treat GitHub `micahheaton/BoomerBuddyRemix` as the only 2.0 source of truth. Its four Replit deployment consumers are fixed: `boomerbuddy-web` serves `app.boomerbuddy.net`; `boomerbuddy-api` serves `api.boomerbuddy.net`; `boomerbuddy-worker` runs background jobs; and `boomerbuddy-hq` serves `hq.boomerbuddy.net`. Each pulls the exact approved GitHub commit and never pushes code back to GitHub.
- Preserve separate customer and HQ Clerk realms, issuers, audiences, cookies, and origins.
- Keep HQ private. Founder actions require the bound founder identity and recent MFA.
- Keep Twilio disabled until a separate consent, sender, suppression, quiet-hours, delivery, and compliance gauntlet passes. Do not add Twilio credentials to source or prompts.
- Check analysis must never request, resolve, preview, redirect through, or otherwise fetch a submitted URL.
- Never expose production secrets, session tokens, payment details, safe words, raw customer artifacts, or personal contact data.
- Keep the first customer's personal details outside Git, agent prompts, screenshots, and general evidence. Retrieve them only from an approved founder-held system at execution time.
- No agent may accept consent, choose a plan, enter payment details, or authorize a charge for a customer.
- [OFFER-HYPOTHESIS-REGISTRY.md](./OFFER-HYPOTHESIS-REGISTRY.md) controls every annual, Individual, and referral hypothesis. Those entries are synthetic and Stripe sandbox only; this plan cannot promote them into production configuration, customer copy, live provider resources, or external action.
- Customer-facing web, HQ, mobile, email, store, and support copy may not contain U+2013 or U+2014.
- The current release gate supersedes broader historical authority wording. External writes remain stopped until the exact phrase in Section 1.1 appears in the active task and the reviewed scope remains noncharging.

## 3. Historical audit and current closure ledger

### 3.0 Controlling current ledger, 2026-08-26

Sections 3.1 through 3.10 preserve the `9b5d585` audit and later receipts. They are not a claim that the present worktree is clean, committed, deployed, or covered by CI. This ledger controls when historical wording differs from later evidence.

| Surface | Current evidence | Current disposition |
| --- | --- | --- |
| Immutable repository evidence | Candidate `1fbd079de126aabccd788bfa3a854a77d1f6c1a3` passed uninterrupted local verification, Playwright, and all four GitHub CI jobs. | This is the last immutable evidence boundary, not proof for later local edits. |
| Current local work | The shared worktree contains uncommitted canonical public-origin validation, auth-route recovery, billing recovery, paid-feedback, support, mobile, copy, production-config hardening, test-runner hardening, and documentation closure work. | Do not assign a final SHA, deployability, or CI result until the integrated diff is committed, pushed, and green on its own SHA. |
| Current local validation receipt, 2026-08-26 | On the integrated dirty worktree: secrets passed across 738 text files; runtime dependency scope passed with 99 packages; all workspace and root typechecks, zero-warning lint, and formatting passed; unit passed 36 files and 422 tests; the default bounded integration command passed two fresh-worker shards totaling 68 files and 456 tests; security passed 42 files and 316 tests; the synthetic evaluation passed 12 of 12 with zero forbidden-action violations; Playwright passed 26 of 26; API, worker, web, HQ, and Expo web export builds passed; Expo Doctor passed 21 of 21; deterministic mobile assets, provider-free distribution inputs, production auth-route resolution, production fail-closed UI, and `git diff --check` passed. The dependency audit reported 1 Low, 23 Moderate, and zero High or Critical findings. | This is local uncommitted evidence only. It is not an exact-SHA GitHub CI receipt, managed PostgreSQL or restore proof, Stripe or Clerk provider proof, Replit deployment proof, signed native build, physical-device proof, store receipt, customer evidence, or payment evidence. |
| Deployment topology | GitHub is source truth. The four BoomerBuddy 2.0 Replit consumers are web, API, worker, and HQ as mapped in Section 2; they pull exact commits and never push. | No Replit pull or deployment is authorized before `CONFIRM NONCHARGING RELEASE SETUP`. Do not assume any deployed surface contains `1fbd079` or later local work without an exact deployment receipt. |
| Legacy site | The separate `BoomerBuddy` Replit project and `boomerbuddy.net` are legacy-only. | Excluded from synchronization, deployment, Clerk, Stripe 2.0, and product work. Preserve its Twilio evidence unchanged. |
| Customer Clerk production instance | Read-only inspection found root-domain Clerk infrastructure, including `accounts.boomerbuddy.net`; that arrangement is not inherently wrong and must be preserved unless a staged change is proved necessary. Home URL, Unauthorized sign-in URL, and Account Portal fallbacks are blank or default to the root. Allowed subdomain restriction is disabled; the provider UI identifies `app.boomerbuddy.net` as a valid subdomain of the primary root. Provider logs show completed Google sign-in and session creation, while the observed app flow looped or reached `https://app.boomerbuddy.net/sign-in/client-trust` and returned 404. That path is Device Trust for an unrecognized device, not proof of true MFA. No user record or PII was retained. | Authentication can succeed at Clerk, but the post-auth application routing chain, true MFA/recovery, and subdomain restriction are not proved. Establish the exact `app.boomerbuddy.net` home, fallback, callback-path, and allowed-subdomain configuration, deploy matching canonical-origin code only after the external gate, then enable restriction with only required Customer app subdomains. Keep HQ in its separate Clerk app. Prove Account Portal, OAuth, web, native, true MFA, and recovery flows before and after. Treat any domain or home-origin change as downtime, key, and OAuth risk with staged rollback. |
| Windows sandbox | The Windows filesystem sandbox is healthy and remains enabled. Some Node, Prettier, `tsx`, and Playwright file-replacement or user-identity operations can fail inside isolation with `EPERM` or `uv_os_get_passwd ENOMEM`; the same exact narrowly scoped command succeeds with approved elevation. | Do not disable sandboxing or use shell-write workarounds. Use scoped elevation only for the exact blocked command, keep repository boundaries intact, and retain the command result. This is host-tooling friction, not a product defect or provider sandbox. |
| Production offer candidate | Family at USD 14.99 per month for one household is the sole approved production offer candidate. It is not live. Payment remains web-first, with mobile P0 in parallel. | Annual, Individual, group-rate, referral, coupon, credit, trial, and native-purchase ideas remain synthetic and Stripe sandbox only under the offer registry. |
| Billing | `1fbd079` is not live-capable: the paid Family catalog and effective-entitlement mismatch leaves production payment at NO-GO. Later payment-action recovery, async Checkout, Portal/invoice guidance, and related tests are uncommitted local closure work and do not change that immutable evidence boundary. Live Stripe remains empty. Read-only sandbox access works and confirms zero Products, Prices, Coupons, Promotion Codes, or Portal configurations plus exactly one enabled legacy webhook at `https://boomerbuddy.net/api/webhooks/stripe`. | Reverify the integrated code on a new exact SHA. Keep the legacy webhook untouched. After the confirmation phrase, create a separate 2.0 endpoint under `api.boomerbuddy.net`; authentic sandbox resources/events, provider configuration, deployed preflight, Tax/receipt decisions, and first-payment evidence remain open. |
| Support and feedback | Durable content-free support receipts, latest-state idempotent replay, tenant-scoped HQ handling, mobile retry classification, and production paid-entitlement feedback containment pass local automated tests. | Do not call Customer 1 ready until the new exact SHA passes CI and deployed authenticated support plus genuine paid-access feedback are proved. Never store customer PII or free-text artifacts in general evidence. |
| Mobile | Mobile is P0 in parallel. `net.boomerbuddy.app` remains the default permanent identifier unless an Apple, Google, Clerk, or Expo collision is verified. Provider-free distribution inputs, deterministic assets, Expo Doctor, web export, API pinning, backup hardening, and mobile security tests pass locally. | Provider account state, identifier availability, production Clerk native token, signed iOS/Android artifacts, physical-device auth, accessibility, failure recovery, two-way link associations, and distribution receipts remain open. |
| Twilio | No BoomerBuddy 2.0 consent/compliance enablement has passed. | Keep Twilio disabled. Do not reuse or modify the legacy site's registration surface. |
| External release setup | The confirmation phrase has not been recorded in the current evidence packet. | Continue safe local work. Stop all provider writes, merge/tag, Replit pull/deploy, production migration, external messages/spend, charges, and refunds until the exact phrase and an exact-SHA action packet exist. |

### 3.1 Historical audited repository and release evidence

The following read-only Git checks describe the `9b5d585` audit, not the present worktree:

| Fact | Evidence |
| --- | --- |
| Git root | `C:/Dev/BoomerBuddy` |
| Origin | `https://github.com/micahheaton/BoomerBuddyRemix.git` |
| Branch | `main` |
| HEAD | `9b5d585e89e4a691a113b9cd4264c1edbb3cdfdf` |
| Exact tag | `run3-1-replit-founding-household-9b5d585e89e4` |
| Annotated tag target | The tag object peels to the exact HEAD commit |
| Worktree | Clean before and after inspection and verification |
| Upstream | Local `origin/main` and live `git ls-remote` both resolved to the exact HEAD commit |

At the audit, the user reported API, worker, web, and HQ published and healthy. That historical operator testimony is not a substitute for a dated exact-SHA browser, alert, restore, provider, or human receipt.

### 3.2 Historical `9b5d585` local verification and later immutable candidate

An exact `npm ci` restored the lockfile-pinned dependency graph without changing tracked files. The following results describe audited `9b5d585`:

| Gate | Result | Evidence boundary |
| --- | --- | --- |
| Secret scan | Passed across 624 text files | Not history, entropy, managed KMS, or an external scanner |
| Runtime dependency scope | Passed with 99 named API/worker packages | Local installed graph |
| TypeScript | Passed for all workspaces and root | Local compile-time evidence |
| Format | Passed | Source formatting only |
| Unit | 30 files, 303 tests passed | Local fixtures |
| Integration | 55 files, 407 tests passed | Local PGlite and mocked providers; run took about 17 minutes |
| Security | 19 files, 179 tests passed | Local adversarial tests |
| Fraud evaluation | 12 of 12 passed, no forbidden-action violation | Small synthetic corpus, explicitly not calibrated |
| Build | API, worker, web, HQ, and Expo web export passed | No native signed artifact |
| Playwright | 23 of 23 passed on one Edge project | Seeded local identities, not deployed or cross-browser proof |
| Static production UI | Passed fail-closed checks | No configured hydrated production-browser proof |
| Full `npm run verify` | Failed | Five `no-undef` errors for `Buffer` in `scripts/replit-service.mjs` |

That audited release was therefore not fully green even though its individual tests and builds
passed. The later candidate at `1fbd079de126aabccd788bfa3a854a77d1f6c1a3` fixed the Buffer lint
failure and passed uninterrupted local verification plus all four GitHub CI jobs. That evidence
does not automatically cover a later change set: every new candidate must rerun and bind the same
gates to its own exact SHA.

The E2E run also emitted Clerk's current deprecation warning for middleware path matching. Treat migration to resource-based authorization checks as P1 security maintenance, not as proof of a present auth bypass.

### 3.3 Dependency inventory

The audited `9b5d585` baseline's full `npm audit --json` reported 16 vulnerable nodes: 1 Low, 10
Moderate, 5 High, and 0 Critical. The retained scoped evidence identified four mobile-production
High nodes and two distinct `image-size` advisories; it did not retain the fifth full-audit node's
identity. Preserve that count as historical evidence rather than presenting five distinct findings.

The later locked graph pins the supported Metro packages to 0.84.5 and removes `image-size`.
Fresh registry evidence now reports 1 Low, 23 Moderate, 0 High, and 0 Critical for the full graph;
the production-mobile graph reports 23 Moderate and zero High/Critical; API, worker, web, and HQ
production graphs each report zero findings. The empty High allowlist is enforced in
`scripts/verify-run3-1-dependencies.mjs` and CI. The Moderate Clerk/Expo tooling chains remain open
upstream risk and must be re-audited before a signed native distribution. See
[MOBILE-DEPENDENCY-AUDIT.md](../run-3/MOBILE-DEPENDENCY-AUDIT.md).

Do not run automatic audit fixes. The reported fallback to Expo 46 is a major, inappropriate downgrade for an Expo 57 app.

### 3.4 Audited product strengths

The repository has unusually strong local foundations for an early beta:

- Customer and HQ identity are intentionally separated at the web proxy and API layers.
- Household membership, administration, protected status, payer identity, billing authority, and pairwise Trusted Circle authority are separate facts.
- Consent is versioned, append-only, scoped, revocable, and identity-bound.
- Public and member Check paths minimize content, never fetch submitted URLs, state uncertainty, and provide safer actions.
- History, deletion, redacted sharing, orientation, and Founding Household enrollment exist.
- Stripe test-mode design separates redirects from canonical paid-invoice evidence and includes idempotent inbox, reconciliation, refunds, disputes, and inventory.
- Durable jobs, outbox/inbox patterns, external-action evidence, cumulative budget reservations, and a global stop exist locally.
- Feedback intake, minimization, assignment, retention, and least-privilege access have substantial local evidence.
- Web, HQ, API, worker, and Expo web builds currently succeed.

These are engineering assets. They are not customer demand, fraud efficacy, native readiness, provider success, or recurring-revenue evidence.

### 3.5 Historical `9b5d585` blocker snapshot

This table explains why the audited release was not launch-ready. Several repository blockers were closed in `1fbd079`; several others have later uncommitted closure work. It is preserved for traceability and does not override Section 3.0 or the exact current diff.

| Blocker | Actual evidence | Required resolution |
| --- | --- | --- |
| Live Stripe is structurally impossible | Production config requires Stripe disabled; API and worker compose Stripe only in test; database and repository reject production initiation; billing readiness requires test | New forward-only live-capable release across config, migration, persistence, API, worker, HQ, UI, tests, monitoring, and rollback |
| New customers lack billing authority | Production bootstrap creates household membership and administrator assignment, but no payer or billing-manager fact; no normal runtime or HQ grant path was found | Founder-only, recent-MFA, exact-household billing-authority grant and revoke flow with audit, idempotency, tenant tests, and rollback |
| Public and paid offer copy contradict | Pricing says no plan is for sale and billing is unimplemented; billing says test checkout and unvalidated offer | One coherent production offer with price, renewal, cancellation, refund, tax, receipt, and support terms |
| Support is not reachable | No customer support route or verified public mailbox path; feedback explicitly does not create a support case | Public support page, in-product links, case receipt, hours, response target, backup, billing/refund/account routes, incident fallback |
| Production feedback excludes paid-only access | Current production feedback gate requires active Founding Household sponsored access | Make verified paid access eligible, or truthfully label temporary overlapping sponsored continuity for Customer 1 |
| Tax behavior is hard-coded to zero | Checkout disables automatic tax; schema and verifier require zero tax and exact $14.99 total | Qualified launch-geography decision; change code/schema if collection is required |
| Failed-payment recovery is incomplete | Portal is cancel-only and payment-method update is disabled; action-required and finalization-failed events are omitted | Safe card-update recovery, webhook coverage, customer guidance, dunning tests, reconciliation |
| Customer legal and billing terms are not reachable | No public privacy, terms, billing terms, account deletion, or accessibility pages were found | Publish evidence-backed, professionally reviewed documents and link them throughout the flow |
| Frontend copy violates the dash rule | Static scan found 59 source lines in web and HQ containing U+2013 or U+2014; mobile contains additional occurrences | Deterministic source and rendered checks plus human editorial review |
| Browser proof is narrow | Local Playwright uses seeded identities and one Edge project; current task's in-app browser connection failed during setup | Deployed browser audit, real Clerk session proof, Chromium/Firefox/WebKit, mobile viewport, keyboard, zoom, screen-reader human evidence |
| Native app cannot use production | Local identifiers, seeded mobile sessions, API rejects mobile audience, no Clerk Expo SDK, no production EAS profiles, no store assets, no signed device proof | Production native auth contract, permanent IDs, EAS setup, signed builds, physical-device matrix, privacy/support/deletion paths |
| Full release gate is red | Five lint errors in the Replit service script | Fix and rerun `npm run verify` and E2E |

#### 3.5.1 Read-only Customer Clerk facts, updated 2026-08-26

The connected provider UI was inspected without changing a setting. The exact application was
`BoomerBuddy Customer`, in its production instance, with invite-only access. Email verification
codes, password sign-in, Google social sign-in, and Device Trust are enabled. Phone numbers are
disabled, so SMS MFA is unavailable. Authenticator-app MFA, backup codes, and required MFA are
disabled. The default session-token custom claims object is
empty, so it does not yet carry the billing reverification binding claim. No custom JWT template
exists, including the required `boomerbuddy-mobile` template. Clerk express legal consent is off,
and the Terms of Service and Privacy Policy URLs are unset. The instance uses root-domain Clerk
infrastructure, including `accounts.boomerbuddy.net`. That arrangement is not inherently wrong and
must not be replaced blindly. The Home URL, Unauthorized sign-in URL, and Account Portal fallbacks
are blank or default to the root. Allowed subdomain restriction is disabled, and the provider UI
identifies `app.boomerbuddy.net` as a valid subdomain of the primary root. Exact home, fallback,
callback-path, and allowed-subdomain proof remains open. Provider logs show completed Google sign-in
and session creation, but the observed app flow looped and the manual-email flow reached
`/sign-in/client-trust` on the customer app and returned 404. That path is Device Trust for an
unrecognized device, not true MFA. This separates provider authentication success from the broken
post-auth application routing chain and leaves genuine MFA/recovery open. A Change domain or home-origin action can cause downtime and
key or OAuth changes, so it requires staged validation and rollback. A later read-only Google SSO
inspection confirmed that custom production credentials and the expected Clerk OAuth callback are
configured, but the Clerk Dashboard rendered the Google OAuth client secret as readable text and
the browser inspection surfaced it in the local task log. The secret value is not repeated or stored
in this repository and must be treated as compromised, rotated in Google Cloud, replaced in Clerk,
and revoked before further Google production sign-in. No user record or customer PII was retained.

The exact closure configuration for the default session-token claims is
`{"reverification_id":"{{session.reverification_id}}"}`. Clerk documents that the shortcode is
unique to each reverification and can be combined with the signed `fva` freshness claim to bind one
reverification to one sensitive action ([Clerk reverification](https://clerk.com/docs/guides/secure/reverification#correlate-a-reverification-with-a-specific-action)).
An authentic production token and one-time Checkout/Portal replay test are still required before
this gate is closed.

Candidate `1fbd079` registers `/sign-in/[[...sign-in]]`. With non-secret local Clerk
placeholders, `/sign-in`, `/sign-in/client-trust`, `/sign-in/sso-callback`, and
`/sign-in/oauth-callback` each returned HTTP 200 rather than 404. This is local build evidence only.
It does not close the current local diff, exact-SHA deployment, provider home/fallback/path settings,
allowed-subdomain proof, real Clerk post-auth routing, MFA enrollment, billing reverification, native
JWT, or physical-device gates.

### 3.6 Stripe account inventory

Safe read-only inventory covered the separate live account and the provider context named
`Boomer Buddy sandbox`.

- The account is a live US company account with card charges enabled and payouts enabled.
- The live account has zero Products, zero Prices, zero Coupons, zero Promotion Codes, zero Subscriptions, zero webhook endpoints, and zero Customer Portal configurations.
- Stripe Tax settings are active. There are zero tax registrations.
- The payout schedule is manual. One default USD bank destination exists, but identifying details are intentionally omitted.
- Account support email and support URL are unset.
- Account privacy policy URL and terms of service URL are unset.
- Receipt email toggle values were not readable through the available interface and remain unknown until the account holder verifies them directly.
- The separate `Boomer Buddy sandbox` has zero Products, zero Prices, zero Coupons, zero Promotion Codes, zero Subscriptions, and zero Customer Portal configurations.
- That sandbox has one enabled legacy webhook endpoint targeting `https://boomerbuddy.net/api/webhooks/stripe` on API version `2025-09-30.clover`. It belongs to the legacy site, is not BoomerBuddy 2.0 evidence, and must not be edited or deleted. A 2.0 sandbox path requires either a clean isolated sandbox or reviewed coexistence proof that prevents endpoint, secret, event, and replay ambiguity.
- No Stripe write was performed in either context. No Product, Price, Coupon, Promotion Code, Subscription, webhook endpoint, Portal configuration, Tax registration, payout, refund, dispute, customer, invoice, payment, account setting, or other Stripe resource was created, changed, archived, or deleted.

The account can accept charges, but it is intentionally empty and is not launch-ready. The current release also rejects live Stripe at multiple application layers. A Dashboard-only shortcut cannot close the code, evidence, authority, reconciliation, tax, receipt, support, or rollback gates.

### 3.7 Explicit unknowns and closure gates

| Unknown or open gap | Owner | Required closure evidence | Closure gate | Stop condition |
| --- | --- | --- | --- | --- |
| Live receipt email toggles are unreadable | Account holder plus billing owner | Account-holder-inspected live Dashboard setting recorded as enabled or disabled, with account identifiers redacted | Before any live charge | Do not take payment while receipt behavior is unknown |
| Support email and support URL are unset | Ops owner | Approved non-PII support channel and public URL, followed by a verified provider write | Before first live onboarding | Stop if a customer cannot reach support |
| Privacy policy URL and terms URL are unset | Legal and product owners | Approved public URLs with version and effective date | Before payment surface is public | Stop payment activation while either URL is absent |
| Live Product and Price do not exist | Billing owner | One Family Product and one USD 14.99 monthly Price after a verified write; no annual Price | Before live billing E2E and first payment | Stop if amount, currency, interval, quantity, or Product differs |
| Live webhook endpoint does not exist | API owner | Exact endpoint URL, event list, API version, secret-custody receipt without the secret, and verified delivery | Before live payment | Stop if signature, replay, idempotency, or delivery evidence fails |
| Customer Portal has no configuration | Billing owner | Approved cancellation and payment-recovery behavior plus live configuration receipt | Before self-service billing is promised | Stop if member-visible controls exceed approved policy |
| Stripe Tax is active but has zero registrations | Qualified tax owner plus account holder | Written jurisdiction and registration decision with effective date; registration evidence if required | Before first taxable charge | Stop if advice or registration is unresolved |
| Checkout and invoice code require zero tax | Billing/API owner plus tax owner | Qualified decision supports zero tax, or code/schema/test changes support required tax correctly | Before live preflight | Stop on any mismatch between provider tax and entitlement verification |
| Manual payout schedule is active | Finance owner plus account holder | Written acceptance or verified schedule change, named reconciliation owner, and close runbook | Before first payment | Stop if funds or reconciliation ownership is unclear |
| Sandbox contains an enabled legacy-site webhook and no 2.0 commerce resources | Billing and API owners | After the confirmation phrase, a separate 2.0 webhook under `api.boomerbuddy.net` plus reviewed coexistence proof, followed by authentic 2.0 Checkout, signed-webhook, lifecycle, refund, and reconciliation receipts with unambiguous endpoint, secret, event, and replay isolation | Before live configuration | Do not edit or delete the legacy webhook; fixtures, mocks, or events delivered to the legacy endpoint are insufficient |
| Current worktree has uncommitted closure work | Launch integrator | Integrated review, full local verification, Playwright, independent gauntlet, commit, push, and green GitHub CI bound to one new exact SHA | Before merge, provider setup, or deployment | Do not reuse `1fbd079` receipts for later changes or claim a final candidate while the worktree is dirty |
| Customer Clerk app home/fallback configuration and post-auth routing are open | Identity, web, and platform owners | Preserve root-domain Clerk infrastructure such as `accounts.boomerbuddy.net`; prove exact `app.boomerbuddy.net` Home URL, Unauthorized sign-in URL, Account Portal fallback, callback paths, and allowed subdomains with matching deployed canonical-origin code and real-session Google plus email/MFA sign-in, return, sign-out, and recovery receipts without PII. Then enable allowed-subdomain restriction for only the required Customer app subdomains while HQ remains in its separate Clerk app | Before customer onboarding or billing | Do not make a blind Change domain action; prove Account Portal, OAuth, web, and native flows before and after, stop on downtime, key/OAuth drift, loop, callback mismatch, 404, wrong `azp`, or wrong realm, and use the staged rollback |
| Google OAuth client secret was exposed by the Clerk Dashboard to the local browser-inspection log | Identity and security owners plus the Google Cloud credential custodian | Rotate the Google OAuth client secret in Google Cloud, replace the shared production credential in Clerk through an approved credential-custody session, revoke the exposed secret, and prove Google sign-in plus rollback without recording either secret | Before any further Google production sign-in or Customer 1 onboarding | Do not repeat, copy, commit, or reuse the exposed secret; stop if the replacement cannot be installed and verified atomically |
| Billing-authority control is local but not proved in the deployed production realm | Auth and billing owners | The existing exact-household HQ grant/revoke workflow passes recent-MFA, founder-realm, audit, idempotency, revocation, tenant, and replay tests; then the exact candidate must prove the same flow with genuine production identity and rollback receipts | Before Customer 1 can initiate Checkout | Stop any manual database or inferred-authority shortcut, or any grant that lacks fresh operation-bound MFA |
| Customer Clerk true MFA is disabled | Identity owner | Phone numbers are disabled, so SMS MFA is unavailable; enable and prove authenticator-app MFA plus backup-code recovery and the required-MFA flow after the nested sign-in route is deployed, without retaining PII | Before Checkout or Portal is available | Device Trust and `/sign-in/client-trust` are not true MFA; stop billing if a recent second factor and recovery cannot be enrolled and proved |
| Customer session claims omit billing reverification evidence | Identity and API owners | Default session-token claim `{"reverification_id":"{{session.reverification_id}}"}` configured and a one-time operation-bound Checkout and Portal proof passes | Before Checkout or Portal is available | Stop billing on missing, stale, malformed, or reused evidence |
| Customer Clerk allowed subdomain restriction is disabled | Identity and security owners | After exact deployment/config staging, enable restriction with only the required Customer app subdomain or subdomains; keep HQ in its separate Clerk app; prove Account Portal, OAuth, customer web, and native flows before and after | Before customer onboarding or billing | Stop on an unexpected allowed origin, HQ crossover, callback failure, key/OAuth drift, or missing rollback |
| No mobile Clerk JWT template exists | Identity and mobile owners | Exact `boomerbuddy-mobile` template with audience, surface, 60-second lifetime, and observed device `azp` disposition | Before physical-device beta | Stop native auth on an unexpected or unallowlisted `azp` |
| Customer Clerk legal URLs and express consent are unset | Legal, product, and identity owners | Approved deployed URLs and exact provider configuration receipt | Before any new customer sign-up or payment | Stop onboarding while the provider legal surface is incomplete |
| Paid-only feedback eligibility is incomplete | Product and persistence owners | Verified paid entitlement can access approved feedback, or temporary sponsored overlap is labeled and approved | Before paid onboarding is called complete | Stop if promised feedback/support is inaccessible |
| Failed-payment recovery is locally implemented but lacks authentic provider proof | Billing and web owners | Exact-candidate local gate plus authentic sandbox action-required, repeated-attempt, finalization-failed, Portal invoice-history, restart, replay, and recovery receipts | Before first payment | Stop if a customer cannot recover, obtain help, or see truthful provider-backed invoice and receipt guidance |
| Customer legal, support, accessibility, and deletion routes are incomplete | Product, ops, legal, and privacy owners | Public, linked, accessible routes with approved content and E2E evidence | Before scheduling Customer 1 | Stop when any required route is unavailable |
| Mobile identifier availability for `net.boomerbuddy.app` is unverified | Mobile owner and account holder | Apple and Google console collision check and exact local configuration match | Before signed store build | Use it unless collision; a collision requires a verified replacement decision, with no invented suffix |
| Apple/Google/Expo account, agreement, tax, banking, and credential state is unverified | Mobile owner and account holder | Console status checklist with no PII, named custody and recovery owners | Before the affected build or submission | Stop when any required agreement, attestation, or custody control is incomplete |
| Production browser, monitoring, backup, and rollback evidence is incomplete | Platform and QA owners | Deployed synthetic browser matrix, alert receipt, worker/webhook health, disposable restore, timed rollback | Before first live onboarding | Stop when rollback or alert receipt cannot be demonstrated |
| Web-first golden path and mobile P0 evidence are incomplete | Web and mobile owners | Web payment path passes; mobile P0 has signed-device evidence or an explicit owned closure plan in parallel | Day 5 go/no-go | Any unresolved P0 or launch-critical P1 is a no-go |
| Twilio consent and compliance are unresolved | Compliance owner | Consent, sender registration, opt-out, suppression, quiet hours, privacy, delivery, budget, and incident evidence plus explicit enable decision | Later phase only | Keep Twilio disabled on any gap |
| First-customer support and incident coverage is unverified | Ops owner | Named window and backup, escalation, refund/cancel runbook, incident log, and rehearsal | Before scheduling the customer | Stop when accountable coverage is unavailable |
| Noncharging external release setup is not yet confirmed for the final exact SHA | Founder plus launch integrator | The founder types `CONFIRM NONCHARGING RELEASE SETUP` in the active task after reviewing the exact-SHA action packet | Before merge/tag, any Replit pull/deploy, production migration, provider write, external message, or spend | Continue safe local work only; the phrase does not authorize a charge, refund, customer consent, or an action outside the packet |

### 3.8 Historical exact repository code anchors for major blockers

Line numbers and claims refer to audited `9b5d585` and may move or be superseded after edits. Paths and named controls are historical anchors. Review the current diff before using any row as a present-tense claim.

| Blocker | Exact repository anchors | What the anchor proves | Closure owner |
| --- | --- | --- | --- |
| Production rejects live Stripe | `packages/config/src/index.ts:207-219`, `packages/config/src/index.ts:256-280`, `packages/config/src/index.ts:346-459` | Live startup is refused; production mode is disabled; offer/API constraints are code-owned | Platform plus billing |
| API and worker wire Stripe only in test | `apps/api/src/routes/commerce.ts:162-199`, `apps/worker/src/server.ts:214-260` | Stripe adapter, reconciliation, retry, and inventory registration are test-only | API plus worker |
| Database and repository reject live initiation | `packages/persistence/migrations/0016_run3_stripe_first_dollar.sql:48-59`, `packages/persistence/src/commerce-runtime.ts:291-317`, `packages/persistence/src/commerce-runtime.ts:920-1018`, `packages/persistence/src/commerce-runtime.ts:3146-3175` | Production initiation cannot be enabled and readiness requires test environment | Persistence plus billing |
| Webhook livemode provenance is not live-capable | `apps/api/src/routes/commerce.ts:729-919`, especially the `transportLivemode` capture near line 766 | Current capture records test provenance and must match live schema/verification | API plus security |
| Tax is forced to zero | `packages/integrations/src/stripe.ts:1070-1094`, `packages/persistence/migrations/0016_run3_stripe_first_dollar.sql:178-206` | Checkout disables automatic tax and verification requires exact zero tax and total | Billing plus tax owner |
| Failed-payment recovery is incomplete | `apps/api/src/routes/commerce.ts:39-53`, `packages/integrations/src/stripe.ts:970-1036`, `packages/persistence/src/commerce.ts:749-895` | Important lifecycle events are omitted; Portal is cancel-only; grace exists without safe card update | Billing/API/web |
| No normal billing-authority grant path | `packages/persistence/src/production-identity.ts:190-255`, `apps/web/src/app/member/page.tsx:49-53`, `apps/web/src/app/member/page.tsx:223-230`, `apps/web/src/app/member/billing/page.tsx:154-165` | Production bootstrap creates membership/admin only; UI hides or blocks billing without separate authority | Auth plus billing |
| Pricing and billing contradict | `apps/web/src/app/pricing/page.tsx:9-53`, `apps/web/src/app/member/billing/page.tsx:15-24`, `apps/web/src/app/member/billing/page.tsx:169-216` | Public page says no sale/free development while member billing offers test/unvalidated USD 14.99 | Product/editorial plus billing |
| Billing success is not a payment proof | `apps/web/src/app/member/billing/success/page.tsx:9-56`, `apps/web/src/app/member/billing/page.tsx:60-152` | Redirect is not canonical entitlement; pending/recovery needs explicit handling | Web plus billing |
| Paid-only feedback is blocked | `packages/persistence/src/feedback.ts:662-681`, `packages/persistence/src/feedback.ts:937-952`, `packages/persistence/migrations/0027_run3_1_feedback_founding_quota.sql:277-313` | Production feedback eligibility currently depends on sponsored Founding Household access | Product plus persistence |
| Customer support/legal routes are missing or unreachable | `apps/web/src/components/public-shell.tsx:16-23`, `apps/web/src/components/feedback-form.tsx:190-193`, `apps/web/src/app/feedback/page.tsx:14-29` | Navigation has no complete support/legal path and feedback explicitly does not open support | Product plus ops/legal |
| Customer invite UX expects provider identifiers | `apps/web/src/app/member/family/page.tsx:440-454` | A customer is asked for a raw Clerk subject instead of a normal bounded invite workflow | Member/auth |
| Non-shareable Check results can miss focus | `apps/web/src/app/member/check/page.tsx:50-72` | Result focus is guarded by sharing availability | Web/accessibility |
| Production mobile auth is impossible | `apps/mobile/src/screens.tsx:124-191`, `apps/api/src/auth.ts:203-270`, `apps/api/src/routes/sessions.ts:36-40`, `apps/mobile/package.json:16-32` | Mobile uses dev personas/session route; production rejects mobile bearer; Clerk Expo is absent | Mobile plus auth |
| Mobile identity and distribution are local-only | `apps/mobile/app.json:3-23`, `apps/mobile/eas.json:1-20`, `apps/mobile/src/api.ts:4-6` | Local permanent IDs, incomplete EAS profiles, and loopback default prevent production build | Mobile |
| Mobile lacks independent paid onboarding | `apps/mobile/src/screens.tsx:374-409`, `apps/api/src/routes/commerce.ts:370-427`, `apps/api/src/routes/commerce.ts:591-600` | Native has read-only entitlement summary; Checkout/Portal are customer-web scoped | Mobile plus billing |
| Native dependency containment expires on distribution | `docs/run-3-1/EXTERNAL-BETA-EVIDENCE.md:232-241`, `scripts/verify-run3-1-dependencies.mjs:116-140`, `scripts/verify-run3-1-dependencies.mjs:191-196` | High Expo/Metro findings were accepted only while mobile stayed undeployed | Security plus mobile |
| Frontend violates the dash standard | Representative anchors: `apps/web/src/app/layout.tsx:7`, `apps/web/src/components/member-shell.tsx:70`, `apps/hq/src/app/layout.tsx:7`, `apps/hq/src/components/hq-screen.tsx:103`, `apps/mobile/src/screens.tsx:133-138` | Customer/HQ/native strings contain prohibited U+2013/U+2014 | Editorial plus QA |

### 3.9 Historical mobile audit

At audited `9b5d585`, the Expo app was useful product code but not a production customer app:

- `apps/mobile/app.json` uses local slug, scheme, and `net.boomerbuddy.local` identifiers.
- `apps/mobile/eas.json` lacks production build and submit profiles.
- Sign-in uses `/v1/dev/sessions/mobile`; production rejects mobile bearer auth.
- No Clerk Expo package or reviewed native token contract exists.
- Default API URL is loopback unless explicitly configured.
- Acquisition, real account creation, Founding Household acceptance, billing, support, account deletion, and wired feedback are missing.
- Share-to-Check, push, inbound intents, and production deep links are not implemented.
- No icon, adaptive icon, splash, screenshots, store listing, or signed-artifact evidence is tracked.
- SecureStore usage is sensible static code but is not device proof.
- There are no React Native component tests, native E2E tests, or device accessibility receipts.

Recommended permanent bundle and application identifier: `net.boomerbuddy.app`. It is a reverse-DNS technical identity derived from the controlled `boomerbuddy.net` namespace. It is not a public URL and does not change the legacy site. The founder approved this assumption, but a collision in Apple, Google, Clerk, or Expo is a stop condition.

### 3.10 Historical member experience audit

At audited `9b5d585`, the assisted path was plausible but not yet commercially coherent:

1. Public landing or Public Check.
2. Founder invites an exact customer identity through the customer Clerk realm.
3. First sign-in bootstraps a household administrator.
4. Founder separately creates a Founding Household credential.
5. Customer accepts service and protected-enrollment consent.
6. Customer completes orientation and an actual Check.
7. Customer may create a Trusted Circle invitation, but the production form currently expects a raw Clerk subject and sends no message.
8. Billing is hidden unless billing authority already exists.
9. Feedback is available only under the sponsored entitlement boundary.
10. No coherent customer support, account closure, receipt, or retention follow-up surface completes the loop.

The fastest safe version is founder-assisted. Self-service acquisition, referral automation, white label, and broad outreach come later.

## 4. Commercial decisions

### 4.1 Initial offer

Use one offer for the first paid cohort:

**Founding Family Beta: $14.99 per month, one household, guided setup included, cancel any time.**

Do not introduce a trial, coupon, referral credit, adaptive pricing, app-store purchase, or multiple paid tiers for the first paid cohort. Family monthly is the complete production catalog for this plan. Annual, Individual, and referral candidates are not a production backlog or approved catalog: their names, amounts, allowed scopes, and promotion gate are controlled only by [OFFER-HYPOTHESIS-REGISTRY.md](./OFFER-HYPOTHESIS-REGISTRY.md), and evaluation is limited to synthetic or Stripe sandbox evidence.

### 4.2 Refund and cancellation recommendation

Publish only after qualified legal and accounting review for the launch geography:

- First subscription charge: full refund on request within 30 calendar days.
- Monthly renewal: cancel any time, with access through the paid period. Refund duplicate, unauthorized, erroneous, or service-failure charges and honor any legal right.
- No annual refund promise is approved. Any later production proposal must first pass the offer registry promotion gate and receive qualified refund, tax, and accounting review.
- Refund exceptions above the policy remain founder-approved until a staffed billing function exists.
- A refund or cancellation never erases invoice, consent, audit, or reconciliation evidence that must be retained.
- Customer access changes only from reconciled provider and policy truth, never from a browser redirect or support promise.

### 4.3 Support promise

Agent triage and acknowledgement may run continuously. Public service terms should initially promise:

- automated receipt immediately when the system is healthy;
- a human-reviewed response within one business day during published hours;
- a separate urgent safety message that tells the customer to stop contact and use independently verified official channels;
- no claim that BoomerBuddy is emergency service, law enforcement, a bank, or 24/7 human support.

Suggested initial published hours: Monday through Friday, 8:00 a.m. to 6:00 p.m. Pacific, excluding holidays. The founder must confirm an accountable backup before cohort expansion.

### 4.4 Acquisition order

1. One consented warm founding household.
2. Up to five founder-permissioned warm households.
3. Original educational content and high-intent Public Check landing pages.
4. A small paid acquisition test only after attribution, support, and retention gates pass.
5. Credit-union discovery and a reusable co-branded paid evaluation.
6. Full white-label only after two standardized partner pilots and one renewal or expansion.

Do not make broad paid Facebook acquisition the first-customer plan. It is slower than an assisted warm household and cannot validate product value until the payment path works.

## 5. Definition of paying customer onboarded

Customer 1 counts only when every required fact below is true. A family relationship to the founder is disclosed in the evidence and does not count as independent channel validation.

| Stage | Measurable completion |
| --- | --- |
| Acquisition | Candidate has valid contact authority and independently agrees to consider the beta; no scraped, purchased, or transferred consent |
| Account | Customer creates or accepts the customer-Clerk identity and can sign in, sign out, recover, and return; no HQ token or realm is accepted |
| Consent | Customer directly accepts current service and protected-enrollment disclosures, can explain withdrawal, and separately chooses research, follow-up, or messaging consent |
| Household | Household exists; protected adult, administrator, payer, and billing manager facts are explicit; no role is inferred from kinship or payment |
| Orientation | Required steps complete; customer explains that the result can be wrong, URLs are not opened, and official-channel verification matters |
| First useful action | Customer completes one realistic Check, understands its uncertainty, and chooses one independently verified safer action |
| Family value | A Trusted Circle relationship and one deliberate redacted share complete when a second person is available; a valid informed deferral is recorded rather than blocking payment |
| Billing | Customer knowingly initiates live Checkout for $14.99 monthly; exact live Checkout completion and separate `invoice.paid` evidence reconcile; canonical paid entitlement becomes active |
| Receipt and terms | Customer receives a usable provider receipt and can find price, renewal, cancellation, refund, statement descriptor, and billing support information |
| Support | Customer can open support, receives a case or receipt identifier, understands hours and emergency limits, and the operator meets the response target |
| Feedback | Customer submits minimized feedback or explicitly declines; service feedback, research, marketing, and testimonial permissions remain separate |
| Retention | Day 1 and Day 7 follow-ups are scheduled through an authorized channel; return use or a clear retention risk is recorded |

Do not call an account, free sponsored household, Checkout redirect, subscription status snapshot, or founder-entered entitlement a paying onboarded customer.

## 6. Day 0 through Day 7 critical path

### Owners

- **Codex engineering:** repository implementation, tests, evidence, runbooks, and bounded provider configuration after gates.
- **Independent reviewer:** adversarial review of security, payment, accessibility, privacy, and release evidence.
- **Founder:** irreversible account identity, offer, tax/legal/accounting, support ownership, live release, exact first-customer invitation, budget and provider activation.
- **Qualified professional:** applicable legal, tax, accounting, privacy, and security decisions.
- **Customer:** identity, consent, plan, payment, optional research/follow-up choices, and product use.

Codex engineering may perform safe local repository work, reviewable commits, branch pushes, and CI. The external-effect actions in Section 1.1 remain stopped until the exact confirmation phrase is recorded for the reviewed noncharging action packet. Founder references below identify accountability, an interactive account-holder step, or the explicit external gate.

### Workstream ownership and priority

Priority rule: P0 outranks launch-critical P1, which outranks other P1, then P2. Every owner works the highest unresolved gate in that order. Schedule pressure, sunk work, and provider timing never lower severity. Web-first payment is the revenue path. Mobile P0 work continues in parallel and is never silently deferred. Family at USD 14.99 per month is the only launch offer. Annual, Individual, and referral hypotheses remain sandbox-only under the offer registry. Twilio remains disabled.

| Day | Primary workstream | Accountable owner | Parallel workstreams | Required exit evidence |
| --- | --- | --- | --- | --- |
| Day 0 | Freeze scope, capture baseline, classify P0/P1, and confirm no PII | Launch integrator | Engineering inventory; QA evidence map; read-only provider checks | Approved scope, owner map, blocker ledger, and closure-gate table |
| Day 1 | Member golden-path hardening | Web/member owner | API auth/authorization/security; billing-authority design; mobile P0 auth/device triage | Clean synthetic customer reaches consent, household, orientation, and useful Check |
| Day 2 | Editorial, legal/support routes, accessibility, and failure states | Product/editorial owner | Cross-browser QA; support setup; mobile identifier/config/device readiness | Approved copy inventory, public required routes, zero prohibited dashes, no launch-critical accessibility defect |
| Day 3 | Billing and first-payment readiness for Family monthly only | Billing/API owner | Web Checkout/recovery UX; worker/webhook reconciliation; tax/receipt decisions; mobile P0 | Authentic sandbox matrix covers success, decline, action required, replay, cancel, refund, restart, and reconciliation |
| Day 4 | Beta operations, support, security review, restore, and first-customer rehearsal | Ops owner | Monitoring; incident tabletop; exact-SHA full verification; mobile signed-device lane | Clean synthetic rehearsal, alert receipt, restore, support escalation, and timed rollback pass |
| Day 5 | Go/no-go, live-capable default-off deployment, and read-only preflight | Launch integrator | Platform, billing, QA, mobile, ops, and support on-call | Go only with no unresolved P0 or launch-critical P1 and all objective/provider gates closed |
| Day 6 | Noncharging exact-SHA provider setup and initiation-disabled deployment | Launch integrator; billing and ops owners watch | Auth configuration; support readiness; logs/alerts; mobile P0 closure | Zero-customer inventory, deployed health, rollback, and noncharging provider evidence reconcile |
| Day 7 | Bounded live onboarding, immediate reconciliation, and initial observation | Product owner plus launch integrator | Commerce close; support/fraud/privacy review; retrospective; mobile/distribution plan | One approved payment and canonical entitlement reconcile; record hold, continue, or expand |

### Schedule

| Day | P0 work and parallel tracks | Dependencies and closure gates | Definition of done | Rollback or stop |
| --- | --- | --- | --- | --- |
| Day 0 | Freeze monthly offer and golden path. Fix lint. Create release branch. Read-only live Stripe inventory. Confirm no live catalog. Start member, billing, mobile, operations, and copy tracks. Keep ad spend at $0. | Launch geography, support owner, refund recommendation, `net.boomerbuddy.app`, candidate availability | Exact backlog, owners, metrics, branch, test baseline, no untracked changes | Stop live path if offer, tax, or support cannot be stated truthfully |
| Day 1 | Build billing-authority grant/revoke. Rewrite public pricing and billing copy. Add support, privacy, terms, billing terms, accessibility, and account-deletion entry points. Add dash enforcement. Start production native auth contract and EAS profiles. | Legal and tax review may continue, but unknowns remain visible | Golden path is coherent in local synthetic web; all new copy uses ASCII punctuation; P0 auth tests pass | Revert isolated changes if consent, auth, or product claims weaken |
| Day 2 | Implement forward-only live Stripe seams across config, migration, API, worker, persistence, HQ, and UI. Keep initiation disabled. Add paid-feedback eligibility, payment recovery, missing webhook events, receipt/support UI. Continue mobile auth, central 401 recovery, assets, permissions allowlists, and native tests. | No live credentials in source; founder account access only through provider controls | Test-mode lifecycle composes in a production-like config while live initiation remains disabled | Fail closed on migration ambiguity, tenant leak, or payment/access mismatch |
| Day 3 | Run authentic Stripe test Checkout, signed webhooks, test clocks, 3DS, failure, card update, cancellation, refund, dispute, duplicates, order changes, ambiguity, outage, restart, and inventory. Run cross-browser and accessibility matrix. Produce signed iOS/Android internal builds if accounts permit. | Stripe sandbox resources; Expo/Apple/Google/Clerk account actions; dependency disposition | Complete test-mode evidence, no unresolved Critical/High, signed internal builds or explicit external account blockers | Do not distribute native build with local auth, wrong API, risky dependency, or inaccurate privacy manifest |
| Day 4 | Prepare an exact candidate and a noncharging staging or initiation-disabled production-canary packet. After the exact phrase gate, deploy it and prove real PostgreSQL concurrency, backup and isolated restore, worker heartbeat, raw-body webhook edge, alert receipt, support drill, incident stop, and rollback. Physical-device mobile test begins only after its provider gate. | Deployment target and immutable app identity are verified; provider settings remain noncharging; `CONFIRM NONCHARGING RELEASE SETUP` is recorded before the first external write | Exact SHA has deployed receipts, restore proof, alert proof, browser proof, and mobile device evidence | Before the phrase, stop at the reviewed packet. After it, roll back exact SHA on auth, privacy, restore, accessibility, or worker failure |
| Day 5 | Run two clean synthetic first-customer rehearsals across separate customer and HQ sessions. Complete independent review. Freeze candidate. Prepare live product, price, portal, webhook, receipts, and statement descriptor plan but do not charge. | Qualified tax/accounting/legal disposition; support backup; recent founder MFA | Signed GO, NO-GO, or REMEDIATE dossier. GO names exact live writes and rollback | Any unresolved P0 or launch-critical P1 is NO-GO. Other P1 items require a named owner, dated closure plan, bounded exposure, and explicit acceptance. A code change invalidates affected rehearsal evidence |
| Day 6 | After the exact noncharging confirmation phrase and the exact-SHA packet, perform only the reviewed setup: minimum Family monthly Stripe configuration and deployment with Checkout initiation disabled. Verify zero-customer inventory. Opening a live initiation window and taking payment require a separate first-charge gate. | No account restriction; live secrets in approved custody; all objective closure gates passed; exact phrase recorded | Noncharging live readiness is green with no customer or money yet; kill switch and reconciliation remain active | Do not open Checkout from the noncharging phrase. Disable new initiation first after any drift and keep webhook and worker running to reconcile an accepted action |
| Day 7 | Customer personally signs in, consents, completes setup and useful Check, chooses the monthly offer, enters payment in Stripe Checkout, receives receipt, obtains canonical access, tests support, chooses feedback, and schedules follow-up. Observe web path and offer signed mobile beta if ready. | Customer availability and direct consent; founder operator and backup present | Every row in Section 5 reconciles. One real $14.99 subscription is active. Day 1 and Day 7 follow-ups exist | Stop and refund or cancel per policy on wrong charge, auth mismatch, unsafe experience, support failure, or unresolved provider outcome |

### Honest seven-day risks

- No immutable candidate is live-capable. `1fbd079` has the paid Family catalog and effective-entitlement mismatch, and later billing recovery work is uncommitted and still needs a new exact-SHA gate.
- Tax treatment and recurring-subscription terms depend on launch geography and professional review.
- A real customer and support operator must be available at the same time.
- Real Clerk behavior, MFA, invite delivery, and session recovery can differ from fixtures.
- Restore, monitoring, and raw-body webhook edge behavior need deployed proof.
- Mobile production auth is implemented locally, but provider configuration, signed builds, and
  physical-device authentication evidence remain open.
- Apple organization enrollment is reviewed by Apple, App Store Connect must process an uploaded build before it appears, and the first build added for external TestFlight testing requires approval. A newly requested D-U-N-S number can take up to five business days, followed by up to two business days for Apple to receive it. These combined steps have no cited seven-day guarantee, so external iOS distribution is not on the Customer 1 critical path ([Apple enrollment](https://developer.apple.com/help/account/membership/enrolling-in-the-app/), [Apple D-U-N-S timing](https://developer.apple.com/help/account/membership/D-U-N-S/), [Apple build processing](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/), [Apple TestFlight review](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)).
- Google verification must finish before submission. If the Play Console owner is a personal account created after 2023-11-13, Google requires at least 12 closed testers to remain opted in continuously for the preceding 14 days before the developer may apply for production access. Google says the later production-access review usually takes seven days or less but can take longer. Production distribution therefore cannot be promised inside seven days ([Google developer verification](https://support.google.com/googleplay/android-developer/answer/10841920?hl=en), [Google testing and production-access review](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)).
- Internal distribution is a separate lane and does not change the web-first payment plan ([Google test tracks](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en), [Apple TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)).
- The first family customer is valuable usability and payment evidence, but not independent acquisition proof.

If a safety or payment gate misses, move the first charge rather than invent a shortcut. Continue native internal testing and all safe local work in parallel.

## 7. Thirty-day beta operating model

### Cohort control

- Start with one paid household.
- Expand to three only after 72 hours with clean auth, payment, entitlement, support, logs, backups, and reconciliation.
- Cap at five for the first 30 days unless a new founder review explicitly raises capacity.
- Eligibility: adult participant with sufficient digital access, willingness to complete direct consent, no active emergency used as the practice case, an authorized support channel, and geography covered by approved terms.
- Exclude anyone who expects guaranteed detection, passive monitoring, financial advice, emergency response, or payer control over another adult.

### Daily cadence

1. API readiness, worker heartbeat, stale jobs, dead letters, and database health.
2. Clerk auth failures, wrong-realm attempts, founder MFA failures, and session recovery.
3. Stripe webhook age, inbox, ambiguous Checkout operations, paid entitlement SLO, inventory, failures, disputes, refunds, and receipts.
4. Support queue, safety reports, accessibility blockers, response target, and backup coverage.
5. Privacy, retention, feedback quarantine, restricted records, and deletion deadlines.
6. Error, log-redaction, alert receipt, backup receipt, and rollback readiness.
7. Funnel and spend: qualified Checks, activated households, paid households, refunds, support minutes, committed spend, and unknown outcomes.

### Weekly cadence

- One planned release window. Emergency fixes are separate and require incident evidence.
- One restore drill until RPO and RTO are measured and stable, then monthly.
- Browser and physical-device regression on the golden path.
- Fraud fixture and false-assurance review without claiming calibration.
- Cohort review: invite, consent, activation, first action, return, payment, support, feedback, cancellation, refund, and incident.
- Growth review: content source, qualified Check, activation, paid conversion, refund-adjusted CAC, payback, and stop rules.
- Access review: founder, support, reviewer, provider, store, and recovery roles.
- Founder report: revenue, customer value, risk, spend, decisions, and next bounded goals.

### Release cadence

- Days 1 through 7: at most one planned low-risk production release per day after rehearsal, plus incident hotfixes.
- Days 8 through 30: one regular weekly release unless a measured P0/P1 needs a hotfix.
- Every release binds exact SHA, tests, browser/device evidence, migration compatibility, backup, rollback, and owner approval.
- No release contains unrelated feedback items. One regression accompanies every fix.

### Incident levels

| Severity | Examples | Required action |
| --- | --- | --- |
| Critical | Cross-tenant or HQ access, secret/key compromise, wrong live charge, uncontrolled communication, destructive loss | Engage global and provider stop, freeze releases and cohort, preserve evidence, founder incident command, professional notification decision |
| High | Payment/access mismatch, unknown provider outcome, consent failure, failed restore, severe accessibility block, support unavailable | Pause affected action and new invites, reconcile, fix and independently retest |
| Medium | Bounded degradation with no known authority, privacy, or money error | Create owned task, communicate through approved support path, fix in next window |
| Low | Copy, documentation, or minor usability defect | Queue by customer impact and evidence |

### Decision metrics

Core metrics use complete denominators and never count family goodwill as channel validation:

- qualified Public Checks;
- Check-to-account rate;
- account-to-consent rate;
- consent-to-first-useful-action rate;
- activation within 24 hours;
- paid conversion and settled live invoices;
- canonical entitlement latency and mismatch count;
- Day 1, Day 7, Day 14, and Day 30 return;
- second useful action;
- Trusted Circle acceptance and deliberate redacted share;
- voluntary and involuntary churn;
- refund and dispute rate;
- support minutes and time to first response;
- severe accessibility, safety, privacy, auth, and payment incidents;
- gross MRR, net MRR, processing and provider cost, direct service cost, contribution;
- refund-adjusted fully loaded CAC and payback by channel.

Do not publish retention or LTV claims before a meaningful cohort exists. The first household teaches the workflow; it does not establish a market rate.

## 8. Cash, ads, and ROI controls

### Starter cash envelope

The founder stated that only a few hundred dollars are available. Use these hard limits:

| Scope | Cap | Rule |
| --- | ---: | --- |
| First seven days external acquisition | $0 | Warm assisted Customer 1 and product readiness come first |
| Total discretionary spend | $300 per rolling month | Includes ads, content tools, and Marketplace device buys unless separately approved |
| Meta/Facebook ads | $150 per month | Only after landing, attribution, billing, support, and rollback are live |
| High-intent search test | $100 per month | Use only a narrow intent cell and one landing page |
| Content/accessibility tools | $50 per month | No subscription without cancellation and owner record |
| Daily paid-media cap | $15 | All campaigns combined |
| Single experiment cap | $50 | Exact hypothesis, audience, creative, success event, and stop rule |
| Annual planning ceiling | $3,600 | Monthly caps still apply; no annual prepayment or self-expansion |
| Autonomous Marketplace payment | $0 | Agents may research and rank only |
| Founder-approved Marketplace item | $75 per item, $150 per month | Only if it fills a named device-test gap; no deposit, shipping, gift card, or agent meetup |

Use existing family devices before buying hardware. Do not purchase hardware before the current external spend gate is explicitly satisfied for an exact item and cap. If representative coverage cannot be obtained, record the exact evidence gap and a priced recommendation; do not silently spend or raise the cap.

### Spend lifecycle

Every paid action follows:

`available -> reserved -> rechecked -> accepted by provider -> committed actual cost -> reconciled outcome`

If the provider outcome is unknown, do not retry with a new key or free the reservation. Reconcile first. No agent can raise its own cap, add a tool, change the success event, or reset a period by versioning policy.

### Experiment stop rules

- Stop immediately on broken attribution, account restriction, unsupported claim, privacy complaint, consent complaint, wrong audience, or unknown spend.
- Stop a $50 experiment if it produces no qualified Check or demo request.
- Do not spend the next $50 until the prior cell has complete cost and funnel reconciliation.
- Do not automatically scale before at least three attributable non-family paid households and Day 14 return evidence.
- Initial refund-adjusted CAC target: at or below $35 per paid household, matching the existing internal scenario. Hard pause above $50 until contribution data supports a different ceiling.
- Target contribution payback: no more than six months initially, then tighten to three months after direct cost is observed.

### Facebook Marketplace boundary

Do not make Marketplace arbitrage part of BoomerBuddy subscription economics. Valid uses are:

1. A founder-approved purchase of a missing representative test device.
2. A customer-facing Marketplace Deal Check acquisition wedge, where the user pastes a message or listing text and gets warning signs, safer payment and meetup steps, and an optional Trusted Circle share.

Agents must not scrape listings, automate messages, impersonate a person, pay a seller, meet a seller, or move a conversation off-platform. Meta warns that unauthorized automated collection can violate its terms and that Marketplace messaging access can be limited.

### ROI record

Each experiment records:

- hypothesis and exact metric;
- channel, audience basis, creative, landing version, and approval;
- reserved and actual cost;
- qualified Checks, activated households, paid households, refunds, disputes, and returns;
- attributable tool and operator time;
- support minutes and direct variable service cost;
- net subscription revenue and realized contribution;
- CAC, payback, stop reason, and next decision.

`realized contribution = collected subscription revenue - refunds - disputes - processing - direct provider cost - direct support cost`

`CAC = attributable acquisition spend and loaded acquisition labor / settled attributable paid households`

Do not count a family member, a click, a submitted form, a free account, a sponsor-eligible person, or a hypothetical prevented loss as recurring revenue.

## 9. Earned autonomy operating system

The existing budget, job, outbox, external-action, and global-stop primitives are a good control plane. They are not yet a general executor.

### Agent cells

1. **Revenue controller:** selects one approved experiment from current evidence.
2. **Evidence analyst:** validates denominators, freshness, CAC, payback, retention, support, safety, and spend.
3. **Feedback triage:** produces a minimized content-free reproduction packet.
4. **Product builder:** implements one bounded change on an isolated branch with a regression.
5. **Independent reviewer:** attacks auth, tenancy, privacy, billing, accessibility, failure modes, copy, and overfitting.
6. **Release operator:** stages, canaries, verifies exact SHA, observes, and rolls back.
7. **Mobile operator:** builds signed artifacts, runs device matrices, and manages version evidence.
8. **Content operator:** source, draft, review, preview, publish, measure, correct, and expire.
9. **Lifecycle operator:** drafts and later sends only preapproved consented service messages within caps.
10. **B2B operator:** verifies public institutional facts, drafts compliant outreach, manages suppression, and prepares demos.
11. **Finance reconciler:** reserves cost, matches provider charges, Stripe revenue, refunds, disputes, and channel contribution.
12. **Safety governor:** can veto or demote authority but cannot execute the action it reviews.

### Authority levels

| Level | Allowed authority | Promotion evidence |
| --- | --- | --- |
| 0 Observe | Read approved content-free evidence, score, draft, and create internal proposals | Baseline, replay-safe proposals, no external action |
| 1 Internal | Reversible no-cost maintenance, test generation, branch creation, internal tasks and drafts | 20 reconciled runs, no auth or privacy breach, stop drill |
| 2 Staging and owned previews | Deploy staging, run browser/device tests, preview content, create release candidates | 10 clean candidates and two successful rollback drills |
| 3 Capped external | Publish reviewed owned content, send approved consented service messages, run one paid channel within exact caps | 20 reconciled actions, zero unknown outcome, complaint and suppression gates green |
| 4 Mature bounded operator | Select and run qualified experiments, canary approved releases, reconcile and demote automatically | 30 clean days, no unresolved P0/P1, founder-absence tabletop, complete cost truth |

Always human or professional:

- customer consent and payment authorization;
- contracts, legal terms, tax registration, accounting policy, bank and payout actions;
- cap increases and new payment methods;
- breach or regulator notification;
- material refund exceptions and dispute representations;
- Apple, Google, Clerk, Expo, Stripe, Twilio, or other provider legal agreements and recovery ownership;
- physical Marketplace transaction or meetup;
- new data category, processor, retention basis, or surveillance permission;
- novel safety claim or difficult fraud adjudication;
- hiring, firing, compensation, debt, equity, or transfer of money.

### Continuous loop

Every autonomous cycle must name:

- one customer or revenue metric;
- one falsifiable hypothesis;
- one evidence source and freshness limit;
- one maximum cost and action count;
- one time box;
- one owner and independent reviewer;
- one stop condition;
- one rollback;
- one verifiable completion condition.

Use scheduled bounded runs for daily and weekly operations. Create one durable goal only for a coherent engineering or experiment objective. Do not create an endless goal called grow the business.

## 10. Product and engineering backlog

### P0 before Customer 1

| Surface | Backlog item | Done when |
| --- | --- | --- |
| Web | Coherent acquisition, invite, price, support, consent, billing, feedback, and return path | Two clean synthetic rehearsals and deployed browser proof |
| Web | Fix Public Check production/local contradictions and signed-out recovery | Production branch renders only accurate copy and preserves ephemeral privacy |
| Web | Add support, privacy, terms, billing terms, accessibility, and account-deletion entry points | Reachable from public, auth, billing, success, member, and error states |
| Web | Fix non-shareable Check result focus and dynamic accessibility coverage | Keyboard and assistive-tech regression passes |
| Identity | Rotate the exposed production Google OAuth client secret | Replacement is installed in Google Cloud and Clerk, the exposed credential is revoked, no secret value enters repository or evidence, and real Google sign-in plus rollback pass |
| Billing auth | Founder-only billing-manager grant/revoke | Exact identity/household, recent MFA, audit, idempotency, revocation, cross-tenant negatives |
| Billing | Forward-only live-capable runtime and migration | Live can be configured with initiation disabled and test lifecycle stays green |
| Billing | Paid feedback eligibility | Verified paid household can submit minimized feedback without sponsored contamination |
| Billing | Payment-method recovery and missing webhook events | 3DS/action-required, finalization failure, renewal failure, card update, and recovery reconcile |
| Billing | Receipts, statement descriptor, cancellation, refund, and support UI | Customer can find and use every path |
| API | Preserve origin, audience, issuer, tenant, consent, and entitlement enforcement | Wrong realm, origin, actor, household, and replay tests pass |
| Worker | Live webhook, retry, inventory, ambiguity, and graceful-shutdown composition | Restart/outage/replay/inventory evidence passes on real PostgreSQL |
| HQ | Recent-MFA live cohort, initiation, preflight, attention, safe drain, repair, and billing-authority controls | Founder can operate without raw manual API or SQL mutation |
| Operations | Hosted redacted errors, metrics, alerts, backup, restore, incident stop, support queue | Receipt and tabletop evidence bound to exact SHA |
| Copy | Remove all U+2013/U+2014 and development/test contradictions | Source and rendered `verify:copy` gate passes |
| Accessibility | WCAG 2.2 AA matrix over dynamic path | Edge/Chromium, Firefox, WebKit, mobile viewport, keyboard, zoom, axe, and human screen-reader proof |
| Mobile | Production customer-Clerk native auth and HQ rejection | Genuine native session works; wrong realm and stale/revoked token fail |
| Mobile | Permanent IDs, environments, EAS profiles, API fail-closed checks, assets | Signed internal iOS and Android artifacts bind to exact SHA |
| Mobile | Central session recovery, support, feedback, account deletion, copy cleanup | Physical-device golden path passes |
| Mobile | Dependency and generated-manifest review | No unaccepted Critical/High and only expected permissions and privacy declarations |
| Release | Fix five lint errors and bind E2E into release gate | Full `npm run verify` plus E2E passes from clean install |

### P1 during the first 30 days

| Surface | Backlog item |
| --- | --- |
| Member | Replace raw Clerk-subject family entry with a bounded identity-bound invitation lookup |
| Member | Add profile, household rename, settings, accessibility preferences, account export and closure |
| Member | Add contextual Check, orientation, billing, and support feedback links with explicit scope |
| Mobile | User-invoked Share-to-Check from text, email, browser, and Marketplace, with hostile-input isolation |
| Mobile | Consent-aware content-free push for support and incomplete setup, with quiet hours and revocation |
| Mobile | Native black-box automation, crash health, minimum supported version, and mobile kill switch |
| Billing | MRR, net revenue, renewal, refund/dispute, failed-payment, and contribution dashboards |
| Billing | Accounting export and payout/balance reconciliation package |
| Support | Customer-visible case status, safe FAQ, billing and account recovery, escalation, and handoff |
| Feedback | Content-free feedback-to-reproduction packet and internal issue proposal in shadow mode |
| Analytics | Privacy-minimized event dictionary from landing through payment and return |
| Growth | Three manually researched high-intent pages and one measured landing page |
| Content | Founder recording to article, captions, clips, correction, and expiry pipeline |
| Demo | Isolated, resettable, expiring synthetic demo tenant with no production data |
| Sales | Verified public credit-union roles, content-free CRM, compliant draft outreach and suppression |
| HQ | First-class customer, revenue, support, payment, mobile, funnel, and owner-attention views |
| Security | Replace deprecated Clerk middleware path matching with resource-based checks |
| Operations | Weekly release, restore, access review, dependency review, and incident exercise |

### P2 after direct retention and contribution evidence

| Surface | Backlog item |
| --- | --- |
| Packaging | Evaluate annual or Individual hypotheses only in the offer registry's synthetic and Stripe sandbox scopes; any production proposal must pass its promotion gate |
| Mobile | Public store readiness, external TestFlight, broader Play test, and production submission |
| Mobile | Store billing only if retention and current policy justify the cost |
| Product | Guided incident recovery plan, evidence checklist, official-contact directory, and family closure loop |
| Product | Topic-selected source-linked family scam brief and recurring preparedness rehearsal |
| Product | Image, screenshot, QR, document, audio, or call-related intake only after modality-specific safety and privacy gates |
| Growth | Small paid social/search cells after attributable retention and CAC proof |
| Referrals | Evaluate only the registry's sandbox referral hypotheses; any production proposal additionally requires recipient consent, abuse controls, accounting, and observed advocacy |
| B2B | One reusable paid co-branded credit-union evaluation with aggregate small-cell reporting |
| White label | Configuration-driven brand, domain, content, sponsor policy, and reporting; no source fork |
| Autonomy | Capped publication, lifecycle, spend, sales, and release actions only after earned-authority gates |

## 11. Human-writing and editorial standard

The [Wikipedia Signs of AI writing field guide](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) is descriptive, not prescriptive. It is not a policy or detector, and the listed patterns can appear in human prose. Use it as a review prompt only.

### BoomerBuddy human-writing checklist

For every customer and HQ change, a reviewer records pass, revise, or accepted exception with a short rationale:

1. Does the copy name the specific person, action, state, or limit?
2. Is every claim supported by current product or cited evidence?
3. Does the first sentence help the customer act, rather than announce importance?
4. Are uncertainty and failure stated plainly without operator jargon?
5. Are technical details layered after a clear plain-language summary?
6. Does each paragraph carry one main idea?
7. Is vague attribution replaced with an exact source or removed?
8. Are inflated significance, broad social claims, puffery, and canned future prospects absent?
9. Are superficial words such as highlighting or underscoring doing no analytic work?
10. Is formulaic negative parallelism such as not just X but Y removed unless genuinely needed?
11. Is a group of three used because the product has three real parts, not because prose was forced into a triad?
12. Are headings, boldface, repetition, recap sections, emoji, placeholders, and collaborative chatter minimal?
13. Is the tone calm and respectful, without age stereotypes, fear, urgency, or patronizing language?
14. Are price, renewal, cancellation, refund, consent, privacy, and support terms adjacent to the relevant action?
15. Does all frontend copy avoid U+2013 and U+2014 while retaining ordinary ASCII hyphens?

Do not ban ordinary words because an AI detector dislikes them. A deterministic lint rule should enforce only objective constraints. Human review handles tone and quality.

### Automated enforcement

- Add `verify:copy` to scan web, HQ, mobile, templates, store metadata, fixtures, and generated copy inputs for `\u2013` and `\u2014`.
- Scan rendered production routes and dynamic browser states so concatenated or provider-supplied copy cannot evade source checks.
- Add regression fixtures for landing, pricing, sign-in, Public Check result/save, member home, consent, orientation, family, Check, history, billing, feedback, support, mobile, and HQ.
- Maintain an approved claim inventory that maps customer claims to source and evidence tier.
- Store review outcomes and exceptions as reviewable artifacts, not a binary AI score.
- Fail CI on a banned dash, placeholder, broken claim reference, or unresolved critical copy fixture.

## 12. Two-year target state

### Product

- Mobile-first user-invoked capture from text, email, browser, screenshots, QR, and Marketplace where platform and privacy rules permit it.
- Calm evidence and safer-action flow, never a guaranteed safe verdict.
- Consent-bound Trusted Circle notification, acknowledgement, official verification, chosen action, and closure.
- Guided incident response and recovery record without turning BoomerBuddy into a bank, emergency service, or law firm.
- Source-linked, customer-selected family preparedness content that creates value between incidents.
- Accessible web and native experiences tested with older adults and assistive technologies.
- Direct household, sponsor, and partner entitlements remain provider-neutral and separately authorized.

### Commercial

- A measured direct Family subscription with known activation, support cost, refund, churn, CAC, and contribution.
- An Individual hypothesis remains sandbox-only unless evidence supports a new production contract through the offer registry promotion gate.
- One standardized co-branded credit-union evaluation, then a reusable partner program.
- Full white-label delivery only when contract value covers independent store, support, security, privacy, and release overhead.
- Synthetic, isolated, resettable demos and complete prospect, customer, admin, security, and integration documentation.
- Original founder-led video and article engine connected to qualified product actions rather than traffic vanity.

### Platform

- Event-driven durable workers with strict schemas, idempotency, leases, retries, dead letters, accepted-effect reconciliation, and audit.
- Separate identity realms and native trust contract; no provider claim grants tenant or household authority.
- Configuration-based brand, domain, content, sponsor policy, reporting, and storefront behavior without tenant code forks.
- Privacy-minimized analytics and support projections; raw artifacts remain private and purpose-bound.
- Provider-independent commerce, messaging, content, store, analytics, and enrichment adapters behind explicit policy.
- Reproducible fraud and action-safety evaluation with rights, provenance, adjudication, incident learning, and no inflated efficacy claim.
- Multi-region recovery, measured RPO/RTO, credential custody, processor inventory, and recurring restore proof.

### Autonomous company loop

- Daily agents observe health, revenue, support, feedback, risk, and spend.
- Scheduled bounded runs create only evidence-backed tasks.
- Product agents turn minimized reproduction packets into tests and reviewed release candidates.
- Content agents produce source-linked drafts, previews, derivatives, corrections, and expirations.
- Sales agents verify public facts, maintain suppression, prepare compliant outreach, and support human-owned relationships.
- Finance agents reconcile provider cost, revenue, refunds, disputes, cash, CAC, and contribution.
- Authority is earned per action and tool, never granted to a general super-agent.
- Global and per-agent stops, cumulative budgets, audit replay, and founder-absence drills are routine.

### Milestones

| Horizon | Target |
| --- | --- |
| Day 7 | One genuine paid monthly household, safe web fallback, signed internal mobile target, complete support and reconciliation |
| Day 30 | Up to five controlled households, Day 30 retention evidence, measured support cost, one content loop, autonomy Level 1 |
| Day 90 | Ten or more direct paid households or a documented pivot, native external beta, one repeatable acquisition cell, five credit-union interviews |
| Month 6 | Known direct-household contribution, at least one renewal cohort, one paid reusable co-brand evaluation, autonomy Level 2 or 3 for narrow actions |
| Month 12 | Repeatable direct or partner acquisition, mobile share loop, staffed support/on-call, independent security and accessibility evidence |
| Month 24 | Durable direct and sponsored recurring revenue, configurable partner platform, mature evidence corpus, governed multi-agent operations, measured recovery and economics |

## 13. Durable Codex goal recommendations

Use a durable goal when the phase has one coherent objective, a clear stopping condition, and a validation loop. OpenAI's [Follow a goal guidance](https://learn.chatgpt.com/use-cases/follow-goals) describes a good goal as larger than one prompt but smaller than an open backlog.

Recommended durable goals:

- Establish the exact evidence baseline and blocker matrix.
- Harden the member golden path until the full test and browser matrix passes.
- Produce a signed production-authenticated internal mobile beta with physical-device evidence.
- Make the Stripe lifecycle test-ready and live-config-ready without taking the customer's payment.
- Build the beta support, incident, backup, restore, and monitoring system and pass a tabletop.
- Observe and improve the first customer for a bounded seven-day period.
- Build the feedback-to-code worker through one synthetic closed loop.
- Build the initial content and landing-page system through three evidence-backed pages.
- Build the synthetic demo and compliant sales system through one complete rehearsal.
- Build and prove a capped spend adapter through one reconciled experiment.
- Build the autonomy control plane through one full shadow and one reversible bounded cycle.

Do not use one endless goal for support, growth, sales, or improve the product. Use scheduled bounded runs and create one goal per qualifying experiment or engineering objective.

Live onboarding should not be a durable autonomous goal. It is a human session with explicit personal actions and stop points.

## 14. Current execution authority and required human actions

Safe local repository implementation, local verification, reviewable commits, branch pushes, and CI may continue. The exact phrase `CONFIRM NONCHARGING RELEASE SETUP` is required before merge/tag, Replit pull/deploy, production migration, Clerk or Stripe writes in any environment, EAS or other provider identity/account writes, external messages, spend, charges, or refunds. The phrase applies only to the reviewed noncharging exact-SHA packet and does not authorize a first charge or other customer action.

Authorization is not evidence. Each permitted action still needs the target, environment, account, amount, scope, policy basis, verification method, stop condition, and rollback or containment recorded before execution. Unknown provider outcomes must be reconciled before retry. The priority and closure rules in Sections 3 and 6 remain controlling.

The following remain truthful human or qualified-professional actions where the provider, law, or customer relationship requires that person:

1. The account holder supplies accurate legal seller, registration, address, bank, tax, payout, identity, and recovery facts and personally completes any provider-required identity check, agreement, or attestation.
2. A qualified owner provides legal, tax, accounting, privacy, security, breach, regulator, difficult fraud, refund-exception, hiring, contract, and money-transfer dispositions when required.
3. The account holder provides secrets and recovery material through an approved secret channel; agents never place them in Git, prompts, logs, screenshots, or general evidence.
4. Customer 1 personally creates or accepts identity, gives or declines consent, chooses the plan, enters payment details, authorizes the charge, and chooses feedback, research, follow-up, and messaging preferences.
5. Any person contacted through lead generation must have a lawful contact basis, receive accurate claims, and retain all required consent, opt-out, suppression, and privacy rights.

Agents may prepare, navigate read-only surfaces, validate local work, and document these steps, but may not impersonate the account holder, customer, professional, or provider reviewer. If required participation, the exact external phrase, or truthful evidence is unavailable, the affected external lane stops while safe local work continues.

## 15. Primary external sources

### Payments and recurring billing

- [Stripe go-live checklist](https://docs.stripe.com/get-started/checklist/go-live)
- [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Stripe webhook handling](https://docs.stripe.com/webhooks)
- [Stripe Billing test clocks](https://docs.stripe.com/billing/testing)
- [Stripe Customer Portal](https://docs.stripe.com/customer-management)
- [Stripe receipts](https://docs.stripe.com/receipts)
- [Stripe refunds](https://docs.stripe.com/refunds)
- [Stripe Tax setup](https://docs.stripe.com/tax/set-up)
- [15 U.S.C. 8403, online negative-option requirements](https://uscode.house.gov/view.xhtml?edition=2023&num=0&req=granuleid%3AUSC-2023-title15-section8403)

### Mobile and stores

- [Expo EAS build configuration](https://docs.expo.dev/build/eas-json/)
- [Expo store submission overview](https://docs.expo.dev/deploy/submit-to-app-stores/)
- [Clerk Expo deployment](https://clerk.com/docs/guides/development/deployment/expo)
- [Apple TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/)
- [Google Play test tracks](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en)
- [Google Play personal-account testing rule](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
- [Google Play Data safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
- [Google Play account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN)

### Growth, content, accessibility, and outreach

- [Google Search spam policies](https://developers.google.com/search/docs/essentials/spam-policies)
- [YouTube channel monetization policies](https://support.google.com/youtube/answer/1311392?hl=en)
- [YouTube altered-content disclosure](https://support.google.com/youtube/answer/14328491)
- [FTC CAN-SPAM compliance guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- [FTC endorsement disclosure guidance](https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers)
- [Meta automated collection guidance](https://www.facebook.com/help/463983701520800)
- [Meta Marketplace safety](https://www.facebook.com/help/123884166448529/)
- [W3C WCAG 2.2](https://www.w3.org/TR/wcag/)
- [W3C older users and accessibility](https://www.w3.org/WAI/older-users/)
- [NCUA third-party relationship guidance](https://ncua.gov/regulation-supervision/letters-credit-unions-other-guidance/evaluating-third-party-relationships)
- [NCUA cyber incident notification requirements](https://ncua.gov/regulation-supervision/letters-credit-unions-other-guidance/cyber-incident-notification-requirements)

The companion [G0 through G3 prompt pack](./GAUNTLET-PROMPT-PACK.md) and [G4 through G15 prompt pack](./GAUNTLET-PROMPT-PACK-G4-G15.md) together turn this plan into the complete set of standalone execution phases.
