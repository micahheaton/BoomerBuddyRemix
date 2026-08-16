# Staffing and Philippines Operations

Status: **operating design only; no hiring or vendor engagement authorized**
Evidence date: 2026-08-16

## Decision

BoomerBuddy should add people when measured queue load, safety risk, or professional accountability crosses a gate—not when a subscriber counter reaches a round number. Early capacity should remain fractional. A future Philippines operation is plausible for bounded L1 support, orientation assistance, and structured review, but it is not a substitute for senior fraud judgment, security/privacy ownership, or a truthful incident path.

No BoomerBuddy time study, live queue, vendor quote, Philippines counsel opinion, or worker has been obtained. The bands below are procurement assumptions, not wages offered or hiring authority.

## Workload gates implemented in Run 2

`packages/business-os/src/economics.ts` converts workload into monthly productive hours and triggers a dedicated capacity unit at **120 hours/month**. The reserve below a nominal full-time month covers coaching, QA, leave, incidents, and administration.

| Capability | Implemented workload formula | Dedicated-capacity trigger |
| --- | --- | ---: |
| Customer Safety / Support | `(support cases × 20 + billing cases × 15) ÷ 60` | 120 hours; 360 support cases alone |
| Orientation | `sessions × 30 ÷ 60` | 120 hours; 240 sessions |
| Trust & Safety analyst | `fraud reviews × 25 ÷ 60` | 120 hours; 288 reviews |
| Customer Success | `interventions × 25 ÷ 60` | 120 hours; 288 interventions |
| Partnerships / RevOps | `accounts with due actions × 35 ÷ 60` | 120 hours; 206 accounts |

Use a trailing eight-week arrival rate plus p90 handling time, not the nominal minutes, once live data exists. Begin fractional coverage at 60 hours/month for two consecutive months; add dedicated capacity only at 120 hours or when severity/SLA risk requires it sooner. Require a 20% capacity buffer and a named backup before publishing a response commitment.

Additional gates:

- appoint a senior fraud escalation owner when difficult-case disagreement exceeds 10%, critical escalations exceed 20/month, or the p90 safety-review SLA misses twice;
- buy customer-success capacity when explainable interventions exceed 120 hours/month, not merely when a health score exists;
- add engineering/operations capacity when recurring manual toil exceeds 40 hours/month, on-call interrupts exceed eight/month, or an SLO misses twice in a quarter;
- expand bookkeeping/finance support when close preparation exceeds 16 founder-hours/month, receivables become material, or tax/payroll jurisdictions multiply; and
- retain qualified security, privacy, legal, accessibility, accounting, and tax professionals at their risk gates regardless of subscriber count.

## Staged operating model

| Reference scale | Capacity decision | Exit evidence before the next stage |
| ---: | --- | --- |
| Pre-first-dollar / 100 | Founder owns exceptions; fractional qualified professionals; self-service and truthful limited support hours. No offshore sensitive-data access. | Time study, taxonomy, escalation tree, training, QA rubric, incident drill |
| 1,000 | Add fractional L1/billing coverage only if the 60-hour early gate persists. Trial a vetted provider on synthetic and content-free cases first. | Eight weeks of volume, p50/p90 handle time, resolution/appeal quality, access audit |
| 5,000 | One dedicated capacity unit is possible only where a 120-hour gate fires; maintain separate senior escalation. | Backlog/SLA stable with 20% reserve; QA agreement and offboarding drill pass |
| 10,000 | Separate L1, Trust & Safety, and customer-success queues if each independently fires. Do not blend an inexpensive generalist into all three. | Named shift lead, two-person critical escalation, monthly access review |
| 25,000 | Add shifts, QA, workforce planning, and partner/customer success according to arrival curves; no automatic 24/7 claim. | Forecast error, shrinkage, continuity, and incident exercises pass |
| 50,000 | Sensitivity range: 10–20 operations FTE-equivalents plus 5–8 senior/product/platform/revenue roles, only if measured work requires them. | Payroll remains inside economics envelope and quality does not decline |

The 50K range is not a headcount plan. Better self-service may need fewer people; safety cases or assisted orientation may need more. The [$4.1M fixed-cost scenario](./50K-SUBSCRIBER-MODEL.md) reserves `$2.1M` for all payroll/contractors, including a market-value founder role, senior U.S. expertise, engineering/operations, and Philippines/vendor capacity. Variable support must not duplicate that payroll.

