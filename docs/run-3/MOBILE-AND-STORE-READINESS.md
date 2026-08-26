# Mobile and Store Readiness

Status: **Production-configured Expo/Clerk client; native device and store evidence blocked**

## Implemented production boundary

- Expo config uses scheme `boomerbuddy` and iOS/Android identifier `net.boomerbuddy.app`.
- Resolved native configuration denies arbitrary iOS network loads, removes the unused Face ID usage
  description, disables Android application backup, and blocks Android storage, overlay, and
  vibration permissions. The separate API origin boundary permits only
  `https://api.boomerbuddy.net` in production. The security suite
  resolves Expo's native manifests so these controls cannot regress behind a source-only `app.json`
  check.
- EAS configuration requires a clean commit and pins EAS CLI `22.4.0`, Node `22.23.2`, and the
  reviewed Expo SDK 57 Android and iOS builder images for preview and production profiles. EAS CLI
  does not permit an `npm` profile key, so npm is selected by the npm lockfile and reviewed builder
  image and must be recorded from the signed build job instead of claimed from `eas.json`.
- The exact pinned CLI accepted the corrected `eas.json` schema for the Android preview profile and
  then stopped at the expected Expo account login gate. Expo Doctor passed all 21 checks with its
  required read-only network access. Neither result is a signed-build or device receipt.
- The locked production-mobile dependency graph now reports 0 Critical, 0 High, and 23 Moderate
  findings. The narrow Metro 0.84.5 overrides removed the prior `image-size` High path, the release
  verifier has an empty High allowlist, and API, worker, web, and HQ production graphs each report
  zero findings. The Moderate Clerk/Expo tooling paths remain tracked and may not be relabeled as
  fixed. See [MOBILE-DEPENDENCY-AUDIT.md](./MOBILE-DEPENDENCY-AUDIT.md). Re-run the exact audit,
  Doctor, export, and native-build evidence after any lock change and before distribution.
- Production builds accept only `EXPO_PUBLIC_API_URL=https://api.boomerbuddy.net`; both EAS preview
  and production profiles pin that public value. The Clerk secret key and all other server
  credentials remain absent from the client.
- Customer sign-in uses Clerk hosted auth and secure Expo token caching. API calls use the exact
  `boomerbuddy-mobile` custom JWT template with `aud=boomerbuddy-mobile`, `bb_surface=mobile`, and a
  maximum issued-to-expiry lifetime of 60 seconds.
- The API accepts production mobile authentication only as a Bearer token with no request `Origin`
  and no `Cookie`. It verifies with the customer issuer and key, never the HQ realm.
