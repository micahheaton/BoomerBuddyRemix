# Run 3.1 Replit environment manifest

This is the exact configuration contract for the one-household candidate. Values shown are formats,
never credentials. Each published project receives only its service rows. Replit project-editor
Secrets and Published app secrets must be checked separately. Production startup intentionally fails
closed when required values are missing, malformed, shared across identity realms, or unsafe.

Service abbreviations: **W** customer web, **A** API, **K** worker, **H** HQ, **M** controlled
migration/bootstrap shell, **T** disposable provider-test PostgreSQL verification shell, **B**
trusted founder backup/restore machine.

## Release and Replit process boundary

| Variable                   | Purpose                                  | Secret? | Source / example                           | Services  | Requirement, default, and failure behavior                                                                                      |
| -------------------------- | ---------------------------------------- | ------- | ------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                 | Select production guards and compiled UI | No      | founder: `production`                      | W/A/K/H/M | Required exactly `production`; any other value makes `replit-service` refuse build/start.                                       |
| `BB_REPLIT_SERVICE`        | Select one workspace                     | No      | founder: `web`, `api`, `worker`, or `hq`   | W/A/K/H   | Required and unique per project; missing/other value refuses build/start.                                                       |
| `BB_RUN3_1_RELEASE_COMMIT` | Bind runtime to candidate                | No      | dossier: 40 lowercase hex                  | W/A/K/H   | Required; must equal both the configured annotated tag's dereferenced commit and the published checkout HEAD. A different snapshot commit is rejected even when its tree is identical. |
| `BB_RUN3_1_RELEASE_TAG`    | Bind runtime to immutable tag            | No      | `run3-1-replit-founding-household-<12hex>` | W/A/K/H   | Required; the ref itself must be an annotated tag object, and its suffix must equal the candidate commit's first 12 characters. |
| `REPLIT_DEPLOYMENT`        | Prove a published runtime                | No      | Replit automatic: `1`                      | W/A/K/H   | Required at start and must be `1`; never set manually in local evidence.                                                        |
| `PORT`                     | Provider-selected listener port          | No      | Replit automatic integer                   | W/A/K/H   | Required for web-facing services. Next consumes it directly; the wrapper derives the API child's `BB_API_PORT`. The worker uses it only for a static private liveness listener and falls back to `3000` when Replit omits it. |

Every Replit provenance check additionally requires all of the following:

- `git cat-file -t refs/tags/<tag>` returns exactly `tag`; a lightweight tag is not accepted.
- `git rev-parse refs/tags/<tag>^{commit}` equals `BB_RUN3_1_RELEASE_COMMIT`.
- `git rev-parse HEAD` equals `BB_RUN3_1_RELEASE_COMMIT`.
- `git rev-parse HEAD^{tree}` equals `git rev-parse refs/tags/<tag>^{tree}` exactly.
- `git status --porcelain=v1 --untracked-files=all` emits no entries before the service build.
  Staged, unstaged, and nonignored untracked content all fail closed.

Each of `boomerbuddy-web`, `boomerbuddy-api`, `boomerbuddy-worker`, and `boomerbuddy-hq` must use a
different credential scoped only to `micahheaton/BoomerBuddyRemix`. Prefer a unique deploy key with
**Allow write access** unchecked. A repository-scoped GitHub App installation or fine-grained token
is acceptable only when its retained permission export shows `Contents: Read-only`,
`Metadata: Read-only`, and no repository, organization, or user write permission. The matching
credential must fetch the exact annotated tag successfully and this dry-run must exit nonzero:

```text
git push --dry-run origin HEAD:refs/heads/bb-denied-write-proof-<receipt-id>
```

Exit zero is a hard stop. Never run the proof without `--dry-run`, never test a force, delete, branch,
or tag write, and never embed the credential in the remote URL. Record only a safe credential ID or
fingerprint, type, repository scope, permission export, expiry or rotation date, successful tag
fetch, nonzero denial classification, and recovery owner. Store each private value only in its
matching Replit protected credential store. No project may share a credential or retain a
write-capable Replit GitHub connection.

