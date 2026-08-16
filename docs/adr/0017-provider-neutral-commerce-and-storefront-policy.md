# ADR-0017: Provider-Neutral Commerce and Storefront Policy

Status: **Accepted Run 2 design; deterministic adapter proof required; authentic Stripe and mobile-store transactions blocked by accounts**

Decision date: 2026-08-16

## Context

Run 1 established canonical entitlements and local commerce events, but commercialization needs an authentic provider path without making Stripe, Apple, or Google the access-control system. Webhooks and store notifications are asynchronous, duplicated, delayed, and potentially out of order. Mobile purchase and external-link rules also vary by storefront, program, jurisdiction, and policy version.

## Supersession

This ADR supersedes the external-adapter and generic store-policy portions of [ADR-0008](./0008-provider-neutral-entitlements.md)'s Decision, while preserving its canonical product, subscription, grant, allowance, sponsorship, inbox, and reconciliation model. It supersedes only the future store-billing boundary in [ADR-0009](./0009-expo-mobile-with-native-extension-boundaries.md); Expo/native testing decisions remain unchanged.

## Decision

Keep payment initiation, payer identity, billing authority, provider customer/subscription state, canonical subscription, entitlement grant, and relationship permission separate. Only a current canonical grant authorizes paid capabilities. A client redirect, Checkout success page, receipt, local cache, provider dashboard state, household ownership, or payment fact never grants Family/artifact access.

The web adapter creates Stripe test Checkout, Billing, and Customer Portal sessions only for an authenticated payer or scoped billing manager. BoomerBuddy never handles card data. The webhook route preserves the exact raw body, verifies `Stripe-Signature` with the environment-specific endpoint secret and recency tolerance, rejects cross-environment input, and writes an idempotent inbox row before acknowledging. Normalization is API-version aware and tolerates duplicate and out-of-order delivery; reconciliation retrieves provider truth and repairs canonical state under audit.

Adapters normalize trial, active, grace, past-due/hold, canceled-at-period-end, canceled, expired, restored, refund, dispute, dunning, and overlapping-source behavior without leaking provider enums into domain policy. Fixture-generated signed events must exercise the same parser and normalizer as authentic test events.

Apple and Google adapters use server-side transaction/purchase verification, signed server notifications, idempotent provider identifiers, acknowledgement where required, and reconciliation into the same canonical layer. A versioned storefront-policy table determines which offers, purchase methods, account-management paths, and external links may appear for a platform, storefront, jurisdiction, program enrollment, app version, and checked policy version. Unknown or stale policy defaults to no external purchase link. Run 2 submits no app and moves no live money.

## Consequences

Commerce can evolve across web, stores, sponsorship, and support without rewriting authorization. The cost is lifecycle mapping, reconciliation, policy operations, and separate sandbox qualification. Storefront presentation can differ lawfully without claiming a permanent global rule.

## Rejected alternatives

- Stripe/Apple/Google status checks directly in authorization.
- Client success redirects or receipts as entitlement proof.
- Provider product IDs embedded as domain plans or UI policy.
- Web Checkout links in every native storefront by default.
- Homegrown card capture or an unverified webhook endpoint.

## Verification

Local tests cover raw-body signature pass/fail, timestamp/replay, wrong secret/environment, duplicate/out-of-order/versioned events, inbox atomicity, lifecycle normalization, overlaps, cancellation, grace, refund/dispute, reconciliation, allowance changes, and fail-closed access. Mobile fixtures cover duplicate notifications, transaction identity, revocation, acknowledgement, and policy default-deny. An external evidence record must distinguish deterministic fixture proof from a provider-executed transaction.

## Evidence boundary

The provider-neutral domain and signed-fixture adapters are not account-blocked. An authentic Stripe journey is **BLOCKED BY ACCOUNT** until test credentials, product/price IDs, an endpoint secret, and a reachable staging callback exist. Apple/Google sandbox proof also requires developer accounts, agreements, products, signing/toolchains, and supported devices. No fixture may be reported as a real transaction.

## Primary sources

Current guidance was rechecked 2026-08-16 in Stripe's [testing environments](https://docs.stripe.com/testing-use-cases), [webhook](https://docs.stripe.com/webhooks), and [subscription webhook](https://docs.stripe.com/billing/subscriptions/webhooks) documentation; Apple's [App Review Guidelines 3.1](https://developer.apple.com/app-store/review/guidelines/); and Google Play's [Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738), [billing integration](https://developer.android.com/google/play/billing/integrate), and [current US policy update](https://support.google.com/googleplay/android-developer/answer/15582165). These living rules justify versioning and default-deny; they are not legal advice.
