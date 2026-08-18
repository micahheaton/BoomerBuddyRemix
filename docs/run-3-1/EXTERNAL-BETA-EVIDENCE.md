# Run 3.1 External Beta Evidence

**Recorded:** 2026-08-17

**Status:** runtime candidate A is frozen locally and passed exact-tag offline reconstruction;
registry-backed dependency evidence is blocked on approval, and all external activation evidence
remains unavailable

**Scope:** one trusted, free, web-first Founding Household on Replit, with Stripe and Twilio
disabled and no mobile deployment

## Candidate identity and topology

Runtime candidate A is the only active Run 3.1 runtime candidate. The final commit and tag are
immutable local Git objects; dossier commit B will contain evidence documents and their document
contract test only. Dossier B is not part of the runtime candidate, and the annotated tag must not
be moved to include it.

| Candidate field                                 | Exact status                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch                                          | `codex/run-3-1-replit-founding-household`                                                                                                               |
| Run 3 starting commit                           | `bbe5662ef911d0bdf5f5c2f5083becf135b3f1bd` — historical input only                                                                                      |
| Final Run 3.1 runtime commit A                  | `690958f851a8ba0dd250de55db73eb5c1176ac94`                                                                                                              |
| Final annotated candidate tag                   | `run3-1-replit-founding-household-690958f851a8`                                                                                                         |
| Annotated tag object                            | `eb096717c54f20ab7aedcd0811cc50c7a3b049d4`                                                                                                              |
| Peeled tag target                               | `690958f851a8ba0dd250de55db73eb5c1176ac94`                                                                                                              |
| Final `package-lock.json` SHA-256 and byte size | `e9413102fae62a11818b6fa972d02b8f943f7d71716f6ab3e6b6360d479d8e84`; `576133` bytes                                                                      |
| Exact offline reconstruction receipt            | `OFFLINE_CANDIDATE_RECONSTRUCTION_PASS 690958f851a8ba0dd250de55db73eb5c1176ac94`                                                                        |
| Evidence-only dossier commit B                  | **DOCUMENT-ONLY** — the Git commit containing this dossier and contract test; its SHA exists only after commit and it is not candidate A                |
| Canonical company remote/protected tag receipt  | **UNAVAILABLE** — no Git remote is configured in this checkout                                                                                          |
| Registry audit/inventory/SBOM manifest          | **BLOCKED** — the platform requires explicit approval before disclosing the private dependency graph to the public npm registry; approval was not given |

The earlier annotated tags remain preserved and explicitly superseded, not active candidates:

| Superseded annotated tag                        | Tag object                                 | Peeled commit                              | Clean-reconstruction disposition                                                    |
| ----------------------------------------------- | ------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `run3-1-replit-founding-household-d529b3c368d3` | `608b6f2d8686f651877c6c9f11d3a38e12a2afbe` | `d529b3c368d36764b8096e20593ca813a5b41671` | Superseded when reconstruction required repository text files to be pinned LF.      |
| `run3-1-replit-founding-household-16c429cbd2e4` | `601c75ea16ea958aa7a05d209fa71f516ac1a989` | `16c429cbd2e4a13029dfae2c7caf9f2a294c5258` | Superseded when reconstruction required the Replit tag test to be candidate-stable. |

Neither earlier tag contains the complete A byte set. No tag was deleted or moved.

Any runtime, configuration, migration, dependency, test, or release-control byte change after A
requires a new commit, a new annotated tag whose suffix matches the first 12 commit characters,
and a complete rerun of the candidate-bound gates. Evidence-only dossier B must not change A.

## Evidence classification

