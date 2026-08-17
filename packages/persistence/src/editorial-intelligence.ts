import { createHash } from 'node:crypto';
import { DomainError } from '@boomerbuddy/domain';
import {
  decryptField,
  encryptField,
  minimizeRestrictedInput,
  parseEncryptedField,
  serializeEncryptedField,
} from '@boomerbuddy/security';
import type { Database, SqlExecutor } from './database';
import { asDate, jsonParameter, randomIdFactory, type IdFactory } from './values';

const codePattern = /^[a-z][a-z0-9_.:-]{1,119}$/u;
const stableIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const forbiddenDraftLocator = /(?:https?:\/\/|www\.)/iu;

export const editorialSourceReviewRoles = [
  'primary_source',
  'domain',
  'rights',
  'security',
  'final_source',
] as const;
export type EditorialSourceReviewRole = (typeof editorialSourceReviewRoles)[number];

export const editorialReviewRoles = [
  'fraud_analysis',
  'evidence_corroboration',
  'safety_action',
  'skeptical',
  'accessibility',
  'privacy_rights',
  'final_human',
] as const;
export type EditorialReviewRole = (typeof editorialReviewRoles)[number];

export const editorialProductKinds = [
  'urgent_alert',
  'daily_tip',
  'weekly_brief',
  'family_prompt',
  'recovery_guidance',
  'learning_update',
  'founder_video_brief',
  'seo_blog_draft',
  'partner_bulletin',
  'internal_support_brief',
] as const;
export type EditorialProductKind = (typeof editorialProductKinds)[number];

export interface EditorialProtection {
  readonly encryptionKey: Uint8Array;
  readonly encryptionKeyVersion: number;
  readonly founderPersonId: string;
}

export type EditorialAuthorityClock = (transaction: SqlExecutor, observedAt: Date) => Promise<Date>;

const databaseEditorialAuthorityClock: EditorialAuthorityClock = async (transaction) => {
  const result = await transaction.query<{ authority_now: unknown } & Record<string, unknown>>(
    'SELECT clock_timestamp() AS authority_now',
  );
  return asDate(result.rows[0]?.authority_now, 'editorial database authority time');
};

interface EmployeeRow extends Record<string, unknown> {
  readonly id: string;
  readonly person_id: string;
  readonly role: 'hq_owner' | 'hq_reviewer' | 'hq_support';
}

interface ContentRow extends Record<string, unknown> {
  readonly id: string;
  readonly content_key: string;
  readonly version: number;
  readonly product_kind: EditorialProductKind;
  readonly body_sha256: string;
  readonly encrypted_text: string;
  readonly encryption_key_version: number;
  readonly expires_at: unknown;
}

interface BoardContentRow extends Record<string, unknown> {
  readonly content_version_id: string;
  readonly content_key: string;
  readonly version: number;
  readonly product_kind: EditorialProductKind;
  readonly state: EditorialBoardItem['state'];
  readonly assigned_role: EditorialReviewRole | null;
  readonly content_readable: boolean;
  readonly expires_at: unknown;
  readonly unsupported_statistics: boolean;
  readonly unverified_urgency: boolean;
}

export interface EditorialBoardItem {
  readonly contentVersionId: string;
  readonly contentKey: string;
  readonly version: number;
  readonly product: EditorialProductKind;
  readonly state:
    | 'draft'
    | 'under_review'
    | 'approved_internal'
    | 'correction_pending'
    | 'corrected'
    | 'retracted'
    | 'expired'
    | 'archived';
  readonly assignedRole?: EditorialReviewRole;
  readonly contentReadable: boolean;
  readonly expiresAt: Date;
  readonly unsupportedStatistics: boolean;
  readonly unverifiedUrgency: boolean;
  readonly evidenceTier: 'local_simulation';
}

export interface EditorialBoard {
  readonly generatedAt: Date;
  readonly sources: readonly {
    readonly sourceVersionId: string;
    readonly sourceKey: string;
    readonly version: number;
    readonly sourceClass:
      | 'government'
      | 'regulator'
      | 'law_enforcement'
      | 'court'
      | 'standards_body'
      | 'provider_advisory'
      | 'financial_institution'
      | 'research_publisher'
      | 'other_reviewed';
    readonly state: 'proposed' | 'approved_local' | 'blocked' | 'stale' | 'retired';
    readonly reviewDueAt: Date;
    readonly evidenceTier: 'local_simulation';
    readonly externalFetchPerformed: false;
  }[];
  readonly stories: readonly {
    readonly relationshipId: string;
    readonly leftArtifactId: string;
    readonly rightArtifactId: string;
    readonly relationship:
      | 'identical_update'
      | 'syndication'
      | 'same_incident'
      | 'similar_mechanism'
      | 'corroborates'
      | 'contradicts'
      | 'supersedes'
      | 'not_related';
    readonly decision: 'candidate' | 'confirmed' | 'rejected' | 'split';
    readonly confidence: 'limited' | 'moderate' | 'strong';
    readonly evidenceTier: 'local_simulation';
  }[];
  readonly content: readonly EditorialBoardItem[];
  readonly corrections: readonly {
    readonly correctionId: string;
    readonly originalContentVersionId: string;
    readonly replacementContentVersionId?: string;
    readonly disposition: 'correction' | 'retraction';
    readonly reasonCode: string;
    readonly recordedAt: Date;
    readonly evidenceTier: 'local_simulation';
  }[];
  readonly calendar: readonly {
    readonly calendarEventId: string;
    readonly contentVersionId: string;
    readonly state: 'internal_review_planned' | 'blocked' | 'cancelled';
    readonly plannedFor: Date;
    readonly evidenceTier: 'local_simulation';
    readonly externalActionEnabled: false;
  }[];
  readonly preferences: {
    readonly grantedLocalFixtures: number;
    readonly withdrawnLocalFixtures: number;
    readonly externalDeliveryEnabled: false;
  };
}

function assertStableId(value: string, field: string): void {
  if (!stableIdPattern.test(value)) throw new DomainError('invalid_input', `Invalid ${field}`);
}

function assertCode(value: string, field: string): void {
  if (!codePattern.test(value)) throw new DomainError('invalid_input', `Invalid ${field}`);
}

function assertSha256(value: string, field: string): void {
  if (!sha256Pattern.test(value)) throw new DomainError('invalid_input', `Invalid ${field}`);
}

function bodyHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizedDraft(value: string): string {
  if (forbiddenDraftLocator.test(value)) {
    throw new DomainError('restricted_input', 'Editorial drafts must not contain raw locators');
  }
  const minimized = minimizeRestrictedInput(value, 16_384, 'reject');
  if (minimized.status !== 'accepted' || minimized.detected.length > 0) {
    throw new DomainError('restricted_input', 'Editorial draft contains restricted input');
  }
  if (minimized.minimized.length < 1) {
    throw new DomainError('invalid_input', 'Editorial draft is empty');
  }
  return minimized.minimized;
}

async function lockReviewMutex(transaction: SqlExecutor): Promise<void> {
  await transaction.query(
    'SELECT singleton FROM editorial_review_mutex WHERE singleton FOR UPDATE',
  );
}

