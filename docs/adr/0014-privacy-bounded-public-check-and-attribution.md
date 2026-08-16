# ADR-0014: Privacy-Bounded Public Check and Attribution

Status: **Accepted Run 2 design; local ephemeral proof required; production abuse controls and acquisition outcomes blocked**

Decision date: 2026-08-16

## Context

Requiring sign-in before a first useful Check protects persistence but removes the likely consumer entry loop. An anonymous endpoint can create abuse, secret leakage, durable shadow profiles, and accidental authority if it is implemented as “member Check without auth.” Public use needs a separate, smaller security and data contract.

## Supersession

No earlier ADR is superseded in full. This ADR adds the public context omitted by [ADR-0003](./0003-managed-identity-and-resource-authorization.md). [ADR-0006](./0006-no-url-fetch-and-isolated-future-acquisition.md)'s no-fetch boundary remains unchanged for public and member Checks.

## Decision

Provide a useful anonymous text/URL-string analysis under a server-minted, short-lived, purpose- and audience-bound context. The token is opaque, integrity protected, expiring, replay-bounded, and grants only transient Check operations. It is not a household session, identity, entitlement, referral authority, or artifact permission.

The public path enforces strict byte, time, concurrency, and per-context/shared abuse budgets before expensive work. It uses the same typed minimization and deterministic action policy as member Check. Responses are non-enumerating and fail safely. Submitted content, URLs, hosts, query strings, redacted artifacts, fingerprints, evidence bodies, and free text never enter durable history, analytics, logs, outbox, attribution, or abuse records.

Only content-free operational counters and coarse states may persist. A short-lived server-side result may support immediate display and a one-time conversion grant; expiry or process loss yields an honest unavailable state. Saving requires an authenticated customer, explicit save consent, and a new actor-owned Check created from the already redacted transient representation. The system never silently converts, associates content with a campaign/referrer, or grants a payer, administrator, or referrer access. If the safe transient handoff is gone, it does not request a secret-bearing original merely to preserve conversion.

Attribution is a separate privacy-bounded touchpoint: allowlisted campaign/referral identifiers, landing route, coarse device/channel, consent state where applicable, and timestamps. It contains no submission-derived data and has explicit retention. Deterministic first/last-touch facts may be measured, but causal credit and conversion performance remain hypotheses.

## Consequences

People can receive value before registration, and the product obtains a measurable acquisition path without building a content dossier. Strict limits and ephemeral loss reduce convenience and make abuse controls a production dependency. Attribution is deliberately less granular than common advertising stacks.

The Run 2 application converts a normalized network address to a keyed HMAC and stores no raw address as its quota identity. Atomic database buckets enforce global and per-client context/Check budgets, while expiring leases enforce global and per-client analysis concurrency. Trusted-proxy configuration is bounded to zero through two hops and defaults to the direct peer. These controls narrow local abuse risk; they do not prove a deployed edge, proxy, WAF, challenge service, or distributed defense.

## Migration and rollback

Public contexts, transient results, aggregate attribution, and consented conversions use separate additive records; authenticated Check history is not copied into the anonymous surface. Deployment begins behind a disabled route/feature boundary with retention and quota jobs active before traffic. Conversion backfill is prohibited because explicit save consent must exist at the moment of conversion.

Rollback disables new context issuance first, allows or expires in-flight display windows, runs terminal purge, and preserves only content-free aggregate and immutable consent evidence required by policy. It must not copy transient results into authenticated history, extend expiry to rescue conversion, or request the original submission again. If purge or quota enforcement fails, the public route stays disabled until reconciled.

## Security and privacy consequences

Anonymous does not mean unbounded or non-sensitive. Context tokens are integrity protected and purpose/audience bound; transient results are encrypted, byte/time/use limited, and physically purged. Per-client quota keys use a keyed digest rather than raw network addresses and remain operational abuse data, not identity or attribution. Proxy trust must match reviewed topology. No submission-derived value enters telemetry or attribution, and campaign/referral context grants no content authority. Consent, deletion, non-enumeration, SSRF/no-fetch, bot defense, distributed attacks, and incident behavior still require staging proof.

## Rejected alternatives

- Anonymous use of authenticated Check routes or a shared service account.
- Durable anonymous artifact/history “for later conversion.”
- Content, host, URL, fingerprint, or free-text analytics.
- Forced signup before showing urgent actions.
- Treating campaign, referral, payer, or household context as artifact authority.

## Verification

Tests prove context expiry, audience/purpose binding, replay limits, atomic global/per-client HMAC quotas, global/per-client concurrency leases and expiry, trusted-proxy configuration bounds, body budgets, non-enumerating failures, no network fetch, useful safe actions, and safe provider failure. Persistence-spy tests show zero artifact/analysis/content fields in database, logs, metrics, audit/outbox, and attribution before consent. Conversion tests prove explicit consent, one-time use, a new actor-owned resource, no secret resubmission, and no access transfer to referrer or payer.

## Evidence boundary

Local transient behavior, per-client/global database quotas, concurrency leases, and bounded proxy configuration are implemented without accounts. No external edge/WAF/challenge service or deployed proxy topology has been configured or proved. Distributed abuse behavior, privacy-reviewed bot defense, and operational retention assertions require staging infrastructure. Comprehension, conversion, acquisition cost, and safety effectiveness require real consented research; no result may be simulated or claimed in Run 2.

## Primary sources

The product boundary comes from the amended [Master Spec](../BOOMERBUDDY-2.0-MASTER-SPEC.md). Privacy lifecycle and disassociability guidance was rechecked 2026-08-16 in the [NIST Privacy Framework](https://www.nist.gov/privacy-framework) and [NIST Privacy Framework introduction](https://www.nist.gov/privacy-framework/getting-started-0). URL isolation continues to follow the primary decision and [OWASP SSRF Prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).
