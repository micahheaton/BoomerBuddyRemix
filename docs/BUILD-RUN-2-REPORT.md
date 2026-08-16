# Build Run 2 Report

Status: **FINAL — bounded Run 2 PASS; no launch or first-dollar authorization**
Report date: 2026-08-16

Run 2 moved BoomerBuddy from a coherent local product slice to a broader, staging-oriented commercialization foundation. The honest verdict is **substantial local implementation, incomplete external proof**. This report uses `implemented`, `implemented with mock provider`, `scaffolded`, `designed`, `blocked`, `deferred`, and `rejected` as defined in the [Master Spec](./BOOMERBUDDY-2.0-MASTER-SPEC.md). It does not convert a scaffold, fixture, focused test, or documented policy into a production result.

## What changed

The material Run 2 delta is a safer and more commercially explicit system boundary:

- **Implemented:** neutral membership; independent administrator, payer, billing, protected-person, Trusted Circle, and support facts; append-only consent evidence and current projection; allowance reconciliation without implied authority.
- **Implemented/scaffolded:** Public Check, provider-data policy, typed redaction, evaluation governance, Stripe test architecture, durable jobs/outbox, acquisition/lifecycle/referral/content contracts, credit-union import, owner HQ, attention/brief, and automation policy history.
- **Documented:** portable production hypothesis, privacy/security and recovery gates, direct-versus-sponsored metric definitions, 50K economics, staged staffing, founder dependency, known limitations, and a no-launch Run 3.

The [review adjudication](./run-2/01-external-review-adjudication.md) accepted findings with implementation-specific modification rather than treating external prose as authority. The [dated spec delta](./run-2/02-master-spec-changes.md) preserves the constitutional boundaries from Run 1.

## What now works

Focused local evidence supports the following bounded claims:

| Capability | Evidence-backed claim | Boundary |
| --- | --- | --- |
| Authority and consent | Server-side tenant/object checks, orthogonal roles, protected allowance binding, invitation/withdrawal, append-only evidence | Development identities and synthetic people only |
| Check and redaction | Text/URL-string normalization, bounded typed redaction, evidence/action result, content-minimized persistence | No live reputation/model provider; URLs are never fetched |
| Public Check | Short-lived context, quotas, content-free attribution, three-check/save limits, consented one-time save, terminal purge | No internet traffic or edge bot proof |
| Commerce | Server-created Stripe Checkout intent, signed raw webhook, strict invoice lineage, canonical lifecycle/grants/allowances, refund/dispute restrictions, reconciliation jobs | Closed for bounded local scope; external Stripe account evidence absent |
| Data and jobs | Canonical PostgreSQL migrations, PGlite local execution, leases/heartbeats/receipts/retry/dead letter/replay/retention contracts | No hosted multi-instance or restore evidence |
| B2B/HQ | Provenance-bound NCUA import, local opportunities/next actions, owner attention/brief/autonomy projections | No contacts, intent, outreach, contracts, or revenue |
| Operating models | Deterministic economics/workload calculations and explicit founder/staffing assumptions | No observed production cohort or queue |

The definitive independent review found no unresolved in-scope Critical or High defect. Frozen local evidence is:

| Gate | Result | Honest boundary |
| --- | --- | --- |
| Static quality | Full workspace typecheck, ESLint, and Prettier PASS | Local toolchain only |
| Test suite | `npm test` PASS: unit 15 files/134 tests; integration 13/60; security 5/17; evaluation 12/12 | Evaluation recorded zero forbidden actions, one provider failure, and `not_calibrated` |
| Coverage | 33 files/211 tests; statements 89.12%, branches 84.69%, functions 97.93%, lines 93.02% | Aggregate code coverage is not safety efficacy |
| Production builds | API, worker, web (13 static pages), HQ (11), Expo web export (355 modules) PASS | No deployed host or native device build |
| Edge browser | 15/15 displayed PASS, including Public Check, Family closure, and axe | On Windows, Playwright lingered only in dev-server teardown; it was manually stopped and no listeners remained |
| Portability/dependencies | Portability inventory PASS; offline production and full-tree npm audits reported zero vulnerabilities across 1,173 dependencies | No live-registry audit, SBOM/license/provenance review, remote CI, or container scan |

Detailed status and test references live in [Run 2 documents 03–31](./run-2/03-domain-model-corrections.md) and the integrated [limitations register](./run-2/32-known-limitations.md). These gates close bounded Run 2 implementation, not production or launch evidence.

