# 33 — Run 3 Launch-Enablement Plan

Status: **recommended next run; separately authorized; no launch**

## Outcome

Run 3 should convert Run 2’s local/staging foundation into a dated launch-decision dossier using company-owned external accounts, professional review, real staging, devices, and human research. It must stop at a founder `GO / NO-GO / REMEDIATE` decision. It does not open public traffic, take real money, send campaigns, submit stores, migrate V1 users, hire, or begin an institutional sale unless separately authorized.

## Gate 0 — Freeze and authorize scope

**Founder decisions:** initial U.S. geography, working brand, offer/price candidates, web/mobile channel order, device matrix, truthful support hours, test/research budget, safety/evaluation thresholds, acceptable residual risk, and whether direct-family or sponsor discovery is primary.

**Actions:** reproduce the closed Run 2 integrated test/security gate against a tagged candidate; obtain the authorized machine-readable advisory inventory and identify, reachability-review, fix, or explicitly risk-accept the 11 high and 7 moderate findings reported by the Run 2 install summary; inventory every environment variable, data class, provider, owner, professional dependency, and rollback. Assign one accountable human and backup per launch-critical queue.

**Exit evidence:** signed scope/budget, risk acceptance boundaries, clean build provenance/SBOM, no open in-scope Critical/High defect, and a stop list. If authority or budget is missing, stop before creating accounts.

## Gate 1 — Establish company-owned continuity

Create only founder-approved, BoomerBuddy LLC-owned accounts with phishing-resistant MFA, recovery custodians, least privilege, billing alerts, and export/termination procedures:

1. private GitHub canonical source with protected `main`, required CI, signed/tagged releases, and independent encrypted backup;
2. Cloudflare-controlled domain/DNS with no Replit dependency;
3. Vercel web/HQ and Render API/worker staging projects;
4. Neon staging PostgreSQL and reviewed S3-compatible private object storage;
5. managed identity evaluation/selection and separate customer/HQ applications;
6. Stripe test account; Apple/Google organization developer accounts and Expo/EAS only if mobile is in the authorized matrix; and
7. Sentry, PostHog, Postmark, and any approved messaging/intelligence sandbox with content-minimized configuration.

**Exit evidence:** ownership/access register, cost ceiling, DPA/subprocessor/region review, secret custody/rotation, account export test, and successful source restoration without Replit. No production DNS cutover occurs.

## Gate 2 — Prove staging, data, and recovery

- Deploy an access-restricted staging stack from the canonical tag, not a developer workstation.
- Run migrations and concurrency/locking tests on real PostgreSQL; test pooled/direct connections and least-privilege database roles.
- Back up, destroy a disposable staging copy, restore to a clean project, and reconcile row counts/checksums, grants, consent projections, jobs, and deletion state.
- Exercise worker crash/lease recovery, duplicate consumers, retry/dead letter/replay, retention recurrence, outbox failure, shutdown, provider timeout, and monitoring alerts under multi-instance load.
- Complete the Replit-loss drill from external source, environment inventory, database/object backups, DNS plan, and mobile build ownership.

**Exit evidence:** timed restore/RPO/RTO result, migration/rollback decision, alert delivery to a named owner/backup, redacted logs, and a signed loss-drill record. Configuration alone does not pass.

## Gate 3 — Close commerce and identity externally

**Web commerce:** execute an external Stripe **test-mode** Checkout through signed raw webhook, idempotent inbox, canonical subscription, entitlement grant, allowance, application access, portal, failed payment/grace, cancel-at-period-end, refund/dispute handling, and retrieval reconciliation. Test duplicates, reordering, missing metadata, forged signatures, provider outage, overlapping sponsor/store/web grants, and downgrade recovery. Reconcile provider objects to BoomerBuddy and a test ledger.

**Identity:** prove passkey/MFA, recovery, invitation identity binding, customer/HQ audience separation, session revocation, administrator/payer/billing independence, pairwise consent withdrawal, support JIT access, joiner/mover/leaver, and incident access review.

**Mobile:** on real supported iOS/Android devices, test authentication/recovery, deep links, invitations, text/URL/image share intake, notifications, restoration, offline/error behavior, screen reader, text size, contrast, and current storefront policy. macOS/Xcode evidence is mandatory for iOS native extensions.

