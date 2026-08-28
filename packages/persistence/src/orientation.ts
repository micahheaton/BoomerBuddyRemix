import {
  completeOrientationStep,
  createOrientation,
  DomainError,
  orientationSteps,
  recordSafeWordDisposition,
  startOrientation,
  type Audience,
  type OrientationState,
  type OrientationStep,
} from '@boomerbuddy/domain';
import type { Database, SqlExecutor } from './database';
import {
  hasEffectiveProtectedEnrollment,
  type EntitlementRuntimeEnvironment,
} from './entitlements';
import { writeAuditAndOutbox } from './events';
import { FamilySafeWordRepository } from './family-safe-word';
import {
  asDate,
  jsonParameter,
  jsonValue,
  randomIdFactory,
  stringArray,
  type IdFactory,
} from './values';

interface OrientationRow extends Record<string, unknown> {
  readonly household_id: string;
  readonly person_id: string;
  readonly status: OrientationState['status'];
  readonly completed_steps: unknown;
  readonly safe_word_disposition: OrientationState['safeWordDisposition'];
  readonly needs_attention: boolean;
  readonly version: number;
  readonly updated_at: unknown;
}

export interface StoredOrientation {
  readonly householdId: string;
  readonly personId: string;
  readonly state: OrientationState;
  readonly version: number;
}

function parseRow(row: OrientationRow): StoredOrientation {
  const completed = stringArray(jsonValue(row.completed_steps), 'orientation.completed_steps');
  if (completed.some((step) => !orientationSteps.includes(step as OrientationStep))) {
    throw new TypeError('Invalid orientation step in database');
  }
  return {
    householdId: row.household_id,
    personId: row.person_id,
    state: {
      status: row.status,
      completedSteps: completed as OrientationStep[],
      safeWordDisposition: row.safe_word_disposition,
      needsAttention: row.needs_attention,
      updatedAt: asDate(row.updated_at, 'orientation.updated_at'),
    },
    version: row.version,
  };
}

function assertSafeWordStepIsCurrent(orientation: StoredOrientation): void {
  const expected = orientationSteps[orientation.state.completedSteps.length];
  if (orientation.state.status !== 'in_progress' || expected !== 'safe_word') {
    throw new DomainError(
      'invalid_transition',
      'The safe-word decision is available only at its orientation step',
      { expected: expected ?? 'complete' },
    );
  }
}

async function selectOrientation(
  executor: SqlExecutor,
  householdId: string,
  personId: string,
  lock = false,
): Promise<StoredOrientation | null> {
  const result = await executor.query<OrientationRow>(
    `SELECT household_id, person_id, status, completed_steps, safe_word_disposition,
            needs_attention, version, updated_at
     FROM orientation_states WHERE household_id = $1 AND person_id = $2${lock ? ' FOR UPDATE' : ''}`,
    [householdId, personId],
  );
  const row = result.rows[0];
  return row === undefined ? null : parseRow(row);
}

export class OrientationRepository {
  private readonly familySafeWords: FamilySafeWordRepository;

  constructor(
    private readonly database: Database,
    safeWordPepper: Uint8Array,
    private readonly idFactory: IdFactory = randomIdFactory,
    private readonly runtimeEnvironment: EntitlementRuntimeEnvironment = 'production',
  ) {
    this.familySafeWords = new FamilySafeWordRepository(
      database,
      safeWordPepper,
      idFactory,
      runtimeEnvironment,
    );
  }

  async get(householdId: string, personId: string, now: Date): Promise<StoredOrientation> {
    const existing = await selectOrientation(this.database, householdId, personId);
    if (existing !== null) return existing;
    const state = createOrientation(now);
    await this.database.query(
      `INSERT INTO orientation_states(
         household_id, person_id, status, completed_steps, safe_word_disposition,
         needs_attention, version, updated_at
       ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,1,$7)
       ON CONFLICT (household_id, person_id) DO NOTHING`,
      [
        householdId,
        personId,
        state.status,
        jsonParameter(state.completedSteps),
        state.safeWordDisposition,
        state.needsAttention,
        now.toISOString(),
      ],
    );
    const inserted = await selectOrientation(this.database, householdId, personId);
    if (inserted === null) throw new Error('Unable to initialize orientation');
    return inserted;
  }

