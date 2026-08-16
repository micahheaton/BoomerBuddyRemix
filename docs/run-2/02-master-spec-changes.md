# Master Spec Changes

Status: **Run 2 authority-change ledger; design decisions are not implementation claims**

Amendment date: 2026-08-16

The [BoomerBuddy 2.0 Master Spec](../BOOMERBUDDY-2.0-MASTER-SPEC.md) remains authoritative. This ledger explains its Run 2 amendment and does not supersede it. The change set responds to the [independent review](../external-review/BoomerBuddy-BuildRun1-Independent-Review.md), the evidence-backed [review adjudication](./01-external-review-adjudication.md), and the as-built limits in the [Build Run 1 Report](../BUILD-RUN-1-REPORT.md). Architectural consequences require dated records in the [ADR index](../adr/README.md); an accepted design is not `implemented` until its code and evidence gates pass.

## 1. Executive decision and founder outcome

**Evidence and rationale.** Run 1 proved a local architecture, while the [business-model review](../build-run-1/09-business-model-review.md) found willingness to pay, customer outcomes, and first-dollar readiness blocked. Run 2 needs a commercial target without turning a target into traction.

**Prior rule.** Pursue a narrow proof of consented household scam response; production commerce and launch were outside Run 1.

**New rule.** Treat the product as a commercialization candidate and authorize a staging-ready foundation. Model approximately 50,000 revenue-bearing subscribers or equivalents and approximately $1 million in sustainable annual owner-level operating profit as scenarios only. Count direct subscribers, paid households, protected people, sponsor eligibility, sponsor activation, and revenue-bearing equivalents separately.

**Preserved invariants.** The buyer, name, price, demand, retention, fraud advantage, and channel economics remain hypotheses. Differentiation still requires observed safe-action, usability, quality, and distribution evidence.

**Implementation and test consequences.** Build a versioned scenario model with explicit units, assumptions, sensitivities, source dates, and no denominator blending. Add assertions that eligible or free accounts cannot be reported as paid/activated equivalents.

**Blocked or not authorized.** No forecast, valuation, traction claim, live sale, public launch, outbound research, hiring, or production customer data follows from the scenario.

## 2. Customers, users, and authority

**Evidence and rationale.** The [authorization review](../build-run-1/05-authorization-review.md) verifies independent protected enrollment and deny-by-default object policy, but the single household membership role still prevents an administrator or protected person from also becoming trusted in the same household. Finding 1 in the [adjudication](./01-external-review-adjudication.md) accepts that defect with bounds.

**Prior rule.** `person`, identity, payer, household owner, protected member, Trusted Circle member, organization member, and employee were conceptually distinct, while one membership row still carried one household role.

**New rule.** Authority is orthogonal: neutral membership, administration, protected enrollment, exact pairwise trust, payer identity, billing management, organization membership, employee eligibility, support-case assignment, and restricted-access grant are separately scoped and separately revocable. One person may hold several without implication.

**Preserved invariants.** Payment, age, kinship, sponsor eligibility, administration, or employment never grants artifact access. Current server-derived principals, selected-household checks, tenant predicates, and independent protected enrollment remain.

**Implementation and test consequences.** ADR-0011 must govern the authority graph and migration. Replace role shortcuts in schema, contracts, session resolution, authorization, repositories, and UI. Test dual-administrator/protected/trusting spouses, adult-child payer/trusted authority, multi-protected and multi-household actors, one trusted person serving several pairs, and isolated revocation.

**Blocked or not authorized.** No payer surveillance, household-wide history, employee superuser, inferred caregiver permission, or production identity claim is allowed.

## 3. Core product loop and risk semantics

**Evidence and rationale.** `lower_concern` exists in the Run 1 type/schema but no scoring branch can emit it. The [fraud evaluation result](../build-run-1/06-fraud-evaluation-results.md) is a 12-case, single-author harness marked `not_calibrated`, not affirmative safety evidence.

**Prior rule.** The result taxonomy named `lower_concern`, `caution`, `high_concern`, and `unknown`, even though runtime returned only the latter three relevant states.

