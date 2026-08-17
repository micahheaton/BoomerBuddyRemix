# ADR-0020: Least-Privilege HQ Metadata Projections

Status: **Accepted for Run 3 local implementation; production identity evidence remains blocked**

Decision date: 2026-08-16

## Context

The independent Run 2 review found that `hq_support` could enumerate the global household
projection and that both `hq_support` and `hq_reviewer` could enumerate the global Check metadata
projection. Those responses omitted submitted content but still exposed household identity, Check
activity, risk, provider state, and time without an exact work assignment. In a scam-safety product,
that operational metadata is sensitive.

[ADR-0010](./0010-separate-customer-and-hq-applications.md) keeps HQ separate from customer
identity and makes customer content absent by default. [ADR-0011](./0011-orthogonal-household-authority-and-pairwise-trust.md)
makes employee eligibility, support-case assignment, and restricted-resource grants independent
facts. This decision applies those rules to metadata projections as well as content.

## Decision

HQ uses four distinct projection classes:

| Projection | Eligible role | Fields released |
| --- | --- | --- |
| Owner household directory | Current active `hq_owner` | Household ID/name, member count, orientation-ready count, entitlement state |
| Owner Check operations | Current active `hq_owner` | Check ID, household ID, kind, risk, provider state, time; never submitted content |
| Assigned fraud queue | Current active `hq_reviewer` with exact current work assignment | Work-case ID, severity, state, routing class, due/update time |
| Assigned support queue | Current active `hq_support` with exact current support-case assignment | Case ID, assigned household ID/name, system purpose code, status, assignment time |

The owner projections remain global because the current owner is the accountable company operator.
Each sensitive projection read must persist an actor-bound, correlation-bound, content-free audit
record before any rows are released. An audit failure fails the request closed.

Reviewer and support queue authorization is evaluated before the owner-global shortcut. Owner status
alone does not imply a delegated assignment. Reviewer output deliberately omits household identity,
Check identity/activity, risk output, provider output, case summary, and customer content. Support
output deliberately omits household rosters, orientation, entitlements, Check/risk/provider metadata,
free-text case purpose, and customer content. The queue emits only the bounded
`customer_support` system purpose code; it never projects the support case's arbitrary `purpose`
column. Repositories recheck current employee role and exact assignment in persistence;
they do not accept a client-selected employee, household, case, or projection scope.

Aggregate provider/system health remains identity-free and owner-only in this implementation. A
future delegated health view must retain an identity-free contract and receive separate policy and
tests.

Exact restricted-customer-resource access is unchanged. Support requires a current open case, exact
active assignment, separately issued exact resource grant, purpose, recent step-up assurance, and
unexpired grant. Reviewer assignment does not grant restricted content. Owner status is not a
content superuser shortcut.

## Schema and migration consequence

No migration is required. The assigned support projection uses `support_cases` and
`support_case_assignments`; the assigned reviewer projection uses the existing fraud
`hq_work_cases.assigned_person_id` fact. Run 3 adds only synthetic local assignments needed to prove
the projection behavior. If a later reviewer workflow needs exact Check/risk rows, it requires a new
exact analysis-assignment lifecycle and a separate decision; household-wide inference is forbidden.

## Security and privacy consequences

- Direct calls to the old global endpoints by reviewer or support roles return `403` without data.
- Suspended employees, ended support assignments, closed cases, resolved work, and unrelated
  assignments produce no queue rows.
- Projection audits contain only actor, projection class, audience, correlation, outcome, and time;
  no household/customer/Check identifier or content is copied into audit metadata.
- Assigned support responses contain a bounded system purpose code, never the free-text case purpose.
- Read auditing is a release prerequisite, not asynchronous best effort.
- The customer/HQ origin, session, and audience boundary remains unchanged.

## Verification

Authorization tests cover owner, reviewer, support, suspended, dual-assignment, and wrong-audience
decisions. API integration tests cover assigned-only filtering, direct global-route denial,
content/metadata exclusion, content-free audit records, and audit-failure fail-closed behavior.
Browser tests cover reviewer and support routing and prove that owner navigation and unrelated seeded
households/Checks do not appear on delegated screens.

All current evidence is local and synthetic. These tests do not establish production identity,
employee training, real support/review operations, legal sufficiency, or customer-visible access
accountability.

## Rejected alternatives

- Treating “no submitted content” as sufficient minimization: household and risk activity remain
  sensitive.
- Filtering global Check rows by assigned household: that still reveals unrelated Checks within the
  household and turns one case into household-wide surveillance.
- Trusting hidden navigation: direct API access must enforce the same policy.
- Granting owner, reviewer, or support a customer-content superuser role: contradicts the authority
  graph and consent boundary.
- Adding a new assignment migration before it is needed: the existing case/work assignment facts are
  sufficient for the minimal Run 3 projection.
