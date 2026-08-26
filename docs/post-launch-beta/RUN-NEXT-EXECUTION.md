# Exact execution prompt to run next

```text
Objective

Take BoomerBuddy from the completed post-launch audit to a tested, release-ready first-customer candidate as quickly as safety permits. Work autonomously through member golden-path hardening, editorial cleanup, mobile P0 readiness, billing readiness, beta operations, and a synthetic first-customer rehearsal. Use parallel agents and keep generating bounded follow-up tasks until the candidate passes or reaches a genuine objective closure gate. Do not contact or charge a real customer in this task.

Repository boundary

Work only in the saved local project C:\Dev\BoomerBuddy. Never inspect Downloads, OneDrive, another checkout, another worktree, or another repository. Begin read-only. Verify the Git root, origin, branch, HEAD, annotated tag target, worktree/index status, and live upstream synchronization. The audited production release is 9b5d585e89e4a691a113b9cd4264c1edbb3cdfdf with annotated tag run3-1-replit-founding-household-9b5d585e89e4. Preserve all existing user work and the untracked docs/post-launch-beta planning artifacts. Stop on an unexpected repository or overlapping dirty state. Never touch legacy boomerbuddy.net.

Required reading

Read AGENTS.md and every applicable nested AGENTS.md. Read docs/post-launch-beta/README.md, EXECUTION-PLAN.md, EXECUTION-PLAN-SUPPLEMENT.md, OFFER-HYPOTHESIS-REGISTRY.md, GAUNTLET-PROMPT-PACK.md, and GAUNTLET-PROMPT-PACK-G4-G15.md. Treat the integrated base plan as authoritative, the supplement as its audit receipt, and the offer registry as controlling for annual, Individual, and referral hypotheses. Execute the intent of G2, G3, G4, G5, G6, G7, and G8. Read the product, architecture, security, consent, Run 3, Run 3.1, mobile, Clerk, Stripe, persistence, worker, testing, deployment, backup, restore, incident, support, feedback, accessibility, growth, and automation documents and the relevant code/tests. Do not import from reference/boomerbuddy-v1.

Allowed actions

Create a codex/ branch after the baseline is verified. Preserve the planning artifacts and make small reviewable commits when a coherent phase passes. Install only the lockfile-pinned dependency graph if needed. Add regression tests first, implement the smallest production-capable changes, run local services and synthetic databases, use approved test or sandbox environments, and use the Browser skill for public, local, staging, and authorized synthetic-session testing. Build signed internal mobile artifacts only after account, identifier, credential-custody, and cost gates pass. Use Stripe sandbox resources and authentic signed events only after a read-only preflight confirms test context. Research time-sensitive facts from primary sources. Update runbooks and evidence without PII or secrets.

Business and product decisions

The first offer is Family at USD 14.99 monthly for one household. No annual, Individual, or referral offer exists in production. Their registry entries may be evaluated only with synthetic data or in Stripe sandbox and may not reach production configuration, customer copy, live provider resources, or external action. Do not add a trial, coupon, referral credit, adaptive pricing, native purchase, or another paid tier. The first payment remains web-first. Mobile is a parallel P0 safety surface and must reach production customer-Clerk authentication, signed internal iOS and Android builds, and physical-device evidence if the required accounts are available. Use net.boomerbuddy.app unless a verified provider collision stops for the founder. Keep separate customer and HQ Clerk realms and audiences. HQ remains private, founder-bound, and recent-MFA protected. Keep Twilio disabled. Check analysis must never fetch a submitted URL. Customer-facing and HQ copy may not contain U+2013 or U+2014.

Forbidden actions

Do not modify production, deploy, change DNS, create or change live Stripe resources, enable live Checkout, charge or refund anyone, contact or invite a real customer, create a real customer account, accept consent, enter payment details, publish content, launch ads, spend money, submit a store build for public review, accept provider agreements, enable Twilio, add Twilio credentials, make a Marketplace purchase, make an external commitment, or reveal secrets or customer data. Do not use a Payment Link, manual invoice, SQL entitlement, dashboard-only shortcut, or browser redirect as payment truth. Do not weaken auth, tenant, consent, privacy, no-URL-fetch, reconciliation, accessibility, or rollback controls to meet the schedule.

Parallel workstreams

Run one integrator plus bounded parallel agents for: (1) member web and founder-only billing authority, (2) editorial/legal/support routes and automated dash enforcement, (3) mobile auth/session/device safety, (4) EAS and internal distribution readiness, (5) live-capable but default-off Stripe architecture and authentic sandbox lifecycle, (6) worker/reconciliation/HQ controls, (7) support/incident/backup/restore/observability, and (8) cross-browser, accessibility, security, and adversarial review. Agents may spawn narrower agents. Coordinate shared contracts and migrations through the integrator. Keep each agent on one coherent objective and require tests, evidence, rollback, and a stopping condition.

Evidence gates

Distinguish repository design, local automation, deployed browser, authentic provider, signed-device, founder, and genuine customer evidence. Close every P0 and launch-critical P1 in the execution plan or record a no-go. Prove customer/HQ separation, exact household authority, direct consent, orientation, one useful Check and independently verified safer action, history/return, support, paid-feedback eligibility, canonical Checkout plus separate invoice-paid entitlement, receipts, cancellation, payment recovery, refunds/disputes, webhook replay/order/ambiguity, inventory, worker restart, alert receipt, backup/restore, and rollback. No live resource or customer action may substitute for missing sandbox, staging, browser, or device evidence.

Tests

Fix the five known Buffer lint errors first with regression or configuration evidence. Run targeted tests after each change, then npm run verify and npm run test:e2e from a clean lockfile-pinned graph. Add Chromium, Firefox, WebKit, responsive, keyboard, axe, zoom, and human-review gates. Add native component and black-box tests plus physical VoiceOver/TalkBack and failure-mode evidence. Run wrong-realm, cross-tenant, stale-MFA, replay, concurrency, consent withdrawal, URL-egress, payment lifecycle, provider ambiguity, backup/restore, incident, rollback, secret, PII, dependency, permission-manifest, and copy/dash checks. Do not auto-fix dependency advisories. Independently review every auth, billing, migration, privacy, fraud, safety, and release change.

Commit, tag, and release policy

Use short imperative commits on the codex/ branch, one coherent change with its regression. Do not mix unrelated feedback or refactors. Do not merge, deploy, create a release tag, write live provider state, or contact the customer in this task. At completion, produce one exact candidate SHA and a GO, NO-GO, or REMEDIATE packet. A later G9 task may tag and deploy only after founder approval and all external closure gates.

Founder-only stop conditions

Stop the affected external lane for launch geography, tax/legal/accounting treatment, final terms/refund/cancellation/support promise, exact live Stripe resource writes, production secret custody, deployment, live charge/cohort cap, Apple/Google/Expo/Clerk agreements and account ownership, signing-key recovery, identifier collision, store declarations/submission, customer identity/contact/consent/payment, physical purchase/meetup, public claims, outreach, spend, refund/dispute, or incident communication. Continue all safe local and synthetic work in parallel. Do not ask broad questions that repository evidence can answer.

Rollback

Keep new external effects at zero. Make schema changes forward-only and backward compatible. Put live initiation and new automation behind default-off controls. Revert only isolated compatible commits. For any auth, privacy, payment, or safety regression, disable the affected feature, preserve evidence and support, keep webhook/reconciliation paths intact, and return to the last verified release without disturbing unrelated user work.

Verifiable completion

Complete only when one exact candidate SHA has a green full verification gate, complete synthetic member and first-payment rehearsals, authentic Stripe sandbox evidence, deployed or staging browser evidence, signed-device evidence or explicit provider-account blocker, support/incident/restore/rollback receipts, zero prohibited dashes in source and rendered frontend copy, no unresolved P0 or launch-critical P1, and an ordered list of the exact founder/customer actions remaining before G9. Do not declare success merely because time or context is low.

Durable goal

Create one durable goal: produce an exact-SHA, independently reviewed, rollback-ready first-customer release candidate with the web payment path and mobile P0 lane proven, stopping before production deployment, live provider writes, customer contact, consent, or payment. Do not set a token budget unless the founder explicitly supplies one. Validate continuously and mark blocked only after the same genuine blocker repeats for three consecutive goal turns.
```