**New rule.** The active Run 2 customer contract is `unknown`, `caution`, or `high_concern`. `lower_concern` is reserved and unavailable until affirmative, current evidence, representative evaluation, and an approved threshold justify it. Provider no-match or missing evidence never lowers concern.

**Preserved invariants.** Safe action outranks label; evidence, inference, confidence, and unknown remain distinct; failures are visible; confidence remains coarse and not empirically calibrated.

**Implementation and test consequences.** Add a risk-semantics ADR; reconcile domain, Zod, SQL, UI, analytics, and evaluation schemas. Regression tests must prove zero-signal, no-match, timeout, stale evidence, and provider failure resolve to uncertainty rather than reassurance.

**Blocked or not authorized.** No “safe,” accuracy, calibration, prevented-loss, or lower-concern claim is allowed from the current corpus or provider absence.

## 4. Family and auditable consent

**Evidence and rationale.** Run 1 pairwise sharing and participant-specific revocation are strong, but [Known Limitations](../build-run-1/12-known-limitations.md) records mutable consent rows, non-materialized expiry, bearer-style invitations, and incomplete permission vocabulary.

**Prior rule.** Protected people could accept/defer/revoke protection; invitations were expiring, single-use, role-limited, revocable, and audited; current-state consent rows were updated in place.

**New rule.** Membership establishes presence only. Protected people control their protection and sharing; either exact pair participant may end the relationship; administrator suspension is distinct from subject withdrawal. Production invitations are identity-bound and lifecycle-complete. Consent facts are append-only and record actor, subject, recipient, purpose, canonical scope, action, disclosure/policy digest, interaction, assurance, effective/expiry time, withdrawal/revocation, and correlation evidence; authorization reads a current-state projection.

**Preserved invariants.** Pairwise trust, private-by-default artifacts, redacted-result-first sharing, non-enumeration, allowance enforcement, and deletion/withdrawal after entitlement lapse remain.

**Implementation and test consequences.** ADR-0012 must define evidence versus current projection. Add immutable lifecycle records, identity-bound invite acceptance, expiry cleanup, canonical permissions, suspension/reactivation distinction, idempotency, concurrency locks, and customer-visible withdrawal. Test replay, stale preview, coercive role shortcuts, exact-pair withdrawal, historical immutability, and unrelated-authority survival.

**Blocked or not authorized.** Managed delivery, MFA/step-up, recovery, coercion validation, and legally sufficient disclosures remain blocked on a managed-identity account, real user research, and professional privacy/legal review.

## 5. BoomerBuddy HQ

**Evidence and rationale.** The [HQ review](../build-run-1/10-hq-review.md) confirms a separate employee audience, content-free fraud projection, and labeled seeded revenue shell. It also confirms that support, cases, jobs, partner reporting, and production operations are absent. The external review correctly warned that “not a full CRM” could cause future agents to optimize away the founder’s domain-specific control plane.

**Prior rule.** HQ covered seeded owner metrics, household/entitlement/orientation summaries, fraud/review metadata, revenue fixtures, provider/job health, and audit; it was not a full CRM or commodity back office.

**New rule.** HQ is the BoomerBuddy Business OS. It owns household/customer and sponsor/partner graphs, consent/safety context, entitlement truth, attribution, activation/health, fraud/support/privacy cases, leads/accounts/opportunities, activities/tasks/next actions, partner adoption, and owner attention. It integrates commodity payroll, tax, GL, banking, bulk data, messaging, ATS, and general-purpose CRM services rather than rebuilding them.

**Preserved invariants.** HQ remains a separate app and audience. Employee eligibility never bypasses customer authority; restricted access requires a case, purpose, step-up, resource scope, expiry, and immutable audit. Seeded/mock/verified provenance stays visible.

**Implementation and test consequences.** Add a Business OS boundary ADR and bounded modules for owner, customer operations, revenue operations, fraud operations, and system operations. Test audience/role/organization isolation, case-bound access, content exclusions, staleness, task state, immutable activity history, suppression, small-cell reporting, and human approval for outbound work.

