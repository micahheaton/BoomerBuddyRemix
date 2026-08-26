# Mobile Distribution Release Receipt

Status: **provider-free inputs verifiable; signed distribution blocked**

This receipt defines what the repository can prove without Expo, Apple, Google, Clerk production,
DNS, signing, or device access. It does not authorize a beta, store submission, or production
release.

## Canonical repository inputs

- Application name: `BoomerBuddy`
- iOS bundle identifier: `net.boomerbuddy.app`
- Android application ID: `net.boomerbuddy.app`
- Marketing version: `0.1.0`
- Developer build-version source: EAS remote source with production auto-increment
- Production and preview API origin: `https://api.boomerbuddy.net`
- Custom route-only entry URL: `boomerbuddy://check`
- Universal Links and Android App Links: blocked pending exact signing and two-way website
  association
- Native commerce: no native purchase SDK, checkout action, billing link, pricing link, or payment
  steering

The public store-listing fields are in
[`apps/mobile/store-metadata.json`](../../apps/mobile/store-metadata.json). The file is deliberately
ASCII-only so copying values into provider consoles does not silently substitute punctuation or
control characters.

## Provider-free verification

From the repository root, run:

```powershell
npm run mobile:assets:check
npm run mobile:verify-distribution
npm run typecheck -w @boomerbuddy/mobile
npx eslint apps/mobile tests/security/mobile-*.test.ts
npx vitest run --project security mobile
```

`mobile:verify-distribution` performs no network or provider mutation. It verifies:

- source and resolved Expo identity, transport, permission, and backup settings;
- exact preview and production API configuration;
- remote build-version truth without presenting ignored local defaults as signed-build numbers;
- absence of guessed Expo, Apple, or Google submission identifiers;
- absence of partial Universal Link or App Link entitlements;
- canonical public policy metadata and corresponding repository routes;
- absence of native purchase dependencies and mobile checkout, pricing, or billing routes;
- exact deterministic icon regeneration, dimensions, opacity requirements, and SHA-256 hashes; and
- a SHA-256 fingerprint of the mobile app, its imported workspace packages, dependency lock, and
  distribution scripts.

The fingerprint is reproducible input evidence, not a claim that independently signed IPA or AAB
files will be byte-for-byte identical. Signing services and native toolchains add provider-controlled
state.

## Signed-build receipt

An authorized operator must complete these steps from an approved clean commit:

1. Confirm `git status --short` is empty and record the full commit SHA. Run the provider-free
   verification again after the clean install used for the build.
2. Confirm that BoomerBuddy controls `net.boomerbuddy.app` in Apple Developer, App Store Connect,
   and Google Play. Stop if either store reports a collision or prior owner. Do not change the
   identifier locally until ownership and migration implications are adjudicated.
3. Inspect the highest existing iOS build number and Android version code, if any. Initialize or
   synchronize the EAS remote version only through the authorized Expo project. Record the exact
   values embedded in each signed artifact; local introspection defaults are not that evidence.
4. Configure the production Clerk publishable key in the authorized EAS production environment.
   Never add a Clerk secret key to Expo. Capture the environment name and variable presence, not the
   key value.
5. Build from the exact approved commit with the pinned production profile. Retain the EAS build ID,
   EAS CLI version, builder images, Node and npm versions, dependency-lock hash, input fingerprint,
   iOS build number, Android version code, signing identity fingerprints, and resulting IPA/AAB
   SHA-256 hashes.
6. Inspect the signed manifests and entitlements. Verify the application IDs, production API URL,
   active permissions, Android backup denial, iOS transport policy, Clerk callback schemes, and the
   absence of unapproved associated-domain or HTTPS intent filters.
7. Install the exact signed artifacts on representative physical devices and complete the device
   matrix in [MOBILE-AND-STORE-READINESS.md](./MOBILE-AND-STORE-READINESS.md).

Every rebuilt artifact needs a new receipt. A successful Expo export or simulator run cannot replace
the signed-build receipt.

## Public policy reachability

The repository verifies that these canonical public routes exist in the customer web source:

- `https://app.boomerbuddy.net/support`
- `https://app.boomerbuddy.net/privacy`
- `https://app.boomerbuddy.net/terms`
- `https://app.boomerbuddy.net/account-deletion`

Before submission, verify each exact HTTPS URL from an unauthenticated external network and retain a
dated response and rendered-page receipt. Confirm that no login, preview deployment, redirect to the
legacy project, certificate warning, or indexing interstitial blocks access. Also prove that
`support@boomerbuddy.net` is company-controlled and has a staffed, tested operating path. Source
presence alone does not prove live reachability or response coverage.

## Universal Link and App Link closure

The native config intentionally contains neither `ios.associatedDomains` nor Android HTTPS
`intentFilters`. Adding only one side would create a misleading partial association.

To close this gate, first obtain the exact Apple Team ID and Android production signing certificate
SHA-256 from company-controlled provider accounts. Then publish and verify the Apple App Site
Association and Digital Asset Links files on the approved customer domain for an explicitly approved
route-only path. Only after the website files are live should the native entitlements, Android
filters, and runtime classifier be added together. Prove install fallback, cold/warm routing, no
query or fragment ingestion, certificate rotation, and behavior when association verification
fails. The custom `boomerbuddy://check` scheme remains device-unverified and is not a substitute for
that two-way proof.

## Remaining external gates

- company custody of the Expo organization/project and an exact, non-fabricated EAS project ID;
- Apple Developer and App Store Connect custody, identifier collision check, Team ID, certificates,
  provisioning, agreements, tax/banking state, and an App Store record;
- Google Play custody, package collision check, Play App Signing/keystore evidence, certificate
  SHA-256, agreements, and an application record;
- production Clerk native application configuration, hosted-auth callback proof, Apple sign-in
  readiness for iOS review, and exact disposable-token audience/authorized-party evidence;
- revoke and rotate the Google OAuth client secret that surfaced in local browser-inspection output,
  configure the replacement only in the authorized provider boundary, and prove that no client
  bundle, repository file, retained log, or build receipt contains a client secret;
- live API, policy URL, account-deletion, support mailbox, privacy-operation, and incident-response
  evidence;
- signed IPA/AAB builds, physical-device authentication/session/deep-link/offline/accessibility
  evidence, and representative iPhone, iPad, and Android coverage;
- approved store descriptions, age/content/privacy declarations, reviewer instructions, screenshots,
  Android feature graphic, localization, and professional legal/privacy/accessibility review; and
- current Apple and Google commerce-policy review while native purchase and payment steering remain
  absent.

Repository verdict: **GO for a clean provider-free build-input candidate; NO-GO for signed beta,
store submission, or production distribution until every applicable external gate has a retained
receipt.**
