import { createHash } from 'node:crypto';

import {
  assertFounderProvisioningEvidenceChronology,
  assertFounderProvisioningTransition,
  DomainError,
  founderProvisioningCatalogue,
  founderProvisioningEntry,
  founderProvisioningStatuses,
  type FounderProvisioningBlockerCode,
  type FounderProvisioningCatalogueEntry,
  type FounderProvisioningEvidenceKind,
  type FounderProvisioningEvidenceResult,
  type FounderProvisioningEvidenceTier,
  type FounderProvisioningStatus,
  type FounderProvisioningWorkstreamKey,
} from '@boomerbuddy/domain';

import type { Database, SqlExecutor } from './database';
import { asDate, randomIdFactory, stringArray, type IdFactory } from './values';

const boundedIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const operationKeyPattern =
  /^provisioning:([a-z][a-z0-9_]{2,63}):[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const manifestDigestPattern = /^[A-Za-z0-9_-]{43}$/u;

export interface FounderProvisioningAccess {
  readonly actorPersonId: string;
  readonly correlationId: string;
}

export interface FounderProvisioningEvidenceInput {
  readonly tier: FounderProvisioningEvidenceTier;
  readonly kind: FounderProvisioningEvidenceKind;
  readonly result: FounderProvisioningEvidenceResult;
  readonly blockerCode?: FounderProvisioningBlockerCode;
  readonly manifestDigest?: string;
  readonly observedAt: Date;
}

export interface FounderProvisioningCurrentEvidence {
  readonly tier: FounderProvisioningEvidenceTier;
  readonly kind: FounderProvisioningEvidenceKind;
  readonly result: FounderProvisioningEvidenceResult;
  readonly blockerCode?: FounderProvisioningBlockerCode;
  readonly manifestDigest?: string;
  readonly observedAt: Date;
  readonly recordedAt: Date;
}

export interface FounderProvisioningRegisterEntryRecord {
  readonly catalogue: FounderProvisioningCatalogueEntry;
  readonly status: FounderProvisioningStatus;
  readonly version: number;
  readonly latestEvidence: FounderProvisioningCurrentEvidence;
}

export interface FounderProvisioningTransitionRecord {
  readonly workstreamKey: FounderProvisioningWorkstreamKey;
  readonly status: FounderProvisioningStatus;
  readonly version: number;
  readonly evidenceId: string;
  readonly reused: boolean;
  readonly externalActionExecuted: false;
}

interface RegisterRow extends Record<string, unknown> {
  readonly workstream_key: string;
  readonly definition_version: number;
  readonly display_order: number;
  readonly definition_digest: string;
  readonly initial_status: FounderProvisioningStatus;
  readonly allowed_proof_tiers: unknown;
  readonly to_status: FounderProvisioningStatus;
  readonly version: number;
  readonly tier: FounderProvisioningEvidenceTier;
  readonly kind: FounderProvisioningEvidenceKind;
  readonly result: FounderProvisioningEvidenceResult;
  readonly blocker_code: FounderProvisioningBlockerCode | null;
  readonly manifest_digest: string | null;
  readonly observed_at: unknown;
  readonly recorded_at: unknown;
}

interface WorkstreamRow extends Record<string, unknown> {
  readonly workstream_key: string;
  readonly definition_version: number;
  readonly display_order: number;
  readonly definition_digest: string;
  readonly initial_status: FounderProvisioningStatus;
  readonly allowed_proof_tiers: unknown;
}

interface StatusRow extends Record<string, unknown> {
  readonly id: string;
  readonly workstream_key: FounderProvisioningWorkstreamKey;
  readonly to_status: FounderProvisioningStatus;
  readonly version: number;
  readonly evidence_id: string;
  readonly occurred_at: unknown;
}

interface OperationRow extends Record<string, unknown> {
  readonly operation_key: string;
  readonly workstream_key: FounderProvisioningWorkstreamKey;
  readonly request_digest: string;
  readonly actor_person_id: string;
}

function assertBoundedIdentifier(value: string, field: string): void {
  if (!boundedIdentifier.test(value)) throw new DomainError('invalid_input', `Invalid ${field}`);
}

function assertOperationKey(value: string, workstreamKey: FounderProvisioningWorkstreamKey): void {
  const match = operationKeyPattern.exec(value);
  if (match?.[1] !== workstreamKey) {
    throw new DomainError('invalid_input', 'Invalid founder provisioning idempotency key');
  }
}

function assertEvidenceInput(evidence: FounderProvisioningEvidenceInput): void {
  if (Number.isNaN(evidence.observedAt.getTime())) {
    throw new DomainError('invalid_input', 'Invalid founder provisioning evidence timestamp');
  }
  if (
    evidence.manifestDigest !== undefined &&
    !manifestDigestPattern.test(evidence.manifestDigest)
  ) {
    throw new DomainError('invalid_input', 'Invalid founder provisioning manifest digest');
  }
  if (evidence.result === 'blocked' && evidence.blockerCode === undefined) {
    throw new DomainError('invalid_input', 'Blocked evidence requires a structured blocker code');
  }
  if (
    evidence.blockerCode !== undefined &&
    evidence.result !== 'blocked' &&
    evidence.result !== 'failed'
  ) {
    throw new DomainError(
      'invalid_input',
      'Blocker codes are limited to failed or blocked evidence',
    );
  }
}

function requestDigest(input: {
  readonly workstreamKey: FounderProvisioningWorkstreamKey;
  readonly toStatus: FounderProvisioningStatus;
  readonly evidence: FounderProvisioningEvidenceInput;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        blockerCode: input.evidence.blockerCode ?? null,
        kind: input.evidence.kind,
        manifestDigest: input.evidence.manifestDigest ?? null,
        observedAt: input.evidence.observedAt.toISOString(),
        result: input.evidence.result,
        tier: input.evidence.tier,
        toStatus: input.toStatus,
        workstreamKey: input.workstreamKey,
      }),
    )
    .digest('base64url');
}

