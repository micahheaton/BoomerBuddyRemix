# Founding Household closed-beta playbook

Status: **historical local-simulation evidence; not an operational production runbook**

Do not use this playbook to create a new production sponsorship, credential, invitation,
enrollment, or external-customer cohort. The production runtime refuses the historical activation
path. Begin current implementation at `docs/post-launch-beta/RUN-NEXT-EXECUTION.md`; the post-launch
beta execution plan, receipt, and prompt pack are its controlling references. The local commands
below are retained only for deterministic historical or maintenance investigation with synthetic
data.

## Evidence statement

This playbook describes an implemented local-simulation workflow. It is not evidence of a real household invitation, managed identity, deployed staging, provider success, payment, conversion, willingness to pay, retention, calibration, or production readiness.

The current production critical-path blocker is managed customer identity and a separately reviewed production sponsor release. Production rendering hides the local forms, and the repository hard-refuses nonlocal operations. Canonical entitlement/session/Family/HQ projections additionally exclude local Founding rows when the runtime is production. The API also refuses production startup globally. Do not promote local persona evidence to a higher tier.

## Objective

Use the smallest safe cohort needed to learn whether a household can reach useful product behaviors. Founding Households are beta customers/test households, not paid customers and not proof that anyone will pay.

The implemented path is deliberately narrow:

1. the exact configured founder records a finite local cohort policy;
2. the founder issues one HMAC-only credential with no recipient/contact record;
3. an existing authenticated household administrator reviews the exact benefit;
4. the administrator separately accepts service terms and protected-adult self-enrollment;
5. one transaction creates finite canonical sponsor access with no payer and no card;
6. the product derives only supported, privacy-bounded funnel facts;
7. the administrator may withdraw, or the founder may end only that sponsorship.

No adapter sends an email, text, notification, campaign, or referral. No account is created by the invitation.

## Founder prerequisites and gates

For local rehearsal only:

- `BB_FOUNDER_PERSON_ID` must name the exact local founder persona (`person-hq-heidi` in the deterministic seed only).
- That person must currently hold an active `hq_owner` assignment in an `internal` organization.
- The normal local development identity, database migration, and seed controls must be enabled.
- The repository must remain in the `local` environment and the evidence tier must remain `local_simulation`.

An upgraded local database that already has the historical `run1-v1` demo-bootstrap marker intentionally returns `already_seeded`; migration 0019 adds the dormant schema and immutable catalogue but does not retrofit Stage 7 demo sponsor/backing fixtures into that occupied database. Use a new disposable local database and run the normal migration/seed path for this rehearsal, or implement a separately reviewed versioned bootstrap. Do not delete or rewrite the old marker, rerun the empty-database seed against occupied data, or silently resurrect fixtures.

Do not put invitation credentials, session secrets, HMAC keys, customer content, or other secret values in source, documentation, logs, prompts, tickets, screenshots, or evidence manifests.

Before any real household can be invited, the founder must separately complete and review:

- managed customer identity and account-recovery custody;
- a verified company-controlled production sponsor organization/backing;
- a production-specific code release that removes the repository’s nonlocal hard refusal only after security review;
- deployed staging evidence for the exact frozen release;
- applicable beta terms, privacy, accessibility, support, incident, and professional-review gates;
- explicit authorization for the real recipient contact/recruitment action.

This document does not authorize any of those actions.

## Local founder procedure

1. Sign in to the separate HQ app as the configured founder.
2. Open **Founding Households**.
3. Confirm the banner says `Local simulation; no card and no delivery adapter`.
4. Choose the sponsor benefit:
   - Plus beta: one protected member and two Trusted Circle participants; or
   - Family beta: three protected members and six Trusted Circle participants.
5. Record all finite bounds:
   - cohort maximum: 1–25 households;
   - invitation lifetime: 1–14 days;
   - sponsored access: 1–180 days;
   - hard programme end: no more than 180 days from the change.
6. Save the policy. Saving any revision terminally supersedes every pending invitation and zeroizes its HMAC material.
7. Issue one local credential. The raw credential appears once. The system stores only its HMAC fingerprint and key version.
8. Hand the credential to the intended local tester only through the explicitly permitted local rehearsal channel. The product does not deliver it.
9. If the credential is lost, exposed, or copied into a prohibited surface, revoke it and issue a new one. It cannot be recovered.
10. Never interpret a reservation, acceptance, or active local grant as a payment or conversion.

Mutation buttons retain one action-and-payload idempotency UUID across an unknown network outcome. Retry the unchanged action first. For invitation creation, an exact retry can confirm that the invitation was created but can never recover its one-time bearer; the console must show `created_credential_unavailable`, then require revocation/zeroization of that exact invitation before a new operation key is issued. A changed payload or resolved operation receives a new UUID.

