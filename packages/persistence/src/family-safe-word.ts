import { DomainError, type Audience } from '@boomerbuddy/domain';
import {
  createSafeWordVerifier,
  verifySafeWord,
  type SafeWordVerifier,
} from '@boomerbuddy/security';
import type { Database, SqlExecutor } from './database';
import {
  hasEffectiveProtectedEnrollment,
  type EntitlementRuntimeEnvironment,
} from './entitlements';
import { writeAuditAndOutbox } from './events';
import { asDate, jsonValue, randomIdFactory, type IdFactory } from './values';

const verificationWindowMilliseconds = 15 * 60 * 1_000;
const verificationAttemptLimit = 5;
const rateBucketRetentionMilliseconds = 24 * 60 * 60 * 1_000;
const maximumRateBucketCleanupBatchSize = 500;

export const familySafeWordVerificationPolicy = Object.freeze({
  windowSeconds: verificationWindowMilliseconds / 1_000,
  attemptLimit: verificationAttemptLimit,
});

type SafeWordActorKind = 'protected_member' | 'trusted_person';
type SafeWordState = 'configured' | 'disabled';

interface SafeWordRow extends Record<string, unknown> {
  readonly verifier: string;
  readonly lifecycle_revision: number;
  readonly updated_at: unknown;
}

interface LifecycleSummaryRow extends Record<string, unknown> {
  readonly maximum_revision: number | null;
  readonly latest_at: unknown | null;
}

export interface FamilySafeWordStatus {
  readonly state: SafeWordState;
  readonly updatedAt?: Date;
}

export interface FamilySafeWordLifecycleResult extends FamilySafeWordStatus {
  readonly changed: boolean;
}

export type FamilySafeWordVerificationResult =
  | { readonly rateLimited: false; readonly result: 'verified' | 'not_verified' }
  | { readonly rateLimited: true; readonly retryAfterSeconds: number };

export interface FamilySafeWordRateBucketPurgeResult {
  readonly deleted: number;
  readonly saturated: boolean;
}

interface OperationalInput {
  readonly householdId: string;
  readonly protectedPersonId: string;
  readonly actorPersonId: string;
  readonly audience: Audience;
  readonly correlationId: string;
  readonly now: Date;
}

const unavailableVerifier: SafeWordVerifier = Object.freeze({
  algorithm: 'scrypt',
  version: 1,
  salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
  verifier: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  parameters: Object.freeze({
    cost: 16_384,
    blockSize: 8,
    parallelization: 1,
    keyLength: 32,
  }),
  createdAt: '1970-01-01T00:00:00.000Z',
});

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseVerifier(serialized: string): SafeWordVerifier | undefined {
  try {
    const value = record(jsonValue(serialized));
    const parameters = record(value?.parameters);
    if (
      value?.algorithm !== 'scrypt' ||
      value.version !== 1 ||
      typeof value.salt !== 'string' ||
      typeof value.verifier !== 'string' ||
      typeof value.createdAt !== 'string' ||
      parameters?.cost !== 16_384 ||
      parameters.blockSize !== 8 ||
      parameters.parallelization !== 1 ||
      parameters.keyLength !== 32
    ) {
      return undefined;
    }
    return {
      algorithm: 'scrypt',
      version: 1,
      salt: value.salt,
      verifier: value.verifier,
      createdAt: value.createdAt,
      parameters: {
        cost: 16_384,
        blockSize: 8,
        parallelization: 1,
        keyLength: 32,
      },
    };
  } catch {
    return undefined;
  }
}

function windowStart(now: Date): Date {
  return new Date(
    Math.floor(now.getTime() / verificationWindowMilliseconds) * verificationWindowMilliseconds,
  );
}

async function selectVerifier(
  executor: SqlExecutor,
  householdId: string,
  protectedPersonId: string,
  lock = false,
): Promise<SafeWordRow | null> {
  const result = await executor.query<SafeWordRow>(
    `SELECT verifier, lifecycle_revision, updated_at
     FROM safe_word_verifiers
     WHERE household_id = $1 AND protected_person_id = $2${lock ? ' FOR UPDATE' : ''}`,
    [householdId, protectedPersonId],
  );
  return result.rows[0] ?? null;
}

