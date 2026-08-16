# Fraud Provider Architecture

Status: **least-data provider dispatch, redaction, and active risk semantics implemented and locally tested; live intelligence remains blocked**.

## Evidence boundary

The internal deterministic `FeatureVector` remains, but providers receive role-specific immutable requests rather than an artifact or a generic rich payload. Run 2 implements structural-reputation, campaign-intelligence, and language-pattern roles. Each manifest declares identity/version, capability and data-policy version, exact fields, deployment type, network egress, retention, training use, timeout, and cost.

The dispatcher enforces exact per-role fields, allowed provider/role lists, provider and cost budgets, timeout, egress/retention/training policy, and a kill switch. Unavailable, invalid, timed-out, stale, mock, and `not_found` evidence cannot become reassurance. Provider observations remain evidence; deterministic BoomerBuddy policy selects customer actions.

Before analysis, bounded typed redaction replaces safely isolated payment-card, credential, and one-time-code spans. Private keys, URL secrets, ambiguous credentials, overlaps, oversized input, and unusable remnants fail closed. URL analysis emits structure only and performs no fetch, DNS lookup, or host/path/query egress.

The active risk set is `unknown`, `caution`, and `high_concern`. `lower_concern` is reserved and unreachable. Results state `not_calibrated`.

## Evidence

`packages/fraud/src/fraud.test.ts` covers combined signals, honest unknown, redaction-before-sink, URL structure, timeout, exact fields, budget, kill switch, provenance, mock/live separation, untrusted provider prose, and hard rejection. `packages/security/src/security.test.ts` covers typed redaction and log sanitation. The final evaluation run passed its 12 synthetic action-invariant cases with zero forbidden-action violations, exercised one provider failure, and remained explicitly `not_calibrated`.

## Not proved

Only `LocalUnknownProvider` is configured at runtime. No reputation, verified-organization, campaign, reasoning, or recovery provider account has been contracted or called. Vendor accuracy, terms, retention/training behavior, cost, latency, rate limits, freshness, conflict handling, and outage behavior are **blocked by account, contract, privacy review, and representative dataset**. `lower_concern` is **blocked by evidence**. No accuracy or losses-prevented claim is supportable; no launch.

See [ADR-0013](../adr/0013-typed-fraud-evidence-redaction-and-risk-semantics.md).
