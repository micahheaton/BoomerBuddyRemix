# HQ Review

Status: **[IMPLEMENTED] separate local control-plane slice; [BLOCKED] production operations.**

## As-built modules

| Module         | Projection                                                                                                                            | Status                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Overview       | Local household, active-member, retained completed-Check, ready-orientation, and effective-entitlement counts; owner attention notice | **[IMPLEMENTED]** local runtime           |
| Customers      | Household ID/name, member count, orientation-ready count, and canonical entitlement state                                             | **[IMPLEMENTED]** local runtime           |
| Fraud & review | Up to 100 active Check metadata rows: IDs, household, kind, risk, provider state, and time                                            | **[IMPLEMENTED]** content-free projection |
| Revenue        | One saved search, two fictional accounts, and two fictional opportunities with staleness                                              | **[MOCK]** seeded research data           |
| System & audit | Local provider-health cards and up to 100 metadata-only audit events                                                                  | **[IMPLEMENTED]** partial local module    |

Every metric and table identifies `local_development` or `seeded` provenance. Runtime counts combine deterministic seed fixtures with interactions from the current local database; they are not users, customers, revenue, or production evidence.

## Boundary review

- **[IMPLEMENTED]** HQ is a separate Next.js application and session audience. Customer and HQ cookies can coexist, but each audience is rejected at the other's API boundary.
- **[IMPLEMENTED]** `hq_owner` receives all current modules. A seeded `hq_reviewer` is routed to Fraud & review and is denied overview and audit APIs.
- **[SCAFFOLDED]** `hq_support` authorization exists for review and household-list tasks, but no seeded support persona or dedicated support workflow is exposed.
- **[IMPLEMENTED]** The fraud projection's schema cannot carry ciphertext, submitted text/URL, fingerprint, evidence body, or safe word. The browser journey injects a marker artifact and verifies that HQ never renders it.
- **[IMPLEMENTED]** Audit rows expose actor/resource/outcome/time metadata only; revenue rows explicitly say research, synthetic, and not a verified pipeline.

## Metrics truth

The overview intentionally does not show MRR, loss prevented, conversion, or fabricated growth. **[DEFERRED]** Verified safe-action completion and time-to-first-safe-action are not instrumented. Consequently the proposed north-star outcome cannot be computed, partner impact cannot be substantiated, and this gap remains a first-dollar blocker.

## Operational gaps

- **[MOCK]** Provider health reports a local unknown adapter and unavailable optional AI; it is not an external uptime check.
- **[SCAFFOLDED]** The System module exposes health and audit, but not interactive job/outbox controls, replay, incident management, or reconciliation drill-down.
- **[DEFERRED]** Step-up customer-content access, explicit case-purpose grants, reason/expiry workflow, human review queues, partner reporting, production alerts, and CRM/accounting integrations.
- **[BLOCKED]** Production employee identity, organization administration, access reviews, tamper-resistant audit retention, observability, restore/incident drills, and qualified operational ownership.

## Evidence and verdict

`tests/integration/orientation-hq.test.ts` verifies audience separation, content exclusion, provenance, and reviewer authorization. `tests/e2e/hq.spec.ts` verifies labeled local data, content-free fraud review, seeded revenue disclosure, audit disclosure, and reviewer-only navigation. The Edge/axe sweep also covers HQ overview and Fraud & review with no serious or critical findings.

HQ is an honest and useful local operating projection, not a production command center and not a replacement for accounting, CRM, support, or observability tools. Its scope matches [BoomerBuddy HQ](../gauntlet-zero/24-boomerbuddy-hq.md); Run 2 should add only workflows backed by real operating owners and measurable outcomes.
