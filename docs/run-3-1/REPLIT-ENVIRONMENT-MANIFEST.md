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
| `BB_RUN3_1_RELEASE_COMMIT` | Bind runtime to candidate                | No      | dossier: 40 lowercase hex                  | W/A/K/H   | Required; must equal the configured annotated tag's dereferenced commit. A provider snapshot HEAD may differ only when its tree is identical. |
| `BB_RUN3_1_RELEASE_TAG`    | Bind runtime to immutable tag            | No      | `run3-1-replit-founding-household-<12hex>` | W/A/K/H   | Required; the ref itself must be an annotated tag object, and its suffix must equal the candidate commit's first 12 characters. |
| `REPLIT_DEPLOYMENT`        | Prove a published runtime                | No      | Replit automatic: `1`                      | W/A/K/H   | Required at start and must be `1`; never set manually in local evidence.                                                        |
| `PORT`                     | Provider-selected listener port          | No      | Replit automatic integer                   | W/A/K/H   | Required for web-facing services. Next consumes it directly; the wrapper derives the API child's `BB_API_PORT`. The worker uses it only for a static private liveness listener and falls back to `3000` when Replit omits it. |

Every Replit provenance check additionally requires all of the following:

- `git cat-file -t refs/tags/<tag>` returns exactly `tag`; a lightweight tag is not accepted.
- `git rev-parse refs/tags/<tag>^{commit}` equals `BB_RUN3_1_RELEASE_COMMIT`.
- `git rev-parse HEAD^{tree}` equals `git rev-parse refs/tags/<tag>^{tree}` exactly.
- `git status --porcelain=v1 --untracked-files=all` emits no entries before the service build.
  Staged, unstaged, and nonignored untracked content all fail closed.

Replit may package the reviewed source tree beneath a different provider-generated snapshot commit.
That representation is accepted only when the configured annotated tag still dereferences to the
recorded candidate commit, the two trees are identical, and the full porcelain status is empty. For
API, web, and HQ Autoscale builds only, the wrapper recognizes Replit's exact reviewed
`deploymentTarget = "cloudrun"` append by requiring the sole raw status record, canonical and
rewritten blob hashes, and unchanged mode. It restores the canonical indexed `.replit`, reruns the
same status command, and proceeds only after the result is empty. The Reserved VM worker never
receives this normalization. Any other byte, target, path, status, or mode fails closed; this does not
permit a moved or lightweight tag, a different tagged commit, a changed tree, or arbitrary dirty
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
| `BB_PUBLIC_ORIGIN`                  | Exact browser-visible origin and mutation-origin authority | No      | published app URL, e.g. `https://customer.example.replit.app` | W or H, different values | Required HTTPS origin with no path/query/credentials. Missing/invalid makes the same-origin API proxy return 503 and the identity provider render unavailable. |
| `BB_API_INTERNAL_ORIGIN`            | Exact upstream API origin for server proxy                 | No      | API published URL, e.g. `https://api.example.replit.app`      | W/H                      | Required HTTPS origin with no path/query/credentials. Missing/invalid returns private no-store 503.                                                            |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Select the correct browser Clerk application               | No      | customer or HQ `pk_live_...`                                  | W/H                      | Required in production; customer and HQ values come from separate Clerk apps. At build, the reviewed Next config aliases Replit-managed `CLERK_PUBLISHABLE_KEY` when this name is absent. |
| `CLERK_SECRET_KEY`                  | Clerk Next.js server/middleware credential                 | Yes     | matching Clerk production application                         | W/H                      | Required only in the matching project. Missing makes every matched production request return no-store 503. Never prefix with `NEXT_PUBLIC_`.                   |
| `NEXT_PUBLIC_API_URL`               | Legacy local direct API target                             | No      | not set                                                       | none in production       | Production client uses same-origin `/api`; omit.                                                                                                               |
| `EXPO_PUBLIC_API_URL`               | Mobile direct API target                                   | No      | not set                                                       | none                     | Mobile is outside Run 3.1 deployment.                                                                                                                          |

