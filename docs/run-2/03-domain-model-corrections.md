# Domain Model Corrections

Status: **implemented and focused-test verified locally; production identity and consent-language proof remain blocked**.

## What changed

Run 2 replaces the overloaded household role with independent authority facts:

- neutral household membership;
- scoped household administration;
- self-accepted protected-person enrollment;
- exact protected-person/Trusted Circle relationships and grants;
- payer identity and separate billing-management authority; and
- employee eligibility, support-case assignment, and expiring restricted-resource grants.

A person can hold several of these facts at once. Payment, administration, kinship, or employment does not imply Family or artifact access. Ending one Trusted Circle pair leaves unrelated pairs and household authority unchanged. Commerce allowance reconciliation can rebind eligible protected-member and Trusted Circle allocations without rewriting consent.

Consent is append-only evidence with actor, subject, recipient, purpose, scope, action, disclosure/policy version and digest, interaction, session/audience, effective time, and supersession. Database triggers reject mutation or deletion. Current grants are projections; participant withdrawal, administrative suspension, expiry, and revocation remain distinct.

## Evidence

**Tested:**

- `tests/integration/authority-migration.test.ts` migrates populated Run 1 authority and invitations.
- `tests/integration/tenant-family.test.ts` covers multi-authority members, exact-pair views, revocation, lapse, credential-bound invitation acceptance, and cross-household isolation.
- `tests/integration/authority-consent.test.ts` proves append-only evidence, identity binding, and separate support scopes.
- `packages/authorization/src/authorization.test.ts` denies role shortcuts for administrator, payer, billing, Trusted Circle, and support access.

See [ADR-0011](../adr/0011-orthogonal-household-authority-and-pairwise-trust.md) and [ADR-0012](../adr/0012-append-only-consent-and-identity-bound-invitations.md).

## Evidence boundary

**Development-only:** local invitations may use a visibly unbound code. **Blocked by account:** production identity binding, MFA/step-up, recovery, and session assurance. **Professional blocker:** consent wording, comprehension, coercion response, and privacy/legal sufficiency. No production household has exercised this model, and Run 2 does not launch it.
