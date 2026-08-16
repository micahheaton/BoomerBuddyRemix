# Build, Buy, and Integrate

Status: **decision framework and Run 1 choices designed on 2026-08-15; no production vendor is implemented or contracted**.

## Decision rule

Build what expresses BoomerBuddy's safety, consent, authorization, evidence, and entitlement contract. Buy mature commodity operations whose failure modes and regulatory surface exceed the team's differentiation. Integrate replaceable evidence and transaction sources through narrow ports. Reject architecture that creates irreversible cost before demand, quality, and operating capacity are proven.

The choice is not “fewest vendors.” It is the lowest whole-life risk: implementation and review effort, incident blast radius, privacy transfer, support burden, variable cost, policy dependence, migration cost, and time to validated customer value.

## Portfolio decisions

| Area | Choice and status | BoomerBuddy-owned invariant | Why / trigger to revisit |
|---|---|---|---|
| Fraud workflow and safe actions | **Build — designed for Run 1.** | Deterministic normalization/signals, evidence provenance, risk/confidence vocabulary, unknown/error semantics, explanation contract, action policy, and release evaluation. | This is the safety promise and learning loop. A critical false assurance blocks release regardless of provider score. |
| Household, Trusted Circle, and orientation | **Build — designed for Run 1.** | Scoped/versioned/revocable consent, relationship permissions, invitations, redacted sharing, safe-word verifier, and readiness workflow. | These encode dignity and anti-surveillance boundaries that generic family/account tools do not. |
| Identity proofing/authentication | **Buy and integrate — deferred for production.** | Internal person/identity link, audience, roles, tenant/resource authorization, recovery consequences, and audit. | Do not build password, MFA, passkey, federation, or recovery infrastructure. Revisit provider only on assurance, residency, support, B2B federation, or cost failure. |
| Authorization | **Build centrally — designed for Run 1.** | Deny-by-default policy over principal, session audience, action, tenant, resource ownership, relationship, consent, and entitlement; repository scope and negative tests. | A vendor role claim is input, not object authorization. Separate customer and HQ audiences remain mandatory. |
| Commerce and entitlements | **Integrate processors/stores; build normalization and grants — designed/deferred.** | Immutable plan versions, normalized subscription lifecycle, provider event inbox, entitlement grants/allowances, sponsor separation, reconciliation, and server enforcement. | Stripe/Apple/Google process transactions; none becomes the access model. Do not build card processing, tax calculation, or a store-receipt-only unlock. |
| Reputation/threat intelligence | **Integrate — deferred.** | Source provenance, freshness, limitations, cost/failure state, fusion policy, and independent evaluation. | Coverage changes faster than a small team can maintain. Add a feed only when it improves segmented quality after privacy/commercial review. Run 1 does no lookup or submitted-URL fetch. |
| AI model | **Integrate optionally — deferred and off without credentials.** | Minimized/schema-bound request, deterministic action authority, evaluation, version record, redaction, outage fallback, and user-visible limitation. | Training a foundation model is not differentiating or economically credible. A model is removable interpretation, not the verdict, memory, tool user, or policy engine. |
| Customer web, HQ, and mobile product | **Build on maintained frameworks — designed for Run 1.** | Separate customer/HQ builds and sessions; shared contracts/tokens; accessible flows; API-authoritative permissions and entitlements. | Product interaction is differentiating. Buy native commodity services, but retain Swift/Kotlin escape hatches for later share extensions/intents. |
| Data model and transactional core | **Build schema; buy managed operation later — designed/deferred.** | PostgreSQL migrations, tenant constraints, encryption boundary, keyed-HMAC fingerprints, audit/outbox transaction, retention/deletion state, and portable repositories. | PGlite accelerates local/tests; managed PostgreSQL/KMS/backups reduce production operations. Real PostgreSQL validation remains a gate. |
| Messaging and notifications | **Buy transport; build policy — deferred.** | Consent/suppression, purpose, template version, safe content, quiet hours, delivery state, retry policy, and incident-aware sequencing. | Carrier/email/platform delivery is commodity but regulated and operationally complex. Run 1 emits no real message. |
| Analytics and observability | **Build approved schemas/instrumentation; buy backend — designed/deferred.** | Metric definitions, privacy classification, redaction, correlation, source lineage, sponsor aggregation, alerts, and retention. | OpenTelemetry preserves backend portability. Generic analytics cannot define “safe action” or justify “fraud prevented.” |
| CRM, support, accounting, tax, payroll | **Buy/integrate narrowly — deferred.** | Domain references, sync provenance, reconciliation exceptions, and authorization to deep-link—not replicated sensitive artifacts. | These are commodity systems of record. HQ must not become a weak version of them. Start with export/manual operation; integrate only after repeated workload. |
| File storage, malware scan, OCR/transcription | **Buy primitives; build quarantine/extraction controls — deferred.** | Hostile-input isolation, type/size policy, authorization, retention, extraction provenance, and modality evaluation. | Specialized engines improve faster than a bespoke stack. No file/image/audio modality belongs in Run 1. |