The published Replit build context must preserve the reviewed commit as its exact checkout HEAD.
A different provider-generated snapshot commit is rejected even when its tree matches the tag. The
configured annotated tag must dereference to that same commit, the trees must be identical, and the
full porcelain status must be empty. For
API, web, and HQ Autoscale builds only, the wrapper recognizes Replit's exact reviewed
`deploymentTarget = "cloudrun"` append by requiring the sole raw status record, canonical and
rewritten blob hashes, and unchanged mode. It restores the canonical indexed `.replit`, reruns the
same status command, and proceeds only after the result is empty. The Reserved VM worker never
receives this normalization. Any other byte, target, path, status, or mode fails closed; this does not
permit a moved or lightweight tag, a different HEAD or tagged commit, a changed tree, or arbitrary dirty
content. On dirty-status failure, the wrapper may print only bounded index/worktree status and escaped
filenames (at most 50 paths and 256 bytes per rendered path); it never prints file contents.

For web and HQ only, npm may report the lockfile-pinned optional Sharp WASM artifacts
`@img/sharp-wasm32@0.35.3` and `@emnapi/runtime@1.11.3` as extraneous after the
production-only workspace install. The runtime inventory accepts only that exact pair when the
literal root `node_modules` paths, resolved registry URLs, complete per-package problem and dependency
nodes, and the tagged lockfile's version-3 package paths, optional flags, integrity hashes, and
dependency ranges all match. API, worker, malformed or nested problems, a partial, duplicate, or
additional set, or any altered inventory or lock metadata remains a hard failure.

## Customer web and HQ proxy boundary

| Variable                            | Purpose                                                    | Secret? | Source / example                                              | Services                 | Requirement, default, and failure behavior                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------- | ------- | ------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BB_PUBLIC_ORIGIN`                  | Exact browser-visible origin and mutation-origin authority | No      | published app URL, e.g. `https://customer.example.replit.app` | W or H, different values | Required public HTTPS origin with no path/query/credentials/wildcard. Build and start normalize only safe equivalents such as a root slash, host casing, IDN spelling, and the default port, then pass that one canonical origin to Clerk and the API proxy. Missing/unsafe returns no-store 503 or stops before spawn; an incoming authority mismatch returns no-store 421 before Clerk. |
| `BB_API_INTERNAL_ORIGIN`            | Exact upstream API origin for server proxy                 | No      | API published URL, e.g. `https://api.example.replit.app`      | W/H                      | Required HTTPS origin with no path/query/credentials. Missing/invalid returns private no-store 503.                                                            |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Select the correct browser Clerk application               | No      | customer or HQ `pk_live_...`                                  | W/H                      | Required in production; customer and HQ values come from separate Clerk apps. At build, the reviewed Next config aliases Replit-managed `CLERK_PUBLISHABLE_KEY` when this name is absent. |
| `CLERK_SECRET_KEY`                  | Clerk Next.js server/middleware credential                 | Yes     | matching Clerk production application                         | W/H                      | Required only in the matching project. Missing makes every matched production request return no-store 503. Never prefix with `NEXT_PUBLIC_`.                   |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`     | Pin Clerk server and browser redirects to the local route  | No      | exactly `/sign-in`                                            | W/H                      | Required exactly as shown. Missing or any other value makes every matched production request return no-store 503 instead of falling back to the hosted Account Portal. |
| `BB_CUSTOMER_CLERK_SELF_DELETION_DISABLED_CONFIRMED` | Gate the embedded Customer Clerk security profile | No | exactly `false` until provider proof, then `true` | W only | While false or absent, `/member/account-security` refuses to mount the broader Clerk profile. Set true only after the Customer Clerk instance proves direct self-deletion disabled; omit from API, worker, HQ, and mobile. |
| `NEXT_PUBLIC_API_URL`               | Legacy local direct API target                             | No      | not set                                                       | none in production       | Production client uses same-origin `/api`; omit.                                                                                                               |
| `EXPO_PUBLIC_API_URL`               | Mobile direct API target                                   | No      | not set                                                       | none                     | Mobile is outside Run 3.1 deployment.                                                                                                                          |

The web and HQ proxies require the raw Host and the complete Next-derived
`X-Forwarded-Host/Port/Proto` authority tuple to resolve to the same canonical `BB_PUBLIC_ORIGIN`.
They reject partial or crossed authority tuples and any raw `Forwarded` header before Clerk without
constructing a redirect from untrusted request metadata. They then pass the exact configured
`/sign-in` path and canonical public origin into Clerk's server middleware and forward only the exact
`__session` cookie plus a small header allowlist. They discard legacy BoomerBuddy session cookies and
Authorization. The API independently verifies issuer, authorized party, signature, time, subject,
provider session, and state. Customer tokens may omit `aud` only under ADR 0030; an explicit customer
`aud` must match. HQ always requires its exact audience and bounded factor age.

The matching Customer Clerk production instance uses this exact application-path contract:

- Application Home URL: `https://app.boomerbuddy.net/member`.
- Unauthorized sign-in URL: `https://app.boomerbuddy.net/unauthorized-sign-in`.
- Self-hosted sign-in component URL: `https://app.boomerbuddy.net/sign-in`, backed by the Next
  catch-all route `/sign-in/[[...sign-in]]` and `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`.
