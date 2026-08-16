# ADR-0003: Managed Production Identity and Central Resource Authorization

Status: **Accepted; development adapter selected, production provider deferred**

Decision date: 2026-08-15

## Context

The v1 allowed public object access, client-selected identity, and unsafe administrative paths. BoomerBuddy has customer, mobile, sponsor, and employee contexts whose roles do not imply each other.

## Decision

Buy production identity from a reviewed OIDC/OAuth provider; do not build passwords, MFA, passkeys, or account recovery. Build Run 1 exchanges only allow-listed seeded personas for server-side sessions:

- browser uses distinct signed, HttpOnly customer and HQ cookies;
- mobile uses an opaque, audience-scoped, expiring and revocable development bearer whose server-side session resolves actor and current roles;
- native stores that bearer through Expo SecureStore; Expo web stores it in memory only; this native behavior is device-unverified on the Windows host;
- production refuses every development issuer and credential type.

No client actor ID, role, payer, tenant, consent, or entitlement is trusted. Central policy evaluates principal, issuer/audience, action, tenant, resource ownership, relationship, consent, and entitlement. Application services pass an authorization scope to scoped repositories. Composite tenant foreign keys make cross-tenant attachment invalid. Customer and HQ have distinct origins, clients, audiences, services, and cookies; employee identity is never customer administration.

## Consequences

Run 1 can prove object authorization without pretending to provide production authentication. Native credential storage remains host-blocked evidence. Production requires vendor review, MFA/step-up, recovery, device/session management, and incident procedures.

Rejected: client-supplied user IDs, JWT roles as lasting authority, shared customer/HQ sessions, custom credentials, and RLS as the sole control.

## Verification

Negative tests cover cross-tenant read/list/update/delete/invite/share and indirect IDs; production-mode tests reject dev issuers. Guidance accessed 2026-08-15: [NIST SP 800-63-4](https://www.nist.gov/publications/nist-sp-800-63-4-digital-identity-guidelines), [OWASP BOLA](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/), and [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/). SecureStore documentation informs the intended adapter, not device evidence.
