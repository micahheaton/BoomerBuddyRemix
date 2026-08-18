# ADR 0027: Local Editorial Intelligence Evidence Boundary

- Status: Accepted for the Run 3 local candidate
- Date: 2026-08-17

## Context

Stage 9 requires a durable source-governance, provenance, duplicate-resolution, editorial-review,
calendar, preference, and correction foundation. It does not authorize BoomerBuddy to fetch a
source, run an external model, generate customer content, process media, publish, send, or claim
that a local fixture is a current public observation. No provider account, source allowlist review,
isolated fetch/parser boundary, private artifact store, KMS custody, CMS/channel adapter,
test destination, reconciliation path, professional rights/privacy review, or founder activation
evidence exists for those stages.

The earlier Run 2 governed-content tables contain useful metadata, but they permit a `published_at`
shape and do not provide the exact append-only role, assignment, freshness, contradiction,
correction, and preference evidence needed for the Run 3 boundary.

## Decision

Implement a provider-free local core in migration `0022_run3_editorial_intelligence.sql` and
isolated domain, contract, persistence, API-route, and HQ modules:

- version source definitions by a code-owned source key, publisher key, lower-case host, bounded
  path prefix, product scope, jurisdiction, locale, lifecycle, review date, and expiry while storing
  no URL and constraining external fetch to `false`;
- require append-only primary-source, domain, rights, security, and independent owner-final source
  reviews from current internal assignments before a source can back a local artifact receipt;
- retain local-fixture artifact identity receipts and claim provenance as digests, codes, time
  bounds, uncertainty, and exact source links while constraining raw-artifact storage, normalized
  content storage, raw claims, models, providers, and fetches to `false`; bind every claim author to
  the exact current internal employee assignment recorded with that immutable claim version;
- require each claim's recorded and valid-from times to fall no earlier than its exact artifact
  observation and source effective time, bound its validity and expiry to the artifact expiry and
  source review/expiry deadlines, and recheck artifact/source freshness at final approval; accept
  mutation timestamps only from the current database transaction and always evaluate authority
  against a fresh database clock rather than a caller-supplied event time;
- model duplicate, syndication, contradiction, supersession, and corroboration decisions as
  append-only human evidence; reject same-source corroboration, reject duplicate/corroboration
  conflicts in either insertion order, and block approval when both endpoints of a currently
  confirmed duplicate or syndicated pair are linked to the draft;
- store one immutable encrypted local draft version linked to exact source and claim versions;
  require every linked source to authorize the exact product, locale, and jurisdiction and every
  claim to share the draft/source jurisdiction at both aggregate completion and final approval;
  reject raw locators and restricted values before persistence, and never place draft text or
  evidence digests in board, audit, job, or outbox payloads;
- bind each review to the exact immutable assignment event and require that event to remain current,
  together with active internal authority, immutable-body digest, complete current prerequisite
  approvals, source and claim freshness, no contradiction, no unsupported statistics or unverified
  urgency, and separate skeptical/final actors for `approved_internal`; withdrawal and reassignment
  of the same employee therefore cannot revive an earlier approval;
- expose only owner-global or exact-assignee metadata for source health, review queues, internal
  calendar, correction lineage, and local preference counts; draft text has a separate exact-current
  assignment repository read with a same-transaction audit, but no API route because the required
  step-up grant has not been implemented;
- require a correction replacement to be the latest approved version with the same product,
  audience, locale, and jurisdiction and with current source, claim, review, and final-assignment
  evidence; make correction, calendar, assignment, review, content-state, and local preference
  evidence append-only and database-time ordered; withdrawal remains a new event and never erases
  prior evidence;
- constrain publication, outbound delivery, external actions, provider processing, external models,
  generation, transcription, and preference delivery to `false`; define no published or sent state;
- add no editorial durable-job type, outbox event, worker handler, fetch client, provider adapter,
  public route, mutation route, publisher, sender, or destination field; and
- hard-disable the older `governed_content_items.published_at` field with a new database constraint
  so the legacy table cannot bypass the bounded Run 3 model.

The isolated `GET /v1/hq/editorial` route is nonproduction-only, authenticated to the HQ audience,
private/no-store, contract-strict, and metadata-only. The isolated HQ page renders the same five
local queues without action controls. Shared API composition now registers this route and shared HQ
navigation links the page only outside production for owner/reviewer identities. The route itself
still returns unavailable before repository access in production; this is local integration
evidence, not deployed or production activation evidence.

## Consequences

The repository can prove locally that source and editorial evidence is immutable, role scoped,
product/locale/jurisdiction bound, artifact/source-authority bounded, duplicate aware, correction
preserving, preference suppressible, and incapable of creating an external action. A local source
approval proves only that seeded internal identities recorded local review events for a host/path
metadata fixture. A local artifact receipt proves only that code recorded supplied digests; it is
not evidence that the artifact was fetched, authentic, malware scanned, parsed, rights cleared, or
current. An `approved_internal` draft is neither publication eligibility nor human approval
evidence from a real person.

The current encrypted draft uses repository-supplied local key material and does not prove managed
KMS custody, backup deletion, processor deletion, disaster recovery, or production access control.
PGlite migration and transaction tests do not prove managed-PostgreSQL concurrency, restoration,
or deployed behavior. Local fixture preferences are not messaging consent and enable no delivery.

Authentic source-health, provider-test, deployed-staging, independent human-review, publication,
delivery, analytics, correction-drill, and production claims remain blocked. Adding any external
stage requires a later ADR and the exact founder, privacy/rights, provider, budget, destination,
reconciliation, recovery, and rollback evidence for that stage.
