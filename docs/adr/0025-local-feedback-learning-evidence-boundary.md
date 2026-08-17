# ADR 0025: Local Feedback Learning Evidence Boundary

- Status: Accepted for the Run 3 local candidate
- Date: 2026-08-17

## Context

Run 3 needs a useful feedback foundation without turning customer voice into an unrestricted inbox, broad HQ content feed, provider-training corpus, or implied permission to contact a person. The repository already has tenant-bound AES-256-GCM encryption, keyed fingerprints, typed restricted-input minimization, durable jobs, internal employee assignments, and append-only audit patterns. Object storage, media quarantine/scanning, transcription, inbound email, managed KMS, production identity, and provider review remain founder/external gates.

## Decision

Implement a local-only, text-only feedback evidence boundary in migration `0020_run3_feedback_learning.sql` and the feedback domain, contracts, and repository:

- authenticate account-linked intake against an active exact household membership;
- keep anonymous records free of household, actor, campaign, network, and linked-object association;
- accept anonymous network authority only from the framework-resolved address after the configured trusted-proxy boundary, strictly canonicalize and validate IPv4/IPv6 in both route and repository layers, collapse IPv4-mapped IPv6 into dotted IPv4, and control abuse with separate global and canonical-current-network HMAC quota buckets plus an immutable singleton acquisition mutex and ephemeral concurrency leases that cannot join to a feedback record;
- allow post-Check, orientation, cancellation, and refund linkage only with explicit linkage consent and current exact actor/tenant authority;
- allow support conversion only for the current exact internal support-case assignee, without granting another reviewer visibility;
- reject every code-owned reserved redaction placeholder found in normalized raw submitted text into typed metadata-only quarantine before minimization; use a separate verifier for decrypted already-minimized content so participant input cannot impersonate a trusted redaction;
- minimize bounded text synchronously before persistence, using an all-or-nothing explicit-credential pre-minimizer that replaces the complete bounded value only at an unambiguous boundary and otherwise discards the payload into typed metadata-only quarantine; encrypt only the minimized result with tenant/resource/field-bound additional data;
- treat follow-up, research retention, and object linkage as separate append-only consent purposes, with no raw destination in feedback storage;
- model current workflow through immutable state, consent, routing/assignment, processing, and erasure evidence rather than mutable evidence rows;
- record authenticated and anonymous customer intake as code-owned unassigned routing without resolving or requiring an internal owner; a safe support conversion alone starts with its current exact support-case assignment;
- expose owner-global or exact-current-assignee content-free HQ metadata, while allowing minimized text only after a current internal owner explicitly self-claims a non-support record or an exact support assignee retains the current case assignment;
- serialize review authorization with a code-owned mutex, lock the selected feedback records before employee/organization authority, keep exact organization and support case/assignment locks through projection or content-read audit, and re-read latest state after those locks before returning;
- use one code-owned content-readable status allowlist for both metadata flags and assigned-text reads, denying `restricted`, `withdrawn`, `retention_expired`, unsafe/quarantined, and erased payloads even after a stale claim or direct state insertion;
- deterministically rerun the restricted-input minimizer before an exact-assignee read, render only the verified minimized string as escaped text, audit the code-owned `feedback_triage` purpose in the same transaction, and never return unsafe, quarantined, expired, or erased payloads;
- mark governed assignments `human_review_required`; this is not a model classification, duplicate decision, close-loop contact, or provider result;
- enqueue confidential, content-free local jobs for redaction verification, classification, deduplication, and internal drafting, while recording `local_processing_not_run`, `provider_processed=false`, and `external_action_executed=false` until an actual bounded worker completes a later reviewed protocol;
- use database `clock_timestamp()` obtained after the relevant locks for quota windows, leases, authorization deadlines, reads, and purge eligibility rather than trusting a caller clock;
- after anonymous lease acquisition, lock and verify the exact ID/HMAC lease row inside the durable intake transaction, renew it while holding that row lock, retain the lock through all intake writes, and atomically renew/recheck ownership before commit; roll back the intake on failed renewal and perform exact cleanup in `finally`;
- enforce an exact one-hour local operational text lifetime without research consent and for every support conversion, and a matching participant-selected lifetime capped by schema at 24 hours for the local research fixture;
- erase ciphertext and its key-version reference from the active database on authenticated consent withdrawal or retention expiry, record the payload state as `payload_erased`, require matching same-transaction append-only erasure evidence through a deferred constraint, erase an optional linked-object identifier when its purpose is withdrawn, and retain truthful append-only consent/erasure evidence;
- acquire retention locks in record-then-payload order so participant withdrawal and scheduled expiry do not invert PostgreSQL locks; and
- keep attachment, audio, image, video, screen-recording, inbound-email, transcription, and external-model adapters structurally disabled.

The one-hour/24-hour limits are fail-closed local candidate ceilings, not a production retention policy or professional approval. Anonymous intake currently mints no management credential; its withdrawal limitation and bounded automatic expiry must be disclosed before any external test. Production activation remains blocked until the founder and qualified reviewers approve exact consent language, retention, geography, ownership, storage/KMS, incident handling, and provider terms.

## Consequences

The local repository can prove schema, encryption, submitted-placeholder quarantine, minimization, idempotency, authorization, mapped-address canonical-network quota/lease handling, row-locked lease renewal through durable intake, owner-independent intake routing, exact support assignment, assigned-only minimized-text review, database-authoritative local deadlines, and active-store ciphertext deletion without contacting a provider or a real person. IDs and structured metadata may enter confidential jobs; feedback text, ciphertext, fingerprints, destinations, and network HMACs do not.

Queued local jobs are not evidence that feedback was classified, deduplicated, clustered, summarized, drafted into an issue, or acted on. Owner-global metadata is not content authorization. The local review path requires explicit owner self-claim or the current exact support assignment, locks and revalidates current authority/latest state, performs deterministic redaction verification, returns only minimized text, and records a same-transaction read audit. HQ metadata/content responses carry private no-store and legacy cache-prevention headers; the client requests `cache: 'no-store'` and clears opened content on 401/403. The shared API now registers every feedback route and constructs the repository with artifact-encryption and fingerprint key version 1; production route guards remain authoritative, and API startup/close never invokes feedback retention or erasure. Shared local navigation is limited to owner/reviewer/support HQ roles, a selected household on member web, and the `__DEV__` native stack; public feedback remains unlinked and production navigation remains absent. The durable worker installs only `feedback.retention.maintain` and one idempotent content-free bootstrap outside production; production installs/enqueues no feedback work, and redaction/classification/deduplication/drafting handlers remain unregistered. Real-`buildApp` and worker-composition tests are local simulation. The only browser evidence remains an isolated route-mocked local Edge regression, not a deployed flow.

The shared master encryption key is not a per-record envelope key. Nulling active-store ciphertext and its key-version reference does not destroy backup copies, processor copies, snapshots, caches, or a recoverable master key. Backup/processor reconciliation, independent restore/delete proof, and any future cryptographic-erasure claim remain external gates.

Fresh-install and forward-upgrade fixtures apply the deferred retention and erasure constraints under local PGlite and exercise commit-time rejection. This does not establish managed PostgreSQL lock behavior, operational restore behavior, or portability across a founder-selected managed database until those exact environments are tested.

No production readiness, human validation, managed-PostgreSQL concurrency proof, managed-storage proof, provider processing, outbound follow-up, issue creation, model training, media handling, restoration, or deletion-from-backups claim follows from this decision.
