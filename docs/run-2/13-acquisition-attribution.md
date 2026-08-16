# 13 — Acquisition Attribution

Status: **privacy-bounded touchpoints and deterministic local funnel projections are implemented; external analytics, spend, traffic, and causal performance remain blocked**.

## Implemented boundary

The Business OS defines bounded acquisition channels and milestones without accepting submitted artifact content. Tokens are normalized and restricted; referrer input can retain only a syntactically valid hostname. People, households, and anonymous contexts remain distinct, and attribution never grants authority to view a Check or contact anyone.

The durable growth projector now consumes allowlisted product outbox events and writes content-free acquisition touchpoints. Public Check save can record signup; member Check completion can record first Check; orientation events record progress/completion; Family invitation and relationship events record referral milestones; and canonical commerce lifecycle events record trial/paid states. Projection receipts make replay idempotent. Earlier unresolved events for the same aggregate block later growth projection, preventing a causal successor from overtaking poison work.

Evidence: [acquisition policy](../../packages/business-os/src/acquisition.ts), [growth projector](../../packages/persistence/src/growth-runtime.ts), [growth schema](../../packages/persistence/migrations/0009_run2_growth_runtime.sql), and [worker registration](../../apps/worker/src/growth-runtime.ts).

## Measurement contract

The intended funnel is:

`landing → first Check → signup → activation → orientation → trial → paid → retention → referral`

A context is not a person; signup is not activation; eligibility is not payment. Reports must state event source, cohort window, denominator, unknown/direct share, identity-merge rule, and suppression. Local deterministic projection establishes event lineage; it does not establish causal marketing credit.

## Truthful limitations

- No PostHog project, ad connector, consent-banner decision, campaign-cost ledger, production identity merge, small-cell dashboard, or production traffic exists.
- No campaign, landing experiment, paid impression, customer invoice, channel spend, or externally delivered message has been observed.
- Projection can calculate local funnel states from product facts, but no conversion, CAC, retention, incremental lift, or channel-performance result exists.
- Public Check client-HMAC quotas remain application/database controls, not external edge or bot proof.

## Research gate — awaiting external execution

Use the versioned [Human Research Protocol](./HUMAN-RESEARCH-PROTOCOL.md), [Moderator Guides](./HUMAN-RESEARCH-MODERATOR-GUIDES.md), and [Research Forms](./HUMAN-RESEARCH-FORMS.md) for consented older-adult, adult-child purchaser, brand/pricing/Family, and credit-union buyer research. No session has run and there are no findings to report.

Run 3 must obtain privacy/legal review, deploy only content-free approved events, prove merge/deletion/suppression rules, validate edge behavior, and reconcile real costs before comparing channels. See [known limitations](./32-known-limitations.md) and the [Run 3 plan](./33-run-3-launch-plan.md). Run 2 does not launch.