async function writeAudit(
  transaction: SqlExecutor,
  ids: IdFactory,
  input: {
    readonly actorPersonId: string;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly correlationId: string;
    readonly now: Date;
    readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  },
): Promise<void> {
  await transaction.query(
    `INSERT INTO audit_events(
       id, household_id, actor_person_id, session_audience, action, resource_type,
       resource_id, outcome, metadata, correlation_id, occurred_at
     ) VALUES ($1,NULL,$2,'hq',$3,$4,$5,'completed',$6::jsonb,$7,$8)`,
    [
      ids.next('audit'),
      input.actorPersonId,
      input.action,
      input.resourceType,
      input.resourceId,
      jsonParameter(input.metadata ?? {}),
      input.correlationId,
      input.now.toISOString(),
    ],
  );
}

export class EditorialIntelligenceRepository {
  constructor(
    private readonly database: Database,
    private readonly protection: EditorialProtection,
    private readonly ids: IdFactory = randomIdFactory,
    private readonly authorityClock: EditorialAuthorityClock = databaseEditorialAuthorityClock,
  ) {
    if (
      protection.encryptionKey.byteLength !== 32 ||
      !Number.isSafeInteger(protection.encryptionKeyVersion) ||
      protection.encryptionKeyVersion < 1
    ) {
      throw new TypeError('Editorial protection configuration is invalid');
    }
    assertStableId(protection.founderPersonId, 'founder person ID');
  }

  private async authorityNow(transaction: SqlExecutor, observedAt: Date): Promise<Date> {
    return this.authorityClock(transaction, observedAt);
  }

  private async requireFounderOwner(
    transaction: SqlExecutor,
    actorPersonId: string,
  ): Promise<EmployeeRow> {
    if (actorPersonId !== this.protection.founderPersonId) {
      throw new DomainError('not_authorized', 'Editorial mutation requires the configured founder');
    }
    const result = await transaction.query<EmployeeRow>(
      `SELECT employee.id, employee.person_id, employee.role
       FROM employee_assignments employee
       JOIN organizations organization ON organization.id = employee.organization_id
       WHERE employee.person_id = $1 AND employee.role = 'hq_owner'
         AND employee.status = 'active' AND organization.kind = 'internal'
       ORDER BY employee.id LIMIT 1 FOR UPDATE OF employee, organization`,
      [actorPersonId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new DomainError(
        'not_authorized',
        'Editorial mutation requires current owner authority',
      );
    }
    return row;
  }

  private async requireInternalReviewer(
    transaction: SqlExecutor,
    actorPersonId: string,
  ): Promise<EmployeeRow> {
    const result = await transaction.query<EmployeeRow>(
      `SELECT employee.id, employee.person_id, employee.role
       FROM employee_assignments employee
       JOIN organizations organization ON organization.id = employee.organization_id
       WHERE employee.person_id = $1 AND employee.role IN ('hq_owner','hq_reviewer')
         AND employee.status = 'active' AND organization.kind = 'internal'
       ORDER BY CASE employee.role WHEN 'hq_owner' THEN 0 ELSE 1 END, employee.id
       LIMIT 1 FOR UPDATE OF employee, organization`,
      [actorPersonId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new DomainError(
        'not_authorized',
        'Editorial review requires current internal authority',
      );
    }
    return row;
  }

  async createSourceVersion(input: {
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly sourceKey: string;
    readonly version: number;
    readonly publisherKey: string;
    readonly originHost: string;
    readonly pathPrefix: string;
    readonly sourceClass:
      | 'government'
      | 'regulator'
      | 'law_enforcement'
      | 'court'
      | 'standards_body'
      | 'provider_advisory'
      | 'financial_institution'
      | 'research_publisher'
      | 'other_reviewed';
    readonly jurisdiction: string;
    readonly locale: string;
    readonly intendedProducts: readonly EditorialProductKind[];
    readonly authorityReasonCode: string;
    readonly retentionPolicyVersion: string;
    readonly lifecycle?: 'proposed' | 'disabled' | 'retired' | 'rejected';
    readonly effectiveAt: Date;
    readonly reviewDueAt: Date;
    readonly expiresAt: Date;
    readonly now: Date;
  }): Promise<string> {
    assertCode(input.publisherKey, 'publisher key');
    assertCode(input.authorityReasonCode, 'authority reason code');
    assertCode(input.retentionPolicyVersion, 'retention policy version');
    if (
      !/^source_[a-z0-9_]{2,111}$/u.test(input.sourceKey) ||
      !Number.isSafeInteger(input.version) ||
      input.version < 1 ||
      input.intendedProducts.length < 1 ||
      input.intendedProducts.length > 10 ||
      input.intendedProducts.some((product) => !editorialProductKinds.includes(product)) ||
      input.originHost !== input.originHost.toLowerCase() ||
      !/^\/[A-Za-z0-9._~/%+-]*$/u.test(input.pathPrefix)
    ) {
      throw new DomainError('invalid_input', 'Editorial source definition is invalid');
    }
    return this.database.transaction(async (transaction) => {
      await lockReviewMutex(transaction);
      await this.requireFounderOwner(transaction, input.actorPersonId);
      const authorityNow = await this.authorityNow(transaction, input.now);
      if (
        input.effectiveAt < authorityNow ||
        input.reviewDueAt <= input.effectiveAt ||
        input.expiresAt < input.reviewDueAt
      ) {
        throw new DomainError('invalid_input', 'Editorial source chronology is invalid');
      }
      const id = this.ids.next('editorial_source');
      await transaction.query(
        `INSERT INTO editorial_source_versions(
           id, source_key, version, publisher_key, origin_host, path_prefix, source_class,
           jurisdiction, locale, intended_products, authority_reason_code,
           retention_policy_version, lifecycle, effective_at, review_due_at, expires_at,
           evidence_tier, external_fetch_enabled, created_by_person_id, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,
           'local_simulation',false,$17,$18)`,
        [
          id,
          input.sourceKey,
          input.version,
          input.publisherKey,
          input.originHost,
          input.pathPrefix,
          input.sourceClass,
          input.jurisdiction,
          input.locale,
          jsonParameter([...new Set(input.intendedProducts)]),
          input.authorityReasonCode,
          input.retentionPolicyVersion,
          input.lifecycle ?? 'proposed',
          input.effectiveAt.toISOString(),
          input.reviewDueAt.toISOString(),
          input.expiresAt.toISOString(),
          input.actorPersonId,
          authorityNow.toISOString(),
        ],
      );
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'editorial.source_version.created',
        resourceType: 'editorial_source_version',
        resourceId: id,
        correlationId: input.correlationId,
        now: authorityNow,
        metadata: { evidenceTier: 'local_simulation', externalFetchEnabled: false },
      });
      return id;
    });
  }

