import { decryptField, fingerprintMinimized, parseEncryptedField } from '@boomerbuddy/security';
import { createSeededTestDatabase, fixedTestNow } from '@boomerbuddy/testkit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database, SqlExecutor } from './database';
import {
  FeedbackRepository,
  type FeedbackAuthorityClock,
  type FeedbackIntakeRequest,
  type FeedbackProtection,
} from './feedback';
import { ProductionFeedbackFoundingFixture } from './feedback-production-fixture.test-helper';
import type { IdFactory } from './values';

const encryptionKey = Buffer.alloc(32, 37);
const fingerprintKey = Buffer.alloc(32, 41);
const protection: FeedbackProtection = {
  encryptionKey,
  encryptionKeyVersion: 1,
  fingerprintKey,
  fingerprintKeyVersion: 1,
};
let databaseAuthorityNow = new Date(fixedTestNow);
const fixedAuthorityClock: FeedbackAuthorityClock = async () => new Date(databaseAuthorityNow);

function ids(): IdFactory {
  let sequence = 0;
  return { next: (prefix) => `${prefix}-feedback-test-${++sequence}` };
}

let operationSequence = 0;
function operationKey(): string {
  operationSequence += 1;
  return `feedback:00000000-0000-4000-8000-${String(operationSequence).padStart(12, '0')}`;
}

function request(overrides: Partial<FeedbackIntakeRequest> = {}): FeedbackIntakeRequest {
  return {
    operationKey: operationKey(),
    text: 'The primary action was difficult to find on the page.',
    feedbackType: 'product_feedback',
    source: {
      surface: 'web_feedback_form',
      appVersion: 'web-3.0.0',
      locale: 'en-US',
      deviceClass: 'desktop',
    },
    link: { permitted: false },
    followUp: { granted: false },
    researchRetention: { granted: false },
    ...overrides,
  };
}

