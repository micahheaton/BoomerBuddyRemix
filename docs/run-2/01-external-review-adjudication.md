# External Review Adjudication

Status: **Run 2 design gate — accepted for bounded implementation, not launch**

Decision date: 2026-08-16

Source: [independent Build Run 1 review](../external-review/BoomerBuddy-BuildRun1-Independent-Review.md). The review was checked against the [authoritative Master Spec](../BOOMERBUDDY-2.0-MASTER-SPEC.md), current migrations, runtime code, tests, Run 1 evidence, and current primary platform documentation. A disposition accepts the finding's direction; it does not convert a hypothesis, fixture, or unexecuted external journey into evidence.

## Decision summary

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | Household authority and Trusted Circle participation remain partly collapsed | **ACCEPT WITH MODIFICATION** |
| 2 | The fraud-provider interface is too lossy for future live providers | **ACCEPT WITH MODIFICATION** |
| 3 | Blanket restricted-input rejection is too aggressive | **ACCEPT WITH MODIFICATION** |
| 4 | `lower_concern` is unreachable | **ACCEPT WITH MODIFICATION** |
| 5 | The Master Spec understates the Business OS boundary | **ACCEPT WITH MODIFICATION** |
| 6 | Public ephemeral Check must become a first-class Run 2 deliverable | **ACCEPT** |
| 7 | Useful V1 knowledge is not yet a governed 2.0 asset | **ACCEPT WITH MODIFICATION** |
| 8 | Commerce needs an authentic Stripe test transaction path | **ACCEPT WITH MODIFICATION** |
| 9 | HQ is a secure shell, not yet the company operating system | **ACCEPT** |

No finding is rejected. Several are modified because the review correctly identifies a gap but either understates working Run 1 controls or overstates evidence not yet available.

## 1. Orthogonal household and Trusted Circle authority

**Disposition: ACCEPT WITH MODIFICATION**

**Evidence.** The Master says domain roles remain separate, and protected enrollment is already independent. However, `household_memberships.role` is still a single-value enum in the [initial migration](../../packages/persistence/migrations/0001_initial.sql), the [Family contract](../../packages/contracts/src/family.ts) exposes that exclusive role, and invitation acceptance in the [Family repository](../../packages/persistence/src/family.ts) rejects an existing non-`trusted_circle` member. The conflict is reproduced intentionally in the current [commerce/Family integration test](../../tests/integration/commerce-entitlements.test.ts). The review is therefore correct for an owner or protected spouse who must also be trusted by another protected person.

The correction must retain what already works: independent `protected_members`, relationship-level `trusted_circle_relationships`, one allowance allocation reused across multiple protected/trusted pairs, pairwise check sharing, and revocation that preserves an unrelated active pair.

**Required change.** Amend the Master to make household membership neutral and administration, protected enrollment, pairwise trust, payer authority, billing authority, and case-bound support delegation independent. Record ADR-0011 for orthogonal authority and ADR-0012 for consent evidence. Migrate authorization away from membership-role shortcuts; keep payer/billing/support grants incapable of conferring artifact visibility. Add topologies for two administrator/protected/trusting spouses, an adult-child payer who is trusted by a parent, one trusted person serving multiple protected people, and isolated revocation.

**External blocker.** Local schema and authorization proof is not account-blocked. Identity-bound invitations and production recovery require the selected managed-identity staging account; coercion, support delegation, and consent language require qualified privacy/legal review before launch.

## 2. Evidence-provider architecture

**Disposition: ACCEPT WITH MODIFICATION**

**Evidence.** `FraudProvider.inspect()` receives only a structural [`FeatureVector`](../../packages/fraud/src/types.ts). The [analysis pipeline](../../packages/fraud/src/analyze.ts) deliberately omits text, host, path, query, and URL from provider input, and the [fraud tests](../../packages/fraud/src/fraud.test.ts) enforce that safe Run 1 boundary. That contract cannot support domain reputation, message reasoning, organization verification, or campaign matching. It should not be replaced by one richer raw-artifact contract.

