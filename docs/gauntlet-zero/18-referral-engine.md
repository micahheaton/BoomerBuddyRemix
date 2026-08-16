# Referral Engine

Status: **mechanisms proposed; no referral coefficient or incentive response is known**. Research accessed 2026-08-15.

## Referral principle

Referrals should extend a trusted safety workflow, not turn fear into spam. Ask only after a user has received value, and let the recipient understand who invited them, what will be shared and what accepting does. A Trusted Circle invitation is a product action; a public recommendation, affiliate link and gift are distinct commercial events.

## Current v1 finding

The v1 awards both parties after the referred user’s first analysis: free users receive ten extra analyses and Premium users a free month (reference/boomerbuddy-v1/BoomerBuddy/server/referralService.ts:60). It should not roll forward unchanged:

- the incentive cost is unmodeled and a single analysis is too weak a quality gate;
- lines 138–143 record the referred Premium user’s free-month reward as extra_analyses, corrupting reporting;
- generic referral codes do not encode the user’s purpose, consent scope or household relationship;
- “ten more analyses” reinforces commodity usage rather than collaborative value.

This is a design assessment, not authorization to modify v1.

## Four separate loops

| Loop | Trigger and recipient value | Success event | Initial reward hypothesis |
|---|---|---|---|
| Trusted Circle invite | A user wants help reviewing or acting on a case | Invite accepted, scopes confirmed, first collaborative action | None; it is core utility |
| Share a safe result | A resolved result is useful to one known person | Recipient completes a relevant check | None |
| Gift trial | A paid household wants to protect another household | Recipient activates and remains active 30 days | Sender receives account credit after qualification |
| Advocate / affiliate | A customer or disclosed partner recommends the service | New customer pays and passes refund/abuse window | Fixed credit or commission with caps |

Do not pay for sending invitations, impressions, raw signups, five-star reviews or sharing a frightening result. Never expose an artifact, risk label or relationship merely because a link was forwarded.

## Experience rules

1. The sender selects a person and purpose; native share is preferred over address-book upload.
2. Show a preview of the exact message and data scope. Default to no artifact sharing.
3. The recipient sees the sender’s verified display name, why they were invited, plan implications, privacy terms and decline/block controls before account creation.
4. Send at most one sender-authorized reminder. Respect suppression, rate limits and revocation.
5. Attribute the invitation through acceptance and qualifying value without cross-device surveillance.
6. Make household exit, role change and data deletion straightforward.

Incentivized endorsements create a material connection that must be clearly disclosed ([FTC endorsement guidance](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking)). Counsel should review reward, tax, sweepstakes, messaging and state-law implications before launch.

## Measurement

Maintain an auditable tree of inviter, recipient, campaign, loop type, timestamps, consent state and reward ledger. Report:

- eligible value moments → invite starts → sends → deliveries → acceptances;
- accepted invite → first value → activated household → paid → 90-day retained;
- unique inviters, qualified invites per inviter and downstream contribution;
- time to accept, reminder dependence, block/complaint rate and support contacts;
- reward cost, fraud loss and cannibalized organic conversions.

The viral coefficient is **qualified invitations per active household × acceptance × activated-retained rate**, not raw shares. Keep Trusted Circle growth separate from new paying-household growth.

## Validation plan

1. Observe 12 household usability sessions to learn which value moments naturally prompt help or recommendation.
2. Ship a no-reward, user-initiated Trusted Circle invitation to a 50-household beta. Review every complaint and measure accepted, consented collaboration.
3. Randomize invitation timing only after safety review: post-safe-action versus seven-day follow-up. Stop if users report pressure or misunderstanding.
4. Test gift access with a fixed cohort and explicit terms; compare no sender reward versus a modest account credit. Do not test cash incentives first.
5. Add an affiliate motion only after 90-day consumer retention is known, with signed terms, disclosure templates, code-level attribution and claim monitoring.

Graduate a loop only when it produces activated, retained households at positive incremental contribution without elevated privacy complaints, abuse or cancellations. A high share rate with low retained value is failure.
