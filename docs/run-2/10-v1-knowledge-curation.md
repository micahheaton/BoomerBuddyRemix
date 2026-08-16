# V1 Knowledge Curation

Status: **governance schema and two 2.0 source-verified drafts implemented; V1 migration and runtime activation remain blocked**.

## Curation boundary

`reference/boomerbuddy-v1/` remains read-only research. BoomerBuddy 2.0 does not import or execute its runtime code or data. V1 scam types and source registries may only inspire a newly authored proposal with independent source, rights, domain, and editorial review.

Run 2 adds immutable versioned knowledge assets with locale, jurisdiction, lifecycle, review state, publisher/URL/retrieval date, rights basis, authoring version, content digest, and an enforced `v1_runtime_import = false` marker. Reviews record reviewer reference, kind, decision, notes, and time. Runtime eligibility requires an active, independently reviewed asset; source, domain, and rights approvals; and at least two distinct approving reviewers.

## Material progress

Migration `0004_run2_intelligence_public.sql` seeds two **draft, source-verified, not runtime-eligible** 2.0 assets:

- government impersonation, paraphrased from the US Federal Trade Commission; and
- gift-card payment warnings, paraphrased from the US Federal Trade Commission.

Each has one source approval only. Tests in `packages/persistence/src/public-checks.test.ts` prove source-verified drafts stay out of runtime, independently reviewed 2.0 assets can become eligible, and intelligence evidence is append-only. `packages/persistence/src/knowledge.ts` also validates HTTPS source URLs, content schema, hashes, version uniqueness, and the independent-review threshold.

## Missing proof

No V1 candidate inventory has been fully curated, no bulk proposal tool or HQ governance screen exists, and neither seeded draft has domain or rights approval. Source currency, jurisdictional applicability, exact reuse rights, expert review, deprecation/review cadence, and a broad taxonomy are **blocked by source evidence and professional/human review**.

Asset counts are not quality, calibration, or moat evidence. Nothing here supports public safety claims or automated publishing. Run 2 does not launch. See [ADR-0019](../adr/0019-governed-v1-curation-and-evaluation-evidence.md).
