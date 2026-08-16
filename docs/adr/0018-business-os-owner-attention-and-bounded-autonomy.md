# ADR-0018: Business OS, Owner Attention, and Bounded Autonomy

Status: **Accepted Run 2 design; bounded local workflows required; live integrations, outbound actions, and professional decisions blocked**

Decision date: 2026-08-16

## Context

Run 1 proved that HQ is a separate employee audience with redacted projections, but not the operating graph required to run BoomerBuddy. “Do not rebuild a generic CRM” must not be read as “remove revenue, customer, safety, or owner workflows.” At the same time, founder time is a constraint and automation without explicit authority can create privacy, fraud, communications, financial, or legal harm.

## Supersession

This ADR supersedes [ADR-0010](./0010-separate-customer-and-hq-applications.md)'s narrow HQ scope and seeded-projection description. It preserves separate applications, origins, sessions, audiences, deployments, content-minimized projections, and case-bound restricted access. It also clarifies [ADR-0003](./0003-managed-identity-and-resource-authorization.md): employee role is eligibility, never customer authority.

## Decision

HQ is the BoomerBuddy Business OS and control plane. It owns BoomerBuddy-specific:

- customer, person, household, consent, safety, orientation, and health context;
- sponsor/partner organizations, eligibility, adoption, and aggregate reporting policy;
- attribution, leads, accounts, opportunities, stage history, activities, tasks, next actions, provenance, and staleness;
- subscription/entitlement truth and commerce reconciliation views;
- support, fraud-review, privacy, provider, job, and incident cases;
- owner-attention items, brief snapshots, autonomy policies, approvals, and audit.

Payroll, tax filing, general ledger, banking, bulk contact databases, message transport, generic ATS, and general-purpose CRM capabilities remain external systems of record. HQ links their minimized references and status through adapters; it does not clone them.

Least-privilege modules separate owner, customer operations, revenue operations, fraud operations, and system operations. Lists exclude artifact content. Support eligibility requires an exact case assignment; restricted content additionally requires purpose, resource scope, customer/legal basis, recent step-up, expiry, immutable audit, and review. No hidden impersonation exists.

Every recurring workflow is registered as `AUTO`, `APPROVAL`, `HUMAN`, or `PROFESSIONAL`, with owner, permitted data/actions/tools, budget, preconditions, idempotency, audit, escalation, and kill switch. `AUTO` is limited to reversible, internal, allowlisted work. Publishing, outbound campaigns, novel fraud determinations, customer-content access, material refunds, legal/accounting judgments, production configuration, and irreversible actions require the specified approval or qualified person.

“WHAT ACTUALLY NEEDS YOU?” is a deduplicated owner queue, not another dashboard. Each item has reason, evidence, recommendation, alternatives, deadline, consequence, severity, source, deduplication key, state, and resolution. The owner brief summarizes only exceptions, decisions, cash/safety/service risks, and overdue commitments with truthful seeded/mock/verified labels.

## Consequences

BoomerBuddy gains one operational context without creating a commodity SaaS clone. Explicit provenance, ownership, due-state, and audit add schema and workflow cost. Tight autonomy boundaries may leave more human work initially; measured workflows can move modes only through a reviewed policy change.

## Rejected alternatives

- A generic CRM clone or one dashboard that owns every business record.
- Employee superusers, direct SQL tools, or support impersonation.
- Autonomous outbound/publishing/refunds because an agent can execute them.
- Sending every metric or stale task to the founder.
- Treating seeded opportunities, health scores, or recommendations as observed business truth.

## Verification

Tests cover audience, role, tenant, case, resource, step-up, expiry, and content-exclusion boundaries; state-machine idempotency; due/stale transitions; provenance; small-cell suppression; owner-queue deduplication; and truthful evidence labels. Automation tests prove data/action allowlists, budgets, approvals, kill switches, revoked authority at execution, and no external side effect in Run 2.

## Evidence boundary

The bounded local graph and queues are not account-blocked. Live enrichment, communications, finance/accounting synchronization, customer outcomes, and production support access require accounts, contracts, lawful purpose/consent, data owners, staging assurance, and human approval. Legal, tax, accounting, security, and high-risk fraud decisions remain `PROFESSIONAL`; agent output is not professional evidence.

## Primary sources

The scope is controlled by the amended [Master Spec](../BOOMERBUDDY-2.0-MASTER-SPEC.md) and [independent-review adjudication](../run-2/01-external-review-adjudication.md). Least privilege, separation of duties, and audit guidance was rechecked 2026-08-16 in [NIST SP 800-53 Rev. 5](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final); automation-risk governance uses the [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework).