async function lifecycleSummary(
  executor: SqlExecutor,
  householdId: string,
  protectedPersonId: string,
): Promise<{ readonly maximumRevision: number; readonly latestAt?: Date }> {
  const result = await executor.query<LifecycleSummaryRow>(
    `SELECT
            max(lifecycle_revision) FILTER (
              WHERE event_kind IN ('configured', 'replaced', 'disabled')
            )::integer AS maximum_revision,
            max(occurred_at) FILTER (
              WHERE event_kind IN ('configured', 'replaced', 'disabled')
            ) AS latest_at
     FROM family_safe_word_lifecycle_events
     WHERE household_id = $1 AND protected_person_id = $2`,
    [householdId, protectedPersonId],
  );
  const row = result.rows[0];
  const maximumRevision = row?.maximum_revision ?? 0;
  const latestAt = row?.latest_at;
  return {
    maximumRevision,
    ...(latestAt === undefined || latestAt === null
      ? {}
      : { latestAt: asDate(latestAt, 'family_safe_word_lifecycle_events.latest_at') }),
  };
}

export class FamilySafeWordRepository {
  constructor(
    private readonly database: Database,
    private readonly pepper: Uint8Array,
    private readonly idFactory: IdFactory = randomIdFactory,
    private readonly runtimeEnvironment: EntitlementRuntimeEnvironment = 'local',
  ) {}

