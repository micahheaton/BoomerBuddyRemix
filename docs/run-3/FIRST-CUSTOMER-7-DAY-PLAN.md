# First Customer: Seven-Day Critical Path

Status: **candidate operating plan; calendar starts only after founder-owned staging prerequisites exist**

Last reviewed: 2026-08-16

The shortest safe path is a web-first, founder-invited Founding Household with no card, followed by a separately gated Stripe test journey and live-activation review. Apple/Google store readiness does not block this path. “Day 1” below is a readiness-relative workday, not a promise that missing accounts, professional decisions, human participants, or provider review can be completed in seven calendar days.

## Entry criteria

Do not start the customer clock until the founder has:

- company-controlled canonical Git and recovery ownership;
- a non-public Replit candidate deployment or equivalent from the frozen tag;
- managed PostgreSQL plus successful independent restore/reconciliation;
- managed customer/HQ identity and KMS/secret custody;
- founder-controlled DNS/edge with a reversible staging hostname;
- support owner, backup, stated hours, incident path, and global stop access;
- approved beta/privacy/research/communications terms and cohort parameters; and
- no applicable unresolved in-scope Critical/High defect.

If these are absent, engineering continues locally while the customer clock remains `not_started`.

## Parallel tracks

| Track | Founder/manual work | Engineering/evidence work | Exit evidence |
| --- | --- | --- | --- |
| Custody/platform | Git, Replit, DNS, PostgreSQL, identity, KMS, backup accounts and recovery owners | Frozen-tag deploy, migration, health, worker, proxy, concurrency, backup/restore, rollback | Staging and independent restore tied to commit/tag |
| Founding Household | Cohort cap, benefit, expiration, geography, participant, support schedule | Invitation/provisioning mode, no-card entitlement, identity binding, consent, funnel, offboarding | One bounded test household can complete the synthetic journey |
| Commerce | Stripe test resources, tax/pricing/refund decisions | Authentic test Checkout/webhook/invoice/portal/reconciliation matrix | Provider test evidence; live remains disabled |
| Communications | Twilio/email account status, approved test recipients and templates | Consent/suppression/quiet-hour/frequency/external-action test path | Test-only signed provider evidence or explicit blocker |
| Feedback/learning | Research owner, media/retention choice, participant consent | Minimized feedback intake, quarantine, HQ triage, close-loop state | Synthetic end-to-end intake; human evidence separately labeled |
| Operations | Incident/absence/finance/privacy owners | Observability, support, privacy request plan, dependency gate, kill-switch/tabletops | Dated owner/checklist and bounded drill evidence |
| Mobile | Apple/Google/Expo account work continues | Native build/share/deep-link/device/accessibility evidence when available | Does not block web-first customer |

## Day 1 — Freeze the narrow customer path

Founder:

1. approve cohort maximum, benefit, expiration, geography, support hours, beta owner, and backup;
2. choose one consented candidate household but do not contact them yet;
3. confirm platform/account owners and store secret values only in approved provider systems; and
4. approve the no-card Founding Household path as the only initial offer.

Engineering:

1. freeze the exact invitation → identity → orientation → Check → safe action → Trusted Circle → feedback → return path;
2. disable unrelated public purchase, marketing, mass message, external autonomous action, and unapproved provider surfaces;
3. run authorization/privacy/consent/retention/browser/accessibility regressions; and
4. publish the provisional support and stop checklist.

Rollback: engage global stop, disable new invitations, preserve evidence, and return to local synthetic testing.

## Day 2 — Deploy and prove custody

Founder manually provisions or confirms the non-public deployment, PostgreSQL, identity, KMS/secrets, DNS test hostname, backup destination, and recovery roles.

Engineering deploys only the frozen tag, then proves:

- health and worker heartbeat;
- production identity/KMS refusal is replaced only by real managed controls, never bypassed;
- least-privilege DB roles and pooled/direct connectivity;
- queue/outbox/replay/shutdown behavior on real PostgreSQL;
- export and restore into independent PostgreSQL with reconciliation;
- trusted-proxy and Public Check edge limits; and
- rollback to the prior tag.

Failure to restore or verify identity/KMS is a stop condition.

## Day 3 — Synthetic founder rehearsal

Use development/test identities and synthetic content only.

1. founder issues one bounded test invitation;
2. a separate test identity accepts and binds it;
3. complete orientation, a synthetic Check, comprehension, a safe action, pairwise Trusted Circle acceptance/withdrawal, feedback, and return;
4. verify funnel events contain no raw content/PII;
5. exercise support assignment, privacy request plan, incident stop, benefit expiration, offboarding, and restore; and
6. have an independent reviewer attempt cross-household, support/reviewer enumeration, consent transfer, replay, quota, and suppression bypasses.