async function databaseAuthorityNow(transaction: SqlExecutor): Promise<Date> {
  const result = await transaction.query<{ authority_now: unknown } & Record<string, unknown>>(
    'SELECT clock_timestamp() AS authority_now',
  );
  return asDate(result.rows[0]?.authority_now, 'database authority time');
}

async function lockConfiguredFounder(
  transaction: SqlExecutor,
  configuredFounderPersonId: string | undefined,
  actorPersonId: string,
): Promise<void> {
  if (configuredFounderPersonId === undefined || actorPersonId !== configuredFounderPersonId) {
    throw new DomainError(
      'not_authorized',
      'Founder provisioning requires the exact configured founder identity',
    );
  }
  const assignment = await transaction.query(
    `SELECT employee.id
     FROM employee_assignments employee
     JOIN organizations organization ON organization.id = employee.organization_id
     WHERE employee.person_id = $1 AND employee.role = 'hq_owner'
       AND employee.status = 'active' AND organization.kind = 'internal'
     ORDER BY employee.id
     LIMIT 1
     FOR UPDATE`,
    [actorPersonId],
  );
  if (assignment.rows[0] === undefined) {
    throw new DomainError(
      'not_authorized',
      'Founder provisioning requires an active internal hq_owner assignment',
    );
  }
}

async function writeProvisioningAudit(
  transaction: SqlExecutor,
  ids: IdFactory,
  input: {
    readonly access: FounderProvisioningAccess;
    readonly action: 'founder.provisioning.read' | 'founder.provisioning.transition';
    readonly resourceId: string;
    readonly outcome: 'allowed' | 'completed';
    readonly metadata: Readonly<Record<string, string | number | boolean>>;
    readonly now: Date;
  },
): Promise<void> {
  await transaction.query(
    `INSERT INTO audit_events(
       id, household_id, actor_person_id, session_audience, action, resource_type,
       resource_id, outcome, metadata, correlation_id, occurred_at
     ) VALUES ($1,NULL,$2,'hq',$3,'founder_provisioning',$4,$5,$6::jsonb,$7,$8)`,
    [
      ids.next('audit'),
      input.access.actorPersonId,
      input.action,
      input.resourceId,
      input.outcome,
      JSON.stringify(input.metadata),
      input.access.correlationId,
      input.now.toISOString(),
    ],
  );
}