| Evidence class                | Current state                        | What it proves and does not prove                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local implementation evidence | **Available at candidate A**         | Production identity, Founding Household, feedback, Replit startup, and portability code is committed in A. This proves source state only, not deployment or provider behavior.                                                                                                                                           |
| Local test evidence           | **Available at candidate A**         | Focused hostile-review receipts cover the exact snapshots below, and a clean detached clone of A passed the offline candidate-wide local matrix recorded below. This does not include registry advisory evidence, real PostgreSQL, provider, deployed, hydrated-browser, human, or production proof.                    |
| Simulated evidence            | **Available**                        | PGlite, in-process Fastify injection, fake Clerk verification/tokens, fake subprocesses, and deterministic local providers exercise intended code paths. Labels such as `production`, `live_production`, or `production-like` inside these tests describe the selected application branch or stored evidence label only. |
| Provider-test evidence        | **Unavailable for the product path** | No authentic Replit, Clerk, Replit PostgreSQL, Stripe-test, Twilio-test, or other product-provider interaction was performed. The historical registry-backed dependency snapshot is supply-chain input, not product-provider proof or final A evidence.                                                                  |
| Deployed Replit evidence      | **Unavailable**                      | No project import, published build, deployment ID, provider port, HTTPS origin, worker process, proxy path, restart, rollback, or Replit log/alert receipt exists.                                                                                                                                                       |
| Human evidence                | **Unavailable**                      | No founder-operated real HQ session, external household, consent/comprehension observation, moderated accessibility/usability session, useful-feedback observation, or willingness-to-pay result exists.                                                                                                                 |
| Production evidence           | **Unavailable and unauthorized**     | No production customer data, external invitation, production session, customer Check, feedback submission, backup, restore, payment, message, DNS change, or public traffic was created by this run.                                                                                                                     |

## Independently reviewed local receipts

The following exact local snapshots were independently rehashed and reviewed without external
calls before the freeze. The paths and bytes are committed in A, but these focused receipts are not
a candidate-wide reconstruction manifest:

| File                                                                      | SHA-256                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/persistence/src/entitlements.ts`                                | `df1d152b5a74592672601c85112ba55ed486c3a737cdf0bc3379b901c8e74537` |
| `packages/persistence/src/feedback.ts`                                    | `7f0c1fb841127c6e49842ea812594ac91e9ef7955478525fd03cd525a1c04199` |
| `packages/persistence/src/feedback.test.ts`                               | `b46144a1b561f5ef611a65f7dae3f5fb9b84b1d0be78cdc1a49b56fe39bf1509` |
| `tests/integration/run3-1-customer-journey.test.ts`                       | `ad817952f0f62afd14c68763aae377b0bf5b6fbbf905ae592bb972a11c171f17` |
| `packages/persistence/migrations/0027_run3_1_feedback_founding_quota.sql` | `697c5e3fc1144b861c7f2a9f5048ab66e36b82ba364fc6de1d6cd910efdd2ec0` |
| `packages/persistence/src/feedback-migration.test.ts`                     | `b976df58b1a2b6b7d68fbab487f5383ee5c3441be414f32036b48c80d5e4d61a` |
| `packages/persistence/src/feedback-production-access.test.ts`             | `d81b5dac2d737db030f4c84e8f01cfd771422a3cfadcc2b01da46da2add6c9e7` |
| `packages/persistence/src/feedback-production-fixture.test-helper.ts`     | `ba8a3d459c89154cb3b46ee4efd8404f9f2113198515ceb160c55181ceb80797` |

Reviewed results were:

- a 14-file Stage 7/feedback hostile matrix passed 177/177 tests;
- a supplemental production-identity/security matrix passed 26/26 tests;
- the exact-current-hash Customer #1 journey passed 1/1 test;
- the remediated feedback quota/admission matrix passed 46/46 tests across six files;
- focused persistence, API, and root type checks, ESLint, Prettier, and whitespace checks passed; and
- the independent reviews reported 0 Critical and 0 High findings inside those exact local review
  boundaries.

The focused reviews above are supplemented by this exact-tag offline reconstruction of A on a
fresh detached Windows checkout with repository-owned LF normalization:

| Candidate-wide local gate | Exact result |
| ------------------------- | ------------ |
| Install | `npm ci --offline --audit=false` completed from the local npm cache; this is reproducibility evidence, not a registry advisory audit. |
| Migration and seed | Fresh local PGlite applied exactly 27 migrations, `0001` through `0027`, then seeded synthetic local data. |
| Source controls | Secret scan passed 615 working-tree text files with its documented limits; API/worker runtime dependency scope passed with 99 named packages; typecheck, ESLint, Prettier, and diff/cleanliness controls passed. |
| Unit | 30 files / 296 tests passed. |
| Integration | 54 files / 401 tests passed. |
| Security | 16 files / 79 tests passed. |
| Fraud evaluation | 12/12 synthetic cases passed with zero forbidden-action violations; calibration remains `not_calibrated`. |
| Builds | API, worker, web, HQ, and mobile builds passed; web and HQ each emitted 19 routes. Mobile was a local compatibility build and is not in any deployable Replit graph. |
| Static production artifacts | Unconfigured-identity web/HQ route bodies failed closed and the mobile bundle omitted local-only actions. Configured/hydrated browser behavior remains unproved. |
| Unit coverage | Statements 89.29%, branches 86.24%, functions 98.4%, lines 92.53%; authorization, fraud, and security remained above 80%. |
| Final checkout | `git status --porcelain` was empty and emitted the exact receipt recorded in the candidate table. |

The separate Edge Playwright matrix passed 21/21 before tagging on the same application bytes; the
only later runtime-candidate changes were repository LF checkout metadata and the candidate-stable
Replit tag security test. It is useful local browser evidence, but it was not rerun inside the exact
offline reconstruction and is not deployed or hydrated-Clerk evidence. The registry-backed
dependency gate and genuine-PostgreSQL verifier remain separately blocked/unexecuted as recorded
below.

## Authentication and authorization evidence

### Local evidence

Local tests exercise these fail-closed properties:

- Clerk RS256 signature verification plus exact issuer, audience, authorized-party, token-age, and
  HQ second-factor requirements;
- distinct customer and HQ identity realms and rejection of a realm swap;
- production refusal of the development identity issuer and development personas;
- server-owned customer person, household, role, entitlement, and Trusted Circle relationships;
- explicit one-time founder bootstrap, conflict refusal, disabled identity behavior, local session
  revocation, provider-session replay refusal, and founder-binding checks;
- founder-only production Founding Household creation, finite sponsor lineage, one-time HMAC-only
  invitation credentials, exact-recipient binding, cohort serialization, expiry/revocation, and
  append-only consent/audit lineage;
- cross-household and guessed-ID denial for Checks, feedback, and family relationships; and
- bounded browser-to-API proxying, cross-origin mutation refusal, duplicate session-cookie refusal,
  unrelated-cookie stripping, and fail-closed production UI configuration.

The Customer #1 test follows the production application branches through founder bootstrap,
finite sponsored enrollment, entitlement hydration, one persisted Check, sign-out and a new
provider session ID, API/database-object restart, feedback submission and founder-only review,
Trusted Circle acceptance/revocation, worker replay, offboarding, and post-revocation denial.

### Evidence limit

That journey runs locally with PGlite, Fastify injection, a fake Clerk verifier and fake signed-token
objects, and a local unknown fraud provider. It does not log into Clerk, create a provider cookie,
open a hydrated browser, contact Replit, or use genuine PostgreSQL. Its production code-path labels
must not be cited as provider-test, deployed, human, or production evidence.

Real customer and HQ Clerk applications, restricted customer sign-up, HQ MFA, issuer/audience and
authorized-party values, browser cookie behavior, logout, disable/recovery, and the founder's exact
provider subject remain unproved.

## Run 2 finding regression matrix

All rows below were included in the exact tagged unit/integration/security reconstruction. They are
not Clerk, Replit edge, authentic PostgreSQL, provider, or production evidence.

| Finding                                  | Candidate command/files                                                                                                                                                                                                            | Required semantics                                                                                                                                                                  | Current evidence tier/result                                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| R2-01 — least-privilege HQ projections   | `packages/authorization/src/authorization.test.ts`, `tests/integration/orientation-hq.test.ts`                                                                                                                                     | Owner, reviewer, and support projections remain distinct; delegated roles cannot enumerate arbitrary household/customer content.                                                    | Local automated evidence inside the final 296-unit/401-integration totals. Provider-created reviewer/support accounts remain unavailable. |
| R2-02 — cumulative transactional budgets | `packages/persistence/src/automation-budget.test.ts`, `packages/persistence/src/automation-budget-migration.test.ts`, `tests/integration/automation-budget-maintenance.test.ts`, plus `npm run verify:postgres` on a disposable DB | Cumulative global/scoped windows serialize, reserve/recheck/commit/release atomically, and no per-request reset is accepted.                                                        | PGlite/local automated evidence; real-PostgreSQL verifier prepared but not executed.                                     |
| R2-03 — Public Check continuity          | `packages/persistence/src/public-checks.test.ts`, `tests/integration/public-checks.test.ts`                                                                                                                                        | A short HMAC-only continuity proof survives legitimate network change while each request is charged to its current network; missing/modified proof and forged forwarding deny.      | Local automated evidence; deployed Replit proxy/Wi-Fi/cellular/VPN proof unavailable.                                    |
| R2-04 — conversion replay semantics      | `tests/security/public-check-conversion.test.ts`, `tests/integration/public-checks.test.ts`                                                                                                                                        | One successful conversion, matching safe replay, conflicting actor/household/consent denial, expiry denial, and unauthorized denial use one documented meaning.                     | Local automated evidence; real external conversion unavailable.                                                          |
| R2-05 — external side-effect outcomes    | `packages/persistence/src/external-actions.test.ts` and worker/security regressions                                                                                                                                                | Stable operation/provider key lineage, known success/failure, unknown outcome, reconciliation, and no blind duplicate retry; DB exactly-once is never called provider exactly-once. | Local fixture/state-machine evidence only; Stripe and Twilio remain disabled and no provider call occurred.              |

## HQ Household #1 capability inventory

| Capability class          | Current exact boundary                                                                                                                                                                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implemented code          | Separate founder HQ authentication/bootstrap, founder-only Founding creation/revocation, policy-scoped customer/household metadata, minimized feedback queue/claim/read, health/readiness, append-only audit evidence, global automation stop, cumulative-budget state, and bounded owner-attention queues. |
| Manual founder workflow   | Create the HQ identity, complete MFA, run one-time founder/program bootstrap, invite the restricted customer in Clerk, copy the exact provider subject, issue/deliver one credential manually, review minimized feedback, disable/offboard on incident, and execute backup/restore.                         |
| Scheduled worker behavior | Durable internal lease/retry processing and the reviewed 15-minute feedback-retention maintenance job. It does not make feedback classification, media, Stripe, Twilio, or outbound-provider calls.                                                                                                         |
| Future or disabled        | Production reviewer/support provisioning, autonomous agents, classification/generation, outbound messaging, media/transcription/email ingestion, provider reconciliation, live payments, referral rewards, and mobile deployment. Documentation or queue names do not make these always-on.                 |

## PostgreSQL and recovery evidence

### Local evidence

- Migrations through the current Run 3.1 chain and repository rules are exercised in PGlite.
- Local tests cover transaction rollback, uniqueness, concurrency simulations, cohort capacity,
  database-authority clocks, cumulative feedback quotas, raw-DML guards, idempotency,
  append-only audit/outbox requirements, retention, and worker restart/replay behavior.
- The portability tool requires a TLS PostgreSQL URL, an exact candidate SHA, an independent
  32-byte backup key, an output outside the repository, no overwrite, an authenticated
  AES-256-GCM container, a disposable restore target and exact destructive confirmation, migration
  comparison, and critical-table count reconciliation.
- Its hostile tests cover tampering, malformed dumps, incomplete output, changed state during
  export, receipt races, wrong restore targets, and reconciliation failure.

### Evidence limit

PGlite is not authentic PostgreSQL. The backup tests use controlled/fake `pg_dump` and `pg_restore`
processes; no customer database was exported. There is no Replit Production PostgreSQL connection,
TLS receipt, role/privilege proof, real migration/concurrency run, multi-process lease test, backup
artifact, founder-controlled off-Replit destination, or successful disposable PostgreSQL restore.
Database restart persistence and worker restart behavior are simulated locally, not observed on
Replit. A database backup alone is insufficient recovery evidence: the artifact-encryption,
fingerprint/HMAC, and safe-word secrets required to interpret restored application state also need
independent founder-controlled escrow, rotation, and recovery proof. No backup, runtime-key escrow,
restore, RPO, or RTO evidence exists.

## Feedback, privacy, and retention evidence

Local code and tests restrict the first-household path to authenticated text feedback, server-owned
tenant lineage, founder-authorized minimized HQ reads, database-authority per-person and
per-household hourly admission limits, content redaction/minimization, retention jobs, and restart
recovery. Operational ciphertext has a one-hour deadline. Research retention is code-bounded to a
24-hour ceiling, while the current UI requests at most 23 hours. The durable retention job is
scheduled at a 15-minute interval. Tests cover concurrent limit-plus-one admission, replay/conflict
charging, rollover, clock skew, cross-household behavior, unauthorized raw DML, orphan migration
rejection, and retention restart.

These receipts do not prove a deployed retention schedule, operator review process, production log
redaction, deletion across backups, customer-facing privacy comprehension, or a reviewed privacy
policy version. Retained provider backups may resurrect deleted content until their independent
retention expires; no backup-deletion proof exists. Media, screenshots, image/audio upload,
voicemail, transcription, inbound email, and arbitrary-file processing remain disabled; no media
deletion claim is made.

## Fraud-safety evidence

The local synthetic evaluation passed 12/12 harness cases with zero forbidden-action violations and
one exercised provider failure. Its calibration remains exactly `not_calibrated`. The corpus proves
harness behavior and action invariants only; it is not representative and supports no accuracy,
efficacy, calibration, or real-world fraud-detection claim.

## Dependency and SBOM adjudication

Candidate A's lock file is exactly `576133` bytes with SHA-256
`e9413102fae62a11818b6fa972d02b8f943f7d71716f6ab3e6b6360d479d8e84`. That byte identity is not
an audit, inventory, reachability analysis, or SBOM.

Earlier non-final Run 3.1 handoff notes reported four distinct advisories behind 19
affected-package entries. Nineteen affected entries are not nineteen distinct GHSAs. The table
below preserves that historical, non-final adjudication so it is not silently lost; this dossier
does not claim persistent raw registry evidence for it or promote it to candidate A evidence.

| Advisory                                 | Severity and package                                  | Snapshot path/reachability adjudication                                                                                                                                                                                                                          | Required disposition                                                                                                                                                                                         |
| ---------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GHSA-w3rx-r6r6-pgpr` / `CVE-2025-71330` | High; `image-size@1.2.1`; no patched release reported | Snapshot path `mobile -> expo@57.0.13 -> @expo/metro@56.0.0 -> metro@0.84.4 -> image-size@1.2.1`. Mobile is built locally as a compatibility gate but excluded from every deployable Replit service build/runtime graph; repository-owned assets only were used. | Temporary containment is valid only while mobile, Expo/Metro, untrusted mobile build assets, and the affected parser remain absent from every deployed service. Reopen immediately if that boundary changes. |
| `GHSA-5p2g-fcmc-qvqq` / `CVE-2025-71329` | High; `image-size@1.2.1`; no patched release reported | Same versioned undeployed mobile-only path and boundary.                                                                                                                                                                                                         | Same time-bounded containment; no statement that the advisory is harmless.                                                                                                                                   |
| `GHSA-w5hq-g745-h8pq` / `CVE-2026-41907` | Moderate; `uuid@7.0.3`; fixed in `11.1.1`             | Snapshot path `mobile -> expo@57.0.13 -> @expo/config-plugins@57.0.8 -> xcode@3.0.1 -> uuid@7.0.3`; the reported caller-buffer API was not reached in the reviewed Replit services.                                                                              | Upgrade through a compatible Expo/Xcode graph, then rerun mobile and web regressions. Do not carry snapshot reasoning across changed bytes without review.                                                   |
| `GHSA-g7r4-m6w7-qqqr`                    | Low; `esbuild@0.27.7`; fixed in `0.28.1`              | Root development/build paths through `tsup@8.5.1` and `vitest@4.1.10 -> vite`; no `esbuild serve` invocation was identified, and esbuild is absent from the deployable runtime graph.                                                                            | Upgrade compatibly and rerun exact candidate audit/build checks.                                                                                                                                             |

