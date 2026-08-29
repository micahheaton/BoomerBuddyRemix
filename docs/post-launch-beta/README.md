# Post-launch beta planning artifacts

## Authoritative planning set

- [PRODUCTION-NONCHARGING-RELEASE-EVIDENCE.md](../run-3-1/PRODUCTION-NONCHARGING-RELEASE-EVIDENCE.md): current candidate-bound evidence for the exact `d0c22310` tag, green tag CI, four successful BoomerBuddy 2.0 Replit deployments, production migration 0045, live noncharging smoke checks, and the DPAPI-encrypted production backup plus disposable-branch restore.
- [EXECUTION-PLAN.md](./EXECUTION-PLAN.md): historical `9b5d585` audit plus the controlling current closure ledger, explicit unknowns and closure gates, historical code anchors, seven-day owner map, 30-day operating model, cash controls, autonomy model, backlog, and two-year target.
- [EXECUTION-PLAN-SUPPLEMENT.md](./EXECUTION-PLAN-SUPPLEMENT.md): immutable audit receipt for the 2026-08-24 live Stripe inventory and corrections now integrated into the base plan.
- [LIVE-DEPLOYMENT-DRIFT.md](./LIVE-DEPLOYMENT-DRIFT.md): historical sanitized read-only evidence for the deployment drift observed through 2026-08-28. The exact `d0c22310` deployment supersedes its current-state conclusions but not its dated observations.
- [PRODUCT-VALUE-BETA-LEDGER.md](./PRODUCT-VALUE-BETA-LEDGER.md): current repository evidence for the Trusted Circle, collaborative Check, learning, regional-guidance, reminder, web, and mobile beta value loop, with explicit external closure gates. Its top finite handoff separates the deployed baseline from the repository-only Check reuse candidate, tonight's stopping point, tomorrow's founder walkthrough, and the remaining launch gates.
- [OFFER-HYPOTHESIS-REGISTRY.md](./OFFER-HYPOTHESIS-REGISTRY.md): historical planning index for annual, Individual, and referral hypotheses. The committed versioned catalog promotes Family annual into the current repository offer candidate while Individual and referral entries remain default-off hypotheses. Neither document can authorize provider configuration, deployment, or production activation.
- [REVENUE-EXPERIMENT-ACTION-PACKET.md](./REVENUE-EXPERIMENT-ACTION-PACKET.md): exact local synthetic specification and candidate-bound noncharging setup packet for an isolated offer-research Stripe sandbox and private, noncollecting website preview. It records that access-intent receipts are not leads and cannot currently measure lead-to-paid conversion.
- [NONCHARGING-RELEASE-RECEIPT.md](./NONCHARGING-RELEASE-RECEIPT.md): retired historical template for
  the earlier monthly-only noncharging plan. It is format and regression evidence only and must not
  govern the current annual-plus-monthly catalog. The current release requires a new external scope
  receipt. The completed receipt lives outside the versioned candidate and binds the exact
  candidate, catalog, actions, targets, prerequisites, stop conditions, and rollback.
- [GAUNTLET-PROMPT-PACK.md](./GAUNTLET-PROMPT-PACK.md): standalone phases G0 through G3.
- [GAUNTLET-PROMPT-PACK-G4-G15.md](./GAUNTLET-PROMPT-PACK-G4-G15.md): standalone phases G4 through G15 and the exact G0 first prompt preserved at the end.

The two gauntlet files together are the complete G0 through G15 pack. Neither file is complete by itself.

## Current release status

The exact release commit is `d0c22310de5ea0c4727035ca278f1a552c65eafb`, tree
`b3f74c3ea858c0ce9b3d407a811327497af81248`, under annotated tag
`run3-1-replit-founding-household-d0c22310de5e`. Tag CI run `33238936758` passed all five jobs.
Production migration 0045 is applied, all four BoomerBuddy 2.0 Replit services published
successfully, the API and worker are healthy, the current pricing and Learn surfaces are live, and
`/sign-in/client-trust` no longer returns 404.

A fresh production `pg_dump` was encrypted with Windows DPAPI `CurrentUser`, authenticated by a
decrypt-and-hash round trip, and restored successfully on the disposable Neon branch. Source and
restored migration evidence both equal `45|0045_member_learning_rehearsal_answers.sql`. The ignored
local artifact and sanitized receipt live under `.data/backups/`; the candidate-bound safe evidence
is summarized in the current production release dossier linked above.

This is a deployed noncharging release, not a completed paid beta. Real Google and email/password
member sessions including any inbox verification or Device Trust challenge, authenticated member
and Trusted Circle rehearsals, staffed support, qualified legal and tax dispositions, authentic
Stripe sandbox and live lifecycle proof, timed application rollback, signed mobile packages,
physical-device proof, and Customer 1 remain open. Stripe, Twilio, referrals, support intake,
access-intent collection, and governed-content automation remain disabled. No first payment is
claimed.

## Historical pre-deployment evidence snapshot

The remainder of this section records the state before the exact `d0c22310` release. Preserve it as
dated lineage, not as the current deployment verdict.

The integrated implementation was committed as
`db2ff5efbc139623b72584f55e896213128c2552`, followed by the PostgreSQL verifier repair
`45714b713619e3d02785ca84669da6ec364d1b70`, and merged to `main` as
`20fc6783046df682b92bb01495fabbff347d2727`. Exact-SHA pull-request GitHub Actions run
`33176283345` passed all five jobs. Earlier exact-SHA receipts `33154571879`, `33098426835`,
`33123397854`, and `33141679927` remain immutable evidence for their respective implementation
baselines.

