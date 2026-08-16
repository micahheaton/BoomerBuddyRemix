# Human Research Protocol

Status: **execution-ready protocol draft; awaiting founder authorization, professional review, recruitment, and external execution**

Protocol version: `run2-human-research-v1`

Prepared: 2026-08-16

## Purpose and truth boundary

This package tests comprehension, trust, consent, paired-family behavior, brand/price language, and credit-union buyer workflow. It is research—not customer support, marketing, fraud adjudication, a clinical assessment, commercial traction, or launch. No participant has been recruited and no finding exists.

Execution requires a founder-approved geography, language, budget, incentive, recruiting channel, device matrix, and research owner; privacy/legal and accessibility review; a non-public research build; synthetic task materials; and named safety and incident contacts. Recruitment, contact, recording, and incentives are external actions and require separate authorization.

Companion files:

- [Moderator Guides](./HUMAN-RESEARCH-MODERATOR-GUIDES.md)
- [Research Forms and Data Dictionary](./HUMAN-RESEARCH-FORMS.md)
- [Known Limitations](./32-known-limitations.md)
- [Run 3 Launch-Enablement Plan](./33-run-3-launch-plan.md)

## Research questions

1. Can an older adult obtain a useful Public Check result and choose a safer next action without believing BoomerBuddy guarantees safety?
2. Can protected people and adult-child purchasers explain who can see what, why payment grants no content authority, how consent works, and how to withdraw it?
3. Can a pair complete orientation and Family setup without coercion, hidden surveillance, or moderator rescue?
4. Does `BoomerBuddy` communicate trust and respect across older-adult, adult-child, and institutional audiences, and which claim language creates confusion or patronization risk?
5. Do participants understand Free, Plus, and Family differences and prices? Which tradeoffs—not hypothetical “purchase intent” alone—drive choice?
6. Can credit-union stakeholders identify a legitimate owner, member problem, approval path, evidence requirement, acceptable data boundary, pilot outcome, and stop condition?

## Study design and waves

Research proceeds in waves; later waves do not begin while an earlier stop condition remains open.

| Study                           |                                                                                               Planned participants | Structure                                                                  | Primary evidence                                                                            |
| ------------------------------- | -----------------------------------------------------------------------------------------------------------------: | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Older-adult usability           |                                                                          12 adults age 60+, across three age bands | 75-minute individual moderated task session                                | Task completion, assistance, critical errors, comprehension, trust                          |
| Adult-child and paired Family   |                                                     8 consented pairs; interview each separately before joint work | Two 30-minute individual interviews plus one 60-minute paired task session | Buyer/protected goals, authority comprehension, coercion signals, paired activation         |
| Brand, positioning, and pricing | Minimum 12 older adults and 12 adult-child purchasers; may reuse participants only when order effects are recorded | Randomized concept-card review after product tasks                         | Comprehension, trust, patronization risk, price tradeoffs; never claimed conversion         |
| Credit-union discovery          |                                                                  12 professionals across at least six institutions | 45-minute individual discovery interview; no sales pitch                   | Current workflow, accountable buyer/owner, diligence, data boundary, pilot/renewal evidence |

These are purposive learning samples, not population estimates. Report exact denominators and missing segments. Do not publish percentages without counts, confidence caveats, and the sampling method.

## Recruiting criteria

### Older adults

Include adults age 60 or older in the founder-approved geography and language who make or share responsibility for their own digital/financial decisions. Recruit across `60–69`, `70–79`, and `80+` bands where feasible; a mix of smartphone/web confidence; iOS/Android/desktop use; rural/suburban/urban context; and differing family-support arrangements. At least four sessions should include a participant who uses or requests an accessibility accommodation such as screen reader, magnification, large text, keyboard/switch access, captions, hearing support, reduced motion, or additional processing time.

Do not use age as a proxy for incapacity. Exclude only when informed consent cannot be established, the supported language/accommodation cannot be provided safely, the person is currently in an active scam or acute distress, or participation creates a direct reporting/care dependency that could make refusal difficult.

### Adult-child purchasers and pairs

Include adults who currently receive suspicious-message questions or plausibly help an older adult, plus an older adult who independently agrees to participate with them. Obtain consent and preferences separately. Recruit variation in geography, frequency of help, relationship type, payer expectation, and technology confidence. Do not let the adult child enroll the older adult or answer consent questions for them.

Exclude a pair when either person objects to joint observation/recording, reports coercion or unsafe relationship dynamics, expects hidden monitoring, or cannot participate without exposing a current private incident. Either participant may complete only the individual interview and decline the pair session.

### Brand and pricing

