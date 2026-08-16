# BoomerBuddy Build Run 1 — Independent Founder/Technical Review

**Review date:** 2026-08-16  
**Source reviewed:** `BoomerBuddy-BuildRun1.zip`  
**Reviewer posture:** independent review of the committed Run 1 archive, with emphasis on whether the foundation should be extended rather than rebuilt.

## Executive verdict

**Keep the foundation. Do not restart BoomerBuddy 2.0.**

The Build Run 1 report is directionally honest and the repository contains substantially more than a demo shell: four distinct application surfaces, centralized authorization, tenant-scoped persistence, a real SQL domain model, provider-neutral commerce/entitlement concepts, privacy-oriented artifact handling, deterministic fraud logic, evaluation scaffolding, audit/outbox foundations, and meaningful negative security tests.

The strongest result is architectural discipline. The system repeatedly separates identity, household membership, protected enrollment, entitlements, customer/HQ audiences, artifact ownership, and pairwise sharing rather than using a single `user/admin/premium` shortcut.

However, independent review found several issues that should materially change Run 2. None justify throwing the repository away. They do justify amending the Master Spec before another large autonomous build.

## What I independently verified

The archive contains 255 committed files, including:

- 63 files under `apps/`
- 81 files under `packages/`
- 15 files under `tests/`
- 80 files under `docs/`
- 125 TypeScript/TSX source files
- 33 tables in the initial PostgreSQL schema

Implemented surfaces include:

- Fastify API
- customer Next.js web app
- separate Next.js HQ app
- Expo/React Native mobile app
- shared domain/contracts/authorization/security/fraud/persistence packages
- integration, security, Playwright, accessibility, and evaluation test suites

The code backs up the report's major architectural claims:

- server-derived current authorization rather than trusting client role flags;
- customer, mobile, and HQ session audiences;
- selected-household validation;
- explicit object ownership and pairwise share checks;
- independent protected-person enrollment backed by entitlement allocation;
- AES-256-GCM encrypted artifact storage with contextual AAD;
- purpose/tenant-scoped keyed HMAC fingerprints;
- scrypt safe-word verifier storage;
- deletion/retention scrubbing;
- content-free audit/outbox events;
- provider-neutral subscription sources for web, Apple, Google, sponsor, support, and local development;
- production startup deliberately refused while Run 1 identity/KMS are development-only.

I did **not** independently reproduce `npm run verify` inside my review sandbox because dependency installation was unavailable in that environment. I inspected the test source and recorded Run 1 evidence, but the reported 99 unit / 18 integration / 16 security / 13 Playwright results should still be reproduced in clean CI during Run 2.

---

# Independent findings that should alter Run 2

## 1. The role model still has one important collapse: household owner vs Trusted Circle participant

**Priority: High architectural correction before expanding Family.**

The documentation says a person may hold several domain roles. The implementation fixed owner-plus-protected by separating protected enrollment from membership role, which was the right correction.

But `household_memberships` still stores exactly one role:

`household_owner | protected_member | trusted_circle`

and invitation acceptance explicitly rejects an existing membership whose role is not `trusted_circle` (`packages/persistence/src/family.ts`, around line 615).

Concrete consequence:

> A spouse who is already a household owner cannot also accept a Trusted Circle relationship for the other spouse in the same household.

That is a normal real-world family topology.

### Required Run 2 correction

Separate these concepts fully:

- household membership
- household administrative/owner authority
- protected-person enrollment
- Trusted Circle relationship
- payer/billing authority

Trusted Circle should be relationship-level authority, not an exclusive household membership role.

Add tests for:

- two spouses who are both protected;
- both spouses as household administrators;
- each spouse trusted by the other;
- adult child who is household payer/manager and also trusted by a parent;
- one trusted person supporting multiple protected people;
- revocation of one relationship without damaging unrelated roles.

---

## 2. The fraud-provider interface is too lossy for the future fraud system described in the Master Spec

