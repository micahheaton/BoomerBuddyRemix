# Feedback Learning System

Status: **local text-only persistence/repository foundation, shared API registration, local-only web/HQ navigation, an isolated unwired native component, and bounded non-production retention-worker composition implemented; production intake/maintenance, media storage, transcription, email ingestion, deployed proof, and human evidence are not implemented**

Last reviewed: 2026-08-17

Feedback is a customer-safety and product-learning workflow, not an unrestricted inbox. This design defines the minimum object, privacy boundary, review roles, and evidence required before any feedback adapter is enabled. It does not claim that a real customer submitted feedback, that a provider processed media, or that an issue was fixed.

## Supported intake surfaces

The eventual system may accept:

- authenticated web and mobile feedback;
- contextual post-Check, orientation, cancellation, and refund prompts;
- an anonymous web option for non-account-specific product feedback;
- support-case conversion by an explicitly assigned support actor;
- text notes;
- optional audio, screenshot/image, and—only after separate proof—screen recording; and
- `feedback@boomerbuddy.net` inbound mail after the founder provisions and approves the adapter.

No external adapter is enabled merely because this list exists. The repository now has a governed local text object, an owner-global-or-exact-assignee metadata projection, an assigned-only minimized-text reader, and content-free durable job receipts. An owner must explicitly self-claim a non-support record before reading; support conversion remains bound to its current exact case assignment. The reader reruns deterministic minimization, audits the code-owned `feedback_triage` purpose in the same transaction, and refuses unsafe, quarantined, restricted, withdrawn, expired, or erased payloads. The shared API constructs the repository with artifact-encryption and fingerprint key version 1 and registers the feedback routes in every environment so their production guards are exercised. Local development/test navigation exposes selected-household web feedback and role-bounded HQ review; public feedback remains unlinked. The native feedback component is deliberately unwired from the shared app entry until a release-specific module boundary can exclude it from production artifacts. Production public/member/HQ routes render explicit blockers, and production native navigation contains no feedback path or action. A route-mocked local Edge test covers HQ `no-store` requests and clearing opened text on authorization loss; a separate real-`buildApp` integration test covers route registration and durable authenticated intake. Neither is deployed or native-device evidence. File-system web pages render no form in production and explicitly warn against sending data; the API independently refuses production intake. The durable worker composes only `feedback.retention.maintain` outside production and idempotently bootstraps its content-free local job; production composes no feedback handler or job. The API startup/close lifecycle never runs feedback maintenance. The system still has no automated classification/deduplication/drafting handler, media store, malware scanner, transcription provider, or feedback-mailbox adapter.

Code-owned adapter state is explicit:

- authenticated text, anonymous text, and exact-assignee support conversion are `local_only_enabled` at the repository boundary; and
- attachment, audio, image, video, screen recording, inbound email, transcription, and external-model processing are `structurally_disabled`.

The implemented repository has not received real customer content. Focused tests use synthetic local fixtures only.

## Safety boundary

Every intake surface must say:

- do not submit passwords, OTPs, card data, bank credentials, private keys, seed phrases, safe words, or an active emergency;
- feedback is not emergency response, law enforcement, or a substitute for reporting a live financial incident;
- submitting feedback does not automatically create a support case or authorize follow-up;
- account/product linkage and research retention are explicit choices; and
- media is optional and unavailable until its security and deletion path is proved.

The form must not encourage a user to re-upload sensitive scam content merely to provide a product opinion. Existing Check content may be linked only by a server-resolved, purpose-authorized reference; it is never copied into the feedback record or analytics.

## Minimum feedback object

Use a strict, versioned contract. Fields are absent unless required for the selected purpose.

