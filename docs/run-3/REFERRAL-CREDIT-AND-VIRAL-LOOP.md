# Referral Credit and Viral Loop

Status: **economic and safety design only; referral attribution, qualification, credits, and outbound invitations are not implemented**

Last reviewed: 2026-08-16

This document models a configurable, consent-aware referral-credit engine. It does not approve a permanent offer, create a customer entitlement, authorize outreach, promise a credit, or claim referral demand. No person, household, phone number, email address, payment identity, or provider transaction was used to create it.

The immediate objective is stakeholder discovery after a useful household experience—not viral volume before Customer #1.

## Non-negotiable boundary

- Entering or uploading another person's phone number, email address, or contact record earns nothing.
- BoomerBuddy does not upload an address book, enrich a contact, or send the first invitation.
- The customer initiates sharing through the operating-system share sheet, SMS/email composer, or copied short-lived link.
- The referral link contains no contact destination, Check content, household name, safe word, consent, or permission.
- The recipient acts independently, creates/binds their own identity, sees current terms, and accepts the exact relationship/referral purpose.
- A Trusted Circle invitation is not marketing consent, paid conversion, or reward qualification.
- A payer, administrator, referrer, or partner cannot consent for another adult.
- No purchased lists, cold outreach, transferred consent, cash payout, transferable balance, public leaderboard, or “free forever” promise.

Until the runtime and external gates pass, the product may expose only fixed safe copy through a user-controlled share surface; it must not claim that sharing or opening will earn credit.

## Hypotheses to model

These are experiment variants, not approved customer terms.

| Variant | Qualified-recipient milestone | Eligible paid milestone | Maximum nominal annual-plan credit | Current disposition |
| --- | --- | --- | --- | --- |
| `one_then_three_total` | Candidate one month-equivalent after qualified recipient action | Additional amount bringing total to three months after settled eligible annual conversion | Three month-equivalents | Starting hypothesis only |
| `one_plus_three_incremental` | Candidate one month-equivalent | Additional three month-equivalents | Four month-equivalents | Higher-cost stress alternative |
| `paid_only_three_total` | No credit | Three month-equivalents after settled conversion | Three month-equivalents | Abuse/cost comparison |
| `bounded_founding_benefit` | Code-owned noncash beta benefit | No automatic paid credit | Founder-configured cap/expiry | Closed-beta comparison |
| `share_only_no_credit` | No credit | No credit | Zero | Consent/comprehension control |

“Qualified recipient action” must be selected before launch from a narrow set such as a legitimate identity-bound invitation acceptance or qualified account/orientation milestone. A link open, form start, phone/email entry, message send, Trusted Circle permission, or synthetic/test account is not enough.

## Configurable program definition

Every program version declares:

- stable program/variant key and immutable version;
- effective and expiration times, cohort/geography/channel eligibility, and maximum participants;
- qualifying recipient milestone and exact server evidence;
- paid-conversion offer/interval/status/settlement requirements;
- credit unit, maximum per referral/referrer/household/period/program, and expiration;
- whether the first milestone is pending/reserved or immediately usable;
- refund, dispute, cancellation, failed-payment, duplicate, abuse, and correction rules;
- self-referral/payment-identity/household/device/network risk policy;
- stacking, annual renewal, tax, accounting, cash-value, transfer, and negative-balance policy;
- participant disclosure/terms/privacy versions;
- experiment allocation and stop rule; and
- founder/professional approvals and frozen release.

Missing or expired definition, unreviewed terms, unavailable canonical price, engaged global stop, or evidence conflict fails closed. Existing credits are not silently reinterpreted when a new version is published.

## Attribution sequence

`share_created -> invitation_opened -> identity_bound -> qualified_acceptance -> orientation -> eligible_paid_settlement -> credit_available -> credit_applied | expired | reversed`

Each transition is idempotent and append-only. A later event cannot fabricate a missing predecessor.

### Share creation

The server may issue a short-lived, high-entropy, single-program attribution credential after authenticating an eligible referrer. The stored form is HMAC/digest only. The response provides a route-safe token; it does not embed referrer/household/person identity or an external destination.

Creating or sharing the link earns nothing. BoomerBuddy records only the content-free share event and cannot know whether the user sent it unless the operating system or recipient later supplies explicit, approved evidence; do not infer a send from clicking the share button.

### Recipient open and binding

Opening charges global/per-client abuse budgets but grants no account, relationship, entitlement, messaging consent, or credit. The attribution credential is carried through a short-lived, explicit continuity mechanism and bound only after the recipient creates/authenticates their own account and accepts current referral terms. Existing cookies, household headers, or referrer-controlled actor IDs are not trusted.

At binding, the server verifies:

- token/program freshness and use policy;
- recipient identity and no self/household/payment-identity conflict;
- cohort/geography/age/eligibility requirements;
- deterministic first-touch/last-touch rule chosen by program version;
- no prior incompatible attribution or paid conversion; and
- consent/terms version without granting product authority.

