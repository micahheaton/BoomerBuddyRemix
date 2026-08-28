import { DomainError } from '@boomerbuddy/domain';
import {
  encryptField,
  fingerprintMinimized,
  minimizeRestrictedInput,
  serializeEncryptedField,
} from '@boomerbuddy/security';
import type { Audience } from '@boomerbuddy/domain';
import type { Database, SqlExecutor } from './database';
import {
  hasEffectiveProtectedEnrollment,
  type EntitlementRuntimeEnvironment,
} from './entitlements';
import { writeAuditAndOutbox } from './events';
import {
  asDate,
  jsonParameter,
  jsonValue,
  placeholders,
  randomIdFactory,
  type IdFactory,
} from './values';

export interface ArtifactProtection {
  readonly encryptionKey: Uint8Array;
  readonly encryptionKeyVersion: number;
  readonly fingerprintKey: Uint8Array;
  readonly fingerprintKeyVersion: number;
}

export interface EvidenceRecord {
  readonly kind: 'artifact' | 'reputation' | 'model' | 'missing';
  readonly label: string;
  readonly observation: string;
  readonly limitations: string;
}

export interface ActionRecord {
  readonly key: string;
  readonly priority: number;
  readonly title: string;
  readonly detail: string;
  readonly officialChannelOnly: boolean;
}

export interface DecisionRecord {
  readonly risk: 'lower_concern' | 'caution' | 'high_concern' | 'unknown';
  readonly summary: string;
  readonly evidence: readonly EvidenceRecord[];
  readonly actions: readonly ActionRecord[];
  readonly provider: {
    readonly name: string;
    readonly state: 'mock' | 'unknown' | 'unavailable' | 'verified';
    readonly version: string;
  };
  readonly rulesetVersion: string;
  readonly evidenceSufficiency: 'limited' | 'moderate' | 'strong';
  readonly calibration: 'not_calibrated';
}

interface CheckVisibilityScope {
  readonly includeOwned: boolean;
  readonly includeExplicitlyShared: boolean;
}

function visibilityPredicate(scope: CheckVisibilityScope, actorSlot: number): string {
  const categories: string[] = [];
  if (scope.includeOwned) categories.push(`a.requested_by = $${actorSlot}`);
  if (scope.includeExplicitlyShared) {
    categories.push(`EXISTS (
      SELECT 1 FROM check_shares s
      JOIN trusted_circle_relationships t
        ON t.household_id = s.household_id AND t.id = s.relationship_id
      JOIN household_memberships trusted_membership
        ON trusted_membership.household_id = t.household_id
       AND trusted_membership.person_id = t.trusted_person_id
       AND trusted_membership.status = 'active'
      JOIN household_memberships protected_membership
        ON protected_membership.household_id = t.household_id
       AND protected_membership.person_id = t.protected_person_id
       AND protected_membership.status = 'active'
      JOIN consents c
        ON c.household_id = t.household_id AND c.id = t.consent_id
      WHERE s.household_id = a.household_id AND s.analysis_id = a.id
        AND s.shared_with_person_id = $${actorSlot}
        AND t.trusted_person_id = $${actorSlot} AND t.state = 'active'
        AND t.protected_person_id = a.requested_by
        AND t.permissions ? 'view_shared_checks'
        AND c.state = 'active'
    )`);
  }
  return categories.length === 0 ? 'false' : categories.map((item) => `(${item})`).join(' OR ');
}

export interface StoredCheck extends DecisionRecord {
  readonly id: string;
  readonly artifactId: string;
  readonly householdId: string;
  readonly ownerPersonId: string;
  readonly kind: 'text' | 'url';
  readonly createdAt: Date;
  readonly deleteAfter: Date;
  readonly state: 'active' | 'deleted';
}

export type CheckShareLifecycleState = 'shared' | 'acknowledged' | 'closed';
export type CheckShareClosureReason = 'safer_action_completed' | 'no_longer_needs_help';

export interface CheckShareLifecycleRecord {
  readonly checkId: string;
  readonly sharedWithPersonId: string;
  readonly sharedWithDisplayName: string;
  readonly state: CheckShareLifecycleState;
  readonly sharedAt: Date;
  readonly acknowledgedAt?: Date;
  readonly closedAt?: Date;
  readonly closureReason?: CheckShareClosureReason;
}

