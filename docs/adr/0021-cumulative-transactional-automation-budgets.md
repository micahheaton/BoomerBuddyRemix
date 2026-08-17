# ADR-0021: Cumulative Transactional Automation Budgets

Status: **Accepted for Run 3 local implementation; paid autonomous execution remains disabled**

Decision date: 2026-08-16

## Context

Run 2 named `budget_cents` on each autonomy policy, but the policy engine used it only as the
maximum estimated cost of one request. Repeating individually inexpensive requests could therefore
pass without a cumulative company, agent, action, tool, or policy limit. No executor or external
paid tool existed, so the defect did not spend money in Run 2. It must be closed before any such
executor can exist.

The independent Run 2 review requires `available -> reserved -> committed | released`, atomic
reservation, company daily/monthly caps, narrower dimensional caps, immutable evidence, an explicit
founder override, and a kill-switch recheck immediately before irreversible execution.

## Decision

The old policy field is renamed `max_cost_per_operation_cents`. It remains a useful server-side
ceiling, but it is not called a budget. Cumulative authority is a separate persistent ledger.

Every reservation requires all of the following enabled caps:

- company `global` UTC day;
- company `global` UTC month;
- the exact server-selected agent;
- the exact action;
- the exact tool; and
- the exact policy ID.

Agent, action, tool, and policy scopes may use a UTC day, UTC month, or both. If both exist, both
apply. A missing required scope is denial, never unlimited authority.

One transaction locks the global control, current policy, matching caps, and current period windows
in deterministic order. It re-evaluates the code-owned action/tool/data boundary, verifies remaining
authority in every window, and either reserves the estimate in every window or changes none. A
stable operation key is idempotent only for the canonicalized exact envelope; conflicting reuse is
rejected.

Release removes the full reservation from every window when execution never occurs. Commit moves
the reservation to truthful actual cost after acceptance evidence. An unexpected accepted cost
above reserved authority is still recorded; it appends overrun evidence and engages the global
stop. Provider adapters must reserve a server/provider-declared upper bound so overrun is exceptional,
not an ordinary pricing path.

Immediately before any future irreversible provider call, the executor must call the transactional
recheck. It confirms the reservation is live, the global stop remains clear, the exact policy
version remains enabled, and the complete applicable cap ID/version envelope still matches, then
issues a five-second authorization window. Revocation, expiry, policy change, or any applicable cap
addition/change/removal atomically releases the reservation. Database and external-provider
operations cannot be one distributed transaction, so this is a narrow fail-closed precondition,
not an exactly-once claim.

Cap changes and founder overrides require the exact configured founder identity, a transactionally
locked active `hq_owner` assignment that references an existing `organizations` row whose kind is
`internal`, and the global stop engaged. The assignment and organization rows are locked together;
a null organization, sponsor organization, suspension, repoint, or organization-kind change fails
closed and serializes against the mutation. An override
adds bounded authority to one named cap's current UTC window and appends actor, reason, amount,
control version, stable exact-envelope override key, and time. An exact retry cannot compound the
override, while conflicting key reuse is rejected. It cannot disable enforcement or create a
wildcard exception.

`automation_budget_events`, reservation allocations, policy versions, and global-control history
are protected from update and deletion by database triggers. Current cap/window/reservation rows are
mutable projections; the event and allocation rows are their immutable evidence.

## No-executor boundary

The owner API can configure and inspect caps and append an explicit override. It cannot reserve,
commit, release, recheck, or call a tool. `/autonomy/evaluate` remains a dry run and explicitly
returns that no action executed and no cumulative budget was reserved.

The repository lifecycle is exercised with local simulation evidence only. No provider was called,
no external action occurred, no money was spent, and no production authority was demonstrated.
An `external_action` commit reference is accepted only when it uses the same operation key and the
governed external-action ledger already records terminally confirmed success. No adapter currently
calls that path; future execution must additionally pass provider idempotency and reconciliation.
Production authority and UTC-period decisions use the database transaction clock; caller-provided
dates cannot extend authority. The injected clock seam is test-only.

## Schema and migration

Forward migration `0013_run3_automation_budget_ledger.sql` preserves existing policies, versions,
control history, and evaluation runs. It adds:

- `automation_budget_caps`;
- `automation_budget_windows`;
- `automation_budget_reservations`;
- `automation_budget_reservation_allocations`; and
- `automation_budget_events`.

It creates no default or permissive cap. An upgraded environment therefore remains fail closed until
the founder deliberately configures every required scope while the global stop is engaged.

## Verification

Local tests prove missing-cap denial, many-cheap-request concurrency, exact-envelope idempotency,
atomic overlapping windows, release, commit, overrun stop, founder override gating, policy/kill
revocation, immutable evidence, and explicit 0012-to-0013 upgrade. The real-PostgreSQL verifier adds
a competing multi-transaction reservation scenario, but that evidence is not claimed until it runs
against a founder-owned disposable PostgreSQL target.

## Rejected alternatives

- Treating the per-operation maximum as a budget.
- Maintaining an in-memory counter that resets on deploy or does not coordinate workers.
- Checking only a global cap and omitting agent/action/tool/policy containment.
- Resetting accumulated use when a cap version changes.
- Making policy evaluation reserve funds.
- Letting an override bypass the ledger or operate while execution remains enabled.
- Deleting failed, released, or overrun evidence.
- Holding a database transaction open during an external network request.

## Remaining risks and gates

Real PostgreSQL contention, hosted clock behavior, restore, maintenance scheduling, provider cost
upper bounds, acceptance evidence, and the dispatch-start-to-provider timing gap still require
staging evidence. Local maintenance and external-action accounting are structural only; no shared
external-action or provider executor is enabled in this decision. The bounded maintenance handler is
wired into the shared worker for local expiry release and accepted-effect recovery, but it cannot
call a provider. Founder override governance needs real identity/MFA and professional
financial/security review. The ledger is cost authority and evidence; it is not accounting,
payment, provider success, revenue, or production-readiness proof.

The application repository checks the configured founder identity and a current internal-owner
assignment. Database triggers cannot read deployment identity configuration, so their defense in
depth requires a current internal-owner assignment but not the configured-founder value. A direct
database writer is therefore a separately controlled migration/operations principal, never an HQ
actor substitute; production database roles and custody must prove that boundary.
