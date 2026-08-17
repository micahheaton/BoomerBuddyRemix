# Run 3 Automation Budget Controls

Status: **Stage 0 local implementation evidence; no executor, provider call, spend, or production proof**

Evidence date: 2026-08-16

## Independent-review reconciliation

Finding R2-02 is closed at the local implementation layer. The former policy `budgetCents` field is
now `maxCostPerOperationCents`, truthfully describing its one-operation purpose. Cumulative authority
uses atomic persistent reservations and cannot be inferred from a dry-run policy result.

## Required authority topology

| Required scope | Required period | Missing behavior |
| --- | --- | --- |
| Company `global` | UTC day | Fail closed |
| Company `global` | UTC month | Fail closed |
| Exact server-selected agent | UTC day and/or month | Fail closed |
| Exact action | UTC day and/or month | Fail closed |
| Exact tool | UTC day and/or month | Fail closed |
| Exact policy ID | UTC day and/or month | Fail closed |

Every matching enabled cap applies. A tighter dimension blocks the whole reservation without
changing any other window. Cap updates retain a stable cap ID and the same current-period counters,
so raising or changing a version does not reset accumulated usage.

## Lifecycle

1. `reserve` locks global control, policy, caps, and windows; rechecks the allowlisted tuple; and
   atomically reserves all scopes or none.
2. `recheckBeforeIrreversibleExecution` confirms the exact reservation, global stop, expiry,
   current policy version, and the complete applicable cap ID/version envelope immediately before
   any future provider adapter. A cap added, disabled, or revised after reservation releases the
   authority instead of inheriting stale terms.
3. `release` returns the entire reservation to every window if execution never occurs.
4. `commit` replaces reserved cost with truthful actual accepted cost. Local tests use only
   `local_simulation` evidence. An external-action reference is structurally rejected unless the
   same operation key is terminally confirmed in the separate external-action ledger.
5. An unexpected accepted-cost overrun is recorded rather than hidden, and it engages the global
   stop before another reservation can proceed.

The budget repository does not expose a paid-tool or provider executor. The portable worker has
durable local-fixture notification, intelligence-count, and synthetic evaluation handlers, but the
discretionary intelligence/evaluation schedules and handlers are structurally omitted in
production. No public or HQ route exposes reserve, recheck, commit, or release.

Authority time for reservations, UTC windows, rechecks, expiry, and leases comes from the database
transaction clock in production. Caller time is observation metadata only. A deterministic injected
clock exists solely for isolated repository tests.

## Founder controls in HQ

The owner can view current UTC windows, set one exact cap, or append a bounded current-window
override. Configuration and override require the exact configured `BB_FOUNDER_PERSON_ID`, a locked
active `hq_owner` assignment for that person that references an existing `internal` organization,
authoritative global state, and the global stop engaged. The assignment and organization are locked
together so null, sponsor, suspended, repointed, or concurrently reclassified authority fails
closed. Missing founder configuration fails closed.
The override needs an exact cap, positive amount, explicit confirmation, reason code, and stable
override key. Only an exact retry of the same cap/window/amount/reason envelope is idempotent;
conflicting reuse fails closed.

The HQ policy evaluator remains non-reserving and non-executing. Its response explicitly includes:

- `evaluationOnly: true`;
- `cumulativeBudgetReserved: false`; and
- `actionExecuted: false`.

## Evidence implemented

- Forward-only 0012-to-0013 upgrade preserves policy/control/evaluation history.
- No cap is seeded by migration; upgraded instances remain fail closed.
- Concurrent individually cheap requests can reserve only up to the tightest cumulative cap.
- A duplicate operation converges only when its canonical envelope matches exactly.
- Release and commit update all overlapping windows once.
- Kill-switch engagement, policy version change, cap-envelope change, or expiry prevents execution
  recheck and releases authority.
- Founder override is rejected while the global stop is clear.
- Founder override retries do not compound authority and conflicting envelopes fail closed.
- Budget events and allocations reject update/delete.
- Accepted-cost overrun remains truthful and engages the global stop.
- Provider-confirmed accepted exposure commits the budget in the same transaction as immutable
  acceptance evidence; a later rule revocation or response cannot erase accepted truth.
- A bounded `SKIP LOCKED` maintenance path releases only undispatched expired reservations and
  retains any in-flight, unknown, or accepted external action.

Exact frozen command counts belong in the Run 3 candidate dossier after independent review and the
full repository gates complete.

## Evidence boundary

Current evidence is PGlite/local simulation plus source-level PostgreSQL verification scaffolding.
It is not real PostgreSQL contention evidence, hosted time evidence, managed identity evidence,
founder MFA evidence, accounting evidence, provider acceptance, spend, revenue, conversion, or
production readiness. The bounded maintenance handler is registered in shared worker startup with
a deterministic interval key. Discretionary intelligence/evaluation work is nonproduction-only,
and only its local tests are evidence; no hosted schedule or real PostgreSQL execution has been
observed. The founder must not clear any paid external action until
the external-action adapter gates, real PostgreSQL concurrency/clock/restore evidence, identity,
staging, provider sandbox, reconciliation, and professional gates are independently green.

Decision: [ADR-0021](../adr/0021-cumulative-transactional-automation-budgets.md).
