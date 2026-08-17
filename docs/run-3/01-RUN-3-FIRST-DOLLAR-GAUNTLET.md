# BoomerBuddy — Run 3 First-Dollar Launch Candidate Gauntlet

**Authority:** Founder-authorized Run 3 engineering/commercialization run.  
**Starting commit:** `a66a24d3b826d602e20f2976375d140801f893ed`  
**Starting state:** Run 2 bounded local commercialization foundation; no production launch or first-dollar evidence.  
**Primary objective:** Convert Run 2 into a **company-controlled, Replit-first, founder-invited closed-beta production candidate** that can truthfully reach a manual `GO / NO-GO / REMEDIATE` decision and, after an explicit separate founder activation, support the first real paying household.

This run is **not** authorization for uncontrolled public launch, mass outreach, live ad spend, autonomous customer messaging, app-store submission, or an agent taking live payment. It is authorization to build, test, provision bounded staging/test integrations when credentials are available, produce exact founder provisioning steps, and prepare a first-dollar activation runbook.

The optimization target is **shortest safe path to Customer #1**, not maximal feature breadth.

---

## 0. Read first and preserve truth

Read and treat as authoritative context:

1. `docs/BUILD-RUN-2-REPORT.md`
2. `docs/run-2/00-executive-verdict.md`
3. `docs/run-2/32-known-limitations.md`
4. `docs/run-2/33-run-3-launch-plan.md`
5. `docs/run-3/00-INDEPENDENT-RUN2-REVIEW.md`
6. repository `AGENTS.md`
7. current Master Spec / architecture / autonomy / commerce / fraud / research docs

Do not silently downgrade Run 2 blockers into “done.”  
Do not fabricate external evidence.  
Do not call synthetic personas “customers,” “focus groups,” “conversion,” “traction,” “efficacy,” or “validation.”

At the beginning, reproduce the clean Run 2 gate and freeze a Run 3 candidate branch/tag.

---

# Stage 0 — Independent review reconciliation: mandatory before external execution

Reopen these five findings from the independent Run 2 audit.

## R2-01 — Narrow HQ employee metadata access

Current support/reviewer projections are broader than necessary.

Before real customer data:

- owner/admin may retain appropriately audited global views;
- support should see assigned cases/households only unless a separately justified emergency workflow exists;
- fraud reviewers should see assigned or policy-eligible review queues, not an unrestricted all-household activity feed;
- aggregate health/provider metrics should not leak customer/household identities;
- exact content access remains JIT/case/grant gated.

Add negative tests proving an unrelated employee cannot enumerate household names, household IDs, Check activity, risk metadata, or restricted content.

Document the final data projection per HQ role.

## R2-02 — Make automation budgets cumulative and transactional

The current policy limit is a per-request ceiling, not a real budget.

Before any autonomous paid tool/executor, implement:

`available -> reserved -> committed | released`

with atomic persistence and audit lineage.

At minimum support:

- global company daily/monthly caps;
- per-agent/action/tool caps;
- policy-level period caps;
- concurrency-safe reservation before execution;
- release when execution never occurs;
- commit after provider acceptance;
- explicit founder override;
- kill switch checked again immediately before an irreversible action;
- immutable budget/spend history.

No autonomous paid executor may be enabled until tests demonstrate the cumulative cap cannot be bypassed by many individually-cheap requests.

## R2-03 — Public Check continuity under mobile IP changes

Current anonymous context binds to the exact observed network-address HMAC.

Test and redesign if necessary for:

- Wi-Fi -> cellular;
- cellular -> Wi-Fi;
- IPv4/IPv6 changes;
- VPN/privacy relay changes;
- proxy/CDN topology.

Prefer separating:

- abuse/quota network bucketing; from
- short-lived browser/device/context continuity.

Do not weaken abuse controls without deployed-edge evidence.

## R2-04 — Clarify Public Check conversion replay semantics

