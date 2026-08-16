import { DomainError } from '@boomerbuddy/domain';
import {
  constantTimeEqual,
  fingerprintMinimized,
  minimizeRestrictedInput,
} from '@boomerbuddy/security';
import type { Database } from './database';
import { randomIdFactory, type IdFactory } from './values';

interface InboxRow extends Record<string, unknown> {
  readonly id: string;
  readonly payload_hmac: string;
  readonly fingerprint_key_version: number;
  readonly status: 'received' | 'processing' | 'processed' | 'retry' | 'quarantined';
}

export interface CapturedCommerceEvent {
  readonly id: string;
  readonly duplicate: boolean;
  readonly status: InboxRow['status'];
}

export class CommerceOperationsRepository {
  constructor(
    private readonly database: Database,
    private readonly fingerprintKey: Uint8Array,
    private readonly fingerprintKeyVersion: number,
    private readonly idFactory: IdFactory = randomIdFactory,
  ) {}

  async captureLocalEvent(input: {
    readonly environment: 'local' | 'test';
    readonly externalEventId: string;
    readonly eventType: string;
    readonly canonicalPayload: string;
    readonly now: Date;
  }): Promise<CapturedCommerceEvent> {
    const minimized = minimizeRestrictedInput(input.canonicalPayload, 4_096);
    if (minimized.status === 'rejected') {
      throw new DomainError(
        'restricted_input',
        'Commerce event evidence must not contain credentials or payment details',
      );
    }
    const hmac = fingerprintMinimized(minimized.minimized, this.fingerprintKey, {
      tenantId: `commerce-${input.environment}`,
      purpose: `commerce-event:${input.eventType}`,
      keyVersion: this.fingerprintKeyVersion,
    });
    const id = this.idFactory.next('commerce-event');
    const inserted = await this.database.query(
      `INSERT INTO commerce_event_inbox(
         id, provider, environment, external_event_id, event_type, payload_hmac,
         fingerprint_key_version, authenticity, status, received_at
       ) VALUES ($1,'local',$2,$3,$4,$5,$6,'local_fixture','received',$7)
       ON CONFLICT (provider, environment, external_event_id) DO NOTHING`,
      [
        id,
        input.environment,
        input.externalEventId,
        input.eventType,
        hmac.value,
        hmac.keyVersion,
        input.now.toISOString(),
      ],
    );
    const receipt = await this.database.query<InboxRow>(
      `SELECT id, payload_hmac, fingerprint_key_version, status
       FROM commerce_event_inbox
       WHERE provider = 'local' AND environment = $1 AND external_event_id = $2`,
      [input.environment, input.externalEventId],
    );
    const row = receipt.rows[0];
    if (row === undefined) throw new Error('Commerce event capture did not persist');
    if (
      row.fingerprint_key_version !== hmac.keyVersion ||
      !constantTimeEqual(row.payload_hmac, hmac.value)
    ) {
      throw new DomainError('conflict', 'Commerce event identifier has conflicting evidence');
    }
    return { id: row.id, duplicate: inserted.rowCount === 0, status: row.status };
  }

  async startLocalReconciliation(input: {
    readonly environment: 'local' | 'test';
    readonly now: Date;
  }): Promise<string> {
    const id = this.idFactory.next('reconciliation');
    await this.database.query(
      `INSERT INTO commerce_reconciliation_runs(
         id, provider, environment, state, created_at
       ) VALUES ($1,'local',$2,'queued',$3)`,
      [id, input.environment, input.now.toISOString()],
    );
    return id;
  }

  async completeLocalReconciliation(input: {
    readonly id: string;
    readonly environment: 'local' | 'test';
    readonly checkedCount: number;
    readonly mismatchCount: number;
    readonly now: Date;
  }): Promise<boolean> {
    if (
      !Number.isSafeInteger(input.checkedCount) ||
      input.checkedCount < 0 ||
      !Number.isSafeInteger(input.mismatchCount) ||
      input.mismatchCount < 0 ||
      input.mismatchCount > input.checkedCount
    ) {
      throw new DomainError('invalid_input', 'Invalid reconciliation counts');
    }
    const result = await this.database.query(
      `UPDATE commerce_reconciliation_runs
       SET state = $3, checked_count = $4, mismatch_count = $5,
           started_at = COALESCE(started_at, created_at), completed_at = $6
       WHERE id = $1 AND provider = 'local' AND environment = $2
         AND state IN ('queued','running')`,
      [
        input.id,
        input.environment,
        input.mismatchCount === 0 ? 'completed' : 'attention',
        input.checkedCount,
        input.mismatchCount,
        input.now.toISOString(),
      ],
    );
    return result.rowCount === 1;
  }
}
