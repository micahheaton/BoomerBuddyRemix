# BoomerBuddy 2.0 Master Spec

Status: **Authoritative product and system contract, amended for Run 2 commercialization foundation**

Decision date: 2026-08-15

Implementation reconciliation: 2026-08-16

Run 2 amendment: 2026-08-16

Working product name: **BoomerBuddy** (not audience-tested or legally cleared)

This document is the authoritative product and system contract. Detailed evidence lives in [Gauntlet Zero](./gauntlet-zero/00-executive-verdict.md); architectural decisions live in [ADRs](./adr/). Where this document conflicts with a workstream note, this document governs until a dated amendment explains the change.

## Executive decision

Pursue **consented household scam response** as a commercialization candidate. Do not pursue “an AI scam detector for seniors” as the business. The urgent free job is to examine suspicious text or a URL. The paid recurring job is to help a willing protected person and people they trust move from uncertainty to a verified safer action, preserve appropriate context, and follow through. Run 2 may build a staging-ready commercialization foundation, but it does not authorize public launch, live money, outbound campaigns, hiring, app submission, or production customer data.

The problem and category are real; BoomerBuddy demand, name, pricing, retention, fraud-quality advantage, and channel economics are not proven. Trend Micro already offers scanner-plus-Family-Circle functionality. Differentiation must be demonstrated through safe-action completion, private-by-default collaboration, older-adult usability, reproducible quality evidence, recovery operations, and distribution—not asserted from feature presence. The founder’s 50,000 revenue-bearing subscriber-equivalent and approximately $1 million annual sustainable owner-level operating-profit scenarios are planning constraints, not forecasts or traction claims. Direct paid households, direct subscribers, protected people, sponsor-eligible people, sponsor-activated people, and revenue-bearing equivalents remain distinct measures.

## What 2026 changes—and does not

Current iOS/Android sharing and call-screening surfaces can shorten user-invoked capture; structured-output models are stronger and cheaper; managed identity, commerce, PostgreSQL, telemetry, and communications reduce commodity build work. These changes improve feasibility, not permission or truth. OS capabilities remain user-enabled and constrained, provider terms still govern data, and no model becomes an authoritative fraud oracle. Build only the text/URL-string foundation now; validate native and live-provider claims separately.

## Product constitution

1. Safe action outranks a risk label.
2. Protected people retain dignity, agency, and control over sharing.
3. Observed evidence, third-party reputation, inference, confidence, and unknowns are distinct.
4. Failure and uncertainty are stated plainly; no fabricated provider success or false “safe” result.
5. Urgent recovery guidance is never paywalled or interrupted by an upsell.
6. Consent is scoped, versioned, revocable, and auditable.
7. Sensitive artifacts are minimized; customer content is not training data by default.
8. Every artifact and URL is hostile input. Build Run 1 never fetches submitted URLs.
9. Authentication, object authorization, employee access, and entitlements are server-enforced.
10. Safety claims require reproducible evaluation and incident learning.

BoomerBuddy is not a bank, insurer, emergency service, law-enforcement agency, attorney, identity proof, voice-authentication service, or guarantee against loss.

## Customers, users, and jobs

The first payer hypothesis is an adult child or household organizer who already receives “is this real?” requests. The primary protected user is an older adult who willingly participates. Self-purchasing older adults, couples, caregivers, sponsors, and advisers are secondary hypotheses.

Domain authority is orthogonal. `person`, `identity`, neutral household membership, household administrator, protected enrollment, pairwise Trusted Circle relationship, payer economic identity, billing manager, organization membership, customer support delegation, employee eligibility, support-case assignment, and restricted-access grant are separate facts with separate scopes and lifecycles. One person may hold several at once. Age, payment, kinship, household administration, sponsor eligibility, or employee role never implies artifact access or another authority.

The protected user’s job is: “Help me decide what to do without making me feel foolish.” The payer’s job is: “Help our family respond before panic becomes loss without turning care into surveillance.”

