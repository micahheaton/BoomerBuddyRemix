# Architecture Decision Records

These decisions govern Build Run 1 together with the [master spec](../BOOMERBUDDY-2.0-MASTER-SPEC.md). `Accepted` means the direction is selected, not that it is implemented or production-verified.

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

Superseding a decision requires a new dated ADR, affected contract/test changes, migration and rollback plans, and updates to source evidence.
