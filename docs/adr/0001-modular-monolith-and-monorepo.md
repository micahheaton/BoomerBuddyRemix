# ADR-0001: Modular Monolith in a TypeScript Monorepo

Status: **Accepted for Build Run 1; not yet implemented**

Decision date: 2026-08-15

## Context

BoomerBuddy must prove one narrow Check flow while preserving household consent, employee separation, mobile clients, provider portability, and atomic audit. A small team cannot safely operate distributed data ownership and network failure modes before product demand is known.

## Decision

Use Node.js 22, strict TypeScript, ES modules, and locked npm workspaces. Deploy `api`, customer `web`, employee `hq`, and Expo `mobile` separately, with framework-independent domain, contract, authorization, fraud, persistence, configuration, observability, and design packages.

The API is a modular monolith. Each bounded module owns its lifecycle and mutations; cross-module work uses application services and versioned domain events. Domain code imports no database, UI, transport, or vendor SDK. One canonical PostgreSQL database provides atomic domain, audit, and outbox writes.

Extract a service only for measured independent scale, residency, reliability, or hostile-input isolation. A new service must have an owner, SLO, threat boundary, idempotent contract, and migration/rollback plan.

## Consequences

Run 1 gets simple local operation, refactoring safety, one transaction boundary, and real module seams. Deployment isolation is weaker than microservices, so repository boundaries, dependency checks, tenant constraints, and tests must enforce ownership. Later extraction carries migration cost, accepted in exchange for avoiding premature operations.

Rejected: microservices/event sourcing as default, a single combined customer/HQ frontend, and preserving the v1 application as the new foundation.

## Verification

CI checks dependency direction, strict types, package tests, migrations, module-boundary security tests, and atomic audit/outbox behavior. See [NIST SSDF](https://csrc.nist.gov/pubs/sp/800/218/final), accessed 2026-08-15.
