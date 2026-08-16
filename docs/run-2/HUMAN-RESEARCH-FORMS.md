# Human Research Forms and Data Dictionary

Status: **blank execution templates; awaiting approved external research; contains no participant data or findings**

Protocol: [Human Research Protocol](./HUMAN-RESEARCH-PROTOCOL.md) `run2-human-research-v1`

Copy these templates only into an approved access-controlled research system. Never commit completed participant forms, recordings, contact rosters, incentive details, or free-text incident descriptions to this repository.

## Gate-0 approval record

| Field                               | Required value |
| ----------------------------------- | -------------- |
| Protocol and guide versions         |                |
| Prototype commit/build              |                |
| Founder authorization/date          |                |
| Research owner and backup           |                |
| Privacy/legal reviewer/date         |                |
| Accessibility reviewer/date         |                |
| Geography and language              |                |
| Recruiting source and authorization |                |
| Cohorts/quotas                      |                |
| Incentive and budget ceiling        |                |
| Device/browser matrix               |                |
| Synthetic task IDs/versions         |                |
| Data systems and access list        |                |
| Retention/deletion dates            |                |
| Safety/incident contacts            |                |
| Stop-rule owner                     |                |

No recruitment begins while any field is blank.

## Recruiting screener

### Common fields

- Candidate scheduling ID: `[kept only in separate roster]`
- Cohort sought: `older_adult | adult_child | pair_protected | pair_purchaser | credit_union`
- Founder-approved geography/language eligible: `yes | no`
- Adult and able to provide informed consent for this session: `yes | no | needs approved accommodation`
- Prior exposure to concepts/team: `none | pilot_only | exclude_primary`
- Current active scam, acute distress, or request for incident advice: `no | yes_stop_and_route`
- Direct employment, investment, care, or reporting dependency that could impair voluntary consent: `no | yes_review`
- Accessibility accommodation category requested: `none | vision | hearing | motor | cognitive_pace | language | other_approved`
- Eligible: `yes | no | research_owner_review`
- Exclusion reason code: `quota | geography | language | consent | safety | conflict | prior_exposure | accommodation_unavailable | other`

### Older-adult quota fields

- Age band: `60_69 | 70_79 | 80_plus | prefer_not_to_say`
- Primary device: `ios | android | desktop | tablet | mixed`
- Digital confidence self-description: `lower | middle | higher | prefer_not_to_say`
- Support arrangement: `usually_independent | informal_family | formal_caregiver | mixed | prefer_not_to_say`

### Adult-child/pair fields

- Receives suspicious-message questions: `never | less_than_monthly | monthly | weekly_or_more`
- Relationship category: `adult_child | spouse_partner | other_approved`
- Both parties independently opted into pair contact: `yes | no`
- Separate-session order assignment: `protected_first | purchaser_first`

### Credit-union fields

- Institution verification source/reference: `[official URL or business-domain evidence; separate from notes]`
- Role perspective: `executive_strategy | fraud_risk_compliance | member_service_operations | digital_product_technology`
- Institution size band: `under_10k | 10k_49k | 50k_249k | 250k_plus`
- Can discuss non-confidential workflow: `yes | no`

## Consent and deletion log

| Field                                      | Value                          |
| ------------------------------------------ | ------------------------------ |
| Participant ID                             |                                |
| Information-sheet version/delivered at     |                                |
| Participation consent                      | `yes/no`, timestamp, collector |
| Data-handling acknowledgement              | `yes/no`, timestamp            |
| Recording consent                          | `yes/no/not offered`           |
| Deidentified quotation consent             | `yes/no/not offered`           |
| Pair-session consent reconfirmed privately | `yes/no/not applicable`        |
| Withdrawal requested                       | timestamp/reason optional      |
| Contact roster deletion due/completed      |                                |
| Recording deletion due/completed           |                                |
| Coded-data deletion due/completed          |                                |
| Deletion verifier                          |                                |

## Session header

```text
protocolVersion:
guideVersion:
sessionId:
participantId:
cohort:
pairedSessionId: null
moderatorId:
observerIds: []
prototypeCommit:
buildEnvironment:
deviceClass:
browserOrAppVersion:
assistiveTechnologyCategory: none
conceptOrder:
taskVersions: []
startedAt:
endedAt:
recording: false
deviations: []
stopEventId: null
```

## Task observation

One row per task; do not enter artifact text, URLs, contact information, or secrets.

| Field                       | Allowed value                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session/task ID and version | Opaque/versioned identifiers                                                                                                                     |
| Start/end                   | ISO timestamp                                                                                                                                    |
| Outcome                     | `independent_complete`, `assisted_complete`, `incomplete`, `participant_stop`, `safety_stop`, `environment_failure`                              |
| Assistance count            | Nonnegative integer                                                                                                                              |
| Assistance codes            | `navigation`, `terminology`, `task_reminder`, `accessibility`, `environment_recovery`, `safety_intervention`                                     |
| Error codes                 | `navigation`, `comprehension`, `false_safety`, `unsafe_action`, `consent`, `authority`, `privacy`, `accessibility`, `environment`, `other_coded` |
| Critical                    | Boolean; rationale is a controlled code plus evidence reference                                                                                  |
| Safe-action comprehension   | `correct`, `partial`, `incorrect`, `not_asked`                                                                                                   |
| Authority comprehension     | `correct`, `partial`, `incorrect`, `not_asked`                                                                                                   |
| Withdrawal comprehension    | `correct`, `partial`, `incorrect`, `not_asked`                                                                                                   |
| Confidence/trust            | Integer 1–5 after open response, or `declined`                                                                                                   |
| Evidence reference          | Access-controlled timestamp/note reference, never repository content                                                                             |
| Moderator interpretation    | Separate coded field, not merged with observation                                                                                                |

