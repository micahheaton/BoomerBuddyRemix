# BoomerBuddy Gauntlet Prompt Pack, G4 through G15

Status: Standalone continuation of `GAUNTLET-PROMPT-PACK.md`

Evidence baseline: 2026-08-24

Audited release: `9b5d585e89e4a691a113b9cd4264c1edbb3cdfdf`

These prompts complete the pack. Each is standalone. Work only in the saved project, use synthetic data, preserve customer/HQ separation, keep Check from fetching submitted URLs, and keep Family at USD 14.99 monthly as the sole approved production offer candidate, which is not live. `OFFER-HYPOTHESIS-REGISTRY.md` controls every annual, Individual, and referral hypothesis, each of which is synthetic and Stripe sandbox only; no prompt may move one into production configuration, customer copy, live provider resources, or external action. Keep payment web-first while mobile P0 continues in parallel, use `net.boomerbuddy.app` unless a verified collision requires a recorded replacement decision and matching provider and repository evidence, keep Twilio disabled, and keep customer PII and secrets out of evidence.

Current authority note: the user has supplied standing authorization for in-scope repository,
provider-configuration, deployment, testing, and controlled-launch work. No additional subjective
founder phrase is required. For checklist compatibility, each phase retains its `Founder-only stop
conditions` heading; read it as the set of nondelegable human and external stop conditions. Direct
customer consent or payment action, provider-required account-holder identity or agreement steps,
qualified legal or tax decisions, missing target access, security or privacy failures, unbounded
spend, missing evidence, and failed rollback still stop the affected lane. Safe independent lanes
continue.

## G4 - Mobile auth, device, and native safety readiness

```text
Objective

Produce a production-authenticated, least-permission native candidate that works on real iOS and Android devices while Customer 1 remains web-first. Close native auth, session, API, deep-link, secure-storage, dependency, accessibility, and failure-recovery P0s without promising store distribution.

Repository boundary

Work only in C:\Dev\BoomerBuddy on a dedicated codex/ branch. Edit only apps/mobile, the minimum customer-auth/API contracts in apps/api and shared packages, focused tests, and docs/post-launch-beta. Read nested AGENTS.md. Never import from reference/boomerbuddy-v1. Preserve legacy boomerbuddy.net. Use synthetic data only and never expose secrets or customer PII.

Required reading

Read AGENTS.md; docs/post-launch-beta/EXECUTION-PLAN.md and its supplement; docs/post-launch-beta/OFFER-HYPOTHESIS-REGISTRY.md as the controlling annual, Individual, and referral hypothesis index; the G0-G3 evidence; apps/mobile/package.json, app.json, eas.json, App.tsx, api.ts, session.ts, navigation.ts, and screens.tsx; apps/api/src/auth.ts and sessions routes; ADR 0009 and ADR 0030; docs/run-3/MOBILE-AND-STORE-READINESS.md; docs/run-3/FOUNDER-PROVISIONING.md; Run 3.1 environment/evidence documents; and relevant Clerk, Expo, security, integration, and dependency tests.

Allowed actions

Implement production customer-realm native auth, strict HQ rejection, central expiry/revocation recovery, fail-closed HTTPS API configuration, route-only deep links, minimal permissions, secure session handling, support/account-control entry points, and mobile copy fixes. Add RN/component, API-auth, manifest, dependency, and native black-box tests. Use `net.boomerbuddy.app` in proposed local configuration unless a verified collision exists, but do not reserve it remotely.

Forbidden actions

Do not use dev personas or `/v1/dev/sessions/mobile` in production builds. Do not weaken issuer, audience, authorized-party, tenant, or founder boundaries. Do not add production secrets, URL fetching, background surveillance, contacts/camera/microphone/photos/location/tracking permissions, push, Twilio, store billing, EAS Update, remote builds, app records, or store submissions. Do not call Expo Go proof signed-device proof.

Parallel workstreams

Run native auth/API; session/storage; deep-link/intake; permissions/privacy manifests; component/native E2E; dependency/SBOM; physical-device accessibility; and support/account-control streams in parallel. Keep web-first billing and member work active in its own P0 lane.

Evidence gates

Real iOS and Android devices prove customer sign-in, HQ rejection, household scope, Check/history, logout, remote revoke, expiry, reinstall, cold/warm deep links, secure storage, offline/latency recovery, and no unexpected permission. Submitted URLs go only to the BoomerBuddy API and are never fetched by the app. No secret, raw content, local ID, loopback URL, dev persona, prohibited dash, or unresolved Critical/High dependency appears in a signed candidate.

Tests

Run targeted RN and API tests, realm-swap and tenant tests, deep-link hostile-input tests, manifest/Info.plist permission scans, secret scan, SBOM/audit, signed-artifact inspection, offline/401 recovery, and native black-box journeys. Record VoiceOver, TalkBack, text scaling, contrast, focus, reduced motion, lock/reboot, uninstall/reinstall, and network-loss evidence on physical devices. Then run full typecheck, lint, format, tests, and builds. Review git status, scoped diff, git diff --check, required headings, dash scan, and PII/secret evidence.

Commit, tag, and release policy

Use small reviewed commits with regressions. No release tag or distribution until exact-SHA signed artifacts and device receipts exist. Production rollout requires the scope receipt, objective gates, and rollback.

Founder-only stop conditions

Standing authorization covers scoped mobile provider and build work when exact account access, custody, cost cap, and rollback are proved. Stop on identifier collision, uncertain native token claims, unresolved High dependency, dangerous permission, wrong account, unbounded quota or spend, or customer/HQ crossover.

Rollback

Disable native distribution, revoke only test sessions, and revert the smallest compatible commit. Never delete app records, rotate shared signing keys, or touch the healthy web release autonomously.

Verifiable completion

Complete only when exact-SHA iOS and Android signed candidates pass the device, auth-separation, privacy, accessibility, failure, and rollback matrix, with no unresolved P0 or launch-critical P1 in scope.

Durable goal

Use one durable goal for a production-authenticated internal native candidate. Omit a token budget unless explicitly supplied. Complete only after all gates; mark blocked only after the same blocker repeats for three consecutive goal turns. Stop at signed-device evidence; store distribution belongs to G5.
```

## G5 - Mobile distribution and store readiness

