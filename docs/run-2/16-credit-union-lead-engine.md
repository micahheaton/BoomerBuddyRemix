# 16 — Credit-Union Research Engine

Status: **the official fixed-snapshot importer, deterministic segmentation, CRM organization creation, owner-only target API, and HQ filtering UI are implemented and tested; contacts, intent, enrichment, and outreach are absent**.

## Exact Run 2 import evidence

The 2026-03-31 NCUA archive was processed from the official active-research files with archive SHA-256:

`6D7FDF1E7EAF9078B33A498BE966163E07E368949DBBDF3736527842C51F7567`

The importer joined `FOICU.txt` institution facts to `FS220.txt` metrics by charter number, required the expected cycle on both sides, and retained source type codes `1` and `2`. The resulting fixed universe contained **4,250 federally insured credit unions**, **145,766,660 reported memberships**, and **748 institutions with at least $500 million in reported assets**. Member segments were:

| Reported memberships | Institutions |
| --- | ---: |
| Under 10,000 | 2,771 |
| 10,000–49,999 | 950 |
| 50,000–249,999 | 428 |
| 250,000+ | 101 |

Those exact counts reconcile to the official public summary’s rounded 145.8 million memberships and 4,250 institutions. Memberships are accounts across institutions, not unique people, reachable users, or TAM. The source and limitation are registered in the [Gauntlet Zero evidence register](../gauntlet-zero/44-source-and-evidence-register.md) and [credit-union strategy](../gauntlet-zero/20-credit-union-strategy.md).

## Implemented mechanics

The CLI requires a local archive and extracted files, computes the archive hash itself, permits only an HTTPS `ncua.gov` source URL, and records cycle, URL, hash, download/import time, and row count. Import is idempotent by cycle/hash and emits audit/outbox evidence. Each row becomes a provenance-linked CRM organization.

Fit is a transparent size hypothesis. Membership bands contribute 10–35 points; reported asset bands contribute 0–20. HQ can filter the latest imported snapshot by segment and minimum score. Every API item is labeled `official_fixed_snapshot`, `intentClaimed: false`, and “Fit is explainable segmentation, not buyer intent.”

Evidence: [parser/scoring](../../packages/business-os/src/credit-unions.ts), [ingest CLI](../../scripts/ingest-ncua-credit-unions.ts), [repository](../../packages/persistence/src/business-os.ts), [API contract](../../packages/contracts/src/business-os.ts), and [integration test](../../tests/integration/business-os-api.test.ts).

## Boundary and next evidence

This is a research universe, not 4,250 leads. It contains no verified decision-maker, email, phone, budget, incumbent, age mix, consent, interest, or permission to solicit. No account was contacted and no lead score predicts purchase. Refresh is manual; there is no scheduled download or source-change alert.

Run 3 should select a small geography and design-partner hypothesis, manually verify official institution websites and roles, record field-level provenance, run authorized discovery—not campaigns—and stop unless independent interviews confirm an owner, budget path, acceptable data scope, and renewal measure. NCUA does not approve BoomerBuddy or its vendors.
