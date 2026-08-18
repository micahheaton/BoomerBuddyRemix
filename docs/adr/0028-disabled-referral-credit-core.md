# ADR 0028: Disabled Referral-Credit Core

- Status: Accepted for the Run 3 local candidate
- Date: 2026-08-17
- Evidence state: repository-local simulation only; no seeded program, customer surface, provider test, managed PostgreSQL, real-human, or production evidence

## Context

Run 3 needs a configurable referral-credit model without turning a candidate economic hypothesis into an active promise, a contact-acquisition path, or a second billing authority. The existing Run 2 referral policy accepts caller-supplied award facts and a mutable activation flag; it does not provide immutable program versions, recipient-bound attribution, deterministic server qualification, authenticated settlement/refund lineage, or a complete append-only credit ledger. Reusing it would make the local candidate easier to activate than to prove safe.

The Stage 10 design also requires user-controlled sharing, HMAC-only attribution, identity and cumulative-cap controls, refund/dispute reconciliation, expiration, reviewed corrections, and truthful separation of local evidence from provider or production proof. Applying a credit is a money-affecting provider action and is outside this decision.

## Decision

Create a new, isolated Run 3 referral-credit core in migration `0023_run3_referral_credit_engine.sql` and new domain, contract, and persistence modules. Do not change or import the Run 2 referral runtime.

The core is structurally disabled:

- program lifecycle values are limited to `draft`, `review_required`, `approved_disabled`, `stopped`, and `expired`; there is no `active` value;
- the migration seeds no program or offer;
- every row is `local_simulation`, program and provider execution flags are constrained false, and the credit ledger has no `applied` entry kind;
- the domain, contract, and persistence modules are exported and the API dependency context
  constructs the disabled repository; a non-production, read-only HQ route/screen can project only
  content-free evidence to a current owner/reviewer, while no customer route, mutation handler,
  worker consumer, program seed, provider adapter, or lifecycle execution is registered; and
- durable evaluation jobs are content-free `queued_not_run` receipts with no installed consumer or provider dispatch.

Each program version freezes its variant, effective window, deterministic first-identity-bound-touch rule, recipient milestone, exact canonical offer/currency, candidate amounts, participant/referrer/household/program caps, hold and expiration durations, disclosure versions, and definition digest. Program rows and all subsequent evidence are append-only.

Local simulation issuance authenticates an exact active referrer membership, locks the immutable program and its program-key identity mutex, enforces participant and per-referrer caps, creates 32 random bytes, returns the route-safe token once, and stores only a purpose-separated HMAC-SHA-256 plus key version. The mutex serializes payment-identity decisions across every immutable version of the same program key. A payment HMAC already used by any referrer or bound recipient cannot later be reused in either role, including after a new program version is published. An exact retry can recover the attribution result but not the token. The stored attribution contains no destination, contact, message, Check content, safe word, or provider identifier.

Opening the token earns nothing. Recipient binding requires a preceding unexpired open, an active recipient membership, the exact terms/privacy versions, and no same-person, same-household, or same-purpose payment-identity HMAC conflict. Partial unique indexes enforce one first identity-bound person and household per program version. Neither the referrer nor a caller can use the token to acquire recipient product or relationship authority.

Qualification consumes an immutable, server-generated, recipient-bound local event. Database-authority ordering rejects future recipient evidence, a decision timestamp before its recipient event, and evidence predating program creation, attribution issuance, or binding. The database maps the exact program milestone to one allowed event type and rejects a qualified decision when the definition digest, identity, time, or event does not match. Wrong events produce a durable denied decision and no reservation. No client checkbox, link open, contact entry, share action, or message event qualifies.

Financial evidence is append-only and purpose-HMACed. A settlement must use the exact qualified attribution (or an explicitly paid-only bound program), canonical immutable offer, currency, positive principal, and authenticated local source lineage. Its event time cannot predate program creation, attribution issuance, binding, or qualification, and its database-recorded time cannot predate the event or exceed database authority time. Refund, dispute, cancellation, and failed-payment evidence must reference the exact settlement, follow its event/recorded times, and match its subscription/invoice/line HMACs. Cumulative refunds and disputes cannot exceed settled principal. These flags mean authenticated local fixture/server evidence only; they are not Stripe test or live-provider proof.

