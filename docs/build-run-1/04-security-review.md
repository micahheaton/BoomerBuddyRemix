# Security Review

Review date: 2026-08-16

Disposition: **acceptable for the bounded local Build Run 1 proof; production and first-dollar use remain blocked**.

No unresolved Critical/High application defect was identified in the reviewed local flows after the regression fixes below. This is a source/test review, not an external penetration test, production threat assessment, or compliance attestation.

## Implemented controls

| Boundary                 | Implemented evidence                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity/session         | Only allow-listed seeded identities can mint HMAC-signed, database-backed, eight-hour development sessions. Customer, mobile, and HQ audiences are distinct; revocation, expiry, tamper, disabled identity, cross-audience, and mixed bearer/cookie cases fail closed. Production startup and production dev-token verification are refused.                          |
| Browser/native transport | Customer/HQ use separate HttpOnly, `SameSite=Strict` local cookies and disjoint trusted origins. Browser-cookie mutations require exact origin. Mobile uses an audience-scoped bearer; native source stores bearer and selected-household preference in separate SecureStore entries, while Expo web uses memory only.                                                |
| Input and URL            | Zod schemas, a 24 KiB API body limit, UTF-8 byte limits, NFKC normalization, and restricted-input detection run before fraud analysis. Private-key blocks, Luhn-valid cards, authorization credentials/JWT-like tokens, contextual OTPs, and sensitive URL credentials/parameters are rejected without reflection or persistence. URL analysis makes no network call. |
| Restricted storage       | Remaining minimized Check content uses AES-256-GCM with unique nonces and length-prefixed tenant/resource/field/schema/key-version AAD. Correlation uses a separate tenant/purpose/key-version HMAC. Encryption key, fingerprint key, session secret, and safe-word pepper must differ.                                                                               |
| Safe word                | Only a salted scrypt verifier plus separate pepper is stored; the phrase/verifier has no GET route. Ordered updates write verifier, disposition, step, audit, and outbox atomically.                                                                                                                                                                                  |
| Tenant/object isolation  | Central policy, current database-derived principals, per-household capabilities, composite tenant foreign keys, exact repository predicates, explicit shares, and negative tests provide layered isolation.                                                                                                                                                           |
| Logs/events/errors       | Structured logger redacts sensitive keys and credential/content patterns. Public errors use safe envelopes and request IDs. Audit/outbox payloads permit only content-free scalar metadata and commit with domain mutations.                                                                                                                                          |
| Retention/deletion       | Active reads require `delete_after > now`. Manual and due deletion remove shares, null ciphertext/fingerprint, scrub analysis findings, and leave a content-free tombstone. Startup plus overlap-guarded periodic sweeps drain bounded batches.                                                                                                                       |
| Bootstrap integrity      | Demo seed is one atomic transaction with a durable marker and an occupancy check over root/selected domain tables. Persistent restart tests prove ordinary marked restarts cannot resurrect deleted content or revoked authority; the remaining operational-table-only edge case is documented in [Known Limitations](./12-known-limitations.md).                     |

The API now passes the exact minimized string to analysis and persistence; the repository repeats minimization defensively. This closes the earlier risk that one representation could be analyzed while another was stored.

## Verification performed

Fresh local runs passed:

- `npm run test:unit`: 10 files, 99 tests.
- `npm run test:integration`: 4 files, 18 tests.
- `npm run test:security`: 4 files, 16 tests.

Security regressions cover malicious origin/CORS behavior, audience confusion, session expiry/revocation/tampering, Unicode/body limits, no URL fetch, restricted-value non-persistence, transaction rollback, safe-word non-disclosure/atomicity, cross-household access, due-record fail-closed reads, multi-batch retention, and two persistent seed restarts. Coverage thresholds for authorization/security/fraud are enforced by `vitest.config.ts`; the consolidated test report records the final coverage run.

## Known gaps and blockers

- **Production identity/KMS deferred:** no OIDC provider, MFA/step-up, account recovery, managed key custody, rotation job, or secret-rotation runbook. Local cookies intentionally use `secure: false`; production mode cannot start.
- **Dependency advisories unresolved:** the run's npm audit reported 0 critical, 11 high, 7 moderate, and 1 low advisory. The high findings are primarily current Expo/React Native/Metro transitive paths with no confirmed compatible fix; forcing an incompatible downgrade was rejected. This blocks production release.
- **Production operations deferred:** no durable retention/outbox worker, dead-letter/replay control, multi-instance coordination, production backup/restore drill, monitoring/on-call, external penetration test, or incident exercise.
- **Privacy lifecycle incomplete:** Check retention/deletion is implemented, but account/household export and full erasure across all domain/operational records are not.
- **Restricted-input detection is heuristic:** encrypted remaining content is still sensitive. The design reduces exposure; it does not prove every secret class can be recognized.
- **Invitation credential is bearer-like:** Run 1 stores only its HMAC fingerprint and requires ID, code, authenticated preview, preview version, expiry, and single use. It is not pre-bound to a verified email/phone identity; secure delivery and address binding are deferred.
- **Safe-word verification operations deferred:** verifier creation is implemented, but there is no user verification endpoint, abuse throttling, recovery ceremony, or staffed support process.
- **Web/native assurance incomplete:** no production CSP/header policy is configured for the Next apps, and native SecureStore/device/extension behavior is unverified. iOS/Android sharing is not implemented.
- **Real PostgreSQL not qualified:** PGlite supplies useful PostgreSQL semantics, not production concurrency, network, restore, or extension evidence. Row-level security is not enabled.

These gaps are consistent with [ADR-0003](../adr/0003-managed-identity-and-resource-authorization.md), [ADR-0004](../adr/0004-sensitive-artifact-encryption-and-keyed-fingerprints.md), and the explicit [Build Run 1 boundary](../BUILD-RUN-1-PLAN.md). None may be converted into a production-readiness claim.