The current successful conversion is replay-safe/idempotent for the same actor/household/consent, despite being described as `oneTime`.

Either:

- rename/document it as “single successful conversion with bounded idempotent replay,” or
- expire replay authorization after a small recovery window while preserving content-free conversion evidence.

Add tests for legitimate retry and theft/mismatch attempts.

## R2-05 — Exactly-once strategy for external side effects

A durable consumer receipt alone cannot prove exactly-once behavior when a provider accepts an action and the worker dies before local completion.

Build an external-action framework that requires, per provider/action class:

- stable BoomerBuddy operation ID;
- provider idempotency key when supported;
- external action/message ledger;
- provider response ID/state;
- “outcome unknown” reconciliation before retry;
- bounded retry policy;
- duplicate-prevention tests;
- explicit handling for providers without idempotency guarantees.

No autonomous email/SMS/refund/credit/paid-tool action may bypass this layer.

---

# Stage 1 — Supply-chain and production-platform gate

## Dependency adjudication

Run a fresh machine-readable dependency/security inventory. The Run 2 report recorded 19 advisories: 1 low, 7 moderate, 11 high. Do not carry those counts forward without re-running the audit.

For every current advisory:

- package/advisory/CVE or GHSA;
- direct/transitive;
- dev/build/runtime reachability;
- exploit preconditions;
- actual BoomerBuddy execution path;
- fixed version;
- remediation/replace/mitigation/acceptance decision;
- owner and deadline.

No applicable unresolved Critical/High may cross the launch-candidate gate.

Produce current SBOM/license/provenance evidence.

## Production refusal

Keep production fail-closed until managed identity/KMS and the required production controls are real. Do not weaken a refusal merely to make a deployment green.

---

# Stage 2 — Replit-first deployment with an engineered exit

The founder is explicitly choosing **Replit as the fastest initial hosting/development/publishing path**, while preserving company portability.

## Non-negotiable custody rules

Replit must not become the sole custodian of:

- canonical source;
- DNS/domain;
- customer database backups;
- payment truth;
- durable object/media backups;
- mobile signing identity;
- production secrets/recovery documentation.

Preferred topology for the first production candidate:

- **Replit:** development cockpit + initial web/API/worker hosting if technically sound;
- **founder/company-controlled Git remote:** canonical source and protected release history;
- **Cloudflare or equivalent founder-controlled DNS:** domain custody;
- **portable PostgreSQL:** external managed PostgreSQL preferred when it shortens future migration; if Replit-native persistence is chosen for speed, prove full export/restore to independent PostgreSQL before GO;
- **S3-compatible object storage:** screenshots/audio/attachments; never rely on deployment-local filesystem;
- **Stripe:** payment truth;
- **Twilio:** approved customer messaging/voice transport;
- **managed identity/KMS:** production auth/key custody;
- **Sentry/PostHog or approved equivalents:** errors/analytics.

The application core must not import Replit-specific runtime assumptions. Replit-specific deployment adapters/configuration may exist at the edge.

## Required Replit deliverables

Create:

`docs/run-3/REPLIT-FIRST-LAUNCH-RUNBOOK.md`

It must contain exact founder steps for:

- connecting/importing canonical source;
- required deployment type(s);
- environment variable names only — never secret values;
- build/start/worker commands;
- persistent-data requirements;
- custom-domain/DNS setup;
- health checks;
- rollback;
- log/alert verification;
- scaling/cost assumptions;
- how to redeploy a frozen tag;
- how to disable/stop production quickly.

Create:

`docs/run-3/MIGRATION-OFF-REPLIT.md`

It must prove how the exact same frozen release can move to an alternate OCI/web/API/worker target with:

- source restore;
- environment recreation;
- PostgreSQL restore;
- object/media restore;
- DNS cutover;
- worker drain;
- rollback;
- validation checklist.

Perform the strongest non-destructive migration/loss drill possible in the run and label unproved steps honestly.

---

# Stage 3 — Founder Provisioning Console

