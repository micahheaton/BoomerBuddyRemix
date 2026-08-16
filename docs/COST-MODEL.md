# Cost Model

Status: directional planning model, USD, accessed/estimated 2026-08-15. Reprice vendors before commitment. Labor, tax, legal, insurance, and acquisition vary too widely to present as fixed quotes.

## Build Run 1 reconciliation

Build Run 1 incurred no authorized external vendor, infrastructure, messaging, intelligence, payment, deployment, or customer-acquisition spend. It used local PGlite, synthetic personas, local provider states, and development-only credentials, so it produced **no observed production unit cost**. The estimates below remain planning inputs rather than validation.

The implementation reinforces four budgeting realities:

- managed identity/KMS, hosted PostgreSQL with backup/restore, durable jobs, monitoring, commerce reconciliation, legal/privacy work, independent security and accessibility review, and staffed incident/support ownership are first-dollar requirements, not optional scale polish;
- 11 high and 7 moderate production-dependency advisories remain in the production dependency audit, largely through the Expo/React Native toolchain, so compatible remediation and ongoing software-supply-chain work need time and budget before release;
- the 12-case synthetic fraud suite does not justify buying multiple intelligence feeds; fund a rights-cleared adjudicated corpus first, then pay for one source only if it demonstrates marginal safety lift; and
- human research, fraud review, support, channel fees, and acquisition are more likely to dominate economics than the current text-inference hypothesis.

## Unit assumptions

- Family hypothesis: $14.99 monthly; annual mix and discounts not modeled.
- Typical AI-assisted text check: 4,000 input + 800 output tokens. At current GPT-5.6 Luna list rates ($0.20/$1.20 per 1M), this infers about **$0.0018/check** before retries, tools, caching, or other providers. Build Run 1 does not call it.
- Web Risk Lookup is free through 100,000 calls/month, then $0.50/1,000. Do not use noncommercial Safe Browsing for a paid product.
- Stripe domestic online card: 2.9% + $0.30; optional Stripe Billing pay-as-you-go currently adds 0.7% of billing volume.
- Apple/Google subscription commissions can be about 15% for qualifying subscriptions/programs and may dominate inference costs; channel mix matters.

