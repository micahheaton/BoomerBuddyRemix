# Stripe Stage 5 Adversarial Remediation Evidence

Status: **historical author snapshot; independently accepted local Stripe slice; superseded by the final integrated candidate**

Evidence date: 2026-08-17

Historical author snapshot aggregate: `8cdb262f222202755c0979a655e23048f52c849297d03392f3b3f705c90525fc`

This ledger covers only the Run 3 Stripe Stage 5 remediation. It is not a launch verdict, provider
receipt, production-readiness claim, authorization to call Stripe, or authorization to take a
payment. The author made no provider, payment, refund, live, or external-network action while
producing this evidence. Local test runners used injected transports and loopback fixture servers
only.

An independent read-only reviewer reproduced this exact 34-path aggregate before and after review
and returned 0 Critical / 0 High for the frozen Stripe slice. Later shared composition, migration,
configuration, and release-hardening edits changed listed files, so the manifest below is an
accepted historical snapshot and intentionally does not describe current working-tree bytes. It
must not be recomputed and presented as the final candidate. The immutable commit/tag named by the
Stage 17 executive verdict is the canonical integrated freeze; a separate current-tree review found
0 Critical / 0 High across the shared Stage 5–10 composition.

## Evidence boundary

| Tier | Result in this lane |
| --- | --- |
| `local_fixture` | Deterministic injected transports, fixture-signed webhook bodies, PGlite migrations/repositories, API integration behavior, TypeScript checks, and authored browser assertions only. This is not Stripe evidence. |
| `stripe_test` | **Blocked.** No founder-owned Stripe test account, object, restricted key, signed provider delivery, or provider receipt was used. |
| `deployed_staging` | **Blocked.** No Replit edge, HTTPS, persistent PostgreSQL, worker restart, restore, telemetry, or portability receipt was produced here. |
| `real_human` | **Blocked.** No founder-invited household journey or consented human feedback was performed. |
| `live_production` | **Disabled and blocked.** The candidate refuses live API and worker startup and refuses raw live secrets. |
| Revenue / first charge | **Not authorized and not performed.** |

Fixture HMAC verification establishes only deterministic fixture authenticity. Signature
authenticity, transport, livemode, runtime run, and evidence tier remain separate persisted facts.

## Historical accepted author snapshot

This snapshot supersedes the obsolete `e905abb5f3f24082633571419920e8c82d624a5e76110186fba9f2d6117ff5f8`
author snapshot. It was the input to the accepted independent local review. The manifest excludes this
evidence file to avoid a self-referential digest. The fresh 34-path ownership set adds the worker
adapter composition seam, the earlier reviewer-required `0016` migration and migration regression,
and the Stripe environment section of the Replit runbook. Those historical blobs are not the final
integrated release manifest.

Historical construction recipe (requires the original historical snapshot bytes, which are not supplied by the final checkout; running these steps against
the final checkout is not expected to match):

1. Use the 34 repository-relative paths below in ordinal lexicographic order.
2. For each path, compute `git hash-object -- <path>` from the repository root.
3. Serialize one line as `path<TAB>git-hash-object`.
4. Join lines with one LF byte (`0x0a`) and no terminal newline.
5. Encode the joined string as UTF-8 without a BOM.
6. Compute SHA-256 over those bytes. The expected lowercase hexadecimal result is the author snapshot
   aggregate above.

Exact manifest input:

```text
.env.example	cc61b266ebe946699eef1c95b3e757dabaac450c
apps/api/src/app.ts	98081b8fb6f3bb6831868d189eeaa101c7ceadb8
apps/api/src/routes/commerce.ts	37155b998b008878690fd5f05b5010e1608bae2b
apps/web/src/app/member/billing/page.tsx	54eb8e31e4735a9b9c0d3b0b744e08da426ba258
apps/web/src/app/member/billing/success/page.tsx	44c6bb6f404c581178205e0adce0878f71bbec32
apps/web/src/app/member/page.tsx	11d9d8ff224769bcc3bbcf996db83e0ac1813a26
apps/worker/src/commerce-reconciliation.ts	457c0d585c27ae4a377652968de06348a1087b75
apps/worker/src/server.ts	bdc8e00565172311ae355f0ae82c4cba33753a49
apps/worker/src/stripe-adapter.ts	af9ea1044f9cea0c6abbfc9030ccbc8bbd641fe6
apps/worker/src/stripe-inventory.ts	cf24f096e08fc47a1623c2c90abda1acf802d24f
apps/worker/src/stripe-session-retry.ts	1a845a45abfa3d712dffd2eaa987907ce278c8d3
docs/adr/0022-stripe-first-dollar-evidence-chain.md	4b2a9d7181e0d9f78151f17a3dda7324d3b223ee
docs/run-3/REPLIT-FIRST-LAUNCH-RUNBOOK.md	5f5c680fcc82624c868b5aa1df5be011f4abd331
docs/run-3/STRIPE-FIRST-DOLLAR-RUNBOOK.md	6a7baaf231a06738ffbc9fd891adef8d7920c526
package.json	f0ebd1e4332895252fad6235eae052c237dc4a09
packages/config/src/config.test.ts	33514095aad535e01651d129bc2b521c3d1ff1b2
packages/config/src/index.ts	bbff9d3a0975c43a1a1031f023fe3a7e661203c4
packages/contracts/src/commerce.ts	dd8572b41be0276196abcde05bfe7c480c58b44f
packages/integrations/src/commerce.ts	c43123f3015cc7cf523fca3a65805dd633cfa4d2
packages/integrations/src/integrations.test.ts	1f062deea70f51c5f3d88444371ebba481637f8b
packages/integrations/src/stripe.ts	d490b121e9b276a312fee9b138a8aad0fce8eaa3
packages/persistence/migrations/0016_run3_stripe_first_dollar.sql	2d3986af4c1cfd1c7254670c63e7dfa1674bba05
packages/persistence/migrations/0018_run3_stripe_adversarial_remediation.sql	9d2dd2fac2474e56236455138681335febbf37a3
packages/persistence/src/commerce-provider.test.ts	9cb2a60f077145c4760e39d7b4acfc3bcd4a73a5
packages/persistence/src/commerce-runtime.ts	937859f84de40b217495fd17b9de62de4da4cb73
packages/persistence/src/commerce.ts	ebc7d445bc90f6427a11ff1567e0c0f80d52be98
packages/persistence/src/stripe-adversarial-migration.test.ts	1ee0cd8b9754d44af995c76fca9e5a6b15ee4621
packages/persistence/src/stripe-first-dollar-migration.test.ts	c67090abc3c6fbde1f53d7eb09c8a5d4c83f563a
scripts/enqueue-stripe-inventory.ts	75312c0de73b28948313aaa1e39ceaab72de05f5
scripts/verify-postgres.ts	e75fdf67754aee724a3bc52d256e74a1735fecd1
tests/e2e/billing.spec.ts	103b46af689be5fcd01b30b1c39ac2f31ebd0bf9
tests/integration/commerce-entitlements.test.ts	44c4dd915a244d023bc5e330d03ee4189daa7b91
tests/integration/stripe-commerce.test.ts	6d9f8e9cebfd7b54b008acf12cee0e2d0d256727
tests/integration/stripe-inventory.test.ts	85db8bc17191e26c19335455ae813ff64d30ba86
```

## Final frozen-rereview remediation

### C1 — crash ambiguity and worker return origins

- `apps/worker/src/server.ts` now composes the online worker adapter through
  `apps/worker/src/stripe-adapter.ts` with the exact configured customer-origin set. Local
  worker-composition fixtures prove Checkout and Portal reach only the mock transport with the stored return
  origin and immutable provider key.
- `markStripeSessionFailedNoEffect` treats any earlier attempt's `dispatch_started`, `lease_expired`,
  or `outcome_unknown` receipt as operation-level ambiguity. A later attempt that is proven to fail
  before transport appends its own no-effect receipt but cannot clear that earlier ambiguity, expire
  the pending Checkout, or permit a replacement.
- Hostile Checkout and Portal regressions simulate process death after the durable dispatch receipt,
  lease recovery, and an attempt-two local refusal with zero retry POSTs. Both remain unknown with
  owner attention. The distinct genuine first-attempt pre-transport refusal still terminalizes; the
  caught ambiguous path still retries only the bounded same key.

### H2 — exact whole-second Checkout expiry

- `prepareStripeCheckout` canonicalizes `now + 23 hours` down to a whole provider second before
  persisting either the requested deadline or the exact five-minute local boundary. The adapter sends
  that integer second, requires the response to return the same second, and persistence repeats the
  equality check.
- A `.789Z` regression proves the prepared return value, database requested/returned deadlines,
  outbound form, and customer response all use one canonical second. A lost-response regression sends
  fixture-signed expiry events at minus one, plus one, and the exact second: both mismatches quarantine
  without mutation, while the exact event terminalizes and alone permits a replacement. The known
  response plus later completion/expiry paths remain green.

