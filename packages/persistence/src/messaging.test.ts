import { createSeededTestDatabase, testArtifactProtection } from '@boomerbuddy/testkit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from './database';
import { MessagingRepository } from './messaging';
import type { IdFactory } from './values';

const now = new Date('2026-08-17T19:00:00.000Z');

function ids(label: string): IdFactory {
  let sequence = 0;
  return { next: (prefix) => `${prefix}-${label}-${(sequence += 1)}` };
}

function repository(
  database: Database,
  label: string,
  runtimeEnvironment: 'local' | 'production' = 'local',
): MessagingRepository {
  return new MessagingRepository(
    database,
    testArtifactProtection(),
    ids(label),
    runtimeEnvironment,
    async (_executor, observedAt) => new Date(observedAt),
  );
}

async function registerAlice(
  messaging: MessagingRepository,
  input: { readonly destination?: string; readonly timeZone?: string } = {},
) {
  return messaging.registerLocalDestination({
    actorPersonId: 'person-owner-alice',
    personId: 'person-owner-alice',
    destination: input.destination ?? '+12025550123',
    jurisdiction: 'US',
    locale: 'en-US',
    now,
    ...(input.timeZone === undefined
      ? { timeZone: 'America/Los_Angeles' }
      : { timeZone: input.timeZone }),
  });
}

