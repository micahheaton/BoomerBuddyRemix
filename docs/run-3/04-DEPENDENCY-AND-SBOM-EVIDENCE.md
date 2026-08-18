# Run 3 Dependency and SBOM Evidence

Status: **local inventory complete; fresh advisory identity and reachability adjudication blocked; launch-candidate supply-chain gate not passed**

Recorded: 2026-08-16

Rechecked locally: 2026-08-17

## Frozen inputs

- Node: `v22.18.0`
- npm: `10.9.3`
- lockfile version: `3`
- `package-lock.json` SHA-256: `157C847A2A7E88D3A566FE722F70B477DA73E1206A01B401FC2C4FEE96122B0E`
- lockfile size: `570821` bytes
- locked `node_modules` package entries: `1154`

These facts identify the dependency input. They do not establish that a package is safe, maintained, licensed for every use, or reachable in production.

## Advisory evidence

| Evidence | Result | Interpretation |
| --- | --- | --- |
| Run 2 post-closure clean-clone install | npm reported 19 vulnerabilities: 1 low, 7 moderate, 11 high | Current advisory identities, paths, reachability, and fixed versions were not retained in the repository |
| Run 3 fresh registry-backed `npm audit --json` | Not run; execution was denied because it would disclose the dependency graph externally | No retry, alternate registry, indirect upload, or workaround was attempted |
| Run 3 `npm audit --offline --json` | 0 cached advisories across 1,173 dependencies | Cache-only evidence; explicitly not fresh registry or launch evidence |

The apparent difference between 19 install-time findings and zero offline cached findings is unresolved. No High is dismissed because it is transitive, development-only by assumption, or absent from a stale cache. Until a founder/company-controlled environment runs and retains the current detailed advisory result, BoomerBuddy cannot produce the required package/advisory/CVE-or-GHSA, dependency path, runtime/build/dev reachability, exploit preconditions, fixed version, and remediation-or-acceptance record.

## Local SBOM generation check

`npm sbom --sbom-format cyclonedx` generated valid CycloneDX 1.5 JSON locally:

- components: `1023`
- dependency nodes: `1024`
- root component: `BoomerBuddy`

This proves the locked tree can emit a machine-readable SBOM. The final candidate still needs a retained SBOM generated from a clean candidate install, artifact digest linkage, license review, package provenance/signature review where available, and OCI-image comparison.

The current lock contains 1,135 external `node_modules` package records. Every one has both a registry `resolved` URL and an integrity digest; none resolves from Git or a non-npm registry origin. This is reproducibility metadata, not proof that a publisher identity, provenance attestation, package signature, or package contents are trustworthy.

## License inventory

The lockfile declares these leading license counts:

| License expression | Package entries |
| --- | ---: |
| MIT | 951 |
| ISC | 49 |
| Apache-2.0 | 48 |
| BSD-3-Clause | 28 |
| MPL-2.0 | 14 |
| BSD-2-Clause | 12 |
| LGPL-3.0-or-later | 10 |
| BlueOak-1.0.0 | 8 |
| UNLICENSED private workspace definitions | 19 |

All 19 private `@boomerbuddy/*` workspace manifests and their lockfile definitions now explicitly declare `UNLICENSED`. The lockfile also contains 19 license-less `node_modules/@boomerbuddy/*` link records for those same workspaces; they are not 19 additional components. npm's CycloneDX generator omits the non-SPDX `UNLICENSED` value from each private workspace component's `licenses` array, so the generated SBOM still needs a documented proprietary-license enrichment step rather than being represented as complete license evidence. Optional Sharp/libvips platform artifacts carry LGPL or combined expressions and require distribution review for the deployed artifact. `argparse` declares Python-2.0, `caniuse-lite` declares CC-BY-4.0, and `node-forge` declares a BSD-or-GPL choice; these are inventory facts, not a legal conclusion.

## Installed-tree hygiene

Local `npm ls --depth=0 --json` returned exit code zero but reported two extraneous installed packages: `@emnapi/runtime@1.11.3` and `@img/sharp-wasm32@0.35.3`. Neither is a declared top-level dependency. This may reflect optional-platform build residue in the existing working installation. No package was deleted. A clean-candidate `npm ci` must prove whether either remains and the final SBOM must come from that clean installation.

## Founder/company-controlled completion steps

No secret is required in source or documentation. In a company-controlled CI/security environment:

1. check out the frozen candidate tag on a clean runner;
2. run locked `npm ci`;
3. run `npm audit --json` against the approved registry and retain the raw result as a restricted build artifact;
4. run `npm sbom --sbom-format cyclonedx` and retain the SBOM with the commit and artifact digests;
5. provide a redacted adjudication containing only advisory ID, package/path, affected surface, reachability, preconditions, fixed version, action, owner, deadline, and accepted residual risk;
6. regenerate after remediation and prove no applicable unresolved Critical/High remains;
7. scan the built OCI image and compare its runtime component set with the source/install SBOM; and
8. obtain qualified license/provenance review before distribution where required.

Do not paste registry credentials, private advisory artifacts, recovery codes, signing material, or internal repository tokens into prompts, source, screenshots, or logs.

## Candidate enforcement prepared in Run 3

- CI now runs for immutable `run3-local-candidate-*` tags as well as pull requests and `main`.
- CI uses the repository's High advisory threshold without omitting development packages, runs the
  focused coverage gate, retains a CycloneDX artifact, and has a separate Windows Edge job.
- The OCI runtime dependency stage performs a lockfile-backed production-only install scoped to the
  API and worker workspaces, removes bundled internal-workspace links, and does not copy the build
  dependency tree. A local graph verifier requires the external runtime packages and rejects known
  web, native, browser-test, TypeScript, and test-runner packages from that selected graph. A built
  OCI SBOM is still required to prove the resulting image bytes.
- The local and external-source reconstruction scripts require an exact candidate tag and
  40-character commit, check out detached, assert `HEAD`, and refuse a dirty reconstructed tree.

These controls are source preparation, not executed company-CI evidence. GitHub actions are pinned
to the full commit IDs independently resolved from their official Git repositories on 2026-08-17.
The Node and PostgreSQL image tags are paired with the multi-architecture manifest digests returned
by the official Docker registry on 2026-08-17. No candidate SBOM, advisory result, provenance
attestation, OCI scan, or Edge artifact has yet been retained by company CI.

## Gate decision

The Run 3 dependency gate is `blocked`, not passed. Independent engineering can improve manifest license truth, generate reproducible local inventory, remove unnecessary dependencies, and prepare clean-run scripts. Founder/company-controlled current advisory retrieval and accepted risk ownership remain external evidence.