```text
Objective

Prepare reproducible iOS and Android internal distribution, store metadata, privacy/account-deletion evidence, credential custody, and rollback without making public store approval a Customer 1 dependency.

Repository boundary

Work only in C:\Dev\BoomerBuddy. Edit apps/mobile distribution configuration/assets, focused validation scripts/tests, and docs/post-launch-beta on a codex/ branch. Read nested AGENTS.md. Do not edit reference/boomerbuddy-v1, legacy boomerbuddy.net, unrelated product code, customer data, or secrets.

Required reading

Read AGENTS.md; docs/post-launch-beta/EXECUTION-PLAN.md and supplement; docs/post-launch-beta/OFFER-HYPOTHESIS-REGISTRY.md as the controlling annual, Individual, and referral hypothesis index; G0-G4 evidence; apps/mobile/app.json and eas.json; docs/run-3/MOBILE-AND-STORE-READINESS.md; docs/run-3/FOUNDER-PROVISIONING.md; privacy, support, deletion, accessibility, and incident materials; current official Expo EAS/submission docs; Apple enrollment, build processing, TestFlight, privacy, review, deletion, and accessibility docs; Google verification, testing tracks, personal-account testing, Data Safety, deletion, and review docs.

Allowed actions

Prepare development, preview, production, and submit profiles; version policy; production icons/assets; accurate screenshots from real builds; reviewer instructions; privacy/data inventory; support/privacy/terms/deletion URLs; signing and recovery checklist; internal-tester matrix; and rollback runbook. Perform read-only collision checks for `net.boomerbuddy.app` when account-holder consoles are available. After the account holder completes any provider-required identity, agreement, or attestation step, verify receipts and signed artifacts without exposing private identifiers.

Forbidden actions

Do not invent an identifier suffix after collision. Do not accept agreements for the account holder. Do not create app, store, or EAS records; register devices or testers; create or revoke credentials; upload builds or source; submit for review; invite testers; spend quota; or change declarations without the exact target, scope receipt, required account-holder action, cost cap, evidence plan, and rollback. Do not claim TestFlight, Play, or public approval timing. Do not add web-payment links inside native until storefront policy is approved. Twilio stays disabled.

Parallel workstreams

Run iOS account/metadata; Android account/metadata; EAS provenance; privacy/data safety; assets/accessibility; reviewer access; credential recovery; and internal-track rollback streams. Mobile P0 device fixes continue in parallel with web-first revenue work.

Evidence gates

Identifier availability is checked in Apple and Google consoles; local bundle/package/scheme match; signed IPA/AAB provenance binds to exact SHA; install and update work on real devices; privacy, support, terms, account deletion, app access, content rating, and Data Safety/App Privacy fields have named owners; certificates/keys have recovery owners. If the Play owner is a personal account created after 2023-11-13, record the required 12 continuously opted-in testers for 14 days and later production-access review as a schedule constraint.

Tests

Repeat G4 signed-device, accessibility, permission, secret, SBOM, session, offline, and realm tests. Validate screenshots against shipped UI, store text against dash/copy rules, links over HTTPS, deletion initiation, reviewer access using a synthetic demo tenant, install/update/rollback, and exact version/build numbers. Finish with Git diff/status/check and evidence scans.

Commit, tag, and release policy

Commit reproducible config and assets separately from account receipts. Tag only after exact-SHA signed-artifact verification and the scope receipt pass. Internal distribution is not public release authority. Every submission requires exact target, account-holder prerequisites, review evidence, cost cap, and rollback.

Founder-only stop conditions

Stop the affected distribution lane for identifier collision, incomplete provider-required agreement or account-holder attestation, unresolved legal entity or tax facts, unsafe certificate or key custody, inaccurate privacy or store declarations, unapproved tester participation, unbounded build quota, failed review evidence, or missing rollback. Standing authorization does not permit impersonating the account holder.

Rollback

Expire/remove an approved TestFlight build from groups or halt/deactivate an approved Play internal release. Revoke test sessions as needed. Preserve non-PII receipts. Never delete permanent app records or revoke shared credentials autonomously.

Verifiable completion

Complete only when installable internal iOS and Android artifacts from an exact SHA pass device proof, all store, privacy, support, and deletion fields have owners and evidence, rollback is rehearsed, and every provider-required account-holder action is completed or remains an explicit gate.

Durable goal

Use one durable goal for reproducible internal distribution readiness, with no token budget unless supplied. Complete only after gates; mark blocked only after the same blocker repeats for three goal turns. Stop before an unapproved provider write or public submission.
```

## G6 - Billing and first-payment readiness

