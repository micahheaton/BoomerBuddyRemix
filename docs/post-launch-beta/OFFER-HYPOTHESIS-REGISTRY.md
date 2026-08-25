# Offer Hypothesis Registry

## Boundary

Family at USD 14.99 per month is the only public or live offer. Its production Checkout contract,
Stripe mapping, and customer copy remain separate from this registry.

The registry in `packages/domain/src/revenue-hypotheses.ts` is evidence for controlled future
experiments only. Every entry has exactly two allowed scopes: `synthetic` and `stripe_sandbox`.
Every entry disables public routes, production activation, and live provider writes. No API route,
web billing surface, worker, Stripe integration, production configuration, or live contract may
consume the registry.

## Version 1 subscription hypotheses

| Key | Name | Amount | Interval | Role | Allowed scopes |
| --- | --- | ---: | --- | --- | --- |
| `offer-hypothesis-family-monthly-v1` | Family monthly USD 14.99 | 1,499 cents | month | synthetic control | synthetic, stripe_sandbox |
| `offer-hypothesis-family-annual-v1` | Family annual USD 149 | 14,900 cents | year | synthetic candidate | synthetic, stripe_sandbox |
| `offer-hypothesis-individual-monthly-v1` | Individual monthly USD 8.99 | 899 cents | month | synthetic candidate | synthetic, stripe_sandbox |
| `offer-hypothesis-individual-annual-v1` | Individual annual USD 89 | 8,900 cents | year | synthetic candidate | synthetic, stripe_sandbox |

The former USD 119 Family annual founding experiment is retired. The legacy
`founding_experiment` kind can remain readable for historical catalog, migration, and replay
evidence, but no active domain hypothesis emits USD 119 and no new experiment may select it.

## Version 1 referral hypotheses

| Key | Eligible hypothesis | Non-cash service credit | Per-referrer and household cap | Program liability cap |
| --- | --- | ---: | ---: | ---: |
| `referral-hypothesis-family-service-credit-v1` | Family monthly | 1,499 cents | 3 credits, 4,497 cents | 149,900 cents |
| `referral-hypothesis-individual-service-credit-v1` | Individual monthly | 899 cents | 3 credits, 2,697 cents | 89,900 cents |

Both referral hypotheses require the referred subscription's first settled payment. They deny the
same person, same household, same payment identity, and an already-attributed recipient. They do
not allow cash payout, transfer, external action, public activation, production activation, or live
provider writes.

## Promotion gate

Synthetic or Stripe sandbox evidence does not promote an offer. A later production proposal needs
a new reviewed production contract, customer copy, tax and accounting disposition, refund and
cancellation behavior, provider-resource preflight, attribution proof, bounded rollout, stop rule,
and rollback. Editing this registry alone can never activate an offer or referral program.