  async reviewSource(input: {
    readonly sourceVersionId: string;
    readonly actorPersonId: string;
    readonly role: EditorialSourceReviewRole;
    readonly decision: 'approve' | 'changes_requested' | 'reject';
    readonly reasonCode: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<string> {
    assertStableId(input.sourceVersionId, 'source version ID');
    assertCode(input.reasonCode, 'source review reason code');
    return this.database.transaction(async (transaction) => {
      await lockReviewMutex(transaction);
      const employee = await this.requireInternalReviewer(transaction, input.actorPersonId);
      const authorityNow = await this.authorityNow(transaction, input.now);
      const sequence = await transaction.query<{ next_sequence: number } & Record<string, unknown>>(
        `SELECT COALESCE(max(sequence),0)::int + 1 AS next_sequence
         FROM editorial_source_review_events
         WHERE source_version_id = $1 AND review_role = $2`,
        [input.sourceVersionId, input.role],
      );
      const id = this.ids.next('editorial_source_review');
      await transaction.query(
        `INSERT INTO editorial_source_review_events(
           id, source_version_id, review_role, sequence, employee_assignment_id,
           actor_person_id, decision, reason_code, evidence_tier, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'local_simulation',$9)`,
        [
          id,
          input.sourceVersionId,
          input.role,
          sequence.rows[0]?.next_sequence ?? 1,
          employee.id,
          input.actorPersonId,
          input.decision,
          input.reasonCode,
          authorityNow.toISOString(),
        ],
      );
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'editorial.source_review.recorded',
        resourceType: 'editorial_source_review',
        resourceId: id,
        correlationId: input.correlationId,
        now: authorityNow,
        metadata: { role: input.role, decision: input.decision },
      });
      return id;
    });
  }

  async recordLocalArtifact(input: {
    readonly sourceVersionId: string;
    readonly artifactKey: string;
    readonly locatorSha256: string;
    readonly contentSha256: string;
    readonly sourcePublishedAt?: Date;
    readonly expiresAt: Date;
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<string> {
    assertStableId(input.sourceVersionId, 'source version ID');
    assertSha256(input.locatorSha256, 'locator digest');
    assertSha256(input.contentSha256, 'content digest');
    if (!/^artifact_[a-z0-9_]{2,109}$/u.test(input.artifactKey)) {
      throw new DomainError('invalid_input', 'Invalid artifact key');
    }
    return this.database.transaction(async (transaction) => {
      await lockReviewMutex(transaction);
      const employee = await this.requireInternalReviewer(transaction, input.actorPersonId);
      const authorityNow = await this.authorityNow(transaction, input.now);
      if (input.expiresAt <= authorityNow) {
        throw new DomainError('invalid_input', 'Editorial artifact expiry is invalid');
      }
      const id = this.ids.next('editorial_artifact');
      await transaction.query(
        `INSERT INTO editorial_artifact_receipts(
           id, source_version_id, artifact_key, locator_sha256, content_sha256,
           source_published_at, observed_at, expires_at, parser_version,
           employee_assignment_id, actor_person_id, evidence_tier, receipt_kind,
           external_fetch_performed, provider_processed, raw_artifact_stored,
           normalized_content_stored, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'local-fixture-metadata-v1',$9,$10,
           'local_simulation','local_fixture',false,false,false,false,$7)`,
        [
          id,
          input.sourceVersionId,
          input.artifactKey,
          input.locatorSha256,
          input.contentSha256,
          input.sourcePublishedAt?.toISOString() ?? null,
          authorityNow.toISOString(),
          input.expiresAt.toISOString(),
          employee.id,
          input.actorPersonId,
        ],
      );
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'editorial.local_artifact_receipt.recorded',
        resourceType: 'editorial_artifact_receipt',
        resourceId: id,
        correlationId: input.correlationId,
        now: authorityNow,
        metadata: { receiptKind: 'local_fixture', externalFetchPerformed: false },
      });
      return id;
    });
  }

  async recordClaim(input: {
    readonly claimKey: string;
    readonly version: number;
    readonly artifactReceiptId: string;
    readonly artifactSpanSha256: string;
    readonly subjectCode: string;
    readonly predicateCode: string;
    readonly scopeCode: string;
    readonly jurisdiction: string;
    readonly uncertainty: 'unknown' | 'limited' | 'moderate' | 'strong';
    readonly validFrom: Date;
    readonly validThrough: Date;
    readonly expiresAt: Date;
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<string> {
    if (!/^claim_[a-z0-9_]{2,112}$/u.test(input.claimKey)) {
      throw new DomainError('invalid_input', 'Invalid editorial claim key');
    }
    assertStableId(input.artifactReceiptId, 'artifact receipt ID');
    assertSha256(input.artifactSpanSha256, 'artifact span digest');
    for (const [value, field] of [
      [input.subjectCode, 'claim subject code'],
      [input.predicateCode, 'claim predicate code'],
      [input.scopeCode, 'claim scope code'],
    ] as const) {
      assertCode(value, field);
    }
    return this.database.transaction(async (transaction) => {
      await lockReviewMutex(transaction);
      const employee = await this.requireInternalReviewer(transaction, input.actorPersonId);
      const authorityNow = await this.authorityNow(transaction, input.now);
      if (
        !Number.isSafeInteger(input.version) ||
        input.version < 1 ||
        input.validThrough < input.validFrom ||
        input.expiresAt < input.validThrough
      ) {
        throw new DomainError('invalid_input', 'Editorial claim chronology is invalid');
      }
      const id = this.ids.next('editorial_claim');
      await transaction.query(
        `INSERT INTO editorial_claim_versions(
           id, claim_key, version, artifact_receipt_id, artifact_span_sha256,
           subject_code, predicate_code, scope_code, jurisdiction, uncertainty,
           valid_from, valid_through, expires_at, raw_claim_stored, model_generated,
           evidence_tier, employee_assignment_id, created_by_person_id, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false,false,
           'local_simulation',$14,$15,$16)`,
        [
          id,
          input.claimKey,
          input.version,
          input.artifactReceiptId,
          input.artifactSpanSha256,
          input.subjectCode,
          input.predicateCode,
          input.scopeCode,
          input.jurisdiction,
          input.uncertainty,
          input.validFrom.toISOString(),
          input.validThrough.toISOString(),
          input.expiresAt.toISOString(),
          employee.id,
          input.actorPersonId,
          authorityNow.toISOString(),
        ],
      );
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'editorial.claim_version.recorded',
        resourceType: 'editorial_claim_version',
        resourceId: id,
        correlationId: input.correlationId,
        now: authorityNow,
        metadata: { rawClaimStored: false, modelGenerated: false },
      });
      return id;
    });
  }

  async recordStoryRelationship(input: {
    readonly relationshipKey: string;
    readonly leftArtifactId: string;
    readonly rightArtifactId: string;
    readonly relationship:
      | 'identical_update'
      | 'syndication'
      | 'same_incident'
      | 'similar_mechanism'
      | 'corroborates'
      | 'contradicts'
      | 'supersedes'
      | 'not_related';
    readonly decision: 'candidate' | 'confirmed' | 'rejected' | 'split';
    readonly confidence: 'limited' | 'moderate' | 'strong';
    readonly reasonCode: string;
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<string> {
    if (!/^relationship_[a-z0-9_]{2,105}$/u.test(input.relationshipKey)) {
      throw new DomainError('invalid_input', 'Invalid editorial relationship key');
    }
    assertStableId(input.leftArtifactId, 'left artifact ID');
    assertStableId(input.rightArtifactId, 'right artifact ID');
    assertCode(input.reasonCode, 'story relationship reason code');
    return this.database.transaction(async (transaction) => {
      await lockReviewMutex(transaction);
      const employee = await this.requireInternalReviewer(transaction, input.actorPersonId);
      const authorityNow = await this.authorityNow(transaction, input.now);
      const sequence = await transaction.query<{ next_sequence: number } & Record<string, unknown>>(
        `SELECT COALESCE(max(sequence),0)::int + 1 AS next_sequence
         FROM editorial_story_relationship_events WHERE relationship_key = $1`,
        [input.relationshipKey],
      );
      const id = this.ids.next('editorial_relationship');
      await transaction.query(
        `INSERT INTO editorial_story_relationship_events(
           id, relationship_key, sequence, left_artifact_id, right_artifact_id,
           relationship, decision, confidence, reason_code, employee_assignment_id,
           actor_person_id, evidence_tier, model_generated, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'local_simulation',false,$12)`,
        [
          id,
          input.relationshipKey,
          sequence.rows[0]?.next_sequence ?? 1,
          input.leftArtifactId,
          input.rightArtifactId,
          input.relationship,
          input.decision,
          input.confidence,
          input.reasonCode,
          employee.id,
          input.actorPersonId,
          authorityNow.toISOString(),
        ],
      );
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'editorial.story_relationship.recorded',
        resourceType: 'editorial_story_relationship',
        resourceId: id,
        correlationId: input.correlationId,
        now: authorityNow,
        metadata: {
          relationship: input.relationship,
          decision: input.decision,
          modelGenerated: false,
        },
      });
      return id;
    });
  }

