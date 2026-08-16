# Public Check

Status: **useful anonymous local flow, privacy-preserving application abuse controls, and atomic consented save are implemented; external public-edge proof and acquisition outcomes are blocked**.

## What works locally

An anonymous visitor can request a short-lived opaque context, perform a bounded number of text or URL-string Checks, receive the same deterministic safety result as a member, and optionally save once after authentication and consent. The API performs no URL fetch. Safe redaction precedes analysis; unsafe URL credentials and ambiguous secrets fail closed.

Context and conversion secrets are stored only as keyed HMACs. A normalized network address is also converted to a per-client HMAC; the raw address is not stored as the quota identity. Atomic database buckets enforce global and per-client context/Check budgets. Expiring database leases enforce global and per-client analysis concurrency. Per-context use limits still apply. The transient redacted result is encrypted for the handoff and is excluded from customer history, analytics, audit, and outbox before consent.

`BB_TRUSTED_PROXY_HOPS` is bounded to zero through two hops. Zero trusts only Fastify's direct peer; a nonzero value must match a reviewed deployment topology. This prevents implicit trust of arbitrary forwarding headers, but configuration is not evidence that any real proxy is correct.

Save requires customer/mobile authentication, exact household authorization, `public-check-save-v1` consent, and the matching one-time grant. Check creation, immutable conversion evidence, grant consumption, content-free audit/outbox, and rollback occur in one transaction. Terminal anonymous rows are physically purged after their maximum horizon.

## Local evidence

Integration, repository, security, and browser tests cover transient redaction, client binding, atomic global/per-client quotas, concurrency acquisition/release/expiry, one-time actor-owned save, rollback/retry, non-enumeration, unsafe URL rejection, immutable consent evidence, and physical purge. These prove local application/database behavior only.

## External boundary

No CDN, WAF, bot/challenge service, public proxy topology, distributed-region budget, edge body limit, load test, or internet-abuse exercise has been configured or observed. The HMAC database controls reduce local abuse risk; they do **not** prove public-edge protection, correct production client attribution, or resistance to address rotation and distributed attacks.

Content-free growth projections now connect save and subsequent product milestones locally, but no public traffic, real conversion, CAC, comprehension, accessibility, or safety-effectiveness result exists. Public staging remains unauthorized. See [ADR-0014](../adr/0014-privacy-bounded-public-check-and-attribution.md) and [acquisition attribution](./13-acquisition-attribution.md). Run 2 does not launch.
