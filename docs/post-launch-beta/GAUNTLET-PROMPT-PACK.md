# BoomerBuddy Post-Launch Beta Gauntlet Prompt Pack

Status: Standalone execution prompt pack

Evidence baseline: 2026-08-24

Audited release: `9b5d585e89e4a691a113b9cd4264c1edbb3cdfdf`

Annotated release tag: `run3-1-replit-founding-household-9b5d585e89e4`

## How to use this pack

Run one prompt at a time in order unless a prompt explicitly opens parallel work. Start every phase from current repository evidence, not from an earlier phase's summary. A phase may use subagents for the named parallel workstreams, but one agent must own integration and the final evidence packet.

Current authority note: the user has supplied standing authorization for in-scope repository,
provider-configuration, deployment, testing, and controlled-launch work. No additional subjective
founder phrase is required. For checklist compatibility, each phase retains its `Founder-only stop
conditions` heading; read it as the set of nondelegable human and external stop conditions. It still
stops an affected lane for direct customer consent or payment action, provider-required
account-holder identity or agreement steps, qualified legal or tax decisions, missing target access,
security or privacy failure, unbounded spend, missing evidence, or failed rollback. It does not stop
safe independent lanes or create a new approval ritual.

The launch path is web-first. Family at USD 14.99 per month for one household is the sole approved production offer candidate and is not live. [OFFER-HYPOTHESIS-REGISTRY.md](./OFFER-HYPOTHESIS-REGISTRY.md) controls every annual, Individual, and referral hypothesis, each of which is synthetic and Stripe sandbox only. No phase may copy one into production configuration, customer copy, live provider resources, or external action. Mobile is P0 work in parallel, but public store approval is not a condition for Customer 1. Use `net.boomerbuddy.app` as the proposed iOS bundle and Android package identifier unless an Apple, Google, Clerk, or Expo collision is found. A verified collision requires a recorded replacement decision and matching provider and repository evidence.

Twilio remains disabled until a later, separate consent and compliance gate covers sender registration, opt-out, suppression, quiet hours, delivery evidence, privacy, and incident handling. No phase in this pack authorizes Twilio credentials or traffic.

Never put customer PII, submitted artifacts, payment details, tokens, safe words, contact data, or provider secrets in Git, prompts, screenshots, logs, test fixtures, or general evidence. Use synthetic data or opaque evidence IDs. Customer-facing and HQ copy must not contain U+2013 or U+2014.

## Phase map

| Phase | Outcome |
| --- | --- |
| G0 | Explore and baseline |
| G1 | Founder decisions and launch control |
| G2 | Member golden-path hardening |
| G3 | Editorial and copy cleanup |
| G4 | Mobile auth, device, and native safety readiness |
| G5 | Mobile distribution and store readiness |
| G6 | Billing and first-payment readiness |
| G7 | Beta operations and support readiness |
| G8 | First-customer rehearsal |
| G9 | Live first-customer onboarding |
| G10 | Post-onboarding observation and iteration |
| G11 | Safe feedback-to-code loop |
| G12 | Content, landing-page, and video loop |
| G13 | Measured acquisition and lead generation |
| G14 | Credit-union co-brand and demo validation |
| G15 | Governed autonomous operating cadence |

## G0 - Explore and baseline

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

## G1 - Founder decisions and launch control

