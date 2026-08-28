# Product value beta evidence ledger

## Purpose and boundary

This ledger records the BoomerBuddy 2.0 product-value candidate built on 2026-08-27. It separates repository implementation and synthetic proof from deployment, provider, native-device, real-human, and production evidence.

- Repository: `https://github.com/micahheaton/BoomerBuddyRemix.git` is the only source of truth.
- Candidate branch: `codex/product-value-beta`.
- Frozen payment baseline: `f4997946231b1548afc1a4b6d798ff05796a3c69`.
- Payment evidence: exact-SHA GitHub Actions run `33098426835` passed all five jobs before this product-value work began.
- Household safety implementation baseline: `11c0f70b2e293d71a09401b918b15a0a9ca2f711`.
- Household safety evidence: exact-SHA GitHub Actions run `33123397854` passed all five jobs.
- Public value-proposition implementation baseline: `08a285eaf39675b3daa1afef0568601525b8116f`.
- Public value-proposition evidence: local full verification and the focused responsive
  accessibility matrix passed; exact-SHA GitHub Actions run `33141679927` is the controlling CI
  receipt for that baseline.
- Payment boundary: this candidate does not change Stripe, commerce, billing, pricing, Twilio, Replit, or the legacy BoomerBuddy application.
- Data boundary: tests and browser rehearsals use synthetic identities and content. No customer PII is included.
- External boundary: no provider, production, deployment, customer, message, payment, or money write occurred in this candidate.

These exact commits are immutable implementation baselines. A later documentation or integration
commit creates a new candidate and must receive its own applicable validation and exact-SHA CI before
release. None of these repository receipts proves deployment, provider configuration, signed native
artifacts, physical-device behavior, real-customer value, or payment.

## Implemented beta value loop

| Capability | Repository implementation | Evidence state |
| --- | --- | --- |
| Customer sign-in recovery route | An explicit `/sign-in/client-trust` page preserves the Clerk device-trust callback and has its own descriptive metadata. | Source, type, route, and browser proof in the candidate. The live site remains on an older deployment and is not repaired until the exact candidate is deployed and Clerk configuration is closed. |
| Neutral household onboarding | A signed-in adult creates and retains an identity-bound, short-lived, one-use connection code. An organizer creates a neutral household invitation and shares only its invitation ID. The recipient previews and accepts with their own code. | API, persistence, web, mobile, tenant, restart, wrong-identity, revoked-invite, and retry tests. No automatic role, protected status, payer authority, billing authority, or Trusted Circle permission is granted. |
| Neutral membership exit | Eligible neutral members can leave; administrators can remove eligible neutral members. | Web and mobile confirmation flows, recent-auth handling, stale-household response guards, principal refresh, and focused security tests. Server authority remains canonical. |
| Protected-member enrollment | The invited adult separately reviews and directly consents to protected enrollment. | Existing authorization and consent flow plus integrated customer-journey regression. Household membership alone cannot supply consent or protected authority. |
| Trusted Circle pairing | A protected member creates an exact-recipient, one-permission invitation. The intended person previews and accepts with their own connection code. | API, persistence, web, mobile, identity-binding, revocation, allowance, zero-side-effect denial, restart, and cross-household tests. It grants `view_shared_checks` only. |
| Collaborative Check follow-through | The protected member deliberately shares a redacted result. The exact trusted recipient acknowledges review. The owner can close only after acknowledgement, with a bounded safe reason. Revocation removes access. | Integrated Run 3.1 journey, web/mobile lifecycle UI, append-only event constraints, and authorization tests. Submitted text and URLs are not included in the shared view. No message is sent automatically. |
| In-app Trusted Circle attention | An exact trusted recipient sees a content-free pending acknowledgement count on Home and enters the existing shared History flow. Acknowledgement or loss of the exact active relationship removes the item. | Contract, persistence, API, web, mobile, tenant, revocation, bounded-list, and browser proof. The item contains only Check ID, fixed attention kind, and share time. No text, email, push, or provider delivery occurs. |
| Family safe word lifecycle | A protected member can replace or disable a masked family safe word after recent first-factor authentication. An exact active Trusted Circle counterpart can privately test a phrase, with five attempts per 15 minutes per pair. | Contract, scrypt verifier, database actor and append-only constraints, API, web, mobile, privacy inventory, retention, deletion, rate-limit, browser, and wrong-actor tests. Phrases are transient and never returned, logged, audited, or stored in plaintext. Match and non-match are labeled as a social aid, not identity proof. |
| Short safety curriculum | Seven versioned lessons cover urgency, independent verification, codes and passwords, unusual payment requests, family-emergency impersonation, remote access, and recovery without shame. | Domain, contract, persistence, API, web, mobile, and browser proof. Each lesson is designed for about 3 to 5 minutes and records resumable progress and review timing. |
| Reviewed scam guidance | Members choose the United States or a coarse state region. The feed returns dated, source-linked, reviewed briefs. California, Arizona, Illinois, New York, and Pennsylvania have current state-specific items; other states honestly fall back to current national guidance when no reviewed state item exists. | Seed, schema, API, web/mobile copy, official-source existence review, fallback, stale, expiry, and browser tests. This is curated guidance, not live monitoring or an exhaustive regional alert service. |
| Weekly rehearsal | A member can opt into in-app weekly rehearsal state and complete a rehearsal. Mobile can request and schedule one generic local device notification. | Persistence, API, web/mobile, cancellation, permission-denial, sign-out, and static distribution tests. Remote push, SMS, contacts, and automatic notification delivery are disabled. Physical-device and lock-screen proof remains external. |
| Retry-safe learning mutations | Every learning mutation requires an action-bound `Idempotency-Key`. Exact retries return the canonical result without repeating progress, audit, or outbox effects. Conflicting reuse fails. Pending keys survive web reload and mobile app restart for up to 24 hours without retaining the raw answer or region. | Concurrent first-use, replay, conflict, authorization-after-revocation, malformed local record, expiry, intent mismatch, sign-out clearing, privacy inventory, immutable receipt, cascade deletion, PGlite, and real-PostgreSQL test paths. |
| Household-switch safety | Home, Check, History, Family, Orientation, Learn, and mobile resources bind responses and mutations to the exact selected household and request generation. | Focused async-race regressions and browser rehearsal. A stale response cannot relabel or mutate another household's screen. |
| Senior-first navigation and accessibility | Member Home, Check, History, Family, and Orientation/Learn have unique page titles, visible focus behavior, honest loading/error/retry states, plain-language authority boundaries, and no color-only risk claim. | Type, lint, source regression, Playwright, keyboard, axe, and local browser evidence for the candidate. Manual screen-reader, large-type, and real-device proof remain external. |
| Mobile beta surface | Expo mobile includes signed-in Home, Check, History, Family, Trusted Circle, shared-result lifecycle, Learn and updates, region preference, weekly rehearsal, and generic local reminders. Distribution identifiers and store metadata use `net.boomerbuddy.app` unless a provider collision is found. | Source, type, security, distribution-verifier, and web-preview proof. Signed iOS/Android builds, stores, physical devices, native share extensions, and production Clerk native-app records remain external. |