**Blocked or not authorized.** No generic CRM rebuild, direct database admin, unrestricted support access, live enrichment, campaign send, partner claim, finance sync, or production operations claim is authorized.

## 6. Commercial contract and provider-neutral commerce

**Evidence and rationale.** The [business-model review](../build-run-1/09-business-model-review.md) verifies immutable plan versions, canonical grants, source precedence, allowance limits, local inbox deduplication, and reconciliation state, while every subscription remains a fixture. Finding 8 requires an authentic Stripe sandbox path without weakening entitlement truth.

**Prior rule.** Provider-neutral entitlements governed access; production Stripe, Apple, Google, tax, refunds, cancellation, and reconciliation were excluded from Run 1.

**New rule.** Payment initiation, payer, billing administrator, provider state, canonical subscription, and effective entitlement are separate. Only authenticated provider evidence through an idempotent inbox and reconciliation may normalize access. Run 2 may implement Stripe test-mode and Apple/Google adapters. Storefront rules are jurisdiction/policy-versioned and external-purchase links default deny.

**Preserved invariants.** Client state, success redirects, receipts, ownership, payment, and sponsor eligibility never directly grant access or relationship permission. Canonical provider-neutral grants and urgent free safety guidance remain.

**Implementation and test consequences.** Add commerce-adapter and mobile-store ADRs. Implement raw-body signature verification, duplicate/out-of-order handling, lifecycle mapping, grants/allowances, portal, trial, cancel/grace/dunning/refund/dispute, reconciliation, and fixture/external parity. Test overlapping Apple/web/sponsor sources and unverified/failing provider states.

**Blocked or not authorized.** External Stripe proof is `blocked by account` without sandbox keys, webhook secret, products/prices, and a reachable callback. Apple/Google proof additionally needs developer accounts, store products, agreements, signing toolchains, and devices. No live money, card handling, app submission, tax conclusion, or store-policy compliance claim is authorized.

## 7. Canonical domain expansion

**Evidence and rationale.** Run 1 implemented the core household, Check, orientation, commerce, audit/outbox, and HQ projection. The independent review and Run 2 scope require commercial workflows without decomposing the modular monolith.

**Prior rule.** The canonical modules were identity/access, household, Check, orientation, commerce, sponsor, and operations.

**New rule.** The domain map now explicitly includes Public Check; governed fraud intelligence; lifecycle/health and communication policy; acquisition/attribution/referrals/content; sourced revenue operations; privacy/support/review cases; durable job state; owner attention/brief; and automation approval records. A named module is an ownership boundary, not proof that it exists in code.

**Preserved invariants.** Sensitive resources retain household/organization boundaries, opaque IDs, constraints, repository scopes, and versioned events. The application remains a modular monolith with provider ports.

**Implementation and test consequences.** Add migrations, contracts, domain services, repositories, projections, and tests in dependency order. Every stateful workflow needs owner, provenance, idempotency, lifecycle constraints, audit/outbox, retention classification, and truthful fixture/provider state. Avoid cross-module writes outside transactions and explicit ports.

**Blocked or not authorized.** Domain scaffolding cannot be labeled customer adoption, verified lead data, production operations, live communication, or partner integration.

## 8. Security, privacy, redaction, and Public Check

**Evidence and rationale.** Run 1 safely rejected recognized secret-bearing submissions and required sign-in for every Check. The adjudication found blanket rejection can suppress useful scam guidance, while the absence of an ephemeral Check leaves a high-leverage acquisition hypothesis untestable.

**Prior rule.** A recognized sensitive value could be rejected or redacted before persistence, but implementation always rejected. Anonymous Check was described as a future ephemeral possibility.

**New rule.** Deterministic typed redaction is required when an exact sensitive span can be bounded safely; only the redacted representation may be analyzed/persisted, and originals cannot reach fingerprints, providers, telemetry, events, exceptions, or fixtures. Unsafe/ambiguous cases remain rejected. Public Check uses a short-lived server context, shared quotas, strict budgets, non-enumerating responses, transient analysis, no durable history/content analytics, and authenticated explicit consent before a new actor-owned save.