```text
Objective

Turn unresolved business choices into a single evidence-backed launch-control record without changing product, provider, production, or customer state. Freeze the smallest safe Customer 1 envelope and the authority boundaries for later phases.

Repository boundary

Work only in C:\Dev\BoomerBuddy. Read and, if explicitly authorized, edit only planning files under docs/post-launch-beta. Do not edit application code, tests, migrations, configuration, secrets, or reference/boomerbuddy-v1. Do not inspect any other checkout or personal folder. Use no customer PII.

Required reading

Read AGENTS.md; the completed G0 evidence packet; docs/post-launch-beta/EXECUTION-PLAN.md and any supplement; docs/post-launch-beta/OFFER-HYPOTHESIS-REGISTRY.md as the controlling annual, Individual, and referral hypothesis index; docs/FOUNDER-DECISIONS.md; docs/run-3/FIRST-CUSTOMER-7-DAY-PLAN.md; docs/run-3/FOUNDING-HOUSEHOLD-PLAYBOOK.md; docs/run-3/STRIPE-FIRST-DOLLAR-RUNBOOK.md; docs/run-3/FOUNDER-PROVISIONING.md; docs/run-3/OPERATIONS-PRIVACY-AND-RECOVERY.md; docs/run-3/MOBILE-AND-STORE-READINESS.md; docs/run-3/TWILIO-CONSENT-AND-MESSAGING.md; docs/gauntlet-zero/15-commercial-model-pricing.md; docs/gauntlet-zero/23-customer-success.md; and the G0 unknowns and founder-gate tables.

Allowed actions

Draft a decision record with explicit approve, reject, defer, owner, date, evidence, and review fields. Recommend one launch geography; Family at USD 14.99 monthly; no trial, coupon, promotion, referral credit, adaptive price, annual purchase, Individual purchase, or mobile purchase; one household; web-first checkout; mobile P0 in parallel; Twilio disabled; a maximum one live initiation window; and `net.boomerbuddy.app` unless collision. Annual, Individual, and referral entries remain registry-controlled sandbox hypotheses and cannot be promoted by this record. Draft plain recurring-charge, cancellation, refund, tax, receipt, support, privacy, and emergency-boundary language for qualified-professional and account-holder review where required. Keep candidate details in an approved account-holder system, not Git.

Forbidden actions

Do not invent legal or tax conclusions or impersonate the account holder. This phase is documentation-only: do not publish terms, invite or contact a customer, create a Stripe Product, Price, webhook, or Portal configuration, change payout settings, enable a provider, reserve a mobile identifier, accept store agreements, create EAS, Apple, or Google records, add secrets, deploy, or spend. A documentation commit is allowed only when the active task includes it. Do not infer consent or billing authority from kinship or payment.

Parallel workstreams

Prepare separate decision cells for offer and geography; tax/accounting; cancellation/refund and recurring disclosure; support hours/backup/incident command; privacy/legal URLs; Customer 1 eligibility/contact authority; Stripe live-write envelope; mobile identifier/account custody; release and rollback authority; and beta cash cap. Reconcile them into one launch-control record.

Evidence gates

Every launch-critical decision has one accountable human, an approval state, an effective date, an exact downstream action it authorizes, and a revocation/expiry rule. The record states that Family USD 14.99 monthly is the sole approved production offer candidate and is not live, all annual, Individual, and referral hypotheses remain sandbox-only under the offer registry, payment is web-first, mobile remains P0 in parallel, Twilio stays disabled, and no customer PII enters project evidence. Any undecided launch-critical cell remains a stop gate, not an assumption.

Tests

Run a consistency review against pricing, billing, support, privacy, mobile, and operating documents. Scan the decision record for blank owner/approval fields, contradictory amounts or intervals, U+2013/U+2014, customer PII, secret patterns, and language that implies a provider action occurred. No application tests are required because application code must not change.

Commit, tag, and release policy

If the active task includes a commit, use one concise documentation-only commit on a codex/ branch and include only docs/post-launch-beta files. Do not tag, merge, deploy, release, or perform provider writes in this phase.

Founder-only stop conditions

Standing authorization covers in-scope execution. Stop only the affected action until launch geography, qualified tax and legal decisions, recurring-charge disclosure, refund policy, support ownership, privacy publication, customer contact basis, charge and spend caps, provider custody, and any required account-holder attestation have objective evidence. Continue independent engineering and verification.

Rollback

Revert only the unapproved decision draft or later documentation commit. There should be no provider, production, or customer state to reverse.

Verifiable completion

Complete only when one internally consistent control record has no blank launch-critical field, bounds at most one household and one USD 14.99 monthly live initiation, keeps annual, Individual, and referral hypotheses sandbox-only, explicitly defers mobile purchase and Twilio, names every nondelegable customer, account-holder, qualified-professional, provider-access, evidence, and rollback stop, and confirms no external action occurred.

Durable goal

Do not use a durable goal. This is a short control-record phase. Resume the next engineering goal when every launch-critical decision has an accountable source and closure evidence; keep any unresolved dependent external lane stopped.
```

## G2 - Member golden-path hardening