- Account Portal fallback after customer sign-in: `https://app.boomerbuddy.net/member`.
- Direct Clerk self-deletion: disabled. Keep
  `BB_CUSTOMER_CLERK_SELF_DELETION_DISABLED_CONFIRMED=false` until this exact provider setting and
  the BoomerBuddy account-deletion workflow are proved together; then set it true on customer web
  only and re-run the authenticated account-security route test.

Keep the existing root-domain Clerk infrastructure, including `accounts.boomerbuddy.net` and the
reviewed Clerk Frontend API or OAuth callback domain. These hosts are identity-provider
infrastructure, not the separate legacy `BoomerBuddy` Replit project. Do not point any Customer
application path or fallback at legacy `boomerbuddy.net`. Record provider screenshots without user
records, email addresses, session identifiers, keys, or other PII. A local build proves only route
generation; it does not prove Clerk configuration or a hydrated sign-in flow.

The separate HQ Clerk production instance uses this different exact application-path contract:

- Application Home URL: `https://hq.boomerbuddy.net/`.
- Unauthorized sign-in URL: `https://hq.boomerbuddy.net/sign-in`.
- Self-hosted sign-in component URL: `https://hq.boomerbuddy.net/sign-in`, backed by the Next
  catch-all route `/sign-in/[[...sign-in]]` and `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`.
- Account Portal fallback after HQ sign-in: `https://hq.boomerbuddy.net/`.

The HQ application uses only audience `boomerbuddy-hq`, authorized party
`https://hq.boomerbuddy.net`, and its own issuer, publishable key, secret key, PEM key, cookie realm,
origin, account population, MFA, and recovery boundary. Keep the HQ root and every operator route
private. Do not point an HQ field at Customer Clerk infrastructure, `accounts.boomerbuddy.net`, or
legacy `boomerbuddy.net`. Record Customer and HQ before/after values and deployed synthetic outcomes
in separate evidence blocks. A Customer success cannot close an HQ field, and an HQ success cannot
close a Customer field. Stop on a sign-in loop, callback 404, wrong issuer/audience/authorized party,
realm crossover, missing recent second factor, or unexpected account access.

The only incoming-authority exception is the observed direct Replit Autoscale GET/HEAD homepage
probe. It requires `REPLIT_DEPLOYMENT=1`, the canonical automatic listener `PORT`, an
exact canonical mapped `127.0.0.1:<port>` raw Host and the Next-normalized listener URL, no query,
either the complete exact Next-derived loopback `X-Forwarded-For/Host/Port/Proto` tuple or complete
absence of all four headers, and no raw `Forwarded` header. Mixed forwarding shapes fail closed. The
exception runs only after the matching Clerk publishable and secret keys are present. The response is
fixed content-free, no-store text with restrictive browser headers on both web and HQ. External HQ
`/`, every HQ operator route, and all HQ `/api` paths remain behind the separate HQ Clerk middleware;
near-match probes fail closed on both applications.

## API and worker application configuration

