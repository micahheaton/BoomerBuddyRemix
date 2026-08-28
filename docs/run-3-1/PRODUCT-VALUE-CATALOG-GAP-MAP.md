# Product Value and Catalog Gap Map

Date: 2026-08-28

This map distinguishes repository implementation from production proof. It contains no customer
data, provider credentials, provider writes, or claims that an untested live journey works. The
baseline release is commit `ce71b6522360afb6dc94b836a8cd46493e3d3468`; the repository changes
described as "added in this change" must receive a new release commit and deployment rehearsal.

## Requirement-to-evidence map

| Requirement | Authoritative repository evidence | Current status | Exact remaining gap or closure gate |
| --- | --- | --- | --- |
| Short safety curriculum | `packages/domain/src/member-learning.ts` defines seven versioned, 3 to 5 minute scenarios with official sources. `packages/persistence/src/member-learning.ts` persists attempts, completion, review due dates, and resume state. `apps/api/src/routes/member-learning.ts` and `apps/web/src/app/member/orientation/member-learning-client.tsx` expose the member journey. `packages/domain/src/member-learning.test.ts`, `packages/persistence/src/member-learning.test.ts`, and member-learning integration tests exercise it. | Implemented in the repository | Run the signed-in journey against the deployed candidate on an invited test household, including one wrong answer, completion, refresh, resume, and 30-day review-due behavior. |
| Regional scam guidance | Migration `0038_run3_1_member_learning_feed.sql` supports national, state, and District of Columbia selection, immutable versions, official-source metadata, expiry, and national fallback. It originally seeded only United States and California guidance. Migration `0042_run3_1_regional_scam_guidance.sql` adds reviewed Arizona, Illinois, New York, and Pennsylvania briefs from official state attorney general sources. | Materially improved in this change, still partial | Deploy migration 0042, verify each added region resolves to state plus national guidance, and establish an editorial replacement process before the 2026-11-25 and 2026-11-26 review windows expire. The remaining states intentionally fall back to national guidance. |
| Ongoing notifications | `packages/persistence/src/member-learning.ts` builds an in-app feed for lesson reviews, guidance, and an opt-in weekly rehearsal. `apps/web/src/app/member/orientation/member-learning-client.tsx` exposes preferences and feed receipts. | In-app loop implemented; external notifications missing | Prove weekly due-state behavior in the deployed app. Email and remote push require a separately consented provider, delivery receipts, quiet-hour behavior, unsubscribe or disable controls, and device testing. Twilio remains disabled. |
| Trusted Circle onboarding | `apps/api/src/routes/family.ts`, `apps/web/src/app/member/family/page-client.tsx`, migration `0039_trusted_circle_customer_journey.sql`, and `tests/integration/trusted-circle-customer-journey.test.ts` implement recipient-bound invitations, one-time connection codes, explicit acceptance, revocation, and deliberate per-result sharing. | Implemented in the repository | Complete a two-person deployed rehearsal from invitation creation through acceptance, one redacted share, acknowledgement, revocation, and denied post-revocation access. No submitted message or URL may appear in invitation, notification, audit, or support evidence. |
| Family Safe Word | `apps/api/src/routes/family-safe-word.ts`, `apps/web/src/app/member/family/safe-word/page-client.tsx`, migrations `0037_family_safe_word.sql` and `0041_run3_1_family_safe_word_lifecycle.sql`, plus safe-word security and integration tests implement protected creation, replacement, verification, rate limiting, recovery, and lifecycle evidence. | Implemented in the repository | Complete a deployed create, verify, mismatch, replace, recovery, and revoke rehearsal. Confirm lifecycle evidence for every new candidate-created Safe Word; do not claim legacy lifecycle backfill. |
| Private history and practice | `apps/web/src/app/member/history/page-client.tsx` implements owner history, individually shared redacted results, acknowledgement, and self-reported closure. The member-learning repository implements weekly rehearsal and lesson review. Security and integration tests cover household and sharing boundaries. | Implemented in the repository | Prove save, refresh, pagination, redacted share, acknowledgement, closure, deletion or expiry, and cross-household denial on the deployed candidate. |
| Support | Migration `0034_run3_1_support_receipts.sql`, `apps/web/src/components/support-receipts.tsx`, `apps/hq/src/components/support-receipt-queue.tsx`, and support receipt security, integration, and E2E tests provide bounded receipts and an HQ queue. Public support also offers an email path. | Repository workflow implemented; operating path unproven | Configure and verify the public support destination, send a synthetic non-PII request, observe its receipt and HQ queue state, and rehearse acknowledgement and closure within the promised response window. |
| HQ editorial drafting and publishing | `packages/domain/src/editorial-intelligence.ts`, `apps/api/src/routes/editorial-intelligence.ts`, and `apps/hq/src/components/editorial-intelligence.tsx` explicitly declare `local_simulation`, `publication: false`, `outboundDelivery: false`, no production route, and no editable content on the board. | Missing as an operating publisher | Build an owner-authenticated content editor with immutable versions, official-source evidence, review and correction states, preview, scheduled owned-site publication, audit receipts, and rollback. Social or video dispatch must remain a later adapter; an HQ queue row is not publication. |
| Homepage clarity | `apps/web/src/app/page.tsx` leads with the problem, Family price, invitation boundary, primary and free CTAs, a four-step response plan, and six recurring-value cards. `tests/security/customer-production-funnel.test.ts` and `tests/e2e/accessibility.spec.ts` bind core copy and navigation. | Strong repository candidate | Deploy the candidate and run five-second comprehension tests with older adults and family buyers. Measure whether they can state who it is for, what happens before and during a scam, what Family includes, what it costs, and what to do next. Do not buy traffic until this passes. |
| Family monthly | Migration `0035_run3_1_paid_family_catalog.sql`, Stripe integration guards, entitlement projections, billing UI, and commerce security tests bind one Family monthly offer at USD 14.99. Production surfaces fail closed around any other customer price. | Only production candidate in the repository; live provider offer not proven | Create and inventory one matching Stripe sandbox Product and monthly Price, configure Checkout and Portal, verify signed webhooks, first payment, renewal, failure, cancellation, refund, dispute, and entitlement reconciliation, then repeat the approved live setup only after legal and tax gates. |
| Family annual, exact two months free | The prior research hypothesis used USD 149.00, which was USD 30.88 below twelve monthly payments and therefore not exactly two free months. Version 2 changes the sandbox-only candidate to USD 149.90, exactly ten payments of USD 14.99 and a USD 29.98 discount. | Corrected research hypothesis only; unavailable for purchase | Extract trial and annual consent requirements, add a separate Family Product Price for the yearly billing variant, implement exact provider lineage and entitlement tests, and prove renewal notices, cancellation, refunds, and failed first annual charge before activation. |
| Individual monthly and annual | Sandbox-only research includes USD 8.99 monthly. The prior annual value was USD 89.00; version 2 changes it to USD 89.90, exactly ten monthly payments and a USD 17.98 discount. Production deliberately exposes no Individual plan. | Corrected research hypotheses only; unavailable for purchase | Define the Individual entitlement and allowance contract, use a distinct Stripe Product from Family, add separate monthly and annual Prices, and prove checkout, lifecycle, upgrade, downgrade, overlap, support, and public copy before activation. |
| Seven-day trial followed by annual billing | Provider-neutral lifecycle types include `trialing`, but the approved production offer requires no trial and the research preview does not start Checkout. | Missing | Specify the exact post-trial amount and date before payment, collect affirmative annual recurring authorization, provide pre-charge notice and simple cancellation, test payment-method requirements and failed first charge, and bind the trial to one identity and household. A trial must not be inferred from a lifecycle enum. |
| Referral rewards | The referral core and HQ evidence queue are intentionally disabled, local-only, and non-cash. `docs/adr/0028-disabled-referral-credit-core.md` records the boundary. | Safety core exists; customer program missing | Choose terms, qualification, fraud controls, tax and accounting treatment, caps, expiry, refund or dispute reversal, customer disclosure, and support policy. Test sandbox credits end to end before any public promise. |

