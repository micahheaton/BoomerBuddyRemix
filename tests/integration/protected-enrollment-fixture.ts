import { EntitlementRepository } from '@boomerbuddy/persistence';

import type { ApiHarness } from './support';

export const syntheticLocalFamilyHousehold = {
  householdId: 'household-protected-golden',
  personId: 'person-trusted-jordan',
  personaId: 'trusted-jordan',
} as const;

export async function installSyntheticLocalFamilyEntitlement(
  harness: ApiHarness,
  input: {
    readonly householdId: string;
    readonly payerPersonId: string;
    readonly suffix: string;
    readonly lifecycle?: 'active' | 'expired';
    readonly precedence?: number;
  },
): Promise<void> {
  const now = harness.clock.now();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000);
  const lifecycle = input.lifecycle ?? 'active';
  const precedence = input.precedence ?? 100;
  const subscriptionId = `subscription-${input.suffix}`;
  await harness.database.query(
    `INSERT INTO commerce_subscriptions(
       household_id, id, payer_person_id, plan_version_id, source, lifecycle,
       source_verified, precedence, current_period_starts_at, current_period_ends_at,
       reconciliation_state, created_at, updated_at
     ) VALUES ($1,$2,$3,'family_v1','local',$4,true,$7,
       $5,$6,'not_required',$5,$5)`,
    [
      input.householdId,
      subscriptionId,
      input.payerPersonId,
      lifecycle,
      now.toISOString(),
      periodEnd.toISOString(),
      precedence,
    ],
  );
  await harness.database.query(
    `INSERT INTO commerce_provider_subscription_records(
       id, household_id, subscription_id, provider, environment,
       external_subscription_id, raw_state, provider_version, observed_at, verified_at
     ) VALUES ($1,$2,$3,'local','local',$4,$5,'fixture-v1',$6,$6)`,
    [
      `provider-record-${input.suffix}`,
      input.householdId,
      subscriptionId,
      `local-${input.suffix}`,
      lifecycle,
      now.toISOString(),
    ],
  );
  await harness.database.query(
    `INSERT INTO entitlement_grants(
       household_id, id, source, capabilities, starts_at, source_verified,
       precedence, plan_version_id, subscription_id
     ) VALUES ($1,$2,'local',$3::jsonb,$4,true,$6,'family_v1',$5)`,
    [
      input.householdId,
      `grant-${input.suffix}`,
      JSON.stringify([
        'check:text',
        'check:url',
        'history:read',
        'family:manage',
        'orientation:use',
      ]),
      now.toISOString(),
      subscriptionId,
      precedence,
    ],
  );
}

export async function installSyntheticLocalFamilyHousehold(
  harness: ApiHarness,
  options: { readonly lifecycle?: 'active' | 'expired' } = {},
): Promise<void> {
  const now = harness.clock.now();
  const lifecycle = options.lifecycle ?? 'active';
  await harness.database.query(
    `INSERT INTO households(id, name, created_at)
     VALUES ($1,'Synthetic local Family entitlement household',$2)`,
    [syntheticLocalFamilyHousehold.householdId, now.toISOString()],
  );
  await harness.database.query(
    `INSERT INTO household_memberships(
       household_id, id, person_id, membership_kind, status, created_at
     ) VALUES ($1,'membership-protected-golden',$2,'member','active',$3)`,
    [
      syntheticLocalFamilyHousehold.householdId,
      syntheticLocalFamilyHousehold.personId,
      now.toISOString(),
    ],
  );
  await harness.database.query(
    `INSERT INTO household_administrator_assignments(
       household_id, person_id, status, granted_by_person_id, granted_at
     ) VALUES ($1,$2,'active',$2,$3)`,
    [
      syntheticLocalFamilyHousehold.householdId,
      syntheticLocalFamilyHousehold.personId,
      now.toISOString(),
    ],
  );
  await harness.database.query(
    `INSERT INTO household_billing_authorities(
       household_id, person_id, status, granted_by_person_id, granted_at
     ) VALUES ($1,$2,'active',$2,$3)`,
    [
      syntheticLocalFamilyHousehold.householdId,
      syntheticLocalFamilyHousehold.personId,
      now.toISOString(),
    ],
  );
  await harness.database.query(
    `INSERT INTO household_payers(
       household_id, person_id, source, status, effective_at
     ) VALUES ($1,$2,'local','active',$3)`,
    [
      syntheticLocalFamilyHousehold.householdId,
      syntheticLocalFamilyHousehold.personId,
      now.toISOString(),
    ],
  );
  await installSyntheticLocalFamilyEntitlement(harness, {
    householdId: syntheticLocalFamilyHousehold.householdId,
    payerPersonId: syntheticLocalFamilyHousehold.personId,
    suffix: 'protected-golden',
    lifecycle,
  });
}

export async function exhaustSyntheticLocalFamilyProtectedSeats(
  harness: ApiHarness,
): Promise<void> {
  const repository = new EntitlementRepository(harness.database, undefined, 'local');
  for (const [personId, suffix] of [
    ['person-owner-alice', 'alice'],
    ['person-protected-pat', 'pat'],
    ['person-protected-olivia', 'olivia'],
  ] as const) {
    await harness.database.query(
      `INSERT INTO household_memberships(
         household_id, id, person_id, membership_kind, status, created_at
       ) VALUES ($1,$2,$3,'member','active',$4)`,
      [
        syntheticLocalFamilyHousehold.householdId,
        `membership-protected-golden-${suffix}`,
        personId,
        harness.clock.now().toISOString(),
      ],
    );
    await repository.testOnlyEnrollProtectedSelf({
      householdId: syntheticLocalFamilyHousehold.householdId,
      personId,
      actorPersonId: personId,
      consentVersion: `test-protected-seat-${suffix}-v1`,
      actorIssuer: 'boomerbuddy-dev',
      now: harness.clock.now(),
    });
  }
}
