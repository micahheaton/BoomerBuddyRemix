# Exact first prompt to run next

```text
Objective

Establish an exact, read-only baseline for the saved BoomerBuddy repository and the path from the deployed release to one safely onboarded paying household. Produce a dated evidence packet, blocker ledger, unknowns ledger, and Day 0 through Day 7 dependency map. Do not implement fixes in this phase.

Repository boundary

Work only in C:\Dev\BoomerBuddy. Confirm that this is the Git root before reading project files. Do not inspect Downloads, OneDrive, another checkout, another worktree, or reference/boomerbuddy-v1. Do not edit any file. Do not install dependencies. Do not use customer PII, production secrets, or raw submitted artifacts. Treat legacy boomerbuddy.net as out of scope and untouched.

Required reading

Read AGENTS.md; package.json; .env.example; docs/post-launch-beta/README.md; docs/post-launch-beta/EXECUTION-PLAN.md; docs/post-launch-beta/EXECUTION-PLAN-SUPPLEMENT.md as its audit receipt; docs/post-launch-beta/OFFER-HYPOTHESIS-REGISTRY.md as the controlling index for annual, Individual, and referral hypotheses; docs/post-launch-beta/GAUNTLET-PROMPT-PACK.md for G0-G3; docs/post-launch-beta/GAUNTLET-PROMPT-PACK-G4-G15.md for G4-G15; docs/run-3/00-EXECUTIVE-VERDICT.md; docs/run-3/01-RUN-3-FIRST-DOLLAR-GAUNTLET.md; docs/run-3/03-BASELINE-EVIDENCE.md; docs/run-3/FIRST-CUSTOMER-7-DAY-PLAN.md; docs/run-3/FOUNDING-HOUSEHOLD-PLAYBOOK.md; docs/run-3/STRIPE-FIRST-DOLLAR-RUNBOOK.md; docs/run-3/MOBILE-AND-STORE-READINESS.md; docs/run-3/OPERATIONS-PRIVACY-AND-RECOVERY.md; docs/run-3/TWILIO-CONSENT-AND-MESSAGING.md; docs/run-3-1/EXECUTIVE-VERDICT.md; docs/run-3-1/EXTERNAL-BETA-EVIDENCE.md; docs/run-3-1/FOUNDING-HOUSEHOLD-GO-LIVE.md; docs/run-3-1/REPLIT-ENVIRONMENT-MANIFEST.md; the relevant ADRs for identity, consent, entitlements, commerce, no-URL-fetch, outbox, and production Clerk binding; and the actual web, API, worker, HQ, mobile, configuration, persistence, integration, and test files reached by those documents. Read any nested AGENTS.md before inspecting that subtree.

Allowed actions

Use read-only Git, filesystem, search, package-script inventory, and source inspection. Verify root, origin, branch, HEAD, annotated tag target, worktree/index status, upstream relationship, and live remote HEAD if network access is explicitly available. Inventory current tests without changing dependency state. Use the Browser skill for read-only public production inspection when it initializes safely. Use safe public GET requests or read-only provider inspection only when the relevant connection is already available and the action cannot reveal customer data. Label operator testimony, repository evidence, local automated evidence, deployed browser evidence, provider evidence, device evidence, and human evidence separately.

Forbidden actions

Do not edit, commit, branch, tag, merge, deploy, install, migrate, seed, sign in as a customer, create an account, contact anyone, create provider resources, alter DNS, change Clerk or Stripe, upload a build, send a message, spend money, or fetch a URL submitted to Check. Do not treat mocks, seeded identities, screenshots, or source design as genuine provider, device, customer, demand, or payment evidence. Treat every annual, Individual, and referral registry entry as synthetic or Stripe sandbox only, never as a production offer. Keep Twilio disabled.

Parallel workstreams

Run these read-only streams in parallel: repository/release baseline; member journey and accessibility audit; Stripe and entitlement audit; mobile and store audit; support/privacy/incident audit; security and auth-separation audit; editorial scan; and test/evidence inventory. One integrator must reconcile contradictions and duplicate findings.

Evidence gates

Record exact commands, timestamps, commit/tag identity, dirty-state before and after, and file/line or symbol anchors for every launch-critical claim. Define Customer 1 completion across acquisition, customer Clerk account, direct consent, household roles, orientation, one useful Check, optional deliberate Trusted Circle action, Family USD 14.99 monthly payment, canonical entitlement, receipt, support, feedback, and authorized follow-up. Classify each gap P0, launch-critical P1, other P1, or P2. Mark unknown facts as unknown and assign an owner and closure gate.

Tests

Do not install or repair dependencies. If the pinned graph is already present and the worktree can remain clean, run the existing read-only-safe checks that do not mutate provider state: typecheck, lint, format check, unit/integration/security tests, builds, and E2E where their prerequisites already exist. Capture failures exactly. Run a source scan for U+2013 and U+2014 across customer web, HQ, mobile, emails, templates, fixtures, and store copy. Confirm no test reaches live URLs or production providers.

Commit, tag, and release policy

No commit, branch, tag, merge, deployment, release, provider write, or production change is allowed. The phase output stays in the task response unless the founder separately requests a documentation artifact.

Founder-only stop conditions

Stop and ask the founder only when a missing choice changes launch geography, offer, tax treatment, refund/cancellation terms, support coverage, candidate eligibility, live-charge cap, permanent mobile identifier, provider-account ownership, or legal/business posture. Repository questions are not founder blockers until read-only evidence is exhausted.

Rollback

No state should change. If a supposedly read-only command creates a local artifact, stop, identify it precisely, and restore only that artifact without disturbing pre-existing work. Never use a destructive broad reset.

Verifiable completion

Complete only when the evidence packet identifies the exact baseline, all P0 and launch-critical P1 blockers with code anchors, all external unknowns with owners and closure gates, a web-first Day 0 through Day 7 dependency map, the mobile P0 parallel lane, and a no-write attestation. Git status must match the starting status.

Durable goal

Use one durable goal for this phase: produce a source-anchored launch baseline and stop when every launch-critical claim has an evidence class, owner, severity, and closure gate. Do not combine implementation with this goal and do not set a token budget unless the founder supplies one.
```
