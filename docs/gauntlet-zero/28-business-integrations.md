# Business Integrations

Status: **designed on 2026-08-15; every external connection is deferred from Build Run 1**.

## Operating boundary

BoomerBuddy owns consent, household and organization scope, fraud decisions, action policy, and provider-neutral entitlements. Vendors may supply commodity transport, transaction evidence, or bounded intelligence; they never become the authorization source of truth. BoomerBuddy HQ is a separate employee application and audience, not a CRM, accounting system, payroll system, or unrestricted vendor console.

Build Run 1 creates no vendor accounts, stores no production credentials, sends no messages, accepts no money, and calls no live reputation or AI service. Local adapters return explicit `mock`, `unknown`, or `unavailable` states. A submitted URL is parsed only as hostile text and is never resolved, redirected, requested, previewed, or rendered.

## Integration portfolio

| Capability | Decision and status | System-of-record and data boundary | Activation gate / exit path |
|---|---|---|---|
| Identity | **Buy/integrate — deferred.** Select a managed OIDC/OAuth provider for production. | Provider proves identity; BoomerBuddy resolves current role, tenant, relationship, consent, and entitlement. Customer web, mobile, and HQ use separate clients/audiences. | MFA/passkeys, recovery, export, audit, regional processing, DPA, SCIM/JIT needs, and migration tested. Keep stable internal person/identity IDs and standard tokens. |
| Web and native commerce | **Integrate — deferred.** Stripe Checkout/Billing is the leading web candidate; StoreKit and Play Billing are required candidates where store policy applies. | Providers own payment instruments and transaction evidence. The canonical commerce module normalizes lifecycle events and derives grants; no provider field directly unlocks a feature. | Current legal/store review, sandbox and signed-event tests, tax/refund/cancel UX, idempotency, daily reconciliation, duplicate-channel recovery, and spend approval. Adapters preserve raw provider state at the edge. |
| Tax, accounting, payroll, banking | **Buy — deferred.** Use a tax service plus CPA review, an accounting platform such as QuickBooks/Xero, and a payroll/HR platform. Do not build these into HQ. | Vendors remain authoritative. HQ stores only external references, reconciliation state, owner, exception, and due date. No consumer bank-linking product is planned. | First-dollar accounting map and tax decision; later export before write integration. Bank feeds and payroll access stay outside product service credentials. |
| Fraud intelligence | **Build the fusion/evaluation layer; integrate feeds — designed/deferred.** Evaluate a commercial URL-reputation provider such as Google Web Risk and licensed campaign/threat feeds. | BoomerBuddy owns normalization, provenance, taxonomy, scoring, uncertainty, explanation, safe-action policy, and evaluation. Providers receive the minimum representation permitted by contract. | Independent quality/cost/privacy evaluation, commercial rights, freshness/failure semantics, retention terms, quotas, circuit breaker, and kill switch. Run 1 performs no lookup and never fetches a submitted URL. |
| Optional AI interpretation | **Integrate behind a provider-neutral port — deferred and disabled without credentials.** | The deterministic pipeline remains authoritative. A provider may return schema-constrained interpretation from minimized input; it gets no tools, network, memory, secrets, other-tenant data, or action authority. | DPA/retention/training review, content consent/notice, red-team and evaluation pass, cost ceiling, version pinning, outage fallback, and a non-AI path. |
| Email, SMS, and push | **Buy transport — deferred.** Resend/Postmark, Twilio or equivalent, and Expo Push/APNs/FCM are candidates, not commitments. | BoomerBuddy owns consent, suppression, template/version, purpose, destination reference, delivery intent, and incident-aware policy. Providers own delivery receipts. No artifact text or allegation belongs in lock-screen or routine message content. | Verified domain/number, opt-in/out and legal review, signed webhooks, bounce/complaint handling, rate/spend limits, quiet hours, accessibility, and test-recipient allowlist. |
| CRM, partner sales, and scheduling | **Buy/integrate — deferred.** HubSpot or equivalent and a scheduling service may receive approved B2B records. | BoomerBuddy owns organization, sponsor eligibility, pilot, opportunity, next action, and attribution facts. CRM gets no raw Check artifact, household graph, safe word, or protected-person status. | Field-level map, lawful purpose, dedupe/merge, deletion propagation, sync provenance, conflict owner, API quota, and export test. Run 1 uses visibly seeded HQ data only. |
| Customer support | **Buy/integrate — deferred.** Evaluate a ticketing platform after support workflow validation. | The support vendor owns ticket transport; BoomerBuddy owns authorization and any time-bound content-access grant. Metadata-only deep links are preferable to copying restricted content. | SSO/MFA, role mapping, redaction, regional/retention controls, audited just-in-time access, deletion/export, and incident escalation runbook. |
| Product analytics and feature delivery | **Build a governed event contract; buy a backend later — designed/deferred.** Start with approved first-party events and typed configuration. | Domain/audit records remain canonical. Analytics excludes raw content, full URLs, destinations, safe words, ciphertext, prompts, and low-cell sponsor data. A vendor flag cannot bypass server authorization or entitlement. | Event/data inventory, consent basis, sampling, retention, deletion, identity rules, small-cell suppression, warehouse/export plan, and server-side enforcement tests. |
| Error and operational telemetry | **Instrument with OpenTelemetry; buy/export backend later — designed/deferred.** | BoomerBuddy emits redacted logs, metrics, and traces. The selected backend receives opaque IDs and operational dimensions, never customer artifacts or secrets. | Scrubbing tests, alert ownership, budget/cardinality controls, regional retention, access review, incident routing, and export portability. |
| Files, OCR, and malware handling | **Buy commodity storage/scanning/OCR; build isolation policy — deferred.** | Future object storage holds quarantined encrypted objects; BoomerBuddy owns purpose, retention, authorization, and safe extraction contract. | Separate hostile-input worker, malware/file-type controls, no primary-database credentials, bounded decode, deletion proof, modality evaluation, and vendor content-use review. There are no uploads in Run 1. |
| Database, hosting, and durable work | **Buy managed runtime/PostgreSQL/KMS/queue capabilities; preserve portable contracts — deferred.** | PostgreSQL migrations, transactional outbox/inbox, encryption envelope, and provider ports are BoomerBuddy-owned. PGlite plus local dispatch is development-only. | Production identity/KMS, real PostgreSQL CI, backups/restore, RPO/RTO, dead-letter operations, least privilege, data residency, cost alarms, and exit rehearsal. |

