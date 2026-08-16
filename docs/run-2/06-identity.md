# Identity

Status: **local audience/session controls implemented and security-tested; managed production identity is not implemented**.

## Implemented controls

Local and test sessions are short-lived HMAC-signed `boomerbuddy-dev` credentials with bounded opaque claims. Customer and HQ use different cookie names and disjoint origin allowlists; mobile uses a bearer token. The API rejects mixed bearer/cookie credentials, wrong audiences, untrusted origins, tampering, expiry, revocation, and disabled identities. Session resolution rebuilds current household, Trusted Circle, payer, billing, employee, case, and restricted-access scopes from the database rather than trusting client roles.

Production invitations require issuer/subject binding in the persistence contract. Local bearer-style invitation codes remain explicitly development-only. The application refuses `NODE_ENV=production`, and the development verifier also refuses production use.

## Evidence

**Tested:** `tests/security/session-origin.test.ts` covers origin, CORS, audience confusion, revocation, expiry, tampering, and disabled identities. `tests/integration/authority-consent.test.ts` covers verified issuer/subject invitation binding. Authorization tests prove current, exact-scope server decisions. The final Run 2 security selection passed 17 tests across five files.

## Missing production capability

There is no Clerk or other managed-identity adapter, staging tenant, passkey flow, MFA policy, account recovery, identity-proofing choice, enterprise federation path, production cookie/session configuration, or device SecureStore proof. Clerk remains a preferred hypothesis, not a vendor conclusion.

These are **blocked by provider account, founder choice, threat-model review, and device/staging evidence**. Consent language and high-risk recovery require qualified privacy/security review. No production identity assurance claim is made, and Run 2 does not launch.

See [ADR-0003](../adr/0003-managed-identity-and-resource-authorization.md), [ADR-0011](../adr/0011-orthogonal-household-authority-and-pairwise-trust.md), and [ADR-0012](../adr/0012-append-only-consent-and-identity-bound-invitations.md).
