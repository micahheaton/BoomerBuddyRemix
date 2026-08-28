# Product Value and Catalog Gap Map

Date: 2026-08-28

This map distinguishes repository implementation from production proof. It contains no customer
data, provider credentials, provider writes, or claims that an untested live journey works. The
current uncommitted branch is `codex/annual-trial-content-beta`, based on frozen commit
`a8d0080701d80f3bb0219905a53c6c86a6a26d47`. GitHub Actions run `33154571879` passed all five jobs
for that exact frozen base. The annual-trial, versioned-catalog, self-service billing-authority,
governed-content, acquisition, and mobile changes described below are an integrated uncommitted
candidate. Full local verification, 31 Edge journeys, Chromium and WebKit desktop and mobile
accessibility checks, and a final isolated migration rehearsal passed. The candidate has no new
commit, tag, exact-SHA CI, provider proof, or deployment proof.

The live site remains on an older build. Its missing `/sign-in/client-trust` route and observed
Google refresh loop and email-verification dead end make the current sell-today decision **no**.
The full combined local gauntlet is strong repository evidence, but only later provider, deployment,
and observed-customer closure evidence can change that decision.

## Requirement-to-evidence map

| Requirement | Authoritative repository evidence | Current status | Exact remaining gap or closure gate |
| --- | --- | --- | --- |
| Short safety curriculum | `packages/domain/src/member-learning.ts` defines seven versioned, 3 to 5 minute scenarios with official sources. `packages/persistence/src/member-learning.ts` persists attempts, completion, review due dates, and resume state. `apps/api/src/routes/member-learning.ts` and `apps/web/src/app/member/orientation/member-learning-client.tsx` expose the member journey. `packages/domain/src/member-learning.test.ts`, `packages/persistence/src/member-learning.test.ts`, and member-learning integration tests exercise it. | Implemented in the repository | Run the signed-in journey against the deployed candidate on an invited test household, including one wrong answer, completion, refresh, resume, and 30-day review-due behavior. |
| Regional scam guidance | Migration `0038_run3_1_member_learning_feed.sql` supports national, state, and District of Columbia selection, immutable versions, official-source metadata, expiry, and national fallback. It originally seeded only United States and California guidance. Migration `0042_run3_1_regional_scam_guidance.sql` adds reviewed Arizona, Illinois, New York, and Pennsylvania briefs from official state attorney general sources. | Materially improved in this change, still partial | Deploy migration 0042, verify each added region resolves to state plus national guidance, and establish an editorial replacement process before the 2026-11-25 and 2026-11-26 review windows expire. The remaining states intentionally fall back to national guidance. |
| Ongoing notifications | `packages/persistence/src/member-learning.ts` builds an in-app feed for lesson reviews, guidance, and an opt-in weekly rehearsal. Web and mobile expose the preference. The current mobile work also separates in-app rehearsal state from generic local-device notification permission and scheduling. | In-app and device-local repository loops implemented; external notifications missing | Prove weekly due-state behavior in the deployed app and generic lock-screen behavior on physical devices. Email, SMS, and remote push require separate purpose consent, provider readiness, delivery receipts, quiet hours, disable controls, and device testing. Twilio remains disabled. |
| Trusted Circle onboarding | `apps/api/src/routes/family.ts`, `apps/web/src/app/member/family/page-client.tsx`, migration `0039_trusted_circle_customer_journey.sql`, and `tests/integration/trusted-circle-customer-journey.test.ts` implement recipient-bound invitations, one-time connection codes, explicit acceptance, revocation, and deliberate per-result sharing. | Implemented in the repository | Complete a two-person deployed rehearsal from invitation creation through acceptance, one redacted share, acknowledgement, revocation, and denied post-revocation access. No submitted message or URL may appear in invitation, notification, audit, or support evidence. |
| Family Safe Word | `apps/api/src/routes/family-safe-word.ts`, `apps/web/src/app/member/family/safe-word/page-client.tsx`, migrations `0037_family_safe_word.sql` and `0041_run3_1_family_safe_word_lifecycle.sql`, plus safe-word security and integration tests implement protected creation, replacement, verification, rate limiting, recovery, and lifecycle evidence. | Implemented in the repository | Complete a deployed create, verify, mismatch, replace, recovery, and revoke rehearsal. Confirm lifecycle evidence for every new candidate-created Safe Word; do not claim legacy lifecycle backfill. |
| Private history and practice | `apps/web/src/app/member/history/page-client.tsx` implements owner history, individually shared redacted results, acknowledgement, and self-reported closure. The member-learning repository implements weekly rehearsal and lesson review. Security and integration tests cover household and sharing boundaries. | Implemented in the repository | Prove save, refresh, pagination, redacted share, acknowledgement, closure, deletion or expiry, and cross-household denial on the deployed candidate. |
| Support | Migration `0034_run3_1_support_receipts.sql`, `apps/web/src/components/support-receipts.tsx`, `apps/hq/src/components/support-receipt-queue.tsx`, and support receipt security, integration, and E2E tests provide bounded receipts and an HQ queue. Public support also offers an email path. | Repository workflow implemented; operating path unproven | Configure and verify the public support destination, send a synthetic non-PII request, observe its receipt and HQ queue state, and rehearse acknowledgement and closure within the promised response window. |
| HQ editorial drafting and publishing | Migration `0043_governed_first_party_content.sql`, `packages/domain/src/governed-content.ts`, `packages/persistence/src/governed-content.ts`, `apps/api/src/routes/governed-content.ts`, `apps/hq/src/components/governed-content.tsx`, `apps/worker/src/governed-content.ts`, and the public `/learn` surface form the current candidate. Draft bodies are encrypted and immutable; review, publication intent, reconciliation, unpublish, retract, and export-only social or video variants are bounded and audited. | Implemented and locally verified as an uncommitted repository candidate | Commit and receive exact-SHA CI, then prove deployed owner authorization, review separation, digest binding, worker reconciliation, correction, rollback, and owned-site publication with synthetic content. No social adapter, autonomous web research, provider post, customer notification, or production publication is proved. |
| Homepage clarity and acquisition | `apps/web/src/app/page.tsx`, `apps/web/src/app/pricing/page.tsx`, the dedicated `/sign-up` route, and public-shell and metadata guards now explain the full practice, Check, Trusted Circle, Safe Word, learning, and guidance loop. They present Family annual at USD 149.90 after a seven-day trial, Family monthly at USD 14.99 without a trial, free account creation, and free Check. | Strong uncommitted repository candidate; local public, axe, reflow, and acquisition checks passed | Commit and receive exact-SHA CI, deploy the exact candidate, repair Clerk, and run five-second comprehension and full sign-up tests with older adults and family buyers. Measure offer, value, privacy, mobile-status, and next-action understanding before buying traffic. |
| Family monthly | Migration `0035_run3_1_paid_family_catalog.sql` remains the historical paid Family base. The current migration `0044_versioned_stripe_offer_catalog.sql`, public catalog helper, commerce contracts, billing UI, worker reconciliation, and provider guards retain Family monthly at USD 14.99 without a trial. | Implemented as an uncommitted repository candidate; live provider offer not proven | Pass the combined catalog and entitlement gauntlet, create and inventory the exact sandbox Product and Price, then prove Checkout, Portal, signed webhooks, first payment, renewal, failure, cancellation, refund, dispute, and reconciliation. Repeat live setup only after legal, tax, support, and cutover gates close. |
| Family annual, exact two months free | Migration `0044_versioned_stripe_offer_catalog.sql` and the current commerce candidate define Family annual at USD 149.90, exactly ten payments of USD 14.99 and a USD 29.98 discount, with a seven-day trial. Public and member billing copy disclose the payment-method requirement and post-trial charge. | Implemented as the intended default in the uncommitted repository candidate; not configured or purchasable live | Prove one-person and one-household trial eligibility, exact provider lineage, payment-method collection, trial reminder delivery, exact first charge date and amount, cancellation before charge, failed first charge, renewal, refund, dispute, tax disposition, and entitlement reconciliation before activation. |
| Individual monthly and annual | Migration `0044_versioned_stripe_offer_catalog.sql` and the current catalog candidate define Individual monthly at USD 8.99 and Individual annual at USD 89.90 with a seven-day trial. Annual equals ten monthly payments and saves USD 17.98. | Implemented but default-off; unavailable to customers | Keep all Individual launch mapping and public selection disabled until its allowance contract, household transition behavior, separate Stripe Product, Prices, copy, support, checkout, upgrade, downgrade, overlap, tax, refund, and lifecycle proof are complete. |
| Seven-day trial followed by annual billing | The current contracts, persistence, commerce route, provider adapter, worker reconciliation, billing UI, and catalog migration model the seven-day annual trial. Checkout requires a payment method and the repository candidate binds trial eligibility and selected offer to durable evidence. An immutable attempt ledger permits a fresh key only after all prior attempts are proved expired, unused, and unambiguous, while a paid entitlement or consumed trial still blocks reuse. | Implemented as an uncommitted repository candidate; no provider or delivery proof | Pass combined authorization and commerce tests; prove same-key replay, abandoned-session expiry and retry, anti-repeat eligibility across person and household, exact consent, exact date and amount, pre-charge reminder delivery, simple cancellation, missing-payment-method cancellation, failed first annual charge, and provider test-clock behavior. Live initiation must fail closed without tax, legal, support, and reminder-readiness receipts. |
| Customer billing authority | `apps/api/src/routes/billing-authority.ts`, shared contracts, and persistence now let the exact active household administrator accept or revoke billing authority for self after recent Clerk billing re-verification, origin validation, explicit consent, and action-bound idempotency. Append-only audit and outbox evidence preserve the decision; HQ remains a correction lane. | Implemented as a security-sensitive uncommitted repository candidate | Pass the full authorization, tenant, stale-household, identity, retry, revocation, audit, outbox, Checkout, and entitlement gauntlet. Then prove recent re-verification and callback behavior in the repaired deployed Clerk realm without recording identity data. |
| Referral rewards | The referral core and HQ evidence queue are intentionally disabled, local-only, and non-cash. `docs/adr/0028-disabled-referral-credit-core.md` records the boundary. | Safety core exists; customer program missing | Choose terms, qualification, fraud controls, tax and accounting treatment, caps, expiry, refund or dispute reversal, customer disclosure, and support policy. Test sandbox credits end to end before any public promise. |