| Field group | Required boundary |
| --- | --- |
| Identity | Feedback ID; authenticated actor and household only when signed in; anonymous mode has no covert account/campaign association |
| Source | Code-owned surface, route/app/build version, locale, device class, schema version |
| Product linkage | Optional code-owned object type and server-resolved ID; explicit linkage consent and current authorization required |
| Classification | Feedback type, severity, safety/accessibility/support flags, duplicate/cluster reference, status, structured reason codes |
| Follow-up | Separate consent/purpose/version, allowed channel class, withdrawal state; no raw destination in the feedback object |
| Research | Separate retention purpose/version, expiration, withdrawal/restriction state; never inferred from product terms |
| Media | Attachment IDs, declared kind, byte size, hash, quarantine/redaction/transcription state, retention deadline; no public URL |
| Ownership | Code-owned queue, unassigned/assigned routing state, current exact assignee when present, escalation state, optimistic version |
| Outcome | Linked issue/experiment/content/support action IDs, structured disposition, close-loop state, reviewer evidence |
| Evidence | Origin interaction ID, correlation ID, immutable state-event lineage, evidence tier, recorded time |

Free text and media remain in encrypted restricted payload storage, not in audit, outbox, job payloads, analytics, search indexes, owner-attention text, or broad HQ projections. A content-free preview must never be reconstructable into the submission.

## State model

The workflow is append-only evidence plus a reconstructable current projection:

`received -> quarantined | minimized -> classified -> assigned -> actioned | no_action -> close_loop_pending -> closed`

Additional terminal or holding states:

- `withdrawn` — participant withdrew the optional research/follow-up purpose;
- `restricted` — privacy restriction blocks ordinary processing;
- `retention_expired` — optional active-store payload/media was removed while required evidence remains truthfully retained; backup/provider disposition is separate;
- `unsafe_unprocessable` — attachment or payload cannot be safely inspected;
- `support_escalated` — assigned support path exists; this does not expose content to unrelated product reviewers; and
- `incident_escalated` — security/safety incident process owns the next action.

State events require actor/service provenance, prior version, structured reason, and idempotency key. Direct UPDATE/DELETE of immutable evidence is rejected. Corrections append superseding evidence rather than rewriting a participant's original submission or reviewer decision.

## Privacy and media intake

### Text

Before persistence or general review, the local repository applies the existing bounded restricted-input minimizer. Raw submitted text is normalized first and any occurrence of a code-owned reserved redaction placeholder (`[PAYMENT_CARD]`, `[AUTH_CREDENTIAL]`, or `[ONE_TIME_CODE]`) causes metadata-only quarantine before minimization; a participant cannot smuggle a pre-redacted-looking value into retained text. Verification of decrypted, already-minimized content is a separate code path that permits those code-owned placeholders but still requires deterministic equality and no new detection/redaction. OTP and payment-card spans are irreversibly replaced before AES-256-GCM encryption. Code-owned explicit credential labels and bare authorization schemes use an all-or-nothing pre-minimizer: the full bounded token is replaced only when its boundary is unambiguous, including supported punctuation, quoted/space-containing values, `password is`, URL-shaped values, and Unicode values. Ambiguous boundaries, private keys, overlapping spans, unsafe structures, and text made unusable by redaction are not retained as ciphertext; only typed detection metadata, a `quarantined_discarded` receipt, and an unassigned narrow privacy/security queue event remain. Database checks allow only code-owned detection classes and integer class counts, preventing those metadata fields from becoming a covert text channel. This metadata-only quarantine is not recoverable content and is not a claim that all secrets were detected.

The local fixture keeps minimized text for exactly one hour when research retention is declined; support conversion is always in that one-hour class. Explicit research retention must match the participant's deadline and is capped by schema at 24 hours from the database-recorded intake time. Deferred database constraints require matching initial consent/record/payload chronology and matching same-transaction erasure evidence before `payload_erased` can commit. Repository deadlines, quota windows, concurrency leases, reads, and purge eligibility use `clock_timestamp()` obtained after the relevant authorization/record locks rather than a caller clock. These are conservative local candidate bounds, not approved production policy. Authenticated consent withdrawal and expiry remove ciphertext and its key-version reference from the active database, set `payload_erased`, and append a truthful erasure event. This is `active_store_ciphertext_erased`, not cryptographic erasure: the shared master key is not a per-record envelope key, and backup/provider/snapshot/cache deletion remains unproved because no deployed storage or backup system was used.