```text
Objective

Deliver a live-capable but fail-closed web Stripe path for exactly one Family subscription at USD 14.99 per month, then prove sandbox, staging, reconciliation, recovery, cancellation, refund, receipt, support, and rollback before a live charge. Keep every annual, Individual, and referral registry hypothesis sandbox-only and mobile payment web-first.

Repository boundary

Work only in C:\Dev\BoomerBuddy on a codex/ branch. Edit only necessary files in packages/config, contracts, domain, integrations, persistence and forward migrations; apps/api, worker, web, hq; focused tests; and docs/post-launch-beta. Read nested AGENTS.md. Do not edit reference/boomerbuddy-v1, customer data, provider secrets, or legacy boomerbuddy.net.

Required reading

Read AGENTS.md; EXECUTION-PLAN.md and supplement; OFFER-HYPOTHESIS-REGISTRY.md as the controlling annual, Individual, and referral hypothesis index; G0-G5 evidence; docs/run-3/STRIPE-FIRST-DOLLAR-RUNBOOK.md; STRIPE-STAGE-5-REMEDIATION-EVIDENCE.md; commerce/outbox/entitlement ADRs; config Stripe rules; commerce API/worker/integrations/repositories/migrations; member billing/success UI; feedback eligibility; Stripe integration/inventory/entitlement/E2E tests; and current official Stripe Checkout, subscriptions, webhooks, Portal, receipts, Tax, test clocks, idempotency, and payout reconciliation docs.

Allowed actions

Add a forward-only live-capable architecture with managed secret references, exact livemode provenance, default-disabled initiation, founder recent-MFA controls, max-one cohort capacity, billing-authority grant/revoke, idempotent Checkout, verified webhook inbox, canonical invoice-paid entitlement, inventory/reconciliation, action-required recovery, cancellation, refund/dispute ingestion, receipt guidance, support, monitoring, drain, and rollback. Use authorized Stripe sandbox resources only after an explicit sandbox gate.

Forbidden actions

Do not create or change live Stripe objects/settings, enter a card, charge a customer, use Payment Links/manual invoices/database entitlements, expose keys/secrets, trust redirects, enable annual/Individual/referral/trial/coupon/promotion/adaptive pricing/mobile purchase, change payout/tax registration, or weaken reconciliation. Do not use production credentials in tests. Twilio stays disabled.

Parallel workstreams

Run config/migration; API/webhook; worker/reconciliation; founder controls/HQ; member billing/recovery; tax/receipt/support policy; sandbox matrix; security review; and mobile entitlement/deep-link parity streams under one commerce integrator.

Evidence gates

Offer amount is 1499 cents (USD 14.99), currency is USD, interval is monthly, quantity is one, with no discount and no annual, Individual, or referral Price or program. Entitlement requires exact Checkout completion plus separate verified `invoice.paid`. Duplicate, delayed, out-of-order, missing, ambiguous, action-required, failed-finalization, cancel, refund, dispute, restart, inventory, and unknown-outcome cases reconcile safely. Every live unknown in the supplement closes before payment. Tax, receipts, support/policy URLs, Portal, payout owner, and schedule pass their objective closure gates.

Tests

Run commerce unit/integration/security/E2E, PostgreSQL concurrency, raw-body/signature/replay, authentic sandbox signed events and test clocks when authorized, decline/retry/card update, cancel, partial/full refund, dispute, restart, drain, backup/restore, alert, inventory, rollback, full verify, E2E, secret scan, and Git checks.

Commit, tag, and release policy

Use small reviewed commits and forward migrations. Do not tag or deploy until independent payment and security review passes. Later deployment must start with live initiation disabled. Provider resources and first charge require separate scope receipts and objective gates.

Founder-only stop conditions

Standing authorization covers the scoped billing work after objective gates pass. Stop on unresolved qualified tax, legal, or accounting decisions; wrong account or mode; catalog, Price, webhook, Portal, receipt, payout, bank, descriptor, support, credential, deployment, cohort, charge-cap, eligibility, refund, dispute, reconciliation, or rollback ambiguity; or any unknown provider outcome.

Rollback

Disable new initiation first, keep webhook reconciliation and safe Portal access running until work drains, preserve evidence, reconcile provider truth, refund only under the recorded policy and accountable authority, and roll back only to a migration-compatible tag.

Verifiable completion

Complete only when automated and authentic sandbox gates pass, live-capable code is default-off, every live closure gate has evidence, rollback is rehearsed, and no unresolved P0 or launch-critical P1 remains. No live charge occurs in G6.

Durable goal

Use one durable goal for a fail-closed first-payment system, omitting token budget unless supplied. Complete only after gates; mark blocked only after the same blocker repeats for three turns. Stop before live writes/payment.
```

## G7 - Beta operations and support readiness

```text
Objective

Make one-household beta support, privacy operations, monitoring, backup/restore, payment operations, incident response, and founder coverage executable before scheduling Customer 1. Twilio remains disabled; this phase does not enable it.

Repository boundary

Work only in C:\Dev\BoomerBuddy on a codex/ branch. Edit bounded support/ops/privacy code, tests, runbooks, and docs/post-launch-beta. Read nested AGENTS.md. Do not edit reference/boomerbuddy-v1, provider accounts, production/customer data, secrets, or legacy boomerbuddy.net.

Required reading

Read AGENTS.md; EXECUTION-PLAN.md and supplement; OFFER-HYPOTHESIS-REGISTRY.md as the controlling annual, Individual, and referral hypothesis index; G0-G6 evidence; operations/privacy/recovery, restore, Stripe, founding-household, feedback, Twilio, and Run 3.1 go-live/environment docs; worker health/jobs/dead-letter code; support/feedback/account controls; privacy retention; observability/security; and operational tests.

Allowed actions

Implement a reachable support route/receipt, published hours/emergency boundary, case taxonomy, billing/refund/cancel/account/deletion paths, named primary/backup coverage, on-call checklist, redacted alerting, worker/webhook/inventory health, backup receipt, disposable restore, incident log, severity model, release freeze, and rollback drills. Use synthetic cases only.

Forbidden actions

Do not promise staffed 24/7 or emergency service. Do not contact customers, expose raw artifacts, copy feedback into general prompts, auto-refund/dispute/delete, alter production, or send messages. Do not add Twilio credentials/traffic. Any missing consent, sender, STOP, suppression, quiet-hours, privacy, delivery, budget, webhook-security, retention, or ownership evidence keeps Twilio off.

Parallel workstreams

Run support UX/case receipt; billing operations; incident communications; monitoring/alerts; backup/restore; privacy/deletion/retention; staffing/coverage; and Twilio disabled-state verification.

Evidence gates

Support is reachable from public, sign-in, member, billing, feedback, and critical error surfaces. Founder and backup own the published window. Synthetic safety, auth, privacy, billing, outage, refund, cancel, and deletion cases escalate correctly. Alerts arrive, restore proves bounded RPO/RTO, rollback works, evidence is redacted, and Twilio stays off.

Tests

Run support routing/receipt/accessibility; privacy retention/deletion; auth separation; worker heartbeat/stale/dead-letter; webhook/inventory alert; backup/restore; incident tabletop; refund/cancel; outage; redaction; rollback; full verification; and E2E without live providers/customer data. Finish Git and evidence scans.

Commit, tag, and release policy

Use reviewed commits with regressions. No tag, deployment, or provider action until the applicable G8 evidence gate. Runbooks name the exact SHA and rollback owners.

Founder-only stop conditions

Stop the affected lane when support hours or backup are not operational, legal or privacy content lacks an accountable decision, an alert destination or restore target is unproved, customer communication lacks a lawful basis, refund or cancellation authority is ambiguous, incident command is absent, a provider target is wrong, or Twilio would be enabled.

Rollback

Pause invites and initiation, preserve support/reconciliation, disable affected automation, restore the last compatible path, and keep manual support available.

Verifiable completion

Complete only when coverage, support/incident drills, alerts, restore, refund/cancel, privacy operations, and rollback pass with synthetic evidence and no unresolved P0 or launch-critical P1.

Durable goal

Use one durable goal for a rehearsed one-household operating envelope. Omit token budget unless supplied; complete after gates; use blocked only after the same blocker repeats three turns. Stop before customer contact or production mutation.
```

## G8 - First-customer rehearsal

