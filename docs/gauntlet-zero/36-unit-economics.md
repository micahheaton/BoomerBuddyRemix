# Unit Economics

Status: **sensitivity model, not a forecast**. BoomerBuddy has no observed cost, CAC, churn or willingness-to-pay cohort. Inputs checked 2026-08-15.

## Economic unit

For B2C, measure one paying household-month by plan, acquisition source and checkout channel. For sponsored B2B2C, measure both an eligible-member-month and activated-household-month; contracting on one while operating on the other can conceal poor economics.

Use:

**contribution = recognized revenue − payment/store fee − inference/intelligence − infrastructure/comms − variable support − refunds/chargebacks − channel share**

Gross margin and contribution margin should not exclude recurring costs merely because an employee or annual contract currently hides them.

## Revenue and payment sensitivity

[Stripe](https://stripe.com/pricing) currently publishes 2.9% + $0.30 for a standard U.S. domestic online card. Apple’s eligible [Small Business Program](https://developer.apple.com/app-store/small-business-program/) uses a 15% commission; [Google Play fees](https://support.google.com/googleplay/android-developer/answer/112622?hl=en) vary by program and transaction. A 15% mobile fee is therefore an illustrative scenario, not a guaranteed rate.

| Family offer | Recognized gross / month | Payment-fee assumption / month | Net before service cost |
|---|---:|---:|---:|
| $14.99 monthly, web | $14.99 | $0.73 | $14.26 |
| $14.99 monthly, app | $14.99 | $2.25 | $12.74 |
| $149 annual, web | $12.42 | $0.39 | $12.03 |
| $149 annual, app | $12.42 | $1.86 | $10.55 |
| $119 annual, web | $9.92 | $0.31 | $9.60 |
| $119 annual, app | $9.92 | $1.49 | $8.43 |

Annual web fees assume one Stripe charge, then monthly recognition. Taxes, billing software, failed payments, refunds and chargebacks are excluded and must be added.

## Variable-cost sensitivity

Model tokens are probably not the dominant unknown. The current [official model comparison](https://developers.openai.com/api/docs/models/compare) lists GPT-5.6 Luna at $0.20/million input and $1.20/million output tokens, and Terra at $2/$12. An illustrative 5,000-input/800-output check therefore costs about $0.00196 on Luna or $0.0196 on Terra; 20 such checks cost about $0.04 or $0.39. This is arithmetic, not a measured BoomerBuddy trace, and excludes OCR/audio, search, retries, caching and safety passes.

Use this explicit placeholder until invoices and time studies exist:

| Variable household-month component | Illustrative assumption | Evidence state |
|---|---:|---|
| Model/inference and processing | $0.50 | Scenario only |
| Threat/reputation providers | $1.00 | Scenario only; vendor plan unknown |
| Infrastructure and communications | $0.50 | Scenario only |
| Variable support allocation | $1.50 | Scenario only; likely largest uncertainty |
| **Total** | **$3.50** | **Not a quote or actual** |

With that $3.50 placeholder, contribution margins on gross recognized revenue are:

| Offer/channel | Contribution / month | Illustrative margin |
|---|---:|---:|
| $14.99 monthly, web | $10.76 | 71.7% |
| $14.99 monthly, app | $9.24 | 61.7% |
| $149 annual, web | $8.53 | 68.7% |
| $149 annual, app | $7.05 | 56.8% |
| $119 annual, web | $6.10 | 61.6% |
| $119 annual, app | $4.93 | 49.7% |

The table explains why $119/year is safer as a controlled promotion than an assumed list price. It does not establish that $149 sells or that $3.50 is achievable.

## Acquisition, payback and retention

Define fully loaded CAC by source as campaign spend, creative/agency cost, discounts, referral rewards, sales commissions and attributable labor divided by settled new payers. Do not blend organic, partner and paid cohorts.

**allowable CAC = observed monthly contribution × chosen payback months**, adjusted for actual survival. As a simple ceiling, the illustrative $14.99 web-monthly contribution would generate $64.53 over six months before churn; that is not a CAC target. Require at least 30 settled customers and 90 days of cohort behavior before scaling a campaign.

Avoid perpetual-value claims from early monthly churn. The shortcut contribution ÷ churn assumes stable memoryless churn and becomes absurd with small samples. Use monthly cohort survival, renewal curves, refunds, plan migration and discounted contribution. Report annual-plan cash flow separately from recognized revenue.

Internal scale gates, chosen rather than claimed as industry benchmarks:

- observed contribution margin at least 60% by core plan/channel, with a path toward 70%;
- recovered CAC within six contribution months on a survival-adjusted basis;
- no cohort growth purchased through rising refunds, support burden or unsafe engagement;
- adequate cash runway after annual prepayment liabilities and sponsor implementation.

## Sponsored and channel economics

For each account calculate contract value less partner share, payment cost, onboarding/security review, launch communication, customer success, support, contracted vendors and ongoing reporting. Allocate sales and implementation labor even when the founder performs it.

Report:

- net revenue per eligible member and per activated household;
- eligible → enrolled → activated conversion;
- variable cost per active and per eligible member;
- launch/sales cost, months to recover, renewal and expansion;
- support and incident cost, concentration and receivable days.

A per-eligible contract can look attractive while activation is near zero; a per-active contract can grow service cost without minimum revenue. Both need minimums and cohort measurement.

## Measurement plan

Instrument checks, tokens/vendor calls, artifact type, retries, storage, messages, support minutes, refunds, payment fees, source/channel share and entitlement by household. Reconcile event data to the general ledger monthly. After 50 paying households and one sponsored evaluation, replace every placeholder with p50/p90 actuals, publish a plan/channel contribution table and run ±25% stress tests for support, vendor cost, retention and channel mix.
