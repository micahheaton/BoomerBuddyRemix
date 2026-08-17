# Twilio Consent and Messaging

Status: **provider-free local core candidate implemented; no Twilio adapter, provider test, provider network action, recipient message, or live send exists**

Last reviewed: 2026-08-17

This document defines the boundary for a future Twilio test integration. It does not authorize purchasing a number, enabling a Messaging Service, sending to a real recipient, contacting an invitee, or treating one adult's phone-number entry as another adult's consent.

## Evidence boundary

| Level | Current state |
| --- | --- |
| Local simulation | Migration `0021_run3_consent_messaging.sql` plus isolated domain, contracts, persistence, and worker-composition modules now model encrypted local fixture destinations, recipient-purpose consent/withdrawal, STOP/START/HELP effects, exact-case support intake, quiet hours, serialized cumulative caps, and terminal local outcomes. Transport is constrained to `none`, network permission to `false`, and production composition installs no handler. This is not Twilio delivery proof. |
| Twilio test | **Blocked** pending founder-owned account/subaccount, verified toll-free sender, approved test recipients, credentials, reachable staging, and the reviewed adapter. |
| Deployed staging | **Blocked** pending managed identity/KMS, PostgreSQL, trusted proxy, monitoring, recovery, and exact consent/suppression evidence. |
| Live customer messaging | **Blocked and founder-gated** pending communications/legal review, toll-free/campaign approval, templates, support coverage, and a bounded activation decision. |

No message was sent by creating this document.

## Messaging principles

1. Consent belongs to the recipient and the specific purpose/channel; it is not transferred by a household administrator, referrer, contact upload, or Trusted Circle member.
2. Initial referral/invitation outreach is user initiated through a native share sheet, SMS/email composer, or copied link. BoomerBuddy may supply bounded copy, but the user chooses the recipient and presses send from their device.
3. After the recipient enters BoomerBuddy, identity-binds the invitation/relationship, and separately grants the required BoomerBuddy communications consent, the service may become eligible to send the approved class of message.
4. Service, fraud-safety, support, research follow-up, referral, and marketing purposes remain separate. Transactional consent is not marketing consent.
5. STOP/withdrawal/suppression is effective before any future dispatch. A delivery provider's suppression is defense in depth, not BoomerBuddy's only record.
6. No purchased list, scraped address book, automatic contact upload, transferred consent, or automatic first message.

Twilio's current Messaging Policy requires the sender to obtain the applicable consent and identify itself; initial messages need an opt-out instruction. This policy boundary requires qualified review for the actual geography/use case and is not legal advice. See [Twilio Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy).

## Reserved configuration names

These names are reserved for the future reviewed adapter. The current application parses only the
`disabled` sentinel and rejects every reserved credential, identifier, or callback value; no
messaging adapter consumes them. Future values must stay in the founder-controlled secret/config
system.

| Name | Type | Intended use |
| --- | --- | --- |
| `BB_TWILIO_MODE` | Non-secret | `disabled` by default; a future adapter may add an explicit test mode. No live value is defined. |
| `BB_TWILIO_ACCOUNT_SID` | Secret-system value | Exact test subaccount/account identifier used with the signing credential. Do not publish it as proof of security. |
| `BB_TWILIO_AUTH_TOKEN` | Secret | Test request credential and inbound webhook signature-validation secret. |
| `BB_TWILIO_MESSAGING_SERVICE_SID` | Secret-system identifier | Exact test Messaging Service. |
| `BB_TWILIO_TOLL_FREE_NUMBER_SID` | Secret-system identifier | Exact approved test sender resource. |
| `BB_TWILIO_INBOUND_WEBHOOK_BASE_URL` | Non-secret configuration | Canonical externally visible HTTPS base URL used for exact signature reconstruction. |
| `BB_TWILIO_STATUS_CALLBACK_BASE_URL` | Non-secret configuration | Canonical externally visible HTTPS status-callback base URL. |

The names are now reserved in `.env.example`. `@boomerbuddy/config` accepts only `BB_TWILIO_MODE=disabled` and rejects every credential or callback value; a future provider implementation must introduce a separately reviewed environment-specific contract and managed secret custody rather than relaxing this sentinel in place.

## Consent model

An eligible send needs current, append-only evidence of:

- recipient identity and destination verification;
- channel `sms`;
- message purpose and consent version;
- affirmative actor action, timestamp, jurisdiction/locale, disclosure version, and source surface;
- withdrawal/suppression state;
- quiet-hour timezone basis and frequency-policy version;
- template/version and allowed variables;
- exact household/case/relationship scope when applicable; and
- the external-action intent, budget/control recheck, attempt, provider response, and reconciliation lineage.

