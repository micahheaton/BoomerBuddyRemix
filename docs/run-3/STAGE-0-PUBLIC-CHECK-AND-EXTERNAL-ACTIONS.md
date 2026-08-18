# Run 3 Stage 0 — Public Check continuity and external-action foundation

**Evidence class:** local implementation and local automated simulation only

**External actions performed:** none
**Provider, deployed-edge, device, human, revenue, and production evidence:** not established

## R2-03 — Public Check continuity

New anonymous contexts mint two independent high-entropy bearer values:

- the existing context token; and
- a short-lived continuity proof tied to that context.

Only HMACs are stored. The web client keeps both values in component memory, does not place them in
browser storage or a URL, and continues to omit ambient credentials on the two anonymous Public
Check endpoints.

The continuity proof authorizes the same bounded context through an observed network-address
change. It does not become an abuse identity. Every request still derives its quota key and
concurrency lease from the current network address. Supplying an invalid proof fails without a
same-network fallback. Omitting the proof preserves same-network compatibility for existing
clients. A pre-migration row with no continuity HMAC remains network-bound.

Local tests cover IPv4-to-IPv6 change, missing and modified proofs, HMAC-only persistence, legacy
rows, current-network quota attribution, and the existing global/per-network lease and quota
controls. These tests are not deployed proxy/CDN, WAF, address-rotation, iOS, or Android evidence;
those gates remain open.

## R2-04 — Public Check conversion semantics

The response now advertises version `single-success-retry-v1` with these explicit truths:

- one successful owned Check can be created;
- a retry requires the same conversion credential, authenticated owner, household, and consent;
- a matching retry returns the existing Check; and
- credential, actor, household, or consent mismatch remains non-enumerating.

`oneTime: true` remains temporarily as a compatibility alias meaning one successful owned Check,
not one HTTP attempt. New UI language uses the precise semantics. Conversion evidence records the
semantics version without retaining the bearer credential or anonymous content.

Local tests cover concurrent legitimate retries, concurrent owner mismatch, wrong credential,
wrong household, explicit consent, atomic rollback, append-only evidence, and anonymous-payload
purge. No real conversion or customer evidence is claimed.

## R2-05 — External-action foundation

Migration `0015_run3_external_actions.sql` and `ExternalActionRepository` provide a state-only
foundation. Every registration has a unique non-null cumulative-budget reservation and binds the
same operation ID, budget envelope digest, action/tool keys, tenant scope, durable-job or outbox
origin, registration actor, action class, provider, HMAC-only provider-account identity, and
HMAC-only minimized intent. The schema has no destination, message, payload, token, or secret
column.

The only exposure-authority issuer is explicitly named `authorizeLocalFixtureExposure`. It is
owner-gated, short-lived, single-use, and labeled `local_fixture`; it is not provider, staging, or
production price evidence. Every founder/owner gate requires an active `hq_owner` assignment that
references an existing organization whose kind is `internal`, and locks both rows. Null, sponsor,
suspended, repointed, or concurrently reclassified authority fails closed at provider-rule review,
exposure issuance, registration, reconciliation issuance, and reconciliation consumption. It binds
refund principal or credit face value—not merely a provider fee—to the exact positive USD
reservation. Observed accepted exposure may exceed the request input ceiling: confirmed runaway
truth is still recorded, the budget is committed, and the global stop is engaged instead of losing
evidence.

Configured-founder equality is enforced by the application repository for provider review and
fixture exposure. SQL triggers enforce current internal-owner authority only because deployment
identity configuration is not stored in the database; a privileged database writer is a separate
migration/operations custody boundary, not an alternate HQ actor path.

Provider acceptance and idempotency metadata is founder-reviewed only while the global stop is
engaged. Immutable versions bind provider, account, action class, accepted response state,
idempotency support, and key-derivation version. A local-fixture idempotency key is derived in the
repository from that reviewed version plus the operation envelope; registration cannot assert the
boolean or key. Claim requires that exact reviewed version to remain current and enabled. The claim
stores an immutable snapshot, so revocation blocks new dispatches but cannot make a response from an
already-started dispatch unrecordable.

`claimForDispatch` is deliberately the durable dispatch-start boundary. It first rechecks the
global stop, reservation, policy version, every current cap ID/version/window, and the live
durable-origin lease. Once it commits, effect state is `unknown`; there is no API or permitted SQL
transition that can reset the action to `not_dispatched`. A timeout or expired outcome lease moves
to `outcome_unknown`, never a blind retry. The five-second budget authorization governs dispatch
start, while the longer outcome lease can record later provider truth.

Provider acceptance records the exact reviewed rule version, provider response, cost source,
magnitude, and evidence digest. The same database transaction commits all cumulative budget
windows, records overrun or authorization-breach evidence, and engages the global stop before a
subsequent reservation can pass. This is a local ledger invariant, not proof that a provider
accepted anything.

Unknown outcomes remain reconcilable even when retries are suppressed. A typed, single-use HQ-owner
capability is rechecked against the active assignment at consumption. Provider query/webhook
evidence is bound to the exact provider/account/operation and must be observed after the latest
unknown transition; stale pre-dispatch evidence cannot rearm. Operator review cannot declare
provider success and cannot rearm refund, credit, paid-tool, or non-idempotent work.

A bounded durable maintenance handler can recover legacy accepted-accounting gaps and release only
safe expired reservations. It is registered on the shared worker with a deterministic interval
key, makes no external call, and has local test evidence only; this is not hosted-worker or real
PostgreSQL evidence.

### Deliberate activation blockers

The external-action foundation contains no provider adapter wired to this ledger, executor,
delivery path, refund path, credit issuer, paid-tool caller, or autonomous enablement. No email,
SMS, payment, refund, credit, paid request, or provider reconciliation query was made by this
framework.

No real adapter may be added until all of these are independently green:

- a server-owned, versioned provider/account/action price or refund catalog derives both the
  conservative reservation and the exact provider request amount from one canonical command;
- unproven zero-cost operations are rejected and separate action/rate caps bound zero-marginal-cost
  messaging;
- the reviewed provider metadata and key derivation are verified against the actual sandbox account;
- a scoped service principal and live durable-origin lease, not a caller string, authorize workers;
- a real provider sandbox proves late responses, ambiguous timeouts, idempotency, and reconciliation;
- real PostgreSQL proves lock ordering, concurrency, clock behavior, restore, and maintenance; and
- the explicit founder gate authorizes that one adapter and action class.

Current `local_fixture` exposure and cost evidence must never be relabeled as provider truth.