function statusIsValid(status: string): status is FounderProvisioningStatus {
  return founderProvisioningStatuses.includes(status as FounderProvisioningStatus);
}

export function founderProvisioningDefinitionDigest(
  entry: FounderProvisioningCatalogueEntry,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        key: entry.key,
        definitionVersion: entry.definitionVersion,
        displayOrder: entry.displayOrder,
        provider: entry.provider,
        purpose: entry.purpose,
        accountOwner: entry.accountOwner,
        initialStatus: entry.initialStatus,
        adapterState: entry.adapterState,
        manualSteps: entry.manualSteps.map(({ code, instruction, requiredBefore }) => ({
          code,
          instruction,
          requiredBefore,
        })),
        requiredIdentifierNames: [...entry.requiredIdentifierNames],
        configurationEnvironmentNames: [...entry.configurationEnvironmentNames],
        secretEnvironmentNames: [...entry.secretEnvironmentNames],
        verificationTest: entry.verificationTest,
        allowedProofTiers: [...entry.allowedProofTiers],
        monthlyCostCeiling: entry.monthlyCostCeiling,
        recoveryOwner: entry.recoveryOwner,
        exportTermination: entry.exportTermination,
        nextFounderAction: entry.nextFounderAction,
      }),
    )
    .digest('base64url');
}

function mapRegisterRows(
  rows: readonly RegisterRow[],
): readonly FounderProvisioningRegisterEntryRecord[] {
  if (rows.length !== founderProvisioningCatalogue.length) {
    throw new Error('Founder provisioning catalogue is incomplete');
  }
  const byKey = new Map(rows.map((row) => [row.workstream_key, row]));
  return founderProvisioningCatalogue.map((catalogue) => {
    const row = byKey.get(catalogue.key);
    if (
      row === undefined ||
      row.definition_version !== catalogue.definitionVersion ||
      row.display_order !== catalogue.displayOrder ||
      row.definition_digest !== founderProvisioningDefinitionDigest(catalogue) ||
      row.initial_status !== catalogue.initialStatus ||
      JSON.stringify(stringArray(row.allowed_proof_tiers, 'allowed_proof_tiers')) !==
        JSON.stringify(catalogue.allowedProofTiers) ||
      !statusIsValid(row.to_status)
    ) {
      throw new Error(`Founder provisioning catalogue drift: ${catalogue.key}`);
    }
    return {
      catalogue,
      status: row.to_status,
      version: row.version,
      latestEvidence: {
        tier: row.tier,
        kind: row.kind,
        result: row.result,
        ...(row.blocker_code === null ? {} : { blockerCode: row.blocker_code }),
        ...(row.manifest_digest === null ? {} : { manifestDigest: row.manifest_digest }),
        observedAt: asDate(row.observed_at, 'founder_provisioning_evidence.observed_at'),
        recordedAt: asDate(row.recorded_at, 'founder_provisioning_evidence.recorded_at'),
      },
    };
  });
}

export class FounderProvisioningRepository {
  constructor(
    private readonly database: Database,
    private readonly configuredFounderPersonId: string | undefined,
    private readonly ids: IdFactory = randomIdFactory,
  ) {}

