# Founding Household Playbook

Status: **operator playbook drafted; Founding Household runtime mode and real cohort evidence are pending**

Last reviewed: 2026-08-16

This playbook defines the smallest bounded closed beta. It does not authorize contacting anyone, enrolling a household, opening public traffic, charging a card, or treating participants as evidence of willingness to pay. A participant becomes a beta customer/test household only after the founder follows the approved recruitment, identity, consent, and provisioning steps.

## Objective

Learn whether one invited household can safely complete a coherent loop:

1. create and recover an account;
2. complete orientation;
3. run a first Check;
4. understand the result and evidence limits;
5. choose a safe next action;
6. establish a consented Trusted Circle relationship;
7. receive a relevant service benefit;
8. submit useful feedback; and
9. return later.

The objective is not signup volume, testimonials, referrals, revenue, conversion, or fraud-model calibration.

## Founder gates

Before inviting the first real household, the founder must record:

- cohort owner and support backup;
- maximum active Founding Households;
- invitation expiration;
- benefit and benefit expiration—never “free forever”;
- launch geography and age/eligibility rule;
- stated support hours and emergency boundary;
- identity/recovery process;
- privacy notice, beta terms, research consent, and communications consent versions;
- feedback/media retention choice;
- incident, pause, and offboarding owners; and
- the exact frozen candidate commit/tag.

Missing values keep enrollment disabled. Values belong in the provisioning system, not hard-coded application copy.

## Recruitment boundary

### Allowed draft script

> BoomerBuddy is testing a private, early fraud-safety service with a small number of households. This is a beta: it can make mistakes, is not emergency or financial advice, and may change. Participation is optional. We want to observe onboarding, a synthetic or participant-chosen Check, safe-action guidance, Trusted Circle consent, and feedback. The beta benefit and end date will be shown before you accept. You can withdraw from research or service communications without losing safety/withdrawal controls. Replying to this invitation is not consent to marketing.

The founder sends or approves every first invitation. Initial outreach must use an existing legitimate relationship or a participant-requested channel; no purchased/enriched list, contact upload, transferred consent, automated cold outreach, or implied institutional endorsement.

### Research versus marketing

- Product access terms authorize the bounded beta service only.
- Research participation is separate, optional, purpose/version bound, and revocable.
- Service notifications are separate from marketing and referral messages.
- A beta invitation is not a testimonial request.
- A free household is not willingness-to-pay evidence.
- Quotes, recordings, images, case studies, and testimonials require later artifact-specific permission and review.

## Enrollment checklist

The founder or authorized operator must complete every item:

- [ ] Candidate is inside the configured cohort and geography limits.
- [ ] Invitation has a unique, short-lived, identity-bound token and has not been reassigned.
- [ ] Benefit, expiration, included capabilities, support hours, beta limits, and no-card status are shown.
- [ ] Customer identity and recovery route are verified through the approved identity provider.
- [ ] Customer/HQ audiences remain separate; no development persona or bearer-token login is used.
- [ ] Household administrator, protected person, payer, and billing authority are not conflated.
- [ ] Protected enrollment is self-consented and consumes the correct independent allowance.
- [ ] Trusted Circle authority is pairwise, purpose-limited, explicitly accepted, and revocable by either participant.
- [ ] Research, follow-up, feedback/media retention, and each communications channel have separate choices.
- [ ] The participant receives the safe-word/recovery limitation and emergency escalation language.
- [ ] The founder records only content-free status evidence and the frozen release ID.

No card is requested for Founding Household enrollment. Any future paid conversion is a separate, founder-gated Checkout decision.

## Guided first session

Use a synthetic practice scenario before inviting sensitive real content.