**Exit evidence:** external sandbox identifiers and timestamps, webhook/reconciliation report, zero redirect/client authority, identity threat-model sign-off, and device matrix. No live price, card, store submission, or production credential is used.

## Gate 4 — Independent assurance and legal readiness

Commission qualified, independent work within the approved budget:

- application/API/mobile/HQ/worker security test and privacy threat model, with no open Critical/High;
- U.S. consumer/privacy/auto-renewal/marketing/SMS/recording/terms/disclaimer review and tax/accounting setup;
- accessibility audit plus moderated older-adult/assistive-technology remediation;
- independently double-reviewed, rights-cleared fraud/action corpus and agreed release thresholds; and
- Philippines employment/privacy/security advice only if that operating option remains in scope.

Prepare incident response, breach notification, customer rights, deletion verification, refund, complaint, vulnerability disclosure, accessibility support, and vendor-failure runbooks. Buy neither a compliance badge nor a broad intelligence contract as a substitute for evidence.

**Exit evidence:** dated professional reports, remediation traceability, accepted residual-risk owner, approved disclosures/contracts, insurance decision, data/processor register, and current tax/store analysis.

## Gate 5 — Human evidence and operating rehearsal

With separate research authorization and consent—not marketing—run moderated studies with older adults and adult-child pairs on comprehension, self-serve orientation, Check, consent, Trusted Circle, recovery, pricing language, and name trust. Record failures and uncertainty; do not fabricate conversion or safety outcomes.

Rehearse operations using synthetic and consented research cases:

- support taxonomy, routing, truthful hours, senior safety escalation, and incident commander;
- billing reconciliation, refunds, privacy requests, account recovery, provider outage, and status communications;
- Owner Brief/Attention noise, approval expiry, global kill-switch drill, and two-week founder-absence tabletop;
- monthly close, revenue/deferred-revenue/tax/refund reconciliation, spend alerts, and runway; and
- B2B discovery protocol using official institution data without enrichment or outreach unless separately approved.

Update the [50K economics](./50K-SUBSCRIBER-MODEL.md) with current quotes and research observations, the [staffing model](./STAFFING-AND-PHILIPPINES-OPS.md) with measured handle times, and the [Founder Dependency Score](./FOUNDER-DEPENDENCY-MODEL.md) with a four-week time study.

**Exit evidence:** research protocol/results, accessibility and safety remediation, queue capacity/SLA plan, named professional/incident owners, vendor costed bill of materials, and base/downside cash runway. Research participation is not traction.

## Gate 6 — Produce the launch decision dossier, then stop

The dossier must contain:

- exact release tag/artifacts, architecture, account ownership, provider/status inventory, SBOM, CI and restore evidence;
- launch geography/device/channel/price proposal and current store/tax/legal basis;
- fraud/evaluation thresholds, limitations, prohibited claims, incident and rollback criteria;
- identity, commerce, privacy, accessibility, security, support, staffing, observability, and mobile evidence;
- direct versus sponsored metric definitions, contribution/CAC/churn sensitivities, 12-month cash/runway, and spend approvals;
- open risks with owner/deadline, professional opinions, customer/research evidence, and every unresolved external dependency; and
- an exact, reversible launch-day runbook with feature flags, rate limits, support coverage, communications, rollback, and stop-loss thresholds.

The founder records `GO`, `NO-GO`, or `REMEDIATE` with rationale. A `GO` authorizes planning a separate launch run; it does not automatically deploy, charge, contact, publish, submit, hire, or alter DNS.

## Stop conditions

Stop Run 3 on an open Critical/High security or consent defect; unsafe fraud-action regression; failed restore/reconciliation; inaccessible critical path; unclear processor/data rights; no named incident/support owner; unbounded spend; unsupported marketing/safety claim; store/legal uncertainty for the chosen flow; or downside runway below the founder-approved floor.

Run 3 is successful when the founder can make an evidence-backed launch decision and BoomerBuddy can remain safely unlaunched. It is not successful merely because staging renders or a test card succeeds.
