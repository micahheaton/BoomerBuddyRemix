import { describe, expect, it } from 'vitest';

import {
  authorizeAutomation,
  calculateFounderDependency,
  canTransitionReferral,
  canTransitionOpportunity,
  decideCommunication,
  evaluateContentForPublication,
  evaluateCustomerHealth,
  evaluateOpportunityHygiene,
  evaluateReferralReward,
  evaluateStaffingTriggers,
  ingestNcuaSnapshot,
  lifecyclePlan,
  modelSubscriberEconomics,
  routeSupportCase,
  sanitizeAttribution,
} from './index';

describe('Business OS policy', () => {
  it('sanitizes attribution without accepting arbitrary content', () => {
    expect(
      sanitizeAttribution({
        campaign: 'Fall_2026',
        channel: 'paid_search',
        content: 'grandparent-guide',
        referrerHost: 'example.com',
        source: 'g00gle<script>',
      }),
    ).toEqual({
      campaign: 'fall_2026',
      channel: 'paid_search',
      content: 'grandparent-guide',
      referrerHost: 'example.com',
    });
  });

  it('requires approved, evidenced, current content before publication', () => {
    expect(
      evaluateContentForPublication(
        {
          evidenceCount: 1,
          hasUnsupportedStatistics: false,
          hasUnverifiedUrgency: false,
          reviewState: 'approved',
          sourceFreshUntil: new Date('2026-09-01T00:00:00Z'),
        },
        new Date('2026-08-16T00:00:00Z'),
      ),
    ).toEqual({ publishable: true, reasons: [] });
  });

  it('enforces stage transitions and detects stale work without sending outreach', () => {
    expect(canTransitionOpportunity('qualified', 'pilot')).toBe(true);
    expect(canTransitionOpportunity('qualified', 'closed_won')).toBe(false);
    const hygiene = evaluateOpportunityHygiene(
      { stage: 'qualified', lastMeaningfulActivityAt: new Date('2026-07-01T00:00:00Z') },
      new Date('2026-08-16T00:00:00Z'),
    );
    expect(hygiene.stale).toBe(true);
    expect(hygiene.recommendedAction).toContain('Review');
  });

  it('keeps referral rewards disabled without an approved policy', () => {
    expect(
      evaluateReferralReward({ enabled: false, maximumAwardsPerReferrer: 3 }, 0, true),
    ).toEqual({ award: false, reason: 'Rewards are disabled.' });
    expect(canTransitionReferral('created', 'accepted')).toBe(true);
    expect(canTransitionReferral('created', 'paid')).toBe(false);
  });

  it('separates automatic communication from approval and professional review', () => {
    expect(
      decideCommunication({
        campaignApproved: true,
        consented: true,
        includesNovelSafetyAdvice: false,
        kind: 'lifecycle',
        suppressed: false,
        templateApproved: true,
      }),
    ).toBe('automatic');
    expect(
      decideCommunication({
        campaignApproved: true,
        consented: true,
        includesNovelSafetyAdvice: false,
        kind: 'consumer_sms',
        suppressed: false,
        templateApproved: true,
      }),
    ).toBe('professional_review');
  });

  it('explains every customer health contribution', () => {
    const result = evaluateCustomerHealth({
      cancellationIntent: false,
      checkCompleted: true,
      familyParticipation: false,
      mobileInstalled: false,
      orientationComplete: false,
      paymentFailed: true,
      productInactiveDays: 31,
      supportCasesOpen: 1,
      trustedCircleEstablished: false,
      unresolvedIncident: false,
    });
    expect(result.state).toBe('at_risk');
    expect(result.components.every((component) => component.explanation.length > 0)).toBe(true);
    expect(lifecyclePlan('win_back_eligible', false)).toEqual([]);
    expect(lifecyclePlan('win_back_eligible', true)).toHaveLength(1);
    expect(
      routeSupportCase({
        category: 'fraud',
        executiveEscalation: false,
        needsArtifactAccess: true,
        safetySeverity: 'high',
      }),
    ).toBe('trust_safety');
  });

  it('fails automation closed on kill switch, data, tools, budgets, and approvals', () => {
    const policy = {
      action: 'create_internal_task',
      allowedDataClasses: ['public'],
      allowedTools: ['hq'],
      autonomy: 'auto' as const,
      enabled: true,
      maxCostPerOperationCents: 10,
      requiresAudit: true,
    };
    expect(
      authorizeAutomation(
        policy,
        {
          action: 'create_internal_task',
          dataClasses: ['sensitive'],
          estimatedCostCents: 1,
          tool: 'hq',
        },
        false,
      ).allowed,
    ).toBe(false);
    expect(
      authorizeAutomation(
        policy,
        {
          action: 'create_internal_task',
          dataClasses: ['public'],
          estimatedCostCents: 1,
          tool: 'hq',
        },
        false,
      ).allowed,
    ).toBe(true);
    expect(
      authorizeAutomation(
        { ...policy, action: 'send_outreach' },
        {
          action: 'send_outreach',
          dataClasses: ['public'],
          estimatedCostCents: 1,
          tool: 'hq',
        },
        false,
      ),
    ).toMatchObject({
      allowed: false,
      reasons: expect.arrayContaining(['This action is not eligible for autonomous execution.']),
    });
    expect(
      authorizeAutomation(
        {
          ...policy,
          action: 'prepare_owner_brief',
          allowedDataClasses: ['customer_content'],
          allowedTools: ['gmail'],
        },
        {
          action: 'prepare_owner_brief',
          dataClasses: ['customer_content'],
          estimatedCostCents: 1,
          tool: 'gmail',
        },
        false,
      ),
    ).toMatchObject({
      allowed: false,
      reasons: expect.arrayContaining([
        'The policy exceeds the code-owned autonomous execution boundary.',
        'The request exceeds the code-owned autonomous execution boundary.',
      ]),
    });
  });
});

