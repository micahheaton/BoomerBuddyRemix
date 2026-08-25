import type { Database, SqlExecutor } from './database';
import { CheckRepository, type ArtifactProtection, type DecisionRecord } from './checks';

export const seedPersonas = [
  { personaId: 'owner-alice', personId: 'person-owner-alice', displayName: 'Alice Owner' },
  { personaId: 'protected-pat', personId: 'person-protected-pat', displayName: 'Pat Protected' },
  { personaId: 'trusted-terry', personId: 'person-trusted-terry', displayName: 'Terry Trusted' },
  {
    personaId: 'trusted-jordan',
    personId: 'person-trusted-jordan',
    displayName: 'Jordan Unassigned',
  },
  { personaId: 'owner-bob', personId: 'person-owner-bob', displayName: 'Bob Owner' },
  {
    personaId: 'protected-olivia',
    personId: 'person-protected-olivia',
    displayName: 'Olivia Protected',
  },
  { personaId: 'hq-heidi', personId: 'person-hq-heidi', displayName: 'Heidi HQ Owner' },
  { personaId: 'hq-riley', personId: 'person-hq-riley', displayName: 'Riley Reviewer' },
  { personaId: 'hq-sam', personId: 'person-hq-sam', displayName: 'Sam Support' },
] as const;

export const seedHouseholds = {
  sunrise: 'household-sunrise',
  harbor: 'household-harbor',
} as const;

export const seedChecks = {
  sunriseShared: 'analysis-seed-sunrise-shared',
  sunrisePrivate: 'analysis-seed-sunrise-private',
  harborPrivate: 'analysis-seed-harbor-private',
} as const;

async function seedPeople(transaction: SqlExecutor, now: Date): Promise<void> {
  for (const persona of seedPersonas) {
    await transaction.query(
      `INSERT INTO persons(id, display_name, created_at) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO NOTHING`,
      [persona.personId, persona.displayName, now.toISOString()],
    );
    await transaction.query(
      `INSERT INTO identities(id, person_id, issuer, subject, status, created_at)
       VALUES ($1,$2,'boomerbuddy-dev',$3,'active',$4)
       ON CONFLICT (id) DO NOTHING`,
      [`identity-${persona.personaId}`, persona.personId, persona.personaId, now.toISOString()],
    );
  }
}

