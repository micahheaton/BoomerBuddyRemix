# BoomerBuddy 2.0 Master Spec

Status: **Gauntlet Zero synthesis; implementation status must be updated after Build Run 1**  
Decision date: 2026-08-15  
Working product name: **BoomerBuddy** (not audience-tested or legally cleared)

This document is the authoritative product and system contract. Detailed evidence lives in [Gauntlet Zero](./gauntlet-zero/00-executive-verdict.md); architectural decisions live in [ADRs](./adr/). Where this document conflicts with a workstream note, this document governs until a dated amendment explains the change.

## Executive decision

Pursue a narrow proof of **consented household scam response**. Do not pursue “an AI scam detector for seniors” as the business. The urgent free job is to examine suspicious text or a URL. The paid recurring job is to help a willing protected person and people they trust move from uncertainty to a verified safer action, preserve appropriate context, and follow through.

The problem and category are real; BoomerBuddy demand, name, pricing, retention, fraud-quality advantage, and channel economics are not proven. Trend Micro already offers scanner-plus-Family-Circle functionality. Differentiation must be demonstrated through safe-action completion, private-by-default collaboration, older-adult usability, reproducible quality evidence, recovery operations, and distribution—not asserted from feature presence.

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

Key domain roles remain separate: `person`, `identity`, `payer`, `household owner`, `protected member`, `Trusted Circle member`, `organization member`, and `employee`. Age, payment, kinship, or sponsor eligibility never implies another role or permission.

The protected user’s job is: “Help me decide what to do without making me feel foolish.” The payer’s job is: “Help our family respond before panic becomes loss without turning care into surveillance.”

## Core product loop

`capture → normalize → extract deterministic signals → gather provider evidence → reason → state risk and confidence → explain → recommend verified action → optionally share/escalate → retain minimally → learn only through governed evaluation`

A result contains:

- risk represented as `lower_concern`, `caution`, `high_concern`, or `unknown`, never “guaranteed safe”;
- a coarse rules-based evidence-sufficiency/confidence band rather than false decimal precision; Run 1 labels it **not empirically calibrated**;
- evidence with type, source, acquisition time, authority, and limitations;
- plain-language reasoning that distinguishes observations from inference;
- prioritized actions with official-channel guidance and emergency recovery when relevant;
- provider/model/ruleset versions and a visible `mock`, `unavailable`, or `unverified` state;
- retention/deletion state and a security audit reference.

Build Run 1 supports text and URL strings. Image, document, QR, phone, transcript, audio, and live-call capabilities are later modalities that must clear separate consent, extraction, safety, and device tests.

## Family and consent contract

- A household is an ownership and billing boundary, not blanket visibility.
- A protected member accepts, defers, or revokes protection and sharing.
- Trusted Circle permissions are purpose-scoped, initially `receive_escalation`, `view_shared_result`, and `help_with_incident`.
- Raw artifacts are private by default. Sharing starts with a redacted result; expanded content requires explicit action.
- Invitations are expiring, single-use, role-limited, revocable, and audited. Local-only delivery is acceptable in Build Run 1 and must be labeled.
- Employees have no default artifact access. Future support access is queue-based, time-bound, justified, and audited.

The Family Safe Word is a social verification aid. The service stores only a salted memory-hard verifier, rate-limits attempts, never retrieves or displays the phrase, and replaces it during recovery. It is not proof that a person or voice is genuine.

## Orientation contract

Orientation is a resumable domain workflow: `not_started → in_progress → ready`, with a separate `needs_attention` condition. Steps are protection subject, Trusted Circle, safe word or informed deferral, practice check, capabilities/limitations, and review. Practice artifacts are labeled and excluded from real fraud metrics. Readiness remains descriptive; it cannot imply a household is scam-proof.

## Surfaces and information architecture

### Customer web

Public: home, how it works, pricing hypothesis, trust boundaries, and Check entry. In Build Run 1 the entry leads to development sign-in; persisted Checks are member-only. A future anonymous Check must be ephemeral/no-history under a server-minted anonymous context. Member navigation is limited to `Home`, `Check`, `History`, and `Family`; orientation is a guided task and recovery starts from a result. No testimonials, ratings, customer counts, partnerships, awards, or prevented-loss claims without evidence and permission.

