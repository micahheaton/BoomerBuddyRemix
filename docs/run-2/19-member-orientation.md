# 19 — Member Orientation

Status: **a six-step protected-member web workflow is implemented and tested locally; real-user comprehension, lifecycle instrumentation, assisted orientation, and native-device proof remain external**.

## Working workflow

Orientation is an ordered state machine:

1. confirm the protected person;
2. explain the Trusted Circle boundary;
3. configure or knowingly defer a family safe word;
4. practice pausing and independently verifying a synthetic bank-link message;
5. understand capabilities and limits; and
6. review completion.

The member UI disables later steps until earlier steps are complete. The synthetic practice screen initially blocks completion, explains why opening the supplied link is unsafe, and enables completion only after the safer response is selected. The limits step states that local rules can be wrong, URLs are not fetched, live reputation is absent, and BoomerBuddy is not monitoring or emergency service.

The API persists `not_started`, `in_progress`, and `ready` with completed steps, safe-word disposition, attention state, version, and update time. Updates use row locking/optimistic versioning, retry idempotency, audit, and outbox events. A configured phrase becomes a salted, peppered `scrypt` verifier; plaintext is not stored. Deferral is explicit and deletes any existing verifier.

Evidence: [domain state machine](../../packages/domain/src/orientation.ts), [repository](../../packages/persistence/src/orientation.ts), [web workflow](../../apps/web/src/app/member/orientation/page.tsx), [integration test](../../tests/integration/orientation-hq.test.ts), and [browser journey](../../tests/e2e/orientation-family.spec.ts).

## Authority boundary

A protected member needs an effective protected-person enrollment to start or change their orientation. Household administration or payment alone does not grant access. The read/update authorization model supports an exact `help_with_orientation` Trusted Circle permission, but Run 2 invitation creation exposes only `view_shared_checks`; therefore assisted orientation is deliberately unavailable through the current product. A test confirms the existing Trusted Circle fixture cannot read another member’s orientation.

## Evidence limitations

The safer practice answer is enforced by the current web UI, not carried as a server-verified response artifact; the generic authenticated step endpoint can record completion. This is product-flow evidence, not an assessment or safety certification. No older adult, caregiver pair, screen-reader participant, or orientation specialist completed a moderated session. Time-to-complete, abandonment, difficult step, activation correlation, and subsequent safe action are not instrumented.

The first step confirms product scope; it does not verify identity. The current sequence also has no notification setup, account-recovery path, end-to-end Check walkthrough, or invitation-delivery exercise. Sharing education is limited to Trusted Circle consent copy, and the page explicitly says invitations send no notification in this build. These are missing requirements, not implied by an orientation `ready` state.

Mobile shares the API architecture, but no iOS/Android real-device orientation, notification, deep-link, offline, or assistive-technology run passed. The safe word is an optional family verification aid, not identity authentication, account recovery, or a guarantee against impersonation.

Run 3 should conduct consented moderated studies, instrument content-free step timing/abandonment, server-bind the practice response if it becomes decision-bearing, review language with fraud/accessibility/privacy professionals, and test the supported device matrix. Assisted orientation should be enabled only with explicit pairwise consent, a scoped staff workflow, truthful service hours, and measured economics.
