# Fraud Evaluation Results

Status: **[IMPLEMENTED] harness baseline passed; [BLOCKED] production accuracy and calibration claims.**

## Executed result

On 2026-08-16 the versioned runner completed corpus `boomerbuddy-run-1-synthetic` v1:

| Measure                     |           Result |
| --------------------------- | ---------------: |
| Synthetic cases             |               12 |
| Passed / failed             |           12 / 0 |
| Forbidden-action violations |                0 |
| Provider failures exercised |                1 |
| Calibration                 | `not_calibrated` |

The mutually exclusive exploratory confusion summary was TP 6, FP 1, TN 0, FN 0, abstained 2 (malicious abstained 0), with 3 borderline cases excluded. These values describe this authored fixture set only; they are not accuracy, prevalence, or safety estimates.

The corpus covers gift-card secrecy, remote support, credential requests, authority threats, family-emergency payment, benign messages, benign urgency, possible impersonation, structural URL risk, prompt injection, and provider outage. It contains six malicious, three legitimate, and three borderline examples. Provenance is project-authored synthetic, adjudication is single-author, and sensitivity is non-sensitive.

## What the result proves

- **[IMPLEMENTED]** Deterministic `normalize-v1`, `signals-v1`, `score-v1`, and `actions-v1` execute reproducibly.
- **[IMPLEMENTED]** Required evidence and safe actions are checked case by case. The forbidden set rejects recommendations to pay, reply, share credentials or codes, install remote access, or use contact details from the submission.
- **[IMPLEMENTED]** The injection fixture cannot change policy or introduce a forbidden action.
- **[IMPLEMENTED]** Provider outage is explicit missing evidence and does not lower concern.
- **[IMPLEMENTED]** URL analysis inspects characters and structure only; it performs no DNS resolution or fetch.

## What it does not prove

- **[MOCK]** The only configured reputation adapter is `local-unknown`; there is no live threat-intelligence evidence.
- **[SCAFFOLDED]** Provider interfaces and versioned evidence exist, but provider comparison, cost, freshness, and rollback evidence do not.
- **[DEFERRED]** A licensed, representative, independently double-reviewed and adjudicated corpus; sealed evaluation split; subgroup analysis; confidence intervals; and calibrated thresholds.
- **[BLOCKED]** Any claim that BoomerBuddy detects a known percentage of scams, prevents loss, or produces calibrated confidence.

Run with `npm run test:eval`. In this Windows Codex host, `os.userInfo()` intermittently returned `ENOMEM`; the host-only shim in `tests/e2e/os-userinfo-host-shim.cjs` allowed the unchanged runner to execute. See the evaluation policy in [Fraud Evaluation Lab](../gauntlet-zero/12-fraud-evaluation-lab.md).

## Verdict

The lab is adequate as a Build Run 1 regression and action-safety baseline. It is not first-dollar fraud-quality evidence. A production launch remains blocked on representative adjudicated data, declared thresholds, live-provider evaluation, and qualified fraud review.
