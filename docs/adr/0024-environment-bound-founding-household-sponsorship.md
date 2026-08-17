# ADR 0024: Environment-bound Founding Household sponsorship

- Status: Accepted
- Date: 2026-08-17
- Evidence state: implemented and exercised only as `local_simulation`; no real household, managed identity, deployed staging, provider, payment, conversion, or production evidence

## Context

Run 3 needs a shortest-safe path for a founder-invited household to use the web product without a card. That path must not turn a free beta into a paid-access claim, allow an unbounded or perpetual grant, transfer research or marketing consent, create a contact list, or let local development identities become production authority.

The existing provider-neutral commerce model already supports sponsor subscriptions, sponsorship allocations, entitlement grants, and canonical entitlement resolution. A separate ad hoc “free user” flag would bypass expiry, allowance, audit, and revocation rules and would create a second access authority.

## Decision

Founding Household access is a code-owned, environment-bound sponsorship cohort that uses the canonical sponsor entitlement chain. It is never represented as paid access.

The programme definition is immutable and versioned. Its policy is append-only and bounded to 1–25 households, 1–14 invitation days, 1–180 access days, and a hard programme end no more than 180 days from the policy change. Every policy update terminally supersedes all pending credentials.

Two sponsor-only beta plan versions are active in the catalogue so canonical entitlement resolution works without a schema rewrite:

- `founding_plus_beta_v2`: one protected member and two Trusted Circle participants;
- `founding_family_beta_v2`: three protected members and six Trusted Circle participants.

They have no public or Stripe offer mapping. Their zero-value `founding_experiment` price is descriptive catalogue metadata, not a purchase, payment, discount, or willingness-to-pay claim.

The environment dimension is structural:

- `local` uses `local_simulation` evidence and a deterministic local-fixture sponsor backing;
- `staging` starts disabled with no backing and would require `deployed_staging` evidence;
- `production` starts disabled with no backing and would require `live_production` evidence.

The repository hard-refuses every nonlocal operation. Leaving local simulation requires a separately reviewed code release, managed customer identity, verified company-controlled sponsor backing, current internal founder authority, and new deployment evidence. Merely inserting a nonlocal policy row cannot make production access effective.

Canonical entitlement resolution also receives the runtime environment. A subscription or grant linked to a Founding Household enrollment is excluded when its stored environment differs from the runtime. API entitlement, session-capability, Family, HQ, Check, Orientation, and commerce-reconciliation paths all receive the same fail-closed mapping: development/test → `local`, production → `production`. Thus restoring a local database into a production runtime does not make its Founding grant effective, authorize a Check or Orientation transition, or attract an allowance during reconciliation; unrelated store, local, sponsor, and support entitlements retain their existing semantics.

## Authority and invitation boundary

Founder reads and mutations require both the exact configured `BB_FOUNDER_PERSON_ID` and a current active `hq_owner` assignment joined to an `internal` organization. The authorization layer and repository both recheck this authority. The first configured-founder mutation immutably binds that identity to the programme/environment in the database; policy, invitation, revocation, supersession, and founder-offboarding triggers require the same bound founder plus current internal-owner authority.

After authority rows are locked, each transaction captures one database `clock_timestamp()`. Every operation and consequential policy, invitation, enrollment, consent, audit, and transition time uses that captured value; SQL triggers require exact equality rather than accepting a caller-controlled tolerance. Invitation expiry must equal the policy TTL capped by programme end. Enrollment end must equal the invitation access duration capped by programme and current sponsor end. The deterministic PGlite test seam cannot operate on PostgreSQL.

These trigger invariants constrain ordinary DML; they do not make a PostgreSQL superuser or migration owner untrusted. A production activation remains blocked until the founder provisions a least-privilege application role that cannot replace functions/triggers, rewrite immutable authority/history tables, set the PGlite-only test seam, or assume the migration-owner role, and that custody is independently exercised on the selected managed PostgreSQL service.

An invitation contains no name, email address, phone number, recipient record, message, or delivery state. Creation returns 32 random bytes as a one-time local credential. The database retains only a purpose-separated HMAC-SHA-256 fingerprint and key version. Exact idempotent retry returns the stored invitation result without recovering the credential. A lost credential must be revoked and reissued.

Expiration, revocation, supersession, or acceptance clears the HMAC material and preserves append-only invitation, operation, audit, and outbox history. “Purge” means terminal zeroization, never deletion of history.

Preview and acceptance require an authenticated, unexpired, unrevoked `boomerbuddy-dev` session whose person has an active identity, active household membership, and active household-administrator assignment for the selected household. Production identity is deliberately unsupported.

## Consent and atomic enrollment

Acceptance records two separate affirmative purposes:

1. finite `founding_household_service_beta` service consent;
2. protected-adult self-enrollment consent when needed.

The request has no research, marketing, follow-up, referral, media, or outreach opt-in. Those values remain false. Any later research or contact requires its own reviewed purpose and evidence.