```text
Objective

Make the mobile-responsive web path sufficient for one invited household to sign in through the customer Clerk realm, give direct consent, establish explicit household roles, complete orientation, perform one useful Check, optionally share a redacted result deliberately, reach support, initiate eligible Family USD 14.99 monthly billing, and return without relying on HQ credentials, Twilio, manual database edits, or customer PII in evidence.

Repository boundary

Work only in C:\Dev\BoomerBuddy on a dedicated codex/ branch created from a verified clean baseline. Edit only the smallest necessary files in apps/web, apps/api, packages/contracts, packages/domain, packages/authorization, packages/security, packages/persistence, tests, and docs/post-launch-beta. Read nested AGENTS.md before editing an app. Do not import from or edit reference/boomerbuddy-v1. Preserve legacy boomerbuddy.net untouched.

Required reading

Read AGENTS.md; G0 and G1 outputs; docs/post-launch-beta/OFFER-HYPOTHESIS-REGISTRY.md as the controlling annual, Individual, and referral hypothesis index; docs/run-3/FOUNDING-HOUSEHOLD-PLAYBOOK.md; docs/run-3/FIRST-COHORT-AND-DISCOVERY-WORKFLOW.md; docs/run-3/STRIPE-FIRST-DOLLAR-RUNBOOK.md; docs/run-3/OPERATIONS-PRIVACY-AND-RECOVERY.md; ADRs 0003, 0006, 0008, 0010, 0011, 0012, 0014, and 0030; apps/web/src/app/page.tsx; public Check, sign-in, member home, founding-household, orientation, family, Check, history, billing, feedback, and API proxy files; apps/api/src/auth.ts and relevant routes; packages/persistence/src/production-identity.ts; commerce and feedback repositories; and current integration/security/E2E tests.

Allowed actions

Add regression tests first, then implement the minimum coherent flow. Add a founder-only, recent-MFA, exact-household billing-authority grant/revoke control that is tenant-scoped, idempotent, audited, replay-safe, and not self-service. Add reachable support, privacy, terms, billing terms, accessibility, and account/privacy-control routes as approved content permits. Remove production dev/test/local contradictions. Fix focus, pending, recovery, and error states. Keep consent choices separate. Use synthetic identities and content only.

Forbidden actions

Do not grant billing authority from kinship, membership, payer status, or a browser redirect. Do not weaken separate customer/HQ issuers, audiences, cookies, origins, founder binding, or recent MFA. Do not fetch submitted URLs. Do not enable live Stripe, Twilio, public self-signup, external messaging, store billing, or automatic family alerts. Do not contact, impersonate, invite, charge, or enter data for a real customer. Do not put raw Clerk subjects into customer-facing instructions as the final workflow.

Parallel workstreams

Run bounded streams for auth and billing authority; member navigation and onboarding; Check/history/accessibility; Family/Trusted Circle authority; support/legal/account controls; paid-feedback eligibility; E2E and failure-mode evidence; and security review. Coordinate shared contracts and persistence changes through one integrator.

Evidence gates

New customer bootstrap creates only authorized membership/admin facts. Billing authority can be added and revoked only by the bound founder with recent MFA and exact subject/household confirmation. The web flow exposes one coherent offer and support path. A customer can complete the useful-action definition: run an actual Check, explain uncertainty and no-URL-fetch, and choose an independently verified safer action. Optional sharing remains direct-consent and redacted. Feedback works for eligible paid access or any temporary sponsored overlap is labeled precisely. All tenant, wrong-realm, stale-MFA, replay, concurrency, and revocation cases fail closed.

Tests

Add regression coverage for bootstrap without billing authority; founder grant/revoke; self-grant denial; wrong realm; cross-household; stale MFA; replay; concurrent requests; revoked authority; consent withdrawal; actual Check without URL fetch; non-shareable result focus; history/return; support/legal navigation; paid-feedback access; and all critical error states. Run targeted tests, then typecheck, lint, format check, unit/integration/security suites, builds, and cross-browser E2E including keyboard, axe, mobile viewport, 200 and 400 percent zoom, and session recovery. Keep production providers off.

Commit, tag, and release policy

Use small reviewed commits with one regression per fix. Do not tag or deploy from this phase. A later release candidate must bind the exact SHA, migrations, tests, browser evidence, backup, and rollback plan. Do not mix mobile distribution, content growth, or unrelated refactors into these commits.

Founder-only stop conditions

Do not wait for a new subjective approval. Stop the affected lane for missing production access, unapproved legal or support content, unresolved account-deletion or paid-feedback policy, unsafe migration evidence, auth-realm ambiguity, cross-tenant behavior, customer-data exposure, or a missing accountable qualified owner. Continue unrelated safe work.

Rollback

Keep schema changes forward-only and backward compatible. Define feature flags or initiation gates before release. Revert application commits only if migration compatibility is proved. If authorization behavior regresses, disable the new founder control and paid initiation while preserving customer access, webhook ingestion, evidence, and support.

Verifiable completion

Complete only when a fresh synthetic identity can traverse the entire web golden path, every required action has accessible recovery/support, all authority and no-URL-fetch tests pass, the exact SHA has clean full verification, and an independent reviewer finds no unresolved P0 or launch-critical P1 in this phase's scope.

Durable goal

Use one durable goal: deliver a production-capable, test-proven member golden path and stop only when the synthetic end-to-end contract and all auth/tenant/failure gates pass. Keep billing provider activation and real customer onboarding outside this goal.
```

## G3 - Editorial and copy cleanup

