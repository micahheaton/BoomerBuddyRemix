# Technical Debt

The frozen Build Run 1 tree has no open Critical/High application defect in its bounded local scope. This register prioritizes work needed to preserve the trust model as the system moves beyond local fixtures; “release-blocking” below describes launch impact, not a newly discovered defect severity.

## Release-blocking debt

| Debt                                                        | Required closure evidence                                                                                                                                                                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High dependency advisory paths in Expo/React Native/Metro   | Adopt compatible patched releases without `--force`; rerun full audit, Expo Doctor, native build/device suites, and web/API regression. Document any time-bounded exception with owner and compensating control. |
| Development identity and local key material                 | Real customer/employee identity with MFA/step-up/recovery; managed KMS and rotation; negative audience/object tests; external security review. Production refusal must remain until these pass.                  |
| In-process retention/outbox execution                       | Durable, idempotent workers with leases, bounded retry, dead letter/replay, privacy deadlines, multi-instance tests, alerts, and operator runbooks.                                                              |
| Local-only database evidence                                | Managed PostgreSQL staging migration/concurrency/lock/failure tests, backup/restore drill, least privilege, and an explicit row-level-security decision.                                                         |
| Mutable consent and incomplete protected enrollment surface | Identity-bound enrollment/withdrawal API and UI, append-only consent evidence, versioned disclosures, coercion/recovery handling, and legal/privacy review.                                                      |

## Next engineering tranche

| Debt                                                                   | Actionable acceptance test                                                                                                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expired invitation rows and consent remain logically active in storage | A transactional expiry worker changes invitation/consent state; preview/accept/cancel and concurrent expiry remain fail-closed and idempotent.                                      |
| Seed emptiness check covers selected tables only                       | A schema-wide occupancy assertion rejects every unmarked nonempty database, including inbox, reconciliation, audit, and outbox-only fixtures; marked restarts remain exact no-ops.  |
| No general request idempotency for Check mutations                     | Versioned idempotency keys return the original result, reject payload mismatch, isolate households, survive restart, and expire under documented retention.                         |
| Provider lifecycle dates are under-specified                           | Trial, renewal, grace, cancellation, refund, and revocation clocks have canonical transitions, boundary tests, and reconciliation rules.                                            |
| Permission naming differs between documents and runtime                | One canonical registry generates or validates contract, authorization, database, UI, and documentation identifiers; stale names fail CI.                                            |
| Verified safe-action outcome is absent                                 | Define a consented, auditable outcome event that cannot be inferred from a click; publish denominator, provenance, late-event, and retraction rules before HQ displays it.          |
| Native behavior lacks a test target                                    | Establish reproducible Android and iOS build/device matrices covering session storage, household switching, share intake, offline/error behavior, VoiceOver/TalkBack, and deletion. |
| Fraud evaluation is synthetic and uncalibrated                         | Add licensed representative data, two independent reviewers plus adjudication, sealed evaluation, subgroup reporting, thresholds, confidence intervals, and provider-outage cases.  |

## Tooling debt versus product debt

The Windows host's intermittent `os.userInfo()` `ENOMEM`, lingering Playwright server teardown, and in-app browser loopback/navigation restriction are test-host/tool issues. They did not change application assertions, and the Edge suite passed 13/13. Reproduce clean CI lifecycle on the chosen build host, but do not mislabel these observations as customer-facing defects.

Priorities should be revisited after real user evidence, not used as permission to broaden the artifact roadmap. See [Known Limitations](./12-known-limitations.md) and the [Risk Register](../gauntlet-zero/39-risk-register.md).