| Variable                                    | Purpose                                                             | Secret?                              | Source / example                                      | Services                      | Requirement, default, and failure behavior                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BB_API_HOST`                               | API bind address                                                    | No                                   | founder: `0.0.0.0`                                    | A                             | Required by Replit start wrapper exactly `0.0.0.0`; localhost binding is refused. Worker may omit.                                                     |
| `BB_API_PORT`                               | API internal port                                                   | No                                   | derived automatically from provider `PORT` by wrapper | A                             | Do not configure separately. The wrapper supplies it to the API child; an explicitly configured mismatch refuses before startup.                       |
| `BB_TRUSTED_PROXY_HOPS`                     | Fastify proxy trust count                                           | No                                   | founder: `0`                                          | A/K/M                         | Production requires exactly `0` until deployed spoof-resistance evidence establishes another value; any nonzero value refuses config.                  |
| `BB_DATABASE_DRIVER`                        | Customer truth database                                             | No                                   | founder: `postgres`                                   | A/K/M                         | Production requires `postgres`; PGlite refuses startup.                                                                                                |
| `DATABASE_URL`                              | PostgreSQL connection                                               | Yes                                  | Replit DB; `postgresql://.../db?sslmode=verify-full`  | A/K/M; B uses separate target | Required, PostgreSQL scheme, one database, and exactly one `sslmode=require`, `verify-ca`, or `verify-full`. Use pooled runtime URLs for A/K and the direct migration URL for M; missing or downgrade modes refuse config. |
| `BB_POSTGRES_POOL_MAX`                      | Per-process PostgreSQL connection cap                               | No                                   | A: `2`; K: `1`; M: `1`                               | A/K/M                         | Required explicitly in production; integer 1-10. Development/test default 10 when omitted. The initial 0.25-CU beta must use the listed caps so pressure queues in Node instead of consuming PostgreSQL backend memory. |
| `BB_RUN_MIGRATIONS`                         | Runtime migration switch                                            | No                                   | founder: `false`                                      | A/K/M                         | Production requires `false`; API/worker startup refuses `true`. The controlled `db:migrate` command still explicitly runs migrations.                  |
| `BB_SEED_DEMO`                              | Demo seed switch                                                    | No                                   | founder: `false`                                      | A/K/M                         | Production requires `false`; `true` refuses config.                                                                                                    |
| `BB_ALLOW_DEV_IDENTITY`                     | Development issuer switch                                           | No                                   | founder: `false`                                      | A/K/M                         | Production requires `false`; `true` refuses config.                                                                                                    |
| `BB_FOUNDER_PERSON_ID`                      | Exact internal founder binding                                      | No, identifier                       | founder-chosen stable ID, e.g. `person-founder-micah` | A/K/M                         | Required and bounded. Startup joins it to the immutable founder bootstrap; mismatch refuses API/worker.                                                |
| `BB_FOUNDER_CLERK_SUBJECT`                  | Exact HQ Clerk founder subject                                      | No, sensitive identifier             | Clerk HQ `user_...`                                   | A/K/M                         | Required; must match immutable founder bootstrap and configured HQ issuer.                                                                             |
| `BB_CUSTOMER_ORIGINS`                       | Authorized customer `azp` and HTTP Origin                           | No                                   | exact W HTTPS origin; comma list only if reviewed     | A/K/M                         | Required. Origins cannot overlap HQ and cannot contain paths/query/credentials; non-HTTPS refuses production.                                          |
| `BB_HQ_ORIGINS`                             | Authorized HQ `azp` and HTTP Origin                                 | No                                   | exact H HTTPS origin                                  | A/K/M                         | Required, disjoint from customer, HTTPS only.                                                                                                          |
| `BB_CLERK_CUSTOMER_ISSUER`                  | Exact customer token issuer                                         | No                                   | customer Clerk Frontend API HTTPS origin              | A/K/M                         | Required. Must differ from HQ issuer and contain no path/query/credentials.                                                                            |
| `BB_CLERK_CUSTOMER_AUDIENCE`                | Customer realm audience binding                                     | No                                   | `boomerbuddy-customer`                                | A/K/M                         | Required, whitespace-free, distinct from HQ. An explicit token `aud` must match; provider-default customer tokens may omit it only under ADR 0030.       |
| `BB_CLERK_CUSTOMER_JWT_KEY`                 | Offline customer JWT verification                                   | Public key, protect config integrity | customer Clerk PEM public key                         | A/K/M                         | Required bounded `BEGIN PUBLIC KEY` PEM and distinct from HQ. Invalid/missing refuses startup.                                                         |
| `BB_CLERK_MOBILE_AUTHORIZED_PARTIES`        | Exact native JWT `azp` allowlist                                     | No                                   | `none` until physical-device proof                    | A/K/M                         | Required. `none` accepts only omitted `azp`; otherwise at most eight exact HTTPS origins, disjoint from customer/HQ browser origins.                    |
| `BB_CLERK_HQ_ISSUER`                        | Exact HQ token issuer                                               | No                                   | HQ Clerk Frontend API HTTPS origin                    | A/K/M                         | Required and distinct from customer.                                                                                                                   |
| `BB_CLERK_HQ_AUDIENCE`                      | Exact HQ token audience                                             | No                                   | `boomerbuddy-hq`                                      | A/K/M                         | Required and distinct from customer.                                                                                                                   |
| `BB_CLERK_HQ_JWT_KEY`                       | Offline HQ JWT verification                                         | Public key, protect config integrity | HQ Clerk PEM public key                               | A/K/M                         | Required and distinct from customer.                                                                                                                   |
| `BB_CLERK_HQ_MAX_SECOND_FACTOR_AGE_SECONDS` | Bound fresh HQ MFA and token issue age                              | No                                   | `600`                                                 | A/K/M                         | Optional schema default 600; allowed 60-3600. Missing MFA/factor-age or stale token denies HQ.                                                         |
| `BB_ARTIFACT_KEY_BASE64`                    | AES key for encrypted submitted/minimized application records       | Yes                                  | distinct canonical base64 of 32 random bytes          | A/K/M                         | Required; wrong length/noncanonical/reused secret refuses config. Never rotate without a reviewed data migration.                                      |
| `BB_FINGERPRINT_KEY_BASE64`                 | Keyed fingerprints, evidence binding, and nonreversible identifiers | Yes                                  | separate canonical base64 of 32 random bytes          | A/K/M                         | Required; wrong length/noncanonical/equal to another secret refuses config.                                                                            |
| `BB_SAFE_WORD_PEPPER`                       | Safe-word verifier hardening                                        | Yes                                  | separate high-entropy string, 16+ characters          | A/K/M                         | Required and distinct. Missing/short/equal secret refuses config.                                                                                      |
| `BB_LOG_LEVEL`                              | Structured log threshold                                            | No                                   | `info`                                                | A/K/M                         | Optional default `info`; only `debug`, `info`, `warn`, `error`. Do not use debug with customer traffic.                                                |
| `BB_STRIPE_MODE`                            | Payment network boundary                                            | No                                   | default `disabled`; future reviewed rollout `live`    | A/K                           | Live is not currently production-capable. Disabled mode refuses every Stripe field, and a future candidate must close the catalog, entitlement, and complete surface-specific manifest gates below. |
| `BB_TWILIO_MODE`                            | Messaging network boundary                                          | No                                   | `disabled`                                            | A/K/M                         | Only `disabled` parses; all Twilio credential/URL fields are refused.                                                                                  |

