# ADR-0002: PostgreSQL Schema with PGlite for Local Tests

Status: **Accepted for Build Run 1; production equivalence unverified**

Decision date: 2026-08-15

## Context

The product needs real relational constraints, tenant ownership, transactions, migrations, and deterministic tests without requiring a cloud database during the gauntlet. An in-memory object store or SQLite would hide PostgreSQL behavior and repeat v1 persistence drift.

## Decision

Make forward SQL migrations for a supported PostgreSQL version the canonical schema. Use PGlite to execute the same migrations in local development and most tests. Use a typed query layer with explicit repositories; DTOs and domain objects do not expose database rows.

Every tenant-owned parent has unique `(tenant_id, id)` and each tenant-owned child repeats `tenant_id` with a composite foreign key to that pair. Scoped repositories require an authorization scope and apply tenant plus resource predicates. Optional PostgreSQL row-level security is later defense in depth, never the only authorization layer.

CI and prelaunch staging must also exercise real PostgreSQL, including concurrency, constraints, extensions actually used, migrations, backups, and restore. PGlite-specific behavior cannot become the production contract.

## Consequences

Local setup is fast and tests use PostgreSQL semantics for much of the schema. PGlite is not complete operational equivalence; real-server coverage remains a release gate. SQL migrations require deliberate backward compatibility and expand-migrate-contract for destructive changes.

Rejected: SQLite, ORM auto-sync/`db push` as migration history, cloud-only development, and unconstrained per-test mocks as integration evidence.

## Evidence

Accessed 2026-08-15: [PGlite documentation](https://pglite.dev/docs/) and [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).