Build a founder-facing provisioning/status area in HQ and a repository document:

`docs/run-3/FOUNDER-PROVISIONING.md`

It must list every external dependency with:

- provider;
- purpose;
- account owner;
- current status: `not_started | founder_in_progress | ready_for_test | test_proven | ready_for_live_review | blocked`;
- exact manual founder steps;
- required IDs/config names;
- secret names expected by the application;
- verification test;
- monthly cost ceiling;
- recovery/MFA owner;
- export/termination procedure;
- last evidence timestamp.

No secrets may be stored in this document, git, screenshots, analytics, test fixtures, or logs.

Expected provider workstreams include, as applicable:

- canonical Git remote;
- Replit;
- DNS/domain;
- PostgreSQL;
- object storage;
- identity/KMS;
- Stripe;
- Twilio;
- Postmark/email or equivalent;
- Sentry;
- PostHog;
- Apple Developer;
- Google Play Developer;
- Expo/EAS;
- Apollo or other enrichment — still disabled for real outreach unless separately authorized.

If a founder credential/account is missing, the workstream must produce an exact checklist and continue on work that does not require the credential.

---

# Stage 4 — Real PostgreSQL, concurrency, restore, and edge proof

Run the queue/outbox/commerce/consent/authorization/privacy model against real PostgreSQL, not only PGlite.

Prove:

- migrations from clean DB;
- pooled/direct connections;
- least-privilege roles;
- concurrent lease claims;
- lease loss/reclaim;
- heartbeats;
- consumer receipts;
- causal ordering;
- dead letter/replay;
- duplicate workers;
- shutdown drain/relinquish;
- provider timeout;
- multi-worker tests;
- restore into a clean independent database;
- row/checksum/projection reconciliation;
- deletion/retention states after restore.

Put Public Check behind the intended deployed edge and prove trusted-proxy topology, body limits, quotas, concurrency, address rotation, redacted telemetry, abuse behavior, and purge.

---

# Stage 5 — Commerce: test truth first, first-dollar activation second

Use the existing Run 2 commerce model. Do not simplify payment truth.

## Stripe external test-mode proof

When founder-provided Stripe test configuration is available, prove end-to-end:

- server-created Checkout;
- product/price mapping;
- tax configuration decision;
- signed raw webhook;
- idempotent event inbox;
- initial server-bound activation;
- authenticated `invoice.paid` paid-through advancement;
- canonical subscription;
- allowance/entitlement rebinding;
- portal;
- cancel-at-period-end;
- failed payment/grace;
- recovery;
- refund;
- dispute;
- duplicate/reordered events;
- metadata mismatch;
- forged signature;
- provider outage;
- reconciliation;
- exact paid-invoice lineage.

Create:

`docs/run-3/STRIPE-FIRST-DOLLAR-RUNBOOK.md`

The runbook must separate:

### Safe automated preparation
test products/prices, test webhooks, configuration verification, test transactions, reconciliation.

### Founder-only live activation gate
live product/price IDs, live webhook secret, live tax/registration review, live checkout enablement, first real charge, refund procedure, rollback.

**Run 3 itself does not charge a real card.**  
It prepares a candidate that can be activated only after the final founder GO decision.

---

# Stage 6 — Twilio and consent-aware communication

Assume the founder is completing a Twilio account and U.S. toll-free verification.

Build messaging so BoomerBuddy can support, once approved:

- two-way customer care;
- account/service notifications;
- fraud-safety alerts;
- HELP/STOP handling;
- opt-out suppression;
- delivery/failure reconciliation;
- exact external-action idempotency;
- quiet hours/frequency rules;
- consent evidence and withdrawal.

Create:

`docs/run-3/TWILIO-CONSENT-AND-MESSAGING.md`

Initial promotional/referral outreach must **not** rely on one person providing another adult’s phone number as consent.

