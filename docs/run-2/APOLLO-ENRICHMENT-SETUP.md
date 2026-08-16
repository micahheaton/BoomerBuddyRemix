# Apollo Enrichment Setup

Status: **offline fixture contract implemented; no Apollo account, credential, network call, live data, enrichment result, or outreach**

Implementation date: 2026-08-16

## What exists

[`enrichment.ts`](../../packages/integrations/src/enrichment.ts) defines a provider-neutral `EnrichmentProvider` and an Apollo-labeled, deterministic fixture implementation. It supports three bounded research operations:

| Operation                 | Allowed input                                                                      | Allowlisted output                                                     |
| ------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `organization_search`     | Organization name/domain and coarse business filters                               | Public company fields with field-level fixture provenance              |
| `organization_enrichment` | Canonical internal organization ID plus provider ID or domain                      | Requested public company fields only                                   |
| `contact_discovery`       | Canonical organization ID, business domain/provider ID, role families, seniorities | Professional role, business profile, and business email fixture fields |

Every result is marked `environment: fixture`, `evidenceState: fixture`, and `intentClaimed: false`. The boundary has no HTTP client, API-key input, persistence, opportunity creation, campaign/sequence method, or message sender. It cannot make a live request: non-fixture modes fail with `enrichment.live_transport_not_implemented`, and a source declaring network access is rejected.

Synthetic fixtures use reserved `.example` domains and fictional people/institutions. They demonstrate shape and failure behavior only; they are not leads, matches, buyer intent, validation, or traction.

## Run locally

No environment variable or provider account is required.

```bash
npm install
npm run typecheck -w @boomerbuddy/integrations
npx vitest run packages/integrations/src/enrichment.test.ts
```

Create the fixture provider only in a test/research process:

```ts
import {
  ApolloFixtureEnrichmentProvider,
  DEFAULT_APOLLO_FIXTURE_CONFIG,
  DeterministicApolloFixtureSource,
} from '@boomerbuddy/integrations';

const enrichment = new ApolloFixtureEnrichmentProvider(
  DEFAULT_APOLLO_FIXTURE_CONFIG,
  new DeterministicApolloFixtureSource(),
);
```

Callers must supply `purpose: 'b2b_research'`, an operator/request ID, an ISO timestamp, an explicit data-class grant, a record ceiling, and a cost-unit ceiling. Strict runtime validation rejects unknown fields and recursively rejects customer/household/Check artifacts, submitted messages, consent records, payment data, credentials, secrets/tokens, phones, personal email, and safe words before fixture execution.

The deterministic regressions are in [`enrichment.test.ts`](../../packages/integrations/src/enrichment.test.ts). They cover field minimization/provenance, truthful unavailable and rate-limit states, disabled and kill-switch behavior, record/cost ceilings, forbidden data, malformed fixtures, offline-only construction, and repeatability.

## Isolation contract

1. Use enrichment only to research an institution or professional role. Never send a Check artifact, household/customer identifier, protected-person record, consent state, billing record, or message-derived text across this boundary.
2. Keep the provider identifier separate from the canonical Business OS organization ID. A provider record cannot create or advance an opportunity and cannot establish stakeholder interest, authority, consent, or intent.
3. Do not persist fixture contact details into customer tables or attach them to support/fraud records. Any future business-research store needs a separate schema, scoped repository, retention policy, deletion path, role review, and audit trail.
4. No output authorizes email, calling, sequencing, social contact, or ad targeting. Outreach needs a separately approved workflow with applicable privacy/marketing review, suppression handling, source evidence, a named human owner, and channel-specific authorization.
5. Keep the kill switch engaged for any future provider mode until account ownership, terms, privacy, cost, field mapping, logging, deletion, and incident controls have independent evidence.

## Apollo mapping for a future authorized adapter

