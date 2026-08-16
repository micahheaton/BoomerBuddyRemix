# Mobile Experience

Status: **designed on 2026-08-15; not implemented until the readiness gate passes**.

## Product decision

Mobile is the primary protection surface because it can shorten the path from “this feels wrong” to a safe action. The target loop is **Share → Check → understand → act safely → optionally involve a trusted person**. Manual paste remains essential when another app or the operating system cannot share the artifact.

Build Run 1 will create an Expo/React Native application shell, shared contracts and design tokens, navigation, and a text/URL Check for an allow-listed signed-in member persona. There is no anonymous persisted Check; a future anonymous mode would be ephemeral/no-history under a server-minted context. Run 1 will not claim that native sharing, SMS filtering, caller identification, or app-store billing works. Those capabilities require native targets, device testing, store review, and policy validation.

## Capability roadmap

| Priority | Capability | Platform reality | Decision |
|---|---|---|---|
| Run 1 | Text and URL Check, history, Family/orientation entry | Ordinary app APIs | Implement the cross-platform foundation; clearly label local/mock providers. |
| Run 2 | User-invoked share from browser, Messages, Mail, and other apps | iOS Share Extension receives declared attachment types; Android can receive text, images, and files through sharing intents | Build thin native entry points that hand validated content to the same Check contract. Test on real devices. |
| Run 2 | Deep links from notifications and trusted escalation | Universal/App Links require domain association and safe routing | Route only to an authorized resource; unauthenticated links land at sign-in without leaking metadata. |
| Later | Screenshot/image and QR ingestion | Camera/photo permissions and hostile file handling are required | Add only after the isolated upload/OCR pipeline and evaluation fixtures exist. |
| Research | iOS message filtering | Apple limits IdentityLookup to SMS/MMS from unknown senders; it does not cover contacts or iMessage. The extension cannot directly access the network. | Treat as a separate opt-in product experiment, not “we read your texts.” Do not block or label messages without dedicated quality evidence. |
| Research | Caller identification/screening | iOS CallKit/IdentityLookup and Android `CallScreeningService` are constrained, user-enabled platform roles; neither grants universal call access | Validate acquisition value, permissions, latency, store policy, and false-positive harm before building. |
| Rejected claim | Call recording or definitive AI-voice detection | Platform, consent, and scientific limitations are material | Never market automatic recording, call interception, or proof that a voice is AI-generated. |

Apple documents that a Share Extension receives initial text and attachments such as links and images through an extension context. Android documents receiving simple text, images, and files through the Sharesheet and intents. These are user-invoked transfer mechanisms, not background surveillance.

## Native boundary

Keep business rules in shared TypeScript packages; keep platform lifecycle, extension activation, secure token access, and attachment handoff in Swift/Kotlin native targets. A native entry point may:

1. accept only declared content types and bounded sizes;
2. normalize metadata without rendering active content;
3. write an opaque, short-lived handoff reference to an app-group/private container;
4. open the containing app or call the authenticated API when platform rules permit;
5. delete temporary bytes after success, cancellation, or expiry.

It may not persist session secrets in ordinary storage, silently upload artifacts, broaden permissions, or implement a second scoring engine. The API remains authoritative for identity, entitlement, authorization, analysis, and retention.

## Senior-first interaction contract

- One prominent **Check** action; no security dashboard as the home screen.
- Minimum 48-by-48 CSS-point product target, dynamic type, screen-reader labels, visible focus, plain language, and no color-only risk state.
- Results lead with “What to do now,” then evidence and uncertainty. Never label a URL “safe”; use “no known warning found” or “we cannot verify this.”
- A high-risk result must not auto-message family. The member chooses a scoped escalation and sees exactly what will be shared.
- Offline mode may show saved educational guidance and queue a draft, but it must never present a stale or fabricated verdict.
- Notifications contain no artifact text, financial detail, or risk allegation on the lock screen by default.

## Mobile security and release gates

Build Run 1 mobile authentication is development-only: the app holds an opaque, audience-scoped, expiring and revocable bearer whose server-side session resolves the actor and current roles. It stores that bearer through Expo SecureStore on native and only in memory on Expo web; it never trusts actor IDs or roles in client state. Production refuses the development issuer. SecureStore behavior is **device-unverified** on this Windows host until real-device validation.

Use OS-protected credential storage, certificate-validating TLS, remote session revocation, device-local redaction, and per-environment deep-link allowlists. Avoid embedded third-party SDKs until their data collection and mobile manifests are reviewed. A lost device must be removable from account security settings.

Before a native-sharing release: test extension termination/retry, oversized and malformed input, Unicode/homograph text, locked-device notifications, cross-account handoff, revoked sessions, VoiceOver/TalkBack, large type, low connectivity, and device cleanup. iOS source must be built and exercised with Xcode on macOS; Windows static checks do not satisfy that gate.

## Evidence

Accessed 2026-08-15:

- [Apple Share Extensions](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html)
- [Apple SMS and MMS Message Filtering](https://developer.apple.com/documentation/identitylookup/sms-and-mms-message-filtering)
- [Apple identifying and blocking calls](https://developer.apple.com/documentation/callkit/identifying-and-blocking-calls)
- [Android sharing overview](https://developer.android.com/develop/ui/compose/sharing)
- [Android call screening](https://developer.android.com/develop/connectivity/telecom/dialer-app/screen-calls)
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
