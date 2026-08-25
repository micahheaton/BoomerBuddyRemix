# Stripe First-Dollar Runbook

Status: **production-capable, default-off control plane; live resource provisioning, deployed proof, and first payment remain open**

Last reviewed: 2026-08-25

This runbook defines the controlled Family first-payment rollout. It does not itself authorize a
provider write, charge, refund, DNS change, or customer message. Never paste an API key, webhook secret, session cookie, or other secret
into source, git, documentation, logs, screenshots, prompts, or support tickets.

## Evidence boundary

| Evidence level | Current result | Meaning |
| --- | --- | --- |
| `local_fixture` | Scoped deterministic checks and independent local rereview passed at 0 Critical / 0 High | In-process mocked transport, signed fixtures, PGlite/PostgreSQL-shaped repositories, API behavior, and authored browser assertions. This is not Stripe evidence. |
| `stripe_test` | **Blocked by founder-owned Stripe test resources, credentials, and an approved execution gate** | A real Stripe test account accepted/retrieved objects and delivered signed events. No such claim is made. |
| `deployed_staging` | **Blocked** | The frozen build, Replit edge, HTTPS, worker, PostgreSQL, restore, identity, secret custody, and telemetry operated together. No such claim is made. |
| `real_human` | **Blocked** | A founder-invited household completed the journey and gave consented feedback. No such claim is made. |
| `live_production` | **Default-off; external proof open** | Code supports separate live API/worker custody and an operator-approved max-one cohort, but resource provisioning and authentic live preflight receipts are still required. |
| `first_real_charge` | **Not authorized and not performed** | Money moved and reconciled. No such claim is made. |

Local tests use injected transports and fixture keys only. They do not call Stripe. Preserve that
distinction in every dossier and evidence record.

## Frozen first-dollar contract

- Offer ID: `founding_family_monthly_v1`.
- Canonical plan: `family_v1`.
- Initial launch price: USD $14.99 monthly, quantity one.
- Stripe Checkout selects eligible payment methods dynamically; the request does not hardcode payment-method types.
- Promotion codes, automatic tax, adaptive pricing, trials, recovery links, upgrades, downgrades,
  proration, interval changes, and every legacy Plus/annual offer are outside this path.
- Customer Portal permits payment-method updates and cancel-at-period-end; plan changes, promotions, and proration are disabled.
- Code-owned Stripe API version: `2026-07-29.dahlia`.

The amount is the fixed initial Family launch offer; conversion and willingness-to-pay evidence will
come from the controlled rollout. Tax and consumer-law decisions remain legal/accounting gates.

## Access and initiation invariants

Payment initiation and webhook ingestion are independent controls.

