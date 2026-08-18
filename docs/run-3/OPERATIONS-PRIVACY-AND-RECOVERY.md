# Operations, Privacy, and Recovery

Status: **local controls and plans only; deployed operations and fulfillment unproved**

## Incident and stop boundary

The founder kill switch and provider-specific stops are precautionary controls, not incident-response
evidence. Engage them for authorization uncertainty, duplicate/unknown provider action, payment or
entitlement mismatch, unredacted telemetry, retention failure, identity compromise, restore
divergence, or loss of audit/reconciliation truth. Preserve redacted evidence and do not clear an
unknown provider outcome from elapsed time alone.

Severity guidance:

- `critical`: possible unauthorized access, secret/key compromise, incorrect live money movement,
  destructive loss, or uncontrolled external communication;
- `high`: material tenant/privacy/entitlement/reconciliation uncertainty with fail-closed impact;
- `medium`: bounded local/deployed degradation with no known authority or data breach;
- `low`: documentation, usability, or nonconsequential operational defect.

No hosted alert receipt, on-call staffing, or founder-absence tabletop has occurred.

## Privacy fulfillment truth

The current privacy workflow records identity review and a content-free plan. It does not claim that
an access package was delivered or that correction, restriction, export, or deletion finished.
The generated plan is a non-exhaustive local scaffold, not the authoritative data inventory: it
does not enumerate every Run 3 table, processor, object, or backup. A versioned inventory registry,
representative coverage tests, processor ownership, and external-store reconciliation are blocked
before any fulfillment-complete claim.
Plans must inventory, as applicable:

- identity, sessions, memberships, household and Trusted Circle relationships;
- submitted artifacts, analyses, shares, and retained/pseudonymized audit facts;
- consent, orientation, Founding Household enrollment and sponsorship evidence;
- commerce, invoice/payment lineage, entitlements, allowances, refunds/disputes, and reconciliation;
- support, fraud/review, lifecycle, research, referral, editorial, and external-action evidence;
- Feedback record/state/assignment/read/retention evidence and active-store encrypted payload state;
- provider/processor copies, object/media stores, backups, restores, and legal retention holds.

Append-only legal, security, commerce, consent, audit, and correction records are not described as
deleted when policy requires retention. The plan must distinguish erasable payload, restricted
access, retained/pseudonymized evidence, processor-pending work, and backup-expiry reconciliation.

## Recovery checklist

An independent recovery proof must bind an immutable candidate tag and commit, restore PostgreSQL
and any objects into separately controlled infrastructure, recover identity/KMS versions, start one
API and one worker, reconcile row counts/checksums/projections/provider truth, verify retention and
withdrawal states, exercise alert receipt and stop controls, and time both cutover and rollback.

Current local PGlite migrations, seed rollback/idempotence, build, and portability checks do not prove
managed PostgreSQL roles, backup integrity, object recovery, processor deletion, DNS, edge, KMS,
monitoring, or founder absence. Those remain explicit `blocked` gates before activation.

## Stage 15 before-GO control matrix

| Required proof | Current evidence tier | Status / exact blocker |
| --- | --- | --- |
| Error monitoring | none | **Blocked:** no hosted capture, redaction review, alert receipt, or retained incident event. |
| Privacy-minimized analytics | local design only | **Blocked:** no deployed analytics processor, approved event dictionary, consent review, or deletion/opt-out reconciliation. |
| Redacted logs | local simulation | Local logger/redaction tests and secret scanning exist; deployed log sinks, access, retention, and sampled-event review are **blocked**. |
| Alert routing | none | **Blocked:** no paging destination, receipt, escalation acknowledgement, or after-hours owner. |
| Incident runbooks | local plan | Stop/severity guidance exists; tabletop execution, evidence capture, regulator/customer decision paths, and owner acknowledgement are **blocked**. |
| Provider outage handling | local fail-closed fixtures | Stripe ambiguity and provider-zero paths are modeled; no authentic Stripe/Twilio outage, callback backlog, recovery, or reconciliation evidence. |
| Support routing | local simulation | Exact-assignee content-free/JIT boundaries and queues pass locally; staffing, deployed identity, response time, and handoff evidence are **blocked**. |
| Identity recovery | none | **Blocked:** managed identity, MFA recovery, break-glass custody, revocation, and recovery drill do not exist. |
| Billing/refund operations | local Stripe fixtures | Exact invoice/payment/refund/dispute lineage passes locally; authentic test account, accounting/tax review, provider reconciliation, and support drill are **blocked**. |
| Privacy fulfillment | evidence-plan only | Requests remain `in_progress`; export, correction, restriction, deletion, identity verification, and recipient delivery have not been performed. |
| Media/object deletion | unavailable | No production media/object pipeline is enabled; future object inventory, quarantine, deletion, and restore reconciliation are **blocked**. |
| Processor/backup reconciliation | none | **Blocked:** no processor register, backup expiry receipt, deletion propagation, restore comparison, or legal-hold decision. |
| Full restore | local migration/seed only | PGlite migration and rollback checks are not managed PostgreSQL/object/KMS restore evidence; the complete restore drill is **blocked**. |
| Kill switch | local control | Local global/provider stop semantics exist; deployed authorization, alert receipt, restart, rollback, and founder-approved drill are **blocked**. |
| Founder-absence tabletop | none | **Blocked:** no named delegate, custody transfer, on-call schedule, recovery authority, or timed tabletop. |

## Accountable roles before the next GO review

- founder/release and recovery owner;
- database/backup owner;
- identity/KMS owner;
- privacy and qualified legal reviewer;
- billing/accounting/tax owner;
- incident/on-call and customer-support owner;
- accessibility/device owner;
- provider-specific owners for payment and communication.

Named people and dates are intentionally not invented. Missing assignment is itself a blocker and
must be resolved in the final activation checklist.
