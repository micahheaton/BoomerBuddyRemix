# Mobile and Store Readiness

Status: **Expo local/web scaffold; native device and store evidence blocked**

## Implemented local boundary

- Expo config uses the local-only identifiers `boomerbuddy-2-local`, `net.boomerbuddy.local`, and
  `boomerbuddy-local`.
- The route observer recognizes only the empty `boomerbuddy-local://check` signal. Query strings and
  fragments are rejected instead of becoming artifact input.
- No inbound share extension, contacts import, push transport, background monitoring, camera,
  microphone, photo-library workflow, or automatic artifact intake is configured.
- Native share actions require an explicit user gesture. One action shares fixed safety guidance;
  in local development only, the Family flow can separately compose the just-created local
  invitation ID, one-time code, and expiry for the device-owned share sheet. BoomerBuddy does not
  choose a destination, read or upload contacts, send automatically, or include submitted content,
  Check results, person IDs, or household IDs. The invitation creation/share actions and native
  proof screen are guarded by `__DEV__`; the post-build verifier rejects their action strings from
  the production Expo bundle.
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
- cold/warm deep-link routing and rejection of query/fragment payloads;
- share-sheet cancellation and destination-independent behavior;
- screen reader, text scaling, contrast, focus, reduced motion, and keyboard/switch behavior;
- permission prompts and denial/revocation recovery;
- offline/restart/session-expiry behavior;
- secure storage, sign-out, recovery, and notification privacy;
- store-commerce/canonical-entitlement reconciliation if later introduced.

Apple/Google/Expo account timing does not block the web-first candidate. It does block any claim of a
native beta, store readiness, submission readiness, or native accessibility completion. No store
submission is authorized by this document.