interface CheckShareRow extends Record<string, unknown> {
  readonly analysis_id: string;
  readonly shared_with_person_id: string;
  readonly shared_with_display_name: string;
  readonly lifecycle_state: CheckShareLifecycleState;
  readonly created_at: unknown;
  readonly acknowledged_at: unknown | null;
  readonly closed_at: unknown | null;
  readonly closure_reason: CheckShareClosureReason | null;
}

function mapCheckShare(row: CheckShareRow): CheckShareLifecycleRecord {
  return {
    checkId: row.analysis_id,
    sharedWithPersonId: row.shared_with_person_id,
    sharedWithDisplayName: row.shared_with_display_name,
    state: row.lifecycle_state,
    sharedAt: asDate(row.created_at, 'check_shares.created_at'),
    ...(row.acknowledged_at === null
      ? {}
      : { acknowledgedAt: asDate(row.acknowledged_at, 'check_shares.acknowledged_at') }),
    ...(row.closed_at === null
      ? {}
      : { closedAt: asDate(row.closed_at, 'check_shares.closed_at') }),
    ...(row.closure_reason === null ? {} : { closureReason: row.closure_reason }),
  };
}

const checkShareProjection = `
  SELECT share.analysis_id, share.shared_with_person_id,
         person.display_name AS shared_with_display_name,
         share.lifecycle_state, share.created_at, share.acknowledged_at,
         share.closed_at, share.closure_reason
  FROM check_shares share
  JOIN persons person ON person.id = share.shared_with_person_id
`;

interface CheckRow extends Record<string, unknown> {
  readonly id: string;
  readonly artifact_id: string;
  readonly household_id: string;
  readonly owner_person_id: string;
  readonly kind: string;
  readonly risk: StoredCheck['risk'];
  readonly evidence_sufficiency: StoredCheck['evidenceSufficiency'];
  readonly calibration: 'not_calibrated';
  readonly summary: string;
  readonly evidence: unknown;
  readonly actions: unknown;
  readonly provider_name: string;
  readonly provider_state: StoredCheck['provider']['state'];
  readonly provider_version: string;
  readonly ruleset_version: string;
  readonly created_at: unknown;
  readonly delete_after: unknown;
  readonly artifact_state: string;
}

function parseEvidence(value: unknown): readonly EvidenceRecord[] {
  const parsed = jsonValue(value);
  if (!Array.isArray(parsed)) throw new TypeError('Invalid stored evidence');
  return parsed as readonly EvidenceRecord[];
}

function parseActions(value: unknown): readonly ActionRecord[] {
  const parsed = jsonValue(value);
  if (!Array.isArray(parsed)) throw new TypeError('Invalid stored actions');
  return parsed as readonly ActionRecord[];
}

function mapCheck(row: CheckRow): StoredCheck {
  if (row.kind !== 'text' && row.kind !== 'url') throw new TypeError('Invalid stored Check kind');
  return {
    id: row.id,
    artifactId: row.artifact_id,
    householdId: row.household_id,
    ownerPersonId: row.owner_person_id,
    kind: row.kind,
    risk: row.risk,
    evidenceSufficiency: row.evidence_sufficiency,
    calibration: row.calibration,
    summary: row.summary,
    evidence: parseEvidence(row.evidence),
    actions: parseActions(row.actions),
    provider: {
      name: row.provider_name,
      state: row.provider_state,
      version: row.provider_version,
    },
    rulesetVersion: row.ruleset_version,
    createdAt: asDate(row.created_at, 'analyses.created_at'),
    deleteAfter: asDate(row.delete_after, 'artifacts.delete_after'),
    state: row.artifact_state === 'deleted' ? 'deleted' : 'active',
  };
}

const checkProjection = `
  SELECT a.id, a.artifact_id, a.household_id, a.requested_by AS owner_person_id,
         r.kind, a.risk, a.evidence_sufficiency, a.calibration, a.summary, a.evidence, a.actions,
         a.provider_name, a.provider_state, a.provider_version, a.ruleset_version,
         a.created_at, r.delete_after, r.state AS artifact_state
  FROM analyses a
  JOIN artifacts r ON r.household_id = a.household_id AND r.id = a.artifact_id
`;

