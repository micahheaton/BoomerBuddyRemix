# Stage 8 Feedback Author Evidence

Date: 2026-08-17

Evidence tier: `local_simulation`
Historical integrated author snapshot aggregate: `46ce07f5c3118f918129ce0ae0973a559902594abeb06e4e864e0cb173b0ad0c`

This was the integrated Stage 8 author candidate after the shared API, worker, HQ, member-web, and native-development composition was released by the Stage 7 owner. It superseded the isolated `1cd2794ad454f6843154a15ea44f263adefddb7ea7d3bcbc66991985851b2126` snapshot and the obsolete `f92e06e314009e4be1e087366e43c7c54e8f1ab566f87f587ec94dcc50171ef9` snapshot. Independent review reproduced the exact aggregate before and after, reran the 55-test slice plus adjacent worker regressions, and returned 0 Critical / 0 High. Later shared composition changed multiple listed paths, so this manifest is now an accepted historical snapshot, not the final working-tree manifest. The Stage 17 commit/tag is the canonical integrated freeze.

This snapshot is not deployed-staging, native-device, managed-PostgreSQL contention, restore, backup deletion, provider, real-human, production, revenue, conversion, calibration, or training evidence. No real person, message, payment, provider, campaign, external model, media, or outbound action participated. The manifest excludes this evidence file to avoid a self-referential digest.

## Historical construction recipe

This recipe requires the original historical snapshot bytes, which are not supplied by the final checkout. Running it against the final checkout
is not expected to match the historical aggregate.

1. Use the 34 repository-relative paths below in ordinal lexicographic order.
2. For each path, compute `git hash-object -- <path>` from the repository root.
3. Serialize one line as `path<TAB>git-hash-object`.
4. Join lines with a single LF byte (`0x0a`). Do not add a terminal newline.
5. Encode the joined string as UTF-8 without a BOM.
6. Compute SHA-256 over those bytes. The expected lowercase hexadecimal result is the integrated author snapshot aggregate above.

Exact manifest input:

