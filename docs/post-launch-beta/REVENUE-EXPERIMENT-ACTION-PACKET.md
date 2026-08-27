# Revenue Experiment Action Packet

Status: **non-executable local specification; no external action authorized or performed**

Controlling registry: [OFFER-HYPOTHESIS-REGISTRY.md](./OFFER-HYPOTHESIS-REGISTRY.md)

Clean pushed implementation and local-validation baseline before this follow-up tranche:
`c39a98415320adb40737d1ea354674b2aa8c4194`. GitHub Actions run `33023999677` for that SHA is
green across all four jobs. The c39a984 baseline remains not live-capable because its Family
catalogue is a hypothesis that provider-backed production entitlement verification cannot make
effective.

This versioned packet cannot bind the final commit SHA that contains itself because changing the
packet changes that SHA. After the paid-entitlement repair and all approved changes are committed,
execution must derive the exact SHA and annotated tag from Git, verify green local and GitHub CI
evidence for that exact SHA, and record them in an external release receipt. A branch name, prior
candidate, prior run, or documentation timestamp is not a substitute.

This packet is non-executable until all of these conditions are true: the separately authorized
paid-entitlement repair is complete and green; the final exact SHA, annotated tag, and green CI are
recorded in an external release receipt; and the noncharging authorization below is present in the
active task.

External gate: **CLOSED** until the founder types this exact phrase in the active task after reviewing
the external release receipt:

`CONFIRM NONCHARGING RELEASE SETUP`

The phrase authorizes only the exact noncharging sandbox and private-preview setup bound by the
external release receipt. It cannot make this packet executable while any prerequisite above is
open. It does not authorize a public experiment, participant contact, customer
consent, plan choice, a live Checkout window, a real payment, a charge, a refund, a production
offer change, a live provider resource, or a production deployment.

This packet prepares an isolated Stripe research sandbox and a private, noncollecting website
preview. It does not connect either surface to production.

## Gauntlet decision

The fastest safe route to recurring revenue remains one founder-assisted, consented household on
the Family USD 14.99 monthly candidate. It is the sole approved production offer candidate and is
not live. Its Checkout contract remains default-off. Family means coverage for one household group. No employer, association, bulk,
or other group price has been selected, so this packet does not invent one.

The other entries answer later questions and do not outrank the first-household path:

| Hypothesis | What it can test | Why it does not accelerate the first safe payment |
| --- | --- | --- |
| Family USD 149 yearly | Stated interval preference and sandbox renewal arithmetic | It increases commitment, refund, tax, and support questions before any retention evidence exists. Up-front cash is not proof of recurring retention. |
| Individual USD 8.99 monthly | Stated demand for one-person coverage | It adds a new entitlement, value, support, and copy boundary while lowering initial recurring revenue per payer. |
| Individual USD 89 yearly | Stated audience and interval preference | It combines both unproved changes and therefore cannot identify which change caused a result. |
| One-month service credits | Sandbox ledger, liability, and abuse-control behavior | A referral loop requires a settled payer, observed advocacy, recipient consent, and accounting treatment. It cannot produce Customer 1. |
| Private-beta access receipt | Whether the pricing CTA created a content-free handoff receipt | It does not prove that the visitor sent email, that support received or qualified a lead, or that anyone paid. |

## Frozen arithmetic and liability

All values below must be read from `packages/domain/src/revenue-hypotheses.ts` at registry version 1.
Do not retype them into production configuration.

| Audience | Monthly | Twelve monthly payments | Yearly candidate | Savings | Rounded discount |
| --- | ---: | ---: | ---: | ---: | ---: |
| Family household group | USD 14.99 | USD 179.88 | USD 149.00 | USD 30.88 | 17.17% |
| Individual | USD 8.99 | USD 107.88 | USD 89.00 | USD 18.88 | 17.50% |

| Credit hypothesis | Credit | Maximum qualifying referrals per referrer | Referrer and household cap | Program cap | Maximum whole credits |
| --- | ---: | ---: | ---: | ---: | ---: |
| Family | USD 14.99 | 3 | USD 44.97 | USD 1,499.00 | 100 |
| Individual | USD 8.99 | 3 | USD 26.97 | USD 899.00 | 100 |