## Core product loop

`capture → normalize → extract deterministic signals → gather provider evidence → reason → state risk and confidence → explain → recommend verified action → optionally share/escalate → retain minimally → learn only through governed evaluation`

A result contains:

- risk represented in the active Run 2 contract as `unknown`, `caution`, or `high_concern`, never “guaranteed safe”; `lower_concern` is reserved and unavailable until affirmative, current evidence and representative evaluation support a truthful threshold, and a provider no-match never qualifies by itself;
- a coarse rules-based evidence-sufficiency/confidence band rather than false decimal precision; Run 1 labels it **not empirically calibrated**;
- evidence with type, source, acquisition time, authority, and limitations;
- plain-language reasoning that distinguishes observations from inference;
- prioritized actions with official-channel guidance and emergency recovery when relevant;
- provider/model/ruleset versions and a visible `mock`, `unavailable`, or `unverified` state;
- retention/deletion state and a security audit reference.

Build Run 1 supports text and URL strings. Image, document, QR, phone, transcript, audio, and live-call capabilities are later modalities that must clear separate consent, extraction, safety, and device tests.

## Family and consent contract

- A household is an ownership and billing boundary, not blanket visibility.
- Household membership establishes presence only. Administration, protected status, pairwise trust, payment, billing management, and support authority are separate grants.
- A protected person accepts, defers, or withdraws protection and grants or expands sharing for themself. Either participant may end an exact Trusted Circle relationship. An administrator may safety-suspend access, but that is not the protected person’s withdrawal and cannot rewrite their consent history.
- Trusted Circle authority belongs to the exact `(household, protected person, trusted person)` relationship. It is never a membership-wide role or permission. The conceptual permissions are `receive_escalation`, `view_shared_result`, and `help_with_incident`; only implemented permissions may be granted.
- One person may be an administrator and protected person, be trusted by another protected person, pay for the household, or manage billing without one fact implying another. A payer or billing manager receives no Family, orientation, Check, or artifact visibility through payment authority.
- Raw artifacts are private by default. Sharing starts with a redacted result; expanded content requires explicit action.
- Invitations are identity-bound in production, expiring, single-use, scope-limited, revocable, non-enumerating, and audited. A bearer-style local code is development evidence only. Expiry, acceptance, withdrawal, relinquishment, suspension, and reactivation are explicit lifecycle events.
- Consent evidence is append-only. Each record identifies actor, subject, recipient, purpose, canonical scope, action, disclosure and policy version/digest, source interaction, session/assurance, effective time, expiry, withdrawal/revocation, and correlation evidence. Authorization uses a current-state projection while preserving historical facts.
- Employees have no default artifact access. Employee roles establish eligibility only. Support requires an exact case assignment; restricted content additionally requires purpose, recent step-up, resource scope, expiry, immutable audit, and customer-visible accountability where appropriate.

The Family Safe Word is a social verification aid. The service stores only a salted memory-hard verifier, rate-limits attempts, never retrieves or displays the phrase, and replaces it during recovery. It is not proof that a person or voice is genuine.

## Orientation contract

Orientation is a resumable domain workflow: `not_started → in_progress → ready`, with a separate `needs_attention` condition. Steps are protection subject, Trusted Circle, safe word or informed deferral, practice check, capabilities/limitations, and review. Practice artifacts are labeled and excluded from real fraud metrics. Readiness remains descriptive; it cannot imply a household is scam-proof.

## Surfaces and information architecture

### Customer web

Public: home, how it works, pricing hypothesis, trust boundaries, and Check entry. In Build Run 1 the entry leads to development sign-in; persisted Checks are member-only. A future anonymous Check must be ephemeral/no-history under a server-minted anonymous context. Member navigation is limited to `Home`, `Check`, `History`, and `Family`; orientation is a guided task and recovery starts from a result. No testimonials, ratings, customer counts, partnerships, awards, or prevented-loss claims without evidence and permission.