## What remains mocked

`implemented with mock provider` applies to development HMAC identity, local fraud/provider observations, Stripe transport and signed fixtures, synthetic customer/HQ/commerce data, and local database execution. The two curated FTC assets are source-verified drafts, not a production knowledge base. Apple and Google are typed commerce/policy contracts without products, agreements, verification, purchase UI, or device tests.

The following are foundations rather than operating engines: content has provenance/review records but no body generation or publishing; referrals have state and abuse holds but no reward issuance; lifecycle has deterministic plans but no event wiring/sender; acquisition has content-free facts but no analytics vendor/CAC ledger; B2B has opportunities but no contact/enrichment/mail/calendar/contract path. No fixture is reported as delivery, demand, revenue, accuracy, or traction.

## Replit risk

The codebase is portable in design: standard Node 22/npm workspaces, environment contracts, PostgreSQL migrations, container files, compose, deployment scaffolds, and provider ports. The portability verifier reports no required Replit import. That reduces source/runtime coupling but does not yet prove survival of permanent Replit loss.

Required external proof remains a founder-controlled canonical remote, protected release history, independent encrypted source backup, company-owned secrets and identity, independently restorable PostgreSQL/object data, DNS custody, build ownership, and a timed clean-room drill. The [continuity plan](./run-2/REPLIT-CONTINUITY-PLAN.md) assigns those steps; no claim of completed remote restore or RPO/RTO is made.

## Hosting

The selected hypothesis is separate Vercel web/HQ projects, Render API/worker, Neon PostgreSQL, managed identity, Cloudflare DNS, reviewed S3-compatible object storage, Sentry/PostHog, Postmark/Twilio, and Expo/EAS where mobile is authorized. Repository configuration and container definitions are `scaffolded`; accounts, DPAs, regions, budgets, credentials, networks, backups, alerts, and deployed builds are `blocked`.

Production startup deliberately rejects development identity/KMS behavior. PGlite proves canonical schema behavior locally but cannot prove pool sizing, locking, point-in-time restore, regional failure, or multi-worker semantics. See [platform](./run-2/05-production-platform.md), [data/jobs](./run-2/24-production-data-and-jobs.md), and [CI/deployment](./run-2/28-ci-and-deployment.md).

## Payments

Web commerce has the right local shape: the server chooses plan/price and creates a pending binding; the webhook verifies the raw body, size, signature, age, mode, and API version; an idempotent inbox applies canonical lifecycle and entitlements; ambiguous or recoverable evidence queues reconciliation; refunds/disputes restrict access; and allowances reconcile independently of consent.

It has not exercised a Stripe-owned test account, actual Checkout/portal, provider delivery, tax/dunning configuration, settlement, refund, dispute, or bank ledger. The closed local invariant prevents status snapshots from extending service and requires authenticated `invoice.paid` evidence with strict legacy/modern lineage, complete lines, paid status, expected price/subscription identity, and exact invoice-line/subscription-snapshot service-period equality before renewal/recovery advances a period. Initial server-bound activation may establish a period; later status may restrict or shorten but not extend it. Old invoice/current-cycle mismatches are quarantined. The definitive reviewer closed this High with no unresolved in-scope Critical/High finding. Apple/Google commerce remains blocked by current storefront analysis, organization accounts, agreements, products, server notifications, devices, and macOS/Xcode evidence. See [commerce](./run-2/07-commerce.md) and [mobile commerce](./run-2/08-mobile-commerce.md).

## Public Check

Public Check is implemented as an acquisition-safe boundary, not an unrestricted public endpoint. A server-minted anonymous context lasts ten minutes, permits three checks, grants a 15-minute conversion window, and can save once only after authentication and explicit consent. Analytics/attribution exclude content, URL, host, query, and free text; terminal payload is physically purged after its maximum horizon. Submitted URLs are parsed but never fetched.

Missing public-edge evidence is material: per-client and distributed rate limits, bot/challenge controls, IP/privacy policy, CDN/proxy behavior, global quota coordination, production disclosures, load/abuse testing, and conversion measurement. These stay `blocked`, not silently assigned to the application global quota. See [Public Check](./run-2/12-public-check.md) and [attribution](./run-2/13-acquisition-attribution.md).

## Fraud

The fraud boundary distinguishes deterministic signals, provider observations, inference, evidence, risk, action, and uncertainty. A central least-data dispatcher provides only allowlisted representations to typed provider roles. Bounded secret classes can be redacted before persistence/provider use; private keys, ambiguous credentials, unsafe URL forms, and unsupported inputs remain rejected. Provider failure cannot become false reassurance.

