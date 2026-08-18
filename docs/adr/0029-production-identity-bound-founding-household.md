# ADR 0029: Production identity-bound Founding Household activation

- Status: Accepted
- Date: 2026-08-17
- Evidence state: implemented and adversarially exercised in local database tests; no deployed, provider-test, human-delivery, or production-household evidence

## Context

ADR 0024 deliberately stopped the Run 3 Founding Household path at local simulation. Run 3.1 needs a narrowly bounded path for one real Founding Household without converting a bearer credential into authority over an arbitrary client-selected household or treating local evidence as production evidence.

## Decision

Migration 0026 adds definition revision 2 without changing the immutable revision-1 row. Revision 2 permits a production Founding Household only when all of these facts hold at the database boundary:

- the configured founder has the exact active `production-founder-v1` bootstrap, active external identity, verified internal organization, and active `hq_owner` assignment;
- the sponsor organization is verified, its sponsorship and plan are active and finite, and its append-only backing is labeled `live_production`;
- the active production policy has a non-null hard cap from one through five households, a finite invitation lifetime, a finite access duration, and a hard program end;
- the intended customer is resolved from the configured customer issuer plus an exact provider subject to one immutable `production_customer_bootstraps` row;
- that bootstrap still joins the same active identity, person, membership, administrator assignment, and server-created household, with no effective entitlement or prior Founding record.

The HQ invitation request accepts only `intendedCustomerSubject`. It does not accept issuer, household, person, role, entitlement, benefit, or delivery fields. The server supplies the configured issuer and resolves the exact bootstrap. The invitation stores the exact identity ID, issuer, subject, person, and household as immutable lineage.

Creation returns a one-time `invitationCredential` only on the first successful response. The server stores a purpose-separated HMAC fingerprint, cannot recover the credential on idempotent replay, and has no automatic email, SMS, campaign, or contact-list path. Delivery is `founder_manual_only`. Loss requires revocation and replacement.

Preview and acceptance select the household from the authenticated server-side session. They accept no household ID in the request body. A production member must present the same active identity ID, issuer, and subject bound to the invitation, and that identity must still control the same bootstrap household. Wrong-identity and wrong-HMAC attempts fail without expiring, revoking, consuming, or otherwise changing the credential or creating an acceptance operation.

Production acceptance uses the additive `founding-household-service-beta-v2` disclosure, which refers to an authenticated account rather than a local account. Revision-1 consent text and digests remain unchanged for existing local evidence. Acceptance stores the exact session identity lineage, `live_production` evidence tier, separate service and protected-adult consent, and the same finite no-card sponsor chain. Research, marketing, follow-up, referral, testimonial, and media consent remain false.

The production seed remains empty. Code and migrations do not create a production founder, sponsor, sponsor backing, active policy, customer, invitation, or enrollment. Activation requires reviewed one-time founder and sponsor/policy bootstrap procedures. Until those exact prerequisites exist, founder controls and invitation issuance fail closed.

After migrations and `npm run identity:bootstrap-founder`, the founder runs the narrow production bootstrap with a reviewed lowercase UUID v4 and explicit finite dates:

```text
npm run founding-household:bootstrap-production -- \
  --operation-id <uuid-v4> \
  --confirm-operation-id <same-uuid-v4> \
  --benefit-key family_beta_v1 \
  --max-households 1 \
  --invitation-ttl-days 7 \
  --access-duration-days 30 \
  --program-ends-at <iso-timestamp> \
  --sponsorship-starts-at <iso-timestamp> \
  --sponsorship-ends-at <iso-timestamp> \
  --privacy-policy-version <reviewed-version> \
  --confirm-production FOUNDING_HOUSEHOLD_PRODUCTION
```

The repository holds the code-owned definition lock and exact founder lock while it creates or exact-replays one fixed verified sponsor organization, one fixed finite active sponsorship, one append-only `live_production` backing, and policy revision 2. It invokes the normal policy configurator inside the same database transaction, so a policy conflict rolls back any newly created sponsor rows. A retry must use the same operation ID and every semantic field; changed benefit, dates, privacy version, cap, or policy bounds fail as conflicts. The existing append-only policy operation, audit/outbox pair, backing approval person/time, and production founder trigger provide the audit chain. The CLI prints IDs and states only and performs no provider or outbound action.

## Concurrency and recovery

Definition and policy rows are locked before capacity is counted. Active/attention enrollments and unexpired pending invitations consume the same hard cohort capacity; concurrent issuance cannot exceed the active policy. Raw active production policies with a null cap or a cap above five are rejected by a database trigger.

Revocation, supersession, acceptance, and expiry clear HMAC material while retaining append-only lineage. Offboarding closes only the linked Founding sponsor chain and preserves unrelated entitlements and consent history. Disabling the production policy terminally supersedes pending credentials but does not delete history.

## Consequences

- A production credential is not sufficient without the exact intended active customer identity and bootstrap household.
- Founder and sponsor configuration cannot be inferred from local fixtures or generic internal-owner rows.
- UI labels and API evidence tiers reflect the repository environment; local simulation is never relabeled as production.
- Local adversarial tests are implementation evidence only. Founder manual delivery, provider identity, deployed database locking, backup/recovery, and the first real household remain separate founder-gated evidence.

## Rejected alternatives

- Selecting a recipient household, person, role, or entitlement in the HQ request.
- Resolving an issuer from untrusted input or choosing among multiple identities.
- Allowing any active household administrator to redeem a production bearer credential.
- Sending credentials automatically or storing plaintext credentials for recovery.
- Rewriting revision-1 definition or consent evidence.
- Activating an unlimited or null-cap production cohort.