## Role boundaries

| Role | May do | Must not do |
| --- | --- | --- |
| L1 support | Approved FAQs, navigation, orientation logistics, status, content-free triage, billing portal guidance | View raw scam artifacts by default, pronounce something safe, reset identity without proof, make refunds, browse households |
| Orientation specialist | Scripted setup and comprehension checks with explicit consent | Coerce enrollment/sharing, become a Trusted Circle participant, provide novel safety/legal advice |
| Bounded fraud reviewer | Review a case-scoped redacted evidence packet, apply a rubric, escalate disagreement | Use private content for training, change policy, give novel recovery advice, see unrelated history |
| Senior Trust & Safety | Difficult adjudication, policy/evaluation ownership, incident learning | Treat model output as authority or bypass consent/access purpose |
| Customer success | Explainable activation/health intervention under contact policy | Use fear-based retention, inspect submitted artifacts, send without consent |
| Finance/billing | Reconciliation and policy-bound adjustment | Infer family authority from payment or issue material exceptions without approval |
| Security/privacy | Incident, rights, and access oversight | Delegate professional accountability to a general AI agent |

## Philippines legal and privacy boundary

The Philippines Data Privacy Act permits outsourced processing but leaves the controller responsible for safeguards and requires processors to comply. Its implementing rules require documented instructions, confidentiality, appropriate security, assistance with data-subject rights, comparable protection for domestic or international transfers, and contracts with processors that provide sufficient guarantees. The controller remains accountable after transfer. Sources: [Data Privacy Act, Sections 14 and 20](https://privacy.gov.ph/data-privacy-act/) and [implementing rules, Sections 26, 44, and 50](https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/).

The NPC says appointing a DPO is a legal requirement for controllers and processors, while outsourced DPO functions still require oversight. Breaches requiring notification generally have a 72-hour window, so any provider contract needs immediate notification to BoomerBuddy, evidence preservation, and drill participation—not a 72-hour vendor SLA. Sources: [NPC DPO guidance](https://privacy.gov.ph/appointing-a-data-protection-officer/) and [NPC breach reporting](https://privacy.gov.ph/pips-and-pics/breach-reporting/).

Employment structure also needs Philippines counsel. DOLE Department Order 174 prohibits labor-only contracting, regulates permissible arrangements, and requires contractor registration. A label such as “independent contractor” does not cure an employee-like controlled shift. Verify a BPO/contractor in the current registry and contract for a defined service; do not procure anonymous labor seats. Source: [DOLE Department Order 174 summary](https://dole.gov.ph/news/bello-signs-d-o-on-contracting-and-subcontracting/).

## Security design for any remote operation

- company-managed device, full-disk encryption, patch/EDR policy, unique identity, phishing-resistant MFA, and no shared accounts;
- case-scoped, purpose-bound, time-limited access through HQ; no database, analytics warehouse, production console, or bulk export access;
- redacted evidence by default; raw artifact access only for a named senior case role with consent, step-up, reason, expiry, and audit;
- block local download, removable media, unmanaged printing, and clipboard transfer where technically enforceable; no personal phones for customer content;
- supervised workspace/privacy standard, headset and screen positioning, secure connectivity, and no smart speakers or family-shared room;
- immutable access and decision audit, monthly access review, QA sampling, anomaly alerts, and four-hour target for access removal after separation;
- vendor/subprocessor inventory, background-screening boundaries reviewed by counsel, incident and continuity clauses, deletion verification, and audit rights; and
- include the provider in incident, recovery, and supply-chain review. This follows the supplier-risk outcomes in [NIST CSF 2.0](https://www.nist.gov/cyberframework) and resource-focused access model in [NIST SP 800-207](https://csrc.nist.gov/pubs/sp/800/207/final).

## Quality, training, and scheduling

Training must cover older-adult communication, coercion/consent, uncertainty language, redaction, account recovery, billing authority, accessibility, escalation, privacy, secure workstation practice, and incident reporting. Require synthetic certification before customer access, supervised cases, weekly calibration, and quarterly recertification.

Sample at least 10% of ordinary cases during a pilot and 100% of high/critical or overturned cases. Track rubric agreement, safe escalation, unauthorized access, reopen/appeal rate, p50/p90 resolution, and customer comprehension. Do not use keystrokes, screen activity, or speed alone as quality proxies.

Start with published 8×5 coverage. A single continuously staffed 24×7 seat requires 4.2 nominal 40-hour workers before leave, training, absence, and supervision; in practice it needs more plus escalation. Never advertise 24×7 based on time-zone arbitrage or one Philippines shift.

## Cost anchors and planning bands

Government data are anchors, not job quotes. The Philippine Statistics Authority reports an August 2024 average monthly wage of `₱21,544` across covered full-time workers, `₱29,310` in NCR, and `₱22,903` for NCR general office clerks; the survey covers formal establishments with at least ten workers. The current NCR non-agriculture minimum is `₱755/day` effective 2026-07-25 and is scheduled to become `₱780/day` on 2027-01-20. Sources: [PSA 2024 Occupational Wages Survey](https://psa.gov.ph/statistics/occupational-wages-survey/node/1684081185) and [NWPC NCR wage order](https://nwpc.dole.gov.ph/ncr/).

Direct employment also entails more than base pay. DOLE’s handbook states qualifying rank-and-file employees receive at least one-twelfth of annual basic salary as 13th-month pay. The latest located official schedules show a 10% employer SSS share on monthly salary credit capped at `₱35,000`, a 5% PhilHealth premium shared equally within its floor/ceiling, and a 2% Pag-IBIG employer contribution with a `₱10,000` Monthly Fund Salary ceiling effective February 2024. Reconfirm all schedules before an offer. Sources: [DOLE statutory benefits handbook](https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf), [SSS contribution schedule](https://www.sss.gov.ph/pay-contribution/), [PhilHealth advisory](https://www.philhealth.gov.ph/advisories/2025/PA2025-0002.pdf), and [Pag-IBIG Circular 460](https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/Circular%20No.%20460%20-%20Guidelines%20on%20the%20Pag-IBIG%20Fund%27s%20Implementation%20of%20Increase%20in%20the%20MFS%20Effective%20February%202024.pdf).

The following uses `₱57/USD`, 13 salary months, and a broad 20–40% load for employer contributions, leave, equipment, management, training, and hiring. Exchange rate and load are assumptions to replace with quotes and counsel.

| Future role | Monthly base-pay planning band | Direct loaded annual planning band | Managed/BPO annual seat band |
| --- | ---: | ---: | ---: |
| L1 Customer Safety / Support | ₱35k–₱60k | $10k–$19k | $18k–$36k |
| Orientation specialist | ₱45k–₱70k | $12k–$22k | $22k–$42k |
| Bounded fraud reviewer | ₱55k–₱90k | $15k–$29k | $28k–$55k |
| QA / operations lead | ₱75k–₱120k | $21k–$38k | $38k–$70k |

Pay for skill, security, supervision, and retention; do not anchor offers to the legal minimum. Obtain at least three like-for-like quotes including taxes, shift premiums, equipment, management, bench, setup, termination, and security. A low seat rate that omits senior escalation or leaks data is not savings.

## BPO, employer-of-record, or direct

1. **Fractional specialist/vendor:** preferred first test when load is irregular. Use synthetic/content-free cases before any customer data and require a named team, subprocessor disclosure, and exit export/deletion.
2. **Employer of record:** consider only after recurring individual roles are stable and counsel confirms responsibilities. It improves day-to-day control but does not outsource BoomerBuddy’s privacy/security accountability.
3. **Direct Philippines entity/employment:** consider only after at least six stable capacity units for six months, a durable leadership need, and a legal/tax/benefits case. Control may improve; administration and fixed commitment rise.
4. **Independent contractor:** reserve for genuinely independent project work. Do not use it to disguise scheduled, supervised, core support employment.

Before any choice: founder approval, U.S. and Philippines labor/tax/privacy counsel, security review, DPA/transfer map, processor agreement, costed pilot, training, access test, breach drill, and recoverable exit plan. Run 2 performs none of those external steps.

Related: [Run 2 staffing review](./30-staffing-and-philippines-ops.md), [50K Subscriber Model](./50K-SUBSCRIBER-MODEL.md), [Founder Dependency Model](./FOUNDER-DEPENDENCY-MODEL.md), and [People, Hiring, and Workforce](../gauntlet-zero/26-people-hiring-workforce.md).
