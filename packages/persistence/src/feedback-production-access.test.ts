import { createSeededTestDatabase, fixedTestNow } from '@boomerbuddy/testkit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './database';
import { FeedbackRepository, type FeedbackIntakeRequest } from './feedback';
import {
  ProductionFeedbackFoundingFixture,
  type ProductionFeedbackEnrollee,
} from './feedback-production-fixture.test-helper';

let requestSequence = 0;

function operationKey(): string {
  requestSequence += 1;
  return `feedback:20000000-0000-4000-8000-${String(requestSequence).padStart(12, '0')}`;
}

function feedbackRequest(input?: {
  readonly operationKey?: string;
  readonly text?: string;
}): FeedbackIntakeRequest {
  return {
    operationKey: input?.operationKey ?? operationKey(),
    text: input?.text ?? 'The Founding Household member flow needs a clearer primary action.',
    feedbackType: 'product_feedback',
    source: { surface: 'in_app_contextual', deviceClass: 'desktop' },
    link: { permitted: false },
    followUp: { granted: false },
    researchRetention: { granted: false },
  };
}

describe('live feedback Founding access and quota boundary', () => {
  let database: Database;
  let databaseAuthorityNow: Date;
  let repository: FeedbackRepository;
  let idSequence: number;

  beforeEach(async () => {
    requestSequence = 0;
    idSequence = 0;
    databaseAuthorityNow = new Date(fixedTestNow);
    database = await createSeededTestDatabase(fixedTestNow);
    repository = new FeedbackRepository(
      database,
      {
        encryptionKey: Buffer.alloc(32, 89),
        encryptionKeyVersion: 1,
        fingerprintKey: Buffer.alloc(32, 97),
        fingerprintKeyVersion: 1,
      },
      { next: (prefix) => `${prefix}-feedback-access-${++idSequence}` },
      async () => new Date(databaseAuthorityNow),
    );
  });

  afterEach(async () => database.close());

  async function createLive(input: {
    readonly enrollee: Pick<ProductionFeedbackEnrollee, 'householdId' | 'actorPersonId'>;
    readonly request?: FeedbackIntakeRequest;
    readonly callerNow?: Date;
  }) {
    return repository.createAuthenticated({
      householdId: input.enrollee.householdId,
      actorPersonId: input.enrollee.actorPersonId,
      request: input.request ?? feedbackRequest(),
      correlationId: `correlation:feedback-access-${requestSequence}-${idSequence}`,
      evidenceTier: 'live_production',
      now: input.callerNow ?? fixedTestNow,
    });
  }

  async function feedbackCounts() {
    const result = await database.query<
      {
        readonly records: number;
        readonly operations: number;
        readonly charges: number;
        readonly buckets: number;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::integer FROM feedback_records) AS records,
         (SELECT count(*)::integer FROM feedback_intake_operations) AS operations,
         (SELECT count(*)::integer FROM feedback_authenticated_quota_charges) AS charges,
         (SELECT count(*)::integer FROM feedback_authenticated_quota_buckets) AS buckets`,
    );
    return result.rows[0];
  }

  it('leaves zero feedback or quota rows before enrollment and after exact expiry or revocation', async () => {
    await expect(
      createLive({
        enrollee: {
          householdId: 'household-sunrise',
          actorPersonId: 'person-owner-alice',
        },
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });
    expect(await feedbackCounts()).toEqual({ records: 0, operations: 0, charges: 0, buckets: 0 });

    await expect(
      database.query(
        `INSERT INTO feedback_records(
           id, schema_version, identity_mode, household_id, actor_person_id, source_surface,
           device_class, feedback_type, correlation_id, evidence_tier, created_at
         ) VALUES ('feedback-direct-live-without-founding',1,'authenticated',
           'household-sunrise','person-owner-alice','in_app_contextual','desktop',
           'product_feedback','feedback-direct-live-without-founding','live_production',$1)`,
        [fixedTestNow.toISOString()],
      ),
    ).rejects.toThrow(/Founding Household entitlement/iu);

    const founding = await ProductionFeedbackFoundingFixture.create(database, fixedTestNow, 2);
    const expired = await founding.enroll('expired-denial');
    const revoked = await founding.enroll('revoked-denial');
    await founding.offboard(revoked, new Date(fixedTestNow.getTime() + 1_000));

    databaseAuthorityNow = new Date(fixedTestNow.getTime() + 31 * 86_400_000);
    await expect(createLive({ enrollee: expired })).rejects.toMatchObject({
      code: 'not_authorized',
    });
    databaseAuthorityNow = new Date(fixedTestNow.getTime() + 2_000);
    await expect(createLive({ enrollee: revoked })).rejects.toMatchObject({
      code: 'not_authorized',
    });
    expect(await feedbackCounts()).toEqual({ records: 0, operations: 0, charges: 0, buckets: 0 });
  });

  it('accepts exact live enrollment once, replays without charge, and rejects conflicts without charge', async () => {
    const founding = await ProductionFeedbackFoundingFixture.create(database, fixedTestNow);
    const enrollee = await founding.enroll('idempotency');
    const key = operationKey();
    const original = feedbackRequest({ operationKey: key });
    const created = await createLive({ enrollee, request: original });
    expect(created).toMatchObject({ evidenceTier: 'live_production', reused: false });

    await expect(createLive({ enrollee, request: original })).resolves.toMatchObject({
      id: created.id,
      reused: true,
    });
    await expect(
      createLive({
        enrollee,
        request: feedbackRequest({ operationKey: key, text: 'A conflicting payload must fail.' }),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });

    expect(await feedbackCounts()).toEqual({ records: 1, operations: 1, charges: 1, buckets: 2 });
    const quota = await database.query<
      { readonly scope_kind: string; readonly accepted_count: number } & Record<string, unknown>
    >(
      `SELECT scope_kind, accepted_count
       FROM feedback_authenticated_quota_buckets ORDER BY scope_kind`,
    );
    expect(quota.rows).toEqual([
      { scope_kind: 'household', accepted_count: 1 },
      { scope_kind: 'person', accepted_count: 1 },
    ]);
  });

  it('serializes concurrent person limit plus one to exactly twenty durable charges', async () => {
    const founding = await ProductionFeedbackFoundingFixture.create(database, fixedTestNow);
    const enrollee = await founding.enroll('person-limit');
    const attempts = await Promise.allSettled(
      Array.from({ length: 21 }, (_unused, index) =>
        createLive({
          enrollee,
          request: feedbackRequest({ text: `Person quota attempt number ${index + 1}.` }),
        }),
      ),
    );
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(20);
    expect(attempts.filter(({ status }) => status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'conflict' }) }),
    ]);
    expect(await feedbackCounts()).toEqual({
      records: 20,
      operations: 20,
      charges: 20,
      buckets: 2,
    });
    const quota = await database.query<
      { readonly scope_kind: string; readonly accepted_count: number } & Record<string, unknown>
    >(
      `SELECT scope_kind, accepted_count
       FROM feedback_authenticated_quota_buckets ORDER BY scope_kind`,
    );
    expect(quota.rows).toEqual([
      { scope_kind: 'household', accepted_count: 20 },
      { scope_kind: 'person', accepted_count: 20 },
    ]);
  });

  it('serializes concurrent household limit plus one across members to exactly fifty charges', async () => {
    const founding = await ProductionFeedbackFoundingFixture.create(database, fixedTestNow);
    const enrollee = await founding.enroll('household-limit');
    const extraActors = ['person-feedback-household-two', 'person-feedback-household-three'];
    await database.query(
      `INSERT INTO persons(id, display_name, created_at) VALUES
         ($1,'Feedback household member two',$3),
         ($2,'Feedback household member three',$3)`,
      [extraActors[0], extraActors[1], fixedTestNow.toISOString()],
    );
    await database.query(
      `INSERT INTO household_memberships(
         household_id, id, person_id, membership_kind, status, created_at
       ) VALUES
         ($1,'membership-feedback-household-two',$2,'member','active',$4),
         ($1,'membership-feedback-household-three',$3,'member','active',$4)`,
      [enrollee.householdId, extraActors[0], extraActors[1], fixedTestNow.toISOString()],
    );
    const actors = [enrollee.actorPersonId, ...extraActors];
    const attempts = await Promise.allSettled(
      Array.from({ length: 51 }, (_unused, index) =>
        createLive({
          enrollee: {
            householdId: enrollee.householdId,
            actorPersonId: actors[index % actors.length] ?? enrollee.actorPersonId,
          },
          request: feedbackRequest({ text: `Household quota attempt number ${index + 1}.` }),
        }),
      ),
    );
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(50);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(await feedbackCounts()).toEqual({
      records: 50,
      operations: 50,
      charges: 50,
      buckets: 4,
    });
    const household = await database.query<
      { readonly accepted_count: number } & Record<string, unknown>
    >(
      `SELECT accepted_count FROM feedback_authenticated_quota_buckets
       WHERE scope_kind = 'household' AND scope_id = $1`,
      [enrollee.householdId],
    );
    expect(household.rows).toEqual([{ accepted_count: 50 }]);
    const people = await database.query<
      { readonly accepted_count: number } & Record<string, unknown>
    >(
      `SELECT accepted_count FROM feedback_authenticated_quota_buckets
       WHERE scope_kind = 'person' ORDER BY scope_id`,
    );
    expect(people.rows).toHaveLength(3);
    expect(people.rows.reduce((sum, row) => sum + row.accepted_count, 0)).toBe(50);
    expect(people.rows.every(({ accepted_count }) => accepted_count <= 20)).toBe(true);
  });

  it('uses database-hour rollover despite caller skew and keeps household scopes isolated', async () => {
    const founding = await ProductionFeedbackFoundingFixture.create(database, fixedTestNow, 2);
    const first = await founding.enroll('clock-first');
    const second = await founding.enroll('clock-second');
    databaseAuthorityNow = new Date('2026-08-15T12:59:59.999Z');
    for (let index = 0; index < 20; index += 1) {
      await createLive({
        enrollee: first,
        request: feedbackRequest({ text: `Database clock first bucket ${index + 1}.` }),
        callerNow: new Date('2050-01-01T00:00:00.000Z'),
      });
    }
    await expect(
      createLive({
        enrollee: first,
        callerNow: new Date('1900-01-01T00:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      createLive({
        enrollee: second,
        callerNow: new Date('1900-01-01T00:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ reused: false });

    databaseAuthorityNow = new Date('2026-08-15T13:00:00.000Z');
    await expect(
      createLive({
        enrollee: first,
        callerNow: new Date('1900-01-01T00:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ reused: false });
    await expect(
      createLive({
        enrollee: {
          householdId: second.householdId,
          actorPersonId: first.actorPersonId,
        },
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });

    const buckets = await database.query<
      {
        readonly scope_kind: string;
        readonly scope_id: string;
        readonly bucket_starts_at: Date;
        readonly accepted_count: number;
      } & Record<string, unknown>
    >(
      `SELECT scope_kind, scope_id, bucket_starts_at, accepted_count
       FROM feedback_authenticated_quota_buckets
       WHERE scope_kind = 'household'
       ORDER BY bucket_starts_at, scope_id`,
    );
    expect(
      buckets.rows.map(({ scope_id, bucket_starts_at, accepted_count }) => ({
        scopeId: scope_id,
        bucket: new Date(bucket_starts_at).toISOString(),
        acceptedCount: accepted_count,
      })),
    ).toEqual([
      {
        scopeId: first.householdId,
        bucket: '2026-08-15T12:00:00.000Z',
        acceptedCount: 20,
      },
      {
        scopeId: second.householdId,
        bucket: '2026-08-15T12:00:00.000Z',
        acceptedCount: 1,
      },
      {
        scopeId: first.householdId,
        bucket: '2026-08-15T13:00:00.000Z',
        acceptedCount: 1,
      },
    ]);
  });
});
