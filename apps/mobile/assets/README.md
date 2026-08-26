# BoomerBuddy mobile assets

These PNG files are deterministic renders of the canonical shield and check mark in
`apps/web/src/components/brand.tsx`. They use the shared design colors from
`packages/design/src/index.ts` and add no new brand mark, text, customer data, or provider asset.

Regenerate them from the repository root with `npm run mobile:assets`. Inspect the resulting icon,
adaptive icon, splash icon, and favicon before a signed build. Store screenshots and approval
receipts outside Git when they could contain provider or tester information.

The iOS/store icon and favicon are encoded without an alpha channel. The Android adaptive foreground
and splash mark intentionally retain transparent padding for platform composition.