### Mobile

The recurring loop is `share or paste → check → understand → act`. Build Run 1 establishes a real Expo application, shared contracts/tokens, navigation, and text/URL Check. Native share extensions/intents are not complete until device-tested; iOS validation requires macOS/Xcode.

### BoomerBuddy HQ

HQ is a separate employee application, session audience, and BoomerBuddy Business OS. It owns the customer/household and sponsor/partner graphs, consent and safety context, subscription/entitlement truth, acquisition attribution, activation and customer-health evidence, fraud/support/privacy cases, leads/accounts/opportunities, activities/tasks/next actions, owner attention, and partner/member adoption. It integrates rather than rebuilds commodity payroll, tax, general ledger, banking, bulk contact data, message transport, generic ATS, and general-purpose CRM functions. Employee roles never bypass customer authority or turn HQ into direct database access.

## Commercial contract

Packaging is a hypothesis:

| Offer  | Working boundary                                                      |                Hypothesis |
| ------ | --------------------------------------------------------------------- | ------------------------: |
| Free   | Useful complete result, urgent actions, limited history/collaboration |                        $0 |
| Plus   | One protected adult, two Trusted Circle participants                  |   $8.99/month or $89/year |
| Family | Up to three protected adults, six Trusted Circle participants         | $14.99/month or $149/year |

`$119/year` may be tested only as a controlled founding offer. No plan promises unlimited costly use. Sponsored pricing and credit-union pilots are discovery hypotheses, not quotes or relationships. Provider-neutral entitlements—not payment-provider fields—govern access. Payment initiation, payer identity, billing administration, provider subscription state, and effective entitlement are separate. Signed provider events enter an idempotent inbox and normalize through reconciliation; redirects, client state, receipts, or ownership never unlock access directly. Run 2 may prove Stripe in test mode and build Apple/Google adapters, but an external transaction remains `blocked` unless account credentials and a real sandbox journey are available. Storefront presentation is jurisdiction- and policy-versioned with default-deny external purchase links.

## Canonical domain model

The initial bounded modules are:

- **Identity and access:** person, identity, session, neutral membership, administrator assignment, employee eligibility, support-case assignment, restricted-access grant.
- **Household:** household, protected enrollment, pairwise Trusted Circle relationship/grant, invitation, append-only consent evidence and current projection, payer fact, billing authority, safe-word verifier.
- **Check:** artifact, normalized artifact, signal, provider observation, analysis run, decision, action, feedback, retention state.
- **Public Check:** anonymous context, abuse quota, ephemeral analysis, one-time conversion grant, save consent, content-free attribution.
- **Fraud intelligence:** curated taxonomy/source/action records, provider capability and data-access policy, provider attempt/evidence, evaluation case/review/adjudication/release gate.
- **Orientation and lifecycle:** versioned workflow/steps, completion/readiness evidence, intervention, customer-health signal, communication policy and suppression.
- **Commerce:** product/plan versions, payer, billing authority, provider customer/subscription record, canonical subscription, entitlement grant, seat/allowance, commerce inbox, reconciliation, refund/dispute/cancel evidence.
- **Sponsor:** organization, eligibility, sponsored entitlement, aggregate-reporting policy.
- **Acquisition and referrals:** privacy-bounded touchpoint/attribution, referral relationship and immutable reward ledger, content item/source/review/publication decision.
- **Revenue operations:** sourced account/contact facts, opportunity/stage history, activity, task/next action, staleness item, suppression, partner program.
- **Operations:** audit event, outbox/inbox, durable job/lease/attempt/dead letter, review/support/privacy case, provider health, owner-attention item, owner-brief snapshot, autonomy registry and approval record.

Every sensitive resource carries a household or organization boundary. Foreign keys, uniqueness, lifecycle constraints, and repository filters enforce that boundary; application code alone is insufficient. IDs are opaque. Events use a versioned envelope with event ID, type/version, aggregate ID/type, tenant, actor, correlation/causation, occurred time, data classification, and payload.