The initial referral invitation should use a **user-initiated native share sheet / SMS composer / email composer / copied referral link** from the customer’s own device. BoomerBuddy may pre-compose safe invitation copy, but the user sends the first message.

Only after the recipient enters BoomerBuddy, accepts the relevant relationship/invitation, and separately gives BoomerBuddy the required consent may BoomerBuddy send its own messages.

No purchased lists. No transferred consent. No automatic messaging to uploaded contacts.

---

# Stage 7 — Founding Household closed beta

Build an explicit **Founding Household** mode for the first real users.

The founder must be able to invite a small bounded cohort without requiring a card.

Support a configurable cohort limit, expiration, and benefits. Do not hard-code “free forever.”

The initial objective is not vanity signup count. It is to observe whether a household can successfully complete:

1. account creation;
2. orientation;
3. first Check;
4. understand the result;
5. take a safe next action;
6. invite/establish a Trusted Circle relationship;
7. receive relevant service value;
8. submit useful feedback;
9. return later.

Instrument this funnel in privacy-bounded analytics.

Create:

`docs/run-3/FOUNDING-HOUSEHOLD-PLAYBOOK.md`

including founder recruitment script, research/marketing boundary, consent language, onboarding checklist, follow-up cadence, stop conditions, and success/failure definitions.

The first free users are **beta customers/test households**, not proof of willingness to pay.

---

# Stage 8 — BoomerBuddy Learning System

Feedback is a first-class company operating system, not an inbox.

Build a unified feedback object and intake system for:

- web feedback form;
- in-app contextual feedback;
- mobile app feedback;
- text notes;
- optional audio note;
- optional screenshot/image;
- optional screen recording only if safely supported;
- `feedback@boomerbuddy.net` adapter/inbound-email workflow when the founder provisions it;
- support-to-feedback conversion;
- post-Check feedback;
- orientation feedback;
- cancellation/refund feedback.

## Required feedback metadata

Store only what is necessary. Model:

- feedback ID;
- actor/household when authenticated;
- anonymous option where appropriate;
- source surface;
- app/build version;
- locale/device class;
- optional linked product object/Check only with explicit permitted linkage;
- feedback type;
- consent for follow-up;
- research-retention consent/purpose;
- attachments;
- redaction status;
- transcription status;
- classification;
- duplicate/cluster ID;
- severity;
- customer-impact hypothesis;
- status;
- owner/agent;
- resulting issue/experiment/content/support action;
- close-the-loop state.

## Privacy/safety intake

Before material is broadly visible:

- scan/redact OTPs, payment-card data, credentials, private keys, and other unnecessary secrets;
- quarantine unsafe/unprocessable attachments;
- strip unnecessary metadata;
- enforce media size/type limits;
- malware-safe handling strategy;
- encrypt retained media;
- define retention/deletion/export behavior;
- do not use customer feedback to train external providers unless explicitly allowed by policy/contract/consent.

## Feedback gauntlet

Implement an internal agent-review pipeline with separate roles such as:

- intake/transcription agent;
- privacy/minimization agent;
- support triage agent;
- fraud-quality reviewer;
- accessibility/usability reviewer;
- product analyst;
- engineering defect analyst;
- customer-success analyst;
- skeptical reviewer.

The gauntlet must distinguish:

- one person’s preference;
- repeated usability pattern;
- true bug;
- safety/fraud-quality issue;
- accessibility blocker;
- support request;
- pricing objection;
- feature opportunity;
- testimonial candidate;
- research question.

It may autonomously:

- transcribe;
- redact;
- classify;
- deduplicate;
- cluster;
- summarize;
- draft internal issues/experiments;
- produce Founder Attention items.

It may **not** autonomously:

- deploy production code;
- alter fraud policy;
- promise a feature;
- publish a testimonial;
- send mass customer communication;
- expose customer content to unrelated employees/agents.

Build HQ views for:

- new feedback;
- repeated themes;
- severe/safety issues;
- customers needing follow-up;
- accessibility issues;
- feature hypotheses;
- proposed experiments;
- “you told us / we changed” close-loop candidates.

