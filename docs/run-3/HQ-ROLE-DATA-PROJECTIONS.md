# HQ Role Data Projections

Status: **Run 3 Stage 0 local implementation evidence; not production employee-access evidence**

Evidence date: 2026-08-16

## Decision

HQ metadata is not harmless merely because submitted scam content is absent. Household identity,
Check activity, risk, provider state, and time are released only through a role- and
assignment-specific projection. This closes independent-review finding R2-01 without creating an
employee content shortcut.

## Projection matrix

| Role | Global household directory | Global Check metadata | Assigned queue | Restricted customer content |
| --- | --- | --- | --- | --- |
| `hq_owner` | Yes; audited before release | Yes; audited before release | No delegated queue by owner role alone | No owner shortcut |
| `hq_reviewer` | No | No | Exact active fraud work cases only | No; reviewer assignment grants no content |
| `hq_support` | No | No | Exact active open support cases only | Only with the separate exact case/resource/step-up/expiry grant |
| Customer/mobile actor | No | No | No | Governed by customer object policy, never HQ role |

### Owner household projection

Released fields: household ID, household name, active-member count, orientation-ready count,
entitlement state, and explicit local-development provenance.

### Owner Check projection

Released fields: Check ID, household ID, artifact kind, risk, provider state, creation time, and
explicit local-development provenance. Submitted text/URL, encrypted values, fingerprints,
reasoning detail, and action detail are absent.

### Reviewer projection

Released fields: assigned work-case ID, severity, work state, routing class, optional due time,
update time, and explicit local-development provenance.

Explicitly absent: household ID/name, Check ID/activity, risk, provider state, case summary,
submitted content, and restricted-resource identifiers. A reviewer with no current assignment sees
an empty queue. Resolved/closed or differently assigned work is absent.

### Support projection

Released fields: assigned support-case ID, assigned household ID/name, bounded system purpose code
(`customer_support`), open status, assignment time, and explicit local-development provenance. The
free-text support-case purpose is not selected or returned.

Explicitly absent: unrelated household identity, members/roster, orientation, entitlement, Check
activity, risk, provider state, submitted content, and restricted-resource identifiers. Ended
assignments and non-open cases are absent.

### Aggregate provider/system health

Current provider/system health contracts contain no household/customer identifier and remain
owner-only. This implementation does not claim a delegated operations-health role.

## Enforcement path

1. The server resolves the current HQ session and active employee assignments.
2. Central authorization selects one exact projection action.
3. The repository independently rechecks current role and, for delegated queues, the current exact
   assignment.
4. A content-free audit record is written with actor, HQ audience, projection class, correlation,
   outcome, and time.
5. Only after that audit succeeds may the repository release explicitly mapped contract fields.

If audit persistence fails, no projection rows are returned. Clients cannot select actor, role,
assignment, household, or projection scope.

## Local synthetic evidence

The development seed contains:

- one synthetic fraud work case assigned to the reviewer persona;
- one synthetic support case assigned to the support persona; and
- unrelated owner/household/Check fixtures used by negative tests.

Focused authorization, integration, and browser tests exercise direct global-route attempts,
unrelated assignments, suspended/ended state, wrong audiences, content/metadata exclusion, and
audit-write failure. Exact command results belong in the Run 3 evidence dossier after the frozen
candidate gates execute.

## Evidence boundary and remaining gates

This is local simulation over seeded identities and PGlite. It does not prove managed production
identity, MFA/step-up, real PostgreSQL concurrency, deployed staging, real employees, support or
fraud-review quality, customer-visible access history, incident response, or professional
privacy/security approval. No real customer data may enter these projections until the applicable
Run 3 identity, database, deployment, human, and professional gates pass.

Related decision: [ADR-0020](../adr/0020-least-privilege-hq-projections.md).
