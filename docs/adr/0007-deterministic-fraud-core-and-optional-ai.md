# ADR-0007: Deterministic Fraud Core with Optional, Constrained AI

Status: **Accepted; deterministic slice selected, external AI disabled**

Decision date: 2026-08-15

## Context

The v1 treated a model response as authority and sometimes simulated provider success. Fraud decisions need reproducibility, explicit unknowns, safe actions, and provider/model change gates. A small fixture suite cannot establish real-world accuracy or empirical calibration.

## Decision

Run 1 uses versioned deterministic normalization, URL-string parsing, social-engineering signals, scoring/evidence-sufficiency rules, and action policy. Results use `lower_concern`, `caution`, `high_concern`, or `unknown` plus a coarse rules-based confidence band explicitly labeled **not empirically calibrated**. Provider adapters return provenance and honest `mock`, `unknown`, `unavailable`, or verified state.

AI is a provider-neutral optional adapter, off without explicit credentials and policy configuration. It receives only minimized, delimited input and structured deterministic signals; has no tools, network, memory, secrets, cross-customer context, or action authority; and must return a closed schema. Parse, range, provenance, timeout, or policy failure discards its output. Deterministic policy chooses safe actions.

No provider/model/prompt change ships without the versioned evaluation lab. Initial fixtures prove plumbing and hard action invariants only. Representative, rights-cleared, independently adjudicated data is required before performance or calibration claims.

## Consequences

The baseline is inspectable and works without a vendor. It will miss patterns and may abstain more often. Optional AI can improve interpretation only after proving incremental benefit and privacy/retention acceptability.

Rejected: model-only verdicts, agentic tools, provider-specific domain types, silent fallback, training on submissions by default, and generated contact/action instructions.

## Evidence

Accessed 2026-08-15: [OWASP prompt-injection guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html), [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data), and [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework).
