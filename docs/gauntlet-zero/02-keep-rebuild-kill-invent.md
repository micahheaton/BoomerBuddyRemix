# V1 Keep / Rebuild / Kill / Invent

Paths below are relative to `reference/boomerbuddy-v1/BoomerBuddy/`. **Evidence** records what exists in v1; **judgment** is the recommended 2.0 treatment. “Keep” means preserve knowledge or validated content—not copy implementation or publish seeded data without review.

## Executive decision

V1 is a broad product-research prototype, not a safe technical foundation. It tests hypotheses across scam checking, alerts, education, family support, reporting, subscriptions, and administration. Its single-user model, LLM-only analysis, authorization failures, misleading trust claims, privacy gaps, and Replit-bound operations make incremental hardening unsafe. Reuse product vocabulary, content research, source discovery, and accessibility intent; rebuild every trust-critical runtime path.

## KEEP — preserve as research inputs

| Asset | Evidence | Judgment / 2.0 treatment |
|---|---|---|
| Journey inventory | `client/src/App.tsx` and `client/src/pages/` cover acquisition, orientation, six check inputs, alerts, education, contacts, reporting, billing, sharing, and admin. | Keep as discovery and backlog input. Redesign around Check, Protect, Recover, and role-aware households. |
| Scam taxonomy | `server/seedData/scamTypes.ts` defines 50 types in eight categories with tactics, red flags, examples, and tips. | Keep concepts and copy candidates. Add citations, editorial ownership, versioning, localization, and review dates. |
| Learning themes | `server/seedData/learningTracks.ts` and `assessmentQuestions.ts` hold 15 tracks and 15 questions. | Keep topic coverage; remove stigmatizing “vulnerability” framing and validate recommendations with research. |
| Game prototypes | Six components under `client/src/components/games/` and scenarios under `client/src/data/games/` demonstrate short teaching interactions. | Keep patterns and vetted scenarios; rebuild accessibility, scoring, and progress semantics. |
| Source discovery | `server/stateSourcesConfig.ts` catalogs 200 state sources; `server/alertAggregationService.ts` adds 13 national feeds. | Keep as a candidate registry only. Revalidate URLs, authority, rights, ownership, freshness, and coverage. |
| Safe-contact candidates | `server/seedSafeContacts.ts` contains 44 government, bank, utility, and insurer entries. | Keep as unverified research. Publish only with provenance, jurisdiction, verifier, review date, and expiry. |
| Reporting field research | `client/src/pages/ReportGenerator.tsx`, `server/pdfService.ts`, and `shared/schema.ts` identify incident facts users may need. | Keep field concepts; confirm each agency requirement and distinguish “prepared” from “filed.” |
| Humane design intent | `design_guidelines.md` calls for large controls, plain language, high contrast, and low cognitive load. | Keep as acceptance criteria, then prove with automated and human accessibility testing. |
| Notification copy themes | `server/alertNotificationService.ts`, `learningNotificationService.ts`, `emailService.ts`, and `smsService.ts` contain alert and education patterns. | Keep only after safety, legal, deliverability, escaping, localization, and consent review. |
| Mobile requirements history | `docs/iOS_Development_Brief.md` documents desired native surfaces and old API assumptions. | Preserve as discovery history, not a contract; it contains no native implementation and repeats v1 weaknesses. |
| Visual identity candidates | `attached_assets/generated_images/` and public icons contain a shield master and derivatives. | Keep only after brand/rights review and correct size exports. Treat screenshots and logs as incident evidence, not design assets. |

## REBUILD — retain the capability, replace the implementation