## Security, privacy, and safety boundary

- Deny by default. Authorization evaluates actor, session audience, role, action, tenant, resource ownership, consent, and entitlement.
- The client never submits a trusted actor/user ID. Build Run 1 identity uses allow-listed seeded personas. Browser sessions use distinct signed HttpOnly customer/HQ cookies. The mobile scaffold may use an opaque, expiring, revocable, audience-scoped development bearer stored with Expo SecureStore on native and memory only on web; the server resolves identity and current roles. Production mode refuses every development issuer, and native storage behavior remains device-unverified on this Windows host.
- Sensitive mutations require trusted origin/anti-CSRF controls; cookies are secure in production with explicit SameSite behavior.
- Sensitive artifact fields use authenticated encryption with a configured local key in Build Run 1. Artifact fingerprints use a separate purpose-scoped keyed HMAC—not a guessable plain content hash. Production KMS, key separation, and rotation are Run 2 requirements.
- Never deliberately persist plaintext safe words, passwords, one-time codes, private keys, payment-card/authentication credentials, or provider secrets in fields, logs, events, analytics, fixtures, or prompts. When such values are incidentally embedded in a submission, analyze transiently only as needed and reject or redact them before persistence.
- Run 2 replaces blanket rejection with deterministic typed redaction when a sensitive span can be bounded safely: derive only non-sensitive safety flags, replace the exact span with a typed placeholder, analyze and persist only the redacted representation, and tell the user which classes were removed without values or positions. Private keys, ambiguous credentials, unsafe URLs, unusable remnants, and unsupported binary/modal inputs remain hard-rejected. The transient original never reaches fingerprints, logs, audit/outbox, analytics, providers, exceptions, or fixtures.
- Password-like safe words use a memory-hard verifier and constant-time comparison.
- Logs, analytics, audit summaries, URLs, exceptions, and event payloads exclude artifact content, secrets, tokens, destinations, and unnecessary PII.
- Retention is explicit and deletion is testable. Evaluation fixtures are licensed/synthetic/reviewed and separated from customer submissions.
- URL input is parsed and normalized but never resolved, redirected, requested, previewed, or rendered in Build Run 1.
- Rate limits, production MFA/identity, account recovery, KMS, export, full deletion, isolated URL retrieval, external penetration testing, and incident drills block first-dollar launch even if scaffolded earlier.
- Public Check uses a short-lived server-minted anonymous context, shared quotas/rate limits, strict byte and time budgets, non-enumerating responses, no durable artifact/history by default, and no content, URL, query string, host, or free text in analytics. Saving requires authenticated identity plus explicit consent and creates a new actor-owned resource; referral, campaign, payer, or administrator context never receives artifact authority.

## Fraud intelligence and evaluation

Deterministic rules establish a transparent baseline: urgency, secrecy, unusual payment, credential requests, remote access, authority impersonation, URL user-info/IP/homograph or structural anomalies, and related combinations. Rules do not claim universal detection. External evidence uses typed provider roles such as local signal, URL/domain reputation, verified organization, and message reasoning. Each provider declares exact input representation/data classes, whether data leaves BoomerBuddy, retention/training terms, timeout, freshness, cost/budget, rate limit, kill switch, provenance, and failure semantics. A central policy dispatcher supplies only allowlisted fields. No provider receives raw input by default or chooses the customer action. Network acquisition remains isolated from the API and primary credentials.

The evaluation lab versions fixtures, rights and provenance, sanitization, taxonomy, expected minimum risk, required/prohibited actions, independent reviewer assignments, disagreement/adjudication, sealed split, rules/provider versions, and run environment. Report confusion matrix only where labels support it, false-negative cases, false positives, exploratory calibration buckets, action-safety failures, latency, provider cost, and coverage gaps. The initial fixture set proves harness behavior only; it neither establishes empirical calibration nor provides production-quality evidence. Any critical malicious fixture that receives harmful assurance blocks release. V1 taxonomy and source records are candidate inputs only and become 2.0 assets solely through independent review, provenance, jurisdiction, rights, version, lifecycle, and intended-use governance; no V1 runtime import is permitted.