Create:

`docs/run-3/FEEDBACK-LEARNING-SYSTEM.md`

---

# Stage 9 — Continuous Fraud Intelligence + Editorial Review Board

BoomerBuddy should provide ongoing value between Checks.

Build the foundation for a durable continuous-intelligence system that can ingest **approved authoritative/public sources**, maintain provenance, deduplicate stories/patterns, and create reviewable customer content.

Do not treat an LLM summary as source truth.

## Intelligence pipeline

Separate:

1. source registry/governance;
2. fetch/ingest;
3. provenance;
4. normalization;
5. deduplication;
6. scam-pattern extraction;
7. corroboration;
8. fraud/safety analysis;
9. editorial drafting;
10. skeptical review;
11. compliance/tone/accessibility review;
12. approval;
13. publication/sending;
14. analytics;
15. correction/retraction.

Reuse/migrate strong V1 taxonomy/source-registry assets only through a governed migration; do not reconnect V1 runtime.

## Content products

Prepare configurable outputs such as:

- urgent scam alert;
- “Today’s Safety Tip”;
- weekly BoomerBuddy Brief;
- family discussion prompt;
- recovery guidance;
- learning-module update;
- founder video brief/script;
- SEO/blog draft;
- partner/credit-union bulletin.

## Editorial gauntlet

Model distinct roles:

- source scout;
- primary-source verifier;
- fraud analyst;
- evidence/corroboration reviewer;
- safety-action editor;
- anti-alarmism/skeptical editor;
- accessibility/plain-language editor;
- privacy/legal policy reviewer;
- final human approval queue initially.

Every published factual alert must retain source/provenance and correction lineage.

No automated mass newsletter/urgent-alert send during Run 3 unless the founder separately authorizes a sandbox or tightly bounded test destination.

Build HQ queues, publication calendar, source health, confidence, duplicate story handling, pending corrections, and subscriber preference model.

Create:

`docs/run-3/EDITORIAL-INTELLIGENCE-BOARD.md`

---

# Stage 10 — Referral and viral stakeholder-discovery engine

The founder wants aggressive referral economics, but the mechanism must be consent-aware and abuse-resistant.

Build a **configurable referral-credit engine**, not hard-coded pricing promises.

## Candidate mechanic to model

Test/research this starting hypothesis:

- recipient accepts a legitimate Trusted Circle/referral invitation or creates a qualified referred account -> candidate **1 month-equivalent annual-plan credit**;
- that same referred household becomes an eligible paid annual customer -> additional credit so the referrer receives **3 months total** for that converted referral.

Also model alternatives such as `1 + 3`, capped founding promotions, and different annual-plan treatments.

Do **not** decide the permanent offer from synthetic opinions.

## Rules

- entering/uploading a phone number earns nothing;
- BoomerBuddy does not automatically message contacts who have not consented;
- invitation uses user-initiated native share/link mechanics;
- reward event comes from a verifiable action on the recipient side;
- deterministic attribution;
- self-referral protection;
- duplicate/household/payment-identity abuse controls;
- refund/dispute clawback;
- credit cap;
- expiration policy;
- audit ledger;
- clear customer-facing terms;
- canonical entitlement/commerce integration;
- tax/accounting treatment flagged for professional review.

Instrument:

`share -> invitation open -> qualified acceptance -> orientation -> paid conversion -> credit`

Create:

`docs/run-3/REFERRAL-CREDIT-AND-VIRAL-LOOP.md`

Include an economic sensitivity model against contribution margin/CAC.

---

# Stage 11 — Brand, positioning, price, and human research

Treat **BoomerBuddy** as the working brand, not an unquestionable conclusion.

Run a brand/positioning gauntlet that attacks:

- “Boomer” — memorable/friendly vs patronizing/age-coded;
- “Buddy” — approachable vs insufficient authority;
- self-purchase vs adult-child buyer;
- “scam detector” vs “family scam-safety network” vs “safer-action service”;
- trust language;
- pricing;
- annual discount;
- referral credits;
- Founding Household framing;
- Public Check conversion;
- Trusted Circle comprehension.

Agents may create hypotheses, candidate names/taglines, scripts, scorecards, landing-page variants, and synthetic red-team criticism.

**Synthetic personas are not focus-group evidence.**

Prepare real-human research for:

- older adults;
- adult children/caregivers;
- paired families;
- accessibility/assistive-tech users;
- fraud/cyber professionals;
- financial-institution stakeholders.

If real participants are not available during the run, mark the evidence `pending_human`.

Create:

`docs/run-3/BRAND-PRICE-REFERRAL-RESEARCH.md`

Keep research sessions distinct from marketing/sales unless separately consented.

---

# Stage 12 — Lead generation: start discovery, not volume

Do not optimize for thousands of leads before Customer #1.

## B2C

Prepare a founder-curated first cohort workflow for approximately 10–25 highly informative households.

No contact scraping or automatic messaging from personal address books.

## B2B

Preserve the NCUA/credit-union lead engine and Business OS opportunity model.

During Run 3:

- refresh/verify official-source ingestion if authorized;
- rehearse segmentation;
- build outreach drafts;
- test CRM/opportunity workflows;
- keep real Apollo enrichment/outreach off unless separately approved.

The immediate commercial priority is:

**first useful household -> first retained household -> first paid household -> repeatable acquisition**, not a vanity pipeline.

---

# Stage 13 — Mobile and store readiness without blocking web-first launch

Web-first closed beta and first-dollar readiness must not be blocked by Apple/Google developer-account timing.

Continue:

- Expo native builds;
- iOS/Android device proof;
- share-sheet/deep-link behavior;
- contacts permission minimization;
- photo/audio attachment permissions;
- push notification architecture;
- accessibility;
- store commerce adapters/canonical entitlements.

If Apple/Google accounts become ready, produce and test the next permitted step. Do not submit stores without separate founder authorization.

Never upload a customer’s address book to create a marketing lead database.

---

# Stage 14 — HQ Agent Web / bounded always-on operating system

Turn the Business OS/HQ into the control plane for continuous company operation.

Add first-class queues for:

- Owner Attention;
- Founder Brief;
- feedback;
- product experiments;
- fraud/safety review;
- editorial intelligence;
- content calendar;
- provider/source health;
- lifecycle/customer health;
- referrals/credits;
- support;
- billing/reconciliation;
- privacy requests;
- incidents;
- dependency/security advisories;
- research;
- B2B opportunities;
- provisioning/blockers.

Agents/workers should be event-driven or scheduled backend processes with:

- explicit tool/data/action policy;
- least privilege;
- cost budgets;
- audit logs;
- replay;
- idempotency;
- stop/kill switch;
- escalation;
- evaluation;
- human approval where required.

“Always on” does **not** mean unrestricted.

## Authority ladder

Preserve explicit levels:

1. draft only;
2. recommend/queue approval;
3. bounded autonomous internal action;
4. bounded external action only after that action class has earned approval through evidence.

Initially allow autonomous internal work such as:

- research;
- ingestion;
- classification;
- redaction;
- summarization;
- clustering;
- drafting;
- internal issue creation;
- owner brief generation;
- provider/source health checks.

Keep approval-gated:

- production deploy;
- live money movement/refund/credit above tiny test policy;
- mass email/SMS/push;
- promotional outreach;
- consequential fraud-policy change;
- legal/terms changes;
- public correction/incident statement;
- hiring/contracts.

---

# Stage 15 — Observability, privacy fulfillment, recovery, and operations

Before GO, prove:

