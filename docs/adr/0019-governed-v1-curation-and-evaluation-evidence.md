# ADR-0019: Governed V1 Curation and Evaluation Evidence

Status: **Accepted Run 2 design; local governance and harness proof required; source rights, expert review, and representative evidence blocked**

Decision date: 2026-08-16

## Context

V1 contains potentially useful scam categories and source records, but it is read-only research, not a trusted 2.0 dependency or proof of accuracy. Run 1's twelve synthetic fixtures establish harness behavior only. A compounding intelligence asset needs provenance, rights, review, lifecycle, adjudication, and reproducible release evidence rather than bulk copying or customer-content collection.

## Supersession

This ADR supersedes [ADR-0007](./0007-deterministic-fraud-core-and-optional-ai.md)'s generic evaluation-change-gate section with a governed asset and evidence lifecycle. It preserves deterministic action authority, optional constrained providers, honest unknowns, and the prohibition on calibration claims from the initial corpus. No earlier ADR authorized V1 runtime imports; this ADR makes that prohibition testable.

## Decision

Treat every V1 item as a candidate for one-way independent curation. Versioned 2.0 assets may include scam family, attack technique, channel, signal/explanation primitive, safe action, recovery mapping, official-source registry, jurisdiction, and locale. Each record carries source/provenance, source class, license or permission basis, jurisdiction, intended use, reviewer and review evidence, effective/review/expiry dates, version, and draft/active/deprecated/rejected state. Conflicts are recorded, not silently merged. Runtime packages consume only reviewed 2.0 assets; no code or data import resolves into `reference/boomerbuddy-v1/`.

The source registry distinguishes official authority, observed threat intelligence, provider evidence, editorial interpretation, and hypothesis. Stale or expired guidance fails closed for publication/action use. Curation tools validate schema and emit reviewable proposals; they never bulk-activate records or migrate V1 users/content.

The evaluation corpus is separate from customer submissions and production analytics. Each case records rights/provenance, sanitization, taxonomy labels, artifact class, jurisdiction/language, expected minimum risk, required and prohibited actions, severity, reviewer assignments, disagreement, adjudication, and sealed/public split. Runs record rules, provider/model/prompt, asset versions, environment, latency, cost, provider state, and failures.

Release reporting includes coverage gaps, critical false negatives, false positives, action-safety failures, provider availability, and segmented results. A confusion matrix or calibration view is shown only when labels and sample design support it. Any critical malicious case receiving harmful assurance blocks release. Provider or rules changes compare against a locked baseline; sealed cases are not used to tune the candidate.

## Consequences

Knowledge improves slowly but remains explainable, reviewable, and portable. Rights and freshness work may reject many V1 candidates. Separating editorial assets, provider evidence, evaluation labels, and runtime decisions prevents source counts or test passes from being misrepresented as a moat, calibration, or prevented loss.

Run 2 adds durable `intelligence.refresh` and `evaluation.run` work. Refresh records source freshness and governed draft state but cannot publish or activate an asset. Evaluation runs the governed local synthetic corpus and stores only a content-free summary. The portability guard also rejects direct imports and statically decodable normalized, concatenated, or URI-encoded paths into the V1 reference tree.

## Migration and rollback

Curation is one-way proposal creation: V1 candidates are copied only after schema validation into new draft 2.0 records with their own provenance and rights fields. Nothing points runtime resolution into the V1 tree, and no bulk activation occurs. A runtime release pins exact active asset and evaluation versions; migration checks reject missing review, expiry, rights, conflicts, or reviewer/adjudicator separation.

Rollback moves the runtime pointer to the last accepted 2.0 version and deprecates or rejects the faulty candidate through a new lifecycle record. It preserves source, review, disagreement, adjudication, run, and adverse-case evidence; it never deletes a failed evaluation, changes a sealed label to improve a score, or restores a V1 runtime import. Customer-derived material remains excluded unless a separately consented, rights-reviewed process exists.

## Security and privacy consequences

Source assets and evaluation cases require explicit rights, purpose, provenance, sanitization, retention, access, and deletion policy. Sealed cases are separated from tuning access; reviewer identity and disagreement records are protected from inappropriate editing while remaining auditable. Fixtures, reports, logs, and provider prompts must exclude live secrets and unnecessary personal data. Official-source status does not authorize unrestricted reuse, and model-generated or single-author labels are never independent ground truth.

## Rejected alternatives

- Runtime imports or bulk copy from V1.
- Customer submissions as training/evaluation data by default.
- Synthetic/model-generated labels as independent ground truth.
- One author creating, tuning, reviewing, and adjudicating the same sealed set.
- Claiming coverage, accuracy, calibration, or fraud prevention from fixture counts.

## Verification

AST/static-string checks reject direct imports and statically decodable path construction into `reference/boomerbuddy-v1/`. Schema tests require provenance, rights, version, lifecycle, dates, intended use, and reviewer evidence; duplicate/conflict/deprecation tests prove deterministic behavior. Operational tests prove durable refresh/evaluation receipts, retry/dead-letter behavior, no publication/activation, and content-free summary evidence. Evaluation tests enforce sealed-split isolation, reviewer/adjudicator separation, rules/provider version capture, required/prohibited actions, critical-case release blocking, reproducibility, and truthful `not_calibrated` labeling.

## Evidence boundary

Schemas, curation proposals, repository rules, durable local refresh/evaluation jobs, and the expanded V1 guard are implemented without provider accounts. No job publishes content, activates a draft, or calls a live intelligence provider. Reuse rights, official-source currency, jurisdictional applicability, expert adjudication, and a representative corpus are **BLOCKED BY SOURCE EVIDENCE / PROFESSIONAL REVIEW / DATASET** until recorded. Curated-item totals and local runs are not commercial or quality evidence.

## Primary sources

Internal primary candidates include V1's [scam types](../../reference/boomerbuddy-v1/BoomerBuddy/server/seedData/scamTypes.ts) and [state source configuration](../../reference/boomerbuddy-v1/BoomerBuddy/server/stateSourcesConfig.ts); they are evidence inputs, not authority. Evaluation governance was rechecked 2026-08-16 against the [NIST AI RMF 1.0](https://www.nist.gov/itl/ai-risk-management-framework) and [NIST AI test, evaluation, validation, and verification program](https://www.nist.gov/ai-test-evaluation-validation-and-verification-tevv).