## Brand and pricing response

```text
sessionId:
participantId:
cardId:
cardVersion:
displayOrder:
audienceInterpretationCode:
promiseInterpretationCode:
trustDrivers: []
distrustDrivers: []
patronizingOrFearFlag: false
guaranteeInterpretationFlag: false
clarityRank:
trustRank:
planCardId:
planChoice: free | plus | family | none | unsure
choiceReasonCodes: []
tooInexpensiveToTrust:
goodValue:
startingExpensive:
tooExpensive:
currency:
openResponseReference:
```

Never transform these fields into conversion, retention, CAC, LTV, or validated willingness-to-pay without separate behavioral evidence.

## Credit-union discovery record

| Field                      | Allowed evidence                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| Institution/role reference | Verified official source plus coded role; keep identity access restricted                |
| Current workflow           | Controlled process codes and deidentified note reference                                 |
| Accountable problem owner  | `identified`, `unclear`, or `absent`; role only                                          |
| Budget/approval path       | `identified`, `unclear`, or `absent`; no forecast amount without approved release        |
| Required diligence         | Security, privacy, legal, accessibility, integration, insurance, support, evidence codes |
| Data boundary              | Required, prohibited, unresolved data classes                                            |
| Pilot outcome              | Exact participant-stated measure, labeled research statement                             |
| Stop condition             | Exact coded reason/evidence reference                                                    |
| Timeline class             | `under_3m`, `3_6m`, `6_12m`, `over_12m`, or `unknown`; not forecast                      |
| Follow-up permission       | `none`, `research_only`, or `separately_authorized`; never marketing by default          |
| Opportunity effect         | Always `none` under this protocol                                                        |

## Critical incident record

```text
incidentId:
sessionId:
occurredAt:
category: false_safety | harmful_action | consent | coercion | privacy | security | active_scam | distress | accessibility | environment
taskId:
observationCode:
minimumEvidenceReference:
recordingStoppedAt:
participantTaskEnded: true
researchLeadNotifiedAt:
dataContainmentAction:
participantResourceScriptUsed:
studyWavePaused: true | false
owner:
decisionDueAt:
resolution:
resumeApprovalReference: null
```

Do not place the disclosed artifact, secret, account, diagnosis, or detailed personal narrative in this record.

## Independent coding and adjudication

| Field                          | Value                                                     |
| ------------------------------ | --------------------------------------------------------- |
| Session/task ID                |                                                           |
| Codebook version               |                                                           |
| Reviewer A/code/evidence       |                                                           |
| Reviewer B/code/evidence       |                                                           |
| Agreement                      | `agree`, `minor_disagreement`, or `material_disagreement` |
| Disputed code                  |                                                           |
| Adjudicator/conflict check     |                                                           |
| Final code and rationale       |                                                           |
| Prototype/protocol implication |                                                           |
| Critical outlier retained      | `yes`, `no`, or `not_applicable`                          |

Reviewers do not see each other’s codes before independent submission. A safety/consent material disagreement requires a qualified third adjudicator.

## Wave evidence table

| Cohort | Task/version | Recruited | Completed | Withdrawn | Excluded | Independent | Assisted | Incomplete | Critical | Missing data |
| ------ | ------------ | --------: | --------: | --------: | -------: | ----------: | -------: | ---------: | -------: | ------------ |
|        |              |           |           |           |          |             |          |            |          |              |

Every reported rate must show its numerator and denominator. Add concept-order and accessibility strata where sample disclosure does not risk reidentification. Do not suppress a critical outlier because the aggregate passes.

## Finding register

```text
findingId:
waveId:
type: observed_fact | participant_interpretation | researcher_inference | recommendation | unresolved_question
statement:
supportingSessionIds: []
contradictingSessionIds: []
cohorts:
taskAndPrototypeVersions:
severity: critical | high | moderate | low | opportunity
confidence: bounded | tentative | unresolved
reviewerIds:
adjudicationReference:
decision: stop | iterate | retain | next_wave | unresolved
owner:
dueAt:
```

## Wave decision memo

1. Scope, dates, authorization, protocol/prototype versions.
2. Recruitment achieved versus planned; exclusions, withdrawals, and missing segments.
3. Exact task counts and denominators; critical incidents and stop events first.
4. Observed facts, interpretations, disagreements, contradictions, and accessibility findings.
5. Brand/price results labeled stated research—not market behavior.
6. Credit-union findings labeled research—not intent, pipeline, contract, or revenue.
7. Remediation traceability and unchanged validation wave.
8. Data deletion status and protocol deviations.
9. Decision: `STOP | ITERATE | READY FOR NEXT RESEARCH WAVE`.
10. Explicit prohibited claims: launch readiness, fraud accuracy, losses prevented, accessibility conformance, conversion, retention, willingness to pay, partner intent, or commercial traction.
