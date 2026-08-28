import type { Database, SqlExecutor } from './database';
import { asDate } from './values';

const millisecondsPerDay = 86_400_000;

export const mobileJtiSessionRetentionGraceMilliseconds = millisecondsPerDay;
export const defaultMobileJtiSessionCleanupLimit = 250;
export const maximumMobileJtiSessionCleanupLimit = 1_000;

interface MobileJtiSessionRetentionRow extends Record<string, unknown> {
  readonly total_session_count: number;
  readonly expired_session_count: number;
  readonly retained_in_grace_count: number;
  readonly cleanup_eligible_count: number;
  readonly evidence_protected_count: number;
  readonly consent_evidence_protected_count: number;
  readonly founding_household_evidence_protected_count: number;
  readonly revocation_protected_count: number;
  readonly oldest_cleanup_eligible_expires_at: unknown;
}

interface MobileJtiSessionCleanupRow extends Record<string, unknown> {
  readonly deleted_count: number;
  readonly oldest_deleted_expires_at: unknown;
  readonly newest_deleted_expires_at: unknown;
}

interface CountRow extends Record<string, unknown> {
  readonly count: number;
}

export interface MobileJtiSessionRetentionSnapshot {
  readonly observedAt: Date;
  readonly cleanupEligibleBefore: Date;
  readonly totalSessionCount: number;
  readonly expiredSessionCount: number;
  readonly retainedInGraceCount: number;
  readonly cleanupEligibleCount: number;
  readonly evidenceProtectedCount: number;
  readonly consentEvidenceProtectedCount: number;
  readonly foundingHouseholdEvidenceProtectedCount: number;
  readonly revocationProtectedCount: number;
  readonly oldestCleanupEligibleExpiresAt?: Date;
}

export interface MobileJtiSessionCleanupResult {
  readonly observedAt: Date;
  readonly cleanupEligibleBefore: Date;
  readonly requestedLimit: number;
  readonly deletedCount: number;
  readonly remainingEligibleCount: number;
  readonly oldestDeletedExpiresAt?: Date;
  readonly newestDeletedExpiresAt?: Date;
}

function retentionCutoff(now: Date): Date {
  if (Number.isNaN(now.getTime())) {
    throw new TypeError('Mobile session retention requires a valid observation time');
  }
  return new Date(now.getTime() - mobileJtiSessionRetentionGraceMilliseconds);
}

function cleanupLimit(limit: number | undefined): number {
  const value = limit ?? defaultMobileJtiSessionCleanupLimit;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximumMobileJtiSessionCleanupLimit) {
    throw new TypeError(
      `Mobile session cleanup limit must be an integer between 1 and ${maximumMobileJtiSessionCleanupLimit}`,
    );
  }
  return value;
}

function optionalDate(value: unknown, field: string): Date | undefined {
  return value === null || value === undefined ? undefined : asDate(value, field);
}

const cleanupEligibilityPredicate = `
  session.audience = 'mobile'
  AND session.provider_session_id <> session.id
  AND session.expires_at <= $1
  AND NOT EXISTS (
    SELECT 1 FROM provider_session_revocations revocation
    WHERE revocation.session_id = session.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM consent_evidence evidence
    WHERE evidence.session_id = session.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM founding_household_enrollments enrollment
    WHERE enrollment.accepted_session_id = session.id
  )`;

async function remainingEligibleCount(executor: SqlExecutor, cutoff: Date): Promise<number> {
  const result = await executor.query<CountRow>(
    `SELECT count(*)::integer AS count
     FROM sessions session
     WHERE ${cleanupEligibilityPredicate}`,
    [cutoff.toISOString()],
  );
  return result.rows[0]?.count ?? 0;
}

export class MobileJtiSessionRetentionRepository {
  constructor(private readonly database: Database) {}

