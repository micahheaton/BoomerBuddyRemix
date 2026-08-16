# BoomerBuddy v1 Autopsy

## Scope and evidence standard

This is a read-only audit of the 196 tracked files under `reference/boomerbuddy-v1/BoomerBuddy/` (called **v1** below), including 143 Git commits. The physical tree also contains 744 untracked `.local/` files: cached Replit skills, binary agent state, artifact templates, and workflow logs. They are workspace/tooling residue, not tracked application source, and are excluded from product counts. Paths are relative to the v1 root. **Evidence** describes code or content that exists. **Assessment** is a product, safety, security, or engineering judgment; it is not evidence that a feature worked in production. No v1 file was modified and no production-readiness claims in `replit.md` were accepted without implementation evidence.

## Executive verdict

V1 is a broad, useful prototype and requirements mine: a React/Vite PWA, Express API, 40-table Postgres schema, 41 client routes, 130 Express route declarations, six analysis inputs, alerts, learning, safety tools, Stripe billing, and admin screens. It is **not a safe foundation for 2.0**. Critical authorization failures expose private analyses and allow self-promotion to admin; the PWA caches authenticated API data; fraud decisions are largely an ungrounded LLM opinion; several integrations report success when they only log; and marketing and privacy statements conflict with implementation.

### Highest-severity liabilities

| Severity | Evidence | Assessment |
|---|---|---|
| Critical | Unauthenticated `PATCH /api/users/:id` passes the unvalidated body to `storage.updateUser`; its `Partial<InsertUser>` includes `isAdmin` (`server/routes.ts:129-149`, `server/storage.ts:360-366`, `shared/schema.ts:20-63,697-703`). `requireAdmin` then trusts the stored field (`server/replitAuth.ts`). | Any logged-in user can PATCH their known user ID with `{"isAdmin":true}` and then satisfy the admin check. Public `POST /api/users` also accepts the insert schema containing `isAdmin`. Remove both contracts and treat v1 authorization as compromised. |
| Critical | `GET /api/analyses` returns recent analyses globally when `userId` is absent, and `GET /api/analyses/:id` is public (`server/routes.ts:588-608`, `server/storage.ts:378-391`). Records include submitted text and transcripts (`shared/schema.ts:65-83`). | Direct disclosure of highly sensitive scam, financial, and family communications. |
| High | Quick Share loads an arbitrary analysis by `resourceId` without checking ownership before emailing/SMSing it (`server/routes.ts:3312-3451`). Chat deletion removes messages before confirming conversation ownership (`server/storage.ts:1859-1867`). | Cross-user disclosure and destructive IDORs remain even after login. |
| High | The service worker caches every successful `/api/` response in a shared cache (`client/public/sw.js:1-102`). | Authenticated responses can survive logout, become stale, and be served to another account on the device. |
| High | Home publishes a `4.8` rating from `1,250`, “10,000+ families,” named testimonials, and unsourced loss statistics (`client/src/pages/Home.tsx:57-86,124,187-207,380-417`). Seed data contains ten synthetic community stories (`server/seedSuccessStories.ts:26-137`). | Fabricated or unsubstantiated trust proof is a consumer-protection and brand liability, especially for a safety product. |
| High | SMS/email fallbacks log recipients and messages yet record them as sent (`server/smsService.ts`, `server/emailService.ts:356-398`). Emergency notification only logs a TODO and returns success (`server/routes.ts:1274-1341`); Contact logs the full message and promises a response (`server/routes.ts:2485-2511`). | Users can believe help was delivered when it was not; logs may expose PII. |
| High | Analytics treats no consent choice as consent (`client/src/lib/analytics.ts:22-39`), while the policy says tracking follows “Accept All” (`client/src/pages/PrivacyPolicy.tsx:78-98`). UTM middleware independently records campaign, agent, referrer, and partial IP (`server/middleware/utmTracking.ts:57-138`). | Consent, disclosure, and retention behavior do not match the privacy promise. |

## Repository and architecture inventory

