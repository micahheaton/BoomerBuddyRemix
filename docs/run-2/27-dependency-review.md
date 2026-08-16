# Dependency Review

Status: **locked local tree and cached-advisory scan reviewed; live-registry and broader supply-chain evidence are unavailable**.

## Evidence collected

The repository pins direct versions and commits `package-lock.json`; Node 22.13+ and npm 10.9+ are required, while CI pins Node 22.13.1 and uses `npm ci`.

Two cached-advisory scans were run:

- `npm audit --offline --omit=dev --json`; and
- `npm audit --offline --json`.

Both reported **0 known vulnerabilities** across the locally resolved tree of 1,173 dependencies (719 production, 405 development, and 145 optional classifications; npm categories can overlap). A prior `npm install --offline --ignore-scripts` completed and reported 0 vulnerabilities. That install reduced lifecycle-script exposure for the local check, but it is not a substitute for building and testing normal installs.

## Evidence boundary

The result is limited to the local npm advisory cache. A live-registry audit was not authorized because it would disclose the private repository's dependency tree/metadata to an external service. Therefore this review does **not** establish that current registry advisories are clean. The GitHub workflow is configured to run a production-tree critical audit after `npm ci`, but no external workflow run exists.

No SBOM, license-policy report, package provenance/signature verification, typosquatting review, maintainer-risk analysis, transitive diff review, container-image scan, or automated update policy was completed. Optional/native dependencies and install scripts need staging review before release.

## Launch gate

Before launch, run an authorized current advisory scan in controlled CI, produce and retain an SBOM, review licenses and high-risk maintainers/scripts, scan built OCI images, and define patch SLAs and emergency rollback. A zero cached finding is not a security certification. Run 2 does not launch.
