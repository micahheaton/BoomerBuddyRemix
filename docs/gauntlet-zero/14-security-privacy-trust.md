# Security, Privacy, and Trust

Status: **architecture designed on 2026-08-15; Build Run 1 can prove selected controls, but the first-dollar security gate remains later**.

## Boundary and principles

BoomerBuddy will hold messages about money, family, credentials, fear, and possible victimization. Treat artifact content as restricted data. Minimize first, encrypt what remains, deny access by default, make sharing explicit, and make deletion observable. The v1 public analysis endpoints, self-admin update, object-level sharing failures, authenticated service-worker cache, and PII logging are regression requirements—not architecture to preserve.

Security decisions follow the current [NIST Digital Identity Guidelines](https://www.nist.gov/publications/nist-sp-800-63-4-digital-identity-guidelines), OWASP ASVS/API guidance, and a product-specific threat model. Framework conformance is not claimed until independently verified.

## Identity, sessions, and authorization

- Production identity is bought from a managed OIDC/OAuth provider after vendor review; do not build passwords, MFA, passkeys, recovery, or breach monitoring in-house.
- Build Run 1 uses only allow-listed seeded personas. Browser development sessions use distinct signed, HttpOnly customer and HQ cookies. Mobile cannot rely on that browser contract: it uses an opaque, audience-scoped, expiring, revocable development bearer whose server-side session resolves the actor and current roles. Native stores the bearer through Expo SecureStore; Expo web keeps it in memory only. Native storage behavior is **device-unverified** on this Windows host. Production refuses every development issuer and token type.
- Customer web, mobile, and HQ use distinct clients/audiences. An employee identity is not a customer administrator. HQ requires production MFA/step-up and cannot reuse a consumer cookie or mobile bearer.
- The server derives the principal from the verified session. Client-supplied user, role, household, organization, payer, or entitlement identifiers are lookup inputs—not authority.
- A central policy evaluates `(principal, session audience, action, resource, tenant, relationship, consent, entitlement)`. Every repository method requires an authorized scope and includes tenant/resource predicates. Foreign keys, uniqueness, lifecycle constraints, and opaque IDs add defense. Cross-tenant negative tests cover read, list, update, delete, invite, share, and indirect relationships.
- PostgreSQL row-level security is a future defense-in-depth option, not a substitute for application policy; a single privileged service role can bypass it and complex policies require dedicated testing.

Sessions rotate after authentication/privilege change, use Secure cookies in deployed environments, explicit SameSite behavior, trusted-origin/anti-CSRF controls for cookie mutations, bounded idle/absolute lifetimes, and per-device revocation. Sensitive changes—Trusted Circle permissions, safe-word replacement, export, deletion, payout/refund, employee access—require recent/step-up authentication.

## Data protection and minimization

| Class | Examples | Handling |
|---|---|---|
| Restricted | raw artifact, transcript, attachment, safe-word verifier, recovery evidence | Collect only for a named purpose; field/envelope encrypt; never analytics/logs/events; private by default; shortest retention; JIT human access only. |
| Confidential | identities, contact destinations, consent, household relationships, support case, provider IDs | Encrypt in transit/at rest; scoped access; redact logs; limited vendor transfer. |
| Internal | audit metadata, provider health/cost, evaluation aggregate, HQ pipeline | Employee role/tenant controls; no customer content; retention policy. |
| Public | approved education, pricing, trust/legal pages | Editorial source/claim review and change history. |

Build Run 1 uses AES-256-GCM authenticated encryption with a configured local development key and a distinct nonce per value. Additional authenticated data is an unambiguous length-prefixed encoding of tenant ID, artifact/resource ID, field purpose, schema version, and encryption-key version; tests reject ciphertext swaps and wrong tenant/resource/field context. Artifact/input duplicate fingerprints use a separate tenant- and purpose-scoped HMAC key, record a key version, and are never unkeyed digests: short messages and common URLs are guessable. Schema names are `content_fingerprint` and `fingerprint_key_version`; legacy unkeyed-digest fields are prohibited. Production requires a cloud KMS/envelope-key design, strict separation and rotation for encryption/fingerprint keys, versioned ciphertext, a re-encryption/re-fingerprinting procedure, separate environments, and restore testing. Safe words use a separately salted memory-hard verifier, constant-time verification, attempt throttling, replacement—not retrieval—and never enter logs or analytics.

Minimization precedes persistence and fingerprinting. A bounded transient detector rejects or redacts recognizable private-key blocks, Luhn-valid payment-card numbers, credential/authorization tokens, and one-time-code patterns after deriving only the minimum non-sensitive safety signal. Those values never reach the database, keyed fingerprint input, logs, audit, outbox, analytics, fixtures, or model/provider prompts. Detection limits and false positives are visible; encryption is not permission to store a secret.

Do not log raw URLs, query strings, artifact text, destination email/phone, tokens, cookies, ciphertext, model prompts/output, or database rows. Use opaque IDs, enumerated failure reasons, counts, latency, provider/version, and correlation IDs. Error responses reveal no existence across tenant boundaries.

## Retention and rights

Retention is policy-versioned and purpose-specific. Working hypotheses requiring counsel/user research before launch:

- raw text/URL artifacts: user-controlled immediate deletion, with a short default no longer than 30 days;
- structured Check history: retain while the account needs it, with a content-minimized view and deletion control;
- temporary uploads/extension handoffs: delete on completion/failure and expire within hours;
- evaluation: separate licensed/synthetic/explicitly consented corpus; never automatic reuse of submissions;
- security/consent/commerce records: metadata-only periods set with counsel/accounting, not the artifact lifetime;
- encrypted backups: bounded rolling window, documented deletion lag, tested restore, and eventual purge.

Export and deletion are authenticated asynchronous workflows with request state, scope preview, legal-hold exception, processor propagation, completion evidence, and safe retry. Deletion cryptographically erases applicable artifact keys where feasible and removes search/cache/derived copies; audit retains only the minimum proof. Account deletion cannot silently erase financial records that law requires retaining, and that exception must be disclosed.

## Employee and vendor access

HQ lists metadata and redacted evidence by default. Restricted content requires a support/review case, verified need, recent MFA, explicit user consent or documented emergency/legal basis, time-bound grant, reason, visible access banner, immutable audit, and periodic review. No hidden “log in as user”; support can guide or use separately authorized diagnostic views. Production database access is rare, time-bound, and logged.

Before a vendor receives content, record purpose, exact fields, region/subprocessors, retention/deletion, training/use rights, breach terms, availability, export, and exit plan. Send the minimum representation. Provider failure must not create fake success. SDKs with broad device collection are disallowed until reviewed.

## Platform and operational controls

- Typed configuration; secret manager in production; no secrets in source, client bundles, logs, or fixtures; rotation runbook.
- Parameterized queries, schema validation, output encoding, CSP/security headers, upload quarantine, and zero URL fetching in Run 1.
- Rate limits by principal/IP/device/risk operation, payload/concurrency ceilings, abuse signals, and non-enumerating responses.
- Transactional audit/outbox, signed/idempotent webhooks, immutable security events, synchronized time, and content-free telemetry.
- Separate local/staging/production data and credentials; least-privilege service identities; dependency/SBOM scanning and protected releases.
- Encrypted backups, defined RPO/RTO before launch, restore drills, provider outage modes, incident severity/on-call/notification playbooks, and post-incident learning.

## First-dollar security gate

Build Run 1 is not launch approval. Before charging: production identity/MFA/recovery; KMS/rotation; privacy notice/retention/export/deletion; secure backup/restore; monitoring/alert ownership; incident and breach-response drill; vendor/DPA review; dependency and external penetration review; manual mobile/web accessibility testing; fraud/action release thresholds; support JIT workflow; and no unresolved critical/high findings. Use OWASP ASVS as a verification catalog and preserve test/report evidence.

## Evidence

Accessed 2026-08-15:

- [NIST SP 800-63-4 Digital Identity Guidelines](https://www.nist.gov/publications/nist-sp-800-63-4-digital-identity-guidelines)
- [OWASP API1:2023 Broken Object Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/)
- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/)
- [NIST Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final)
- [NIST Privacy Framework](https://www.nist.gov/privacy-framework)
- [PostgreSQL row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
