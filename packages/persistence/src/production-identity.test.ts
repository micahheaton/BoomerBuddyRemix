import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPGliteDatabase, type Database } from './database';
import { runMigrations } from './migrations';
import { ProductionIdentityRepository } from './production-identity';
import { SessionRepository } from './sessions';
import type { IdFactory } from './values';

const now = new Date('2026-08-17T12:00:00.000Z');
const customerIssuer = 'https://customer.clerk.test';
const hqIssuer = 'https://hq.clerk.test';

function sequentialIds(): IdFactory {
  let sequence = 0;
  return { next: (prefix) => `${prefix}-production-${(sequence += 1)}` };
}

describe('production identity persistence', () => {
  let database: Database;
  let ids: IdFactory;
  let identities: ProductionIdentityRepository;

  beforeEach(async () => {
    database = await createPGliteDatabase(':memory:');
    await runMigrations(database);
    ids = sequentialIds();
    identities = new ProductionIdentityRepository(database, ids);
  });

  afterEach(async () => database.close());

  it('bootstraps the exact founder once and refuses conflicts or mutable evidence', async () => {
    const first = await identities.bootstrapFounder({
      issuer: hqIssuer,
      subject: 'user_founder_exact',
      founderPersonId: 'person-founder-exact',
      correlationId: 'correlation-founder-first',
      now,
    });
    expect(first).toMatchObject({
      issuer: hqIssuer,
      subject: 'user_founder_exact',
      personId: 'person-founder-exact',
      displayName: 'BoomerBuddy Founder',
      reused: false,
    });
    await expect(
      identities.assertFounderBinding({
        issuer: hqIssuer,
        subject: 'user_founder_exact',
        founderPersonId: 'person-founder-exact',
      }),
    ).resolves.toBeUndefined();
    await expect(
      identities.bootstrapFounder({
        issuer: hqIssuer,
        subject: 'user_founder_exact',
        founderPersonId: 'person-founder-exact',
        correlationId: 'correlation-founder-replay',
        now: new Date(now.getTime() + 1_000),
      }),
    ).resolves.toMatchObject({ identityId: first.identityId, reused: true });
    await expect(
      identities.bootstrapFounder({
        issuer: hqIssuer,
        subject: 'user_different_founder',
        founderPersonId: 'person-founder-exact',
        correlationId: 'correlation-founder-conflict',
        now,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      database.query(
        `UPDATE production_founder_bootstraps SET subject = 'user_mutated'
         WHERE bootstrap_key = 'production-founder-v1'`,
      ),
    ).rejects.toThrow('immutable');
    const audit = await database.query<
      { readonly action: string; readonly actor_person_id: string } & Record<string, unknown>
    >(
      `SELECT action, actor_person_id FROM audit_events
       WHERE resource_type = 'production_founder_bootstrap'`,
    );
    expect(audit.rows).toEqual([
      { action: 'production_founder.bootstrap', actor_person_id: 'person-founder-exact' },
    ]);
  });

  it('creates one fixed-label customer household without entitlement and exposes exact lookup', async () => {
    const created = await identities.ensureCustomerBootstrap({
      issuer: customerIssuer,
      subject: 'user_customer_exact',
      now,
    });
    expect(created).toMatchObject({
      issuer: customerIssuer,
      subject: 'user_customer_exact',
      displayName: 'Founding household administrator',
    });
    if (created === null) throw new Error('Expected customer bootstrap');
    await expect(identities.findCustomerBootstrapByIdentity(created.identityId)).resolves.toEqual(
      created,
    );
    await expect(
      identities.findCustomerBootstrapBySubject({
        issuer: customerIssuer,
        subject: 'user_customer_exact',
      }),
    ).resolves.toEqual(created);
    await expect(
      identities.ensureCustomerBootstrap({
        issuer: customerIssuer,
        subject: 'user_customer_exact',
        now: new Date(now.getTime() + 1_000),
      }),
    ).resolves.toEqual(created);

    const entitlement = await database.query(
      'SELECT id FROM entitlement_grants WHERE household_id = $1',
      [created.householdId],
    );
    const protectedMember = await database.query(
      'SELECT person_id FROM protected_members WHERE household_id = $1',
      [created.householdId],
    );
    expect(entitlement.rowCount).toBe(0);
    expect(protectedMember.rowCount).toBe(0);

    await database.query(
      `INSERT INTO persons(id, display_name, created_at)
       VALUES ('person-customer-conflict','Existing identity',$1)`,
      [now.toISOString()],
    );
    await database.query(
      `INSERT INTO identities(id, person_id, issuer, subject, status, created_at)
       VALUES ('identity-customer-conflict','person-customer-conflict',$1,
               'user_customer_conflict','active',$2)`,
      [customerIssuer, now.toISOString()],
    );
    await expect(
      identities.ensureCustomerBootstrap({
        issuer: customerIssuer,
        subject: 'user_customer_conflict',
        now,
      }),
    ).resolves.toBeNull();

    await database.query('UPDATE identities SET status = $2 WHERE id = $1', [
      created.identityId,
      'disabled',
    ]);
    await expect(
      identities.findCustomerBootstrapByIdentity(created.identityId),
    ).resolves.toBeNull();
  });

  it('binds sessions to exact identity subject and provider sid, then permanently denies replay', async () => {
    const bootstrap = await identities.ensureCustomerBootstrap({
      issuer: customerIssuer,
      subject: 'user_session_exact',
      now,
    });
    if (bootstrap === null) throw new Error('Expected customer bootstrap');
    const sessions = new SessionRepository(database, ids, 'production');
    const input = {
      identityId: bootstrap.identityId,
      personId: bootstrap.personId,
      issuer: bootstrap.issuer,
      subject: bootstrap.subject,
      providerSessionId: 'sess_provider_exact',
      audience: 'customer' as const,
      issuedAt: new Date(now.getTime() - 30_000),
      expiresAt: new Date(now.getTime() + 60_000),
      now,
    };
    const resolved = await sessions.resolveProviderSession(input);
    expect(resolved).toMatchObject({
      identityId: bootstrap.identityId,
      identitySubject: bootstrap.subject,
      providerSessionId: 'sess_provider_exact',
      issuer: customerIssuer,
    });
    if (resolved === null) throw new Error('Expected provider session');

    await expect(
      sessions.resolveProviderSession({
        ...input,
        providerSessionId: 'sess_wrong_subject',
        subject: 'user_other_subject',
      }),
    ).resolves.toBeNull();
    await expect(sessions.revoke(resolved.principal.sessionId, now)).resolves.toBe(true);
    await expect(
      sessions.resolveProviderSession({
        ...input,
        expiresAt: new Date(now.getTime() + 120_000),
        now: new Date(now.getTime() + 1_000),
      }),
    ).resolves.toBeNull();
    await expect(
      database.query(
        `DELETE FROM provider_session_revocations
         WHERE issuer = $1 AND provider_session_id = $2`,
        [customerIssuer, 'sess_provider_exact'],
      ),
    ).rejects.toThrow('immutable');
  });

  it('atomically disables an exact non-founder identity and administratively revokes sessions', async () => {
    await identities.bootstrapFounder({
      issuer: hqIssuer,
      subject: 'user_disable_operator',
      founderPersonId: 'person-disable-operator',
      correlationId: 'correlation-disable-bootstrap',
      now,
    });
    const bootstrap = await identities.ensureCustomerBootstrap({
      issuer: customerIssuer,
      subject: 'user_disable_target',
      now,
    });
    if (bootstrap === null) throw new Error('Expected customer bootstrap');
    const sessions = new SessionRepository(database, ids, 'production');
    const resolved = await sessions.resolveProviderSession({
      identityId: bootstrap.identityId,
      personId: bootstrap.personId,
      issuer: bootstrap.issuer,
      subject: bootstrap.subject,
      providerSessionId: 'sess_disable_target',
      audience: 'customer',
      issuedAt: new Date(now.getTime() - 30_000),
      expiresAt: new Date(now.getTime() + 60_000),
      now,
    });
    if (resolved === null) throw new Error('Expected target session');

    await expect(
      identities.disableIdentity({
        issuer: customerIssuer,
        subject: 'user_disable_target',
        founderPersonId: 'person-disable-operator',
        correlationId: 'correlation-disable-target',
        now,
      }),
    ).resolves.toMatchObject({
      identityId: bootstrap.identityId,
      personId: bootstrap.personId,
      revokedSessionCount: 1,
      reused: false,
    });
    await expect(
      sessions.resolve(resolved.principal.sessionId, 'customer', now),
    ).resolves.toBeNull();
    await expect(
      identities.disableIdentity({
        issuer: customerIssuer,
        subject: 'user_disable_target',
        founderPersonId: 'person-disable-operator',
        correlationId: 'correlation-disable-replay',
        now,
      }),
    ).resolves.toMatchObject({ revokedSessionCount: 0, reused: true });
    await expect(
      identities.disableIdentity({
        issuer: hqIssuer,
        subject: 'user_disable_operator',
        founderPersonId: 'person-disable-operator',
        correlationId: 'correlation-disable-founder',
        now,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('allows HQ sessions only for a prebootstrapped active internal identity', async () => {
    await expect(
      identities.findActiveHqIdentity({ issuer: hqIssuer, subject: 'user_unknown_hq' }),
    ).resolves.toBeNull();
    const founder = await identities.bootstrapFounder({
      issuer: hqIssuer,
      subject: 'user_founder_hq',
      founderPersonId: 'person-founder-hq',
      correlationId: 'correlation-founder-hq',
      now,
    });
    await expect(
      identities.findActiveHqIdentity({ issuer: hqIssuer, subject: 'user_founder_hq' }),
    ).resolves.toMatchObject({ identityId: founder.identityId, personId: founder.personId });
    await database.query('UPDATE identities SET status = $2 WHERE id = $1', [
      founder.identityId,
      'disabled',
    ]);
    await expect(
      identities.findActiveHqIdentity({ issuer: hqIssuer, subject: 'user_founder_hq' }),
    ).resolves.toBeNull();
  });
});
