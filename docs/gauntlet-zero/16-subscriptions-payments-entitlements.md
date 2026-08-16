# Subscriptions, Payments, and Entitlements

Status: **canonical model designed; Build Run 1 uses a visibly local/mock commerce adapter and never contacts or charges a real provider**.

## Decision

Commerce providers report transactions; BoomerBuddy decides product access. No Stripe customer ID, App Store receipt on a device, client flag, referral code, or partner assertion directly unlocks a feature. A canonical entitlement service converts verified provider state, sponsorship, promotion, and owner-approved exceptions into time-bounded grants and preserves the source history.

## Canonical model

- `Product` and immutable `PlanVersion`: market offer, interval/price hypothesis, seat/protected-member allowances, included capability keys, effective dates.
- `Subscription`: payer, product/plan version, commerce source, normalized lifecycle, current service period, renewal/cancel/trial/grace metadata.
- `ProviderAccount` / `ProviderSubscriptionRecord`: external IDs and raw provider state, unique within provider/environment; never authorization fields.
- `EntitlementGrant`: subject (person/household/organization), capability or allowance, source, source reference, effective interval, restrictions, revocation reason.
- `SeatAssignment` / `ProtectedMemberAllocation`: explicit assignment under an eligible grant; a household payment does not grant artifact visibility.
- `Sponsorship` / `Eligibility`: organization-funded eligibility and privacy/reporting policy, independent of household consent.
- `CommerceEventInbox`, `Transaction`, `Refund`, `Dispute`, and `ReconciliationRun`: immutable provider evidence and processing history.

Normalized subscription states are `pending`, `trialing`, `active`, `grace`, `delinquent`, `paused`, `cancel_at_period_end`, `canceled`, `expired`, and `disputed`. Provider-specific states remain in the provider record. Access is computed from active grants at server time; cache entries are short-lived and invalidated by commerce events.

## Resolution rules

1. Safety/recovery guidance defined as free is never removed during billing failure.
2. Additive grants may overlap, but allowances do not double unless the offer explicitly says so.
3. A sponsor grant and personal subscription remain distinct; loss of sponsor eligibility cannot cancel a user-owned subscription or transfer content to the sponsor.
4. Downgrade stops new over-limit assignments at the effective time but does not silently delete people or artifacts. Present a resolution workflow.
5. Cancellation normally preserves paid access through the verified service-period end; refund, dispute, fraud, and provider policy can alter that state through an audited rule.
6. Promotions and manual overrides require reason, actor, start/end, scope, and audit; no permanent hidden flags.
7. The backend verifies source events and current provider state. Device/client state can request refresh but cannot grant access.

## Provider processing

All providers implement a port for purchase handoff, state verification, event normalization, and reconciliation. Webhooks/notifications follow the same pattern:

1. capture the unmodified body and verify provider signature/authenticity;
2. insert an inbox row with unique `(provider, environment, external_event_id)`;
3. return success promptly after durable capture where provider rules permit;
4. process idempotently in a transaction: retrieve current provider state when appropriate, update provider record/subscription, derive grants, append commerce/audit facts, and write outbox events;
5. retry transient failures with a bounded policy; quarantine poison events for review;
6. run daily reconciliation over changed/active subscriptions and report mismatches, lag, orphan IDs, and grant drift.

Outgoing provider creates/updates use idempotency keys tied to a BoomerBuddy operation. Event order is not trusted; compare provider version/time and retrieve authoritative current state. Refunds, disputes/chargebacks, charge failures/recovery, grace/hold, upgrades/downgrades/proration, trial conversion, cancellation, gifting, and sponsorship each have fixtures and state-machine tests.

## Channel policy, current as of 2026-08-15

- **Web:** Stripe Checkout/Billing is the leading integration hypothesis; use provider-hosted payment UI to reduce card-data scope, with Tax evaluated before multi-jurisdiction sales. Final tax treatment requires counsel/accounting.
- **Apple:** current App Review Guideline 3.1.1 generally requires in-app purchase to unlock digital app functionality; consumer/family subscriptions must not assume an enterprise exception. Multiplatform access and US/region link rules are nuanced. Use StoreKit/App Store Server notifications and recheck the exact storefront rules before submission.
- **Google Play:** Play-distributed apps accepting payment for in-app digital services generally must use Play Billing unless a current program/exception applies. Google recommends real-time developer notifications plus a secure backend state query; grace/hold/recovery affect entitlements.
- **Partners:** issue sponsored grants from verified eligibility/allocation imports or signed partner integration. Aggregate sponsor reporting never exposes artifacts or household relationships by default.

Policy is volatile. Do not encode a global “web-only checkout is allowed” assumption or price parity rule; record storefront, policy version, and product configuration. Purchasing from multiple channels may create duplicate subscriptions, so show the user existing access and support a reconciliation case rather than silently charging again.

## Build Run 1 acceptance

Implement plan versions, normalized subscription lifecycle, provider-neutral grants/allowances, local provider records, deterministic entitlement calculation, expiration/downgrade/sponsor overlap fixtures, and server authorization. Seeded screens say `development` or `mock`. Do not install production payment SDKs, accept card data, call Stripe/Apple/Google, fabricate webhook delivery, or present price hypotheses as live offers.

First-dollar launch additionally requires current legal/store review, real sandbox integration, signed notification tests, refund/cancel/customer-portal UX, tax decision, finance reconciliation, duplicate-channel recovery, dunning/communications consent, support runbook, and monitoring.

## Evidence

Accessed 2026-08-15:

- [Apple App Review Guidelines §3.1](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en)
- [Google Play subscription lifecycle](https://developer.android.com/google/play/billing/lifecycle/subscriptions)
- [Stripe webhook security and delivery](https://docs.stripe.com/webhooks)
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)

