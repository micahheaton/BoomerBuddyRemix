import { createHmac, randomBytes } from 'node:crypto';
import {
  accessIntentOperationKeySchema,
  type AccessIntentAttribution,
} from '@boomerbuddy/contracts';
import { DomainError } from '@boomerbuddy/domain';
import { constantTimeEqual, lengthPrefixed } from '@boomerbuddy/security';
import type { Database, SqlExecutor } from './database';
import { asDate } from './values';

const accessIntentPurpose = 'private_beta_access_request' as const;
const receiptTtlMs = 7 * 24 * 60 * 60_000;
const expiredReceiptRetentionMs = 24 * 60 * 60_000;
const aggregateRetentionMs = 90 * 24 * 60 * 60_000;
const creationCleanupBatchSize = 25;
const maximumCleanupBatchSize = 500;

interface AccessIntentRow extends Record<string, unknown> {
  readonly receipt_code: string;
  readonly request_digest: string;
  readonly purpose: typeof accessIntentPurpose;
  readonly attribution_source: AccessIntentAttribution['source'];
  readonly attribution_campaign: AccessIntentAttribution['campaign'];
  readonly lifecycle_state: 'intent_created';
  readonly created_at: unknown;
  readonly expires_at: unknown;
}

export interface AccessIntentReceipt {
  readonly receiptCode: string;
  readonly purpose: typeof accessIntentPurpose;
  readonly attribution: AccessIntentAttribution;
  readonly lifecycle: 'intent_created';
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface AccessIntentProjection extends Omit<AccessIntentReceipt, 'lifecycle'> {
  readonly lifecycle: 'intent_created' | 'expired';
}

export interface AccessIntentPurgeResult {
  readonly receiptsDeleted: number;
  readonly rateBucketsDeleted: number;
  readonly aggregatesDeleted: number;
  readonly saturated: boolean;
}

function allowedAttribution(attribution: AccessIntentAttribution): boolean {
  return (
    (attribution.source === 'direct' && attribution.campaign === 'none') ||
    (attribution.source === 'organic' && attribution.campaign === 'none') ||
    (attribution.source === 'partner' && attribution.campaign === 'trusted_partner') ||
    (attribution.source === 'campaign' && attribution.campaign === 'launch_2026')
  );
}

function hourBucket(now: Date): string {
  return new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString();
}

async function consumeQuota(
  executor: SqlExecutor,
  input: {
    readonly bucketStart: string;
    readonly scope: 'global' | 'network';
    readonly scopeKey: string;
    readonly maximum: number;
  },
): Promise<void> {
  const quota = await executor.query<Record<string, unknown>>(
    `INSERT INTO private_beta_access_intent_rate_buckets(
       bucket_start, scope, scope_key_hmac, used_count
     ) VALUES ($1,$2,$3,1)
     ON CONFLICT (bucket_start, scope, scope_key_hmac) DO UPDATE
     SET used_count = private_beta_access_intent_rate_buckets.used_count + 1
     WHERE private_beta_access_intent_rate_buckets.used_count < $4
     RETURNING used_count`,
    [input.bucketStart, input.scope, input.scopeKey, input.maximum],
  );
  if (quota.rowCount !== 1) {
    throw new DomainError('conflict', 'Private-beta access requests are temporarily limited');
  }
}

export class AccessIntentRepository {
  constructor(
    private readonly database: Database,
    private readonly hmacKey: Uint8Array,
    private readonly maximumPerNetworkHour = 5,
    private readonly maximumGlobalHour = 500,
  ) {
    if (hmacKey.byteLength < 32) {
      throw new TypeError('Access-intent HMAC key must contain at least 32 bytes');
    }
    if (
      !Number.isSafeInteger(maximumPerNetworkHour) ||
      maximumPerNetworkHour < 1 ||
      !Number.isSafeInteger(maximumGlobalHour) ||
      maximumGlobalHour < 1 ||
      maximumPerNetworkHour > maximumGlobalHour
    ) {
      throw new TypeError('Access-intent quotas must be positive safe integers');
    }
  }