describe('Business OS operating models', () => {
  it('models subscriber economics without forcing the profit target', () => {
    const result = modelSubscriberEconomics({
      annualFixedCosts: {
        legalSecurityPrivacy: 200_000,
        marketing: 400_000,
        payrollContractors: 1_500_000,
        softwareHosting: 150_000,
        taxAdministration: 50_000,
      },
      annualPlanShare: 0.5,
      annualPrice: 120,
      appStoreShare: 0.25,
      appStoreTakeRate: 0.15,
      badDebtRate: 0.005,
      monthlyChurnRate: 0.03,
      monthlyPrice: 12,
      paidHouseholds: 50_000,
      paymentFeeRate: 0.03,
      refundRate: 0.01,
      variableFraudCostPerHousehold: 0.5,
      variableHostingCostPerHousehold: 0.5,
      variableInferenceCostPerHousehold: 0.25,
      variableSupportCostPerHousehold: 1,
    });
    expect(result.annualRevenue).toBe(6_600_000);
    expect(Number.isFinite(result.profitTargetGap)).toBe(true);
  });

  it('uses workload rather than subscriber count for staffing triggers', () => {
    const triggers = evaluateStaffingTriggers({
      b2bAccountsWithDueActions: 250,
      billingCasesPerMonth: 10,
      customerSuccessInterventionsPerMonth: 10,
      fraudReviewsPerMonth: 500,
      orientationSessionsPerMonth: 10,
      supportCasesPerMonth: 500,
    });
    expect(triggers.find((item) => item.role.startsWith('Customer Safety'))?.triggered).toBe(true);
    expect(triggers.find((item) => item.role === 'Orientation Specialist')?.triggered).toBe(false);
  });

  it('preserves high-value founder work while reducing operational dependency', () => {
    const result = calculateFounderDependency([
      {
        automationFraction: 0.8,
        delegationFraction: 0.2,
        founderMinutesPerOccurrence: 30,
        frequencyPerMonth: 20,
        highValueFounderWork: false,
        name: 'pipeline hygiene',
      },
      {
        automationFraction: 0,
        delegationFraction: 0,
        founderMinutesPerOccurrence: 60,
        frequencyPerMonth: 4,
        highValueFounderWork: true,
        name: 'partner relationships',
      },
    ]);
    expect(result.currentScore).toBe(100);
    expect(result.targetScore).toBe(29);
    expect(result.protectedHighValueHoursPerMonth).toBe(4);
  });
});

describe('NCUA fixed snapshot ingestion', () => {
  it('joins the active universe to reported metrics and emits explainable fit, not intent', () => {
    const foicu = [
      '"CU_NUMBER","CYCLE_DATE","JOIN_NUMBER","CU_TYPE","CU_NAME","CITY","STATE","CharterState","ZIP_CODE","REGION","LIMITED_INC","Peer_Group"',
      '13,"3/31/2026 0:00:00",14,"1","EFCU FINANCIAL","Baton Rouge","LA","LA","70816","2 ",1,6',
      '99,"3/31/2026 0:00:00",100,"3","UNINSURED FIXTURE","Somewhere","CA","CA","90001","4 ",0,1',
    ].join('\n');
    const fs220 = [
      '"CU_NUMBER","CYCLE_DATE","ACCT_010","ACCT_018","ACCT_025B","ACCT_083"',
      '13,"3/31/2026 0:00:00",1282088093,1118682828,1118071276,72182',
      '99,"3/31/2026 0:00:00",1000,900,800,10',
    ].join('\n');
    const records = ingestNcuaSnapshot(foicu, fs220, '3/31/2026');
    const [record] = records;
    expect(records).toHaveLength(1);
    expect(record).toMatchObject({
      assets: 1_282_088_093,
      charterNumber: 13,
      fitScore: 50,
      memberSegment: '50k_250k',
      members: 72_182,
      name: 'EFCU FINANCIAL',
    });
    expect(record?.fitReasons).toEqual([
      '50,000 to 249,999 reported memberships.',
      '$500 million or more in reported assets.',
    ]);
  });
});