The referrer never gains the recipient's account, Check, orientation, payment, or relationship state. Customer-facing progress should use coarse states such as `opened`, `qualified`, `credit_pending`, or `not_eligible`, with privacy-safe delays/aggregation where needed.

### Qualification

Qualification consumes an immutable, server-generated recipient-side event. It is not a client checkbox. For a Trusted Circle-linked variant, the relationship must be legitimate, separately consented, pairwise, active at qualification, and inside allowance/policy; the credit still does not change relationship authority.

The decision writes a structured allow/deny/pending result with policy version and safe reason class. Manual review can append a disposition but cannot edit the underlying event.

### Paid conversion

Paid qualification comes only from the canonical commerce subscription and authenticated `invoice.paid`/settlement lineage for the exact immutable program-eligible offer. Checkout initiation, provider `active`, a pending invoice, a test/sandbox payment, a promo/trial, or a client success page is insufficient.

Refund/dispute/cancellation/failure and money/currency/price/quantity lineage reconcile before credit becomes usable. Referral processing must not mutate provider payment truth or bypass canonical entitlement.

## Credit ledger

Credits are immutable entries plus a reconstructable balance, never a mutable coupon counter.

Entry kinds:

- `reserved` — milestone passed but settlement/hold/review is incomplete;
- `earned` — all program rules passed;
- `applied` — canonical billing application consumed an eligible amount;
- `expired` — unused amount passed its disclosed expiration;
- `reversed` — qualifying event was refunded, disputed, invalidated, duplicated, or abusive;
- `correction_debit` / `correction_credit` — reviewed superseding evidence; and
- `forfeited` — only under explicit disclosed program terms and policy.

Each entry includes program/version, referral lineage, actor/household receiving the credit, canonical offer/currency, value basis/version, nominal amount in integer minor units, available/consumed times, source event, structured reason, idempotency key, and audit correlation. No free text or provider/customer content enters the ledger.

Balance calculation prevents negative application unless the reviewed clawback policy explicitly creates a recoverable negative balance. Credit is not cash, cannot exceed eligible billed value, cannot transfer, and cannot be applied cross-household or cross-currency. A price change does not retroactively change an earned nominal amount unless the original terms explicitly define a unit and conversion method.

Applying credit is a money-affecting external action. It requires exact canonical billing authority, server-owned amount/source, cumulative cap, global stop, immediate pre-dispatch authority, provider idempotency/reconciliation, and truthful outcome-unknown handling. Run 3 does not enable that action merely by defining this ledger.

## Abuse and fairness controls

Use evidence, not invasive certainty. Signals may flag/review but must not silently punish a legitimate shared household.

- exact same person/account/household self-referral;
- reused payment-method/provider-customer identity, subject to minimization and professional review;
- duplicate attribution or invitation lineage;
- rapid synthetic/account-farm behavior;
- repeated refund/dispute/cancel cycles;
- cohort/program/geo/time/device/network anomalies;
- employee/test/provider fixture accounts;
- manipulated client events or idempotency conflicts; and
- relationship create/revoke loops without recipient-side value.

Network/device signals are short-lived, privacy-HMACed, and never sole identity proof. Do not upload contacts, perform hidden social-graph inference, fingerprint broadly, or expose one household's risk reasons to another. Reviewers receive minimal evidence and cannot inspect raw customer content.

An abuse hold preserves withdrawal, support, privacy, and relationship controls. It does not freeze a customer's unrelated paid service without a separately authorized commerce decision.

## Refund, dispute, and correction rules

Program terms must state when a credit is reserved, usable, expired, or reversible. Minimum fail-closed behavior:

- full refund or unresolved dispute before the hold clears prevents earning;
- refund/dispute after earning creates a reviewed reversal under the exact disclosed rule;
- partial refund uses the authenticated principal amount and policy, never a binary guess;
- later provider success/failure remains recordable after a prior timeout/unknown;
- an ordinary `subscription.active` event cannot override a financial restriction;
- clawback never edits the original credit or payment event;
- an insufficient balance produces a bounded negative/correction state or owner attention according to terms, not hidden cross-customer recovery; and
- correcting a false abuse decision appends evidence and restores only the amount actually authorized.

Tax, escheatment, discounts, revenue recognition, referral incentives, consumer disclosures, and accounting treatment require qualified professional review before any real credit.

## Economic sensitivity

The Run 2 model uses a hypothetical Family annual price of `$149`, base annual contribution of `$102.352788` per paid household, and assumed CAC of `$35`. Those are unvalidated assumptions—not invoices, settled cohorts, or observed acquisition economics.

One month-equivalent of that annual price is `$12.4167` nominal. Conservatively treating credit as a dollar-for-dollar reduction in contribution and assuming no breakage:

| Variant | Maximum nominal credit | Base contribution after credit | Share of base contribution consumed | Comparison with assumed `$35` CAC |
| --- | ---: | ---: | ---: | --- |
| `one_then_three_total` | `$37.25` | `$65.10` | `36.4%` | `$2.25` above assumed CAC |
| `one_plus_three_incremental` | `$49.67` | `$52.69` | `48.5%` | `$14.67` above assumed CAC |
| `paid_only_three_total` | `$37.25` | `$65.10` | `36.4%` | `$2.25` above assumed CAC |
| `share_only_no_credit` | `$0` | `$102.35` | `0%` | No incentive cost |