Credit history is an immutable per-attribution sequence with `reserved`, `earned`, `expired`, `reversed`, `correction_debit`, and `correction_credit` entries. Each entry freezes receiving person/household, program/version, offer/currency, integer amount, source digest/reference, safe reason, idempotency key, audit correlation, and timing. The `(source type, source reference, entry kind)` tuple is unique. Database triggers require exact source-kind compatibility, source digest equality, database-recorded time equality, and source-specific positive-entry targeting before applying aggregate nonnegative-balance, per-referral/referrer/household/program cap, settled-principal, and immutable paid-target bounds. Settlement supersedes the exact remaining reservation with a targeted reversal before earning the exact bounded total. Refund and dispute reconciliation sums every prior authenticated child principal independently of whether an earlier proportional result rounded to zero and emitted no ledger row, separately sums the reversal debits actually recorded, and appends only the incremental exact proportional reversal against the settlement's earned entry. Expiry and correction debit likewise consume only the remaining amount of their explicit positive source.

A correction requires a separate append-only review row from a current internal `hq_owner` or `hq_reviewer` assignment and an exact evidence digest. A debit review names the exact positive ledger entry it may reduce; a credit review cannot name a debit target. Expiration appends a bounded entry against an existing due positive entry. Neither path can overdraw that source, the reconstructable aggregate balance, or cumulative caps.

Sharing integration remains deliberately unregistered. The domain and contract expose only `native_share_sheet` and `copy_link` capability definitions with `userInitiatedOnly=true`, `contactPermissionRequested=false`, `contactDataAccepted=false`, `automaticSend=false`, `shareEventRewardsCredit=false`, and `externalActionExecuted=false`. A future UI may consume this contract only after separate founder approval and route integration; it must never accept a recipient destination or infer a sent message.

## Consequences

The repository can locally exercise program immutability, one-time HMAC attribution, recipient binding, deterministic qualification, exact financial lineage, refunds, reviewed corrections, expiration, cumulative caps, reconstructable balances, and content-free job receipts without sending a message or touching a provider. Hostile tests cover forged activation, direct evidence mutation, stolen/forged tokens, future/reordered authority evidence, symmetric cross-version payment reuse and races, self/household conflicts, parallel first-touch binding, wrong server milestones, early/wrong-offer settlements, over-refunds, zero-rounding cumulative refund/dispute principal under retries and concurrency, duplicate/mismatched ledger source tuples, digest/time/target/amount drift, direct earned-entry fabrication, correction authority and source depletion, raw-token absence, and job-payload minimization.

No customer can currently discover or use this core. Package exports, API dependency construction,
and the local content-free HQ projection create no customer or worker execution path.
`approved_disabled` means a reviewed definition that remains incapable of execution, not an active
offer. A local reservation or earned ledger row is simulation evidence, not a coupon, entitlement,
receivable, customer promise, provider balance, or accounting event.

Real PostgreSQL concurrency and least-privilege role enforcement, managed HMAC/KMS custody, canonical commerce adapter integration, Stripe test credit application/reconciliation, provider outcome-unknown handling, restore proof, observability/redaction, customer terms, privacy/retention policy, support/appeal capacity, tax/accounting/legal review, accessible UI, real-human comprehension, and settled-cohort economics remain blocked external or founder gates.

## Rejected alternatives

- Extending the mutable Run 2 `ReferralRewardPolicy` and caller-supplied award endpoint.
- Seeding an “inactive” offer that a configuration toggle could activate.
- Storing a reusable raw token, destination, message, provider customer/payment identifier, or contact record.
- Treating share creation, link open, contact entry, Trusted Circle authority, checkout initiation, or subscription `active` as credit qualification.
- Adding an `applied` ledger row without canonical provider authority and reconciliation.
- Allowing a correction to edit evidence or bypass current internal review authority.

## Rollback

Keep every program and evidence row immutable. The current package exports, API-context
construction, and read-only local HQ projection are inert without a customer mutation route,
worker consumer, program seed, provider adapter, or executable lifecycle. Rollback of any future
executable integration must remove that integration before release while retaining migration
history. If a local definition must stop, create a new stopped version in a later reviewed migration
or administrative protocol; do not update, delete, or reinterpret the frozen version or its ledger.
