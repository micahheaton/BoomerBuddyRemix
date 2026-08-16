# 15 — Referral Foundation

Status: **state, attribution linkage, abuse hold, and reward-approval records are implemented and persistence-tested; no customer referral product, delivery, or reward issuance is connected**.

## Implemented model

The referral record distinguishes Family invitation, Trusted Circle, friend, and gift-trial hypotheses. It can link a referrer/referred person or household to an acquisition touchpoint and move only through approved transitions:

`created → accepted → activated → paid`

Any active state can enter `abuse_review`; revocation remains explicit. Direct jumps such as `created → paid` are rejected. This separation prevents an invitation or acceptance from being counted as an activated or paid household.

Rewards fail closed. A reward is eligible only when a policy is enabled, names an approver and reward code, the referred household is activated, and the referrer remains below the approved cap. The reward ledger records an explicit approver, amount, currency, reason, and disposition. The implemented repository creates an `approved` entry only; issuance, reversal execution, and database-enforced append-only protection are not implemented.

Evidence: [referral rules](../../packages/business-os/src/revenue.ts), [repository methods](../../packages/persistence/src/business-os.ts), [schema](../../packages/persistence/migrations/0005_run2_business_os.sql), and [tests](../../packages/persistence/src/business-os.test.ts).

## Safety and measurement rules

- A Trusted Circle relationship is consent and safety authority, not automatically a marketing referral.
- Referral attribution never grants Check, Family, orientation, or household visibility.
- Count created, accepted, activated, paid, revoked, and abuse-review states separately.
- Do not reward self-referrals, duplicate households, recycled identities, or payment later reversed without a reviewed policy.
- Reward language, tax treatment, promotion terms, and anti-abuse thresholds require professional and founder approval before use.

## Not connected

There is no referral API, web/mobile screen, invite delivery, deep link, identity-bound referral token, gift-trial entitlement, commerce discount, abuse detector, reward balance, payout provider, email/SMS sender, or HQ queue. Current Family invitations use their own consent-scoped lifecycle and are not automatically mirrored into `referrals`. Public Check attribution is also not joined to this table.

No referral, activation, payment, reward cost, or viral coefficient was observed. The test reward is a deterministic fixture—not money, a coupon, or a customer outcome.

Run 3 should first test whether a consent-respecting Family invitation is valuable without incentives. Any rewarded pilot needs identity binding, duplicate/payment/refund checks, clear terms, suppression, accounting/tax advice, a manual review path, and an explicit cost ceiling. Outbound invitation delivery remains separately authorized; Run 2 sent nothing.