- `client/src/`: React, TypeScript, TanStack Query, Wouter, Tailwind, Radix/shadcn UI. Screens live in `pages/`; reusable UI in `components/`; game data in `data/games/`; browser PDF and analytics helpers in `lib/`.
- `client/public/`: manifest, service worker, icons, sitemap, and robots files.
- `server/`: one Express process containing routes, storage, analysis, alerts, notifications, billing, PDF generation, seeds, and in-process schedules.
- `shared/schema.ts`: 40 Drizzle tables plus insert/select schemas and relations.
- `docs/iOS_Development_Brief.md`: a 2,136-line native-app proposal, not an implementation.
- `attached_assets/`, `design_guidelines.md`, `replit.md`, `.replit`: visual/build history, aspirational guidance, and Replit-specific configuration.
- `.local/` and `.git/`: untracked tool/agent state and repository history, respectively. Neither is deployable product IP; do not migrate `.local/` into 2.0.

The runtime is tightly coupled to Replit OIDC and AI Integrations, Neon/Postgres, Stripe, SendGrid, and Twilio (`server/replitAuth.ts`, `server/openai.ts`, `server/routes.ts`, `server/emailService.ts`, `server/smsService.ts`). There is no native code, CI workflow, container/IaC definition, or durable worker process.

## Pages, routes, and journeys

`client/src/App.tsx:60-165` registers 41 routes backed by 42 page files; only 15 routes are wrapped by `ProtectedRoute`.

| Surface | Registered routes / implementation |
|---|---|
| Entry | `/`, `/welcome`, `/dashboard`, `/offline`; Home, four-step Welcome, Dashboard, Offline. |
| Check | `/analyze/text`, `/image`, `/transcript`, `/audio`, `/url`, `/bulk`, `/analysis/result`, `/history`, `/samples`. URL and bulk are gated; several other analyzers are not. |
| Intelligence and learning | `/alerts`, `/heatmap`, `/learn`, `/games`, `/badges`, `/progress-dashboard`; six games under `client/src/pages/games/`. |
| Safety and recovery | `/emergency-contacts`, `/safe-contacts`, `/report-generator`, `/chat-assistant`. |
| Content/community | `/success-stories`, `/videos`, `/printable-guides`, `/referrals`. |
| Commercial/account | `/pricing`, `/account`. |
| Trust/support | `/about`, `/support`, `/privacy`, `/terms`, `/contact`. |
| Admin | `/admin/dashboard`, `/monitoring`, `/users`, `/safe-contacts`, `/success-stories`, `/videos`, `/printable-guides`. Router-level protection is inconsistent; APIs rely on `requireAdmin`. |

The intended journeys are visible but frequently incomplete:

1. **Acquire and orient:** Home CTA -> Welcome -> Dashboard. Welcome collects first name, state, eight concern topics, and four contact channels (`client/src/pages/Welcome.tsx:15-50,109-308`). The anonymous CTA is broken because Welcome posts an authenticated onboarding endpoint and no first-login redirect uses `hasCompletedOnboarding` (`Home.tsx:129-137,432-439`; `Welcome.tsx:72-94`; `server/routes.ts:154`). It is not a household, payer, protected-person, consent, or Trusted Circle orientation.
2. **Check suspicious material:** choose an artifact -> submit -> LLM/OCR/transcription -> Safe/Caution/Danger result -> local PDF, notify, share, or start a report (`AnalysisResult.tsx:151-342`).
3. **Monitor:** browse/filter alerts or a 50-state button matrix -> open the external source -> optionally receive email/SMS (`Alerts.tsx`, `Heatmap.tsx`). Heatmap query links are ignored by Alerts.
4. **Learn:** take a 15-question assessment -> receive recommended tracks -> play games -> earn badges/streaks. Learning start buttons have no handlers; several badge conditions reference nonexistent fields (`client/src/pages/Learn.tsx:644-650,894-900`; `server/badgeService.ts`).
5. **Protect/recover:** manage emergency contacts, browse an “official” directory, produce a report packet, or chat. Contacts are one-way recipients, not permissioned collaborators.
6. **Pay/refer/share:** Stripe checkout/portal, copy a referral link, or Quick Share. Referral attribution is never created from `?ref=` and multiple client mutations reverse the `apiRequest(method, url, data)` arguments (`client/src/lib/queryClient.ts:10-24`).

## API and data model

`server/routes.ts` declares 127 endpoints and `server/replitAuth.ts` three more. Route families include authentication/onboarding/preferences; six analyzers and history; alerts/sources; education/quizzes/games/badges/streaks; emergency and safe contacts; chat; reports/PDF; content; referrals/shares; Stripe; analytics/UTM/feature flags; and admin user/content/source operations.