## Selected architecture

- Node.js 22 and strict TypeScript in npm workspaces.
- Modular monolith API with explicit module/port boundaries; no microservices in Run 1.
- Fastify and schema-validated HTTP contracts; separate customer web and HQ applications; Expo mobile foundation.
- PostgreSQL migrations are canonical. PGlite executes the same schema for local development and tests; managed PostgreSQL is the production direction.
- Transactional audit/outbox writes occur with domain changes. Durable external workers are a later deployment concern; Build Run 1 never sends customer messages.
- Structured redacted logging, request/correlation IDs, central errors, health/readiness, and typed configuration require no production observability credentials.
- Provider ports isolate identity, commerce, reputation/model intelligence, communications, storage, analytics, and future business integrations.
- Replit may host development, but it is never a source, identity, secrets, database, object-storage, deployment, DNS, or history single point of failure. The portable production hypothesis is a founder-controlled external Git remote, standard OCI images, standard PostgreSQL, explicit environment contracts, and independently restorable backups. Vercel for separate web/HQ projects, Render for API/worker, Neon PostgreSQL, Clerk identity, Stripe web commerce, Apple/Google mobile commerce, Cloudflare DNS, reviewed S3-capability storage, Sentry, PostHog, Postmark, Twilio, and Expo/EAS are hypotheses until account, terms, security, region, cost, and restore evidence exists.
- Durable work executes through a portable database-backed worker with leases, bounded retry/jitter, idempotent consumers, dead-letter quarantine, audited replay, heartbeat, and graceful shutdown. In-process timers and vendor workflow products are not the canonical job contract.
- Real PostgreSQL CI, migration locking, pooled/direct connection qualification, backup/restore drills, Linux container builds, and clean-clone reconstruction are release evidence. PGlite remains fast local evidence, not production equivalence.

See [Build Run 1 Plan](./BUILD-RUN-1-PLAN.md) and the ADR directory for decision rationale and rejected alternatives.

## Analytics and operating metrics

The north-star hypothesis is `households completing a verified safe action per active household`, paired with quality and harm guardrails. From day one measure orientation completion, first/practice/second check, Trusted Circle acceptance, time to first safe action, repeat use, deletion/revocation, evaluation performance, provider cost/latency/error, entitlement state, support minutes, refunds, and cohort survival.

No dashboard may call a warning “fraud prevented.” Sponsor reporting is aggregate, purpose-limited, and small-cell suppressed. HQ development metrics are seeded and visibly labeled.

Founder time is an operating constraint. Every recurring workflow is classified `AUTO`, `APPROVAL`, `HUMAN`, or `PROFESSIONAL` with permitted data, tools/actions, budget, audit, escalation, and kill switch. Automation may perform internal, reversible, allowlisted work; it may not make novel fraud determinations, publish content, send campaigns, grant restricted access, issue material refunds, accept legal/accounting responsibility, or conceal uncertainty. Owner Attention contains only decisions or exceptions that genuinely require the founder, with reason, recommendation, deadline, consequence, severity, source, deduplication key, state, and linked evidence.

## Accessibility and content

Target WCAG 2.2 AA as a testable floor, with at least 48px primary touch targets, readable default type, visible focus, keyboard and screen-reader semantics, 200% zoom/reflow, reduced motion, plain verbs, and no color-only status. “Senior-friendly” is not evidence; disabled older adults must complete moderated critical tasks. Every safety claim or official contact eventually needs source, jurisdiction, owner, locale, review date, expiry, and change history.

## Build/run boundaries