**Priority: High before real intelligence or AI providers are integrated.**

`FraudProvider.inspect()` currently receives only a `FeatureVector`.

That vector includes:

- artifact kind;
- already-derived local signal names;
- byte-length bucket;
- a few URL structural booleans/counts.

It deliberately does **not** contain the actual normalized text, domain, URL, host, path, or another provider-usable artifact representation.

This makes the Run 1 local provider safe, but it also means a future provider cannot actually perform:

- domain reputation;
- URL reputation;
- brand/lookalike analysis;
- external threat-intelligence lookup;
- model reasoning over message language;
- organization/contact verification.

The current "provider-neutral" interface therefore needs redesign before live providers are added.

### Required Run 2 correction

Create an evidence-provider architecture with explicit data-access classes.

For example:

- `LocalSignalProvider`
- `DomainReputationProvider`
- `UrlReputationProvider`
- `MessageReasoningProvider`
- `VerifiedOrganizationProvider`

Each provider contract should specify:

- artifact classes it may receive;
- exact fields it may receive;
- whether data may leave BoomerBuddy;
- retention/training policy;
- timeout;
- freshness;
- provenance;
- cost;
- failure behavior;
- kill switch.

Do not solve this by handing every provider the raw artifact.

---

## 3. Restricted-input rejection is too aggressive for the core scam-response job

**Priority: High product correction.**

Run 1 rejects the entire submission when it recognizes:

- payment-card numbers;
- contextual one-time codes;
- authorization credentials;
- private keys.

That is privacy-conscious, but it can fail precisely when BoomerBuddy is most needed.

Example:

> "Your verification code is 482193. Read it back to me immediately."

A real scam message containing the actual six-digit code can be rejected before BoomerBuddy explains that sharing the code is dangerous.

The same issue can occur when a scam message contains a card number or other sensitive value.

The design documents permit **reject or redact**, but the implementation currently uses rejection.

### Required Run 2 correction

Implement transient secret extraction/redaction:

1. inspect the original artifact in bounded memory;
2. derive non-sensitive safety flags;
3. replace recognized secrets with typed placeholders, such as:
   - `[ONE_TIME_CODE]`
   - `[PAYMENT_CARD]`
   - `[AUTH_CREDENTIAL]`
4. analyze the redacted representation;
5. persist only the redacted/minimized version when persistence is justified;
6. never send the original secret to external AI/intelligence providers;
7. show the user that a sensitive value was removed for their protection.

Hard rejection should remain for artifact classes that cannot be made safe.

---

## 4. `lower_concern` is currently unreachable

**Priority: Medium product/semantic correction.**

The public risk taxonomy contains:

- `lower_concern`
- `caution`
- `high_concern`
- `unknown`

But the current scoring code resolves:

- score >= 50 → `high_concern`
- score > 0 → `caution`
- score == 0 → `unknown`

No path returns `lower_concern`.

This may be intentional conservatism, but if so the unused state should not be presented as part of the working taxonomy.

### Required Run 2 decision

Either:

A. remove `lower_concern` until enough affirmative evidence exists to support it, or

B. define the evidence threshold for a truthful "lower concern" outcome.

"Provider did not find it" alone should not establish safety.

---

## 5. The authoritative Master Spec became narrower than the founder's stated Business OS vision

**Priority: High strategic-documentation correction before another autonomous run.**

The detailed Gauntlet documents correctly preserve ideas such as:

- CRM graph;
- target-account sourcing;
- opportunity lifecycle;
- stale-opportunity workflow;
- revenue operations;
- customer success;
- owner command center;
- people/workforce controls;
- finance integrations;
- channel strategy.

But the authoritative Master Spec compresses HQ into a much smaller statement and explicitly says it is not a full CRM.

The "do not rebuild commodity SaaS" decision is correct.

The risk is different:

> Future agents reading the Master Spec as the authority may interpret the founder's long-term Business OS as unwanted scope and optimize it away.

