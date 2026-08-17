# Editorial Intelligence Board

Status: **provider-free local governance and HQ-queue foundations implemented; external ingestion, generation, publication, sending, and authentic source-health evidence are not implemented**

Last reviewed: 2026-08-17

BoomerBuddy may eventually provide ongoing fraud-safety value between Checks, but an LLM summary, viral post, search result, or provider response is never source truth. This design extends the repository's governed source/content and knowledge-asset metadata into a provenance-first review system. It does not authorize fetching, publishing, emailing, texting, pushing, or claiming that any alert is current.

Current local truth is documented in the Run 2 [content-engine report](../run-2/14-content-engine.md): source and claim-control metadata plus draft knowledge assets exist; generation, media processing, CMS publishing, and distribution do not. The source-verified seed drafts remain ineligible for runtime use until their independent domain and rights reviews activate a new version.

Run 3 now also has a bounded local implementation in migration
`0022_run3_editorial_intelligence.sql` and isolated editorial domain, contract, persistence, API,
and HQ modules. It records append-only source reviews, digest-only local artifact receipts and
artifact/source-authority-bounded claims, duplicate/syndication/corroboration decisions, encrypted
immutable draft versions, exact product/locale/jurisdiction provenance, review assignments and
approvals, internal calendar entries, local preference withdrawal, and correction lineage. All
artifact, claim, draft, and append-only event times are bound to the current database transaction
while freshness is evaluated against the database clock. Claims retain the exact author assignment;
reviews retain the exact assignment
event so withdrawal/reassignment cannot revive an approval; duplicate conflicts are order
independent; and correction replacements must preserve scope and current approval evidence. All
records are `local_simulation`; database constraints keep fetch, model, provider, publication,
outbound delivery, and external-action flags false. The contract-strict HQ board is content-free
and owner-global or exact-assignee scoped. Shared API composition registers the metadata route, and
shared HQ navigation links the page for owner/reviewer identities only outside production. The
route refuses production before repository access. There is deliberately no draft-content API until
a current step-up grant can be enforced. No worker handler, durable job, outbox event, destination,
public route, fetch client, provider adapter, publisher, or sender was added.

## Products in scope

The same governed evidence may support separately reviewed outputs:

- urgent scam alert;
- Today's Safety Tip;
- weekly BoomerBuddy Brief;
- family discussion prompt;
- recovery guidance;
- learning-module update;
- founder video brief or script;
- SEO/blog draft;
- credit-union/partner bulletin; and
- an internal support/fraud-review brief.

Approval is product-specific. A source approved for an internal brief is not automatically approved for a customer alert, public article, partner bulletin, search claim, or outbound message. No product is enabled merely because it appears in this list.

## Pipeline and state boundaries

Keep these stages distinct and durable:

1. source registry and governance;
2. authorized fetch/ingest;
3. provenance capture;
4. normalization;
5. duplicate/event-family resolution;
6. scam-pattern extraction;
7. corroboration and contradiction search;
8. fraud/safety analysis;
9. product-specific editorial draft;
10. skeptical/anti-alarmism review;
11. accessibility, privacy, rights, and policy review;
12. final human approval;
13. staged publication or bounded test delivery;
14. analytics and customer-response evidence; and
15. correction, retraction, expiry, and archive.

Every transition records a prior version, code-owned reason, actor/service, evidence tier, and correlation. Draft, approved, published, corrected, retracted, expired, and archived are different states. “Approved” is not “published”; “provider accepted” is not “delivered”; “published” is not “read”; “clicked” is not “protected”; and none proves harm prevented.

## Source registry

Every source definition is code/data-governed and versioned. Minimum fields:

- stable source key, publisher/legal entity, and official domain/endpoint;
- source class: government, regulator, law enforcement, court, standards body, platform/provider advisory, financial institution, research publisher, or other reviewed class;
- exact permitted protocol/path pattern and fetch method;
- jurisdiction, locale, subject taxonomy, and intended products;
- authority rationale and known limitations;
- robots/terms/license/rights and attribution requirements;
- content/data classification, PII expectation, and retention rule;
- expected update cadence, freshness policy, and expiry behavior;
- parser/content-type/size/redirect/timeout limits;
- independent source, domain, rights, and security review states;
- recovery/export/termination owner; and
- enabled/disabled version with append-only decision evidence.

