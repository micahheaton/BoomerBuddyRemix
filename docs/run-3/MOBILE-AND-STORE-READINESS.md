# Mobile and Store Readiness

Status: **Production-configured Expo/Clerk client; native device and store evidence blocked**

## Implemented production boundary

- Expo config uses scheme `boomerbuddy` and iOS/Android identifier `net.boomerbuddy.app`.
- Production builds accept only `EXPO_PUBLIC_API_URL=https://api.boomerbuddy.net`; the EAS production
  profile pins that public value. The Clerk secret key and all other server credentials remain absent
  from the client.
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
- The isolated Feedback component remains source-only and unwired; production navigation and artifacts omit it.
- Web export, TypeScript, and bundle inspection are build evidence, not device evidence.
- The production verifier is a static artifact/payload and Expo-bundle check; it is not hydrated production-browser or native-device evidence.

## Permission policy

Contacts, camera, microphone, photo library, notifications, and tracking permissions are denied by
default because no reviewed feature currently needs them. Adding any permission requires a versioned
purpose, least-privilege platform configuration, denial behavior, retention/deletion path, and a
device regression. Customer address books may never be uploaded to create a marketing database.

## Required device proof

Before a native beta, record on representative iOS and Android devices:

- signed build identity and company custody;
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
  them, Expo Doctor passes, Expo export packages the favicon, and a byte-for-byte regeneration check
  passes. Signed iOS/Android inspection and store screenshots still require real builds and devices.
- `app.json` intentionally has no fabricated EAS project ID. `eas.json` intentionally has no Apple
  App Store Connect application ID, Apple team ID, or Google Play service-account reference.
- An authorized operator must link the Expo project, confirm the bundle/package collision check for
  `net.boomerbuddy.app`, and configure Apple/Google submission identities in the provider accounts.
- Invite creation and native share actions remain development-gated. Device proof does not authorize
  enabling either action in a production build; that requires a separate reviewed product change.
