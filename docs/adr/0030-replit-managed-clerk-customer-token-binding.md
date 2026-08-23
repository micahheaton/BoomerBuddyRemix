# 0030. Bind Replit-managed customer Clerk tokens without requiring `aud`

Date: 2026-08-23

Status: Accepted for the Replit Founding Household candidate

## Context

Replit-managed Clerk uses Clerk's standard session token in the `__session` cookie. The standard
token is signed by one Clerk instance and includes an exact issuer, provider subject, provider
session ID, authorized party (`azp`), and bounded lifetime, but it does not include `aud` by default.
The previous verifier always required `aud`, so a valid managed customer session could not reach the
BoomerBuddy server-side identity and authorization boundary.

The customer and HQ identity realms remain separate. HQ also requires recent signed second-factor
evidence and is not covered by this compatibility decision.

## Decision

For customer sessions only, verify the Clerk signature with the configured customer public key and
require the exact configured issuer, request origin, `azp`, subject, session ID, and token lifetime.
An absent `aud` is accepted. If a customer token contains `aud`, it must equal the configured
customer audience. The HQ verifier continues to require its exact audience and recent `fva`
second-factor evidence.

BoomerBuddy continues to resolve the provider subject through its server-side production-identity
binding. It does not consume household IDs, person IDs, roles, entitlements, or permissions from
Clerk claims.

## Security consequences

The customer realm remains bound by a distinct issuer, signing key, and exact authorized party, so a
token from another Clerk instance or origin is rejected even when it omits `aud`. A token with an
explicit wrong audience is rejected. Cross-realm use remains denied by the distinct issuer, key,
origin, and HQ audience/factor requirements.

This exception must not be extended to HQ or to a provider that lacks a cryptographically distinct
customer realm and exact `azp` binding.

## Verification

Unit coverage includes a real signed customer token without `aud`, a wrong explicit customer
audience, an HQ token without `aud`, wrong issuer and `azp`, expired/not-yet-valid tokens, signature
tampering, acting or pending sessions, realm swapping, and stale or missing HQ second-factor age.