  async createDraft(input: {
    readonly contentKey: string;
    readonly version: number;
    readonly productKind: EditorialProductKind;
    readonly audience: 'internal' | 'customer' | 'public' | 'partner';
    readonly locale: string;
    readonly jurisdiction: string;
    readonly urgency: 'routine' | 'time_sensitive' | 'urgent_candidate';
    readonly draftText: string;
    readonly unsupportedStatistics: boolean;
    readonly unverifiedUrgency: boolean;
    readonly expiresAt: Date;
    readonly sourceVersionIds: readonly string[];
    readonly claimVersionIds: readonly string[];
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<string> {
    if (!/^content_[a-z0-9_]{2,110}$/u.test(input.contentKey)) {
      throw new DomainError('invalid_input', 'Invalid editorial content key');
    }
    if (!editorialProductKinds.includes(input.productKind)) {
      throw new DomainError('invalid_input', 'Invalid editorial product kind');
    }
    const sourceIds = [...new Set(input.sourceVersionIds)];
    const claimIds = [...new Set(input.claimVersionIds)];
    if (sourceIds.length < 1 || claimIds.length < 1) {
      throw new DomainError(
        'invalid_input',
        'Editorial draft requires exact source and claim links',
      );
    }
    sourceIds.forEach((id) => assertStableId(id, 'source version ID'));
    claimIds.forEach((id) => assertStableId(id, 'claim version ID'));
    const draftText = normalizedDraft(input.draftText);
    return this.database.transaction(async (transaction) => {
      await lockReviewMutex(transaction);
      await this.requireFounderOwner(transaction, input.actorPersonId);
      const authorityNow = await this.authorityNow(transaction, input.now);
      if (
        !Number.isSafeInteger(input.version) ||
        input.version < 1 ||
        input.expiresAt <= authorityNow
      ) {
        throw new DomainError('invalid_input', 'Editorial draft chronology is invalid');
      }
      const id = this.ids.next('editorial_content');
      const digest = bodyHash(draftText);
      const encrypted = encryptField(draftText, this.protection.encryptionKey, {
        tenantId: 'boomerbuddy_editorial',
        resourceId: id,
        field: 'local_draft_text',
        schemaVersion: 1,
        keyVersion: this.protection.encryptionKeyVersion,
      });
      await transaction.query(
        `INSERT INTO editorial_content_versions(
           id, content_key, version, product_kind, audience, channel, locale, jurisdiction,
           urgency, body_sha256, unsupported_statistics, unverified_urgency, expires_at,
           evidence_tier, provider_processed, publication_enabled, outbound_delivery_enabled,
           external_action_executed, created_by_person_id, created_at
         ) VALUES ($1,$2,$3,$4,$5,'internal_review_only',$6,$7,$8,$9,$10,$11,$12,
           'local_simulation',false,false,false,false,$13,$14)`,
        [
          id,
          input.contentKey,
          input.version,
          input.productKind,
          input.audience,
          input.locale,
          input.jurisdiction,
          input.urgency,
          digest,
          input.unsupportedStatistics,
          input.unverifiedUrgency,
          input.expiresAt.toISOString(),
          input.actorPersonId,
          authorityNow.toISOString(),
        ],
      );
      await transaction.query(
        `INSERT INTO editorial_content_payloads(
           content_version_id, payload_state, encrypted_text, encryption_key_version, created_at
         ) VALUES ($1,'encrypted_local_draft',$2,$3,$4)`,
        [
          id,
          serializeEncryptedField(encrypted),
          this.protection.encryptionKeyVersion,
          authorityNow.toISOString(),
        ],
      );
      for (const sourceId of sourceIds) {
        await transaction.query(
          `INSERT INTO editorial_content_source_links(content_version_id, source_version_id)
           VALUES ($1,$2)`,
          [id, sourceId],
        );
      }
      for (const claimId of claimIds) {
        await transaction.query(
          `INSERT INTO editorial_content_claim_links(content_version_id, claim_version_id)
           VALUES ($1,$2)`,
          [id, claimId],
        );
      }
      await transaction.query(
        `INSERT INTO editorial_content_state_events(
           id, content_version_id, sequence, to_state, actor_person_id, service_key,
           reason_code, evidence_tier, occurred_at
         ) VALUES ($1,$2,1,'draft',NULL,'editorial.local_repository',
           'project_authored_local_draft','local_simulation',$3)`,
        [this.ids.next('editorial_state'), id, authorityNow.toISOString()],
      );
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'editorial.local_draft.created',
        resourceType: 'editorial_content_version',
        resourceId: id,
        correlationId: input.correlationId,
        now: authorityNow,
        metadata: {
          evidenceTier: 'local_simulation',
          providerProcessed: false,
          publicationEnabled: false,
          outboundDeliveryEnabled: false,
        },
      });
      return id;
    });
  }

  async assignReview(input: {
    readonly contentVersionId: string;
    readonly role: EditorialReviewRole;
    readonly reviewerEmployeeAssignmentId: string;
    readonly actorPersonId: string;
    readonly reasonCode: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<string> {
    assertStableId(input.contentVersionId, 'content version ID');
    assertStableId(input.reviewerEmployeeAssignmentId, 'reviewer assignment ID');
    assertCode(input.reasonCode, 'assignment reason code');
    return this.database.transaction(async (transaction) => {
      await lockReviewMutex(transaction);
      await this.requireFounderOwner(transaction, input.actorPersonId);
      const authorityNow = await this.authorityNow(transaction, input.now);
      const sequence = await transaction.query<{ next_sequence: number } & Record<string, unknown>>(
        `SELECT COALESCE(max(sequence),0)::int + 1 AS next_sequence
         FROM editorial_assignment_events
         WHERE content_version_id = $1 AND review_role = $2`,
        [input.contentVersionId, input.role],
      );
      const id = this.ids.next('editorial_assignment');
      await transaction.query(
        `INSERT INTO editorial_assignment_events(
           id, content_version_id, review_role, sequence, employee_assignment_id, state,
           assigned_by_person_id, reason_code, evidence_tier, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,'assigned',$6,$7,'local_simulation',$8)`,
        [
          id,
          input.contentVersionId,
          input.role,
          sequence.rows[0]?.next_sequence ?? 1,
          input.reviewerEmployeeAssignmentId,
          input.actorPersonId,
          input.reasonCode,
          authorityNow.toISOString(),
        ],
      );
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'editorial.review_assignment.recorded',
        resourceType: 'editorial_assignment',
        resourceId: id,
        correlationId: input.correlationId,
        now: authorityNow,
        metadata: { role: input.role, state: 'assigned' },
      });
      return id;
    });
  }

