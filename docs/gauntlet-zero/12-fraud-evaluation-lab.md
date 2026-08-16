# Fraud Evaluation Lab

Status: **evaluation system designed; a small, explicitly non-production fixture set is proposed for Build Run 1**.

## Purpose

The lab is the release control for detection, explanation, and action safety. It compares the complete versioned system—not merely a model—against human-reviewed cases. It must detect regressions, expose subgroup and campaign blind spots, and make provider changes reversible.

## Case and corpus design

Every case uses a versioned schema:

```text
case_id, artifact_type, content_or_fixture_ref, locale, channel,
ground_truth_label, scam_family, required_evidence, forbidden_claims,
required_actions, forbidden_actions, provenance, license_or_consent,
observed_period, reviewer_ids, adjudication, sensitivity, split
```

Corpus strata include known scam, legitimate, and borderline/unknown examples across government, bank, delivery, health, employment, romance, tech-support, investment, marketplace, charity, gift-card, cryptocurrency, family-emergency, account-verification, benign urgency, legitimate corporate notices, phishing/lookalike URLs, URL shorteners, and adversarial/prompt-injection variants. Include varying grammar, accessibility needs, and English/Spanish only when qualified reviewers can label them.

Use three sets:

- `development`: visible examples for rule construction;
- `validation`: visible aggregate results for threshold selection;
- `sealed`: access-controlled release gate that developers/providers do not tune against.

Split related campaigns, templates, domains, and paraphrases together to prevent leakage. Deduplicate by normalized content and semantic/template clusters. Record when real-world prevalence is unknown; the test mix does not estimate population incidence.

Secret-minimization regressions generate recognizable private-key, card, authorization-token, and one-time-code patterns only in a bounded test process and discard them after the assertion. Golden corpora, snapshots, reports, and ordinary fixtures store only the pattern class and expected rejection/redaction behavior—not the value.

## Golden-review workflow

1. Source an example with provenance and documented rights.
2. Redact direct identifiers without erasing material fraud signals.
3. Two trained reviewers independently label risk, taxonomy, evidence, uncertainty, and action requirements.
4. An adjudicator resolves disagreement and records rationale; unresolved cases remain `ambiguous`, not forced truth.
5. Freeze a case version and corpus-/purpose-scoped keyed-HMAC `caseFingerprint`. Label changes create a new version and audit record. Restricted or low-entropy fixture content never uses an unkeyed checksum.
6. Periodically sample production feedback only after explicit, purpose-specific consent and privacy review. No submission becomes training/evaluation data by default.

Reviewers need a written rubric, calibration exercises, conflict-of-interest rules, and measured agreement. High-severity action cases require fraud/safety review; legal and financial instructions need qualified review rather than model consensus.

## Measures

Report overall and by artifact type, scam family, locale, channel, and difficulty:

| Dimension | Measure |
|---|---|
| Harm detection | false-negative count/rate, recall/sensitivity for high-risk cases, and uncertainty routing |
| Over-warning | false-positive count/rate, specificity, and precision/positive predictive value |
| Taxonomy | per-family precision/recall and macro F1; “unknown” is a valid class |
| Confidence | exploratory reliability diagram, Brier score, calibration error, and coverage at each abstention threshold; no empirical-calibration claim until the corpus is representative and adjudicated |
| Evidence | required-signal recall, unsupported-evidence/claim rate, source freshness |
| Explanation | factual support, uncertainty disclosure, readability, non-patronizing language, and reviewer score |
| Action safety | required-action coverage and **forbidden-action violation count** |
| Operations | p50/p95 latency, provider error/timeout rate, cost per Check, and deterministic reproducibility |
| Robustness | result changes under harmless formatting/paraphrase, injection text, Unicode, truncation, and provider outage |

Never present accuracy alone. With imbalanced data, precision/recall and per-class confusion are more informative; every metric includes numerator, denominator, corpus version, confidence interval where useful, and excluded cases.

## Release policy

Build Run 1 establishes a baseline, not a launch claim. Its fixture set proves test plumbing and catches obvious deterministic regressions. Before first-dollar launch, owners must set numeric thresholds from a substantially larger, representative corpus. Regardless of those thresholds, these invariants block release:

- any golden case recommends paying, replying, sharing a credential/code, installing remote access, or using contact information from the suspicious artifact;
- high-risk evidence is converted into an unsupported “safe” claim;
- provider failure silently becomes a lower-risk verdict;
- one household’s artifact/evidence appears in another case or result;
- prompt injection changes tools, policy, schema, or protected instructions;
- a material regression lacks an approved exception, expiry, and mitigation.

Target thresholds must reflect asymmetric harm and sample uncertainty. “Zero observed false negatives” in a small fixture set is not proof of safety. Report an upper confidence bound or the raw denominator instead of marketing the absence of observed failures.

## Reproducible runner and artifacts

The local/CI runner pins code commit, scoring/action policy, provider/model and prompt versions, case versions/`caseFingerprint` values, random seed, and configuration. The fingerprint key is separate, rotating, unavailable to reports, and scoped to corpus plus purpose. The runner emits machine-readable JSON plus a human report containing a confusion matrix, exploratory calibration buckets, action violations, changed cases, latency/cost, and provider failures. The initial fixture set proves runner plumbing and release invariants only; it cannot establish empirical calibration. Golden content is encrypted/access-controlled and never written to ordinary CI logs.

Provider comparison is paired on the same case version. A candidate advances only if it improves a declared objective without violating action safety, privacy, latency, or cost budgets. Rollout uses a feature flag, shadow evaluation where consent permits, and rollback to the last approved bundle.

## Continuous improvement loop

Production feedback is an appeal/incident process first, not free training data. Store a case reference, user-reported issue, decision provenance, reviewer outcome, and consent scope. Correct the user-facing result when appropriate; separately decide whether a de-identified/redacted derivative may enter evaluation. Measure reviewer queues and repeated root causes.

## Evidence

Accessed 2026-08-15:

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
- [NIST Generative AI Profile, AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)
- [OpenAI evaluation guidance](https://developers.openai.com/api/docs/guides/evals)
