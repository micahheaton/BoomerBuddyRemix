import { afterEach, describe, expect, it } from 'vitest';
import type { ProtectedSelfEnrollmentStatusResponse } from '@boomerbuddy/contracts';

import {
  installSyntheticLocalFamilyHousehold,
  syntheticLocalFamilyHousehold,
} from './protected-enrollment-fixture';
import { browserHeaders, createApiHarness, login, type ApiHarness } from './support';

const operation = (action: 'enroll' | 'withdraw', sequence: number) =>
  `protected-self-${action}:00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;

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

describe('protected-self enrollment golden path', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('moves a synthetic local Family entitlement through consent, orientation, Check, history, withdrawal, and replay denial without proving Stripe or live paid readiness', async () => {
    harness = await createApiHarness();
    await installSyntheticLocalFamilyHousehold(harness);
    const session = await login(harness.app, syntheticLocalFamilyHousehold.personaId);
    const headers = {
      ...browserHeaders(session.cookie as string),
      'x-bb-household-id': syntheticLocalFamilyHousehold.householdId,
    };

    const initial = await harness.app.inject({
      method: 'GET',
      url: '/v1/protected-enrollment',
      headers,
    });
    expect(initial.statusCode).toBe(200);
    const status = initial.json();
    expect(status).toMatchObject({
      householdId: syntheticLocalFamilyHousehold.householdId,
      personId: syntheticLocalFamilyHousehold.personId,
      enrollment: { state: 'not_enrolled', effectiveAccess: false },
      eligibility: 'available',
      withdrawalAvailable: false,
      consent: { version: 'protected-self-enrollment-v1' },
    });
    expect(status.consent.disclosure.text).toContain('for myself');
    expect(status.consent.disclosure.text).toContain('cannot accept this consent for me');
    expect(status.consent.policy.text).toContain('I may withdraw at any time');
    expect(status.consent.disclosure.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(status.consent.policy.digest).toMatch(/^[a-f0-9]{64}$/u);

    const consentPayload = enrollmentPayload(status);
    const enrollKey = operation('enroll', 1);
    const enrolled = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment',
      headers: { ...headers, 'idempotency-key': enrollKey },
      payload: consentPayload,
    });
    expect(enrolled.statusCode).toBe(201);
    expect(enrolled.json()).toEqual({
      state: 'enrolled',
      consentVersion: 'protected-self-enrollment-v1',
      changed: true,
      reused: false,
    });
    const enrollReplay = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment',
      headers: { ...headers, 'idempotency-key': enrollKey },
      payload: consentPayload,
    });
    expect(enrollReplay.statusCode).toBe(201);
    expect(enrollReplay.json()).toMatchObject({ changed: true, reused: true });

    const me = await harness.app.inject({ method: 'GET', url: '/v1/me', headers });
    expect(me.statusCode).toBe(200);
    expect(me.json().principal.households[0]).toMatchObject({
      id: syntheticLocalFamilyHousehold.householdId,
      isAdministrator: true,
      isPayer: true,
      isBillingManager: true,
      isProtectedMember: true,
      capabilities: ['check:text', 'check:url', 'history:read', 'family:manage', 'orientation:use'],
    });

    expect(
      (
        await harness.app.inject({
          method: 'POST',
          url: '/v1/orientation/start',
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    for (const step of ['protection_subject', 'trusted_circle'] as const) {
      expect(
        (
          await harness.app.inject({
            method: 'PUT',
            url: `/v1/orientation/steps/${step}`,
            headers,
            payload: { complete: true },
          })
        ).statusCode,
      ).toBe(200);
    }
    expect(
      (
        await harness.app.inject({
          method: 'PUT',
          url: '/v1/orientation/safe-word',
          headers,
          payload: { action: 'defer' },
        })
      ).statusCode,
    ).toBe(200);
    for (const step of [
      'safe_word',
      'practice_check',
      'capabilities_and_limits',
      'review',
    ] as const) {
      const completed = await harness.app.inject({
        method: 'PUT',
        url: `/v1/orientation/steps/${step}`,
        headers,
        payload: { complete: true },
      });
      expect(completed.statusCode).toBe(200);
      if (step === 'review') expect(completed.json().orientation.status).toBe('ready');
    }

    const check = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers,
      payload: {
        kind: 'text',
        content: 'Synthetic test: an unexpected caller asks for an urgent gift-card payment.',
      },
    });
    expect(check.statusCode).toBe(201);
    const checkId = String(check.json().check.id);
    const history = await harness.app.inject({ method: 'GET', url: '/v1/checks', headers });
    expect(history.statusCode).toBe(200);
    expect(history.json().checks.map((item: { id: string }) => item.id)).toContain(checkId);

    const withdrawKey = operation('withdraw', 2);
    const withdrawn = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment/withdraw',
      headers: { ...headers, 'idempotency-key': withdrawKey },
      payload: { withdrawalAcknowledged: true },
    });
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json()).toEqual({ state: 'not_enrolled', changed: true, reused: false });

    const staleEnrollReplay = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment',
      headers: { ...headers, 'idempotency-key': enrollKey },
      payload: consentPayload,
    });
    expect(staleEnrollReplay.json()).toMatchObject({ changed: true, reused: true });
    const afterStaleEnroll = await harness.app.inject({
      method: 'GET',
      url: '/v1/protected-enrollment',
      headers,
    });
    expect(afterStaleEnroll.json().enrollment.state).toBe('not_enrolled');

    const reenrolled = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment',
      headers: { ...headers, 'idempotency-key': operation('enroll', 3) },
      payload: consentPayload,
    });
    expect(reenrolled.statusCode).toBe(201);
    const staleWithdrawReplay = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment/withdraw',
      headers: { ...headers, 'idempotency-key': withdrawKey },
      payload: { withdrawalAcknowledged: true },
    });
    expect(staleWithdrawReplay.json()).toMatchObject({ changed: true, reused: true });
    const afterStaleWithdraw = await harness.app.inject({
      method: 'GET',
      url: '/v1/protected-enrollment',
      headers,
    });
    expect(afterStaleWithdraw.json().enrollment.state).toBe('enrolled');

    const finalWithdrawal = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment/withdraw',
      headers: { ...headers, 'idempotency-key': operation('withdraw', 4) },
      payload: { withdrawalAcknowledged: true },
    });
    expect(finalWithdrawal.statusCode).toBe(200);

    for (const denied of [
      harness.app.inject({
        method: 'POST',
        url: '/v1/checks',
        headers,
        payload: { kind: 'text', content: 'This post-withdrawal Check must be denied.' },
      }),
      harness.app.inject({ method: 'GET', url: '/v1/orientation', headers }),
      harness.app.inject({ method: 'GET', url: '/v1/checks', headers }),
    ]) {
      expect((await denied).statusCode).toBe(403);
    }

    const evidence = await harness.database.query<
      {
        operations: number;
        audits: number;
        consents: number;
        evidence: number;
        identity_bound: number;
        session_bound: number;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM protected_self_enrollment_operations
          WHERE household_id = $1 AND actor_person_id = $2) AS operations,
         (SELECT count(*)::int FROM audit_events
          WHERE household_id = $1 AND actor_person_id = $2
            AND action IN ('protected_enrollment.enroll','protected_enrollment.withdraw')) AS audits,
         (SELECT count(*)::int FROM consents
          WHERE household_id = $1 AND protected_person_id = $2
            AND purpose = 'protected_enrollment') AS consents,
         (SELECT count(*)::int FROM consent_evidence
          WHERE household_id = $1 AND subject_person_id = $2
            AND purpose = 'protected_enrollment') AS evidence,
         (SELECT count(*)::int FROM consent_evidence
          WHERE household_id = $1 AND subject_person_id = $2
            AND actor_person_id = subject_person_id
            AND actor_identity_id IS NOT NULL AND actor_identity_subject IS NOT NULL
            AND actor_identity_issuer = 'boomerbuddy-dev') AS identity_bound,
         (SELECT count(*)::int FROM consent_evidence
          WHERE household_id = $1 AND subject_person_id = $2
            AND session_id IS NOT NULL AND correlation_id IS NOT NULL) AS session_bound`,
      [syntheticLocalFamilyHousehold.householdId, syntheticLocalFamilyHousehold.personId],
    );
    expect(evidence.rows[0]).toEqual({
      operations: 4,
      audits: 4,
      consents: 2,
      evidence: 4,
      identity_bound: 4,
      session_bound: 4,
    });
  }, 30_000);

  it('binds consent to the exact resolved session identity when one person has two active identities from the same issuer', async () => {
    harness = await createApiHarness();
    await installSyntheticLocalFamilyHousehold(harness);
    await harness.database.query(
      `INSERT INTO identities(id, person_id, issuer, subject, status, created_at)
       VALUES ('identity-000-jordan-session-exact',$1,'boomerbuddy-dev',
         'trusted-jordan-session-exact','active',$2)`,
      [syntheticLocalFamilyHousehold.personId, harness.clock.now().toISOString()],
    );
    const loginResult = await login(harness.app, syntheticLocalFamilyHousehold.personaId);
    const sessionId = String(
      (loginResult.body.principal as { readonly sessionId: string }).sessionId,
    );
    const headers = {
      ...browserHeaders(loginResult.cookie as string),
      'x-bb-household-id': syntheticLocalFamilyHousehold.householdId,
    };
    const resolved = await harness.database.query<
      { readonly identity_id: string; readonly identity_subject: string } & Record<string, unknown>
    >(
      `SELECT identity_id, identity_subject FROM sessions
       WHERE id = $1 AND person_id = $2`,
      [sessionId, syntheticLocalFamilyHousehold.personId],
    );
    expect(resolved.rows[0]).toEqual({
      identity_id: 'identity-000-jordan-session-exact',
      identity_subject: 'trusted-jordan-session-exact',
    });

    const initial = await harness.app.inject({
      method: 'GET',
      url: '/v1/protected-enrollment',
      headers,
    });
    const enrolled = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment',
      headers: { ...headers, 'idempotency-key': operation('enroll', 20) },
      payload: enrollmentPayload(initial.json<ProtectedSelfEnrollmentStatusResponse>()),
    });
    expect(enrolled.statusCode, enrolled.body).toBe(201);

    const evidence = await harness.database.query<
      {
        readonly actor_identity_id: string;
        readonly actor_identity_issuer: string;
        readonly actor_identity_subject: string;
        readonly session_id: string;
      } & Record<string, unknown>
    >(
      `SELECT actor_identity_id, actor_identity_issuer, actor_identity_subject, session_id
       FROM consent_evidence
       WHERE household_id = $1 AND subject_person_id = $2
         AND source_interaction = 'protected_enrollment_accept'`,
      [syntheticLocalFamilyHousehold.householdId, syntheticLocalFamilyHousehold.personId],
    );
    expect(evidence.rows).toEqual([
      {
        actor_identity_id: 'identity-000-jordan-session-exact',
        actor_identity_issuer: 'boomerbuddy-dev',
        actor_identity_subject: 'trusted-jordan-session-exact',
        session_id: sessionId,
      },
    ]);
  });
});
