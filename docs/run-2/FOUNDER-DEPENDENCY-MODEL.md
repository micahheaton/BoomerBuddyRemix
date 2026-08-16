# Founder Dependency Model

Status: **planning baseline and implemented governance; no live-workload validation**

## Objective

Reduce routine founder-required labor while preserving the founder’s disproportionate value in public credibility, original fraud/cybersecurity content, major partner relationships, material product decisions, media, weekly executive review, and exceptional incidents. A low score achieved by neglecting customers, hiding labor, or automating consequential judgment is failure.

## Score definition

Run 2 implements the calculator in `packages/business-os/src/automation.ts`:

`Founder Dependency Score = target founder minutes ÷ current-baseline founder minutes × 100`

The current baseline is normalized to 100. For each recurring workflow:

`current minutes = monthly frequency × founder minutes per occurrence`

For routine work:

`target minutes = current minutes × (1 - automation fraction - delegation fraction)`

Automation plus delegation is capped at 100%. High-value founder work is deliberately retained at 100%. The score is a dependency ratio, not a quality score, headcount target, or claim about actual hours.

## Reference operating month

No production workload or founder time study exists. This reference month is a scenario chosen to exercise the model. Frequencies and minutes must be replaced with a four-week time study before an operating claim.

| Recurring workflow | Class / intended owner | Current hours | Automation | Delegation | Target founder hours | Target dependency |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Weekly executive review | HUMAN — founder | 6.00 | 0% | 0% | 6.00 | 100% |
| Major product decisions | HUMAN — founder | 8.00 | 0% | 0% | 8.00 | 100% |
| Original fraud/security content | HUMAN — founder | 12.00 | 0% | 0% | 12.00 | 100% |
| Major partner/media relationships | HUMAN — founder | 12.00 | 0% | 0% | 12.00 | 100% |
| Material incident leadership | HUMAN — founder/executive | 4.00 | 0% | 0% | 4.00 | 100% |
| Routine support | AUTO triage + L1 HUMAN | 30.00 | 40% | 55% | 1.50 | 5% |
| Billing and reconciliation | AUTO + APPROVAL exceptions | 13.33 | 70% | 25% | 0.67 | 5% |
| Basic customer success | AUTO queue + HUMAN contact | 20.00 | 40% | 55% | 1.00 | 5% |
| Lead-list construction | AUTO public research | 20.00 | 75% | 25% | 0.00 | 0% |
| Sales follow-up/reporting | AUTO reporting + HUMAN send | 13.33 | 50% | 45% | 0.67 | 5% |
| Routine fraud review | AUTO evidence + Trust & Safety HUMAN | 20.00 | 25% | 70% | 1.00 | 5% |
| Employee task assignment | AUTO internal tasks + manager | 6.67 | 70% | 25% | 0.33 | 5% |
| Bookkeeping preparation | AUTO preparation + PROFESSIONAL | 8.00 | 50% | 45% | 0.40 | 5% |
| Infrastructure monitoring | AUTO monitor + HUMAN incident | 7.50 | 80% | 15% | 0.38 | 5% |
| Content repurposing | AUTO draft + founder APPROVAL | 18.00 | 50% | 45% | 0.90 | 5% |
| Routine owner reporting | AUTO Owner Brief | 6.67 | 90% | 5% | 0.33 | 5% |
| **Total** |  | **205.50** |  |  | **49.18** | **24%** |

The target preserves all **42.0 high-value hours/month** and reduces modeled routine founder labor from 163.5 to 7.18 hours. It therefore moves the scenario from **100 to 24**, approximately 11.3 target founder-hours/week. This is a design target, not achieved capacity.

## What Run 2 actually implements

Run 2 adds versioned autonomy policies, approval and run records, budgets, allowed tools/data, audit requirements, an Owner Attention queue, and Owner Brief records. A persisted global kill switch defaults to **engaged**. Code—not an owner-authored policy—limits `AUTO` to these reversible internal actions:

- prepare an Owner Brief;
- identify stale work;
- create an internal task;
- score approved deterministic rules;
- generate an internal draft;
- summarize internal operational data;
- perform approved internal maintenance;
- check provider health; and
- process content-free attribution.