describe('provider-free consent-aware messaging repository', () => {
  let database: Database;

  beforeEach(async () => {
    database = await createSeededTestDatabase(now);
  });

  afterEach(async () => database.close());

  it('is structurally disabled outside local runtime and protects destination evidence', async () => {
    const production = repository(database, 'production-denial', 'production');
    await expect(registerAlice(production)).rejects.toMatchObject({ code: 'not_authorized' });

    const messaging = repository(database, 'protected-destination');
    await expect(
      messaging.registerLocalDestination({
        actorPersonId: 'person-owner-bob',
        personId: 'person-owner-alice',
        destination: '+12025550123',
        jurisdiction: 'US',
        locale: 'en-US',
        timeZone: 'America/Los_Angeles',
        now,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      messaging.registerLocalDestination({
        actorPersonId: 'person-owner-alice',
        personId: 'person-owner-alice',
        destination: '+12025550999',
        jurisdiction: 'US',
        locale: 'en-US',
        timeZone: 'America/Los_Angeles',
        now,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    const destination = await registerAlice(messaging);
    expect(destination).toMatchObject({
      personId: 'person-owner-alice',
      evidenceTier: 'local_simulation',
      timeZone: 'America/Los_Angeles',
    });
    const stored = await database.query<
      {
        encrypted_destination: string;
        destination_fingerprint: string;
        provider_network_permitted: boolean;
        transport_rows: number;
      } & Record<string, unknown>
    >(
      `SELECT destination.encrypted_destination, destination.destination_fingerprint,
              control.provider_network_permitted,
              (SELECT count(*)::int FROM messaging_intents
               WHERE transport_kind <> 'none') AS transport_rows
       FROM messaging_destinations destination
       CROSS JOIN messaging_local_control control
       WHERE destination.id = $1 AND control.id = 'local-simulation'`,
      [destination.id],
    );
    expect(stored.rows[0]).toMatchObject({
      provider_network_permitted: false,
      transport_rows: 0,
    });
    expect(stored.rows[0]?.encrypted_destination).not.toContain('+12025550123');
    expect(stored.rows[0]?.destination_fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    await expect(registerAlice(messaging)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rechecks consent, STOP/START suppression, scope, and bounded frequency at dispatch', async () => {
    const messaging = repository(database, 'dispatch-policy');
    const destination = await registerAlice(messaging);
    const unconsented = await messaging.createIntent({
      destinationId: destination.id,
      householdId: 'household-sunrise',
      intentId: 'messaging-intent-unconsented-001',
      now,
      purpose: 'account_service',
      recipientPersonId: 'person-owner-alice',
      scheduledAt: now,
      scope: { kind: 'household', id: 'household-sunrise' },
      templateKey: 'account.service.v1',
    });
    await expect(
      messaging.dispatchLocalSimulation({
        intentId: unconsented,
        jobId: 'messaging-job-unconsented-001',
        now,
      }),
    ).resolves.toMatchObject({
      state: 'governance_blocked',
      blockedReason: 'consent_unavailable',
      providerNetworkPermitted: false,
    });
    await expect(
      messaging.intentStatus({
        intentId: unconsented,
        recipientPersonId: 'person-owner-bob',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      messaging.intentStatus({
        intentId: unconsented,
        recipientPersonId: 'person-owner-alice',
      }),
    ).resolves.toMatchObject({
      state: 'governance_blocked',
      blockedReason: 'consent_unavailable',
      purpose: 'account_service',
      templateKey: 'account.service.v1',
      deliveryEvidenceRecorded: true,
      providerNetworkPermitted: false,
    });

    await messaging.grantConsent({
      actorPersonId: 'person-owner-alice',
      destinationId: destination.id,
      now,
      personId: 'person-owner-alice',
      purpose: 'account_service',
      sourceSurface: 'member_web',
    });
    await messaging.recordInboundLocalFixture({
      classification: 'stop',
      destinationId: destination.id,
      eventKey: 'messaging-inbound-stop-001',
      now,
      observedAt: now,
      personId: 'person-owner-alice',
    });
    const stopped = await messaging.createIntent({
      destinationId: destination.id,
      householdId: 'household-sunrise',
      intentId: 'messaging-intent-stopped-001',
      now,
      purpose: 'account_service',
      recipientPersonId: 'person-owner-alice',
      scheduledAt: now,
      scope: { kind: 'household', id: 'household-sunrise' },
      templateKey: 'account.service.v1',
    });
    await expect(
      messaging.dispatchLocalSimulation({
        intentId: stopped,
        jobId: 'messaging-job-stopped-001',
        now,
      }),
    ).resolves.toMatchObject({ state: 'governance_blocked', blockedReason: 'suppressed' });
    await messaging.recordInboundLocalFixture({
      classification: 'start',
      destinationId: destination.id,
      eventKey: 'messaging-inbound-start-001',
      now,
      observedAt: now,
      personId: 'person-owner-alice',
    });
    const messagingStatus = await messaging.status({
      personId: 'person-owner-alice',
      destinationId: destination.id,
    });
    expect(messagingStatus.channel).toBe('sms');
    expect(
      messagingStatus.consents.find(({ purpose }) => purpose === 'account_service'),
    ).toMatchObject({ state: 'active', suppressed: true });

    await messaging.grantConsent({
      actorPersonId: 'person-owner-alice',
      destinationId: destination.id,
      now,
      personId: 'person-owner-alice',
      purpose: 'account_service',
      sourceSurface: 'member_web',
    });
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      const intentId = `messaging-intent-cap-${sequence.toString().padStart(3, '0')}`;
      await messaging.createIntent({
        destinationId: destination.id,
        householdId: 'household-sunrise',
        intentId,
        now,
        purpose: 'account_service',
        recipientPersonId: 'person-owner-alice',
        scheduledAt: now,
        scope: { kind: 'household', id: 'household-sunrise' },
        templateKey: 'account.service.v1',
      });
      const result = await messaging.dispatchLocalSimulation({
        intentId,
        jobId: `messaging-job-cap-${sequence.toString().padStart(3, '0')}`,
        now,
      });
      expect(result).toMatchObject(
        sequence < 3
          ? { state: 'local_simulated', providerNetworkPermitted: false }
          : { state: 'governance_blocked', blockedReason: 'purpose_daily_limit' },
      );
    }
    const delivery = await database.query<
      {
        local_simulated: number;
        governance_blocked: number;
        network_permitted: number;
      } & Record<string, unknown>
    >(
      `SELECT
         count(*) FILTER (WHERE event_kind = 'local_simulated')::int AS local_simulated,
         count(*) FILTER (WHERE event_kind = 'governance_blocked')::int AS governance_blocked,
         count(*) FILTER (WHERE provider_network_permitted)::int AS network_permitted
       FROM messaging_delivery_events`,
    );
    expect(delivery.rows[0]).toEqual({
      local_simulated: 2,
      governance_blocked: 3,
      network_permitted: 0,
    });
    await expect(
      messaging.dispatchLocalSimulation({
        intentId: 'messaging-intent-cap-001',
        jobId: 'messaging-job-repeat-001',
        now,
      }),
    ).resolves.toMatchObject({ state: 'local_simulated' });
    expect(
      (
        await database.query<{ count: number } & Record<string, unknown>>(
          `SELECT count(*)::int AS count FROM messaging_delivery_events
           WHERE intent_id = 'messaging-intent-cap-001'`,
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

  it('honors self-withdrawal after membership revocation and never treats START as consent', async () => {
    const messaging = repository(database, 'revoked-withdrawal');
    const destination = await registerAlice(messaging);
    await messaging.grantConsent({
      actorPersonId: 'person-owner-alice',
      destinationId: destination.id,
      now,
      personId: 'person-owner-alice',
      purpose: 'fraud_safety',
      sourceSurface: 'mobile_app',
    });
    const intentId = await messaging.createIntent({
      destinationId: destination.id,
      householdId: 'household-sunrise',
      intentId: 'messaging-intent-revoked-member-001',
      now,
      purpose: 'fraud_safety',
      recipientPersonId: 'person-owner-alice',
      scheduledAt: now,
      scope: { kind: 'household', id: 'household-sunrise' },
      templateKey: 'fraud_safety.pause_verify.v1',
    });
    await database.query(
      `UPDATE household_memberships SET status = 'revoked', revoked_at = $1
       WHERE household_id = 'household-sunrise' AND person_id = 'person-owner-alice'`,
      [now.toISOString()],
    );
    await expect(
      messaging.dispatchLocalSimulation({
        intentId,
        jobId: 'messaging-job-revoked-member-001',
        now,
      }),
    ).resolves.toMatchObject({
      state: 'governance_blocked',
      blockedReason: 'recipient_unavailable',
    });
    await expect(
      messaging.withdrawConsent({
        actorPersonId: 'person-owner-alice',
        destinationId: destination.id,
        now,
        personId: 'person-owner-alice',
        purpose: 'fraud_safety',
        sourceSurface: 'mobile_app',
      }),
    ).resolves.toMatch(/^messaging-consent-/u);
    await messaging.recordInboundLocalFixture({
      classification: 'start',
      destinationId: destination.id,
      eventKey: 'messaging-inbound-revoked-start-001',
      now,
      observedAt: now,
      personId: 'person-owner-alice',
    });
    expect(
      (
        await messaging.status({
          personId: 'person-owner-alice',
          destinationId: destination.id,
        })
      ).consents.find(({ purpose }) => purpose === 'fraud_safety'),
    ).toMatchObject({ state: 'withdrawn', suppressed: true });
  });

  it('fails closed for unknown timezone, retired destination, global stop, and wrong scope/template', async () => {
    const messaging = repository(database, 'negative-policy');
    const unknownZone = await messaging.registerLocalDestination({
      actorPersonId: 'person-owner-alice',
      personId: 'person-owner-alice',
      destination: '+12025550124',
      jurisdiction: 'US',
      locale: 'en-US',
      now,
    });
    await messaging.grantConsent({
      actorPersonId: 'person-owner-alice',
      destinationId: unknownZone.id,
      now,
      personId: 'person-owner-alice',
      purpose: 'account_service',
      sourceSurface: 'local_fixture',
    });
    await messaging.createIntent({
      destinationId: unknownZone.id,
      householdId: 'household-sunrise',
      intentId: 'messaging-intent-unknown-zone-001',
      now,
      purpose: 'account_service',
      recipientPersonId: 'person-owner-alice',
      scheduledAt: now,
      scope: { kind: 'household', id: 'household-sunrise' },
      templateKey: 'account.service.v1',
    });
    await expect(
      messaging.dispatchLocalSimulation({
        intentId: 'messaging-intent-unknown-zone-001',
        jobId: 'messaging-job-unknown-zone-001',
        now,
      }),
    ).resolves.toMatchObject({
      state: 'governance_blocked',
      blockedReason: 'timezone_unknown',
    });

    const current = await registerAlice(messaging, { destination: '+12025550125' });
    await messaging.grantConsent({
      actorPersonId: 'person-owner-alice',
      destinationId: current.id,
      now,
      personId: 'person-owner-alice',
      purpose: 'account_service',
      sourceSurface: 'local_fixture',
    });
    await expect(
      messaging.createIntent({
        destinationId: current.id,
        householdId: 'household-sunrise',
        intentId: 'messaging-intent-wrong-template-001',
        now,
        purpose: 'fraud_safety',
        recipientPersonId: 'person-owner-alice',
        scheduledAt: now,
        scope: { kind: 'household', id: 'household-sunrise' },
        templateKey: 'account.service.v1',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      messaging.createIntent({
        destinationId: current.id,
        householdId: 'household-sunrise',
        intentId: 'messaging-intent-wrong-scope-001',
        now,
        purpose: 'account_service',
        recipientPersonId: 'person-owner-alice',
        scheduledAt: now,
        scope: { kind: 'support_case', id: 'support-case-seeded-sam' },
        templateKey: 'account.service.v1',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await messaging.createIntent({
      destinationId: current.id,
      householdId: 'household-sunrise',
      intentId: 'messaging-intent-global-stop-001',
      now,
      purpose: 'account_service',
      recipientPersonId: 'person-owner-alice',
      scheduledAt: now,
      scope: { kind: 'household', id: 'household-sunrise' },
      templateKey: 'account.service.v1',
    });
    await database.query(
      `UPDATE messaging_local_control SET kill_switch = true, updated_at = $1
       WHERE id = 'local-simulation'`,
      [now.toISOString()],
    );
    await expect(
      messaging.dispatchLocalSimulation({
        intentId: 'messaging-intent-global-stop-001',
        jobId: 'messaging-job-global-stop-001',
        now,
      }),
    ).resolves.toMatchObject({ state: 'governance_blocked', blockedReason: 'global_stop' });

    await database.query(
      `UPDATE messaging_local_control SET kill_switch = false, updated_at = $1
       WHERE id = 'local-simulation'`,
      [now.toISOString()],
    );
    await messaging.createIntent({
      destinationId: current.id,
      householdId: 'household-sunrise',
      intentId: 'messaging-intent-retired-destination-001',
      now,
      purpose: 'account_service',
      recipientPersonId: 'person-owner-alice',
      scheduledAt: now,
      scope: { kind: 'household', id: 'household-sunrise' },
      templateKey: 'account.service.v1',
    });
    await registerAlice(messaging, { destination: '+12025550126' });
    await expect(
      messaging.recordInboundLocalFixture({
        classification: 'start',
        destinationId: current.id,
        eventKey: 'messaging-inbound-retired-start-001',
        now,
        observedAt: now,
        personId: 'person-owner-alice',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      messaging.recordInboundLocalFixture({
        classification: 'stop',
        destinationId: current.id,
        eventKey: 'messaging-inbound-retired-stop-001',
        now,
        observedAt: now,
        personId: 'person-owner-alice',
      }),
    ).resolves.toMatchObject({ effect: 'suppressed' });
    await expect(
      messaging.dispatchLocalSimulation({
        intentId: 'messaging-intent-retired-destination-001',
        jobId: 'messaging-job-retired-destination-001',
        now,
      }),
    ).resolves.toMatchObject({
      state: 'governance_blocked',
      blockedReason: 'destination_unavailable',
    });
  });

  it('serializes cumulative frequency decisions when two workers race the final slot', async () => {
    const messaging = repository(database, 'concurrent-frequency');
    const destination = await registerAlice(messaging);
    await messaging.grantConsent({
      actorPersonId: 'person-owner-alice',
      destinationId: destination.id,
      now,
      personId: 'person-owner-alice',
      purpose: 'account_service',
      sourceSurface: 'local_fixture',
    });
    for (const sequence of [1, 2, 3]) {
      await messaging.createIntent({
        destinationId: destination.id,
        householdId: 'household-sunrise',
        intentId: `messaging-intent-race-${sequence.toString().padStart(3, '0')}`,
        now,
        purpose: 'account_service',
        recipientPersonId: 'person-owner-alice',
        scheduledAt: now,
        scope: { kind: 'household', id: 'household-sunrise' },
        templateKey: 'account.service.v1',
      });
    }
    await messaging.dispatchLocalSimulation({
      intentId: 'messaging-intent-race-001',
      jobId: 'messaging-job-race-001',
      now,
    });
    const raced = await Promise.all([
      messaging.dispatchLocalSimulation({
        intentId: 'messaging-intent-race-002',
        jobId: 'messaging-job-race-002',
        now,
      }),
      messaging.dispatchLocalSimulation({
        intentId: 'messaging-intent-race-003',
        jobId: 'messaging-job-race-003',
        now,
      }),
    ]);
    expect(raced.map(({ state }) => state).sort()).toEqual([
      'governance_blocked',
      'local_simulated',
    ]);
    expect(raced.find(({ state }) => state === 'governance_blocked')).toMatchObject({
      blockedReason: 'purpose_daily_limit',
    });
  });

  it('minimizes support content, requires exact assignment plus JIT grant, and erases on time', async () => {
    const messaging = repository(database, 'support-retention');
    const destination = await registerAlice(messaging);
    const eventKey = 'messaging-inbound-support-001';
    const messageText = 'Please help me restore the navigation view.';
    await expect(
      messaging.recordInboundLocalFixture({
        classification: 'support',
        destinationId: destination.id,
        eventKey,
        messageText,
        now,
        observedAt: now,
        personId: 'person-owner-alice',
        supportCase: {
          householdId: 'household-sunrise',
          id: 'support-case-seeded-sam',
        },
      }),
    ).resolves.toMatchObject({ effect: 'support_case_linked', duplicate: false });
    await expect(
      messaging.recordInboundLocalFixture({
        classification: 'support',
        destinationId: destination.id,
        eventKey,
        messageText,
        now,
        observedAt: now,
        personId: 'person-owner-alice',
        supportCase: {
          householdId: 'household-sunrise',
          id: 'support-case-seeded-sam',
        },
      }),
    ).resolves.toMatchObject({ effect: 'support_case_linked', duplicate: true });
    const payload = await database.query<
      { encrypted_text: string; payload_state: string } & Record<string, unknown>
    >(
      `SELECT encrypted_text, payload_state FROM messaging_inbound_payloads
       WHERE event_key = $1`,
      [eventKey],
    );
    expect(payload.rows[0]?.payload_state).toBe('encrypted_minimized');
    expect(payload.rows[0]?.encrypted_text).not.toContain(messageText);
    const earlyEraseAt = new Date(now.getTime() + 30 * 60_000);
    await expect(
      database.query(
        `INSERT INTO messaging_payload_erasure_evidence(
           id, event_key, reason, evidence_tier, erased_at
         ) VALUES (
           'messaging-early-erasure-evidence-001',$1,
           'retention_expired','local_simulation',$2
         )`,
        [eventKey, earlyEraseAt.toISOString()],
      ),
    ).rejects.toThrow(/exact due encrypted payload/iu);
    await expect(
      database.query(
        `UPDATE messaging_inbound_payloads
         SET payload_state = 'payload_erased', encrypted_text = NULL,
             encryption_key_version = NULL, content_fingerprint = NULL,
             fingerprint_key_version = NULL, erased_at = $2
         WHERE event_key = $1`,
        [eventKey, earlyEraseAt.toISOString()],
      ),
    ).rejects.toThrow(/truthful erasure/iu);
    expect(
      (
        await database.query<
          { payload_state: string; erasure_evidence: number } & Record<string, unknown>
        >(
          `SELECT payload.payload_state,
                  (SELECT count(*)::int FROM messaging_payload_erasure_evidence evidence
                   WHERE evidence.event_key = payload.event_key) AS erasure_evidence
           FROM messaging_inbound_payloads payload WHERE payload.event_key = $1`,
          [eventKey],
        )
      ).rows[0],
    ).toEqual({ payload_state: 'encrypted_minimized', erasure_evidence: 0 });
    await expect(
      messaging.listAssignedSupportMetadata({
        employeePersonId: 'person-hq-riley',
        limit: 10,
        now,
      }),
    ).resolves.toEqual([]);
    await expect(
      messaging.listAssignedSupportMetadata({
        employeePersonId: 'person-hq-sam',
        limit: 10,
        now,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        eventKey,
        householdId: 'household-sunrise',
        supportCaseId: 'support-case-seeded-sam',
        contentState: 'encrypted_minimized',
        effect: 'support_case_linked',
        evidenceTier: 'local_simulation',
      }),
    ]);

    const grantId = 'messaging-restricted-grant-001';
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
      [grantId, eventKey, now.toISOString(), new Date(now.getTime() + 30 * 60_000).toISOString()],
    );
    const wrongPurposeGrantId = 'messaging-restricted-grant-wrong-purpose-001';
    await database.query(
      `INSERT INTO restricted_access_grants(
         household_id, id, case_id, employee_assignment_id, resource_type,
         resource_id, purpose, assurance, status, granted_by_person_id,
         granted_at, expires_at, revoked_at
       ) VALUES (
         'household-sunrise',$1,'support-case-seeded-sam','employee-hq-sam',
         'messaging_inbound',$2,'unrelated_support','step_up_verified','active',
         'person-owner-alice',$3,$4,NULL
       )`,
      [
        wrongPurposeGrantId,
        eventKey,
        now.toISOString(),
        new Date(now.getTime() + 30 * 60_000).toISOString(),
      ],
    );
    await expect(
      messaging.readAssignedSupportMessage({
        employeePersonId: 'person-hq-sam',
        eventKey,
        now: new Date(now.getTime() + 5 * 60_000),
        restrictedAccessGrantId: wrongPurposeGrantId,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });
    await expect(
      messaging.readAssignedSupportMessage({
        employeePersonId: 'person-hq-riley',
        eventKey,
        now: new Date(now.getTime() + 5 * 60_000),
        restrictedAccessGrantId: grantId,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });
    await database.query(
      `UPDATE support_cases SET status = 'resolved', resolved_at = $1
       WHERE household_id = 'household-sunrise' AND id = 'support-case-seeded-sam'`,
      [new Date(now.getTime() + 2 * 60_000).toISOString()],
    );
    await expect(
      messaging.readAssignedSupportMessage({
        employeePersonId: 'person-hq-sam',
        eventKey,
        now: new Date(now.getTime() + 5 * 60_000),
        restrictedAccessGrantId: grantId,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });
    await database.query(
      `UPDATE support_cases SET status = 'open', resolved_at = NULL
       WHERE household_id = 'household-sunrise' AND id = 'support-case-seeded-sam'`,
    );
    await database.query(
      `UPDATE support_cases SET opened_by_person_id = 'person-owner-bob'
       WHERE household_id = 'household-sunrise' AND id = 'support-case-seeded-sam'`,
    );
    await expect(
      messaging.readAssignedSupportMessage({
        employeePersonId: 'person-hq-sam',
        eventKey,
        now: new Date(now.getTime() + 5 * 60_000),
        restrictedAccessGrantId: grantId,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });
    await database.query(
      `UPDATE support_cases SET opened_by_person_id = 'person-owner-alice'
       WHERE household_id = 'household-sunrise' AND id = 'support-case-seeded-sam'`,
    );
    await expect(
      messaging.readAssignedSupportMessage({
        employeePersonId: 'person-hq-sam',
        eventKey,
        now: new Date(now.getTime() + 5 * 60_000),
        restrictedAccessGrantId: grantId,
      }),
    ).resolves.toBe(messageText);
    const dueEraseAt = new Date(now.getTime() + 61 * 60_000);
    await expect(
      database.query(
        `INSERT INTO messaging_payload_erasure_evidence(
           id, event_key, reason, evidence_tier, erased_at
         ) VALUES (
           'messaging-orphan-erasure-evidence-001',$1,
           'retention_expired','local_simulation',$2
         )`,
        [eventKey, dueEraseAt.toISOString()],
      ),
    ).rejects.toThrow(/same transaction/iu);
    await expect(
      messaging.purgeExpiredSupportContent({
        limit: 10,
        now: dueEraseAt,
      }),
    ).resolves.toEqual([eventKey]);
    const erased = await database.query<
      { encrypted_text: string | null; payload_state: string; erasures: number } & Record<
        string,
        unknown
      >
    >(
      `SELECT payload.encrypted_text, payload.payload_state,
              (SELECT count(*)::int FROM messaging_payload_erasure_evidence erasure
               WHERE erasure.event_key = payload.event_key) AS erasures
       FROM messaging_inbound_payloads payload WHERE payload.event_key = $1`,
      [eventKey],
    );
    expect(erased.rows[0]).toEqual({
      encrypted_text: null,
      payload_state: 'payload_erased',
      erasures: 1,
    });
    await expect(
      messaging.readAssignedSupportMessage({
        employeePersonId: 'person-hq-sam',
        eventKey,
        now: dueEraseAt,
        restrictedAccessGrantId: grantId,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });
  });

  it('rejects forged network enablement and mutation of append-only evidence at the DB boundary', async () => {
    const messaging = repository(database, 'hostile-boundary');
    const destination = await registerAlice(messaging);
    await messaging.grantConsent({
      actorPersonId: 'person-owner-alice',
      destinationId: destination.id,
      now,
      personId: 'person-owner-alice',
      purpose: 'account_service',
      sourceSurface: 'local_fixture',
    });
    await messaging.recordInboundLocalFixture({
      classification: 'stop',
      destinationId: destination.id,
      eventKey: 'messaging-inbound-hostile-stop-001',
      now,
      observedAt: now,
      personId: 'person-owner-alice',
    });
    await expect(
      database.transaction(async (transaction) => {
        const chain = await transaction.query<
          { current_evidence_id: string; revision: number } & Record<string, unknown>
        >(
          `SELECT current_evidence_id, revision FROM messaging_suppression_chains
           WHERE person_id = 'person-owner-alice' AND purpose = 'account_service'`,
        );
        const current = chain.rows[0]!;
        await transaction.query(
          `INSERT INTO messaging_suppression_evidence(
             id, person_id, purpose, actor_person_id, action, source,
             evidence_tier, effective_at, recorded_at, supersedes_evidence_id
           ) VALUES (
             'messaging-forged-reactivate-001','person-owner-alice','account_service',
             'person-owner-alice','reactivate','recipient_settings',
             'local_simulation',$1,$1,$2
           )`,
          [now.toISOString(), current.current_evidence_id],
        );
        await transaction.query(
          `UPDATE messaging_suppression_chains
           SET current_evidence_id = 'messaging-forged-reactivate-001',
               revision = revision + 1, updated_at = $1
           WHERE person_id = 'person-owner-alice' AND purpose = 'account_service'`,
          [now.toISOString()],
        );
      }),
    ).rejects.toThrow(/semantically invalid/iu);
    const suppression = await database.query<
      { action: string; revision: number } & Record<string, unknown>
    >(
      `SELECT evidence.action, chain.revision
       FROM messaging_suppression_chains chain
       JOIN messaging_suppression_evidence evidence
         ON evidence.id = chain.current_evidence_id
       WHERE chain.person_id = 'person-owner-alice' AND chain.purpose = 'account_service'`,
    );
    expect(suppression.rows[0]).toEqual({ action: 'suppress', revision: 1 });
    await expect(
      database.query(
        `UPDATE messaging_local_control SET provider_network_permitted = true
         WHERE id = 'local-simulation'`,
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `UPDATE messaging_consent_evidence SET evidence_tier = 'provider_test'
         WHERE person_id = 'person-owner-alice' AND purpose = 'account_service'`,
      ),
    ).rejects.toThrow(/append-only/iu);
    await expect(
      database.query(
        `UPDATE messaging_consent_chains SET revision = revision + 2
         WHERE person_id = 'person-owner-alice' AND destination_id = $1
           AND purpose = 'account_service'`,
        [destination.id],
      ),
    ).rejects.toThrow(/advance/iu);
    await expect(
      database.query(`UPDATE messaging_destinations SET time_zone = 'UTC' WHERE id = $1`, [
        destination.id,
      ]),
    ).rejects.toThrow(/append-only/iu);
  });
});