async function seedHouseholdData(transaction: SqlExecutor, now: Date): Promise<void> {
  await transaction.query(
    `INSERT INTO households(id, name, created_at) VALUES
      ('household-sunrise','Sunrise Household',$1),
      ('household-harbor','Harbor Household',$1)
     ON CONFLICT (id) DO NOTHING`,
    [now.toISOString()],
  );
  await transaction.query(
    `INSERT INTO organizations(id, name, kind, verification_state, created_at) VALUES
       ('organization-boomerbuddy','BoomerBuddy local HQ','internal','local_fixture',$1),
       ('organization-synthetic-sponsor','Synthetic sponsor fixture','sponsor','local_fixture',$1),
       ('organization-founding-households-local',
        'Founding Household local simulation sponsor','sponsor','local_fixture',$1)
     ON CONFLICT (id) DO NOTHING`,
    [now.toISOString()],
  );
  const memberships = [
    ['household-sunrise', 'membership-sunrise-alice', 'person-owner-alice'],
    ['household-sunrise', 'membership-sunrise-pat', 'person-protected-pat'],
    ['household-sunrise', 'membership-sunrise-terry', 'person-trusted-terry'],
    ['household-harbor', 'membership-harbor-bob', 'person-owner-bob'],
    ['household-harbor', 'membership-harbor-olivia', 'person-protected-olivia'],
  ] as const;
  for (const [householdId, membershipId, personId] of memberships) {
    await transaction.query(
      `INSERT INTO household_memberships(
         household_id, id, person_id, membership_kind, status, created_at
       ) VALUES ($1,$2,$3,'member','active',$4)
       ON CONFLICT (household_id, id) DO NOTHING`,
      [householdId, membershipId, personId, now.toISOString()],
    );
  }
  await transaction.query(
    `INSERT INTO household_administrator_assignments(
       household_id, person_id, status, granted_by_person_id, granted_at
     ) VALUES
       ('household-sunrise','person-owner-alice','active','person-owner-alice',$1),
       ('household-harbor','person-owner-bob','active','person-owner-bob',$1)
     ON CONFLICT (household_id, person_id) DO NOTHING`,
    [now.toISOString()],
  );
  await transaction.query(
    `INSERT INTO household_billing_authorities(
       household_id, person_id, status, granted_by_person_id, granted_at
     ) VALUES
       ('household-sunrise','person-owner-alice','active','person-owner-alice',$1),
       ('household-harbor','person-owner-bob','active','person-owner-bob',$1)
     ON CONFLICT (household_id, person_id) DO NOTHING`,
    [now.toISOString()],
  );
  await transaction.query(
    `INSERT INTO employee_assignments(id, person_id, organization_id, role, status, created_at) VALUES
       ('employee-hq-heidi','person-hq-heidi','organization-boomerbuddy','hq_owner','active',$1),
       ('employee-hq-riley','person-hq-riley','organization-boomerbuddy','hq_reviewer','active',$1),
       ('employee-hq-sam','person-hq-sam','organization-boomerbuddy','hq_support','active',$1)
     ON CONFLICT (id) DO NOTHING`,
    [now.toISOString()],
  );
  await transaction.query(
    `INSERT INTO support_cases(
       household_id, id, purpose, status, opened_by_person_id, opened_at
     ) VALUES (
       'household-sunrise','support-case-seeded-sam','Resolve a synthetic navigation request',
       'open','person-owner-alice',$1
     ) ON CONFLICT (household_id, id) DO NOTHING`,
    [now.toISOString()],
  );
  await transaction.query(
    `INSERT INTO support_case_assignments(
       household_id, case_id, employee_assignment_id, status, assigned_at
     ) VALUES (
       'household-sunrise','support-case-seeded-sam','employee-hq-sam','active',$1
     ) ON CONFLICT (household_id, case_id, employee_assignment_id) DO NOTHING`,
    [now.toISOString()],
  );
  await transaction.query(
    `INSERT INTO consents(
       household_id, id, protected_person_id, granted_by_person_id, purpose,
       consent_version, state, granted_at
     ) VALUES
       ('household-sunrise','consent-sunrise-pat-circle','person-protected-pat',
        'person-protected-pat','trusted_circle_relationship','2026-08-15','active',$1),
       ('household-sunrise','consent-protected-sunrise-alice','person-owner-alice',
        'person-owner-alice','protected_enrollment','protected-self-v1','active',$1),
       ('household-sunrise','consent-protected-sunrise-pat','person-protected-pat',
        'person-protected-pat','protected_enrollment','protected-self-v1','active',$1),
       ('household-harbor','consent-protected-harbor-olivia','person-protected-olivia',
        'person-protected-olivia','protected_enrollment','protected-self-v1','active',$1)
     ON CONFLICT (household_id, id) DO NOTHING`,
    [now.toISOString()],
  );
  await transaction.query(
    `INSERT INTO consent_evidence(
       household_id, id, consent_id, actor_person_id, subject_person_id,
       recipient_person_id, purpose, scope, action, disclosure_version,
       disclosure_digest, policy_version, policy_digest, source_interaction,
       actor_identity_id, actor_identity_issuer, actor_identity_subject, assurance,
       effective_at, recorded_at
     ) VALUES
       ('household-sunrise','evidence-sunrise-pat-terry','consent-sunrise-pat-circle',
        'person-protected-pat','person-protected-pat','person-trusted-terry',
        'trusted_circle_relationship',$1::jsonb,'accept','trusted-circle-disclosure-v2',
        repeat('1',64),'trusted-circle-policy-v2',repeat('2',64),'local_seed',
        'identity-protected-pat','boomerbuddy-dev','protected-pat','development',$2,$2),
       ('household-sunrise','evidence-protected-sunrise-alice',
        'consent-protected-sunrise-alice','person-owner-alice','person-owner-alice',NULL,
        'protected_enrollment',$3::jsonb,'accept','protected-enrollment-disclosure-v2',
        repeat('1',64),'protected-enrollment-policy-v2',repeat('2',64),'local_seed',
        'identity-owner-alice','boomerbuddy-dev','owner-alice','development',$2,$2),
       ('household-sunrise','evidence-protected-sunrise-pat',
        'consent-protected-sunrise-pat','person-protected-pat','person-protected-pat',NULL,
        'protected_enrollment',$3::jsonb,'accept','protected-enrollment-disclosure-v2',
        repeat('1',64),'protected-enrollment-policy-v2',repeat('2',64),'local_seed',
        'identity-protected-pat','boomerbuddy-dev','protected-pat','development',$2,$2),
       ('household-harbor','evidence-protected-harbor-olivia',
        'consent-protected-harbor-olivia','person-protected-olivia',
        'person-protected-olivia',NULL,'protected_enrollment',$3::jsonb,'accept',
        'protected-enrollment-disclosure-v2',repeat('1',64),
        'protected-enrollment-policy-v2',repeat('2',64),'local_seed',
        'identity-protected-olivia','boomerbuddy-dev','protected-olivia','development',$2,$2)
     ON CONFLICT (household_id, id) DO NOTHING`,
    [
      JSON.stringify({ permissions: ['view_shared_checks'] }),
      now.toISOString(),
      JSON.stringify({ protectedEnrollment: true }),
    ],
  );
  await transaction.query(
    `INSERT INTO consent_current_projections(
       household_id, consent_id, latest_evidence_id, actor_person_id,
       subject_person_id, recipient_person_id, purpose, scope, state,
       effective_at, updated_at
     ) VALUES
       ('household-sunrise','consent-sunrise-pat-circle','evidence-sunrise-pat-terry',
        'person-protected-pat','person-protected-pat','person-trusted-terry',
        'trusted_circle_relationship',$1::jsonb,'active',$2,$2),
       ('household-sunrise','consent-protected-sunrise-alice',
        'evidence-protected-sunrise-alice','person-owner-alice','person-owner-alice',NULL,
        'protected_enrollment',$3::jsonb,'active',$2,$2),
       ('household-sunrise','consent-protected-sunrise-pat',
        'evidence-protected-sunrise-pat','person-protected-pat','person-protected-pat',NULL,
        'protected_enrollment',$3::jsonb,'active',$2,$2),
       ('household-harbor','consent-protected-harbor-olivia',
        'evidence-protected-harbor-olivia','person-protected-olivia',
        'person-protected-olivia',NULL,'protected_enrollment',$3::jsonb,'active',$2,$2)
     ON CONFLICT (household_id, consent_id) DO NOTHING`,
    [
      JSON.stringify({ permissions: ['view_shared_checks'] }),
      now.toISOString(),
      JSON.stringify({ protectedEnrollment: true }),
    ],
  );
  await transaction.query(
    `INSERT INTO trusted_circle_relationships(
       household_id, id, protected_person_id, trusted_person_id, permissions,
       consent_id, consent_version, state, created_at, latest_consent_evidence_id
     ) VALUES (
       'household-sunrise','relationship-sunrise-pat-terry','person-protected-pat',
       'person-trusted-terry',$1::jsonb,'consent-sunrise-pat-circle','2026-08-15','active',$2,
       'evidence-sunrise-pat-terry'
     ) ON CONFLICT (household_id, id) DO NOTHING`,
    [JSON.stringify(['view_shared_checks']), now.toISOString()],
  );
  const freeCapabilities = ['check:text', 'check:url', 'history:read', 'orientation:use'];
  const allCapabilities = [
    'check:text',
    'check:url',
    'history:read',
    'family:manage',
    'orientation:use',
  ];
  const plusCapabilities = allCapabilities;
  const allowanceHypotheses = {
    free: [
      { kind: 'protected_members', limit: 1 },
      { kind: 'trusted_circle_participants', limit: 0 },
    ],
    plus: [
      { kind: 'protected_members', limit: 1 },
      { kind: 'trusted_circle_participants', limit: 2 },
    ],
    family: [
      { kind: 'protected_members', limit: 3 },
      { kind: 'trusted_circle_participants', limit: 6 },
    ],
  } as const;
  const priceHypotheses = {
    free: [
      { interval: 'month', amountMinor: 0, currency: 'USD', kind: 'list' },
      { interval: 'year', amountMinor: 0, currency: 'USD', kind: 'list' },
    ],
    plus: [
      { interval: 'month', amountMinor: 899, currency: 'USD', kind: 'list' },
      { interval: 'year', amountMinor: 8_900, currency: 'USD', kind: 'list' },
    ],
    family: [
      { interval: 'month', amountMinor: 1_499, currency: 'USD', kind: 'list' },
      { interval: 'year', amountMinor: 14_900, currency: 'USD', kind: 'list' },
    ],
  } as const;
  const planEffectiveAt = '2026-08-15T00:00:00.000Z';
  await transaction.query(
    `INSERT INTO commerce_product_versions(
       id, product_key, version, display_name, available_from, created_at
     ) VALUES ('consumer_household_v1','consumer_household',1,
       'BoomerBuddy household protection',$1,$2)
     ON CONFLICT (id) DO NOTHING`,
    [planEffectiveAt, now.toISOString()],
  );
  await transaction.query(
    `INSERT INTO commerce_plan_versions(
       id, product_version_id, plan_key, version, display_name, state,
       capabilities, allowances, prices, available_from, created_at
     ) VALUES
       ('free_v1','consumer_household_v1','free',1,'Free','hypothesis',
        $1::jsonb,$2::jsonb,$3::jsonb,$10,$11),
       ('plus_v1','consumer_household_v1','plus',1,'Plus','hypothesis',
        $4::jsonb,$5::jsonb,$6::jsonb,$10,$11),
       ('family_v1','consumer_household_v1','family',1,'Family','hypothesis',
        $7::jsonb,$8::jsonb,$9::jsonb,$10,$11)
     ON CONFLICT (id) DO NOTHING`,
    [
      JSON.stringify(freeCapabilities),
      JSON.stringify(allowanceHypotheses.free),
      JSON.stringify(priceHypotheses.free),
      JSON.stringify(plusCapabilities),
      JSON.stringify(allowanceHypotheses.plus),
      JSON.stringify(priceHypotheses.plus),
      JSON.stringify(allCapabilities),
      JSON.stringify(allowanceHypotheses.family),
      JSON.stringify(priceHypotheses.family),
      planEffectiveAt,
      now.toISOString(),
    ],
  );
  await transaction.query(
    `INSERT INTO commerce_sponsorships(
       id, organization_id, plan_version_id, state, privacy_policy_version,
       starts_at, ends_at, created_at
     ) VALUES
       ('founding-sponsorship-plus-local-v1','organization-founding-households-local',
        'founding_plus_beta_v2','active','founding-household-local-simulation-v1',$1,NULL,$2),
       ('founding-sponsorship-family-local-v1','organization-founding-households-local',
        'founding_family_beta_v2','active','founding-household-local-simulation-v1',$1,NULL,$2)
     ON CONFLICT (id) DO NOTHING`,
    [planEffectiveAt, now.toISOString()],
  );
  await transaction.query(
    `INSERT INTO founding_household_sponsor_backings(
       cohort_key, environment, benefit_key, organization_id, sponsorship_id,
       plan_version_id, evidence_tier, approved_by_person_id, approved_at
     ) VALUES
       ('run3_sponsored_founding_household_v1','local','plus_beta_v1',
        'organization-founding-households-local','founding-sponsorship-plus-local-v1',
        'founding_plus_beta_v2','local_simulation',NULL,$1),
       ('run3_sponsored_founding_household_v1','local','family_beta_v1',
        'organization-founding-households-local','founding-sponsorship-family-local-v1',
        'founding_family_beta_v2','local_simulation',NULL,$1)
     ON CONFLICT (cohort_key, environment, benefit_key) DO NOTHING`,
    [now.toISOString()],
  );
  const periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000).toISOString();
  await transaction.query(
    `INSERT INTO commerce_subscriptions(
       household_id, id, payer_person_id, plan_version_id, source, lifecycle,
       source_verified, precedence, current_period_starts_at, current_period_ends_at,
       reconciliation_state, created_at, updated_at
     ) VALUES
       ('household-sunrise','subscription-local-sunrise','person-owner-alice',
        'family_v1','local','active',true,100,$1,$2,'not_required',$1,$1),
       ('household-harbor','subscription-local-harbor','person-owner-bob',
        'free_v1','local','active',true,100,$1,$2,'not_required',$1,$1),
       ('household-harbor','subscription-local-harbor-unverified','person-owner-bob',
        'family_v1','local','active',false,300,$1,$2,'attention',$1,$1),
       ('household-harbor','subscription-local-harbor-expired','person-owner-bob',
        'plus_v1','local','expired',true,200,'2025-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z','reconciled',$1,$1),
       ('household-harbor','subscription-sponsor-harbor-expired',NULL,
        'plus_v1','sponsor','expired',true,400,'2025-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z','reconciled',$1,$1)
     ON CONFLICT (household_id, id) DO NOTHING`,
    [now.toISOString(), periodEnd],
  );
  await transaction.query(
    `INSERT INTO household_payers(
       household_id, person_id, source, status, effective_at
     ) VALUES
       ('household-sunrise','person-owner-alice','local','active',$1),
       ('household-harbor','person-owner-bob','local','active',$1)
     ON CONFLICT (household_id, person_id) DO NOTHING`,
    [now.toISOString()],
  );
  await transaction.query(
    `INSERT INTO commerce_provider_subscription_records(
       id, household_id, subscription_id, provider, environment,
       external_subscription_id, raw_state, provider_version, observed_at, verified_at
     ) VALUES
       ('provider-record-sunrise','household-sunrise','subscription-local-sunrise',
        'local','local','local-sunrise','active','fixture-v1',$1,$1),
       ('provider-record-harbor','household-harbor','subscription-local-harbor',
        'local','local','local-harbor','active','fixture-v1',$1,$1),
       ('provider-record-harbor-unverified','household-harbor',
        'subscription-local-harbor-unverified','local','local','local-harbor-unverified',
        'active','fixture-v1',$1,NULL),
       ('provider-record-harbor-expired','household-harbor',
        'subscription-local-harbor-expired','local','local','local-harbor-expired',
        'expired','fixture-v1',$1,$1)
     ON CONFLICT (id) DO NOTHING`,
    [now.toISOString()],
  );
  await transaction.query(
    `INSERT INTO commerce_sponsorships(
       id, organization_id, plan_version_id, state, privacy_policy_version,
       starts_at, ends_at, created_at
     ) VALUES (
       'sponsorship-synthetic-expired','organization-synthetic-sponsor',
       'plus_v1','ended','fixture-privacy-v1','2025-01-01T00:00:00.000Z',
       '2026-01-01T00:00:00.000Z',$1
     ) ON CONFLICT (id) DO NOTHING`,
    [now.toISOString()],
  );
  await transaction.query(
    `INSERT INTO commerce_sponsorship_allocations(
       household_id, id, sponsorship_id, plan_version_id, eligibility_reference,
       state, source_verified, starts_at, ends_at, created_at
     ) VALUES (
       'household-harbor','sponsorship-allocation-harbor-expired',
       'sponsorship-synthetic-expired','plus_v1','eligibility-synthetic-harbor',
       'ended',true,'2025-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',$1
     ) ON CONFLICT (household_id, id) DO NOTHING`,
    [now.toISOString()],
  );
  await transaction.query(
    `INSERT INTO entitlement_grants(
       household_id, id, source, capabilities, starts_at, ends_at, source_verified,
       precedence, plan_version_id, subscription_id, sponsorship_id
     ) VALUES
       ('household-sunrise','grant-local-sunrise','local',$1::jsonb,$4,NULL,true,100,
        'family_v1','subscription-local-sunrise',NULL),
       ('household-harbor','grant-local-harbor','local',$2::jsonb,$4,NULL,true,100,
        'free_v1','subscription-local-harbor',NULL),
       ('household-harbor','grant-local-harbor-unverified','local',$1::jsonb,$4,NULL,true,300,
        'family_v1','subscription-local-harbor-unverified',NULL),
       ('household-harbor','grant-local-harbor-expired','local',$3::jsonb,
        '2025-01-01T00:00:00.000Z',NULL,true,200,'plus_v1',
        'subscription-local-harbor-expired',NULL),
       ('household-harbor','grant-sponsor-harbor-expired','sponsor',$3::jsonb,
        '2025-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',true,400,
        'plus_v1','subscription-sponsor-harbor-expired',
        'sponsorship-allocation-harbor-expired')
     ON CONFLICT (household_id, id) DO NOTHING`,
    [
      JSON.stringify(allCapabilities),
      JSON.stringify(freeCapabilities),
      JSON.stringify(plusCapabilities),
      now.toISOString(),
    ],
  );
  await transaction.query(
    `INSERT INTO commerce_allowance_allocations(
       household_id, id, entitlement_grant_id, allowance_key, subject_kind,
       subject_id, state, allocated_at
     ) VALUES
       ('household-sunrise','allocation-sunrise-alice','grant-local-sunrise',
        'protected_members','protected_member','person-owner-alice','active',$1),
       ('household-sunrise','allocation-sunrise-pat','grant-local-sunrise',
        'protected_members','protected_member','person-protected-pat','active',$1),
       ('household-sunrise','allocation-sunrise-terry','grant-local-sunrise',
        'trusted_circle_participants','trusted_circle_person','person-trusted-terry','active',$1),
       ('household-harbor','allocation-harbor-olivia','grant-local-harbor',
        'protected_members','protected_member','person-protected-olivia','active',$1)
     ON CONFLICT DO NOTHING`,
    [now.toISOString()],
  );
  await transaction.query(
    `INSERT INTO protected_members(
       household_id, person_id, status, consented_by_person_id, consent_version,
       allowance_allocation_id, accepted_at, created_at, updated_at,
       consent_id, latest_consent_evidence_id
     ) VALUES
       ('household-sunrise','person-owner-alice','accepted','person-owner-alice',
        'protected-self-v1','allocation-sunrise-alice',$1,$1,$1,
        'consent-protected-sunrise-alice','evidence-protected-sunrise-alice'),
       ('household-sunrise','person-protected-pat','accepted','person-protected-pat',
        'protected-self-v1','allocation-sunrise-pat',$1,$1,$1,
        'consent-protected-sunrise-pat','evidence-protected-sunrise-pat'),
       ('household-harbor','person-protected-olivia','accepted','person-protected-olivia',
        'protected-self-v1','allocation-harbor-olivia',$1,$1,$1,
        'consent-protected-harbor-olivia','evidence-protected-harbor-olivia')
     ON CONFLICT (household_id, person_id) DO NOTHING`,
    [now.toISOString()],
  );
  for (const [householdId, personId] of [
    ['household-sunrise', 'person-owner-alice'],
    ['household-sunrise', 'person-protected-pat'],
    ['household-harbor', 'person-protected-olivia'],
  ] as const) {
    await transaction.query(
      `INSERT INTO orientation_states(
         household_id, person_id, status, completed_steps, safe_word_disposition,
         needs_attention, version, updated_at
       ) VALUES ($1,$2,'not_started','[]'::jsonb,'unanswered',false,1,$3)
       ON CONFLICT (household_id, person_id) DO NOTHING`,
      [householdId, personId, now.toISOString()],
    );
  }
}