The founder console can disable the policy, revoke a pending credential, and offboard an active sponsored household. These controls execute no provider, payment, messaging, deployment, DNS, or purchase action.

## Recruitment script template

Use only after the founder has explicit authority to contact the person. Do not run this as an automated campaign.

> I’m inviting a small number of households to test BoomerBuddy’s scam-safety workflow. This is a finite sponsored beta and needs no card. It is not an emergency service, identity proof, or promise that a message is safe. Participation in the service does not consent you to research, marketing, follow-up, referral, or media use. You can review the exact benefit and end date before accepting, and you can withdraw the sponsored service later. Would you like to receive the one-time invitation through our approved handoff?

Record neither the answer nor recipient contact data in the Founding Household invitation table. If research, follow-up, or marketing is desired, use a separately reviewed consent purpose and system.

## Household acceptance checklist

The person must already have:

- an active, unexpired, unrevoked local development session;
- an active local identity;
- active membership in the selected household;
- an active household-administrator assignment.

On **Member → Founding Household**:

1. Enter the complete one-time credential. It stays only in the page’s transient form state.
2. Review the exact benefit, invitation expiry, and access end.
3. Confirm that payment, research, marketing, and follow-up are all `no`.
4. Separately accept:
   - Founding Household service terms version `founding-household-service-beta-v1`; and
   - protected-adult self-enrollment version `founding-household-protected-self-v1`.
5. Submit once. A successful local response must say `not_paid_sponsored_beta`, `local_simulation`, and `paymentCollected: false`.

The exact service disclosure rendered by the API is:

> This finite Founding Household beta is sponsored by BoomerBuddy and requires no card. It provides the selected code-owned benefit only until the displayed effective end. To operate this bounded cohort during effective access, BoomerBuddy records only whether an active local account existed before enrollment, orientation became ready, a Check completed without its submitted content or result, an active Trusted Circle relationship was established without message or contact contents, an authenticated minimized feedback intake completed without treating it as useful, and a later authenticated session occurred. The founder console sees the stable internal household identifier, effective sponsor-access state, and these yes-or-no milestones, but not precise event times, Check or feedback content, message or contact contents. These operational facts are retained with the append-only enrollment history under the service retention policy; they are not research, marketing, testimonial, referral, follow-up, or media consent, and they are not evidence of willingness to pay. The accepting administrator may withdraw service consent at any time, including after founder offboarding.

The exact service policy rendered with it is:

> Founding Household service consent is purpose-limited to delivering and measuring the finite sponsored beta with the bounded operational facts named in the disclosure. Attribution stops at the earliest of withdrawal, founder offboarding, sponsor access end, or program end. Existing consent, enrollment, audit, and bounded operational event history remains append-only under the applicable service retention policy; submitted Check content is excluded, and feedback content has its own retention and withdrawal controls. Research participation, content reuse, marketing, follow-up, referral, testimonial, and media uses require separate explicit consent. Ending this cohort revokes only its sponsor chain and must preserve or rebind unrelated effective entitlements.

The protected-adult consent is separate because it enables the accepting administrator’s protected workflow. Neither consent grants research, marketing, follow-up, referral, or media use.

## Onboarding checklist

Do not mark a step successful without its named evidence source.

| Funnel step | Current evidence source | Truthful current state |
| --- | --- | --- |
| Account creation/readiness | active identity | observable locally; invitation does not create an account |
| Founding Household acceptance | cohort enrollment | observable locally |
| Orientation | ready orientation state after enrollment | observable when completed |
| First Check | completed analysis requested by the accepting person after enrollment | observable without submitted content |
| Understand result | none | `not_observed / not_implemented` |
| Safe next action | none | `not_observed / not_implemented` |
| Trusted Circle established | active relationship plus current consent after enrollment | observable |
| Relevant service value | none | `not_observed / not_implemented` |
| Feedback submitted | exact authenticated household/person, completed minimized safe Stage 8 intake inside effective access | observable without content; not a usefulness claim |
| Return later | a different customer/mobile session at least 24 hours after enrollment | observable |

The cohort DTO exposes stable household control identity plus yes/no milestones and bounded provenance codes. Accepting-person identity, precise event times, household names, recipient contact data, submitted Check content, feedback content, and message content are excluded. Feedback usefulness remains unimplemented and must not be inferred from submission or assignment.

## Follow-up cadence and consent boundary

The Stage 7 acceptance path records `researchConsent: false`, `marketingConsent: false`, and `followUpConsent: false`. Therefore BoomerBuddy must not initiate an automated or product-originated follow-up from this acceptance.

If a separately consented research system is later approved, a candidate human cadence is:

- after onboarding: confirm the participant can stop and knows support/emergency limits;
- after first Check: ask a comprehension question without collecting the submitted message;
- after a Trusted Circle action: test permission comprehension;
- after seven days: ask whether the service was useful and whether they chose to return;
- at exit: record withdrawal/expiry experience and ask no marketing question unless separately consented.

Until that separate consent exists, every cadence item remains blocked and must not be sent.

## Stop conditions

Immediately disable policy issuance and revoke affected pending credentials if any of these occur:

- credential or HMAC material appears in logs, source, prompts, tickets, screenshots, or documentation;
- a non-administrator or inactive/revoked session can preview or accept;
- cohort capacity, one-time use, expiry, or idempotency can be bypassed;
- access is shown as paid, permanent, or “free forever”;
- a shortened or invalid sponsor backing still appears as effective through the longer ledger end;
- a linked subscription, sponsorship allocation, grant, or service-consent terminator leaves future access or post-terminator funnel milestones visible;
- a missing, malformed, suspended, revoked, expired, deferred, proposed, relinquished, or withdrawn service-consent projection disappears from the ledger or is mislabeled as another consent action;
- a Founding operation can share, replay, lease, process, dead-letter, or omit its operation-bound audit/outbox evidence before commit;
- a Founding-bound protected-member or Trusted Circle allowance can be deleted instead of preserved and safely rebound;
- a local Founding grant contributes to production entitlement, session, Family, HQ, Check, Orientation, or commerce-reconciliation behavior after a database restore;
- research, marketing, follow-up, referral, or media consent is inferred from service acceptance;
- an unrelated grant, payer record, subscription, or consent is changed during offboarding;
- local evidence is labeled as staging, production, a real household, revenue, or conversion;
- the funnel claims comprehension, safe action, value, or feedback without its reviewed evidence source;
- a deployment attempts to make nonlocal access effective before managed identity and sponsor review.

For an exposed credential, revoke it so the HMAC is zeroized, preserve its append-only history, investigate the exposure, and issue a new credential only after the stop condition is cleared.

## Success and failure definitions

Local implementation success means all of the following are proven by local tests only:

- exact founder/internal-owner authorization;
- bounded, expiring, versioned policy;
- high-entropy HMAC-only one-time invitation;
- authenticated administrator preview and explicit two-purpose acceptance;
- atomic no-payer canonical sponsor entitlement;
- concurrency-safe cap and idempotency;
- finite expiry and unrelated-grant-safe offboarding;
- one common canonical effective end, immediate terminator attention, and environment-matched resolution across entitlement, Check, Orientation, and reconciliation paths;
- privacy-bounded funnel projection that leaves unavailable outcomes unobserved.

A future real-beta learning success requires genuine human evidence, kept distinct from this local proof, that a household safely completes the relevant funnel steps and chooses to return. One household’s use does not prove product-market fit, willingness to pay, conversion, or calibration.

Failure includes authorization leakage, secret retention, oversubscription, perpetual access, consent transfer, unrelated-grant mutation, fabricated funnel evidence, inaccessible onboarding, or inability to withdraw safely.

## Offboarding and retention

- Natural expiry ends entitlement effectiveness through canonical resolution.
- Founder offboarding ends only the linked Founding Household grant, allocation, sponsor subscription, and enrollment. It does not claim the customer withdrew consent.
- Household withdrawal is available only to the accepting active administrator and appends service-consent withdrawal evidence before ending only that sponsor chain. If the founder already ended sponsorship, the same administrator retains a consent-only withdrawal path that does not mutate the chain again.
- Invitations and enrollments are never deleted. Pending HMAC material is terminally zeroized on acceptance, expiry, revocation, or supersession.
- Operations, audits, outbox records, and consent evidence remain append-only under their existing retention/governance rules.

## Current verification inventory

- Domain and contract tests: local simulation only.
- PGlite fresh 0001–0019 and 0018→0019 upgrade tests: local simulation only.
- Repository hostile, authority, secret, expiry, concurrency, consent, canonical-entitlement, and offboarding tests: local simulation only.
- Direct-SQL PGlite tests cover initial pending/active states, exact captured database time, finite TTL/access bounds, configured-founder binding, immutable-catalogue upgrade conflicts, credential supersession/zeroization, commit-time consent projection integrity, exact sponsor-chain times, fresh operation-bound audit/outbox pairs, exact result counts, append-only allowance transition history, and refusal of partial sponsor-chain or allowance deletion/transitions. These are local trigger tests, not evidence of managed PostgreSQL role custody.
- API founder-to-household integration journey: local simulation only.
- Browser journey is implemented; a focused local Edge run must be reported separately from provider, staging, human, or production evidence.
- Real PostgreSQL concurrency/restore evidence, managed identity, deployed staging, real humans, and production remain separate required gates.
