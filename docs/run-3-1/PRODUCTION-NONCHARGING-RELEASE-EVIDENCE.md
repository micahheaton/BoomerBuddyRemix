# Production noncharging release evidence

**Recorded:** 2026-08-29

**Status:** Exact release deployed and verified with Stripe, Twilio, referrals, access-intent
collection, support intake, and governed-content automation disabled. This is deployment evidence,
not a claim that paid beta, real member authentication, signed mobile distribution, or Customer 1
is complete.

**Evidence boundary:** This is a documentation-only post-release dossier. It records the immutable
runtime candidate below and does not move its tag or claim that a later documentation commit is
running on Replit. No secret, customer identity, customer PII, payment detail, session identifier,
safe word, submitted artifact, or database connection string is recorded.

## Exact release identity

| Field | Verified value |
| --- | --- |
| Canonical repository | `https://github.com/micahheaton/BoomerBuddyRemix.git` |
| Release commit | `d0c22310de5ea0c4727035ca278f1a552c65eafb` |
| Release tree | `b3f74c3ea858c0ce9b3d407a811327497af81248` |
| Annotated tag | `run3-1-replit-founding-household-d0c22310de5e` |
| Annotated tag object | `86064ee582401bf4deab6db3e6734ea44ffc79b0` |
| Peeled tag target | `d0c22310de5ea0c4727035ca278f1a552c65eafb` |
| Source branch at release | `codex/release-doc-alignment` |
| Canonical main at release | `origin/main` resolved to the same release commit before this later documentation-only dossier |
| Local release gate | `npm run verify` passed before tag and deployment |
| Tag CI | [GitHub Actions run 33238936758](https://github.com/micahheaton/BoomerBuddyRemix/actions/runs/33238936758) |

GitHub's read-only run record binds run 99 to the annotated tag, exact release commit, and exact
tree. The run completed successfully on 2026-08-29 at 07:13:34 UTC. All five jobs passed:
`accessibility`, `edge`, `containers`, `verify`, and `postgres`.

## Replit deployment receipt

Each BoomerBuddy 2.0 service pulled from the canonical GitHub repository and published with the
exact release commit and tag. Replit did not push source to GitHub. The separate legacy Replit
project named `BoomerBuddy`, which serves `boomerbuddy.net`, was not changed.

| Service | Deployment result | Safe deployment identifier | Public boundary |
| --- | --- | --- | --- |
| `boomerbuddy-api` | `success` | `bec7b9ae-63bf-4346-8be4-223159739c11` | `https://api.boomerbuddy.net` |
| `boomerbuddy-worker` | `success` | `eee27c44-0a67-450f-8548-0c36ce577669` | Worker-only process behind Replit protection |
| `boomerbuddy-web` | `success` | `11a5b941-eb7f-4f2e-8892-26bfb7a14ece` | `https://app.boomerbuddy.net` |
| `boomerbuddy-hq` | `success` | `beebf547-4c80-4d83-b614-9c2d05bce627` | `https://hq.boomerbuddy.net` |

The API returned `ok` from `/health/live` and `ready` from `/health/ready`. A production database
query recorded one running worker heartbeat that was fresh within 60 seconds and zero current jobs.
The HQ surface redirected a signed-out request to its own sign-in boundary rather than exposing an
operations view.

## Production database, migration, and restore evidence

The production Neon branch `br-misty-mouse-axci45p5` had 44 checksum-valid migrations through 0044
before cutover. The repository runner applied exactly
`0045_member_learning_rehearsal_answers.sql`; an immediate second run applied zero migrations. The
post-cutover ledger contained 45 entries and the exact repository checksum
`16c13a5574ff6eb7daabb0e56faa13b8e18343ac70a36def6ce1367afb6d85d9` for 0045.

At 2026-08-29 08:14:23 UTC, PostgreSQL 18.6 tools created a custom-format production archive over a
direct TLS connection. The archive was encrypted with Windows DPAPI using `CurrentUser`, the
plaintext was removed, the encrypted artifact was decrypted to a second temporary file, and the
round-trip plaintext SHA-256 matched. The authenticated archive then restored successfully on the
existing disposable Neon branch `br-aged-mud-ax87gugn`.

| Backup field | Verified value |
| --- | --- |
| Local encrypted artifact | `.data/backups/boomerbuddy-production-d0c22310-20260829T075704Z.pgdump.dpapi` |
| Local durable receipt | Same path plus `.receipt.json` |
| Plaintext archive SHA-256 | `941af02c1cc92590c42f6ed41495062b0567b37a48b65d90ce386bf5a6eaae5b` |
| Plaintext archive bytes | `3985784` |
| Encrypted artifact SHA-256 | `6590b65c30dbc78d4a3a053822a1620f744993af6310d5299ffb7043a5b63e34` |
| Encrypted artifact bytes | `3986006` |
| Archive entries | `1996` |
| Source migration evidence | `45|0045_member_learning_rehearsal_answers.sql` |
| Restored migration evidence | `45|0045_member_learning_rehearsal_answers.sql` |
| Restore result | `matched_disposable_neon_branch` |

The full encrypted archive contains `public.show_db_tree()`. Restore replay omitted only that one
pre-existing non-application helper because it is owned by another role on the disposable branch;
the helper remained present there. The application schema, data, and migration ledger restored
without error. Temporary plaintext archives and the downloaded PostgreSQL tools were removed after
verification. The encrypted backup and receipt are under the ignored `.data/` boundary and were not
committed.

## Deployed public evidence

Read-only release checks established the following:

- `/`, `/pricing`, and `/learn` returned HTTP 200 on the customer application.
- `/member` redirected signed-out traffic to same-origin `/sign-in`.
- `/sign-in/client-trust` rendered the customer Device Trust handoff instead of returning 404.
- The sign-in and sign-up fields retained typed email input after delay and blur, and Google was
  offered on both surfaces.
- A Public Check accepted `example.org/public-path` without requiring a user to type `https://` and
  displayed the required uncertainty warning.
- The public API reported production mode with provider initiation disabled, Family annual at USD
  149.90 with a seven-day trial as the default offer, Family monthly at USD 14.99, and the two
  Individual offers present but not customer-selectable.

At 2026-08-29 08:18 UTC, one additional anonymous read-only check returned HTTP 200 for each public
operations-policy route: `/support`, `/privacy`, `/terms`, `/billing-terms`, `/accessibility`, and
`/account-deletion`.

These checks do not prove a real Google or email/password session, inbox verification or Device
Trust challenge, sign-out, recovery, true MFA, billing re-verification, staffed support response,
legal approval, payment, mobile device, or human usability result.

## Capability and activation state

The deployed repository contains the member product loop: orientation, seven short lessons,
regional and national guidance, weekly rehearsal, progress, Check history and deletion, Trusted
Circle onboarding and revocation, redacted sharing, Family Safe Word, feedback, and the matching
Expo member experience. It also contains hosted Stripe Checkout, Portal, webhook, entitlement,
reconciliation, recovery, and Family and Individual catalog code.

External activation remains deliberately closed:

| Boundary | Deployed state |
| --- | --- |
| Stripe | `BB_STRIPE_MODE=disabled`; no Checkout, Portal, webhook, Customer, Subscription, or money movement claimed |
| Family offers | Repository and public catalog present; no live Stripe Product or Price yet |
| Individual offers | Implemented and default-off; not customer-selectable |
| Twilio | Disabled and credential loading refused |
| Referrals | Disabled; no live reward, coupon, or public referral promise |
| Private-beta access intents | Disabled |
| Support receipts | Customer history, HQ queue, and intake disabled pending a synthetic drill |
| Governed content automation | Disabled; the reviewed static curriculum remains available |
| Mobile | Source and provider-free checks complete; no signed IPA, AAB, APK, or store submission |

## Open paid-beta closure gates

The exact deployed release is real, but paid beta remains unproved until all of the following close:

Post-release supersession note, 2026-08-29: an authenticated provider and service configuration
session reports that the prior Google OAuth credential was rotated and revoked, Customer routing
and web Clerk key alignment were corrected, and exact `d0c22310` web code was republished. A
sanitized external configuration receipt and all real member-session journeys remain open. The
rotation instruction in item 1 below is retained as this release dossier's dated pre-repair state
and is superseded only for the reported rotation action.

1. Replace the Google OAuth secret that appeared in authenticated inspection output, install the
   replacement in Customer Clerk, revoke the prior secret, and retain only safe credential IDs and
   timestamps. Then complete real Google and email/password member journeys, any inbox verification
   or Device Trust challenge, return, sign-out, recovery, true MFA or billing re-verification, and
   wrong-realm denial with founder-controlled QA identities and no retained PII.
2. Verify ownership and staffing of `support@boomerbuddy.net`, publish response expectations, and
   rehearse content-free customer and HQ support receipts including rollback.
3. Obtain qualified legal, privacy, refund, cancellation, renewal, tax-geography, receipt-email,
   payout, and statement-descriptor dispositions, then align the public pages and provider fields.
4. Run an authentic isolated Stripe sandbox lifecycle for annual trial, monthly payment, decline,
   Portal, cancellation, renewal, refund, dispute, webhook ordering and replay, worker restart, and
   reconciliation.
5. Re-inventory the live Stripe account, create the exact Family Product, two Family Prices,
   cancel-only Portal configuration, 2.0 webhook, and separate restricted API and worker keys while
   live initiation remains closed.
6. Run two clean deployed customer and HQ rehearsals with fresh synthetic sessions and reset state
   between them.
7. Perform a timed application deployment rollback. The database dump, DPAPI integrity, and
   disposable-branch restore portion is already proved by this receipt.
8. Link the company-controlled Expo, Apple, Google, and Clerk native records; build signed internal
   packages; and complete physical-device authentication, accessibility, reminder, offline, and
   member-value journeys.
9. Onboard one genuine consenting household, let that customer choose the offer and enter payment,
   and reconcile the first settled invoice before claiming a paying customer.

Lead generation, paid advertising, referrals, autonomous publication, and outbound customer
notifications remain after these product, identity, support, legal, payment, and operating gates.

## Current disposition

`NONCHARGING_RELEASE_DEPLOYED_PAID_BETA_NOT_YET_PROVED`

Use this document as the current deployment evidence index. Use historical dossiers only for the
candidate and observations they explicitly bind. Do not reinterpret a historical 404, old pricing
page, monthly-only catalog, or unavailable deployment claim as current state.
