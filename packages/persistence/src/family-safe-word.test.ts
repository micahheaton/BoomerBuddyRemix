import { createSeededTestDatabase } from '@boomerbuddy/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database } from './database';
import { FamilySafeWordRepository } from './family-safe-word';

const pepper = new TextEncoder().encode('local-family-safe-word-test-pepper');
const now = new Date('2026-08-27T12:00:00.000Z');

function operation(
  actorPersonId: string,
  sequence: number,
  at = now,
): {
  readonly householdId: string;
  readonly protectedPersonId: string;
  readonly actorPersonId: string;
  readonly audience: 'customer';
  readonly correlationId: string;
  readonly now: Date;
} {
  return {
    householdId: 'household-sunrise',
    protectedPersonId: 'person-protected-pat',
    actorPersonId,
    audience: 'customer',
    correlationId: `correlation-family-verification-${sequence}`,
    now: at,
  };
}

describe('Family Safe Word repository', () => {
  let database: Database | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it('keeps verification pairwise, non-revealing, rate-limited, and content-free', async () => {
    database = await createSeededTestDatabase(now);
    const repository = new FamilySafeWordRepository(database, pepper);
    const phrase = 'Sunrise lantern seven';

    const configured = await repository.replace({
      ...operation('person-protected-pat', 1),
      phrase,
    });
    expect(configured).toMatchObject({ state: 'configured', changed: true });
    expect(await repository.getStatus(operation('person-trusted-terry', 2))).toMatchObject({
      state: 'configured',
    });

    const protectedResult = await repository.verify({
      ...operation('person-protected-pat', 3),
      phrase,
    });
    const trustedResult = await repository.verify({
      ...operation('person-trusted-terry', 4),
      phrase: phrase.toUpperCase(),
    });
    expect(protectedResult).toEqual({ rateLimited: false, result: 'verified' });
    expect(trustedResult).toEqual({ rateLimited: false, result: 'verified' });

    await expect(
      repository.verify({
        ...operation('person-owner-alice', 5),
        phrase,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        repository.verify({
          ...operation('person-trusted-terry', 10 + attempt),
          phrase: `Wrong phrase ${attempt}`,
        }),
      ).resolves.toEqual({ rateLimited: false, result: 'not_verified' });
    }
    const limited = await repository.verify({
      ...operation('person-trusted-terry', 20),
      phrase,
    });
    expect(limited).toEqual({ rateLimited: true, retryAfterSeconds: 900 });

    const stored = await database.query<{ readonly verifier: string }>(
      `SELECT verifier FROM safe_word_verifiers
       WHERE household_id = 'household-sunrise'
         AND protected_person_id = 'person-protected-pat'`,
    );
    expect(stored.rows[0]?.verifier).not.toContain(phrase);

    const operational = await database.query<{
      readonly audit_metadata: string;
      readonly outbox_payload: string;
    }>(
      `SELECT
         coalesce(string_agg(audit.metadata::text, ' '), '') AS audit_metadata,
         coalesce(string_agg(outbox.payload::text, ' '), '') AS outbox_payload
       FROM audit_events audit
       FULL JOIN outbox_events outbox
         ON outbox.correlation_id = audit.correlation_id
       WHERE audit.action LIKE 'family.verification_aid_%'
          OR outbox.event_type LIKE 'family.verification_aid_%'`,
    );
    expect(JSON.stringify(operational.rows)).not.toContain(phrase);

    const attempts = await database.query<{ readonly count: number }>(
      `SELECT count(*)::integer AS count
       FROM family_safe_word_lifecycle_events
       WHERE household_id = 'household-sunrise'
         AND protected_person_id = 'person-protected-pat'
         AND actor_person_id = 'person-trusted-terry'
         AND event_kind LIKE 'verification_%'`,
    );
    expect(attempts.rows[0]?.count).toBe(5);
  }, 60_000);

  it('replaces and disables only for the protected person with append-only evidence', async () => {
    database = await createSeededTestDatabase(now);
    const repository = new FamilySafeWordRepository(database, pepper);
    const originalPhrase = 'Harbor candle twelve';
    const replacementPhrase = 'Garden compass nine';

    await repository.replace({
      ...operation('person-protected-pat', 30),
      phrase: originalPhrase,
    });
    await expect(
      repository.replace({
        ...operation('person-trusted-terry', 31),
        phrase: replacementPhrase,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });

    const replacementTime = new Date(now.getTime() + 1_000);
    const replaced = await repository.replace({
      ...operation('person-protected-pat', 32, replacementTime),
      phrase: replacementPhrase,
    });
    expect(replaced).toMatchObject({ state: 'configured', changed: true });
    await expect(
      repository.verify({
        ...operation('person-protected-pat', 33, replacementTime),
        phrase: originalPhrase,
      }),
    ).resolves.toEqual({ rateLimited: false, result: 'not_verified' });
    await expect(
      repository.verify({
        ...operation('person-protected-pat', 34, replacementTime),
        phrase: replacementPhrase,
      }),
    ).resolves.toEqual({ rateLimited: false, result: 'verified' });

    const disableTime = new Date(now.getTime() + 2_000);
    const disabled = await repository.disable(operation('person-protected-pat', 35, disableTime));
    expect(disabled).toMatchObject({ state: 'disabled', changed: true });
    const postDisableVerificationTime = new Date(now.getTime() + 3_000);
    await expect(
      repository.verify({
        ...operation('person-protected-pat', 36, postDisableVerificationTime),
        phrase: replacementPhrase,
      }),
    ).resolves.toEqual({ rateLimited: false, result: 'not_verified' });
    expect(
      await repository.disable(operation('person-protected-pat', 37, postDisableVerificationTime)),
    ).toEqual({ state: 'disabled', changed: false, updatedAt: disableTime });

    const changes = await database.query<{
      readonly event_kind: string;
      readonly lifecycle_revision: number;
    }>(
      `SELECT event_kind, lifecycle_revision
       FROM family_safe_word_lifecycle_events
       WHERE household_id = 'household-sunrise'
         AND protected_person_id = 'person-protected-pat'
         AND event_kind IN ('configured', 'replaced', 'disabled')
       ORDER BY lifecycle_revision`,
    );
    expect(changes.rows).toEqual([
      { event_kind: 'configured', lifecycle_revision: 1 },
      { event_kind: 'replaced', lifecycle_revision: 2 },
      { event_kind: 'disabled', lifecycle_revision: 3 },
    ]);
    await expect(
      database.query(
        `UPDATE family_safe_word_lifecycle_events
         SET event_kind = 'verification_failed'
         WHERE household_id = 'household-sunrise'`,
      ),
    ).rejects.toThrow('append-only');
    await expect(
      database.query(
        `INSERT INTO family_safe_word_lifecycle_events(
           household_id, id, protected_person_id, actor_person_id, actor_kind,
           event_kind, lifecycle_revision, occurred_at
         ) VALUES (
           'household-sunrise', 'forged-event', 'person-protected-pat',
           'person-owner-alice', 'trusted_person', 'verification_succeeded', 3, $1
         )`,
        [disableTime.toISOString()],
      ),
    ).rejects.toThrow('exact active relationship');
  }, 60_000);

  it('purges expired rate buckets globally without another attempt from the same pair', async () => {
    database = await createSeededTestDatabase(now);
    const repository = new FamilySafeWordRepository(database, pepper);
    await database.query(
      `INSERT INTO family_safe_word_rate_buckets(
         household_id, protected_person_id, actor_person_id,
         bucket_starts_at, used_count, updated_at
       ) VALUES
         ('household-sunrise','person-protected-pat','person-protected-pat',$1,1,$1),
         ('household-sunrise','person-protected-pat','person-trusted-terry',$2,1,$2),
         ('household-sunrise','person-protected-pat','person-trusted-terry',$3,1,$3)`,
      [
        new Date(now.getTime() - 26 * 60 * 60_000).toISOString(),
        new Date(now.getTime() - 25 * 60 * 60_000).toISOString(),
        new Date(now.getTime() - 60 * 60_000).toISOString(),
      ],
    );

    await expect(repository.purgeExpiredRateBuckets(now, 1)).resolves.toEqual({
      deleted: 1,
      saturated: true,
    });
    await expect(repository.purgeExpiredRateBuckets(now, 100)).resolves.toEqual({
      deleted: 1,
      saturated: false,
    });
    const remaining = await database.query<{ readonly count: number }>(
      'SELECT count(*)::integer AS count FROM family_safe_word_rate_buckets',
    );
    expect(remaining.rows[0]?.count).toBe(1);
  }, 60_000);

  it('cascades verifier, rate, and append-only lifecycle rows on account or household deletion', async () => {
    database = await createSeededTestDatabase(now);
    for (const suffix of ['account', 'household'] as const) {
      await database.query(`INSERT INTO persons(id, display_name, created_at) VALUES ($1,$2,$3)`, [
        `person-safe-delete-${suffix}`,
        `Delete ${suffix}`,
        now.toISOString(),
      ]);
      await database.query(`INSERT INTO households(id, name, created_at) VALUES ($1,$2,$3)`, [
        `household-safe-delete-${suffix}`,
        `Delete ${suffix}`,
        now.toISOString(),
      ]);
      await database.query(
        `INSERT INTO household_memberships(
           household_id, id, person_id, membership_kind, status, created_at
         ) VALUES ($1,$2,$3,'member','active',$4)`,
        [
          `household-safe-delete-${suffix}`,
          `membership-safe-delete-${suffix}`,
          `person-safe-delete-${suffix}`,
          now.toISOString(),
        ],
      );
      await database.query(
        `INSERT INTO safe_word_verifiers(
           household_id, protected_person_id, verifier, version, updated_at, lifecycle_revision
         ) VALUES ($1,$2,'{}',1,$3,1)`,
        [`household-safe-delete-${suffix}`, `person-safe-delete-${suffix}`, now.toISOString()],
      );
      await database.query(
        `INSERT INTO family_safe_word_rate_buckets(
           household_id, protected_person_id, actor_person_id,
           bucket_starts_at, used_count, updated_at
         ) VALUES ($1,$2,$2,$3,1,$3)`,
        [`household-safe-delete-${suffix}`, `person-safe-delete-${suffix}`, now.toISOString()],
      );
      await database.query(
        `INSERT INTO family_safe_word_lifecycle_events(
           household_id, id, protected_person_id, actor_person_id, actor_kind,
           event_kind, lifecycle_revision, occurred_at
         ) VALUES ($1,$2,$3,$3,'protected_member','configured',1,$4)`,
        [
          `household-safe-delete-${suffix}`,
          `event-safe-delete-${suffix}`,
          `person-safe-delete-${suffix}`,
          now.toISOString(),
        ],
      );
    }

    await database.query(`DELETE FROM persons WHERE id = 'person-safe-delete-account'`);
    await database.query(`DELETE FROM households WHERE id = 'household-safe-delete-household'`);
    const retained = await database.query<{
      readonly verifiers: number;
      readonly buckets: number;
      readonly events: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM safe_word_verifiers
           WHERE household_id LIKE 'household-safe-delete-%') AS verifiers,
         (SELECT count(*)::integer FROM family_safe_word_rate_buckets
           WHERE household_id LIKE 'household-safe-delete-%') AS buckets,
         (SELECT count(*)::integer FROM family_safe_word_lifecycle_events
           WHERE household_id LIKE 'household-safe-delete-%') AS events`,
    );
    expect(retained.rows[0]).toEqual({ verifiers: 0, buckets: 0, events: 0 });
  }, 60_000);
});