`BB_SESSION_SECRET` is intentionally **absent** in production. Supplying it refuses startup because
production accepts only Clerk's exact `__session`; the secret exists only for local development.

### Default-off acquisition and support controls

These nonsecret controls are part of the exact deployment manifest. Do not omit them and rely on an
implicit default. Worker and HQ projects must not receive them.

| Variable | API project | Customer web project | Activation and failure behavior |
| --- | --- | --- | --- |
| `BB_PRIVATE_BETA_ACCESS_INTENTS_ENABLED` | exactly `false` at baseline | exactly `false` at baseline | May become `true` on API and web only after the edge gate below is proved. A mismatched pair is a hard stop. |
| `BB_PRIVATE_BETA_ACCESS_INTENTS_EDGE_GUARD_CONFIRMED` | exactly `false` at baseline | exactly `false` at baseline | May become `true` with the access-intent switch only after deployed edge rate limiting, mailbox ownership, retention, and rollback are proved. |
| `BB_SUPPORT_RECEIPTS_CUSTOMER_ACCESS_ENABLED` | exactly `false` at baseline | absent | Enable first for a synthetic drill so an authenticated customer can read only their own content-free receipts. |
| `BB_SUPPORT_RECEIPTS_HQ_QUEUE_ENABLED` | exactly `false` at baseline | absent | Enable with customer access and before intake so a recently MFA-verified HQ operator can see the content-free queue. |
| `BB_SUPPORT_RECEIPTS_INTAKE_ENABLED` | exactly `false` at baseline | absent | Enable last, only after both read paths pass. Disable first on rollback. |

Access-intent activation follows `docs/run-3/PRIVATE-BETA-ACCESS-INTENTS.md`: prove the deployed edge
guard and owned mailbox, set both access-intent variables true on API and web for the same exact
release, then run the bounded synthetic receipt and rollback drill. Disable by setting
`BB_PRIVATE_BETA_ACCESS_INTENTS_ENABLED=false` on both services first, then return the edge
confirmation to false when the evidence is no longer current.

Support activation is API-only. Keep intake false while setting customer access and HQ queue true;
redeploy API and prove both paths with separate synthetic customer and HQ sessions. Only then set
intake true and run create, idempotent retry, acknowledgement, transition, withdrawal, tenant
denial, and rollback. Roll back by setting intake false first, then customer access and HQ queue
false. Record only names, booleans, exact release identity, timestamps, and content-free receipt
IDs. Never record PII or submitted content.