Build Run 1 proves architecture and one end-to-end vertical slice with seeded local data. It does not accept money, contact users, fetch URLs, use live intelligence/AI, submit to app stores, deploy, or represent mock delivery as real. Detailed scope is in [Build Run 1 Plan](./BUILD-RUN-1-PLAN.md).

### Build Run 1 implementation amendments

These are implementation clarifications, not silent changes to the buyer, promise, pricing, or distribution hypotheses:

- Protected status is independent of household role. Effective protected authority now requires active membership, accepted self-consent, an exact active `protected_members` allowance allocation, and a grant contributing to the household's current entitlement portfolio. An owner can separately enroll as protected; ownership alone grants no protected-person workflow.
- The local demo bootstrap is opt-in and one-shot. It runs atomically only when its checked root and selected domain tables are empty, writes a durable marker last, becomes a no-op after that marker exists, and rejects an unmarked database occupied in those checked tables. Normal marked restarts therefore cannot resurrect deleted Checks, revoked consent or relationships, disabled identities, or lapsed grants. The operational-only unmarked edge case is recorded in [Known Limitations](./build-run-1/12-known-limitations.md).
- Run 1 implements only the invitation permission `view_shared_checks`. The wider conceptual permission set remains designed, and the current code names its deferred entries `receive_escalations` and `help_with_orientation`. No screen or local invitation implies those deferred permissions work.
- Check history is split into actor-owned records and individually shared records. There is no household-wide history, and loss of protected enrollment removes new owned-workflow authority without removing the owner's ability to delete existing content or either participant's ability to withdraw consent.
- Audit/outbox writes and bounded local retention sweeps are implemented; external dispatch, multi-instance scheduling, replay/dead-letter operations, and production privacy orchestration remain deferred.
- Demo seeding, development sessions, local provider observations, commerce states, revenue data, and HQ projections are synthetic. Production startup deliberately fails closed until managed identity and KMS adapters exist.

The consolidated as-built evidence is in the [Build Run 1 Report](./BUILD-RUN-1-REPORT.md). No amendment authorizes deployment, production credentials, live providers, customer contact, payment, or Build Run 2.

First-dollar launch remains blocked by customer/name/price validation; production identity and commerce; current legal review; production retention/export/deletion; external security and accessibility review; expanded independent fraud/action evaluation; production monitoring/backups/restore; support/incident ownership; and tested vendor terms.

### Run 2 commercialization-foundation amendment

Run 2 corrects the authority graph and consent evidence, adds provider and knowledge governance, builds the privacy-bounded public Check, prepares real provider adapters and durable operations, and turns HQ into a bounded company control plane. It must also create portable CI/deployment and clean-clone recovery evidence, a 50,000-subscriber-equivalent scenario model, an explicit staffing model, and a Founder Dependency Score. Research protocols may be prepared and synthetic/local workflows may be implemented, but absent external participants or accounts their results are `blocked`, not simulated.

Run 2 may use local fixtures, Docker/PostgreSQL, provider simulators, and test/sandbox adapters. It may not create vendor accounts, provision paid services, use production credentials, charge anyone, contact prospects or users, publish or send content, submit a mobile app, hire staff, migrate V1 users, change DNS, or claim calibration, prevented loss, demand, retention, accessibility conformance, partner intent, or commercial traction. External steps are isolated as founder-approved Run 3 gates.

The Run 2 gate preserves the modular monolith, separate customer/HQ audiences, server-side object authorization, independent protected enrollment, pairwise sharing, provider-neutral entitlement truth, transactional outbox, PostgreSQL canonical schema, truthful provider states, minimized retention/encryption, evaluation release gates, and production fail-closed behavior. New dated ADRs supersede only the singular-role, mutable-consent, provider-data, public-context, durable-job, platform-portability, and Business-OS gaps identified in the independent review.

### Run 2 implementation reconciliation — 2026-08-16

