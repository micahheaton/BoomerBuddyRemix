# Legal and Compliance Issues

Status: **issue map prepared 2026-08-15; not legal advice and not a compliance certification**. Build Run 1 uses synthetic/local data and no real commerce or communications. Qualified counsel must resolve the launch-state, customer-state, modality, and partner-specific questions below.

## Product rules created by the issue map

Legal disclaimers do not cure unsafe design or unsupported claims. BoomerBuddy must disclose that it is not a bank, attorney, emergency service, identity proof, or guarantee against loss; distinguish observations from inference; say when evidence is unavailable; and never call a result “safe.” Public claims need an owner, primary evidence, scope, date, expiry/review date, and permission for third-party names.

Consent to account terms is not consent to share an artifact, involve family, record audio, market, train a model, or create an evaluation fixture. Each purpose needs a separately evidenced basis. The protected person’s revocation stops future Trusted Circle access; payer, kinship, age, sponsorship, and household ownership do not override it.

## Issue register

| Area | Why it matters | Required disposition before exposure |
|---|---|---|
| Privacy and sensitive communications | California describes email/text contents and financial credentials as sensitive personal information. CCPA applicability has thresholds, but falling below them does not make collection safe or eliminate other state laws. | Data map; notice at collection; purpose/retention schedule; processor contracts; authenticated access/correct/delete/export; sale/share and targeted-ad review; state-law matrix; breach plan. Do not reuse submissions for evaluation or training by default. |
| Consumer-protection and safety claims | Fraud verdicts, prevention claims, testimonials, partner logos, AI/voice claims, and “official” contacts can mislead or cause reliance. | Counsel and safety review for claim substantiation; evidence register; expiry; permission; prominent limitations; deterministic, verified-channel actions. No prevented-loss or accuracy claim from Run 1 fixtures. |
| Auto-renewal and cancellation | Federal negative-option requirements are changing, while state and app-store rules also apply. | Recheck the live FTC docket and launch-state laws; clear price/renewal/trial terms before consent; affirmative consent evidence; receipt; simple cancellation; refund/grace policy; lifecycle reconciliation. |
| Mobile-store billing | Apple and Google generally require their billing systems for in-app digital access, with changing storefront/program exceptions. | Current policy/counsel review per build and region; store-specific disclosures and restore/manage-subscription paths; provider-neutral entitlements; no web/store double grant. |
| Payments, tax, and PCI DSS | Using hosted checkout can reduce card-data scope but does not automatically remove merchant responsibilities or all SAQ eligibility conditions. Taxability and nexus vary. | Keep card data out of BoomerBuddy; signed/idempotent webhooks; annual scope assessment with an assessor as appropriate; accountant/tax review; refunds/disputes/reconciliation controls. |
| Email, SMS, push, and calls | Commercial email, texts, automated calls, carrier rules, consent, opt-out, quiet-hours, and emergency expectations differ by channel and jurisdiction. | Run 1 sends nothing. Before enabling: classify transactional/marketing purpose, record channel-specific consent/source, suppress promptly, honor CAN-SPAM and applicable telemarketing/TCPA/state rules, vendor registration, quiet hours, rate limits, abuse handling, and counsel-reviewed templates. |
| Audio, calls, and biometrics | Recording consent varies by jurisdiction. Voice-clone detection may be inaccurate and biometric laws may apply if voiceprints identify people. | No recording or voice identity in Run 1. Obtain jurisdiction-specific advice, clear just-in-time consent, retention/deletion, vendor terms, and separate evaluation. Never call model output proof of identity or synthetic origin. |
| Accessibility | Older-adult focus increases the harm of inaccessible flows. DOJ states ADA obligations apply to public-facing goods/services; WCAG 2.2 is the engineering target, not a legal safe harbor. | Automated plus manual keyboard, screen-reader, zoom/reflow, contrast, cognition, error-recovery, and real-device tests; accessible support and legal content; named remediation owner. |
| AI transparency and provenance | California AB 853 became operative August 2, 2026 for covered GenAI providers over its statutory scale threshold and adds later platform duties. Other AI rules are evolving. | BoomerBuddy does not train or expose a foundation model in Run 1. Counsel must reassess product role, user scale, model output modality/provenance, notices, vendor duties, and jurisdiction before enabling generative or synthetic-media features. Do not assume an exemption. |
| Financial-institution and sponsor channel | Credit unions remain responsible for third-party due diligence and legal/regulatory compliance. Partner data can implicate GLBA, security, records, accessibility, marketing, incident, audit, and subcontractor terms. | No logo or relationship claim without permission. Before a pilot: data-flow and role analysis, DPA/security packet, aggregate-only reporting policy, incident/SLA/exit terms, subcontractor list, insurance and counsel review. Sponsored access never grants artifact visibility. |
| Intellectual property and data rights | Scam corpora, threat feeds, OCR/model outputs, marketing assets, app names, and open-source packages carry license and trademark constraints. | Trademark/name clearance before brand spend; corpus/fixture provenance; commercial-use rights for every feed; OSS inventory/SBOM/notices; takedown and editorial correction process. Free Google Safe Browsing is not a commercial shortcut. |

## Counsel gates

1. **Before external beta:** approve privacy/terms/claims, consent records, retention/deletion, incident notices, accessibility plan, evaluation-data rights, and supported jurisdictions.
2. **Before first dollar:** approve checkout/renewal/cancel/refund/tax flows, app-store packaging, PCI scope, customer support promises, and evidence for every paid claim.
3. **Before communications or audio:** approve each channel, consent language, suppression, recording jurisdiction, biometric analysis, retention, and vendor contract.
4. **Before B2B/B2B2C:** approve organization/customer roles, GLBA and partner obligations, reporting privacy thresholds, security addendum, insurance, records, audit, breach/SLA, and exit/portability.

Owners must record jurisdiction, counsel, conclusion, source, decision date, next review date, and product/control changes. A checkbox saying “legal reviewed” is insufficient.

## Primary evidence

Accessed 2026-08-15:

- [California Attorney General: CCPA](https://oag.ca.gov/privacy/ccpa)
- [FTC advertising guidance for small businesses](https://www.ftc.gov/business-guidance/resources/advertising-faqs-guide-small-business)
- [FTC Negative Option Rule docket](https://www.ftc.gov/legal-library/browse/rules/negative-option-rule)
- [FTC CAN-SPAM compliance guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- [DOJ guidance on web accessibility and the ADA](https://www.ada.gov/resources/web-guidance/)
- [California AB 853, Chapter 674](https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260AB853)
- [PCI SSC: hosted payment-page SAQ eligibility](https://www.pcisecuritystandards.org/faqs/if-a-merchant-s-e-commerce-implementation-meets-the-criteria-that-all-elements-of-payment-pages-originate-from-a-pci-dss-compliant-service-provider-is-the-merchant-eligible-to-complete-saq-a-or-saq-a-ep/)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en)
- [NCUA: evaluating third-party relationships](https://ncua.gov/regulation-supervision/letters-credit-unions-other-guidance/evaluating-third-party-relationships)