Many mutators are public: user read/update, alert creation/aggregation, educational resources, quiz questions/results, and sample scams (`server/routes.ts:119-149,991-1133,1253-1271`). `GET /api/alerts` is declared twice (`server/routes.ts:991` and `:2190`), so the later behavior is unreachable. Premium video/guide data is public even when the client hides it. There is no coherent resource-ownership middleware or tenant boundary.

The 40 tables in `shared/schema.ts` are:

> `sessions`, `users`, `scamAnalyses`, `scamAlerts`, `alertNotifications`, `educationalResources`, `quizQuestions`, `userQuizResults`, `sampleScams`, `subscriptionPlans`, `subscriptions`, `paymentHistory`, `usageTracking`, `notificationLogs`, `analyticsEvents`, `utmCampaigns`, `conversions`, `featureFlags`, `emergencyContacts`, `gameScores`, `referrals`, `referralRewards`, `scamTypes`, `learningTracks`, `vulnerabilityProfiles`, `assessmentAnswers`, `learningTrackProgress`, `chatConversations`, `chatMessages`, `bulkAnalyses`, `urlAnalyses`, `badges`, `userBadges`, `dailyStreaks`, `successStories`, `videoContent`, `safeContacts`, `scamReports`, `printableGuides`, `shares`.

**Evidence:** this is a single-user schema; `users` mixes identity, vulnerability, preferences, admin, referral, locale, and Stripe state. Statuses are usually free-form text, uniqueness/indexing is sparse, and no retention/cascade model is evident. **Assessment:** it cannot represent household roles, payer versus protected person, sponsor entitlements, granular Trusted Circle permissions, consent proofs, fraud evidence/signals, provider runs, model/prompt versions, human review, incidents/recovery, audit events, or durable jobs.

## Fraud analysis, prompts, and artifact types

| Artifact | Evidence | Assessment |
|---|---|---|
| Text | `SCAM_ANALYSIS_PROMPT` lists seven patterns and asks GPT-5 for JSON; untrusted text is concatenated directly (`server/scamAnalysisService.ts:14-95`). | LLM-only classification has no deterministic signals, citations, calibration, prompt-injection boundary, or evaluation gate. JSON is parsed but not schema-validated. |
| Image | English Tesseract OCR, then the text prompt (`scamAnalysisService.ts:99-150`); a truncated base64 prefix is stored (`server/routes.ts:420`). | No vision, QR, metadata, homograph, or structured entity pipeline; lifecycle/retention is unclear. |
| Transcript | The same prompt analyzes pasted transcript (`scamAnalysisService.ts:152-203`). | No source provenance, speaker structure, or call-specific signals. |
| Audio | Whisper-1 English transcription, then text analysis (`scamAnalysisService.ts:205-230`). | No recording consent flow, deepfake/voice signals, multilingual policy, or explicit deletion proof. |
| URL | A prompt judges the URL string after `new URL()` (`scamAnalysisService.ts:240-316`). | No redirect, DNS/TLS, domain-age, reputation, page, homograph, brand, or safe-destination verification; HTTPS can create false assurance. |
| Bulk | Client submits multiple items and records `bulkAnalyses`. | Gated UI calls nonexistent `/api/subscriptions/me` instead of `/current` (`client/src/pages/AnalyzeBulk.tsx:51-56`); it multiplies an unsafe decision pipeline. |
| Chat | Route uses `model: "gpt-4"` (`server/routes.ts:1511-1521`). | No retrieval, safety policy, grounding, or escalation contract. |

On provider or parse failure, analysis returns a normal-looking Caution/50 “Analysis Error,” which can be persisted as a result (`scamAnalysisService.ts:80-95`). No stored decision provenance identifies model version, prompt version, evidence source, provider latency/cost, reviewer, or appeal. This is the largest product-safety gap.

## Alerts, sources, taxonomy, and content

**Alerts.** `server/stateSourcesConfig.ts` configures 200 enabled state sources: AG/agency, Google News RSS, BBB, and AARP for each state. `server/alertAggregationService.ts:562-680` adds 13 federal/national feeds, for 213 configured inputs. Generic RSS/HTML scraping, keyword matching, urgency-based severity, and title-token deduplication feed alerts (`alertAggregationService.ts:26-370`). Federal state extraction recognizes only a subset of states; generic scrape timestamps can be “now”; per-source failures do not make the run fail.