The web and HQ proxies forward only the exact `__session` cookie plus a small header allowlist. They
discard legacy BoomerBuddy session cookies and Authorization. The API independently verifies issuer,
authorized party, signature, time, subject, provider session, and state. Customer tokens may omit
`aud` only under ADR 0030; an explicit customer `aud` must match. HQ always requires its exact
audience and bounded factor age.

HQ's only application-level liveness exception is the observed direct Replit Autoscale GET/HEAD
homepage probe. It requires `REPLIT_DEPLOYMENT=1`, the canonical automatic `PORT`, exact
`127.0.0.1:$PORT` Host and Next-normalized loopback HTTP URL, no query, exact Next-derived loopback
`X-Forwarded-For/Host/Port/Proto` values, and no raw `Forwarded` header, and it runs only after the matching Clerk publishable and secret keys are present. The response is
fixed content-free, no-store text with restrictive browser headers. External `/`, every operator
route, and all `/api` paths remain behind the separate HQ Clerk middleware; near-match probes fail
closed.

## API and worker application configuration

| Variable                                    | Purpose                                                             | Secret?                              | Source / example                                      | Services                      | Requirement, default, and failure behavior                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BB_API_HOST`                               | API bind address                                                    | No                                   | founder: `0.0.0.0`                                    | A                             | Required by Replit start wrapper exactly `0.0.0.0`; localhost binding is refused. Worker may omit.                                                     |
| `BB_API_PORT`                               | API internal port                                                   | No                                   | derived automatically from provider `PORT` by wrapper | A                             | Do not configure separately. The wrapper supplies it to the API child; an explicitly configured mismatch refuses before startup.                       |
| `BB_TRUSTED_PROXY_HOPS`                     | Fastify proxy trust count                                           | No                                   | founder: `0`                                          | A/K/M                         | Production requires exactly `0` until deployed spoof-resistance evidence establishes another value; any nonzero value refuses config.                  |
| `BB_DATABASE_DRIVER`                        | Customer truth database                                             | No                                   | founder: `postgres`                                   | A/K/M                         | Production requires `postgres`; PGlite refuses startup.                                                                                                |
| `DATABASE_URL`                              | PostgreSQL connection                                               | Yes                                  | Replit DB; `postgresql://.../db?sslmode=verify-full`  | A/K/M; B uses separate target | Required, PostgreSQL scheme, one database, and exactly one `sslmode=require`, `verify-ca`, or `verify-full`. Use pooled runtime URLs for A/K and the direct migration URL for M; missing or downgrade modes refuse config. |
| `BB_POSTGRES_POOL_MAX`                      | Per-process PostgreSQL connection cap                               | No                                   | A: `2`; K: `1`; M: `1`                               | A/K/M                         | Required explicitly in production; integer 1–10. Development/test default 10 when omitted. The initial 0.25-CU beta must use the listed caps so pressure queues in Node instead of consuming PostgreSQL backend memory. |
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
| `BB_CLERK_HQ_ISSUER`                        | Exact HQ token issuer                                               | No                                   | HQ Clerk Frontend API HTTPS origin                    | A/K/M                         | Required and distinct from customer.                                                                                                                   |
| `BB_CLERK_HQ_AUDIENCE`                      | Exact HQ token audience                                             | No                                   | `boomerbuddy-hq`                                      | A/K/M                         | Required and distinct from customer.                                                                                                                   |
| `BB_CLERK_HQ_JWT_KEY`                       | Offline HQ JWT verification                                         | Public key, protect config integrity | HQ Clerk PEM public key                               | A/K/M                         | Required and distinct from customer.                                                                                                                   |
| `BB_CLERK_HQ_MAX_SECOND_FACTOR_AGE_SECONDS` | Bound fresh HQ MFA and token issue age                              | No                                   | `600`                                                 | A/K/M                         | Optional schema default 600; allowed 60–3600. Missing MFA/factor-age or stale token denies HQ.                                                         |
| `BB_ARTIFACT_KEY_BASE64`                    | AES key for encrypted submitted/minimized application records       | Yes                                  | distinct canonical base64 of 32 random bytes          | A/K/M                         | Required; wrong length/noncanonical/reused secret refuses config. Never rotate without a reviewed data migration.                                      |
| `BB_FINGERPRINT_KEY_BASE64`                 | Keyed fingerprints, evidence binding, and nonreversible identifiers | Yes                                  | separate canonical base64 of 32 random bytes          | A/K/M                         | Required; wrong length/noncanonical/equal to another secret refuses config.                                                                            |
| `BB_SAFE_WORD_PEPPER`                       | Safe-word verifier hardening                                        | Yes                                  | separate high-entropy string, 16+ characters          | A/K/M                         | Required and distinct. Missing/short/equal secret refuses config.                                                                                      |
| `BB_LOG_LEVEL`                              | Structured log threshold                                            | No                                   | `info`                                                | A/K/M                         | Optional default `info`; only `debug`, `info`, `warn`, `error`. Do not use debug with customer traffic.                                                |
| `BB_STRIPE_MODE`                            | Payment network boundary                                            | No                                   | `disabled`                                            | A/K/M                         | Production requires `disabled`. Any Stripe mode or any Stripe field refuses the beta runtime.                                                          |
| `BB_TWILIO_MODE`                            | Messaging network boundary                                          | No                                   | `disabled`                                            | A/K/M                         | Only `disabled` parses; all Twilio credential/URL fields are refused.                                                                                  |

