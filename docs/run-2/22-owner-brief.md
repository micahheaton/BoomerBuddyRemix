# 22 — Owner Brief Prototype

Status: **an owner-only, on-demand five-metric projection is implemented and API/UI tested; scheduled briefs, change narratives, financial truth, and external delivery are not implemented**.

## Current brief

At request time, the repository calculates:

| Metric | Current source and meaning |
| --- | --- |
| Founder decisions waiting | Open or snoozed `owner_attention_items` |
| At-risk households | Latest persisted deterministic health snapshot per household |
| Credit-union universe | Rows in an imported NCUA snapshot |
| Open opportunities | Local opportunities outside closed-won/closed-lost |
| Stale opportunities | Deterministic hygiene evaluation at brief time |

The API adds `generatedAt` and labels the data `local_or_imported_evidence`. HQ links each metric back to the source surface and repeats that local/imported records neither infer buyer intent nor execute action. Business OS authorization makes the endpoint owner-only; a reviewer receives `403`.

Evidence: [projection](../../packages/persistence/src/business-os.ts), [contract](../../packages/contracts/src/business-os.ts), [route](../../apps/api/src/routes/business-os.ts), [UI](../../apps/hq/src/components/business-os.tsx), and [integration test](../../tests/integration/business-os-api.test.ts).

## Truth boundary

This is a prototype query, not a daily or weekly operating brief. The `owner_briefs` table exists, but the current route does not persist snapshots, deltas, changes, attention links, evidence state history, or delivery receipts. There is no scheduled job or Owner Brief Agent executor.

MRR, ARR, paid households, protected members, churn, conversion, referral performance, support health, fraud quality, provider cost, inference spend, pipeline value, employee/queue health, cash, and upcoming professional obligations are absent. The five current counts must not be renamed into those metrics. NCUA universe size is not pipeline; opportunity count is not revenue; a local health score is not measured retention risk.

## Run 3 acceptance

Add only reconciled metrics with definitions, source timestamps, comparison windows, late-data behavior, and drill-down. Persist immutable brief snapshots after the real PostgreSQL and privacy design is reviewed. The useful format remains:

1. what changed;
2. why it changed or what evidence is missing; and
3. what truly needs attention.

Before scheduled delivery, connect a content-minimized transport, named recipient/backup, retry and suppression rules, and a global stop. Exercise false alarms and missing-provider data in an owner rehearsal. No brief should contain submitted scam content, secret/provider payloads, invented explanations, or automatic commitments.

See [Owner Attention](./21-owner-attention.md), [HQ Business OS](./20-hq-business-os.md), and [Known Limitations](./32-known-limitations.md).
