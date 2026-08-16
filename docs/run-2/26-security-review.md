# Security Review

Status: **expanded local security controls passed the frozen Run 2 gate; production security remains blocked and uncertified**.

## Implemented local controls

- Server-derived resource scope separates customer, mobile, and HQ audiences and rejects payer/administrator/support shortcuts.
- Exact origin checks protect browser sessions/mutations; CORS is allowlisted. Trusted-proxy handling defaults to the direct peer and accepts only a bounded zero-to-two-hop configuration that must match reviewed topology.
- Zod boundary validation, bounded bodies, non-enumerating failures, and Stripe raw-body signature verification reduce input/webhook risk.
- Contextual encryption, scoped HMACs, typed redaction, safe logging, and content-free operational envelopes reduce exposure.
- The Check path never fetches a submitted URL. Seven provider roles receive exact allowlisted fields; freshness, local budgets, kill switches, and a required durable live-rate reservation fail closed.
- Public Check applies per-context, atomic global/per-client HMAC quotas, and expiring global/per-client database concurrency leases without storing a raw address as quota identity.
- Append-only consent, provider event, knowledge/evaluation, privacy request, conversion, commerce, and causal replay evidence resists silent rewriting.
- Durable work uses leases, canonical replay-lineage receipts, restrictive lineage foreign keys, idempotency, retry/dead letter, audited replay, and poison-predecessor ordering.
- The portability/V1 guard inspects runtime imports and statically decodable path construction rather than relying on a plain text search.

Frozen evidence includes full workspace typecheck, ESLint, and Prettier PASS; security 6 files/19 tests PASS; the broader unit/integration/evaluation suites PASS; and Edge 15/15 PASS. Coverage was 90.20% statements, 88.35% branches, 98.19% functions, and 93.67% lines across the frozen aggregate. The evaluation recorded zero forbidden actions, one intentional provider-outage case, and `not_calibrated`. Windows browser teardown linger required terminating only verified API/web/HQ listeners, after which the ports were clear. These are automated local checks, not a penetration test or production evidence.

## High-risk boundaries

Production startup deliberately refuses development identity and local key handling. Application/database Public Check controls do not prove CDN/WAF/bot/challenge behavior, correct deployed proxy attribution, or resistance to distributed address rotation. No live provider, hosted database, telemetry, storage, messaging, Stripe, or mobile-store behavior has been exercised against company accounts. There is no production network design, secret-rotation ceremony, independent restore, incident exercise, abuse shift, penetration test, SBOM/license/provenance adjudication, or image attestation.

## Verdict

Checked-in controls materially narrow local risk, but absence of a local finding is not production assurance. Staging requires a refreshed threat model, external edge controls, managed identity/KMS, real PostgreSQL and restore evidence, dependency/supply-chain review, selected-vendor assessment, incident rehearsal, and independent security testing. Professional decisions remain **blocked by specialists and external infrastructure**. **No launch.**