### Surface-separated live Stripe configuration

Live Stripe remains default-off. The API and worker use the same exact live account, Family product,
USD $14.99/month price, and bounded Portal configuration identifiers, but they must not receive the
same credential manifest. Each project receives only its own restricted key. The API alone receives
the webhook signing secret and is the only surface on which initiation may later become true. The
worker must keep initiation false. The deprecated shared `BB_STRIPE_LIVE_API_KEY` is always absent
and is rejected by configuration.

| Variable | Purpose | Secret? | API project | Worker project | Failure behavior |
| --- | --- | --- | --- | --- | --- |
| `BB_STRIPE_RUNTIME_SURFACE` | Bind one credential to one runtime | No | exactly `api` | exactly `worker` | Missing, wrong, or mixed surface custody refuses startup. |
| `BB_STRIPE_LIVE_INITIATION_ENABLED` | Runtime initiation kill switch | No | `false` by default; `true` only after the active operator-approved, unexpired max-one cohort and exact live preflight | exactly `false` | Worker true, or API true without reviewed database controls, remains fail-closed. |
| `BB_STRIPE_LIVE_ACCOUNT_ID` | Exact live Stripe account | No, identifier | exact `acct_...` | same identifier | Missing or malformed refuses startup; preflight also requires charges and payouts enabled for a US company account. |
| `BB_STRIPE_LIVE_FOUNDING_PRODUCT_ID` | Family product | No, identifier | exact live `prod_...` | same identifier | Must resolve to the active Family product. |
| `BB_STRIPE_LIVE_FOUNDING_MONTHLY_PRICE_ID` | Family monthly price | No, identifier | exact live `price_...` | same identifier | Must resolve to one active recurring USD 1,499-cent monthly price with quantity one. |
| `BB_STRIPE_LIVE_CANCEL_ONLY_PORTAL_CONFIGURATION_ID` | Bounded customer Portal | No, identifier | exact live `bpc_...` | same identifier | Payment-method update and cancel-at-period-end are enabled; plan changes, promotions, and proration are disabled. |
| `BB_STRIPE_LIVE_API_RESTRICTED_KEY` | API Checkout, Portal, preflight, and webhook-side reconciliation reads | Yes | required `rk_live_...` in API Secrets only | absent | Any unrestricted key, worker key, or cross-surface copy refuses startup. |
| `BB_STRIPE_LIVE_WORKER_RESTRICTED_KEY` | Worker inventory and reconciliation reads | Yes | absent | required `rk_live_...` in worker Secrets only | Any API key, webhook secret, or cross-surface copy refuses startup. |
| `BB_STRIPE_LIVE_WEBHOOK_SECRET` | Verify the exact live webhook endpoint | Yes | required `whsec_...` in API Secrets only | absent | Missing on API or present on worker refuses the live surface manifest. |

Production projects must omit every `BB_STRIPE_TEST_*` value. Test mode remains limited to isolated
nonproduction evidence and cannot be mixed with any live field.

The initial 0.25-CU database capacity profile is API pool 2 plus worker pool 1/batch 1. A pooled Neon
URL controls connection churn but does not replace these application-side active-work caps. SQLSTATE
`53200` is a failed capacity gate and must not be hidden by immediate retry. Raise compute to at least
0.5 CU (prefer bounded 0.5-1 CU autoscaling where available) if three fresh-database mixed-load runs
cannot pass with these caps.

## Worker-only configuration

| Variable                  | Purpose                            | Secret? | Source / example   | Services | Requirement, default, and failure behavior                                  |
| ------------------------- | ---------------------------------- | ------- | ------------------ | -------- | --------------------------------------------------------------------------- |
| `BB_WORKER_ID`            | Stable lease owner without content | No      | `run3-1-worker-01` | K        | Required, 2-200 safe identifier characters. Missing/invalid refuses worker. |
| `BB_WORKER_POLL_MS`       | Poll interval                      | No      | `1000`             | K        | Optional default 1000; range 50-60000.                                      |
| `BB_WORKER_LEASE_MS`      | Lease duration                     | No      | `30000`            | K        | Optional default 30000; range 5000-900000.                                  |
| `BB_WORKER_HEARTBEAT_MS`  | Lease heartbeat                    | No      | `10000`            | K        | Optional default 10000; must be less than half the lease duration.          |
| `BB_WORKER_SHUTDOWN_MS`   | Graceful shutdown bound            | No      | `20000`            | K        | Optional default 20000; range 1000-120000.                                  |
| `BB_WORKER_BATCH_SIZE`    | Per-cycle batch bound              | No      | production: `1`    | K        | Optional schema default 10; range 1-100. Set 1 for the initial 0.25-CU beta so claimed work matches the worker pool cap. |
| `BB_WORKER_RETRY_BASE_MS` | Retry backoff base                 | No      | `1000`             | K        | Optional default 1000; range 100-60000.                                     |
| `BB_WORKER_RETRY_MAX_MS`  | Retry backoff cap                  | No      | `300000`           | K        | Optional default 300000; range 1000-3600000.                                |

