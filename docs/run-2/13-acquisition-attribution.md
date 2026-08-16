# 13 — Acquisition Attribution

Status: **privacy-bounded contracts and Public Check counters are implemented and tested locally; the full funnel and external analytics are scaffolded, not operating**.

## Implemented boundary

The Business OS defines ten acquisition channels (`organic_search`, `paid_search`, `paid_social`, `referral`, `partner`, `affiliate`, `direct`, `content`, `campaign`, and `newsletter`) and nine milestones from landing through referral. Tokens are length-bounded, restricted to a small character set, normalized, and invalid values are discarded. Referrer input can retain only a syntactically valid hostname. The `acquisition_touchpoints` table and repository can record anonymous-context, person, or household milestones without accepting submitted artifact content.

The wired path is narrower. Public Check accepts only enumerated source/campaign pairs, keeps daily aggregate counts for `context_issued` and `check_completed`, and carries source/campaign evidence into the one-time authenticated save record. Integration and browser tests prove bounded attribution and consented conversion without placing the submitted text, URL, host, or result narrative in analytics.

Evidence: [acquisition policy](../../packages/business-os/src/acquisition.ts), [Public Check persistence](../../packages/persistence/src/public-checks.ts), [Business OS migration](../../packages/persistence/migrations/0005_run2_business_os.sql), [Public Check integration test](../../tests/integration/public-checks.test.ts), and [browser journey](../../tests/e2e/public-check.spec.ts).

## Measurement contract

The intended funnel is:

`landing → first Check → signup → activation → orientation → trial → paid → retention → referral`

Count people, households, and anonymous contexts separately. A context is not a person; a signup is not activation; eligibility is not payment. Attribution must never become authority to view a Check or contact a person. Reports should show first-touch and milestone evidence, cohort window, denominator, unknown/direct share, and suppression—not a fabricated single-cause claim.

## Truthful limitations

- Only Public Check context/completion attribution is connected to product traffic. General `acquisition_touchpoints` recording is repository-level and not wired to landing, signup, orientation, commerce, retention, or referral events.
- Public Check’s current `organic` vocabulary is intentionally smaller than the general `organic_search` vocabulary; no cross-model attribution join exists.
- There is no PostHog project, ad-platform connector, identity merge policy, consent banner decision, campaign cost import, multi-touch model, dashboard, or production traffic.
- No conversion, CAC, retention, or channel-performance result exists. Local counters prove mechanics only.

## Research gate — awaiting external execution

Recruit, with consent and accessibility accommodations, older adults across supported age, device, and assistance needs; adult-child buyer pairs with separate interviews before joint tasks; and credit-union buyers spanning executive, compliance/risk, and member-service roles. Use moderated, task-based sessions—not marketing outreach—to test name/brand trust, positioning, price and willingness to pay, the Family proposition, accessibility, and comprehension. Instrument completion, time, assistance, error/recovery, abandonment, confidence, and verbatim concerns without collecting Check content in analytics. Predefine sample, scripts, tasks, success thresholds, incentives, consent, retention, and stop rules. No session has run, so there are no findings to report.

Run 3 must obtain privacy/legal review, connect approved content-free event envelopes, define anonymous-to-known merge and deletion behavior, configure small-cell/reporting controls, and validate production bot/edge behavior before any channel comparison. See [known limitations](./32-known-limitations.md) and the [Run 3 research gate](./33-run-3-launch-plan.md).
