# ADR-0011: Orthogonal Household Authority and Pairwise Trust

Status: **Accepted Run 2 design; local schema and authorization proof required; production identity and consent-language proof blocked**

Decision date: 2026-08-16

## Context

Run 1 correctly separated protected enrollment from household ownership, but `household_memberships.role` still makes owner, protected-member, and Trusted Circle participation mutually exclusive. That prevents ordinary topologies such as two spouses who are both administrators and protected people while each is trusted by the other. Payment, billing, support, and employee facts also need lifecycles that cannot accidentally grant artifact access.

## Supersession

This ADR supersedes the household-role-resolution portion of [ADR-0003](./0003-managed-identity-and-resource-authorization.md)'s Decision. Managed identity, distinct audiences, server-derived principals, and central authorization remain unchanged. It clarifies, but does not replace, [ADR-0008](./0008-provider-neutral-entitlements.md)'s rule that payment never grants relationship permission.

## Decision

Model these as independent facts:

- neutral household membership;
- one or more scoped administrator assignments;
- self-accepted protected enrollment and its entitlement allowance;
- exact `(household, protected person, trusted person)` relationships and grants;
- payer economic identity and separate billing-management authority;
- employee eligibility, exact support-case assignment, and time-bounded restricted-access grant.

A person may hold any valid combination. No grant is inferred from age, kinship, membership, administration, payment, sponsorship, or employment. Trusted Circle permissions live only on the exact pair and use a canonical vocabulary. Ending one pair cannot change another pair, household administration, protected enrollment, or commerce state. An administrator may safety-suspend access under policy, but cannot impersonate a protected person's withdrawal or rewrite consent history.

Authorization resolves current, unexpired facts at request time and passes an explicit scope to tenant-filtered repositories. Payer and billing views contain commerce data only. Employee roles establish eligibility, not customer authority; restricted content additionally requires a case, purpose, resource, recent step-up, expiry, and audit.

## Consequences

The schema and policy graph become more explicit, and UI labels must distinguish “member,” “administrator,” “protected,” “trusted,” “payer,” and “billing manager.” Migrations need deterministic conversion of legacy membership roles and rollback evidence. More joins are accepted to prevent authority collapse and to support real household topologies.

## Rejected alternatives

- Role arrays or a larger membership enum: still mixes facts with different scope and revocation.
- Household-wide Trusted Circle visibility: violates pairwise consent.
- Owner, payer, or employee superuser shortcuts: creates invisible privilege escalation.
- Duplicating a person to represent multiple roles: breaks identity, audit, and revocation.

## Verification

Migration and authorization tests must prove two administrator/protected spouses with reciprocal trust, an adult-child payer trusted by a parent, one trusted person serving multiple protected people, unrelated-pair preservation on revocation, and zero Family visibility from payer/billing/support eligibility alone. Negative tests cover cross-household IDs, inactive membership, expired grants, audience confusion, and stale-session roles.

## Evidence boundary

The orthogonal local graph is not account-blocked. Identity-bound invitation recovery and production step-up require a selected managed-identity staging account. Consent wording, coercion response, and customer-visible support accountability require qualified privacy/legal review before launch.

## Primary sources

Design evidence is the amended [Master Spec](../BOOMERBUDDY-2.0-MASTER-SPEC.md) and [external-review adjudication](../run-2/01-external-review-adjudication.md). Assurance and least-privilege guidance was rechecked 2026-08-16 in [NIST SP 800-63-4](https://www.nist.gov/publications/nist-sp-800-63-4-digital-identity-guidelines) and [NIST SP 800-53 Rev. 5](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final).
