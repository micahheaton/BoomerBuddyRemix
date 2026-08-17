# BoomerBuddy Build Run 2 — Independent Review

**Reviewed archive:** `BoomerBuddy-BuildRun2-a66a24d.zip`  
**Archive commit marker:** `a66a24d3b826d602e20f2976375d140801f893ed`  
**Archive SHA-256:** `7f23e5ff47212f01f345e514855734e4dd002ec09433e92df648ac15165bd2d8`  
**Archive contents:** 415 committed files, 3,468,891 uncompressed bytes  
**Review posture:** adversarial static review of the frozen committed tree, with targeted tracing of authority, Public Check, fraud-provider boundaries, commerce, durable work, HQ, autonomy, privacy, and portability.

## Executive verdict

**Proceed to Run 3, but amend the Run 3 gate before execution.**

I did **not** find a new in-scope Critical defect in the frozen Run 2 tree. The major Run 1 findings were materially addressed. In particular, Run 2 now has a much stronger authority graph, typed least-data fraud-provider boundaries, safe redaction instead of blanket rejection, a first-class privacy-bounded Public Check, conservative Stripe event/reconciliation logic, causal durable work, and a materially expanded Business OS/HQ foundation.

I would accept the claim that Run 2 is a strong **bounded local commercialization foundation**.

I would **not** carry the sentence “no unresolved Critical or High defect” forward as a production-readiness statement. Production is deliberately disabled, the dependency advisory inventory is not adjudicated, and several controls needed for future external/autonomous execution are still design-time rather than enforced runtime controls. That is consistent with Run 2’s own stated limits.

Before Run 3 provisions staging or enables any external side effect, I would explicitly reopen the items below.

---

## What I independently verified from source

### 1. The ZIP is the promised frozen commit

The ZIP archive comment contains the full commit:

`a66a24d3b826d602e20f2976375d140801f893ed`

This is stronger evidence than relying on the filename alone.

### 2. Run 1 authority-model problems are materially corrected

The current model separates neutral household membership from:

- household administration;
- protected enrollment;
- pairwise Trusted Circle relationships and permissions;
- payer identity;
- billing management;
- employee role;
- support-case assignment;
- exact restricted-resource grants.

`packages/authorization/src/index.ts` enforces server-side resource checks rather than inferring authority from broad roles. Support access to restricted customer resources requires both an active case assignment and an exact restricted-access grant. The restricted-access scopes are hydrated from current persistence state rather than trusted from the client.

This is a substantial improvement over the Run 1 role collapse.

### 3. Sensitive scam inputs are now redacted where safe

`packages/security/src/minimize.ts` detects bounded card, one-time-code, and explicit credential spans and substitutes typed placeholders. Private keys, unsafe URL secrets, uncovered credential-like material, overlapping sensitive spans, and unusable remnants still fail closed.

That directly resolves the Run 1 problem where useful scam evidence containing an OTP or payment-card string could be rejected wholesale.

### 4. `lower_concern` is no longer a reachable customer risk state

`packages/fraud/src/types.ts` limits active risk bands to:

- `unknown`
- `caution`
- `high_concern`

`lower_concern` is explicitly reserved. `packages/fraud/src/analyze.ts` also gives stale provider observations and provider `not_found` observations zero score, so missing evidence does not lower concern.

### 5. Fraud-provider least-data boundaries are materially stronger

The provider model now defines seven typed roles with exact input-field contracts:

- local signals;
- domain reputation;
- URL reputation;
- message reasoning;
- verified organization;
- campaign intelligence;
- recovery authority.

`packages/fraud/src/provider.ts` revalidates the dispatch object, checks exact manifest fields, enforces data/egress/retention/training policy, applies timeout and cost limits, and refuses a live provider unless a durable cross-process rate limiter is supplied.

The current local provider has no network egress and returns `unknown`, which is truthful.

### 6. Public Check is a real first-class acquisition/privacy path

The Public Check path has:

- anonymous server-minted context grants;
- HMAC-stored credentials rather than plaintext bearer secrets;
- client/global quotas;
- database-backed concurrency leases;
- no URL fetching;
- safe redaction before analysis;
- encrypted short-lived result payloads;
- explicit save consent;
- atomic conversion into an owned Check;
- attribution that does not contain submitted scam content;
- physical deletion of expired anonymous result/context rows after the terminal window.

This is a meaningful correction to Run 1.

### 7. Stripe handling is substantially more conservative

The Stripe implementation verifies the raw signed body with HMAC and constant-time comparison, enforces timestamp tolerance, test-vs-live mode, supported API version, and an idempotent provider inbox.

The commerce layer deliberately distinguishes:

- initial server-bound activation;
- non-payment status evidence;
- verified `invoice.paid` evidence.

Initial server-bound activation may establish the first service period. Non-payment subscription events can restrict or shorten that period but cannot extend it. Advancing a later paid-through period requires authenticated `invoice.paid` evidence and exact subscription/price/period lineage, with mismatches sent to reconciliation/quarantine.

