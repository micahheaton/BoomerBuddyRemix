# REMEDIATE_BEFORE_EXTERNAL_USER

**Decision date:** 2026-08-17

**Decision scope:** one trusted, free, web-first Founding Household on Replit

**Activation authority:** none; this document grants neither founder nor agent deployment or invite
authority

## Decision

Run 3.1 runtime candidate A is frozen locally at
`690958f851a8ba0dd250de55db73eb5c1176ac94`. Its annotated tag is
`run3-1-replit-founding-household-690958f851a8`, tag object
`eb096717c54f20ab7aedcd0811cc50c7a3b049d4`, peeled to the same runtime commit. The final lock is
`576133` bytes with SHA-256
`e9413102fae62a11818b6fa972d02b8f943f7d71716f6ab3e6b6360d479d8e84`.

That local freeze is necessary but insufficient. A clean detached checkout of the exact tag passed
the offline candidate matrix and emitted
`OFFLINE_CANDIDATE_RECONSTRUCTION_PASS 690958f851a8ba0dd250de55db73eb5c1176ac94`.
Persistent candidate-bound registry audit, dependency inventory, reachability evidence, and SBOM
are blocked because the platform requires explicit approval before disclosing the private
dependency graph to the public npm registry, and no approval was given. No authentic external path
evidence exists. Earlier `d529b3c368d3` and `16c429cbd2e4` tags remain preserved but are superseded
by clean-reconstruction fixes and are not active candidates. Evidence-only dossier commit B must
not move or redefine candidate A.

The production-labeled Customer #1 test is local simulation: PGlite, in-process Fastify injection,
a fake Clerk verifier/tokens, and local provider seams. It does not prove genuine PostgreSQL,
Clerk, Replit, browser cookies, a hydrated UI, deployment restarts, an external backup/restore, a
real household, human comprehension, product usefulness, fraud-detection efficacy, or willingness
to pay.

The reviewed local auth/Founding/feedback slices reported 0 Critical and 0 High findings within
their exact source and test boundaries. Focused receipts include 177/177 Stage 7/feedback hostile
tests, 26/26 supplemental production-identity/security tests, and 1/1 Customer #1 journey test. The
exact-tag offline reconstruction additionally passed 296 unit, 401 integration, and 79 security
tests; 12/12 synthetic fraud cases with calibration still `not_calibrated`; all workspace builds;
the static production-artifact gate; and coverage of 89.29% statements, 86.24% branches, 98.4%
functions, and 92.53% lines. Those results support continued remediation; they are not provider,
deployed, hydrated-browser, genuine-PostgreSQL, human, or production-readiness findings. No passing
result is inferred from the blocked dependency gate.

## Dependency decision

Historical non-final handoff notes reported four distinct advisories behind 19 affected-package
entries. No persistent raw registry artifact is claimed for candidate A:

- two `image-size` High advisories, `GHSA-w3rx-r6r6-pgpr` / `CVE-2025-71330` and
  `GHSA-5p2g-fcmc-qvqq` / `CVE-2025-71329`, with no patched release reported, were confined to the
  excluded mobile -> Expo/Metro graph;
- `GHSA-w5hq-g745-h8pq` / `CVE-2026-41907` was Moderate in a mobile Expo configuration/Xcode path
  and has a fixed `uuid` version, `11.1.1`; and
- `GHSA-g7r4-m6w7-qqqr` was Low in a build/development `esbuild` path with no `serve` invocation and
  has a fixed version, `0.28.1`.

Those same historical notes reported zero High/Critical findings in API, worker, web, and HQ
production-only graphs at the non-final snapshot. The notes are preserved for follow-up, not
promoted into A evidence. No final mobile-only High acceptance is made. Candidate-bound audit,
inventory, SBOM, path/reachability adjudication, and proof of zero unaccepted reachable
Critical/High findings in deployable graphs remain a hard gate after an approved evidence path is
available.

## Why the gate remains closed

Before one external person is invited, the founder and named owners must complete and retain all
mandatory receipts in `EXTERNAL-BETA-EVIDENCE.md`, including:

1. independent review of the completed clean reconstruction of A plus company-controlled source
   custody and a protected tag receipt;
2. an explicitly approved candidate-bound dependency evidence path, full/production inventories,
   SBOM, path/reachability analysis, and independent advisory adjudication;
3. authentic genuine-PostgreSQL, deployed-browser, provider, privacy/logging, operational, and
   recovery evidence that the completed local install/build/test/security/secret/coverage/static
   artifact matrix cannot supply;
4. separate authentic customer and HQ Clerk applications, restricted customer access, HQ MFA,
   exact realm/origin/session validation, founder bootstrap, disable/revocation, and recovery;
5. authentic Replit Production PostgreSQL with TLS, controlled migrations, runtime privilege
   review, concurrency/budget/job/lease/outbox/restart evidence;
6. an encrypted off-Replit backup, independent runtime-key escrow, successful disposable
   genuine-PostgreSQL restore, and measured RPO/RTO;
7. exact-tag Replit deployments with recorded build/deployment IDs, published secret scopes,
   web/API/worker/HQ boundaries, HTTPS health, proxy behavior, monitoring, rollback, and spend
   controls;
8. a hydrated browser journey with real provider identity plus all tenant, guessed-ID, session,
   consent, feedback, restart, revocation, and privacy negative tests; and
9. a named support/incident owner and a truthful first-household human consent and comprehension
   process that preserves the `not_calibrated` fraud-safety label.

## Non-authorization

No external invite or deployment authority exists under this decision. It also does not authorize a
public launch, production DNS change, live Stripe use, any card charge or purchase, Twilio or other
outbound messaging, a campaign, contact with a non-test recipient, mobile/app-store submission,
production customer data entry, or an agent-performed founder action. Synthetic-data provider proof
requires separate explicit founder authorization; permission to run local tests does not authorize
Clerk, Replit, genuine-PostgreSQL, registry, or deployed-browser interactions.

The go-live runbook is an instruction and blocker handoff, not activation approval. The founder must
not publish or invite from A or dossier B under this verdict. After the dependency approval blocker
is resolved, every mandatory pre-invite external receipt is complete, and no runtime byte has
changed, an independent reviewer must reissue the executive decision against A and its immutable
annotated tag. The first-household human consent/comprehension observation remains an at-invite
stop/continue control. Any runtime change requires a new commit, new correctly suffixed tag, and
complete rerun.