  async start(input: {
    readonly householdId: string;
    readonly subjectPersonId: string;
    readonly actorPersonId: string;
    readonly audience: Audience;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<StoredOrientation> {
    if (
      input.actorPersonId === input.subjectPersonId &&
      !(await hasEffectiveProtectedEnrollment(
        this.database,
        input.householdId,
        input.subjectPersonId,
        input.now,
        false,
        this.runtimeEnvironment,
      ))
    ) {
      throw new DomainError('not_authorized', 'Protected-member enrollment is required');
    }
    await this.get(input.householdId, input.subjectPersonId, input.now);
    return this.update(input, (state) => startOrientation(state, input.now), 'orientation.started');
  }

  async completeStep(input: {
    readonly householdId: string;
    readonly subjectPersonId: string;
    readonly actorPersonId: string;
    readonly step: OrientationStep;
    readonly audience: Audience;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<StoredOrientation> {
    return this.update(
      input,
      (state) =>
        state.completedSteps.includes(input.step)
          ? state
          : completeOrientationStep(state, input.step, input.now),
      'orientation.step_completed',
      { step: input.step },
    );
  }

  async setSafeWord(input: {
    readonly householdId: string;
    readonly subjectPersonId: string;
    readonly actorPersonId: string;
    readonly action: 'configure' | 'defer';
    readonly phrase?: string;
    readonly audience: Audience;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<StoredOrientation> {
    if (
      input.actorPersonId === input.subjectPersonId &&
      !(await hasEffectiveProtectedEnrollment(
        this.database,
        input.householdId,
        input.subjectPersonId,
        input.now,
        false,
        this.runtimeEnvironment,
      ))
    ) {
      throw new DomainError('not_authorized', 'Protected-member enrollment is required');
    }
    const snapshot = await selectOrientation(
      this.database,
      input.householdId,
      input.subjectPersonId,
    );
    if (snapshot === null)
      throw new Error('Orientation must be initialized before safe-word setup');
    assertSafeWordStepIsCurrent(snapshot);
    return this.database.transaction(async (transaction) => {
      if (
        input.actorPersonId === input.subjectPersonId &&
        !(await hasEffectiveProtectedEnrollment(
          transaction,
          input.householdId,
          input.subjectPersonId,
          input.now,
          true,
          this.runtimeEnvironment,
        ))
      ) {
        throw new DomainError('not_authorized', 'Protected-member enrollment is required');
      }
      const current = await selectOrientation(
        transaction,
        input.householdId,
        input.subjectPersonId,
        true,
      );
      if (current === null)
        throw new Error('Orientation must be initialized before safe-word setup');
      assertSafeWordStepIsCurrent(current);
      if (input.action === 'defer' && current.state.safeWordDisposition === 'informed_deferral') {
        return current;
      }
      const dispositionState = recordSafeWordDisposition(
        current.state,
        input.action === 'configure' ? 'configured' : 'informed_deferral',
        input.now,
      );
      const state = completeOrientationStep(dispositionState, 'safe_word', input.now);
      const safeWordOperation = {
        householdId: input.householdId,
        protectedPersonId: input.subjectPersonId,
        actorPersonId: input.actorPersonId,
        audience: input.audience,
        correlationId: input.correlationId,
        now: input.now,
      };
      if (input.action === 'configure') {
        await this.familySafeWords.replaceWithin(transaction, {
          ...safeWordOperation,
          phrase: input.phrase ?? '',
        });
      } else {
        await this.familySafeWords.disableWithin(transaction, safeWordOperation);
      }
      await this.persistState(transaction, current, state);
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
          action: 'orientation.verification_aid_updated',
          resourceType: 'orientation',
          resourceId: input.subjectPersonId,
          outcome: 'completed',
          metadata: { disposition: state.safeWordDisposition, stepCompleted: true },
        },
        {
          eventType: 'orientation.verification_aid_updated.v1',
          aggregateType: 'orientation',
          aggregateId: input.subjectPersonId,
          payload: { disposition: state.safeWordDisposition, stepCompleted: true },
        },
      );
      return { ...current, state, version: current.version + 1 };
    });
  }

  private async update(
    input: {
      readonly householdId: string;
      readonly subjectPersonId: string;
      readonly actorPersonId: string;
      readonly audience: Audience;
      readonly correlationId: string;
      readonly now: Date;
    },
    transition: (state: OrientationState) => OrientationState,
    eventName: string,
    metadata: Readonly<Record<string, string | number | boolean>> = {},
  ): Promise<StoredOrientation> {
    return this.database.transaction(async (transaction) => {
      if (
        input.actorPersonId === input.subjectPersonId &&
        !(await hasEffectiveProtectedEnrollment(
          transaction,
          input.householdId,
          input.subjectPersonId,
          input.now,
          true,
          this.runtimeEnvironment,
        ))
      ) {
        throw new DomainError('not_authorized', 'Protected-member enrollment is required');
      }
      const current = await selectOrientation(
        transaction,
        input.householdId,
        input.subjectPersonId,
        true,
      );
      if (current === null) throw new Error('Orientation is unavailable');
      const state = transition(current.state);
      if (state === current.state) return current;
      await this.persistState(transaction, current, state);
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
          action: eventName,
          resourceType: 'orientation',
          resourceId: input.subjectPersonId,
          outcome: 'completed',
          metadata,
        },
        {
          eventType: `${eventName}.v1`,
          aggregateType: 'orientation',
          aggregateId: input.subjectPersonId,
          payload: { status: state.status, ...metadata },
        },
      );
      return { ...current, state, version: current.version + 1 };
    });
  }

  private async persistState(
    transaction: SqlExecutor,
    current: StoredOrientation,
    state: OrientationState,
  ): Promise<void> {
    const result = await transaction.query(
      `UPDATE orientation_states
       SET status = $4, completed_steps = $5::jsonb, safe_word_disposition = $6,
           needs_attention = $7, version = version + 1, updated_at = $8
       WHERE household_id = $1 AND person_id = $2 AND version = $3`,
      [
        current.householdId,
        current.personId,
        current.version,
        state.status,
        jsonParameter(state.completedSteps),
        state.safeWordDisposition,
        state.needsAttention,
        state.updatedAt.toISOString(),
      ],
    );
    if (result.rowCount !== 1) throw new Error('Concurrent orientation update');
  }
}
