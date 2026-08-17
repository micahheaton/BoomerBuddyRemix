# Feedback Learning System

Status: **governed design only; unified intake, media storage, transcription, email ingestion, and HQ feedback queues are not implemented**

Last reviewed: 2026-08-16

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

No adapter is enabled merely because this list exists. The current repository has no governed feedback object, media store, malware scanner, transcription provider, feedback-mailbox adapter, or feedback-specific HQ queue.

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
| Ownership | Current assigned queue/role, service level, escalation state, optimistic version |
| Outcome | Linked issue/experiment/content/support action IDs, structured disposition, close-loop state, reviewer evidence |
| Evidence | Origin interaction ID, correlation ID, immutable state-event lineage, evidence tier, recorded time |

Free text and media remain in encrypted restricted payload storage, not in audit, outbox, job payloads, analytics, search indexes, owner-attention text, or broad HQ projections. A content-free preview must never be reconstructable into the submission.

## State model

The workflow is append-only evidence plus a reconstructable current projection:

`received -> quarantined | minimized -> classified -> assigned -> actioned | no_action -> close_loop_pending -> closed`

Additional terminal or holding states:

- `withdrawn` — participant withdrew the optional research/follow-up purpose;
- `restricted` — privacy restriction blocks ordinary processing;
- `retention_expired` — optional payload/media was physically removed or crypto-erased while required evidence remains truthfully retained;
- `unsafe_unprocessable` — attachment or payload cannot be safely inspected;
- `support_escalated` — assigned support path exists; this does not expose content to unrelated product reviewers; and
- `incident_escalated` — security/safety incident process owns the next action.

State events require actor/service provenance, prior version, structured reason, and idempotency key. Direct UPDATE/DELETE of immutable evidence is rejected. Corrections append superseding evidence rather than rewriting a participant's original submission or reviewer decision.

## Privacy and media intake

### Text

Before general review, a bounded minimization step detects and redacts unnecessary OTPs, payment-card patterns, credentials, private-key/seed material, direct destinations, and other purpose-irrelevant identifiers. Redaction is not a claim that all secrets were found. High-risk or parser-failed payloads remain quarantined for the narrow security/privacy role.

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

The pipeline may transcribe, redact, classify, deduplicate, cluster, summarize, draft internal issues/experiments, and produce content-free Founder Attention candidates after its exact action/data/tool tuple and cumulative budget are approved.

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

The future HQ feedback module needs least-privilege queues for:

- new minimized feedback;
- quarantined/unsafe intake for the narrow privacy/security role;
- severe safety and fraud-quality issues;
- accessibility blockers;
- assigned customers needing consented follow-up;
- repeated themes and duplicate candidates;
- product/engineering hypotheses and proposed experiments; and
- “you told us / we changed” candidates awaiting evidence and customer-specific permission.

Queue rows expose IDs, states, coarse classification, assignment, age/SLA, and evidence availability—not raw content. Opening restricted content requires exact assignment, purpose, current step-up grant, read audit, and content-safe rendering. Reviewer/support global metadata access does not confer feedback access.

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

The founder and qualified privacy reviewer must approve exact periods before real intake. Defaults remain fail-closed: no optional media; no external transcription; the shortest useful text retention; and no indefinite raw-payload retention.

Privacy operations must separately handle:

- account-linked feedback export, correction annotations, restriction, and deletion/crypto-erasure;
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

## Current disposition

`REMEDIATE` for implementation and external proof. The repository currently has no unified feedback runtime, attachment/media boundary, feedback mailbox, transcription provider, or feedback HQ queue. No real customer feedback, audio, image, screen recording, inbound email, support conversion, cluster, experiment, close-loop message, or provider result was created by this document.
