# Test Results

Verification date: 2026-08-16

Verdict: **PASS for the bounded local Build Run 1; not a production or first-dollar release approval.**

## Final gate evidence

| Gate                          |                             Result | Interpretation                                                                                                                                                                                                                                             |
| ----------------------------- | ---------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`              |                               PASS | Strict types, ESLint, Prettier, all configured test suites, API bundle, Next web/HQ production builds, and Expo web export passed.                                                                                                                         |
| `npm run test:unit`           |                10 files / 99 tests | Domain, contracts, authorization, security, fraud, configuration, and supporting unit behavior passed.                                                                                                                                                     |
| `npm run test:integration`    |                 4 files / 18 tests | Persistence, API, household/commerce, orientation/HQ, retention, and restart behavior passed.                                                                                                                                                              |
| `npm run test:security`       |                 4 files / 16 tests | Cross-household denial, session/origin boundaries, input minimization, no URL fetch, atomicity, deletion, and seed non-resurrection passed.                                                                                                                |
| `npm run test:eval`           | 12 / 12 cases; 0 forbidden actions | The synthetic, versioned fraud regression passed, including one explicit provider-failure case. Its calibration state is `not_calibrated`.                                                                                                                 |
| `npm run test:coverage`       |               18 files / 133 tests | 89.76% statements, 87.47% branches, 98.24% functions, and 93.00% lines. Included authorization/fraud/security source cleared the aggregate gates (80% statements/functions/lines; 75% branches), and each package's observed branch coverage exceeded 80%. |
| Edge Playwright journey suite |                      13 / 13 tests | Customer, Family, orientation, pagination, HQ, keyboard/reflow, and axe assertions passed in Desktop Edge.                                                                                                                                                 |
| Expo Doctor (online)          |                     21 / 21 checks | The Expo dependency and configuration checks passed after compatibility alignment. This is not native-device evidence.                                                                                                                                     |

The Edge run used `tests/e2e/os-userinfo-host-shim.cjs` only to work around this Windows host intermittently failing Node's `os.userInfo()` with `ENOMEM`; application and Playwright assertions were unchanged. The local web-server teardown lingered after the passing output, so the exact test-server processes were stopped and ports 3100, 3101, and 4100 were confirmed clear.

## Dependency and host observations

`npm audit --omit=dev` reported **0 critical, 11 high, 7 moderate, and 0 low** advisories. The full audit added **1 low** advisory. The high paths are principally current Expo/React Native/Metro transitive dependencies; npm's proposed remediation would require incompatible changes, so no forced downgrade was applied. These unresolved advisories block production release even though they do not invalidate the local test result.

The Codex in-app browser could not reach the running loopback services and then restricted further navigation from its internal error page. This is recorded as an in-app browser host/tool limitation, not a product failure. Edge rendered and exercised all 13 browser tests.

## What this pass establishes

The frozen tree has no unresolved Critical/High application defect in the reviewed Build Run 1 scope. It proves a repeatable local vertical slice, negative authorization controls, bounded accessibility automation, and deterministic action-safety regression. It does **not** establish native-device behavior, representative fraud accuracy, WCAG conformance, production security, real PostgreSQL operations, provider reliability, payment correctness, or customer usability. Those boundaries remain in [Known Limitations](./12-known-limitations.md) and the [Launch Definition of Done](../gauntlet-zero/40-launch-definition-of-done.md).
