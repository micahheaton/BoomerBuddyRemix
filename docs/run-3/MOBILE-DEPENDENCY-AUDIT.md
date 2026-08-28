# Mobile Production Dependency Audit Disposition

Audit date: 2026-08-25

## Scope and result

The initial `npm audit --omit=dev --json` run reported 26 vulnerable production dependency nodes:
0 critical, 4 high, 22 moderate, 0 low, and 0 informational. The four High nodes were
`image-size`, `metro`, `metro-config`, and `metro-transform-worker` through React Native's nested
Metro 0.84.4 toolchain.

The repository now pins `metro`, `metro-config`, and `metro-transform-worker` to 0.84.5 with a
narrow root override. `npm update metro metro-config metro-transform-worker
--include-workspace-root` removed the nested 0.84.4 graph. The exact production-only audit now
reports 0 critical, 0 high, 23 moderate, 0 low, and 0 informational. A broad `npm audit fix` was not
run.

The 23 moderate nodes are `@clerk/clerk-js`, `@clerk/expo`, `@expo/cli`, `@expo/config`,
`@expo/config-plugins`, `@expo/inline-modules`, `@expo/local-build-cache-provider`,
`@expo/metro-config`, `@expo/prebuild-config`,
`@solana-mobile/mobile-wallet-adapter-protocol-web3js`,
`@solana-mobile/wallet-adapter-mobile`, `@solana/wallet-adapter-base`,
`@solana/wallet-adapter-react`, `@solana/wallet-standard`,
`@solana/wallet-standard-wallet-adapter`, `@solana/wallet-standard-wallet-adapter-base`,
`@solana/wallet-standard-wallet-adapter-react`, `@solana/web3.js`, `expo`,
`expo-splash-screen`, `jayson`, `uuid`, and `xcode`.

## Closed High-severity Metro path

The original installed vulnerable path was:

`@boomerbuddy/mobile@0.1.0 -> react-native@0.86.2 ->
@react-native/community-cli-plugin@0.86.2 -> metro-config@0.84.4 -> metro@0.84.4 ->
image-size@1.2.1`

`metro@0.84.4` also reaches `metro-transform-worker@0.84.4`. The two `image-size` advisories are
[GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) and
[GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq). Both describe an infinite
loop when parsing crafted image formats. The latest published `image-size`, 2.0.2, remains within
the reported vulnerable range, so directly forcing that package is not a fix.

The affected parser is reached through Metro build tooling. BoomerBuddy does not feed customer
uploads into Metro, which reduced runtime exposure but did not close the supply-chain finding.
`@react-native/community-cli-plugin@0.86.2` accepts the patched Metro range, and the installed Expo
graph already used Metro 0.84.5 through `@expo/metro@56.0.2`.

After the narrow update, `npm ls metro metro-config metro-transform-worker image-size --all`
reports only Metro 0.84.5 and no vulnerable `image-size` node. `npm audit --omit=dev --json` reports
zero High nodes. Expo Doctor passed 21 of 21 checks, mobile TypeScript passed, Expo web export
completed with the patched Metro graph, and the focused mobile and retention suite passed 26 of 26
tests. Signed iOS and Android native builds and physical-device proof remain separate distribution
gates; this dependency remediation does not claim them.

## Moderate UUID paths

The two exact installed vulnerable paths are:

- `@boomerbuddy/mobile@0.1.0 -> @clerk/expo@4.5.4 -> @clerk/clerk-js@6.30.1 ->
  @solana/wallet-adapter-base@0.9.27 -> @solana/web3.js@1.98.4 -> jayson@4.3.0 -> uuid@8.3.2`
- `@boomerbuddy/mobile@0.1.0 -> expo@57.0.16 -> @expo/config-plugins@57.0.9 -> xcode@3.0.1 ->
  uuid@7.0.3`

The applicable advisory is
[GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), a missing bounds check in
UUID v3, v5, and v6 when a caller supplies a buffer. BoomerBuddy does not invoke Solana wallet
features or these UUID buffer APIs. The affected packages remain installed transitively, so this is
risk context rather than closure.

The npm audit result marks the top-level `@clerk/expo`, `expo`, `jayson`, `uuid`, and `xcode` paths as
having no automatic fix. The current registry latest versions are Expo 57.0.16 and Clerk Expo 4.6.0;
Clerk Expo 4.6.0 supports Expo versions from 54 through 57. A safe candidate is a separately reviewed
Clerk Expo 4.6.0 patch update followed by a complete dependency tree diff, auth regression suite,
Expo Doctor, exports, native builds, and a fresh audit. It must not be claimed as a vulnerability fix
unless the transitive Solana/Jayson/UUID path is actually gone. Do not force UUID 11 or 14 beneath
Jayson or Xcode because those consumers declare older major ranges.

The audit also reports `expo-splash-screen@57.0.8` through the same `@expo/config-plugins`/`xcode`/
`uuid` chain and suggests `55.0.24` as a semver-major fix. That downgrade is outside the Expo SDK 57
compatibility set, so it is not accepted. Expo Doctor and the all-platform export remain the release
compatibility gates while this upstream moderate path is tracked.

## Release disposition

- The Metro 0.84.5 targeted refresh removed all four High dependency nodes without crossing the
  React Native or Expo support boundary.
- The moderate Clerk and Expo tooling chains require upstream-compatible releases or removal of the
  transitive paths. Track and re-audit them; do not suppress or relabel them as fixed.
- The dependency graph now meets the clean High-severity production-audit gate. Signed native builds,
  physical devices, provider configuration, store screenshots/metadata, and distribution review
  remain open.
- Every dependency change must preserve the exact Clerk mobile JWT realm, Bearer-only API boundary,
  secure token cache, one-time 401 refresh, and production API-origin pin.