```text
apps/api/src/app.ts	91b81793f15989dcdda2268cff73cc3c8bf8fea0
apps/api/src/context.ts	919a11e7ef693e52cf0ac8573f8995cf16bc762e
apps/api/src/routes/feedback.ts	cdddb48906f28ab491c6e8f3b631fc2ae700075c
apps/hq/src/app/feedback/page.tsx	152452d01c044fac4bc00805cdfa925601b1e5b1
apps/hq/src/components/feedback-learning.tsx	2eca5c409041a4af9d7b1efb28e10df34b00f2b0
apps/hq/src/components/hq-screen.tsx	d0ad7097132991d7d215f459b2e388dc8b1cce4f
apps/mobile/App.tsx	a9977cabac3274f00d23df876deeb59c36eaef74
apps/mobile/src/feedback-screen.tsx	2b7e2cf00270e773a1abcf361a28ed2b2e99be5b
apps/mobile/src/navigation.ts	5ae6f26d6123fffff37a024b6faa75ec8591bfa8
apps/mobile/src/screens.tsx	3de4f143d6efa38f2fa4b3f79baef3852a7f1761
apps/web/src/app/feedback/page.tsx	490af16460f0be229ca5dde2358c7c226abe283e
apps/web/src/app/member/feedback/page.tsx	bc892360fb6a1ea784ba01950bc3269a147d7ac4
apps/web/src/app/member/page.tsx	8110868d363b7db0197aac31a9ff45f742c62395
apps/web/src/components/feedback-form.tsx	1118a107be63619c171b4a496bb77a5d12539107
apps/worker/src/feedback-composition.ts	bf4c1669389360c6cbaa9b8bdcacb7bfa0c82209
apps/worker/src/feedback-retention.ts	8287afb1c2b5159059de2863aa1fbe11df032cee
apps/worker/src/server.ts	f10a152cebd1a9564957727fb982fa1a3ac543d6
docs/adr/0025-local-feedback-learning-evidence-boundary.md	335b5fac7ef2308f43f4461728906db851fcf8a9
docs/run-3/FEEDBACK-LEARNING-SYSTEM.md	ea4c4e4bf4986129d28bb9a98026724bb3f7353f
packages/contracts/src/feedback.test.ts	85a88bcd8908d323551f3c961b7a6fe32c1d079d
packages/contracts/src/feedback.ts	ad1c1fc4e42019ea4ee8782f55434cf61017bf7e
packages/domain/src/feedback.test.ts	cfc5b077f04b4c25d30396cc4f9c6343b9f46e14
packages/domain/src/feedback.ts	125c3251b2c1a5c8a18bb4a297d15ad2f9e2b645
packages/persistence/migrations/0020_run3_feedback_learning.sql	95dfe466e3be4f7ad4c3e219965207b7cf36d952
packages/persistence/src/feedback-migration.test.ts	4684c9702900f8f66aea402d99bffcfbc56abedb
packages/persistence/src/feedback.test.ts	bd9d29ca83005c920e2ff99b4830d61ca81feb17
packages/persistence/src/feedback.ts	ee59d5f59927937ae80110782dc558713602548e
packages/persistence/src/index.ts	69b77fbb0c30cb7ebe05c471584053d7436ae8cc
tests/e2e/feedback-learning-isolated.spec.ts	890e0a6293974864aa1436cbb8eb019cb6ff0135
tests/e2e/feedback-learning.playwright.config.ts	9fe7dc9f739d97d97c72fdb737457978fabf7513
tests/integration/feedback-composition.test.ts	9d846d18a8b0b3e6cc6300b3590666ceb5cce8c1
tests/integration/feedback-retention.test.ts	a37a3c367aff9e4cb335173f9dff79331af12b86
tests/integration/feedback-routes-isolated.test.ts	93d90532853c574f0a470e9c250374cd11aaf6be
tests/integration/feedback-worker-composition.test.ts	68952b2bd8403bc11a9d2b8ea0466cb519a2d22b
```

## Shared composition evidence

- Persistence exports `FeedbackRepository`. The shared API context constructs it with the code-owned artifact-encryption and fingerprint keys at version 1.
- `buildApp` registers the feedback routes in every environment so their production guards are exercised. No feedback purge, retention, or ciphertext-erasure maintenance was added to API initialization, startup intervals, close, or request intake.
- A real-`buildApp` integration creates an already-due encrypted feedback payload before app startup, proves startup and a later authenticated durable intake do not purge it, exercises the registered adapter inventory, signs in through the real local session route, and verifies the completed operation, retained minimized payload, and four content-free processing receipts.
- A production-configuration real-`buildApp` integration proves the adapter inventory remains inspectable while anonymous intake returns the fail-closed founder-gate response and persists no feedback row.
- The durable worker composition installs exactly `feedback.retention.maintain` outside production and enqueues one interval-idempotent, internal, content-free bootstrap job. Production installs no feedback handler and enqueues no feedback job. Redaction, classification, deduplication, drafting, provider, media, email, transcription, and outbound handlers are not registered.
- At the historical snapshot, HQ advertised feedback only outside production to owner, reviewer, or support roles; repository authorization limited content to an exact current assignment. Member web advertised it only outside production with a selected household, and the native stack/home entry were `__DEV__`-guarded. The final integrated candidate further removes native feedback from the shared entry so its local actions are absent from production artifacts. Public feedback remains unlinked.
- A bounded read-only composition preflight found no API lifecycle maintenance, production worker work, processing-handler registration, public link, or apparent overwrite of the accepted Stage 7/Stripe hunks. This preflight is author-side evidence, not the required independent adversarial verdict.

## Independent-reopen remediation retained

The isolated foundation retains the three High closures from the second independent reopen:

- **Untrusted reserved placeholders:** raw submitted text containing any reserved redaction placeholder becomes typed metadata-only quarantine before minimization or encryption. Decrypted already-minimized content uses a separate verifier. Tests find no submitted placeholder/span in retained content, operations, jobs, audit, or metadata.
- **Canonical mapped addresses:** dotted and hexadecimal IPv4-mapped IPv6 collapse to canonical dotted IPv4 in domain, route, and repository layers. Dotted/mapped equivalents share one five-request bucket and one active concurrency identity.
- **Lease ownership through completion:** anonymous intake locks and renews the exact lease using database time through the durable transaction and atomically rechecks ownership before commit. Crossing the original TTL does not create overlapping intake; failed final renewal rolls back and cleanup remains exact.

The five earlier High closures also remain represented in the manifest and focused suite:

- one code-owned readable-state allowlist, fresh state after current authority locks, and race/direct-SQL denials;
- all-or-nothing bounded explicit-credential redaction or metadata-only quarantine, including punctuation, quoted/space, `password is`, URL, Unicode, private-key, card, and OTP cases;
- database-authoritative quota, lease, deadline, read, and purge time plus canonical trusted-proxy-resolved IPv4/IPv6;
- deferred same-transaction erasure evidence, exact one-hour declined/support retention, and a hard 24-hour local ceiling; and
- private no-store/legacy response headers, client `cache: 'no-store'`, and clearing opened content on authorization loss.

`activeStoreCiphertextErased` remains the only deletion claim. The shared master key is not a per-record envelope key, so deleting active-database ciphertext is not cryptographic erasure of backups, snapshots, caches, processors, or restored copies.

## Local validation at this snapshot

- 8 focused Vitest files / 55 tests passed, including shared real-API and worker composition.
- Domain, contracts, persistence, API, web, HQ, worker, and mobile workspace typechecks passed; root TypeScript passed again after the integrated browser-fixture change.
- Scoped ESLint and Prettier passed; scoped tracked-file `git diff --check` passed. The production web build's generated `next-env.d.ts` drift was restored exactly and is absent from git status.
- API and worker production bundles passed. Optimized web and HQ production builds passed. Expo web production export passed.
- Historical generated public/member feedback HTML contained the fail-closed activation warning with no form or submit control, and production navigation omitted feedback. The final integrated verifier additionally requires the public, member, and HQ feedback blockers, forbids local submit/review actions in their route artifacts, and requires the production Expo bundle to omit the feedback navigation and action text. The isolated native component remains source-only and unwired.
- One isolated route-mocked local Edge test passed 1/1 with exit 0 for no-store requests and clearing opened minimized text on authorization loss. The fixture now explicitly supplies the composed HQ session projection. It remains a mocked-feedback-API browser test, not a shared API/session/database or deployed-browser journey.
- The high-confidence repository secret scan passed across 524 text files. It is not managed-KMS, Git-history, entropy, or external-scanner evidence.

## Remaining limits and disposition

- PGlite exercised fresh/forward migration, deferred commit-time failures, and deterministic gated lease races. No founder-selected managed PostgreSQL instance, true multi-connection contention run, replica, restore, backup, or disaster-recovery system participated.
- No shared API/session/database browser journey, native-device run, deployed staging, accessibility audit of the integrated flow, provider sandbox, or real-human validation exists.
- Processing receipts remain `local_processing_not_run`; no classification, deduplication, clustering, drafting, issue creation, experiment, external action, outbound contact, provider result, or training claim exists.
- Attachment, audio, image, video, screen-recording, inbound-email, transcription, and external-model adapters remain structurally disabled.
- Founder decisions for consent language, anonymous intake, retention, ownership, geography, storage/KMS, providers, professional review, and incident handling remain explicit activation gates.

Stage 8 disposition remains `REMEDIATE` for the managed-PostgreSQL, restore/backup, deployed, founder, professional-review, and external gates above. Independent local adversarial review is accepted at 0 Critical / 0 High, and the later current-tree shared Stage 5–10 review also returned 0 Critical / 0 High. Neither result authorizes production feedback intake or any external action.
