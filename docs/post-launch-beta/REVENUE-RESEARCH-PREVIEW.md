# Local Revenue Research Preview

Status: implemented locally, disabled by default, noncollecting, and not authorized for deployment
or participant exposure.

## Boundary

The isolated route is `/research/offer-pair-v2`. It is not linked by the public site. It always
returns not found unless all three runtime conditions are exact:

```text
NODE_ENV=development or NODE_ENV=test
BB_LOCAL_REVENUE_RESEARCH_PREVIEW_ENABLED=true
BB_LOCAL_REVENUE_RESEARCH_PREVIEW_SECOND_GUARD_CONFIRMED=true
```

Production, an unknown runtime, a missing flag, or a differently cased value fails closed. The
route also emits noindex and nofollow metadata and a no-referrer policy.

The preview has no form, API route, cookies, browser storage, analytics, contact fields, free text,
submitted URLs, provider calls, Checkout links, or purchase actions. Coverage and response choices
exist only in transient React state and disappear when the page closes or reloads. Presentation
order comes from a server random selector, while a pure exact-selector function makes both orders
deterministic under test. No order or response is retained.

## Offer and referral truth

[OFFER-HYPOTHESIS-REGISTRY.md](./OFFER-HYPOTHESIS-REGISTRY.md) remains controlling for default-off
Individual, group-rate, and referral hypotheses and preserves historical Family annual research.
The versioned production catalog now defines Family annual at USD 149.90 after a seven-day trial as
the intended default and retains Family monthly at USD 14.99 without a trial; neither is live.
Account creation alone does not start a trial or charge. Individual offers remain default-off and
referrals remain disabled. This historical local preview does not activate, map, reserve, sell, or
collect evidence for any offer or hypothesis.

Automated security tests bind every displayed amount, saving, cap, and allowed response to registry
version 2. They also prove the route is double-gated and local-only, contains no submission path,
and is not imported or linked by any other web source.

## Stop rule

Do not deploy or expose this route. Stop on any public link, production enablement, durable state,
network submission, provider dependency, PII, Checkout reachability, candidate arithmetic drift,
or response value outside `monthly`, `yearly`, `neither`, and `unsure`. Roll back by leaving either
guard unset and removing the isolated route from any local access group.
