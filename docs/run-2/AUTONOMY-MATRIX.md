# Run 2 Autonomy Matrix

Status: **classification and fail-closed enforcement are implemented; autonomous execution is not**.

`AUTO` means eligible for a future policy-bound internal executor. In Run 2 the global kill switch defaults engaged, and evaluation only records an approved/blocked run proposal. No scheduler or tool executor exists.

## Code-owned AUTO ceiling

An owner policy may remove tools/data or reduce budget; it cannot add to these tuples.

| Action | Only allowed tool | Maximum allowed data classes | Run 2 execution state |
| --- | --- | --- | --- |
| `prepare_owner_brief` | `local_database` | `aggregate_metrics` | Query exists; no scheduler/delivery |
| `identify_stale_work` | `local_database` | `content_free_operational_metadata` | Opportunity rule exists; no recurring runner |
| `create_internal_task` | `hq` | `public`, `content_free_operational_metadata` | Policy evaluation only |
| `score_approved_rules` | `local_rules` | `public`, `aggregate_metrics`, `content_free_operational_metadata` | Some deterministic rules exist; no executor |
| `generate_internal_draft` | `internal_drafts` | `public`, `approved_content` | No generator; publishing excluded |
| `summarize_internal` | `local_database` | `aggregate_metrics`, `content_free_operational_metadata` | Policy evaluation only |
| `approved_internal_maintenance` | `local_database` | `content_free_operational_metadata` | Durable maintenance must be separately registered |
| `provider_health_check` | `local_database` | `provider_health` | No provider-health collector |
| `attribution_processing` | `local_database` | `attribution_metadata` | Public Check counters exist; no general processor |

Every future AUTO run also requires an enabled audited policy, exact action/tool match, data subset, cost within budget, cleared global stop, idempotent execution, validated output, and escalation on uncertainty.

## Company workflow classification

| Workflow | Class | Permitted assistance | Required gate / current truth |
| --- | --- | --- | --- |
| Public-data refresh and deterministic fit | HUMAN now; AUTO candidate | Parse, hash, and score an approved public source through a future bounded adapter | Import is manual; public fetch is not in the code-owned AUTO registry; no contacts or intent inference |
| Opportunity hygiene and internal next-action draft | AUTO | Flag stale records and draft an internal task | No outreach or commitment |
| Owner Brief preparation | AUTO | Aggregate approved metrics and draft changes | Founder reviews; current brief is on-demand and incomplete |
| Approved lifecycle message send | APPROVAL | Select a preapproved template after consent/suppression checks | No sender/templates connected; novel safety advice never AUTO |
| B2B outreach or campaign | APPROVAL | Research and draft from verified public facts | Human approves target/message; legal/privacy basis and sending controls required |
| Founder content derivative | APPROVAL | Transcribe, summarize, and prepare drafts with provenance | Founder approves voice/claims; no impersonation or auto-publish |
| Routine support navigation/FAQ | HUMAN/self-service now; AUTO candidate | Approved static self-service or internal suggested reply | No support action is in the AUTO registry; no support executor/staff; account/security/fraud boundaries escalate |
| Billing reconciliation exception/refund | HUMAN | Retrieve evidence, compare, queue recommendation | Material refund, dispute resolution, and restriction clearance require accountable human/provider process |
| Fraud result and difficult adjudication | HUMAN | Evidence collection and model/rule recommendation | No novel autonomous “safe” determination; senior Trust & Safety owns difficult cases |
| Partner discovery/relationship/contract | HUMAN | Research, notes, agenda, internal follow-up | Founder or named executive owns relationship and commitment |
| Hiring, firing, compensation, performance | HUMAN | Internal scheduling/checklist only | Authorized manager decides; no agent personnel authority |
| Price/package or material product policy | HUMAN | Scenario analysis and decision memo | Founder records decision and rollout gate |
| Legal/privacy/marketing/SMS review | PROFESSIONAL | Evidence package and deadline tracking | Qualified counsel/privacy professional accepts responsibility |
| Tax, accounting policy, payroll, financial statements | PROFESSIONAL | Reconciliation package and bookkeeping preparation | CPA/accountant/payroll provider owns professional work |
| Security test and accessibility conformance | PROFESSIONAL | Test preparation and remediation tracking | Qualified independent review before launch claims |

## Never autonomous under the current boundary

Transfer money; sign contracts; hire or fire; change prices; issue material refunds; clear a financial restriction without evidence; publish claims; contact consumers without consent; send consequential prospect outreach; disclose customer artifacts; grant support/restricted access; provide novel fraud, legal, medical, or financial advice; claim something is safe; submit mobile stores; or make a legally binding commitment.

## Evidence and stop controls

- The singleton global kill switch starts `true` (engaged).
- HQ fails closed when global state is unavailable and requires explicit owner confirmation to clear it.
- Policy changes append `autonomy_policy_versions`; control changes append `automation_global_control_history`.
- Both mutations write audit and outbox evidence transactionally.
- A policy evaluation writes `automation_runs` but does not execute the tool.
- API tests reject `send_outreach` and owner-authored tuples that exceed the code registry.
- Business OS read/manage is owner-only; reviewer/support roles cannot change autonomy.

See [policy code](../../packages/business-os/src/automation.ts), [schema](../../packages/persistence/migrations/0005_run2_business_os.sql), [integration evidence](../../tests/integration/business-os-api.test.ts), [Automation Agents](./23-automation-agents.md), and the [Founder Dependency Model](./FOUNDER-DEPENDENCY-MODEL.md).