The same historical notes said production-only audits for API, worker, web, and HQ reported zero
High or Critical findings at that non-final snapshot. That statement is an unpromoted handoff
record, not a final A gate and not a current registry assertion. The mobile-only containment is
therefore not accepted as final evidence; it must be re-adjudicated from candidate-bound artifacts,
and it expires immediately if mobile, Expo/Metro, untrusted mobile build assets, or the affected
parser enters a deployable service graph.

Persistent candidate-bound registry audit, production-workspace audits, full/workspace inventories,
dependency paths, reachability decisions, CycloneDX SBOM, and evidence-manifest hashes are
**BLOCKED**. Running npm's registry-backed workflow would disclose the private dependency graph to
the public npm registry, and this platform requires explicit approval for that disclosure. No such
approval was provided, so no registry call was made for candidate A and no final audit/SBOM result
is claimed. This is an approval blocker, not a passing result. A founder-authorized dependency
owner must either approve that bounded disclosure or provide an approved private/offline evidence
path, then bind the resulting restricted artifacts and redacted adjudication to A.

## Secrets and cryptographic boundary

The current implementation classifies the enabled beta's artifact-encryption key, fingerprint/HMAC
key, and safe-word pepper as `replit_runtime_secret_beta`: the raw values are needed by API/worker
processes, and the bounded beta design accepts encrypted Replit published-app secrets rather than a
new cloud KMS. Values must be distinct, generated outside source, scoped only to required services,
rotatable, absent from logs, and re-enterable from founder-controlled recovery custody.

