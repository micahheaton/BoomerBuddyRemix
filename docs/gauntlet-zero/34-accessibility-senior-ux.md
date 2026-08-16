# Accessibility and Older-Adult UX

## Standard and product targets

Target WCAG 2.2 AA across consumer web and HQ, with selected AAA practices when they materially help older users. W3C requires 24×24 CSS-pixel minimum targets at AA; BoomerBuddy’s consumer default is 48×48, with 18px body text, visible focus, strong contrast, no color-only risk meaning, and layouts that survive 200% text scaling and 320px reflow. Sources: [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [Target Size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

## Interaction rules

- One primary action per urgent screen; use verbs such as “Check this message.”
- Pair risk color with text, icon, evidence, confidence, and next action.
- Never auto-advance, impose avoidable timeouts, or use motion as the only status cue.
- Make back, cancel, review, and error recovery obvious; preserve entered work safely.
- Support screen readers, keyboard control, reduced motion, dynamic text, voice control, and one-handed use.
- Authentication must permit password managers/passkeys and avoid memory puzzles.
- Plain language does not mean childish language.

## Test protocol

Automated checks (axe, semantic linting, contrast, keyboard tests) are release gates but not usability proof. Before launch, test core tasks with older adults across low vision, tremor/dexterity limits, hearing loss, screen-reader use, and low digital confidence. Validate share/paste, result comprehension, safe action, invitation consent, and recovery after an error at 200% text scaling.

## Build Run 1 acceptance

The critical Check path has labeled inputs, programmatic errors, logical focus, an announcement for result changes, at least 48px consumer controls, keyboard completion, reduced-motion behavior, and no known critical axe violations.
