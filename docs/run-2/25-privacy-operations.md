# Privacy Operations

Status: **data-minimization controls and request intake implemented; end-to-end privacy fulfillment is not**.

## Implemented controls

Member Check input is safely redacted or rejected before analysis, then stored as AES-256-GCM ciphertext with tenant/resource/field/version additional authenticated data. Fingerprints use a separate scoped keyed digest. Secrets must be distinct. Logs recursively redact sensitive keys, credentials, private keys, one-time codes, card-like values, URLs, email, and phone values. Audit/outbox/job envelopes are content-free by contract.

Member Check content has a 30-day delete time. User deletion and retention purge null ciphertext, fingerprints, explanations, and actions while retaining only minimal operational proof. Public Check uses short-lived encrypted handoff state, explicit save consent, append-only conversion evidence, and physical anonymous-row purge after the terminal horizon. Attribution stores only allowlisted coarse aggregates.

Authenticated customer/mobile users can submit access, export, deletion, correction, or restriction requests. Intake records the subject, type, pending identity verification, received state, and a 30-day due date.

## Focused evidence

The final security selection passed 17 tests across five files. `tests/security/input-persistence.test.ts` inspects persistence/log boundaries; `tests/security/retention.test.ts` verifies destructive deletion and continuation; `tests/security/public-check-conversion.test.ts` verifies immutable save consent and content-free events. Security package tests cover encryption context, keyed fingerprints, minimization, and logger sanitation.

## Operational gaps

Privacy request intake does not yet verify identity, discover all subject data, export a package, propagate correction/restriction/deletion, record exemptions, send notices, or close a request. There is no processor inventory, retention schedule for every Business OS/commerce table, vendor DPA review, region decision, KMS/rotation, object-store lifecycle, backup deletion, legal hold, breach workflow, or qualified privacy review.

Those are **first-customer/first-dollar blockers** requiring managed infrastructure, selected vendors, legal/privacy professionals, and human operating procedures. The current code is a local control foundation, not a compliance certification or completed rights process. Run 2 does not launch.
