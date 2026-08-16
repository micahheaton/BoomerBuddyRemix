# Public Check

Status: **useful anonymous local flow and atomic consented save implemented; public staging abuse controls and acquisition outcomes are blocked**.

## What works locally

An anonymous visitor can request a 10-minute opaque context, perform up to three text or URL-string Checks, receive the same full deterministic safety result as a member, and optionally save it after authenticating. The API performs no URL fetch. Safe redaction happens before analysis; unsafe URL credentials and ambiguous secrets fail closed.

The context secret and one-time conversion secret are stored only as keyed HMACs. The redacted result is encrypted for a 15-minute handoff and is not added to customer history, analytics, audit, or outbox before consent. Attribution is allowlisted to coarse source/campaign values and daily aggregate counts; it contains no submission-derived value.

Save requires customer/mobile authentication, exact household authorization, `public-check-save-v1` consent, and the matching one-time grant. Check creation, immutable conversion evidence, grant consumption, content-free audit/outbox, and rollback occur in one transaction. A repeat by the same actor returns the same owned Check; a different actor, household, result, or credential gets the same non-enumerating failure. Terminal anonymous rows are physically removed after a 24-hour horizon.

## Focused evidence

`tests/integration/public-checks.test.ts` covers transient redaction, zero customer persistence, one-time actor-owned save, transaction rollback, retry, and unsafe URL rejection. `tests/security/public-check-conversion.test.ts` proves immutable consent evidence and content-free operations. `packages/persistence/src/public-checks.test.ts` covers token storage, encryption, source binding, reserved-risk refusal, expiry, and physical purge. The public Playwright journey exists but is not production evidence.

## Staging blockers

The repository has database-global per-minute quotas (60 contexts and 30 Checks) and per-context use limits. It does **not** yet have a privacy-preserving per-client/edge limiter, concurrency budget, bot defense, trusted-proxy design, distributed quota, or edge-level body controls. A bot could exhaust the global budget for everyone. Signup/activation/paid conversion measurement is not connected to Public Check; only context and completion aggregates exist.

Production edge behavior, retention observation, accessibility/comprehension research, conversion, CAC, and safety effectiveness are **blocked by staging infrastructure and consented research**. Public staging is not approved, and Run 2 does not launch. See [ADR-0014](../adr/0014-privacy-bounded-public-check-and-attribution.md).