## Required integration contract

Every adapter must expose a typed internal port and normalize vendor payloads at the boundary. Production activation requires:

1. environment-separated credentials in a secret manager and a fail-closed configuration; optional providers must not affect readiness;
2. timeouts, bounded retries, circuit state, concurrency and spend caps, plus an operator kill switch;
3. durable inbox/outbox processing, authenticity verification, idempotency, replay protection, reconciliation, and a poison-event queue where events can change access or money;
4. explicit fields, purpose, lawful basis/consent, region, subprocessors, retention, training/use rights, deletion/export, breach terms, and a tested termination path;
5. provenance, provider/version, latency, cost, and honest failure state without logging restricted inputs;
6. contract tests against recorded synthetic fixtures and sandbox tests before live use.

Restricted artifact content never goes to CRM, analytics, support, accounting, or observability. Artifact fingerprints remain tenant- and purpose-scoped keyed HMACs held by BoomerBuddy; they are not exported as vendor correlation IDs.

## Sequencing

- **Build Run 1 — designed:** local deterministic Check, local/mock adapters, seeded HQ, provider-neutral entitlements, transactional outbox, and content-free telemetry. No external credentials or side effects.
- **Private pilot — deferred:** production identity, managed PostgreSQL/KMS, error telemetry, tightly allow-listed communications, and any evaluated intelligence provider needed for the stated pilot promise.
- **First dollar — deferred:** compliant channel commerce, tax/accounting decisions, entitlement reconciliation, cancellation/refund support, monitoring, and vendor/security/legal sign-off.
- **Scale/B2B — deferred:** CRM, support, sponsor eligibility exchange, accounting automation, advanced analytics, and licensed feeds only when workload and contracts justify them.

## Evidence

Official/primary sources accessed 2026-08-15:

- [Stripe-hosted Checkout](https://docs.stripe.com/payments/checkout) and [Stripe webhook handling](https://docs.stripe.com/webhooks)
- [Apple App Store Server Notifications](https://developer.apple.com/documentation/AppStoreServerNotifications) and [App Review Guidelines §3.1](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play secure backend integration](https://developer.android.com/google/play/billing/backend) and [Google Play Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en)
- [Google Web Risk overview](https://cloud.google.com/web-risk/docs/overview)
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
- [Expo push notification architecture](https://docs.expo.dev/push-notifications/overview/)
- [HubSpot CRM object APIs](https://developers.hubspot.com/docs/api-reference/latest/crm/using-object-apis)
- [QuickBooks Online Accounting API](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api)
- [OpenTelemetry overview](https://opentelemetry.io/docs/what-is-opentelemetry/)
