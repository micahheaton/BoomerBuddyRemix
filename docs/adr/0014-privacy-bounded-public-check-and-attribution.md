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

## Rejected alternatives

- Anonymous use of authenticated Check routes or a shared service account.
- Durable anonymous artifact/history “for later conversion.”
- Content, host, URL, fingerprint, or free-text analytics.
- Forced signup before showing urgent actions.
- Treating campaign, referral, payer, or household context as artifact authority.

## Verification

Tests prove context expiry, audience/purpose binding, replay limits, rate/concurrency/body budgets, non-enumerating failures, no network fetch, useful safe actions, and safe provider failure. Persistence-spy tests must show zero artifact/analysis/content fields in database, logs, metrics, audit/outbox, and attribution before consent. Conversion tests prove explicit consent, one-time use, a new actor-owned resource, no secret resubmission, and no access transfer to referrer or payer.

## Evidence boundary

Local transient behavior and abuse fixtures are not account-blocked. Production edge behavior, distributed rate limiting, bot-defense privacy, and retention assertions require staging infrastructure. Comprehension, conversion, acquisition cost, and safety effectiveness require real consented research; no result may be simulated or claimed in Run 2.

## Primary sources

The product boundary comes from the amended [Master Spec](../BOOMERBUDDY-2.0-MASTER-SPEC.md). Privacy lifecycle and disassociability guidance was rechecked 2026-08-16 in the [NIST Privacy Framework](https://www.nist.gov/privacy-framework) and [NIST Privacy Framework introduction](https://www.nist.gov/privacy-framework/getting-started-0). URL isolation continues to follow the primary decision and [OWASP SSRF Prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).
