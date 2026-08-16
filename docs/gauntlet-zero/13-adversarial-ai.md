# Adversarial AI and Attacker Model

Status: **threat model designed on 2026-08-15; controls must be verified before any live model or file/page ingestion**.

## Security premise

Every submission, provider response, web page, file, QR payload, metadata field, support message, and model output is attacker-controlled data. A fraud-analysis model is especially attractive to attackers because its ordinary job is to read malicious instructions. Prompt wording cannot create a trustworthy boundary.

Build Run 1 therefore gives the optional model adapter no credentials, tools, network, retrieval, memory, customer lookup, or action authority. It is disabled without explicit configuration. Deterministic code validates inputs, calculates core signals, enforces authorization, selects safe actions, validates structured outputs, and persists results.

## Assets and adversaries

Protect raw family communications; identity/session and encryption keys; household/Trusted Circle permissions; safe-word verifiers; provider credentials; fraud rules, prompts, and sealed evaluation cases; employee access; billing/entitlements; audit integrity; availability; and the trustworthiness of explanations/actions.

Adversaries include a scammer testing evasion; an automated scraper/denial-of-service actor; a credential-stuffer; an abusive household or caregiver; a compromised member/employee/vendor; a malicious support requester; and a provider or dependency compromise. A well-meaning user may also submit secrets or follow an overconfident result.

## Threats and controls

| Threat | Likely path | Required controls |
|---|---|---|
| Direct/indirect prompt injection | “Ignore instructions” in text, email, page, document, image, QR, or metadata | Strong data/instruction separation; no tools; no secrets in prompts; closed output schema; deterministic actions; injection/adversarial fixtures; treat filtering as a signal, not a proof. |
| Data exfiltration | Injected markup/link, model echo, cross-tenant retrieval, debug output | No cross-user context; output allowlist and safe rendering; no active Markdown/HTML; content-free logs; object authorization; red-team canaries that contain no real secret. |
| Policy manipulation | Artifact asks the model to lower risk or recommend a submitted link/number | Model cannot set entitlement, authorization, final actions, or provider facts. Action policy forbids using artifact-supplied contact destinations. |
| Evasion/poisoning | Unicode, obfuscation, paraphrase, many trials, poisoned intelligence or feedback | Preserve raw/normalized representations; rate limits; source provenance/freshness; sealed corpus; campaign-level splits; reviewer adjudication; provider rollback. |
| Malformed/file bomb | Oversized input, parser exploit, decompression bomb, polyglot | File modalities deferred; later quarantine, magic-byte/type allowlists, byte/decode limits, sandboxed parsers, malware scan, timeouts, disposable storage. |
| SSRF/browser abuse | URL redirect to internal/metadata services or hostile page | Run 1 performs zero fetches. Later use a credentialless isolated acquisition worker with network deny rules, re-resolution checks, redirect/size/time limits, and sanitized outputs. |
| Resource exhaustion | Long inputs, bulk checks, expensive provider fan-out, alert-source fan-out | Per-route byte/count ceilings, authenticated quotas, concurrency budgets, provider timeouts/circuit breakers, bounded queues, cost meters, no public fan-out endpoint. |
| Automated oracle/scraping | Repeated probes reveal rules or enumerate artifacts | Opaque IDs, object authz, behavioral/rate controls, response minimization, pagination caps, anomaly alerts; do not rely on hiding rules for safety. |
| Account takeover | Credential stuffing, session theft, recovery social engineering | Managed identity, passkeys/MFA options, device/session visibility, revocation, rate limits, recovery evidence and notification, HQ step-up. |
| Trusted Circle abuse | Coercive invite, stalking, compromised relative, over-sharing | Explicit acceptance, scoped permissions, private artifacts, protected-person notifications, revocation, step-up, audit, abuse-support path. |
| Employee manipulation | Caller claims emergency and requests artifact/account access | No support impersonation; verified workflow, case/reason, time-bound JIT grant, step-up, immutable audit, sensitive-view alert and periodic review. |
| False reporting/review poisoning | Users/partners inject mislabeled cases or campaigns | Separate feedback from ground truth; provenance and reviewer independence; no automatic rules/model training; abuse limits. |
| Supply-chain/provider compromise | Package, model, feed, webhook, SDK | Lockfiles and dependency review, minimal SDKs, signed webhook verification, egress scoping, provider isolation, SBOM/release evidence, kill switches. |

## Model execution contract

The adapter input contains a minimized artifact segment delimited as untrusted data, typed deterministic signals, a policy version, and the exact response schema. The system prompt contains no credential, private rule corpus, customer fact, or sealed label. The adapter returns bounded enums, evidence references, uncertainty, and explanation candidates only.

Before use, code rejects unknown keys, out-of-range values, invented evidence IDs, active links/markup, forbidden actions, prompt/system leakage patterns, and excess output. The application records model/provider/prompt version and failure state, then independently composes the verdict/action. Model output is never directly rendered or executed. Temperature reduction, a second model, or injection keyword filters may add defense but do not establish the boundary.

## Test program

Maintain adversarial fixtures for instruction override, system-prompt extraction, cross-customer requests, invisible Unicode, encoded instructions, Markdown exfiltration, forged provider evidence, “call this number,” fake safe-word verification, tool requests, overlong payloads, repeated variants, and provider timeout/malformed JSON. Test every modality separately as it is added.

Security regression must prove: no model call when disabled; no secret/content in logs; no tool/network capability; schema failure becomes `unknown`; deterministic action invariants survive injected text; cross-household access fails before analysis; and rate/cost ceilings activate. Run an independent prompt-injection and application-security review before enabling a live provider.

## Evidence

Accessed 2026-08-15:

- [OWASP LLM Prompt Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
- [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [NIST adversarial machine-learning taxonomy, AI 100-2 E2025](https://csrc.nist.gov/pubs/ai/100/2/e2025/final)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

