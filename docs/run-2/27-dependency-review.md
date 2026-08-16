# Dependency Review

Status: **a prior baseline locked install and clean-clone reconstruction passed; its advisory summary remains unresolved, a fresh post-closure clean clone is pending, and broader supply-chain evidence is incomplete**.

## Evidence collected

The repository pins direct versions and commits `package-lock.json`; Node 22.13+ and npm 10.9+ are required, while CI pins Node 22.13.1 and uses `npm ci`.

Two cached-advisory scans were run:

- `npm audit --offline --omit=dev --json`; and
- `npm audit --offline --json`.

Both reported **0 known vulnerabilities** across the locally resolved tree of 1,173 dependencies (719 production, 405 development, and 145 optional classifications; npm categories can overlap). A prior `npm install --offline --ignore-scripts` completed and reported 0 vulnerabilities. That install reduced lifecycle-script exposure for the local check, but it is not a substitute for building and testing normal installs.

The prior committed baseline clean-clone reconstruction then ran a normal `npm ci` against the registry and completed the locked install, portability check, workspace typecheck, all unit/integration/security/evaluation tests, and all production builds. npm's install-time audit summary reported **19 vulnerabilities: 1 low, 7 moderate, and 11 high**. That summary covers the baseline installed tree; it did not provide a production-versus-development split or enough detail to adjudicate advisory identity, reachability, exploitability, or compatible fixes. It predates the final closure changes and is not evidence that the frozen closure tree passed a clean clone; that fresh post-closure run remains pending.

## Evidence boundary

The offline-zero result is limited to the local npm advisory cache and is superseded for release decisions by the newer baseline install-time summary. Approval escalation for a fresh machine-readable live `npm audit` was denied because it would disclose the private repository's dependency tree/metadata to an external service; therefore Run 2 has prior counts but not a current reviewed advisory inventory. The GitHub workflow is configured to run a production-tree critical audit after `npm ci`, but no external workflow run exists.

No SBOM, license-policy report, package provenance/signature verification, typosquatting review, maintainer-risk analysis, transitive diff review, container-image scan, or automated update policy was completed. Optional/native dependencies and install scripts need staging review before release.

## Launch gate

Before launch, run the fresh post-closure clean clone and an authorized current advisory scan in controlled CI; identify, reachability-review, fix, or explicitly risk-accept the prior 11 high and 7 moderate findings plus any current delta; produce and retain an SBOM; review licenses and high-risk maintainers/scripts; scan built OCI images; and define patch SLAs and emergency rollback. A passing clean clone does not clear dependency risk. Run 2 does not launch.
