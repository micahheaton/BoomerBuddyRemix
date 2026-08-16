# 17 — B2B Revenue Engine

Status: **an owner-only, local opportunity and next-action control loop is implemented and tested; it is not a sales automation system and has produced no pipeline or revenue**.

## What works

Official NCUA institutions can become provenance-linked CRM organizations. An HQ owner can create a local opportunity, assign an optional owner and hypothesis value/use case, record a dated next action, and advance only through the controlled stage graph:

`target → prospecting → engaged → discovery → qualified → pilot/business case → contracting → closed won → implementation → active partner → expansion`

Closed-lost re-entry and defined terminal/expansion transitions are explicit; unsafe shortcuts are rejected. Every created/transitioned opportunity writes operational audit/outbox evidence. The queue explains staleness using stage-specific inactivity windows, missing/overdue next actions, snooze, and suppression rather than an opaque AI score.

The API and UI state the critical truth twice: creating a record sends no outreach, and consequential outreach is not automatic. Business OS read/manage actions are restricted to the `hq_owner`; reviewers and support staff cannot see the targets, pipeline, attention, brief, or autonomy surfaces.

Evidence: [stage and hygiene rules](../../packages/business-os/src/revenue.ts), [repository](../../packages/persistence/src/business-os.ts), [owner-only API](../../apps/api/src/routes/business-os.ts), [HQ control](../../apps/hq/src/components/business-os.tsx), and [integration test](../../tests/integration/business-os-api.test.ts).

## Schema foundation versus product

The migration also defines contacts, activities, tasks, stage history, communication suppressions, champion/economic-buyer references, pilot/contract fields, and partner stages. In Run 2, contacts, activities, and tasks are schema only: they have no supported API or HQ workflow. Opportunity stage history exists, but the current screen focuses on queue state and next action rather than a complete timeline.

Snooze and suppression fields participate in the hygiene rule but have no supported mutation route or UI control. There is no recurring hygiene runner, generated daily task queue, task assignment, or notification delivery; an owner must open HQ and inspect the opportunity queue.

There is no Apollo/HubSpot connector, contact enrichment, mailbox/calendar sync, sequence engine, template library, deliverability domain, consent/legitimate-interest decision, proposal, e-signature, contract repository, invoicing, sponsor eligibility feed, implementation workflow, or partner reporting. The imported institutions are not “leads,” opportunity amount is not forecast revenue, and no stage is externally verified.

## Operating rule

Use HQ to preserve BoomerBuddy-specific context: why an institution may fit, what human action is due, what evidence supports the stage, and whether work is stale or suppressed. Integrate a commodity CRM later only if the operating burden warrants it; never export consumer artifacts or consent relationships into prospecting tools.

Before outreach, Run 3 needs founder authorization, separate sending identity, legal/privacy review, verified contacts, suppression synchronization, a narrow discovery script, capacity limits, and human approval. Before calling anything pipeline, require recorded external interaction and stage evidence. Before revenue, require signed terms, settled money, activated members, and sponsor contribution reconciliation.
