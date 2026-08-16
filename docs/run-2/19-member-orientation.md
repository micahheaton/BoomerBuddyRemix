# 19 — Member Orientation

Status: **a six-step protected-member workflow and content-free progress/stall/first-Check projections are implemented locally; comprehension, assisted use, external delivery, and native-device proof remain blocked**.

## Working workflow

Orientation is an ordered state machine:

1. confirm the protected person;
2. explain the Trusted Circle boundary;
3. configure or knowingly defer a family safe word;
4. practice pausing and independently verifying a synthetic bank-link message;
5. understand capabilities and limits; and
6. review completion.

The member UI gates later steps and initially blocks the unsafe practice response. Limits state that local rules can be wrong, URLs are not fetched, live reputation is absent, and BoomerBuddy is not monitoring or an emergency service.

The API persists state, completed steps, safe-word disposition, attention, version, audit, and outbox facts. A configured phrase becomes a salted, peppered `scrypt` verifier; plaintext is not stored. Deferral deletes any prior verifier. The growth runtime consumes content-free orientation events to project start, latest step, completion, attention/stall, and first Check after start or completion. Durable jobs can create lifecycle help work and an approved local-test notification request. These are local measurements, not user comprehension or external delivery.

Evidence: [domain state machine](../../packages/domain/src/orientation.ts), [orientation repository](../../packages/persistence/src/orientation.ts), [growth projector](../../packages/persistence/src/growth-runtime.ts), and [web workflow](../../apps/web/src/app/member/orientation/page.tsx).

## Authority boundary

A protected member needs an effective protected-person enrollment to start or change orientation. Household administration or payment alone does not grant access. Although authorization supports an exact `help_with_orientation` Trusted Circle permission, the current invitation product does not issue it; assisted orientation is therefore unavailable. Growth projection and notification planning grant no new access.

## Evidence limitations

The safer practice answer is enforced by the current web UI, not a server-verified assessment artifact. No older adult, caregiver pair, screen-reader participant, or orientation specialist has completed a moderated session. No production baseline exists for completion time, abandonment, hard steps, activation correlation, or later safe action; local timestamps and correlations merely make those questions measurable.

The workflow does not verify identity, provide account recovery, prove an end-to-end external notification, or deliver Family invitations. Mobile shares the API architecture, but no supported iOS/Android device, deep link, offline path, notification, or assistive-technology run has passed. The safe word is an optional family verification aid, not authentication, recovery, or a guarantee against impersonation.

Run 3 should execute the consented [Human Research Protocol](./HUMAN-RESEARCH-PROTOCOL.md), review language with fraud/accessibility/privacy professionals, and test supported devices. Assisted orientation requires explicit pairwise consent, scoped staff access, truthful coverage, and measured economics. Run 2 does not launch.