## Current uncommitted catalog decision record

- Family annual is the intended default repository candidate: USD 149.90 per year after a seven-day
  trial. It equals ten monthly payments and saves exactly USD 29.98, or two monthly payments.
- Family monthly remains available in the repository candidate: USD 14.99 per month with no trial.
- Individual monthly is implemented at USD 8.99 per month but remains default-off.
- Individual annual is implemented at USD 89.90 per year after a seven-day trial but remains
  default-off. It equals ten monthly payments and saves exactly USD 17.98, or two monthly payments.
- None of these entries proves an active Stripe Product, Price, Checkout, Portal, subscription,
  provider webhook, payment, entitlement, deployment, or customer journey.
- The referral reward remains disabled and must not appear in public copy.
- Monthly and annual Prices for the same customer plan may share one Stripe Product. Family and
  Individual must be separate Stripe Products because they are different plans.
- Stripe Checkout plus Billing remains the intended subscription path. Do not implement renewal
  with manual PaymentIntents and do not hardcode payment method types.
- Stripe Tax is not launch-ready merely because Tax settings are active. Automatic tax must remain
  off until the account has the legally required active registrations and the exact product tax
  code is confirmed with a qualified advisor.

## Verifiable next closure sequence

1. Create a new exact release commit, pass the clean-tree dependency verifier, push, receive green
   exact-SHA CI, and create an annotated candidate tag.
2. Preserve the completed isolated migration rehearsal and confirm its final 0043 and 0044 hashes
   match the committed files before any production migration.
3. Rerun deployment drift checks and bind provider and deployment receipts to the exact candidate.
4. Repair and prove production Clerk sign-up, Google and email sign-in, client trust, recent billing
   re-verification, and callback behavior with synthetic identities and no customer PII.
5. Configure only the approved Stripe catalog resources and prove each enabled offer's trial,
   Checkout, Portal, webhook, payment, renewal, failure, cancellation, refund, dispute, tax, support,
   and entitlement lifecycle. Keep Individual and referrals off.
6. Prove governed content generation, independent review, publication reconciliation, correction,
   retraction, and worker restart behavior. Social and video outputs remain export-only.
7. Deploy the exact approved tag through GitHub to the four BoomerBuddy 2.0 Replit consumers, with
   Replit pulling only. Do not touch the legacy BoomerBuddy Replit project.
8. Run signed-in two-person member, learning, regional guidance, Trusted Circle, Safe Word, history,
   support, content, and billing rehearsals. Complete signed mobile device and store-package proof
   before claiming mobile availability.
