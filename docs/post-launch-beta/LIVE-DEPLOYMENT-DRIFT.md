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

## Authenticated read-only follow-up

- Observed at 2026-08-27 05:21 UTC through authenticated, read-only Clerk and Replit dashboard views plus anonymous public HTTP checks.
- No provider setting, secret, source file, branch, deployment, database, customer, payment, or production state was changed.
- No customer identity, customer PII, token, cookie, request identifier, database connection string, or secret value is recorded here.
- The separate legacy `BoomerBuddy` Replit project was visible in the project list but was not opened, inspected, or changed.

### GitHub candidate under comparison

The implementation candidate at the start of this follow-up was GitHub commit
`452ec33ea585ed8fc074c1ffc4b4d8a8f6511407` on `codex/production-beta-launch`. Exact-SHA
GitHub Actions run `33039698920` completed successfully across verify, containers, PostgreSQL, Edge,
and accessibility jobs. At observation start, the worktree was clean and synchronized with the
branch remote. No reviewed receipt proves that implementation candidate was merged, tagged, or
deployed: web, API, and worker evidence contradicts its deployment, while the exact HQ release commit
remains unresolved. If committed, this documentation-only follow-up creates a later commit and does
not claim to bind the final release candidate.

### Replit deployment-consumer evidence

| Service | Read-only evidence | Disposition |
| --- | --- | --- |
| Customer web | Replit Git shows local checkpoint `e75682dc61140af8a0d06162435a6593c5930981` with parent `9b5d585e89e4a691a113b9cd4264c1edbb3cdfdf`. Its only checkpoint diff is `.replit`, adding `NEXT_PUBLIC_CLERK_SIGN_IN_URL = "/sign-in"`; the product tree still has only the fixed `/sign-in/page.tsx` route. The newest successful build shown is `d6674986-708d-4eee-a9dd-9f48e94707d2`. | The checkpoint is a Replit-local child of the old canonical release and is not a GitHub source release. Live callback and recovery paths remain 404. Preserve the `.replit` difference as evidence, reconcile its intent through the approved release configuration, and never push it to GitHub from Replit. |
| API | Replit Git shows local checkpoint `795b02b` with parent `9b5d585e89e4a691a113b9cd4264c1edbb3cdfdf` and zero changed files. The last recorded successful build is `d622d36a-2797-4ba4-bab6-164b7eb1aa16`. | The observed editor checkout is based on the old release tree. The build-to-commit binding is not independently exposed, but live public config proves the deployed API predates the candidate and commit `75cda80`. |
| Worker | The successful publish records build `1c114aad-e804-4904-805e-e6a654b21a63`, deployment `665da59e-dcf3-42fe-9569-1654ab0a6a8e`, release commit `9b5d585e89e4a691a113b9cd4264c1edbb3cdfdf`, and annotated tag `run3-1-replit-founding-household-9b5d585e89e4`. The later editor checkout is local checkpoint `ca98ba969aaeea68d24f48bab195ff5c1bd71290`, while the release tag still peels to `9b5d585...`; `.replit` is reported dirty. Runtime logs show the worker started and completed a job, but no heartbeat timestamp was available and the Replit Production database view reported no provisioned database. | The published worker is bound to the old release. Preserve the dirty checkout evidence, identify the real external database and current heartbeat without exposing its connection string, then restore a clean exact-candidate checkout only through an approved pull. |
| HQ | The newest successful private build shown is `fe8e3f18-17a6-4fcd-ac4d-bf3679f6dc00`. ReplShield returns 307 to unauthenticated external traffic. Build provenance and the isolated HQ production build passed, but the dashboard receipt does not expose an independently verifiable release commit. The Git view displays a local `.replit` difference adding the sign-in URL. | Keep HQ private. Treat the exact deployed commit as unresolved until a clean checkout, tag, tree, build, and deployment receipt agree. Preserve and reconcile the local `.replit` difference before any pull. |

Web, API, and worker evidence proves that those services are not currently consuming the GitHub
candidate. The exact HQ release commit remains unresolved. The evidence also shows why a blind pull
is unsafe: Replit-local checkpoint and `.replit` state must first be captured, classified, and either
represented by canonical GitHub source or by explicit deployment configuration. Replit remains
pull-only and must never push these local checkpoints to GitHub.

### Clerk production facts

- The Customer Clerk instance is production and invite-only. Its root custom domain, Frontend API,
  Account Portal, email DNS, and certificates report verified.
- The Account Portal is active at `accounts.boomerbuddy.net`. Home URL, unauthorized-sign-in URL,
  Account Portal sign-in/sign-up fallbacks, and logo-click fallback are blank.
- Google sign-in is enabled. A custom Google client secret rendered as readable text in the
  authenticated dashboard and inspection output; the value is intentionally omitted and must be
  treated as compromised, rotated in Google Cloud, replaced in Clerk, and revoked before another
  production Google sign-in test.
- Authenticator-app MFA, backup codes, and required MFA are disabled. Email verification, email code,
  and Device Trust are not proof of true MFA.
- Express legal consent is disabled and Clerk Terms of Service and Privacy Policy URLs are blank.
  The Clerk application support email is blank.
- Allowed-subdomain restriction is disabled. No Customer satellite domains are configured.
- Clerk Native API is enabled, but there are zero iOS application records, zero Android application
  records, and zero native SSO redirect allowlist entries.

No Clerk configuration was changed. These provider facts must be closed in a staged noncharging
configuration session with pre-change receipts and rollback, after the exact external setup phrase.

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