A DNS/domain match alone is not authority. User-submitted URLs, shortened URLs, RSS autodiscovery, open redirects, arbitrary HTML links, email attachments, and model-suggested sources never enter the allowlist automatically.

The initial registry should prefer official primary sources and explicitly model when corroboration is required. Social posts and news articles may be leads, but they cannot alone become factual alert authority unless a reviewed policy for that exact source and claim says otherwise.

## Safe ingestion

External fetching remains disabled until a dedicated adapter proves:

- exact allowlist resolution before and after every redirect;
- public-network-only DNS/IP enforcement resistant to rebinding, metadata/internal services, IPv4/IPv6 variants, decimal/encoded hosts, userinfo, fragments, and alternate schemes;
- GET-only or code-owned request shape, no ambient credential/cookie forwarding, and no customer-derived URL;
- strict TLS, timeout, byte, decompression, redirect, concurrency, rate, and content-type limits;
- isolated parser execution, malware/file-complexity controls, and no script rendering unless independently justified;
- raw artifact hashing, receipt time, response headers needed for provenance, and safe private retention;
- provider/source terms, robots, license, attribution, privacy, and deletion review;
- idempotent inbox, bounded retry, outage/unknown state, dead-letter/replay, and source-health evidence; and
- logs/jobs/audit/owner-attention that contain only content-free identifiers and safe error classes.

A failed or stale source produces `unknown`/`stale`, never fabricated continuity or an automatically refreshed claim. Local fixtures are `local_simulation`, not a current web observation.

## Provenance and claim model

Each ingested artifact retains:

- immutable source/version and fetch-policy version;
- canonical provider locator digest, retrieval time, source publication/update time when authenticated, response/content hash, locale, and parser version;
- raw-artifact restricted reference plus normalized derivative hash;
- author/publisher attribution and rights state;
- extracted claim IDs linked to exact artifact spans or structured fields;
- claim subject, predicate, scope, jurisdiction, time interval, uncertainty, and expiry;
- corroborating, contradicting, superseding, and duplicate claim links;
- analyst and reviewer decisions; and
- every downstream draft/publication/correction that relies on the claim.

Do not put raw article text, customer content, credentials, or copyrighted material in audit/outbox/job payloads or broad HQ search. Hashes establish artifact identity, not truth or legal permission.

## Pattern and duplicate resolution

Deduplication must distinguish:

- identical source update;
- syndication or copied story;
- two sources reporting one underlying incident;
- similar scam mechanism across different campaigns;
- corrected/superseded source material; and
- superficially similar but independent claims.

Automated clustering is a candidate relationship with confidence and reasons. It never deletes source lineage, collapses contradictory facts, inflates source count through syndication, or treats repeated copying as corroboration. An editor can split/merge with append-only rationale; the skeptical reviewer sees original dissent and uncertainty.

## Editorial roles

Use separate role projections and approval steps:

1. **Source scout** — proposes registry/artifact candidates; cannot enable a source.
2. **Primary-source verifier** — verifies publisher/domain/authority and exact artifact identity.
3. **Fraud analyst** — extracts patterns, actors, requests, pressure tactics, and affected surface without declaring every item fraudulent.
4. **Evidence/corroboration reviewer** — validates claim support, independence, contradictions, scope, and freshness.
5. **Safety-action editor** — drafts proportionate, reversible safe actions and emergency boundaries.
6. **Skeptical/anti-alarmism editor** — attacks unsupported urgency, fear, certainty, demographic stereotyping, sensational losses, and engagement bait.
7. **Accessibility/plain-language editor** — reviews reading level, structure, alternative text/captions, cognition, and assistive-technology behavior.
8. **Privacy/rights/policy reviewer** — verifies minimization, attribution, permission, retention, endorsement/testimonial, jurisdiction, and channel policy.
9. **Final human approver** — approves one immutable product/version/audience/expiry; cannot bypass missing evidence.

The same person may hold multiple roles only under an explicit small-team exception that still requires a separate skeptical/final review for public or customer-facing material. Support/reviewer global HQ metadata access never grants raw source or publication authority.

## Claim and tone rules

Every customer-facing factual alert must:

