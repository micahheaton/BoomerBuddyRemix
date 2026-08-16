# Mobile Commerce

Status: **provider-neutral server contracts and default-deny policy are implemented; purchase UI, real verification, and device/store proof are not**.

## Implemented foundation

Apple App Store Server Notification and Google Real-time Developer Notification contracts normalize verified provider events into the same canonical subscription lifecycle used by web and sponsor sources. The adapters refuse an unverified payload, preserve provider identifiers and environment, identify Google acknowledgement requirements, and request reconciliation when notification evidence is incomplete.

A versioned storefront-policy evaluator keys decisions by platform, storefront, jurisdiction, program, application version, and policy version. Unknown, stale, or ambiguous policy disables external purchase/account-management links and requires the native path. This prevents a historical policy assumption from becoming permanent UI behavior.

`packages/integrations/src/integrations.test.ts` uses deterministic verifier fixtures to cover Apple/Google normalization, rejection, and the distinction between fixture HMACs and real store verification. It also tests default-deny storefront decisions. These are **contract tests**, not sandbox purchases.

## Scaffolded mobile surface

The Expo app has preview EAS profiles and a SecureStore plugin declaration. Its metadata truthfully marks deep linking as scaffolded and native sharing/device behavior as unverified. There is no StoreKit/Google Play Billing purchase UI, receipt restore flow, acknowledgement worker, subscription-management UI, or application-submission configuration.

## External and professional blockers

- **Blocked by account/contract:** LLC-owned Apple Developer and Google Play accounts, agreements, products, tax/banking profiles, signing keys, sandbox users, and server credentials.
- **Blocked by device/toolchain:** signed iOS/Android builds, supported-device purchases, restore, renewal, cancellation, refund, grace, family/mobile-account, accessibility, and notification tests.
- **Policy/professional:** current jurisdiction/program eligibility, fees, external-link language, reporting, consumer terms, and tax treatment must be reviewed immediately before release.

Run 2 submitted no app and took no payment. See [ADR-0017](../adr/0017-provider-neutral-commerce-and-storefront-policy.md) and [ADR-0009](../adr/0009-expo-mobile-with-native-extension-boundaries.md).
