# CRM and Revenue Operations

## Boundary

BoomerBuddy should own the domain facts that generic CRM systems do not: household, protected member, sponsor eligibility, partner-funded entitlement, activation, safety events, and consented referral. It should integrate a commodity CRM for email synchronization, enrichment, sequences, forecasting conveniences, and broad sales automation rather than rebuild them.

## Canonical commercial graph

Model `Organization`, `Contact`, `Lead`, `TargetAccount`, `Opportunity`, `Partner`, `Pilot`, `ContractReference`, `Activity`, `Task`, and `AttributionTouch`. Link these to sponsor programs and aggregate adoption metrics—not to raw consumer artifacts. An opportunity requires stage, amount/range, confidence, use case, owner, champion, economic buyer, next action, next-action date, and activity history.

## Operating rule

No qualified opportunity silently dies. A daily workflow emits `opportunity.stale` when a stage-specific activity window expires, creates an owned task, and escalates overdue items. AI may summarize history or suggest a next action, but outbound communication and stage/forecast changes require human approval.

## Opportunity sourcing decision

Start with the free, official [NCUA active-research files](https://ncua.gov/analysis/credit-union-corporate-call-report-data) for institution facts and human-verified institution websites for people/roles. Preserve source URL, source period, retrieved time, field provenance, and verification state. Do not construct a giant contact database or infer age mix, interest, budget, or intent from membership data.

Apollo is a later enrichment/prospecting candidate, not a Run 1 dependency or endorsement. Its public pricing accessed 2026-08-15 lists Free with 900 annual credits per seat, Basic at $49/seat/month billed annually, Professional at $79, and Organization at $119 with a three-seat minimum; enrichment, API use, and contact access consume credits that expire by billing cycle. Prices/features are introductory and volatile ([Apollo pricing](https://www.apollo.io/pricing), [credit rules](https://knowledge.apollo.io/hc/en-us/articles/9527776320781-What-Are-Credits)). Buy only after a time study shows manual verification is the bottleneck and a controlled sample improves qualified meetings enough to cover subscription, credits, privacy review, and data decay. Any provider sits behind an import/enrichment adapter with field provenance and deletion/export controls; no consumer or artifact data enters it.

`SavedTargetSearch` stores owner, name/version, source snapshot, geography, charter/status, member and asset ranges, evidence filters, sort, refresh cadence, last run, result count, and change history. Initial saved searches include `AZ-OR-UT-WA / 10k–250k members` and `same region / $500m+ assets`, with only active insured institutions. Results are reproducible from a dated source snapshot.

Target-account scoring is transparent, human-reviewed, and evidence-dated: size/segment fit (0–20), public evidence of fraud/member-experience/caregiver work (0–25), digital distribution readiness (0–15), geographic/service fit (0–10), procurement/design-partner fit (0–15), and a verified relevant role/contact (0–15). Each component links to its evidence; missing evidence scores zero and is not negative evidence. There is no opaque “AI intent score.”

## Initial stages

`target → engaged → discovery → qualified → pilot_design → pilot → business_case → contracting → won/lost → implementation → active_partner → renewal/expansion`

## Build Run 1

Implement visibly seeded saved searches, target accounts, explainable score components, and opportunities in HQ with owner, stage, next action, and staleness. Defer enrichment, mailbox sync, sequences, real contacts, and external CRM connection. Provider interfaces must preserve source snapshots, field provenance, external IDs, consent/deletion state, and sync history for later Apollo, HubSpot, or equivalent integration.
