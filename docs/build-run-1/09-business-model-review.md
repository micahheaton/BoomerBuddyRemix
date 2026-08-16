# Business Model Review

Status: **[SCAFFOLDED] commercial architecture; [BLOCKED] willingness-to-pay and first-dollar readiness.**

## Packaging hypotheses

No plan is for sale. The same versioned values drive the domain model, local seed, API projection, and public pricing page.

| Plan                 |          Price hypothesis | Allowance hypothesis                              | Status                             |
| -------------------- | ------------------------: | ------------------------------------------------- | ---------------------------------- |
| Free                 |                        $0 | 1 protected adult; 0 Trusted Circle participants  | **[MOCK]** local access only       |
| Plus                 |   $8.99/month or $89/year | 1 protected adult; 2 Trusted Circle participants  | **[MOCK]** not purchasable         |
| Family               | $14.99/month or $149/year | 3 protected adults; 6 Trusted Circle participants | **[MOCK]** not purchasable         |
| Family founding test |                 $119/year | Same Family hypothesis; controlled offer only     | **[DEFERRED]** research experiment |

Free, Plus, and Family capabilities are explicit in `packages/domain/src/commerce.ts`. Run 1 enforces protected-member and Trusted Circle seat limits, but it does not define or enforce a monthly Check quota. No resource-intensive use is described as unlimited.

## What is built

- **[IMPLEMENTED]** Immutable product/plan versions, normalized subscription lifecycles, verified-source requirements, entitlement grants, sponsor/personal source precedence, household allowance allocation, and fail-closed access resolution.
- **[IMPLEMENTED]** One portfolio algorithm feeds session capabilities, owner entitlement views, and HQ status. Tests cover expiry, unverified sources, bad linkage, sponsor overlap/loss, exact limits, seat reuse, and multi-protected relationships.
- **[IMPLEMENTED]** Local commerce-event deduplication uses a keyed HMAC rather than storing raw payloads; reconciliation run state is represented.
- **[MOCK]** All subscriptions and sponsorships are local fixtures. There is no charge, checkout, renewal, refund, cancellation payment flow, tax calculation, receipt, or payer identity.

## Commercial thesis

The product being tested is recurring household coordination and safer follow-through, not paid access to a classifier. The three motions remain distinct:

1. Consumer household subscription.
2. Sponsored B2B2C access, initially a low-integration paid evaluation.
3. Later channel/reseller distribution with separately modeled economics.

**[DEFERRED]** Sponsored structures remain interview inputs: $3–$6 per activated household/month plus a minimum, $0.15–$0.40 per eligible member/month, or a $15,000–$30,000 fixed pilot. They are not quotes, market rates, leads, or relationships.

The directional economics show why channel matters. Under current assumptions, $14.99 monthly web yields about $14.26 after the illustrative card fee and before service cost; $149 annual web recognizes about $12.03/month after the annual card fee. The $119 app-store scenario falls to an illustrative 49.7% contribution margin under the placeholder cost model, so it should not become an assumed list price. None of these figures is observed BoomerBuddy economics.

## First-dollar gate

- **[BLOCKED]** Observed willingness to pay, settled customers, refund/support/retention cohorts, and verified safe-action outcomes.
- **[BLOCKED]** Production identity, payment/store integrations, entitlement reconciliation, receipts, cancellation, tax/accounting, backups, monitoring, and legal/security/accessibility approval.
- **[DEFERRED]** Paid acquisition and premium fraud data until activation, retention, quality lift, and contribution are measured.

The next commercial evidence should come from problem and buying-process interviews, transparent offer tests, and a small paid beta—not invented pipeline. See [Commercial Model and Pricing](../gauntlet-zero/15-commercial-model-pricing.md), [Unit Economics](../gauntlet-zero/36-unit-economics.md), and the [Cost Model](../COST-MODEL.md).