Consent evidence contains no raw message, secret, OTP, safe word, or Check content. A destination should be encrypted/minimized and excluded from analytics, logs, job payloads, idempotency keys, and owner attention.

### Withdrawal

- Recipient withdrawal is available even after an entitlement, relationship, or membership lapses.
- `STOP` or an equivalent inbound provider classification appends suppression evidence immediately and blocks new work before dispatch.
- Pairwise relationship withdrawal does not silently become channel-wide consent withdrawal, but it blocks relationship-purpose messages.
- Re-enrollment requires a recipient-originated action and the current disclosure; an administrator cannot clear another adult's suppression.
- Necessary one-time privacy/security notices, if legally permitted, require a separately reviewed purpose and cannot be used as marketing.

## Initial referral invitation

BoomerBuddy does not send the first referral message. The product may expose:

- native OS share sheet;
- native SMS composer with safe draft text;
- native email composer with safe draft text; or
- copied, short-lived, attribution-bounded referral link.

The link contains no phone/email, Check content, household name, or permission. Opening it does not create a relationship, consent, reward, or message eligibility. The recipient must create/bind their own account, accept the exact invitation/relationship, and separately opt in to any BoomerBuddy messaging.

## Future adapter flow

The adapter may be enabled only after the Stage 0 external-action and cumulative-budget seams are independently closed.

1. Create a content-free notification intent and immutable template/version.
2. Transactionally recheck current recipient, purpose consent, suppression, relationship/case scope, quiet hours, frequency counters, global stop, cumulative caps, and external-action envelope.
3. Claim one short-lived dispatch capability. No database transaction stays open across the network call.
4. Send with the deterministic provider idempotency/reference strategy supported by the exact Twilio API; never claim generic exactly-once delivery.
5. Record provider acceptance, timeout/unknown, or pre-dispatch failure through the immutable external-action attempt.
6. Reconcile status callbacks and provider queries; accepted is not delivered, and a timeout is not safe to blind-retry.
7. Append delivery/failure/unknown/suppression evidence and update customer-facing state without losing the provider event.
8. Escalate prolonged unknown, signature mismatch, destination mismatch, or suppression conflict to owner attention.

Only code-owned template IDs and typed variables may cross the adapter. Free text, raw Check content, secrets, and arbitrary URLs are forbidden.

## Inbound webhooks

Twilio signs inbound requests with `X-Twilio-Signature` using the exact externally visible URL and request parameters. The future route must validate the evolving parameter set with Twilio's maintained server SDK, reconstruct the URL through a bounded trusted-proxy configuration, reject signature failures generically, enforce body/parameter limits, and persist a deduplicated inbox before processing. See [Twilio webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

Required negative cases:

- missing, malformed, wrong-account, wrong-URL, altered-parameter, duplicate, oversized, and stale/replayed requests;
- forged forwarded host/scheme/address outside the trusted proxy topology;
- status callback for the wrong provider message/recipient/action;
- reordered callback states and a later authoritative terminal state;
- provider timeout before or after acceptance;
- repeated inbound STOP/HELP/START; and
- content/secret leakage in logs, errors, audit, jobs, analytics, and owner attention.

## STOP, START, HELP, and suppression