describe('feedback learning repository', () => {
  let database: Database;
  let repository: FeedbackRepository;

  beforeEach(async () => {
    operationSequence = 0;
    databaseAuthorityNow = new Date(fixedTestNow);
    database = await createSeededTestDatabase(fixedTestNow);
    repository = new FeedbackRepository(database, protection, ids(), fixedAuthorityClock);
  });

  afterEach(async () => {
    await database.close();
  });

  it('irreversibly minimizes safe typed secrets before encrypted retention and queues content-free work', async () => {
    const created = await repository.createAuthenticated({
      householdId: 'household-sunrise',
      actorPersonId: 'person-owner-alice',
      request: request({
        text: 'The form asked for verification code 102345 and then the primary action was hard to find.',
        followUp: {
          granted: true,
          purpose: 'feedback_follow_up',
          consentVersion: 'feedback-follow-up-v1',
          channelClass: 'in_app',
        },
      }),
      correlationId: 'feedback-create-redaction-test',
      now: fixedTestNow,
    });

    expect(created).toMatchObject({
      status: 'queued_unassigned',
      redactionStatus: 'minimized_redacted',
      queue: 'new_feedback',
      evidenceTier: 'local_simulation',
      reused: false,
      mediaAccepted: false,
      providerProcessed: false,
      externalActionExecuted: false,
    });
    const payload = await database.query<{
      encrypted_text: string;
      detected_classes: unknown;
    }>(`SELECT encrypted_text, detected_classes FROM feedback_payloads WHERE feedback_id = $1`, [
      created.id,
    ]);
    const serialized = payload.rows[0]?.encrypted_text;
    expect(serialized).toBeDefined();
    expect(serialized).not.toContain('102345');
    const plaintext = decryptField(parseEncryptedField(serialized as string), encryptionKey, {
      tenantId: 'household-sunrise',
      resourceId: created.id,
      field: 'minimized_text',
      schemaVersion: 1,
      keyVersion: 1,
    }).toString('utf8');
    expect(plaintext).toContain('[ONE_TIME_CODE]');
    expect(plaintext).not.toContain('102345');
    expect(payload.rows[0]?.detected_classes).toEqual(['one_time_code']);

    const jobs = await database.query<{
      job_type: string;
      payload: unknown;
      classification: string;
    }>(
      `SELECT job_type, payload, classification FROM durable_jobs
       WHERE id IN (SELECT durable_job_id FROM feedback_processing_jobs WHERE feedback_id = $1)
       ORDER BY job_type`,
      [created.id],
    );
    expect(jobs.rows).toHaveLength(4);
    expect(jobs.rows.every((job) => job.classification === 'confidential')).toBe(true);
    expect(JSON.stringify(jobs.rows)).not.toMatch(/102345|primary action|encrypted_text/iu);
    expect(JSON.stringify(jobs.rows)).toContain('localOnly');

    const queue = await repository.roleScopedMetadata({
      actorPersonId: 'person-hq-heidi',
      correlationId: 'feedback-founder-queue-test',
      now: fixedTestNow,
    });
    expect(queue).toEqual([
      expect.objectContaining({
        id: created.id,
        identityMode: 'authenticated',
        status: 'minimized',
        classification: 'unclassified',
        queue: 'new_feedback',
        routingState: 'unassigned',
        followUpConsented: true,
        contentReadAuthorized: false,
        selfClaimAvailable: true,
      }),
    ]);
    expect(JSON.stringify(queue)).not.toMatch(/primary action|102345|cipher/iu);
    await expect(
      repository.readAssignedMinimizedText({
        feedbackId: created.id,
        actorPersonId: 'person-hq-heidi',
        correlationId: 'feedback-owner-read-before-claim',
        now: fixedTestNow,
      }),
    ).rejects.toThrow('unavailable');
    const claim = await repository.claimForReview({
      feedbackId: created.id,
      actorPersonId: 'person-hq-heidi',
      correlationId: 'feedback-owner-exact-self-claim',
      now: fixedTestNow,
    });
    expect(claim).toMatchObject({
      feedbackId: created.id,
      queue: 'new_feedback',
      routingState: 'assigned',
      assignmentVersion: 2,
      humanReviewRequired: true,
      reused: false,
      evidenceTier: 'local_simulation',
      externalActionExecuted: false,
    });
    await expect(
      repository.claimForReview({
        feedbackId: created.id,
        actorPersonId: 'person-hq-heidi',
        correlationId: 'feedback-owner-exact-self-claim-retry',
        now: fixedTestNow,
      }),
    ).resolves.toMatchObject({ assignmentVersion: 2, reused: true });
    const content = await repository.readAssignedMinimizedText({
      feedbackId: created.id,
      actorPersonId: 'person-hq-heidi',
      correlationId: 'feedback-owner-exact-content-read',
      now: fixedTestNow,
    });
    expect(content).toMatchObject({
      feedbackId: created.id,
      redactionStatus: 'minimized_redacted',
      contentBoundary: 'assigned_minimized_text',
      evidenceTier: 'local_simulation',
      externalActionExecuted: false,
    });
    expect(content.minimizedText).toContain('[ONE_TIME_CODE]');
    expect(content.minimizedText).not.toContain('102345');
    const readAudit = await database.query<{ metadata: unknown }>(
      `SELECT metadata FROM audit_events
       WHERE action = 'feedback.content.read' AND resource_id = $1`,
      [created.id],
    );
    expect(readAudit.rows).toEqual([
      {
        metadata: {
          projection: 'exact_assigned_minimized_text',
          purpose: 'feedback_triage',
          redactionStatus: 'minimized_redacted',
          deterministicRedactionVerification: 'passed',
          providerProcessed: false,
          externalActionExecuted: false,
        },
      },
    ]);
    expect(JSON.stringify(readAudit.rows)).not.toMatch(/102345|primary action/iu);
    await expect(
      repository.roleScopedMetadata({
        actorPersonId: 'person-hq-riley',
        correlationId: 'feedback-unassigned-reviewer-test',
        now: fixedTestNow,
      }),
    ).resolves.toEqual([]);
  });

  it('keeps live authenticated feedback tenant-bound and visible only through the live founder review path', async () => {
    const founding = await ProductionFeedbackFoundingFixture.create(database, fixedTestNow);
    const enrollee = await founding.enroll('review-path');
    const created = await repository.createAuthenticated({
      householdId: enrollee.householdId,
      actorPersonId: enrollee.actorPersonId,
      request: request({
        text: 'The Check explanation was difficult to understand.',
        followUp: {
          granted: true,
          purpose: 'feedback_follow_up',
          consentVersion: 'feedback-follow-up-v1',
          channelClass: 'in_app',
        },
      }),
      correlationId: 'feedback-live-production-create',
      evidenceTier: 'live_production',
      now: fixedTestNow,
    });
    expect(created).toMatchObject({
      status: 'queued_unassigned',
      evidenceTier: 'live_production',
      providerProcessed: false,
      externalActionExecuted: false,
    });

    const lineage = await database.query<{
      record_tier: string;
      state_tiers: unknown;
      processing_tiers: unknown;
    }>(
      `SELECT record.evidence_tier AS record_tier,
              (SELECT jsonb_agg(DISTINCT state.evidence_tier)
               FROM feedback_state_events state
               WHERE state.feedback_id = record.id) AS state_tiers,
              (SELECT jsonb_agg(DISTINCT processing.evidence_tier)
               FROM feedback_processing_jobs processing
               WHERE processing.feedback_id = record.id) AS processing_tiers
       FROM feedback_records record WHERE record.id = $1`,
      [created.id],
    );
    expect(lineage.rows[0]).toEqual({
      record_tier: 'live_production',
      state_tiers: ['live_production'],
      processing_tiers: ['live_production'],
    });

    await expect(
      repository.roleScopedMetadata({
        actorPersonId: 'person-hq-heidi',
        correlationId: 'feedback-live-hidden-from-local-projection',
        evidenceTier: 'local_simulation',
        now: fixedTestNow,
      }),
    ).resolves.toEqual([]);
    await expect(
      repository.roleScopedMetadata({
        actorPersonId: 'person-hq-riley',
        correlationId: 'feedback-live-reviewer-unassigned-denied',
        evidenceTier: 'live_production',
        now: fixedTestNow,
      }),
    ).resolves.toEqual([]);
    await expect(
      repository.claimForReview({
        feedbackId: created.id,
        actorPersonId: 'person-hq-heidi',
        correlationId: 'feedback-live-wrong-tier-claim',
        evidenceTier: 'local_simulation',
        now: fixedTestNow,
      }),
    ).rejects.toThrow(/unavailable/iu);
    await expect(
      repository.claimForReview({
        feedbackId: 'feedback-guessed-production-id',
        actorPersonId: 'person-hq-heidi',
        correlationId: 'feedback-live-guessed-claim',
        evidenceTier: 'live_production',
        now: fixedTestNow,
      }),
    ).rejects.toThrow(/unavailable/iu);

    const queue = await repository.roleScopedMetadata({
      actorPersonId: 'person-hq-heidi',
      correlationId: 'feedback-live-founder-queue',
      evidenceTier: 'live_production',
      now: fixedTestNow,
    });
    expect(queue).toEqual([
      expect.objectContaining({
        id: created.id,
        householdId: enrollee.householdId,
        evidenceTier: 'live_production',
        selfClaimAvailable: true,
        contentReadAuthorized: false,
      }),
    ]);
    await repository.claimForReview({
      feedbackId: created.id,
      actorPersonId: 'person-hq-heidi',
      correlationId: 'feedback-live-founder-claim',
      evidenceTier: 'live_production',
      now: fixedTestNow,
    });
    await expect(
      repository.readAssignedMinimizedText({
        feedbackId: created.id,
        actorPersonId: 'person-hq-riley',
        correlationId: 'feedback-live-wrong-role-read',
        evidenceTier: 'live_production',
        now: fixedTestNow,
      }),
    ).rejects.toThrow(/unavailable/iu);
    await expect(
      repository.readAssignedMinimizedText({
        feedbackId: 'feedback-guessed-production-id',
        actorPersonId: 'person-hq-heidi',
        correlationId: 'feedback-live-guessed-read',
        evidenceTier: 'live_production',
        now: fixedTestNow,
      }),
    ).rejects.toThrow(/unavailable/iu);
    await expect(
      repository.readAssignedMinimizedText({
        feedbackId: created.id,
        actorPersonId: 'person-hq-heidi',
        correlationId: 'feedback-live-founder-read',
        evidenceTier: 'live_production',
        now: fixedTestNow,
      }),
    ).resolves.toMatchObject({
      feedbackId: created.id,
      minimizedText: 'The Check explanation was difficult to understand.',
      evidenceTier: 'live_production',
      externalActionExecuted: false,
    });

    for (const hostileScope of [
      { householdId: 'household-harbor', actorPersonId: enrollee.actorPersonId },
      { householdId: enrollee.householdId, actorPersonId: 'person-protected-pat' },
    ]) {
      await expect(
        repository.withdrawAuthenticatedConsent({
          feedbackId: created.id,
          ...hostileScope,
          purpose: 'follow_up',
          correlationId: `feedback-live-hostile-withdraw-${hostileScope.householdId}`,
          evidenceTier: 'live_production',
          now: new Date(fixedTestNow.getTime() + 30_000),
        }),
      ).rejects.toThrow(/authority/iu);
    }
    await expect(
      repository.withdrawAuthenticatedConsent({
        feedbackId: created.id,
        householdId: enrollee.householdId,
        actorPersonId: enrollee.actorPersonId,
        purpose: 'follow_up',
        correlationId: 'feedback-live-exact-withdraw',
        evidenceTier: 'live_production',
        now: new Date(fixedTestNow.getTime() + 30_000),
      }),
    ).resolves.toEqual({ withdrawn: true, activeStoreCiphertextErased: true });
    await expect(
      repository.readAssignedMinimizedText({
        feedbackId: created.id,
        actorPersonId: 'person-hq-heidi',
        correlationId: 'feedback-live-read-after-withdrawal',
        evidenceTier: 'live_production',
        now: new Date(fixedTestNow.getTime() + 30_000),
      }),
    ).rejects.toThrow(/unavailable/iu);
  });

  it('quarantines every submitted reserved placeholder before minimization without retaining the submitted span', async () => {
    const cases = [
      { placeholder: '[PAYMENT_CARD]', className: 'payment_card', marker: 'RAW-CARD-MARKER' },
      {
        placeholder: '[AUTH_CREDENTIAL]',
        className: 'authorization_credential',
        marker: 'RAW-AUTH-MARKER',
      },
      {
        placeholder: '[ONE_TIME_CODE]',
        className: 'one_time_code',
        marker: 'RAW-OTP-MARKER',
      },
    ] as const;
    for (const candidate of cases) {
      const created = await repository.createAuthenticated({
        householdId: 'household-sunrise',
        actorPersonId: 'person-owner-alice',
        request: request({
          text: `${candidate.marker} ${candidate.placeholder} SUBMITTED-PLACEHOLDER-TAIL`,
        }),
        correlationId: `feedback-raw-placeholder-${candidate.className}`,
        now: fixedTestNow,
      });
      expect(created).toMatchObject({
        status: 'unsafe_unprocessable',
        redactionStatus: 'quarantined_discarded',
        queue: 'privacy_security',
      });
      const payload = await database.query<{
        readonly encrypted_text: string | null;
        readonly detected_classes: unknown;
      }>(
        `SELECT encrypted_text, detected_classes
         FROM feedback_payloads WHERE feedback_id = $1`,
        [created.id],
      );
      expect(payload.rows[0]?.encrypted_text).toBeNull();
      expect(payload.rows[0]?.detected_classes).toContain(candidate.className);
    }

    const retained = await Promise.all(
      [
        'feedback_records',
        'feedback_payloads',
        'feedback_intake_operations',
        'feedback_state_events',
        'feedback_assignment_events',
        'feedback_processing_jobs',
        'durable_jobs',
        'audit_events',
      ].map((table) => database.query(`SELECT to_jsonb(row) AS row FROM ${table} row`)),
    );
    const serialized = JSON.stringify(retained.flatMap((result) => result.rows));
    for (const candidate of cases) {
      expect(serialized).not.toContain(candidate.placeholder);
      expect(serialized).not.toContain(candidate.marker);
    }
    expect(serialized).not.toContain('SUBMITTED-PLACEHOLDER-TAIL');
  });

  it('revokes readable metadata and assigned content after a direct restricted state', async () => {
    const created = await repository.createAuthenticated({
      householdId: 'household-sunrise',
      actorPersonId: 'person-owner-alice',
      request: request(),
      correlationId: 'feedback-readable-state-create',
      now: fixedTestNow,
    });
    await repository.claimForReview({
      feedbackId: created.id,
      actorPersonId: 'person-hq-heidi',
      correlationId: 'feedback-readable-state-claim',
      now: fixedTestNow,
    });
    const prior = await database.query<{
      version: number;
      to_status: string;
      severity: string;
      classification: string;
      close_loop_state: string;
    }>(
      `SELECT version, to_status, severity, classification, close_loop_state
       FROM feedback_state_events WHERE feedback_id = $1 ORDER BY version DESC LIMIT 1`,
      [created.id],
    );
    const state = prior.rows[0]!;
    await database.query(
      `INSERT INTO feedback_state_events(
         id, feedback_id, version, from_status, to_status, severity, classification,
         close_loop_state, reason_code, actor_kind, actor_person_id, evidence_tier, occurred_at
       ) VALUES ('feedback-state-direct-restricted',$1,$2,$3,'restricted',$4,$5,$6,
         'owner_restricted_after_claim','hq','person-hq-heidi','local_simulation',$7)`,
      [
        created.id,
        state.version + 1,
        state.to_status,
        state.severity,
        state.classification,
        state.close_loop_state,
        fixedTestNow.toISOString(),
      ],
    );
    await expect(
      repository.roleScopedMetadata({
        actorPersonId: 'person-hq-heidi',
        correlationId: 'feedback-readable-state-restricted-metadata',
        now: fixedTestNow,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        status: 'restricted',
        contentReadAuthorized: false,
        selfClaimAvailable: false,
      }),
    ]);
    await expect(
      repository.readAssignedMinimizedText({
        feedbackId: created.id,
        actorPersonId: 'person-hq-heidi',
        correlationId: 'feedback-readable-state-restricted-content',
        now: fixedTestNow,
      }),
    ).rejects.toThrow('unavailable');
  });

  it('rechecks the latest state after record locks before releasing assigned content', async () => {
    const created = await repository.createAuthenticated({
      householdId: 'household-sunrise',
      actorPersonId: 'person-owner-alice',
      request: request(),
      correlationId: 'feedback-readable-race-create',
      now: fixedTestNow,
    });
    await repository.claimForReview({
      feedbackId: created.id,
      actorPersonId: 'person-hq-heidi',
      correlationId: 'feedback-readable-race-claim',
      now: fixedTestNow,
    });
    let restrictionInjected = false;
    const racingDatabase: Database = {
      kind: database.kind,
      query: <Row extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]) =>
        database.query<Row>(sql, parameters),
      exec: (sql) => database.exec(sql),
      close: () => database.close(),
      transaction: (work) =>
        database.transaction((transaction) => {
          const racing: SqlExecutor = {
            query: async <Row extends Record<string, unknown>>(
              sql: string,
              parameters?: readonly unknown[],
            ) => {
              if (!restrictionInjected && sql.includes('SELECT state_event.to_status')) {
                restrictionInjected = true;
                const prior = await transaction.query<
                  {
                    version: number;
                    to_status: string;
                    severity: string;
                    classification: string;
                    close_loop_state: string;
                  } & Record<string, unknown>
                >(
                  `SELECT version, to_status, severity, classification, close_loop_state
                   FROM feedback_state_events WHERE feedback_id = $1
                   ORDER BY version DESC LIMIT 1`,
                  [created.id],
                );
                const state = prior.rows[0]!;
                await transaction.query(
                  `INSERT INTO feedback_state_events(
                     id, feedback_id, version, from_status, to_status, severity, classification,
                     close_loop_state, reason_code, actor_kind, actor_person_id,
                     evidence_tier, occurred_at
                   ) VALUES ('feedback-state-race-restricted',$1,$2,$3,'restricted',$4,$5,$6,
                     'owner_restricted_during_read','hq','person-hq-heidi',
                     'local_simulation',$7)`,
                  [
                    created.id,
                    state.version + 1,
                    state.to_status,
                    state.severity,
                    state.classification,
                    state.close_loop_state,
                    fixedTestNow.toISOString(),
                  ],
                );
              }
              return transaction.query<Row>(sql, parameters);
            },
            exec: (sql) => transaction.exec(sql),
          };
          return work(racing);
        }),
    };
    const racingRepository = new FeedbackRepository(
      racingDatabase,
      protection,
      ids(),
      fixedAuthorityClock,
    );
    await expect(
      racingRepository.readAssignedMinimizedText({
        feedbackId: created.id,
        actorPersonId: 'person-hq-heidi',
        correlationId: 'feedback-readable-race-content',
        now: fixedTestNow,
      }),
    ).rejects.toThrow('unavailable');
    expect(restrictionInjected).toBe(true);
    const readAudit = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_events
       WHERE action = 'feedback.content.read' AND resource_id = $1`,
      [created.id],
    );
    expect(readAudit.rows[0]?.count).toBe(0);
  });

  it('redacts payment cards and explicit credentials before encryption and quarantines ambiguous credentials', async () => {
    const generatedCard = ['4242', '4242', '4242', '4242'].join(' ');
    const generatedCredential = ['Authorization:', 'Bearer', 'generated_feedback_value_123'].join(
      ' ',
    );
    const created = await repository.createAuthenticated({
      householdId: 'household-sunrise',
      actorPersonId: 'person-owner-alice',
      request: request({
        text: `The report included ${generatedCard} and ${generatedCredential}; the Continue action remained hidden.`,
      }),
      correlationId: 'feedback-card-credential-redaction',
      now: fixedTestNow,
    });
    const payload = await database.query<{
      encrypted_text: string;
      detected_classes: unknown;
    }>('SELECT encrypted_text, detected_classes FROM feedback_payloads WHERE feedback_id = $1', [
      created.id,
    ]);
    const serialized = payload.rows[0]?.encrypted_text;
    const plaintext = decryptField(parseEncryptedField(serialized as string), encryptionKey, {
      tenantId: 'household-sunrise',
      resourceId: created.id,
      field: 'minimized_text',
      schemaVersion: 1,
      keyVersion: 1,
    }).toString('utf8');
    expect(plaintext).toContain('[PAYMENT_CARD]');
    expect(plaintext).toContain('[AUTH_CREDENTIAL]');
    expect(plaintext).not.toContain(generatedCard);
    expect(plaintext).not.toContain(generatedCredential);
    expect(payload.rows[0]?.detected_classes).toEqual(['payment_card', 'authorization_credential']);

    const ambiguousCredential = ['ghp', '_', 'A'.repeat(24)].join('');
    const quarantined = await repository.createAuthenticated({
      householdId: 'household-sunrise',
      actorPersonId: 'person-owner-alice',
      request: request({
        text: `The pasted diagnostic contained ${ambiguousCredential}; the Continue action remained hidden.`,
      }),
      correlationId: 'feedback-ambiguous-credential-quarantine',
      now: fixedTestNow,
    });
    expect(quarantined).toMatchObject({
      status: 'unsafe_unprocessable',
      redactionStatus: 'quarantined_discarded',
      queue: 'privacy_security',
    });
    const quarantine = await database.query<{
      encrypted_text: string | null;
      detected_classes: unknown;
    }>('SELECT encrypted_text, detected_classes FROM feedback_payloads WHERE feedback_id = $1', [
      quarantined.id,
    ]);
    expect(quarantine.rows[0]).toEqual({
      encrypted_text: null,
      detected_classes: ['authorization_credential'],
    });
    expect(JSON.stringify(quarantine.rows[0])).not.toContain(ambiguousCredential);
  });

  it('redacts an entire explicitly labelled credential or discards the payload without retaining any span', async () => {
    const cases = [
      {
        marker: 'HASH-ALPHA#QUERY-BRAVO?COLON-CHARLIE:TAIL-DELTA',
        text: 'Password: HASH-ALPHA#QUERY-BRAVO?COLON-CHARLIE:TAIL-DELTA\nThe action was hidden.',
        accepted: true,
      },
      {
        marker: 'QUOTED-ALPHA secret space QUOTED-OMEGA',
        text: 'Password: "QUOTED-ALPHA secret space QUOTED-OMEGA" and the action was hidden.',
        accepted: true,
      },
      {
        marker: 'PASSWORD-IS-ALPHA?PASSWORD-IS-OMEGA',
        text: 'Password is PASSWORD-IS-ALPHA?PASSWORD-IS-OMEGA\nThe action was hidden.',
        accepted: true,
      },
      {
        marker: 'BARE-BEARER-ALPHA#BARE-BEARER-OMEGA',
        text: 'Bearer BARE-BEARER-ALPHA#BARE-BEARER-OMEGA\nThe action was hidden.',
        accepted: true,
      },
      {
        marker: 'https://feedback.invalid/path?opaque=URL-ALPHA#URL-OMEGA',
        text: 'Access token: https://feedback.invalid/path?opaque=URL-ALPHA#URL-OMEGA',
        accepted: true,
      },
      {
        marker: '密碼-UNICODE-ALPHA-終-UNICODE-OMEGA',
        text: 'Passcode: 密碼-UNICODE-ALPHA-終-UNICODE-OMEGA',
        accepted: true,
      },
      {
        marker: 'AMBIGUOUS-ALPHA secret-space AMBIGUOUS-OMEGA',
        text: 'Password is AMBIGUOUS-ALPHA secret-space AMBIGUOUS-OMEGA',
        accepted: false,
      },
    ] as const;

    for (const [index, candidate] of cases.entries()) {
      const created = await repository.createAuthenticated({
        householdId: 'household-sunrise',
        actorPersonId: 'person-owner-alice',
        request: request({ text: candidate.text }),
        correlationId: `feedback-explicit-credential-${index}`,
        now: fixedTestNow,
      });
      const payload = await database.query<{
        encrypted_text: string | null;
        detected_classes: unknown;
      }>('SELECT encrypted_text, detected_classes FROM feedback_payloads WHERE feedback_id = $1', [
        created.id,
      ]);
      if (candidate.accepted) {
        expect(created.redactionStatus).toBe('minimized_redacted');
        const serialized = payload.rows[0]?.encrypted_text;
        expect(serialized).toBeDefined();
        const plaintext = decryptField(parseEncryptedField(serialized as string), encryptionKey, {
          tenantId: 'household-sunrise',
          resourceId: created.id,
          field: 'minimized_text',
          schemaVersion: 1,
          keyVersion: 1,
        }).toString('utf8');
        expect(plaintext).toContain('[AUTH_CREDENTIAL]');
        for (const span of candidate.marker
          .split(/[\s#?:/]+/u)
          .filter((part) => part.length >= 8)) {
          expect(plaintext).not.toContain(span);
        }
      } else {
        expect(created).toMatchObject({
          status: 'unsafe_unprocessable',
          redactionStatus: 'quarantined_discarded',
          queue: 'privacy_security',
        });
        expect(payload.rows[0]?.encrypted_text).toBeNull();
      }
      expect(payload.rows[0]?.detected_classes).toContain('authorization_credential');
    }

    const retained = await database.query<{ retained: string }>(
      `SELECT COALESCE(string_agg(
         COALESCE(payload.encrypted_text, '') || payload.detected_classes::text
         || payload.redaction_counts::text || operation.request_digest
         || COALESCE(job.payload::text, ''), ''), '') AS retained
       FROM feedback_payloads payload
       JOIN feedback_intake_operations operation ON operation.feedback_id = payload.feedback_id
       LEFT JOIN feedback_processing_jobs processing ON processing.feedback_id = payload.feedback_id
       LEFT JOIN durable_jobs job ON job.id = processing.durable_job_id`,
    );
    for (const candidate of cases) {
      for (const span of candidate.marker.split(/[\s#?:/]+/u).filter((part) => part.length >= 8)) {
        expect(retained.rows[0]?.retained).not.toContain(span);
      }
    }
  });

  it('accepts customer and anonymous feedback without an active internal owner', async () => {
    await database.query(
      `UPDATE employee_assignments SET status = 'suspended'
       WHERE role = 'hq_owner' AND status = 'active'`,
    );
    const authenticated = await repository.createAuthenticated({
      householdId: 'household-sunrise',
      actorPersonId: 'person-owner-alice',
      request: request(),
      correlationId: 'feedback-no-owner-authenticated',
      now: fixedTestNow,
    });
    const anonymous = await repository.createAnonymous({
      networkAddress: '203.0.113.22',
      request: request(),
      correlationId: 'feedback-no-owner-anonymous',
      now: fixedTestNow,
    });
    expect(authenticated.status).toBe('queued_unassigned');
    expect(anonymous.status).toBe('queued_unassigned');
    const routing = await database.query<{
      routing_state: string;
      employee_assignment_id: string | null;
      assigned_by_person_id: string | null;
      service_key: string | null;
    }>(
      `SELECT routing_state, employee_assignment_id, assigned_by_person_id, service_key
       FROM feedback_assignment_events ORDER BY feedback_id`,
    );
    expect(routing.rows).toEqual([
      {
        routing_state: 'unassigned',
        employee_assignment_id: null,
        assigned_by_person_id: null,
        service_key: 'feedback.local_router',
      },
      {
        routing_state: 'unassigned',
        employee_assignment_id: null,
        assigned_by_person_id: null,
        service_key: 'feedback.local_router',
      },
    ]);
  });

  it('holds delegated assignment, organization, support, and record locks through audit', async () => {
    const created = await repository.convertSupportCase({
      householdId: 'household-sunrise',
      supportCaseId: 'support-case-seeded-sam',
      actorPersonId: 'person-hq-sam',
      request: {
        operationKey: operationKey(),
        text: 'The customer reported a difficult navigation step.',
        feedbackType: 'accessibility_issue',
        source: { surface: 'support_conversion', deviceClass: 'desktop' },
      },
      correlationId: 'feedback-lock-order-create',
      now: fixedTestNow,
    });
    const statements: string[] = [];
    const observedDatabase: Database = {
      kind: database.kind,
      query: <Row extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]) =>
        database.query<Row>(sql, parameters),
      exec: (sql) => database.exec(sql),
      close: () => database.close(),
      transaction: (work) =>
        database.transaction((transaction) => {
          const observed: SqlExecutor = {
            query: <Row extends Record<string, unknown>>(
              sql: string,
              parameters?: readonly unknown[],
            ) => {
              statements.push(sql);
              return transaction.query<Row>(sql, parameters);
            },
            exec: (sql) => transaction.exec(sql),
          };
          return work(observed);
        }),
    };
    const observedRepository = new FeedbackRepository(
      observedDatabase,
      protection,
      ids(),
      fixedAuthorityClock,
    );
    await expect(
      observedRepository.roleScopedMetadata({
        actorPersonId: 'person-hq-sam',
        correlationId: 'feedback-lock-order-read',
        now: fixedTestNow,
      }),
    ).resolves.toEqual([expect.objectContaining({ id: created.id })]);
    const internalLock = statements.findIndex(
      (sql) =>
        sql.includes('SELECT employee.id, employee.role') &&
        sql.includes('FOR UPDATE OF employee, organization'),
    );
    const reviewMutex = statements.findIndex(
      (sql) => sql.includes('feedback_review_concurrency_mutex') && sql.includes('FOR UPDATE'),
    );
    const supportLock = statements.findIndex(
      (sql) =>
        sql.includes('SELECT support_case.id') &&
        sql.includes('FOR UPDATE OF support_case, support_assignment, employee, organization'),
    );
    const recordLock = statements.findIndex(
      (sql) => sql.includes('SELECT record.id') && sql.includes('FOR UPDATE OF record'),
    );
    const projection = statements.findIndex((sql) => sql.includes('AS content_read_authorized'));
    const audit = statements.findIndex((sql) => sql.includes("'feedback.queue.read'"));
    expect(
      [reviewMutex, recordLock, internalLock, supportLock, projection, audit].every(
        (index) => index >= 0,
      ),
    ).toBe(true);
    expect(reviewMutex).toBeLessThan(recordLock);
    expect(recordLock).toBeLessThan(internalLock);
    expect(internalLock).toBeLessThan(supportLock);
    expect(supportLock).toBeLessThan(projection);
    expect(projection).toBeLessThan(audit);
  });

  it('discards private-key text while retaining typed quarantine metadata only', async () => {
    const secretMarker = 'PRIVATE-FEEDBACK-MARKER-DO-NOT-RETAIN';
    const requestedResearchDeadline = new Date(
      fixedTestNow.getTime() + 60 * 60 * 1_000,
    ).toISOString();
    const created = await repository.createAuthenticated({
      householdId: 'household-sunrise',
      actorPersonId: 'person-owner-alice',
      request: request({
        text: `I accidentally pasted this:\n-----BEGIN PRIVATE KEY-----\n${secretMarker}\n-----END PRIVATE KEY-----`,
        researchRetention: {
          granted: true,
          purpose: 'product_feedback_research',
          consentVersion: 'feedback-research-v1',
          retainUntil: requestedResearchDeadline,
        },
      }),
      correlationId: 'feedback-private-key-quarantine',
      now: fixedTestNow,
    });
    expect(created).toMatchObject({
      status: 'unsafe_unprocessable',
      queue: 'privacy_security',
      redactionStatus: 'quarantined_discarded',
    });
    const facts = await database.query<{
      encrypted_text: string | null;
      detected_classes: unknown;
      jobs: number;
      all_job_payloads: string;
    }>(
      `SELECT payload.encrypted_text, payload.detected_classes,
              (SELECT count(*)::int FROM feedback_processing_jobs job
               WHERE job.feedback_id = payload.feedback_id) AS jobs,
              (SELECT COALESCE(string_agg(durable.payload::text, ''), '')
               FROM durable_jobs durable
               WHERE durable.id IN (SELECT job.durable_job_id FROM feedback_processing_jobs job
                 WHERE job.feedback_id = payload.feedback_id)) AS all_job_payloads
       FROM feedback_payloads payload WHERE payload.feedback_id = $1`,
      [created.id],
    );
    expect(facts.rows[0]).toMatchObject({
      encrypted_text: null,
      detected_classes: ['private_key'],
      jobs: 1,
    });
    expect(JSON.stringify(facts.rows[0])).not.toContain(secretMarker);
    const operation = await database.query<{ operation: string }>(
      `SELECT row_to_json(operation)::text AS operation FROM feedback_intake_operations operation
       WHERE feedback_id = $1`,
      [created.id],
    );
    expect(operation.rows[0]?.operation).not.toContain(secretMarker);
    const researchConsent = await database.query<{
      state: string;
      retain_until: string | null;
      reason_code: string;
    }>(
      `SELECT state, retain_until, reason_code
       FROM feedback_consent_events
       WHERE feedback_id = $1 AND purpose = 'research_retention'
       ORDER BY sequence DESC LIMIT 1`,
      [created.id],
    );
    expect(researchConsent.rows).toEqual([
      {
        state: 'restricted',
        retain_until: null,
        reason_code: 'unsafe_payload_discarded',
      },
    ]);
  });

  it('returns exact idempotent evidence and rejects conflicting operation reuse', async () => {
    const body = request();
    const input = {
      householdId: 'household-sunrise',
      actorPersonId: 'person-owner-alice',
      request: body,
      correlationId: 'feedback-idempotency-test',
      now: fixedTestNow,
    } as const;
    const first = await repository.createAuthenticated(input);
    const second = await repository.createAuthenticated(input);
    expect(second).toEqual({ ...first, reused: true });
    const counts = await database.query<{ records: number; jobs: number; operations: number }>(
      `SELECT (SELECT count(*)::int FROM feedback_records) AS records,
              (SELECT count(*)::int FROM feedback_processing_jobs) AS jobs,
              (SELECT count(*)::int FROM feedback_intake_operations) AS operations`,
    );
    expect(counts.rows[0]).toEqual({ records: 1, jobs: 4, operations: 1 });
    await expect(
      repository.createAuthenticated({
        ...input,
        request: { ...body, text: 'A different request tried to reuse the same operation key.' },
      }),
    ).rejects.toThrow('conflicting evidence');
  });

  it('keeps anonymous identity absent while enforcing global and network HMAC quotas independent of feedback IDs', async () => {
    const body = request();
    const first = await repository.createAnonymous({
      networkAddress: '192.0.2.44',
      request: body,
      correlationId: 'feedback-anonymous-first',
      now: fixedTestNow,
    });
    for (let index = 0; index < 4; index += 1) {
      await expect(
        repository.createAnonymous({
          networkAddress: '192.0.2.44',
          request: body,
          correlationId: `feedback-anonymous-retry-${index}`,
          now: fixedTestNow,
        }),
      ).resolves.toMatchObject({ id: first.id, reused: true });
    }
    await expect(
      repository.createAnonymous({
        networkAddress: '192.0.2.44',
        request: body,
        correlationId: 'feedback-anonymous-over-quota',
        now: fixedTestNow,
      }),
    ).rejects.toThrow('capacity');
    const record = await database.query<{
      household_id: string | null;
      actor_person_id: string | null;
      identity_mode: string;
      linked_object_id: string | null;
    }>(
      'SELECT household_id, actor_person_id, identity_mode, linked_object_id FROM feedback_records',
    );
    expect(record.rows).toEqual([
      {
        household_id: null,
        actor_person_id: null,
        identity_mode: 'anonymous',
        linked_object_id: null,
      },
    ]);
    const networkHmac = fingerprintMinimized('192.0.2.44', fingerprintKey, {
      tenantId: 'anonymous_feedback',
      purpose: 'network-quota-v1',
      keyVersion: 1,
    }).value;
    const quota = await database.query<{ scope: string; scope_key: string; used_count: number }>(
      `SELECT scope, scope_key, used_count FROM feedback_anonymous_quota_buckets
       ORDER BY scope`,
    );
    expect(quota.rows).toEqual([
      { scope: 'global', scope_key: 'global', used_count: 5 },
      { scope: 'network', scope_key: networkHmac, used_count: 5 },
    ]);
    expect(JSON.stringify(record.rows)).not.toContain(networkHmac);

    await database.query(
      `UPDATE feedback_anonymous_quota_buckets SET used_count = 60
       WHERE scope = 'global'`,
    );
    await expect(
      repository.createAnonymous({
        networkAddress: '192.0.2.99',
        request: request(),
        correlationId: 'feedback-anonymous-global-over-quota',
        now: fixedTestNow,
      }),
    ).rejects.toThrow('capacity');
    const exhausted = await database.query<{ scope: string; used_count: number }>(
      `SELECT scope, used_count FROM feedback_anonymous_quota_buckets ORDER BY scope`,
    );
    expect(exhausted.rows).toEqual([
      { scope: 'global', used_count: 60 },
      { scope: 'network', used_count: 5 },
    ]);
  });

  it('blocks anonymous processing when the same network or global concurrency lease is active', async () => {
    const networkHmac = fingerprintMinimized('198.51.100.8', fingerprintKey, {
      tenantId: 'anonymous_feedback',
      purpose: 'network-quota-v1',
      keyVersion: 1,
    }).value;
    await database.query(
      `INSERT INTO feedback_anonymous_processing_leases(id, client_key_hmac, created_at, expires_at)
       VALUES ('feedback-active-lease',$1,$2,$3)`,
      [
        networkHmac,
        fixedTestNow.toISOString(),
        new Date(fixedTestNow.getTime() + 20_000).toISOString(),
      ],
    );
    await expect(
      repository.createAnonymous({
        networkAddress: '198.51.100.8',
        request: request(),
        correlationId: 'feedback-anonymous-concurrency',
        now: fixedTestNow,
      }),
    ).rejects.toThrow('processing capacity');
    const quota = await database.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM feedback_anonymous_quota_buckets',
    );
    expect(quota.rows[0]?.count).toBe(0);

    await database.query('DELETE FROM feedback_anonymous_processing_leases');
    for (let index = 0; index < 10; index += 1) {
      const distinctNetworkHmac = fingerprintMinimized(`203.0.113.${index + 1}`, fingerprintKey, {
        tenantId: 'anonymous_feedback',
        purpose: 'network-quota-v1',
        keyVersion: 1,
      }).value;
      await database.query(
        `INSERT INTO feedback_anonymous_processing_leases(
           id, client_key_hmac, created_at, expires_at
         ) VALUES ($1,$2,$3,$4)`,
        [
          `feedback-global-lease-${index}`,
          distinctNetworkHmac,
          fixedTestNow.toISOString(),
          new Date(fixedTestNow.getTime() + 20_000).toISOString(),
        ],
      );
    }
    await expect(
      repository.createAnonymous({
        networkAddress: '203.0.113.200',
        request: request(),
        correlationId: 'feedback-anonymous-global-concurrency',
        now: fixedTestNow,
      }),
    ).rejects.toThrow('processing capacity');
    const globalQuota = await database.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM feedback_anonymous_quota_buckets',
    );
    expect(globalQuota.rows[0]?.count).toBe(0);
  });

  it('uses one IPv4 quota bucket and concurrency identity for every IPv4-mapped IPv6 form', async () => {
    const addresses = [
      '192.0.2.45',
      '::ffff:192.0.2.45',
      '0:0:0:0:0:ffff:c000:022d',
      '::FFFF:C000:22D',
      '0000:0000:0000:0000:0000:ffff:192.0.2.45',
    ] as const;
    for (const [index, networkAddress] of addresses.entries()) {
      await expect(
        repository.createAnonymous({
          networkAddress,
          request: request(),
          correlationId: `feedback-mapped-ipv4-quota-${index}`,
          now: fixedTestNow,
        }),
      ).resolves.toMatchObject({ status: 'queued_unassigned' });
    }
    await expect(
      repository.createAnonymous({
        networkAddress: '::ffff:c000:022d',
        request: request(),
        correlationId: 'feedback-mapped-ipv4-quota-exhausted',
        now: fixedTestNow,
      }),
    ).rejects.toThrow('capacity');

    const expectedNetworkHmac = fingerprintMinimized('192.0.2.45', fingerprintKey, {
      tenantId: 'anonymous_feedback',
      purpose: 'network-quota-v1',
      keyVersion: 1,
    }).value;
    const buckets = await database.query<{
      readonly scope_key: string;
      readonly used_count: number;
    }>(
      `SELECT scope_key, used_count FROM feedback_anonymous_quota_buckets
       WHERE scope = 'network'`,
    );
    expect(buckets.rows).toEqual([{ scope_key: expectedNetworkHmac, used_count: 5 }]);

    databaseAuthorityNow = new Date(databaseAuthorityNow.getTime() + 3_600_000);
    await database.query(
      `INSERT INTO feedback_anonymous_processing_leases(id, client_key_hmac, created_at, expires_at)
       VALUES ('feedback-mapped-ipv4-lease',$1,$2,$3)`,
      [
        expectedNetworkHmac,
        databaseAuthorityNow.toISOString(),
        new Date(databaseAuthorityNow.getTime() + 30_000).toISOString(),
      ],
    );
    await expect(
      repository.createAnonymous({
        networkAddress: '0:0:0:0:0:ffff:c000:022d',
        request: request(),
        correlationId: 'feedback-mapped-ipv4-concurrency',
        now: fixedTestNow,
      }),
    ).rejects.toThrow('processing capacity');
    const leases = await database.query<{
      readonly id: string;
      readonly client_key_hmac: string;
    }>('SELECT id, client_key_hmac FROM feedback_anonymous_processing_leases');
    expect(leases.rows).toEqual([
      { id: 'feedback-mapped-ipv4-lease', client_key_hmac: expectedNetworkHmac },
    ]);
  });

  it('holds and renews exact anonymous lease ownership through a create that crosses the original TTL', async () => {
    const startedAt = new Date('2026-08-15T12:00:00.000Z');
    databaseAuthorityNow = startedAt;
    let authorityCalls = 0;
    let releaseClock!: () => void;
    let enterClock!: () => void;
    const clockEntered = new Promise<void>((resolve) => {
      enterClock = resolve;
    });
    const clockReleased = new Promise<void>((resolve) => {
      releaseClock = resolve;
    });
    const gatedClock: FeedbackAuthorityClock = async () => {
      authorityCalls += 1;
      if (authorityCalls === 3) {
        databaseAuthorityNow = new Date(startedAt.getTime() + 31_000);
        enterClock();
        await clockReleased;
      }
      return new Date(databaseAuthorityNow);
    };
    const renewalExpirations: Date[] = [];
    const observedDatabase: Database = {
      kind: database.kind,
      query: <Row extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]) =>
        database.query<Row>(sql, parameters),
      exec: (sql) => database.exec(sql),
      close: () => database.close(),
      transaction: (work) =>
        database.transaction((transaction) => {
          const observed: SqlExecutor = {
            query: <Row extends Record<string, unknown>>(
              sql: string,
              parameters?: readonly unknown[],
            ) => {
              if (
                sql.includes('UPDATE feedback_anonymous_processing_leases') &&
                sql.includes('SET expires_at')
              ) {
                renewalExpirations.push(new Date(String(parameters?.[2])));
              }
              return transaction.query<Row>(sql, parameters);
            },
            exec: (sql) => transaction.exec(sql),
          };
          return work(observed);
        }),
    };
    const firstRepository = new FeedbackRepository(observedDatabase, protection, ids(), gatedClock);
    const secondRepository = new FeedbackRepository(
      database,
      protection,
      ids(),
      fixedAuthorityClock,
    );
    const first = firstRepository.createAnonymous({
      networkAddress: '198.51.100.90',
      request: request(),
      correlationId: 'feedback-lease-cross-ttl-first',
      now: new Date('2040-01-01T00:00:00.000Z'),
    });
    await clockEntered;
    let secondSettled = false;
    const second = secondRepository
      .createAnonymous({
        networkAddress: '198.51.100.90',
        request: request(),
        correlationId: 'feedback-lease-cross-ttl-second',
        now: new Date('1990-01-01T00:00:00.000Z'),
      })
      .finally(() => {
        secondSettled = true;
      });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    releaseClock();
    const [firstOutcome, secondOutcome] = await Promise.allSettled([first, second]);
    expect(firstOutcome).toMatchObject({
      status: 'fulfilled',
      value: expect.objectContaining({ status: 'queued_unassigned' }),
    });
    expect(secondOutcome).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ message: expect.stringContaining('processing capacity') }),
    });
    expect(renewalExpirations.map((value) => value.toISOString())).toEqual([
      '2026-08-15T12:00:30.000Z',
      '2026-08-15T12:01:01.000Z',
    ]);
    const leases = await database.query<{ readonly count: number }>(
      'SELECT count(*)::int AS count FROM feedback_anonymous_processing_leases',
    );
    expect(leases.rows[0]?.count).toBe(0);
    const quota = await database.query<{ readonly used_count: number }>(
      `SELECT used_count FROM feedback_anonymous_quota_buckets
       WHERE scope = 'network'`,
    );
    expect(quota.rows).toEqual([{ used_count: 1 }]);
  });

  it('rolls back anonymous intake and removes the lease when the final ownership renewal fails', async () => {
    let renewalAttempt = 0;
    const failingDatabase: Database = {
      kind: database.kind,
      query: <Row extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]) =>
        database.query<Row>(sql, parameters),
      exec: (sql) => database.exec(sql),
      close: () => database.close(),
      transaction: (work) =>
        database.transaction((transaction) => {
          const failing: SqlExecutor = {
            query: <Row extends Record<string, unknown>>(
              sql: string,
              parameters?: readonly unknown[],
            ) => {
              if (
                sql.includes('UPDATE feedback_anonymous_processing_leases') &&
                sql.includes('SET expires_at')
              ) {
                renewalAttempt += 1;
                if (renewalAttempt === 2) {
                  return Promise.resolve({ rows: [] as Row[], rowCount: 0 });
                }
              }
              return transaction.query<Row>(sql, parameters);
            },
            exec: (sql) => transaction.exec(sql),
          };
          return work(failing);
        }),
    };
    const failingRepository = new FeedbackRepository(
      failingDatabase,
      protection,
      ids(),
      fixedAuthorityClock,
    );
    const failedRequest = request();
    await expect(
      failingRepository.createAnonymous({
        networkAddress: '198.51.100.91',
        request: failedRequest,
        correlationId: 'feedback-lease-renewal-failure',
        now: fixedTestNow,
      }),
    ).rejects.toThrow('renewal failed');
    expect(renewalAttempt).toBe(2);
    const persisted = await database.query<{ readonly count: number }>(
      `SELECT (
         (SELECT count(*) FROM feedback_intake_operations WHERE operation_key = $1)
         + (SELECT count(*) FROM feedback_records
            WHERE correlation_id = 'feedback-lease-renewal-failure')
       )::int AS count`,
      [failedRequest.operationKey],
    );
    expect(persisted.rows[0]?.count).toBe(0);
    const leases = await database.query<{ readonly count: number }>(
      'SELECT count(*)::int AS count FROM feedback_anonymous_processing_leases',
    );
    expect(leases.rows[0]?.count).toBe(0);
  });

  it('uses canonical IP quotas and database-authoritative lease TTL, wait, rollover, and skew', async () => {
    databaseAuthorityNow = new Date('2026-08-15T12:59:59.900Z');
    const leaseWindows: Array<{ readonly createdAt: Date; readonly expiresAt: Date }> = [];
    const observedDatabase: Database = {
      kind: database.kind,
      query: <Row extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]) =>
        database.query<Row>(sql, parameters),
      exec: (sql) => database.exec(sql),
      close: () => database.close(),
      transaction: (work) =>
        database.transaction((transaction) => {
          const observed: SqlExecutor = {
            query: <Row extends Record<string, unknown>>(
              sql: string,
              parameters?: readonly unknown[],
            ) => {
              if (sql.includes('INSERT INTO feedback_anonymous_processing_leases')) {
                leaseWindows.push({
                  createdAt: new Date(String(parameters?.[2])),
                  expiresAt: new Date(String(parameters?.[3])),
                });
              }
              return transaction.query<Row>(sql, parameters);
            },
            exec: (sql) => transaction.exec(sql),
          };
          return work(observed);
        }),
    };
    const observedRepository = new FeedbackRepository(
      observedDatabase,
      protection,
      ids(),
      fixedAuthorityClock,
    );
    const skewedObservedAt = new Date('2036-01-01T00:00:00.000Z');
    const equivalentAddresses = [
      '2001:0DB8:0:0:0:0:0:1',
      '2001:db8::1',
      '2001:0db8:0000:0000:0000:0000:0000:0001',
    ] as const;
    for (let index = 0; index < 5; index += 1) {
      await expect(
        observedRepository.createAnonymous({
          networkAddress: equivalentAddresses[index % equivalentAddresses.length]!,
          request: request(),
          correlationId: `feedback-authority-quota-${index}`,
          now: skewedObservedAt,
        }),
      ).resolves.toMatchObject({ status: 'queued_unassigned' });
    }
    await expect(
      observedRepository.createAnonymous({
        networkAddress: '2001:db8::1',
        request: request(),
        correlationId: 'feedback-authority-quota-exhausted',
        now: new Date('2000-01-01T00:00:00.000Z'),
      }),
    ).rejects.toThrow('capacity');

    databaseAuthorityNow = new Date('2026-08-15T13:00:00.100Z');
    await expect(
      observedRepository.createAnonymous({
        networkAddress: '2001:db8::1',
        request: request(),
        correlationId: 'feedback-authority-quota-rollover',
        now: skewedObservedAt,
      }),
    ).resolves.toMatchObject({ status: 'queued_unassigned' });

    const canonicalNetworkHmac = fingerprintMinimized('2001:db8::1', fingerprintKey, {
      tenantId: 'anonymous_feedback',
      purpose: 'network-quota-v1',
      keyVersion: 1,
    }).value;
    await database.query(
      `INSERT INTO feedback_anonymous_processing_leases(id, client_key_hmac, created_at, expires_at)
       VALUES ('feedback-authority-wait',$1,$2,$3)`,
      [
        canonicalNetworkHmac,
        databaseAuthorityNow.toISOString(),
        new Date(databaseAuthorityNow.getTime() + 10_000).toISOString(),
      ],
    );
    await expect(
      observedRepository.createAnonymous({
        networkAddress: '2001:0db8::1',
        request: request(),
        correlationId: 'feedback-authority-lease-wait',
        now: new Date('2040-01-01T00:00:00.000Z'),
      }),
    ).rejects.toThrow('processing capacity');
    databaseAuthorityNow = new Date(databaseAuthorityNow.getTime() + 10_000);
    await expect(
      observedRepository.createAnonymous({
        networkAddress: '2001:0db8::1',
        request: request(),
        correlationId: 'feedback-authority-lease-expired',
        now: new Date('1999-01-01T00:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ status: 'queued_unassigned' });

    expect(leaseWindows.length).toBe(7);
    expect(
      leaseWindows.every(
        ({ createdAt, expiresAt }) => expiresAt.getTime() - createdAt.getTime() === 30_000,
      ),
    ).toBe(true);
    expect(leaseWindows[0]?.createdAt.toISOString()).toBe('2026-08-15T12:59:59.900Z');
    expect(leaseWindows.at(-1)?.createdAt.toISOString()).toBe('2026-08-15T13:00:10.100Z');
    const quota = await database.query<{
      bucket_start: unknown;
      scope_key: string;
      used_count: number;
    }>(
      `SELECT bucket_start, scope_key, used_count
       FROM feedback_anonymous_quota_buckets WHERE scope = 'network'
       ORDER BY bucket_start`,
    );
    expect(
      quota.rows.map((row) => ({
        bucketStart: new Date(String(row.bucket_start)).toISOString(),
        scopeKey: row.scope_key,
        usedCount: row.used_count,
      })),
    ).toEqual([
      {
        bucketStart: '2026-08-15T12:00:00.000Z',
        scopeKey: canonicalNetworkHmac,
        usedCount: 5,
      },
      {
        bucketStart: '2026-08-15T13:00:00.000Z',
        scopeKey: canonicalNetworkHmac,
        usedCount: 2,
      },
    ]);
  });

  it('requires current exact actor and tenant authority for contextual object linkage', async () => {
    const postCheck = (actorPersonId: string, checkId: string) =>
      repository.createAuthenticated({
        householdId: 'household-sunrise',
        actorPersonId,
        request: request({
          source: {
            surface: 'post_check',
            appVersion: 'web-3.0.0',
            deviceClass: 'desktop',
          },
          link: {
            permitted: true,
            consentVersion: 'feedback-linkage-v1',
            objectType: 'check',
            objectId: checkId,
          },
        }),
        correlationId: `feedback-link-${actorPersonId}`,
        now: fixedTestNow,
      });
    await expect(postCheck('person-owner-alice', 'analysis-seed-sunrise-shared')).rejects.toThrow(
      'authority',
    );
    await expect(
      postCheck('person-protected-pat', 'analysis-seed-sunrise-shared'),
    ).resolves.toMatchObject({ status: 'queued_unassigned' });
    await expect(postCheck('person-protected-pat', 'analysis-seed-harbor-private')).rejects.toThrow(
      'authority',
    );
  });

  it('allows only the current exact support assignee to convert and does not broaden visibility', async () => {
    const body = {
      operationKey: operationKey(),
      text: 'The customer reported that keyboard navigation could not reach the Continue action.',
      feedbackType: 'accessibility_issue' as const,
      source: {
        surface: 'support_conversion' as const,
        appVersion: 'hq-3.0.0',
        deviceClass: 'desktop' as const,
      },
    };
    await expect(
      repository.convertSupportCase({
        householdId: 'household-sunrise',
        supportCaseId: 'support-case-seeded-sam',
        actorPersonId: 'person-hq-riley',
        request: body,
        correlationId: 'feedback-support-wrong-assignee',
        now: fixedTestNow,
      }),
    ).rejects.toThrow('exact internal support-case assignment');
    const created = await repository.convertSupportCase({
      householdId: 'household-sunrise',
      supportCaseId: 'support-case-seeded-sam',
      actorPersonId: 'person-hq-sam',
      request: body,
      correlationId: 'feedback-support-conversion',
      now: fixedTestNow,
    });
    const retry = await repository.convertSupportCase({
      householdId: 'household-sunrise',
      supportCaseId: 'support-case-seeded-sam',
      actorPersonId: 'person-hq-sam',
      request: body,
      correlationId: 'feedback-support-conversion',
      now: fixedTestNow,
    });
    expect(retry).toEqual({ ...created, reused: true });
    await expect(
      repository.roleScopedMetadata({
        actorPersonId: 'person-hq-sam',
        correlationId: 'feedback-support-metadata',
        now: fixedTestNow,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        identityMode: 'support_conversion',
        queue: 'accessibility',
        followUpConsented: false,
        researchRetentionConsented: false,
        closeLoopState: 'human_review_required',
        contentReadAuthorized: true,
        selfClaimAvailable: false,
      }),
    ]);
    await expect(
      repository.readAssignedMinimizedText({
        feedbackId: created.id,
        actorPersonId: 'person-hq-sam',
        correlationId: 'feedback-support-exact-content-read',
        now: fixedTestNow,
      }),
    ).resolves.toMatchObject({
      feedbackId: created.id,
      minimizedText: body.text,
      contentBoundary: 'assigned_minimized_text',
    });
    await expect(
      repository.roleScopedMetadata({
        actorPersonId: 'person-hq-riley',
        correlationId: 'feedback-support-unrelated-reviewer',
        now: fixedTestNow,
      }),
    ).resolves.toEqual([]);
    await expect(
      repository.readAssignedMinimizedText({
        feedbackId: created.id,
        actorPersonId: 'person-hq-riley',
        correlationId: 'feedback-support-unrelated-content-denied',
        now: fixedTestNow,
      }),
    ).rejects.toThrow('unavailable');

    const unsafeBody = {
      ...body,
      operationKey: operationKey(),
      text: [
        'The customer pasted this by mistake:',
        '-----BEGIN ' + 'PRIVATE KEY-----',
        'generated-support-private-material',
        '-----END ' + 'PRIVATE KEY-----',
      ].join('\n'),
    };
    const unsafe = await repository.convertSupportCase({
      householdId: 'household-sunrise',
      supportCaseId: 'support-case-seeded-sam',
      actorPersonId: 'person-hq-sam',
      request: unsafeBody,
      correlationId: 'feedback-support-unsafe-conversion',
      now: fixedTestNow,
    });
    expect(unsafe).toMatchObject({
      status: 'unsafe_unprocessable',
      queue: 'privacy_security',
      redactionStatus: 'quarantined_discarded',
    });
    const samAfterUnsafe = await repository.roleScopedMetadata({
      actorPersonId: 'person-hq-sam',
      correlationId: 'feedback-support-unsafe-hidden',
      now: fixedTestNow,
    });
    expect(samAfterUnsafe.map((item) => item.id)).toEqual([created.id]);
    await database.query(
      `UPDATE support_case_assignments
       SET status = 'ended', ended_at = $3
       WHERE household_id = $1 AND case_id = $2 AND status = 'active'`,
      [
        'household-sunrise',
        'support-case-seeded-sam',
        new Date(fixedTestNow.getTime() + 1_000).toISOString(),
      ],
    );
    await expect(
      repository.roleScopedMetadata({
        actorPersonId: 'person-hq-sam',
        correlationId: 'feedback-support-ended-assignment-hidden',
        now: new Date(fixedTestNow.getTime() + 1_000),
      }),
    ).resolves.toEqual([]);
    await expect(
      repository.readAssignedMinimizedText({
        feedbackId: created.id,
        actorPersonId: 'person-hq-sam',
        correlationId: 'feedback-support-ended-content-denied',
        now: new Date(fixedTestNow.getTime() + 1_000),
      }),
    ).rejects.toThrow('unavailable');
    await expect(
      repository.claimForReview({
        feedbackId: created.id,
        actorPersonId: 'person-hq-heidi',
        correlationId: 'feedback-support-owner-broadening-denied',
        now: new Date(fixedTestNow.getTime() + 1_000),
      }),
    ).rejects.toThrow('unavailable');
    const ownerView = await repository.roleScopedMetadata({
      actorPersonId: 'person-hq-heidi',
      correlationId: 'feedback-owner-privacy-projection',
      now: new Date(fixedTestNow.getTime() + 1_000),
    });
    expect(ownerView).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.id, routingState: 'assigned' }),
        expect.objectContaining({
          id: unsafe.id,
          routingState: 'unassigned',
          queue: 'privacy_security',
          contentReadAuthorized: false,
          selfClaimAvailable: false,
        }),
      ]),
    );
  });

  it('derives retention and purge decisions from fresh database authority time despite caller skew', async () => {
    databaseAuthorityNow = new Date('2026-08-15T12:00:00.000Z');
    const observedFuture = new Date('2045-01-01T00:00:00.000Z');
    const declined = await repository.createAuthenticated({
      householdId: 'household-sunrise',
      actorPersonId: 'person-owner-alice',
      request: request(),
      correlationId: 'feedback-authority-declined-retention',
      now: observedFuture,
    });
    expect(declined.retainedUntil?.toISOString()).toBe('2026-08-15T13:00:00.000Z');

    const granted = await repository.createAuthenticated({
      householdId: 'household-sunrise',
      actorPersonId: 'person-owner-alice',
      request: request({
        researchRetention: {
          granted: true,
          purpose: 'product_feedback_research',
          consentVersion: 'feedback-research-v1',
          retainUntil: '2026-08-16T12:00:00.000Z',
        },
      }),
      correlationId: 'feedback-authority-granted-retention',
      now: new Date('1995-01-01T00:00:00.000Z'),
    });
    expect(granted.retainedUntil?.toISOString()).toBe('2026-08-16T12:00:00.000Z');
    await expect(
      repository.createAuthenticated({
        householdId: 'household-sunrise',
        actorPersonId: 'person-owner-alice',
        request: request({
          researchRetention: {
            granted: true,
            purpose: 'product_feedback_research',
            consentVersion: 'feedback-research-v1',
            retainUntil: '2026-08-16T12:00:00.001Z',
          },
        }),
        correlationId: 'feedback-authority-overlong-retention',
        now: observedFuture,
      }),
    ).rejects.toThrow('within 24 hours');

    const support = await repository.convertSupportCase({
      householdId: 'household-sunrise',
      supportCaseId: 'support-case-seeded-sam',
      actorPersonId: 'person-hq-sam',
      request: {
        operationKey: operationKey(),
        text: 'The customer reported a difficult local navigation step.',
        feedbackType: 'product_feedback',
        source: { surface: 'support_conversion', deviceClass: 'desktop' },
      },
      correlationId: 'feedback-authority-support-retention',
      now: observedFuture,
    });
    expect(support.retainedUntil?.toISOString()).toBe('2026-08-15T13:00:00.000Z');

    const createdAt = await database.query<{ created_at: unknown }>(
      'SELECT created_at FROM feedback_records WHERE id = $1',
      [declined.id],
    );
    expect(new Date(String(createdAt.rows[0]?.created_at)).toISOString()).toBe(
      '2026-08-15T12:00:00.000Z',
    );
    databaseAuthorityNow = new Date('2026-08-15T12:59:59.999Z');
    await expect(
      repository.purgeDue({ now: new Date('2050-01-01T00:00:00.000Z'), limit: 10 }),
    ).resolves.toBe(0);
    databaseAuthorityNow = new Date('2026-08-15T13:00:00.000Z');
    await expect(
      repository.purgeDue({ now: new Date('1990-01-01T00:00:00.000Z'), limit: 10 }),
    ).resolves.toBe(2);
  });

  it('rejects direct active-store ciphertext deletion without same-transaction erasure evidence', async () => {
    const created = await repository.createAuthenticated({
      householdId: 'household-sunrise',
      actorPersonId: 'person-owner-alice',
      request: request(),
      correlationId: 'feedback-direct-erasure-create',
      now: fixedTestNow,
    });
    await expect(
      database.query(
        `UPDATE feedback_payloads
         SET payload_state = 'payload_erased', encrypted_text = NULL,
             encryption_key_version = NULL, erased_at = $2
         WHERE feedback_id = $1`,
        [created.id, new Date(fixedTestNow.getTime() + 30_000).toISOString()],
      ),
    ).rejects.toThrow(/same-transaction durable evidence/iu);
    const payload = await database.query<{
      payload_state: string;
      encrypted_text: string | null;
      erasure_events: number;
    }>(
      `SELECT payload_state, encrypted_text,
              (SELECT count(*)::int FROM feedback_payload_erasure_events evidence
               WHERE evidence.feedback_id = payload.feedback_id) AS erasure_events
       FROM feedback_payloads payload WHERE feedback_id = $1`,
      [created.id],
    );
    expect(payload.rows[0]?.payload_state).toBe('encrypted_minimized');
    expect(payload.rows[0]?.encrypted_text).not.toBeNull();
    expect(payload.rows[0]?.erasure_events).toBe(0);
  });

  it('erases active-store ciphertext on consent withdrawal without claiming backup erasure', async () => {
    const created = await repository.createAuthenticated({
      householdId: 'household-sunrise',
      actorPersonId: 'person-owner-alice',
      request: request({
        followUp: {
          granted: true,
          purpose: 'feedback_follow_up',
          consentVersion: 'feedback-follow-up-v1',
          channelClass: 'account_email',
        },
      }),
      correlationId: 'feedback-withdraw-create',
      now: fixedTestNow,
    });
    await expect(
      repository.withdrawAuthenticatedConsent({
        feedbackId: created.id,
        householdId: 'household-sunrise',
        actorPersonId: 'person-owner-alice',
        purpose: 'follow_up',
        correlationId: 'feedback-withdraw-exact',
        now: new Date(fixedTestNow.getTime() + 30_000),
      }),
    ).resolves.toEqual({ withdrawn: true, activeStoreCiphertextErased: true });
    const facts = await database.query<{
      payload_state: string;
      encrypted_text: string | null;
      state: string;
      consent_state: string;
      erasure_reason: string;
    }>(
      `SELECT payload.payload_state, payload.encrypted_text,
              (SELECT event.to_status FROM feedback_state_events event
               WHERE event.feedback_id = record.id ORDER BY event.version DESC LIMIT 1) AS state,
              (SELECT consent.state FROM feedback_consent_events consent
               WHERE consent.feedback_id = record.id AND consent.purpose = 'follow_up'
               ORDER BY consent.sequence DESC LIMIT 1) AS consent_state,
              erasure.reason AS erasure_reason
       FROM feedback_records record
       JOIN feedback_payloads payload ON payload.feedback_id = record.id
       JOIN feedback_payload_erasure_events erasure ON erasure.feedback_id = record.id
       WHERE record.id = $1`,
      [created.id],
    );
    expect(facts.rows[0]).toEqual({
      payload_state: 'payload_erased',
      encrypted_text: null,
      state: 'withdrawn',
      consent_state: 'withdrawn',
      erasure_reason: 'consent_withdrawn',
    });
    await expect(
      repository.roleScopedMetadata({
        actorPersonId: 'person-hq-heidi',
        correlationId: 'feedback-withdraw-latest-effective-consent',
        now: new Date(fixedTestNow.getTime() + 30_000),
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        followUpConsented: false,
        researchRetentionConsented: false,
        contentReadAuthorized: false,
        selfClaimAvailable: false,
      }),
    ]);
    await expect(
      repository.withdrawAuthenticatedConsent({
        feedbackId: created.id,
        householdId: 'household-sunrise',
        actorPersonId: 'person-protected-pat',
        purpose: 'follow_up',
        correlationId: 'feedback-withdraw-wrong-actor',
        now: new Date(fixedTestNow.getTime() + 60_000),
      }),
    ).rejects.toThrow('authority');
  });

  it('erases optional linked-object identifiers when exact linkage consent is withdrawn', async () => {
    const created = await repository.createAuthenticated({
      householdId: 'household-sunrise',
      actorPersonId: 'person-protected-pat',
      request: request({
        source: { surface: 'post_check', deviceClass: 'desktop' },
        link: {
          permitted: true,
          consentVersion: 'feedback-linkage-v1',
          objectType: 'check',
          objectId: 'analysis-seed-sunrise-shared',
        },
      }),
      correlationId: 'feedback-link-withdraw-create',
      now: fixedTestNow,
    });
    await expect(
      repository.withdrawAuthenticatedConsent({
        feedbackId: created.id,
        householdId: 'household-sunrise',
        actorPersonId: 'person-protected-pat',
        purpose: 'object_linkage',
        correlationId: 'feedback-link-withdraw-exact',
        now: new Date(fixedTestNow.getTime() + 30_000),
      }),
    ).resolves.toEqual({ withdrawn: true, activeStoreCiphertextErased: true });
    const record = await database.query<{
      linked_object_type: string | null;
      linked_object_id: string | null;
      linkage_consent_version: string | null;
      payload_state: string;
    }>(
      `SELECT record.linked_object_type, record.linked_object_id,
              record.linkage_consent_version, payload.payload_state
       FROM feedback_records record
       JOIN feedback_payloads payload ON payload.feedback_id = record.id
       WHERE record.id = $1`,
      [created.id],
    );
    expect(record.rows[0]).toEqual({
      linked_object_type: null,
      linked_object_id: null,
      linkage_consent_version: null,
      payload_state: 'payload_erased',
    });
  });

  it('expires every still-granted optional purpose and erases linkage at payload expiry', async () => {
    const created = await repository.createAuthenticated({
      householdId: 'household-sunrise',
      actorPersonId: 'person-protected-pat',
      request: request({
        source: { surface: 'post_check', deviceClass: 'desktop' },
        link: {
          permitted: true,
          consentVersion: 'feedback-linkage-v1',
          objectType: 'check',
          objectId: 'analysis-seed-sunrise-shared',
        },
        followUp: {
          granted: true,
          purpose: 'feedback_follow_up',
          consentVersion: 'feedback-follow-up-v1',
          channelClass: 'in_app',
        },
      }),
      correlationId: 'feedback-purpose-expiry-create',
      now: fixedTestNow,
    });
    databaseAuthorityNow = new Date(fixedTestNow.getTime() + 61 * 60_000);
    await expect(
      repository.purgeDue({
        now: new Date(fixedTestNow.getTime() + 61 * 60_000),
        limit: 10,
      }),
    ).resolves.toBe(1);
    const facts = await database.query<{
      linked_object_id: string | null;
      follow_up: string;
      research_retention: string;
      object_linkage: string;
    }>(
      `SELECT record.linked_object_id,
              (SELECT state FROM feedback_consent_events consent
               WHERE consent.feedback_id = record.id AND purpose = 'follow_up'
               ORDER BY sequence DESC LIMIT 1) AS follow_up,
              (SELECT state FROM feedback_consent_events consent
               WHERE consent.feedback_id = record.id AND purpose = 'research_retention'
               ORDER BY sequence DESC LIMIT 1) AS research_retention,
              (SELECT state FROM feedback_consent_events consent
               WHERE consent.feedback_id = record.id AND purpose = 'object_linkage'
               ORDER BY sequence DESC LIMIT 1) AS object_linkage
       FROM feedback_records record WHERE record.id = $1`,
      [created.id],
    );
    expect(facts.rows[0]).toEqual({
      linked_object_id: null,
      follow_up: 'expired',
      research_retention: 'declined',
      object_linkage: 'expired',
    });
  });

  it('erases expired live-production ciphertext without backup or provider deletion claims', async () => {
    const founding = await ProductionFeedbackFoundingFixture.create(database, fixedTestNow);
    const enrollee = await founding.enroll('retention');
    const created = await repository.createAuthenticated({
      householdId: enrollee.householdId,
      actorPersonId: enrollee.actorPersonId,
      request: request({
        researchRetention: {
          granted: true,
          purpose: 'product_feedback_research',
          consentVersion: 'feedback-research-v1',
          retainUntil: new Date(fixedTestNow.getTime() + 30 * 60_000).toISOString(),
        },
      }),
      correlationId: 'feedback-retention-create',
      evidenceTier: 'live_production',
      now: fixedTestNow,
    });
    databaseAuthorityNow = new Date(fixedTestNow.getTime() + 61 * 60_000);
    await expect(
      repository.purgeDue({
        now: new Date(fixedTestNow.getTime() + 61 * 60_000),
        limit: 10,
      }),
    ).resolves.toBe(1);
    const facts = await database.query<{
      payload_state: string;
      encrypted_text: string | null;
      to_status: string;
      state_evidence_tier: string;
      reason: string;
      erasure_evidence_tier: string;
      consent_state: string;
    }>(
      `SELECT payload.payload_state, payload.encrypted_text, state.to_status,
              state.evidence_tier AS state_evidence_tier, erasure.reason,
              erasure.evidence_tier AS erasure_evidence_tier,
              (SELECT consent.state FROM feedback_consent_events consent
               WHERE consent.feedback_id = payload.feedback_id
                 AND consent.purpose = 'research_retention'
               ORDER BY consent.sequence DESC LIMIT 1) AS consent_state
       FROM feedback_payloads payload
       JOIN LATERAL (
         SELECT event.to_status, event.evidence_tier FROM feedback_state_events event
         WHERE event.feedback_id = payload.feedback_id ORDER BY event.version DESC LIMIT 1
       ) state ON true
       JOIN feedback_payload_erasure_events erasure ON erasure.feedback_id = payload.feedback_id
       WHERE payload.feedback_id = $1`,
      [created.id],
    );
    expect(facts.rows[0]).toEqual({
      payload_state: 'payload_erased',
      encrypted_text: null,
      to_status: 'retention_expired',
      state_evidence_tier: 'live_production',
      reason: 'retention_expired',
      erasure_evidence_tier: 'live_production',
      consent_state: 'expired',
    });
    await expect(
      repository.roleScopedMetadata({
        actorPersonId: 'person-hq-heidi',
        correlationId: 'feedback-retention-expired-metadata',
        evidenceTier: 'live_production',
        now: new Date('2050-01-01T00:00:00.000Z'),
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        status: 'retention_expired',
        contentReadAuthorized: false,
        selfClaimAvailable: false,
      }),
    ]);
    await expect(
      repository.readAssignedMinimizedText({
        feedbackId: created.id,
        actorPersonId: 'person-hq-heidi',
        correlationId: 'feedback-retention-expired-content',
        evidenceTier: 'live_production',
        now: fixedTestNow,
      }),
    ).rejects.toThrow('unavailable');
    const receiptClaims = await database.query<{
      provider_processed: boolean;
      external_action_executed: boolean;
      result_code: string;
      evidence_tier: string;
    }>(
      `SELECT provider_processed, external_action_executed, result_code, evidence_tier
       FROM feedback_processing_jobs`,
    );
    expect(
      receiptClaims.rows.every(
        (receipt) =>
          !receipt.provider_processed &&
          !receipt.external_action_executed &&
          receipt.result_code === 'local_processing_not_run' &&
          receipt.evidence_tier === 'live_production',
      ),
    ).toBe(true);
  });
});
