# Accessibility Review

Status: **[IMPLEMENTED] automated web baseline; [BLOCKED] native and human validation.**

## Evidence from this run

The current Playwright project targets Desktop Edge and uses axe-core. On 2026-08-16 both accessibility test bodies reported `ok`:

1. An axe sweep of 12 landmark pages—five public customer pages, five authenticated member pages, HQ overview, and HQ fraud review—found zero serious or critical violations.
2. The critical Check journey verified keyboard entry through the skip link and navigation, focused the new result heading, announced the result through a polite live region, remained usable at 200% zoom and 320 CSS pixels, and disabled smooth scrolling under reduced-motion preference.

The broad sweep needed a 90-second per-test allowance on this constrained host; the standard 30-second attempt timed out during repeated axe scans rather than reporting a violation. Both test bodies passed on retry, but Playwright's local web-server teardown then lingered and required interruption. This supports the page assertions, not a claim of clean runner lifecycle on this host.

## Implemented baseline

- **[IMPLEMENTED]** Shared tokens specify 18px consumer body text, a 48px minimum target, strong text/risk colors, and a visible 3px focus ring.
- **[IMPLEMENTED]** Web and HQ include skip links, labeled navigation and forms, semantic tables/headings, status/error announcements, and non-color risk text.
- **[IMPLEMENTED]** Orientation progress exposes `progressbar` semantics; paginated history announces newly loaded records.
- **[IMPLEMENTED]** Mobile components use React Native accessibility roles, state, hints, live regions, secure-entry semantics, and comfortably sized controls.
- **[IMPLEMENTED]** ESLint includes JSX accessibility rules, and the design package rejects undersized target tokens.

## Remaining validation

- **[MOCK]** Seeded personas and synthetic Check content exercise routes only; they are not usability participants or assistive-technology evidence.
- **[SCAFFOLDED]** Expo screens share accessible tokens and semantics, but JavaScript structure is not device behavior.
- **[BLOCKED]** No Android emulator/device run was possible because Java/Android SDK tooling is unavailable; no iOS run is possible on this Windows host.
- **[DEFERRED]** VoiceOver, TalkBack, Windows screen-reader, switch/voice control, high-contrast, text-spacing, localization, and cognitive walkthroughs.
- **[DEFERRED]** Moderated usability testing with older adults, including low vision, tremor/dexterity limits, hearing loss, low digital confidence, and recovery under stress.

Automated axe results are necessary but not WCAG conformance or usability proof. Before first dollar, run the manual WCAG 2.2 AA protocol and older-adult task study defined in [Accessibility and Older-Adult UX](../gauntlet-zero/34-accessibility-senior-ux.md), and make the Edge suite exit cleanly in the intended CI host.