Use the older-adult and adult-child criteria above. Balance concept order and device where feasible. Record prior awareness of BoomerBuddy, scam-protection products, paid security services, and family support tools. Employees, contractors, investors, close founder contacts, and anyone previously shown the concepts are excluded from the primary comparison and may be labeled pilot participants only.

### Credit-union buyers

Recruit at least three participants from each relevant perspective across the sample: executive/strategy, fraud/risk/compliance, member service/operations, and digital/product/technology. Include at least two institutions in each of the selected membership-size bands and more than one geography where the approved scope permits. Verify role from an official institution source or business email without importing personal profiles into the research dataset.

Exclude vendors presenting themselves as credit-union employees, people unable to discuss process even at a non-confidential level, and anyone seeking a binding proposal, procurement commitment, or exchange of member/customer data during research. Participation never becomes an opportunity stage without separate external evidence.

## Consent, privacy, and participant safety

1. Send an approved information sheet before scheduling. At session start, obtain affirmative research consent; obtain separate optional consent for recording and deidentified quotation. Product terms or an incentive never substitute for research consent.
2. State that BoomerBuddy is experimental, does not guarantee safety, and cannot investigate a real incident. Use only supplied synthetic examples. Ask participants not to paste real messages, URLs, codes, account data, or names.
3. Assign a random participant ID. Keep the scheduling/incentive roster separate from observation data. Research event records contain no submitted artifact, contact destination, account number, credential, or unnecessary personal data.
4. Default to no recording. If recording is approved and separately consented, encrypt it, restrict access to the named research team, verify the coded transcript, delete the recording within 30 days of transcript verification and no later than 60 days after the session, and log deletion. Delete scheduling contact data within 30 days after incentive reconciliation. Retain coded notes for at most 12 months unless approved policy is shorter. Consent/audit retention must be set by qualified review before recruitment.
5. Participants may skip any question, request an accommodation or break, withdraw, or end participation without losing earned incentive. Withdrawal stops new analysis; deletion follows the approved consent/legal policy and is explained before enrollment.
6. If a participant discloses an active scam, secret, threat, abuse, imminent loss, or medical/emergency concern, stop the task and follow the stop protocol below. Do not ask for the artifact or improvise individualized fraud, legal, financial, medical, or emergency advice.
7. Quotes require explicit quotation consent, are deidentified, and remain research evidence—not testimonials. No quote, image, logo, institution name, or recording may be published or used in marketing under this protocol.

## Research environments and materials

- Use a non-public, synthetic-data environment with development identity clearly labeled and outbound delivery disabled.
- Prepare two synthetic scam tasks, one ambiguous/unknown task, and one benign-looking task that must not produce unsupported reassurance. Use reserved domains and fictional contact details.
- Freeze prototype commit, schema, copy, concept-card version, device/browser, moderator guide, and task order for each wave.
- Provide accessible concept cards for working brand, positioning statements, Free/Plus/Family feature-price hypotheses, Family authority diagram, and institutional pilot concept. Randomize brand/price card order with a recorded schedule.
- Do not create production accounts, use live providers, accept payment, send invitations, contact prospects outside authorized recruitment, or store real customer content.

## Instrumentation and metric definitions

Use the content-free fields in [Research Forms](./HUMAN-RESEARCH-FORMS.md). Manual observation is canonical until product instrumentation is separately reviewed.

| Measure                    | Exact definition                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent completion     | Participant reaches the stated task end with no moderator instruction beyond the scripted prompt                                                        |
| Assisted completion        | Participant completes after one or more recorded neutral prompts; record prompt count and type                                                          |
| Critical failure           | Action or belief could expose content/authority, create false reassurance, defeat consent, or prevent an urgent safer action                            |
| Safe-action comprehension  | Participant identifies the supplied safer next action and explains why without relying on “BoomerBuddy says safe”                                       |
| Authority comprehension    | Participant correctly distinguishes membership, administrator, payer/billing, protected person, Trusted Circle, and content permission for the scenario |
| Withdrawal comprehension   | Participant can state who may withdraw which relationship and what unrelated access remains                                                             |
| Time on task               | Monotonic task start to terminal state, excluding participant-requested breaks and documented environment failure                                       |
| Moderator assistance       | Count and code: navigation, terminology, task reminder, accessibility, environment recovery, or safety intervention                                     |
| Trust/comprehension rating | Participant-selected 1–5 response after the open-ended explanation; never replace the explanation with the score                                        |
| Price response             | Exact concept shown, plan chosen or rejected, tradeoff rationale, and four price-boundary answers; not a conversion forecast                            |
| Institutional evidence     | Role, current workflow, required proof, owner/approver, data boundary, timeline class, pilot outcome, and stated stop reason                            |

