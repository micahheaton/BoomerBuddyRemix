# 15 — Referral Foundation

Status: **Family/referral lifecycle projection and separate reward-policy records are implemented locally; no external invitation delivery, customer referral product, or reward issuance exists**.

## Implemented model

The Business OS referral model distinguishes Family invitation, Trusted Circle, friend, and gift-trial hypotheses. State transitions keep created, accepted, activated, paid, abuse-review, and revoked facts separate. Rewards fail closed behind an enabled policy, explicit approver/code, activation evidence, and a cap; the current ledger can record approval but cannot issue money, a coupon, or a customer entitlement.

The growth runtime now mirrors allowlisted Family invitation and relationship outbox facts into dedicated referral-link projections. Creation, acceptance, activation, withdrawal/revocation, and related acquisition/lifecycle facts retain original event lineage and recipient binding. Receipt idempotency prevents duplicate projection, while causal ordering prevents a later event from passing an unresolved predecessor.

Evidence: [referral rules](../../packages/business-os/src/revenue.ts), [growth projector](../../packages/persistence/src/growth-runtime.ts), [growth schema](../../packages/persistence/migrations/0009_run2_growth_runtime.sql), and [worker tests](../../tests/integration/growth-worker.test.ts).

## Safety and measurement rules

- A Trusted Circle relationship is consent and safety authority, not automatically a marketing referral.
- Referral attribution never grants Check, Family, orientation, or household visibility.
- Count invitation, acceptance, activation, payment, withdrawal/revocation, and abuse review separately.
- Never infer delivery merely because an invitation record or outbox event exists.
- Reward language, tax treatment, promotion terms, and anti-abuse thresholds require professional and founder approval.

## External boundary

There is no public referral API/screen, external email/SMS delivery, deep link, promotion token, gift-trial grant, discount, payout provider, reward balance, production abuse detector, or operated HQ queue. Family invitation projection is product evidence only and does not opt anyone into marketing. No referral conversion, reward cost, or viral coefficient was observed.

Run 3 should first test whether consent-respecting Family invitations are useful without incentives. Any rewarded pilot requires identity and household binding, duplicate/payment/refund controls, clear terms, suppression, accounting/tax advice, manual review, and a cost ceiling. Run 2 sent and paid nothing and does not launch.
