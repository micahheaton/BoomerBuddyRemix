import { EntitlementRepository, protectedSelfEnrollmentConsent } from '@boomerbuddy/persistence';
import type { ProtectedSelfEnrollmentStatusResponse } from '@boomerbuddy/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  exhaustSyntheticLocalFamilyProtectedSeats,
  installSyntheticLocalFamilyHousehold,
  syntheticLocalFamilyHousehold,
} from '../integration/protected-enrollment-fixture';
import { browserHeaders, createApiHarness, login, type ApiHarness } from '../integration/support';

const enrollKey = 'protected-self-enroll:10000000-0000-4000-8000-000000000001';

function enrollmentPayload(status: ProtectedSelfEnrollmentStatusResponse) {
  return {
    consentVersion: status.consent.version,
    disclosureVersion: status.consent.disclosure.version,
    disclosureDigest: status.consent.disclosure.digest,
    policyVersion: status.consent.policy.version,
    policyDigest: status.consent.policy.digest,
    consentAccepted: true,
  };
}

describe('protected-self enrollment security boundaries', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('rejects a wrong household and every payer or administrator target-for-another shape', async () => {
    harness = await createApiHarness();
    await installSyntheticLocalFamilyHousehold(harness);
    const session = await login(harness.app, syntheticLocalFamilyHousehold.personaId);
    const selfHeaders = {
      ...browserHeaders(session.cookie as string),
      'x-bb-household-id': syntheticLocalFamilyHousehold.householdId,
    };
    const statusResponse = await harness.app.inject({
      method: 'GET',
      url: '/v1/protected-enrollment',
      headers: selfHeaders,
    });
    const payload = enrollmentPayload(statusResponse.json());

    for (const request of [
      harness.app.inject({
        method: 'GET',
        url: '/v1/protected-enrollment',
        headers: {
          ...browserHeaders(session.cookie as string),
          'x-bb-household-id': 'household-sunrise',
        },
      }),
      harness.app.inject({
        method: 'POST',
        url: '/v1/protected-enrollment',
        headers: {
          ...browserHeaders(session.cookie as string),
          'x-bb-household-id': 'household-sunrise',
          'idempotency-key': enrollKey,
        },
        payload,
      }),
    ]) {
      expect((await request).statusCode).toBe(403);
    }

    for (const target of [
      { personId: 'person-owner-alice' },
      { actorPersonId: syntheticLocalFamilyHousehold.personId, personId: 'person-owner-alice' },
      { householdId: 'household-sunrise' },
      { subjectPersonId: 'person-owner-alice' },
    ]) {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/protected-enrollment',
        headers: { ...selfHeaders, 'idempotency-key': enrollKey },
        payload: { ...payload, ...target },
      });
      expect(response.statusCode).toBe(400);
    }
    const mutated = await harness.database.query<{ count: number } & Record<string, unknown>>(
      `SELECT count(*)::int AS count FROM protected_members
       WHERE household_id = $1`,
      [syntheticLocalFamilyHousehold.householdId],
    );
    expect(mutated.rows[0]?.count).toBe(0);

    const documents = protectedSelfEnrollmentConsent.documents;
    expect(() =>
      new EntitlementRepository(
        harness!.database,
        undefined,
        'local',
      ).enrollProtectedSelfIdempotent({
        householdId: syntheticLocalFamilyHousehold.householdId,
        personId: 'person-owner-alice',
        actorPersonId: syntheticLocalFamilyHousehold.personId,
        consentVersion: protectedSelfEnrollmentConsent.version,
        disclosureVersion: documents.disclosureVersion,
        disclosureDigest: documents.disclosureDigest,
        policyVersion: documents.policyVersion,
        policyDigest: documents.policyDigest,
        operationKey: enrollKey,
        actorIdentityId: 'identity-security-target-defense',
        actorIssuer: 'boomerbuddy-dev',
        actorIdentitySubject: 'trusted-jordan',
        sessionId: 'session-security-target-defense',
        audience: 'customer',
        correlationId: 'correlation-security-target-defense',
        now: harness!.clock.now(),
      }),
    ).toThrow('Protected enrollment requires self-consent');
  });

  it('rejects an exact identity tuple when its bound session is revoked', async () => {
    harness = await createApiHarness();
    await installSyntheticLocalFamilyHousehold(harness);
    const loginResult = await login(harness.app, syntheticLocalFamilyHousehold.personaId);
    const sessionId = String(
      (loginResult.body.principal as { readonly sessionId: string }).sessionId,
    );
    const session = await harness.database.query<
      {
        readonly identity_id: string;
        readonly identity_subject: string;
        readonly issuer: string;
      } & Record<string, unknown>
    >(
      `SELECT identity_id, identity_subject, issuer FROM sessions
       WHERE id = $1 AND person_id = $2`,
      [sessionId, syntheticLocalFamilyHousehold.personId],
    );
    const exact = session.rows[0];
    if (exact === undefined) throw new Error('Synthetic exact session is unavailable');
    await harness.database.query('UPDATE sessions SET revoked_at = $2 WHERE id = $1', [
      sessionId,
      harness.clock.now().toISOString(),
    ]);
    const documents = protectedSelfEnrollmentConsent.documents;
    await expect(
      new EntitlementRepository(harness.database, undefined, 'local').enrollProtectedSelfIdempotent(
        {
          householdId: syntheticLocalFamilyHousehold.householdId,
          personId: syntheticLocalFamilyHousehold.personId,
          actorPersonId: syntheticLocalFamilyHousehold.personId,
          consentVersion: protectedSelfEnrollmentConsent.version,
          disclosureVersion: documents.disclosureVersion,
          disclosureDigest: documents.disclosureDigest,
          policyVersion: documents.policyVersion,
          policyDigest: documents.policyDigest,
          operationKey: 'protected-self-enroll:10000000-0000-4000-8000-000000000099',
          actorIdentityId: exact.identity_id,
          actorIssuer: exact.issuer,
          actorIdentitySubject: exact.identity_subject,
          sessionId,
          audience: 'customer',
          correlationId: 'correlation-security-revoked-exact-session',
          now: harness.clock.now(),
        },
      ),
    ).rejects.toThrow('The exact active identity and session are required');
    const operations = await harness.database.query<
      { readonly count: number } & Record<string, unknown>
    >(
      `SELECT count(*)::int AS count FROM protected_self_enrollment_operations
       WHERE household_id = $1`,
      [syntheticLocalFamilyHousehold.householdId],
    );
    expect(operations.rows[0]?.count).toBe(0);
  });

  it('denies inactive entitlement enrollment without recording consent or an operation', async () => {
    harness = await createApiHarness();
    await installSyntheticLocalFamilyHousehold(harness, { lifecycle: 'expired' });
    const session = await login(harness.app, syntheticLocalFamilyHousehold.personaId);
    const headers = {
      ...browserHeaders(session.cookie as string),
      'x-bb-household-id': syntheticLocalFamilyHousehold.householdId,
    };
    const status = await harness.app.inject({
      method: 'GET',
      url: '/v1/protected-enrollment',
      headers,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      enrollment: { state: 'not_enrolled', effectiveAccess: false },
      eligibility: 'entitlement_inactive',
    });
    const denied = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment',
      headers: { ...headers, 'idempotency-key': enrollKey },
      payload: enrollmentPayload(status.json()),
    });
    expect(denied.statusCode).toBe(403);
    const counts = await harness.database.query<
      { protected: number; operations: number; evidence: number } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM protected_members WHERE household_id = $1) AS protected,
         (SELECT count(*)::int FROM protected_self_enrollment_operations
          WHERE household_id = $1) AS operations,
         (SELECT count(*)::int FROM consent_evidence WHERE household_id = $1) AS evidence`,
      [syntheticLocalFamilyHousehold.householdId],
    );
    expect(counts.rows[0]).toEqual({ protected: 0, operations: 0, evidence: 0 });
  });

  it('denies allowance exhaustion and rejects cross-action or replay-conflicting keys', async () => {
    harness = await createApiHarness();
    await installSyntheticLocalFamilyHousehold(harness);
    await exhaustSyntheticLocalFamilyProtectedSeats(harness);
    const session = await login(harness.app, syntheticLocalFamilyHousehold.personaId);
    const headers = {
      ...browserHeaders(session.cookie as string),
      'x-bb-household-id': syntheticLocalFamilyHousehold.householdId,
    };
    const status = await harness.app.inject({
      method: 'GET',
      url: '/v1/protected-enrollment',
      headers,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().eligibility).toBe('allowance_exhausted');

    const crossAction = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment',
      headers: {
        ...headers,
        'idempotency-key': 'protected-self-withdraw:10000000-0000-4000-8000-000000000002',
      },
      payload: enrollmentPayload(status.json()),
    });
    expect(crossAction.statusCode).toBe(400);

    const denied = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment',
      headers: { ...headers, 'idempotency-key': enrollKey },
      payload: enrollmentPayload(status.json()),
    });
    expect(denied.statusCode).toBe(403);
    const jordan = await harness.database.query<{ count: number } & Record<string, unknown>>(
      `SELECT count(*)::int AS count FROM protected_members
       WHERE household_id = $1 AND person_id = $2 AND status = 'accepted'`,
      [syntheticLocalFamilyHousehold.householdId, syntheticLocalFamilyHousehold.personId],
    );
    expect(jordan.rows[0]?.count).toBe(0);
  });
});