```text
Objective

Rehearse Customer 1 with clean synthetic identities and authorized Stripe sandbox evidence, including failure, support, payment, entitlement, cancellation, refund, incident, teardown, and rollback. Produce the exact live run sheet and go/no-go packet.

Repository boundary

Work only in C:\Dev\BoomerBuddy using the exact candidate branch/SHA and approved synthetic environments. Prefer edits in tests and docs/post-launch-beta; route product defects back to the owning phase. Read nested AGENTS.md. Do not use reference/boomerbuddy-v1, customer PII, production secrets/providers, live cards, or legacy boomerbuddy.net.

Required reading

Read AGENTS.md; EXECUTION-PLAN.md and supplement; OFFER-HYPOTHESIS-REGISTRY.md as the controlling annual, Individual, and referral hypothesis index; G0-G7 evidence; exact release diff; member, Stripe, mobile, support, privacy, restore, deployment, incident, and founding-household runbooks; environment manifest; release controls; and all golden-path, commerce, security, accessibility, and operations tests.

Allowed actions

Use fresh synthetic customer/HQ identities in approved non-production realms. Run two clean rehearsals, each with separate fresh customer and HQ sessions and reset synthetic state. Rehearse invite, sign-in, consent, roles, orientation, actual synthetic Check, optional redacted share, billing-authority grant, sandbox Checkout, signed webhooks, entitlement, receipt guidance, support, feedback, return, cancel, refund, teardown, and rollback. Give each run its own candidate-bound receipt. Inject failure/replay/delay/outage. Fix only proven blockers with regression, then restart clean.

Forbidden actions

Do not contact/impersonate a real customer, use PII, accept consent, enter payment, or choose a plan for anyone. Do not use live providers/URLs, create live objects, deploy production, weaken gates, enable Twilio, or count mocks as provider evidence. Do not introduce an annual, Individual, or referral registry hypothesis into the production rehearsal. Do not waive failures for schedule.

Parallel workstreams

Run customer journey; auth/adversarial; payment/reconciliation; support/incident; accessibility/browser/device; backup/rollback; and evidence-integrity streams with one launch commander.

Evidence gates

Two clean-account rehearsals pass signup through payment/use/support/cancel/refund/teardown with separate fresh customer and HQ sessions, state reset, and separate receipts. Failure matrix includes decline, action required, duplicate/delayed/out-of-order webhook, entitlement loss, unknown Checkout, restart, outage, consent withdrawal, cross-realm, restore, and timed rollback. No PII/secrets. Any unresolved P0 or launch-critical P1 is no-go; other P1 requires an owner, date, and bounded exposure.

Tests

Run complete automated suite, authentic sandbox matrix, deployed staging cross-browser, mobile viewport/device smoke, keyboard/axe/zoom/screen-reader, restore, alert, incident, reconciliation, and Git/evidence checks. Repeat the happy path after fixes.

Commit, tag, and release policy

Freeze one reviewed SHA. Create an annotated tag only after all objective gates and the scope receipt pass. Do not deploy live-capable code or perform live writes in G8.

Founder-only stop conditions

Standing authorization covers synthetic rehearsal, exact tagging, scoped provider writes, and deployment after their objective gates pass. Stop on an unresolved customer-contact basis, support schedule, qualified legal or tax decision, offer mismatch, candidate or target drift, charge cap, initiation control, rollback, or requested waiver of a safety gate.

Rollback

Reset only synthetic environments through approved procedures. Revert fixes only by compatible commit. Preserve evidence and production.

Verifiable completion

Complete only when both clean rehearsals pass from reset state with separate fresh customer and HQ sessions and separate receipts, every forced failure reaches a safe state, rollback is timed, the packet binds exact SHA and tag, and all nondelegable customer, account-holder, and qualified-professional actions are ordered.

Durable goal

Use one durable goal for the adversarial rehearsal, with no token budget unless supplied. Complete only after the gates; use blocked only after three repeated blocker turns. Stop at the objective GO, NO-GO, or REMEDIATE dossier.
```

## G9 - Live first-customer onboarding

```text
Objective

Safely onboard exactly one eligible, consented paying household through the web-first path. The customer personally completes consent and payment while engineering, billing, support, and incident owners watch content-free evidence and stop on any safety, authority, privacy, or money mismatch.

Repository boundary

Work only in C:\Dev\BoomerBuddy and the exact approved release tag. Do not edit code during onboarding. Use approved production runbooks and read-only, content-minimized evidence. Never put customer PII, contact details, submitted content, card data, tokens, safe words, or secrets in prompts, Git, screenshots, logs, or response. Do not touch legacy boomerbuddy.net.

Required reading

Read AGENTS.md; EXECUTION-PLAN.md and supplement; OFFER-HYPOTHESIS-REGISTRY.md as the controlling annual, Individual, and referral hypothesis index; G1 approvals; G8 packet; exact release/tag; live Stripe closure receipts; deployment, Clerk, member, billing, support, privacy, incident, backup, and rollback runbooks; and approved live run sheet.

Allowed actions

Verify SHA, tag, and health; run the scope-bound read-only preflight; let the launch operator open only the receipt-bound initiation window; observe content-free auth, consent version, household role, Check, Checkout, webhook, invoice-paid, entitlement, receipt, support, and return milestones; record opaque IDs and timestamps; and close initiation after one reconciled payment. The account holder or launch operator handles lawful contact and controls. The customer enters identity, consent, and payment personally.

Forbidden actions

Do not contact the customer autonomously, view/enter PII/card data, accept consent, select a plan, initiate payment, create manual entitlement, retry unknown provider outcome, expose secrets, fetch submitted URL, enable Twilio, expand cohort, change price, deploy, or waive a gate. No annual, Individual, referral, or native purchase.

Parallel workstreams

Account-holder and customer facilitation; platform health; auth and consent; billing and reconciliation; member accessibility; support; incident and rollback; evidence integrity, with the launch operator as commander.

Evidence gates

Exactly one approved household enters. Direct consent, explicit roles, one useful Check/safer action, Family USD 14.99 monthly Checkout, separate verified `invoice.paid`, canonical entitlement, receipt, support, and authorized follow-up are observed. No unresolved inbox, inventory, entitlement, auth, consent, privacy, or support mismatch.

Tests

Run only approved synthetic health probes and read-only readiness, worker/webhook age, reconciliation, inventory, alert, redaction, and support checks. Afterward reconcile provider, ledger, entitlement, receipt, and support evidence without mutating customer state.

Commit, tag, and release policy

Use the frozen tag only. No commit, tag, deploy, config drift, or hotfix during onboarding. An incident fix requires a separate gated release.

Founder-only stop conditions

Provider configuration and controlled launch may proceed under standing authorization when scope receipts and objective gates pass. The customer must personally accept identity, consent, plan, and payment actions. Stop on uncertain contact authority, consent, initiation control, charge cap, provider outcome, refund policy, incident command, support coverage, expansion criteria, or rollback.

Rollback

Close initiation, keep webhook and reconciliation running, preserve evidence, support the customer, revoke incorrect authority, restore safe access, and have the accountable billing owner cancel or refund under the recorded policy if required. Roll back only after reconciliation.

Verifiable completion

Complete only when one payment settles and reconciles, entitlement and receipt are correct, useful action and support complete, initiation is closed, no P0 or launch-critical P1 remains, and the launch integrator records onboarded or rolled back.

Durable goal

Use one durable goal only for content-free operational tracking, not for human interaction. Omit token budget unless supplied. Stop at every nondelegable account-holder or customer action and complete only after all evidence gates; use blocked only after the same blocker repeats for three goal turns.
```

