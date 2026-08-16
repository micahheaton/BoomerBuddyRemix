# BoomerBuddy HQ

HQ is the internal control plane, not a homemade replacement for every SaaS tool. It operates the differentiated links between customer safety, household activation, fraud quality, entitlements, partners, and revenue.

## Initial modules

| Module | Own now | Integrate/defer |
|---|---|---|
| Owner | trusted metrics, alerts, cost framework | accounting cash truth |
| Customers | people, households, plans, orientation, consent state | mass messaging |
| Fraud Ops | analyses, evaluation runs, review queue, provider status | premium threat feeds |
| Revenue | target accounts, opportunities, next actions, pilots | enrichment and sequences |
| System | health, jobs/outbox, environment, provider adapters, audit | production observability vendor |

## Access model

HQ uses a separate application and employee identity boundary. Roles (`owner`, `support`, `fraud_analyst`, `customer_success`, `revenue`, `system_admin`) grant task-specific actions. Customer content is hidden by default; future content access requires case purpose, step-up authentication, explicit grant, reason, expiry, and audit. Impersonation is not part of Build Run 1.

## Data truth

Every card names its source, update time, definition, and whether data is seeded. Revenue is reconciled to commerce events; safety metrics come from versioned evaluations; partner outcomes remain aggregated. No card displays invented MRR, loss prevented, or customer counts outside a visibly labeled development seed.
