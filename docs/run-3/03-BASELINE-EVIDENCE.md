# Run 3 Baseline Evidence

Status: **verified local baseline; no external staging, production, launch, or first-dollar evidence**

Recorded: 2026-08-16

## Source boundary

- Required starting commit: `a66a24d3b826d602e20f2976375d140801f893ed`
- Verified starting commit: `a66a24d3b826d602e20f2976375d140801f893ed`
- Run 3 branch: `codex/run-3-first-dollar`
- Annotated baseline tag: `run3-baseline-a66a24d`
- Initial working tree: only the three expected untracked Run 3 handoff documents; no tracked change or other untracked file
- `reference/boomerbuddy-v1/`: ignored, untracked research input, so Git cannot attest its contents; the BoomerBuddy 2.0 runtime-isolation guard passed and no runtime import is permitted

The three handoff files were preserved without reset, clean, overwrite, or discard.

## Reproduced local gate

| Gate | Result | Evidence boundary |
| --- | --- | --- |
| Workspace TypeScript | PASS | Local Node/npm toolchain only |
| ESLint | PASS | Zero warnings |
| Prettier | PASS | Frozen baseline files |
| Unit | PASS — 16 files, 165 tests | Local deterministic tests |
| Integration | PASS — 18 files, 81 tests | PGlite/local adapters; 123.90 seconds on this host |
| Security | PASS — 6 files, 19 tests | Local security regressions, not a penetration test |
| Fraud evaluation | PASS — 12/12 | Zero forbidden-action violations; one intentional provider-outage case; `not_calibrated` |
| Coverage | PASS — 40 files, 265 tests | 90.20% statements, 88.35% branches, 98.19% functions, 93.67% lines |
| API build | PASS — 536.09 KB | No deployment |
| Worker build | PASS — 1.08 MB server, 553.33 KB migrate | No managed worker execution |
| Web build | PASS — 13 static pages | No hosted customer traffic |
| HQ build | PASS — 12 static pages | No real employee/customer data |
| Expo web export | PASS — 428 modules | No native-device or store proof |
| Edge browser | PASS — 15/15 in 2.4 minutes | Local seeded personas only |
| Portability/V1 isolation | PASS | External remote, restore, DNS, OCI, and hosted PostgreSQL remain unproved |

## Host-only execution notes

The ordinary combined verification reached the evaluation launcher and then hit the known Windows `uv_os_get_passwd` `ENOMEM` host failure. The existing repository host shim was resolved to an absolute path and used only through `NODE_OPTIONS`; the evaluation then passed 12/12. This is a host-tool workaround, not product configuration.

The first sandboxed production build could not traverse the workspace path. The same build was rerun outside that filesystem restriction and passed. This was sandbox evidence, not a product failure.

All 15 Edge tests completed successfully. Windows Playwright teardown lingered afterward. Only the verified API/web/HQ listener PIDs owned by that test run were stopped; Playwright then exited `0` and printed `15 passed (2.4m)`. Ports 3100, 3101, and 4100 were confirmed clear. Next-generated `next-env.d.ts` drift was attributed to the baseline build and restored exactly; it was not preserved as a Run 3 source change.

## Explicitly not proved

- fresh registry advisory details or reachability adjudication;
- real PostgreSQL concurrency, least-privilege roles, pooling, backup, or restore;
- an OCI image start in an alternate target;
- Replit deployment or authentic loss recovery;
- managed identity or KMS;
- Stripe-owned test-mode execution;
- deployed Public Check edge controls;
- native iOS/Android behavior;
- provider quality, human validation, revenue, conversion, calibration, production readiness, or first-dollar readiness.

The attempted fresh network advisory audit was denied because it would disclose the repository dependency graph externally. It was not retried or routed around that decision. A materially safer offline cache audit reported zero known cached advisories across 1,173 dependencies, but this is not fresh registry evidence. A local CycloneDX 1.5 generation check found 1,023 components and 1,024 dependency nodes. Detailed current advisory adjudication remains a provisioning/security blocker.

## Interpretation

This evidence reproduces the frozen local Run 2 baseline before Run 3 implementation. It does not carry any Run 2 scaffold or local fixture across an external-evidence boundary. The mandatory independent-review findings remain open until their Run 3 implementations and adversarial regressions pass.
