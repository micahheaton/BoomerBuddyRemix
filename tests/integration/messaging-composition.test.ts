import { createLogger } from '@boomerbuddy/observability';
import { MessagingRepository, SessionRepository, type Database } from '@boomerbuddy/persistence';
import { createSeededTestDatabase, fixedTestNow } from '@boomerbuddy/testkit';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../apps/api/src/app';
import { browserHeaders, hqOrigin, login, testConfig } from './support';

describe('messaging shared composition', () => {
  let database: Database | undefined;
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    for (const app of apps.splice(0).reverse()) await app.close();
    await database?.close();
    database = undefined;
  });

  it('derives self authority and source surface for local destination consent', async () => {
    const config = testConfig();
    database = await createSeededTestDatabase(fixedTestNow);
    const app = await buildApp({
      config,
      database,
      initialize: false,
      closeDatabase: false,
      now: () => fixedTestNow,
      logger: createLogger({ level: 'error', sink: () => undefined, clock: () => fixedTestNow }),
    });
    apps.push(app);
    const alice = await login(app, 'owner-alice');
    const headers = browserHeaders(alice.cookie as string);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/messaging/local/destinations',
      headers,
      payload: {
        localFixtureDestination: '+12025550177',
        timeZone: 'America/Los_Angeles',
        locale: 'en-US',
        jurisdiction: 'US',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.body).not.toContain('+12025550177');
    expect(created.json()).toMatchObject({
      destination: { evidenceTier: 'local_simulation', timeZoneKnown: true },
      status: { channel: 'sms', evidenceTier: 'local_simulation' },
      providerNetworkPermitted: false,
    });
    const destinationId = created.json<{ destination: { id: string } }>().destination.id;

    const forged = await app.inject({
      method: 'POST',
      url: `/v1/messaging/local/destinations/${encodeURIComponent(destinationId)}/consents/grant`,
      headers,
      payload: {
        purpose: 'account_service',
        disclosureVersion: 'sms-purpose-local-v1',
        policyVersion: 'messaging-local-consent-v1',
        sourceSurface: 'local_fixture',
      },
    });
    expect(forged.statusCode).toBe(400);

    const granted = await app.inject({
      method: 'POST',
      url: `/v1/messaging/local/destinations/${encodeURIComponent(destinationId)}/consents/grant`,
      headers,
      payload: {
        purpose: 'account_service',
        disclosureVersion: 'sms-purpose-local-v1',
        policyVersion: 'messaging-local-consent-v1',
      },
    });
    expect(granted.statusCode, granted.body).toBe(200);
    expect(granted.json()).toMatchObject({
      action: 'grant',
      providerNetworkPermitted: false,
      status: {
        consents: expect.arrayContaining([
          { purpose: 'account_service', state: 'active', suppressed: false },
        ]),
      },
    });
    const evidence = await database.query<{
      readonly actor_person_id: string;
      readonly source_surface: string;
    }>(
      `SELECT actor_person_id, source_surface FROM messaging_consent_evidence
       WHERE id = $1`,
      [granted.json<{ consentEvidenceId: string }>().consentEvidenceId],
    );
    expect(evidence.rows[0]).toEqual({
      actor_person_id: 'person-owner-alice',
      source_surface: 'member_web',
    });
    const stored = await database.query<{
      readonly encrypted_destination: string;
      readonly verification_state: string;
    }>(
      'SELECT encrypted_destination, verification_state FROM messaging_destinations WHERE id = $1',
      [destinationId],
    );
    expect(stored.rows[0]?.encrypted_destination).not.toContain('+12025550177');
    expect(stored.rows[0]?.verification_state).toBe('local_fixture');

    const bob = await login(app, 'owner-bob');
    const crossPerson = await app.inject({
      method: 'GET',
      url: `/v1/messaging/local/destinations/${encodeURIComponent(destinationId)}`,
      headers: browserHeaders(bob.cookie as string),
    });
    expect(crossPerson.statusCode).toBe(404);
  });

  it('returns content-free support metadata and requires the exact current JIT grant to read', async () => {
    const config = testConfig();
    database = await createSeededTestDatabase(fixedTestNow);
    const authorityResult = await database.query<{ readonly now: unknown }>(
      'SELECT clock_timestamp() AS now',
    );
    const authorityNow = new Date(String(authorityResult.rows[0]?.now));
    const messaging = new MessagingRepository(
      database,
      {
        encryptionKey: config.secrets.artifactEncryptionKey,
        encryptionKeyVersion: 1,
        fingerprintKey: config.secrets.fingerprintKey,
        fingerprintKeyVersion: 1,
      },
      undefined,
      'local',
      async () => new Date(authorityNow),
    );
    const destination = await messaging.registerLocalDestination({
      actorPersonId: 'person-owner-alice',
      personId: 'person-owner-alice',
      destination: '+12025550178',
      jurisdiction: 'US',
      locale: 'en-US',
      timeZone: 'America/Los_Angeles',
      now: authorityNow,
    });
    const eventKey = 'messaging-support-composed-001';
    const messageText = 'Please help me restore the local navigation view.';
    await messaging.recordInboundLocalFixture({
      classification: 'support',
      destinationId: destination.id,
      eventKey,
      messageText,
      now: authorityNow,
      observedAt: authorityNow,
      personId: 'person-owner-alice',
      supportCase: { householdId: 'household-sunrise', id: 'support-case-seeded-sam' },
    });
    const grantId = 'messaging-composed-grant-001';
    await database.query(
      `INSERT INTO restricted_access_grants(
         household_id, id, case_id, employee_assignment_id, resource_type,
         resource_id, purpose, assurance, status, granted_by_person_id,
         granted_at, expires_at, revoked_at
       ) VALUES (
         'household-sunrise',$1,'support-case-seeded-sam','employee-hq-sam',
         'messaging_inbound',$2,'customer_support','step_up_verified','active',
         'person-owner-alice',$3,$4,NULL
       )`,
      [
        grantId,
        eventKey,
        authorityNow.toISOString(),
        new Date(authorityNow.getTime() + 30 * 60_000).toISOString(),
      ],
    );
    const app = await buildApp({
      config,
      database,
      initialize: false,
      closeDatabase: false,
      now: () => authorityNow,
      logger: createLogger({ level: 'error', sink: () => undefined, clock: () => authorityNow }),
    });
    apps.push(app);
    const support = await login(app, 'hq-sam', 'hq');
    const sessionId = String(
      (support.body.principal as { readonly sessionId?: string } | undefined)?.sessionId,
    );
    const resolved = await new SessionRepository(database).resolve(sessionId, 'hq', authorityNow);
    expect(resolved?.principal.restrictedAccessScopes).toEqual([
      expect.objectContaining({
        grantId,
        resourceType: 'messaging_inbound',
        resourceId: eventKey,
        purpose: 'customer_support',
      }),
    ]);
    const headers = browserHeaders(support.cookie as string, hqOrigin);
    const metadata = await app.inject({
      method: 'GET',
      url: '/v1/hq/messaging/support',
      headers,
    });
    expect(metadata.statusCode, metadata.body).toBe(200);
    expect(metadata.headers['cache-control']).toContain('no-store');
    expect(metadata.body).not.toContain(messageText);
    expect(metadata.json()).toMatchObject({
      contentIncluded: false,
      items: [expect.objectContaining({ eventKey, contentState: 'encrypted_minimized' })],
    });

    const denied = await app.inject({
      method: 'POST',
      url: `/v1/hq/messaging/support/${eventKey}/read`,
      headers,
      payload: { restrictedAccessGrantId: 'messaging-composed-grant-other' },
    });
    expect(denied.statusCode).toBe(403);
    const read = await app.inject({
      method: 'POST',
      url: `/v1/hq/messaging/support/${eventKey}/read`,
      headers,
      payload: { restrictedAccessGrantId: grantId },
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.headers['cache-control']).toContain('no-store');
    expect(read.json()).toEqual({
      eventKey,
      minimizedMessage: messageText,
      evidenceTier: 'local_simulation',
      contentBoundary: 'exact_assignee_minimized_support_message',
    });

    await database.query(
      `UPDATE support_cases SET status = 'resolved', resolved_at = $1
       WHERE household_id = 'household-sunrise' AND id = 'support-case-seeded-sam'`,
      [authorityNow.toISOString()],
    );
    const afterClose = await app.inject({
      method: 'POST',
      url: `/v1/hq/messaging/support/${eventKey}/read`,
      headers,
      payload: { restrictedAccessGrantId: grantId },
    });
    expect(afterClose.statusCode).toBe(403);
  });

  it('keeps every messaging route unavailable in production', async () => {
    database = await createSeededTestDatabase(fixedTestNow);
    await expect(
      buildApp({
        config: { ...testConfig(), environment: 'production' },
        database,
        initialize: false,
        closeDatabase: false,
        now: () => fixedTestNow,
        logger: createLogger({ level: 'error', sink: () => undefined, clock: () => fixedTestNow }),
      }),
    ).rejects.toThrow('Production Clerk founder configuration is incomplete');
    const rows = await database.query<{ readonly count: number }>(
      'SELECT count(*)::int AS count FROM messaging_destinations',
    );
    expect(rows.rows[0]?.count).toBe(0);
  });
});