**Required change.** Amend the Master and add an evidence-provider/data-access ADR. Introduce role-specific contracts such as local signals, domain reputation, URL reputation, message reasoning, verified organization, campaign, and recovery authority. Every adapter must declare supported artifact class, exact permitted fields, egress, retention/training terms, provenance, freshness, timeout, cost/rate limits, failure state, and kill switch. A provider contributes bounded evidence; deterministic policy still controls customer actions. Tests must prove field allowlists, no accidental raw-to-all fan-out, timeouts, stale evidence, failure-as-unknown, kill switches, cost ceilings, and content-free telemetry.

**External blocker.** Live-provider quality, freshness, terms, training/retention behavior, cost, and outage behavior are **BLOCKED BY ACCOUNT / CONTRACT / DATASET** until credentials, vendor terms and a representative adjudicated corpus exist. Local mock and deterministic contract tests must not be labeled live-provider verification.

## 3. Typed sensitive-value redaction

**Disposition: ACCEPT WITH MODIFICATION**

**Evidence.** [`minimizeRestrictedInput`](../../packages/security/src/minimize.ts) detects private keys, payment cards, authorization credentials, and contextual one-time codes and rejects the whole input. [`analyzeCheck`](../../packages/fraud/src/analyze.ts) turns any detection into `restricted_input`; the [persistence security test](../../tests/security/input-persistence.test.ts) correctly proves that a rejected card value is neither persisted nor reflected. This control prevents leakage but can suppress the warning signals and safe actions needed for a scam message containing a real code or card number.

**Required change.** Add a redaction ADR and change the transient pipeline to detect, replace safely recognized spans with typed placeholders, analyze the redacted representation, persist only the redacted/minimized value when retention is justified, and tell the user what class was removed. The original must never enter logs, analytics, audit/outbox payloads, fixtures, or external provider requests. Keep hard rejection for ambiguous, non-span-local, malformed, oversized, or otherwise unsafe cases. Tests must cover overlapping matches, Unicode, URL user-info/query/fragment secrets, repeated values, false positives, signal preservation, encrypted persistence, deletion, exceptions, and every egress boundary.

**External blocker.** The local implementation is not account-blocked. Sending any customer representation to a live model or intelligence vendor remains blocked on the provider data-class decision, terms/privacy review, required consent, and evidence that originals cannot leave BoomerBuddy.

## 4. Truthful risk semantics

**Disposition: ACCEPT WITH MODIFICATION**

**Evidence.** `lower_concern` exists in the [fraud type](../../packages/fraud/src/types.ts), [Check contract](../../packages/contracts/src/checks.ts), and database risk constraint, but the [scoring branch](../../packages/fraud/src/analyze.ts) returns only `high_concern`, `caution`, or `unknown`. The [synthetic evaluation corpus](../../packages/eval-lab/src/fixtures.ts) likewise expects legitimate examples to resolve to `unknown` or `caution`. This is an unreachable state, but conservative abstention is a valid invariant rather than a reason to manufacture reassurance.

**Required change.** Amend the Master and add a risk-semantics ADR. In Run 2, no customer path may emit `lower_concern`; zero detected signals, provider `not_found`, or provider failure remain `unknown`. Retain the term only as a dormant, versioned future state with a declared evidence contract, or remove it from public/runtime schemas until independently approved. Any future activation requires affirmative, sufficiently fresh evidence, representative evaluation, explicit false-negative thresholds, qualified review, and tests that missing evidence never lowers concern.

**External blocker.** Activation is **BLOCKED BY EVIDENCE**, not code: the current 12-case, single-author corpus is explicitly `not_calibrated` in [Run 1 evaluation results](../build-run-1/06-fraud-evaluation-results.md). No safety, accuracy, or calibration claim is authorized.

## 5. BoomerBuddy-owned Business OS boundary

**Disposition: ACCEPT WITH MODIFICATION**

**Evidence.** The Master currently describes HQ as seeded metrics, household, fraud, revenue, provider/job, and audit views, then says it is not a full CRM. The [HQ repository](../../packages/persistence/src/hq.ts) contains read-only projections over households/checks plus seeded saved searches, target accounts, and opportunities. The [HQ contracts](../../packages/contracts/src/hq.ts) truthfully label these `local_development` or `seeded`, and [HQ tests](../../tests/integration/orientation-hq.test.ts) enforce audience isolation and content exclusion. The secure boundary is real; the authoritative long-term scope is underspecified.

