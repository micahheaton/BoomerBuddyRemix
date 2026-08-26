# Private-beta access-intent receipts

## Boundary

The pricing CTA creates a temporary content-free receipt before opening the visitor's own email
composer to `support@boomerbuddy.net`. The application sends no message. A receipt has lifecycle
`intent_created`; it is not named or counted as `lead_received`.

The content and lifecycle portion of the receipt stores only:

- a server-issued opaque receipt code;
- the fixed purpose `private_beta_access_request`;
- one exact allowlisted source and campaign pair;
- lifecycle `intent_created`;
- creation and expiry timestamps.

The browser creates a purpose-scoped UUID operation key in memory for retry safety. The server stores
only its HMAC and a purpose-scoped request digest. Repeating the same operation returns the same
server receipt without consuming quota or incrementing intent counts again. The key is never put in
a URL, cookie, account, or browser storage.

The request digest binds the fixed purpose and allowlisted attribution, not the observed network
bucket. An exact retry therefore returns the original receipt even if a mobile connection, NAT, or
deployment peer address changes. A replay that changes purpose or attribution fails as a conflict.

It stores no name, email address, phone number, free text, message body, customer identifier, Clerk
identifier, cookie, or raw network address. A purpose-separated HMAC of the observed network address
exists only in the hourly abuse-limit bucket. Receipt validity is seven days. Expired receipt rows
are deleted after a 24-hour terminal grace period; aggregate content-free counts are retained for 90
days.

This storage statement describes the BoomerBuddy application database and application logger. The
hosting, edge, and security providers can process the original request address and short-lived
network logs as operational records before browser JavaScript removes query parameters. Never put a
name, email address, phone number, message, or other contact data in a pricing-page URL. Verify the
providers' access-log fields, access controls, and retention before activation.

The per-network bucket is a best-effort abuse signal, not an identity or an edge-grade rate-limit
claim. Production keeps its network ceiling equal to the global ceiling while trusted proxy hops
remain zero, so equivalent or deployment-translated address forms cannot be used to deny an
individual visitor. The transactional global ceiling remains authoritative until deployed request-IP
behavior and canonicalization are proven.

A process-local, content-free global limiter rejects excess requests before schema parsing and
before the serialized repository gate. Fastify still enforces its bounded JSON body parsing first,
so this is a database-pressure backstop, not the public abuse boundary. A trusted independently
operated edge limit must cap requests per client and globally, must refuse spoofed forwarding
headers, and must provide an immediate kill switch. A checkbox or environment value is not edge
evidence.

The existing durable worker `retention.sweep` job runs every five minutes and invokes access-intent
cleanup. Every cleanup call deletes at most its explicit batch size from each access-intent table and
schedules continuation when a batch saturates. API startup drains at most ten bounded batches per
pass. New receipt creation performs only a smaller bounded cleanup batch. No cleanup query returns
receipt codes. Production activation requires the worker deployment and recurring retention job to
be healthy; the CTA must remain disabled if that evidence is absent.

## Activation and immediate disable

Receipt creation is default-off. Both the API and customer web deployment must set these exact
values only after the independent edge evidence and the operating gates below are complete:

- `BB_PRIVATE_BETA_ACCESS_INTENTS_ENABLED=true`
- `BB_PRIVATE_BETA_ACCESS_INTENTS_EDGE_GUARD_CONFIRMED=true`

The second value records reviewed evidence; it does not create an edge guard. If either value is
missing or false, the API does not register the public mutation and pricing renders honest paused
copy instead of the active CTA. The authenticated HQ projection remains available during rollback
and retention cleanup.

For an incident, engage the independent edge kill switch first. Then set
`BB_PRIVATE_BETA_ACCESS_INTENTS_ENABLED=false` on API and web and restart those exact services. Do
not wait for a code deployment. Keep the worker running so retention continues.

The access-intent HMACs currently use `BB_FINGERPRINT_KEY_BASE64` without a stored key version.
Except for a credential-compromise response, do not rotate that key while receipt creation is
enabled or while any receipt can remain. Disable at the edge and application, wait the seven-day TTL
plus 24-hour grace, run bounded cleanup to zero receipt and rate-bucket rows, and only then perform a
planned rotation. A security incident takes precedence, but the incident record must note that
idempotent retries and rate buckets were invalidated.

## Allowed attribution

Only these exact pairs are accepted:

| Source | Campaign |
| --- | --- |
| `direct` | `none` |
| `organic` | `none` |
| `partner` | `trusted_partner` |
| `campaign` | `launch_2026` |

Missing parameters mean `direct` and `none`. Duplicate, incomplete, mismatched, extra, or
unrecognized parameters fail closed and create no receipt. Address parameters are removed from the
browser after capture.

## Manual correlation

The email subject contains only the fixed text and opaque receipt code. An authenticated active HQ
owner may read `GET /v1/hq/access-intents`, which returns at most 100 recent content-free receipts.
It returns no mailbox or customer data. Staff compare the code in a voluntarily sent email subject
with this projection. The application does not mark the receipt received, qualified, or converted.

## Operating gates

Before relying on this path, verify `support@boomerbuddy.net` delivery, the accountable mailbox
owner, monitoring hours, reply handling, and deletion practice. Also capture deployed edge
configuration, a successful allow test, an over-limit rejection, a kill-switch test, worker job
continuity, and bounded cleanup continuation. Until that evidence exists, keep both activation
values false. The implementation is a technically bounded contact handoff, not an operational
support or conversion claim.

## Rollback

Engage the edge kill switch and set `BB_PRIVATE_BETA_ACCESS_INTENTS_ENABLED=false` on API and web.
Keep the database migration applied and keep the owner-only HQ projection available for correlation
and cleanup verification. Allow the seven-day TTL plus grace period to elapse and run bounded
retention cleanup. Remove code only in a later reviewed release. Do not reverse or edit an applied
migration.