`BB_SESSION_SECRET` is intentionally **absent** in production. Supplying it refuses startup because
production accepts only Clerk's exact `__session`; the secret exists only for local development.

The initial 0.25-CU database capacity profile is API pool 2 plus worker pool 1/batch 1. A pooled Neon
URL controls connection churn but does not replace these application-side active-work caps. SQLSTATE
`53200` is a failed capacity gate and must not be hidden by immediate retry. Raise compute to at least
0.5 CU (prefer bounded 0.5–1 CU autoscaling where available) if three fresh-database mixed-load runs
cannot pass with these caps.

## Worker-only configuration

| Variable                  | Purpose                            | Secret? | Source / example   | Services | Requirement, default, and failure behavior                                  |
| ------------------------- | ---------------------------------- | ------- | ------------------ | -------- | --------------------------------------------------------------------------- |
| `BB_WORKER_ID`            | Stable lease owner without content | No      | `run3-1-worker-01` | K        | Required, 2–200 safe identifier characters. Missing/invalid refuses worker. |
| `BB_WORKER_POLL_MS`       | Poll interval                      | No      | `1000`             | K        | Optional default 1000; range 50–60000.                                      |
| `BB_WORKER_LEASE_MS`      | Lease duration                     | No      | `30000`            | K        | Optional default 30000; range 5000–900000.                                  |
| `BB_WORKER_HEARTBEAT_MS`  | Lease heartbeat                    | No      | `10000`            | K        | Optional default 10000; must be less than half the lease duration.          |
| `BB_WORKER_SHUTDOWN_MS`   | Graceful shutdown bound            | No      | `20000`            | K        | Optional default 20000; range 1000–120000.                                  |
| `BB_WORKER_BATCH_SIZE`    | Per-cycle batch bound              | No      | production: `1`    | K        | Optional schema default 10; range 1–100. Set 1 for the initial 0.25-CU beta so claimed work matches the worker pool cap. |
| `BB_WORKER_RETRY_BASE_MS` | Retry backoff base                 | No      | `1000`             | K        | Optional default 1000; range 100–60000.                                     |
| `BB_WORKER_RETRY_MAX_MS`  | Retry backoff cap                  | No      | `300000`           | K        | Optional default 300000; range 1000–3600000.                                |

Production worker composition contains only reviewed internal jobs, including feedback retention. It
must contain no feedback classification/model/media/outbound handler and no Stripe/Twilio network
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
| `BB_STRIPE_TEST_*`, `BB_STRIPE_LIVE_*`                                                                                                                                                           | A/K/M          | Stripe is out of scope. Disabled mode refuses every mapped value; raw live key/webhook material is always refused. |
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
| Stripe/Twilio credentials      | Future payment/SMS providers                               | No                     | `NOT_USED_IN_FOUNDING_HOUSEHOLD_SCOPE`                                    | Runtime rejects them.                                                                                                                                                                                                               |

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
media path, provider credential, or broader production use is added.
