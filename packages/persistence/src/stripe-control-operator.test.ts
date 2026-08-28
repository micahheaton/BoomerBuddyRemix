import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPGliteDatabase, type Database } from './database';
import { runMigrations } from './migrations';
import { assertStripeControlOperator } from './stripe-control-operator';

describe('Stripe control operator authorization', () => {
  let database: Database;

  beforeEach(async () => {
    database = await createPGliteDatabase(':memory:');
    await runMigrations(database);
    await database.exec(
      `INSERT INTO persons(id, display_name, created_at)
       VALUES ('person-stripe-founder','Stripe Founder','2026-08-25T00:00:00.000Z');
       INSERT INTO organizations(id, name, kind, verification_state, created_at)
       VALUES (
         'organization-stripe-internal','Stripe Internal','internal','local_fixture',
         '2026-08-25T00:00:00.000Z'
       );
       INSERT INTO employee_assignments(
         id, person_id, organization_id, role, status, created_at
       ) VALUES (
         'assignment-stripe-founder','person-stripe-founder','organization-stripe-internal',
         'hq_owner','active','2026-08-25T00:00:00.000Z'
       );`,
    );
  });

  afterEach(async () => {
    await database.close();
  });

  it('requires the exact configured founder with an active internal HQ owner assignment', async () => {
    await expect(
      assertStripeControlOperator({
        executor: database,
        actorPersonId: 'person-stripe-founder',
        configuredFounderPersonId: 'person-stripe-founder',
      }),
    ).resolves.toBeUndefined();

    await expect(
      assertStripeControlOperator({
        executor: database,
        actorPersonId: 'person-stripe-founder',
        configuredFounderPersonId: 'person-other',
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });

    await database.exec(
      `UPDATE employee_assignments SET status = 'suspended'
       WHERE id = 'assignment-stripe-founder'`,
    );
    await expect(
      assertStripeControlOperator({
        executor: database,
        actorPersonId: 'person-stripe-founder',
        configuredFounderPersonId: 'person-stripe-founder',
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });
  });
});