Production refuses the development session-signing secret. Clerk verification PEMs are public
verification material, while web/HQ Clerk secret keys remain provider secrets. Live Stripe
credentials and Twilio credentials are not used in Founding Household scope and remain refused or
disabled; their previous managed-KMS boundary is not weakened. The backup encryption key belongs on
a trusted founder machine outside Replit and must not share custody with the runtime or backup
artifact.

This classification is local design evidence. Actual Replit published-secret scoping, availability,
rotation, access logs, operator access, recovery, and loss behavior have not been observed.

## Development-path, logging, and secret review

- Production configuration rejects the development issuer, development personas, PGlite, demo
  seeding, runtime migrations, the development session secret, non-TLS database URLs, Stripe
  credentials/modes, and every reserved Twilio credential/URL.
- Web and HQ proxies fail closed with private no-store 503 responses when their production Clerk or
  origin configuration is absent; API data access remains independently authenticated. The final
  static production artifact check proves only this unconfigured fail-closed branch and absence of
  local action labels. Configured Clerk hydration/browser behavior remains unavailable.
- Local structured-logging/redaction and boundary tests reject or strip Authorization, session-cookie,
  invitation-credential, submitted-content, feedback-content, and provider-secret leakage in the
  reviewed paths. No deployed Replit log stream has been inspected, so production logging truth is
  unavailable.