The committed and merged repository candidate includes:

- self-service account creation and a dedicated sign-up route;
- Family annual at USD 149.90 after a seven-day trial as the intended default;
- Family monthly at USD 14.99 without a trial;
- Individual monthly at USD 8.99 and Individual annual at USD 89.90 after a seven-day trial,
  implemented but default-off;
- secure self acceptance and revocation of billing authority for the exact active household
  administrator after recent Clerk billing re-verification, origin validation, explicit consent,
  action-bound idempotency, and append-only evidence;
- encrypted immutable HQ content drafts, independent review and correction states, a public Learn
  surface, and export-only social and video variants; and
- hardened mobile callbacks, navigation, reminder choices, Safe Word recovery, tablet layout,
  distribution metadata, and provider-free validation for `net.boomerbuddy.app` unless a provider
  collision is found;
- immutable annual-trial Checkout-attempt lineage so a proved expired and unused attempt can receive
  a fresh idempotency key without consuming the household's one trial; and
- recent-authenticated, transaction-aware Safe Word configure, replace, and disable operations with
  lifecycle, audit, and outbox evidence.

Referral rewards remain disabled. The governed content lane does not autonomously browse the web,
publish to social providers, or send customer notifications. The integrated candidate passed the
complete local repository verification chain, 31 of 31 Edge Playwright journeys, and the Chromium
and WebKit desktop and mobile accessibility matrix. Firefox did not launch on the Windows host and
is not counted as local browser proof. Exact-SHA pull-request CI passed its Edge and
Chromium/Firefox/WebKit accessibility jobs. These results bind the committed implementation and do
not replace an annotated-tag CI, provider, deployment, physical-device, or customer receipt.

A fresh Neon branch named `rehearsal-annual-content-retry-final-20260828`, cloned from unchanged
production, applied migrations 0028 through 0044 with the repository migration runner, reached 44
ledger entries, and applied zero migrations on a second run. The governed-content,
versioned-offer, trial-reservation, and immutable trial-Checkout-attempt tables and the
billing-authority retention index were present. Production remained at 27 migrations. The final
migration hashes were
`b43a99649ef64a5a2f106dee26b27c46e6949e8d65a3e3334cb0cd1595722b6d` for 0043 and
`97ac116f7b4ede21206a83ec379f22a4d301086c2e44b78e3a32b77142b72830` for 0044.

The sell-today decision is **no**. Anonymous live checks still show the older customer deployment,
including a 404 at `/sign-in/client-trust`, an observed Google sign-in refresh loop, and an email
verification path that reached a missing page. The current annual-trial, catalog, authority,
content, acquisition, and mobile work now has a full-suite receipt and an isolated final migration
rehearsal. It has received committed implementation lineage, a clean-tree dependency receipt,
exact-SHA pull-request CI, and a merge to `main`. It still has not received an annotated release tag
and tag CI, provider proof, production migration, deployment, two-person rehearsal, first payment,
signed native package, or physical-device proof.

The current candidate can be considered for controlled beta only after the merged `main` commit and
its annotated tag pass GitHub CI, Clerk and Stripe closure evidence is complete, one exact GitHub
tag is pulled into the four BoomerBuddy 2.0 Replit consumers, and the signed-in value and billing
journeys are rehearsed with synthetic identities. Never use the legacy BoomerBuddy Replit project
for that deployment.

## Which prompt to run

- [RUN-NEXT-EXECUTION.md](./RUN-NEXT-EXECUTION.md) is the current closure and execution entry point.
  It freezes a later exact-SHA candidate, runs the independent gauntlet, and executes only actions
  whose objective prerequisites and rollback receipts are complete.
- [RUN-NEXT.md](./RUN-NEXT.md) is a read-only re-audit prompt. Use it only after the repository, deployment, providers, or evidence baseline materially changes, or when a fresh independent baseline is specifically needed.

Section 3.0 of the base plan is authoritative for current execution. Its later sections preserve historical audit evidence and must not be read as proof for later committed or deployed work. The supplement is retained as an audit receipt and no longer overrides the integrated base plan. The versioned production catalog controls the current Family annual and monthly repository candidates. The offer hypothesis registry controls default-off Individual, group-rate, and referral hypotheses and preserves historical annual research rows. Older or broader wording cannot create a production offer, provider write, customer promise, or referral program.

## Execution authority

Repository implementation and testing may continue under the current scope. The committed and
merged candidate does not authorize a production database, provider, deployment, customer, message,
payment, or money write. Before an external write, complete a scope receipt outside the candidate
that binds the exact candidate SHA and tree, green CI, annotated tag, ordered action manifest, exact target and
environment, safe account identifiers, stop conditions, rollback, and the current explicit
authorization required by the executing task. A different merge result, squash, rebase, tree, CI
result, target, or action scope requires a new receipt and review.

Standing authorization is not evidence and cannot replace direct customer consent, customer plan
choice or payment entry, provider-required account-holder identity or agreement steps, qualified
legal or tax decisions, credential custody, production access, exact-SHA deployment proof, or a
tested rollback. Continue safe independent lanes while a blocked lane waits for one of those
objective prerequisites.
