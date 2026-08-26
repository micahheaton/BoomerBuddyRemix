# Live deployment drift receipt

## Observation boundary

- Observed at 2026-08-26 14:47 UTC.
- Evidence came from anonymous, read-only HTTP requests to public BoomerBuddy 2.0 URLs.
- No sign-in, customer access, customer PII, secrets, provider writes, deployment changes, or cookie reuse occurred.
- Response cookies and request identifiers are intentionally omitted.
- The legacy `boomerbuddy.net` Replit application was not inspected or changed.

## Public live evidence

| Surface | Result | Observation |
| --- | --- | --- |
| `https://app.boomerbuddy.net/` | HTTP 200 | Customer web surface responds. |
| `https://app.boomerbuddy.net/pricing` | HTTP 200 | Page still says development access is free, describes a separate $119 founding Family research offer, and says billing is not implemented. |
| `https://app.boomerbuddy.net/sign-in` | HTTP 200 | Sign-in entry responds. |
| `https://app.boomerbuddy.net/sign-in/client-trust` | HTTP 404 | The deployed customer web application does not contain the current recovery route. |
| `https://app.boomerbuddy.net/api/v1/public/config` | HTTP 200 | Reports production environment with `liveProvidersEnabled: false` and the older Free, Plus, Family monthly, Family annual, and founding annual hypothesis set. |
| `https://api.boomerbuddy.net/v1/public/config` | HTTP 200 | Returns the same older provider-disabled pricing hypothesis set. |
| `https://api.boomerbuddy.net/health/live` | HTTP 200 | API liveness reports `ok`. |
| `https://api.boomerbuddy.net/health/ready` | HTTP 200 | API readiness reports `ready`. |
| `https://hq.boomerbuddy.net/` | HTTP 307 | Public request redirects to Replit ReplShield. |

## Repository comparison

The comparison baseline at the observation time was GitHub commit
`a1c5d885fface6c875fd2ad1f3d45e385d95f38a`. This historical receipt does not bind a later release
candidate; that candidate needs its own exact-SHA CI and deployment receipt.

- The current public contract exposes only the Family USD 14.99 monthly launch candidate. Annual and research offers are not production offers.
- The current public pricing experience has launch-safe copy rather than development-access and unimplemented-billing language.
- The current compiled production route verification resolves `/sign-in/client-trust`.
- GitHub Actions run `32979481597` passed verification, PostgreSQL, Edge browser, and container jobs for this exact commit.

## Conclusion

The live customer application and API did not match the comparison baseline. The observed member
sign-in failure and obsolete pricing language therefore cannot be treated as repaired in production
even though the repository contains relevant fixes. The exact current commit or artifact deployed to
each BoomerBuddy 2.0 service remains an external closure gate.

## Closure gate

After the exact external setup authorization phrase is received:

1. Record the currently deployed commit or immutable artifact for customer web, API, worker, and HQ without exposing secrets or PII.
2. From the external release receipt, verify the later final candidate's full commit SHA, planned
   annotated tag, and green exact-SHA CI, then have every BoomerBuddy 2.0 Replit consumer pull only
   that same receipt-bound candidate. This versioned document does not bind that future SHA or tag.
   Replit must never push.
3. Keep billing initiation and paid entitlement effectiveness disabled during the noncharging deployment validation.
4. Validate the live pricing page, public configuration, `/sign-in/client-trust`, customer Clerk sign-in recovery, API health, HQ access boundary, and worker presence.
5. Record sanitized evidence for every surface and the exact deployed provenance.
6. Do not touch the legacy `BoomerBuddy` Replit application or its Twilio and Stripe integration.

## Rollback

- Record every pre-deployment service artifact, deployment identifier, and full commit SHA before changing a BoomerBuddy 2.0 consumer.
- If validation fails, restore the exact prior artifact or commit for only the affected BoomerBuddy 2.0 service.
- Keep billing initiation disabled throughout rollback.
- Revalidate API health and the customer sign-in boundary after rollback.
- Never use the legacy Replit application as a rollback target for BoomerBuddy 2.0.