| Domain | Evidence | Judgment / 2.0 treatment |
|---|---|---|
| Pages and orientation | `client/src/pages/Welcome.tsx` captures name, state, topics, and contact preferences; `App.tsx` exposes a large flat route set. | Build orientation for protected person, payer, helper, and sponsor; include consent, Trusted Circle, practice check, channel verification, and readiness state. |
| Universal checking | Separate pages implement text, image, transcript, audio, URL, and bulk analysis. | Normalize artifacts into one workflow with modality extraction, evidence, confidence, limitations, and verified actions. |
| Models and prompts | `server/scamAnalysisService.ts` interpolates user material into one prompt, loosely parses JSON, and makes the LLM the primary oracle. | Add deterministic and reputation signals, schema validation, prompt-injection defenses, model/prompt provenance, calibrated uncertainty, evaluations, and human escalation. |
| URL/image/audio | URL safety is inferred largely from the string; images use English OCR; audio is transcribed then sent through the text prompt. | Add URL canonicalization, redirects/DNS/TLS/domain intelligence, QR/visual extraction, language handling, recording consent/retention, and explicit failure states. |
| API/auth | `server/routes.ts`, `server/replitAuth.ts`, and `server/storage.ts` lack consistent protection and ownership checks. | Use contract-first APIs, centralized auth, household/tenant policy, object-level authorization, validation, rate limits, and idempotency. |
| Data schema | `shared/schema.ts` has 40 user-centric tables, free-form statuses, sparse constraints, and no household, consent, evidence, case, entitlement, or evaluation model. | Create bounded contexts with database-enforced ownership, constraints, provenance, retention, audit, and versioned migrations. |
| PWA/offline | `client/public/sw.js` caches successful API responses without user scoping and stubs background sync. | Start with data classification. Default-deny sensitive caching; add logout clearing, encrypted local state where justified, versioned migrations, and offline tests. |
| Alert intelligence | `alertAggregationService.ts` uses generic scraping/RSS, keyword severity, title similarity, and in-process schedules. | Create source adapters, provenance snapshots, normalized facts, quality/confidence, durable jobs, dedupe, moderation, and geographic coverage. |
| Official directory | Safe-contact seeds and admin pages provide the concept without a verification lifecycle. | Build verified organizations with official provenance, jurisdiction, effective dates, change history, review SLA, expiry, and uncertainty handling. |
| Family safety | `EmergencyContacts.tsx` stores one-way contacts; manual notification logs then returns success (`server/routes.ts:1274-1341`). | Replace with consented Trusted Circle membership, scoped permissions, verified channels, escalation/acknowledgement, revocation, and audit. |
| Reports/recovery | Reports are saved under `/tmp`; “filed” is user-controlled (`server/pdfService.ts:168-179`). | Build encrypted cases, evidence bundles, authoritative recovery steps, durable storage, retention choice, export, and truthful filing state. |
| Notifications | SendGrid/Twilio fallbacks record logs as success; scheduling is process-local and not user-timezone aware. | Add verified destinations, purpose consent, quiet hours, STOP/unsubscribe, callbacks, retry/dedupe, bounce handling, push, and delivery truth. |
| Subscriptions/Stripe | `server/routes.ts:1571-1965` embeds Stripe; entitlement checks and subscription shapes are inconsistent and webhook idempotency is absent. | Build a provider-neutral entitlement ledger for Stripe, app stores, family/annual, sponsor, and B2B; reconcile provider events idempotently. |
| Referrals/gamification | Attribution is not created from `?ref=`; reward and badge conditions conflict with stored shapes (`server/referralService.ts`, `badgeService.ts`). | Defer, then rebuild only if safety and retention evidence supports it. Never trust client-submitted scores. |
| Analytics/admin | `client/src/lib/analytics.ts`, UTM middleware, and admin pages cover acquisition/users/source health, not trust operations. | Build consent-aware events and an HQ for cases, source review, model quality, support, billing, privacy, vendors, jobs, and audit. |
| Localization | Locale resources and controls exist, but most screens, content, games, PDFs, and messages are English. | Build complete catalogs, locale-aware content records, translation/review workflow, fallback behavior, and bilingual safety QA. |
| Mobile | The iOS brief is spec-only and mirrors old APIs. | Design iOS/Android for the new model, including share extension/intents, deep links, safe cross-process storage, push, accessibility, and store billing. |
| Testing/delivery | `server/__tests__/alerts.test.ts` recreates routes instead of exercising production registration; all other critical areas are untested. | Require unit, contract, integration, E2E, tenancy, security, model-eval, accessibility, offline, webhook, and recovery gates. |
| Operations | `server/index.ts` and `scheduledTasks.ts` perform startup mutations, crawls, cron, and notification work in the web process. | Separate durable workers; add leases, idempotency, redacted observability, health checks, backup/restore, runbooks, SLOs, and release controls. |

## KILL — do not carry forward