## G10 - Post-onboarding observation and iteration

```text
Objective

Observe Customer 1 from 24 hours through Day 7, reconcile payment, access, support, privacy, and fraud evidence, close only bounded evidence-backed defects, and produce an accountable hold, continue, or expand decision without exposing content or overstating one-household evidence.

Repository boundary

Work only in C:\Dev\BoomerBuddy. Use aggregate/opaque production evidence and a codex/ branch for approved fixes. Never copy customer PII, artifacts, feedback, tokens, or secrets into Git/prompts. Do not inspect reference/boomerbuddy-v1 or touch legacy boomerbuddy.net.

Required reading

Read AGENTS.md; EXECUTION-PLAN.md and supplement; OFFER-HYPOTHESIS-REGISTRY.md as the controlling annual, Individual, and referral hypothesis index; G9 closeout; support/incidents; commerce/reconciliation; feedback/retention; privacy/backup; release/rollback; fraud evaluation; metrics definitions; and code/tests for any defect.

Allowed actions

Review content-free health, auth, consent, Check/useful-action milestones, second use, payment/entitlement/inventory, receipt, support time, feedback consent, refund/cancel/dispute, worker/alerts, privacy, backup, and incidents. Reproduce with synthetic data, add regression, implement smallest reversible fix, review, stage, and release only through gates.

Forbidden actions

Do not infer comprehension, satisfaction, retention, demand, LTV, or channel proof from telemetry. Do not read raw artifacts/feedback without authority, contact outside consent, enable Twilio, expand cohort, spend, auto-refund, auto-deploy protected changes, or release unrelated work.

Parallel workstreams

Commerce; member/accessibility; support/feedback; fraud/safety; platform/privacy; and metrics/decision streams. Fix only reproduced defects.

Evidence gates

At 24 hours, Day 3, and Day 7, provider, ledger, entitlement, support, and privacy evidence reconcile. Return or second action differs from login. Real statements stay in the approved consented research system. Any fix has a regression, full verification, staging, rollback, and exact SHA. Expansion stops for any P0 or launch-critical P1, overload, failed restore, money/access mismatch, auth or privacy incident, or harmful reassurance.

Tests

Run targeted regression, full verify/E2E, security/fraud, browser/accessibility, inventory/reconciliation, alert, backup/restore, and rollback proportionally. Never mutate production customer state.

Commit, tag, and release policy

One fix per reviewed commit. At most one planned low-risk release per day through Day 7. Protected changes require code-owner review, exact-SHA evidence, scope receipt, and rollback. No automatic release.

Founder-only stop conditions

Stop the affected lane when contact lacks a lawful or consented basis, raw feedback would enter general evidence, refund or cancellation policy is ambiguous, a dispute or incident lacks an accountable owner, expansion criteria are unmet, a safety waiver is requested, a policy or price change lacks evidence, or a live effect is unreconciled.

Rollback

Pause cohort/action, preserve support/reconciliation, revert compatible release or disable feature, verify recovery, document content-free outcome.

Verifiable completion

Complete when Day 7 reconciles or safely rolls back, fixes verify, limitations distinguish household learning from market evidence, and the accountable product owner records the decision and next gates.

Durable goal

Use one durable goal for Day 1-Day 7 observation/remediation, no token budget unless supplied. Complete after gates; blocked only after three repeated blocker turns. Stop at expansion decision.
```

## G11 - Safe feedback-to-code loop

```text
Objective

Prove a privacy-bounded feedback-to-code loop from consented intake through minimization, severity, issue, failing regression, isolated fix, review, release evidence, rollback, and outcome measurement without copying raw customer content into coding work.

Repository boundary

Work only in C:\Dev\BoomerBuddy on a codex/ branch. Edit feedback/domain/persistence/worker/HQ code, smallest affected product files, tests, and docs/post-launch-beta. Read nested AGENTS.md. Do not use reference/boomerbuddy-v1, production content, PII, or secrets.

Required reading

Read AGENTS.md; EXECUTION-PLAN.md and supplement; OFFER-HYPOTHESIS-REGISTRY.md as the controlling annual, Individual, and referral hypothesis index; G10; FEEDBACK-LEARNING-SYSTEM.md; privacy/retention/operations; feedback contracts/repositories/API/worker/HQ/web/mobile; auth/security/redaction; automation budgets; tests.

Allowed actions

Use synthetic feedback to implement consent, minimization, quarantine, classification, severity, owner, acceptance criteria, content-free issue link, regression, review, canary, rollback, retention, withdrawal, and outcome receipts. For real feedback, use only approved minimized summary or opaque ID.

Forbidden actions

Do not copy raw feedback/artifacts/PII/contact into prompts/issues/tests. Do not auto-contact, auto-publish, auto-deploy protected changes, infer support consent, or retain beyond policy. Twilio stays disabled.

Parallel workstreams

Consent/minimization; severity/triage; issue/test; isolated coding; security/accessibility/product review; release/rollback; retention/audit.

Evidence gates

A synthetic trace proves all transitions/access. Severity/acceptance are reviewable. Coding gets minimized context. One regression reproduces; fix is bounded; full gates pass; canary/rollback exist; withdrawal/retention work. Safety/legal/payment/auth/privacy/accessibility route to accountable review.

Tests

Run feedback auth/tenant/consent/withdrawal/retention/quarantine, minimization/redaction, issue link, regression, full verify, staging E2E, audit, canary, forced rollback, and Git/evidence checks. No live fetching/credentials.

Commit, tag, and release policy

Separate loop infrastructure from fixes. No tag/release without independent review and normal gates. Never auto-release protected modules.

Founder-only stop conditions

Stop the affected lane for raw feedback outside its approved system, unconsented follow-up, unresolved safety adjudication, qualified legal or privacy interpretation, payment, authentication, security, retention, release, or communication ambiguity. Standing authorization does not convert those unknowns into evidence.

Rollback

Disable lane, quarantine affected items, preserve audit, revert compatible fix, use manual triage.

Verifiable completion

Complete when one sanitized trace reaches verified fix/rollback, privacy/authority tests pass, and no raw content leaves boundary.

Durable goal

Use one durable goal for one feedback-to-code trace, omitting token budget unless supplied. Complete after gates; blocked only after three repeated blocker turns.
```

