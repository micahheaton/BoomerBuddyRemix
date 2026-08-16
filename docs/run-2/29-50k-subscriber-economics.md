# 29 — 50K Subscriber Economics

Status: **scenario complete; commercial validation blocked**

## Finding

The founder’s 50,000 revenue-bearing subscriber-equivalent and approximately $1 million operating-profit targets are internally possible, not proven. The canonical [50K Subscriber Model](./50K-SUBSCRIBER-MODEL.md) uses the implemented Business OS formula and keeps subscribers, paid households, protected members, sponsor eligibility, sponsor activation, and revenue-bearing equivalents separate.

The base case assumes 30% Plus / 70% Family, 60% annual billing, 25% app-store checkout, 3% monthly churn, `$35` settled-household CAC, and `$2.25` of variable household-month cost. It produces `$141.91` annual recognized revenue and `$102.35` annual contribution per paid household, a 72.1% contribution margin. None of those mix, cost, churn, or CAC inputs is observed.

## Scale interpretation

| Average paid households | Revenue | Contribution | Fixed-cost envelope | Operating profit / (loss) |
| ---: | ---: | ---: | ---: | ---: |
| 100 | $14k | $10k | $250k | ($240k) |
| 1,000 | $142k | $102k | $450k | ($348k) |
| 5,000 | $710k | $512k | $700k | ($188k) |
| 10,000 | $1.42M | $1.02M | $1.05M | ($26k) |
| 25,000 | $3.55M | $2.56M | $2.00M | $559k |
| 50,000 | $7.10M | $5.12M | $4.10M | **$1.02M** |

The result is narrow. At 50K, `$3.50` rather than `$2.25` variable cost drops profit to about `$268k`; a 30% instead of 15% app-store take on the modeled store share drops it to about `$752k`; doubling maintenance CAC drops it to about `$388k`. Combining higher service cost and the store-fee stress leaves the company approximately break-even before extra CAC.

## Break-even discipline

At the 50K operating structure, zero-profit break-even is approximately 40,058 average paid households; the `$1M` threshold is approximately 49,828. “50K” must mean an average revenue-bearing balance, not year-end accounts. At 3% monthly churn, maintaining 50K implies roughly 18,000 replacement acquisitions/year and `$630k` of maintenance CAC at `$35`, already included in the `$1.2M` marketing envelope. Net-new growth CAC and launch-ramp burn remain outside the table.

A sponsor-eligible person contributes zero subscriber equivalents. The canonical model counts an activated sponsor household only by its actual recurring contribution relative to `$102.35`; low-revenue sponsor seats therefore require more than one activation per direct equivalent.

## Evidence and gates

Current primary fee anchors are [Stripe Payments](https://stripe.com/pricing), [Stripe Billing](https://stripe.com/billing/pricing), [Apple subscriptions](https://developer.apple.com/app-store/subscriptions/), and [Google Play fees](https://support.google.com/googleplay/android-developer/answer/112622?hl=en). Store account eligibility and jurisdictional rules remain external blockers.

Before scaling acquisition, require settled cohort evidence for price/mix, 90-day survival, refunds, support minutes, channel fees, and CAC. Before first dollar, require professional accounting/tax treatment, commerce reconciliation, security/privacy/accessibility gates, and funded support ownership. No scenario authorizes spending, hiring, charging, or launch.