**Preserved invariants.** Encryption, HMAC separation, hostile-input handling, content-free operations, explicit retention/deletion, no submitted-URL fetch, and no artifact authority from attribution/referral/payer/admin context remain.

**Implementation and test consequences.** Add redaction and anonymous-context ADRs. Test typed replacements, overlap/Unicode/URL secrets, false positives, hard-reject classes, signal preservation, memory/egress boundaries, no persistence, rate/replay controls, token expiry, content-free attribution, and consented save as a new resource.

**Blocked or not authorized.** No live bot-defense, external provider egress, public release, acquisition result, retention assertion, or moderated comprehension claim is authorized without staging, terms/privacy review, and real research.

## 9. Fraud intelligence, evaluation, and V1 knowledge

**Evidence and rationale.** The [architecture as built](../build-run-1/01-architecture-as-built.md) confirms the current provider receives a deliberately content-free structural vector and returns local unknown. The [evaluation result](../build-run-1/06-fraud-evaluation-results.md) confirms harness behavior only. Useful V1 taxonomy/source material remains outside governed 2.0 assets.

**Prior rule.** Generic external reputation/model interfaces supplied evidence with provenance, timeout, failure states, and evaluation gates; V1 source registries were research references.

**New rule.** Typed provider roles declare exact representations, egress, retention/training terms, timeout, freshness, cost/budget, rate limits, kill switches, provenance, and failure semantics. A central dispatcher releases only allowlisted fields; no provider receives raw input by default or chooses actions. Evaluation adds rights, sanitization, independent review/disagreement/adjudication, sealed splits, provider cost, and release gates. V1 records become 2.0 assets only through reviewed provenance, jurisdiction, rights, version, lifecycle, and intended use; runtime imports are prohibited.

**Preserved invariants.** Deterministic rules/action policy remain authoritative; provider failure remains uncertainty; acquisition/network credentials remain isolated; customer content is not training data by default.

**Implementation and test consequences.** Add provider-data and governed-intelligence ADRs. Build capability manifests, policy dispatch, attempt/evidence records, taxonomy/source schemas, curation validation, reviewer/adjudication workflow, sealed evaluation runner, outage/kill-switch/cost tests, and a dependency rule preventing V1 runtime imports.

**Blocked or not authorized.** Live provider quality, corpus representativeness, source rights, calibration, accuracy, moat, prevented loss, and expert sufficiency remain blocked on accounts/contracts, licensed data, independent reviewers, and professional fraud/privacy review.

## 10. Selected architecture, portability, data, and jobs

**Evidence and rationale.** Run 1 established standard PostgreSQL migrations, PGlite local execution, provider ports, and transactional outbox. [Deferred Integrations](../build-run-1/13-deferred-integrations.md) records real PostgreSQL, durable workers, managed identity/KMS, restore, and deployment as unverified. Replit must remain useful without becoming a business single point of failure.

**Prior rule.** Managed PostgreSQL and durable external workers were future directions; production refused startup; no deployment topology was selected.

**New rule.** Replit may host development only. Canonical source/history, identity, secrets, database, object storage, deployment, DNS, and backups must remain externally portable. The provisional topology is founder-controlled Git, OCI containers, standard PostgreSQL, explicit environment contracts, Vercel web/HQ, Render API/worker, Neon, Clerk, Stripe, Apple/Google, Cloudflare, reviewed S3-capability storage, Sentry, PostHog, Postmark, Twilio, and Expo/EAS—each still a hypothesis. Canonical durable work is a portable database-backed worker with leases, bounded retry/jitter, idempotency, quarantine, replay audit, heartbeat, and shutdown. Real PostgreSQL and clean-clone/container/restore evidence are mandatory.

**Preserved invariants.** Node/TypeScript workspaces, modular monolith, separate surfaces, canonical PostgreSQL, PGlite for fast local proof, provider neutrality, transactional outbox, and production fail-closed behavior remain.

**Implementation and test consequences.** Add portability/platform and durable-job ADRs. Build GitHub-ready CI, OCI images, environment validation, real-PostgreSQL migration/concurrency tests, worker lease/race/retry/dead-letter/replay tests, clean-clone reconstruction, and a documented Replit-loss drill. Test direct versus pooled connections and backup/restore where credentials permit.

