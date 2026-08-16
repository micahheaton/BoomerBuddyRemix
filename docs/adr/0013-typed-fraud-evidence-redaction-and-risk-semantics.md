# ADR-0013: Typed Fraud Evidence, Redaction, and Active Risk Semantics

Status: **Accepted Run 2 design; deterministic local proof required; live-provider and lower-concern proof blocked by accounts, contracts, and evidence**

Decision date: 2026-08-16

## Context

Run 1's single `FeatureVector` protects content but cannot support domain reputation, message reasoning, verified-organization, or campaign evidence. Giving every provider the raw artifact would reverse the privacy boundary. Blanket rejection of a bounded one-time code or card span can also suppress the very safety explanation a user needs. Finally, `lower_concern` exists in types but has no truthful evidence threshold.

## Supersession

This ADR supersedes the restricted-input branch in [ADR-0004](./0004-sensitive-artifact-encryption-and-keyed-fingerprints.md)'s Decision by choosing typed redaction where safe and explicit rejection otherwise. It supersedes [ADR-0007](./0007-deterministic-fraud-core-and-optional-ai.md)'s single provider-input concept and active four-value risk set. ADR-0004 encryption/key separation and ADR-0007 deterministic action authority remain in force.

## Decision

Use role-specific evidence-provider contracts, including local signals, domain reputation, URL reputation, message reasoning, verified organization, campaign evidence, and recovery authority. Each capability declares supported artifact classes, exact allowlisted fields/representation, egress, retention/training terms, provenance, freshness, timeout, cost/budget, rate limits, failure semantics, and kill switch. A central dispatcher builds the least-data request; there is no raw-to-all fan-out. Provider evidence can be stale, unavailable, unverified, or conflicting and never chooses the customer action.

Before analysis, a bounded deterministic minimizer finds safely span-local sensitive values, derives only non-sensitive safety flags, and replaces exact spans with typed placeholders such as `[ONE_TIME_CODE]`, `[PAYMENT_CARD]`, or `[AUTH_CREDENTIAL]`. Only the redacted representation may be normalized, fingerprinted, persisted, logged, audited, evaluated, or sent to an authorized provider. The UI identifies removed classes without values or positions. Private keys, ambiguous credentials, overlapping/unsafe matches, unusable remnants, oversized input, unsafe URLs, and unsupported modalities are rejected.

The active Run 2 risk contract is `unknown`, `caution`, or `high_concern`. `lower_concern` is reserved and unreachable. Zero local signals, provider no-match, timeout, stale evidence, or missing evidence remains `unknown`. Future activation needs affirmative current evidence, a versioned threshold, representative independently adjudicated evaluation, explicit false-negative limits, professional review, and a release decision.

## Consequences

Adapters are more numerous and provider onboarding requires data-access review, but permissions become testable and a vendor can be removed without changing decision policy. Redaction preserves useful scam cues while narrowing exposure. Conservative abstention may frustrate users; truthful unknowns are preferable to unsupported reassurance.

## Rejected alternatives

- One rich provider interface or raw artifact broadcast.
- Model/provider verdict as the customer decision.
- Persisting originals encrypted and redacting only for display.
- Redacting private keys or ambiguous secrets that cannot be bounded safely.
- Mapping provider `not_found` or score zero to `lower_concern`.

## Verification

Contract tests prove per-provider field allowlists, no forbidden egress, timeout/budget/kill-switch behavior, stale and conflicting evidence, and failure-as-unknown. Minimization tests cover Unicode, repeated/overlapping values, URLs, false positives, signal preservation, exceptions, logs, audit/outbox, fingerprints, encrypted persistence, deletion, analytics, and providers. Evaluation tests prove `lower_concern` is unreachable and missing evidence never lowers risk.

## Evidence boundary

Local adapters, redaction, and semantics are implementable without accounts. Live-provider quality, terms, retention/training behavior, freshness, cost, and outage behavior are **BLOCKED BY ACCOUNT / CONTRACT / DATASET**. `lower_concern` is **BLOCKED BY EVIDENCE**; the twelve Run 1 fixtures prove harness behavior only and are not calibration.

## Primary sources

The accepted gaps are documented in the [external-review adjudication](../run-2/01-external-review-adjudication.md). Provider privacy and evaluation guidance was rechecked 2026-08-16 in the [NIST Privacy Framework](https://www.nist.gov/privacy-framework), [NIST AI RMF 1.0](https://www.nist.gov/itl/ai-risk-management-framework), and [NIST AI TEVV program](https://www.nist.gov/ai-test-evaluation-validation-and-verification-tevv).