## G12 - Content, landing-page, and video loop

```text
Objective

Build a source-backed, human-reviewed content and landing workflow explaining BoomerBuddy and Family USD 14.99 monthly without publishing, spending, unsupported claims, PII, or filler.

Repository boundary

Work only in C:\Dev\BoomerBuddy. Edit approved web/content tooling, tests, and docs/post-launch-beta on codex/ branch. Do not edit reference/boomerbuddy-v1, provider accounts, campaigns, customer data, secrets, or legacy boomerbuddy.net.

Required reading

Read AGENTS.md; EXECUTION-PLAN.md and supplement; OFFER-HYPOTHESIS-REGISTRY.md as the controlling annual, Individual, and referral hypothesis index; G3/G10; brand, price, content, accessibility, fraud, support, privacy, acquisition, editorial docs; landing/pricing/trust; approved offer/legal/support; content governance/tests; current official platform/FTC guidance.

Allowed actions

Create a claims-source map, brief, owner-recording script, transcript workflow, accessible article, video, and landing previews, captions, alt text, metadata, performance budget, consented aggregate analytics plan, correction and expiry rules, and review checklist. Use synthetic examples and plain language. Annual, Individual, and referral registry hypotheses remain absent from customer previews.

Forbidden actions

Do not publish, upload, send, or buy before the publication scope gates pass; use any person's likeness or testimonial without permission; fabricate outcomes; mass-produce duplicates; guarantee safety; scrape restricted sources; collect leads without consent; or enable Twilio. Do not imply one household proves market rate.

Parallel workstreams

Claims/sources; landing; video/captions; accessibility/performance; analytics/consent; editorial; correction/rollback.

Evidence gates

Every claim maps to dated primary source/product fact. Preview states monthly price, recurrence, limits, support, privacy, no-URL-fetch. No PII, prohibited dash, vague attribution, dev text, annual, Individual, referral offer, or unsupported result. Owners named.

Tests

Run source/staleness, copy/dash, accessibility, keyboard, responsive, performance, metadata, consent, PII/secret, screenshots, full affected verify, and Git checks. No publication/tracking.

Commit, tag, and release policy

Commit previews and evidence in scoped reviewed commits. No publication, campaign, tag, deployment, or upload without editorial, exact-target, release, rights, data-boundary, and rollback gates.

Founder-only stop conditions

Standing authorization covers truthful content work and scoped publication. Stop on an unsubstantiated claim, missing likeness or testimonial permission, price or policy mismatch, unbounded paid tool, unapproved analytics data boundary, wrong external account, rights issue, or unresolved legal or endorsement requirement.

Rollback

Remove/disable preview, invalidate stale claims, preserve correction log, restore prior approved page.

Verifiable completion

Complete when one accessible packet passes claims/copy/performance/consent/removal and remains unpublished.

Durable goal

Use one durable goal for one packet, no token budget unless supplied. Complete after gates; blocked only after three repeated blocker turns. Stop before publish/spend.
```

## G13 - Measured acquisition and lead generation

```text
Objective

Prepare and run one bounded acquisition experiment only after its scope receipt proves the predeclared hypothesis, lawful and consented lead handling, complete cost and funnel evidence, hard stops, and rollback. A warm first household is not channel proof.

Repository boundary

Work only in C:\Dev\BoomerBuddy. Edit approved attribution/growth/HQ code, tests, experiment docs, and landing variants on codex/ branch. Do not inspect address books, scrape, use reference/boomerbuddy-v1, expose PII/secrets, or touch legacy boomerbuddy.net.

Required reading

Read AGENTS.md; EXECUTION-PLAN.md and supplement; OFFER-HYPOTHESIS-REGISTRY.md as the controlling annual, Individual, and referral hypothesis index; G10-G12; first-cohort, acquisition, automation-budget, content, pricing, privacy, support, business-OS docs/code/tests; approved cash cap; consent; official platform policies.

Allowed actions

Define channel, audience basis, creative, landing, eligibility, consent, attribution, sample/window, spend/day caps, qualified and settled events, CAC ceiling, support capacity, retention/deletion, stop rules. Use aggregate content-free metrics. Research/draft without contact/spend until approved.

Forbidden actions

Do not scrape/enrich/buy lists/import contacts, contact leads, launch ads, publish, spend, raise/reset caps, retry unknown effects, put PII in Git, promise results, or enable Twilio without separate authority. Do not place an annual, Individual, or referral registry hypothesis in external creative, landing copy, acquisition, or referral activity.

Parallel workstreams

Hypothesis/creative; landing/attribution; consent/privacy; budget; support; analytics/reconciliation; claims; stop/rollback.

Evidence gates

One falsifiable cell, denominator, reserved budget, immutable cap, accepted-effect/cost reconciliation, consented lead path, support capacity, stops for privacy, claim, restriction, attribution, unknown spend, no outcome, refund/dispute, safety.

Tests

Run attribution/idempotency, budget reserve/recheck/overrun, unknown outcome, consent/suppression, accessibility/performance, claims/copy, aggregate metrics, provider failure simulation, rollback, full verify, Git checks. No spend test.

Commit, tag, and release policy

Use normal reviewed code gates. Activation, publication, outreach, and spend each require their own exact-target receipt, data boundary, cost cap, stop conditions, and rollback. Never auto-scale; reconcile one cell first.

Founder-only stop conditions

Standing authorization covers one bounded acquisition experiment after its receipt, data boundary, and rollback pass. Stop on an unsupported audience or claim, wrong account, unbounded spend, missing publication or outreach basis, cap failure, PII exposure, terms mismatch, refund or dispute ambiguity, unreconciled result, or unmet continuation and scale threshold.

Rollback

Pause draft/campaign, preserve cost/consent, disable variant, honor suppression/deletion, reconcile unknown state before retry.

Verifiable completion

Complete when the packet and dry run pass; if run live, complete only after spend and funnel evidence reconcile and the accountable growth owner records the decision.

Durable goal

Use one durable goal per cell, no token budget unless supplied. Complete after predetermined evidence; blocked only after three repeated blocker turns.
```