async function seedHqData(transaction: SqlExecutor, now: Date): Promise<void> {
  await transaction.query(
    `INSERT INTO provider_health(key, state, detail, checked_at) VALUES
       ('local-reputation','mock','Local adapter returns an explicit unknown observation.',$1),
       ('optional-ai','unavailable','No credentials configured; deterministic analysis remains active.',$1)
     ON CONFLICT (key) DO NOTHING`,
    [now.toISOString()],
  );
  await transaction.query(
    `INSERT INTO saved_searches(id, name, source, result_count, refreshed_at) VALUES
       ('search-seeded-ncua','Seeded credit-union design partners','seeded_nocall',12,$1)
     ON CONFLICT (id) DO NOTHING`,
    [now.toISOString()],
  );
  await transaction.query(
    `INSERT INTO target_accounts(id, name, segment, verification_state, source_reference, updated_at) VALUES
       ('account-seeded-redwood','Redwood Community CU (synthetic)','credit_union','synthetic','local_seed',$1),
       ('account-seeded-harbor','Harbor Benefits Group (synthetic)','employer_benefit','synthetic','local_seed',$1)
     ON CONFLICT (id) DO NOTHING`,
    [now.toISOString()],
  );
  const staleAt = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString();
  const futureAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1_000).toISOString();
  await transaction.query(
    `INSERT INTO opportunities(
       id, account_id, stage, owner, next_action, next_action_at, updated_at
     ) VALUES
       ('opportunity-seeded-redwood','account-seeded-redwood','discovery','Founder','Schedule synthetic discovery review',$1,$3),
       ('opportunity-seeded-harbor','account-seeded-harbor','target','Founder','Verify synthetic contact role',$2,$3)
     ON CONFLICT (id) DO NOTHING`,
    [staleAt, futureAt, now.toISOString()],
  );
  await transaction.query(
    `INSERT INTO hq_work_cases(
       id, case_kind, household_id, severity, state, routing_class, summary,
       assigned_person_id, due_at, created_at, updated_at
     ) VALUES (
       'case-seeded-riley-review','fraud','household-sunrise','medium','open',
       'trust_safety','Synthetic metadata-only review fixture','person-hq-riley',$1,$2,$2
     ) ON CONFLICT (id) DO NOTHING`,
    [futureAt, now.toISOString()],
  );
}