## Explicit rejections and deferrals

- **Rejected:** microservices, Kubernetes, event streaming, a data lake/warehouse, custom identity, custom card processing, custom accounting/payroll/CRM, a trained foundation model, and an agent with tools or action authority in Run 1.
- **Rejected:** treating a client flag, payment-provider status, opaque ID, employee identity, or sponsor eligibility as permission to access a customer resource.
- **Rejected:** a general-purpose URL previewer or server-side browser in the product runtime. Run 1 never fetches submitted URLs. Any future acquisition service requires a separately isolated, deny-by-default worker and a new security decision.
- **Deferred:** production hosting, managed PostgreSQL/KMS, durable workers, live intelligence/AI, payments/stores, communications, object storage, CRM/support/accounting/payroll, analytics backend, deployment, and app-store submission.
- **Deferred:** RevenueCat or another store-commerce aggregator. Evaluate it only if native receipt/server-notification implementation and reconciliation effort demonstrably exceed vendor cost and lock-in; canonical BoomerBuddy entitlements remain regardless.

## Adapter acceptance test

A vendor cannot move from `deferred` to `implemented` until its adapter proves:

1. a versioned typed contract and normalized internal states, with vendor payloads confined to the edge;
2. least-data requests, no restricted content in logs/analytics, documented retention/training/subprocessors, and deletion/export behavior;
3. separated sandbox/live credentials, authenticity checks, idempotency, bounded retry, reconciliation, timeout/circuit state, spend limits, and a kill switch;
4. honest `unavailable`/`unknown` behavior and a safe degraded path—never fabricated success;
5. synthetic contract fixtures, provider sandbox tests, monitoring/owner/runbook, and an export/migration rehearsal;
6. no change to tenant/object authorization, consent, deterministic action policy, or provider-neutral entitlement enforcement.

## Build Run 1 line

Run 1 implements only local product/domain code and local/mock provider interfaces after the readiness gate. There are no external accounts or credentials and no production side effects. The completion report must update each relevant status to `implemented`, `implemented with mock provider`, `scaffolded`, `blocked`, or `deferred`; design text alone is not implementation evidence.

## Evidence

Official/primary sources accessed 2026-08-15:

- [NIST Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final)
- [OpenTelemetry vendor-neutral architecture](https://opentelemetry.io/docs/what-is-opentelemetry/)
- [Stripe-hosted Checkout](https://docs.stripe.com/payments/checkout) and [Stripe webhook guidance](https://docs.stripe.com/webhooks)
- [Apple App Review Guidelines §3.1](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play backend billing guidance](https://developer.android.com/google/play/billing/backend)
- [Google Web Risk limitations and API privacy trade-offs](https://cloud.google.com/web-risk/docs/overview)
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
- [PGlite documentation](https://pglite.dev/docs/)
