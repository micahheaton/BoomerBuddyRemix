# ADR-0008: Provider-Neutral Canonical Entitlements

Status: **Accepted; local lifecycle adapter only in Build Run 1**

Decision date: 2026-08-15

## Context

Direct web billing, Apple, Google, sponsorship, trials, refunds, grace periods, and support adjustments produce different lifecycle states. Payment does not grant relationship permission, and a transient webhook failure cannot be the sole access authority.

## Decision

Model immutable product/plan versions, normalized subscriptions, provider records, entitlement grants, allowance/seat allocations, sponsorship, commerce inbox events, and reconciliation separately. Only canonical effective grants authorize capabilities. Provider payloads and identifiers stay behind adapters and never become domain enums.

Process verified webhook/server notifications through a durable inbox keyed by provider/environment/event ID. Normalize idempotently, preserve raw state only as policy permits, update grants transactionally, and reconcile periodically against provider truth. Define explicit trial, active, grace, hold, canceled, expired, refunded, disputed, restored, overlapping, sponsored, and downgrade behavior. Payment, household ownership, age, or sponsor eligibility never grants artifact visibility or Trusted Circle permission.

Build Run 1 uses seeded/local lifecycle events and no money, tax, refund, app-store, or external provider connection. Urgent safety guidance is never paywalled. Current store policy and cancellation law are rechecked before each launch region.

## Consequences

Provider migration and multi-channel packaging are possible without rewriting authorization. The system must reconcile more state and define conflict precedence. Operational tooling is required before real commerce.

Rejected: checking Stripe/Apple/Google directly on every request, booleans on `user`, receipt-as-permission, store-specific plan IDs in UI policy, and homegrown card handling.

## Evidence

Accessed 2026-08-15: [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [Google subscription lifecycle](https://developer.android.com/google/play/billing/lifecycle/subscriptions), and [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks).