const safeDecision: DecisionRecord = {
  risk: 'caution',
  evidenceSufficiency: 'limited',
  calibration: 'not_calibrated',
  summary: 'This synthetic message uses urgency. Pause and verify through an official channel.',
  evidence: [
    {
      kind: 'artifact',
      label: 'Urgency language',
      observation: 'The message asks for immediate action.',
      limitations: 'Urgency alone does not prove fraud.',
    },
    {
      kind: 'missing',
      label: 'Live reputation unavailable',
      observation: 'No live provider lookup was performed.',
      limitations: 'Build Run 1 uses a local unknown provider.',
    },
  ],
  actions: [
    {
      key: 'pause',
      priority: 1,
      title: 'Pause before responding',
      detail:
        'Do not reply, click, pay, or share a code until you independently verify the request.',
      officialChannelOnly: true,
    },
  ],
  provider: { name: 'local-unknown', state: 'mock', version: 'run1' },
  rulesetVersion: 'run1-seed',
};

async function seedCheckIfMissing(
  database: Database,
  repository: CheckRepository,
  input: {
    readonly householdId: string;
    readonly actorPersonId: string;
    readonly artifactId: string;
    readonly analysisId: string;
    readonly content: string;
    readonly now: Date;
  },
): Promise<void> {
  const exists = await database.query<Record<string, unknown>>(
    'SELECT 1 FROM analyses WHERE id = $1',
    [input.analysisId],
  );
  if (exists.rows.length > 0) return;
  await repository.create({
    householdId: input.householdId,
    actorPersonId: input.actorPersonId,
    audience: 'customer',
    kind: 'text',
    content: input.content,
    decision: safeDecision,
    correlationId: `correlation-${input.analysisId}`,
    now: input.now,
    ids: { artifactId: input.artifactId, analysisId: input.analysisId },
  });
}