Before Checkout or Portal can be initiated, the production customer Clerk default session-token
claims must include `{"reverification_id":"{{session.reverification_id}}"}`. Clerk documents that
this shortcode identifies the unique reverification and is minted again for each new reverification.
The API combines it with the signed `fva` freshness claim, fingerprints it, binds it to the exact
household/action/offer/amount/idempotency operation, and rejects reuse. Never substitute a user ID,
session ID, or other long-lived value. See Clerk's
[reverification guide](https://clerk.com/docs/guides/secure/reverification#correlate-a-reverification-with-a-specific-action).

1. Checkout requires all of: the exact configured environment and runtime surface, runtime
   initiation permission, a revisioned initiation control set to `enabled` by an active internal HQ
   owner with recent MFA, an active unexpired `founding_household_v1` policy capped at one, exact
   household eligibility, active billing authority, and successful resource preflight.
2. Live API and worker startup require different restricted keys. API alone receives the webhook
   secret and may set `BB_STRIPE_LIVE_INITIATION_ENABLED=true`; worker must keep it false. Even on API,
   true is insufficient without the database control, approved max-one cohort, eligibility, and exact
   live US-company account/resource preflight. No production control or cohort is seeded.
3. Webhooks remain ingestible while the initiation control is disabled. Never disable ingestion merely
   to stop new Checkout sessions.
4. A Checkout success redirect, URL parameter, `checkout.session.completed`, customer binding,
   `active`/`trialing` subscription status, or Dashboard display does not grant access.
5. Initial access requires both the exact recorded server-created Checkout Session completion and a
   separately authenticated `invoice.paid` whose invoice, PaymentIntent, amount, currency, quantity,
   discount, tax, billing reason, subscription-item lineage, price, paid timestamp, and service period
   match retrieved provider truth.
6. Status events can restrict or shorten access but cannot create an initial grant or extend a paid
   period. Full refund and dispute evidence revokes access. A won dispute clears the provider
   restriction only under audit; it does not silently reactivate canonical access.

The webhook route preserves the raw body, enforces HMAC and timestamp verification, caps the body at
256 KiB, rejects livemode/API-version mismatches and rejects a Connect account mismatch when the
Event `account` field is present, persists an idempotent inbox, and processes financial events through
durable reconciliation. A standard-account Event can omit `account`; custody is then bound by the
endpoint-specific signing secret plus the separately authenticated `/v1/account` preflight, not by an
invented payload account assertion. Relevant primary documentation includes Stripe's
[API versioning](https://docs.stripe.com/api/versioning),
[Event object](https://docs.stripe.com/api/events/object),
[webhook signatures](https://docs.stripe.com/webhooks/signature), and
[subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks).

## Exact configuration names

The API version is code-owned; there is no `BB_STRIPE_API_VERSION` override.

| Setting | Test | Live | Notes |
| --- | --- | --- | --- |
| Mode | `BB_STRIPE_MODE=test` | `BB_STRIPE_MODE=live` | Default is `disabled`. Production refuses test mode and all `BB_STRIPE_TEST_*` fields. |
| Runtime surface | not used | `BB_STRIPE_RUNTIME_SURFACE=api` or `worker` | Each live project declares exactly one surface. |
| Initiation | runtime test configuration | `BB_STRIPE_LIVE_INITIATION_ENABLED` | API defaults false and may become true only with all database/preflight gates; worker requires false. |
| Account | `BB_STRIPE_TEST_ACCOUNT_ID` | `BB_STRIPE_LIVE_ACCOUNT_ID` | Exact account returned by `/v1/account`; live preflight also requires charges and payouts enabled, country US, and business type company. |
| API key | `BB_STRIPE_TEST_API_KEY` | `BB_STRIPE_LIVE_API_RESTRICTED_KEY` on API; `BB_STRIPE_LIVE_WORKER_RESTRICTED_KEY` on worker | Every value must be a restricted `rk_` credential and remain isolated to its surface. The deprecated `BB_STRIPE_LIVE_API_KEY` is rejected. |
| Webhook secret | `BB_STRIPE_TEST_WEBHOOK_SECRET` | `BB_STRIPE_LIVE_WEBHOOK_SECRET` on API only | The exact endpoint secret is never copied to worker. A CLI listener secret is not interchangeable. |
| Founding product | `BB_STRIPE_TEST_FOUNDING_PRODUCT_ID` | `BB_STRIPE_LIVE_FOUNDING_PRODUCT_ID` | Exact environment-specific product. |
| Monthly price | `BB_STRIPE_TEST_FOUNDING_MONTHLY_PRICE_ID` | `BB_STRIPE_LIVE_FOUNDING_MONTHLY_PRICE_ID` | Exact USD 14.99/month (1,499 cents) recurring price. |
| Portal config | `BB_STRIPE_TEST_CANCEL_ONLY_PORTAL_CONFIGURATION_ID` | `BB_STRIPE_LIVE_CANCEL_ONLY_PORTAL_CONFIGURATION_ID` | Active, payment-method update enabled, cancel-at-period-end enabled, subscription/price update disabled. |

Also provision `BB_FOUNDER_PERSON_ID` to the stable application person ID for the exact active HQ
owner whom the founder designates. This identifier is not a credential; the authenticated HQ session
and role still have to match it. PostgreSQL, session, encryption, fingerprint, and safe-word secrets
remain separate platform provisioning items.

Configuration parsing rejects incomplete resources, mixed test/live fields, unrestricted or shared
live keys, cross-surface credentials, an API manifest without its webhook secret, and any worker
manifest containing that secret. Configuration never replaces the database control gates.

## Runtime restricted-key permission matrix

Create provider resources manually with a separate founder/admin role. Create two different live
restricted keys. Do not copy either key to the other runtime surface.

| Stripe resource | API restricted key | Worker restricted key | Why |
| --- | --- | --- | --- |
| Account | Read | Read | Exact account and live US-company preflight. |
| Products, Prices | Read | None | API preflight of the immutable offer. |
| Customer Portal configurations | Read | None | API preflight of bounded Portal behavior. |
| Checkout Sessions | Write | None | API creates a server-side subscription Checkout Session. |
| Billing Portal Sessions | Write | None | API creates a short-lived bounded Portal Session. |
| Subscriptions | Read | Read | Lifecycle and inventory reconciliation. |
| Invoices and Invoice Payments | Read | Read | Exact paid/failed invoice proof. |
| PaymentIntents | Read | Read | Confirm payment truth and amount. |
| Charges | Read | Read | Resolve refund/dispute lineage. |
| Refunds | Read | Read | Reconcile refund lifecycle. The runtime has no refund-create operation. |
| Disputes | Read | Read | Reconcile dispute creation/closure. |
| Products, Prices, Portal configuration, Refunds | No write | No write | Resource creation, configuration, and refunds remain provider-console operations. |

Stripe describes secret and restricted keys in its [API key documentation](https://docs.stripe.com/keys).
Retain a redacted permission export and key identifier, never the key value.

## Provider network-action inventory

No action in this section was executed while authoring this runbook.

| Action | Method | Guard and ambiguity policy |
| --- | --- | --- |
| Resource preflight | GET account, product, price, Portal configuration | Runs only after the DB initiation/cohort gate for Checkout and before Portal creation. It asserts account, livemode, API contract, active resources, exact per-unit/no-trial price/amount/currency/interval, and the cancel/update/customer/payment controls exposed by the current Portal API. GETs are read-only and retryable. |
| Checkout creation | POST Checkout Session | One provider idempotency key is HMAC-derived from environment, action, household, and server operation ID. A `dispatch_started` receipt is appended before transport. A timeout, ambiguous response, or process death before the result is recorded leaves the operation unknown; a later pre-transport refusal cannot erase that earlier dispatch evidence. A durable lease retry reuses the same key, current gates, fresh preflight, and the API's reviewed customer-origin allowlist. The 23-hour requested provider deadline is rounded down once to a whole provider second before persistence; that exact second is sent and must be returned, while the local intent deadline is exactly five minutes later. Neither retry nor polling moves either deadline. An authenticated exact completion or expiry can repair a lost POST response. |
| Portal creation | POST Billing Portal Session | Same durable operation/idempotency/outcome-unknown and customer-origin model. A proven pre-transport refusal is no-effect only when no earlier attempt has dispatch evidence. Live creation remains default-off behind the runtime and database controls. |
| Financial reconciliation | GET subscription, invoice, PaymentIntent, charge, refund, dispute | Triggered from a durable job after authenticated inbox capture. Reads may retry. Evidence mismatch quarantines and opens owner attention; it never grants access. |
| Inventory comparison | GET `/v1/account`, then `/v1/subscriptions?status=all&limit=100` and `starting_after` | The durable daily/manual job first verifies the exact account, then records account, environment, API version, stable operation/run, request cursor, next cursor, page number, `has_more`, count, and digest for every page. Only a final `has_more=false` page can complete; partial, malformed, repeated-cursor, over-limit, mismatch, or transport failure becomes owner attention and never `completed`. The adapter and local fixtures exist; an authentic provider run remains blocked. |

Stripe's [Checkout Session create API](https://docs.stripe.com/api/checkout/sessions/create)
documents server-side session settings. The current Invoice and Invoice Payment shapes are verified
against Stripe's [Invoice object](https://docs.stripe.com/api/invoices/object) documentation.

## Webhook allowlist

Configure only the events the frozen adapter accepts:

```text
checkout.session.completed
checkout.session.expired
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
charge.refunded
refund.created
refund.updated
refund.failed
charge.dispute.created
charge.dispute.closed
```

Every other event is captured only far enough to quarantine it as not allowlisted. Invoice
finalization events do not prove payment.

## Local verification (no provider account)

Run from the repository root with no Stripe environment variables:

```powershell
npm run test:unit -- packages/config/src/config.test.ts packages/integrations/src/integrations.test.ts
npm run test:integration -- packages/persistence/src/stripe-first-dollar-migration.test.ts packages/persistence/src/stripe-adversarial-migration.test.ts packages/persistence/src/commerce-provider.test.ts tests/integration/stripe-commerce.test.ts tests/integration/stripe-inventory.test.ts tests/integration/commerce-entitlements.test.ts
npm run test:e2e -- tests/e2e/billing.spec.ts --project=edge
npm run typecheck
npm run lint
npm run format:check
npm run build
```

The migration suite explicitly covers fresh PGlite `0001` through `0018` and an applied `0017`
database upgraded only by forward migration `0018`. Record commit, command, exit code, test count,
timestamp, transport, and runtime run ID as `local_fixture`. A fixture HMAC proves only fixture
authenticity; do not relabel it `stripe_test`.

At the author refreeze, the canonical billing Playwright command first failed inside the filesystem
sandbox because `tsx` could not read the Windows user identity (`uv_os_get_passwd ENOMEM`). The
unchanged command then completed outside that sandbox with 2/2 Edge tests. This is a local-fixture
browser receipt only: mocked billing state and local servers are not Stripe, staging, human, or
production evidence. Exact scoped receipts and remaining limitations are in
[Stripe Stage 5 Adversarial Remediation Evidence](STRIPE-STAGE-5-REMEDIATION-EVIDENCE.md).

The real-PostgreSQL gate is destructive and therefore accepts only a new disposable database whose
name contains `ci` or `test`, plus the explicit `BB_ALLOW_POSTGRES_VERIFICATION=true` switch. Keep
`DATABASE_URL` in the founder-controlled shell/secret store and run `npx tsx
scripts/verify-postgres.ts`. It verifies concurrent initial dispatch and stale-lease recovery converge
to one dispatch per phase, two append-only attempts, and one provider idempotency key. This command
was not run while authoring the local-fixture remediation; do not claim PostgreSQL evidence until its
receipt is retained.

## Exact founder steps for an isolated Stripe test

These steps are blocked until the founder explicitly authorizes provider-side test work.

1. In the founder-owned Stripe organization, confirm account ID, company custody, MFA, two recovery
   owners, roles, and test/live separation.
2. For isolated test evidence, manually create one test product and one active recurring USD $14.99
   monthly test price.
   Confirm the retained Price export has `billing_scheme=per_unit`, `custom_unit_amount=null`,
   `tiers_mode=null`, `transform_quantity=null`, `recurring.interval=month`,
   `recurring.interval_count=1`, `recurring.usage_type=licensed`, and
   `recurring.trial_period_days=null`. Do not create annual, Plus, trial, discount, Tax, or
   adaptive-pricing variants for this path.
3. Manually create one active bounded Portal configuration. Confirm cancellation is exactly
   `at_period_end`, payment-method updates are enabled, and subscription plan/price changes,
   promotions, proration, pause, and retention offers are disabled. Retain a redacted configuration
   export without a secret or customer record.
4. Create a restricted test key with the exact permission matrix above and retain it only in the
   founder-controlled deployment secret store.
5. On an approved HTTPS staging API, create `/v1/webhooks/stripe` with the exact event allowlist.
   Set or update the endpoint API version to exactly `2026-07-29.dahlia`; an account-default or
   endpoint version is not assumed. Put its secret only in the secret store and retain a redacted
   endpoint/version/allowlist receipt.
6. Set the `BB_STRIPE_TEST_*` names, `BB_STRIPE_MODE=test`, and `BB_FOUNDER_PERSON_ID` in the isolated
   staging environment. Do not set any live name there.
7. Deploy the frozen commit, run migrations, start API and worker, and verify the edge preserves the
   raw request body and `Stripe-Signature`. Retain redacted deployment and worker evidence.
8. In a same-origin authenticated HQ founder session, without copying its cookie or CSRF material,
   mark only the reviewed Founding Household eligible. Send this exact JSON body to
   `POST /v1/hq/commerce/stripe/eligible-household` (replace placeholders, keep field names):

   ```json
   {
     "householdId": "<reviewed-household-id>",
     "environment": "test",
     "nextState": "eligible",
     "correlationId": "<unique-opaque-correlation-id>"
   }
   ```

   Confirm the response is `state=eligible`. The environment-scoped cohort policy, benefit, capacity,
   and expiry still have to be active; eligibility alone does not enable Checkout.
9. From that same-origin founder session, first GET
   `/v1/hq/commerce/stripe/initiation-control?environment=test`. Use the returned current `revision`
   in this exact body to `POST /v1/hq/commerce/stripe/initiation-control`; never assume revision zero:

   ```json
   {
     "environment": "test",
     "nextState": "enabled",
     "reasonCode": "founder_test_activation",
     "expectedRevision": 7,
     "correlationId": "<unique-opaque-correlation-id>"
   }
   ```

   The integer `7` is illustrative only: replace it with the exact integer returned by the immediately
   preceding GET. Re-GET after any conflict; do not replay with a guessed revision.
10. Confirm `/member/billing` shows `ready` for that household's billing manager. Execute only the
    bounded test matrix the founder approved. Retain redacted object/event/inbox/job/canonical IDs and
    before/after state; do not retain card data, raw bodies, or secrets.
11. Start the worker and observe the durable inventory run (or run
    `npm run stripe:inventory:enqueue` to enqueue the same bounded job manually). Verify every page
    receipt has the expected test account/environment/API version/run/cursor chain and that the final
    page says `has_more=false`. Any missing/error page must remain `attention`; do not call it clean.

Required authentic-test cases include exact initial payment, duplicate/out-of-order delivery,
transport ambiguity with same idempotency key, old/wrong/prorated/incomplete invoice denial, payment
failure and recovery, cancellation, full/partial refund, dispute creation and closure, Portal
cancel-only behavior, worker restart/retry, complete inventory reconciliation, and shutdown/rollback.

No test execution may be reported until the provider objects, signed events, staging deployment, and
canonical evidence have actually been retained.

## Founder-only bounded repair commands

These controls enqueue provider work when the worker is running. They are therefore blocked by the
same explicit founder provider-action gate as the isolated Stripe test above. A GET is a local
projection; a POST is not permission to infer provider truth, clear an ambiguity, create a replacement
Checkout, or operate in live mode. Use only a same-origin authenticated founder HQ session; never copy
session cookies, CSRF material, or provider secrets into a terminal, prompt, document, or screenshot.

For an event reconciliation that exhausted its automatic read budget:

1. GET
   `/v1/hq/commerce/stripe/reconciliation-repair?reconciliationRunId=<exact-run-id>`.
2. Proceed only when the response says `environment=test`, `state=attention`,
   `automaticAttemptCount=12`, `authorizedAttemptLimit=12`, `revision=0`, and
   `repairAvailable=true`. Separately verify the referenced inbox remains `pending`; any other state
   requires investigation, not a repair POST.
3. POST `/v1/hq/commerce/stripe/reconciliation-repair` with this body template, substituting only the
   exact run ID and a new opaque correlation ID:

   ```json
   {
     "reconciliationRunId": "<exact-run-id>",
     "expectedRevision": 0,
     "reasonCode": "founder_bounded_provider_repair",
     "correlationId": "<unique-opaque-correlation-id>"
   }
   ```

4. Verify the response names the same run/inbox, `revision=1`,
   `authorizedAttemptLimit=16`, and one repair job. This is a one-shot four-read-attempt extension;
   an exact replay of the same command is idempotent, while a different replay conflicts. Observe the
   resulting reconciliation/inbox/entitlement state. If it returns to attention, stop; no second
   application repair generation is authorized.

For a Checkout Session operation that exhausted six same-key ambiguous POST attempts:

1. GET
   `/v1/hq/commerce/stripe/session-retry-repair?householdId=<exact-household-id>&serverOperationId=<exact-server-operation-id>`.
2. Proceed only when the response says `environment=test`, `action=checkout`,
   `state=outcome_unknown`, `attemptCount=6`, `authorizedAttemptLimit=6`, `revision=0`, an open or
   snoozed owner-attention item, and `repairAvailable=true`. That projection also requires the current
   founder initiation/cohort/eligibility/billing-authority gates and more than 30 minutes before the
   immutable original provider deadline.
3. POST `/v1/hq/commerce/stripe/session-retry-repair` with:

   ```json
   {
     "householdId": "<exact-household-id>",
     "serverOperationId": "<exact-server-operation-id>",
     "expectedRevision": 0,
     "reasonCode": "founder_bounded_same_key_retry",
     "correlationId": "<unique-opaque-correlation-id>"
   }
   ```

4. Verify the response names the same operation, `revision=1`, `authorizedAttemptLimit=7`, and one
   repair job. The worker must perform a fresh exact preflight and may make at most one additional POST
   with the original provider idempotency key. This command never records `failed_no_effect`, clears
   `outcome_unknown`, or permits a replacement Checkout.

If the session projection is unavailable, the deadline has passed, or the seventh same-key attempt
is still ambiguous, leave the operation blocked with owner attention. Only an authenticated exact
Checkout completion/expiry can terminalize it. There is no safe local no-effect proof or founder
attestation clear; the candidate remains `REMEDIATE` for that household until account/provider
reconciliation supplies authentic terminal evidence.

A later local refusal is not a no-effect proof for the whole operation when any earlier attempt has a
`dispatch_started`, `lease_expired`, or `outcome_unknown` receipt. This includes a worker or host crash
after Stripe might have accepted the request but before the application recorded the response. Keep
the same operation blocked and do not authorize a replacement.

## Edge and rollback truth

The staging edge must terminate HTTPS without parsing/re-serializing the Stripe body, forward
`Stripe-Signature`, preserve the 256 KiB application limit, and route API and worker to the same
PostgreSQL state. Replit process restart, worker lease recovery, portability export, and database
restore need independent deployed evidence.

To stop new Checkout safely:

1. In the same-origin authenticated founder HQ session, GET
   `/v1/hq/commerce/stripe/initiation-control?environment=test`. Use its current `revision` in this
   exact body to `POST /v1/hq/commerce/stripe/initiation-control` (the placeholder becomes a JSON
   integer):

   ```json
   {
     "environment": "test",
     "nextState": "disabled",
     "reasonCode": "founder_disable",
     "expectedRevision": 7,
     "correlationId": "<unique-opaque-correlation-id>"
   }
   ```

   The integer `7` is illustrative only; replace it with the exact integer from the immediately
   preceding GET. Use `incident_stop` instead only for an incident. Re-GET after any conflict. This stops new
   Checkout and any not-yet-dispatched retry without stopping webhooks or reconciliation; an already
   dispatched request remains ambiguous and must be drained.
2. Keep `BB_STRIPE_MODE=test`, API ingestion, and the worker running while dispatched,
   `outcome_unknown`, inbox, and reconciliation items can still receive authentic provider truth.
   An unresolved session after its deadline remains an owner-attention/`REMEDIATE` blocker; do not
   relabel it resolved or create a replacement from elapsed time.
3. Leave the cancel-only Portal available unless the incident specifically requires a Portal stop.
4. Reconcile provider sessions/subscriptions/invoices/refunds/disputes and canonical grants before
   rollback completion.
5. Roll back the application tag only after migration compatibility is checked. Do not delete payment,
   audit, control, consent, refund, dispute, or reconciliation evidence.
6. `BB_STRIPE_MODE=disabled` is an emergency hard stop that also returns 503 for Portal and webhook
   ingestion. Use it only with an explicit plan for provider retry retention and later reconciliation.

There is no application refund-create action. A real refund requires a separate founder approval in
the Stripe Dashboard, followed by authenticated refund-event reconciliation. Stripe notes refunds can
be partial or pending; see [refunds](https://docs.stripe.com/refunds) and
[disputes](https://docs.stripe.com/disputes).

## Live and first-charge gates

Live initiation is production-capable and default-off. The bounded rollout is Family $14.99/month
only, with at most one active household. Annual, Individual, referral, promotion, Tax, and Twilio
paths remain disabled. Complete these gates before enabling initiation:

1. Create separate live Family product, monthly price, bounded Portal configuration, and webhook
   endpoint under the exact company account. Do not reuse test resources.
2. Place the API restricted key and webhook secret only in the API secret store. Place the different
   worker restricted key only in the worker secret store. Set each project's exact
   `BB_STRIPE_RUNTIME_SURFACE`; keep `BB_STRIPE_LIVE_INITIATION_ENABLED=false` everywhere.
3. Record a read-only live preflight proving the configured account ID, `livemode=true`, API version,
   charges enabled, payouts enabled, country US, business type company, exact $14.99/month resource,
   and bounded Portal behavior. The account and resource receipt must contain no customer PII.
4. Prove production PostgreSQL concurrency, restore, edge, observability, legal/privacy/tax/accounting,
   support, incident response, and provider-test behavior for the frozen candidate.
5. Through the same-origin HQ control path, an active `hq_owner` with recent MFA creates or updates an
   active, unexpired, live-approved cohort with `max_active_households=1`, then enables the revisioned
   live initiation control. Eligibility and active billing authority remain independently required.
6. Set `BB_STRIPE_LIVE_INITIATION_ENABLED=true` only on the API project after the database controls
   and preflight are verified. The worker must retain false. Observe the exact first payment and
   canonical entitlement lineage; disable the revisioned control immediately on drift.

This document records the procedure, not proof that provider resources, deployed receipts, or a first
charge already exist.

## Current disposition

- `local_fixture`: scoped Stripe checks, independent local rereview, the mocked Edge billing
  journey, and the final integrated pre-commit repository suite (50 files / 367 tests) passed. Real
  PostgreSQL and authentic provider evidence remain open.
- `stripe_test`: blocked by authentic provider-resource and signed-event evidence.
- `deployed_staging`: blocked.
- `real_human`: not performed.
- `live_production`: code-capable and default-off; live resource, custody, preflight, and deployment
  evidence remain open.
- `first_real_charge`: not performed.
