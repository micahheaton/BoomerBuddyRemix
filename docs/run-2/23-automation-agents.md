# 23 — Automation Agent Architecture

Status: **fail-closed policy evaluation, append-only policy/control history in the supported repository path, budget/data/tool checks, and HQ controls are implemented and tested; there is no autonomous agent scheduler, tool executor, delegation runtime, or unattended operating history**.

## Implemented control plane

Every policy names one action, autonomy class, allowed data classes, allowed tools, cost budget, audit requirement, enabled state, approver, and version. A database-global kill switch defaults engaged. Owner policy and global-control changes insert version/history rows plus audit and outbox evidence; no supported API mutates those history rows. HQ treats an unknown server state as engaged and requires explicit owner confirmation to clear the global stop.

`AUTO` is constrained twice: the owner policy may narrow, but cannot expand, a code-owned action × tool × data-class tuple registry. Unknown actions, unsafe tools/data, excess cost, disabled policies, and an engaged global stop fail closed. Evaluation creates an `automation_runs` record; it does not call the requested tool. The policy API explicitly returns `actionExecuted: false`.

The nine code-eligible actions are owner-brief preparation, stale-work identification, internal task creation, approved-rule scoring, internal draft generation, internal summary, approved internal maintenance, provider-health checking, and attribution processing. Exact tuples are in the [Autonomy Matrix](./AUTONOMY-MATRIX.md).

Evidence: [policy engine](../../packages/business-os/src/automation.ts), [history schema](../../packages/persistence/migrations/0005_run2_business_os.sql), [repository](../../packages/persistence/src/business-os.ts), [HQ controls](../../apps/hq/src/components/business-os.tsx), and [integration test](../../tests/integration/business-os-api.test.ts).

## Candidate agents and actual Run 2 state

| Candidate | Existing foundation | Missing execution |
| --- | --- | --- |
| Owner Brief | Five-metric query; AUTO tuple | Scheduler, persisted delta, delivery |
| Lead Research | Exact NCUA importer/fit rules | Refresh, contact verification, enrichment |
| Opportunity Hygiene | Explainable stale rules | Recurring task producer/assignment |
| Customer Activation | Trigger plans and workflow rows | Product-event wiring, templates, sender |
| Support Triage | Deterministic routing classes | Intake, assignment, staffed queues |
| Fraud Intelligence / Evaluation | Provider/evaluation governance elsewhere | Approved provider jobs and human adjudication |
| Provider Health | AUTO tuple only | Provider checks, thresholds, alert transport |
| Content Repurposing | Provenance/review metadata; internal-draft tuple | Transcription/generation/editor/publisher |
| Churn Risk | Explainable health rules | Scheduled snapshots and interventions |
| Finance Preparation | Scenario models only | Ledger/accounting inputs and professional review |

## Prohibited authority

There is no general super-agent. `send_outreach` is rejected as AUTO in unit and API tests. No current agent can contact a consumer/prospect, publish content, give novel safety advice, change price, transfer money, issue a material refund, hire/fire, sign a contract, grant restricted access, submit a store build, or accept legal/accounting responsibility.

The `automation_approvals` table is a schema foundation only; there is no approval inbox or executor. “Allowed” means the proposed tuple passed policy evaluation while the global stop was clear—not that work ran or succeeded.

Run 3 must add one bounded executor at a time, starting with a reversible internal action. Require idempotency, lease/retry, audit completion, actual-cost capture, output validation, escalation, per-agent kill switch, adversarial tests, named owner/backup, and a stop drill. External or consequential actions remain human/professional gates even if a system prepares the draft.
