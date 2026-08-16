# Fraud Intelligence Architecture

Status: **designed on 2026-08-15; only the deterministic text/URL-string slice is proposed for Build Run 1**.

## Decision

BoomerBuddy is not an LLM verdict wrapper. Its safety product is a traceable pipeline:

`ingest → normalize → acquire permitted evidence → deterministic signals → reputation signals → social-engineering signals → taxonomy → rules-based evidence-sufficiency/confidence → explanation → safe action`

Each result must preserve evidence provenance, provider/version, freshness, failures, and the distinction between **risk** and **confidence**. No single missing lookup becomes “safe.” Provider errors produce an explicit unknown state. User-visible risk is `lower_concern`, `caution`, `high_concern`, or `unknown`, paired with a coarse rules-based evidence-sufficiency/confidence band—never a guarantee. Run 1 confidence is **not empirically calibrated**; that claim requires a representative, independently adjudicated corpus. Exploratory calibration metrics may expose gaps but do not change that status.

## Build Run 1 pipeline

Run 1 accepts bounded plain text and URL strings. It will:

1. validate type and size and normalize Unicode/whitespace in a bounded transient buffer;
2. detect recognizable private-key blocks, Luhn-valid payment-card numbers, credential/authorization tokens, and one-time-code patterns; retain only non-sensitive signal flags, then reject or redact the values before any database, fingerprint, log, audit, outbox, fixture, or provider boundary;
3. compute `keyedFingerprint` over only the minimized representation: a tenant- and purpose-scoped keyed HMAC made with a key separate from encryption keys;
4. parse URL strings with a standards-based parser, canonicalize only well-understood components, and expose bounded structural characteristics without persisting embedded credentials;
5. extract deterministic social-engineering signals such as urgency, secrecy, impersonation, credential/verification-code requests, payment rails, remote-access requests, threats, and suspicious contact instructions;
6. invoke a provider interface whose local adapter returns `mock/unknown`—never a simulated “clean” lookup;
7. apply versioned, monotonic scoring and confidence rules;
8. choose actions from a deterministic policy library, then generate a plain explanation from structured evidence;
9. store only the encrypted, minimized artifact separately from structured evidence and audit metadata.

**Run 1 will never resolve, request, redirect through, render, or otherwise fetch a submitted URL.** This is both a scope choice and an SSRF/data-exposure control. It means Run 1 can comment on string characteristics but cannot claim page, DNS, TLS, domain-age, redirect, or live reputation verification.

## Evidence model

An evidence item contains `sourceKind`, `sourceName`, `observedAt`, `validUntil`, `providerVersion`, `keyedFingerprint`, `fingerprintKeyVersion`, `signal`, `value`, `weight`, `limitations`, and a non-sensitive trace reference. `keyedFingerprint` is a tenant-/purpose-scoped keyed HMAC of the already minimized representation, never an unkeyed digest: artifact text and URLs can be low entropy and guessable. The fingerprint key is separately stored, versioned, rotated, and unavailable to analytics/providers. Legacy unkeyed fingerprint fields are prohibited. Evidence classes are:

- **artifact-derived:** bounded facts from the submitted bytes/string;
- **authoritative/reputation:** a versioned provider response and freshness window;
- **contextual:** campaign/taxonomy relationships with explicit provenance;
- **model-derived:** optional structured interpretation, always labeled non-authoritative;
- **missing/failed:** a first-class fact that reduces confidence rather than risk.

The verdict records the scoring-policy version, evidence set, risk band, confidence band, uncertainty reasons, safe-action policy version, provider failures, and whether a human reviewed it. Explanations cite evidence labels, not invented facts.

## Artifact-specific target pipelines

### URL (future live evidence)

Add commercial URL reputation first, then independently evaluated RDAP/domain-age, DNS, certificate transparency/TLS, redirect-chain, hosting/campaign, and page-form signals. Google Web Risk states that its lists are not comprehensive or error-free. Its Lookup API sends the actual URL to Google; its Update API checks downloaded threat-list prefixes mostly on the customer side but is more complex. The free Safe Browsing API prohibits commercial use absent a separate agreement, so it is not a BoomerBuddy production shortcut.

Any later page acquisition runs in an isolated worker with no customer or control-plane credentials, deny-by-default egress, blocked loopback/private/link-local/metadata networks after every DNS resolution, bounded redirect hops, methods, time, bytes, decompression, and content types, no cookies or ambient authentication, disposable storage, and sanitized output. Browser automation and active content require a stronger sandbox. This worker cannot reach the primary database. See [ADR-0006](../adr/0006-no-url-fetch-and-isolated-future-acquisition.md).

### Messages and email

Parse supplied headers only when present; never imply sender authentication from display text. Signals include From/Reply-To/domain mismatch, SPF/DKIM/DMARC results when trustworthy headers are supplied, new contact/unsolicited context, urgency/secrecy, credential or code requests, payment rails, authority/family impersonation, embedded URLs/phones, and known campaigns. A legitimate brand name or good grammar is not exculpatory.

### Images, documents, and QR (deferred)

The future chain is quarantine → media verification/malware scan → metadata stripping → bounded decode → OCR/QR/entities → the same text/URL pipeline. Original files are never rendered in HQ or a browser origin. Optical/QR extraction preserves coordinates and confidence; it does not silently navigate.

### Audio and voice (deferred)

Require recording/consent UX and jurisdiction review before upload. Transcription, caller evidence, claims, payment/urgency, and family-verification workflows may inform risk. Voice-clone detection is an experimental signal, never identity proof or a definitive AI label.

## AI boundary

The optional model adapter is disabled without explicit configuration and is provider-neutral. It receives a minimized, delimited artifact plus structured deterministic signals; it has no tools, network, memory, secrets, other customer data, or authority to choose actions. Output must satisfy a closed schema and be rejected on parse/range/provenance failure. Deterministic rules select user actions. A model change cannot ship until the Fraud Evaluation Lab passes.

Official OpenAI documentation says API data is not used for training by default, but default abuse-monitoring retention for Responses can be 30 days and Zero Data Retention requires approval. Therefore provider use still needs consent/disclosure, a data-processing review, `store:false` where supported, regional/retention confirmation, and a no-content logging policy.

## Safe-action policy

Actions are versioned, risk-aware, and institution-neutral: stop; do not reply/click/pay/share a code; independently find the organization’s official contact channel; call a trusted person; preserve evidence; secure accounts/payment channels; and use official reporting/recovery routes. Never recommend the submitted phone number or link. High confidence is not required to recommend a reversible pause.

## Evidence

Accessed 2026-08-15:

- [Google Web Risk overview](https://cloud.google.com/web-risk/docs/overview)
- [Google Web Risk pricing](https://cloud.google.com/web-risk/pricing)
- [Google Safe Browsing terms](https://developers.google.com/safe-browsing/terms?hl=en)
- [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
- [OpenAI model comparison](https://developers.openai.com/api/docs/models/compare)
