# BoomerBuddy — Founder Provisioning Status

**Purpose:** Human-maintained, secret-free status handoff for Run 3.  
**Rule:** Never paste passwords, recovery codes, API secrets, signing keys, full card/bank details, or private credentials into this file.

Update `Status`, IDs that are safe to record, and notes as the founder completes accounts.

| Provider / asset | Purpose | Status | Safe identifiers / notes | Next founder action |
|---|---|---|---|---|
| Replit | Development + initial hosting candidate | `existing_account` | Existing BoomerBuddy workflow | Keep account secured; Run 3 will produce launch/deploy checklist |
| Canonical Git remote | Source of truth outside Replit | `unknown` |  | Create/confirm company-controlled private repo, MFA/recovery |
| boomerbuddy.net DNS | Domain custody | `existing_domain` | `boomerbuddy.net` | Confirm founder-controlled DNS provider and recovery |
| Stripe | Web billing/payment truth | `founder_ready` | Account activated per founder | Keep live mode disabled for Run 3; provide test-mode config through secret manager/env only |
| Stripe Tax | Tax calculation/monitoring | `needs_review` |  | Confirm test-mode configuration/registrations only after tax review |
| Twilio | Voice/SMS/customer messaging | `founder_in_progress` | Toll-free number being provisioned/verified | Finish toll-free verification; do not paste auth token here |
| feedback@boomerbuddy.net | Feedback intake | `needs_setup` | Desired alias | Create alias/mailbox/inbound route; Run 3 will define normalized intake adapter |
| support@boomerbuddy.net | Customer support identity | `existing_or_in_progress` |  | Confirm mailbox/routing and accountable owner |
| Managed PostgreSQL | Customer/application truth | `not_started_or_unknown` |  | Run 3 to recommend shortest portable path and exact setup |
| Object storage | Feedback screenshots/audio/media | `not_started` |  | Run 3 to select/configure private S3-compatible storage |
| Managed identity | Customer/HQ authentication | `not_started_or_unknown` |  | Run 3 to produce exact provider setup and audience separation |
| KMS / secret manager | Production key custody | `not_started` |  | Run 3 must keep production fail-closed until real |
| Sentry | Error/incident telemetry | `not_started_or_unknown` |  | Create company account when Run 3 requests it |
| PostHog | Product analytics/flags | `not_started_or_unknown` |  | Create/configure privacy-minimized project when requested |
| Transactional email | Account/support/lifecycle mail | `not_started_or_unknown` |  | Select/provision approved provider; keep marketing separate |
| Apple Developer | iOS distribution/signing | `founder_in_progress` |  | Continue organization/account setup; web-first launch must not wait on it |
| Google Play Console | Android distribution | `founder_in_progress` |  | Continue organization/account setup; web-first launch must not wait on it |
| Expo/EAS | Native builds | `unknown` |  | Provision only as needed after Apple/Google path is ready |
| Cloudflare or DNS/WAF provider | DNS + edge protection | `unknown` |  | Confirm/create founder-controlled account |
| Apollo/enrichment | B2B enrichment | `disabled_for_real_use` | Fixtures only in Run 2 | No real outreach/enrichment without separate approval |
| Dependency/security inventory | Current advisory, SBOM, license, provenance, and image evidence | `blocked` | Fresh registry audit was not authorized in the current execution environment; local offline/cache evidence is not fresh | Run the documented audit/SBOM gate in company-controlled CI and retain a redacted adjudication; do not paste registry credentials or private reports into prompts/source |
| Accounting/bookkeeping | Financial system of record | `outside_repo` |  | Keep external; do not rebuild in HQ |
| Legal/privacy review | Terms/privacy/marketing/SMS | `pending_professional` |  | Run 3 should prepare review packet; founder retains qualified reviewer |

## Founder decisions Run 3 may ask for

Record decisions here only when made:

- Initial launch geography:
- Founding Household cohort size:
- Founding Household free period/benefit:
- Web pricing candidate:
- Annual pricing candidate:
- Referral-credit experiment candidates:
- Support hours stated publicly:
- Maximum Run 3 external test budget:
- Maximum automated daily spend after Stage 0 budget fix:
- First-customer activation owner:
- Incident/support backup:
- Final working brand decision:
- Web-first vs native launch sequence:

## Secret handling

When Codex asks for a provider secret:

1. use the provider/Replit/GitHub/OS secret manager or environment-variable mechanism;
2. use the exact environment-variable name documented by Run 3;
3. never paste the value into git-tracked files;
4. never commit `.env` with live values;
5. rotate any secret that accidentally appears in logs, screenshots, prompts, fixtures, or source.