function transactionDatabase(database: Database, executor: SqlExecutor): Database {
  return {
    kind: database.kind,
    query: <Row extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]) =>
      executor.query<Row>(sql, parameters),
    exec: (sql) => executor.exec(sql),
    transaction: (work) => work(executor),
    close: async () => undefined,
  };
}

export async function seedDemoData(
  database: Database,
  protection: ArtifactProtection,
  now: Date = new Date(),
): Promise<'seeded' | 'already_seeded'> {
  return database.transaction(async (transaction) => {
    const marker = await transaction.query<Record<string, unknown>>(
      `SELECT 1 FROM local_demo_bootstraps WHERE bootstrap_key = 'run1-v1'`,
    );
    if (marker.rows.length > 0) return 'already_seeded';
    const occupancy = await transaction.query<{ occupied: boolean } & Record<string, unknown>>(
      `SELECT (
         EXISTS (SELECT 1 FROM persons) OR EXISTS (SELECT 1 FROM households)
         OR EXISTS (SELECT 1 FROM organizations)
         OR EXISTS (
           SELECT 1 FROM commerce_product_versions
           WHERE id <> 'consumer_household_v1'
         )
         OR (SELECT count(*) FROM commerce_product_versions) <> 1
         OR EXISTS (
           SELECT 1 FROM commerce_plan_versions
           WHERE id NOT IN ('founding_plus_beta_v2','founding_family_beta_v2')
         )
         OR (SELECT count(*) FROM commerce_plan_versions) <> 2
         OR EXISTS (SELECT 1 FROM analyses)
         OR EXISTS (SELECT 1 FROM provider_health)
         OR EXISTS (SELECT 1 FROM saved_searches)
         OR EXISTS (SELECT 1 FROM target_accounts)
       ) AS occupied`,
    );
    if (occupancy.rows[0]?.occupied === true) {
      throw new Error('Demo bootstrap requires an empty local database');
    }
    await seedPeople(transaction, now);
    await seedHouseholdData(transaction, now);
    await seedHqData(transaction, now);
    const scopedDatabase = transactionDatabase(database, transaction);
    const checks = new CheckRepository(scopedDatabase, protection);
    await seedCheckIfMissing(scopedDatabase, checks, {
      householdId: 'household-sunrise',
      actorPersonId: 'person-protected-pat',
      artifactId: 'artifact-seed-sunrise-shared',
      analysisId: seedChecks.sunriseShared,
      content: 'Synthetic bank alert: act immediately by calling the number in this message.',
      now,
    });
    await seedCheckIfMissing(scopedDatabase, checks, {
      householdId: 'household-sunrise',
      actorPersonId: 'person-owner-alice',
      artifactId: 'artifact-seed-sunrise-private',
      analysisId: seedChecks.sunrisePrivate,
      content: 'Synthetic private message asking for an urgent gift card purchase.',
      now,
    });
    await seedCheckIfMissing(scopedDatabase, checks, {
      householdId: 'household-harbor',
      actorPersonId: 'person-protected-olivia',
      artifactId: 'artifact-seed-harbor-private',
      analysisId: seedChecks.harborPrivate,
      content: 'Synthetic Harbor household message requesting a wire transfer.',
      now,
    });
    await checks.share({
      checkId: seedChecks.sunriseShared,
      householdId: 'household-sunrise',
      ownerPersonId: 'person-protected-pat',
      sharedWithPersonId: 'person-trusted-terry',
      audience: 'customer',
      correlationId: 'correlation-seed-share',
      now,
    });
    await transaction.query(
      `INSERT INTO local_demo_bootstraps(bootstrap_key, bootstrap_mode, completed_at)
       VALUES ('run1-v1','empty_database',$1)`,
      [now.toISOString()],
    );
    return 'seeded';
  });
}