export interface CreateStoredCheckInput {
  readonly householdId: string;
  readonly actorPersonId: string;
  readonly audience: Audience;
  readonly kind: 'text' | 'url';
  readonly content: string;
  readonly decision: DecisionRecord;
  readonly correlationId: string;
  readonly now: Date;
  readonly ids?: { readonly artifactId: string; readonly analysisId: string };
}

export class CheckRepository {
  constructor(
    private readonly database: Database,
    private readonly protection: ArtifactProtection,
    private readonly idFactory: IdFactory = randomIdFactory,
    private readonly runtimeEnvironment: EntitlementRuntimeEnvironment = 'production',
  ) {}

  async create(input: CreateStoredCheckInput): Promise<StoredCheck> {
    return this.database.transaction((transaction) => this.createWithExecutor(transaction, input));
  }

  async createWithExecutor(
    transaction: SqlExecutor,
    input: CreateStoredCheckInput,
  ): Promise<StoredCheck> {
    const minimized = minimizeRestrictedInput(input.content, input.kind === 'url' ? 4_096 : 16_384);
    if (minimized.status === 'rejected') {
      throw new DomainError(
        'restricted_input',
        'Remove credentials or payment details before checking',
        {
          detected: minimized.detected.join(','),
        },
      );
    }
    const artifactId = input.ids?.artifactId ?? this.idFactory.next('artifact');
    const analysisId = input.ids?.analysisId ?? this.idFactory.next('analysis');
    const deleteAfter = new Date(input.now.getTime() + 30 * 24 * 60 * 60 * 1_000);
    const encrypted = serializeEncryptedField(
      encryptField(minimized.minimized, this.protection.encryptionKey, {
        tenantId: input.householdId,
        resourceId: artifactId,
        field: 'content',
        schemaVersion: 1,
        keyVersion: this.protection.encryptionKeyVersion,
      }),
    );
    const fingerprint = fingerprintMinimized(minimized.minimized, this.protection.fingerprintKey, {
      tenantId: input.householdId,
      purpose: `artifact:${input.kind}`,
      keyVersion: this.protection.fingerprintKeyVersion,
    });
    const hasEnrollment = await hasEffectiveProtectedEnrollment(
      transaction,
      input.householdId,
      input.actorPersonId,
      input.now,
      true,
      this.runtimeEnvironment,
    );
    if (!hasEnrollment) {
      throw new DomainError('not_authorized', 'Protected-member enrollment is required');
    }
    await transaction.query(
      `INSERT INTO artifacts(
           household_id, id, owner_person_id, kind, encrypted_content, input_fingerprint,
           encryption_key_version, fingerprint_key_version, state, delete_after, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10)`,
      [
        input.householdId,
        artifactId,
        input.actorPersonId,
        input.kind,
        encrypted,
        fingerprint.value,
        this.protection.encryptionKeyVersion,
        this.protection.fingerprintKeyVersion,
        deleteAfter.toISOString(),
        input.now.toISOString(),
      ],
    );
    await transaction.query(
      `INSERT INTO analyses(
           household_id, id, artifact_id, requested_by, risk, evidence_sufficiency, calibration, summary, evidence,
           actions, provider_name, provider_state, provider_version, ruleset_version, state, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,'completed',$15)`,
      [
        input.householdId,
        analysisId,
        artifactId,
        input.actorPersonId,
        input.decision.risk,
        input.decision.evidenceSufficiency,
        input.decision.calibration,
        input.decision.summary,
        jsonParameter(input.decision.evidence),
        jsonParameter(input.decision.actions),
        input.decision.provider.name,
        input.decision.provider.state,
        input.decision.provider.version,
        input.decision.rulesetVersion,
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
        action: 'check.created',
        resourceType: 'check',
        resourceId: analysisId,
        outcome: 'completed',
        metadata: {
          kind: input.kind,
          risk: input.decision.risk,
          providerState: input.decision.provider.state,
        },
      },
      {
        eventType: 'check.completed.v1',
        aggregateType: 'check',
        aggregateId: analysisId,
        payload: {
          kind: input.kind,
          risk: input.decision.risk,
          providerState: input.decision.provider.state,
        },
      },
    );
    return {
      id: analysisId,
      artifactId,
      householdId: input.householdId,
      ownerPersonId: input.actorPersonId,
      kind: input.kind,
      ...input.decision,
      createdAt: input.now,
      deleteAfter,
      state: 'active',
    };
  }