- Clerk documents that custom JWTs include `azp` when an Origin is present, while session-token
  documentation permits omission when Origin is empty or null. The verifier therefore accepts a
  missing `azp` or one exact origin in the production `BB_CLERK_MOBILE_AUTHORIZED_PARTIES` list. The
  literal `none` configures an empty list. Wildcards, HTTP origins, customer/HQ browser origins, and
  unlisted values fail closed. See [Clerk JWT templates](https://clerk.com/docs/guides/sessions/jwt-templates)
  and [Clerk session tokens](https://clerk.com/docs/guides/sessions/session-tokens).
- A first API 401 causes one `getToken({ template: 'boomerbuddy-mobile', skipCache: true })` refresh
  and one replay. A second 401 clears local device state and signs out. Concurrent forced refreshes
  and sign-out recovery are coalesced.
- The route observer recognizes only the empty `boomerbuddy://check` signal. Query strings and
  fragments are rejected instead of becoming artifact input.
- No inbound share extension, contacts import, push transport, background monitoring, camera,
  microphone, photo-library workflow, or automatic artifact intake is configured.
- Native share-sheet proof and local invitation creation/share controls remain guarded by `__DEV__`
  and are absent from production navigation. In development they require an explicit user gesture;
  BoomerBuddy does not choose a destination, read or upload contacts, or send automatically. This
  gate is separate from authenticated in-app sharing of a redacted Check with an already authorized
  Trusted Circle relationship.
- Signed-in members can list, create, and withdraw private support receipts for the selected
  household. Receipt creation accepts only one fixed category and one fixed impact. There is no
  message, attachment, contact-detail, or URL field, and response parsing requires the contract's
  explicit `contentIncluded=false`, `outboundMessage=not_sent`, and `providerAction=none` boundary.
  Idempotency keys are retained for uncertain in-session create and withdrawal retries. The blank
  `mailto:` draft is a separate user action and never runs as a receipt side effect.
- Support copy does not claim that a person monitors receipts or promise a response window. Live
  mailbox custody, staffing, routing, escalation, and response evidence remain external gates.
- The isolated Feedback component remains source-only and unwired; production navigation and artifacts omit it.
- Web export, TypeScript, and bundle inspection are build evidence, not device evidence.
- The production verifier is a static artifact/payload and Expo-bundle check; it is not hydrated production-browser or native-device evidence.

## Web-first commerce boundary

- Family at USD 14.99 per month is the sole approved production offer candidate and is not live. Annual Family, Individual, referral,
  coupon, trial, group-rate, and native-purchase offers remain non-public synthetic hypotheses.
- The native app reads canonical household access only. A billing manager can refresh access after a
  start, renewal, cancellation, or restoration has been confirmed. Refreshing never starts or changes
  a purchase, and a provider status alone never grants access.
- The app contains no Checkout, store purchase, web billing link, price steering, or provider account
  management action. Customer 1 completes payment and billing management through the authenticated
  customer web path. The native app then observes the reconciled entitlement.
- Rechecked on 2026-08-25: external purchase links remain default-deny until an exact, current
  storefront, jurisdiction,
  program, application-version, and policy decision authorizes one. Apple currently treats the US
  storefront differently from most other storefronts, while Google requires applicable program
  enrollment and API integration for external offers. See [Apple App Review Guidelines 3.1](https://developer.apple.com/app-store/review/guidelines/),
  [Google's US policy update](https://support.google.com/googleplay/android-developer/answer/15582165),
  and [Google external offers integration](https://developer.android.com/google/play/billing/external/integration).
- A future native purchase or external-link proposal requires a separate implementation, current
  policy review, provider enrollment, server verification, restore/cancel/refund reconciliation,
  signed-device matrix, accessibility proof, and rollback receipt.

## Permission policy

Contacts, camera, microphone, photo library, notifications, and tracking permissions are denied by
default because no reviewed feature currently needs them. Adding any permission requires a versioned
purpose, least-privilege platform configuration, denial behavior, retention/deletion path, and a
device regression. Android storage, overlay, and vibration permissions are explicitly blocked, and
iOS App Transport Security explicitly denies arbitrary loads. Customer address books may never be
uploaded to create a marketing database.

## Required device proof

Before a native beta, record on representative iOS and Android devices:

- signed build identity and company custody;
- iOS 17 or later coverage because the pinned Clerk native SDK raises the deployment target to iOS
  17, including an explicit product decision about older devices in the intended audience;
- iPhone and iPad coverage while `ios.supportsTablet` remains enabled, including required iPad
  layouts, accessibility behavior, screenshots, and store metadata;
- hosted Google and email/MFA sign-in, callback return, secure restart restoration, and sign-out;
- decode only a disposable test token locally and record whether `azp` is absent or the exact origin
  value, without recording the token or customer PII. Keep `BB_CLERK_MOBILE_AUTHORIZED_PARTIES=none`
  when absent. If present, add only that exact HTTPS origin after confirming it is neither the
  customer nor HQ browser origin, redeploy, and prove an arbitrary `azp` remains rejected;
- prove one stale cached token succeeds after the forced refresh, while two consecutive 401s sign
  out and clear local household selection;
- cold/warm deep-link routing and rejection of query/fragment payloads;
- development-only share-sheet cancellation and destination-independent behavior before any later
  proposal to expose those controls in production;
- screen reader, text scaling, contrast, focus, reduced motion, and keyboard/switch behavior;
- permission prompts and denial/revocation recovery;
- offline/restart/session-expiry behavior;
- secure storage, sign-out, recovery, and notification privacy;
- monitor expired mobile JTI session backlog and cleanup counts. Cleanup may remove only expired,
  unrevoked mobile session rows older than the configured retention floor and unreferenced by any
  evidence table; referenced sessions and revocation evidence are retained;
- store-commerce/canonical-entitlement reconciliation if later introduced.

Apple/Google/Expo account timing does not block the web-first candidate. It does block any claim of a
native beta, store readiness, submission readiness, or native accessibility completion. No store
submission is authorized by this document.

## Brand and provider closure gates

- Repository-owned icon, splash, Android adaptive icon, and web favicon PNGs are deterministic
  renders of the existing BoomerBuddy shield/check mark and shared palette. The manifest references
  them, the iOS/store icon is opaque RGB with no alpha channel, Expo Doctor passes, Expo export
  packages the favicon, and a byte-for-byte regeneration check passes. Signed iOS/Android inspection
  and store screenshots still require real builds and devices.
- `npm run mobile:verify-distribution` validates the resolved manifests, exact API and identity,
  ASCII-only canonical store metadata, legal-route source presence, version-source truth, absent
  purchase steering, deterministic asset bytes/dimensions/opacity, and a build-input SHA-256 without
  contacting a provider. See
  [MOBILE-DISTRIBUTION-RELEASE-RECEIPT.md](./MOBILE-DISTRIBUTION-RELEASE-RECEIPT.md).
- Universal Links and Android App Links remain explicitly unconfigured until the company-controlled
  Apple Team ID, Android production signing SHA-256, and live two-way website association files are
  available. The verifier rejects a partial local association.
- `app.json` intentionally has no fabricated EAS project ID. `eas.json` intentionally has no Apple
  App Store Connect application ID, Apple team ID, or Google Play service-account reference.
- An authorized operator must link the Expo project, confirm the bundle/package collision check for
  `net.boomerbuddy.app`, and configure Apple/Google submission identities in the provider accounts.
- Clerk's native plugin adds the Sign in with Apple entitlement. The production customer Clerk app
  must enable and prove the Apple provider before iOS review while Google sign-in remains available,
  or a documented App Review exception must be established. Do not remove the entitlement or guess
  callback values before the signed build exposes the exact native return path.
- Invite creation and native share actions remain development-gated. Device proof does not authorize
  enabling either action in a production build; that requires a separate reviewed product change.
