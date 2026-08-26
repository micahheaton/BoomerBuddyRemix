# Exact execution prompt to run next

```text
Objective

Finish the current BoomerBuddy 2.0 local closure work, produce one independently reviewed exact-SHA release candidate, and prepare a bounded noncharging provider/deployment action packet. Continue safe local work autonomously. Do not merge, tag, pull or deploy on Replit, run a production migration, write provider state, contact a customer, spend money, or take any payment unless the external gate below is satisfied.

Repository boundary and topology

Work only in C:\Dev\BoomerBuddy. Read AGENTS.md first. GitHub https://github.com/micahheaton/BoomerBuddyRemix.git is the only BoomerBuddy 2.0 source of truth. Its four Replit deployment consumers are fixed: boomerbuddy-web serves app.boomerbuddy.net, boomerbuddy-api serves api.boomerbuddy.net, boomerbuddy-worker runs background jobs, and boomerbuddy-hq serves hq.boomerbuddy.net. Replit pulls exact approved GitHub commits and never pushes. The separate Replit project BoomerBuddy, serving boomerbuddy.net, is legacy-only and out of scope. Do not edit it, sync it, republish it, retire it, or point 2.0 Clerk, Stripe, API, worker, customer web, or HQ configuration at it. Do not inspect another repository, checkout, worktree, Downloads, or OneDrive. Do not import from reference/boomerbuddy-v1.

Current evidence boundary

Begin read-only. Verify Git root, origin, branch, HEAD, index/worktree status, upstream state, and active agents before editing. Preserve all user and agent work. The historical audited release is 9b5d585e89e4a691a113b9cd4264c1edbb3cdfdf. The last immutable candidate with uninterrupted local verification, Playwright, and all four GitHub CI jobs green is 1fbd079de126aabccd788bfa3a854a77d1f6c1a3, but it is not live-capable because paid Family catalog and effective-entitlement semantics do not agree. The current worktree contains or may contain later uncommitted canonical-origin, billing-recovery, paid-feedback, support, mobile, copy, and documentation closure work. Do not claim that 1fbd079 evidence covers those changes. Do not invent a final SHA, test result, deployment receipt, or provider result.

Read-only provider facts

The Customer Clerk production instance uses root-domain Clerk infrastructure, including accounts.boomerbuddy.net. That arrangement is not inherently wrong and must be preserved unless a staged change is proved necessary. Home URL, Unauthorized sign-in URL, and Account Portal fallbacks are blank or default to the root. Allowed subdomain restriction is disabled, and the provider UI identifies app.boomerbuddy.net as a valid subdomain of the primary root. Provider logs show completed Google sign-in and session creation, but observed app flows looped or reached https://app.boomerbuddy.net/sign-in/client-trust and returned 404. That path is Device Trust for an unrecognized device, not true MFA. Phone numbers are disabled, so SMS MFA is unavailable; authenticator-app MFA, backup codes, and required MFA are also disabled. Treat app home, fallback, callback-path, allowed-subdomain, true MFA/recovery, and post-auth routing as open gates, not proof that Clerk authentication always fails. After exact deployment/config staging, restrict allowed subdomains to only required Customer app subdomains, keep HQ in its separate Clerk app, and prove Account Portal, OAuth, web, native, true MFA, and recovery flows before and after. Any Change domain or home-origin action can cause downtime and key or OAuth changes and requires staged rollback. Live Stripe is a charges-enabled, payouts-enabled US company account with an empty live catalog, no live webhook or Portal configuration, active Tax settings with zero registrations, manual payouts, unset support/privacy/terms URLs, and unreadable receipt-toggle state. Read-only Stripe sandbox access works and confirms zero Products, Prices, Coupons, Promotion Codes, or Portal configurations and exactly one enabled legacy webhook at https://boomerbuddy.net/api/webhooks/stripe. Keep it untouched. After the confirmation phrase, the 2.0 webhook must be a separate endpoint under api.boomerbuddy.net. No PII or secrets may enter prompts, Git, screenshots, logs, test fixtures, or general evidence.

Required reading

Read docs/post-launch-beta/README.md, EXECUTION-PLAN.md, EXECUTION-PLAN-SUPPLEMENT.md, OFFER-HYPOTHESIS-REGISTRY.md, GAUNTLET-PROMPT-PACK.md, GAUNTLET-PROMPT-PACK-G4-G15.md, and the current diff. Read the applicable Run 3 and Run 3.1 identity, Clerk, Stripe, mobile, deployment, support, feedback, backup, restore, incident, accessibility, and release documents. Read every changed contract, migration, persistence, API, worker, web, HQ, mobile, config, script, and test file before integrating it.

Allowed local actions

Coordinate the existing agents, use bounded subagents for independent gauntlet review, and make repository edits with regression tests. Run targeted tests after each coherent change, then the full gate. Make small imperative commits only after the integrated diff is reviewed and green. Push the branch and observe CI. Use narrowly scoped elevation for an exact Node, Prettier, tsx, or Playwright command only when the healthy Windows sandbox blocks that command with EPERM or uv_os_get_passwd ENOMEM. Keep sandboxing enabled and do not use shell-write workarounds.

External gate

The founder must type this exact phrase in the active task before any external setup write:

CONFIRM NONCHARGING RELEASE SETUP

Before that phrase, do not merge, tag, make a Replit pull, deploy, run a production migration, write Clerk or Stripe state in test or live mode, write EAS or another provider identity/account state, send external messages, spend money, charge, or refund. Local commits, branch pushes, and CI are allowed. After the phrase, perform only the reviewed noncharging exact-SHA action packet. The phrase does not authorize a live Checkout window, customer contact, customer consent, plan choice, payment, charge, refund, public store submission, provider agreement, legal/tax/bank attestation, Twilio, or an action outside the packet.

Business and product decisions

Family at USD 14.99 per month for one household is the sole approved production offer candidate; it is not live. Payment is web-first. Mobile is P0 in parallel and must not be silently deferred. Annual Family, Individual monthly or annual, group rates, referrals, coupons, credits, trials, and native purchases remain synthetic and Stripe sandbox only under the offer registry. Use net.boomerbuddy.app for the permanent mobile identifier unless an Apple, Google, Clerk, or Expo collision is verified. Keep customer and HQ Clerk realms, issuers, audiences, cookies, and origins separate. Keep HQ private and recent-MFA protected. Keep Twilio disabled. Check analysis must never fetch a submitted URL. Customer and HQ copy must use ASCII punctuation and contain no U+2013 or U+2014.

Parallel workstreams

Run one integrator and bounded parallel reviewers for: (1) canonical public-origin, Clerk app home/fallback/callback paths, allowed subdomains, and customer post-auth routing while preserving accounts.boomerbuddy.net, (2) Stripe async Checkout, payment-action recovery, Portal, invoice and receipt guidance, worker reconciliation, and webhook fail-closed behavior, (3) paid-entitlement feedback eligibility, (4) content-free tenant-scoped support receipt and HQ workflow, (5) mobile production auth, identifiers, signed distribution, physical-device and accessibility readiness, (6) current-state documentation and runbooks, and (7) independent security, privacy, tenancy, migration, commerce, copy, browser, and release red team. Coordinate migrations and shared indexes through the integrator. Do not edit a file another active agent owns.

Evidence gates

Prove canonical origin normalization and rejection, exact customer/HQ separation, Google and email/MFA callback routing, sign-out and recovery, wrong realm and wrong origin denial, exact household billing authority, paid feedback, durable support receipt, Family monthly pricing, Checkout plus separate invoice-paid entitlement, async payment, payment-action recovery, receipts and invoice access, cancellation, refund/dispute reconciliation, webhook replay/order/ambiguity, inventory, worker restart, backup/restore, alerts, rollback, and zero PII. Keep invoice.finalization_failed fail-closed: it records owner attention and customer recovery guidance but never changes access or proves payment. Prove the handler with authentic Stripe sandbox delivery, restart, replay, and recovery evidence. Distinguish local fixture, authentic Stripe sandbox, deployed browser, signed-device, founder, and real-customer evidence. No lower tier can be relabeled as a higher tier.

Tests and validation

Run focused unit, integration, security, migration, web, HQ, worker, mobile, and Playwright tests for every changed surface. The default integration command runs two deterministic sequential shards so the Windows host releases the long-lived PGlite/Vitest worker between halves; both shards must pass. Then run npm run verify, npm run test:e2e, Expo Doctor, production dependency audits, git diff --check, secret and PII scans, forbidden-dash scans, required gauntlet-section scans, and checks that neither reference/boomerbuddy-v1 nor the legacy Replit topology changed. Validate a clean index/worktree after commit. Run an independent final-candidate gauntlet against the exact diff. Do not auto-fix dependency advisories. A scoped elevated command is a Windows host compatibility measure only; record it and do not call it product evidence.

Commit, release, and Replit policy

Use short imperative commits on the current codex/ branch. After the complete local gate passes, push one exact candidate and require all GitHub CI jobs green for that SHA. Do not merge or tag before the external phrase. Replit never pushes. After the phrase and a reviewed noncharging packet, each of the four 2.0 Replit consumers may pull only the exact approved SHA, then must produce a service-specific build, health, origin, auth, and rollback receipt. Never touch the legacy BoomerBuddy Replit project. Do not enable live Checkout or take money in this task.

Stop conditions

Stop the affected lane on an unexpected repository, overlapping unowned edit, secret or PII exposure, migration ambiguity, wrong Clerk realm/domain/audience, auth loop or callback 404, tenant leak, payment/access mismatch, unsupported Tax or receipt behavior, provider account mismatch, legacy-resource ambiguity, mobile identifier collision, unaccepted High or Critical dependency, unsigned or untraceable artifact, failed rollback, missing support path, or an unresolved P0 or launch-critical P1. Before the exact external phrase, stop at the noncharging action packet. Continue other safe local work when one lane stops.

Rollback

Keep external effects at zero before confirmation. Make schema changes forward-only and backward compatible. Keep live initiation and automation default-off. Preserve webhook ingestion and reconciliation when disabling new Checkout. Revert only isolated compatible commits. Never delete provider, payment, consent, audit, support, or reconciliation evidence. For an auth, privacy, billing, or safety regression after an approved noncharging deployment, disable the affected surface, restore the prior exact release, and retain a redacted incident and rollback receipt.

Verifiable completion

Complete the local phase only when one new exact candidate SHA has a reviewed integrated diff, green full local verification, green Playwright and mobile checks, green GitHub CI, no prohibited dashes or secret/PII findings, and a GO, NO-GO, or REMEDIATE packet that separates closed local gates from authentic provider, deployment, signed-device, and human gates. The packet must list the exact noncharging provider and four-service Replit actions, evidence capture, stop conditions, and rollback. If the external phrase is absent, stop there without calling the release deployed or provider-ready. Do not claim Customer 1, recurring revenue, or first-payment readiness while support, paid feedback, mobile P0, authentic Stripe, Clerk post-auth routing, provider, deployment, or first-charge gates remain open.

Durable goal

Continue the durable goal to produce an exact-SHA, independently reviewed, rollback-ready first-customer candidate, with web payment and mobile P0 proven to the highest authorized evidence tier. Keep generating bounded local follow-up tasks. Mark the goal complete only after the objective itself is achieved, not because time or context is low.
```