## Durable safety properties

- Membership, protected status, administrator role, payer identity, billing authority, entitlement, and pairwise Trusted Circle permission remain separate facts.
- Recipient connection secrets are never stored in plaintext and are never delivered automatically.
- Recent customer authentication means recent first-factor authentication. The UI never calls it MFA.
- Repository authorization is rechecked inside the same transaction before learning replay or mutation.
- Learning operation receipts contain only action binding, hashes, time, and the minimal canonical result. They do not contain submitted Check content, lesson option text, region text, tokens, or secrets.
- Direct operation-receipt update or delete is rejected. Authorized membership deletion can cascade the person's scoped receipts.
- Safe-word phrases exist only in transient request and component memory. Stored verifiers are salted and peppered; lifecycle and rate evidence is content-free, bounded, and cascade-safe.
- A Trusted Circle attention item is a private in-app projection, not evidence that any notification was delivered or that the recipient acted.
- Guidance is repository-owned, versioned, dated, reviewed, and expiring. Missing state content produces an explicit national fallback, not fabricated local coverage.
- Twilio and remote outbound communication stay disabled until a later consent and compliance gate.

## Validation record

The frozen candidate must retain the exact command output in the task or CI record. At the last pre-commit checkpoint:

- Member-learning and 0040 focused suite: 11 files and 42 tests passed.
- Cross-layer idempotency, privacy, neutral-membership, and portability suite: 8 files and 22 tests passed during independent review.
- Family and customer-sensitive-auth suite: 2 files and 18 tests passed during independent review.
- Earlier focused Family and security suite: 11 files and 58 tests passed.
- Trusted Circle attention backend suite passed: 2 files and 7 tests. The web/mobile attention copy suite passed as part of 4 files and 19 focused tests.
- Family Safe Word server suite passed 14 focused tests; its web/mobile UI and route guard passed 22 focused security tests.
- Contracts, domain, persistence, API, web, and mobile TypeScript checks passed.
- Whole-tree ESLint passed.
- Targeted Prettier and `git diff --check` passed.
- Local browser proof covered signed-in Home, Check, History, Family, Family Safe Word, Orientation/Learn, a synthetic high-concern Check, redacted History, Trusted Circle invitation and attention boundaries, all seven lessons, one completed lesson, source-linked guidance, and reminder truth with zero console errors.
- Unit tests passed: 50 files and 463 tests.
- Integration shard 1 passed: 41 files and 219 tests. Integration shard 2 passed: 40 files and 281 tests.
- Security tests passed: 65 files and 502 tests.
- The synthetic fraud evaluation passed all 12 fixtures. It is a regression signal, not an accuracy or calibration claim.
- Production builds passed for API, worker, customer web, HQ, and Expo web export.
- Production UI, production auth-route, and Next.js protected-resource verifiers passed. The auth-route verifier proves compiled route topology, not hydrated Clerk provider behavior.
- The full Edge browser suite passed all 30 journeys, including accessibility, auth recovery, Check, History, neutral household onboarding, protected-member consent, Trusted Circle attention and lifecycle, Family Safe Word replacement/verification/disablement, multi-household isolation, learning, support, HQ, and billing fail-closed behavior. A focused axe rerun also covered the new Safe Word route with no serious or critical violation.
- The expanded accessibility matrix passed 16 of 20 cases in Chromium and WebKit. All four Firefox cases were blocked before assertions by the local Windows Playwright toolchain with `browserType.launch: spawn UNKNOWN`; this is an evidence gap, not an application assertion failure.
- Mobile distribution inputs passed the provider-free verifier for `net.boomerbuddy.app`. Universal links, signed native builds, store-provider records, and physical-device behavior remain external.
- A fresh registry-backed `npm audit --audit-level=high` passed its threshold with no high or critical findings. It reported 1 low and 23 moderate advisories, including a Windows development-server `esbuild` advisory with a fix available and transitive `uuid` findings without a complete upstream fix. These remain explicit dependency-maintenance follow-up and are not evidence of production exploitability.
- The final uninterrupted `npm run verify` passed secrets across 868 text files, runtime dependency scope, all TypeScript checks, lint, formatting, 1,465 unit/integration/security tests, 12 evaluation fixtures, API/worker/web/HQ/mobile builds, production UI guards, and protected Next.js resource probes. Windows sandbox restrictions intermittently blocked Node process, trace, directory, and formatting writes; the identical narrow commands passed in approved process contexts. Real-PostgreSQL validation remains an exact-SHA CI gate because this machine has no approved PostgreSQL URL.