### Attachments

Media stays disabled until all of these exist and pass:

- founder-approved kind/size/count limits and retention purpose;
- direct-to-private-object-store upload with short-lived, single-purpose capability;
- server-side MIME/signature validation, decompression/complexity limits, malware-safe scanning, and image/document parser isolation;
- metadata stripping and safe derivative generation;
- encryption/KMS, tenant/object authorization, immutable upload and scan evidence, and no public bucket/URL;
- quarantine that prevents preview, transcription, download, or provider egress before clearance;
- processor/subprocessor, residency, retention, training, and deletion review;
- export, restriction, legal-hold, deletion, backup reconciliation, and independent restore/delete proof; and
- accessibility alternatives for people who cannot use the selected media path.

An original is not considered deleted merely because a derivative disappeared. Object, database reference, transcription, cache, provider copy, backup, and audit/legal-retention dispositions must reconcile separately.

### Audio and transcription

Audio is opt-in per artifact. The contract must capture recording ownership/rights, people present, transcription purpose, provider-egress choice, and retention. Local/manual transcription is a separate evidence tier from an external provider. A transcript remains customer content and must preserve redaction, access, correction, deletion, and original-audio linkage. Speaker identity, emotion, intent, and fraud truth are not inferred from voice.

### Screen recordings

Screen recording remains unavailable until native/web capture, redaction, file-complexity, background-app notification, keyboard/credential, and deletion risks have an independently reviewed implementation. A generic file upload is not an acceptable substitute.

## Review gauntlet

Distinct roles operate on minimized projections; one role cannot silently confer another's authority.

1. **Intake/transcription** — validates envelope, produces a restricted derivative, and records uncertainty.
2. **Privacy/minimization** — approves or rejects the redacted projection and provider egress.
3. **Support triage** — distinguishes a support need from product research and acts only inside an exact assigned case.
4. **Fraud-quality review** — evaluates possible Check/guidance defects without changing fraud policy.
5. **Accessibility/usability review** — identifies task or assistive-technology blockers.
6. **Product analysis** — classifies preference, repeated pattern, bug hypothesis, pricing objection, or opportunity.
7. **Engineering defect review** — creates a content-free reproducible issue or requests purpose-authorized evidence.
8. **Customer-success review** — manages consented follow-up and close-loop state.
9. **Skeptical review** — attacks overgeneralization, duplication, survivorship bias, unsafe disclosure, and false closure.

The pipeline may eventually transcribe, redact, classify, deduplicate, cluster, summarize, draft internal issues/experiments, and produce content-free Founder Attention candidates after its exact action/data/tool tuple and cumulative budget are approved. The local foundation performs synchronous deterministic text minimization at intake and reruns that minimizer before assigned content disclosure. A governed assignment carries `human_review_required`; this is not an automated classification or deduplication result. The system queues confidential, content-free durable work for redaction verification, classification, deduplication, and internal drafting with receipts that explicitly say `local_processing_not_run`, `provider_processed=false`, and `external_action_executed=false`. No feedback processing worker or provider executes those jobs.

It may not autonomously deploy, alter fraud policy, promise a feature, publish a quote/testimonial, send mass communication, change legal terms, or reveal customer content to unrelated employees or agents.

## Classification rubric

Every disposition chooses one primary class plus typed secondary flags:

- `individual_preference`;
- `repeated_usability_pattern`;
- `confirmed_bug` or `bug_hypothesis`;
- `safety_or_fraud_quality`;
- `accessibility_blocker`;
- `support_request`;
- `pricing_objection`;
- `feature_opportunity`;
- `testimonial_candidate_pending_permission`;
- `research_question`; or
- `out_of_scope_or_unsafe`.

A count is never a severity score. Duplicate clustering retains every source record and uncertainty. A model-generated cluster label is a draft, not evidence that the submissions share a root cause. Safety, authorization, privacy, and accessibility findings bypass popularity ranking.

## HQ projections

The local repository models least-privilege queues for:

- new minimized feedback;
- quarantined/unsafe intake for the narrow privacy/security role;
- severe safety and fraud-quality issues;
- accessibility blockers;
- assigned customers needing consented follow-up;
- repeated themes and duplicate candidates;
- product/engineering hypotheses and proposed experiments; and
- “you told us / we changed” candidates awaiting evidence and customer-specific permission.

Customer and anonymous intake never resolves or requires an internal owner. It atomically records a code-owned unassigned route and content-free jobs, so a missing or suspended owner cannot drop feedback. A safe support conversion alone starts assigned to its exact current support-case assignee; an unsafe support conversion is narrowed into the unassigned privacy/security queue.

Repository queue rows expose IDs, states, coarse classification, routing state, latest-effective consent booleans, content-access flags, and evidence tier—not submitted text. A current active internal owner receives a newest-first content-free global metadata projection capped at 100 rows; delegated reviewer/support access is limited to its latest exact active assignment under the same cap. Metadata flags and assigned-text reads use one code-owned readable-status allowlist. The repository locks the selected records, exact employee assignment and organization, and any exact support assignment, then re-reads latest state and obtains database authority time before projection or disclosure. A code-owned review mutex plus the common lock order keeps revocation and restriction from racing a same-transaction audit/release. Local deterministic race and direct-SQL regressions exist; managed-PostgreSQL contention evidence does not.

Owner-global metadata is not content authority. A current owner may explicitly self-claim a non-support record, which appends an exact assignment and `human_review_required` state. Safe support conversion remains readable only by the same current exact support-case assignment; ending the case assignment removes both metadata and content access. Exact assignees may open only unexpired `encrypted_minimized` payloads whose fresh latest state is `minimized`, `classified`, or `assigned`. `restricted`, `withdrawn`, `retention_expired`, unsafe/quarantined, and erased records remain unreadable even if a stale claim or direct SQL state insertion exists. Before return, the repository decrypts with tenant/resource/field-bound additional data, reruns deterministic restricted-input minimization, refuses any residual detection or transformation, and writes a content-free `feedback.content.read` audit with purpose `feedback_triage` in the same transaction. HQ metadata and content responses set `Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache`, and `Expires: 0`; the client also requests `cache: 'no-store'` and clears opened content on a 401/403. The shared local-only HQ path renders the returned minimized string as escaped React text and is advertised only to owner/reviewer/support roles outside production. Global-owner plaintext browse, reviewer/support global browse, provider output, destinations, and media remain unavailable. Shared routes are composed, but shared-runtime browser evidence is still absent; the browser evidence remains a local route-mocked Edge regression.

## Close the loop

Closing internally is distinct from contacting the customer.

1. Record the issue/decision/remediation and exact release/evidence when applicable.
2. Independently verify the fix or explicit no-action rationale.
3. Recheck current follow-up consent, suppression, channel approval, relationship/case scope, quiet hours, frequency, global stop, cumulative budget, and external-action authority.
4. Create a code-owned, artifact-specific draft; do not promise an unshipped feature.
5. Obtain required human approval and send only through an approved test/live channel.
6. Reconcile acceptance/delivery/failure/unknown; customer contact is not complete merely because a provider accepted it.
7. Record whether the customer acknowledged, declined, withdrew, or could not be reached without altering the original feedback.

Publishing a generalized “you told us / we changed” item additionally requires provenance, aggregation/privacy review, non-identification, editorial approval, and no implied endorsement.

## Retention, privacy requests, and deletion truth

The founder and qualified privacy reviewer must approve exact periods before real intake. Local fixture rules of exactly one hour without research consent or for support conversion, and at most 24 hours with explicit research retention, are not production policy. Deferred constraints reject a retained payload whose initial consent, deadline, record chronology, or same-transaction erase evidence does not match. Defaults remain fail-closed: no optional media; no external transcription; no indefinite raw-payload retention; and automatic active-store ciphertext deletion at the database-authoritative local deadline. Backup, snapshot, cache, object-store, and processor copies require separate reconciliation; none exists in this local candidate.