## G14 - Credit-union co-brand and demo validation

```text
Objective

Prepare a reusable, isolated, synthetic, unbranded-by-default credit-union co-brand demo and validation packet without claiming a relationship, using real marks, contacting prospects, or creating forks.

Repository boundary

Work only in C:\Dev\BoomerBuddy. Edit bounded theme/config/demo/partner-reporting code, tests, and docs/post-launch-beta on codex/ branch. Do not use reference/boomerbuddy-v1, production/customer data, secrets, providers, or legacy boomerbuddy.net.

Required reading

Read AGENTS.md; EXECUTION-PLAN.md and supplement; OFFER-HYPOTHESIS-REGISTRY.md as the controlling annual, Individual, and referral hypothesis index; G12-G13; credit-union, B2B/B2B2C, partner, pricing, white-label, security/privacy, demo, accessibility, tenancy, entitlement, support docs/code/tests; relevant ADRs; official NCUA/Google guidance.

Allowed actions

Build config-based synthetic demo with obvious label, reset/expiry, no billing/outbound/production data, generic branding, tenant/entitlement isolation, small-cell suppression, aggregate reporting, data flow, security packet, implementation/support scope, pilot hypothesis, removal plan.

Forbidden actions

Do not use real institution name/logo/domain/data/endorsement/relationship without written permission. Do not contact/enrich/propose/sign/deploy/fork/enable Twilio or imply monitoring/certainty. Do not put an annual, Individual, or referral registry hypothesis into a partner price, proposal, or external demo claim.

Parallel workstreams

Theme/config; demo/reset; tenant/auth/security; reporting/privacy; accessibility; support/implementation; evidence packet; cleanup.

Evidence gates

The demo is synthetic, expiring, resettable, labeled, no-charge, no-send, and isolated. Tenant crossover, raw export, small-cell leakage, unsupported branding, and partner forks fail closed. Real branding is impossible without permission held by the rights owner.

Tests

Run tenant/auth/entitlement isolation, reset/expiry, no-outbound/billing, synthetic-only, small-cell/export, accessibility/performance, theme fallback, secret/PII, teardown, full verify, Git checks.

Commit, tag, and release policy

Commit reusable configuration and tests in reviewed commits. No public deployment, outreach, proposal, branding use, tag, or commitment without exact-target, rights, account-holder, release, and rollback evidence.

Founder-only stop conditions

Research and prototype work may continue under standing authorization. Stop before naming or contacting a real organization without a lawful basis, using a trademark without permission, making a price or proposal commitment, accepting a contract or provider agreement for the account holder, deploying to a wrong target, sharing protected evidence, or accepting an unreviewed bespoke requirement.

Rollback

Disable/remove demo route/config, expire access, verify teardown, preserve non-PII evidence, leave production core.

Verifiable completion

Complete when unbranded demo/packet pass isolation/accessibility/teardown/no-claim and no institution was represented/contacted.

Durable goal

Use one durable goal for reusable synthetic demo, no token budget unless supplied. Complete after gates; blocked only after three repeated blocker turns. Stop before real branding/outreach.
```

## G15 - Governed autonomous operating cadence

```text
Objective

Establish a safe 30-day cadence and autonomy matrix for internal observation, testing, drafting, triage, release evidence, and bounded actions, with budgets, audit, circuit breakers, reconciliation, kill switch, and manual fallback. Earn autonomy one action class at a time.

Repository boundary

Work only in C:\Dev\BoomerBuddy. Edit bounded business-OS, worker, automation policy/budget, observability, HQ, tests, and docs/post-launch-beta on codex/ branch. Do not use reference/boomerbuddy-v1, customer PII/raw artifacts, secrets, live credentials in tests, or legacy boomerbuddy.net.

Required reading

Read AGENTS.md; EXECUTION-PLAN.md and supplement; OFFER-HYPOTHESIS-REGISTRY.md as the controlling annual, Individual, and referral hypothesis index; G10-G14; automation budgets; feedback, operations, release, incident, growth, support, finance, owner docs; ADR 0021/outbox/job/auth; business-OS automation; worker leases/retries; HQ approvals; observability/security; tests.

Allowed actions

Define action autonomy class, data, tool, cost, concurrency, schedule, freshness, approver, expiry, retry/idempotency, unknown-outcome, reconciliation, audit, circuit breaker, kill switch, rollback, fallback. Start with no-cost reversible health briefs, stale detection, tests, issue drafts, evidence. Dry-run providers synthetically.

Forbidden actions

Do not grant reusable credentials, content, autonomous outreach/publication/deploy/live billing/refund/dispute/bank/contracts/tax/legal/store/customer/cap/policy/Twilio authority. Do not grant any automation authority to promote or externally act on an annual, Individual, or referral registry hypothesis. Do not release reservations/retry unknown outcomes before reconciliation.

Parallel workstreams

Policy matrix; budget; scheduler/concurrency; capability isolation; audit/reconciliation; kill switch; HQ approval; forced failures; manual fallback; cadence/metrics.

Evidence gates

Each enabled action is narrow, default-off, revocable, least-data/tool, capped, audited, idempotent, reconciled, human-owned. Dry runs prove success, duplicate, timeout, unknown accepted effect, overrun, stale evidence, collision, kill switch, outage, fallback. Agent cannot raise cap/change success/add tool/reset/approve itself.

Tests

Run deny-by-default, data/tool/cost/action caps, atomic reserve/recheck/commit/release, rolling periods, concurrency/lease, idempotency/replay, unknown outcome, provider failure, audit, kill switch, forced rollback, MFA/access, redaction, fallback, full verify, operator tabletop, Git checks.

Commit, tag, and release policy

Use one isolated reviewed commit per action class. Enable one class per scope-bound release. Protected and external actions never auto-release. Tag and deploy only with exact-SHA evidence, exact targets, caps, reconciliation, and rollback.

Founder-only stop conditions

Standing authorization is necessary but not sufficient for autonomous external effects. Stop on missing scope receipts, caps, credentials, policy, production target, communication basis, release evidence, refund or dispute authority, qualified legal or tax decision, store or contract account-holder step, incident owner, reconciliation, rollback, or earned evidence for autonomy expansion.

Rollback

Trip kill switch, stop new reservations/execution, reconcile accepted/unknown, drain/quarantine, restore manual owner, revert compatible code, preserve audit.

Verifiable completion

Complete when the autonomy matrix, cadence, dry runs, forced failures, kill switch, reconciliation, and fallback pass, with every external action bound by standing authorization, an exact scope receipt, objective prerequisites, caps, and rollback.

Durable goal

Use one durable goal per action class, never whole OS. Omit token budget unless supplied. Complete after gates; blocked only after same blocker repeats for three goal turns.
```

