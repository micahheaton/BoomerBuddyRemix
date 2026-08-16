# Evaluation

Status: **harness and governed-release contracts implemented; representative commercial evidence is not available**.

## Current harness

The existing corpus contains 12 project-authored synthetic cases spanning malicious, legitimate, borderline, prompt-injection, and provider-outage behavior. It validates expected risk ranges, required signals and defensive actions, forbidden actions and claims, version capture, scoped fingerprints, and content-free reporting.

The final Run 2 harness execution passed 12/12 cases with zero forbidden-action violations, exercised one provider failure, and reported `not_calibrated`. These results prove deterministic harness and action invariants only; they do not estimate accuracy, false-negative rate, calibration, or customer safety outcomes.

## Run 2 governance foundation

The schema now supports corpus provenance and rights, development/validation/sealed-test splits, case source and sensitivity, independent reviewer/adjudicator assignments, per-case reviews, disagreement, adjudication, and immutable release-gate evidence. `evaluateReleaseGate` blocks an unsealed split, failed cases, forbidden actions, fewer than two independent reviews, or disagreement without a separate completed adjudicator.

`packages/eval-lab/src/eval-lab.test.ts` proves stable content-free reports and blocks unresolved disagreement. Migration `0004_run2_intelligence_public.sql` creates append-only corpus, case, review, adjudication, and gate tables. The persistence schema is a foundation; no representative corpus has been populated or independently adjudicated.

## Commercialization gate

Before launch, obtain a rights-cleared, privacy-reviewed corpus covering channels, scam families, legitimate near-neighbors, demographic/accessibility variation, provider outages, sanitized real-world examples, and severe recovery scenarios. Pre-register release thresholds for critical false negatives, false positives, explanation/evidence correctness, safe-action correctness, latency, and provider cost. Seal the test split and separate tuning from adjudication.

This work is **blocked by dataset, consent/license rights, expert reviewers, privacy/legal review, and representative study design**. No fraud-accuracy, calibration, or losses-prevented claim is authorized. See [ADR-0019](../adr/0019-governed-v1-curation-and-evaluation-evidence.md).