- `npm run verify:secrets` scanned 615 high-confidence working-tree text files in the exact-tag
  reconstruction. It does not scan Git history, managed secret stores, entropy, operator
  clipboard/history, provider logs, or external systems; the passing local scan does not replace
  those external reviews.

## Replit and browser evidence

Local scripts and security tests prepare one exact service selector, immutable commit/tag binding,
deployment-marker checks, production host/port binding, mobile exclusion, separate web/API/worker/HQ
commands, HTTPS origins, disabled providers, and fail-closed missing configuration. These controls
are source preparation only.

No authentic Replit project, Production PostgreSQL instance, Reserved VM, Autoscale deployment,
background worker, published secret, port mapping, health check, provider build, origin, HTTPS
certificate, response header, restart, proxy, monitoring, rollback, or cost-control receipt is
available. No hydrated customer/HQ UI was tested against the deployed API. Source/static UI checks
do not establish that Clerk hydration, cookies, navigation, consent, Check history, feedback, or HQ
review work in a browser deployment.

## External and founder-controlled blocker register

No individual owner names were supplied, so accountable roles are recorded rather than invented.
The founder must assign a named person for each role before the stated gate.

| Blocker                                                     | Accountable owner                                          | Deadline                                                    | Required action and receipt                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry audit/inventory/SBOM evidence is approval-blocked  | Security/Dependency owner plus founder                     | **Before any deployment or external invitation**            | Obtain explicit approval for the bounded public-npm dependency-graph disclosure or select an approved private/offline path. Then bind restricted raw artifacts, redacted advisory adjudication, lock digest/size, and manifest hashes to A. Until then, this gate remains blocked, not passed.                                            |
| Company source/recovery custody is unproved                 | Founder and Release owner                                  | **Before first Replit import**                              | Create the private company Git remote, require MFA/recovery ownership, protect the release tag, and prove a clean independent checkout without transferring secrets/data.                                                                                                                                                                 |
| Real customer/HQ Clerk realms are absent                    | Founder and Identity/Security owner                        | **Before first API/web/HQ publish**                         | Create separate restricted customer and HQ applications, require and test HQ MFA, configure exact issuer/audience/origins/authorized parties/keys, bind the founder once, and retain provider receipts without secret values.                                                                                                             |
| Synthetic-data provider proof lacks authorization           | Founder plus Identity, Database, Deployment, and QA owners | **Before any provider-backed test is started**              | Obtain separate explicit founder authorization for bounded Clerk, Replit, genuine-PostgreSQL, and deployed-browser tests using synthetic data only. Authorization for local simulation or source review does not authorize provider calls, deployment, or an external invite.                                                             |
| Real Clerk session/browser behavior is unproved             | Identity/Security owner and QA owner                       | **Before first customer invitation**                        | In the deployed HTTPS browser path, verify Secure/HttpOnly/SameSite behavior, expiry/refresh, cross-origin/CSRF controls, logout, revocation, disabled user, replay, wrong realm, and recovery.                                                                                                                                           |
| Replit topology/configuration is absent                     | Founder and Deployment owner                               | **Before first customer invitation**                        | Import the exact tag, prove whether provider builds retain Git/tag metadata, record the injected `PORT`, configure separate web/API/worker/HQ trust boundaries, published-app secrets, disabled providers, immutable release binding, health checks, worker non-exposure, deployment/build IDs, and rollback/cost controls.               |
| Authentic PostgreSQL semantics are unproved                 | Database owner and Engineering owner                       | **Before first customer invitation**                        | Provision Replit Production PostgreSQL with TLS and reviewed migration/runtime privilege separation; run migrations and the real-PG suite for transactions, constraints, concurrency, Founding grants, cumulative budgets, jobs, leases, outbox, retries, API/worker restart, and reconciliation.                                         |
| Off-Replit backup and restore are unproved                  | Founder as recovery custodian plus Database owner          | **Before first customer invitation**                        | Export an authenticated encrypted backup to a founder-controlled destination outside Replit; separately escrow required runtime keys; restore into a disposable genuine PostgreSQL database; reconcile migrations/critical truth; measure RPO/RTO; and retain content-free receipts plus key/artifact separation.                         |
| Hydrated deployed UI and proxy behavior are unproved        | QA/Security owner and founder                              | **Before first customer invitation**                        | Exercise customer and HQ UIs through real HTTPS/Replit proxy paths; verify headers, Clerk hydration, no dev personas, cross-audience isolation, exact origin handling, normal Wi-Fi/cellular/VPN continuation, and forged-forwarding denial. Keep trusted proxy hops at zero until proved otherwise.                                      |
| Production Customer #1 journey is unproved                  | Founder, QA owner, and Database/Worker owners              | **Before inviting Household #1**                            | Execute the documented journey with real identities and genuine PostgreSQL, including tenant-negative tests, persisted Check/history, sign-out/in, API/worker restarts, feedback, founder-only review, Trusted Circle revoke, sponsorship expiry/revocation, and backup/restore. Use synthetic/test data until the final invitation step. |
| Deployed privacy/retention/log behavior is unproved         | Privacy/Security owner and Operations owner                | **Before inviting Household #1**                            | Approve the exact privacy-policy version, inspect deployed logs for credentials/cookies/authorization/customer/feedback content, run text-feedback retention/deletion, verify disabled media paths, and document backup-deletion limits and request handling.                                                                             |
| Support, monitoring, incident, and cost ownership is absent | Founder and named Operations owner/backup                  | **Before inviting Household #1**                            | Establish a reachable support path, alerts, redacted logs, deployment/database health ownership, incident disable/rollback steps, absence coverage, and Replit spend ceiling/alerts; retain one bounded drill receipt.                                                                                                                    |
| Human comprehension and product-safety evidence is absent   | Founder/Product owner                                      | **At the first invite and before any cohort expansion**     | Obtain informed consent from one trusted adult, observe authentication/Check/feedback/offboarding usability, preserve `not_calibrated` fraud-safety truth, record only minimized observations, and stop on comprehension or safety failure. No efficacy or willingness-to-pay claim may be inferred.                                      |

DNS changes are not needed to collect the missing Replit-domain beta evidence and remain a separate
founder-only consequential action. If the founder later chooses a custom domain, exact records,
TLS, rollback, and origin/cookie retesting become additional mandatory gates. Mobile remains outside
the critical path; enabling it invalidates the present dependency containment and requires a new
review.

## Current conclusion

Runtime candidate A is frozen locally, passed the exact offline reconstruction recorded above, and
the reviewed local slices are materially stronger and fail closed. Registry-backed dependency
evidence is approval-blocked, canonical remote custody is unavailable, the genuine-PostgreSQL
verifier was not executed, and no authentic provider, deployed, human, recovery, or production
receipt exists. Candidate A therefore does not satisfy the external beta gate.

The founder runbook may be used to understand the missing actions only. Neither this dossier nor the
runbook authorizes an agent or founder to deploy, configure a provider, invite an external person,
or enter production data. Even synthetic-data provider proof requires separate explicit founder
authorization. An independent reviewer must reissue the executive decision only after every
mandatory pre-invite external gate is satisfied; the first-household human observation remains an
at-invite stop/continue control rather than evidence that can exist before the first invite.
