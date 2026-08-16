# Build Run 1 Report

Report date: 2026-08-16

Decision: **PASS for the bounded local, synthetic-data Build Run 1; FAIL for production, public beta, or first-dollar launch.**

## Executive Verdict

BoomerBuddy is worth pursuing as a **consented household scam-response service**, not as another generic AI scam detector. The local build now proves that a protected person can check suspicious text or a URL string, receive transparent rules-based guidance, keep or delete history, and deliberately involve a trusted person without granting household-wide surveillance.

The [Gauntlet Zero gate](./gauntlet-zero/45-readiness-gate.md) passed before implementation. Final frozen-tree review found no unresolved Critical or High defect within the Run 1 boundary after two High issues were corrected. This is engineering evidence, not customer, fraud-accuracy, accessibility-conformance, legal, or commercial validation.

No deployment, production credential, external outreach, submitted-URL fetch, plugin installation, purchase, payment, live messaging, app submission, or Build Run 2 action occurred. No tracked v1 file was modified, and no v1 code was imported.

## What You Found in 1.0

V1 is valuable research but an unsafe runtime foundation. Its useful assets include a broad fraud taxonomy and source registry, older-adult UX intent, learning and recovery concepts, mobile requirements, six input concepts, and extensive product experiments across 196 tracked files, 77 commits on `main`, and 143 unique commits across all refs. Those ideas remain inputs to verify, not code to inherit.

The largest liabilities were existential: public or insufficiently scoped analysis access, an admin self-promotion path, object-level authorization failures, authenticated API caching in a service worker, LLM-only judgments without a governed evaluation layer, success responses for notifications that only logged, sensitive recipient/content logging, fabricated or unsupported trust claims, and privacy behavior inconsistent with published copy. Its single-user schema also conflated identity, payment, preferences, and admin state and could not express household consent, protected status, provider-neutral entitlements, evidence provenance, or tenant boundaries.

The disposition is explicit: preserve reviewed research themes; rebuild identity, authorization, data, fraud, consent, commerce, and operations; kill fabricated proof, unsafe caching, false delivery, LLM-as-oracle behavior, and distracting breadth. See the [v1 autopsy](./gauntlet-zero/01-v1-autopsy.md) and [keep/rebuild/kill/invent record](./gauntlet-zero/02-keep-rebuild-kill-invent.md).

## What Changed

The ten most important changes to the initial thesis are:

1. **Detector to response service.** The result label is not the paid product; consented safer-action follow-through and household readiness are.
2. **AI oracle to evidence pipeline.** Deterministic signals establish the baseline, provider evidence has provenance and failure states, and optional model reasoning cannot override policy.
3. **Public persistence to member scope.** Run 1 persists Checks only for authenticated, effectively enrolled protected people; a future anonymous Check must be ephemeral and history-free.
4. **Family visibility to pairwise consent.** Household membership grants no blanket artifact access. A trusted person sees only individually shared, redacted results under an active relationship and permission.
5. **Role labels to independent protected enrollment.** Owner, payer, member, and protected person are separate. Protection requires self-consent, an exact allowance, active membership, and a currently effective backing grant.
6. **Safe word as aid, not identity proof.** Only a memory-hard verifier is stored; the feature cannot authenticate a caller or substitute for official-channel verification.
7. **URL analysis without acquisition.** Run 1 parses and scores the submitted string but performs no DNS, HTTP, preview, redirect, or browser navigation.
8. **Price claims to hypotheses.** Free, Plus, and Family values exist to test packaging; no plan is purchasable, no unit economics are observed, and `$119/year` is only a controlled founding-offer hypothesis.
9. **Broad enterprise ambition to staged distribution.** Direct paired-family validation comes first, with narrow credit-union discovery in parallel and no custom partner build or invented pipeline.
10. **Admin screens to a bounded Business OS.** HQ is a separate audience with truthful local provenance and selected operating projections; accounting, CRM, support, monitoring, and verified outcome operations remain external or deferred.