One transaction creates the sponsor subscription with `payer_person_id = NULL`, sponsorship allocation, finite entitlement grant, service consent/evidence, optional protected enrollment, Founding Household enrollment, audit event, and outbox event, then terminally consumes the credential. Existing protected-member and Trusted Circle allocations covered by the selected benefit are selected by distinct allocation identity before the deterministic benefit limit and rebound to the longer Founding grant, prioritizing the accepting administrator; one trusted person’s multiple relationships cannot consume multiple seats. Offboarding later reconciles each supported allocation back to unrelated effective capacity without rewriting an unrelated grant. Capacity, one-use, one-household, and idempotency constraints fail closed under concurrency.

Deferred ordinary-DML constraint triggers require every operation to own exactly one audit and one outbox row through a structural operation key. The outbox row must still be fresh and dispatchable at commit: unprocessed, unleased, unattempted, not dead-lettered, and without replay lineage. The operation result is re-derived from final state; policy supersession counts are tied to that policy operation, acceptance must resolve to an active enrollment, and offboarding rebind counts come from database-owned append-only allowance-transition evidence. Invitation rows can only be inserted pending, and enrollment rows can only be inserted active.

The same commit checks reject a policy revision that leaves older pending HMAC material usable, an enrollment that leaves its source invitation pending or fingerprinted, later deletion or drift of its exact consent projection, acceptance consent/evidence/projection or sponsor-chain timestamps that diverge from the captured authority clock, deletion of a Founding-bound allowance, and offboarding that strands an allocation on the ended Founding grant when unrelated effective capacity supports rebinding. A service-consent terminal action cannot coexist with an active Founding sponsor chain; the only consent-only exception is an exact withdrawal after that chain was already closed by founder offboarding. Valid repository transactions satisfy the same constraints atomically.

## Revocation and expiry

Natural expiry makes the sponsor grant ineffective through canonical entitlement resolution. Status and funnel attribution use one common validity/effective-end projection: the earliest enrollment end/revocation, sponsorship end or invalid state, linked subscription period/end or invalid lifecycle, sponsorship-allocation end or invalid state, entitlement-grant end/revocation, or any non-active or missing service-consent projection. Missing or malformed chain facts fail closed to the enrollment start unless an exact trustworthy terminator supplies an earlier bound. The ledger row remains visible, its consent state is never fabricated, and committed capacity does not silently reopen.

Any early canonical terminator immediately creates attention, stops milestone attribution, removes the Founding grant from canonical contributing grants, and prevents the longer ledger end from appearing as effective access. The enrollment remains committed cohort capacity until its recorded enrollment end or explicit offboarding; attention is not silently converted into a replacement seat. Founder offboarding revokes only the linked Founding Household grant/allocation/subscription/enrollment and does not claim to withdraw customer consent. The accepting administrator retains an idempotent consent-only withdrawal after founder offboarding; that path appends service-consent withdrawal evidence without mutating the already-ended sponsor chain. Withdrawal during active access appends consent evidence before closing the exact sponsor chain. Neither path mutates unrelated grants.

## Funnel evidence

The projection derives only facts already supported by minimized operational records: pre-enrollment active identity, cohort acceptance, orientation-ready state, completed Check, active Trusted Circle relationship, exact authenticated/minimized completed feedback intake, and a later session after 24 hours. Result comprehension, safe next action, service value, and feedback usefulness remain `not_observed` with `not_implemented` provenance until separately reviewed evidence sources exist.

The external DTO exposes only stable household control identity, effective access/consent state, and yes/no milestone states with bounded provenance codes. It excludes accepting-person identity, precise event times, household name, contact details, submitted Check content, feedback content, and message content. Every Stage 7 API response is private/no-store; clients also request no-store and clear credential, preview, consent, and status state after authorization loss.

## Consequences

- Customer #1 can be rehearsed locally without a card and without weakening canonical entitlement controls.
- The founder must make an explicit bounded policy decision before issuing any credential.
- The path cannot message anyone or create an account; the recipient must already be an authenticated household administrator.
- Local evidence cannot be promoted to staging or production evidence.
- Production-rendered Stage 7 destinations expose only the managed-identity activation blocker; local credential/policy forms are absent. This is a UI defense, not production-readiness evidence.
- A future managed-identity release can use the environment-bound schema, but it must supply new resolver policy, verified sponsor custody, deployment evidence, and independent review.

## Rejected alternatives

- A perpetual “free forever” account flag.
- Treating sponsorship as a zero-dollar Stripe purchase or paid conversion.
- Storing plaintext invitation credentials or recipient contact data.
- Letting a founder role claim, sponsor-organization assignment, or unconfigured owner manage the cohort.
- Reusing service acceptance as research, marketing, or follow-up consent.
- Deleting invitation or audit rows when credentials expire.
- Claiming unimplemented funnel outcomes from synthetic personas or founder judgment.

## Rollback

Disable the current local policy, which supersedes and zeroizes every pending credential. Offboard each active Founding Household enrollment through the founder control so only its linked sponsor chain is revoked. Preserve migrations, policy versions, operations, invitations, enrollments, consent evidence, audits, and outbox records. Do not delete or rewrite history.
