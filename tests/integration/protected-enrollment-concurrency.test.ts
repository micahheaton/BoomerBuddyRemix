import type { ProtectedSelfEnrollmentStatusResponse } from '@boomerbuddy/contracts';
import {
  EntitlementRepository,
  protectedSelfEnrollmentMutationQuota,
  protectedSelfNoopMutationQuota,
} from '@boomerbuddy/persistence';
import { afterEach, describe, expect, it } from 'vitest';

import {
  installSyntheticLocalFamilyEntitlement,
  installSyntheticLocalFamilyHousehold,
  syntheticLocalFamilyHousehold,
} from './protected-enrollment-fixture';
import { browserHeaders, createApiHarness, login, type ApiHarness } from './support';

function operation(action: 'enroll' | 'withdraw', sequence: number): string {
  return `protected-self-${action}:20000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function enrollmentPayload(status: ProtectedSelfEnrollmentStatusResponse) {
  return {
    consentVersion: status.consent.version,
    disclosureVersion: status.consent.disclosure.version,
    disclosureDigest: status.consent.disclosure.digest,
    policyVersion: status.consent.policy.version,
    policyDigest: status.consent.policy.digest,
    consentAccepted: true,
  } as const;
}

async function status(
  harness: ApiHarness,
  headers: Record<string, string>,
): Promise<ProtectedSelfEnrollmentStatusResponse> {
  const response = await harness.app.inject({
    method: 'GET',
    url: '/v1/protected-enrollment',
    headers,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<ProtectedSelfEnrollmentStatusResponse>();
}

async function addSyntheticMember(
  harness: ApiHarness,
  input: { readonly householdId: string; readonly personId: string; readonly suffix: string },
): Promise<void> {
  await harness.database.query(
    `INSERT INTO household_memberships(
       household_id, id, person_id, membership_kind, status, created_at
     ) VALUES ($1,$2,$3,'member','active',$4)`,
    [
      input.householdId,
      `membership-protected-${input.suffix}`,
      input.personId,
      harness.clock.now().toISOString(),
    ],
  );
}

describe('protected-self household serialization and mutation quota', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('uses independent household gate rows while concurrent synthetic local Family enrollments both complete', async () => {
    harness = await createApiHarness();
    await installSyntheticLocalFamilyHousehold(harness);
    const secondHouseholdId = 'household-protected-concurrent-second';
    await harness.database.query(
      `INSERT INTO households(id, name, created_at)
       VALUES ($1,'Second synthetic local Family entitlement household',$2)`,
      [secondHouseholdId, harness.clock.now().toISOString()],
    );
    await addSyntheticMember(harness, {
      householdId: secondHouseholdId,
      personId: 'person-protected-olivia',
      suffix: 'concurrent-olivia',
    });
    await installSyntheticLocalFamilyEntitlement(harness, {
      householdId: secondHouseholdId,
      payerPersonId: 'person-protected-olivia',
      suffix: 'protected-concurrent-second',
    });
    const [jordanLogin, oliviaLogin] = await Promise.all([
      login(harness.app, syntheticLocalFamilyHousehold.personaId),
      login(harness.app, 'protected-olivia'),
    ]);
    const jordanHeaders = {
      ...browserHeaders(jordanLogin.cookie as string),
      'x-bb-household-id': syntheticLocalFamilyHousehold.householdId,
    };
    const oliviaHeaders = {
      ...browserHeaders(oliviaLogin.cookie as string),
      'x-bb-household-id': secondHouseholdId,
    };
    const [jordanStatus, oliviaStatus] = await Promise.all([
      status(harness, jordanHeaders),
      status(harness, oliviaHeaders),
    ]);
    const responses = await Promise.all([
      harness.app.inject({
        method: 'POST',
        url: '/v1/protected-enrollment',
        headers: { ...jordanHeaders, 'idempotency-key': operation('enroll', 1) },
        payload: enrollmentPayload(jordanStatus),
      }),
      harness.app.inject({
        method: 'POST',
        url: '/v1/protected-enrollment',
        headers: { ...oliviaHeaders, 'idempotency-key': operation('enroll', 2) },
        payload: enrollmentPayload(oliviaStatus),
      }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
    const gates = await harness.database.query<
      { readonly household_id: string } & Record<string, unknown>
    >(
      `SELECT household_id FROM protected_self_enrollment_household_gates
       ORDER BY household_id`,
    );
    expect(gates.rows.map((row) => row.household_id)).toEqual([
      secondHouseholdId,
      syntheticLocalFamilyHousehold.householdId,
    ]);
  });

  it('serializes same-key concurrency into one mutation and one durable result', async () => {
    harness = await createApiHarness();
    await installSyntheticLocalFamilyHousehold(harness);
    const loginResult = await login(harness.app, syntheticLocalFamilyHousehold.personaId);
    const headers = {
      ...browserHeaders(loginResult.cookie as string),
      'x-bb-household-id': syntheticLocalFamilyHousehold.householdId,
    };
    const payload = enrollmentPayload(await status(harness, headers));
    const key = operation('enroll', 10);
    const responses = await Promise.all([
      harness.app.inject({
        method: 'POST',
        url: '/v1/protected-enrollment',
        headers: { ...headers, 'idempotency-key': key },
        payload,
      }),
      harness.app.inject({
        method: 'POST',
        url: '/v1/protected-enrollment',
        headers: { ...headers, 'idempotency-key': key },
        payload,
      }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
    expect(responses.map((response) => response.json().reused).sort()).toEqual([false, true]);
    const counts = await harness.database.query<
      { readonly operations: number; readonly audits: number; readonly consents: number } & Record<
        string,
        unknown
      >
    >(
      `SELECT
         (SELECT count(*)::int FROM protected_self_enrollment_operations
          WHERE household_id = $1) AS operations,
         (SELECT count(*)::int FROM audit_events
          WHERE household_id = $1 AND action = 'protected_enrollment.enroll') AS audits,
         (SELECT count(*)::int FROM consents
          WHERE household_id = $1 AND purpose = 'protected_enrollment') AS consents`,
      [syntheticLocalFamilyHousehold.householdId],
    );
    expect(counts.rows[0]).toEqual({ operations: 1, audits: 1, consents: 1 });
  });

  it('allows only one winner for the last same-household protected seat', async () => {
    harness = await createApiHarness();
    await installSyntheticLocalFamilyHousehold(harness);
    for (const [personId, suffix] of [
      ['person-owner-alice', 'seat-alice'],
      ['person-protected-pat', 'seat-pat'],
      ['person-protected-olivia', 'seat-olivia'],
    ] as const) {
      await addSyntheticMember(harness, {
        householdId: syntheticLocalFamilyHousehold.householdId,
        personId,
        suffix,
      });
    }
    const repository = new EntitlementRepository(harness.database, undefined, 'local');
    for (const [personId, suffix] of [
      ['person-owner-alice', 'alice'],
      ['person-protected-pat', 'pat'],
    ] as const) {
      await repository.testOnlyEnrollProtectedSelf({
        householdId: syntheticLocalFamilyHousehold.householdId,
        personId,
        actorPersonId: personId,
        consentVersion: `synthetic-seat-${suffix}-v1`,
        actorIssuer: 'boomerbuddy-dev',
        now: harness.clock.now(),
      });
    }
    const [jordanLogin, oliviaLogin] = await Promise.all([
      login(harness.app, syntheticLocalFamilyHousehold.personaId),
      login(harness.app, 'protected-olivia'),
    ]);
    const jordanHeaders = {
      ...browserHeaders(jordanLogin.cookie as string),
      'x-bb-household-id': syntheticLocalFamilyHousehold.householdId,
    };
    const oliviaHeaders = {
      ...browserHeaders(oliviaLogin.cookie as string),
      'x-bb-household-id': syntheticLocalFamilyHousehold.householdId,
    };
    const [jordanStatus, oliviaStatus] = await Promise.all([
      status(harness, jordanHeaders),
      status(harness, oliviaHeaders),
    ]);
    expect([jordanStatus.eligibility, oliviaStatus.eligibility]).toEqual([
      'available',
      'available',
    ]);
    const responses = await Promise.all([
      harness.app.inject({
        method: 'POST',
        url: '/v1/protected-enrollment',
        headers: { ...jordanHeaders, 'idempotency-key': operation('enroll', 20) },
        payload: enrollmentPayload(jordanStatus),
      }),
      harness.app.inject({
        method: 'POST',
        url: '/v1/protected-enrollment',
        headers: { ...oliviaHeaders, 'idempotency-key': operation('enroll', 21) },
        payload: enrollmentPayload(oliviaStatus),
      }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 403]);
    const counts = await harness.database.query<
      {
        readonly allocations: number;
        readonly operations: number;
        readonly consents: number;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM commerce_allowance_allocations
          WHERE household_id = $1 AND allowance_key = 'protected_members'
            AND state = 'active') AS allocations,
         (SELECT count(*)::int FROM protected_self_enrollment_operations
          WHERE household_id = $1) AS operations,
         (SELECT count(*)::int FROM consents
          WHERE household_id = $1 AND consent_version = 'protected-self-enrollment-v1') AS consents`,
      [syntheticLocalFamilyHousehold.householdId],
    );
    expect(counts.rows[0]).toEqual({ allocations: 3, operations: 1, consents: 1 });
  });

  it('caps excess receipts but always permits an enrolled withdrawal after no-op exhaustion', async () => {
    harness = await createApiHarness();
    await installSyntheticLocalFamilyHousehold(harness);
    const loginResult = await login(harness.app, syntheticLocalFamilyHousehold.personaId);
    const headers = {
      ...browserHeaders(loginResult.cookie as string),
      'x-bb-household-id': syntheticLocalFamilyHousehold.householdId,
    };
    await harness.database.query(
      `INSERT INTO protected_self_enrollment_household_gates(household_id, created_at)
       VALUES ($1,$2)`,
      [syntheticLocalFamilyHousehold.householdId, harness.clock.now().toISOString()],
    );
    for (let index = 0; index < protectedSelfNoopMutationQuota; index += 1) {
      await harness.database.query(
        `INSERT INTO protected_self_enrollment_operations(
           operation_key, household_id, actor_person_id, operation_kind, request_digest,
           result_state, changed, created_at
         ) VALUES ($1,$2,$3,'withdraw',$4,'already_withdrawn',false,$5)`,
        [
          operation('withdraw', 1_000 + index),
          syntheticLocalFamilyHousehold.householdId,
          syntheticLocalFamilyHousehold.personId,
          'a'.repeat(64),
          harness.clock.now().toISOString(),
        ],
      );
    }
    for (let index = 0; index < protectedSelfEnrollmentMutationQuota - 1; index += 1) {
      await harness.database.query(
        `INSERT INTO protected_self_enrollment_operations(
           operation_key, household_id, actor_person_id, operation_kind, request_digest,
           result_state, result_consent_version, result_allowance_allocation_id,
           changed, created_at
         ) VALUES ($1,$2,$3,'enroll',$4,'enrolled','protected-self-enrollment-v1',$5,true,$6)`,
        [
          operation('enroll', 2_000 + index),
          syntheticLocalFamilyHousehold.householdId,
          syntheticLocalFamilyHousehold.personId,
          'b'.repeat(64),
          `historical-allocation-${index}`,
          harness.clock.now().toISOString(),
        ],
      );
    }
    const deniedNoop = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment/withdraw',
      headers: { ...headers, 'idempotency-key': operation('withdraw', 9_000) },
      payload: { withdrawalAcknowledged: true },
    });
    expect(deniedNoop.statusCode).toBe(409);
    expect(deniedNoop.json().error.message).toContain('history limit reached');

    const currentStatus = await status(harness, headers);
    const enrolled = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment',
      headers: { ...headers, 'idempotency-key': operation('enroll', 9_001) },
      payload: enrollmentPayload(currentStatus),
    });
    expect(enrolled.statusCode, enrolled.body).toBe(201);
    expect(enrolled.json().changed).toBe(true);

    const withdrawalKey = operation('withdraw', 9_002);
    const withdrawn = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment/withdraw',
      headers: { ...headers, 'idempotency-key': withdrawalKey },
      payload: { withdrawalAcknowledged: true },
    });
    expect(withdrawn.statusCode, withdrawn.body).toBe(200);
    expect(withdrawn.json()).toEqual({ state: 'not_enrolled', changed: true, reused: false });
    const replay = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment/withdraw',
      headers: { ...headers, 'idempotency-key': withdrawalKey },
      payload: { withdrawalAcknowledged: true },
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual({ state: 'not_enrolled', changed: true, reused: true });
    const deniedEnrollment = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment',
      headers: { ...headers, 'idempotency-key': operation('enroll', 9_003) },
      payload: enrollmentPayload(currentStatus),
    });
    expect(deniedEnrollment.statusCode).toBe(409);
    const deniedSecondNoop = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment/withdraw',
      headers: { ...headers, 'idempotency-key': operation('withdraw', 9_004) },
      payload: { withdrawalAcknowledged: true },
    });
    expect(deniedSecondNoop.statusCode).toBe(409);
    const counts = await harness.database.query<
      { readonly operations: number; readonly audits: number; readonly consents: number } & Record<
        string,
        unknown
      >
    >(
      `SELECT
         (SELECT count(*)::int FROM protected_self_enrollment_operations
          WHERE household_id = $1 AND actor_person_id = $2) AS operations,
         (SELECT count(*)::int FROM audit_events
          WHERE household_id = $1 AND actor_person_id = $2
            AND action LIKE 'protected_enrollment.%') AS audits,
         (SELECT count(*)::int FROM consents
          WHERE household_id = $1 AND protected_person_id = $2
            AND purpose = 'protected_enrollment') AS consents`,
      [syntheticLocalFamilyHousehold.householdId, syntheticLocalFamilyHousehold.personId],
    );
    expect(counts.rows[0]).toEqual({
      operations: protectedSelfNoopMutationQuota + protectedSelfEnrollmentMutationQuota + 1,
      audits: 2,
      consents: 1,
    });
  }, 30_000);
});
