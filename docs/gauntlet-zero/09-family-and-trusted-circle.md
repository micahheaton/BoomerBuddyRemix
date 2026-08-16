# Family and Trusted Circle

## Value proposition

Family value is not “more scans.” It is a consented protection network that reduces the delay between a suspicious request and help from the right person. The Family SKU earns its price through multi-person activation, escalation, shared incident context, orientation, and continuity—not passive monitoring.

## Relationship model

- A `Household` has an owner but does not confer blanket access.
- A `ProtectedMember` explicitly accepts or revokes protection.
- A `TrustedCircleRelationship` joins two people with purpose-scoped permissions such as `receive_escalation`, `view_shared_result`, or `help_with_incident`.
- An invitation is expiring, single-use, auditable, and cannot grant rights beyond the inviter’s own authority.
- Consent records capture subject, scope, version, actor, time, source, and revocation.

Raw artifacts are private by default. Escalation shares a redacted result and recommended action unless the protected person explicitly shares more. Household owners cannot silently browse submissions. Employees receive no default artifact access.

## Family Safe Word

Use a memorable multi-word phrase that family members exchange outside a crisis. BoomerBuddy should store only a salted, memory-hard verifier; it cannot reveal the phrase. Verification is rate-limited and audited. Recovery replaces the phrase rather than retrieving it, and suspected disclosure invalidates it. Explain that this is a social verification aid—not identity proof, voice authentication, or cryptographic proof.

## Abuse cases and controls

Threats include coercive invitations, compromised family accounts, stalking, oversharing, brute-force safe-word checks, and malicious caregivers. Controls include explicit acceptance, granular permissions, session/MFA step-up for sensitive changes, notifications to the protected person, revocation, immutable security audit events, rate limits, and a visible “who can see what” screen.

## Success metrics

Measure invitation acceptance, protected-member activation, practice completion, safe escalation response time, revocation/support rates, and permission-related complaints. Do not count raw invitations as network value.