- error monitoring;
- product analytics with privacy minimization;
- redacted structured logs;
- alert routing;
- incident runbooks;
- provider outage behavior;
- customer support routing;
- identity recovery;
- billing/refund workflow;
- privacy export/correction/restriction/deletion;
- media/object deletion;
- processor/backup reconciliation;
- full restore;
- founder kill switch;
- founder absence tabletop.

Do not call append-only legal/audit records “deleted” if policy requires retention; design pseudonymization/retention truth explicitly.

---

# Stage 16 — Seven-day Customer #1 critical path

Produce:

`docs/run-3/FIRST-CUSTOMER-7-DAY-PLAN.md`

with the shortest realistic founder critical path beginning from the current Run 2 state.

The plan must identify:

- what can be parallelized;
- exact founder account tasks;
- exact engineering blockers;
- first day a real Founding Household can safely use the product;
- first day Stripe live activation could be considered;
- rollback criteria;
- what is allowed to remain manual for Customer #1;
- what must be automated before Customer #10/100.

Optimize for the smallest safe, useful slice.

Do not expand scope just because infrastructure exists.

---

# Stage 17 — Final launch-candidate dossier and stop

Produce a final:

`docs/run-3/00-EXECUTIVE-VERDICT.md`

with one of:

`GO_FOR_FOUNDER_ACTIVATION`  
`NO_GO`  
`REMEDIATE`

“GO” means only:

> the evidence supports the founder manually activating the explicitly documented live path for a bounded closed beta / first paying household.

It does **not** authorize agents to:

- open uncontrolled public traffic;
- turn on mass campaigns;
- charge arbitrary users;
- upload/send to contacts;
- submit app stores;
- hire;
- sign institutional contracts.

The dossier must contain:

- exact frozen commit/tag;
- test/build/security/coverage evidence;
- current dependency adjudication;
- real PostgreSQL/restore evidence;
- Replit deployment and migration-off-Replit evidence;
- account/provisioning register;
- identity/KMS state;
- Stripe test evidence;
- Twilio verification/integration state;
- Public Check edge evidence;
- feedback Learning System evidence;
- editorial Intelligence Board evidence;
- referral/credit engine evidence;
- privacy/accessibility/recovery state;
- device/store state;
- human/professional evidence and gaps;
- economics with referral scenarios;
- first-customer runbook;
- all remaining risks with owner/deadline;
- explicit founder activation checklist.

If a claim depends on a real account, human participant, professional opinion, live provider, or deployed environment and that evidence was not obtained, mark it blocked/pending. Never infer success from scaffolding.

---

# Required engineering quality gate

At minimum preserve or improve Run 2 quality:

- strict TypeScript;
- lint/format;
- unit/integration/security/evaluation coverage;
- browser/Edge journeys;
- clean clone;
- V1 isolation;
- portability;
- real PostgreSQL verification;
- OCI/alternative-target verification where practical;
- secret scanning;
- dependency/SBOM evidence.

Add focused tests for every Stage 0 finding and every new external side-effect/feedback/referral/editorial privacy boundary.

No unresolved in-scope Critical/High defect at final candidate freeze.

---

# Final founder experience

The desired output is not merely “tests pass.”

The founder should finish Run 3 with:

1. a working Replit-first production candidate;
2. a company-owned escape path from Replit;
3. exact account/provisioning instructions;
4. real Stripe test-mode proof and a manual first-dollar activation checklist;
5. Twilio-safe consent/messaging infrastructure;
6. a real Founding Household mode;
7. a feedback system that turns customer voice/screenshots/text into HQ learning;
8. a continuous fraud-intelligence/editorial system with source provenance and review gates;
9. a consent-aware referral engine with aggressive but configurable credits;
10. brand/pricing/referral research ready for real humans;
11. an HQ Agent Web capable of bounded continuous operation;
12. a dated seven-day plan to the first real paying household;
13. a final `GO_FOR_FOUNDER_ACTIVATION / NO_GO / REMEDIATE` decision.

**The company goal is not “autonomy everywhere.” It is evidence-driven autonomy that earns broader authority one workflow at a time.**