### Required Run 2 correction

The Master Spec should distinguish:

**BoomerBuddy-owned Business OS**
- customer/household graph
- sponsor/partner graph
- safety and activation context
- leads/accounts/opportunities
- next actions/tasks
- onboarding/orientation
- support/fraud work queues
- subscription/entitlement truth
- attribution
- partner/member adoption
- owner intelligence

from:

**External systems of record**
- payroll
- tax filing
- bank ledger
- accounting GL
- bulk contact databases
- commodity email transport
- generic ATS functionality

HQ remains the control plane across both.

---

## 6. The highest-leverage acquisition loop is designed but absent from Run 2's recommended scope

**Priority: High commercial correction.**

The Master Spec correctly notes that a future anonymous Check can be ephemeral and history-free.

That capability is important for more than convenience.

It is the likely top-of-funnel:

`search/social/referral → suspicious artifact → useful Check → account/family conversion`

Run 1 requires development sign-in before checking, which is appropriate for the bounded local build.

The proposed Run 2 does not make the public ephemeral Check a first-class deliverable.

### Required Run 2 correction

Build a privacy-bounded public Check:

- server-minted anonymous context;
- no durable artifact history;
- strong rate/abuse controls;
- transient analysis;
- explicit data handling;
- optional result save only after account creation and consent;
- attribution event that contains no submitted content;
- conversion into orientation/Family without re-submitting secrets.

This is both a product feature and the consumer acquisition engine.

---

## 7. The strongest V1 knowledge assets have not yet become 2.0 assets

**Priority: High strategic/moat correction.**

Gauntlet Zero identified V1's taxonomy and source registries as valuable.

The new runtime does not yet contain a real scam taxonomy. Its implemented fraud domain currently consists mainly of a small deterministic signal vocabulary and twelve synthetic evaluation cases.

That is fine for Run 1.

It is not fine if those V1 assets remain reference-only indefinitely.

### Required Run 2 correction

Create a governed migration/curation workstream that converts useful V1 knowledge into versioned 2.0 assets without copying V1 runtime architecture.

Targets include:

- scam-family taxonomy;
- attack-technique taxonomy;
- channel taxonomy;
- safe-action mappings;
- recovery mappings;
- source registry;
- jurisdiction/source provenance;
- educational explanation primitives.

Every imported item should have:

- source/provenance;
- review state;
- version;
- active/deprecated status;
- intended product use.

This is also the beginning of a proprietary intelligence asset that can compound over time.

---

## 8. Commerce architecture is one of Run 1's strongest pieces, but it needs a real sandbox transaction in Run 2

**Priority: High commercialization milestone.**

The schema already distinguishes:

- web;
- Apple;
- Google;
- sponsor;
- support;

and normalizes access through BoomerBuddy entitlements instead of trusting a provider status directly.

Keep this.

Run 2 should prove at least one real commerce path in **test/sandbox mode**, preferably Stripe first:

`checkout/test transaction → signed provider event → idempotent inbox → normalized subscription → entitlement grant → allowance → application access → cancellation/reconciliation`

No real customer charge is necessary to prove this.

Apple/Google provider contracts can follow the same canonical entitlement layer.

---

## 9. HQ is a good security boundary but still a shell, not the company operating system

**Priority: Expected, not a Run 1 defect.**

Current HQ proves:

- separate audience;
- separate application;
- owner/reviewer roles;
- household summaries;
- analysis metadata;
- provider health;
- audit events;
- seeded target accounts/opportunities.

It does **not** yet implement the workflows the founder ultimately needs:

- real contacts/leads;
- activities;
- next-action engine;
- follow-up queue;
- campaign attribution;
- partner programs;
- customer success;
- support cases;
- fraud-review cases;
- orientation intervention;
- staff queues;
- finance reconciliation views.

This is exactly the right point to begin building those capabilities on the secure boundary now established.

---

# What should NOT change

Do not discard these Run 1 decisions:

