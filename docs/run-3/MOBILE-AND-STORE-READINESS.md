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
- The resolved iOS URL schemes include both `boomerbuddy` and `net.boomerbuddy.app`, which covers
  the Clerk hosted-auth default return `net.boomerbuddy.app://callback`. The resolved Android main
  activity includes Clerk's exact `clerk://net.boomerbuddy.app.hosted-callback` intent filter. This
  proves repository configuration, not a live Clerk realm, signed build, browser-return, or device
  sign-in.
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
- `apps/mobile/store-metadata.json` is the ASCII-only `en-US` source packet for truthful listing
  copy, age/content/privacy answers, a repository-observed data map, permission posture, reviewer
  steps, release-note handling, and signed-device screenshot specifications. Every
  provider-dependent field is labeled draft or pending. It contains no provider identifier,
  reviewer credential, customer PII, secret, native purchase, checkout, billing link, price, or
  payment steering.
- Category choices are provider-specific drafts, not a shared mapping. Apple uses `Utilities` as the
  proposed primary category and `Lifestyle` as the proposed secondary category. Google Play uses
  the single proposed `Tools` application category. Recheck the current provider documentation and
  console before approval or submission. See [Apple App Store categories](https://developer.apple.com/app-store/categories/)
  and [Google Play categories and tags](https://support.google.com/googleplay/android-developer/answer/9859673?hl=en).
- Apple listing checks require an app name of at least 2 characters and keywords longer than 2
  characters within Apple's 100-byte keyword limit. For the initial Apple version, the packet omits
  the What's New field because it is not available for the first version. Google Play release notes
  are maintained separately and capped at 500 characters. Recheck these dated draft rules before
  every release. See [Apple platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)
  and [Google Play prepare and roll out a release](https://support.google.com/googleplay/android-developer/answer/9859348?hl=en).
- Every current `apps/mobile/package.json` runtime dependency has an exact approved privacy
  classification. Distribution verification fails if a dependency is added, removed, renamed, or
  reclassified without updating that reviewed allowlist. This repository gate does not replace
  current SDK disclosures, generated privacy manifests, or inspection of the exact signed IPA and
  AAB.
- Store review access is provider-specific. The same founder-controlled synthetic customer review
  account must be reusable, non-expiring, valid for reviewers regardless of location, and delivered
  only through the secure review fields in App Store Connect and Google Play Console. One-time-only
  credentials and repository authentication bypasses are forbidden. Before delivery, preflight the
  exact signed candidate against the protected-adult role, active household, required capabilities,
  effective canonical access, protected-member and Trusted Circle allowances, and all listed flows.
  Retain only content-free evidence, never credentials, tokens, customer PII, or Check content. See
  [Apple platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)
  and [Google Play app access requirements](https://support.google.com/googleplay/android-developer/answer/15748846?hl=en).
- Current provider questionnaires, SDK disclosures, signed manifests, live operations, screenshots,
  reviewer-account preflight, and professional review must still be reconciled before any store
  answer or listing is approved.
- Signed-in members can submit text-only household feedback from production navigation. The mobile
  client validates the exact request and response contracts, binds each request and receipt to the
  selected household, retains the same idempotency key only for an unchanged uncertain retry, and
  aborts and clears private state on a household switch. It accepts no attachment, contact detail,
  destination, or external processing action. Optional in-app follow-up and short research-retention
  consent can be withdrawn independently from the receipt; a server-confirmed active-store erasure
  updates text-retention state without changing another still-granted consent. Signed-device
  behavior and staffed review remain external gates.
- Web export, TypeScript, and bundle inspection are build evidence, not device evidence.
- The production verifier is a static artifact/payload and Expo-bundle check; it is not hydrated production-browser or native-device evidence.

## Web-first commerce boundary

- The deployed customer web surface presents Family annual at USD 149.90 after a seven-day trial as
  the default and Family monthly at USD 14.99 without a trial. Stripe initiation and purchasing
  remain disabled, so neither visible offer is purchasable. Individual, referral, coupon, group-rate,
  and native-purchase offers remain unavailable.
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

Contacts, camera, microphone, photo library, and tracking permissions are denied by default because
no reviewed feature currently needs them. Notifications are the one narrow exception: after a member
explicitly opts into a generic weekly practice reminder, iOS may request notification permission and
the Android notifications library contributes `POST_NOTIFICATIONS` and `RECEIVE_BOOT_COMPLETED` at
native manifest merge. The repository-owned Android manifest directly requests only Internet access;
the distribution packet separately declares the two SDK-contributed permissions. Remote push-token
registration, background remote notifications, sounds, badges, exact alarms, message content,
household identifiers, and automatic family delivery remain disabled. Signed IPA/AAB inspection and
permission grant, denial, restart, reboot, lock-screen, and revocation behavior remain device gates.

Adding any other permission requires a versioned purpose, least-privilege platform configuration,
denial behavior, retention/deletion path, and a device regression. Android storage, overlay, and
vibration permissions are explicitly blocked, and iOS App Transport Security explicitly denies
arbitrary loads. Customer address books may never be uploaded to create a marketing database.

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
- reviewer access on the exact signed candidate using only the preflighted non-expiring synthetic
  review account, including the protected-adult household, capabilities, canonical access,
  allowances, and every documented reviewer flow.

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
  ASCII-only canonical store metadata, bounded source-locale copy, split Apple and Google category
  drafts, provider-split release notes, pending content/privacy declarations, the exact runtime
  dependency privacy allowlist, the repository-observed data map, provider-specific non-expiring
  synthetic reviewer-account requirements and preflight, pending screenshot/device matrix,
  legal-route source presence, version-source truth, absent purchase steering, deterministic asset
  bytes/dimensions/opacity, and a build-input SHA-256 without contacting a provider. See
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