Production worker composition contains only reviewed internal jobs, including feedback retention and
the bounded Stripe inventory/reconciliation handlers when the exact worker live manifest is present.
It must contain no feedback classification/model/media/outbound handler and no Twilio network
adapter. Do not increase the worker pool or batch until repeated mixed API/worker provider tests show
memory and latency headroom without SQLSTATE `53200`.

## Disposable provider-test PostgreSQL verifier

| Variable                         | Purpose                                    | Secret? | Source / example                                                               | Services | Requirement, default, and failure behavior                                                                                                               |
| -------------------------------- | ------------------------------------------ | ------- | ------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                   | New empty destructive-test PostgreSQL only | Yes     | disposable TLS URL ending in a DB name with a delimited `ci` or `test` segment | T only   | Required by `verify:postgres`; never reuse the live URL. The verifier also checks that Run 3.1 truth tables are empty before fixtures.                   |
| `BB_ALLOW_POSTGRES_VERIFICATION` | Explicit destructive verifier confirmation | No      | founder: `true`                                                                | T only   | Required exactly `true` for `npm run verify:postgres`; otherwise unset. Must be absent from W/A/K/H/M/B and must never be paired with the live database. |

Destroy the disposable database and remove the allow flag after retaining content-free output. This
verifier is not a runtime mode or a migration shortcut.

## Values that must be absent

| Variable family                                                                                                                                                                                  | Services       | Reason / failure behavior                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `BB_SESSION_SECRET`                                                                                                                                                                              | A/K/M          | Development signing material; production explicitly rejects it.                                                    |
| `BB_PGLITE_PATH`                                                                                                                                                                                 | all production | Deployment filesystem is not customer truth; PostgreSQL is required.                                               |
| `BB_STRIPE_TEST_*`                                                                                                                                                                               | A/K/M          | Production refuses sandbox resources and credentials.                                                             |
| `BB_STRIPE_LIVE_API_KEY`                                                                                                                                                                        | A/K/M          | Deprecated shared or unrestricted live key; configuration always rejects it.                                      |
| `BB_STRIPE_LIVE_API_RESTRICTED_KEY`, `BB_STRIPE_LIVE_WEBHOOK_SECRET`                                                                                                                            | K/M            | API-only custody; either value on worker or migration shell refuses the exact manifest.                            |
| `BB_STRIPE_LIVE_WORKER_RESTRICTED_KEY`                                                                                                                                                           | A/M            | Worker-only custody; the value must never be copied to API or migration shell.                                     |
| `BB_TWILIO_ACCOUNT_SID`, `BB_TWILIO_AUTH_TOKEN`, `BB_TWILIO_MESSAGING_SERVICE_SID`, `BB_TWILIO_TOLL_FREE_NUMBER_SID`, `BB_TWILIO_INBOUND_WEBHOOK_BASE_URL`, `BB_TWILIO_STATUS_CALLBACK_BASE_URL` | A/K/M          | Provider adapter is absent; any value refuses config.                                                              |
| `NEXT_PUBLIC_API_URL`, `EXPO_PUBLIC_API_URL`                                                                                                                                                     | W/H            | Production browser traffic uses same-origin proxies; mobile is not deployed.                                       |
| Any `.env` file                                                                                                                                                                                  | all            | Never commit or bake secrets into the deployment snapshot. Use Published app secrets.                              |

## Founder-machine-only portability variables

