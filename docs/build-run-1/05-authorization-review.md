# Authorization Review

Review date: 2026-08-16

Disposition: **the implemented customer/mobile/HQ policy is suitable for the local Run 1 slice; production identity and operational authorization remain deferred**.

## Model

The client never supplies a trusted actor, role, payer, protected status, entitlement, or employee scope. A credential supplies only signed session claims; every request resolves current identity status, database session, household memberships, employee assignments, effective commerce portfolio, and capabilities. Customer/HQ cookies and mobile bearers have different audiences. The optional `X-BB-Household-Id` header can select only an active household already present in the resolved principal; multi-household actors must select one.

`packages/authorization` is deny-by-default over a closed action union and typed resources. Unknown action/resource pairs are rejected even for an HQ owner. Routes then pass exact tenant/actor/resource predicates to repositories; database composite foreign keys reject cross-tenant attachment. There is no global paid-user or admin boolean.

## Effective protected-person authority

Protected authority is **not inferred from `household_owner` or `protected_member` role**. A principal's `isProtectedMember` projection requires all of:

1. active household membership;
2. accepted self-consent in `protected_members`;
3. an exact active `protected_members` allowance allocation for that person and household; and
4. a backing grant that contributes to the household's effective commerce portfolio at request time.

The schema validates exact allowance linkage and prevents release before enrollment revocation. Self-enrollment/revocation repository transactions lock state, enforce self-consent and plan limits, and preserve withdrawal ordering. Seeded Alice proves an owner may independently be protected; seeded Bob proves owner role alone cannot create a Check, self-orient, or invite. A legacy role with no effective enrollment fails closed. The missing general enrollment endpoint/UI is explicitly **deferred**, not treated as implemented onboarding.

## Policy by resource

| Resource/action | Allowed scope                                                                                                                                                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Check create    | Customer/mobile actor, selected active household, effective protected enrollment, and exact `check:text` or `check:url` capability. Repository rechecks enrollment under lock.                                                                                                                                                      |
| Check list/read | Owned history only while protected enrollment is effective; a Trusted Circle actor sees only individually shared Checks when `view_shared_checks`, active pairwise relationship, active consent, and active memberships all match. No household-wide history mode exists.                                                           |
| Check delete    | Exact owner only. Deletion remains available after entitlement/enrollment lapse so safety/privacy withdrawal is not paywalled.                                                                                                                                                                                                      |
| Check share     | Exact owner with current protected enrollment, active consented pairwise relationship, and `view_shared_checks`; the share is bound to that protected-owner/trusted-person pair. Revocation deletes it.                                                                                                                             |
| Family view     | Owner receives the household roster and pending invitation records; non-owner views are self/pairwise. A trusted person cannot enumerate unrelated protected people.                                                                                                                                                                |
| Invite          | Only the independently enrolled protected subject may invite for self, with `family:manage`. Run 1 contracts allow exactly `view_shared_checks`; `receive_escalations` and `help_with_orientation` cannot be newly invited.                                                                                                         |
| Preview/accept  | Any authenticated customer/mobile actor presenting the correct invitation ID and local code may preview household, protected person, permission, and expiry. Acceptance revalidates code, active consent/enrollment, preview version, expiry, pair conflict, and allowance in one locked transaction; the credential is single-use. |
| Cancel/revoke   | The exact protected subject or household owner can cancel a pending invitation. Either exact relationship participant or owner can revoke a relationship, even after entitlement/enrollment lapse. Unrelated actors are denied; revocation removes consent/shares and releases a participant seat only when no active pair remains. |
| Orientation     | An effectively enrolled person can view/update self. A Trusted Circle helper requires an exact active pair and `help_with_orientation`; Run 1 invitation contracts do not grant that permission, so the helper path is architecture-only.                                                                                           |
| Entitlements    | Selected household owner only. Provider lifecycle never grants artifact visibility or relationship permission by itself.                                                                                                                                                                                                            |
| HQ              | HQ audience only. `hq_owner` can access current HQ routes; `hq_reviewer` can access only the review projection; `hq_support` policy permits review/household projections but has no seeded persona or complete workflow. Customer roles confer nothing in HQ.                                                                       |

## Evidence

Authorization unit tests cover missing principal, wrong audience, unknown action, cross-tenant scope, missing capability, independent enrollment, owner-without-enrollment, role-only failure, actor-scoped history, explicit sharing, self-only invitation, pre-membership credential acceptance, exact cancellation/revocation, post-lapse withdrawal, per-household capability separation, and HQ role limits.

Integration/security tests additionally prove:

- actor-owned/explicit-share-only Check lists and true pagination beyond 50 records;
- direct-ID isolation and no cross-household read/delete/invite/share;
- enrollment loss removes owned workflow authority but preserves delete-own and explicit received shares;
- preview/cancel/accept expiry, stale preview, no credential leakage, and exact participant seat reuse;
- one Trusted Circle membership can support separately consented protected-person pairs without double-counting;
- customer and HQ sessions can coexist without audience confusion; and
- revocation and one-shot restart do not restore authority.

Fresh runs passed 99 unit, 18 integration, and 16 security tests.

## Residual limitations

- Development personas are allow-listed fixtures, not production authentication; there is no MFA/step-up, recovery, device trust, or production session administration.
- Local invitations are bearer credentials and are not pre-addressed to a verified identity. Production delivery, recipient binding, abuse/rate controls, and recovery are required.
- Denials return safe 403/404 envelopes but are not all persisted as authorization-denial audit events.
- Authorization is application/repository enforced; PostgreSQL RLS is not enabled. Real-PostgreSQL and multi-instance concurrency verification remains outstanding.
- HQ resources currently use the internal seeded organization and coarse projections; production support cases, time-bound restricted grants, reason capture, step-up, and organization-specific operating scopes are not implemented.
- Protected enrollment persistence is implemented, but exposing it safely requires a separately reviewed consent/onboarding API and UX.

The controlling design is [ADR-0003](../adr/0003-managed-identity-and-resource-authorization.md); commerce separation is defined by [ADR-0008](../adr/0008-provider-neutral-entitlements.md).