Required event envelope: `protocolVersion`, `sessionId`, `participantId`, `cohort`, `conceptOrder`, `taskId`, `taskVersion`, `startedAt`, `endedAt`, `outcome`, `assistanceCodes`, `errorCodes`, `critical`, `comprehensionCode`, `confidence`, `trust`, `moderatorId`, `prototypeCommit`, and `notesReference`. Never include free-text artifact content in events.

## Predefined decision thresholds

Thresholds are iteration gates, not statistical validation or launch criteria.

- Any false-safety belief, hidden-monitoring expectation, unintended content disclosure, inability to withdraw, or harmful recommended action is critical and pauses the affected flow.
- In a final unchanged older-adult wave, at least 10 of 12 participants should independently select the safer action; all critical failures must be remediated and retested.
- In a final unchanged paired wave, at least 7 of 8 pairs should correctly explain payer-versus-content authority and withdrawal after completing the flow; no protected participant may report coerced enrollment.
- Brand language advances only when no cohort identifies a repeated patronizing/deceptive interpretation and participants can explain the product without “guaranteed safe” language. Report minority harm concerns even if a numeric threshold passes.
- Pricing remains a hypothesis until behavior with real, separately authorized offers exists. Research may reject confusing packaging but cannot validate CAC, retention, or willingness to pay from stated intent alone.
- Credit-union discovery advances to a separately authorized design-partner step only when at least two unrelated institutions identify an accountable owner, acceptable data boundary, measurable pilot outcome, and plausible approval path. This is not pipeline, intent, or a commitment.

## Analysis, review, and adjudication

1. Two reviewers independently code every critical task and consent/authority answer using the frozen codebook. A moderator may be one reviewer but cannot be the sole adjudicator for a session they ran.
2. Compare codes without averaging away disagreement. Record `agree`, `minor_disagreement`, or `material_disagreement`, the exact disputed code, and evidence reference.
3. A third qualified reviewer adjudicates material safety, consent, accessibility, or institutional-data disagreements. The adjudicator cannot be the prototype author for a disputed safety behavior.
4. Report counts and denominators by cohort, task version, concept order, accessibility accommodation, and assistance—not individual identity. Preserve critical outliers even when a majority succeeds.
5. Separate observed fact, participant interpretation, researcher inference, recommendation, and unresolved question. A theme needs supporting session IDs and a contradictory-evidence field.
6. Freeze a wave report with protocol/prototype versions, exclusions/withdrawals, missing data, deviations, disagreements, stop events, remediations, and negative findings. Never fabricate a participant, quote, score, conversion, demand, partner interest, or safety outcome.

## Stop and escalation rules

### Stop the session immediately

- participant withdraws consent, becomes distressed, or cannot continue voluntarily;
- a real secret, account, contact, private artifact, or current victimization is entered or displayed;
- participant describes imminent physical danger or an urgent emergency;
- the prototype gives harmful reassurance or guidance for the synthetic scenario;
- protected and purchaser participants disagree about consent or one appears coerced;
- recording, access control, environment isolation, or identity labeling fails; or
- moderator cannot provide an approved accessibility accommodation.

The moderator stops recording, preserves only the minimum incident reference, follows the approved safety/contact script, notifies the named research lead, and does not resume that participant’s task the same day after a safety/privacy event.

### Pause the study wave

- one Critical security/privacy defect;
- one harmful action recommendation or false `safe` implication;
- two participants encounter the same consent/authority failure;
- two sessions lose data isolation or require an unapproved workaround;
- a moderator deviates materially from disclosure, task order, or neutral-prompt rules; or
- recruiting quotas systematically exclude an approved accessibility or audience segment.

Resume only after root cause, decision owner, remediation, updated version, regression evidence, reviewer approval, and a documented restart decision. Do not edit the previous wave’s data to make the new version appear successful.

## Execution sequence and outputs

1. Approve owner, geography/language, budget/incentive, privacy/legal/accessibility plan, materials, device matrix, and incident contacts.
2. Pilot with two non-primary participants; fix only protocol/environment defects and label pilot data excluded from primary evidence.
3. Recruit to the frozen criteria; track screen failures and quota gaps without inferring population incidence.
4. Run individual sessions, then paired sessions; randomize concepts using the pre-generated schedule.
5. Complete same-day incident review and two-reviewer coding within five business days.
6. Adjudicate, calculate exact counts, document contradictions/deviations, and decide `ITERATE`, `STOP`, or `READY FOR NEXT RESEARCH WAVE`.
7. Verify recording/contact deletion and publish only a deidentified internal evidence report.

Required outputs are a recruitment disposition log, consent/deletion log, session records, task observations, critical-incident records, reviewer/adjudication table, versioned findings register, and decision memo. `READY FOR NEXT RESEARCH WAVE` is never launch, commercial traction, accessibility conformance, fraud accuracy, or approval to contact customers/prospects.