Aggregation is triggered both by an interval in `server/index.ts` and cron in `server/scheduledTasks.ts`, with no distributed lock, idempotent job record, or queue. A public aggregation endpoint can fan out 213 network operations. **Assessment:** the URL registry is valuable discovery research, but every source needs authority, license/terms, ownership, freshness, parser, and quality validation before reuse.

**Taxonomy and learning.** `server/seedData/scamTypes.ts` contains 50 scam types in eight actual categories, each with tactics, red flags, examples, tips, severity, and prevalence. There are 15 learning tracks and 15 assessment questions (`server/seedData/learningTracks.ts`, `assessmentQuestions.ts`). UI taxonomies diverge; Learn lists nonexistent categories and omits actual ones (`client/src/pages/Learn.tsx:695-703`). Severity/prevalence and the “vulnerability” score are unsourced; the score uses a rough denominator (`server/routes.ts:2565-2568`). Keep the themes, not the claims.

**Games and badges.** Six games provide reusable interaction prototypes and JSON scenario sets under `client/src/data/games/`. There are 24 seeded badges (`server/seedBadges.ts`), but badge code checks nonexistent fields and hard-codes some conditions false (`server/badgeService.ts`). Client-submitted scores are not trustworthy. Streak UI exists but is not imported. Leaderboards, streak pressure, and “vulnerability” framing require research for an older-adult safety context.

**Directory and media.** `server/seedSafeContacts.ts` holds 44 government, bank, utility, and insurance contacts. `verifiedAt` defaults to creation time without verifier, evidence, jurisdiction, or review expiry. Sixteen external videos, eleven generated guides, and ten synthetic success stories live in seed files. An attached screenshot records an unavailable YouTube embed. Verify phone numbers, URLs, licenses, captions, claims, and ownership; delete synthetic testimony.

## Contacts, reports, orientation, and notifications

- Emergency contacts support CRUD and alerting, but have no invite acceptance, relationship role, scoped permission, consent proof, escalation tree, safe word, or audit history (`shared/schema.ts:291-302`; `server/routes.ts:1274-1341`).
- Scam reports structure incident details and target FTC, FBI IC3, state AG, or police. They do not file externally. PDFs are written under `/tmp/reports` and the database stores a local path (`server/pdfService.ts:168-179`), so they disappear or split across instances. Evidence is an arbitrary string array.
- Welcome is the only orientation. It does not establish the person being protected, payer/sponsor, household, Trusted Circle, emergency readiness, notification consent, install/share setup, or a practiced safety plan.
- SendGrid and Twilio integrations are real code paths, but HTML templates interpolate personal, scraped, or model text without systematic escaping. There are no delivery callbacks, bounce/complaint/STOP flows, quiet hours, phone verification, consent ledger, or push-token provider. Some English/Spanish templates exist, but schedules use server rather than user timezone.

## Subscriptions, referrals, analytics, and admin

**Stripe.** V1 seeds Free (five analyses/month) and Premium ($4.95/month), and exposes checkout, portal, cancel, payment history, and webhook routes (`server/index.ts`, `server/routes.ts:1571-1965`). Price copy also says $9.99 in Contact and Terms (`client/src/pages/Contact.tsx:258`; `TermsOfService.tsx:87,132`). There is no annual/family/B2B, seats, household entitlement, App Store/Play billing, reconciliation, refunds/disputes, or webhook-event idempotency. Subscription update handling expects metadata that may be absent; code repeatedly reads `subscription.subscription?.status` although storage returns `{...subscription, plan}` (`server/storage.ts:954-974`). Quick Share treats the mere presence of `stripeCustomerId` as premium (`server/routes.ts:3334`).

**Referrals.** UI and storage expose codes, links, rewards, and history (`client/src/pages/Referrals.tsx`, `server/referralService.ts`), but no code consumes `?ref=` to create the relationship. “Extra analysis” rewards are ignored by usage checking (`server/storage.ts:1068-1085`), and premium reward logic records the wrong type. Treat as a concept only.

**Analytics.** Client events cover page, feature, auth, conversion, analysis, and subscription actions (`client/src/lib/analytics.ts:75-223`); server tables add campaigns and conversions. There is no validated north-star definition, household funnel, fraud outcome/appeal, support, provider quality/cost, or consent-safe event contract. Cleanup methods exist but repository-wide search found no scheduler invocation.

