import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { browserHeaders, createApiHarness, hqOrigin, login, type ApiHarness } from './support';

const sunrise = 'household-sunrise';
const harbor = 'household-harbor';
const pat = 'person-protected-pat';
const terry = 'person-trusted-terry';

function operation(action: 'grant' | 'revoke', suffix: string): string {
  return `billing-authority:${action}:00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
}

describe('HQ billing-authority workflow', () => {
  let harness: ApiHarness;

  beforeEach(async () => {
    harness = await createApiHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('grants and revokes one exact member with immutable, idempotent evidence', async () => {
    const founder = await login(harness.app, 'hq-heidi', 'hq');
    const headers = browserHeaders(founder.cookie!, hqOrigin);
    const before = await harness.app.inject({
      method: 'GET',
      url: `/v1/hq/billing-authorities/${sunrise}`,
      headers,
    });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({
      authority: 'configured_founder_active_internal_owner',
      household: { id: sunrise },
      externalActionExecuted: false,
      members: expect.arrayContaining([
        expect.objectContaining({ personId: pat, authorityStatus: 'absent' }),
      ]),
    });

    const grantKey = operation('grant', '1');
    const grant = await harness.app.inject({
      method: 'POST',
      url: `/v1/hq/billing-authorities/${sunrise}/${pat}/transitions`,
      headers: { ...headers, 'idempotency-key': grantKey },
      payload: { action: 'grant', reasonCode: 'customer_billing_consent_verified' },
    });
    expect(grant.statusCode).toBe(200);
    expect(grant.json()).toMatchObject({
      householdId: sunrise,
      personId: pat,
      action: 'grant',
      previousStatus: 'absent',
      nextStatus: 'active',
      actorPersonId: 'person-hq-heidi',
      reused: false,
      externalActionExecuted: false,
    });

    const replay = await harness.app.inject({
      method: 'POST',
      url: `/v1/hq/billing-authorities/${sunrise}/${pat}/transitions`,
      headers: { ...headers, 'idempotency-key': grantKey },
      payload: { action: 'grant', reasonCode: 'customer_billing_consent_verified' },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ id: grant.json().id, reused: true });

    const afterGrant = await harness.database.query<{
      status: string;
      granted_by_person_id: string;
      grant_source: string;
      events: number;
      audits: number;
      outbox: number;
    }>(
      `SELECT authority.status, authority.granted_by_person_id, authority.grant_source,
        (SELECT count(*)::int FROM household_billing_authority_events
          WHERE operation_key = $3) AS events,
        (SELECT count(*)::int FROM audit_events
          WHERE action = 'billing_authority.granted' AND household_id = $1
            AND resource_id = $2) AS audits,
        (SELECT count(*)::int FROM outbox_events
          WHERE event_type = 'billing_authority.granted' AND household_id = $1
            AND aggregate_id = $1 || ':' || $2) AS outbox
       FROM household_billing_authorities authority
       WHERE authority.household_id = $1 AND authority.person_id = $2`,
      [sunrise, pat, grantKey],
    );
    expect(afterGrant.rows[0]).toEqual({
      status: 'active',
      granted_by_person_id: 'person-hq-heidi',
      grant_source: 'hq_operator',
      events: 1,
      audits: 1,
      outbox: 1,
    });

    const conflictingReplay = await harness.app.inject({
      method: 'POST',
      url: `/v1/hq/billing-authorities/${sunrise}/${terry}/transitions`,
      headers: { ...headers, 'idempotency-key': grantKey },
      payload: { action: 'grant', reasonCode: 'customer_billing_consent_verified' },
    });
    expect(conflictingReplay.statusCode).toBe(409);

    const revoke = await harness.app.inject({
      method: 'POST',
      url: `/v1/hq/billing-authorities/${sunrise}/${pat}/transitions`,
      headers: { ...headers, 'idempotency-key': operation('revoke', '2') },
      payload: { action: 'revoke', reasonCode: 'customer_billing_consent_withdrawn' },
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json()).toMatchObject({
      previousStatus: 'active',
      nextStatus: 'revoked',
      reused: false,
    });
    const state = await harness.database.query<{ status: string; revoked_at: unknown }>(
      `SELECT status, revoked_at FROM household_billing_authorities
       WHERE household_id = $1 AND person_id = $2`,
      [sunrise, pat],
    );
    expect(state.rows[0]?.status).toBe('revoked');
    expect(new Date(String(state.rows[0]?.revoked_at)).toISOString()).toBe(
      harness.clock.now().toISOString(),
    );

    await expect(
      harness.database.query(
        `UPDATE household_billing_authority_events SET reason_code = 'operator_correction'
         WHERE operation_key = $1`,
        [grantKey],
      ),
    ).rejects.toThrow(/append-only/iu);
    await expect(
      harness.database.query(
        'DELETE FROM household_billing_authority_events WHERE operation_key = $1',
        [grantKey],
      ),
    ).rejects.toThrow(/append-only/iu);
  });

  it('fails closed for non-founder HQ actors, cross-household targets, and audit failure', async () => {
    await harness.database.query(
      `UPDATE employee_assignments SET role = 'hq_owner'
       WHERE person_id = 'person-hq-riley'`,
    );
    const otherOwner = await login(harness.app, 'hq-riley', 'hq');
    const denied = await harness.app.inject({
      method: 'POST',
      url: `/v1/hq/billing-authorities/${sunrise}/${pat}/transitions`,
      headers: {
        ...browserHeaders(otherOwner.cookie!, hqOrigin),
        'idempotency-key': operation('grant', '3'),
      },
      payload: { action: 'grant', reasonCode: 'customer_billing_consent_verified' },
    });
    expect(denied.statusCode).toBe(403);

    const founder = await login(harness.app, 'hq-heidi', 'hq');
    const headers = browserHeaders(founder.cookie!, hqOrigin);
    const crossTenant = await harness.app.inject({
      method: 'POST',
      url: `/v1/hq/billing-authorities/${harbor}/${pat}/transitions`,
      headers: { ...headers, 'idempotency-key': operation('grant', '4') },
      payload: { action: 'grant', reasonCode: 'customer_billing_consent_verified' },
    });
    expect(crossTenant.statusCode).toBe(404);

    await harness.database.exec(`
      CREATE FUNCTION fail_billing_authority_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'billing_authority.granted'
           AND NEW.resource_id = 'person-trusted-terry' THEN
          RAISE EXCEPTION 'forced billing authority audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fail_billing_authority_audit
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION fail_billing_authority_audit();
    `);
    const failed = await harness.app.inject({
      method: 'POST',
      url: `/v1/hq/billing-authorities/${sunrise}/${terry}/transitions`,
      headers: { ...headers, 'idempotency-key': operation('grant', '5') },
      payload: { action: 'grant', reasonCode: 'customer_billing_consent_verified' },
    });
    expect(failed.statusCode).toBe(500);
    const rolledBack = await harness.database.query<{ authorities: number; events: number }>(
      `SELECT
         (SELECT count(*)::int FROM household_billing_authorities
           WHERE household_id = $1 AND person_id = $2) AS authorities,
         (SELECT count(*)::int FROM household_billing_authority_events
           WHERE household_id = $1 AND person_id = $2) AS events`,
      [sunrise, terry],
    );
    expect(rolledBack.rows[0]).toEqual({ authorities: 0, events: 0 });
  });

  it('allows the current founder to revoke after the historical HQ grantor is suspended', async () => {
    await harness.database.query(
      `UPDATE employee_assignments SET role = 'hq_owner'
       WHERE person_id = 'person-hq-riley'`,
    );
    await harness.database.query(
      `INSERT INTO household_billing_authorities(
         household_id, person_id, status, granted_by_person_id, granted_at, grant_source
       ) VALUES ($1,$2,'active','person-hq-riley',$3,'hq_operator')`,
      [sunrise, pat, harness.clock.now().toISOString()],
    );
    await harness.database.query(
      `UPDATE employee_assignments SET status = 'suspended'
       WHERE person_id = 'person-hq-riley'`,
    );

    const founder = await login(harness.app, 'hq-heidi', 'hq');
    const revoke = await harness.app.inject({
      method: 'POST',
      url: `/v1/hq/billing-authorities/${sunrise}/${pat}/transitions`,
      headers: {
        ...browserHeaders(founder.cookie!, hqOrigin),
        'idempotency-key': operation('revoke', '6'),
      },
      payload: { action: 'revoke', reasonCode: 'security_response' },
    });
    expect(revoke.statusCode, revoke.body).toBe(200);
    expect(revoke.json()).toMatchObject({
      nextStatus: 'revoked',
      actorPersonId: 'person-hq-heidi',
    });

    await expect(
      harness.database.query(
        `UPDATE household_billing_authorities
         SET granted_by_person_id = 'person-hq-heidi'
         WHERE household_id = $1 AND person_id = $2`,
        [sunrise, pat],
      ),
    ).rejects.toThrow(/cannot rewrite grant evidence/iu);
  });
});