This matches the Run 2 commerce design rather than treating every Stripe status event as payment truth.

### 8. Durable work is materially better

`packages/persistence/src/jobs.ts` implements:

- transactional enqueue;
- idempotency conflict checks;
- lease-based claims with `FOR UPDATE SKIP LOCKED`;
- lease heartbeats;
- consumer receipts;
- bounded attempts;
- retry/dead-letter state;
- replay lineage;
- shutdown lease relinquishment.

The outbox additionally prevents a later causal event from passing an unresolved predecessor.

This is a credible local durable-work foundation.

### 9. Replit is not an intended runtime dependency

`verify-portability.mjs` checks source/configuration for Replit-specific runtime dependencies and V1 runtime references. The Docker/Render/Vercel/EAS artifacts are standard-platform scaffolding.

`replit-loss-drill.mjs` explicitly requires a non-Replit Git source and accurately labels its result as only partial source/build proof. It does **not** pretend that database restore, DNS cutover, object restore, or mobile signing have been proven.

### 10. Production fails closed

`packages/config/src/index.ts` intentionally refuses all `NODE_ENV=production` startup until managed identity and KMS adapters exist.

That means the Render configuration is presently a scaffold, not deployable production infrastructure. This is a feature of the Run 2 safety posture, not an accidental failure.

---

# Findings to reopen before Run 3

## R2-01 — HQ support/reviewer projections are broader than I want for least privilege

**Severity:** Medium in the bounded local build; **must resolve before real customer data / production identity**

`packages/authorization/src/index.ts` currently allows:

- `hq_support` to `hq:households:list`;
- `hq_support` and `hq_reviewer` to `hq:reviews:list`.

The corresponding HQ routes call unfiltered repository projections.

`HqRepository.households()` returns every household ID/name plus member count, orientation-ready count, and entitlement state.

`HqRepository.checks()` returns up to 100 recent Check records across households with household ID, artifact kind, risk, provider state, and time.

The design correctly case-gates restricted customer **content**, but support/reviewer staff can still receive broad customer metadata without a case assignment.

For a scam-safety product, household identity plus Check/risk activity is sensitive operational metadata even when the submitted artifact itself is absent.

### Required Run 3 change

Define separate projections for:

- owner global visibility;
- fraud reviewer assigned queue;
- support assigned-case queue;
- aggregate system/provider health.

A support employee should not need a global household directory to resolve one assigned case. A fraud reviewer should receive assigned/review-eligible work rather than an all-customer activity feed unless an explicit policy says otherwise.

Add negative tests proving unrelated employees cannot enumerate household names, household IDs, or Check/risk metadata.

---

## R2-02 — Autonomy budget is a per-request ceiling, not a real budget

**Severity:** Medium now; **mandatory before any autonomous executor or paid external tool**

`packages/business-os/src/automation.ts` checks only:

`request.estimatedCostCents > policy.budgetCents`

There is no:

- budget period;
- cumulative spend;
- reservation;
- committed spend;
- global company cap;
- per-agent/tool period cap;
- concurrency-safe decrement;
- release/refund path.

Therefore a policy with a `$10` “budget” could authorize an unlimited number of `$9` requests if an executor repeatedly evaluates them.

The current system has no autonomous executor, so this is not currently exploitable. It becomes important the moment BoomerBuddy can spend money without the founder.

### Required Run 3 change

Implement transactional budget ledgers with explicit periods and states:

`available → reserved → committed/released`

At minimum enforce:

- company-wide daily/monthly cap;
- action/tool cap;
- policy cap;
- atomic reservation before execution;
- immutable spend/audit lineage;
- kill switch checked again immediately before irreversible execution.

The word **budget** should mean cumulative authority, not “maximum cost of one request.”

---

## R2-03 — Public Check grants are bound to the exact observed network address

**Severity:** Medium availability/conversion risk; low security risk

`clientKeyForNetworkAddress()` HMACs the observed network address.

The context row stores that HMAC, and `consumeContext()` requires the current request to have exactly the same HMAC.

This is safe against token movement, but normal users can change apparent IP during the ten-minute grant:

- Wi-Fi to cellular;
- cellular path rotation;
- VPN connect/disconnect;
- privacy relay/proxy behavior;
- some carrier/network transitions.

The result could be a valid context appearing “invalid or unavailable” during an otherwise normal Check.

### Required Run 3 proof/change

Test real iOS and Android network transitions through the deployed edge.

Consider using the HMAC address only for quota/abuse buckets while binding the short-lived context to a separate browser/device nonce. Do not weaken abuse controls without edge/WAF evidence.

---

## R2-04 — “One-time” Public Check conversion is technically replay-safe idempotency

**Severity:** Low semantic/documentation issue

After a successful conversion, `public_check_conversions` retains an HMAC of the conversion credential.

A later request with the same token, same authenticated actor, same household, and same consent can return the already-created owned Check with `created: false`.

That is safe and useful for retry/idempotency, but the API response advertises `oneTime: true`.

A more precise contract would be:

**single successful conversion, bounded replay for idempotent recovery**