| Pattern | Evidence | Judgment |
|---|---|---|
| V1 runtime as foundation | UI, routes, storage, providers, and schema are tightly coupled across `server/routes.ts`, `storage.ts`, and `shared/schema.ts`. | Freeze as research evidence; do not evolve it into the 2.0 system of record. |
| Public/weakly authorized private data | Public user mutation/read and global/per-ID analyses live in `server/routes.ts`; Quick Share reads arbitrary analysis IDs. | Delete these contracts; use deny-by-default authorization. |
| Client-controlled admin role | Unauthenticated `PATCH /api/users/:id` passes an unvalidated body through `Partial<InsertUser>`, including `isAdmin`; `requireAdmin` trusts the stored value (`server/routes.ts:129-149`, `server/storage.ts:360-366`, `shared/schema.ts:20-63`). | Any logged-in user can self-promote. Roles must be server-controlled, separately permissioned, and durably audited. |
| Synthetic proof | Home hard-codes ratings, family count, named testimonials, and statistics; `server/seedSuccessStories.ts` contains synthetic stories. | Remove unless independently substantiated, permissioned, dated, and legally approved. |
| False success | Emergency notify/contact and email/SMS fallbacks log but promise delivery or follow-up. | Never represent logging as delivery, filing, or human response. Fail visibly and truthfully. |
| LLM-only verdicts | `server/scamAnalysisService.ts` can turn failed/malformed output into an ordinary Caution/50 result. | Ban unsupported “safe” decisions and false precision. Models may synthesize evidence, not silently become authority. |
| “Vulnerability” score | `server/routes.ts:2565-2568` derives a precise-looking score from simple counts. | Remove the label/score unless validated; give supportive, non-stigmatizing recommendations. |
| Sensitive caches/logs | `client/public/sw.js` caches API responses; API/provider/contact code logs content and recipients. | Prohibit through data-classification policy and automated tests. |
| Consent by default | `client/src/lib/analytics.ts:22-39` treats no choice as consent; UTM middleware tracks independently. | Require explicit, versioned, revocable consent and minimized events. |
| Unsupported privacy/readiness claims | `PrivacyPolicy.tsx` promises unenforced rights/retention; `replit.md` claims production readiness, AAA, and source success without reproducible proof. | Publish only controls backed by evidence and legal/accessibility review. |
| Unverified authoritative content | Contacts, videos, examples, prevalence, and feeds lack durable provenance/review evidence. | Keep out of production until verified; expire stale content automatically. |
| In-process 213-source crawl | `index.ts`, `scheduledTasks.ts`, state config, and aggregation service duplicate work and expose a public trigger. | Remove from web requests and close public triggers. |
| Temporary evidence storage | `server/pdfService.ts` stores reports locally under `/tmp`. | Never use ephemeral local files for user evidence. |
| Replit-only coupling | `server/replitAuth.ts`, `server/openai.ts`, `.replit`, and `replit.md` bind identity, models, and deployment to one host. | Remove as architecture; keep only migration notes. |
| Launch distractions | Bulk, open-ended chat, story likes, leaderboards, referrals, and complex badges add risk before the core loop is trusted. | Exclude from trust-first launch until evidence supports them. |
| Hard-coded legacy identity | Sitemap, SEO, email, SMS, PDFs, and support text use `boomerbuddy.com`, conflicting with `boomerbuddy.net`. | Centralize and validate brand/contact configuration. |

## INVENT — missing 2.0 primitives

| New primitive | Required outcome |
|---|---|
| Household and Trusted Circle | Model payer, protected person, helper, sponsor, invite/acceptance, consent, scope, emergency authority, revocation, and immutable audit. |
| Family Safe Word | Create a secure, recoverable, selectively disclosed protocol; never expose the value to analytics, logs, models, or routine messages. |
| Canonical artifact | Normalize text/message/email, screenshot/image/document, URL/QR, phone number, voicemail/audio, transcript, and call metadata with explicit retention. |
| Evidence and decision graph | Separate extraction, signals, authoritative sources, provider/model versions, confidence, limitations, verdict, safe actions, reviewer changes, and feedback. |
| Evaluation/safety system | Maintain golden fixtures, adversarial and injection suites, modality benchmarks, calibration, false-negative monitoring, release gates, and appeals. |
| Incident/recovery case | Connect artifacts, financial exposure, evidence, contacts, actions, deadlines, reports, acknowledgements, and progress without implying legal filing. |
| Source/organization governance | Add ownership, jurisdiction, acquisition method, rights status, provenance snapshot, quality score, review SLA, effective dates, and expiry. |
| Provider-neutral commerce | Separate products, plans, entitlements, seats, beneficiaries, sponsorship, purchases, invoices/refunds, and provider events. |
| Communication governance | Record purpose consent, destination verification, capability, quiet hours, locale/template, provider event, retry, unsubscribe, and delivery state. |
| Trust Operations HQ | Add queues for fraud review, source/contact re-verification, content approval, support, billing, privacy, model regressions, and job failures. |
| Privacy control plane | Implement classification, minimization, regional rules, retention/deletion, export/correction, legal holds, redaction, vendor inventory, consent receipts, and access audit. |
| Mobile capture | Support iOS Share Extension, Android share intents, deep links, safe shared storage, background limits, push, and offline-sensitive design. |
| Content/localization lifecycle | Give every safety claim an owner, citation, locale, version, review status, accessibility metadata, effective date, and retirement policy. |
| Reliable platform operations | Add isolated workers, queues, locks, idempotency, secret management, promotion, observability, recovery drills, incident response, and cost controls. |
| B2B/sponsor boundary | Model sponsored access, co-branding, licenses, seats, beneficiary privacy, aggregate reporting, and separation from individual safety data. |

## Sequencing judgment

1. **P0 — Trust foundation:** authorization, household roles, canonical artifacts/evidence, privacy controls, verified actions, evaluation harness, and truthful operations.
2. **P1 — Core product:** universal check, Trusted Circle, verified directory, recovery cases, notifications, orientation, consent-aware analytics, and HQ.
3. **P2 — Distribution/monetization:** provider-neutral entitlements, native capture, sponsor/B2B, and governed alert intelligence.
4. **Later, only with evidence:** referrals, streaks, badges, leaderboards, bulk checking, open-ended chat, and community stories.

The governing rule is simple: preserve v1’s learning, not its trust assumptions.