  clientKeyForNetworkAddress(networkAddress: string): string {
    const normalized = networkAddress.trim().toLowerCase();
    if (normalized.length === 0 || normalized.length > 256) {
      throw new DomainError('invalid_input', 'Access-intent client address is unavailable');
    }
    return createHmac('sha256', this.hmacKey)
      .update(lengthPrefixed(['boomerbuddy:private-beta-access-intent-client:v1', normalized]))
      .digest('base64url');
  }

  async create(input: {
    readonly purpose: typeof accessIntentPurpose;
    readonly attribution: AccessIntentAttribution;
    readonly clientKey: string;
    readonly operationKey: string;
    readonly now: Date;
  }): Promise<AccessIntentReceipt> {
    if (input.purpose !== accessIntentPurpose || !allowedAttribution(input.attribution)) {
      throw new DomainError('invalid_input', 'Access-intent purpose or attribution is unavailable');
    }
    if (!/^[A-Za-z0-9_-]{43}$/u.test(input.clientKey)) {
      throw new DomainError('invalid_input', 'Access-intent client identity is invalid');
    }
    accessIntentOperationKeySchema.parse(input.operationKey);
    const operationKeyHmac = createHmac('sha256', this.hmacKey)
      .update(
        lengthPrefixed(['boomerbuddy:private-beta-access-intent-operation:v1', input.operationKey]),
      )
      .digest('base64url');
    const requestDigest = createHmac('sha256', this.hmacKey)
      .update(
        lengthPrefixed([
          'boomerbuddy:private-beta-access-intent-request:v1',
          input.purpose,
          input.attribution.source,
          input.attribution.campaign,
        ]),
      )
      .digest('base64url');
    const receiptCode = `access_intent_${randomBytes(24).toString('base64url')}`;
    const createdAt = new Date(input.now);
    const expiresAt = new Date(createdAt.getTime() + receiptTtlMs);
    const bucketStart = hourBucket(createdAt);
    return this.database.transaction(async (transaction): Promise<AccessIntentReceipt> => {
      await transaction.query(
        'SELECT id FROM private_beta_access_intent_gate WHERE id = 1 FOR UPDATE',
      );
      await this.purgeWithExecutor(transaction, createdAt, creationCleanupBatchSize);
      const prior = await transaction.query<AccessIntentRow>(
        `SELECT receipt_code, request_digest, purpose, attribution_source,
                attribution_campaign, lifecycle_state, created_at, expires_at
         FROM private_beta_access_intent_receipts
         WHERE operation_key_hmac = $1`,
        [operationKeyHmac],
      );
      const priorRow = prior.rows[0];
      if (priorRow !== undefined) {
        if (!constantTimeEqual(priorRow.request_digest, requestDigest)) {
          throw new DomainError('conflict', 'Access-intent idempotency key was already used');
        }
        if (asDate(priorRow.expires_at, 'access-intent expiry') <= createdAt) {
          throw new DomainError('expired', 'Access-intent receipt has expired');
        }
        return {
          receiptCode: priorRow.receipt_code,
          purpose: priorRow.purpose,
          attribution: {
            source: priorRow.attribution_source,
            campaign: priorRow.attribution_campaign,
          },
          lifecycle: priorRow.lifecycle_state,
          createdAt: asDate(priorRow.created_at, 'access-intent creation'),
          expiresAt: asDate(priorRow.expires_at, 'access-intent expiry'),
        };
      }
      await consumeQuota(transaction, {
        bucketStart,
        scope: 'global',
        scopeKey: 'global',
        maximum: this.maximumGlobalHour,
      });
      await consumeQuota(transaction, {
        bucketStart,
        scope: 'network',
        scopeKey: input.clientKey,
        maximum: this.maximumPerNetworkHour,
      });
      await transaction.query(
        `INSERT INTO private_beta_access_intent_receipts(
           receipt_code, operation_key_hmac, request_digest, purpose,
           attribution_source, attribution_campaign, lifecycle_state, created_at, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'intent_created',$7,$8)`,
        [
          receiptCode,
          operationKeyHmac,
          requestDigest,
          accessIntentPurpose,
          input.attribution.source,
          input.attribution.campaign,
          createdAt.toISOString(),
          expiresAt.toISOString(),
        ],
      );
      await transaction.query(
        `INSERT INTO private_beta_access_intent_aggregates(
           bucket_start, attribution_source, attribution_campaign, event_kind, event_count
         ) VALUES ($1,$2,$3,'intent_created',1)
         ON CONFLICT (
           bucket_start, attribution_source, attribution_campaign, event_kind
         ) DO UPDATE
         SET event_count = private_beta_access_intent_aggregates.event_count + 1`,
        [
          createdAt.toISOString().slice(0, 10),
          input.attribution.source,
          input.attribution.campaign,
        ],
      );
      return {
        receiptCode,
        purpose: accessIntentPurpose,
        attribution: input.attribution,
        lifecycle: 'intent_created',
        createdAt,
        expiresAt,
      };
    });
  }