This section records implementation evidence without rewriting the Run 2 authorization boundary. The definitive independent review is PASS with no unresolved in-scope Critical or High defect. That closes bounded Run 2 implementation only; production evidence, first dollar, and launch remain blocked.

- **Implemented locally:** orthogonal household/payer/billing/protected/Trusted Circle authority; append-only consent evidence and current projections; allowance reconciliation; bounded typed redaction; privacy-bounded Public Check; canonical commerce/inbox/reconciliation foundations; durable database jobs; provenance-bound NCUA import; owner-only HQ/Attention/Brief; and deterministic economics/workload calculators.
- **Implemented with mock provider:** development identity, local fraud observations, Stripe transport/signed fixtures, synthetic households/commerce/HQ data, and local PGlite execution.
- **Scaffolded or designed:** portable Vercel/Render/Neon/container configuration, Apple/Google commerce contracts, content/referral/lifecycle/acquisition foundations, privacy fulfillment, provider adapters, and autonomy policy evaluation.
- **Blocked externally:** company accounts and production credentials; managed identity/KMS; real PostgreSQL, multi-worker, restore and Replit-loss evidence; payments/store agreements and devices; edge bot/rate-limit controls; delivery/analytics/intelligence providers; representative human, accessibility and fraud evidence; legal/privacy/security/tax/employment review; staffed support/incident ownership; and founder commercial choices.

The required commerce invariant is conservative and implemented: the initial server-bound activation may establish its service period; later subscription status may restrict or shorten access but may not extend it; renewal or recovery may advance a period only from authenticated `invoice.paid` evidence with strict legacy/modern lineage, complete lines, paid status, the expected price and exact subscription, and invoice-line/subscription-snapshot service-period equality. Old invoice/current-cycle mismatches are quarantined.

Frozen local evidence includes full workspace typecheck, ESLint, and Prettier PASS; `npm test` PASS across 15 unit files/134 tests, 13 integration files/60 tests, five security files/17 tests, and 12 evaluation cases; 33 coverage files/211 tests with 89.12% statements, 84.69% branches, 97.93% functions, and 93.02% lines; production builds for API, worker, web (13 static pages), HQ (11), and Expo web (355 modules); portability inventory PASS; and committed clean-clone install/type/test/build reconstruction PASS. The normal clean-clone install summary reported 19 dependency advisories (1 low, 7 moderate, 11 high), while offline cached audits reported zero; detailed live advisory identity, reachability, and production/development split remain unreviewed. The full Edge run displayed 15/15 PASS, then Playwright lingered only during Windows dev-server teardown and was manually stopped; no listeners remained. Both caveats remain explicit.

The integrated [Run 2 Report](./BUILD-RUN-2-REPORT.md), [Executive Verdict](./run-2/00-executive-verdict.md), [Known Limitations](./run-2/32-known-limitations.md), and separately authorized [Run 3 plan](./run-2/33-run-3-launch-plan.md) govern interpretation. Run 2 still authorizes no public traffic, live money, outbound campaign, app submission, production customer data, hiring, DNS change, or claim of calibration, demand, retention, partner intent, prevented loss, or commercial traction.

## Evidence and change control

Facts, inferences, hypotheses, and decisions must remain labeled. Vendor prices, laws, platform policies, competitor features, and source registries are rechecked before commitment. Material changes to buyer, promise, consent boundary, risk taxonomy, data retention, architecture, price, or distribution require an ADR or founder decision and an entry in the implementation report. Build status uses only: `implemented`, `implemented with mock provider`, `scaffolded`, `designed`, `blocked`, `deferred`, or `rejected`.

## Success and stop tests

Continue toward a private pilot only if paired users understand the result and take a safe action; protected people retain control; households repeat the workflow; the evaluation shows acceptable, segmented safety; support and intelligence costs leave contribution; and at least one channel produces retained use. Reposition or stop if users want only a commodity verdict, family consent/activation is weak, severe false negatives remain, costs require misleading claims or surveillance, or partners demand sensitive transaction access before product value exists.