- name or link the approved authoritative source when safe and legally permitted;
- state when and where the information applies;
- distinguish observed facts, source claims, BoomerBuddy analysis, uncertainty, and suggested action;
- avoid “guaranteed,” “always safe,” “caught,” “prevented,” “everyone,” unsupported prevalence/loss statistics, and unverified urgency;
- never impersonate a person, institution, or the founder;
- avoid blame, shame, age stereotypes, and coercive family framing;
- prefer reversible verification steps using independently obtained contact routes;
- include the emergency/law-enforcement/financial-institution boundary when relevant; and
- carry an expiry/review date and correction route.

A vivid anecdote is not prevalence. A model confidence is not source confidence. A platform takedown is not proof of criminality. Absence from a warning list is not proof of safety.

## Content-product contracts

Each version declares:

- product kind, audience, locale/jurisdiction, channel, urgency, and expiry;
- source/claim set and minimum corroboration policy;
- approved title/summary/body artifact digests in restricted content storage;
- safety-action set and unsupported-claim flags;
- accessibility/readability/caption/alt-text states;
- rights/privacy/policy/final approval evidence;
- exact template/layout/build version;
- publication/delivery eligibility and stop state; and
- correction/retraction lineage.

Urgent alerts require a tighter policy than tips or drafts: authoritative freshness, explicit severity rubric, independent reviewer, bounded audience, service-capacity check, frequency/quiet-hours/consent rules, and founder/human approval initially.

The founder-video workflow may draft a script from founder-original, rights-cleared material. It may not synthesize the founder's voice/image, imply the founder reviewed an artifact, or manufacture experience, expertise, incidents, testimonials, or losses prevented.

## HQ control plane

Future least-privilege queues:

- proposed and disabled sources;
- ingestion/source-health failures;
- new artifacts and duplicate families;
- unsupported, contradicted, stale, or expiring claims;
- fraud-analysis and safety-action review;
- skeptical/accessibility/privacy/rights queues;
- product-specific draft and approval queues;
- publication calendar and audience/channel eligibility;
- pending corrections/retractions;
- delivery/publication reconciliation; and
- outcome metrics with evidence-tier labels.

Queue summaries stay content-free. Restricted artifact/draft access needs exact assignment, purpose, step-up grant, read audit, and current review state. No queue button directly publishes or sends unless a later external-action class has independent policy, budget, provider, reconciliation, and founder evidence.

## Publication and distribution boundary

Run 3 does not authorize automated public or mass distribution. Before even a sandbox publisher exists, require:

- approved CMS/channel adapter and separate test/live credentials;
- immutable publication intent, target allowlist, exact content digest, provider idempotency/reference, cumulative budget, and global stop;
- immediate pre-dispatch recheck of approval, claim freshness, correction state, audience, consent/preferences, quiet hours/frequency, and channel policy;
- outcome-unknown reconciliation without blind duplicate publication/send;
- staged preview on a nonpublic destination and exact rendered-artifact review;
- reversible unpublish/correction behavior and cached/search/social propagation plan;
- monitoring, owner attention, incident/rollback, and founder absence coverage; and
- founder authorization for the exact first external destination/audience.

Email, SMS, push, social, blog/CMS, partner portals, and app content are separate action classes. Approval for one never enables another.

## Subscriber preferences

Customer delivery requires current, purpose- and channel-specific consent/preferences, including locale, jurisdiction, enabled product/urgency classes, frequency, quiet hours/timezone basis, accessibility/format choice, suppression/withdrawal, and expiry. A Trusted Circle relationship, payer fact, product entitlement, beta enrollment, or referral does not transfer messaging consent.

Critical service/legal notices, if applicable, require their own professionally reviewed purpose and cannot be mislabeled to bypass marketing suppression. Recipient-originated STOP/withdrawal remains available after entitlement or relationship lapse.

## Corrections and retractions

Correction is a first-class lineage, not an edit that erases the prior publication.

1. Freeze new distribution and mark the affected version under review.
2. Identify every product/channel/audience/cache/partner derivative linked to the claim.
3. Preserve the original evidence and append the correction/retraction reason.
4. Re-verify source, claim, impact, and required customer action.
5. Draft proportionate correction with the same evidence/accessibility/policy reviews.
6. Obtain final human approval and founder/incident approval when material.
7. Publish/send through the exact governed channel and reconcile outcome.
8. Update source health, derived knowledge, support scripts, and learning modules.
9. Measure reach without claiming every recipient saw or understood it.