  async transitionContent(input: {
    readonly contentVersionId: string;
    readonly toState:
      'under_review' | 'correction_pending' | 'corrected' | 'retracted' | 'expired' | 'archived';
    readonly actorPersonId: string;
    readonly reasonCode: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<string> {
    assertStableId(input.contentVersionId, 'content version ID');
    assertCode(input.reasonCode, 'content transition reason code');
    return this.database.transaction(async (transaction) => {
      await lockReviewMutex(transaction);
      await this.requireInternalReviewer(transaction, input.actorPersonId);
      const authorityNow = await this.authorityNow(transaction, input.now);
      const sequence = await transaction.query<{ next_sequence: number } & Record<string, unknown>>(
        `SELECT COALESCE(max(sequence),0)::int + 1 AS next_sequence
         FROM editorial_content_state_events WHERE content_version_id = $1`,
        [input.contentVersionId],
      );
      const id = this.ids.next('editorial_state');
      await transaction.query(
        `INSERT INTO editorial_content_state_events(
           id, content_version_id, sequence, to_state, actor_person_id, service_key,
           reason_code, evidence_tier, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,NULL,$6,'local_simulation',$7)`,
        [
          id,
          input.contentVersionId,
          sequence.rows[0]?.next_sequence ?? 1,
          input.toState,
          input.actorPersonId,
          input.reasonCode,
          authorityNow.toISOString(),
        ],
      );
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'editorial.content_state.recorded',
        resourceType: 'editorial_content_state',
        resourceId: id,
        correlationId: input.correlationId,
        now: authorityNow,
        metadata: { toState: input.toState },
      });
      return id;
    });
  }

  async reviewDraft(input: {
    readonly contentVersionId: string;
    readonly role: EditorialReviewRole;
    readonly decision: 'approve' | 'changes_requested' | 'reject';
    readonly actorPersonId: string;
    readonly reasonCode: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<string> {
    assertStableId(input.contentVersionId, 'content version ID');
    assertCode(input.reasonCode, 'review reason code');
    return this.database.transaction(async (transaction) => {
      await lockReviewMutex(transaction);
      const employee = await this.requireInternalReviewer(transaction, input.actorPersonId);
      const authorityNow = await this.authorityNow(transaction, input.now);
      const assignment = await transaction.query<
        { id: string; employee_assignment_id: string; state: string } & Record<string, unknown>
      >(
        `SELECT id, employee_assignment_id, state
         FROM editorial_assignment_events
         WHERE content_version_id = $1 AND review_role = $2
         ORDER BY sequence DESC LIMIT 1 FOR UPDATE`,
        [input.contentVersionId, input.role],
      );
      const currentAssignment = assignment.rows[0];
      if (
        currentAssignment === undefined ||
        currentAssignment.state !== 'assigned' ||
        currentAssignment.employee_assignment_id !== employee.id
      ) {
        throw new DomainError('not_authorized', 'Editorial review requires the exact assignment');
      }
      const content = await transaction.query<{ body_sha256: string } & Record<string, unknown>>(
        'SELECT body_sha256 FROM editorial_content_versions WHERE id = $1 FOR UPDATE',
        [input.contentVersionId],
      );
      const digest = content.rows[0]?.body_sha256;
      if (digest === undefined) throw new DomainError('not_found', 'Editorial draft was not found');
      const sequence = await transaction.query<{ next_sequence: number } & Record<string, unknown>>(
        `SELECT COALESCE(max(sequence),0)::int + 1 AS next_sequence
         FROM editorial_review_events
         WHERE content_version_id = $1 AND review_role = $2`,
        [input.contentVersionId, input.role],
      );
      const id = this.ids.next('editorial_review');
      await transaction.query(
        `INSERT INTO editorial_review_events(
           id, content_version_id, review_role, sequence, assignment_event_id,
           employee_assignment_id, actor_person_id, decision, reviewed_body_sha256,
           reason_code, evidence_tier, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'local_simulation',$11)`,
        [
          id,
          input.contentVersionId,
          input.role,
          sequence.rows[0]?.next_sequence ?? 1,
          currentAssignment.id,
          employee.id,
          input.actorPersonId,
          input.decision,
          digest,
          input.reasonCode,
          authorityNow.toISOString(),
        ],
      );
      if (input.role === 'final_human' && input.decision === 'approve') {
        const state = await transaction.query<{ next_sequence: number } & Record<string, unknown>>(
          `SELECT COALESCE(max(sequence),0)::int + 1 AS next_sequence
           FROM editorial_content_state_events WHERE content_version_id = $1`,
          [input.contentVersionId],
        );
        await transaction.query(
          `INSERT INTO editorial_content_state_events(
             id, content_version_id, sequence, to_state, actor_person_id, service_key,
             reason_code, evidence_tier, occurred_at
           ) VALUES ($1,$2,$3,'approved_internal',$4,NULL,
             'final_human_local_approval','local_simulation',$5)`,
          [
            this.ids.next('editorial_state'),
            input.contentVersionId,
            state.rows[0]?.next_sequence ?? 1,
            input.actorPersonId,
            authorityNow.toISOString(),
          ],
        );
      }
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'editorial.review.recorded',
        resourceType: 'editorial_review',
        resourceId: id,
        correlationId: input.correlationId,
        now: authorityNow,
        metadata: { role: input.role, decision: input.decision },
      });
      return id;
    });
  }

  async withdrawReviewAssignment(input: {
    readonly contentVersionId: string;
    readonly role: EditorialReviewRole;
    readonly actorPersonId: string;
    readonly reasonCode: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<string> {
    assertStableId(input.contentVersionId, 'content version ID');
    assertCode(input.reasonCode, 'assignment withdrawal reason code');
    return this.database.transaction(async (transaction) => {
      await lockReviewMutex(transaction);
      await this.requireFounderOwner(transaction, input.actorPersonId);
      const authorityNow = await this.authorityNow(transaction, input.now);
      const latest = await transaction.query<
        { sequence: number; employee_assignment_id: string; state: string } & Record<
          string,
          unknown
        >
      >(
        `SELECT sequence, employee_assignment_id, state
         FROM editorial_assignment_events
         WHERE content_version_id = $1 AND review_role = $2
         ORDER BY sequence DESC LIMIT 1 FOR UPDATE`,
        [input.contentVersionId, input.role],
      );
      const assignment = latest.rows[0];
      if (assignment === undefined || assignment.state !== 'assigned') {
        throw new DomainError('conflict', 'Editorial review assignment is not active');
      }
      const id = this.ids.next('editorial_assignment');
      await transaction.query(
        `INSERT INTO editorial_assignment_events(
           id, content_version_id, review_role, sequence, employee_assignment_id, state,
           assigned_by_person_id, reason_code, evidence_tier, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,'withdrawn',$6,$7,'local_simulation',$8)`,
        [
          id,
          input.contentVersionId,
          input.role,
          assignment.sequence + 1,
          assignment.employee_assignment_id,
          input.actorPersonId,
          input.reasonCode,
          authorityNow.toISOString(),
        ],
      );
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'editorial.review_assignment.withdrawn',
        resourceType: 'editorial_assignment',
        resourceId: id,
        correlationId: input.correlationId,
        now: authorityNow,
        metadata: { role: input.role, state: 'withdrawn' },
      });
      return id;
    });
  }