**Required change.** Amend the Master and add a Business OS boundary ADR. HQ owns BoomerBuddy-specific customer/household, sponsor/partner, safety/activation, attribution, lead/account/opportunity, task/next-action, orientation, support/fraud case, entitlement, partner-adoption, and owner-attention context. Payroll, tax filing, accounting GL, banking, bulk contact databases, commodity messaging transport, and generic ATS remain external systems of record. Add least-privilege modules and tests for owner, customer operations, revenue operations, fraud operations, and system operations; no role or payment state grants raw artifact access.

**External blocker.** The bounded local graph is not account-blocked. Verified enrichment, communications, finance/accounting synchronization, and external systems of record remain blocked on accounts, contracts, lawful purpose/consent, data owners, and human approval policy.

## 6. Privacy-bounded public Check

**Disposition: ACCEPT**

**Evidence.** Every current `/v1/checks` operation in the [API route](../../apps/api/src/routes/checks.ts) authenticates a customer/mobile principal. The [public home](../../apps/web/src/app/page.tsx) sends Check traffic to development sign-in. The Master mentions a future anonymous ephemeral Check, but Run 1 implements no anonymous context or transient public analysis. The review correctly identifies both the implementation gap and its priority; whether it becomes the highest-converting acquisition loop remains a hypothesis to measure.

**Required change.** Make the public Check a first-class Run 2 contract and add an ephemeral-Check ADR. Use a server-minted, short-lived anonymous context; transient analysis; typed redaction; strict rate/body/concurrency/abuse limits; no durable artifact/history; no submitted content in analytics; and a useful result without forced signup. Saving requires subsequent identity, explicit consent, and a new authorized persistence action. Content-free attribution may connect the anonymous journey to orientation/Family without carrying the submission. Tests must prove no artifact/analysis retention, no content in events/logs/metrics, token expiry/replay resistance, abuse throttling, safe failure, optional-save consent, and no secret resubmission.

**External blocker.** Local functionality and abuse fixtures are not account-blocked. Production edge/rate-limit behavior, bot-defense privacy, retention assertions, acquisition performance, and moderated comprehension remain blocked on staging infrastructure and real research. No conversion or safety-effectiveness claim is authorized.

## 7. Governed V1 knowledge curation

**Disposition: ACCEPT WITH MODIFICATION**

**Evidence.** Current 2.0 runtime assets are a small signal vocabulary and twelve synthetic cases in the [evaluation package](../../packages/eval-lab/src/fixtures.ts). The V1 reference tree contains assets such as `server/seedData/scamTypes.ts` and `server/stateSourcesConfig.ts`, but no governed 2.0 taxonomy/source registry exists. The review is correct about the gap; “migration” must mean reviewed knowledge curation, never a V1 runtime dependency or bulk copy.

**Required change.** Amend the Master and add a governed-intelligence-assets ADR. Create versioned scam-family, attack-technique, channel, safe-action, recovery, explanation, and source-registry assets with provenance, license/permission, jurisdiction, review state, reviewer, effective/expiry dates, version, and active/deprecated status. Add a one-way curation tool/process, schema validation, duplicate/conflict review, deprecation tests, and a repository rule proving 2.0 runtime packages do not import `reference/boomerbuddy-v1/`.

**External blocker.** Each source's reuse rights, current official guidance, jurisdictional applicability, and expert review are **BLOCKED BY SOURCE EVIDENCE / PROFESSIONAL REVIEW** until recorded. Curated counts are not representative coverage, proprietary moat, detection accuracy, or prevented-loss evidence.

## 8. Authentic Stripe test commerce path

**Disposition: ACCEPT WITH MODIFICATION**

**Evidence.** Run 1 already separates subscription source, provider record, entitlement grant, allowance, event inbox, and reconciliation in the [schema](../../packages/persistence/migrations/0001_initial.sql). The [domain resolver](../../packages/domain/src/commerce.ts) fails closed on unverified sources, and [integration tests](../../tests/integration/commerce-entitlements.test.ts) cover lifecycle, overlap, limits, deduplication, and reconciliation using local fixtures. But [`CommerceOperationsRepository`](../../packages/persistence/src/commerce.ts) captures only `local` events; `.env.example` and [configuration](../../packages/config/src/index.ts) contain no Stripe adapter or credentials.

