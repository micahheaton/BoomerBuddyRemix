import { createHash } from 'node:crypto';
import { DomainError } from '@boomerbuddy/domain';
import type { Database, SqlExecutor } from './database';
import { asDate, jsonValue, placeholders, randomIdFactory, type IdFactory } from './values';

export type DurableJobState =
  'queued' | 'running' | 'retry' | 'succeeded' | 'dead_letter' | 'canceled';
export type DurableJobPayloadValue = string | number | boolean | null;
export type DurableJobPayload = Readonly<Record<string, DurableJobPayloadValue>>;

export interface DurableJob {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly householdId?: string;
  readonly classification: 'public' | 'internal' | 'confidential';
  readonly payload: DurableJobPayload;
  readonly idempotencyKey: string;
  readonly state: DurableJobState;
  readonly priority: number;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: Date;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: Date;
  readonly correlationId: string;
}

interface JobRow extends Record<string, unknown> {
  readonly id: string;
  readonly job_type: string;
  readonly job_version: number;
  readonly household_id: string | null;
  readonly classification: DurableJob['classification'];
  readonly payload: unknown;
  readonly payload_hash: string;
  readonly idempotency_key: string;
  readonly deduplication_key: string | null;
  readonly state: DurableJobState;
  readonly priority: number;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly next_attempt_at: unknown;
  readonly lease_owner: string | null;
  readonly lease_expires_at: unknown;
  readonly correlation_id: string;
}

interface ReceiptRow extends Record<string, unknown> {
  readonly state: 'processing' | 'completed';
  readonly lease_owner: string | null;
  readonly lease_expires_at: unknown;
}

const jobName = /^[a-z][a-z0-9_.-]{1,79}$/u;
const payloadKey = /^[a-z][A-Za-z0-9_.-]{1,79}$/u;
const stableKey = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{1,199}$/u;
const forbiddenKey =
  /(?:content|artifact|cipher|fingerprint|token|secret|safe.?word|url|destination|email|phone|prompt|message)/iu;
const forbiddenString =
  /(?:-----BEGIN[^\r\n]*PRIVATE KEY|\b(?:bearer|basic)\s+[A-Za-z0-9._~+/-]+|https?:\/\/|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.)/iu;

function assertJobPayload(payload: DurableJobPayload): void {
  const entries = Object.entries(payload);
  if (entries.length > 32) throw new DomainError('invalid_input', 'Job payload is too broad');
  for (const [key, value] of entries) {
    if (!payloadKey.test(key) || forbiddenKey.test(key)) {
      throw new DomainError('restricted_input', 'Job payload contains a restricted field');
    }
    if (typeof value === 'string' && (value.length > 256 || forbiddenString.test(value))) {
      throw new DomainError('restricted_input', 'Job payload contains restricted data');
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new DomainError('invalid_input', 'Job payload numbers must be finite');
    }
  }
}

function canonicalPayload(payload: DurableJobPayload): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(payload).sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function payloadHash(payload: DurableJobPayload): string {
  return createHash('sha256').update(canonicalPayload(payload)).digest('base64url');
}

function mapPayload(value: unknown): DurableJobPayload {
  const parsed = jsonValue(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Invalid durable job payload');
  }
  const payload: Record<string, DurableJobPayloadValue> = {};
  for (const [key, item] of Object.entries(parsed)) {
    if (item !== null && !['string', 'number', 'boolean'].includes(typeof item)) {
      throw new TypeError('Invalid durable job payload value');
    }
    payload[key] = item as DurableJobPayloadValue;
  }
  assertJobPayload(payload);
  return Object.freeze(payload);
}

function mapJob(row: JobRow): DurableJob {
  return {
    id: row.id,
    type: row.job_type,
    version: row.job_version,
    ...(row.household_id === null ? {} : { householdId: row.household_id }),
    classification: row.classification,
    payload: mapPayload(row.payload),
    idempotencyKey: row.idempotency_key,
    state: row.state,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: asDate(row.next_attempt_at, 'next_attempt_at'),
    ...(row.lease_owner === null ? {} : { leaseOwner: row.lease_owner }),
    ...(row.lease_expires_at === null
      ? {}
      : { leaseExpiresAt: asDate(row.lease_expires_at, 'lease_expires_at') }),
    correlationId: row.correlation_id,
  };
}