1. modular monolith;
2. separate customer and HQ audiences;
3. server-side object authorization;
4. independent protected enrollment;
5. pairwise sharing;
6. provider-neutral entitlement truth;
7. transactional outbox pattern;
8. PostgreSQL as canonical persistence model;
9. truthful unknown/unavailable provider states;
10. short/raw-artifact retention discipline;
11. evaluation as a release gate;
12. production refusal while security dependencies are fake/local.

These are good foundations.

---

# Recommended Run 2 mission

Rename the next phase conceptually:

# **Run 2 — Commercialization Foundation**

Do not make Run 2 only a research exercise.

Run user/commercial validation in parallel with engineering.

The build should have the following workstreams:

## A. Correct the domain foundation

- multi-role household topology;
- append-only/versioned consent evidence;
- identity-bound invitations;
- invitation expiry cleanup;
- idempotency;
- canonical permission vocabulary.

## B. Production-like platform

- real managed identity in staging;
- customer/HQ MFA/step-up design;
- managed PostgreSQL staging;
- managed encryption/KMS design;
- durable jobs/outbox/retention;
- observability;
- backup/restore;
- privacy export/erasure;
- rate/abuse control.

## C. Fraud Intelligence 2

- redesign provider contracts;
- migrate/curate V1 taxonomy and source registry;
- first live reputation/intelligence provider in a controlled environment;
- optional structured model-reasoning provider behind deterministic action policy;
- redaction rather than blanket rejection;
- representative adjudicated evaluation corpus.

## D. Public acquisition Check

- anonymous ephemeral Check;
- abuse controls;
- attribution;
- save/convert after signup;
- SEO/campaign landing architecture.

## E. Real commerce proof

- Stripe test-mode purchase;
- webhook authenticity;
- event idempotency;
- subscription normalization;
- entitlement activation;
- trial/cancel/grace/refund test states;
- reconciliation.
- preserve Apple/Google/sponsor adapters for later stores.

## F. Mobile native proof

- Android and iOS device builds;
- secure identity/session;
- share-sheet intake;
- deep links/invitations;
- offline/error flows;
- VoiceOver/TalkBack;
- no unsupported call interception claims.

## G. BoomerBuddy HQ / Revenue OS

Build the first real internal business graph:

- organizations;
- contacts;
- leads;
- target accounts;
- opportunities;
- activities;
- tasks;
- next actions;
- source/provenance;
- attribution;
- customer health;
- orientation state;
- support/fraud cases.

Add:

- stale opportunity workflow;
- owner daily queue;
- credit-union target import from official sources;
- provider adapter for later Apollo/enrichment;
- no automated outbound messages without human-approved policy.

## H. Customer success and orientation

- real protected enrollment;
- consent withdrawal;
- activation score;
- orientation interventions;
- practice scam;
- Family setup;
- optional future Safety Setup scheduling abstraction.

## I. Clean CI and security closure

- clean reproducible CI;
- dependency advisory remediation;
- authorization regressions;
- real PostgreSQL tests;
- native test matrix;
- security/privacy review gates.

---

# Run 2 should still NOT do

Do not yet:

- publicly launch;
- accept uncontrolled live payment;
- claim fraud prevention;
- claim calibrated accuracy;
- build every V1 feature;
- add audio/live-call breadth;
- build payroll/accounting/tax systems;
- build a generic CRM;
- custom-build for one credit union;
- automate outbound sales without human governance;
- add a large human support organization.

---

# Founder-level conclusion

Build Run 1 succeeded at its actual purpose.

The repository is worth extending.

The biggest risk now is **not** that the architecture is fake.

The bigger risk is that the next gauntlet remains so conservative that it optimizes away:

- the free acquisition loop;
- the revenue engine;
- the Business OS;
- the V1 intelligence assets;
- and the speed required to become a commercial company.

Run 2 should retain Run 1's safety discipline while becoming materially more commercially aggressive.

That is the balance to preserve.