## What You Built

BoomerBuddy 2.0 is a strict-TypeScript npm-workspaces modular monolith:

| Surface              | Real Run 1 capability                                                                                                                                 | Boundary                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Fastify API          | Sessions, tenant/object policy, Check, Family, orientation, entitlements, HQ projections, retention, audit/outbox                                     | Development identity and local providers only                                |
| Customer Next.js web | Public explanation/pricing plus Home, Check, History, Family, and Orientation                                                                         | Persisted Check requires a seeded member persona                             |
| Expo mobile          | Sign-in, household selection, Check/result, History, Family, Orientation, shared contracts/tokens                                                     | Source and web export verified; native device/share integration not verified |
| Separate Next.js HQ  | Overview, Customers, Fraud/review, Revenue, System/audit with role-scoped routes                                                                      | Seeded/local data; not a production operations console                       |
| Shared packages      | Domain, contracts, authorization, security, fraud, persistence, config, observability, design, evaluation, and test utilities                         | Vendor integrations stay behind ports                                        |
| Persistence          | Canonical PostgreSQL SQL migration run by PGlite locally, scoped repositories, composite constraints, encrypted content, commerce and consent records | Real PostgreSQL concurrency/backup/restore not qualified                     |

The Check slice minimizes restricted input before analysis or storage, encrypts remaining content with context-bound AES-GCM, correlates with a purpose-scoped keyed HMAC, produces deterministic evidence/risk/actions, stores a 30-day record, supports deletion and explicit sharing, and writes content-free audit/outbox intent atomically. The only intelligence provider is visibly local/unknown.

Protected enrollment is independent of household role. The corrected projection requires active membership, accepted self-consent, an exact active protected-member allowance, and an effective backing grant. Seeded Alice is both owner and protected; seeded Bob is owner-only and cannot exercise protected workflows.

Demo data is an explicit, atomic, durable-marker bootstrap rather than a startup upsert. Marked restarts preserve deletion, revocation, disabled identities, and lapsed grants. Its occupancy preflight checks root/selected domain tables, not every standalone operational table; the exotic operational-only unmarked case remains Medium technical debt and is not described as universal empty-database enforcement.

## What Works

- Text and URL-string Check creation, result, owned/shared paginated history, direct read, deletion, and explicit redacted sharing work under selected household scope.
- URL scoring is structural and local. No submitted URL is fetched, resolved, followed, previewed, or rendered.
- Family invitation preview, explicit acceptance, single use, cancellation, pairwise consent, revocation, participant allowance reuse, and share removal are enforced locally.
- Ordered/resumable orientation and atomic safe-word configure-or-defer behavior work for seeded enrolled protected people.
- Source-neutral products, plan versions, subscriptions, grants, sponsorship, allowances, inbox deduplication, and reconciliation state support future commerce without granting relationship permission.
- Customer and HQ cookies have distinct audiences and origins; mobile uses an audience-scoped development bearer. Cross-audience, cross-tenant, cross-object, stale, revoked, and entitlement-lapse cases fail closed.
- Local retention denies expired reads, scrubs ciphertext/fingerprint/findings in bounded sweeps, removes shares, and preserves content-free tombstones.
- Web and HQ critical journeys rendered in Edge. Automated axe checks found no serious or critical violation in their covered pages, with keyboard, live-region, zoom/reflow, and reduced-motion assertions.

Final command evidence:

| Verification               | Result                                                                                                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`           | PASS: types, ESLint, Prettier, 99 unit + 18 integration + 16 security tests, 12/12 evaluation fixtures, API/web/HQ/mobile builds                                                                                                                         |
| `npm run test:coverage`    | PASS: 133 tests; 89.76% statements, 87.47% branches, 98.24% functions, 93.00% lines; configured aggregate gates are 80% statements/functions/lines and 75% branches, and each authorization/security/fraud package exceeded 80% observed branch coverage |
| Edge Playwright            | PASS: 13/13 journeys; local teardown required host cleanup after results                                                                                                                                                                                 |
| Expo Doctor                | PASS: 21/21 checks                                                                                                                                                                                                                                       |
| Frozen-tree closure review | PASS: 0 unresolved Critical/High scoped defects                                                                                                                                                                                                          |
| Reference integrity        | PASS: v1 tracked tree unchanged; its pre-existing untracked `.local/` residue remains excluded                                                                                                                                                           |

The Codex in-app browser could not navigate to local loopback after entering its internal error page because its URL policy then blocked further navigation. No workaround was attempted. The configured Edge suite rendered and asserted all 13 journeys, so this is recorded as a host/tool limitation rather than product proof or a product defect.

## What Does Not Yet Work

The following are not production-ready, even where an interface or local fixture exists:

- managed identity, MFA/step-up, recovery, verified invitation delivery/binding, production sessions, KMS custody/rotation, and production secret management;
- a general identity-bound protected-enrollment/withdrawal HTTP journey and durable append-only consent registry;
- live reputation/model evidence, a representative licensed double-reviewed corpus, empirical calibration, production thresholds, or any supported detection/prevention-rate claim;
- native iOS/Android device behavior, share extensions/intents, notifications, deep links, app packaging, or store commerce;
- real checkout, billing authenticity, renewals, refunds, cancellation, receipts, taxes, accounting, payment/provider reconciliation, email, SMS, push, CRM, or sponsor eligibility feeds;
- durable multi-instance retention/outbox workers, dead-letter/replay controls, PostgreSQL concurrency/migration/backup/restore evidence, monitoring/on-call, incident drills, full export/erasure, and production support operations;
- verified safe-action completion, time-to-first-safe-action, retention, revenue, contribution, or partner-outcome measurement in HQ;
- automatic invitation-expiry/consent cleanup, request-level Check idempotency, complete denial auditing, and real provider/store lifecycle deadlines; and
- compatibility remediation for the dependency audit: production dependencies report 0 critical, 11 high, 7 moderate, 0 low advisories; the full tree adds 1 low. Forced incompatible downgrades were rejected.

No native/device, customer, external accessibility, penetration, legal, privacy, or commercial validation was performed. More detail is in [Known Limitations](./build-run-1/12-known-limitations.md), [Deferred Integrations](./build-run-1/13-deferred-integrations.md), and [Technical Debt](./build-run-1/14-tech-debt.md).

## Commercial Model

The recommended test remains recurring household coordination, not a paid classifier:

| Offer                | Working hypothesis                                                                              | Confidence                          |
| -------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------- |
| Free                 | Useful result and urgent actions; one protected adult; no trusted participant allowance         | Low; no behavioral evidence         |
| Plus                 | `$8.99/month` or `$89/year`; one protected adult and two Trusted Circle participants            | Low; not purchasable                |
| Family               | `$14.99/month` or `$149/year`; up to three protected adults and six Trusted Circle participants | Low; hero paid hypothesis           |
| Founding Family test | `$119/year`, only as a transparent controlled offer                                             | Very low; not a list-price decision |

Run 1 proves that plan/source-neutral entitlements and exact allowances can be enforced. It proves no willingness to pay, acquisition cost, churn, refund/support load, usage quota, fraud-provider cost, or contribution margin. The first commercial evidence should be paired problem interviews, transparent offer tests, and only later a small paid beta after the first-dollar safety gate.

## Moat

The code and a scanner are not a moat. Defensibility could compound from:

1. a rights-cleared, independently adjudicated fraud-and-safe-action corpus with reproducible provider/rules comparisons;
2. consented household activation and repeated safe-action workflows that remain useful without surveillance;
3. high-quality safety review, recovery, incident learning, and deletion/consent operations;
4. trusted distribution agreements with measured activation and retention;
5. recurring, reconciled family/sponsor revenue and a credible trust/accessibility/security record.

Raw sensitive submissions, unvalidated prompts, synthetic fixtures, seeded pipeline, vanity counts, or proprietary-looking UI are liabilities or replaceable features. Run 1 created foundations for these assets but none of the scarce market assets themselves; see [Strategic Value](./STRATEGIC-VALUE.md).

## B2B2C

The highest-leverage first hypothesis is a standardized paid credit-union design-partner evaluation: a member benefit outside core transaction monitoring, activated without bank transaction access, with sponsor isolation, aggregate/small-cell-safe reporting, and explicit success criteria. This is a discovery hypothesis, not a lead, relationship, quote, or commitment.

Later candidates are employee caregiver benefits, financial advisers, insurers, telecom/consumer-security providers, and senior/caregiver platforms. Each requires observed household activation, outcome evidence, security/accessibility diligence, partner support economics, contract/data-rights controls, and a reusable implementation. The source-neutral sponsor/grant model supports this direction; no external partner integration exists.

## HQ

HQ now exists as a separate employee application and session audience. It shows truthful local overview counts, household/entitlement/orientation projections, content-free fraud review metadata, explicitly fictional revenue research fixtures, provider state, and metadata-only audit events. An HQ reviewer sees only the review surface; customer authority never becomes employee authority.

It does not yet operate support cases, restricted/time-bound content access, human fraud adjudication, jobs/replay, incidents, provider uptime, partner reporting, commerce reconciliation drill-down, CRM, accounting, or verified north-star outcomes. The direction is a thin operating layer over differentiated safety and consent workflows, not a custom replacement for every commodity business system.

## Security / Fraud Safety

Implemented controls include deny-by-default current-state authorization, exact origin/audience binding, scoped repositories and composite tenant constraints, pre-analysis secret minimization, bounded bodies, context-bound AES-256-GCM, purpose-scoped HMAC fingerprints, scrypt safe-word verifier storage, content-free logs/audit/outbox, explicit retention/deletion, production startup refusal, and no URL network access. A user-facing safe-word verification, throttling, and recovery ceremony remains deferred.

Independent review found and fixed two High defects:

1. **Protected authority was incorrectly represented by an exclusive membership role.** This made owner-plus-protected impossible and left allowance/consent enforcement vulnerable to role semantics. Independent enrollment, self-consent, exact protected allowance linkage, grant-backed current projection, schema triggers, and negative owner-only tests now enforce it.
2. **Default reseeding could resurrect deleted or revoked local state.** Seeding is now opt-in, atomic, insert-only for the checked domain baseline, and durable-marker controlled. Persistent tests mutate/revoke/delete, restart twice, and compare the structured state exactly. The narrower operational-only preflight caveat remains documented.

Fraud output is a transparent deterministic baseline, not an oracle. The 12-case synthetic suite passed with zero forbidden-action violations and exercised a provider failure, but it is single-author and explicitly `not_calibrated`. The local provider returns unknown; no accuracy, prevention, or safety-rate claim is supported.

## Costs

The likely largest cost centers are human research/support/fraud operations, acquisition and distribution commissions, independent security/privacy/accessibility work, payment/store fees, and production reliability—not baseline text-model tokens. Required first-dollar categories include identity/KMS, hosting/database/backups, durable jobs/monitoring, payment and tax/accounting controls, messaging, legal/privacy/security/accessibility review, and incident/support ownership.

At roughly 100 families, add a real support workflow, restore drills, fraud-review cadence, product analytics, spend alerts, and a larger evaluation set. At 10,000, expect dedicated safety/customer operations, formal on-call/compliance, stronger database/telemetry, vendor SLAs, partner reporting, and finance/data systems. All dollar bands in the [Cost Model](./COST-MODEL.md) are directional and must be repriced; Run 1 observed no production unit cost.

## Where to Spend

If the founder chooses to spend aggressively, use staged evidence gates in this order:

1. paired older-adult/adult-child research and a longitudinal pilot;
2. a rights-cleared, independently double-reviewed fraud/action evaluation corpus and tooling;
3. independent application security, privacy architecture, and threat modeling;
4. accessibility review and moderated testing with disabled older adults;
5. one commercial intelligence-source pilot measured for marginal safety lift.

Brand work, credit-union pilot design, and specialist native capture follow when preceding evidence supports them. Defer broad paid acquisition, a large sales team, overlapping feeds, bespoke partner infrastructure, and concierge staffing. See [Where to Spend](./WHERE-TO-SPEND.md).

## Five Largest Risks

1. **Harmful false assurance:** a missed scam or unsafe recommendation can accelerate financial/identity harm and destroy trust.
2. **Consent, privacy, or family abuse:** a breach, coercive enrollment, or surveillance-like sharing would violate the product promise and create legal/reputational exposure.
3. **No durable paid demand:** households may use free general AI or a commodity scanner and decline to pay for coordination; willingness to pay and retention are unobserved.
4. **Production assurance gap:** identity/KMS, dependencies, native behavior, durable data/worker operations, privacy lifecycle, incident response, and external review are incomplete.
5. **Distribution and positioning failure:** the name may repel users, direct acquisition may be costly, and partner cycles/custom demands may consume runway before repeatable activation.

## Founder Decisions

Five choices remain genuinely human:

1. keep or replace the BoomerBuddy name after audience testing and preliminary trademark review;
2. approve launch packaging/pricing only after evidence, including whether `$119/year` is worth a controlled test;
3. choose the direct-family versus partner-discovery time allocation;
4. decide whether a staffed Safety Setup fits the company after self-serve results and liability/economics are known; and
5. set the external investment envelope and authorize research, vendors, hiring, or commitments.

None blocks internal local work. Brand/pricing block public paid use; outreach, purchases, vendors, hiring, and external commitments require explicit authorization. Production safety gaps remain evidence gates, not documentation that the founder should simply waive. The full alternatives and tradeoffs are in [Founder Decisions](./FOUNDER-DECISIONS.md).

## Run 2

Do not start Run 2 automatically. Recommend a separately approved, evidence-led scope:

1. conduct paired protected-person/payer task research, name testing, and transparent offer interviews;
2. design and test a real identity-bound protected-enrollment, consent-withdrawal, and recovery journey without weakening independent agency;
3. expand the fraud/action corpus with rights-cleared examples, two reviewers and adjudication, sealed cases, subgroup reporting, and declared release thresholds; compare one reputation provider while keeping submitted-URL fetching prohibited;
4. instrument verified safe-action completion and time-to-first-action without relabeling clicks as outcomes;
5. validate Expo flows on Android and iOS, then prototype user-invoked share capture only if task research supports it;
6. qualify a production-like foundation—managed identity/KMS design, real PostgreSQL migration/concurrency/backup/restore, durable jobs/privacy operations, dependency remediation, and one measured provider comparison—without public launch.

Exit only with documented customer evidence, stronger safety evidence, consent usability, native findings, and an updated first-dollar gap. Do not add image/audio/live-call breadth, broad gamification, production billing, or custom partner work merely to increase feature count. See [Run 2 Recommendation](./build-run-1/15-run-2-recommendation.md).

## Agent Activity

The run used **15 distinct subagents/workstreams: 13 direct and 2 nested**. Roles were source-control conventions; v1 autopsy; commercial/market research; technical foundation; nested integration decisions; independent readiness-gate review; nested commerce/database audit; build blueprint; core implementation; frozen-tree closure audit; foundation documentation; product/business/HQ documentation; final evidence/limitations documentation; founder-report reconciliation; and a final read-only handoff audit.

Material disagreements were resolved in favor of safer, narrower claims:

- pre-account persisted Check versus member-only persistence → member-only in Run 1;
- raw content hash versus a purpose-scoped keyed fingerprint → keyed HMAC;
- “calibrated” confidence versus authored fixtures → explicitly not calibrated;
- role-derived protected status versus independent self-consent/allocation → independent enrollment;
- convenient startup reseeding versus preservation of revocation/deletion → one-shot marked bootstrap;
- interaction clicks versus verified safe action → do not fabricate the north-star metric; and
- “build passed” versus “launch ready” → local Run 1 PASS and first-dollar FAIL remain separate.

Independent review produced the two High fixes described above, additional negative authorization and persistent-restart regressions, and the final 0-Critical/0-High scoped verdict. Medium/deferred findings remain explicit rather than being polished away.

## Files Created

Major artifacts are:

- contributor and operator entry points: [`AGENTS.md`](../AGENTS.md), [`README.md`](../README.md), `.env.example`, workspace/tooling configuration, and the pinned lockfile;
- four runtimes under `apps/api`, `apps/web`, `apps/hq`, and `apps/mobile`;
- shared packages under `packages/` for domain, contracts, authorization, security, fraud, persistence, config, observability, design, evaluation, and test support;
- canonical migration and local scripts under `packages/persistence/migrations/` and `scripts/`;
- unit, integration, security, evaluation, Edge, and accessibility evidence under `packages/**/*.test.ts` and `tests/`; and
- this report plus the 16-part evidence set indexed below.

No tracked file under `reference/boomerbuddy-v1/` was created or edited, and no v1 code was imported into 2.0. The known pre-existing untracked v1 `.local/` tooling residue remains outside product evidence.

## Commands

Run from the repository root in PowerShell with Node 22.13+ and npm 10.9+.

Install and configure local development:

```powershell
npm install
Copy-Item .env.example .env
npm run db:migrate
npm run db:seed
```

Start API, customer web, and HQ together (ports 4000, 3000, and 3001):

```powershell
npm run dev
```

Or run the services in separate terminals:

```powershell
npm run dev:api
npm run dev:web
npm run dev:hq
```

Start Expo separately where a suitable native toolchain is available:

```powershell
npm run dev:mobile
```

Execute the complete static/test/build gate, then the checks not included in it:

```powershell
npm run verify
npm run test:coverage
npm run test:e2e
npm run test:eval
npm run audit:deps
npm run doctor -w @boomerbuddy/mobile
```

On the constrained Codex Windows host only, resolve the checked-in host shim before Playwright because child working directories can vary:

```powershell
$bbShim = (Resolve-Path .\tests\e2e\os-userinfo-host-shim.cjs).Path
npx cross-env "NODE_OPTIONS=--require=$bbShim" npm run test:e2e
```

`npm run verify` does not include Playwright, coverage, dependency audit, or Expo Doctor. The audit command is expected to remain nonzero while High advisories exist; do not force incompatible downgrades.

## Evidence Index

- [00 — Build Summary](./build-run-1/00-build-summary.md)
- [01 — Architecture as Built](./build-run-1/01-architecture-as-built.md)
- [02 — Repository Map](./build-run-1/02-repository-map.md)
- [03 — Local Development](./build-run-1/03-local-development.md)
- [04 — Security Review](./build-run-1/04-security-review.md)
- [05 — Authorization Review](./build-run-1/05-authorization-review.md)
- [06 — Fraud Evaluation Results](./build-run-1/06-fraud-evaluation-results.md)
- [07 — Accessibility Review](./build-run-1/07-accessibility-review.md)
- [08 — Product Review](./build-run-1/08-product-review.md)
- [09 — Business Model Review](./build-run-1/09-business-model-review.md)
- [10 — HQ Review](./build-run-1/10-hq-review.md)
- [11 — Test Results](./build-run-1/11-test-results.md)
- [12 — Known Limitations](./build-run-1/12-known-limitations.md)
- [13 — Deferred Integrations](./build-run-1/13-deferred-integrations.md)
- [14 — Technical Debt](./build-run-1/14-tech-debt.md)
- [15 — Run 2 Recommendation](./build-run-1/15-run-2-recommendation.md)
