# Architecture Decision Records

These decisions govern BoomerBuddy 2.0 together with the [master spec](../BOOMERBUDDY-2.0-MASTER-SPEC.md). `Accepted` means the direction is selected, not that it is implemented or production-verified. Each Run 2 ADR distinguishes local design evidence from proof blocked by accounts, infrastructure, datasets, or professional review.

1. [Modular monolith and TypeScript monorepo](./0001-modular-monolith-and-monorepo.md)
2. [PostgreSQL canonical schema with PGlite locally](./0002-postgresql-canonical-pglite-local.md)
3. [Managed identity and central resource authorization](./0003-managed-identity-and-resource-authorization.md)
4. [Sensitive-artifact encryption and keyed fingerprints](./0004-sensitive-artifact-encryption-and-keyed-fingerprints.md)
5. [Transactional outbox and at-least-once events](./0005-transactional-outbox-and-at-least-once-events.md)
6. [No submitted-URL fetch and isolated future acquisition](./0006-no-url-fetch-and-isolated-future-acquisition.md)
7. [Deterministic fraud core with optional constrained AI](./0007-deterministic-fraud-core-and-optional-ai.md)
8. [Provider-neutral canonical entitlements](./0008-provider-neutral-entitlements.md)
9. [Expo mobile with explicit native boundaries](./0009-expo-mobile-with-native-extension-boundaries.md)
10. [Separate customer and HQ applications](./0010-separate-customer-and-hq-applications.md)
11. [Orthogonal household authority and pairwise trust](./0011-orthogonal-household-authority-and-pairwise-trust.md)
12. [Append-only consent and identity-bound invitations](./0012-append-only-consent-and-identity-bound-invitations.md)
13. [Typed fraud evidence, redaction, and active risk semantics](./0013-typed-fraud-evidence-redaction-and-risk-semantics.md)
14. [Privacy-bounded public Check and attribution](./0014-privacy-bounded-public-check-and-attribution.md)
15. [Portable platform and Replit continuity](./0015-portable-platform-and-replit-continuity.md)
16. [Durable database-backed jobs and outbox delivery](./0016-durable-database-backed-jobs-and-outbox.md)
17. [Provider-neutral commerce and storefront policy](./0017-provider-neutral-commerce-and-storefront-policy.md)
18. [Business OS, owner attention, and bounded autonomy](./0018-business-os-owner-attention-and-bounded-autonomy.md)
19. [Governed V1 curation and evaluation evidence](./0019-governed-v1-curation-and-evaluation-evidence.md)

Superseding a decision requires a new dated ADR, affected contract/test changes, migration and rollback plans, and updates to source evidence.