Anonymous local intake deliberately stores no actor, household, campaign, linked object, raw network address, or network HMAC on the feedback object. The API accepts only the framework-resolved client IP after its configured trusted-proxy boundary; a shared strict parser canonicalizes valid IPv4/IPv6, collapses IPv4-mapped IPv6 into canonical dotted IPv4, and persistence repeats that check before HMAC derivation. Dotted IPv4 and all equivalent mapped forms therefore share one current-network quota and concurrency identity. Global and current-network HMAC quota/concurrency tables are separate and short-lived, with database-authoritative quota-hour and 30-second stale-lease boundaries. After acquisition, the anonymous create transaction locks its exact lease row, verifies and renews it using database time, holds the row lock throughout durable intake, and atomically renews/rechecks ownership immediately before commit. A concurrent acquisition cannot treat the lease as free merely because the original timestamp passes while the owning transaction is still running; failed final renewal rolls the intake back, and exact ID/HMAC cleanup runs in `finally`. The local contract mints no anonymous management credential, so post-submission anonymous correction or withdrawal is unavailable; the bounded automatic expiry and this limitation require explicit disclosure and review before any external anonymous test.

Privacy operations must separately handle:

- account-linked feedback export, correction annotations, restriction, active-store deletion, and separately proved backup/key reconciliation;
- anonymous credential/proof limitations stated at collection time;
- media originals, derivatives, transcripts, thumbnails, caches, provider copies, and backups;
- support/incident/legal evidence whose retention basis differs from optional research content;
- cluster summaries that could retain unique customer details; and
- follow-up consent/suppression, which must survive deletion when required to prevent unwanted contact.

An append-only audit or required suppression record is retained/pseudonymized under its policy; it is not falsely labeled deleted.

## Required adversarial evidence

Before local implementation can be considered complete:

- tenant, actor, purpose, assignment, and exact linked-object authorization negatives;
- anonymous/account association and campaign-attribution non-linkage;
- concurrency, idempotency conflict, state ordering, replay, poison/dead-letter, and restore;
- raw secret/content absence in logs, audit, outbox, jobs, analytics, errors, owner attention, and broad queues;
- redaction bypass and false-positive handling without silently losing the original;
- type/size/count/decompression/parser/malware/quarantine/media-metadata attacks;
- duplicate/cluster separation and no model-summary-as-source behavior;
- support-to-feedback and feedback-to-support least privilege;
- consent withdrawal, suppression, relationship lapse, account offboarding, privacy restriction, and retention expiry races;
- export/delete across database/object/provider/backup layers; and
- keyboard, screen-reader, low-vision, reduced-motion, error recovery, mobile, and slow-network paths.

Evidence tiers stay distinct:

- deterministic fixtures and synthetic media: `local_simulation`;
- approved sandbox provider processing: `provider_test`;
- deployed private intake/object/storage proof: `deployed_staging`;
- consented participant feedback: `real_human_closed_beta`; and
- permitted production intake: `live_production`.

## Founder-only decisions and blockers

Record, without placing secrets in source or prompts:

- feedback owner, support/privacy/security backups, and SLAs;
- allowed intake surfaces and whether anonymous intake is appropriate;
- feedback/research/follow-up consent language and versions;
- text/media/transcript retention and deletion policy;
- managed object storage, KMS, scanning, transcription, inbound-email, and observability providers;
- provider data use/training/residency/subprocessor terms;
- mailbox ownership, MFA/recovery, domain/DNS configuration, and sender/reply policy;
- participant compensation and research/marketing/testimonial separation; and
- launch geography, professional privacy/security review, and incident escalation.

Required environment-variable names are added only with an implemented adapter; no secret name or provider success is invented by this design.

## Local implementation evidence

Focused deterministic evidence currently includes:

- domain and strict-contract tests for source/linkage compatibility, structural adapter disablement, consent shape, and no-effect response truth;
- forward-only migration application through `0020` and direct-SQL immutability, state-ordering, and anonymous-association negatives;
- exact authenticated membership and linked-Check ownership negatives across actor and household boundaries;
- intake continuity with the owner assignment suspended, code-owned unassigned routing, exact support-case assignee conversion, and unrelated-reviewer visibility denial;
- raw reserved-placeholder rejection before minimization plus a separate already-minimized redisclosure verifier; hostile assertions find no submitted placeholder span in ciphertext/plaintext, intake operations, durable jobs, audit, or metadata;
- payment-card and all-or-nothing explicit-credential pre-encryption redaction, including punctuation, quoted/space, `password is`, URL, and Unicode cases, plus ambiguous-credential/private-key metadata-only quarantine; hostile assertions find no submitted credential span in retained payload fields, durable job payloads, or request digests;
- idempotent retry and conflicting-operation rejection;
- strict IPv4/IPv6 canonicalization after trusted-proxy resolution, IPv4-mapped collapse to dotted IPv4, global/current-network anonymous HMAC quotas, and one five-request bucket plus one concurrency identity across dotted/mapped equivalents;
- an immutable singleton acquisition mutex plus database-authoritative lease acquisition and exact row-locked renewal through create completion, including exact TTL, wait, quota-hour rollover, caller-clock skew, a gated create crossing the original TTL, failed-final-renewal rollback, and cleanup regressions, without linking a network HMAC to a feedback identity;
- OTP minimization before encryption and private-key metadata-only quarantine;
- absence of submitted text from durable job payloads and HQ metadata projections;
- authenticated consent-withdrawal, optional linked-object erasure, research-consent expiry, and retention-expiry active-store ciphertext deletion with deferred same-transaction evidence, database-authoritative timing, a hard 24-hour schema ceiling, exact one-hour declined/support retention, immutable evidence, and no backup-erasure claim;
- one shared readable-state allowlist for metadata and content, owner self-claim, exact-assignee minimized-text read, fresh latest-state-after-lock checks, deterministic redisclosure redaction verification, latest-effective consent projection, support-assignment lapse/restriction-race denial, and content-free same-transaction read audit;
- code-owned review mutex plus record-before-employee/support lock ordering, with managed-PostgreSQL contention still unproved; and
- record-before-payload retention locking, removing the withdrawal/expiry lock inversion at the SQL design boundary.

Latest integrated validation on 2026-08-17: 8 focused Vitest files / 55 tests passed, including real-`buildApp` route/adapter/intake/startup-non-purge coverage and exact dev/production worker-composition coverage; domain, contracts, persistence, API, web, HQ, worker, and mobile workspace typechecks plus root TypeScript passed. Final scoped lint/format, build, production-HTML, browser, and secret-scan results are recorded in the Stage 8 author evidence manifest rather than inferred here. One isolated route-mocked local Edge test covers `no-store` requests and clearing opened minimized text after authorization loss. These are local static/deterministic and local-browser-simulation results only. No deployed browser, native-device, managed-PostgreSQL contention, restore, backup deletion, provider, staging, or human evidence is claimed.

The later integrated pre-commit repository suite also passed 50 files / 367 tests, and the
current-tree shared Stage 5–10 independent review returned 0 Critical / 0 High. These remain local
fixture receipts, not external evidence.

All of this evidence is `local_simulation`. No real customer, deployed staging system, provider sandbox, managed PostgreSQL contention run, object store, backup restore, or production environment participated.

## Current disposition

`REMEDIATE` pending managed-PostgreSQL contention, deployed proof, founder decisions, professional review, and external evidence. Independent adversarial review of the integrated local slice and the later shared Stage 5–10 composition both returned 0 Critical / 0 High. The repository now has a shared but local-only text API/UI/retention-worker composition around the unified schema/repository, owner-global-or-exact-assignee metadata query, explicit owner self-claim, and exact-assignee minimized-text renderer. Production intake and feedback maintenance remain fail closed; media, feedback mailbox, transcription, external-model, and completed classification/dedup/draft processing remain unavailable. Active-store ciphertext deletion is not backup or cryptographic erasure. No real customer feedback, audio, image, screen recording, inbound email, real support conversion, cluster, experiment, close-loop message, provider result, or training use was created or claimed.