The candidate stays closed if the reviewer finds an unresolved Critical/High.

## Day 4 — Invite the first real Founding Household

Earliest safe real-use day: **Day 4 only if every Day 1–3 gate has retained evidence and the founder explicitly authorizes the bounded invitation. Otherwise it remains pending.**

The founder uses the approved recruitment script and confirms beta terms, research distinction, support hours, benefit/expiration, and no-card status. The participant completes identity and consent directly. Start with a synthetic practice Check and collect only purpose-limited observations.

Allowed manual work for Customer #1:

- founder sends the first invitation;
- guided onboarding and scheduled support;
- manual review of feedback, safety issues, and access state;
- manual extension/offboarding decision with append-only evidence;
- manual Stripe Dashboard observation during later test/live review; and
- manual privacy/support routing.

Not allowed: bypassing identity, inserting consent on the participant's behalf, manually forcing entitlement active, copying raw content into HQ/analytics, or messaging another adult without their consent.

## Day 5 — Observe value and close the loop

1. review comprehension, safe-action choice, support intervention, feedback, and technical funnel state;
2. separate participant preference, defect, safety issue, accessibility issue, support request, and pricing question;
3. make no product promise and publish no quote/testimonial;
4. resolve or explicitly defer blockers with owner/date;
5. verify STOP/withdrawal/offboarding and data choices; and
6. decide whether the household may continue inside the original benefit or the program pauses.

A free beta outcome is not conversion or willingness-to-pay evidence.

## Day 6 — Stripe provider-test gate

If the founder has supplied Stripe **test** resources through the secret system and staging is ready, execute the complete [Stripe first-dollar runbook](./STRIPE-FIRST-DOLLAR-RUNBOOK.md). Keep live mode unavailable. Reconcile Checkout, signed events, exact `invoice.paid` lineage, canonical subscription, grants/allowances, portal, failure/grace/recovery, refund/dispute, outage, and replay.

Earliest day live activation could be **considered**: after Day 6 provider-test evidence plus independent review, qualified tax/legal/accounting decisions, production platform evidence, and the final Run 3 verdict. It is not automatically Day 7 and no agent may execute it.

## Day 7 — Founder dossier and decision

Freeze the candidate and provide:

- exact commit/tag and clean-clone evidence;
- test/build/coverage/security/dependency evidence;
- platform/restore/Replit exit evidence;
- provisioning status and external blockers;
- Founding Household journey and real-human evidence, if any;
- Stripe/Twilio evidence level;
- feedback/intelligence/referral/mobile/operations state;
- open risks with owner/deadline;
- rollback and stop checklist; and
- exactly one `GO_FOR_FOUNDER_ACTIVATION`, `NO_GO`, or `REMEDIATE` verdict.

`GO_FOR_FOUNDER_ACTIVATION` still requires the founder to perform the documented activation decision and separately authorize the first real payment.

## Rollback criteria

Immediately pause invitations and external initiation for:

- cross-tenant/HQ authorization leak;
- consent, suppression, withdrawal, or privacy-control failure;
- raw secret/customer content exposure;
- payment/entitlement mismatch or unreconciled provider outcome;
- failed database restore or custody loss;
- severe required-path accessibility failure;
- provider/webhook identity ambiguity;
- support coverage failure or credible participant harm; or
- applicable unresolved Critical/High.

Rollback preserves legal/audit/payment/consent evidence, drains or relinquishes workers, disables new actions, restores the prior tag when needed, reconciles provider truth, and communicates only through the incident-approved channel.

## Before Customer #10

Must be automated or operator-safe:

- cohort cap/expiry/benefit and idempotent identity-bound invitations;
- privacy-bounded funnel and health alerts;
- feedback minimization/quarantine/assignment/close-loop;
- consent/suppression/quiet-hours/frequency enforcement;
- provider reconciliation, owner attention, and budget/external-action ledgers;
- support assignment, incident stop, privacy-request tracking, and backup verification; and
- dependency/secret/CI/release gates.

Manual founder onboarding, research interviews, final editorial approval, unusual refunds, and sensitive incident decisions may remain manual.

## Before Customer #100

Require measured support capacity, automated but bounded lifecycle operations, mature privacy/media fulfillment, representative accessibility/device evidence, reliable provider monitoring/recovery, staffed incident/on-call coverage, accounting close, tested referral abuse controls, documented editorial provenance/corrections, and repeatable acquisition evidence. Do not extrapolate Customer #1 behavior into these claims.

## Current disposition

The plan is ready; its external entry criteria are not. The repository has local deterministic evidence and draft runbooks, but no managed production identity/KMS, real PostgreSQL restore, deployed Replit candidate, authentic Stripe test journey, Twilio test journey, or real Founding Household evidence. The calendar therefore remains `not_started`.