const jobProjection = `
  SELECT id, job_type, job_version, household_id, classification, payload, payload_hash,
         idempotency_key, deduplication_key, state, priority, attempts, max_attempts, next_attempt_at,
         lease_owner, lease_expires_at, correlation_id
  FROM durable_jobs
`;

async function recordAttempt(
  transaction: SqlExecutor,
  ids: IdFactory,
  input: {
    readonly jobId: string;
    readonly attempt: number;
    readonly workerId: string;
    readonly outcome:
      'claimed' | 'heartbeat' | 'succeeded' | 'retry' | 'dead_letter' | 'relinquished';
    readonly errorCode?: string;
    readonly now: Date;
  },
): Promise<void> {
  await transaction.query(
    `INSERT INTO durable_job_attempts(
       id, job_id, attempt, worker_id, outcome, error_code, occurred_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      ids.next('job-attempt'),
      input.jobId,
      input.attempt,
      input.workerId,
      input.outcome,
      input.errorCode ?? null,
      input.now.toISOString(),
    ],
  );
}

export class DurableJobRepository {
  constructor(
    private readonly database: Database,
    private readonly idFactory: IdFactory = randomIdFactory,
  ) {}

  async enqueue(input: {
    readonly type: string;
    readonly version?: number;
    readonly householdId?: string;
    readonly classification?: DurableJob['classification'];
    readonly payload: DurableJobPayload;
    readonly idempotencyKey: string;
    readonly deduplicationKey?: string;
    readonly priority?: number;
    readonly scheduledAt: Date;
    readonly maxAttempts?: number;
    readonly correlationId: string;
    readonly causationId?: string;
  }): Promise<{ readonly job: DurableJob; readonly duplicate: boolean }> {
    assertJobPayload(input.payload);
    const version = input.version ?? 1;
    const priority = input.priority ?? 0;
    const maxAttempts = input.maxAttempts ?? 8;
    if (
      !jobName.test(input.type) ||
      !stableKey.test(input.idempotencyKey) ||
      !stableKey.test(input.correlationId) ||
      (input.deduplicationKey !== undefined && !stableKey.test(input.deduplicationKey)) ||
      (input.causationId !== undefined && !stableKey.test(input.causationId)) ||
      !Number.isSafeInteger(version) ||
      version < 1 ||
      !Number.isSafeInteger(priority) ||
      priority < -100 ||
      priority > 100 ||
      !Number.isSafeInteger(maxAttempts) ||
      maxAttempts < 1 ||
      maxAttempts > 50 ||
      !Number.isFinite(input.scheduledAt.getTime())
    ) {
      throw new DomainError('invalid_input', 'Invalid durable job envelope');
    }
    const id = this.idFactory.next('job');
    const canonical = canonicalPayload(input.payload);
    const hash = payloadHash(input.payload);
    const inserted = await this.database.query(
      `INSERT INTO durable_jobs(
         id, job_type, job_version, household_id, classification, payload, payload_hash,
         idempotency_key, deduplication_key, state, priority, scheduled_at, next_attempt_at,
         max_attempts, correlation_id, causation_id, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,'queued',$10,$11,$11,$12,$13,$14,$11)
       ON CONFLICT (job_type, idempotency_key) DO NOTHING`,
      [
        id,
        input.type,
        version,
        input.householdId ?? null,
        input.classification ?? 'internal',
        canonical,
        hash,
        input.idempotencyKey,
        input.deduplicationKey ?? null,
        priority,
        input.scheduledAt.toISOString(),
        maxAttempts,
        input.correlationId,
        input.causationId ?? null,
      ],
    );
    const result = await this.database.query<JobRow>(
      `${jobProjection} WHERE job_type = $1 AND idempotency_key = $2`,
      [input.type, input.idempotencyKey],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('Durable job enqueue did not persist');
    if (
      row.payload_hash !== hash ||
      row.job_version !== version ||
      row.household_id !== (input.householdId ?? null) ||
      row.classification !== (input.classification ?? 'internal') ||
      row.deduplication_key !== (input.deduplicationKey ?? null) ||
      row.priority !== priority ||
      row.max_attempts !== maxAttempts
    ) {
      throw new DomainError('conflict', 'Job idempotency key has conflicting evidence');
    }
    // A duplicate delivery keeps the first schedule and trace context; retries cannot move work.
    return { job: mapJob(row), duplicate: inserted.rowCount === 0 };
  }

  async claim(input: {
    readonly workerId: string;
    readonly jobTypes: readonly string[];
    readonly limit: number;
    readonly leaseDurationMs: number;
    readonly now: Date;
  }): Promise<readonly DurableJob[]> {
    const jobTypes = [...new Set(input.jobTypes)];
    if (jobTypes.length === 0) return [];
    if (
      !stableKey.test(input.workerId) ||
      jobTypes.some((type) => !jobName.test(type)) ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      !Number.isSafeInteger(input.leaseDurationMs) ||
      input.leaseDurationMs < 1_000 ||
      input.leaseDurationMs > 15 * 60_000 ||
      !Number.isFinite(input.now.getTime())
    ) {
      throw new DomainError('invalid_input', 'Invalid job claim request');
    }
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseDurationMs);
    return this.database.transaction(async (transaction) => {
      await transaction.query(
        `UPDATE durable_jobs
         SET state = 'dead_letter', lease_owner = NULL, lease_expires_at = NULL,
             dead_lettered_at = $1, last_error_code = 'lease_expired_after_final_attempt'
         WHERE state = 'running' AND lease_expires_at <= $1 AND attempts >= max_attempts`,
        [input.now.toISOString()],
      );
      const typeSlots = placeholders(5, jobTypes.length);
      const claimed = await transaction.query<JobRow>(
        `WITH claimable AS (
           SELECT id FROM durable_jobs
           WHERE job_type IN (${typeSlots})
             AND attempts < max_attempts
             AND (
               (state IN ('queued','retry') AND next_attempt_at <= $1)
               OR (state = 'running' AND lease_expires_at <= $1)
             )
           ORDER BY priority DESC, next_attempt_at, id
           LIMIT $4 FOR UPDATE SKIP LOCKED
         )
         UPDATE durable_jobs AS job
         SET state = 'running', lease_owner = $3, lease_expires_at = $2,
             heartbeat_at = $1, attempts = job.attempts + 1
         FROM claimable WHERE job.id = claimable.id
         RETURNING job.id, job.job_type, job.job_version, job.household_id,
                   job.classification, job.payload, job.payload_hash, job.idempotency_key, job.state,
                   job.priority, job.attempts, job.max_attempts, job.next_attempt_at,
                   job.lease_owner, job.lease_expires_at, job.correlation_id`,
        [
          input.now.toISOString(),
          leaseExpiresAt.toISOString(),
          input.workerId,
          input.limit,
          ...jobTypes,
        ],
      );
      for (const row of claimed.rows) {
        await recordAttempt(transaction, this.idFactory, {
          jobId: row.id,
          attempt: row.attempts,
          workerId: input.workerId,
          outcome: 'claimed',
          now: input.now,
        });
      }
      return claimed.rows.map(mapJob);
    });
  }

  async heartbeat(input: {
    readonly jobId: string;
    readonly workerId: string;
    readonly leaseDurationMs: number;
    readonly now: Date;
  }): Promise<boolean> {
    const expiresAt = new Date(input.now.getTime() + input.leaseDurationMs);
    return this.database.transaction(async (transaction) => {
      const updated = await transaction.query<
        { readonly attempts: number } & Record<string, unknown>
      >(
        `UPDATE durable_jobs
         SET heartbeat_at = $3, lease_expires_at = $4
         WHERE id = $1 AND state = 'running' AND lease_owner = $2 AND lease_expires_at > $3
         RETURNING attempts`,
        [input.jobId, input.workerId, input.now.toISOString(), expiresAt.toISOString()],
      );
      const row = updated.rows[0];
      if (row === undefined) return false;
      await recordAttempt(transaction, this.idFactory, {
        jobId: input.jobId,
        attempt: row.attempts,
        workerId: input.workerId,
        outcome: 'heartbeat',
        now: input.now,
      });
      return true;
    });
  }

  async heartbeatWithConsumerReceipt(input: {
    readonly jobId: string;
    readonly consumerKey: string;
    readonly idempotencyKey: string;
    readonly workerId: string;
    readonly leaseDurationMs: number;
    readonly now: Date;
  }): Promise<boolean> {
    const expiresAt = new Date(input.now.getTime() + input.leaseDurationMs);
    return this.database.transaction(async (transaction) => {
      const locked = await transaction.query<
        { readonly attempts: number } & Record<string, unknown>
      >(
        `SELECT job.attempts
         FROM durable_jobs AS job
         INNER JOIN durable_consumer_receipts AS receipt
           ON receipt.job_id = job.id
          AND receipt.consumer_key = $4
          AND receipt.idempotency_key = $5
         WHERE job.id = $1 AND job.state = 'running' AND job.lease_owner = $2
           AND job.lease_expires_at > $3
           AND receipt.state = 'processing' AND receipt.lease_owner = $2
           AND receipt.lease_expires_at > $3
         FOR UPDATE OF job, receipt`,
        [
          input.jobId,
          input.workerId,
          input.now.toISOString(),
          input.consumerKey,
          input.idempotencyKey,
        ],
      );
      const row = locked.rows[0];
      if (row === undefined) return false;
      const job = await transaction.query(
        `UPDATE durable_jobs
         SET heartbeat_at = $3, lease_expires_at = $4
         WHERE id = $1 AND state = 'running' AND lease_owner = $2
           AND lease_expires_at > $3`,
        [input.jobId, input.workerId, input.now.toISOString(), expiresAt.toISOString()],
      );
      const receipt = await transaction.query(
        `UPDATE durable_consumer_receipts
         SET lease_expires_at = $6
         WHERE job_id = $1 AND state = 'processing' AND lease_owner = $2
           AND lease_expires_at > $3 AND consumer_key = $4 AND idempotency_key = $5`,
        [
          input.jobId,
          input.workerId,
          input.now.toISOString(),
          input.consumerKey,
          input.idempotencyKey,
          expiresAt.toISOString(),
        ],
      );
      if (job.rowCount !== 1 || receipt.rowCount !== 1) {
        throw new Error('Atomic job and consumer receipt heartbeat failed');
      }
      await recordAttempt(transaction, this.idFactory, {
        jobId: input.jobId,
        attempt: row.attempts,
        workerId: input.workerId,
        outcome: 'heartbeat',
        now: input.now,
      });
      return true;
    });
  }

  async complete(input: {
    readonly jobId: string;
    readonly workerId: string;
    readonly now: Date;
  }): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const updated = await transaction.query<
        { readonly attempts: number } & Record<string, unknown>
      >(
        `UPDATE durable_jobs
         SET state = 'succeeded', completed_at = $3, lease_owner = NULL,
             lease_expires_at = NULL, heartbeat_at = $3, last_error_code = NULL
         WHERE id = $1 AND state = 'running' AND lease_owner = $2 AND lease_expires_at > $3
         RETURNING attempts`,
        [input.jobId, input.workerId, input.now.toISOString()],
      );
      const row = updated.rows[0];
      if (row === undefined) return false;
      await recordAttempt(transaction, this.idFactory, {
        jobId: input.jobId,
        attempt: row.attempts,
        workerId: input.workerId,
        outcome: 'succeeded',
        now: input.now,
      });
      return true;
    });
  }

  async fail(input: {
    readonly jobId: string;
    readonly workerId: string;
    readonly errorCode: string;
    readonly nextAttemptAt: Date;
    readonly now: Date;
  }): Promise<'retry' | 'dead_letter' | 'lost_lease'> {
    if (!jobName.test(input.errorCode) || !Number.isFinite(input.nextAttemptAt.getTime())) {
      throw new DomainError('invalid_input', 'Invalid job failure classification');
    }
    return this.database.transaction(async (transaction) => {
      const locked = await transaction.query<
        { readonly attempts: number; readonly max_attempts: number } & Record<string, unknown>
      >(
        `SELECT attempts, max_attempts FROM durable_jobs
         WHERE id = $1 AND state = 'running' AND lease_owner = $2 AND lease_expires_at > $3
         FOR UPDATE`,
        [input.jobId, input.workerId, input.now.toISOString()],
      );
      const row = locked.rows[0];
      if (row === undefined) return 'lost_lease';
      const dead = row.attempts >= row.max_attempts;
      await transaction.query(
        `UPDATE durable_jobs
         SET state = $4::text, next_attempt_at = $5::timestamptz,
             lease_owner = NULL, lease_expires_at = NULL,
             heartbeat_at = $3::timestamptz, last_error_code = $6,
             dead_lettered_at = CASE WHEN $4::text = 'dead_letter'
               THEN $3::timestamptz ELSE NULL END
         WHERE id = $1 AND lease_owner = $2`,
        [
          input.jobId,
          input.workerId,
          input.now.toISOString(),
          dead ? 'dead_letter' : 'retry',
          input.nextAttemptAt.toISOString(),
          input.errorCode,
        ],
      );
      await recordAttempt(transaction, this.idFactory, {
        jobId: input.jobId,
        attempt: row.attempts,
        workerId: input.workerId,
        outcome: dead ? 'dead_letter' : 'retry',
        errorCode: input.errorCode,
        now: input.now,
      });
      return dead ? 'dead_letter' : 'retry';
    });
  }

  async deadLetter(input: {
    readonly jobId: string;
    readonly workerId: string;
    readonly errorCode: string;
    readonly now: Date;
  }): Promise<boolean> {
    if (!jobName.test(input.errorCode)) {
      throw new DomainError('invalid_input', 'Invalid job dead-letter classification');
    }
    return this.database.transaction(async (transaction) => {
      const updated = await transaction.query<
        { readonly attempts: number } & Record<string, unknown>
      >(
        `UPDATE durable_jobs
         SET state = 'dead_letter', lease_owner = NULL, lease_expires_at = NULL,
             heartbeat_at = $3, last_error_code = $4, dead_lettered_at = $3
         WHERE id = $1 AND state = 'running' AND lease_owner = $2 AND lease_expires_at > $3
         RETURNING attempts`,
        [input.jobId, input.workerId, input.now.toISOString(), input.errorCode],
      );
      const row = updated.rows[0];
      if (row === undefined) return false;
      await recordAttempt(transaction, this.idFactory, {
        jobId: input.jobId,
        attempt: row.attempts,
        workerId: input.workerId,
        outcome: 'dead_letter',
        errorCode: input.errorCode,
        now: input.now,
      });
      return true;
    });
  }

  async beginConsumerReceipt(input: {
    readonly consumerKey: string;
    readonly idempotencyKey: string;
    readonly jobId: string;
    readonly workerId: string;
    readonly leaseDurationMs: number;
    readonly now: Date;
  }): Promise<'acquired' | 'completed' | 'busy'> {
    const expiresAt = new Date(input.now.getTime() + input.leaseDurationMs);
    return this.database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO durable_consumer_receipts(
           consumer_key, idempotency_key, job_id, state, lease_owner, lease_expires_at, started_at
         ) VALUES ($1,$2,$3,'processing',$4,$5,$6)
         ON CONFLICT (consumer_key, idempotency_key) DO NOTHING`,
        [
          input.consumerKey,
          input.idempotencyKey,
          input.jobId,
          input.workerId,
          expiresAt.toISOString(),
          input.now.toISOString(),
        ],
      );
      const receipt = await transaction.query<ReceiptRow>(
        `SELECT state, lease_owner, lease_expires_at
         FROM durable_consumer_receipts
         WHERE consumer_key = $1 AND idempotency_key = $2 FOR UPDATE`,
        [input.consumerKey, input.idempotencyKey],
      );
      const row = receipt.rows[0];
      if (row === undefined) throw new Error('Consumer receipt did not persist');
      if (row.state === 'completed') return 'completed';
      const expiry = asDate(row.lease_expires_at, 'consumer lease_expires_at');
      if (row.lease_owner === input.workerId && expiry.getTime() > input.now.getTime()) {
        return 'acquired';
      }
      if (expiry.getTime() > input.now.getTime()) return 'busy';
      const reclaimed = await transaction.query(
        `UPDATE durable_consumer_receipts
         SET job_id = $3, lease_owner = $4, lease_expires_at = $5, started_at = $6
         WHERE consumer_key = $1 AND idempotency_key = $2 AND state = 'processing'
           AND lease_expires_at <= $6`,
        [
          input.consumerKey,
          input.idempotencyKey,
          input.jobId,
          input.workerId,
          expiresAt.toISOString(),
          input.now.toISOString(),
        ],
      );
      return reclaimed.rowCount === 1 ? 'acquired' : 'busy';
    });
  }

  async completeConsumerReceipt(input: {
    readonly consumerKey: string;
    readonly idempotencyKey: string;
    readonly workerId: string;
    readonly resultCode: string;
    readonly now: Date;
  }): Promise<boolean> {
    if (!jobName.test(input.resultCode)) {
      throw new DomainError('invalid_input', 'Consumer result code is invalid');
    }
    const result = await this.database.query(
      `UPDATE durable_consumer_receipts
       SET state = 'completed', lease_owner = NULL, lease_expires_at = NULL,
           completed_at = $5, result_code = $4
       WHERE consumer_key = $1 AND idempotency_key = $2 AND state = 'processing'
         AND lease_owner = $3 AND lease_expires_at > $5`,
      [
        input.consumerKey,
        input.idempotencyKey,
        input.workerId,
        input.resultCode,
        input.now.toISOString(),
      ],
    );
    return result.rowCount === 1;
  }

  async replayDeadLetter(input: {
    readonly jobId: string;
    readonly actorPersonId: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<DurableJob> {
    if (!jobName.test(input.reason) || !stableKey.test(input.correlationId)) {
      throw new DomainError('invalid_input', 'Replay reason must be a content-free code');
    }
    return this.database.transaction(async (transaction) => {
      const original = await transaction.query<JobRow>(
        `${jobProjection} WHERE id = $1 AND state = 'dead_letter' FOR UPDATE`,
        [input.jobId],
      );
      const row = original.rows[0];
      if (row === undefined) throw new DomainError('conflict', 'Only dead-letter jobs may replay');
      const newId = this.idFactory.next('job');
      const replayKey = `${row.idempotency_key}:replay:${newId}`;
      await transaction.query(
        `INSERT INTO durable_jobs(
           id, job_type, job_version, household_id, classification, payload, payload_hash,
           idempotency_key, state, priority, scheduled_at, next_attempt_at, max_attempts,
           correlation_id, causation_id, created_at, replay_of_job_id, replay_reason,
           replay_actor_person_id
         )
         SELECT $1, job_type, job_version, household_id, classification, payload, payload_hash,
                $2, 'queued', priority, $3, $3, max_attempts, $4, id, $3, id, $5, $6
         FROM durable_jobs WHERE id = $7`,
        [
          newId,
          replayKey,
          input.now.toISOString(),
          input.correlationId,
          input.reason,
          input.actorPersonId,
          input.jobId,
        ],
      );
      await transaction.query(
        `INSERT INTO audit_events(
           id, household_id, actor_person_id, session_audience, action, resource_type,
           resource_id, outcome, metadata, correlation_id, occurred_at
         ) SELECT $1, household_id, $2, 'hq', 'job.replayed', 'durable_job', $3,
                  'completed', $4::jsonb, $5, $6
           FROM durable_jobs WHERE id = $3`,
        [
          this.idFactory.next('audit'),
          input.actorPersonId,
          newId,
          JSON.stringify({ reason: input.reason, replayOfJobId: input.jobId }),
          input.correlationId,
          input.now.toISOString(),
        ],
      );
      const replay = await transaction.query<JobRow>(`${jobProjection} WHERE id = $1`, [newId]);
      const replayRow = replay.rows[0];
      if (replayRow === undefined) throw new Error('Replayed job did not persist');
      return mapJob(replayRow);
    });
  }

  async updateWorkerHeartbeat(input: {
    readonly workerId: string;
    readonly state: 'running' | 'draining' | 'stopped';
    readonly currentJobCount: number;
    readonly version: string;
    readonly startedAt: Date;
    readonly now: Date;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO worker_heartbeats(
         worker_id, started_at, last_seen_at, state, current_job_count, version
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (worker_id) DO UPDATE
       SET last_seen_at = EXCLUDED.last_seen_at, state = EXCLUDED.state,
           current_job_count = EXCLUDED.current_job_count, version = EXCLUDED.version`,
      [
        input.workerId,
        input.startedAt.toISOString(),
        input.now.toISOString(),
        input.state,
        input.currentJobCount,
        input.version,
      ],
    );
  }

  async relinquishWorkerLeases(input: {
    readonly workerId: string;
    readonly now: Date;
  }): Promise<number> {
    return this.database.transaction(async (transaction) => {
      const released = await transaction.query<
        { readonly id: string; readonly attempts: number } & Record<string, unknown>
      >(
        `UPDATE durable_jobs
         SET state = 'retry', next_attempt_at = $2, lease_owner = NULL,
             lease_expires_at = NULL, heartbeat_at = $2, last_error_code = 'worker_shutdown'
         WHERE state = 'running' AND lease_owner = $1
         RETURNING id, attempts`,
        [input.workerId, input.now.toISOString()],
      );
      for (const row of released.rows) {
        await recordAttempt(transaction, this.idFactory, {
          jobId: row.id,
          attempt: row.attempts,
          workerId: input.workerId,
          outcome: 'relinquished',
          errorCode: 'worker_shutdown',
          now: input.now,
        });
      }
      return released.rowCount;
    });
  }
}