### Mobile

The recurring loop is `share or paste → check → understand → act`. Build Run 1 establishes a real Expo application, shared contracts/tokens, navigation, and text/URL Check. Native share extensions/intents are not complete until device-tested; iOS validation requires macOS/Xcode.

### BoomerBuddy HQ

HQ is a separate employee application and session audience. Its first operating views cover seeded owner metrics, households/entitlements/orientation, fraud runs/review foundations, revenue pipeline, provider/job health, and audit events. It is not a replacement for accounting, payroll, email automation, or a full CRM.

## Commercial contract

Packaging is a hypothesis:

| Offer | Working boundary | Hypothesis |
|---|---|---:|
| Free | Useful complete result, urgent actions, limited history/collaboration | $0 |
| Plus | One protected adult, two Trusted Circle participants | $8.99/month or $89/year |
| Family | Up to three protected adults, six Trusted Circle participants | $14.99/month or $149/year |

`$119/year` may be tested only as a controlled founding offer. No plan promises unlimited costly use. Sponsored pricing and credit-union pilots are discovery hypotheses, not quotes or relationships. Provider-neutral entitlements—not payment-provider fields—govern access. Production Stripe, App Store, Play, taxes, refunds, cancellation, and reconciliation are excluded from Build Run 1.

## Canonical domain model

The initial bounded modules are:

- **Identity and access:** person, identity, session, role, employee assignment.
- **Household:** household, membership, protected member, Trusted Circle relationship, invitation, consent, safe-word verifier.
- **Check:** artifact, normalized artifact, signal, provider observation, analysis run, decision, action, feedback, retention state.
- **Orientation:** workflow, versioned steps, completion/readiness state.
- **Commerce:** product, plan, subscription, entitlement, seat, protected-member allowance, provider event.
- **Sponsor:** organization, eligibility, sponsored entitlement, aggregate-reporting policy.
- **Operations:** audit event, outbox event, job, review case, provider health, support/revenue reference.

Every sensitive resource carries a household or organization boundary. Foreign keys, uniqueness, lifecycle constraints, and repository filters enforce that boundary; application code alone is insufficient. IDs are opaque. Events use a versioned envelope with event ID, type/version, aggregate ID/type, tenant, actor, correlation/causation, occurred time, data classification, and payload.

## Security, privacy, and safety boundary

- Deny by default. Authorization evaluates actor, session audience, role, action, tenant, resource ownership, consent, and entitlement.
- The client never submits a trusted actor/user ID. Build Run 1 identity uses allow-listed seeded personas. Browser sessions use distinct signed HttpOnly customer/HQ cookies. The mobile scaffold may use an opaque, expiring, revocable, audience-scoped development bearer stored with Expo SecureStore on native and memory only on web; the server resolves identity and current roles. Production mode refuses every development issuer, and native storage behavior remains device-unverified on this Windows host.
- Sensitive mutations require trusted origin/anti-CSRF controls; cookies are secure in production with explicit SameSite behavior.
- Sensitive artifact fields use authenticated encryption with a configured local key in Build Run 1. Artifact fingerprints use a separate purpose-scoped keyed HMAC—not a guessable plain content hash. Production KMS, key separation, and rotation are Run 2 requirements.
- Never deliberately persist plaintext safe words, passwords, one-time codes, private keys, payment-card/authentication credentials, or provider secrets in fields, logs, events, analytics, fixtures, or prompts. When such values are incidentally embedded in a submission, analyze transiently only as needed and reject or redact them before persistence.
- Password-like safe words use a memory-hard verifier and constant-time comparison.
- Logs, analytics, audit summaries, URLs, exceptions, and event payloads exclude artifact content, secrets, tokens, destinations, and unnecessary PII.
- Retention is explicit and deletion is testable. Evaluation fixtures are licensed/synthetic/reviewed and separated from customer submissions.
- URL input is parsed and normalized but never resolved, redirected, requested, previewed, or rendered in Build Run 1.
- Rate limits, production MFA/identity, account recovery, KMS, export, full deletion, isolated URL retrieval, external penetration testing, and incident drills block first-dollar launch even if scaffolded earlier.