  async purgeExpiredRateBuckets(
    now: Date,
    limit = 100,
  ): Promise<FamilySafeWordRateBucketPurgeResult> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumRateBucketCleanupBatchSize) {
      throw new TypeError(
        'Family verification rate-bucket cleanup limit must be between 1 and 500',
      );
    }
    const expiredBefore = new Date(now.getTime() - rateBucketRetentionMilliseconds);
    const deleted = await this.database.query<Record<string, unknown>>(
      `WITH due AS (
         SELECT household_id, protected_person_id, actor_person_id, bucket_starts_at
         FROM family_safe_word_rate_buckets
         WHERE bucket_starts_at < $1
         ORDER BY bucket_starts_at, household_id, protected_person_id, actor_person_id
         LIMIT $2
       )
       DELETE FROM family_safe_word_rate_buckets bucket
       USING due
       WHERE bucket.household_id = due.household_id
         AND bucket.protected_person_id = due.protected_person_id
         AND bucket.actor_person_id = due.actor_person_id
         AND bucket.bucket_starts_at = due.bucket_starts_at
       RETURNING 1 AS deleted`,
      [expiredBefore.toISOString(), limit],
    );
    return { deleted: deleted.rowCount, saturated: deleted.rowCount === limit };
  }

  private async assertAuthority(
    executor: SqlExecutor,
    input: Pick<OperationalInput, 'householdId' | 'protectedPersonId' | 'actorPersonId' | 'now'>,
  ): Promise<SafeWordActorKind> {
    if (input.actorPersonId === input.protectedPersonId) {
      const protectedAccess = await hasEffectiveProtectedEnrollment(
        executor,
        input.householdId,
        input.protectedPersonId,
        input.now,
        true,
        this.runtimeEnvironment,
      );
      if (!protectedAccess) {
        throw new DomainError('not_found', 'Family verification aid is unavailable');
      }
      return 'protected_member';
    }

    const relationship = await executor.query(
      `SELECT relationship.id
       FROM trusted_circle_relationships relationship
       JOIN consent_current_projections consent
         ON consent.household_id = relationship.household_id
        AND consent.consent_id = relationship.consent_id
        AND consent.latest_evidence_id = relationship.latest_consent_evidence_id
       JOIN household_memberships protected_membership
         ON protected_membership.household_id = relationship.household_id
        AND protected_membership.person_id = relationship.protected_person_id
       JOIN household_memberships trusted_membership
         ON trusted_membership.household_id = relationship.household_id
        AND trusted_membership.person_id = relationship.trusted_person_id
       WHERE relationship.household_id = $1
         AND relationship.protected_person_id = $2
         AND relationship.trusted_person_id = $3
         AND relationship.state = 'active'
         AND protected_membership.status = 'active'
         AND trusted_membership.status = 'active'
         AND consent.subject_person_id = relationship.protected_person_id
         AND consent.recipient_person_id = relationship.trusted_person_id
         AND consent.purpose = 'trusted_circle_relationship'
         AND consent.state = 'active'
         AND (consent.expires_at IS NULL OR consent.expires_at > $4)
       FOR UPDATE OF relationship, consent, protected_membership, trusted_membership`,
      [input.householdId, input.protectedPersonId, input.actorPersonId, input.now.toISOString()],
    );
    if (relationship.rowCount !== 1) {
      throw new DomainError('not_found', 'Family verification aid is unavailable');
    }
    const protectedAccess = await hasEffectiveProtectedEnrollment(
      executor,
      input.householdId,
      input.protectedPersonId,
      input.now,
      true,
      this.runtimeEnvironment,
    );
    if (!protectedAccess) {
      throw new DomainError('not_found', 'Family verification aid is unavailable');
    }
    return 'trusted_person';
  }

  async getStatus(input: OperationalInput): Promise<FamilySafeWordStatus> {
    return this.database.transaction(async (transaction) => {
      await this.assertAuthority(transaction, input);
      const stored = await selectVerifier(
        transaction,
        input.householdId,
        input.protectedPersonId,
        true,
      );
      if (stored !== null) {
        return {
          state: 'configured',
          updatedAt: asDate(stored.updated_at, 'safe_word_verifiers.updated_at'),
        };
      }
      const summary = await lifecycleSummary(
        transaction,
        input.householdId,
        input.protectedPersonId,
      );
      return {
        state: 'disabled',
        ...(summary.latestAt === undefined ? {} : { updatedAt: summary.latestAt }),
      };
    });
  }

  async verify(
    input: OperationalInput & { readonly phrase: string },
  ): Promise<FamilySafeWordVerificationResult> {
    return this.database.transaction(async (transaction) => {
      const actorKind = await this.assertAuthority(transaction, input);
      const bucket = windowStart(input.now);
      await transaction.query(
        `DELETE FROM family_safe_word_rate_buckets
         WHERE household_id = $1 AND protected_person_id = $2 AND actor_person_id = $3
           AND bucket_starts_at < $4`,
        [
          input.householdId,
          input.protectedPersonId,
          input.actorPersonId,
          new Date(input.now.getTime() - rateBucketRetentionMilliseconds).toISOString(),
        ],
      );
      const consumed = await transaction.query(
        `INSERT INTO family_safe_word_rate_buckets(
           household_id, protected_person_id, actor_person_id,
           bucket_starts_at, used_count, updated_at
         ) VALUES ($1,$2,$3,$4,1,$5)
         ON CONFLICT (household_id, protected_person_id, actor_person_id, bucket_starts_at)
         DO UPDATE SET used_count = family_safe_word_rate_buckets.used_count + 1,
                       updated_at = EXCLUDED.updated_at
         WHERE family_safe_word_rate_buckets.used_count < $6
         RETURNING used_count`,
        [
          input.householdId,
          input.protectedPersonId,
          input.actorPersonId,
          bucket.toISOString(),
          input.now.toISOString(),
          verificationAttemptLimit,
        ],
      );
      if (consumed.rowCount !== 1) {
        return {
          rateLimited: true,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil(
              (bucket.getTime() + verificationWindowMilliseconds - input.now.getTime()) / 1_000,
            ),
          ),
        };
      }

      const stored = await selectVerifier(
        transaction,
        input.householdId,
        input.protectedPersonId,
        true,
      );
      const matches = await verifySafeWord(
        input.phrase,
        stored === null
          ? unavailableVerifier
          : (parseVerifier(stored.verifier) ?? unavailableVerifier),
        this.pepper,
      );
      const result = stored !== null && matches ? 'verified' : 'not_verified';
      await transaction.query(
        `INSERT INTO family_safe_word_lifecycle_events(
           household_id, id, protected_person_id, actor_person_id, actor_kind,
           event_kind, lifecycle_revision, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          input.householdId,
          this.idFactory.next('family_verification_event'),
          input.protectedPersonId,
          input.actorPersonId,
          actorKind,
          result === 'verified' ? 'verification_succeeded' : 'verification_failed',
          stored?.lifecycle_revision ?? null,
          input.now.toISOString(),
        ],
      );
      return { rateLimited: false, result };
    });
  }

  async replace(
    input: OperationalInput & { readonly phrase: string },
  ): Promise<FamilySafeWordLifecycleResult> {
    if (input.actorPersonId !== input.protectedPersonId) {
      throw new DomainError('not_found', 'Family verification aid is unavailable');
    }
    return this.database.transaction(async (transaction) => {
      const actorKind = await this.assertAuthority(transaction, input);
      const verifier = await createSafeWordVerifier(input.phrase, this.pepper, input.now);
      const stored = await selectVerifier(
        transaction,
        input.householdId,
        input.protectedPersonId,
        true,
      );
      const summary = await lifecycleSummary(
        transaction,
        input.householdId,
        input.protectedPersonId,
      );
      const revision = Math.max(stored?.lifecycle_revision ?? 0, summary.maximumRevision) + 1;
      const eventKind =
        stored === null && summary.maximumRevision === 0 ? 'configured' : 'replaced';
      await transaction.query(
        `INSERT INTO safe_word_verifiers(
           household_id, protected_person_id, verifier, version,
           updated_at, lifecycle_revision
         ) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (household_id, protected_person_id) DO UPDATE
           SET verifier = EXCLUDED.verifier,
               version = EXCLUDED.version,
               updated_at = EXCLUDED.updated_at,
               lifecycle_revision = EXCLUDED.lifecycle_revision`,
        [
          input.householdId,
          input.protectedPersonId,
          JSON.stringify(verifier),
          verifier.version,
          input.now.toISOString(),
          revision,
        ],
      );
      await this.recordChange(transaction, input, actorKind, eventKind, revision, 'configured');
      return { state: 'configured', changed: true, updatedAt: input.now };
    });
  }

  async disable(input: OperationalInput): Promise<FamilySafeWordLifecycleResult> {
    if (input.actorPersonId !== input.protectedPersonId) {
      throw new DomainError('not_found', 'Family verification aid is unavailable');
    }
    return this.database.transaction(async (transaction) => {
      const actorKind = await this.assertAuthority(transaction, input);
      const stored = await selectVerifier(
        transaction,
        input.householdId,
        input.protectedPersonId,
        true,
      );
      const summary = await lifecycleSummary(
        transaction,
        input.householdId,
        input.protectedPersonId,
      );
      if (stored === null) {
        return {
          state: 'disabled',
          changed: false,
          ...(summary.latestAt === undefined ? {} : { updatedAt: summary.latestAt }),
        };
      }
      const revision = Math.max(stored.lifecycle_revision, summary.maximumRevision) + 1;
      await transaction.query(
        'DELETE FROM safe_word_verifiers WHERE household_id = $1 AND protected_person_id = $2',
        [input.householdId, input.protectedPersonId],
      );
      await this.recordChange(transaction, input, actorKind, 'disabled', revision, 'disabled');
      return { state: 'disabled', changed: true, updatedAt: input.now };
    });
  }

  private async recordChange(
    transaction: SqlExecutor,
    input: OperationalInput,
    actorKind: SafeWordActorKind,
    eventKind: 'configured' | 'replaced' | 'disabled',
    revision: number,
    state: SafeWordState,
  ): Promise<void> {
    await transaction.query(
      `INSERT INTO family_safe_word_lifecycle_events(
         household_id, id, protected_person_id, actor_person_id, actor_kind,
         event_kind, lifecycle_revision, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.householdId,
        this.idFactory.next('family_verification_event'),
        input.protectedPersonId,
        input.actorPersonId,
        actorKind,
        eventKind,
        revision,
        input.now.toISOString(),
      ],
    );
    await writeAuditAndOutbox(
      transaction,
      this.idFactory,
      {
        householdId: input.householdId,
        actorPersonId: input.actorPersonId,
        audience: input.audience,
        correlationId: input.correlationId,
        now: input.now,
      },
      {
        action: `family.verification_aid_${eventKind}`,
        resourceType: 'family_verification_aid',
        resourceId: input.protectedPersonId,
        outcome: 'completed',
        metadata: { state, revision },
      },
      {
        eventType: `family.verification_aid_${eventKind}.v1`,
        aggregateType: 'family_verification_aid',
        aggregateId: input.protectedPersonId,
        payload: { state, revision },
      },
    );
  }
}