Twilio documents standard opt-out behavior and, for Messaging Services, an `OptOutType` webhook field for configured opt-in/opt-out/help keywords. Toll-free senders have special carrier handling; only the reviewed sender configuration should be treated as evidence. See [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out) and [Messaging Services](https://www.twilio.com/docs/messaging/services).

For the first test:

- use only founder-designated test destinations;
- prove STOP blocks both application dispatch and provider delivery;
- prove START/UNSTOP can restore only after the recipient-originated event and current BoomerBuddy consent policy permits it;
- prove HELP returns the approved sender/support/STOP information without sensitive data;
- do not double-send a reply when Twilio/carrier already supplied the configured opt-out response;
- preserve suppression through account/relationship/entitlement changes and restore; and
- test provider and BoomerBuddy suppression disagreement fail-closed.

## Quiet hours and frequency

The founder and qualified reviewer must approve geography-specific rules. Until then, the proposed fail-closed default is:

- no automated send when recipient timezone is unknown;
- no non-urgent send outside a conservative recipient-local window;
- no marketing/referral automation at all;
- purpose-specific daily/weekly limits plus a global recipient limit;
- transactional/fraud alerts still require an approved urgency class and must not be mislabeled to bypass limits; and
- deferred jobs recheck consent, suppression, time, frequency, budget, and stop before dispatch rather than relying on enqueue-time authority.

Frequency reservations must be concurrency-safe so several individually valid jobs cannot exceed a cumulative recipient cap.

## Test matrix before `test_proven`

### Provider-free local candidate evidence

The local candidate has focused deterministic evidence for:

- production runtime rejection and production worker composition with zero messaging handlers;
- encrypted synthetic destination storage with no raw destination in intents, jobs, or delivery evidence;
- purpose-matched fixed templates, unknown-timezone and quiet-hours fail closure, STOP suppression, START restart-request semantics, self-withdrawal after membership loss, membership/destination/scope rechecks, global stop, purpose/global caps, and idempotent terminal local outcomes;
- two local dispatch transactions racing the final purpose slot, producing one allowed local outcome and one cap denial under the PGlite fixture;
- content-free deduplicated STOP/START/HELP fixtures, with HELP intentionally producing no reply;
- bounded support content minimized and encrypted into the exact open assigned case, unrelated employee denial, exact-purpose step-up restricted-access grant, same-transaction access evidence, and one-hour active-store erasure evidence atomically paired with ciphertext removal;
- exact-recipient local intent status and exact-current-support-assignee content-free intake metadata, without destination or message-body projection;
- database rejection of provider-network enablement, append-only evidence mutation, chain revision skipping, and destination mutation; and
- an initial-invitation helper that accepts no destination/recipient/contact list and returns only a user-device share/composer draft with automatic send and contact upload explicitly forbidden.

These are code and local-simulation results only. Shared composition now exposes a non-production member consent laboratory, authenticated self-only destination/status/consent routes, exact-assignee content-free HQ metadata and JIT-read routes, a device-owned invitation share sheet, and the provider-free worker handler plus local retention. Production navigation omits these surfaces and production composition installs zero messaging handlers. No public inbound-fixture route, customer intent-creation route, provider callback, renderer, sender, credential, provider URL, or network operation exists. See ADR 0026.

Shared authorization now explicitly carries `messaging_inbound` through the domain, authorization, and persistence session unions. Session and policy regressions prove exact-event projection, cross-resource denial, expiry/assignment removal, and purpose-specific repository enforcement. This closes the local type handoff; it does not prove a provider identity, production employee session, managed database role, or deployed edge.

### Still-blocked provider and deployed matrix

The following cases are required future evidence; none is claimed by the local candidate:

- Valid signed inbound support message into the exact assigned case; unrelated employee denied.
- STOP/START/UNSTOP/HELP with append-only consent/suppression evidence and no duplicate response.
- Outbound service notification to one approved test destination with current consent.
- Consent revoked, relationship withdrawn, membership lapsed, destination changed, suppressed, quiet-hours, frequency-limit, global-stop, stale budget/control, wrong tenant, and wrong template denial.
- Two workers racing one action produce one provider intent/acceptance lineage.
- Timeout before dispatch releases authority; timeout after possible acceptance becomes outcome unknown and is not blindly retried.
- Late accepted/delivered/failed callback remains recordable and reconciles cost/effect truth.
- Duplicate/reordered callbacks, provider outage, worker crash/restart, dead letter/replay, and database restore.
- No raw destination/message/secret in telemetry or internal evidence.
- External provider Dashboard/log and BoomerBuddy intent/attempt/job/consent/suppression states reconcile.

Label deterministic fixtures `local_simulation`; a Twilio test-account journey `provider_test`; a deployed callback `deployed_staging`; and a permitted real customer send `live_production`. Never promote one level to another by inference.

## Founder-only activation gate

- [ ] Toll-free sender/application and Messaging Service approved for the exact use case.
- [ ] Company account ownership, MFA, recovery, subaccount separation, spend ceiling, and alerting reviewed.
- [ ] Qualified communications/privacy review retained for geography, consent language, templates, quiet hours, frequency, retention, and support coverage.
- [ ] Managed identity/KMS, PostgreSQL/restore, trusted edge, monitoring, incident, and provider outage evidence passed.
- [ ] Stage 0 budget and external-action seams independently passed; no blind retry of unknown effects.
- [ ] Authentic provider-test matrix retained with approved test recipients only.
- [ ] Founder approves the exact channel, template set, cohort, support window, and maximum spend.
- [ ] Founder separately authorizes enabling the bounded live sender.

Run 3 has not satisfied or exercised the live activation item.

## Current disposition

The legacy executable notification sink remains `local_test`. The new Stage 6 core can execute only a content-free, non-production local governance simulation; it renders and sends nothing. Its shared local routes, customer laboratory, exact-assignee HQ boundary, and worker composition remain unavailable in production, and external channels remain blocked. Founder account/toll-free work is status input, not retained evidence. No Twilio credential was requested or stored, no provider URL or API was used, and no real person was messaged.
