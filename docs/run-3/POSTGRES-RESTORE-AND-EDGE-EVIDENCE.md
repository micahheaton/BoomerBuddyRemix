# PostgreSQL, Restore, and Edge Evidence

> Historical gap snapshot recorded 2026-08-16. Production is now migrated through 0045 and a fresh
> DPAPI-encrypted `pg_dump` passed decrypt-and-hash validation plus a disposable-Neon restore with
> matching migration evidence. See
> [PRODUCTION-NONCHARGING-RELEASE-EVIDENCE.md](../run-3-1/PRODUCTION-NONCHARGING-RELEASE-EVIDENCE.md).
> This closes the database backup/restore portion only; timed application rollback and broader edge
> operations evidence remain open.

Status: **blocked on a disposable real PostgreSQL target and deployed edge; local preparation only**

Recorded: 2026-08-16

## Current environment fact

On the Run 3 Windows host:

- `docker`: unavailable;
- `psql`: unavailable;
- `pg_isready`: unavailable; and
- `DATABASE_URL`: absent.

No real PostgreSQL server, managed database, backup, restore, reverse proxy, CDN/WAF, TLS origin, or address-rotation test was executed. PGlite migrations/tests and the repository's real-PostgreSQL verifier are useful preparation, not real-server evidence.

## Required founder provisioning

Provision a disposable non-production standard PostgreSQL environment under the company account. Record only safe project/database/region/role identifiers in [FOUNDER-PROVISIONING.md](./FOUNDER-PROVISIONING.md).

Required secret/configuration names:

- `DATABASE_URL`: test/runtime least-privilege connection;
- a separate provider-managed migration/admin credential supplied to the one-time migration process; and
- provider-side backup/export credentials or roles, never copied into git or prompts.

The founder or authorized operator must set credentials through the OS/provider/Replit secret mechanism. Do not paste a URL containing a password into this document, a prompt, source, a screenshot, or retained test output.

## Real PostgreSQL gate

Against an empty disposable database:

1. Verify TLS, server version, database/user, region, direct-vs-pooled endpoints, and statement/connection limits.
2. Run every forward migration once, then rerun migration discovery to prove idempotent no-op behavior.
3. Run the repository verifier:

   ```powershell
   npm exec tsx scripts/verify-postgres.ts
   ```

4. Preserve redacted output with candidate commit, schema versions, server version, runner, timestamp, and evidence category `provider_test` or `deployed_staging`.
5. Run the full integration and security suites with the approved real-PostgreSQL transport where supported; record any remaining PGlite-only harness paths honestly.

The gate must directly prove, with multiple independent connections/workers where applicable:

- least-privilege runtime vs migration roles;
- concurrent durable job and outbox claims;
- no same-consumer or same-aggregate causal overlap;
- heartbeat, lease loss, reclaim, and graceful relinquish;
- consumer receipts and exact immutable envelopes;
- retry, dead letter, audited replay, poison-predecessor handling, and canonical replay lineage;
- duplicate workers and shutdown drain;
- commerce event inbox ordering, binding, financial restriction, reconciliation, and exact paid-invoice evidence;
- automation cumulative-cap races, reservation/commit/release, global stop, and override evidence;
- external-action claim, outcome-unknown, reconciliation, and duplicate prevention once the Stage 0 framework is frozen;
- consent/relationship/tenant authorization under concurrent changes; and
- retention/deletion state with no resurrected ciphertext/content.

A static CI PostgreSQL service definition is not observed evidence until it runs and the retained output identifies the candidate.

## Backup and independent restore gate

The source and restore targets must be separate databases. Never overwrite the only copy.

1. Populate the source database only with synthetic Run 3 fixtures that exercise active, revoked, expired, deleted, dead-lettered, replayed, restricted, and retained states.
2. Record a provider snapshot/PITR point and create an encrypted logical export using the provider-approved workflow.
3. Restore into a new independent database/project or alternate standard PostgreSQL provider.
4. Point a test-only API/worker pair to the restored database, run pending forward migrations once, and execute readiness plus authorization/durability/commerce/retention smokes.
5. Compare, under the documented privacy policy:
   - schema migration IDs and checksums;
   - household/person/membership/protected/trusted/consent states;
   - subscriptions/grants/allowance allocations/provider inbox and restriction states;
   - jobs, outbox events, consumer receipts, external actions, replay roots, dead letters, and growth receipts;
   - privacy requests and content-free audit/event evidence;
   - active vs expired/tombstoned analyses and absence of purged ciphertext/fingerprints; and
   - projection/health/feedback/referral rows once those Run 3 slices exist.
6. Record source point, restore duration, counts/digests, differences, operator, and acceptance decision.
7. Destroy only the disposable restore after evidence retention and founder approval; do not delete the source as part of the drill.

The restore passes only when discrepancies are either zero or explicitly expected by a written retention/pseudonymization rule. Append-only retained evidence must not be described as erased.

## Deployed Public Check edge gate

The application currently uses a bounded `BB_TRUSTED_PROXY_HOPS` contract and keyed network buckets. That does not prove the provider's actual proxy chain.

On a non-public deployed staging hostname:

1. Obtain the provider's documented forwarding-header/hop topology and configure the exact reviewed value of `BB_TRUSTED_PROXY_HOPS`; default remains `0`.
2. Verify the direct peer and derived client address with content-free diagnostic evidence. Never log raw Check content, tokens, continuity proof, or full retained addresses.
3. Prove forged `X-Forwarded-For`/`Forwarded` values from an untrusted client cannot choose the quota identity.
4. Exercise context and Check global plus current-network quotas, concurrent leases, and body limits.
5. Move one browser/device between legitimate networks while preserving only the intended short-lived Public Check continuity proof; the analysis must retain current-network abuse charging.
6. Test wrong/stolen/missing/expired continuity proofs, concurrent proof use, IPv4/IPv6/address rotation, and global-cap behavior.
7. Confirm anonymous calls omit credentials and household headers; telemetry contains HMAC/bucket state only.
8. Confirm expired/terminal anonymous records and HMACs are physically purged after the documented evidence horizon.
9. Exercise CDN/WAF/bot/challenge/rate controls at the edge without opening uncontrolled public traffic.
10. Record deployed URL class, provider configuration version, candidate commit, timestamp, source addresses under the approved minimization method, and results.

Do not treat one home IP, a mocked forwarding header, or local Fastify injection as deployed edge proof.

## Current decision

This Stage 4 gate is `blocked`. Exact local engineering can continue, but real-server concurrency, restore, proxy, WAF, address-rotation, and purge behavior require founder/company infrastructure. Their absence prevents a launch-candidate GO claim; it must not cause production controls to be weakened.
