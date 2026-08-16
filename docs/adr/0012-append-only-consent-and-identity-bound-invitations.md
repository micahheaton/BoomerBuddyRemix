# ADR-0012: Append-Only Consent and Identity-Bound Invitations

Status: **Accepted Run 2 design; local lifecycle proof required; production identity and professional review blocked**

Decision date: 2026-08-16

## Context

Authorization needs fast current state, while consent and invitation disputes need durable evidence of what a person saw, intended, accepted, changed, or ended. A mutable consent row loses that history. A bearer invitation also cannot establish that the intended identity accepted it, and accepting an invitation must not silently create broader membership or authority.

## Supersession

This ADR supersedes [ADR-0003](./0003-managed-identity-and-resource-authorization.md)'s underspecified use of “consent” as a current authorization input. It does not change that ADR's identity or audience decisions. [ADR-0005](./0005-transactional-outbox-and-at-least-once-events.md) remains the delivery contract; an outbox event is not the consent record.

## Decision

Record consent evidence as append-only actions. Each action identifies:

- actor, subject, recipient, household, and exact relationship/resource scope;
- purpose and canonical permission vocabulary;
- action such as propose, accept, defer, expand, narrow, withdraw, relinquish, suspend, reactivate, expire, or revoke;
- disclosure and policy version plus immutable digest;
- source interaction, correlation/causation, session, identity assurance, and step-up evidence where required;
- recorded, effective, expiry, and superseding-action times.

The current authorization projection is derived transactionally and can be rebuilt from evidence. Withdrawal or expiry appends a fact and closes only the relevant projection; history is never overwritten or relabeled. Administrative suspension remains distinct from participant withdrawal. Audit and outbox receive content-free references, not disclosure text or personal content.

Production invitations are identity-bound, scope-limited, expiring, single-use, revocable, non-enumerating, and stored as a keyed digest rather than a retrievable secret. Acceptance requires an authenticated identity matching the intended binding and rechecks membership, allowance, consent version, and inviter authority inside one transaction. Tokens never carry lasting authority. Local bearer-style codes remain visibly development-only evidence.

## Consequences

Consent becomes explainable and reconstructable, at the cost of more records, versioned disclosures, projection logic, and repair tooling. Corrections append a correcting event rather than editing history. Privacy export may include human-readable consent history while operational telemetry remains content-free.

## Rejected alternatives

- A mutable `consent_status` row: destroys evidence and makes races ambiguous.
- Treating audit logs or outbox events as consent: neither proves disclosure or intent.
- Long-lived reusable invitation links: enable forwarding, replay, and unintended acceptance.
- Inferring consent from household ownership, payment, use, or inactivity: violates the domain contract.

## Verification

Tests cover disclosure version/digest, idempotent acceptance, concurrent acceptance, expiry, replay, revocation before use, wrong identity, non-enumerating errors, exact-scope projection, withdrawal versus suspension, independent-pair preservation, and projection rebuild equality. Logs, analytics, URLs, errors, and outbox payloads must exclude invitation secrets and disclosure content.

## Evidence boundary

Append-only local evidence and deterministic invitation lifecycle tests are not account-blocked. Binding to production identity, step-up, recovery, and session assurance is blocked until a managed-identity staging account exists. Legal sufficiency, language comprehension, and coercion handling remain professional and moderated-research gates.

## Primary sources

The controlling product source is the [Master Spec](../BOOMERBUDDY-2.0-MASTER-SPEC.md). Identity and session-assurance guidance was rechecked 2026-08-16 in [NIST SP 800-63-4](https://pages.nist.gov/800-63-4/) and [SP 800-63C-4](https://csrc.nist.gov/pubs/sp/800/63/C/4/final). Privacy lifecycle and individual-impact guidance comes from the [NIST Privacy Framework](https://www.nist.gov/privacy-framework).
