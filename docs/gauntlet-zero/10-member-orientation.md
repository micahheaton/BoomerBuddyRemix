# New Member Orientation

## Purpose

Orientation converts a paid account into a prepared household. It is a resumable domain workflow, not a marketing carousel.

## Build Run 1 state model

`not_started → in_progress → ready`, with an orthogonal `intervention_recommended` flag. Required steps are:

1. `protection_subject` — identify who is being protected and confirm their role.
2. `trusted_circle` — invite or explicitly defer a trusted contact.
3. `safe_word` — create a non-retrievable verifier or defer with explanation.
4. `practice_check` — submit a labeled simulation and interpret the result.
5. `capabilities` — acknowledge what BoomerBuddy can and cannot verify.
6. `complete` — review sharing, recovery, and notification choices.

Each step has `not_started`, `in_progress`, `completed`, `skipped`, or `needs_attention`, plus timestamps and version. Transitions are server-validated and idempotent.

## Protection readiness

Expose descriptive state rather than a manipulative single score. Internally, a readiness indicator may weight app access, a completed practice check, an active trusted relationship, safe-word configuration, and acknowledged limitations. It must show its inputs and never imply that a household is scam-proof.

## Follow-up

Reminders are consented, frequency-capped, and suppressed during an active incident. HQ sees step state and `needs_attention`, not artifact content. The initial product uses automated guidance; a live Safety Setup is a founder decision after demand, training, liability, and unit economics are understood.

## Acceptance criteria

A new member can pause and resume, change earlier answers, revoke an invite, complete a practice check without contaminating real fraud metrics, and understand how to get help after a mistake.
