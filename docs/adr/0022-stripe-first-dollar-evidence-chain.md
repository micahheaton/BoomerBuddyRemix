# ADR-0022: Stripe First-Dollar Evidence Chain

Status: **Accepted local design; authentic provider and production evidence blocked**

Decision date: 2026-08-16

## Context

ADR-0017 established provider-neutral canonical commerce, but its initial-activation wording allowed a
server binding or trial/status snapshot to be read too generously. First-dollar readiness needs a
single immutable offer, separate initiation and ingestion controls, environment custody, durable
transport ambiguity, and exact payment truth.

## Decision

This ADR supersedes ADR-0017 only for Stripe initial activation and paid-period proof.

- The only first-dollar offer is `founding_family_monthly_v1`: `family_v1`, USD 14.99 (1,499
  cents), monthly,
  quantity one, card-only. Promotions, automatic tax, adaptive pricing, trials, and recovery are off.
- Test and live configuration names/resources are disjoint. Live values are an offline manifest;
  raw live secrets and API/worker startup in live mode are refused until managed identity/KMS custody
  exists. Live initiation remains false and unreachable.
- Checkout initiation requires an audited founder control and environment-scoped Founding Household
  eligibility under a transactional, capacity-bounded, expiring cohort policy. Test eligibility
  cannot authorize production, and live cohort approval is a separate append-only founder action.
  Authenticated webhook ingestion and durable reconciliation do not depend on that initiation switch.
- Provider idempotency is derived from environment, action, household, and server operation ID.
  Dispatch attempts are append-only; ambiguous transport becomes durable `outcome_unknown`, and
  a persisted `dispatch_started` receipt remains ambiguous if the process dies before it can record
  the POST result. Lease recovery retries only with the same key, the worker uses the same reviewed
  customer-origin allowlist as the API, and no later pre-transport refusal can erase an earlier
  dispatch receipt. The requested 23-hour provider deadline is canonicalized to a whole provider
  second before it is stored; the same exact second is sent and must be returned. An exact
  authenticated completion/expiry can repair a response lost after POST without a blind duplicate.
  Elapsed time cannot prove no effect or authorize a replacement. Only a first attempt with no prior
  dispatch evidence can terminalize from a proven pre-transport refusal. Automatic attempts have one
  operation-level budget; a founder can authorize only one audited, revision-checked seventh same-key
  attempt before the original deadline. That repair never clears unknown state.
- A subscription can bind only through the exact recorded Checkout completion (or an already verified
  immutable provider record). Completion and browser success do not grant access.
- Initial and later paid access require an authenticated `invoice.paid`, a complete exact one-item
  current Subscription page, and exact Invoice Payment ID, PaymentIntent, amount, currency, quantity,
  discount, tax, credit, billing reason, invoice-line/subscription-item/product/price, paid timestamp,
  and contiguous service-period facts. The Invoice Payment ID and immutable fact row are retained
  separately from the canonical grant; a noncontiguous paid observation is quarantined before any
  payment-authority or dunning-recovery mutation. Status alone never creates or extends access.
- Failed invoices require the same current item/product lineage, non-proration, and exact period.
  Dunning is append-only: grace starts at canonical paid-through, never truncates already-paid access,
  does not move on repeated failure, and recovery closes the same audited window.
- Refund and dispute restrictions are append-only and keyed by exact restriction, charge,
  PaymentIntent, invoice, and subscription lineage. Only the matching object can close; all unresolved
  objects are aggregated with dispute precedence. A resolution does not silently reactivate access.
- Current Clover Portal preflight requires cancel exactly at period end, no proration, subscription
  update disabled with `default_allowed_updates=[]`, and the exposed customer/payment-method
  mutations disabled. The API does not expose a `subscription_pause` field; pause and
  retention-coupon absence remain founder-browser evidence gates.
- The durable daily/manual subscription inventory follows every 100-row cursor page and records
  account/environment/API/run/page receipts. Only `has_more=false` can complete; partial/error state is
  attention, never a clean reconciliation.

## Consequences

The first-dollar path is intentionally narrower than the product catalog and requires more provider
reads before access. A due session operation may retry only with the same key after current gates,
preflight, and return-origin validation; the operation remains blocked if its outcome is still
unknown. It is safe to keep ingesting events while initiation is stopped. Browser redirects remain
informational.

## Evidence and rollback

Deterministic fixtures prove only `local_fixture` behavior. `stripe_test`, `deployed_staging`,
real-human, `live_production`, and revenue evidence must be recorded separately. Transport/livemode,
runtime run, and signature authenticity are separate facts; repeated preflight observations append.
Rollback disables initiation first, preserves ingestion and the worker, reconciles every ambiguous
operation, and never deletes financial or audit evidence.

Operational details and exact environment names are in
[Stripe First-Dollar Runbook](../run-3/STRIPE-FIRST-DOLLAR-RUNBOOK.md).

## Primary sources

- Stripe [API versioning](https://docs.stripe.com/api/versioning)
- Stripe [Event object](https://docs.stripe.com/api/events/object)
- Stripe [Checkout Session create](https://docs.stripe.com/api/checkout/sessions/create)
- Stripe [Invoice object](https://docs.stripe.com/api/invoices/object)
- Stripe [API keys](https://docs.stripe.com/keys)