These are repository and synthetic evidence. They are not production, provider, physical-device, real-customer, or outcome evidence.

## Open external closure gates

| Gate | Why it remains open | Verifiable closure |
| --- | --- | --- |
| Exact candidate identity | The pushed implementation baselines are identified above, but this living documentation can change afterward and cannot self-bind the final release commit. | Record the later full commit SHA and tree, clean status, upstream equality, annotated tag, and exact-SHA green CI in an external scope receipt. |
| Live customer sign-in | The live deployment is older, `/sign-in/client-trust` returned 404, and Google sign-in looped. | Preserve Replit-local configuration evidence, deploy the exact approved GitHub SHA by pull only, rotate the exposed Google OAuth secret, close Clerk callback/fallback/legal/support configuration, and pass fresh Gmail plus email-code journeys without recording identity data. |
| Real PostgreSQL runtime | The repository contains a real-PostgreSQL concurrency and migration verifier. | Run it in exact-SHA CI or an approved managed staging database and retain the sanitized job receipt. |
| Physical mobile devices | Windows and web preview cannot prove native credential, notification, accessibility, signing, or store behavior. | Pass signed iOS and Android builds on supported devices, lock-screen privacy, VoiceOver/TalkBack, large text, slow/offline behavior, session revocation, and store review. |
| Native share entry | Manual paste works; iOS Share Extension and Android Sharesheet receivers are not implemented and device-proved in this candidate. | Build thin native receivers, retain the API as authority, and pass hostile-input, cross-account, termination, retry, and cleanup tests on devices. |
| External Trusted Circle delivery | The exact recipient now has an in-app attention queue, but BoomerBuddy does not send email, SMS, or remote push. | For the observed beta, use explicit manual contact. Add any external delivery only after separate purpose consent, compliance, provider, deliverability, device, retry, revocation, and quiet-hours evidence. |
| Recovery follow-through | Results provide prioritized safe actions, redacted collaboration, recipient acknowledgement, and owner closure with a bounded self-reported reason. BoomerBuddy does not verify completion, file reports, contact banks or agencies, or manage a recovery case. | Keep the observed beta promise to decision support and self-reported follow-through. Before claiming managed recovery, add an owner-chosen safe-action record and separately prove any case, deadline, evidence, contact, or filing workflow. |
| Regional breadth | National guidance works for every supported region; only reviewed state items are shown as state-specific. | Add state briefs only through dated official sources, editorial review, expiry, and regression fixtures. Never infer local coverage from a state selection. |
| Human value and usability | Automated tests cannot prove that older adults and family pairs understand or value the service. | Run observed, consented beta sessions with older adults and adult-child pairs; measure first safe action, comprehension, return use, Trusted Circle follow-through, support burden, and complaints without claiming loss prevented. |
| Live operations | No on-call, alert, restore, support, or production rollback receipt is created by this repository-only candidate. | Complete exact-SHA staging, backup/restore, monitoring, support, incident, and timed rollback rehearsals before relying on production service. |

## Release and rollback rule

Commit and push this candidate only after the local gauntlet is green. GitHub remains the source. Each BoomerBuddy 2.0 Replit service may later pull the exact approved commit after its local checkpoint and `.replit` differences are preserved and reconciled. Never push from Replit. Never use or modify the legacy `BoomerBuddy` Replit project as part of this release.

If a candidate validation fails, keep the live services on their current artifacts and fix forward on this branch. If a later deployment fails, restore only the affected service's recorded prior artifact while billing initiation and outbound messaging remain disabled.