The current 12 synthetic, project-authored cases demonstrate evaluation plumbing and zero prohibited-action violations in that set. They do **not** support sensitivity/specificity, calibration, population performance, prevented loss, or comparative superiority. Two FTC-based source records are governed drafts, and V1 is not a runtime dependency. A rights-cleared, representative, independently double-reviewed corpus and any live provider marginal-lift test remain blocked. See [provider architecture](./run-2/09-fraud-provider-architecture.md), [knowledge](./run-2/10-v1-knowledge-curation.md), and [evaluation](./run-2/11-evaluation.md).

## B2C engine

The consumer growth foundation now separates touchpoints from content and artifact authority. It can record content-free Public Check starts/completions/save handoffs, referral states/holds, governed content metadata, lifecycle plans/suppressions, customer-health signals, and a six-step protected-member orientation with a memory-hard safe-word verifier and synthetic practice.

No campaign was sent, content published, reward issued, user invited externally, acquisition invoice reconciled, or lifecycle message delivered. No older adult or paired family completed moderated research. Consequently activation, comprehension, repeat use, retention, conversion, channel CAC, Family value, and willingness to pay remain unknown. See [content](./run-2/14-content-engine.md), [referrals](./run-2/15-referrals.md), [lifecycle](./run-2/18-customer-lifecycle.md), and [orientation](./run-2/19-member-orientation.md).

## B2B engine

The importer records the official NCUA 2026-03-31 archive with SHA-256 `6D7FDF1E7EAF9078B33A498BE966163E07E368949DBBDF3736527842C51F7567`: 4,250 federally insured credit unions, 145,766,660 memberships, and 748 institutions with at least $500 million in assets. Import is idempotent and provenance-bound; the segmentation is a fit hypothesis.

Owner-only opportunity stages, next actions, staleness, audit, and outbox facts work locally. There are no verified contacts, enrichment licenses, outreach permissions, mail/calendar/CRM connections, replies, discovery calls, proposals, partner reporting, contracts, sponsored activations, receivables, or revenue. Institution counts must never be called leads, pipeline, or intent. See [NCUA importer](./run-2/16-credit-union-lead-engine.md) and [B2B revenue engine](./run-2/17-b2b-revenue-engine.md).

## HQ

HQ remains a separate audience and exposes bounded owner views for overview, institution targets, opportunities, attention, autonomy, and an on-demand brief. Business OS routes remain owner-only; reviewer access is narrower. Attention deduplicates evidence and the brief reports five local operating projections without inventing deltas.

HQ does not yet provide delegated queue operations, customer support case controls, privacy fulfillment, content approvals, detailed commerce operations, accounting close, external delivery, or integrated analytics. Many schema foundations have no product surface. It is an owner control plane for local evidence, not a production company operating system. See [HQ](./run-2/20-hq-business-os.md), [attention](./run-2/21-owner-attention.md), and [brief](./run-2/22-owner-brief.md).

## Autonomy

Every recurring workflow is classified `AUTO`, `APPROVAL`, `HUMAN`, or `PROFESSIONAL`. Nine code-owned `AUTO` tuples cover narrow reversible internal work; policy version/history and evaluated-run evidence persist. The global stop defaults engaged, evaluation executes nothing, and unlisted or consequential actions—including outreach—are denied.

There is no live scheduler, external-tool executor, agent delegation roster, approval delivery, or unattended history. Automation therefore reduces ambiguity, not current payroll. The [Autonomy Matrix](./run-2/AUTONOMY-MATRIX.md) is a safety contract; it is not a claim that the company runs itself.

## Humans

Human accountability cannot be replaced by a route or agent label. Before first dollar, named primary/backup owners are needed for customer support, Trust & Safety review, incident command, privacy requests, identity recovery, billing reconciliation/refunds, accessibility support, and vendor failure. Qualified professionals remain necessary for legal/privacy, tax/accounting, security testing, employment, insurance, accessibility, and fraud-corpus adjudication.

