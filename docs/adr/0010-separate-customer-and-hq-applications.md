# ADR-0010: Separate Customer and HQ Applications

Status: **Accepted for Build Run 1**

Decision date: 2026-08-15

## Context

Customer and employee interfaces have different threat models, information density, assurance, accessibility, release cadence, and incident impact. The v1 blurred administration with consumer identity and exposed unsafe privileged paths.

## Decision

Build customer web and BoomerBuddy HQ as separate applications, origins, identity clients, session audiences, cookie names, route trees, and deployments. They may share contracts and design foundations but never middleware that treats an employee as a customer administrator. Customer and HQ services call explicit application use cases and central authorization; HQ is not direct database access or a policy bypass.

Customer content is absent from HQ lists by default. Restricted access requires a review/support case, explicit legal/consent basis, recent production MFA/step-up, time-bound grant, visible reason, immutable audit, and periodic review. Run 1 HQ uses seeded projections labeled as seed data; no external CRM, accounting, payroll, support, or communications connection.

The modular monolith and database may be shared initially, but routes, repository scopes, schemas/projections, tests, telemetry audiences, CSP/origin configuration, and deployment credentials preserve the boundary. A later dedicated service/database requires measured isolation or scale evidence.

## Consequences

A shared component/domain change can still serve both surfaces, while a customer XSS/session cannot automatically become HQ authority. There are two builds and more contract/E2E tests. Operational staff cannot use hidden impersonation shortcuts.

Rejected: one SPA with role-hidden navigation, shared cookies, employee `isAdmin` on customer accounts, direct SQL dashboards, and full customer-content search.

## Verification

Tests prove cross-audience rejection, distinct cookies/origins, no customer routes in HQ bundles, redacted projections, scoped repositories, and audited temporary access.
