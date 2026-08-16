# ADR-0004: Encrypt Sensitive Artifacts and Use Keyed Fingerprints

Status: **Accepted for Build Run 1; production KMS deferred**

Decision date: 2026-08-15

## Context

Messages and URLs can expose finances, relationships, credentials, and victimization. Encryption at disk level does not protect against broad application access. A plain digest of a common message or URL can be guessed offline.

## Decision

Minimize and separately lifecycle content, structured evidence, history, analytics, and audit. A bounded transient detector first rejects or redacts recognizable private-key blocks, Luhn-valid payment-card numbers, credential/authorization tokens, and one-time-code patterns after deriving only non-sensitive safety flags. Those values never enter persistence, fingerprints, logs, audit, outbox, analytics, fixtures, or provider/model prompts. Build Run 1 field-encrypts only the remaining restricted content with AES-256-GCM, a unique nonce, and a versioned local development key. AES-GCM additional authenticated data is an unambiguous length-prefixed encoding of tenant ID, artifact/resource ID, field purpose, schema version, and encryption-key version; decryption reconstructs and verifies the same context.

Duplicate/evidence correlation uses `content_fingerprint`, a keyed HMAC over an unambiguous encoding of tenant, purpose, and the minimized bytes. It uses a separate versioned, rotating key—not the encryption or safe-word key. Schema and contracts carry `fingerprint_key_version`; legacy unkeyed artifact-digest fields are prohibited. Fingerprints never enter analytics or provider requests. Rotation supports bounded current/previous-key lookup and audited re-fingerprinting before retirement.

Safe words use a separately salted memory-hard verifier, constant-time comparison, throttling, and replacement rather than retrieval. Logs, events, errors, and support projections exclude content, URLs, ciphertext, destinations, tokens, and fingerprints unless a narrowly documented security purpose requires one.

## Consequences

A database leak does not enable simple dictionary comparison of common submissions; same content differs by tenant/purpose. Key management and rotation are more complex, and deleting/re-encrypting/re-fingerprinting derived material must be tested. Build Run 1 keys are development controls, not production assurance.

Rejected: plaintext, storage encryption alone, deterministic encryption, unsalted/unkeyed digests, shared-purpose keys, and automatic corpus reuse.

## Verification

Tests cover secret-pattern rejection/redaction across database/log/audit/outbox/provider boundaries, nonce uniqueness, tamper failure, ciphertext swaps, wrong AAD, and cross-tenant/resource/field context confusion. They also cover key separation/versioning, cross-tenant fingerprint inequality, deletion, and production refusal without KMS-ready configuration.

Primary standards accessed 2026-08-15: [NIST SP 800-38D for GCM](https://csrc.nist.gov/pubs/sp/800/38/d/final) (a revision is underway) and [NIST FIPS 198-1 for HMAC](https://csrc.nist.gov/pubs/fips/198-1/final) (NIST has proposed moving it to SP 800-224). Implementations must track the final revisions rather than freezing these publication versions as vendor requirements.