  async purgeExpired(now: Date, limit = 100): Promise<AccessIntentPurgeResult> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumCleanupBatchSize) {
      throw new TypeError('Access-intent cleanup limit must be between 1 and 500');
    }
    return this.database.transaction(async (transaction) => {
      await transaction.query(
        'SELECT id FROM private_beta_access_intent_gate WHERE id = 1 FOR UPDATE',
      );
      return this.purgeWithExecutor(transaction, now, limit);
    });
  }

  private async purgeWithExecutor(
    executor: SqlExecutor,
    now: Date,
    limit: number,
  ): Promise<AccessIntentPurgeResult> {
    const expiredBefore = new Date(now.getTime() - expiredReceiptRetentionMs);
    const receipts = await executor.query<Record<string, unknown>>(
      `WITH due AS (
         SELECT receipt_code
         FROM private_beta_access_intent_receipts
         WHERE expires_at <= $1
         ORDER BY expires_at, receipt_code
         LIMIT $2
       )
       DELETE FROM private_beta_access_intent_receipts AS receipt
       USING due
       WHERE receipt.receipt_code = due.receipt_code
       RETURNING 1 AS deleted`,
      [expiredBefore.toISOString(), limit],
    );
    const rateBuckets = await executor.query<Record<string, unknown>>(
      `WITH due AS (
         SELECT bucket_start, scope, scope_key_hmac
         FROM private_beta_access_intent_rate_buckets
         WHERE bucket_start < $1
         ORDER BY bucket_start, scope, scope_key_hmac
         LIMIT $2
       )
       DELETE FROM private_beta_access_intent_rate_buckets AS bucket
       USING due
       WHERE bucket.bucket_start = due.bucket_start
         AND bucket.scope = due.scope
         AND bucket.scope_key_hmac = due.scope_key_hmac
       RETURNING 1 AS deleted`,
      [new Date(now.getTime() - 2 * 3_600_000).toISOString(), limit],
    );
    const aggregates = await executor.query<Record<string, unknown>>(
      `WITH due AS (
         SELECT bucket_start, attribution_source, attribution_campaign, event_kind
         FROM private_beta_access_intent_aggregates
         WHERE bucket_start < $1
         ORDER BY bucket_start, attribution_source, attribution_campaign, event_kind
         LIMIT $2
       )
       DELETE FROM private_beta_access_intent_aggregates AS aggregate
       USING due
       WHERE aggregate.bucket_start = due.bucket_start
         AND aggregate.attribution_source = due.attribution_source
         AND aggregate.attribution_campaign = due.attribution_campaign
         AND aggregate.event_kind = due.event_kind
       RETURNING 1 AS deleted`,
      [new Date(now.getTime() - aggregateRetentionMs).toISOString().slice(0, 10), limit],
    );
    return {
      receiptsDeleted: receipts.rowCount,
      rateBucketsDeleted: rateBuckets.rowCount,
      aggregatesDeleted: aggregates.rowCount,
      saturated:
        receipts.rowCount === limit ||
        rateBuckets.rowCount === limit ||
        aggregates.rowCount === limit,
    };
  }
}
