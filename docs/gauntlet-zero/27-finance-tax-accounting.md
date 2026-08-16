# Finance, Tax, Accounting, and Administration

## Principle

HQ is a reconciliation and workflow surface over authoritative vendors. It is not a general ledger, bank, payroll processor, tax engine, or substitute for a CPA.

## Recommended systems boundary

- Commerce provider: checkout, invoices, payment method, refunds, disputes, payouts.
- Canonical BoomerBuddy entitlements: access state independent of provider.
- Accounting platform: chart of accounts, books, close, financial statements.
- Sales-tax service: nexus assessment support, calculation, filing workflow where contracted.
- Payroll/HR platform: employee payment, benefits, payroll tax, year-end forms.
- HQ: reconciliation status, exceptions, deadlines, unit economics, external record links, ownership, and audit.

## Required controls before first dollar

Separate test/live environments; idempotent signed webhooks; immutable provider event receipt; daily entitlement/payment reconciliation; refund and chargeback policy; clear renewal/cancellation disclosure; restricted refund permissions; accounting mapping; tax/counsel review; documented month-end procedure.

The FTC’s negative-option rule is again under rulemaking as of March 2026, so subscription cancellation requirements must be rechecked with counsel before launch rather than encoded from stale assumptions: [FTC Negative Option Rule](https://www.ftc.gov/legal-library/browse/rules/negative-option-rule).

## Build Run 1

Use a local commerce adapter and seeded lifecycle events only. Prove plan, seat, source, status, grace, and history; no real payment, bank, accounting, tax, or payroll connection.