Sources: [OpenAI](https://developers.openai.com/api/docs/models/compare), [Google Web Risk](https://cloud.google.com/web-risk/pricing), [Stripe](https://stripe.com/pricing), [Apple](https://developer.apple.com/programs/whats-included/), [Google Play](https://support.google.com/googleplay/android-developer/answer/112622?hl=en).

## Stage model

| Category                        |         First dollar |               100 families |           10,000 families | Notes                                                                                                                                          |
| ------------------------------- | -------------------: | -------------------------: | ------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting/API/web/HQ              |           $25–150/mo |                    $75–400 |                $500–3,000 | Managed app runtime/CDN; load-test before scaling.                                                                                             |
| PostgreSQL/backups              |              $15–100 |                    $50–300 |                $500–2,500 | Neon Launch lists typical intermittent use near $15; scale/security tier can be much higher.                                                   |
| Object storage/scanning         |                $0–50 |                    $10–150 |               $200–2,000+ | Images/audio deferred; scanning may be enterprise-priced.                                                                                      |
| Identity                        |               $0–100 |                     $0–250 |                 $0–2,500+ | AuthKit user management currently has a large free tier; SSO connections cost extra.                                                           |
| URL intelligence                |                   $0 |                         $0 |      $0–450 at 1M lookups | Premium feeds may add $10k+/year and require measured lift.                                                                                    |
| Inference                       |                $0–50 |              roughly $2–50 |       roughly $180–2,000+ | 100k–1M checks under the token assumption; provider mix/retries dominate.                                                                      |
| Transactional email             |                $0–20 |                      $0–20 |                   $35–160 | Resend publishes 3k free and $20/50k.                                                                                                          |
| SMS                             | usage + registration |                    $10–100 | $350+ before carrier fees | Twilio base is $0.0083/segment; consent, carrier and 10DLC costs apply.                                                                        |
| Push                            |                $0–19 |                      $0–50 |                   $50–500 | Expo Starter is $19; app-store accounts: Apple $99/year, Google $25 once.                                                                      |
| Payments                        |             variable |              about $74/mo* |          about $7,350/mo* | *At $14.99 monthly via Stripe cards; excludes Billing/tax and channel commissions.                                                             |
| App-store commission            |             variable |             up to ~$225/mo |         up to ~$22,485/mo | If all modeled revenue is subject to a 15% commission.                                                                                         |
| Observability/analytics         |               $0–100 |                    $25–300 |               $250–2,000+ | Start with redaction and sampling; no artifact content.                                                                                        |
| Support tooling                 |               $0–100 |                     $0–200 |               $500–3,000+ | Human support labor is separate and likely larger.                                                                                             |
| Prospecting/enrichment          |                   $0 | $0–79/seat/mo if validated |     contract/credits vary | Optional B2B acceleration. Apollo currently lists Free, $49 Basic, and $79 Professional annual-billing rates; credits expire and usage varies. |
| Accounting/tax/payroll software |              $50–500 |                 $100–1,000 |             $1,000–5,000+ | Integrate specialists; professional fees excluded.                                                                                             |
| Security/compliance             |     $20k–75k project |                maintenance |             $50k–250k+/yr | Independent review, testing, policies, vendor/partner diligence.                                                                               |

## Stage requirements

- **Required at first dollar:** production identity, payments/reconciliation, database/backups, app hosting, monitoring, email, legal/privacy/security/accessibility review, accounting and tax workflow, app-store accounts if mobile commerce.
- **Required around 100 families:** support case workflow, reliable jobs, restore drills, fraud review cadence, product analytics, spend alerts, expanded evaluation set.
- **Required around 10,000 families:** stronger database/observability, 24/7 incident path, dedicated fraud/customer operations, vendor SLAs, formal compliance program, partner reporting, data warehouse/read models.
- **Optional acceleration:** premium intelligence, advanced experimentation, brand agency, paid acquisition, and prospect enrichment. Current example economics: [Apollo pricing](https://www.apollo.io/pricing) and [credit rules](https://knowledge.apollo.io/hc/en-us/articles/9527776320781-What-Are-Credits); recheck before purchase.
- **Enterprise/B2B:** SSO/SCIM connections, security questionnaires/audits, contract/DPA work, partner implementation and support; price these into contracts.

The largest likely variable costs are distribution commissions, payment fees, human support/fraud operations, and acquisition—not basic model tokens.

## Run 2 implementation delta — 2026-08-16

Run 2 again incurred no authorized external vendor, infrastructure, payment, messaging, intelligence, deployment, acquisition, professional, or hiring spend. It therefore still provides **no observed production unit cost**. The Run 1 dependency paragraph above is historical: the Run 2 offline cached npm audit reported zero known advisories in its captured graph, but no live registry recheck, SBOM/license/provenance review, container scan, or remote CI evidence exists; see the [Run 2 dependency review](./run-2/27-dependency-review.md).

The current [50K Subscriber Model](./run-2/50K-SUBSCRIBER-MODEL.md) supersedes the simpler Run 1 family-only arithmetic for scenario planning. It assumes a 30% Plus/70% Family mix, 60% annual billing, 25% app-store mix, 3% monthly logo churn, `$35` replacement CAC, 1.5% refunds/bad debt, and `$2.25` of variable service cost per paid household-month. Prices and every behavioral input remain hypotheses. Published payment/store references are [Stripe Payments](https://stripe.com/pricing), [Stripe Billing](https://stripe.com/billing/pricing), [Apple subscriptions](https://developer.apple.com/app-store/subscriptions/), and [Google Play service fees](https://support.google.com/googleplay/android-developer/answer/112622?hl=en).

Exact base unit math is:

`$141.912 recognized revenue − $5.108832 web fees − $5.3217 store fees − $2.12868 refunds/bad debt − $27 variable service = $102.352788 annual contribution per average paid household`

| Average paid households | Revenue | Contribution | Fixed-cost scenario | Operating profit/(loss) |
| ---: | ---: | ---: | ---: | ---: |
| 100 | $14,191 | $10,235 | $250,000 | ($239,765) |
| 1,000 | $141,912 | $102,353 | $450,000 | ($347,647) |
| 5,000 | $709,560 | $511,764 | $700,000 | ($188,236) |
| 10,000 | $1,419,120 | $1,023,528 | $1,050,000 | ($26,472) |
| 25,000 | $3,547,800 | $2,558,820 | $2,000,000 | $558,820 |
| 50,000 | $7,095,600 | $5,117,639 | $4,100,000 | $1,017,639 |

At the 50K fixed-cost envelope, operating break-even is about 40,058 average paid households and the `$1 million` threshold is about 49,828. The target fails under plausible independent stress to app-store take, service cost, CAC, or recognized price. Fixed costs include market-value founder/replacement capacity, payroll/contractors, legal/security/privacy, marketing/CAC, software/fixed hosting, and tax/administration; operating profit is before interest, income tax, depreciation/amortization, and owner distributions.

Direct paid households, protected people, sponsor-eligible people, sponsor-activated households, and revenue-bearing equivalents must remain separate. Eligible or activated sponsor volume counts economically only after settled contract contribution and reconciliation. Replace placeholders after real invoices, 50 settled households, channel-specific acquisition observations, 90-day cohort survival, and measured support minutes; obtain qualified tax/accounting review before first dollar.
