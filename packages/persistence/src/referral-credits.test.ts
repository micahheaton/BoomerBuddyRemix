import { createHash } from 'node:crypto';
import { createSeededTestDatabase, fixedTestNow } from '@boomerbuddy/testkit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReferralProgramDefinition } from '../../domain/src/referral-credits';
import type { Database } from './database';
import { ReferralCreditRepository, type ReferralAuthorityClock } from './referral-credits';
import type { IdFactory } from './values';

const protection = { hmacKey: Buffer.alloc(32, 83), keyVersion: 1 } as const;
let authorityNow = new Date(fixedTestNow);
const authorityClock: ReferralAuthorityClock = async () => new Date(authorityNow);

function sequentialIds(): IdFactory {
  let value = 0;
  return { next: (prefix) => `${prefix}-run3-referral-${++value}` };
}

let operationSequence = 0;
function operationKey(): string {
  operationSequence += 1;
  return `referral:00000000-0000-4000-8000-${operationSequence.toString(16).padStart(12, '0')}`;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function program(overrides: Partial<ReferralProgramDefinition> = {}): ReferralProgramDefinition {
  return {
    programKey: 'run3_referral_research',
    version: 1,
    state: 'approved_disabled',
    variant: 'one_then_three_total',
    effectiveAt: new Date(fixedTestNow.getTime() - 24 * 60 * 60_000),
    expiresAt: new Date(fixedTestNow.getTime() + 30 * 24 * 60 * 60_000),
    qualificationMilestone: 'qualified_account',
    qualifiedCreditMinor: 1_242,
    paidCreditTotalMinor: 3_725,
    currency: 'USD',
    eligibleOfferKey: 'family_annual',
    maximumParticipants: 25,
    maximumReferralsPerReferrer: 3,
    maximumCreditPerReferralMinor: 3_725,
    maximumCreditPerReferrerMinor: 11_175,
    maximumCreditPerHouseholdMinor: 11_175,
    maximumProgramLiabilityMinor: 93_125,
    attributionTtlSeconds: 7 * 24 * 60 * 60,
    settlementHoldSeconds: 14 * 24 * 60 * 60,
    creditExpirySeconds: 365 * 24 * 60 * 60,
    termsVersion: 'referral-terms-v1',
    privacyVersion: 'referral-privacy-v1',
    externalActionEnabled: false,
    ...overrides,
  };
}

describe('disabled Run 3 referral-credit repository', () => {
  let database: Database;
  let repository: ReferralCreditRepository;

  beforeEach(async () => {
    operationSequence = 0;
    authorityNow = new Date(fixedTestNow);
    database = await createSeededTestDatabase(fixedTestNow);
    repository = new ReferralCreditRepository(
      database,
      protection,
      sequentialIds(),
      authorityClock,
    );
  });

  afterEach(async () => {
    await database.close();
  });

  async function issueOpenBind(
    overrides: {
      readonly referrerPersonId?: string;
      readonly referrerHouseholdId?: string;
      readonly referrerPaymentIdentityHmac?: string;
      readonly recipientPersonId?: string;
      readonly recipientHouseholdId?: string;
      readonly recipientPaymentIdentityHmac?: string;
    } = {},
  ) {
    const issued = await repository.issueSimulation({
      programKey: 'run3_referral_research',
      programVersion: 1,
      referrerPersonId: overrides.referrerPersonId ?? 'person-owner-alice',
      referrerHouseholdId: overrides.referrerHouseholdId ?? 'household-sunrise',
      ...(overrides.referrerPaymentIdentityHmac === undefined
        ? {}
        : { referrerPaymentIdentityHmac: overrides.referrerPaymentIdentityHmac }),
      operationKey: operationKey(),
      correlationId: 'referral.issue:local-test',
      simulation: true,
    });
    const token = issued.attributionToken;
    if (token === undefined) throw new Error('Fresh referral token was not returned');
    await repository.openSimulation({
      attributionToken: token,
      evidenceReference: 'local-route-open-one',
      evidenceDigest: digest(`open:${issued.attributionId}`),
      operationKey: operationKey(),
      correlationId: 'referral.open:local-test',
      simulation: true,
    });
    const bound = await repository.bindSimulation({
      attributionToken: token,
      recipientPersonId: overrides.recipientPersonId ?? 'person-owner-bob',
      recipientHouseholdId: overrides.recipientHouseholdId ?? 'household-harbor',
      ...(overrides.recipientPaymentIdentityHmac === undefined
        ? {}
        : { recipientPaymentIdentityHmac: overrides.recipientPaymentIdentityHmac }),
      termsVersion: 'referral-terms-v1',
      privacyVersion: 'referral-privacy-v1',
      evidenceReference: 'local-identity-binding-one',
      evidenceDigest: digest(`bind:${issued.attributionId}`),
      operationKey: operationKey(),
      correlationId: 'referral.bind:local-test',
      simulation: true,
    });
    return { issued, token, bound };
  }

  it('migrates with no seeded program and structurally excludes activation and history mutation', async () => {
    const initial = await database.query<{ readonly count: number } & Record<string, unknown>>(
      'SELECT count(*)::int AS count FROM run3_referral_program_versions',
    );
    expect(initial.rows[0]?.count).toBe(0);
    const created = await repository.createProgram(program());
    expect(created).toMatchObject({ reused: false });
    await expect(repository.createProgram(program())).resolves.toEqual({
      definitionDigest: created.definitionDigest,
      reused: true,
    });

    await expect(
      database.query(
        `INSERT INTO run3_referral_program_versions
         SELECT 'forged_active_program', 1, 'active', variant, attribution_rule,
                effective_at, expires_at, qualification_milestone, qualified_credit_minor,
                paid_credit_total_minor, currency, eligible_offer_key, maximum_participants,
                maximum_referrals_per_referrer, maximum_credit_per_referral_minor,
                maximum_credit_per_referrer_minor, maximum_credit_per_household_minor,
                maximum_program_liability_minor, attribution_ttl_seconds,
                settlement_hold_seconds, credit_expiry_seconds, terms_version,
                privacy_version, $1, evidence_tier, false, false, created_at
         FROM run3_referral_program_versions WHERE program_key = 'run3_referral_research'`,
        [digest('forged-active-program')],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `UPDATE run3_referral_program_versions SET lifecycle_state = 'stopped'
         WHERE program_key = 'run3_referral_research'`,
      ),
    ).rejects.toThrow(/append-only/iu);
    await expect(
      database.query(
        `DELETE FROM run3_referral_program_versions
         WHERE program_key = 'run3_referral_research'`,
      ),
    ).rejects.toThrow(/append-only/iu);
  });

  it('keeps raw tokens absent, binds recipient authority, and records content-free local work only', async () => {
    await repository.createProgram(program());
    const issuanceOperation = operationKey();
    const issued = await repository.issueSimulation({
      programKey: 'run3_referral_research',
      programVersion: 1,
      referrerPersonId: 'person-owner-alice',
      referrerHouseholdId: 'household-sunrise',
      referrerPaymentIdentityHmac: digest('alice-payment'),
      operationKey: issuanceOperation,
      correlationId: 'referral.issue:privacy-test',
      simulation: true,
    });
    const token = issued.attributionToken;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    if (token === undefined) throw new Error('Fresh referral token was not returned');
    const retried = await repository.issueSimulation({
      programKey: 'run3_referral_research',
      programVersion: 1,
      referrerPersonId: 'person-owner-alice',
      referrerHouseholdId: 'household-sunrise',
      referrerPaymentIdentityHmac: digest('alice-payment'),
      operationKey: issuanceOperation,
      correlationId: 'referral.issue:privacy-test',
      simulation: true,
    });
    expect(retried).toMatchObject({ attributionId: issued.attributionId, reused: true });
    expect(retried.attributionToken).toBeUndefined();

    await repository.openSimulation({
      attributionToken: token,
      evidenceReference: 'privacy-open-evidence',
      evidenceDigest: digest('privacy-open'),
      operationKey: operationKey(),
      correlationId: 'referral.open:privacy-test',
      simulation: true,
    });
    await repository.bindSimulation({
      attributionToken: token,
      recipientPersonId: 'person-owner-bob',
      recipientHouseholdId: 'household-harbor',
      recipientPaymentIdentityHmac: digest('bob-payment'),
      termsVersion: 'referral-terms-v1',
      privacyVersion: 'referral-privacy-v1',
      evidenceReference: 'privacy-binding-evidence',
      evidenceDigest: digest('privacy-binding'),
      operationKey: operationKey(),
      correlationId: 'referral.bind:privacy-test',
      simulation: true,
    });
    const qualified = await repository.qualifyFromServerEvent({
      attributionId: issued.attributionId,
      recipientPersonId: 'person-owner-bob',
      recipientHouseholdId: 'household-harbor',
      eventKind: 'account_eligible',
      serverEventReference: 'server-account-event-one',
      serverEventDigest: digest('server-account-event-one'),
      serverGenerated: true,
      occurredAt: fixedTestNow,
      operationKey: operationKey(),
      correlationId: 'referral.qualify:privacy-test',
    });
    expect(qualified).toMatchObject({
      state: 'qualified',
      programActive: false,
      providerCreditApplied: false,
      messageSent: false,
      externalActionExecuted: false,
      ledgerEntries: [{ kind: 'reserved', amountMinor: 1_242 }],
    });
    const settlement = await repository.recordFinancialEvent({
      attributionId: issued.attributionId,
      eventKind: 'settlement',
      subscriptionReferenceHmac: digest('subscription-one'),
      invoiceReferenceHmac: digest('invoice-one'),
      lineReferenceHmac: digest('line-one'),
      canonicalOfferKey: 'family_annual',
      currency: 'USD',
      principalMinor: 14_900,
      sourceAuthenticated: true,
      providerExecutionRequested: false,
      occurredAt: fixedTestNow,
      operationKey: operationKey(),
      correlationId: 'referral.settlement:privacy-test',
    });
    expect(settlement.ledgerEntries.map((entry) => [entry.kind, entry.amountMinor])).toEqual([
      ['reversed', 1_242],
      ['earned', 3_725],
    ]);
    await expect(repository.balance(issued.attributionId)).resolves.toBe(3_725);

    const stored = await database.query<
      { readonly serialized: string; readonly token_hmac: string } & Record<string, unknown>
    >(
      `SELECT to_jsonb(attribution)::text AS serialized, token_hmac
       FROM run3_referral_attributions attribution WHERE id = $1`,
      [issued.attributionId],
    );
    expect(stored.rows[0]?.serialized).not.toContain(token);
    expect(stored.rows[0]?.token_hmac).not.toBe(token);
    const jobs = await database.query<
      {
        readonly payload: unknown;
        readonly provider_processed: boolean;
        readonly provider_credit_applied: boolean;
        readonly external_action_executed: boolean;
      } & Record<string, unknown>
    >(
      `SELECT durable.payload, receipt.provider_processed, receipt.provider_credit_applied,
              receipt.external_action_executed
       FROM run3_referral_processing_jobs receipt
       JOIN durable_jobs durable ON durable.id = receipt.durable_job_id
       ORDER BY receipt.created_at, receipt.id`,
    );
    expect(jobs.rows).toHaveLength(2);
    for (const job of jobs.rows) {
      const payload = JSON.stringify(job.payload);
      expect(payload).toContain(issued.attributionId);
      expect(payload).not.toMatch(/token|payment|invoice|subscription|email|phone|message/iu);
      expect(job).toMatchObject({
        provider_processed: false,
        provider_credit_applied: false,
        external_action_executed: false,
      });
    }
    const ledger = await repository.ledger(issued.attributionId);
    expect(ledger.map((entry) => entry.kind)).toEqual(['reserved', 'reversed', 'earned']);
    expect(ledger.every((entry) => !entry.providerCreditApplied)).toBe(true);
    await expect(
      repository.localHqQueue({
        actorPersonId: 'person-hq-sam',
        correlationId: 'referral.hq:support-denied',
        limit: 10,
      }),
    ).rejects.toThrow('unavailable');
    const queue = await repository.localHqQueue({
      actorPersonId: 'person-hq-riley',
      correlationId: 'referral.hq:reviewer-projection',
      limit: 10,
    });
    expect(queue).toEqual([
      expect.objectContaining({
        attributionId: issued.attributionId,
        programState: 'approved_disabled',
        attributionState: 'identity_bound',
        qualificationState: 'qualified',
        balanceMinor: 3_725,
        contentIncluded: false,
        contactIncluded: false,
        recipientIdentityIncluded: false,
        paymentIdentityIncluded: false,
        providerCreditApplied: false,
        externalActionExecuted: false,
      }),
    ]);
    const queueJson = JSON.stringify(queue);
    expect(queueJson).not.toContain('person-owner-alice');
    expect(queueJson).not.toContain('person-owner-bob');
    expect(queueJson).not.toContain('household-sunrise');
    expect(queueJson).not.toContain('household-harbor');
    expect(queueJson).not.toContain(token);
    expect(queueJson).not.toContain(digest('alice-payment'));
  });

  it('fails self, household, payment-identity, stolen-token, and parallel first-touch conflicts', async () => {
    await repository.createProgram(program());
    const payment = digest('shared-payment');
    const first = await repository.issueSimulation({
      programKey: 'run3_referral_research',
      programVersion: 1,
      referrerPersonId: 'person-owner-alice',
      referrerHouseholdId: 'household-sunrise',
      referrerPaymentIdentityHmac: payment,
      operationKey: operationKey(),
      correlationId: 'referral.issue:conflict-one',
      simulation: true,
    });
    const firstToken = first.attributionToken;
    if (firstToken === undefined) throw new Error('Fresh referral token was not returned');
    await repository.openSimulation({
      attributionToken: firstToken,
      evidenceReference: 'conflict-open-one',
      evidenceDigest: digest('conflict-open-one'),
      operationKey: operationKey(),
      correlationId: 'referral.open:conflict-one',
      simulation: true,
    });
    await expect(
      repository.bindSimulation({
        attributionToken: firstToken,
        recipientPersonId: 'person-owner-alice',
        recipientHouseholdId: 'household-sunrise',
        recipientPaymentIdentityHmac: payment,
        termsVersion: 'referral-terms-v1',
        privacyVersion: 'referral-privacy-v1',
        evidenceReference: 'self-binding-evidence',
        evidenceDigest: digest('self-binding'),
        operationKey: operationKey(),
        correlationId: 'referral.bind:self-conflict',
        simulation: true,
      }),
    ).rejects.toThrow(/identity conflict/iu);
    await expect(
      repository.openSimulation({
        attributionToken: digest('forged-or-stolen-token'),
        evidenceReference: 'forged-token-open',
        evidenceDigest: digest('forged-token-open'),
        operationKey: operationKey(),
        correlationId: 'referral.open:forged-token',
        simulation: true,
      }),
    ).rejects.toThrow('unavailable');

    const second = await repository.issueSimulation({
      programKey: 'run3_referral_research',
      programVersion: 1,
      referrerPersonId: 'person-protected-pat',
      referrerHouseholdId: 'household-sunrise',
      operationKey: operationKey(),
      correlationId: 'referral.issue:conflict-two',
      simulation: true,
    });
    const secondToken = second.attributionToken;
    if (secondToken === undefined) throw new Error('Fresh referral token was not returned');
    await repository.openSimulation({
      attributionToken: secondToken,
      evidenceReference: 'conflict-open-two',
      evidenceDigest: digest('conflict-open-two'),
      operationKey: operationKey(),
      correlationId: 'referral.open:conflict-two',
      simulation: true,
    });
    const attempts = await Promise.allSettled([
      repository.bindSimulation({
        attributionToken: firstToken,
        recipientPersonId: 'person-owner-bob',
        recipientHouseholdId: 'household-harbor',
        recipientPaymentIdentityHmac: digest('bob-payment'),
        termsVersion: 'referral-terms-v1',
        privacyVersion: 'referral-privacy-v1',
        evidenceReference: 'parallel-binding-one',
        evidenceDigest: digest('parallel-binding-one'),
        operationKey: operationKey(),
        correlationId: 'referral.bind:parallel-one',
        simulation: true,
      }),
      repository.bindSimulation({
        attributionToken: secondToken,
        recipientPersonId: 'person-owner-bob',
        recipientHouseholdId: 'household-harbor',
        recipientPaymentIdentityHmac: digest('bob-payment'),
        termsVersion: 'referral-terms-v1',
        privacyVersion: 'referral-privacy-v1',
        evidenceReference: 'parallel-binding-two',
        evidenceDigest: digest('parallel-binding-two'),
        operationKey: operationKey(),
        correlationId: 'referral.bind:parallel-two',
        simulation: true,
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    const bindingCount = await database.query<{ readonly count: number } & Record<string, unknown>>(
      `SELECT count(*)::int AS count FROM run3_referral_attribution_events
       WHERE event_kind = 'identity_bound' AND recipient_person_id = 'person-owner-bob'`,
    );
    expect(bindingCount.rows[0]?.count).toBe(1);
  });

  it('rejects forged milestones, canonical financial mismatch, direct ledger fabrication, and over-refund', async () => {
    await repository.createProgram(program());
    const { issued } = await issueOpenBind();
    const denied = await repository.qualifyFromServerEvent({
      attributionId: issued.attributionId,
      recipientPersonId: 'person-owner-bob',
      recipientHouseholdId: 'household-harbor',
      eventKind: 'orientation_ready',
      serverEventReference: 'wrong-server-event-one',
      serverEventDigest: digest('wrong-server-event-one'),
      serverGenerated: true,
      occurredAt: fixedTestNow,
      operationKey: operationKey(),
      correlationId: 'referral.qualify:wrong-milestone',
    });
    expect(denied).toMatchObject({ state: 'denied', ledgerEntries: [] });
    await expect(
      repository.recordFinancialEvent({
        attributionId: issued.attributionId,
        eventKind: 'settlement',
        subscriptionReferenceHmac: digest('denied-subscription'),
        invoiceReferenceHmac: digest('denied-invoice'),
        lineReferenceHmac: digest('denied-line'),
        canonicalOfferKey: 'family_annual',
        currency: 'USD',
        principalMinor: 14_900,
        sourceAuthenticated: true,
        providerExecutionRequested: false,
        occurredAt: fixedTestNow,
        operationKey: operationKey(),
        correlationId: 'referral.settlement:denied',
      }),
    ).rejects.toThrow(/qualified canonical lineage/iu);

    await repository.createProgram(program({ programKey: 'run3_referral_exact_finance' }));
    const exact = await repository.issueSimulation({
      programKey: 'run3_referral_exact_finance',
      programVersion: 1,
      referrerPersonId: 'person-owner-alice',
      referrerHouseholdId: 'household-sunrise',
      operationKey: operationKey(),
      correlationId: 'referral.issue:exact-finance',
      simulation: true,
    });
    const exactToken = exact.attributionToken;
    if (exactToken === undefined) throw new Error('Fresh referral token was not returned');
    await repository.openSimulation({
      attributionToken: exactToken,
      evidenceReference: 'exact-finance-open',
      evidenceDigest: digest('exact-finance-open'),
      operationKey: operationKey(),
      correlationId: 'referral.open:exact-finance',
      simulation: true,
    });
    await repository.bindSimulation({
      attributionToken: exactToken,
      recipientPersonId: 'person-owner-bob',
      recipientHouseholdId: 'household-harbor',
      termsVersion: 'referral-terms-v1',
      privacyVersion: 'referral-privacy-v1',
      evidenceReference: 'exact-finance-bind',
      evidenceDigest: digest('exact-finance-bind'),
      operationKey: operationKey(),
      correlationId: 'referral.bind:exact-finance',
      simulation: true,
    });
    await repository.qualifyFromServerEvent({
      attributionId: exact.attributionId,
      recipientPersonId: 'person-owner-bob',
      recipientHouseholdId: 'household-harbor',
      eventKind: 'account_eligible',
      serverEventReference: 'exact-finance-qualify',
      serverEventDigest: digest('exact-finance-qualify'),
      serverGenerated: true,
      occurredAt: fixedTestNow,
      operationKey: operationKey(),
      correlationId: 'referral.qualify:exact-finance',
    });
    await expect(
      repository.recordFinancialEvent({
        attributionId: exact.attributionId,
        eventKind: 'settlement',
        subscriptionReferenceHmac: digest('exact-subscription'),
        invoiceReferenceHmac: digest('exact-invoice'),
        lineReferenceHmac: digest('exact-line'),
        canonicalOfferKey: 'wrong_annual_offer',
        currency: 'USD',
        principalMinor: 14_900,
        sourceAuthenticated: true,
        providerExecutionRequested: false,
        occurredAt: fixedTestNow,
        operationKey: operationKey(),
        correlationId: 'referral.settlement:wrong-offer',
      }),
    ).rejects.toThrow(/canonical lineage/iu);
    const settlement = await repository.recordFinancialEvent({
      attributionId: exact.attributionId,
      eventKind: 'settlement',
      subscriptionReferenceHmac: digest('exact-subscription'),
      invoiceReferenceHmac: digest('exact-invoice'),
      lineReferenceHmac: digest('exact-line'),
      canonicalOfferKey: 'family_annual',
      currency: 'USD',
      principalMinor: 14_900,
      sourceAuthenticated: true,
      providerExecutionRequested: false,
      occurredAt: fixedTestNow,
      operationKey: operationKey(),
      correlationId: 'referral.settlement:exact',
    });
    const financialId = settlement.ledgerEntries.find(
      (entry) => entry.kind === 'earned',
    )?.sourceReference;
    if (financialId === undefined) throw new Error('Settlement financial lineage missing');
    await expect(
      repository.recordFinancialEvent({
        attributionId: exact.attributionId,
        eventKind: 'refund',
        parentFinancialEventId: financialId,
        subscriptionReferenceHmac: digest('exact-subscription'),
        invoiceReferenceHmac: digest('exact-invoice'),
        lineReferenceHmac: digest('exact-line'),
        canonicalOfferKey: 'family_annual',
        currency: 'USD',
        principalMinor: 14_901,
        sourceAuthenticated: true,
        providerExecutionRequested: false,
        occurredAt: fixedTestNow,
        operationKey: operationKey(),
        correlationId: 'referral.refund:over-principal',
      }),
    ).rejects.toThrow(/exceeds settled principal/iu);

    const reserved = (await repository.ledger(exact.attributionId))[0];
    if (reserved === undefined) throw new Error('Reserved ledger evidence missing');
    await expect(
      database.query(
        `INSERT INTO run3_referral_credit_entries(
           id, attribution_id, program_key, program_version, receiving_person_id,
           receiving_household_id, sequence, entry_kind, amount_minor, currency, canonical_offer_key,
           source_type, source_reference, source_evidence_digest, source_entry_id, reason_code,
           idempotency_key, audit_correlation_id, available_at, expires_at, evidence_tier,
           provider_credit_applied, external_action_executed, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,4,'earned',1,'USD',$7,'financial',$8,$9,NULL,
           'forged_earning',$10,'referral.forged:ledger',$11,$12,'local_simulation',false,false,$13)`,
        [
          'referral-ledger-forged',
          exact.attributionId,
          reserved.programKey,
          reserved.programVersion,
          reserved.receivingPersonId,
          reserved.receivingHouseholdId,
          reserved.canonicalOfferKey,
          'forged-financial-source',
          digest('forged-ledger-source'),
          operationKey(),
          fixedTestNow.toISOString(),
          new Date(fixedTestNow.getTime() + 60_000).toISOString(),
          fixedTestNow.toISOString(),
        ],
      ),
    ).rejects.toThrow(/authenticated lineage/iu);
    await expect(
      database.query(
        `UPDATE run3_referral_credit_entries SET amount_minor = 1
         WHERE id = $1`,
        [reserved.id],
      ),
    ).rejects.toThrow(/append-only/iu);
  });

  it('requires internal correction authority and appends bounded correction, refund, and expiry evidence', async () => {
    await repository.createProgram(program({ creditExpirySeconds: 3_600 }));
    const { issued } = await issueOpenBind();
    await repository.qualifyFromServerEvent({
      attributionId: issued.attributionId,
      recipientPersonId: 'person-owner-bob',
      recipientHouseholdId: 'household-harbor',
      eventKind: 'account_eligible',
      serverEventReference: 'correction-qualify-event',
      serverEventDigest: digest('correction-qualify-event'),
      serverGenerated: true,
      occurredAt: fixedTestNow,
      operationKey: operationKey(),
      correlationId: 'referral.qualify:correction',
    });
    const settlement = await repository.recordFinancialEvent({
      attributionId: issued.attributionId,
      eventKind: 'settlement',
      subscriptionReferenceHmac: digest('correction-subscription'),
      invoiceReferenceHmac: digest('correction-invoice'),
      lineReferenceHmac: digest('correction-line'),
      canonicalOfferKey: 'family_annual',
      currency: 'USD',
      principalMinor: 14_900,
      sourceAuthenticated: true,
      providerExecutionRequested: false,
      occurredAt: fixedTestNow,
      operationKey: operationKey(),
      correlationId: 'referral.settlement:correction',
    });
    const settlementId = settlement.ledgerEntries.find(
      (entry) => entry.kind === 'earned',
    )?.sourceReference;
    if (settlementId === undefined) throw new Error('Settlement financial lineage missing');
    const refunded = await repository.recordFinancialEvent({
      attributionId: issued.attributionId,
      eventKind: 'refund',
      parentFinancialEventId: settlementId,
      subscriptionReferenceHmac: digest('correction-subscription'),
      invoiceReferenceHmac: digest('correction-invoice'),
      lineReferenceHmac: digest('correction-line'),
      canonicalOfferKey: 'family_annual',
      currency: 'USD',
      principalMinor: 7_450,
      sourceAuthenticated: true,
      providerExecutionRequested: false,
      occurredAt: fixedTestNow,
      operationKey: operationKey(),
      correlationId: 'referral.refund:partial',
    });
    expect(refunded.ledgerEntries).toEqual([
      expect.objectContaining({ kind: 'reversed', amountMinor: 1_862 }),
    ]);
    await expect(repository.balance(issued.attributionId)).resolves.toBe(1_863);
    const correctionTargets = await repository.ledger(issued.attributionId);
    const reversedReservation = correctionTargets.find((entry) => entry.kind === 'reserved');
    const earnedTarget = correctionTargets.find((entry) => entry.kind === 'earned');
    if (reversedReservation === undefined || earnedTarget === undefined) {
      throw new Error('Correction target evidence is unavailable');
    }
    await expect(
      repository.appendReviewedCorrection({
        attributionId: issued.attributionId,
        kind: 'correction_debit',
        targetEntryId: reversedReservation.id,
        amountMinor: 1,
        reviewerPersonId: 'person-hq-riley',
        reviewerAssignmentId: 'employee-hq-riley',
        evidenceReference: 'depleted-correction-target',
        evidenceDigest: digest('depleted-correction-target'),
        reasonCode: 'reviewed_depleted_target_probe',
        operationKey: operationKey(),
        correlationId: 'referral.correction:depleted-target',
      }),
    ).rejects.toThrow(/exact positive source/iu);
    const correctionDebit = await repository.appendReviewedCorrection({
      attributionId: issued.attributionId,
      kind: 'correction_debit',
      targetEntryId: earnedTarget.id,
      amountMinor: 100,
      reviewerPersonId: 'person-hq-riley',
      reviewerAssignmentId: 'employee-hq-riley',
      evidenceReference: 'reviewed-correction-debit',
      evidenceDigest: digest('reviewed-correction-debit'),
      reasonCode: 'reviewed_financial_correction',
      operationKey: operationKey(),
      correlationId: 'referral.correction:debit',
    });
    expect(correctionDebit).toMatchObject({ kind: 'correction_debit', amountMinor: 100 });
    await expect(repository.balance(issued.attributionId)).resolves.toBe(1_763);

    await expect(
      repository.appendReviewedCorrection({
        attributionId: issued.attributionId,
        kind: 'correction_credit',
        amountMinor: 100,
        reviewerPersonId: 'person-hq-sam',
        reviewerAssignmentId: 'employee-hq-sam',
        evidenceReference: 'support-cannot-review-correction',
        evidenceDigest: digest('support-cannot-review-correction'),
        reasonCode: 'false_abuse_hold_restored',
        operationKey: operationKey(),
        correlationId: 'referral.correction:wrong-role',
      }),
    ).rejects.toThrow(/internal authority/iu);
    const correction = await repository.appendReviewedCorrection({
      attributionId: issued.attributionId,
      kind: 'correction_credit',
      amountMinor: 100,
      reviewerPersonId: 'person-hq-riley',
      reviewerAssignmentId: 'employee-hq-riley',
      evidenceReference: 'reviewed-correction-evidence',
      evidenceDigest: digest('reviewed-correction-evidence'),
      reasonCode: 'false_abuse_hold_restored',
      operationKey: operationKey(),
      correlationId: 'referral.correction:reviewed',
    });
    expect(correction).toMatchObject({
      kind: 'correction_credit',
      amountMinor: 100,
      providerCreditApplied: false,
    });
    await expect(repository.balance(issued.attributionId)).resolves.toBe(1_863);

    authorityNow = new Date(fixedTestNow.getTime() + 3_601_000);
    const expired = await repository.expireDue(10);
    expect(expired.length).toBeGreaterThan(0);
    expect(expired.every((entry) => entry.kind === 'expired')).toBe(true);
    expect(await repository.balance(issued.attributionId)).toBeGreaterThanOrEqual(0);
  });

  it('serializes issuance and ledger liability against immutable cumulative caps', async () => {
    await repository.createProgram(
      program({
        programKey: 'run3_referral_cap_test',
        maximumReferralsPerReferrer: 1,
        maximumCreditPerReferrerMinor: 3_725,
        maximumCreditPerHouseholdMinor: 3_725,
        maximumProgramLiabilityMinor: 3_725,
      }),
    );
    const issued = await repository.issueSimulation({
      programKey: 'run3_referral_cap_test',
      programVersion: 1,
      referrerPersonId: 'person-owner-alice',
      referrerHouseholdId: 'household-sunrise',
      operationKey: operationKey(),
      correlationId: 'referral.issue:cap-first',
      simulation: true,
    });
    await expect(
      repository.issueSimulation({
        programKey: 'run3_referral_cap_test',
        programVersion: 1,
        referrerPersonId: 'person-owner-alice',
        referrerHouseholdId: 'household-sunrise',
        operationKey: operationKey(),
        correlationId: 'referral.issue:cap-second',
        simulation: true,
      }),
    ).rejects.toThrow(/cap is exhausted/iu);
    const token = issued.attributionToken;
    if (token === undefined) throw new Error('Fresh referral token was not returned');
    await repository.openSimulation({
      attributionToken: token,
      evidenceReference: 'cap-open-evidence',
      evidenceDigest: digest('cap-open-evidence'),
      operationKey: operationKey(),
      correlationId: 'referral.open:cap',
      simulation: true,
    });
    await repository.bindSimulation({
      attributionToken: token,
      recipientPersonId: 'person-owner-bob',
      recipientHouseholdId: 'household-harbor',
      termsVersion: 'referral-terms-v1',
      privacyVersion: 'referral-privacy-v1',
      evidenceReference: 'cap-binding-evidence',
      evidenceDigest: digest('cap-binding-evidence'),
      operationKey: operationKey(),
      correlationId: 'referral.bind:cap',
      simulation: true,
    });
    await repository.qualifyFromServerEvent({
      attributionId: issued.attributionId,
      recipientPersonId: 'person-owner-bob',
      recipientHouseholdId: 'household-harbor',
      eventKind: 'account_eligible',
      serverEventReference: 'cap-server-event',
      serverEventDigest: digest('cap-server-event'),
      serverGenerated: true,
      occurredAt: fixedTestNow,
      operationKey: operationKey(),
      correlationId: 'referral.qualify:cap',
    });
    await repository.recordFinancialEvent({
      attributionId: issued.attributionId,
      eventKind: 'settlement',
      subscriptionReferenceHmac: digest('cap-subscription'),
      invoiceReferenceHmac: digest('cap-invoice'),
      lineReferenceHmac: digest('cap-line'),
      canonicalOfferKey: 'family_annual',
      currency: 'USD',
      principalMinor: 14_900,
      sourceAuthenticated: true,
      providerExecutionRequested: false,
      occurredAt: fixedTestNow,
      operationKey: operationKey(),
      correlationId: 'referral.settlement:cap',
    });
    await expect(repository.balance(issued.attributionId)).resolves.toBe(3_725);
    await expect(
      repository.appendReviewedCorrection({
        attributionId: issued.attributionId,
        kind: 'correction_credit',
        amountMinor: 1,
        reviewerPersonId: 'person-hq-riley',
        reviewerAssignmentId: 'employee-hq-riley',
        evidenceReference: 'cap-correction-review',
        evidenceDigest: digest('cap-correction-review'),
        reasonCode: 'reviewed_cap_probe',
        operationKey: operationKey(),
        correlationId: 'referral.correction:cap',
      }),
    ).rejects.toThrow(/cumulative cap/iu);
    await expect(repository.balance(issued.attributionId)).resolves.toBe(3_725);
  });

  it('orders recipient, decision, and settlement evidence against database authority time', async () => {
    await repository.createProgram(program());
    const { issued } = await issueOpenBind();
    await expect(
      repository.qualifyFromServerEvent({
        attributionId: issued.attributionId,
        recipientPersonId: 'person-owner-bob',
        recipientHouseholdId: 'household-harbor',
        eventKind: 'account_eligible',
        serverEventReference: 'future-recipient-event',
        serverEventDigest: digest('future-recipient-event'),
        serverGenerated: true,
        occurredAt: new Date('2099-01-01T00:00:00.000Z'),
        operationKey: operationKey(),
        correlationId: 'referral.qualify:future-evidence',
      }),
    ).rejects.toThrow(/identity-bound/iu);
    await expect(
      repository.qualifyFromServerEvent({
        attributionId: issued.attributionId,
        recipientPersonId: 'person-owner-bob',
        recipientHouseholdId: 'household-harbor',
        eventKind: 'account_eligible',
        serverEventReference: 'decision-before-recipient-event',
        serverEventDigest: digest('decision-before-recipient-event'),
        serverGenerated: true,
        occurredAt: new Date(fixedTestNow.getTime() + 60_000),
        operationKey: operationKey(),
        correlationId: 'referral.qualify:decision-before-event',
      }),
    ).rejects.toThrow(/authority time/iu);
    await repository.qualifyFromServerEvent({
      attributionId: issued.attributionId,
      recipientPersonId: 'person-owner-bob',
      recipientHouseholdId: 'household-harbor',
      eventKind: 'account_eligible',
      serverEventReference: 'ordered-recipient-event',
      serverEventDigest: digest('ordered-recipient-event'),
      serverGenerated: true,
      occurredAt: fixedTestNow,
      operationKey: operationKey(),
      correlationId: 'referral.qualify:ordered',
    });
    await expect(
      repository.recordFinancialEvent({
        attributionId: issued.attributionId,
        eventKind: 'settlement',
        subscriptionReferenceHmac: digest('early-subscription'),
        invoiceReferenceHmac: digest('early-invoice'),
        lineReferenceHmac: digest('early-line'),
        canonicalOfferKey: 'family_annual',
        currency: 'USD',
        principalMinor: 14_900,
        sourceAuthenticated: true,
        providerExecutionRequested: false,
        occurredAt: new Date(fixedTestNow.getTime() - 1),
        operationKey: operationKey(),
        correlationId: 'referral.settlement:before-lineage',
      }),
    ).rejects.toThrow(/qualified canonical lineage/iu);
    await expect(repository.balance(issued.attributionId)).resolves.toBe(1_242);
  });

  it('serializes symmetric program-wide payment identity reuse across both roles', async () => {
    await repository.createProgram(program());
    const referrerPayment = digest('symmetric-referrer-payment');
    const recipientPayment = digest('symmetric-recipient-payment');
    const first = await repository.issueSimulation({
      programKey: 'run3_referral_research',
      programVersion: 1,
      referrerPersonId: 'person-owner-alice',
      referrerHouseholdId: 'household-sunrise',
      referrerPaymentIdentityHmac: referrerPayment,
      operationKey: operationKey(),
      correlationId: 'referral.issue:symmetric-first',
      simulation: true,
    });
    const firstToken = first.attributionToken;
    if (firstToken === undefined) throw new Error('Fresh referral token was not returned');
    await repository.openSimulation({
      attributionToken: firstToken,
      evidenceReference: 'symmetric-first-open',
      evidenceDigest: digest('symmetric-first-open'),
      operationKey: operationKey(),
      correlationId: 'referral.open:symmetric-first',
      simulation: true,
    });
    await repository.bindSimulation({
      attributionToken: firstToken,
      recipientPersonId: 'person-owner-bob',
      recipientHouseholdId: 'household-harbor',
      recipientPaymentIdentityHmac: recipientPayment,
      termsVersion: 'referral-terms-v1',
      privacyVersion: 'referral-privacy-v1',
      evidenceReference: 'symmetric-first-bind',
      evidenceDigest: digest('symmetric-first-bind'),
      operationKey: operationKey(),
      correlationId: 'referral.bind:symmetric-first',
      simulation: true,
    });
    await expect(
      repository.issueSimulation({
        programKey: 'run3_referral_research',
        programVersion: 1,
        referrerPersonId: 'person-protected-pat',
        referrerHouseholdId: 'household-sunrise',
        referrerPaymentIdentityHmac: recipientPayment,
        operationKey: operationKey(),
        correlationId: 'referral.issue:recipient-reused-as-referrer',
        simulation: true,
      }),
    ).rejects.toThrow(/payment identity is already used/iu);
    await repository.createProgram(program({ version: 2 }));
    await expect(
      repository.issueSimulation({
        programKey: 'run3_referral_research',
        programVersion: 2,
        referrerPersonId: 'person-protected-pat',
        referrerHouseholdId: 'household-sunrise',
        referrerPaymentIdentityHmac: recipientPayment,
        operationKey: operationKey(),
        correlationId: 'referral.issue:cross-version-recipient-reuse',
        simulation: true,
      }),
    ).rejects.toThrow(/payment identity is already used/iu);
    await expect(
      repository.issueSimulation({
        programKey: 'run3_referral_research',
        programVersion: 1,
        referrerPersonId: 'person-protected-pat',
        referrerHouseholdId: 'household-sunrise',
        referrerPaymentIdentityHmac: referrerPayment,
        operationKey: operationKey(),
        correlationId: 'referral.issue:referrer-payment-reused',
        simulation: true,
      }),
    ).rejects.toThrow(/payment identity is already used/iu);
    const second = await repository.issueSimulation({
      programKey: 'run3_referral_research',
      programVersion: 1,
      referrerPersonId: 'person-protected-pat',
      referrerHouseholdId: 'household-sunrise',
      referrerPaymentIdentityHmac: digest('symmetric-distinct-referrer-payment'),
      operationKey: operationKey(),
      correlationId: 'referral.issue:symmetric-second',
      simulation: true,
    });
    const secondToken = second.attributionToken;
    if (secondToken === undefined) throw new Error('Fresh referral token was not returned');
    await repository.openSimulation({
      attributionToken: secondToken,
      evidenceReference: 'symmetric-second-open',
      evidenceDigest: digest('symmetric-second-open'),
      operationKey: operationKey(),
      correlationId: 'referral.open:symmetric-second',
      simulation: true,
    });
    await expect(
      repository.bindSimulation({
        attributionToken: secondToken,
        recipientPersonId: 'person-protected-olivia',
        recipientHouseholdId: 'household-harbor',
        recipientPaymentIdentityHmac: referrerPayment,
        termsVersion: 'referral-terms-v1',
        privacyVersion: 'referral-privacy-v1',
        evidenceReference: 'referrer-reused-as-recipient',
        evidenceDigest: digest('referrer-reused-as-recipient'),
        operationKey: operationKey(),
        correlationId: 'referral.bind:referrer-reused-as-recipient',
        simulation: true,
      }),
    ).rejects.toThrow(/payment identity is already used/iu);

    await repository.createProgram(program({ programKey: 'run3_referral_payment_race' }));
    await repository.createProgram(
      program({ programKey: 'run3_referral_payment_race', version: 2 }),
    );
    const sharedRacePayment = digest('symmetric-concurrent-payment');
    const concurrent = await Promise.allSettled([
      repository.issueSimulation({
        programKey: 'run3_referral_payment_race',
        programVersion: 2,
        referrerPersonId: 'person-owner-alice',
        referrerHouseholdId: 'household-sunrise',
        referrerPaymentIdentityHmac: sharedRacePayment,
        operationKey: operationKey(),
        correlationId: 'referral.issue:payment-race-one',
        simulation: true,
      }),
      repository.issueSimulation({
        programKey: 'run3_referral_payment_race',
        programVersion: 1,
        referrerPersonId: 'person-protected-pat',
        referrerHouseholdId: 'household-sunrise',
        referrerPaymentIdentityHmac: sharedRacePayment,
        operationKey: operationKey(),
        correlationId: 'referral.issue:payment-race-two',
        simulation: true,
      }),
    ]);
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('cumulates rounded refund and dispute principal independently from emitted reversals', async () => {
    await repository.createProgram(program());
    const { issued } = await issueOpenBind();
    await repository.qualifyFromServerEvent({
      attributionId: issued.attributionId,
      recipientPersonId: 'person-owner-bob',
      recipientHouseholdId: 'household-harbor',
      eventKind: 'account_eligible',
      serverEventReference: 'rounding-qualification-event',
      serverEventDigest: digest('rounding-qualification-event'),
      serverGenerated: true,
      occurredAt: fixedTestNow,
      operationKey: operationKey(),
      correlationId: 'referral.qualify:rounding-regression',
    });
    const subscriptionReferenceHmac = digest('rounding-subscription');
    const invoiceReferenceHmac = digest('rounding-invoice');
    const lineReferenceHmac = digest('rounding-line');
    const settlement = await repository.recordFinancialEvent({
      attributionId: issued.attributionId,
      eventKind: 'settlement',
      subscriptionReferenceHmac,
      invoiceReferenceHmac,
      lineReferenceHmac,
      canonicalOfferKey: 'family_annual',
      currency: 'USD',
      principalMinor: 14_900,
      sourceAuthenticated: true,
      providerExecutionRequested: false,
      occurredAt: fixedTestNow,
      operationKey: operationKey(),
      correlationId: 'referral.settlement:rounding-regression',
    });
    const earned = settlement.ledgerEntries.find((entry) => entry.kind === 'earned');
    if (earned === undefined) throw new Error('Rounded reversal source is unavailable');
    expect(earned.amountMinor).toBe(3_725);

    const childInput = (
      eventKind: 'refund' | 'dispute',
      label: string,
      financialOperationKey = operationKey(),
    ) => ({
      attributionId: issued.attributionId,
      eventKind,
      parentFinancialEventId: earned.sourceReference,
      subscriptionReferenceHmac,
      invoiceReferenceHmac,
      lineReferenceHmac,
      canonicalOfferKey: 'family_annual' as const,
      currency: 'USD' as const,
      principalMinor: 1,
      sourceAuthenticated: true as const,
      providerExecutionRequested: false as const,
      occurredAt: fixedTestNow,
      operationKey: financialOperationKey,
      correlationId: `referral.${eventKind}:rounding-${label}`,
    });
    const sequentialInputs = [1, 2, 3, 4].map((index) =>
      childInput('refund', `sequential-${index}`),
    );
    const sequentialResults = [];
    for (const input of sequentialInputs) {
      sequentialResults.push(await repository.recordFinancialEvent(input));
    }
    expect(sequentialResults.slice(0, 3).flatMap((result) => result.ledgerEntries)).toEqual([]);
    expect(
      sequentialResults[3]?.ledgerEntries.map((entry) => [entry.kind, entry.amountMinor]),
    ).toEqual([['reversed', 1]]);
    const zeroRoundingRetryInput = sequentialInputs[0];
    if (zeroRoundingRetryInput === undefined) {
      throw new Error('Zero-rounding retry input is unavailable');
    }
    await expect(repository.recordFinancialEvent(zeroRoundingRetryInput)).resolves.toMatchObject({
      reused: true,
      ledgerEntries: [],
    });
    const retryInput = sequentialInputs[3];
    if (retryInput === undefined) throw new Error('Rounded retry input is unavailable');
    await expect(repository.recordFinancialEvent(retryInput)).resolves.toMatchObject({
      reused: true,
      ledgerEntries: [{ kind: 'reversed', amountMinor: 1 }],
    });

    const mixedResults = await Promise.all(
      [
        childInput('refund', 'concurrent-five'),
        childInput('dispute', 'concurrent-six'),
        childInput('refund', 'concurrent-seven'),
        childInput('dispute', 'concurrent-eight'),
      ].map((input) => repository.recordFinancialEvent(input)),
    );
    expect(
      mixedResults
        .flatMap((result) => result.ledgerEntries)
        .reduce((total, entry) => total + entry.amountMinor, 0),
    ).toBe(1);

    const repositoryTotals = await database.query<
      {
        readonly child_count: number;
        readonly dispute_count: number;
        readonly principal_minor: number;
        readonly refund_count: number;
      } & Record<string, unknown>
    >(
      `SELECT count(*)::int AS child_count,
              count(*) FILTER (WHERE event_kind = 'refund')::int AS refund_count,
              count(*) FILTER (WHERE event_kind = 'dispute')::int AS dispute_count,
              COALESCE(sum(principal_minor), 0)::int AS principal_minor
       FROM run3_referral_financial_events
       WHERE parent_financial_event_id = $1`,
      [earned.sourceReference],
    );
    expect(repositoryTotals.rows[0]).toEqual({
      child_count: 8,
      dispute_count: 2,
      principal_minor: 8,
      refund_count: 6,
    });
    const repositoryReversals = await database.query<
      { readonly amount_minor: number; readonly source_reference: string } & Record<string, unknown>
    >(
      `SELECT amount_minor, source_reference FROM run3_referral_credit_entries
       WHERE source_entry_id = $1 AND entry_kind = 'reversed' ORDER BY sequence`,
      [earned.id],
    );
    expect(repositoryReversals.rows.map((row) => row.amount_minor)).toEqual([1, 1]);
    expect(new Set(repositoryReversals.rows.map((row) => row.source_reference)).size).toBe(2);

    const insertDirectChild = async (index: number, eventKind: 'refund' | 'dispute') => {
      const id = `referral-financial-rounding-sql-${index}`;
      const sourceDigest = digest(`rounding-sql-source-${index}`);
      await database.query(
        `INSERT INTO run3_referral_financial_events(
           id, attribution_id, event_kind, parent_financial_event_id, source_event_hmac,
           subscription_reference_hmac, invoice_reference_hmac, line_reference_hmac,
           canonical_offer_key, currency, principal_minor, source_authenticated,
           evidence_tier, provider_execution_requested, provider_credit_applied,
           external_action_executed, operation_key, occurred_at, recorded_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'family_annual','USD',1,true,
           'local_simulation',false,false,false,$9,$10,$10)`,
        [
          id,
          issued.attributionId,
          eventKind,
          earned.sourceReference,
          sourceDigest,
          subscriptionReferenceHmac,
          invoiceReferenceHmac,
          lineReferenceHmac,
          operationKey(),
          fixedTestNow.toISOString(),
        ],
      );
      return { id, sourceDigest, eventKind };
    };
    const insertDirectReversal = async (input: {
      readonly id: string;
      readonly sourceDigest: string;
      readonly eventKind: 'refund' | 'dispute';
    }) => {
      const sequence = await database.query<
        { readonly next_sequence: number } & Record<string, unknown>
      >(
        `SELECT COALESCE(max(sequence), 0)::int + 1 AS next_sequence
         FROM run3_referral_credit_entries WHERE attribution_id = $1`,
        [issued.attributionId],
      );
      return database.query(
        `INSERT INTO run3_referral_credit_entries(
           id, attribution_id, program_key, program_version, receiving_person_id,
           receiving_household_id, sequence, entry_kind, amount_minor, currency,
           canonical_offer_key, source_type, source_reference, source_evidence_digest,
           source_entry_id, reason_code, idempotency_key, audit_correlation_id,
           available_at, expires_at, evidence_tier, provider_credit_applied,
           external_action_executed, created_at
         ) VALUES ('referral-ledger-rounding-sql',$1,$2,$3,$4,$5,$6,'reversed',1,'USD',
           $7,'financial',$8,$9,$10,$11,$12,'referral.sql:rounding-regression',
           NULL,NULL,'local_simulation',false,false,$13)`,
        [
          issued.attributionId,
          earned.programKey,
          earned.programVersion,
          earned.receivingPersonId,
          earned.receivingHouseholdId,
          sequence.rows[0]?.next_sequence,
          earned.canonicalOfferKey,
          input.id,
          input.sourceDigest,
          earned.id,
          `authenticated_${input.eventKind}`,
          operationKey(),
          fixedTestNow.toISOString(),
        ],
      );
    };

    const ninth = await insertDirectChild(9, 'refund');
    await expect(insertDirectReversal(ninth)).rejects.toThrow(/exact source/iu);
    await insertDirectChild(10, 'dispute');
    await insertDirectChild(11, 'refund');
    const twelfth = await insertDirectChild(12, 'dispute');
    await expect(insertDirectReversal(twelfth)).resolves.toMatchObject({ rowCount: 1 });

    const finalTotals = await database.query<
      {
        readonly principal_minor: number;
        readonly reversal_minor: number;
        readonly reversal_sources: number;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT COALESCE(sum(principal_minor), 0)::int
          FROM run3_referral_financial_events
          WHERE parent_financial_event_id = $1
            AND event_kind IN ('refund','dispute')) AS principal_minor,
         COALESCE(sum(amount_minor), 0)::int AS reversal_minor,
         count(DISTINCT source_reference)::int AS reversal_sources
       FROM run3_referral_credit_entries
       WHERE source_entry_id = $2 AND entry_kind = 'reversed'`,
      [earned.sourceReference, earned.id],
    );
    expect(finalTotals.rows[0]).toEqual({
      principal_minor: 12,
      reversal_minor: 3,
      reversal_sources: 3,
    });
  });

  it('binds each ledger kind to one exact source digest, time, target, and bounded amount', async () => {
    await repository.createProgram(program());
    const { issued } = await issueOpenBind();
    await repository.qualifyFromServerEvent({
      attributionId: issued.attributionId,
      recipientPersonId: 'person-owner-bob',
      recipientHouseholdId: 'household-harbor',
      eventKind: 'account_eligible',
      serverEventReference: 'exact-ledger-qualification',
      serverEventDigest: digest('exact-ledger-qualification'),
      serverGenerated: true,
      occurredAt: fixedTestNow,
      operationKey: operationKey(),
      correlationId: 'referral.qualify:exact-ledger',
    });
    const settlement = await repository.recordFinancialEvent({
      attributionId: issued.attributionId,
      eventKind: 'settlement',
      subscriptionReferenceHmac: digest('exact-ledger-subscription'),
      invoiceReferenceHmac: digest('exact-ledger-invoice'),
      lineReferenceHmac: digest('exact-ledger-line'),
      canonicalOfferKey: 'family_annual',
      currency: 'USD',
      principalMinor: 14_900,
      sourceAuthenticated: true,
      providerExecutionRequested: false,
      occurredAt: fixedTestNow,
      operationKey: operationKey(),
      correlationId: 'referral.settlement:exact-ledger',
    });
    const settlementId = settlement.ledgerEntries.find(
      (entry) => entry.kind === 'earned',
    )?.sourceReference;
    if (settlementId === undefined) throw new Error('Settlement source is unavailable');
    const initialLedger = await repository.ledger(issued.attributionId);
    const reserved = initialLedger.find((entry) => entry.kind === 'reserved');
    const earned = initialLedger.find((entry) => entry.kind === 'earned');
    if (reserved === undefined || earned === undefined) {
      throw new Error('Positive source entries are unavailable');
    }
    const settlementLineage = await database.query<
      {
        readonly subscription_reference_hmac: string;
        readonly invoice_reference_hmac: string;
        readonly line_reference_hmac: string;
        readonly canonical_offer_key: string;
        readonly currency: string;
      } & Record<string, unknown>
    >(
      `SELECT subscription_reference_hmac, invoice_reference_hmac, line_reference_hmac,
              canonical_offer_key, currency
       FROM run3_referral_financial_events WHERE id = $1`,
      [settlementId],
    );
    const lineage = settlementLineage.rows[0];
    if (lineage === undefined) throw new Error('Settlement lineage is unavailable');

    const directRefundId = 'referral-financial-direct-refund-one';
    const directRefundDigest = digest('direct-refund-source-one');
    await database.query(
      `INSERT INTO run3_referral_financial_events(
         id, attribution_id, event_kind, parent_financial_event_id, source_event_hmac,
         subscription_reference_hmac, invoice_reference_hmac, line_reference_hmac,
         canonical_offer_key, currency, principal_minor, source_authenticated,
         evidence_tier, provider_execution_requested, provider_credit_applied,
         external_action_executed, operation_key, occurred_at, recorded_at
       ) VALUES ($1,$2,'refund',$3,$4,$5,$6,$7,$8,$9,7450,true,'local_simulation',
         false,false,false,$10,$11,$11)`,
      [
        directRefundId,
        issued.attributionId,
        settlementId,
        directRefundDigest,
        lineage.subscription_reference_hmac,
        lineage.invoice_reference_hmac,
        lineage.line_reference_hmac,
        lineage.canonical_offer_key,
        lineage.currency,
        operationKey(),
        fixedTestNow.toISOString(),
      ],
    );

    const insertDirectReversal = (input: {
      readonly id: string;
      readonly sequence: number;
      readonly financialId: string;
      readonly sourceDigest: string;
      readonly sourceEntryId: string;
      readonly amountMinor: number;
      readonly reasonCode?: string;
      readonly createdAt?: Date;
    }) =>
      database.query(
        `INSERT INTO run3_referral_credit_entries(
           id, attribution_id, program_key, program_version, receiving_person_id,
           receiving_household_id, sequence, entry_kind, amount_minor, currency,
           canonical_offer_key, source_type, source_reference, source_evidence_digest,
           source_entry_id, reason_code, idempotency_key, audit_correlation_id,
           available_at, expires_at, evidence_tier, provider_credit_applied,
           external_action_executed, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'reversed',$8,'USD',$9,'financial',$10,$11,$12,
           $13,$14,'referral.direct:lineage-probe',NULL,NULL,'local_simulation',false,false,$15)`,
        [
          input.id,
          issued.attributionId,
          earned.programKey,
          earned.programVersion,
          earned.receivingPersonId,
          earned.receivingHouseholdId,
          input.sequence,
          input.amountMinor,
          earned.canonicalOfferKey,
          input.financialId,
          input.sourceDigest,
          input.sourceEntryId,
          input.reasonCode ?? 'authenticated_refund',
          operationKey(),
          (input.createdAt ?? fixedTestNow).toISOString(),
        ],
      );

    await expect(
      insertDirectReversal({
        id: 'referral-ledger-wrong-digest',
        sequence: 4,
        financialId: directRefundId,
        sourceDigest: digest('wrong-refund-digest'),
        sourceEntryId: earned.id,
        amountMinor: 1_862,
      }),
    ).rejects.toThrow(/authenticated lineage/iu);
    await expect(
      insertDirectReversal({
        id: 'referral-ledger-wrong-time',
        sequence: 4,
        financialId: directRefundId,
        sourceDigest: directRefundDigest,
        sourceEntryId: earned.id,
        amountMinor: 1_862,
        createdAt: new Date(fixedTestNow.getTime() + 1_000),
      }),
    ).rejects.toThrow(/authenticated lineage/iu);
    await expect(
      insertDirectReversal({
        id: 'referral-ledger-wrong-target',
        sequence: 4,
        financialId: directRefundId,
        sourceDigest: directRefundDigest,
        sourceEntryId: reserved.id,
        amountMinor: 1_862,
      }),
    ).rejects.toThrow(/target is (?:invalid|unavailable)/iu);
    await expect(
      insertDirectReversal({
        id: 'referral-ledger-wrong-amount',
        sequence: 4,
        financialId: directRefundId,
        sourceDigest: directRefundDigest,
        sourceEntryId: earned.id,
        amountMinor: 1_863,
      }),
    ).rejects.toThrow(/exact source/iu);
    await expect(
      insertDirectReversal({
        id: 'referral-ledger-wrong-reason',
        sequence: 4,
        financialId: directRefundId,
        sourceDigest: directRefundDigest,
        sourceEntryId: earned.id,
        amountMinor: 1_862,
        reasonCode: 'authenticated_dispute',
      }),
    ).rejects.toThrow(/target is invalid/iu);

    await expect(
      insertDirectReversal({
        id: 'referral-ledger-direct-refund-one',
        sequence: 4,
        financialId: directRefundId,
        sourceDigest: directRefundDigest,
        sourceEntryId: earned.id,
        amountMinor: 1_862,
      }),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      insertDirectReversal({
        id: 'referral-ledger-duplicate-source',
        sequence: 5,
        financialId: directRefundId,
        sourceDigest: directRefundDigest,
        sourceEntryId: earned.id,
        amountMinor: 1_862,
      }),
    ).rejects.toThrow();

    const secondRefundId = 'referral-financial-direct-refund-two';
    const secondRefundDigest = digest('direct-refund-source-two');
    await database.query(
      `INSERT INTO run3_referral_financial_events(
         id, attribution_id, event_kind, parent_financial_event_id, source_event_hmac,
         subscription_reference_hmac, invoice_reference_hmac, line_reference_hmac,
         canonical_offer_key, currency, principal_minor, source_authenticated,
         evidence_tier, provider_execution_requested, provider_credit_applied,
         external_action_executed, operation_key, occurred_at, recorded_at
       ) VALUES ($1,$2,'refund',$3,$4,$5,$6,$7,$8,$9,7450,true,'local_simulation',
         false,false,false,$10,$11,$11)`,
      [
        secondRefundId,
        issued.attributionId,
        settlementId,
        secondRefundDigest,
        lineage.subscription_reference_hmac,
        lineage.invoice_reference_hmac,
        lineage.line_reference_hmac,
        lineage.canonical_offer_key,
        lineage.currency,
        operationKey(),
        fixedTestNow.toISOString(),
      ],
    );
    await expect(
      insertDirectReversal({
        id: 'referral-ledger-aggregate-under-reversal',
        sequence: 5,
        financialId: secondRefundId,
        sourceDigest: secondRefundDigest,
        sourceEntryId: earned.id,
        amountMinor: 1_862,
      }),
    ).rejects.toThrow(/exact source/iu);
    await expect(
      insertDirectReversal({
        id: 'referral-ledger-direct-refund-two',
        sequence: 5,
        financialId: secondRefundId,
        sourceDigest: secondRefundDigest,
        sourceEntryId: earned.id,
        amountMinor: 1_863,
      }),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(repository.balance(issued.attributionId)).resolves.toBe(0);
  });
});