## Catalog decision record

- Family monthly remains the only production offer candidate: USD 14.99 per month.
- Family annual version 2 is a synthetic or Stripe sandbox hypothesis only: USD 149.90 per year.
  This equals ten monthly payments and saves exactly USD 29.98, or two monthly payments.
- Individual monthly remains a synthetic or Stripe sandbox hypothesis only: USD 8.99 per month.
- Individual annual version 2 is a synthetic or Stripe sandbox hypothesis only: USD 89.90 per
  year. This equals ten monthly payments and saves exactly USD 17.98, or two monthly payments.
- The seven-day annual trial and referral reward are not active offers.
- Monthly and annual Prices for the same customer plan may share one Stripe Product. Family and
  Individual must be separate Stripe Products because they are different plans.
- Stripe Checkout plus Billing remains the intended subscription path. Do not implement renewal
  with manual PaymentIntents and do not hardcode payment method types.
- Stripe Tax is not launch-ready merely because Tax settings are active. Automatic tax must remain
  off until the account has the legally required active registrations and the exact product tax
  code is confirmed with a qualified advisor.

## Verifiable next closure sequence

1. Apply and restore-test migration 0042 on an isolated database branch.
2. Create a new exact release commit and tag; rerun repository verification and deployment drift
   checks.
3. Deploy the candidate through GitHub to the four BoomerBuddy 2.0 Replit consumers, with Replit
   pulling only. Do not touch the legacy BoomerBuddy Replit project.
4. Run the signed-in member, learning, regional guidance, Trusted Circle, Safe Word, history,
   support, and monthly billing rehearsals using synthetic identities and no customer PII.
5. Keep annual, Individual, trial, referral, external notifications, and editorial publication off
   until their row-specific closure evidence exists.
