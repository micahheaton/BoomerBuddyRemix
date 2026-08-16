# 50K Subscriber Model

Status: **planning sensitivity model, not a forecast**
Model date: 2026-08-16; USD unless stated otherwise

## Verdict

Approximately $1 million of annual operating profit is mathematically possible at 50,000 average paid households under the base case below, but only narrowly. It requires about $102.35 of annual contribution per household and no more than $4.1 million of annual fixed cost. BoomerBuddy has no paying cohort, observed churn, CAC, support time study, vendor invoice, or willingness-to-pay evidence. Every commercial input is therefore an assumption to replace, not a result.

The implemented calculator in `packages/business-os/src/economics.ts` reproduces the core relationship:

`operating profit = revenue - channel/loss costs - variable service costs - fixed costs`

It bounds percentage inputs and reports contribution margin, churned households, and the gap to $1 million. It does not model cash timing, taxes on profit, cohort survival, or sponsor contracts.

## Metric integrity

| Measure | Exact meaning | Revenue-bearing? |
| --- | --- | --- |
| Direct paid subscriber | A settled billing subscription; not a person count | Yes, once recognized |
| Paid household | A household with an effective paid entitlement; base model assumes one settled subscription per household | Yes |
| Protected member | A consenting person enrolled for protection | No; never count as a subscriber |
| Sponsor-eligible member | A person a contract says may enroll | No |
| Sponsor-activated household | An eligible household that completed activation and has an effective sponsored entitlement | Only when contract revenue is recognized |
| Revenue-bearing equivalent (RBE) | Sponsor contribution divided by base direct-household contribution | Yes, but only after settlement and reconciliation |

Free accounts, invitations, public Checks, sponsor eligibility, unactivated seats, and duplicate payers are excluded. Report all six measures separately.

## Current facts and scenario assumptions