  async findOwnedWithExecutor(
    executor: SqlExecutor,
    input: {
      readonly householdId: string;
      readonly checkId: string;
      readonly actorPersonId: string;
      readonly now: Date;
    },
  ): Promise<StoredCheck | null> {
    const result = await executor.query<CheckRow>(
      `${checkProjection}
       WHERE a.household_id = $1 AND a.id = $2 AND a.requested_by = $3
         AND a.state = 'completed' AND r.state = 'active' AND r.delete_after > $4`,
      [input.householdId, input.checkId, input.actorPersonId, input.now.toISOString()],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapCheck(row);
  }

  async listVisible(input: {
    readonly householdIds: readonly string[];
    readonly actorPersonId: string;
    readonly now: Date;
    readonly includeOwned: boolean;
    readonly includeExplicitlyShared: boolean;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly StoredCheck[]> {
    if (input.householdIds.length === 0) return [];
    const tenantSlots = placeholders(1, input.householdIds.length);
    const actorSlot = input.householdIds.length + 1;
    const nowSlot = actorSlot + 1;
    const limitSlot = nowSlot + 1;
    const offsetSlot = limitSlot + 1;
    const result = await this.database.query<CheckRow>(
      `${checkProjection}
       WHERE a.household_id IN (${tenantSlots})
         AND a.state = 'completed' AND r.state = 'active' AND r.delete_after > $${nowSlot}
         AND (${visibilityPredicate(input, actorSlot)})
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${limitSlot} OFFSET $${offsetSlot}`,
      [
        ...input.householdIds,
        input.actorPersonId,
        input.now.toISOString(),
        Math.max(1, Math.min(Math.floor(input.limit ?? 50), 100)),
        Math.max(0, Math.floor(input.offset ?? 0)),
      ],
    );
    return result.rows.map(mapCheck);
  }

  async countVisible(input: {
    readonly householdIds: readonly string[];
    readonly actorPersonId: string;
    readonly now: Date;
    readonly includeOwned: boolean;
    readonly includeExplicitlyShared: boolean;
  }): Promise<number> {
    if (input.householdIds.length === 0) return 0;
    const tenantSlots = placeholders(1, input.householdIds.length);
    const actorSlot = input.householdIds.length + 1;
    const nowSlot = actorSlot + 1;
    const result = await this.database.query<{ total: number } & Record<string, unknown>>(
      `SELECT count(*)::int AS total
       FROM analyses a
       JOIN artifacts r ON r.household_id = a.household_id AND r.id = a.artifact_id
       WHERE a.household_id IN (${tenantSlots})
         AND a.state = 'completed' AND r.state = 'active' AND r.delete_after > $${nowSlot}
         AND (${visibilityPredicate(input, actorSlot)})`,
      [...input.householdIds, input.actorPersonId, input.now.toISOString()],
    );
    return result.rows[0]?.total ?? 0;
  }

  async findVisible(input: {
    readonly checkId: string;
    readonly householdIds: readonly string[];
    readonly actorPersonId: string;
    readonly now: Date;
  }): Promise<StoredCheck | null> {
    if (input.householdIds.length === 0) return null;
    const tenantSlots = placeholders(2, input.householdIds.length);
    const actorSlot = input.householdIds.length + 2;
    const nowSlot = actorSlot + 1;
    const result = await this.database.query<CheckRow>(
      `${checkProjection}
       WHERE a.id = $1 AND a.household_id IN (${tenantSlots})
         AND a.state = 'completed' AND r.state = 'active' AND r.delete_after > $${nowSlot}
         AND (
           a.requested_by = $${actorSlot}
           OR EXISTS (
             SELECT 1 FROM check_shares s
             JOIN trusted_circle_relationships t
               ON t.household_id = s.household_id AND t.id = s.relationship_id
             JOIN household_memberships trusted_membership
               ON trusted_membership.household_id = t.household_id
              AND trusted_membership.person_id = t.trusted_person_id
              AND trusted_membership.status = 'active'
             JOIN household_memberships protected_membership
               ON protected_membership.household_id = t.household_id
              AND protected_membership.person_id = t.protected_person_id
              AND protected_membership.status = 'active'
             JOIN consents c
               ON c.household_id = t.household_id AND c.id = t.consent_id
             WHERE s.household_id = a.household_id AND s.analysis_id = a.id
               AND s.shared_with_person_id = $${actorSlot}
               AND t.trusted_person_id = $${actorSlot} AND t.state = 'active'
               AND t.protected_person_id = a.requested_by
               AND t.permissions ? 'view_shared_checks'
               AND c.state = 'active'
           )
         )`,
      [input.checkId, ...input.householdIds, input.actorPersonId, input.now.toISOString()],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapCheck(row);
  }

  async purgeDue(input: {
    readonly now: Date;
    readonly limit?: number;
  }): Promise<readonly string[]> {
    const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 100), 500));
    return this.database.transaction(async (transaction) => {
      const due = await transaction.query<
        { household_id: string; id: string; artifact_id: string } & Record<string, unknown>
      >(
        `SELECT a.household_id, a.id, a.artifact_id
         FROM analyses a
         JOIN artifacts r ON r.household_id = a.household_id AND r.id = a.artifact_id
         WHERE a.state = 'completed' AND r.state = 'active' AND r.delete_after <= $1
         ORDER BY r.delete_after, a.id LIMIT $2 FOR UPDATE OF a, r`,
        [input.now.toISOString(), limit],
      );
      for (const check of due.rows) {
        await transaction.query(
          `DELETE FROM check_shares WHERE household_id = $1 AND analysis_id = $2`,
          [check.household_id, check.id],
        );
        await transaction.query(
          `UPDATE artifacts SET state = 'deleted', encrypted_content = NULL,
             input_fingerprint = NULL, deleted_at = $3
           WHERE household_id = $1 AND id = $2 AND state = 'active'`,
          [check.household_id, check.artifact_id, input.now.toISOString()],
        );
        await transaction.query(
          `UPDATE analyses SET state = 'deleted', risk = 'unknown',
             evidence_sufficiency = 'limited', summary = 'Deleted', evidence = '[]'::jsonb,
             actions = '[]'::jsonb, provider_name = 'deleted', provider_state = 'unavailable',
             provider_version = 'deleted', ruleset_version = 'deleted', deleted_at = $3
           WHERE household_id = $1 AND id = $2 AND state = 'completed'`,
          [check.household_id, check.id, input.now.toISOString()],
        );
        await writeAuditAndOutbox(
          transaction,
          this.idFactory,
          {
            householdId: check.household_id,
            correlationId: `retention-${check.id}`,
            now: input.now,
          },
          {
            action: 'check.retention_deleted',
            resourceType: 'check',
            resourceId: check.id,
            outcome: 'completed',
            metadata: { reason: 'retention_due' },
          },
          {
            eventType: 'check.retention_deleted.v1',
            aggregateType: 'check',
            aggregateId: check.id,
            payload: { state: 'deleted', reason: 'retention_due' },
          },
        );
      }
      return due.rows.map((row) => row.id);
    });
  }

  async deleteOwned(input: {
    readonly checkId: string;
    readonly householdIds: readonly string[];
    readonly actorPersonId: string;
    readonly audience: Audience;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<StoredCheck | null> {
    const existing = await this.findVisible(input);
    if (existing === null || existing.ownerPersonId !== input.actorPersonId) return null;
    await this.database.transaction(async (transaction) => {
      await transaction.query(
        `DELETE FROM check_shares WHERE household_id = $1 AND analysis_id = $2`,
        [existing.householdId, existing.id],
      );
      await transaction.query(
        `UPDATE artifacts SET state = 'deleted', encrypted_content = NULL, input_fingerprint = NULL,
         deleted_at = $3 WHERE household_id = $1 AND id = $2 AND state = 'active'`,
        [existing.householdId, existing.artifactId, input.now.toISOString()],
      );
      await transaction.query(
        `UPDATE analyses SET state = 'deleted', risk = 'unknown',
           evidence_sufficiency = 'limited', summary = 'Deleted', evidence = '[]'::jsonb,
           actions = '[]'::jsonb, provider_name = 'deleted', provider_state = 'unavailable',
           provider_version = 'deleted', ruleset_version = 'deleted', deleted_at = $3
         WHERE household_id = $1 AND id = $2 AND state = 'completed'`,
        [existing.householdId, existing.id, input.now.toISOString()],
      );
      await writeAuditAndOutbox(
        transaction,
        this.idFactory,
        {
          householdId: existing.householdId,
          actorPersonId: input.actorPersonId,
          audience: input.audience,
          correlationId: input.correlationId,
          now: input.now,
        },
        {
          action: 'check.deleted',
          resourceType: 'check',
          resourceId: existing.id,
          outcome: 'completed',
        },
        {
          eventType: 'check.deleted.v1',
          aggregateType: 'check',
          aggregateId: existing.id,
          payload: { state: 'deleted' },
        },
      );
    });
    return { ...existing, state: 'deleted' };
  }

  async share(input: {
    readonly checkId: string;
    readonly householdId: string;
    readonly ownerPersonId: string;
    readonly sharedWithPersonId: string;
    readonly audience: Audience;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<CheckShareLifecycleRecord> {
    return this.database.transaction(async (transaction) => {
      const hasEnrollment = await hasEffectiveProtectedEnrollment(
        transaction,
        input.householdId,
        input.ownerPersonId,
        input.now,
        true,
        this.runtimeEnvironment,
      );
      if (!hasEnrollment) {
        throw new DomainError('not_authorized', 'Protected-member enrollment is required');
      }
      const allowed = await transaction.query<
        { relationship_id: string } & Record<string, unknown>
      >(
        `SELECT t.id AS relationship_id FROM analyses a
         JOIN artifacts r ON r.household_id = a.household_id AND r.id = a.artifact_id
         JOIN trusted_circle_relationships t ON t.household_id = a.household_id
         JOIN household_memberships trusted_membership
           ON trusted_membership.household_id = t.household_id
          AND trusted_membership.person_id = t.trusted_person_id
          AND trusted_membership.status = 'active'
         JOIN household_memberships protected_membership
           ON protected_membership.household_id = t.household_id
          AND protected_membership.person_id = t.protected_person_id
          AND protected_membership.status = 'active'
         JOIN consents c ON c.household_id = t.household_id AND c.id = t.consent_id
         WHERE a.household_id = $1 AND a.id = $2 AND a.requested_by = $3
           AND a.state = 'completed' AND r.state = 'active' AND r.delete_after > $5
           AND t.protected_person_id = a.requested_by
           AND t.trusted_person_id = $4 AND t.state = 'active'
           AND c.state = 'active'
           AND t.permissions ? 'view_shared_checks'`,
        [
          input.householdId,
          input.checkId,
          input.ownerPersonId,
          input.sharedWithPersonId,
          input.now.toISOString(),
        ],
      );
      const relationshipId = allowed.rows[0]?.relationship_id;
      if (relationshipId === undefined)
        throw new DomainError('not_authorized', 'Sharing is not permitted');
      const inserted = await transaction.query(
        `INSERT INTO check_shares(
           household_id, analysis_id, relationship_id, shared_with_person_id, shared_by_person_id, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING
         RETURNING analysis_id`,
        [
          input.householdId,
          input.checkId,
          relationshipId,
          input.sharedWithPersonId,
          input.ownerPersonId,
          input.now.toISOString(),
        ],
      );
      if (inserted.rowCount === 1) {
        await transaction.query(
          `INSERT INTO check_share_lifecycle_events(
             id, household_id, analysis_id, shared_with_person_id, actor_person_id,
             event_kind, state_after, closure_reason, created_at
           ) VALUES ($1,$2,$3,$4,$5,'shared','shared',NULL,$6)`,
          [
            this.idFactory.next('check_share_event'),
            input.householdId,
            input.checkId,
            input.sharedWithPersonId,
            input.ownerPersonId,
            input.now.toISOString(),
          ],
        );
        await writeAuditAndOutbox(
          transaction,
          this.idFactory,
          {
            householdId: input.householdId,
            actorPersonId: input.ownerPersonId,
            audience: input.audience,
            correlationId: input.correlationId,
            now: input.now,
          },
          {
            action: 'check.shared',
            resourceType: 'check',
            resourceId: input.checkId,
            outcome: 'completed',
          },
          {
            eventType: 'check.shared.v1',
            aggregateType: 'check',
            aggregateId: input.checkId,
            payload: { shareState: 'shared' },
          },
        );
      }
      const current = await transaction.query<CheckShareRow>(
        `${checkShareProjection}
         WHERE share.household_id = $1 AND share.analysis_id = $2
           AND share.shared_with_person_id = $3`,
        [input.householdId, input.checkId, input.sharedWithPersonId],
      );
      const row = current.rows[0];
      if (row === undefined) throw new Error('Check share was not persisted');
      return mapCheckShare(row);
    });
  }

  async listShares(input: {
    readonly householdId: string;
    readonly checkId: string;
    readonly actorPersonId: string;
  }): Promise<readonly CheckShareLifecycleRecord[]> {
    const result = await this.database.query<CheckShareRow>(
      `${checkShareProjection}
       WHERE share.household_id = $1 AND share.analysis_id = $2
         AND (share.shared_by_person_id = $3 OR share.shared_with_person_id = $3)
       ORDER BY share.created_at, share.shared_with_person_id`,
      [input.householdId, input.checkId, input.actorPersonId],
    );
    return result.rows.map(mapCheckShare);
  }

  async acknowledgeShare(input: {
    readonly householdId: string;
    readonly checkId: string;
    readonly trustedPersonId: string;
    readonly audience: Audience;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<CheckShareLifecycleRecord | null> {
    return this.database.transaction(async (transaction) => {
      const existing = await transaction.query<
        { readonly lifecycle_state: CheckShareLifecycleState } & Record<string, unknown>
      >(
        `SELECT share.lifecycle_state FROM check_shares share
         JOIN analyses analysis
           ON analysis.household_id = share.household_id
          AND analysis.id = share.analysis_id
         JOIN artifacts artifact
           ON artifact.household_id = analysis.household_id
          AND artifact.id = analysis.artifact_id
         JOIN trusted_circle_relationships relationship
           ON relationship.household_id = share.household_id
          AND relationship.id = share.relationship_id
         JOIN consents consent
           ON consent.household_id = relationship.household_id
          AND consent.id = relationship.consent_id
         WHERE share.household_id = $1 AND share.analysis_id = $2
           AND share.shared_with_person_id = $3
           AND relationship.trusted_person_id = $3
           AND relationship.protected_person_id = analysis.requested_by
           AND relationship.state = 'active'
           AND relationship.permissions ? 'view_shared_checks'
           AND consent.state = 'active'
           AND analysis.state = 'completed' AND artifact.state = 'active'
           AND artifact.delete_after > $4
         FOR UPDATE OF share`,
        [input.householdId, input.checkId, input.trustedPersonId, input.now.toISOString()],
      );
      const row = existing.rows[0];
      if (row === undefined) return null;
      if (row.lifecycle_state === 'shared') {
        const changed = await transaction.query(
          `UPDATE check_shares
           SET lifecycle_state = 'acknowledged', acknowledged_by_person_id = $3,
               acknowledged_at = $4
           WHERE household_id = $1 AND analysis_id = $2
             AND shared_with_person_id = $3 AND lifecycle_state = 'shared'`,
          [input.householdId, input.checkId, input.trustedPersonId, input.now.toISOString()],
        );
        if (changed.rowCount !== 1) throw new DomainError('conflict', 'Check share changed');
        await transaction.query(
          `INSERT INTO check_share_lifecycle_events(
             id, household_id, analysis_id, shared_with_person_id, actor_person_id,
             event_kind, state_after, closure_reason, created_at
           ) VALUES ($1,$2,$3,$4,$4,'acknowledged','acknowledged',NULL,$5)`,
          [
            this.idFactory.next('check_share_event'),
            input.householdId,
            input.checkId,
            input.trustedPersonId,
            input.now.toISOString(),
          ],
        );
        await writeAuditAndOutbox(
          transaction,
          this.idFactory,
          {
            householdId: input.householdId,
            actorPersonId: input.trustedPersonId,
            audience: input.audience,
            correlationId: input.correlationId,
            now: input.now,
          },
          {
            action: 'check.share_acknowledged',
            resourceType: 'check',
            resourceId: input.checkId,
            outcome: 'completed',
          },
          {
            eventType: 'check.share_acknowledged.v1',
            aggregateType: 'check',
            aggregateId: input.checkId,
            payload: { shareState: 'acknowledged' },
          },
        );
      }
      const current = await transaction.query<CheckShareRow>(
        `${checkShareProjection}
         WHERE share.household_id = $1 AND share.analysis_id = $2
           AND share.shared_with_person_id = $3`,
        [input.householdId, input.checkId, input.trustedPersonId],
      );
      const currentRow = current.rows[0];
      return currentRow === undefined ? null : mapCheckShare(currentRow);
    });
  }

  async closeShare(input: {
    readonly householdId: string;
    readonly checkId: string;
    readonly ownerPersonId: string;
    readonly sharedWithPersonId: string;
    readonly resolution: CheckShareClosureReason;
    readonly audience: Audience;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<CheckShareLifecycleRecord | null> {
    return this.database.transaction(async (transaction) => {
      const existing = await transaction.query<
        {
          readonly lifecycle_state: CheckShareLifecycleState;
          readonly closure_reason: CheckShareClosureReason | null;
        } & Record<string, unknown>
      >(
        `SELECT share.lifecycle_state, share.closure_reason FROM check_shares share
         JOIN analyses analysis
           ON analysis.household_id = share.household_id
          AND analysis.id = share.analysis_id
         JOIN artifacts artifact
           ON artifact.household_id = analysis.household_id
          AND artifact.id = analysis.artifact_id
         WHERE share.household_id = $1 AND share.analysis_id = $2
           AND share.shared_by_person_id = $3 AND analysis.requested_by = $3
           AND share.shared_with_person_id = $4
           AND analysis.state = 'completed' AND artifact.state = 'active'
           AND artifact.delete_after > $5
         FOR UPDATE OF share`,
        [
          input.householdId,
          input.checkId,
          input.ownerPersonId,
          input.sharedWithPersonId,
          input.now.toISOString(),
        ],
      );
      const row = existing.rows[0];
      if (row === undefined) return null;
      if (row.lifecycle_state === 'shared') {
        throw new DomainError(
          'conflict',
          'The trusted person must acknowledge this shared result before it can be closed',
        );
      }
      if (row.lifecycle_state === 'closed' && row.closure_reason !== input.resolution) {
        throw new DomainError('conflict', 'This shared result is already closed');
      }
      if (row.lifecycle_state === 'acknowledged') {
        const changed = await transaction.query(
          `UPDATE check_shares
           SET lifecycle_state = 'closed', closed_by_person_id = $3,
               closed_at = $5, closure_reason = $6
           WHERE household_id = $1 AND analysis_id = $2
             AND shared_by_person_id = $3 AND shared_with_person_id = $4
             AND lifecycle_state = 'acknowledged'`,
          [
            input.householdId,
            input.checkId,
            input.ownerPersonId,
            input.sharedWithPersonId,
            input.now.toISOString(),
            input.resolution,
          ],
        );
        if (changed.rowCount !== 1) throw new DomainError('conflict', 'Check share changed');
        await transaction.query(
          `INSERT INTO check_share_lifecycle_events(
             id, household_id, analysis_id, shared_with_person_id, actor_person_id,
             event_kind, state_after, closure_reason, created_at
           ) VALUES ($1,$2,$3,$4,$5,'closed','closed',$6,$7)`,
          [
            this.idFactory.next('check_share_event'),
            input.householdId,
            input.checkId,
            input.sharedWithPersonId,
            input.ownerPersonId,
            input.resolution,
            input.now.toISOString(),
          ],
        );
        await writeAuditAndOutbox(
          transaction,
          this.idFactory,
          {
            householdId: input.householdId,
            actorPersonId: input.ownerPersonId,
            audience: input.audience,
            correlationId: input.correlationId,
            now: input.now,
          },
          {
            action: 'check.share_closed',
            resourceType: 'check',
            resourceId: input.checkId,
            outcome: 'completed',
            metadata: { resolution: input.resolution },
          },
          {
            eventType: 'check.share_closed.v1',
            aggregateType: 'check',
            aggregateId: input.checkId,
            payload: { shareState: 'closed', resolution: input.resolution },
          },
        );
      }
      const current = await transaction.query<CheckShareRow>(
        `${checkShareProjection}
         WHERE share.household_id = $1 AND share.analysis_id = $2
           AND share.shared_with_person_id = $3`,
        [input.householdId, input.checkId, input.sharedWithPersonId],
      );
      const currentRow = current.rows[0];
      return currentRow === undefined ? null : mapCheckShare(currentRow);
    });
  }
}