This section is a design map, not active configuration. Apollo currently documents API-key authentication through the `x-api-key` header for Apollo users and OAuth 2.0 for partners acting for mutual users. A future company-owned integration should use a least-privilege scoped key, never a master key unless a reviewed endpoint makes it unavoidable. See Apollo’s [Authentication](https://docs.apollo.io/reference/authentication) and [Create an API Key](https://docs.apollo.io/docs/create-api-key) documentation.

The likely mappings, to be reverified on the implementation date, are:

- `organization_search` → Apollo [Organization Search](https://docs.apollo.io/reference/organization-search), currently `POST /api/v1/mixed_companies/search`, documented at one credit per page.
- `organization_enrichment` → Apollo [Organization Enrichment](https://docs.apollo.io/reference/organization-enrichment), currently `GET /api/v1/organizations/enrich`, documented at one credit per organization.
- `contact_discovery` → Apollo [People API Search](https://docs.apollo.io/reference/people-api-search), currently `POST /api/v1/mixed_people/api_search`. Apollo states that search returns neither email nor phone; those require a separate enrichment operation.

BoomerBuddy must not enable Apollo phone reveal, personal-email reveal, waterfall enrichment, or webhook delivery under this contract. Apollo’s [People Enrichment](https://docs.apollo.io/reference/people-enrichment) describes those as separate options with different credit and data consequences; they remain expressly out of scope.

## Future setup checklist — blocked, do not execute in Run 2

Only after founder authorization and professional review:

1. Establish an LLC-owned Apollo account with named owner/backup, phishing-resistant MFA where available, approved plan/budget, billing alerts, export/deletion procedure, and reviewed terms/DPA/subprocessors/data geography.
2. Recheck official endpoints, scopes, response schemas, credit charges, pagination, rate-limit headers, retention rights, and applicable privacy/marketing obligations. Apollo exposes plan usage and per-endpoint limits in its developer dashboard; do not hard-code today’s limits. See [Apollo API](https://docs.apollo.io/reference/apollo-api).
3. Create a least-privilege key limited to approved search/enrichment endpoints. Store it in the chosen server-side secret manager; never commit it or expose it to web/mobile/HQ clients.
4. Add a new, separately reviewed live transport. Require HTTPS, tight timeouts, bounded concurrency, no unsafe automatic retry, explicit `401/403/422/429/5xx` handling, response-size limits, strict allowlist parsing, structured redacted audit events, and kill-switch enforcement before dispatch.
5. Use server-only configuration names such as `APOLLO_ENRICHMENT_ENABLED`, `APOLLO_ENRICHMENT_MODE`, `APOLLO_API_KEY`, `APOLLO_MAX_RECORDS_PER_REQUEST`, and `APOLLO_MAX_CREDITS_PER_REQUEST`. These names are documentation only; Run 2 intentionally has no loader for them.
6. Build recorded-response contract fixtures from rights-cleared, fully synthetic payloads. Never commit a real provider response, key, person, email, profile, or institution export.
7. Prove denial of forbidden inputs, field minimization, provider outage/rate-limit behavior, budget exhaustion, key rotation/revocation, deletion, access review, and kill-switch operation in access-restricted staging.
8. Obtain a founder go/no-go record. A successful sandbox query would prove transport behavior only; it would not prove data accuracy, buyer interest, permissible outreach, product-market fit, or launch readiness.

## Remaining external blockers

- Apollo company account, current commercial plan, endpoint scopes, credits/rate limits, and contract terms
- Privacy/legal review for business-contact sourcing, retention, deletion, suppression, and any later outreach geography/channel
- Separate server-side secret/KMS, production identity, audit ownership, incident response, and access review
- A dedicated, isolated Business OS persistence/import workflow with provenance and rollback
- Human verification of record accuracy and institutional role; provider output never becomes opportunity or intent evidence automatically
- Founder authorization for any account creation, live transport, paid credit, real record, persistence, or contact

Until those blockers are closed, this capability remains fixture-only and cannot enrich or contact anyone.
