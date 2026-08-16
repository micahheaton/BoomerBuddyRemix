# ADR-0009: Expo Mobile Foundation with Explicit Native Boundaries

Status: **Accepted for Run 1 scaffold; native capabilities device-unverified**

Decision date: 2026-08-15

## Context

The shortest useful mobile loop is paste/share, Check, understand, act. A shared application accelerates ordinary flows, but iOS extensions, Android intent handling, message filters, calls, app-store billing, and secure-storage behavior require native lifecycles and real devices.

## Decision

Use Expo/React Native for navigation, text/URL Check, history, Family/orientation entry, shared contracts, and accessible design tokens. Keep fraud, authorization, entitlement, and retention authority on the API. Build Run 1 labels native sharing, filtering, calling, push, and store billing unimplemented.

Future Swift/Kotlin entry points stay thin: declare bounded content types/sizes, avoid active rendering, create opaque short-lived handoff references, invoke the authorized app/API only when platform rules permit, and delete temporary material. They never silently upload, broaden permissions, store secrets in ordinary storage, or implement another scoring engine.

The development mobile bearer contract is defined by ADR-0003. Expo SecureStore is the intended native store; web is memory-only; Windows static/web tests do not verify native storage or iOS behavior. iOS changes need macOS/Xcode and real-device tests; Android needs real-device role/intent tests.

## Consequences

Most product code is shared while native risk stays explicit. Extensions may require config plugins or custom native code and can diverge if not contract-tested. Host limitations remain reported, never converted into a passed device gate.

Rejected: responsive web only as the mobile product, claiming native functions from scaffolds, putting domain decisions in extensions, and background content collection.

## Evidence

Accessed 2026-08-15: [Expo monorepos](https://docs.expo.dev/guides/monorepos/), [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [Apple Share Extensions](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html), and [Android sharing](https://developer.android.com/develop/ui/compose/sharing).