The Plus `$8.99/month` or `$89/year` and Family `$14.99/month` or `$149/year` amounts are repository hypotheses, not validated prices. Stripe currently publishes `2.9% + $0.30` for a domestic online card and Stripe Billing publishes `0.7%` of Billing volume. Apple publishes a 15% Small Business Program rate, subject to its eligibility rules, while subscriptions outside that program generally produce 70% in year one and 85% after one year. Google currently publishes service-fee schedules that vary by program, transaction, region, and rollout. The model therefore uses 15% for the base app-store case and 30% for stress, not as a policy conclusion. Sources: [Stripe Payments](https://stripe.com/pricing), [Stripe Billing](https://stripe.com/billing/pricing), [Apple subscriptions](https://developer.apple.com/app-store/subscriptions/), [Apple Small Business Program](https://developer.apple.com/app-store/small-business-program/), and [Google Play service fees](https://support.google.com/googleplay/android-developer/answer/112622?hl=en).

| Input | Base case | Evidence state |
| --- | ---: | --- |
| Plus / Family plan mix | 30% / 70% | Assumption |
| Annual / monthly billing | 60% / 40% | Assumption |
| App-store / web checkout | 25% / 75% | Assumption |
| Effective web payment + Billing cost | 4.8% of web revenue; 3.6% blended | Approximation from published fees and plan cadence |
| App-store take | 15%; 30% stress | Scenario; storefront/account status unknown |
| Refund / bad-debt loss | 1.0% / 0.5% | Assumption |
| Monthly logo churn | 3.0% | Assumption; 69.4% 12-month survival |
| Settled-household CAC | $35; $70 stress | Assumption |
| Inference / fraud-intelligence / hosting-comms / variable support per household-month | $0.25 / $0.50 / $0.50 / $1.00 | Assumptions; no production trace |

Sales tax collected from customers is a liability, not revenue. Tax-registration, calculation, filing, CPA, and legal costs are budgeted separately. Stripe Tax currently advertises usage and subscription choices, but taxability and nexus require professional analysis; see [Stripe Tax pricing](https://stripe.com/tax/pricing).

## Per-household math

The weighted monthly list price is `$13.19`; the weighted annual price is `$131`. With 60% annual billing, recognized revenue is:

`(40% × $13.19) + (60% × $131 ÷ 12) = $11.826/month = $141.912/year`

| Annual per paid household | Amount |
| --- | ---: |
| Recognized revenue | $141.91 |
| Web payment/Billing allocation, 3.6% blended | ($5.11) |
| App-store allocation, 25% × 15% | ($5.32) |
| Refunds and bad debt, 1.5% | ($2.13) |
| Variable service cost, $2.25/month | ($27.00) |
| **Contribution** | **$102.35** |
| **Contribution margin** | **72.1%** |

Variable support means overflow labor, case tooling, and per-use vendor work. Core employee/contractor payroll is fixed below. The ledger must prevent counting the same labor in both places.

## Scale scenarios

These rows assume the displayed number is the **average paid-household balance** throughout the year. At 3% monthly churn, replacements are required merely to hold that balance. Growth CAC for net-new households and launch-ramp cash burn are not included.

| Average paid households | Revenue | Contribution | Illustrative fixed cost | Operating profit / (loss) | Churn events / month | Replacement CAC / year at $35 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | $14,191 | $10,235 | $250,000 | **($239,765)** | 3 | $1,260 |
| 1,000 | $141,912 | $102,353 | $450,000 | **($347,647)** | 30 | $12,600 |
| 5,000 | $709,560 | $511,764 | $700,000 | **($188,236)** | 150 | $63,000 |
| 10,000 | $1,419,120 | $1,023,528 | $1,050,000 | **($26,472)** | 300 | $126,000 |
| 25,000 | $3,547,800 | $2,558,820 | $2,000,000 | **$558,820** | 750 | $315,000 |
| 50,000 | $7,095,600 | $5,117,639 | $4,100,000 | **$1,017,639** | 1,500 | $630,000 |

Illustrative fixed-cost envelopes are capacity scenarios, not spending authority:

| Households | Legal, security, privacy | Marketing and CAC | Payroll / contractors | Software / fixed hosting | Tax / administration | Total |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | $75k | $40k | $80k | $35k | $20k | $250k |
| 1,000 | $100k | $80k | $190k | $50k | $30k | $450k |
| 5,000 | $125k | $180k | $300k | $65k | $30k | $700k |
| 10,000 | $150k | $250k | $500k | $100k | $50k | $1.05M |
| 25,000 | $200k | $600k | $900k | $200k | $100k | $2.00M |
| 50,000 | $250k | $1.20M | $2.10M | $400k | $150k | $4.10M |

The payroll envelope includes a market-value founder operating role or replacement capacity before owner profit. Operating profit is before interest, income tax, depreciation/amortization, and owner distributions; it is not founder take-home pay.

## What must be true by stage

| Scale | Economic condition, not a forecast |
| ---: | --- |
| 100 | Spend for learning, safety, and assurance; do not interpret the expected loss as failed unit economics or scale paid acquisition. |
| 1,000 | Validate settled revenue, plan/channel contribution, 90-day survival, refunds, and support minutes; the base envelope still burns about $348k/year. |
| 5,000 | Contribution must exceed about $512k or fixed cost must remain below it to break even; hire only when queue workload triggers. |
| 10,000 | Base economics are nearly break-even. Fixed cost must stay at or below about $1.024M, with no concealed founder labor, to cross zero. |
| 25,000 | Base operating profit is about $559k. Reaching $1M here would require contribution of $120/household-year or fixed cost below $1.559M—neither is evidenced. |
| 50,000 | `$1M` requires contribution at least `$102/household-year`, fixed cost at most `$4.118M`, and average—not year-end—paid households near 50,000. |

At the 50K cost structure, operating break-even is about **40,058** average paid households. The exact base threshold for $1 million is about **49,828**.

## Stress and failure conditions at 50K

| Change from base | Approximate operating profit | Consequence |
| --- | ---: | --- |
| Base | $1.018M | Target narrowly clears |
| Variable service cost rises from $2.25 to $3.50/month | $268k | Target fails |
| Effective app-store take rises from 15% to 30% on the 25% store mix | $752k | Target fails |
| Maintenance CAC doubles from $35 to $70 | $388k | Target fails |
| Recognized price/mix falls 10% | $371k | Target fails |
| Both `$3.50` service cost and 30% store take | About $2k | Business is approximately break-even before added CAC stress |

The model must not be “solved” by hiding support in payroll, excluding security/privacy, counting annual cash as immediate profit, treating taxes as revenue, or replacing monthly cohort survival with a perpetual-LTV shortcut.

## Direct versus sponsored example

The scale table is pure direct-household arithmetic. For a mixed 50,000-RBE scenario, suppose 40,000 are direct paid households and a sponsored activation contributes `$54/year` after partner-specific variable cost. One sponsored activation then equals `$54 ÷ $102.35 = 0.528` RBE. Supplying the remaining 10,000 RBE requires about **18,954 activated sponsored households**, not 10,000.

At a hypothetical 25% eligibility-to-activation rate, and assuming one eligible member maps to one potentially activated household for this arithmetic, that means about **75,816 eligible** people. If direct households average 1.4 protected members and sponsored activations average 1.2, the mixed scenario has about **78,745 protected members**. These population counts are not subscribers. The sponsor price, activation, implementation cost, receivable days, concentration, and renewal are all unknown, so sponsor economics require a separate contract P&L.

## Replacement protocol

After 50 settled paid households, replace fee, usage, and support placeholders with invoices and p50/p90 traces. After 30 settled acquisitions per channel and 90 days, publish cohort survival and CAC payback without blending organic, paid, referral, and partner sources. Reforecast monthly cash, recognized revenue, deferred revenue, tax liabilities, refunds, disputes, payroll, and runway. A qualified CPA/tax adviser must approve accounting treatment before first dollar.

Related: [Run 2 economics review](./29-50k-subscriber-economics.md), [Staffing and Philippines Operations](./STAFFING-AND-PHILIPPINES-OPS.md), [Founder Dependency Model](./FOUNDER-DEPENDENCY-MODEL.md), and the repository [Cost Model](../COST-MODEL.md).
