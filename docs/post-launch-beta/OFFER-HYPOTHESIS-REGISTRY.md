# Offer Hypothesis Registry

## Boundary

The versioned production catalog now defines Family annual at USD 149.90 after a seven-day trial as
the intended default repository candidate and retains Family monthly at USD 14.99 without a trial.
Neither offer is live. Account creation alone does not start a trial or charge; a customer must
explicitly select Checkout, consent, and provide a payment method. The production catalog, Stripe
mapping, and customer copy remain separate from this hypothesis registry.

For default-off Individual, group-rate, and referral hypotheses, this document is the controlling
planning index and `packages/domain/src/revenue-hypotheses.ts` is the controlling typed registry.
Family annual rows here remain historical research evidence; the versioned production catalog
controls the current Family repository candidates. Conflicting historical or exploratory text
grants no execution authority.

The registry is evidence for controlled future experiments only. Every entry has exactly two
allowed scopes: `synthetic` and `stripe_sandbox`. Every entry disables public routes, production
activation, and live provider writes. Only test/spec code or an isolated sandbox orchestrator may
read it. No production API route, web billing surface, worker, Stripe integration, configuration,
customer copy, live contract, or live provider resource may consume it. Prompts must link here
instead of restating candidate terms as approved production plans.

Two historical Run 2 compatibility fixtures remain readable: `seededCommercePlanVersions` in
`packages/domain/src/commerce.ts` and `priceHypotheses` in `packages/persistence/src/seed.ts`. They
preserve immutable local migration, replay, and demo evidence, including former Plus and annual
values. They are not current offer hypotheses, production Checkout contracts, provider mappings, or
promotion inputs. Do not update historical rows in place or infer authority from them. A future
approved offer requires a new versioned production contract that passes the promotion gate below.

## Version 2 subscription hypothesis registry

| Key | Name | Amount | Interval | Role | Allowed scopes |
| --- | --- | ---: | --- | --- | --- |
| `offer-hypothesis-family-monthly-v1` | Family monthly USD 14.99 | 1,499 cents | month | synthetic control | synthetic, stripe_sandbox |
| `offer-hypothesis-family-annual-v2` | Family annual USD 149.90 | 14,990 cents | year | synthetic candidate | synthetic, stripe_sandbox |
| `offer-hypothesis-individual-monthly-v1` | Individual monthly USD 8.99 | 899 cents | month | synthetic candidate | synthetic, stripe_sandbox |
| `offer-hypothesis-individual-annual-v2` | Individual annual USD 89.90 | 8,990 cents | year | synthetic candidate | synthetic, stripe_sandbox |

Each annual version 2 candidate costs exactly ten monthly payments. Family annual saves USD 29.98
and Individual annual saves USD 17.98 compared with twelve monthly payments, so each discount is
exactly two monthly payments. Automated tests bind this arithmetic. Family is the household
coverage hypothesis; no separate employer, association, or bulk group price has been specified, so
the registry does not invent one. The prior annual version 1 hypotheses remain historical evidence
and are not active registry entries.

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

## Experiment execution

[REVENUE-EXPERIMENT-ACTION-PACKET.md](./REVENUE-EXPERIMENT-ACTION-PACKET.md) is the exact synthetic
measurement specification and candidate-bound noncharging setup packet. It keeps offer-research
provider objects in a new isolated Stripe sandbox, leaves the existing legacy-webhook sandbox and
all live resources untouched, and permits only a private noncollecting website preview. It also
records the current funnel boundary: an access-intent receipt proves only `intent_created`, not an
email, received or qualified lead, payment, lead-to-paid conversion, or recurring revenue.

## Promotion gate

Synthetic or Stripe sandbox evidence does not promote an offer. A later production proposal needs
a new reviewed production contract, customer copy, tax and accounting disposition, refund and
cancellation behavior, provider-resource preflight, attribution proof, bounded rollout, stop rule,
and rollback. Editing this registry alone can never activate an offer or referral program.