A credit is non-cash, non-transferable subscription service only. Qualification requires the
referred subscription's first settled payment. The same person, same household, same payment
identity, and a recipient already attributed to another referrer are denied. A fourth qualifying
referral is denied. The referrer cap, household cap, and program cap are cumulative, not reset by a
retry, correction, experiment version, sandbox recreation, or billing period.

Stripe Coupon `max_redemptions` is only a global provider limit. It cannot prove the person,
household, payment-identity, prior-attribution, or per-referrer rules. Those controls must pass the
synthetic decision matrix before any sandbox discount is attached, and sandbox evidence cannot
promote the program.

## Funnel truth and measurement contract

The current website and access-intent implementation supports only this causal statement:

`allowlisted pricing attribution -> idempotent content-free intent_created receipt`

An access-intent receipt proves only `intent_created` and cannot currently measure lead-to-paid
conversion.

It intentionally has no account, email address, phone number, message, customer identifier, or paid
household join. The email composer is owned by the visitor's device. Therefore these later states are
unknown unless separately observed with valid consent and a restricted operator-owned record:

| State | Current application evidence | Allowed interpretation |
| --- | --- | --- |
| Pricing exposure | Not durably recorded by access intents | Unknown denominator; do not calculate CTA conversion from receipts alone |
| `intent_created` | Durable content-free receipt and aggregate count | CTA handoff was created once; not a lead |
| Email sent | Not observed | Unknown |
| Email received | Manual mailbox observation only | Operator evidence outside the access-intent database |
| Qualified lead | Not modeled | Unknown |
| Invited household | Separate founder-assisted workflow | Not attributable to an access receipt without a consented correlation record |
| Paid household | Canonical commerce evidence after a settled live invoice | Recurring-revenue evidence only for the sole Family monthly production offer |

Do not divide access receipts by paid households and label the result lead-to-paid conversion. A
future lead-to-paid metric requires a reviewed, consented transition contract with one durable
idempotent lineage from qualified lead to household to canonical first settled payment, plus
withdrawal, retention, tenancy, and access rules. That contract is not implemented by this packet.

When the required evidence exists, formulas use complete distinct denominators:

- stated yearly share = yearly choices / (monthly choices + yearly choices);
- neither-or-unsure rate = neither or unsure choices / eligible submitted choices;
- qualified-lead-to-paid rate = distinct consented qualified leads with a canonical first settled
  payment / all distinct consented qualified leads in the same closed cohort;
- receipt creation rate = unique `intent_created` receipts / verified eligible pricing exposures.

Until both sides of a formula exist, report the numerator and the missing denominator separately.
Synthetic selections, Stripe test invoices, family goodwill, access receipts, and Checkout redirects
are not paid conversion, CAC, MRR, retention, or willingness-to-pay evidence.

## Local synthetic validation specification

No provider or deployment access is needed for this validation. These steps describe the required
local evidence, but this packet does not authorize executing them while its status is
non-executable.

1. Run the revenue registry unit tests and production-boundary security test from the exact
   candidate.
2. Execute a table-driven offer fixture for both audience pairs and both presentation orders:
   monthly, yearly, neither, and unsure. Require exactly one idempotent response for a repeated
   operation key and conflict for the same key with a changed choice.
3. Execute referral denial fixtures for same person, same household, same payment identity,
   already-attributed recipient, fourth referral, referrer cap, household cap, and program cap.
4. Execute settlement fixtures in which Checkout completion, subscription `active`, pending invoice,
   sandbox payment, duplicate event, and later invoice do not qualify. Only the first canonical
   settled subscription payment can qualify once.
5. Record the result as `synthetic`. It can falsify arithmetic or control behavior but cannot prove
   participant preference, Stripe behavior, acquisition, payment, or revenue.

Any failed invariant is a stop. Fix the registry, fixture, or packet locally and restart from step 1.

## Private website research specification

This is a research preview, not a public pricing route. It must not be linked from the production
home, pricing, sign-in, billing, mobile, support, email, or search surfaces. It must not be indexed,
must not contain Checkout or purchase links, and must not write a cookie, contact field, free text,
or submitted URL.

The exact coverage labels are:

- `Family - one household group`
- `Individual - one person`

Ask for the coverage choice before showing its interval pair. Randomize only the order of the two
prices inside that selected audience. Do not compare Family yearly directly with Individual monthly
because that confounds coverage and interval.

Use this exact status copy above every pair:

> Research preview only. These choices do not start Checkout, reserve a price, or create an offer.
> Family at USD 14.99 per month is the sole approved production offer candidate, and it is not live.
> Every yearly and Individual choice shown here is unavailable and is being evaluated only as a hypothesis.

The Family pair is `USD 14.99 each month` and `USD 149 each year; USD 30.88 less than twelve monthly
payments`. The Individual pair is `USD 8.99 each month` and `USD 89 each year; USD 18.88 less than
twelve monthly payments`. The only response values are `monthly`, `yearly`, `neither`, and `unsure`.
Provide a no-response exit.

The minimized event contract for a future reviewed collector is:

```json
{
  "experimentKey": "offer-pair-v1",
  "registryVersion": 1,
  "evidenceTier": "synthetic",
  "audience": "family",
  "presentationOrder": "monthly_first",
  "choice": "monthly"
}
```

Allowed values are fixed by this specification. An operation-scoped UUID is supplied in an HTTP
header, retained only as a purpose-separated HMAC, and uniquely binds one request digest. Exact
retries return the first receipt and do not increment counts. The same key with changed content
conflicts. Raw operation keys, IP addresses, referrers, user agents, URLs, names, contact data, and
free text are not experiment data.

No real-participant collector or route exists in the current repository. The private preview must
remain noncollecting until a separate reviewed contract, retention schedule, consent flow,
independent edge limit, kill switch, accessibility pass, and owner are implemented. The
confirmation phrase can authorize private preview setup only after the external release receipt
closes every prerequisite in this packet. It cannot authorize participant contact or exposure.

## Isolated Stripe sandbox specification

Do not use live mode. Do not use or modify the existing `Boomer Buddy sandbox`, whose enabled
legacy webhook targets `https://boomerbuddy.net/api/webhooks/stripe`. Do not point a BoomerBuddy 2.0
application, webhook, environment variable, provider key, or inventory job at the research
sandbox. Only after every packet prerequisite, the external release receipt, and the external gate
are complete may an authorized operator create a new isolated sandbox owned by the company solely
for offer research. Stop if isolation cannot be proved.

Create exactly two sandbox Products and four recurring Prices:

| Product metadata audience | Price hypothesis key | Unit amount | Recurrence |
| --- | --- | ---: | --- |
| `family` | `offer-hypothesis-family-monthly-v1` | 1499 USD cents | month, interval count 1 |
| `family` | `offer-hypothesis-family-annual-v1` | 14900 USD cents | year, interval count 1 |
| `individual` | `offer-hypothesis-individual-monthly-v1` | 899 USD cents | month, interval count 1 |
| `individual` | `offer-hypothesis-individual-annual-v1` | 8900 USD cents | year, interval count 1 |

Each object must report `livemode=false`. Each Price must also report `type=recurring`,
`billing_scheme=per_unit`, `usage_type=licensed`, `custom_unit_amount=null`, `tiers_mode=null`,
`transform_quantity=null`, and `trial_period_days=null`. Do not create a Payment Link, promotion
code, trial, adaptive price, tier, metered price, Tax rule, live object, or application mapping.

Use this exact metadata on every research object where the object supports it:

```text
bb_scope=stripe_sandbox
bb_registry_version=1
bb_public_route_enabled=false
bb_production_activation_enabled=false
bb_live_provider_write_enabled=false
bb_hypothesis_key=<exact registry key>
```

Create exactly two sandbox Coupons only after all four denial fixtures pass:

| Coupon hypothesis | `amount_off` | Currency | Duration | Global `max_redemptions` |
| --- | ---: | --- | --- | ---: |
| Family one-month service credit | 1499 | usd | once | 100 |
| Individual one-month service credit | 899 | usd | once | 100 |

Create no Promotion Code. Restrict each Coupon to its matching sandbox Product if the provider
surface supports that restriction. A sandbox operator may attach the Coupon only to a synthetic
referrer's matching monthly subscription after a distinct synthetic recipient produces exactly one
first-settled-payment qualification. Verify that one subsequent untaxed sandbox invoice is reduced
by exactly the credit and the following invoice resumes the full monthly amount. This is provider
schema and lifecycle evidence, not an accounting conclusion or customer promise.