This is deliberately conservative and incomplete. It excludes incremental processing/billing fees, tax, support/review, fraud, failed attribution, credit timing, annual cash/recognition, price mix, churn/retention, unpaid reservations, reversals, and the possibility that a referrer was already going to acquire the customer. It also assigns the full credit cost to one converted household; actual program accounting must avoid double-counting across referrer and recipient.

Required decision model:

`incremental contribution from referred cohort - credit consumed - incremental provider/support/fraud/tax cost - cannibalization`

Report at minimum:

- share-to-open, open-to-qualified, qualified-to-oriented, oriented-to-settled-paid, and paid-to-retained cohorts;
- credit reserved, earned, applied, expired, reversed, disputed, and uncollectible;
- incremental vs existing/organic attribution uncertainty;
- support/review minutes and adverse/abuse rate;
- 30/60/90-day settled retention and contribution; and
- confidence intervals/denominators, not only conversion percentages.

Do not activate an offer merely because its maximum nominal credit is near assumed CAC. Real price, contribution, settlement, retention, support, abuse, tax/accounting, and incremental lift must replace assumptions.

## Privacy-bounded instrumentation

Instrument content-free server events:

- share capability created;
- invitation route opened;
- recipient identity/terms bound;
- qualification passed/failed/pending;
- orientation milestone;
- canonical paid settlement;
- credit reserved/earned/applied/expired/reversed; and
- support/privacy/abuse review state.

Do not log/share raw token, contact destination, message, Check, relationship narrative, payment instrument, provider secret, safe word, or household identity in analytics. Attribution identifiers are purpose-specific, HMACed/minimized, access-scoped, and deleted/pseudonymized under the approved horizon. Opening the link is not consent to cross-site tracking.

## Customer-facing truth

Terms and UI must say, in plain language:

- exactly who may participate and when the program expires;
- what recipient action qualifies, what does not, and when paid settlement matters;
- that sharing/entering contact information earns nothing;
- who sends the first invitation and what BoomerBuddy can observe;
- nominal credit/cap/expiration/application order and no-cash/nontransferable status;
- refund/dispute/cancellation/duplicate/abuse/clawback rules;
- privacy, recipient independence, support, appeal/correction, and program-change boundary; and
- that a Trusted Circle relationship and communication consents are separate.

Avoid “free months” when the value can differ, “instant,” “guaranteed,” “unlimited,” or a countdown/pressure design. Show pending versus available credit distinctly. The recipient never sees the referrer's payment or risk information; the referrer never sees the recipient's private product journey.

## Required adversarial tests

- forged/expired/stolen/reused attribution token, parallel binds, and idempotency conflict;
- referrer/recipient same person, household, payment identity, employee, provider fixture, or synthetic account;
- link open without qualification; relationship acceptance without marketing consent; recipient withdrawal;
- multiple referrers, deterministic attribution choice, late attribution, account merge/recovery, and household move;
- duplicate/reordered recipient, orientation, invoice, refund, dispute, cancellation, and correction events;
- metadata mismatch, cross-tenant credit, wrong offer/currency/amount, partial refund, clawback above balance, and price/version change;
- cap/expiration/UTC boundary, many concurrent referrals, global stop, cumulative budget, and provider outcome unknown;
- direct SQL mutation of program/event/ledger identity and append-only history;
- raw token/contact/payment/relationship/content absence in logs/audit/outbox/jobs/analytics/HQ/errors;
- share copy/deep-link accessibility and no contact permission/upload; and
- restore/reconciliation reproduces balances and pending/unknown states without double application.

Real PostgreSQL concurrency, authentic provider credit/coupon/balance behavior, professional terms/tax/accounting review, real-human comprehension, and settled cohort economics remain separate external evidence.

## Founder gates

Before any real program:

- choose one program version, cohort, geography, limit, effective/expiry date, qualifying events, and maximum liability;
- approve customer terms, privacy notice, support/appeal process, and exact share copy;
- obtain accounting/tax/legal/privacy review;
- approve canonical price/credit application and refund/dispute/clawback behavior with Stripe test evidence;
- approve abuse/minimization/retention policy and reviewer capacity;
- pass managed identity/KMS, PostgreSQL/restore, edge, observability, incident, cumulative-budget, external-action, and kill-switch gates;
- retain real-human comprehension research without calling it conversion proof; and
- separately authorize the exact bounded test or live program.

No agent may make a purchase, configure a live coupon/credit, message a recipient, or activate a customer-visible reward without that gate.

## Current disposition

`REMEDIATE`. The design and sensitivity arithmetic are repository-local. There is no referral program definition, attribution runtime, qualification decision, abuse review, credit ledger, canonical billing application, customer terms, provider-test evidence, professional review, real-human evidence, or live credit. The permanent mechanic and economics remain undecided.