Expired content is not silently current. If the product cannot fetch or review current evidence, it fails closed to unavailable/stale rather than continuing a dated alert.

## Analytics and evidence truth

Allowed privacy-bounded measures may include content version rendered, coarse source/channel, delivery state, consented open/click interaction where approved, correction exposure, and optional helpful/not-helpful feedback. Avoid cross-site tracking, raw URLs/query strings, customer content, fingerprinting, exact location, household composition, and inference that noninteraction means safety.

Report separately:

- source ingestion/health;
- editorial throughput and disagreement;
- approved/published/corrected state;
- provider acceptance/delivery/unknown;
- rendered/opened/clicked/helpfulness events; and
- real-world outcome evidence, which requires a separately consented and reviewed method.

Publication, impressions, clicks, and stated helpfulness are not fraud prevention, retention, revenue, calibration, or market demand.

## Adversarial gauntlet

Before local implementation is accepted:

- SSRF, DNS rebinding, redirect, encoded-host, internal-network, credential-forwarding, oversized/decompression, parser, malware, and timeout tests;
- domain takeover, compromised source, unexpected publisher/rights change, stale clock, and source-withdrawal behavior;
- duplicate syndication, conflicting sources, chronology reversal, correction/supersession, and poison replay;
- unsupported statistics, urgency, losses, quotes, endorsements, demographic targeting, and invented attribution;
- prompt injection/data exfiltration from source artifacts and generated drafts;
- tenant/assignment/purpose/role/step-up and restricted-content read negatives;
- immutable version, approval, idempotency, concurrency, ordering, dead-letter/replay, and restore;
- accessibility, plain language, localization, captions/alt text, and reduced-motion rendering;
- channel/audience mismatch, stale consent/preference, STOP, quiet-hour/frequency, kill-switch, budget, and provider-unknown denial; and
- correction/retraction across every derivative, cache, provider, and analytics projection.

Required independent review must search for alarmism, false certainty, source-count inflation, stale claims, selection bias, rights/privacy violations, accessibility harm, and distribution that outruns support capacity.

## Founder and external gates

Record in the Founder Provisioning system:

- source/editorial/policy owners and backup reviewers;
- approved initial sources and professional rights/privacy review;
- private artifact/object storage, KMS, scanner/parser isolation, and retention;
- any fetch, model, transcription, CMS, email, SMS, push, social, analytics, or search provider account and its exact environment-variable names only after an adapter exists;
- external-provider data-use/training/residency/subprocessor terms;
- publication domains/accounts, MFA/recovery, rollback, export, and termination;
- support and incident capacity for urgent products; and
- the founder's exact first product, audience, test destination, and spend authorization.

Do not paste source-provider, CMS, messaging, analytics, or publication credentials into source, documentation, logs, screenshots, or prompts.

## Run 3 local validation snapshot — 2026-08-17

The bounded provider-free tranche has the following local evidence:

- domain and strict-contract checks: 2 files, 7 tests passed;
- PGlite migration, repository authorization/privacy, provenance, deduplication, freshness,
  product/locale/jurisdiction binding, artifact/source authority, skeptical/final independence,
  exact assignment-event and claim-author authority, order-independent duplicate handling,
  correction/preference, and isolated API-route checks: 3 files, 20 tests passed;
- TypeScript checks passed for domain, contracts, persistence, API, and HQ workspaces; and
- exact-file ESLint and Prettier checks passed for the new TypeScript/TSX modules.

These are simulated/local evidence only. They include no URL fetch, provider request, public route,
worker execution, publication, message, real recipient, deployed environment, managed-PostgreSQL
recovery, human review, or production evidence. The external-provider, deployed, human, and
production evidence columns therefore remain `not_evidenced`, not implicitly passed.

## Current disposition

`REMEDIATE`. The provider-free local source/provenance/review/correction foundation and isolated
content-free HQ board now have focused local tests and nonproduction shared composition/navigation.
There is no approved external fetcher, live source registry, authentic source-health observation,
restricted raw-artifact/media store, generator, step-up draft-content route, CMS/publisher,
newsletter/SMS/push sender, analytics outcome, deployed correction drill, or real human approval.
Local fixture approvals are not authentic human evidence. No customer-facing content was published
or sent by this implementation.