## High-finding closure map

### H1 — Live custody is offline only

- `packages/config/src/index.ts` represents live Stripe as resource names plus a managed-custody
  refusal; it contains no live transport credential value and rejects raw live API-key/webhook-secret
  variables.
- `apps/api/src/app.ts` and `apps/worker/src/server.ts` call the live-runtime refusal before database,
  provider transport, route, handler, or provider-read construction.
- `packages/config/src/config.test.ts` and `tests/integration/stripe-commerce.test.ts` prove raw-secret,
  API, worker, and injected-transport refusal locally.

### H2 — Checkout ambiguity is durable and bounded

- Migration `0018_run3_stripe_adversarial_remediation.sql` adds append-only operation attempts,
  dispatch leases, retry timestamps, immutable Checkout expiry, and a material minimum expiry.
- `packages/persistence/src/commerce-runtime.ts` serializes household dispatch claims, schedules a
  durable retry before transport, reuses the HMAC-derived provider key, and never moves the original
  23-hour provider deadline or five-minute local reconciliation boundary. It canonicalizes the
  provider deadline to a whole second before persisting either boundary.
- The API records `outcome_unknown`; `apps/worker/src/stripe-session-retry.ts` claims only a due
  operation, performs a fresh exact preflight, persists that observation, and repeats only the same
  provider key. `apps/worker/src/server.ts` composes that adapter with the configured customer origins,
  matching the API redirect boundary. Control/cohort/eligibility/billing authority are rechecked at
  every durable dispatch.
- Elapsed local time never converts a dispatched/unknown operation into no effect and never permits a
  replacement. An exact authenticated completion or expired Session can terminalize the original
  operation. A deterministic first-attempt pre-transport refusal can record no effect only when no
  earlier attempt has a `dispatch_started`, `lease_expired`, or `outcome_unknown` receipt. A host crash
  after dispatch begins therefore stays ambiguous even if a later attempt fails locally before POST.
- Automatic provider dispatch is capped at six operation-level attempts. One founder-only,
  revision-checked, append-only repair can authorize one seventh same-key attempt before the immutable
  deadline after fresh gates/preflight. It never clears ambiguity. After the deadline or another
  unknown result, owner attention remains a `REMEDIATE` blocker pending authentic provider truth.
- `apps/web/src/app/member/billing/page.tsx` persists and displays the server operation ID, attempt,
  retry, and expiry, and carries the selected household on Checkout and Portal mutations.
- `scripts/verify-postgres.ts` contains a destructive-gated real-PostgreSQL race check. It was not run
  in this lane and must not be reported as PostgreSQL evidence.

### H3 — Price, subscription, and invoice authority are exact

- `packages/integrations/src/stripe.ts` requires USD 14.99 (1,499 cents), per-unit billing, no
  custom/tier/transform quantity, no trial, monthly interval/count one, licensed usage, active exact
  product/price, and a complete (`has_more=false`) single subscription item with exact item ID and
  quantity.
- Paid authority requires the current retrieved subscription item and one exact non-proration Invoice
  line, a current Clover Invoice Payment whose exact ID is persisted, a succeeded PaymentIntent,
  exact period, and explicit null-or-empty current-schema discount/tax/credit aggregates plus zero
  balance, overpayment, and credit-note amounts. Wrong/missing object, ID, or livemode envelopes fail
  closed.
- `commerce_stripe_invoice_authority_facts` persists the item/line/product/price and empty-control
  facts under an append-only trigger. Hostile adapter and API tests withhold authority for truncated,
  extra, wrong-item, wrong-product, taxed, discounted, credited, prorated, or incomplete evidence.

### H4 — Dunning starts at paid-through

- Failed invoices require the exact current item/product/price, quantity, non-proration, and period.
- `commerce_stripe_dunning_events` is append-only and constrains grace to exactly three days starting
  at the previously paid-through instant.
- Early/off-cycle failure does not shorten already-paid access; repeat failure does not move the
  window; an exact paid recovery appends `recovered` against the same window and removes the temporary
  grace extension. The transaction test asserts each fact and both access periods.

### H5 — Financial restrictions are object-keyed and append-only

- Refund/dispute events persist exact restriction, charge, PaymentIntent, invoice, subscription, and
  source-inbox lineage. Only an exact previously opened object can append a favorable clear; an exact
  terminal retained/lost dispute can restrict on first observation.