  async register(
    access: FounderProvisioningAccess,
  ): Promise<readonly FounderProvisioningRegisterEntryRecord[]> {
    assertBoundedIdentifier(access.correlationId, 'correlation identifier');
    return this.database.transaction(async (transaction) => {
      await lockConfiguredFounder(
        transaction,
        this.configuredFounderPersonId,
        access.actorPersonId,
      );
      const now = await databaseAuthorityNow(transaction);
      await writeProvisioningAudit(transaction, this.ids, {
        access,
        action: 'founder.provisioning.read',
        resourceId: 'register',
        outcome: 'allowed',
        metadata: {
          catalogueVersion: 1,
          evidenceBoundary: 'names_digests_enums_only',
          externalActionExecuted: false,
        },
        now,
      });
      const result = await transaction.query<RegisterRow>(`
        SELECT DISTINCT ON (workstream.workstream_key)
          workstream.workstream_key, workstream.definition_version, workstream.display_order,
          workstream.definition_digest,
          workstream.initial_status, workstream.allowed_proof_tiers,
          status.to_status, status.version, evidence.tier, evidence.kind, evidence.result,
          evidence.blocker_code, evidence.manifest_digest,
          evidence.observed_at, evidence.recorded_at
        FROM founder_provisioning_workstreams workstream
        JOIN founder_provisioning_status_events status
          ON status.workstream_key = workstream.workstream_key
        JOIN founder_provisioning_evidence evidence
          ON evidence.workstream_key = status.workstream_key AND evidence.id = status.evidence_id
        ORDER BY workstream.workstream_key, status.version DESC
      `);
      return mapRegisterRows(result.rows);
    });
  }