**Blocked or not authorized.** Vendor accounts, paid provisioning, hosted deployment, DNS change, production secrets, managed backup/restore proof, KMS proof, native cloud build, and vendor security/region/cost claims remain blocked until founder-authorized setup.

## 11. Analytics, autonomy, and owner attention

**Evidence and rationale.** Run 1 defined honest product metrics but could not compute verified safe-action outcomes; the [HQ review](../build-run-1/10-hq-review.md) rejects fabricated MRR, prevention, conversion, and growth. Run 2 also treats founder time as a business constraint.

**Prior rule.** Measure orientation, Check, sharing, provider, entitlement, support, refund, and cohort signals with no “fraud prevented” claim.

**New rule.** Every recurring workflow is classified `AUTO`, `APPROVAL`, `HUMAN`, or `PROFESSIONAL` with data, actions, budget, audit, escalation, and kill switch. Only reversible allowlisted internal work can be autonomous. Owner Attention contains deduplicated, evidence-linked decisions/exceptions that genuinely need the founder, with reason, recommendation, deadline, consequence, severity, and state.

**Preserved invariants.** Outcome provenance, small-cell sponsor reporting, seeded labels, uncertainty, and human accountability remain. A click is not a verified safe action.

**Implementation and test consequences.** Add automation-governance decisions and registries, approval records, attention deduplication/escalation, owner-brief snapshots, budget/kill-switch enforcement, and Founder Dependency Score inputs. Test policy denial, replay/idempotency, expired approval, budget exhaustion, restricted data, and founder-queue noise controls.

**Blocked or not authorized.** Automation may not make novel fraud decisions, publish content, send campaigns, grant restricted access, issue material refunds, take professional responsibility, conceal uncertainty, contact users/prospects, hire, or incur spend.

## 12. Build/run boundary and evidence status

**Evidence and rationale.** The [Run 2 recommendation](../build-run-1/15-run-2-recommendation.md) called for bounded production-foundation work without public beta or payment. The external review expands the commercial foundation but does not erase first-dollar blockers.

**Prior rule.** The historical Build Run 1 amendment authorized no deployment, production credentials, live providers, customer contact, payment, or Run 2.

**New rule.** The later dated Run 2 amendment authorizes this bounded implementation run: authority/consent correction, provider and knowledge governance, Public Check, test/sandbox adapters, durable/portable operations, Business OS workflows, scenario/staffing/founder-dependency models, and research protocols. Historical Run 1 statements continue to describe what Run 1 itself did not authorize.

**Preserved invariants.** Build status remains one of `implemented`, `implemented with mock provider`, `scaffolded`, `designed`, `blocked`, `deferred`, or `rejected`. External evidence is never simulated. Material product/security/commercial changes require ADR or founder decision and report traceability.

**Implementation and test consequences.** Every Run 2 deliverable must link design, migration/code, tests, execution evidence, external blockers, rollback, and remaining limitations. Clean CI and independent security/privacy/fraud/Family/commerce/portability/mobile/business reviews must leave no scoped Critical/High defect before Run 2 passes.

**Blocked or not authorized.** Run 2 may not create vendor accounts, provision paid services, deploy publicly, use production credentials/data, charge anyone, contact users/prospects, publish/send content, submit apps, hire, migrate V1 users, change DNS, or claim demand, retention, accessibility conformance, calibration, prevented loss, partner intent, or traction. Those are separately authorized launch gates.

## ADR traceability

The amendment requires decision records for: orthogonal authority; append-only consent and lifecycle projection; active risk semantics; provider data access; typed redaction; anonymous Public Check context; governed intelligence assets/evaluation; Stripe and mobile-store adapters; bounded Business OS ownership; portable platform topology; durable database jobs; and automation/approval governance. New ADRs must state which prior decision they clarify or supersede, migration and rollback, security/privacy consequences, verification evidence, and any external-account blocker. Until listed as accepted in the [ADR index](../adr/README.md), these topics remain Master-level requirements awaiting detailed design.
