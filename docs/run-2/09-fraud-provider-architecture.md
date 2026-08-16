# Fraud Provider Architecture

Status: **seven-role least-data contracts, freshness semantics, and fail-closed live limiting are implemented and tested locally; no live intelligence provider has run**.

## Implemented boundary

Providers receive role-specific immutable requests, never an artifact or one generic rich payload. Run 2 defines exactly seven roles: `local_signals`, `domain_reputation`, `url_reputation`, `message_reasoning`, `verified_organization`, `campaign_intelligence`, and `recovery_authority`. Each request exposes only the fields its role needs. For example, domain reputation receives a registrable domain; URL reputation receives a normalized URL with credentials, query, and fragment removed; reasoning receives typed-redacted text; and verified-organization receives controlled candidate identifiers.

Every manifest declares provider/version, capability and data-policy versions, artifact support, exact fields, deployment/egress, retention/training use, timeout, cost, evidence age, rate limit, and failure behavior. Each observation records `observedAt` and `validUntil`. Expired or over-age evidence remains visible as stale provenance but receives zero decision weight; `not_found`, missing, failed, and stale evidence never reassure.

The dispatcher applies local provider and capability budgets. A manifest marked `live` additionally requires an atomic shared durable reservation. A missing limiter, denial, or limiter failure returns unavailable without calling the provider. Global and capability kill switches fail closed. Provider observations remain evidence; deterministic BoomerBuddy policy selects customer actions.

Bounded typed redaction replaces safely isolated payment-card, credential, and one-time-code spans before provider use or persistence. Private keys, URL secrets, ambiguous credentials, overlaps, oversized input, and unusable remnants fail closed. URL analysis performs no fetch, DNS lookup, or host/path/query egress. The active risk set remains `unknown`, `caution`, and `high_concern`; `lower_concern` is reserved and unreachable, and results remain `not_calibrated`.

## Local evidence

Focused fraud tests exercise all seven request shapes, exact field isolation, freshness expiry, provider and capability budgets, durable live-limiter denial/failure, kill switches, mock/live separation, timeout, provenance, typed redaction, and honest unknown behavior. Security tests cover redaction and log sanitation. This is deterministic local evidence, not provider quality or production availability.

## Not proved

Only `LocalUnknownProvider` is configured at runtime. No external reputation, reasoning, verified-organization, campaign, or recovery account has been contracted or called. Vendor accuracy, terms, retention/training behavior, cost, latency, real shared-rate behavior, evidence freshness, conflicts, and outage behavior are **blocked by account, contract, privacy review, staging, and a representative independently adjudicated corpus**. No accuracy, calibration, prevented-loss, or provider-lift claim is supportable; no launch.

See [ADR-0013](../adr/0013-typed-fraud-evidence-redaction-and-risk-semantics.md).