  async transition(input: {
    readonly access: FounderProvisioningAccess;
    readonly workstreamKey: FounderProvisioningWorkstreamKey;
    readonly operationKey: string;
    readonly toStatus: FounderProvisioningStatus;
    readonly evidence: FounderProvisioningEvidenceInput;
  }): Promise<FounderProvisioningTransitionRecord> {
    assertBoundedIdentifier(input.access.correlationId, 'correlation identifier');
    assertOperationKey(input.operationKey, input.workstreamKey);
    assertEvidenceInput(input.evidence);
    const digest = requestDigest(input);

    return this.database.transaction(async (transaction) => {
      await lockConfiguredFounder(
        transaction,
        this.configuredFounderPersonId,
        input.access.actorPersonId,
      );
      const workstream = founderProvisioningEntry(input.workstreamKey);
      const lockedWorkstream = await transaction.query<WorkstreamRow>(
        `SELECT workstream_key, definition_version, display_order, definition_digest,
                initial_status, allowed_proof_tiers
         FROM founder_provisioning_workstreams
         WHERE workstream_key = $1
         FOR UPDATE`,
        [input.workstreamKey],
      );
      const locked = lockedWorkstream.rows[0];
      if (
        locked === undefined ||
        locked.definition_version !== workstream.definitionVersion ||
        locked.display_order !== workstream.displayOrder ||
        locked.definition_digest !== founderProvisioningDefinitionDigest(workstream) ||
        locked.initial_status !== workstream.initialStatus ||
        JSON.stringify(stringArray(locked.allowed_proof_tiers, 'allowed_proof_tiers')) !==
          JSON.stringify(workstream.allowedProofTiers)
      ) {
        throw new Error(`Founder provisioning catalogue drift: ${input.workstreamKey}`);
      }
      const now = await databaseAuthorityNow(transaction);

      const operation = await transaction.query<OperationRow>(
        `INSERT INTO founder_provisioning_operations(
           operation_key, workstream_key, request_digest, actor_person_id, created_at
         ) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (operation_key) DO NOTHING
         RETURNING operation_key, workstream_key, request_digest, actor_person_id`,
        [
          input.operationKey,
          input.workstreamKey,
          digest,
          input.access.actorPersonId,
          now.toISOString(),
        ],
      );

      if (operation.rows[0] === undefined) {
        const existingOperation = await transaction.query<OperationRow>(
          `SELECT operation_key, workstream_key, request_digest, actor_person_id
           FROM founder_provisioning_operations
           WHERE operation_key = $1`,
          [input.operationKey],
        );
        const existing = existingOperation.rows[0];
        if (
          existing === undefined ||
          existing.request_digest !== digest ||
          existing.workstream_key !== input.workstreamKey ||
          existing.actor_person_id !== input.access.actorPersonId
        ) {
          throw new DomainError(
            'conflict',
            'Founder provisioning idempotency key was used for a different request',
          );
        }
        const prior = await transaction.query<StatusRow>(
          `SELECT id, workstream_key, to_status, version, evidence_id, occurred_at
           FROM founder_provisioning_status_events
           WHERE operation_key = $1`,
          [input.operationKey],
        );
        const row = prior.rows[0];
        if (row === undefined) throw new Error('Founder provisioning operation is incomplete');
        await writeProvisioningAudit(transaction, this.ids, {
          access: input.access,
          action: 'founder.provisioning.transition',
          resourceId: input.workstreamKey,
          outcome: 'completed',
          metadata: {
            evidenceKind: input.evidence.kind,
            evidenceTier: input.evidence.tier,
            externalActionExecuted: false,
            reused: true,
            status: row.to_status,
            version: row.version,
          },
          now,
        });
        return {
          workstreamKey: row.workstream_key,
          status: row.to_status,
          version: row.version,
          evidenceId: row.evidence_id,
          reused: true,
          externalActionExecuted: false,
        };
      }

      const currentStatus = await transaction.query<StatusRow>(
        `SELECT id, workstream_key, to_status, version, evidence_id, occurred_at
         FROM founder_provisioning_status_events
         WHERE workstream_key = $1
         ORDER BY version DESC
         LIMIT 1`,
        [input.workstreamKey],
      );
      const current = currentStatus.rows[0];
      if (current === undefined) {
        throw new Error(`Founder provisioning status is missing: ${input.workstreamKey}`);
      }
      try {
        assertFounderProvisioningEvidenceChronology({
          currentStatusOccurredAt: asDate(
            current.occurred_at,
            'founder_provisioning_status_events.occurred_at',
          ),
          evidenceObservedAt: input.evidence.observedAt,
          recordedAt: now,
          toStatus: input.toStatus,
        });
      } catch (error) {
        throw new DomainError(
          'invalid_input',
          error instanceof Error ? error.message : 'Invalid founder provisioning chronology',
        );
      }
      try {
        assertFounderProvisioningTransition({
          workstream,
          from: current.to_status,
          to: input.toStatus,
          evidence: input.evidence,
        });
      } catch (error) {
        throw new DomainError(
          'invalid_transition',
          error instanceof Error ? error.message : 'Invalid founder provisioning transition',
        );
      }

      const evidenceId = this.ids.next('provisioning_evidence');
      const statusId = this.ids.next('provisioning_status');
      await transaction.query(
        `INSERT INTO founder_provisioning_evidence(
           id, workstream_key, actor_person_id, tier, kind, result, blocker_code,
           manifest_digest, observed_at, recorded_at, correlation_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          evidenceId,
          input.workstreamKey,
          input.access.actorPersonId,
          input.evidence.tier,
          input.evidence.kind,
          input.evidence.result,
          input.evidence.blockerCode ?? null,
          input.evidence.manifestDigest ?? null,
          input.evidence.observedAt.toISOString(),
          now.toISOString(),
          input.access.correlationId,
        ],
      );
      const nextVersion = current.version + 1;
      await transaction.query(
        `INSERT INTO founder_provisioning_status_events(
           id, workstream_key, from_status, to_status, version, evidence_id,
           actor_person_id, operation_key, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          statusId,
          input.workstreamKey,
          current.to_status,
          input.toStatus,
          nextVersion,
          evidenceId,
          input.access.actorPersonId,
          input.operationKey,
          now.toISOString(),
        ],
      );
      await writeProvisioningAudit(transaction, this.ids, {
        access: input.access,
        action: 'founder.provisioning.transition',
        resourceId: input.workstreamKey,
        outcome: 'completed',
        metadata: {
          evidenceKind: input.evidence.kind,
          evidenceTier: input.evidence.tier,
          externalActionExecuted: false,
          reused: false,
          status: input.toStatus,
          version: nextVersion,
        },
        now,
      });
      return {
        workstreamKey: input.workstreamKey,
        status: input.toStatus,
        version: nextVersion,
        evidenceId,
        reused: false,
        externalActionExecuted: false,
      };
    });
  }
}