No one was hired, contracted, scheduled, or promised service hours in Run 2. The Philippines Data Privacy Act leaves controllers responsible for outsourced processing and safeguards ([NPC Act](https://privacy.gov.ph/data-privacy-act/)); the NPC describes DPO accountability and breach reporting ([DPO guidance](https://privacy.gov.ph/appointing-a-data-protection-officer/), [breach reporting](https://privacy.gov.ph/pips-and-pics/breach-reporting/)). Those are design inputs, not legal conclusions.

## Staffing

Hiring is driven by measured productive workload and risk, not subscriber count:

| Review point | Scenario trigger | Action boundary |
| --- | --- | --- |
| Fractional coverage | At least 60 productive queue hours/month for two consecutive months, or a safety/SLA override | Review fractional/partner coverage; no automatic hire |
| Dedicated capacity | At least 120 productive queue hours/month, plus persistent queue/SLA evidence | Review one dedicated role or equivalent vendor capacity |
| Specialist/on-call | Severity, jurisdiction, or coverage requires qualified escalation | Retain the appropriate professional/partner; do not route beyond competence |

For Philippines operations, government data are only anchors: PSA reported an August 2024 average monthly wage of ₱29,310 in NCR and ₱22,903 for NCR general office clerks, while the current NCR wage order is ₱755/day from 2026-07-25 ([PSA](https://psa.gov.ph/statistics/occupational-wages-survey/node/1684081185), [NWPC](https://nwpc.dole.gov.ph/ncr/)). Offers require current quotes and counsel, plus statutory benefits, entity/EOR/BPO classification, processor terms, managed devices, least privilege, QA, breach escalation, and overlap with the accountable U.S. owner. Full detail: [Staffing and Philippines Operations](./run-2/STAFFING-AND-PHILIPPINES-OPS.md).

## Economics

The [50K Subscriber Model](./run-2/50K-SUBSCRIBER-MODEL.md) is a sensitivity model, not a forecast. It keeps direct paid households, protected members, sponsor-eligible members, sponsor-activated households, and revenue-bearing equivalents separate.

Base assumptions are 30% Plus/70% Family, 60% annual/40% monthly billing, 25% app-store/75% web checkout, 15% base store take, about 3.6% blended web payment/Billing allocation, 1.5% refunds/bad debt, 3% monthly logo churn, $35 replacement CAC, and $2.25 variable service cost per household-month. The price hypotheses are $8.99/$89 Plus and $14.99/$149 Family. Published fee references are [Stripe Payments](https://stripe.com/pricing), [Stripe Billing](https://stripe.com/billing/pricing), [Apple subscriptions](https://developer.apple.com/app-store/subscriptions/), and [Google Play service fees](https://support.google.com/googleplay/android-developer/answer/112622?hl=en).

Exact base math:

`ARPH = 12 × [(40% × $13.19) + (60% × $131 ÷ 12)] = $141.912/year`

`contribution = $141.912 − $5.108832 web fees − $5.3217 store fees − $2.12868 refunds/bad debt − $27 service = $102.352788/year`

`50K operating profit = (50,000 × $102.352788) − $4,100,000 = $1,017,639.40/year`

| Average paid households | Revenue | Contribution | Fixed-cost scenario | Operating profit/(loss) |
| ---: | ---: | ---: | ---: | ---: |
| 100 | $14,191 | $10,235 | $250,000 | ($239,765) |
| 1,000 | $141,912 | $102,353 | $450,000 | ($347,647) |
| 5,000 | $709,560 | $511,764 | $700,000 | ($188,236) |
| 10,000 | $1,419,120 | $1,023,528 | $1,050,000 | ($26,472) |
| 25,000 | $3,547,800 | $2,558,820 | $2,000,000 | $558,820 |
| 50,000 | $7,095,600 | $5,117,639 | $4,100,000 | $1,017,639 |

At the 50K fixed-cost envelope, operating break-even is about 40,058 average paid households; the $1 million threshold is about 49,828. Plausible independent changes to service cost, store take, CAC, or recognized price each miss the $1 million target. No paying cohort, observed churn, CAC, support-time study, vendor invoice, sponsor contract, or willingness-to-pay result exists.

## Founder time

The [Founder Dependency Model](./run-2/FOUNDER-DEPENDENCY-MODEL.md) turns recurring workflows into a transparent scenario. Current modeled founder work is 205.5 hours/month, normalized to a score of 100. A target design assigns routine internal work, explicit human queues, and professional duties while preserving 42 hours/month of high-value founder product/safety, capital, partnership, and culture work. Target founder time is 49.18 hours/month and score 24.

This is a design target, not measured improvement. The repository has no four-week time study, filled job, delegated staff owner, queue SLA history, or founder-absence drill. No workflow should be called founder-independent until its named owner, backup, evidence, budget, escalation, and absence behavior have operated.

## Blockers

| Category | Blocking evidence/action | Owner class |
| --- | --- | --- |
| Accounts/platform | Company remote, DNS, hosting, managed PostgreSQL/object storage, identity/KMS, telemetry, messaging, commerce/intelligence sandboxes | Founder-authorized operators |
| Recovery/operations | Real restore, PostgreSQL locking/pool proof, multi-worker soak, alerts, incident/support owners and backups | Engineering + humans |
| Devices/stores | Supported iOS/Android matrix, macOS/Xcode, developer organizations, agreements, product/server notification proof | Founder + mobile/store specialists |
| Product evidence | Paired-family research, name/price/comprehension/activation/retention evidence, disabled-older-adult accessibility audit | Research/accessibility professionals |
| Safety evidence | Rights-cleared representative double-reviewed corpus, release thresholds, provider marginal lift, incident learning | Fraud professionals |
| Legal/finance | U.S. consumer/privacy/marketing/auto-renewal terms, tax/accounting, insurance; Philippines employment/privacy/security if used | Qualified professionals |
| Founder choices | Geography, brand, price/package, channel/device order, support hours, risk thresholds, capital envelope, GTM priority | Founder |

There is no unresolved in-scope Critical or High local defect. The full external list is in [Known Limitations](./run-2/32-known-limitations.md). External participants, account state, professional opinions, and device results must remain `blocked` until real evidence exists.

## Run 3

The recommended [Run 3 launch-enablement plan](./run-2/33-run-3-launch-plan.md) is separately authorized and explicitly no-launch:

1. freeze scope, reproduce the clean in-scope defect gate, and record founder budget/risk choices;
2. establish company-owned continuity, accounts, MFA/recovery, cost ceilings, and data/vendor review;
3. deploy restricted staging and prove PostgreSQL, multi-worker, backup/restore, and Replit-loss recovery;
4. prove external Stripe test-mode and managed identity; prove mobile only on authorized devices/accounts;
5. obtain independent security/privacy/legal/accessibility/fraud evidence;
6. run consented research and synthetic operating rehearsals, then replace model assumptions with measurements; and
7. assemble a dated dossier and stop at founder `GO / NO-GO / REMEDIATE`.

A `GO` decides whether to authorize a separate launch run. It does not deploy, charge, contact, publish, submit, hire, migrate, or change DNS.

## Agent activity

Run 2 used named bounded workstreams, including sequential review and remediation—not an inflated agent count:

| Workstream | Material contribution |
| --- | --- |
| `r2_review_domain` | Challenged the authority/consent and domain model |
| `r2_gate_docs` | Defined evidence gates and limitations |
| `r2_adrs` / authority lane | Recorded and implemented dated authority/provider/job/portability decisions |
| `r2_review_platform` | Reviewed platform, portability, operations, and deployment claims |
| `r2_hq_ui` | Built/reconciled the owner HQ control plane |
| `r2_customer_ui` | Built/reconciled customer and Public Check surfaces |
| `r2_integration_review` | Performed independent integrated review and raised cross-lane defects |
| `r2_commerce_entitlement_reconcile` | Fixed commerce binding, entitlement, and allowance reconciliation defects |
| `r2_worker_lease_hardening` | Hardened lease/heartbeat/receipt/outbox behavior |
| `r2_public_check_atomic_save` | Closed Public Check save atomicity/retention behavior |
| `r2_economics_staffing_docs` | Produced economics, staffing, founder-dependency, limitation, Run 3, and reconciliation evidence |
| `r2_stripe_dunning_close` | Closed earlier dunning/grace behavior and reconciled product documentation |
| `r2_platform_security_docs` | Closed the paid-through/status-extension and invoice-item-lineage proof |
| `r2_e2e_family_closure` | Corrected stale neutral-authority Edge assertions and the post-withdrawal Family UI redirect regression exposed by the full Edge run |

Material disagreements were resolved in the record: external review findings were accepted with modification rather than copied verbatim; a Docker package warning was retracted after the bundle was inspected; independent review found multiple commerce Highs and drove their closure, including a legacy-invoice-item lineage gap exposed only after an earlier author-green batch; the full Edge run exposed and closed stale authority assertions plus a Family redirect defect; and Public Check edge controls remain an external blocker rather than a local success claim.

Run 2 completion means **commercialization foundation complete within its bounded local scope**, never public launch or first-dollar approval.