- Aggregation evaluates every object and gives unresolved disputes precedence over refunds. It orders
  by authenticated provider-event time and exact-object terminal precedence: retained/lost outranks
  clear, and clear outranks open at the same provider second. A late delivered create event cannot
  reopen a current terminal dispute. A retained/lost object is restrictive even if its opening event
  was missed; a favorable clear still requires an exact prior opening.
- A full-amount pending refund opens its exact restriction; its matching failed event closes only that
  object. A mismatched failed refund remains a retrying fail-closed job and cannot close another
  refund. An unresolved dispute-close status records no mutation, completes with attention, and
  retains the opening restriction.
- Local transaction coverage includes partial plus full refund, pending-to-failed exact refund,
  mismatched closure, two simultaneous disputes, unknown closure, stale delivery, one-object closure,
  and refund-plus-dispute precedence.

### H6 — Portal is cancel-only

- Current Clover preflight requires cancel exactly `at_period_end`, proration `none`, subscription
  update disabled with `default_allowed_updates=[]`, payment-method update disabled, and customer
  update disabled with an empty allowlist. It does not inspect an invented `subscription_pause` field.
- Pause and retention-coupon/offer absence are deliberately manual founder-browser gates; code does
  not call either proven. The runbook requires a redacted founder-owned Dashboard screenshot/export
  before authentic test activation.
- Hostile preflight tests reject every broadened/missing Portal control.

### H7 — Inventory is complete or attention

- `apps/worker/src/stripe-inventory.ts` uses a canonical UTC period identity, durably schedules the
  next period independently of the current provider outcome, and supplies the same bounded manual
  job through `npm run stripe:inventory:enqueue`.
- The adapter verifies exact `/v1/account`, then requests exactly
  `GET /v1/subscriptions?status=all&limit=100`, follows
  `starting_after`, validates livemode/object/status, rejects repeated/empty/oversized cursors, and
  stops only at `has_more=false`.
- Append-only page receipts retain account, environment, run, page, request/next cursor, count,
  completion flag, and digest. Partial/error input becomes `attention` and never `completed`.
- Local inventory fixtures are labeled `local_fixture` plus `injected_fixture`, never `stripe_test`.

### H8 — Cohort capacity is environment-scoped

- Eligibility has an environment, exact benefit/cohort, expiry, and append-only event. The policy row
  is locked transactionally before the capacity count and invitation write.
- Concurrent max-one invitations converge to one eligible household. An expired eligibility no longer
  consumes capacity and cannot be renewed around a replacement active household.
- Test eligibility does not authorize production. Live cohort approval is a separate exact-founder,
  revision-checked append-only event; production initiation nevertheless remains unreachable in this
  candidate.

### H9 — Provenance, billing truth, UI, and operations

- Preflight observations always append, even for an identical resource digest, and retain tier,
  transport, livemode, runtime run, observation time, and authenticity kind.
- Webhook signature time remains separate from evidence tier. Reconciliation snapshots preserve the
  originating tier/transport/livemode/run without inventing a provider signature.
- Billing derives `ready` from the same runtime, current environment control, exact active cohort
  policy/benefit, unexpired eligibility, and live-approval predicate used at dispatch. An
  expired-but-unresolved unknown operation remains `pending_provider`, never `ready`. `active`
  requires the same current verified web subscription, provider record, entitlement grant, and paid
  period; an expired grant or disabled runtime cannot be shown ready or verified active.
- The browser journey asserts fail-closed success parameters, persisted unknown/retry state,
  ambiguity remaining pending beyond local expiry, awaiting exact paid evidence, active state,
  selected-household propagation, and cancel-only Portal initiation. See the execution limitation
  below.
- The member home retains its billing-manager-only Stripe Billing card while compiling the separate
  local no-card Founding Household link out of production. The post-build production-artifact
  verifier rejects the local link and other local invitation actions from the exact route payloads
  and referenced production chunks.
- `docs/run-3/STRIPE-FIRST-DOLLAR-RUNBOOK.md` states the exact API version, permission matrix,
  environment names, Portal manual gate, inventory procedure, PostgreSQL race command, rollback
  sequence, and founder-only provider steps without claiming they occurred.

## Local execution receipts

The following commands completed with local-fixture inputs only on 2026-08-17 at the author
refreeze. They are author receipts, not independent acceptance:

| Command | Result |
| --- | --- |
| Final combined config/integrations/0016+0018 migration/provider/Stripe transaction/inventory command | PASS, 97/97 tests across 7 files |
| `npx vitest run tests/integration/commerce-entitlements.test.ts` | PASS, 7/7 after restoring local-reconciliation idempotence while retaining provider-attention recovery |
| `npm run typecheck` | PASS across all workspaces plus root TypeScript project |
| `npm run lint` | PASS, zero warnings |
| `npm run format:check` | PASS, all matched repository files use Prettier style |
| `npm run build` | PASS outside the filesystem sandbox: typecheck plus API, worker, web, HQ, and Expo web builds |
| `npm run verify:secrets` | PASS across 518 local text files; this is a scanner receipt, not proof that no secret exists anywhere |
| `npm run test:unit` | PASS, 238/238 tests across 22 files |
| `npm run test:security` | PASS, 21/21 tests across 7 files |
| `npm run test:eval` | PASS outside the filesystem sandbox, 12/12 synthetic cases; calibration remains `not_calibrated` |
| `npx playwright test tests/e2e/billing.spec.ts --project=edge` | PASS outside the filesystem sandbox, 2/2 mocked local Edge journeys |
| `node scripts/verify-founding-household-production-ui.mjs` after the production build | PASS; exact production route payloads/chunks retain the managed-identity blockers and exclude local invitation actions and the member-home Founding Household link |
| `git diff --check` | PASS; only this Windows worktree's existing LF-to-CRLF conversion warnings were emitted |

The repository-wide `npm run test:integration` command is **not** reported green. It emitted only the
Vitest startup banner, produced no per-file result for approximately 150 seconds, and was interrupted.
The focused seven-file Stripe command completed 97/97, and the separately invoked entitlement,
unit, security, evaluation, and mocked billing-browser suites have the exact receipts above. A later
root-level full integration-suite rerun is required for a repository receipt.

That paragraph records the historical author-snapshot boundary. It was superseded on 2026-08-17 by
the final integrated pre-commit candidate run: `npm run test:integration` completed with 50 files /
367 tests passed in 644.28 seconds. This later receipt is local PGlite/fixture evidence and does not
change the historical manifest or establish provider/real-PostgreSQL/deployed evidence.

The canonical billing Playwright command first failed inside the filesystem sandbox because this
Windows host returned `uv_os_get_passwd ENOMEM` to `tsx`. The unchanged command then completed outside
the sandbox with a clean 2/2 result and teardown. It used mocked local billing state and proves only
the authored browser behavior; it is not provider, deployed-staging, real-human, or production
evidence.

The first build attempt inside the filesystem sandbox was blocked by a Windows access-denied error
while starting the bundled build process. The unchanged build command then completed outside the
sandbox. Likewise, the first evaluation attempt hit `uv_os_get_passwd ENOMEM` inside the sandbox;
the unchanged command completed 12/12 outside it. These reruns made no provider or application-network
call.

The final repository-wide format check was rerun only after the independently owned Stage 7 files
stabilized; it passed without the Stripe author editing those sibling files.

## Independent rereview outcome

A separate reviewer reopened H1–H18 and every follow-up finding, reproduced the historical aggregate
before and after, reran the focused unit/integration/browser/static gates, and returned 0 Critical /
0 High. The review covered permanently blocked unknown session outcomes; exact current-schema
resource/Invoice Payment lineage; payment gaps and dunning; multi-object financial restriction
ordering; Portal API-versus-browser evidence; inventory account/cursor/restart/attention behavior;
cohort expiry/capacity; provenance tiering; founder repair budgets; and disabled/expired billing UI.
That result accepts the local slice only. It is not real PostgreSQL, provider-test, deployed,
real-human, live, or payment evidence, and later integrated files require the final candidate gates.

## Remaining founder/external blockers

The exact founder steps and environment-variable names are in
`docs/run-3/STRIPE-FIRST-DOLLAR-RUNBOOK.md` and the Founder Provisioning system. Remaining evidence
requires founder-owned Stripe test custody and explicit provider-action approval; a restricted test
key and webhook secret held only in the deployment secret store; manually created test product,
price, and cancel-only Portal configuration; manual retention-coupon review; an HTTPS staging edge;
durable PostgreSQL, restore, worker-restart, telemetry, and Replit-portability receipts; legal, tax,
accounting, privacy, support, and incident decisions; a consented real-human journey; separate live
company custody; an independently reviewed future live-capable release; and explicit authorization
for the exact first payment.