Stripe documents that testing environments simulate subscriptions without moving real money, webhook authenticity requires the raw payload, `Stripe-Signature`, and endpoint secret, delivery can be retried and out of order, and subscriptions are primarily asynchronous: [testing environments](https://docs.stripe.com/testing-use-cases), [webhook security and ordering](https://docs.stripe.com/webhooks), and [subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks). The requested proof is technically appropriate, but cannot be represented as externally executed without an account.

**Required change.** Amend the Master and add Stripe-adapter/mobile-commerce ADRs. Implement test-only Checkout/Billing/Customer Portal, raw-body signed webhooks, an idempotent provider inbox, version-aware lifecycle normalization, canonical grants/allowances, cancel/grace/refund/dispute/dunning states, reconciliation, and fixture parity. Preserve provider-neutral entitlements; a client success redirect or unverified event never grants access. Apple currently requires in-app purchase for unlocking app functionality subject to storefront/program exceptions ([App Review Guidelines 3.1](https://developer.apple.com/app-store/review/guidelines/)); Google Play likewise generally requires Play Billing for in-app digital functionality and directs secure-backend verification before entitlement ([Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738), [Billing integration](https://developer.android.com/google/play/billing/integrate)). Storefront and jurisdiction policy must be versioned and default-deny; Run 2 submits no app.

**External blocker.** The real journey is **BLOCKED BY ACCOUNT** until a Stripe test/sandbox account, restricted test key, webhook endpoint secret, test product/price IDs, and reachable staging callback exist. Apple/Google sandbox proof additionally requires developer accounts, agreements, store products, native signing/toolchains, and supported devices. Deterministic signed fixtures can validate code but are not an authentic external transaction.

## 9. HQ operating workflows

**Disposition: ACCEPT**

**Evidence.** HQ currently proves a separate audience/application, role-restricted projections, content-free fraud metadata, provider/audit visibility, and seeded opportunity staleness through the [HQ API](../../apps/api/src/routes/hq.ts), [HQ UI](../../apps/hq/src/components/hq-screen.tsx), [integration tests](../../tests/integration/orientation-hq.test.ts), and [browser tests](../../tests/e2e/hq.spec.ts). Those tests also explicitly call revenue data seeded and not a live CRM. There are no durable contact/lead/activity/task, customer-health, support-case, fraud-case, partner-program, or staff-work-queue workflows.

**Required change.** Under the Business OS boundary, implement BoomerBuddy-specific organizations, contacts, leads, accounts, opportunities, activities, tasks/next actions, attribution, lifecycle/health, orientation interventions, support/fraud cases, provider/job attention, and an owner queue/brief. Every item needs provenance, owner, state, due/stale semantics, audit, and bounded automation mode. Tests must cover audience/role/tenant isolation, small-cell/content exclusions, stale work, idempotent transitions, human approval for outbound action, and truthful seeded/mock/verified labels.

**External blocker.** Local workflows are not account-blocked. Live lead/enrichment data, email/SMS delivery, partner/member imports, customer outcomes, and staffing claims require accounts, contracts, lawful basis/consent, source verification, and named human owners. No automated outbound campaign is authorized in Run 2.

## Preserved Run 1 invariants

Every accepted change remains subordinate to these verified foundations:

1. modular monolith and standard PostgreSQL migrations;
2. separate customer/mobile/HQ audiences and deny-by-default server authorization;
3. strict resource ownership, independent protected enrollment, and pairwise sharing;
4. provider-neutral canonical entitlement truth;
5. transactional audit/outbox with content-free operational events;
6. encrypted, minimized, explicitly retained customer artifacts;
7. truthful `unknown`, `unavailable`, `mock`, and `not_calibrated` states;
8. no submitted-URL retrieval in the current safety boundary;
9. deterministic action policy above untrusted provider/model evidence;
10. reproducible evaluation as a release gate; and
11. production refusal while identity, key custody, privacy operations, and other launch dependencies remain local or incomplete.

This adjudication authorizes specification and bounded Run 2 implementation only. It does not authorize deployment, public launch, live money, app submission, customer contact, paid provisioning, production credentials, automated publishing/outbound messaging, V1 user migration, or any claim of fraud prevention, accuracy, calibration, customer adoption, or economic performance.
