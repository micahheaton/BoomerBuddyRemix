# 20 — BoomerBuddy HQ Business OS

Status: **a separate, owner-only local control plane is implemented for imported targets, opportunity hygiene, billing attention, summary metrics, and autonomy policy evaluation; it is not a production company operating system**.

## Implemented surfaces

HQ retains a distinct application, session audience, origin, navigation, and authorization boundary. The Run 2 owner surfaces are:

- **Owner overview:** five on-demand local/imported metrics;
- **Targets:** provenance-labeled NCUA institution filters with an explicit no-intent warning;
- **Pipeline:** local opportunity creation, controlled stage transitions, dated next actions, and explainable staleness;
- **Attention:** deduplicated founder-decision items, currently produced by billing reconciliation and repository workflows; and
- **Autonomy:** authoritative global stop, action policies, and non-executing evaluation records.

Run 1 customer, fraud-review, revenue-fixture, and system/audit projections remain available under the owner shell. Submitted artifact content is excluded from HQ projections and browser tests. HQ reads local or explicitly imported evidence; it does not convert fixtures into customer, revenue, fraud, partner, or production claims.

Business OS `read` and `manage` are currently restricted to `hq_owner`. A reviewer is routed only to the fraud review projection and receives `403` for the owner brief and autonomy management. This least-privilege default prevents revenue/owner context from leaking into a review role, but it also means delegated Customer Ops and RevOps roles are not yet productized.

Evidence: [Master Spec](../BOOMERBUDDY-2.0-MASTER-SPEC.md), [HQ owner UI](../../apps/hq/src/components/business-os.tsx), [API](../../apps/api/src/routes/business-os.ts), [authorization](../../packages/authorization/src/index.ts), and [Business OS integration test](../../tests/integration/business-os-api.test.ts).

## Owned context and integration boundary

HQ should own BoomerBuddy-specific context: household and consent boundaries, entitlement truth, activation evidence, safety/support/privacy cases, partner/member adoption, opportunity next action, provider exceptions, and founder decisions. It should integrate—not recreate—mail delivery, generic CRM enrichment, payroll, accounting, banking, tax, e-signature, or bulk outreach.

The Run 2 migration provides foundations for content, referrals, contacts, activities, tasks, lifecycle, health, work cases, privacy requests, approvals, and runs. Many are repository- or schema-only and have no complete HQ screen or external connector. No customer message, prospect contact, content publication, refund, contract, payment, hire, or professional filing can be executed from HQ.

## External operating gaps

There is no managed identity/MFA, production database, Sentry/PostHog, mailbox/calendar, accounting, payroll, CRM, customer-support, document, or vendor-health integration. There are no scoped L1/Trust & Safety/RevOps workspaces, queue SLAs, staffing assignments, or production evidence. Accessibility has automated checks but no independent audit.

Run 3 should first prove owner-only staging with managed identity, then add narrowly scoped delegated roles and exact case assignments. Each external integration needs data minimization, a human/accountable owner, audit, suppression, failure behavior, and export/termination plan. See [Owner Attention](./21-owner-attention.md), [Owner Brief](./22-owner-brief.md), and [Automation Agents](./23-automation-agents.md).