**Admin.** Seven pages cover acquisition/user analytics, roles, source health/CSV, and story/contact/video/guide CRUD (`client/src/pages/admin/`). This is a prototype admin console, not HQ: there are no fraud-review queues, evidence traces, incident/recovery cases, support cases, consent/audit tools, source approvals, provider/evaluation controls, job replay, partner management, or least-privilege roles. Admin “audit” is console output only.

## PWA, mobile, localization, and accessibility

The manifest, install prompt, offline page, Apple meta tags, icons, and production service-worker registration are implemented (`client/public/manifest.json`, `client/src/App.tsx:169-183`, `client/src/components/InstallPrompt.tsx`). Background sync merely logs (`client/public/sw.js:94-102`); there is no push, OS share target, extension, durable offline queue, or per-user cache boundary. Both declared 192px and 512px icons are identical 1024px files and need proper exports.

`docs/iOS_Development_Brief.md` proposes SwiftUI, Keychain, SwiftData/Core Data, AVFoundation, push, accessibility, and offline support, but the repository contains zero `.swift` files and its base URL is a fixed Replit host. Preserve it only as requirements history.

English and Spanish locale files mirror about 170 keys (`client/src/locales/`), yet only shell/auth copy calls `t()`; pages, games, PDFs, content, and most server output remain English. Accessibility guidance calls for 18px type, 60px controls, plain language, high contrast, and minimal motion (`design_guidelines.md`), and some CSS honors it (`client/src/index.css:250-285`). The same guide prohibits interaction/layout patterns used throughout. No automated or manual accessibility evidence supports the “WCAG AAA” claim.

## Auth, privacy, testing, secrets, and operations

**Auth/security.** Replit OIDC is the sole identity path; Postgres sessions last seven days and contain provider tokens (`server/replitAuth.ts`). Cookies are HTTP-only and secure but no explicit SameSite policy, CSRF defense, global rate limit, CSP/Helmet headers, durable admin audit, or systematic object authorization is evident. `server/index.ts` logs API response bodies, risking sensitive fragments. The only migration is `server/migrations/add_alert_metrics.sql`; full schema history, backup/restore, and deletion cascades are absent.

**Privacy.** The policy says users can access/export/delete and specifies retention (`client/src/pages/PrivacyPolicy.tsx:150-192`), but there is no account export/delete flow or retention worker. It claims OpenAI does not store data while the actual Replit AI intermediary and other processors are omitted. It promises “bank-level encryption” in SEO copy without an application-level control. Raw text and transcripts can persist; logs and the PWA add uncontrolled copies.

**Tests.** `server/__tests__/alerts.test.ts` is the only test file. It recreates alert routes in a separate Express app rather than registering production routes, so it misses the duplicate/unreachable handler. One “should return 400” case expects 200. There are no authorization/tenant, billing/webhook, prompt/evaluation, privacy, PWA, browser/E2E, or accessibility tests; coverage has no threshold; there is no lint/formatter script; tests are excluded from TypeScript checking.

**Secrets/configuration.** A non-value signature scan of all 143 commits and the untracked `.local/` tree found no `.env`, private-key file, or credential-shaped value matching common OpenAI, Stripe, SendGrid, AWS, Postgres URL, or private-key patterns. This is bounded evidence, not proof of absence; binary agent-state files were not decoded. The code expects database, session, Replit, AI, Stripe, SendGrid, and Twilio secrets, but there is no `.env.example`, typed startup validation, documented rotation, or secret-scanning CI; `.gitignore` does not explicitly ignore `.env`. Never reuse any historic credential without rotation.

**Operations.** One Replit-oriented process serves UI/API, seeds or mutates data at startup, crawls sources, and sends scheduled notifications. In-process interval plus cron creates multi-instance duplication risk. There is no health/readiness contract, durable queue, distributed lock, structured observability, SLO/on-call, disaster recovery, release pipeline, feature migration discipline, or support case system. Hard-coded `boomerbuddy.com` links and sender/support addresses conflict with the current `boomerbuddy.net` direction.

## Reusable assets versus conclusion

Reusable **inputs** are the 50-type taxonomy, learning/question/game scenarios, 213-source candidate registry, 44-contact candidate directory, notification/report form concepts, accessible/plain-language principles, shield/icon master, and the iOS brief as requirements history. Each requires provenance, safety, rights, freshness, and accessibility review.

The reusable asset is product learning—not the runtime, schema, API contract, security model, scoring, or production claims. Build 2.0 from a new threat model and canonical household/fraud-evidence architecture; do not incrementally harden this prototype into the system of record.