  async recordCorrection(input: {
    readonly originalContentVersionId: string;
    readonly replacementContentVersionId?: string;
    readonly disposition: 'correction' | 'retraction';
    readonly reasonCode: string;
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<string> {
    assertStableId(input.originalContentVersionId, 'original content version ID');
    if (input.replacementContentVersionId !== undefined) {
      assertStableId(input.replacementContentVersionId, 'replacement content version ID');
    }
    assertCode(input.reasonCode, 'correction reason code');
    if (
      (input.disposition === 'correction' && input.replacementContentVersionId === undefined) ||
      (input.disposition === 'retraction' && input.replacementContentVersionId !== undefined)
    ) {
      throw new DomainError('invalid_input', 'Editorial correction disposition is invalid');
    }
    return this.database.transaction(async (transaction) => {
      await lockReviewMutex(transaction);
      await this.requireFounderOwner(transaction, input.actorPersonId);
      const authorityNow = await this.authorityNow(transaction, input.now);
      const sequence = await transaction.query<{ next_sequence: number } & Record<string, unknown>>(
        `SELECT COALESCE(max(sequence),0)::int + 1 AS next_sequence
         FROM editorial_correction_events WHERE original_content_version_id = $1`,
        [input.originalContentVersionId],
      );
      const id = this.ids.next('editorial_correction');
      await transaction.query(
        `INSERT INTO editorial_correction_events(
           id, original_content_version_id, replacement_content_version_id, sequence,
           disposition, reason_code, actor_person_id, evidence_tier,
           external_action_executed, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'local_simulation',false,$8)`,
        [
          id,
          input.originalContentVersionId,
          input.replacementContentVersionId ?? null,
          sequence.rows[0]?.next_sequence ?? 1,
          input.disposition,
          input.reasonCode,
          input.actorPersonId,
          authorityNow.toISOString(),
        ],
      );
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'editorial.correction.recorded',
        resourceType: 'editorial_correction',
        resourceId: id,
        correlationId: input.correlationId,
        now: authorityNow,
        metadata: { disposition: input.disposition, externalActionExecuted: false },
      });
      return id;
    });
  }

  async planInternalReview(input: {
    readonly contentVersionId: string;
    readonly state: 'internal_review_planned' | 'blocked' | 'cancelled';
    readonly plannedFor: Date;
    readonly reasonCode: string;
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<string> {
    assertStableId(input.contentVersionId, 'content version ID');
    assertCode(input.reasonCode, 'calendar reason code');
    return this.database.transaction(async (transaction) => {
      await lockReviewMutex(transaction);
      await this.requireFounderOwner(transaction, input.actorPersonId);
      const authorityNow = await this.authorityNow(transaction, input.now);
      if (input.plannedFor < authorityNow) {
        throw new DomainError('invalid_input', 'Editorial review plan cannot be in the past');
      }
      const sequence = await transaction.query<{ next_sequence: number } & Record<string, unknown>>(
        `SELECT COALESCE(max(sequence),0)::int + 1 AS next_sequence
         FROM editorial_calendar_events WHERE content_version_id = $1`,
        [input.contentVersionId],
      );
      const id = this.ids.next('editorial_calendar');
      await transaction.query(
        `INSERT INTO editorial_calendar_events(
           id, content_version_id, sequence, state, planned_for, actor_person_id,
           reason_code, evidence_tier, external_action_enabled, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'local_simulation',false,$8)`,
        [
          id,
          input.contentVersionId,
          sequence.rows[0]?.next_sequence ?? 1,
          input.state,
          input.plannedFor.toISOString(),
          input.actorPersonId,
          input.reasonCode,
          authorityNow.toISOString(),
        ],
      );
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'editorial.internal_review_plan.recorded',
        resourceType: 'editorial_calendar',
        resourceId: id,
        correlationId: input.correlationId,
        now: authorityNow,
        metadata: { state: input.state, externalActionEnabled: false },
      });
      return id;
    });
  }

