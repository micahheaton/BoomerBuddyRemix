# Commerce

Status: **Stripe test-mode architecture and deterministic transaction path implemented; authentic Stripe proof and first-dollar operations are blocked**.

## Canonical design

BoomerBuddy, not Stripe, decides access. Versioned products, plans, prices, subscriptions, grants, capabilities, and protected/Trusted Circle allowances sit above web, Apple, Google, sponsor, partner, promotion, support, and future enterprise sources. Access requires a source-verified, eligible subscription and an effective matching grant. Payer and billing authority remain separate from Family permission.

## Implemented web path

The API supports an authenticated, server-authorized Stripe test Checkout and a configured cancel-only Customer Portal. Checkout is serialized per household, idempotency evidence is compared, stale 30-minute intents are expired, and one open web subscription per household is enforced. Provider customer IDs bind to exactly one household.

The webhook endpoint preserves and verifies the raw body, enforces a 256 KiB cap, test livemode, API version, timestamp tolerance, and idempotent inbox. A first subscription must bind to a server-created, unexpired checkout while billing authority is still active; price, interval, provider period, customer, and event time are checked. Ambiguous, incomplete, out-of-order, refund, dispute, and invoice evidence is quarantined or sent to a durable reconciliation job. Grace is bounded to no more than three days. Full refund or dispute restrictions revoke access and are not cleared by a later ordinary active snapshot; partial refund remains active but creates owner attention.

Applied lifecycle changes reconcile the canonical grant and protected-member/Trusted Circle allowance bindings transactionally. The portal never supplies client-owned customer authority.

## Focused evidence

`tests/integration/stripe-commerce.test.ts` exercises Checkout → signed webhook → canonical grant → allowance/application access → portal, duplicates, abandoned and provider-expired Checkout, revoked billing authority, bounded grace, durable reconciliation, refund, dispute, and foreign binding. `packages/integrations/src/integrations.test.ts` covers raw signatures, supported versions, server authorization, invoice allowlisting, and provider normalization. `packages/persistence/src/commerce-provider.test.ts` covers event evidence, ordering, and customer isolation.

This is deterministic fixture/transport evidence, not a real transaction.

## Blockers and limits

**Blocked by account:** Stripe test keys, products/prices, webhook endpoint, cancel-only portal configuration, and reachable staging. **First-dollar blockers:** tax registrations/settings, final prices, discount/trial rules, dunning/customer communications, refund/chargeback policy, financial-restriction clearance, support runbook, accounting, legal terms, and live observability. Upgrade/change-plan operations are not built. No live money moved; no launch.

See [ADR-0017](../adr/0017-provider-neutral-commerce-and-storefront-policy.md).