## Fraud intelligence and evaluation

Deterministic rules establish a transparent baseline: urgency, secrecy, unusual payment, credential requests, remote access, authority impersonation, URL user-info/IP/homograph or structural anomalies, and related combinations. Rules do not claim universal detection. External reputation and model reasoning use provider interfaces with provenance, timeouts, error states, and evaluation gates. Local providers return visibly mock or unknown observations.

The evaluation lab versions fixtures, expected minimum risk, required/prohibited actions, taxonomy, adjudicator, rules/provider versions, and run environment. Report confusion matrix where labels support it, false-negative cases, false positives, exploratory calibration buckets, action-safety failures, latency, and coverage gaps. The initial fixture set proves harness behavior only; it neither establishes empirical calibration nor provides production-quality evidence. Any critical malicious fixture that receives harmful assurance blocks release.

## Selected architecture

- Node.js 22 and strict TypeScript in npm workspaces.
- Modular monolith API with explicit module/port boundaries; no microservices in Run 1.
- Fastify and schema-validated HTTP contracts; separate customer web and HQ applications; Expo mobile foundation.
- PostgreSQL migrations are canonical. PGlite executes the same schema for local development and tests; managed PostgreSQL is the production direction.
- Transactional audit/outbox writes occur with domain changes. Durable external workers are a later deployment concern; Build Run 1 never sends customer messages.
- Structured redacted logging, request/correlation IDs, central errors, health/readiness, and typed configuration require no production observability credentials.
- Provider ports isolate identity, commerce, reputation/model intelligence, communications, storage, analytics, and future business integrations.

See [Build Run 1 Plan](./BUILD-RUN-1-PLAN.md) and the ADR directory for decision rationale and rejected alternatives.

## Analytics and operating metrics

The north-star hypothesis is `households completing a verified safe action per active household`, paired with quality and harm guardrails. From day one measure orientation completion, first/practice/second check, Trusted Circle acceptance, time to first safe action, repeat use, deletion/revocation, evaluation performance, provider cost/latency/error, entitlement state, support minutes, refunds, and cohort survival.

No dashboard may call a warning “fraud prevented.” Sponsor reporting is aggregate, purpose-limited, and small-cell suppressed. HQ development metrics are seeded and visibly labeled.

## Accessibility and content

Target WCAG 2.2 AA as a testable floor, with at least 48px primary touch targets, readable default type, visible focus, keyboard and screen-reader semantics, 200% zoom/reflow, reduced motion, plain verbs, and no color-only status. “Senior-friendly” is not evidence; disabled older adults must complete moderated critical tasks. Every safety claim or official contact eventually needs source, jurisdiction, owner, locale, review date, expiry, and change history.

## Build/run boundaries

Build Run 1 proves architecture and one end-to-end vertical slice with seeded local data. It does not accept money, contact users, fetch URLs, use live intelligence/AI, submit to app stores, deploy, or represent mock delivery as real. Detailed scope is in [Build Run 1 Plan](./BUILD-RUN-1-PLAN.md).

First-dollar launch remains blocked by customer/name/price validation; production identity and commerce; current legal review; production retention/export/deletion; external security and accessibility review; expanded independent fraud/action evaluation; production monitoring/backups/restore; support/incident ownership; and tested vendor terms.

## Evidence and change control

Facts, inferences, hypotheses, and decisions must remain labeled. Vendor prices, laws, platform policies, competitor features, and source registries are rechecked before commitment. Material changes to buyer, promise, consent boundary, risk taxonomy, data retention, architecture, price, or distribution require an ADR or founder decision and an entry in the implementation report. Build status uses only: `implemented`, `implemented with mock provider`, `scaffolded`, `designed`, `blocked`, `deferred`, or `rejected`.

## Success and stop tests

Continue toward a private pilot only if paired users understand the result and take a safe action; protected people retain control; households repeat the workflow; the evaluation shows acceptable, segmented safety; support and intelligence costs leave contribution; and at least one channel produces retained use. Reposition or stop if users want only a commodity verdict, family consent/activation is weak, severe false negatives remain, costs require misleading claims or surveillance, or partners demand sensitive transaction access before product value exists.