## Exact first prompt to run next

```text
Objective

Establish an exact, read-only baseline for the saved BoomerBuddy repository and the path from the deployed release to one safely onboarded paying household. Produce a dated evidence packet, blocker ledger, unknowns ledger, and Day 0 through Day 7 dependency map. Do not implement fixes in this phase.

Repository boundary

Work only in C:\Dev\BoomerBuddy. Confirm that this is the Git root before reading project files. Do not inspect Downloads, OneDrive, another checkout, another worktree, or reference/boomerbuddy-v1. Do not edit any file. Do not install dependencies. Do not use customer PII, production secrets, or raw submitted artifacts. Treat legacy boomerbuddy.net as out of scope and untouched.

Required reading

Read AGENTS.md; package.json; .env.example; docs/post-launch-beta/EXECUTION-PLAN.md if present; docs/post-launch-beta/OFFER-HYPOTHESIS-REGISTRY.md as the controlling annual, Individual, and referral hypothesis index; docs/run-3/00-EXECUTIVE-VERDICT.md; docs/run-3/01-RUN-3-FIRST-DOLLAR-GAUNTLET.md; docs/run-3/03-BASELINE-EVIDENCE.md; docs/run-3/FIRST-CUSTOMER-7-DAY-PLAN.md; docs/run-3/FOUNDING-HOUSEHOLD-PLAYBOOK.md; docs/run-3/STRIPE-FIRST-DOLLAR-RUNBOOK.md; docs/run-3/MOBILE-AND-STORE-READINESS.md; docs/run-3/OPERATIONS-PRIVACY-AND-RECOVERY.md; docs/run-3/TWILIO-CONSENT-AND-MESSAGING.md; docs/run-3-1/EXECUTIVE-VERDICT.md; docs/run-3-1/EXTERNAL-BETA-EVIDENCE.md; docs/run-3-1/FOUNDING-HOUSEHOLD-GO-LIVE.md; docs/run-3-1/REPLIT-ENVIRONMENT-MANIFEST.md; the relevant ADRs for identity, consent, entitlements, commerce, no-URL-fetch, outbox, and production Clerk binding; and the actual web, API, worker, HQ, mobile, configuration, persistence, integration, and test files reached by those documents. Read any nested AGENTS.md before inspecting that subtree.

Allowed actions

Use read-only Git, filesystem, search, package-script inventory, and source inspection. Verify root, origin, branch, HEAD, annotated tag target, worktree/index status, upstream relationship, and live remote HEAD if network access is explicitly available. Inventory current tests without changing dependency state. Use safe public GET requests or read-only provider inspection only when the relevant connection is already available and the action cannot reveal customer data. Label operator testimony, repository evidence, local automated evidence, deployed browser evidence, provider evidence, device evidence, and human evidence separately.

Forbidden actions

Do not edit, commit, branch, tag, merge, deploy, install, migrate, seed, sign in as a customer, create an account, contact anyone, create provider resources, alter DNS, change Clerk or Stripe, upload a build, send a message, spend money, or fetch a URL submitted to Check. Do not treat mocks, seeded identities, screenshots, or source design as genuine provider, device, customer, demand, or payment evidence.

Parallel workstreams

Run these read-only streams in parallel: repository/release baseline; member journey and accessibility audit; Stripe and entitlement audit; mobile and store audit; support/privacy/incident audit; security and auth-separation audit; editorial scan; and test/evidence inventory. One integrator must reconcile contradictions and duplicate findings.

Evidence gates

Record exact commands, timestamps, commit/tag identity, dirty-state before and after, and file/line or symbol anchors for every launch-critical claim. Define Customer 1 completion across acquisition, customer Clerk account, direct consent, household roles, orientation, one useful Check, optional deliberate Trusted Circle action, Family USD 14.99 monthly payment, canonical entitlement, receipt, support, feedback, and authorized follow-up. Classify each gap P0, launch-critical P1, other P1, or P2. Mark unknown facts as unknown and assign an owner and closure gate.

Tests

Do not install or repair dependencies. If the pinned graph is already present and the worktree can remain clean, run the existing read-only-safe checks that do not mutate provider state: typecheck, lint, format check, unit/integration/security tests, builds, and E2E where their prerequisites already exist. Capture failures exactly. Run a source scan for U+2013 and U+2014 across customer web, HQ, mobile, emails, templates, fixtures, and store copy. Confirm no test reaches live URLs or production providers.

Commit, tag, and release policy

No commit, branch, tag, merge, deployment, release, provider write, or production change is allowed in this read-only phase. Create a documentation artifact only when the active task explicitly includes it.

Founder-only stop conditions

Standing authorization is already present. Stop only when a missing account-holder, qualified-professional, or customer decision changes launch geography, tax treatment, refund or cancellation terms, provider identity, consent, payment action, or legal or business posture. Record the unknown and continue unrelated read-only work.

Rollback

No state should change. If a supposedly read-only command creates a local artifact, stop, identify it precisely, and restore only that artifact without disturbing pre-existing work. Never use a destructive broad reset.

Verifiable completion

Complete only when the evidence packet identifies the exact baseline, all P0 and launch-critical P1 blockers with code anchors, all external unknowns with owners and closure gates, a web-first Day 0 through Day 7 dependency map, the mobile P0 parallel lane, and a no-write attestation. Git status must match the starting status.

Durable goal

Use one durable goal for this phase: produce a source-anchored launch baseline and stop when every launch-critical claim has an evidence class, owner, severity, and closure gate. Do not combine implementation with this goal.
```