rather than a credential that becomes unusable after the first successful request.

### Required Run 3 decision

Either:

- rename/document the semantics; or
- expire replay authorization after a short recovery window while retaining content-free conversion evidence.

---

## R2-05 — Consumer receipts do not by themselves make external side effects exactly-once

**Severity:** Medium now; **high-priority prerequisite before external autonomous messaging/actions**

The durable worker acquires a consumer receipt, calls the handler, and only marks the receipt complete after the handler returns.

That is correct for local transactional work.

For a future external side effect, however:

1. provider accepts the operation;
2. process dies before the receipt is marked complete;
3. lease expires;
4. another worker reclaims the receipt;
5. handler may call the provider again.

Current external notification delivery is explicitly blocked, so Run 2 does not create this harm today.

### Required Run 3 change

Every externally irreversible handler must have a provider-specific idempotency strategy.

Examples:

- stable provider idempotency key derived from BoomerBuddy operation ID;
- external message/action ledger;
- provider response ID stored before downstream state advancement where possible;
- reconciliation before retry when provider outcome is uncertain;
- separate policy for providers that cannot guarantee idempotency.

This should be part of the agent/action execution framework, not solved independently by each future agent.

---

# Known blockers I agree with

These are not new defects from this review. They remain truthful Run 3 gates:

### Dependency advisories

Run 2 reports 19 installed dependency advisories: 1 low, 7 moderate, 11 high. The archive does not contain a reviewed advisory/reachability adjudication.

Do not dismiss a High merely because it is transitive. Run 3 should produce a machine-readable current audit/SBOM, map each advisory to runtime/build/dev reachability, then upgrade, replace, mitigate, or formally accept it.

### Real PostgreSQL / multi-worker / OCI

PGlite and source reconstruction are useful evidence, but they do not prove:

- real PostgreSQL semantics under concurrency;
- hosted connection pooling/failure;
- multi-worker lease contention;
- rolling deploy behavior;
- an OCI image actually starts correctly in the target platform.

### Managed identity and KMS

Production identity and key custody do not exist yet. Production correctly refuses to start.

### Full restoration

Source recovery is not company recovery. A real drill still needs:

- founder-controlled remote;
- independent backup;
- managed PostgreSQL restore;
- object-store restore when introduced;
- secrets/KMS recovery;
- DNS cutover;
- application deployment;
- validation from clean machines/accounts.

### Edge protection

Public Check needs real proxy-chain verification, WAF/bot/challenge controls, IPv4/IPv6 behavior, rotation tests, abuse tests, and quota evidence at the deployed edge.

### Human and professional evidence

The 12-case fraud corpus remains `not_calibrated`. The code is a harness, not efficacy evidence.

Representative older adults, paired families, accessibility participants, fraud professionals, legal/privacy advisers, accounting/tax review, and external security testing remain real-world gates.

### Privacy fulfillment

Privacy planning/evidence exists, but complete production export/erasure/restriction/correction behavior has not been proven. Append-only operational/legal evidence will require an explicit retention/pseudonymization policy.

---

# Execution evidence limitation in this independent review

I attempted to install the locked dependency tree in the review sandbox so I could rerun the repository's tests.

The dependency installation did not complete within the available execution window, and the resulting partial `node_modules` did not contain the `vitest` binary. Therefore I **did not independently reproduce** the reported 165 unit / 81 integration / 19 security tests, coverage numbers, builds, or Edge journeys.

That is a limitation of this review environment, not evidence that those tests fail.

My conclusions above are based on direct inspection and tracing of the committed source, migrations, tests, configuration, and Run 2 documentation.

A static secret scan found no obvious real production secret in the archive. The Stripe and credential-like values I found were clearly test/fixture values.

---

# Run 3 gate I recommend

Do **not** use the existing Run 3 plan unchanged.

Add a short **Stage 0: Independent Review Reconciliation** before account provisioning.

Run 3 should be forbidden from declaring staging ready until it has:

1. narrowed support/reviewer metadata scopes or explicitly justified and tested them;
2. implemented cumulative transactional automation budgets before any paid autonomous executor;
3. proved or redesigned Public Check continuity across normal mobile IP changes;
4. defined Public Check replay semantics;
5. created exactly-once/idempotent patterns for every external side-effect class;
6. adjudicated all current dependency advisories;
7. then proceeded into company-owned staging, managed identity/KMS, real PostgreSQL, OCI, Stripe test mode, edge controls, devices, restore, research, professional review, and operations rehearsal.

The final Run 3 outcome should remain:

`GO / NO-GO / REMEDIATE`

with **no public launch and no first-dollar authorization implied by completing the run**.

---

# Bottom line

Run 2 is much better than Run 1 and is suitable to become the base for Run 3.

The biggest positive is that the architecture now tends to **refuse to invent truth**: missing provider evidence stays unknown, payment ambiguity is quarantined, development identity cannot silently become production identity, and external activity remains mocked or blocked.

The most important next move is to preserve that quality when the system gains the ability to touch real customers, real money, real staff, and real external services.

That is where the risk changes.