Every provider POST uses one recorded UUID idempotency key and exact parameters. Retry an ambiguous
request only with the same key and parameters. Stripe documents that POST idempotency results are
replayed for the same key and that changed parameters conflict. Reconcile by object metadata and
provider request ID before any later operation. See the official Stripe references for
[Prices](https://docs.stripe.com/api/prices/create),
[Coupons](https://docs.stripe.com/api/coupons/create),
[idempotent requests](https://docs.stripe.com/api/idempotent_requests), and
[test clocks](https://docs.stripe.com/billing/testing/test-clocks/simulate-subscriptions).

The sandbox lifecycle matrix is limited to synthetic Customers, test payment methods, test clocks,
subscriptions, and invoices. It must cover initial settlement, renewal, payment failure, recovery,
duplicate and out-of-order event observation, cancellation, credit application, cap denial, and
clock completion. No real payment instrument, customer identity, customer contact, or production
endpoint may participate.

## Externally bound action order

After, and only after, the paid-entitlement repair is green, the external release receipt binds the
final exact SHA, annotated tag, and green CI, and the exact phrase is present in the active task:

1. Read the reviewed 40-character candidate SHA, annotated tag, and exact green local and CI
   receipts from the external release receipt. Verify them directly against Git and CI. Do not edit
   this packet to self-bind them. Stop if the worktree, tag, receipt, or deployed source differs.
2. Perform read-only account and mode verification. Record the company owner, sandbox identifier,
   `livemode=false`, MFA and recovery custody, current object counts, and the legacy endpoint as
   redacted operator evidence outside Git. Stop on ambiguity.
3. Create the new isolated research sandbox. Do not select the existing legacy-containing sandbox
   and do not open live mode.
4. Create the two Products and four Prices with fresh operation IDs. Immediately read each object
   back and compare every field and metadata value with this packet.
5. Run the synthetic anti-self-referral and cumulative-cap matrix locally. Only if it is green,
   create and read back the two Coupons. Create no Promotion Codes.
6. Run the bounded test-clock matrix with synthetic identities. Retain redacted object IDs,
   idempotency operation receipts, expected-versus-actual invoice amounts, and lifecycle outcomes.
7. Build the research page only as a private, noncollecting, noindex preview from the exact copy in
   this packet. Run keyboard, zoom, screen-reader, responsive, and automated accessibility checks.
8. Verify the production home and pricing pages still show only Family USD 14.99 monthly and the
   production Checkout contract still accepts only `founding_family_monthly_v1`.
9. Freeze the sandbox. Make the four Prices and two Products inactive after evidence capture if no
   further authorized test is scheduled. Leave the isolated evidence intact; do not delete or alter
   the legacy webhook or any live object.
10. Report counts and failures by evidence tier. Do not publish preference, conversion, revenue,
    CAC, retention, or promotion claims.

Participant exposure, recruitment, public routing, production configuration, application secrets,
webhooks, Checkout integration, live resources, and any offer promotion remain outside this packet
and require a new reviewed proposal and authority.

## Stop and rollback

Stop the affected lane immediately on live mode, wrong account or sandbox, legacy endpoint contact,
unexpected existing resources, a public candidate string, Checkout reachability, PII, free text,
non-idempotent duplicate, cap drift, self-referral acceptance, invoice mismatch, missing evidence,
unsupported provider field, or an accessibility blocker.

For the website lane, remove the private preview from its access group and keep production
unchanged. For the Stripe lane, stop new synthetic operations, reconcile every ambiguous request,
then mark the research Products and Prices inactive. Preserve redacted evidence. Do not delete or
edit the legacy webhook, do not change application configuration, and do not touch live mode.

## Completion receipt

The external release receipt is complete only when it records:

- exact candidate SHA, annotated tag, and clean-diff identity derived from Git;
- confirmation phrase timestamp and scope;
- green local invariant, production-boundary, access-intent, accessibility, and CI receipts;
- isolated sandbox identity and before/after inventory with `livemode=false`;
- exact Product, Price, Coupon, idempotency, test-clock, and invoice-field comparisons;
- private-preview screenshots and accessibility results;
- zero public candidate routes, zero live objects, zero production mappings, zero real payments,
  zero participant contacts, zero PII, and zero legacy changes;
- every unknown outcome, stop reason, and rollback action.

Until those fields exist, the evidence remains `local_specification`, not `stripe_sandbox`, website
research, lead generation, paid conversion, or recurring revenue.
