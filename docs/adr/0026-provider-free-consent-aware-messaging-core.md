# ADR 0026: Provider-Free Consent-Aware Messaging Core

- Status: Accepted for the Run 3 local candidate
- Date: 2026-08-17

## Context

Stage 6 needs a consent-aware communication foundation without implying that BoomerBuddy has a Twilio adapter, a verified sender, a reachable webhook, provider delivery evidence, permission to contact an invitee, or authority to send a live message. The codebase already has tenant-aware encryption and keyed fingerprints, recipient and employee identities, household membership, exact support-case assignment, restricted-access grants, durable jobs, and local-only worker composition patterns.

The founder-owned provider account, toll-free verification, exact consent language, geography rules, trusted callback edge, managed secret custody, qualified review, approved test recipients, external-action lineage, provider idempotency behavior, delivery reconciliation, and production activation remain external or founder gates.

## Decision

Implement a bounded provider-free core in migration `0021_run3_consent_messaging.sql` and isolated domain, contract, persistence, and worker-composition modules:

- label every executable record `local_simulation`; constrain transport to `none`, provider network permission to `false`, and external-action operation linkage to `NULL`;
- accept only synthetic U.S. local fixture destinations, encrypt each destination with field-bound AES-256-GCM, retain only a keyed fingerprint for duplicate control, and make destination evidence append-only;
- make consent recipient-self-authored, channel- and purpose-specific for customer care, account service, or fraud safety, with immutable disclosure/policy digests and append-only withdrawal evidence;
- preserve channel-purpose suppression independently of household membership, make STOP immediately suppress all implemented purposes, treat START only as a recipient restart request, and require current consent interaction before reactivation;
- permit withdrawal after membership or entitlement loss, while rechecking exact active recipient membership, current destination, exact household or open assigned support-case scope, consent, suppression, timezone, quiet hours, frequency, and global stop at dispatch;
- use fixed code-owned, versioned, digest-bound, non-urgent templates containing sender identity and STOP/HELP instructions; arbitrary content, arbitrary URLs, provider identifiers, and raw destination data never enter an intent or durable-job payload;
- serialize purpose and global daily/weekly counters under database row locks, advance each counter by exactly one, and terminally record only `local_simulated` or `governance_blocked` outcomes;
- keep STOP, START, and HELP fixtures content-free and deduplicated; HELP records `help_observed_no_reply` because no outbound provider is present;
- accept bounded local support text only into the exact open case opened by that recipient and assigned to a current internal `hq_support` employee, minimize before encryption, hard-discard unsafe payloads, require an exact active step-up restricted-access grant for a same-transaction read audit, and erase active-store ciphertext after one hour with matching append-only evidence applied in the same transaction;
- expose only content-free local intent status to the exact recipient identity and content-free support intake metadata to the exact current internal case assignee; neither projection returns a destination or message body;
- install the content-free `messaging.local-simulate` handler only through an explicit non-production composition; production composition returns no handler and the module contains no provider or network adapter;
- expose a typed initial-invitation draft helper only for a native share sheet, SMS composer, email composer, or copied text, with `deliveryAuthority='user_device_only'`, `requiresUserGesture=true`, `automaticSendPermitted=false`, and `contactUploadPermitted=false`; it accepts no recipient or destination; and
- expose only non-production self-service destination/status/consent routes and exact-assignee HQ metadata/JIT-read routes; register the provider-free handler and active-store retention only in the shared worker's local branch; keep inbound fixtures, intent creation, provider callbacks, outbound rendering/sending, and external-action attempts unavailable;
- compile a local member consent laboratory and device-owned invitation share sheet out of production, request no contacts permission, and never accept a recipient destination for invitations; and
- reserve `BB_TWILIO_*` configuration names while accepting only `BB_TWILIO_MODE=disabled`; any credential, callback URL, or non-disabled mode fails configuration loading.

The local quiet-hours fixture allows non-urgent evaluation only from 09:00 through 19:59 in the recipient timezone. The implemented purpose/global limits are conservative test policy, not a legal or production communications policy.

Shared session integration now includes `messaging_inbound` in the domain, authorization, and persistence unions. Focused session resolution proves an exact active grant is projected only while the case, assignment, employee, organization, assurance, status, and expiry remain current; authorization tests deny a different event or resource type. The HQ read route derives the resource scope from that authenticated projection and the repository independently repeats the exact case/assignment/grant checks under locks before decrypting and auditing the read.

## Consequences

The repository can prove local schema constraints, encryption, append-only consent and suppression, self-withdrawal after membership loss, STOP-before-dispatch, START-without-transferred consent, content-free worker payloads, transactional dispatch rechecks, cumulative caps, exact support authorization, minimized-content JIT access, and active-store timed erasure without using a URL, credential, provider API, phone network, or real recipient.

A `local_simulated` delivery event means only that the local governance transaction reached its allowed terminal state. It is not evidence that content was rendered, queued at a carrier, accepted by Twilio, delivered, seen, or reconciled. A local inbound fixture is not a signed webhook. PGlite serialization evidence is not managed-PostgreSQL concurrency or recovery evidence. Nulling active-store ciphertext does not prove deletion from backups, logs, snapshots, processors, or a recoverable shared master key.

Initial invitation draft construction is not a send action. A future UI must invoke only a native user-controlled share/composer surface, must not request contacts permission for this flow, and must never pass the draft to a BoomerBuddy transport. Opening an invitation continues to grant no relationship, consent, reward, or message eligibility.

Provider-test, deployed-staging, human-review, and live-production claims remain blocked until their exact evidence exists. Production and provider modes remain structurally disabled.
