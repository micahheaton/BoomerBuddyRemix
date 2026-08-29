# Exact first prompt to run next

Open [GAUNTLET-PROMPT-PACK.md](./GAUNTLET-PROMPT-PACK.md) and run exactly the entire fenced
`text` block immediately below `## G0 - Explore and baseline`. Do not summarize, copy, or modify
that prompt in this file. It is the single canonical G0 and the only first prompt to execute.

Use [GAUNTLET-PROMPT-PACK-G4-G15.md](./GAUNTLET-PROMPT-PACK-G4-G15.md) only after the canonical
G0 through G3 sequence reaches the applicable evidence gates. The canonical G0 requires reading
[OFFER-HYPOTHESIS-REGISTRY.md](./OFFER-HYPOTHESIS-REGISTRY.md), which controls default-off
Individual, group-rate, and referral hypotheses; referrals remain disabled.

Current baseline:

Deployed production release: `d0c22310de5ea0c4727035ca278f1a552c65eafb`

Deployed production database: migrations through `0045_member_learning_rehearsal_answers.sql`

Runtime release candidate:
`0059c4dc07325fdcc7d36565480f1698d8f140de` through migration
`0046_check_analysis_reuse.sql`; it is not the deployed production release. This later
documentation and governance state is outside `0059c4d` and is not covered by exact-SHA CI run
`33255158115`. The deployed customer
surfaces present the annual-first Family catalog: USD 149.90 after a seven-day trial is the default,
and USD 14.99 monthly without a trial is the alternative.
Stripe initiation and purchasing remain disabled, so neither offer can currently be purchased.
Account creation alone does not start a trial or charge. Individual offers remain default-off, payment remains web-first, mobile P0 continues in
parallel, and Twilio remains disabled.