```text
Objective

Make all customer-facing web, HQ, mobile, support, email/template, and store copy plain, specific, accurate, accessible to older adults and families, and free of U+2013 and U+2014. Remove development leakage, contradictory offers, false certainty, vague claims, operator jargon, and unreachable promises without changing domain semantics.

Repository boundary

Work only in C:\Dev\BoomerBuddy on a dedicated codex/ branch after verifying the baseline. Edit only user-visible strings, supporting content/data files, focused copy tests, and docs/post-launch-beta evidence in apps/web, apps/hq, apps/mobile, packages/design, approved templates, and tests. Read nested AGENTS.md. Do not edit reference/boomerbuddy-v1. Do not change authorization, fraud scoring, retention, billing amounts, schemas, or provider behavior unless a separate reviewed defect proves the copy cannot be corrected safely without it.

Required reading

Read AGENTS.md; G0-G2 evidence; docs/post-launch-beta/OFFER-HYPOTHESIS-REGISTRY.md as the controlling annual, Individual, and referral hypothesis index; docs/BOOMERBUDDY-2.0-MASTER-SPEC.md; docs/run-3/EDITORIAL-INTELLIGENCE-BOARD.md; docs/run-3/BRAND-PRICE-REFERRAL-RESEARCH.md; docs/gauntlet-zero/04-brand-assessment.md; docs/gauntlet-zero/34-accessibility-senior-ux.md; every rendered route/component/template in scope; and https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing only as a descriptive heuristic. Review the approved offer, legal, support, safety, and no-URL-fetch decisions before rewriting them.

Allowed actions

Inventory source and rendered copy. Replace prohibited dashes with suitable ASCII punctuation. Rewrite local/dev/test language on production branches. Layer plain summaries before technical detail. State uncertainty, limitations, next action, price, recurrence, cancellation, refund, tax, receipt, support hours, and emergency boundaries exactly as approved. Add deterministic source and rendered checks. Maintain a human review log with before/after/rationale and no customer data.

Forbidden actions

Do not use an AI detector to ban ordinary words or score authors. Do not add puffery, inflated significance, vague attribution, forced rule-of-three copy, repetitive summaries, emoji structure, formulaic 'not just X but Y', unsupported safety claims, guaranteed detection, 24/7 human support, background monitoring claims, or legal/tax conclusions. Do not change meaning merely to satisfy a scan. Do not publish or deploy in this phase.

Parallel workstreams

Run route-level streams for public/acquisition; member/onboarding/Check/history; billing/support/legal; HQ; mobile/store metadata; transactional templates; automated enforcement; and accessibility/plain-language review. One editorial owner resolves terminology and policy conflicts.

Evidence gates

The rendered production branch has one Family USD 14.99 monthly offer; no annual, Individual, or referral hypothesis; no development persona or test-checkout instruction; and no contradiction between pricing and billing. Safety copy never implies proof, passive surveillance, URL fetching, or emergency response. Technical terms are explained or moved behind progressive disclosure. Every U+2013/U+2014 result is zero in both source and rendered states. Human reviewers can trace each material change to a policy or usability reason.

Tests

Add a deterministic Unicode dash scan over frontend literals, metadata, templates, fixtures, email/support text, and mobile/store copy. Add rendered regression coverage for landing, pricing, trust, sign-in, Public Check result/save, member home, consent, orientation, Family, Check, history, billing and pending/success, feedback, support/legal, account controls, and HQ. Run axe, keyboard, screen-width, 200/400 percent zoom, text-spacing, reduced-motion, and copy snapshot tests. Run typecheck, lint, format check, affected tests, builds, and E2E.

Commit, tag, and release policy

Use small reviewable copy commits grouped by coherent surface, with automated regression updates in the same commit. No tag, merge, deployment, provider write, outreach, or publication is authorized. A future release packet must include rendered screenshots or text receipts from the exact SHA.

Founder-only stop conditions

Standing authorization covers truthful editorial work and publication after objective gates pass. Stop the affected claim for an unresolved price, recurring-charge term, refund policy, support promise, privacy or legal statement, safety substantiation, accessibility defect, rights issue, or unimplemented feature.

Rollback

Revert the smallest copy commit if meaning or accessibility regresses. Preserve the automated dash ban and regression harness unless they themselves are wrong. Never restore dev/test language to a production branch as a shortcut.

Verifiable completion

Complete only when source and rendered scans return zero prohibited dashes, all launch routes use the approved offer and support/legal facts, no reviewer finds an unsupported or operator-centric launch-critical statement, and the full relevant test/build suite passes at a clean exact SHA.

Durable goal

Use one bounded durable goal for the editorial pass. Stop when the complete launch-copy inventory is reviewed, automated enforcement is green, and every P0/launch-critical P1 copy issue is closed. Do not include growth content production in this goal.
```