1. Confirm the participant can sign in, sign out, recover access, and identify BoomerBuddy support.
2. Complete orientation and ask the participant to explain the protected-person/Trusted Circle boundary in their own words.
3. Run a synthetic Check and confirm the UI distinguishes evidence, uncertainty, and safe next actions.
4. Ask the participant what they would do next; do not coach toward a desired answer before observing comprehension.
5. If they choose, establish one Trusted Circle relationship with the other adult's direct acceptance. Do not enter or message the other person's phone/email as proof of consent.
6. Exercise participant withdrawal and confirm relationship/content access ends while safety withdrawal controls remain available.
7. Submit one contextual feedback item without sensitive real content.
8. Schedule a participant-chosen follow-up inside the stated cadence.

Never ask the participant to paste passwords, OTPs, card numbers, seed phrases, private keys, or unnecessary real scam content into research notes.

## Follow-up cadence

The default draft cadence is manual and must be founder-approved:

- Day 0: guided onboarding and first Check.
- Day 1: optional service follow-up on comprehension or a blocker.
- Day 3: optional feedback prompt only when follow-up consent remains active.
- Day 7: return/usefulness conversation and opt-in reminder of beta expiration.
- Day 14 or configured end: continuation/offboarding decision and data-choice reminder.

STOP/withdrawal/suppression overrides the cadence immediately. Quiet hours, frequency caps, test-recipient restrictions, and provider delivery reconciliation apply before BoomerBuddy sends any message. Until an approved provider path exists, outreach remains founder/manual and separately consented.

## Privacy-bounded funnel evidence

Record content-free events only, with explicit schema/version and participant choice:

- invitation issued, opened, expired, accepted, or declined;
- identity binding completed;
- orientation started/completed;
- first Check completed;
- result comprehension prompt completed;
- safe-action selection category—not raw content;
- Trusted Circle invitation accepted/declined/withdrawn;
- service notification eligible/suppressed/delivered/unknown;
- feedback submitted, minimized, quarantined, triaged, or closed;
- return session; and
- benefit expired, converted, extended by explicit founder decision, or offboarded.

Do not put raw Check text/URLs, message content, phone/email, safe words, attachment data, research notes, or free-text feedback in analytics. Household/person IDs must be minimized or pseudonymized for the approved purpose. Provider analytics is not enabled until its retention, residency, deletion, and consent path is approved and proved.

## Success and failure definitions

### Per-household success candidate

A household is a usability success candidate only if it independently completes orientation, one Check, result comprehension, a safe next action, and a later return without a severe privacy/authorization/support incident. Trusted Circle and feedback steps are reported separately rather than silently excluded.

### Program learning threshold

The founder sets the cohort target before seeing outcomes. Results must include denominators, drop-off, support intervention, missing evidence, and participant withdrawals. A tiny self-selected cohort cannot establish fraud accuracy, market demand, willingness to pay, or population accessibility.

### Stop conditions

Pause new invitations immediately for:

- unauthorized customer/HQ or cross-household access;
- plaintext secret, raw content, or media exposure;
- loss of consent withdrawal, suppression, or deletion controls;
- incorrect payment or entitlement activation;
- unbounded external message/action retry;
- serious/critical accessibility blocker on the required web path;
- inability to identify/restore the canonical database or frozen release;
- applicable unresolved Critical/High security defect;
- participant harm, credible unsafe guidance, or support coverage failure; or
- the founder engaging the global stop.

Preserve evidence, stop external initiation, revoke affected credentials when necessary, communicate only through the incident-approved path, and do not resume until remediation and independent review are recorded.

## Offboarding

At benefit expiration or withdrawal:

1. explain the service state and any continuation choices without pressure;
2. stop non-required communications and preserve STOP/suppression;
3. keep relationship withdrawal and participant safety controls available;
4. revoke beta-specific entitlement without revoking an unrelated valid grant;
5. honor feedback/media research retention choices and privacy requests;
6. preserve required consent, audit, commerce, and incident evidence under policy; and
7. record the reason category without raw participant narrative in analytics.

## Evidence classification

This document is `operational_design`. Current repository-local synthetic journeys are `local_simulation`. A founder-invited participant would be `real_human_closed_beta` only after identity, consent, deployment, support, and provisioning evidence exists. No real household was recruited, contacted, enrolled, observed, charged, or measured by creating this playbook.
