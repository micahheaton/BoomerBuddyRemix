# Security Review

Status: **local security gauntlet passed; production security is intentionally blocked and not certified**.

## Controls verified in Run 2

- Server-derived, resource-scoped authorization separates customer, mobile, and HQ audiences and rejects payer/administrator/support shortcuts.
- Exact origin checks protect browser sessions and mutations; CORS is allowlisted and proxy trust is disabled.
- Zod boundary validation, bounded bodies, non-enumerating failures, and Stripe raw-body signature verification reduce input and webhook risk.
- AES-256-GCM contextual encryption, scoped HMAC fingerprints, typed redaction, safe log sanitation, and content-free operational envelopes reduce data exposure.
- The Check path does not fetch submitted URLs. Fraud providers receive structured allowlisted fields and have budget, timeout, data-policy, and kill-switch controls.
- Append-only consent, provider-event, knowledge/evaluation, and Public Check conversion evidence resists silent rewriting.
- Durable work uses leases, receipts, idempotency evidence, retry/dead-letter controls, and fail-closed completion.

Workspace typecheck and lint passed after repository-owned fixes. The final security selection passed 17 tests across five files, including session/origin confusion, production dev-identity refusal, restricted-input persistence, retention, bootstrap behavior, and Public Check conversion. These are local automated checks, not penetration-test or production evidence.

## High-risk boundaries

Production startup is deliberately refused because managed identity and KMS-grade key handling do not exist. Public Check has global database quotas but lacks distributed privacy-preserving client/edge limits and bot defense. Provider, database, hosting, telemetry, storage, email/SMS, Stripe, and mobile-store behavior is untested against real accounts. There is no production network design, WAF configuration, secret rotation ceremony, backup restore, incident exercise, abuse operations, independent penetration test, or supply-chain attestation.

## Verdict

No known local Critical issue is being claimed here, but absence of a finding is not production assurance. Staging requires threat-model refresh, real PostgreSQL/concurrency checks, edge abuse controls, managed identity/KMS, dependency and secret scanning, vendor review, restore/incident drills, and independent security testing. Security-sensitive professional decisions remain **blocked by specialists and external infrastructure**. **No launch.**