| Variable                      | Purpose                                               | Secret? | Source / example                         | Services | Requirement, default, and failure behavior                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------- | ------- | ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BB_RUN3_1_BACKUP_KEY_BASE64` | Encrypt/authenticate portable `.bbbackup`             | Yes     | independent canonical base64 32-byte key | B only   | Required by backup/restore. Never store in Replit, GitHub, or beside backup. Invalid key refuses before subprocess execution.                                                     |
| `DATABASE_URL`                | Source DB for backup or disposable target for restore | Yes     | explicit TLS PostgreSQL URL              | B only   | Required. Missing/disable/allow/prefer TLS modes refuse. Restore additionally refuses production/live-looking DB names and requires exact `RESTORE-DISPOSABLE:<db>` confirmation. |

The backup output path and 40-character candidate SHA are CLI arguments, not environment variables.
Output must be an absolute founder-controlled path outside the repository and must not already exist.

## Cryptographic custody decision

| Value                          | Protects                                                   | Raw at runtime?        | Run 3.1 classification                                                    | Reason and remaining risk                                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BB_ARTIFACT_KEY_BASE64`       | Confidentiality/integrity of encrypted application records | Yes                    | `REPLIT_SECRET_SUFFICIENT_FOR_BETA`                                       | Bounded acceptance for one trusted household and sole-founder administration. Replit exposes it as a runtime environment variable, so this is not non-exportable KMS and does not protect against runtime/project-admin compromise. |
| `BB_FINGERPRINT_KEY_BASE64`    | Keyed fingerprints/evidence identifiers                    | Yes                    | `REPLIT_SECRET_SUFFICIENT_FOR_BETA`                                       | Same bounded threat model; separate value and external recovery escrow required.                                                                                                                                                    |
| `BB_SAFE_WORD_PEPPER`          | Offline verifier resistance                                | Yes                    | `REPLIT_SECRET_SUFFICIENT_FOR_BETA`                                       | Same bounded threat model; high entropy and separate custody required.                                                                                                                                                              |
| Customer/HQ `CLERK_SECRET_KEY` | Next/Clerk server integration                              | Yes                    | `REPLIT_SECRET_SUFFICIENT_FOR_BETA`                                       | Use only in the matching web/HQ project; rotate in Clerk on suspected exposure.                                                                                                                                                     |
| PostgreSQL `DATABASE_URL`      | Database authentication and endpoint                       | Yes                    | `REPLIT_SECRET_SUFFICIENT_FOR_BETA`                                       | Requires TLS URL and narrow role; provider backups/role separation remain external evidence.                                                                                                                                        |
| `BB_RUN3_1_BACKUP_KEY_BASE64`  | External recovery artifact                                 | Yes, founder tool only | `FOUNDER_HELD_OUTSIDE_REPLIT` (portability-only; not a runtime KMS claim) | Founder-controlled external custody supplies independence from the runtime platform. A hardware/password-manager secret is acceptable for the drill; never inject into deployments.                                                 |
| `BB_SESSION_SECRET`            | Development token signing                                  | No                     | `NOT_USED_IN_FOUNDING_HOUSEHOLD_SCOPE`                                    | Production rejects it.                                                                                                                                                                                                              |
| Stripe API restricted key and webhook secret | Family billing and signed payment truth                    | Yes, surface-specific  | `REPLIT_SECRET_SUFFICIENT_FOR_BETA`                                       | API and worker credentials are separate least-privilege restricted keys. The webhook secret exists only on API. Initiation remains default-off and database-gated to one approved household. Rotate in Stripe on suspected exposure. |
| Twilio credentials             | Future SMS/voice provider                                  | No                     | `NOT_USED_IN_FOUNDING_HOUSEHOLD_SCOPE`                                    | Runtime rejects them while `BB_TWILIO_MODE=disabled`.                                                                                                                                                                                |

This beta classification is an explicit risk decision, not a claim that Replit Secrets are KMS.
Replit documents Secrets as encrypted environment variables; the application necessarily receives
their raw value in process memory. Before any non-test customer sign-in, the founder must place the
exact versioned artifact key, fingerprint key, and safe-word pepper in an encrypted recovery escrow
outside Replit, with a second recovery owner or independently recoverable access. A disposable
recovery drill must re-enter those same values without logging them and prove application-level
encrypted-record readability plus fingerprint/safe-word behavior. A database dump without these
values is not a reconstructable backup. Any later expansion beyond one tightly held household
requires a fresh custody and rotation review.

No enabled Run 3.1 runtime value is classified `TRUE_KMS_REQUIRED_BEFORE_EXTERNAL_USER` under this
one-household, sole-founder risk boundary. That conclusion expires if another operator, household,
media path, additional provider credential, or broader production use is added.