A policy can narrow that allowlist but cannot expand it. Tool, data-class, cost, enabled-state, and global-kill checks fail closed. This is a control-plane proof. No production scheduler, messaging account, staff delegation, real queue, or unattended external action proves the target score.

## Autonomy boundary

| Class | Permitted examples | Never implied |
| --- | --- | --- |
| AUTO | Approved internal summaries, drafts, deterministic scoring, stale-work detection, internal tasks, health checks | Consumer contact, publishing, spending, permissions, novel safety advice |
| APPROVAL | Approved-template external message, governed content publication, policy-bounded refund, campaign start, price/config change | Approval by silence or an agent approving itself |
| HUMAN | Customer conversation, partner relationship, difficult fraud adjudication, hiring choice, material incident, major product decision | Unlimited data access or bypass of consent |
| PROFESSIONAL | Legal/privacy/tax/accounting opinions, independent security/accessibility testing, employment classification | AI substitution for licensed/accountable judgment |

The founder does not need to approve every routine act. Approval should sit with the lowest authorized human role whose policy and competence fit the consequence. The founder receives only items that require founder capital allocation, credibility, relationship ownership, public voice, material exception, or executive risk acceptance.

## Owner Attention noise budget

Every founder item must state why the founder is required, recommended action, deadline, consequence of inaction, severity, evidence, and deduplication key. Aggregate repeated provider failures into one incident. Route ordinary support, billing, pipeline hygiene, and staff tasks to their operating owners. Review false-positive attention weekly; a queue that the founder habitually ignores is not a control.

Suggested service objective:

- no more than five non-incident founder decisions in a daily brief;
- critical safety/security items page immediately through a separately tested path;
- stale low-severity items roll into a weekly review rather than repeated alerts; and
- an approval expiry returns work to a safe state, never approval-by-timeout.

## Stage targets

These are governance gates for the same reference-workflow basket, not promises tied automatically to subscribers.

| Stage | Maximum routine-dependency target | Required evidence |
| --- | ---: | --- |
| Run 2 foundation | 100 in live operations | Kill switch engaged; no unsupported autonomy claim |
| Launch-enablement | 70 | Four-week time study; every recurring queue has owner, backup, runbook, and escalation |
| Stable early service | 55 | Billing/support/provider recurrence proven without founder; monthly access and quality review |
| Repeatable operation | 40 | Customer success, reporting, pipeline hygiene, and bookkeeping preparation delegated with measured QA |
| Scaled small company | 30 | Management, staffing, incidents, and professional calendar do not depend on founder memory |
| 50K target scenario | 24 | Approximately 42 high-value + 7 routine founder hours/month; no failed SLA or hidden labor |

Do not reduce the score by deleting a necessary workflow, undercounting frequency, treating unpaid founder labor as free, moving founder work to an unmeasured inbox, or adding unsafe automation.

## Measurement cadence

1. For four weeks, record workflow, occurrence, founder minutes, interruption severity, reason founder was needed, and resulting decision—never customer artifact content.
2. Monthly, reconcile the time log to Owner Attention, support, billing, job, incident, and professional calendars.
3. Freeze the baseline basket for a quarter. Report workload growth separately so the denominator cannot be gamed.
4. For each proposed removal, select automation, delegation, process elimination, or retained founder work; name remaining risk and evidence required.
5. Release `AUTO` only after deterministic tests, least-data review, budget, audit, rollback, kill-switch drill, and human escalation pass.
6. Report two companion numbers: total founder hours and high-value founder hours. The dependency score alone can hide overload.

## Failure and rollback

Re-engage the global kill switch on policy drift, unauthorized data/tool use, repeated incorrect actions, budget breach, audit failure, or incident investigation. Preserve records, move affected work to a named human queue, and require a new versioned policy plus replay-safe test before re-enabling. A founder vacation drill should demonstrate that routine work continues for two weeks while consequential decisions wait safely or escalate to a named backup.

Related: [Run 2 founder-dependency review](./31-founder-dependency.md), [Staffing and Philippines Operations](./STAFFING-AND-PHILIPPINES-OPS.md), [50K Subscriber Model](./50K-SUBSCRIBER-MODEL.md), and [Master Spec autonomy contract](../BOOMERBUDDY-2.0-MASTER-SPEC.md#analytics-autonomy-and-owner-attention).