  async recordLocalPreference(
    input:
      | {
          readonly actorPersonId: string;
          readonly productKind: EditorialProductKind;
          readonly channel: 'in_app' | 'email' | 'sms' | 'push';
          readonly state: 'granted';
          readonly locale: string;
          readonly timezoneName: string;
          readonly quietHoursStart: number;
          readonly quietHoursEnd: number;
          readonly frequency: 'urgent_only' | 'daily' | 'weekly' | 'monthly';
          readonly expiresAt: Date;
          readonly correlationId: string;
          readonly now: Date;
        }
      | {
          readonly actorPersonId: string;
          readonly productKind: EditorialProductKind;
          readonly channel: 'in_app' | 'email' | 'sms' | 'push';
          readonly state: 'withdrawn';
          readonly correlationId: string;
          readonly now: Date;
        },
  ): Promise<string> {
    if (!editorialProductKinds.includes(input.productKind)) {
      throw new DomainError('invalid_input', 'Invalid editorial preference product');
    }
    return this.database.transaction(async (transaction) => {
      await lockReviewMutex(transaction);
      const authorityNow = await this.authorityNow(transaction, input.now);
      const person = await transaction.query<{ id: string } & Record<string, unknown>>(
        'SELECT id FROM persons WHERE id = $1 FOR UPDATE',
        [input.actorPersonId],
      );
      if (person.rows[0] === undefined) {
        throw new DomainError('not_authorized', 'Editorial preference requires a current person');
      }
      if (
        input.state === 'granted' &&
        (input.expiresAt <= authorityNow ||
          !Number.isInteger(input.quietHoursStart) ||
          !Number.isInteger(input.quietHoursEnd) ||
          input.quietHoursStart < 0 ||
          input.quietHoursStart > 1439 ||
          input.quietHoursEnd < 0 ||
          input.quietHoursEnd > 1439)
      ) {
        throw new DomainError('invalid_input', 'Editorial local preference is invalid');
      }
      const sequence = await transaction.query<{ next_sequence: number } & Record<string, unknown>>(
        `SELECT COALESCE(max(sequence),0)::int + 1 AS next_sequence
         FROM editorial_preference_events
         WHERE subject_person_id = $1 AND product_kind = $2 AND channel = $3`,
        [input.actorPersonId, input.productKind, input.channel],
      );
      const id = this.ids.next('editorial_preference');
      await transaction.query(
        `INSERT INTO editorial_preference_events(
           id, subject_person_id, actor_person_id, product_kind, channel, sequence, state,
           consent_version, locale, timezone_name, quiet_hours_start, quiet_hours_end,
           frequency, expires_at, source_surface, evidence_tier, external_delivery_enabled,
           occurred_at
         ) VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
           'local_fixture','local_simulation',false,$14)`,
        [
          id,
          input.actorPersonId,
          input.productKind,
          input.channel,
          sequence.rows[0]?.next_sequence ?? 1,
          input.state,
          input.state === 'granted' ? 'editorial-preference-local-fixture-v1' : null,
          input.state === 'granted' ? input.locale : null,
          input.state === 'granted' ? input.timezoneName : null,
          input.state === 'granted' ? input.quietHoursStart : null,
          input.state === 'granted' ? input.quietHoursEnd : null,
          input.state === 'granted' ? input.frequency : null,
          input.state === 'granted' ? input.expiresAt.toISOString() : null,
          authorityNow.toISOString(),
        ],
      );
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'editorial.local_preference.recorded',
        resourceType: 'editorial_preference',
        resourceId: id,
        correlationId: input.correlationId,
        now: authorityNow,
        metadata: {
          product: input.productKind,
          channel: input.channel,
          state: input.state,
          externalDeliveryEnabled: false,
        },
      });
      return id;
    });
  }

  async readAssignedDraft(input: {
    readonly contentVersionId: string;
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<{
    readonly contentVersionId: string;
    readonly assignedRole: EditorialReviewRole;
    readonly draftText: string;
    readonly evidenceTier: 'local_simulation';
    readonly providerProcessed: false;
    readonly publicationEligible: false;
    readonly externalActionExecuted: false;
  }> {
    assertStableId(input.contentVersionId, 'content version ID');
    return this.database.transaction(async (transaction) => {
      await lockReviewMutex(transaction);
      const content = await transaction.query<ContentRow>(
        `SELECT content.id, content.content_key, content.version, content.product_kind,
                content.body_sha256, payload.encrypted_text, payload.encryption_key_version,
                content.expires_at
         FROM editorial_content_versions content
         JOIN editorial_content_payloads payload ON payload.content_version_id = content.id
         WHERE content.id = $1 FOR UPDATE OF content, payload`,
        [input.contentVersionId],
      );
      const row = content.rows[0];
      if (row === undefined) throw new DomainError('not_found', 'Editorial draft was not found');
      const assignment = await transaction.query<
        { review_role: EditorialReviewRole } & Record<string, unknown>
      >(
        `SELECT latest.review_role
         FROM (
           SELECT DISTINCT ON (assignment.review_role)
             assignment.review_role, assignment.employee_assignment_id, assignment.state,
             assignment.sequence
           FROM editorial_assignment_events assignment
           WHERE assignment.content_version_id = $1
           ORDER BY assignment.review_role, assignment.sequence DESC
         ) latest
         JOIN employee_assignments employee ON employee.id = latest.employee_assignment_id
         JOIN organizations organization ON organization.id = employee.organization_id
         WHERE latest.state = 'assigned' AND employee.person_id = $2
           AND employee.status = 'active' AND organization.kind = 'internal'
           AND employee.role IN ('hq_owner','hq_reviewer')
         ORDER BY latest.review_role LIMIT 1
         FOR UPDATE OF employee, organization`,
        [input.contentVersionId, input.actorPersonId],
      );
      const assignedRole = assignment.rows[0]?.review_role;
      const authorityNow = await this.authorityNow(transaction, input.now);
      if (
        assignedRole === undefined ||
        asDate(row.expires_at, 'editorial draft expiry') <= authorityNow
      ) {
        throw new DomainError('not_authorized', 'Assigned editorial draft is unavailable');
      }
      const latestState = await transaction.query<{ to_state: string } & Record<string, unknown>>(
        `SELECT to_state FROM editorial_content_state_events
         WHERE content_version_id = $1 ORDER BY sequence DESC LIMIT 1`,
        [input.contentVersionId],
      );
      if (
        !['draft', 'under_review', 'approved_internal', 'correction_pending'].includes(
          latestState.rows[0]?.to_state ?? '',
        )
      ) {
        throw new DomainError('not_authorized', 'Assigned editorial draft is unavailable');
      }
      let plaintext: string;
      try {
        plaintext = decryptField(
          parseEncryptedField(row.encrypted_text),
          this.protection.encryptionKey,
          {
            tenantId: 'boomerbuddy_editorial',
            resourceId: row.id,
            field: 'local_draft_text',
            schemaVersion: 1,
            keyVersion: row.encryption_key_version,
          },
        ).toString('utf8');
      } catch {
        throw new DomainError('conflict', 'Assigned editorial draft is unreadable');
      }
      if (bodyHash(plaintext) !== row.body_sha256 || normalizedDraft(plaintext) !== plaintext) {
        throw new DomainError('conflict', 'Assigned editorial draft failed integrity verification');
      }
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'editorial.assigned_draft.read',
        resourceType: 'editorial_content_version',
        resourceId: row.id,
        correlationId: input.correlationId,
        now: authorityNow,
        metadata: { purpose: 'editorial_review', role: assignedRole },
      });
      return {
        contentVersionId: row.id,
        assignedRole,
        draftText: plaintext,
        evidenceTier: 'local_simulation',
        providerProcessed: false,
        publicationEligible: false,
        externalActionExecuted: false,
      };
    });
  }

  async board(input: {
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<EditorialBoard> {
    return this.database.transaction(async (transaction) => {
      await lockReviewMutex(transaction);
      const authority = await transaction.query<EmployeeRow>(
        `SELECT employee.id, employee.person_id, employee.role
         FROM employee_assignments employee
         JOIN organizations organization ON organization.id = employee.organization_id
         WHERE employee.person_id = $1 AND employee.status = 'active'
           AND organization.kind = 'internal'
           AND employee.role IN ('hq_owner','hq_reviewer')
         ORDER BY CASE employee.role WHEN 'hq_owner' THEN 0 ELSE 1 END, employee.id
         LIMIT 1 FOR UPDATE OF employee, organization`,
        [input.actorPersonId],
      );
      const employee = authority.rows[0];
      if (employee === undefined) {
        throw new DomainError(
          'not_authorized',
          'Editorial board requires current internal authority',
        );
      }
      const authorityNow = await this.authorityNow(transaction, input.now);
      const owner = employee.role === 'hq_owner';
      const sources = owner
        ? await transaction.query<
            {
              id: string;
              source_key: string;
              version: number;
              source_class: EditorialBoard['sources'][number]['sourceClass'];
              lifecycle: 'proposed' | 'disabled' | 'retired' | 'rejected';
              review_due_at: unknown;
              approved: boolean;
            } & Record<string, unknown>
          >(
            `SELECT source.id, source.source_key, source.version, source.source_class,
                    source.lifecycle, source.review_due_at,
                    editorial_source_is_approved(source.id, $1) AS approved
             FROM editorial_source_versions source
             WHERE NOT EXISTS (
               SELECT 1 FROM editorial_source_versions newer
               WHERE newer.source_key = source.source_key AND newer.version > source.version
             )
             ORDER BY source.review_due_at, source.source_key LIMIT 100`,
            [authorityNow.toISOString()],
          )
        : { rows: [] as const, rowCount: 0 };
      const stories = owner
        ? await transaction.query<
            {
              id: string;
              left_artifact_id: string;
              right_artifact_id: string;
              relationship: EditorialBoard['stories'][number]['relationship'];
              decision: EditorialBoard['stories'][number]['decision'];
              confidence: EditorialBoard['stories'][number]['confidence'];
            } & Record<string, unknown>
          >(
            `SELECT relationship.id, relationship.left_artifact_id,
                    relationship.right_artifact_id, relationship.relationship,
                    relationship.decision, relationship.confidence
             FROM editorial_story_relationship_events relationship
             WHERE NOT EXISTS (
               SELECT 1 FROM editorial_story_relationship_events newer
               WHERE newer.relationship_key = relationship.relationship_key
                 AND newer.sequence > relationship.sequence
             )
             ORDER BY relationship.occurred_at DESC, relationship.id LIMIT 100`,
          )
        : { rows: [] as const, rowCount: 0 };
      const content = await transaction.query<BoardContentRow>(
        `WITH current_state AS (
           SELECT DISTINCT ON (state.content_version_id)
             state.content_version_id, state.to_state
           FROM editorial_content_state_events state
           ORDER BY state.content_version_id, state.sequence DESC
         ), actor_assignment AS (
           SELECT DISTINCT ON (assignment.content_version_id, assignment.review_role)
             assignment.content_version_id, assignment.review_role,
             assignment.employee_assignment_id, assignment.state
           FROM editorial_assignment_events assignment
           ORDER BY assignment.content_version_id, assignment.review_role, assignment.sequence DESC
         )
         SELECT content.id AS content_version_id, content.content_key, content.version,
                content.product_kind, state.to_state AS state,
                assignment.review_role AS assigned_role,
                COALESCE(
                  assignment.state = 'assigned' AND employee.status = 'active'
                    AND organization.kind = 'internal',
                  false
                ) AS content_readable,
                content.expires_at, content.unsupported_statistics, content.unverified_urgency
         FROM editorial_content_versions content
         JOIN current_state state ON state.content_version_id = content.id
         LEFT JOIN actor_assignment assignment ON assignment.content_version_id = content.id
         LEFT JOIN employee_assignments employee
           ON employee.id = assignment.employee_assignment_id AND employee.person_id = $1
         LEFT JOIN organizations organization ON organization.id = employee.organization_id
         WHERE $2::boolean OR employee.person_id = $1
         ORDER BY content.created_at DESC, content.id LIMIT 100`,
        [input.actorPersonId, owner],
      );
      const scopedContentIds = content.rows.map((row) => row.content_version_id);
      const corrections =
        owner || scopedContentIds.length > 0
          ? await transaction.query<
              {
                id: string;
                original_content_version_id: string;
                replacement_content_version_id: string | null;
                disposition: 'correction' | 'retraction';
                reason_code: string;
                occurred_at: unknown;
              } & Record<string, unknown>
            >(
              `SELECT correction.id, correction.original_content_version_id,
                      correction.replacement_content_version_id, correction.disposition,
                      correction.reason_code, correction.occurred_at
               FROM editorial_correction_events correction
               WHERE $1::boolean OR correction.original_content_version_id = ANY($2::text[])
               ORDER BY correction.occurred_at DESC, correction.id LIMIT 100`,
              [owner, scopedContentIds],
            )
          : { rows: [] as const, rowCount: 0 };
      const calendar =
        owner || scopedContentIds.length > 0
          ? await transaction.query<
              {
                id: string;
                content_version_id: string;
                state: 'internal_review_planned' | 'blocked' | 'cancelled';
                planned_for: unknown;
              } & Record<string, unknown>
            >(
              `SELECT calendar.id, calendar.content_version_id, calendar.state,
                      calendar.planned_for
               FROM editorial_calendar_events calendar
               WHERE NOT EXISTS (
                 SELECT 1 FROM editorial_calendar_events newer
                 WHERE newer.content_version_id = calendar.content_version_id
                   AND newer.sequence > calendar.sequence
               ) AND ($1::boolean OR calendar.content_version_id = ANY($2::text[]))
               ORDER BY calendar.planned_for, calendar.id LIMIT 100`,
              [owner, scopedContentIds],
            )
          : { rows: [] as const, rowCount: 0 };
      const preferenceCounts = owner
        ? await transaction.query<{ granted: number; withdrawn: number } & Record<string, unknown>>(
            `SELECT
               count(*) FILTER (WHERE current.state = 'granted')::int AS granted,
               count(*) FILTER (WHERE current.state = 'withdrawn')::int AS withdrawn
             FROM (
               SELECT DISTINCT ON (subject_person_id, product_kind, channel) state
               FROM editorial_preference_events
               ORDER BY subject_person_id, product_kind, channel, sequence DESC
             ) current`,
          )
        : { rows: [{ granted: 0, withdrawn: 0 }], rowCount: 1 };
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'editorial.metadata_projection.read',
        resourceType: 'editorial_projection',
        resourceId: owner ? 'owner_global' : 'exact_assignments',
        correlationId: input.correlationId,
        now: authorityNow,
        metadata: {
          projection: owner ? 'owner_global' : 'exact_assignments',
          contentIncluded: false,
        },
      });
      return {
        generatedAt: authorityNow,
        sources: sources.rows.map((row) => {
          const reviewDueAt = asDate(row.review_due_at, 'editorial source review due');
          const state: EditorialBoard['sources'][number]['state'] =
            row.lifecycle === 'retired' || row.lifecycle === 'rejected'
              ? 'retired'
              : reviewDueAt <= authorityNow
                ? 'stale'
                : row.approved
                  ? 'approved_local'
                  : row.lifecycle === 'proposed'
                    ? 'proposed'
                    : 'blocked';
          return {
            sourceVersionId: row.id,
            sourceKey: row.source_key,
            version: row.version,
            sourceClass: row.source_class,
            state,
            reviewDueAt,
            evidenceTier: 'local_simulation',
            externalFetchPerformed: false,
          };
        }),
        stories: stories.rows.map((row) => ({
          relationshipId: row.id,
          leftArtifactId: row.left_artifact_id,
          rightArtifactId: row.right_artifact_id,
          relationship: row.relationship,
          decision: row.decision,
          confidence: row.confidence,
          evidenceTier: 'local_simulation',
        })),
        content: content.rows.map((row) => ({
          contentVersionId: row.content_version_id,
          contentKey: row.content_key,
          version: row.version,
          product: row.product_kind,
          state: row.state,
          ...(row.assigned_role === null ? {} : { assignedRole: row.assigned_role }),
          contentReadable: row.content_readable,
          expiresAt: asDate(row.expires_at, 'editorial content expiry'),
          unsupportedStatistics: row.unsupported_statistics,
          unverifiedUrgency: row.unverified_urgency,
          evidenceTier: 'local_simulation',
        })),
        corrections: corrections.rows.map((row) => ({
          correctionId: row.id,
          originalContentVersionId: row.original_content_version_id,
          ...(row.replacement_content_version_id === null
            ? {}
            : { replacementContentVersionId: row.replacement_content_version_id }),
          disposition: row.disposition,
          reasonCode: row.reason_code,
          recordedAt: asDate(row.occurred_at, 'editorial correction occurrence'),
          evidenceTier: 'local_simulation',
        })),
        calendar: calendar.rows.map((row) => ({
          calendarEventId: row.id,
          contentVersionId: row.content_version_id,
          state: row.state,
          plannedFor: asDate(row.planned_for, 'editorial calendar plan'),
          evidenceTier: 'local_simulation',
          externalActionEnabled: false,
        })),
        preferences: {
          grantedLocalFixtures: preferenceCounts.rows[0]?.granted ?? 0,
          withdrawnLocalFixtures: preferenceCounts.rows[0]?.withdrawn ?? 0,
          externalDeliveryEnabled: false,
        },
      };
    });
  }
}
