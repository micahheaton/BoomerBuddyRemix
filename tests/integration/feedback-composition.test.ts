import { createLogger } from '@boomerbuddy/observability';
import { FeedbackRepository, type Database } from '@boomerbuddy/persistence';
import { createSeededTestDatabase, fixedTestNow } from '@boomerbuddy/testkit';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app';
import { browserHeaders, customerOrigin, login, testConfig } from './support';

describe('feedback shared API composition', () => {
  let database: Database | undefined;
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    for (const app of apps.splice(0).reverse()) await app.close();
    await database?.close();
    database = undefined;
  });

  it('registers adapters and authenticated durable intake without purging due feedback on startup', async () => {
    const config = testConfig();
    database = await createSeededTestDatabase(fixedTestNow);
    const dueRepository = new FeedbackRepository(
      database,
      {
        encryptionKey: config.secrets.artifactEncryptionKey,
        encryptionKeyVersion: 1,
        fingerprintKey: config.secrets.fingerprintKey,
        fingerprintKeyVersion: 1,
      },
      undefined,
      async () => new Date(fixedTestNow),
    );
    const due = await dueRepository.createAuthenticated({
      householdId: 'household-sunrise',
      actorPersonId: 'person-owner-alice',
      request: {
        operationKey: 'feedback:00000000-0000-4000-8000-000000009001',
        text: 'The primary action was difficult to find in the local flow.',
        feedbackType: 'product_feedback',
        source: { surface: 'web_feedback_form', deviceClass: 'desktop' },
        link: { permitted: false },
        followUp: { granted: false },
        researchRetention: { granted: false },
      },
      correlationId: 'feedback-build-app-due-fixture',
      now: fixedTestNow,
    });
    const startupNow = new Date(fixedTestNow.getTime() + 2 * 60 * 60_000);
    const app = await buildApp({
      config,
      database,
      initialize: false,
      closeDatabase: false,
      now: () => startupNow,
      logger: createLogger({ level: 'error', sink: () => undefined, clock: () => startupNow }),
    });
    apps.push(app);

    const duePayload = await database.query<{
      readonly payload_state: string;
      readonly retention_deadline: unknown;
    }>('SELECT payload_state, retention_deadline FROM feedback_payloads WHERE feedback_id = $1', [
      due.id,
    ]);
    expect(new Date(String(duePayload.rows[0]?.retention_deadline)).getTime()).toBeLessThanOrEqual(
      startupNow.getTime(),
    );
    expect(duePayload.rows[0]?.payload_state).toBe('encrypted_minimized');

    const adapters = await app.inject({ method: 'GET', url: '/v1/feedback/adapters' });
    expect(adapters.statusCode, adapters.body).toBe(200);
    expect(adapters.json()).toMatchObject({
      evidenceTier: 'local_simulation',
      adapters: expect.arrayContaining([
        expect.objectContaining({ key: 'authenticated_text', state: 'local_only_enabled' }),
        expect.objectContaining({ key: 'external_model', state: 'structurally_disabled' }),
      ]),
    });

    const customer = await login(app, 'owner-bob', 'customer');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: {
        ...browserHeaders(customer.cookie as string),
        'x-bb-household-id': 'household-harbor',
      },
      payload: {
        operationKey: 'feedback:00000000-0000-4000-8000-000000009002',
        text: 'The selected-household navigation was useful but the label was hard to find.',
        feedbackType: 'product_feedback',
        source: { surface: 'in_app_contextual', deviceClass: 'desktop' },
        link: { permitted: false },
        followUp: { granted: false },
        researchRetention: { granted: false },
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({
      feedback: {
        status: 'queued_unassigned',
        redactionStatus: 'minimized_clean',
        evidenceTier: 'local_simulation',
        reused: false,
      },
      mediaAccepted: false,
      providerProcessed: false,
      externalActionExecuted: false,
    });
    const feedbackId = response.json<{ feedback: { id: string } }>().feedback.id;
    const durable = await database.query<{
      readonly operation_complete: boolean;
      readonly payload_state: string;
      readonly job_count: number;
    }>(
      'SELECT operation.completed_at IS NOT NULL AS operation_complete, payload.payload_state, (SELECT count(*)::int FROM feedback_processing_jobs processing WHERE processing.feedback_id = record.id) AS job_count FROM feedback_records record JOIN feedback_payloads payload ON payload.feedback_id = record.id JOIN feedback_intake_operations operation ON operation.feedback_id = record.id WHERE record.id = $1',
      [feedbackId],
    );
    expect(durable.rows[0]).toEqual({
      operation_complete: true,
      payload_state: 'encrypted_minimized',
      job_count: 4,
    });
    const dueAfterIntake = await database.query<{ readonly payload_state: string }>(
      'SELECT payload_state FROM feedback_payloads WHERE feedback_id = $1',
      [due.id],
    );
    expect(dueAfterIntake.rows[0]?.payload_state).toBe('encrypted_minimized');
  });

  it('registers the adapters in production while every intake route remains fail closed', async () => {
    const config = { ...testConfig(), environment: 'production' as const };
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

    const adapters = await app.inject({ method: 'GET', url: '/v1/feedback/adapters' });
    const intake = await app.inject({
      method: 'POST',
      url: '/v1/public/feedback',
      remoteAddress: '192.0.2.88',
      headers: { origin: customerOrigin },
      payload: {
        operationKey: 'feedback:00000000-0000-4000-8000-000000009003',
        text: 'This production-guard fixture must never persist.',
        feedbackType: 'product_feedback',
        source: { surface: 'web_feedback_form', deviceClass: 'desktop' },
        link: { permitted: false },
        followUp: { granted: false },
        researchRetention: { granted: false },
      },
    });
    expect(adapters.statusCode).toBe(200);
    expect(intake.statusCode).toBe(404);
    expect(intake.json()).toMatchObject({
      error: {
        code: 'not_found',
        message: expect.stringContaining('founder activation gates'),
      },
    });
    const persisted = await database.query<{ readonly count: number }>(
      'SELECT count(*)::int AS count FROM feedback_records WHERE correlation_id = $1',
      [intake.headers['x-request-id']],
    );
    expect(persisted.rows[0]?.count).toBe(0);
  });
});