  async monitor(now: Date): Promise<MobileJtiSessionRetentionSnapshot> {
    const cutoff = retentionCutoff(now);
    const result = await this.database.query<MobileJtiSessionRetentionRow>(
      `WITH mobile_jti_session AS (
         SELECT session.id, session.expires_at,
                EXISTS (
                  SELECT 1 FROM provider_session_revocations revocation
                  WHERE revocation.session_id = session.id
                ) AS has_revocation,
                EXISTS (
                  SELECT 1 FROM consent_evidence evidence
                  WHERE evidence.session_id = session.id
                ) AS has_consent_evidence,
                EXISTS (
                  SELECT 1 FROM founding_household_enrollments enrollment
                  WHERE enrollment.accepted_session_id = session.id
                ) AS has_founding_household_evidence
         FROM sessions session
         WHERE session.audience = 'mobile'
           AND session.provider_session_id <> session.id
       )
       SELECT count(*)::integer AS total_session_count,
              count(*) FILTER (WHERE expires_at <= $2)::integer AS expired_session_count,
              count(*) FILTER (
                WHERE expires_at <= $2 AND expires_at > $1
              )::integer AS retained_in_grace_count,
              count(*) FILTER (
                WHERE expires_at <= $1
                  AND NOT has_revocation
                  AND NOT has_consent_evidence
                  AND NOT has_founding_household_evidence
              )::integer AS cleanup_eligible_count,
              count(*) FILTER (
                WHERE expires_at <= $1
                  AND (has_consent_evidence OR has_founding_household_evidence)
              )::integer AS evidence_protected_count,
              count(*) FILTER (
                WHERE expires_at <= $1 AND has_consent_evidence
              )::integer AS consent_evidence_protected_count,
              count(*) FILTER (
                WHERE expires_at <= $1 AND has_founding_household_evidence
              )::integer AS founding_household_evidence_protected_count,
              count(*) FILTER (
                WHERE expires_at <= $1 AND has_revocation
              )::integer AS revocation_protected_count,
              min(expires_at) FILTER (
                WHERE expires_at <= $1
                  AND NOT has_revocation
                  AND NOT has_consent_evidence
                  AND NOT has_founding_household_evidence
              ) AS oldest_cleanup_eligible_expires_at
       FROM mobile_jti_session`,
      [cutoff.toISOString(), now.toISOString()],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('Mobile session retention monitor returned no row');
    const oldestCleanupEligibleExpiresAt = optionalDate(
      row.oldest_cleanup_eligible_expires_at,
      'mobile_jti_session.oldest_cleanup_eligible_expires_at',
    );
    return {
      observedAt: new Date(now),
      cleanupEligibleBefore: cutoff,
      totalSessionCount: row.total_session_count,
      expiredSessionCount: row.expired_session_count,
      retainedInGraceCount: row.retained_in_grace_count,
      cleanupEligibleCount: row.cleanup_eligible_count,
      evidenceProtectedCount: row.evidence_protected_count,
      consentEvidenceProtectedCount: row.consent_evidence_protected_count,
      foundingHouseholdEvidenceProtectedCount: row.founding_household_evidence_protected_count,
      revocationProtectedCount: row.revocation_protected_count,
      ...(oldestCleanupEligibleExpiresAt === undefined ? {} : { oldestCleanupEligibleExpiresAt }),
    };
  }

  async cleanup(input: {
    readonly now: Date;
    readonly limit?: number;
  }): Promise<MobileJtiSessionCleanupResult> {
    const cutoff = retentionCutoff(input.now);
    const limit = cleanupLimit(input.limit);
    return this.database.transaction(async (transaction) => {
      const deleted = await transaction.query<MobileJtiSessionCleanupRow>(
        `WITH candidate AS (
           SELECT session.id
           FROM sessions session
           WHERE ${cleanupEligibilityPredicate}
           ORDER BY session.expires_at, session.id
           LIMIT $2
           FOR UPDATE OF session SKIP LOCKED
         ), deleted AS (
           DELETE FROM sessions session
           USING candidate
           WHERE session.id = candidate.id
           RETURNING session.expires_at
         )
         SELECT count(*)::integer AS deleted_count,
                min(expires_at) AS oldest_deleted_expires_at,
                max(expires_at) AS newest_deleted_expires_at
         FROM deleted`,
        [cutoff.toISOString(), limit],
      );
      const row = deleted.rows[0];
      if (row === undefined) throw new Error('Mobile session cleanup returned no row');
      const oldestDeletedExpiresAt = optionalDate(
        row.oldest_deleted_expires_at,
        'mobile_jti_session.oldest_deleted_expires_at',
      );
      const newestDeletedExpiresAt = optionalDate(
        row.newest_deleted_expires_at,
        'mobile_jti_session.newest_deleted_expires_at',
      );
      return {
        observedAt: new Date(input.now),
        cleanupEligibleBefore: cutoff,
        requestedLimit: limit,
        deletedCount: row.deleted_count,
        remainingEligibleCount: await remainingEligibleCount(transaction, cutoff),
        ...(oldestDeletedExpiresAt === undefined ? {} : { oldestDeletedExpiresAt }),
        ...(newestDeletedExpiresAt === undefined ? {} : { newestDeletedExpiresAt }),
      };
    });
  }
}
