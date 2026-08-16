# Analytics and Metrics

## Canonical event rules

Events are versioned, immutable facts with an ID, occurred-at time, actor/subject references, household or organization scope where lawful, source, schema version, and correlation ID. Never place raw submitted content, safe words, credentials, full URLs with sensitive query strings, or free-form support notes in analytics.

## Day-one scorecard

| Dimension | Measures |
|---|---|
| Safety | false-negative/positive rates on reviewed fixtures, calibration, action-safety pass rate, high-risk escalation completion |
| Product | check completion, time to result, time to safe action, return checks, history deletion |
| Activation | practice completion, orientation state, protected-member activation, active Trusted Circle relationship |
| Growth | landing → check → account → activated → paid, attribution confidence, referral acceptance |
| Revenue | MRR/ARR, ARPU, plan mix, gross margin, churn, refunds, payment recovery |
| B2B2C | eligible, enrolled, activated, retained, partner-funded seats, pilot outcomes |
| Operations | review backlog/age, support SLA, provider latency/errors, cost per check, audit anomalies |

“Fraud prevented” is not a routine product event; count it only under a documented, human-reviewed attribution method. Keep product analytics pseudonymous where possible and separate it from fraud-evaluation data.

## Diligence assets

Retain metric definitions, event schema versions, consent provenance, data lineage, cohort logic, evaluation snapshots, and reconciliation procedures. A future acquirer should be able to reproduce reported retention, revenue, and quality metrics rather than trust dashboard screenshots.
