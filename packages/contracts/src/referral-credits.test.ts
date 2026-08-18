import { describe, expect, it } from 'vitest';
import {
  bindReferralSimulationRequestSchema,
  bindReferralServerCommandSchema,
  issueReferralSimulationResponseSchema,
  referralFinancialEvidenceSchema,
  referralHqQueueResponseSchema,
  referralLedgerEntrySchema,
  referralProgramDefinitionSchema,
  referralShareCapabilityResponseSchema,
} from './referral-credits';

const hmac = 'a'.repeat(43);
const operationKey = 'referral:99d88d04-66bc-4f7a-9093-05d1a732d1e2';

const program = {
  programKey: 'run3_referral_research',
  version: 1,
  state: 'approved_disabled',
  variant: 'one_then_three_total',
  effectiveAt: '2026-08-01T00:00:00.000Z',
  expiresAt: '2026-09-01T00:00:00.000Z',
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
  attributionTtlSeconds: 604_800,
  settlementHoldSeconds: 1_209_600,
  creditExpirySeconds: 31_536_000,
  termsVersion: 'referral-terms-v1',
  privacyVersion: 'referral-privacy-v1',
  externalActionEnabled: false,
} as const;

describe('referral-credit contracts', () => {
  it('admits only immutable disabled program states and bounded caps', () => {
    expect(referralProgramDefinitionSchema.parse(program)).toEqual(program);
    expect(() => referralProgramDefinitionSchema.parse({ ...program, state: 'active' })).toThrow();
    expect(() =>
      referralProgramDefinitionSchema.parse({
        ...program,
        maximumProgramLiabilityMinor: 1_000,
      }),
    ).toThrow(/cumulatively bounded/iu);
  });

  it('rejects contact destinations, messages, and raw payment/provider identifiers', () => {
    const bind = {
      operationKey,
      attributionToken: hmac,
      termsVersion: 'referral-terms-v1',
      privacyVersion: 'referral-privacy-v1',
      simulation: true,
    };
    expect(bindReferralSimulationRequestSchema.parse(bind)).toEqual(bind);
    for (const extra of [
      { email: 'recipient@example.test' },
      { phone: '+15555550100' },
      { message: 'Join me' },
      { providerPaymentMethodId: 'pm_raw_value' },
      { paymentIdentityHmac: hmac },
    ]) {
      expect(() => bindReferralSimulationRequestSchema.parse({ ...bind, ...extra })).toThrow();
    }
    expect(
      bindReferralServerCommandSchema.parse({
        ...bind,
        recipientPersonId: 'person-recipient',
        recipientHouseholdId: 'household-recipient',
        canonicalPaymentIdentityHmac: hmac,
        serverEvidenceReference: 'binding-evidence-one',
        serverEvidenceDigest: hmac,
        serverGenerated: true,
      }),
    ).toBeDefined();
  });

  it('requires authenticated local evidence with zero provider execution', () => {
    const evidence = {
      operationKey,
      attributionId: 'referral-attribution-one',
      eventKind: 'settlement',
      subscriptionReferenceHmac: hmac,
      invoiceReferenceHmac: hmac,
      lineReferenceHmac: hmac,
      canonicalOfferKey: 'family_annual',
      currency: 'USD',
      principalMinor: 14_900,
      sourceAuthenticated: true,
      occurredAt: '2026-08-15T00:00:00.000Z',
      evidenceTier: 'local_simulation',
      providerExecutionRequested: false,
    };
    expect(referralFinancialEvidenceSchema.parse(evidence)).toEqual(evidence);
    expect(() =>
      referralFinancialEvidenceSchema.parse({
        ...evidence,
        providerExecutionRequested: true,
      }),
    ).toThrow();
    expect(() =>
      referralFinancialEvidenceSchema.parse({ ...evidence, evidenceTier: 'live_production' }),
    ).toThrow();
  });

  it('makes one-time issuance and every ledger result truthfully no-effect', () => {
    expect(() =>
      issueReferralSimulationResponseSchema.parse({
        attributionId: 'referral-attribution-one',
        attributionToken: hmac,
        expiresAt: '2026-08-22T00:00:00.000Z',
        evidenceTier: 'local_simulation',
        programActive: false,
        creditPromised: false,
        messageSent: false,
        providerCreditApplied: true,
        externalActionExecuted: false,
        reused: false,
      }),
    ).toThrow();

    const ledger = {
      id: 'referral-ledger-one',
      attributionId: 'referral-attribution-one',
      programKey: 'run3_referral_research',
      programVersion: 1,
      receivingPersonId: 'person-referrer',
      receivingHouseholdId: 'household-referrer',
      sequence: 1,
      kind: 'earned',
      amountMinor: 2_483,
      currency: 'USD',
      canonicalOfferKey: 'family_annual',
      reasonCode: 'eligible_paid_settlement',
      sourceReference: 'financial-event-one',
      sourceEvidenceDigest: hmac,
      idempotencyKey: operationKey,
      availableAt: '2026-08-29T00:00:00.000Z',
      expiresAt: '2027-08-29T00:00:00.000Z',
      evidenceTier: 'local_simulation',
      providerCreditApplied: false,
      externalActionExecuted: false,
      createdAt: '2026-08-15T00:00:00.000Z',
    };
    expect(referralLedgerEntrySchema.parse(ledger)).toEqual(ledger);
    expect(() => referralLedgerEntrySchema.parse({ ...ledger, kind: 'applied' })).toThrow();
  });

  it('admits only unregistered user-controlled sharing with no contacts, send, or reward', () => {
    const capability = {
      capabilities: [
        {
          mode: 'native_share_sheet',
          state: 'integration_not_registered',
          userInitiatedOnly: true,
          contactPermissionRequested: false,
          contactDataAccepted: false,
          automaticSend: false,
          shareEventRewardsCredit: false,
          externalActionExecuted: false,
        },
        {
          mode: 'copy_link',
          state: 'integration_not_registered',
          userInitiatedOnly: true,
          contactPermissionRequested: false,
          contactDataAccepted: false,
          automaticSend: false,
          shareEventRewardsCredit: false,
          externalActionExecuted: false,
        },
      ],
      evidenceTier: 'local_simulation',
    };
    expect(referralShareCapabilityResponseSchema.parse(capability)).toEqual(capability);
    expect(() =>
      referralShareCapabilityResponseSchema.parse({
        ...capability,
        capabilities: [
          { ...capability.capabilities[0], automaticSend: true },
          capability.capabilities[1],
        ],
      }),
    ).toThrow();
    expect(() =>
      referralShareCapabilityResponseSchema.parse({
        ...capability,
        contactEmail: 'recipient@example.test',
      }),
    ).toThrow();
  });

  it('keeps the HQ queue content-, contact-, recipient-, and payment-identity-free', () => {
    const queue = {
      projection: 'content_free_disabled_referral_evidence',
      referrals: [
        {
          attributionId: 'referral-attribution-one',
          programKey: 'run3_referral_research',
          programVersion: 1,
          programState: 'approved_disabled',
          attributionState: 'identity_bound',
          qualificationState: 'qualified',
          balanceMinor: 3_725,
          reservedGrossMinor: 1_242,
          earnedGrossMinor: 3_725,
          reversedGrossMinor: 1_242,
          issuedAt: '2026-08-15T00:00:00.000Z',
          expiresAt: '2026-08-22T00:00:00.000Z',
          evidenceTier: 'local_simulation',
          contentIncluded: false,
          contactIncluded: false,
          recipientIdentityIncluded: false,
          paymentIdentityIncluded: false,
          providerCreditApplied: false,
          externalActionExecuted: false,
        },
      ],
    };
    expect(referralHqQueueResponseSchema.parse(queue)).toEqual(queue);
    expect(() =>
      referralHqQueueResponseSchema.parse({
        ...queue,
        referrals: [{ ...queue.referrals[0], recipientPersonId: 'person-recipient' }],
      }),
    ).toThrow();
  });
});
