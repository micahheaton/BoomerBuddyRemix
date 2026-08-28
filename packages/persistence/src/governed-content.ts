import { createHash } from 'node:crypto';
import {
  assertGovernedContentSlug,
  buildDeterministicGovernedDraft,
  DomainError,
  governedContentReviewRoles,
  governedPublicationEligibility,
  normalizeGovernedContentDocument,
  type GovernedContentDocument,
  type GovernedContentReviewDecision,
  type GovernedContentReviewRole,
  type GovernedPublicFact,
} from '@boomerbuddy/domain';
import {
  decryptField,
  encryptField,
  minimizeRestrictedInput,
  parseEncryptedField,
  serializeEncryptedField,
} from '@boomerbuddy/security';
import type { Database, SqlExecutor } from './database';
import { asDate, jsonParameter, randomIdFactory, stringArray, type IdFactory } from './values';

const stableIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const sourceIdPattern = /^([a-z][a-z0-9_-]{2,79}):v([1-9][0-9]*)$/u;
const forbiddenLocator = /(?:https?:\/\/|www\.)/iu;
const forbiddenPersonalIdentifier =
  /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:code|pin|otp)\s*(?:is|:|=)?\s*\d{4,8}\b|\b(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b|\b\d{1,5}\s+[A-Z][A-Za-z .'-]{1,60}\s(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr)\b)/iu;

export interface GovernedContentProtection {
  readonly encryptionKey: Uint8Array;
  readonly encryptionKeyVersion: number;
}

interface FactRow extends Record<string, unknown> {
  readonly brief_key: string;
  readonly version: number;
  readonly region_code: string;
  readonly title: string;
  readonly summary: string;
  readonly safe_actions: unknown;
  readonly source_title: string;
  readonly source_url: string;
  readonly source_published_at: unknown;
  readonly reviewed_at: unknown;
  readonly expires_at: unknown;
}

interface RevisionRow extends Record<string, unknown> {
  readonly id: string;
  readonly content_key: string;
  readonly version: number;
  readonly previous_revision_id: string | null;
  readonly revision_kind: 'deterministic' | 'human' | 'correction';
  readonly source_brief_key: string;
  readonly source_brief_version: number;
  readonly source_claim_digest: string;
  readonly slug: string;
  readonly document_sha256: string;
  readonly encrypted_document: string;
  readonly encryption_key_version: number;
  readonly expires_at: unknown;
  readonly created_at: unknown;
}

interface EmployeeRow extends Record<string, unknown> {
  readonly id: string;
  readonly person_id: string;
  readonly role: 'hq_owner' | 'hq_reviewer';
}

interface ReviewRow extends Record<string, unknown> {
  readonly review_role: GovernedContentReviewRole;
  readonly assigned_to_person_id: string;
  readonly decision: GovernedContentReviewDecision | null;
  readonly reason: string | null;
  readonly reviewed_at: unknown | null;
  readonly actor_person_id: string | null;
  readonly assignment_document_sha256: string;
  readonly reviewed_document_sha256: string | null;
}

interface PublicationRow extends Record<string, unknown> {
  readonly action: 'publish' | 'unpublish' | 'retract';
  readonly revision_id: string;
  readonly occurred_at: unknown;
}

interface IntentRow extends Record<string, unknown> {
  readonly id: string;
  readonly action: 'publish' | 'unpublish' | 'retract';
  readonly revision_id: string;
  readonly slug: string;
  readonly exact_document_sha256: string;
  readonly request_sha256: string;
  readonly authorized_by_person_id: string;
  readonly authorized_at: unknown;
}

export interface GovernedContentReviewView {
  readonly role: GovernedContentReviewRole;
  readonly assignedToPersonId?: string;
  readonly decision?: GovernedContentReviewDecision;
  readonly reason?: string;
  readonly reviewedAt?: Date;
  readonly actorPersonId?: string;
}

export interface GovernedContentDraftMetadata {
  readonly revisionId: string;
  readonly contentKey: string;
  readonly version: number;
  readonly previousRevisionId?: string;
  readonly revisionKind: 'deterministic' | 'human' | 'correction';
  readonly sourceId: string;
  readonly sourceDigest: string;
  readonly slug: string;
  readonly documentDigest: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly reviews: readonly GovernedContentReviewView[];
  readonly publication: 'draft' | 'published' | 'unpublished' | 'retracted' | 'expired';
  readonly publicationEligible: boolean;
  readonly blockers: readonly string[];
}

export interface GovernedContentDraftView extends GovernedContentDraftMetadata {
  readonly document: GovernedContentDocument;
  readonly source: {
    readonly title: string;
    readonly url: string;
    readonly publishedAt: Date;
    readonly reviewedAt: Date;
  };
}

export interface GovernedContentBoard {
  readonly generatedAt: Date;
  readonly facts: readonly GovernedPublicFact[];
  readonly drafts: readonly GovernedContentDraftMetadata[];
}

export interface PublicLearnArticleView {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly documentDigest: string;
  readonly publishedAt: Date;
  readonly expiresAt: Date;
  readonly source: {
    readonly title: string;
    readonly url: string;
    readonly publishedAt: Date;
    readonly reviewedAt: Date;
  };
}

export type PublicLearnArticleSummaryView = Omit<PublicLearnArticleView, 'body'>;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertStableId(value: string, field: string): void {
  if (!stableIdPattern.test(value)) throw new DomainError('invalid_input', `Invalid ${field}`);
}

function assertDigest(value: string): void {
  if (!digestPattern.test(value)) throw new DomainError('invalid_input', 'Invalid content digest');
}

function parseSourceId(sourceId: string): { readonly key: string; readonly version: number } {
  const match = sourceIdPattern.exec(sourceId);
  if (match === null) throw new DomainError('invalid_input', 'Invalid approved source ID');
  return { key: match[1] as string, version: Number(match[2]) };
}

function sourceId(key: string, version: number): string {
  return `${key}:v${version}`;
}

function canonicalSource(row: FactRow): string {
  return JSON.stringify({
    key: row.brief_key,
    version: row.version,
    region: row.region_code,
    title: row.title,
    summary: row.summary,
    safeActions: stringArray(row.safe_actions, 'governed content safe actions'),
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
    sourcePublishedAt: asDate(row.source_published_at, 'source publication').toISOString(),
    reviewedAt: asDate(row.reviewed_at, 'source review').toISOString(),
    expiresAt: asDate(row.expires_at, 'source expiry').toISOString(),
  });
}

function factFromRow(row: FactRow): GovernedPublicFact {
  return {
    sourceId: sourceId(row.brief_key, row.version),
    sourceDigest: sha256(canonicalSource(row)),
    region: row.region_code,
    title: row.title,
    summary: row.summary,
    safeActions: stringArray(row.safe_actions, 'governed content safe actions'),
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
    sourcePublishedAt: asDate(row.source_published_at, 'source publication'),
    reviewedAt: asDate(row.reviewed_at, 'source review'),
    expiresAt: asDate(row.expires_at, 'source expiry'),
  };
}

function contentKeyForSource(key: string): string {
  const normalized = key.replace(/-/gu, '_');
  return `content_${normalized}`.slice(0, 118);
}

function disambiguatedSlug(slug: string, sourceDigest: string): string {
  const suffix = `-${sourceDigest.slice(0, 8)}`;
  const stem = slug.slice(0, 100 - suffix.length).replace(/-$/u, '');
  return assertGovernedContentSlug(`${stem}${suffix}`);
}

function canonicalDocument(document: GovernedContentDocument): string {
  return JSON.stringify({
    slug: document.slug,
    title: document.title,
    summary: document.summary,
    body: document.body,
    platformDrafts: {
      youtubeScript: document.platformDrafts.youtubeScript,
      tiktokCaption: document.platformDrafts.tiktokCaption,
      linkedinPost: document.platformDrafts.linkedinPost,
    },
  });
}

function protectedDocument(document: GovernedContentDocument): GovernedContentDocument {
  const normalized = normalizeGovernedContentDocument(document);
  const fields = [
    normalized.title,
    normalized.summary,
    normalized.body,
    normalized.platformDrafts.youtubeScript,
    normalized.platformDrafts.tiktokCaption,
    normalized.platformDrafts.linkedinPost,
  ];
  if (fields.some((field) => forbiddenLocator.test(field))) {
    throw new DomainError('restricted_input', 'Draft text must use structured source links');
  }
  if (fields.some((field) => forbiddenPersonalIdentifier.test(field))) {
    throw new DomainError('restricted_input', 'Draft contains restricted or personal data');
  }
  for (const field of fields) {
    const minimized = minimizeRestrictedInput(field, 16_384, 'reject');
    if (minimized.status !== 'accepted' || minimized.detected.length > 0) {
      throw new DomainError('restricted_input', 'Draft contains restricted or personal data');
    }
  }
  return normalized;
}

function platformDrafts(input: {
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly sourceTitle: string;
}): GovernedContentDocument['platformDrafts'] {
  const sourceLine = `Reviewed source: ${input.sourceTitle}.`;
  return {
    youtubeScript: `${input.title}\n\n${input.summary}\n\n${input.body}\n\n${sourceLine}`.slice(
      0,
      4_000,
    ),
    tiktokCaption: `${input.title}: ${input.summary} ${sourceLine}`.slice(0, 2_200),
    linkedinPost: `${input.title}\n\n${input.summary}\n\n${input.body}\n\n${sourceLine}`.slice(
      0,
      3_000,
    ),
  };
}

async function lockMutex(transaction: SqlExecutor): Promise<void> {
  await transaction.query(
    'SELECT singleton FROM governed_content_mutex WHERE singleton FOR UPDATE',
  );
}

async function writeAudit(
  transaction: SqlExecutor,
  ids: IdFactory,
  input: {
    readonly actorPersonId: string;
    readonly action: string;
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
     ) VALUES ($1,NULL,$2,'hq',$3,'governed_content_revision',$4,'completed',$5::jsonb,$6,$7)`,
    [
      ids.next('audit'),
      input.actorPersonId,
      input.action,
      input.resourceId,
      jsonParameter(input.metadata ?? {}),
      input.correlationId,
      input.now.toISOString(),
    ],
  );
}

export class GovernedContentRepository {
  constructor(
    private readonly database: Database,
    private readonly protection: GovernedContentProtection,
    private readonly ids: IdFactory = randomIdFactory,
  ) {
    if (
      protection.encryptionKey.byteLength !== 32 ||
      !Number.isSafeInteger(protection.encryptionKeyVersion) ||
      protection.encryptionKeyVersion < 1
    ) {
      throw new TypeError('Governed content encryption configuration is invalid');
    }
  }

  private async employee(
    transaction: SqlExecutor,
    actorPersonId: string,
    ownerOnly = false,
  ): Promise<EmployeeRow> {
    assertStableId(actorPersonId, 'actor person ID');
    const result = await transaction.query<EmployeeRow>(
      `SELECT employee.id, employee.person_id, employee.role
       FROM employee_assignments employee
       JOIN organizations organization ON organization.id = employee.organization_id
       WHERE employee.person_id = $1 AND employee.status = 'active'
         AND organization.kind = 'internal'
         AND employee.role ${ownerOnly ? "= 'hq_owner'" : "IN ('hq_owner','hq_reviewer')"}
       ORDER BY CASE employee.role WHEN 'hq_owner' THEN 0 ELSE 1 END, employee.id
       LIMIT 1 FOR UPDATE OF employee, organization`,
      [actorPersonId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new DomainError(
        'not_authorized',
        ownerOnly
          ? 'Publication requires an active HQ owner'
          : 'Editorial work requires HQ review authority',
      );
    }
    return row;
  }

  private async fact(
    transaction: SqlExecutor,
    source: { readonly key: string; readonly version: number },
    now: Date,
  ): Promise<{ readonly row: FactRow; readonly fact: GovernedPublicFact }> {
    const result = await transaction.query<FactRow>(
      `SELECT brief_key, version, region_code, title, summary, safe_actions, source_title,
              source_url, source_published_at, reviewed_at, expires_at
       FROM member_scam_guidance_briefs
       WHERE brief_key = $1 AND version = $2 AND source_kind = 'public_official'
         AND review_state = 'approved' AND publication_state = 'in_app_only'
         AND automation_generated = false AND external_delivery_permitted = false
         AND expires_at > $3`,
      [source.key, source.version, now.toISOString()],
    );
    const row = result.rows[0];
    if (row === undefined) throw new DomainError('not_found', 'Approved source fact was not found');
    return { row, fact: factFromRow(row) };
  }

  private encryptDocument(
    id: string,
    document: GovernedContentDocument,
  ): {
    readonly document: GovernedContentDocument;
    readonly digest: string;
    readonly encrypted: string;
  } {
    const protectedValue = protectedDocument(document);
    const serialized = canonicalDocument(protectedValue);
    const digest = sha256(serialized);
    const encrypted = encryptField(serialized, this.protection.encryptionKey, {
      tenantId: 'boomerbuddy_governed_content',
      resourceId: id,
      field: 'draft_document',
      schemaVersion: 1,
      keyVersion: this.protection.encryptionKeyVersion,
    });
    return { document: protectedValue, digest, encrypted: serializeEncryptedField(encrypted) };
  }

  private decryptDocument(row: RevisionRow): GovernedContentDocument {
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        decryptField(parseEncryptedField(row.encrypted_document), this.protection.encryptionKey, {
          tenantId: 'boomerbuddy_governed_content',
          resourceId: row.id,
          field: 'draft_document',
          schemaVersion: 1,
          keyVersion: row.encryption_key_version,
        }).toString('utf8'),
      );
    } catch {
      throw new DomainError('conflict', 'Draft encryption integrity check failed');
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new DomainError('conflict', 'Draft document is invalid');
    }
    const value = parsed as GovernedContentDocument;
    const document = protectedDocument(value);
    if (sha256(canonicalDocument(document)) !== row.document_sha256) {
      throw new DomainError('conflict', 'Draft digest integrity check failed');
    }
    return document;
  }

  private async revision(transaction: SqlExecutor, revisionId: string): Promise<RevisionRow> {
    assertStableId(revisionId, 'revision ID');
    const result = await transaction.query<RevisionRow>(
      `SELECT id, content_key, version, previous_revision_id, revision_kind,
              source_brief_key, source_brief_version, source_claim_digest, slug,
              document_sha256, encrypted_document, encryption_key_version, expires_at, created_at
       FROM governed_content_revisions WHERE id = $1 FOR UPDATE`,
      [revisionId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new DomainError('not_found', 'Content revision was not found');
    return row;
  }

  private async reviews(
    transaction: SqlExecutor,
    revisionId: string,
  ): Promise<GovernedContentReviewView[]> {
    const rows = await transaction.query<ReviewRow>(
      `SELECT assignment.review_role, assignment.assigned_to_person_id,
              review.decision, review.reason, review.occurred_at AS reviewed_at,
              review.actor_person_id, assignment.document_sha256 AS assignment_document_sha256,
              review.reviewed_document_sha256
       FROM governed_content_review_assignments assignment
       LEFT JOIN governed_content_review_events review ON review.assignment_id = assignment.id
       WHERE assignment.revision_id = $1 ORDER BY assignment.review_role`,
      [revisionId],
    );
    return rows.rows.map((row) => ({
      role: row.review_role,
      assignedToPersonId: row.assigned_to_person_id,
      ...(row.decision === null || row.assignment_document_sha256 !== row.reviewed_document_sha256
        ? {}
        : { decision: row.decision }),
      ...(row.reason === null ? {} : { reason: row.reason }),
      ...(row.reviewed_at === null
        ? {}
        : { reviewedAt: asDate(row.reviewed_at, 'content review') }),
      ...(row.actor_person_id === null ? {} : { actorPersonId: row.actor_person_id }),
    }));
  }

  private async metadata(
    transaction: SqlExecutor,
    row: RevisionRow,
    now: Date,
  ): Promise<GovernedContentDraftMetadata> {
    const reviews = await this.reviews(transaction, row.id);
    const decisions: Partial<Record<GovernedContentReviewRole, GovernedContentReviewDecision>> = {};
    let skepticalActorId: string | undefined;
    let finalActorId: string | undefined;
    for (const review of reviews) {
      if (review.decision !== undefined) decisions[review.role] = review.decision;
      if (review.role === 'skeptical') skepticalActorId = review.actorPersonId;
      if (review.role === 'final_human') finalActorId = review.actorPersonId;
    }
    const publicationResult = await transaction.query<PublicationRow>(
      `SELECT action, revision_id, occurred_at FROM governed_content_publication_events
       WHERE slug = $1 ORDER BY sequence DESC LIMIT 1`,
      [row.slug],
    );
    const expired = asDate(row.expires_at, 'content revision expiry') <= now;
    const exactDigest = digestPattern.test(row.document_sha256);
    const eligibility = governedPublicationEligibility({
      exactDigest,
      unexpired: !expired,
      decisions,
      ...(skepticalActorId === undefined ? {} : { skepticalActorId }),
      ...(finalActorId === undefined ? {} : { finalActorId }),
    });
    const latestPublication = publicationResult.rows[0];
    let publication: GovernedContentDraftMetadata['publication'];
    if (expired) publication = 'expired';
    else if (latestPublication === undefined) publication = 'draft';
    else if (latestPublication.action === 'publish' && latestPublication.revision_id === row.id) {
      publication = 'published';
    } else if (latestPublication.action === 'retract' && latestPublication.revision_id === row.id) {
      publication = 'retracted';
    } else {
      publication = 'unpublished';
    }
    return {
      revisionId: row.id,
      contentKey: row.content_key,
      version: row.version,
      ...(row.previous_revision_id === null
        ? {}
        : { previousRevisionId: row.previous_revision_id }),
      revisionKind: row.revision_kind,
      sourceId: sourceId(row.source_brief_key, row.source_brief_version),
      sourceDigest: row.source_claim_digest,
      slug: row.slug,
      documentDigest: row.document_sha256,
      expiresAt: asDate(row.expires_at, 'content revision expiry'),
      createdAt: asDate(row.created_at, 'content revision creation'),
      reviews,
      publication,
      publicationEligible: eligibility.eligible,
      blockers: eligibility.blockers,
    };
  }

  private async insertRevision(
    transaction: SqlExecutor,
    input: {
      readonly fact: GovernedPublicFact;
      readonly source: { readonly key: string; readonly version: number };
      readonly contentKey: string;
      readonly version: number;
      readonly previousRevisionId?: string;
      readonly revisionKind: 'deterministic' | 'human' | 'correction';
      readonly document: GovernedContentDocument;
      readonly actorPersonId?: string;
      readonly createdByService?: 'governed_content.daily_generator';
      readonly now: Date;
    },
  ): Promise<{ readonly id: string; readonly digest: string }> {
    const id = this.ids.next('content_revision');
    const protectedValue = this.encryptDocument(id, input.document);
    await transaction.query(
      `INSERT INTO governed_content_revisions(
         id, content_key, version, previous_revision_id, revision_kind,
         source_brief_key, source_brief_version, source_claim_digest, slug,
         document_sha256, encrypted_document, encryption_key_version,
         created_by_person_id, created_by_service, expires_at, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        id,
        input.contentKey,
        input.version,
        input.previousRevisionId ?? null,
        input.revisionKind,
        input.source.key,
        input.source.version,
        input.fact.sourceDigest,
        protectedValue.document.slug,
        protectedValue.digest,
        protectedValue.encrypted,
        this.protection.encryptionKeyVersion,
        input.actorPersonId ?? null,
        input.createdByService ?? null,
        input.fact.expiresAt.toISOString(),
        input.now.toISOString(),
      ],
    );
    return { id, digest: protectedValue.digest };
  }

  async board(input: {
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<GovernedContentBoard> {
    return this.database.transaction(async (transaction) => {
      await lockMutex(transaction);
      await this.employee(transaction, input.actorPersonId);
      const facts = await transaction.query<FactRow>(
        `SELECT brief_key, version, region_code, title, summary, safe_actions, source_title,
                source_url, source_published_at, reviewed_at, expires_at
         FROM member_scam_guidance_briefs
         WHERE source_kind = 'public_official' AND review_state = 'approved'
           AND publication_state = 'in_app_only' AND automation_generated = false
           AND external_delivery_permitted = false AND expires_at > $1
         ORDER BY region_code, brief_key, version DESC LIMIT 100`,
        [input.now.toISOString()],
      );
      const drafts = await transaction.query<RevisionRow>(
        `SELECT id, content_key, version, previous_revision_id, revision_kind,
                source_brief_key, source_brief_version, source_claim_digest, slug,
                document_sha256, encrypted_document, encryption_key_version, expires_at, created_at
         FROM governed_content_revisions ORDER BY created_at DESC, id DESC LIMIT 200`,
      );
      const metadata: GovernedContentDraftMetadata[] = [];
      for (const row of drafts.rows)
        metadata.push(await this.metadata(transaction, row, input.now));
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'governed_content.board.read',
        resourceId: 'governed_content_board',
        correlationId: input.correlationId,
        now: input.now,
        metadata: { contentIncluded: false },
      });
      return { generatedAt: input.now, facts: facts.rows.map(factFromRow), drafts: metadata };
    });
  }

  async createDraft(input: {
    readonly sourceId: string;
    readonly slug: string;
    readonly title: string;
    readonly summary: string;
    readonly body: string;
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<{ readonly revisionId: string; readonly documentDigest: string }> {
    const source = parseSourceId(input.sourceId);
    return this.database.transaction(async (transaction) => {
      await lockMutex(transaction);
      await this.employee(transaction, input.actorPersonId);
      const fact = await this.fact(transaction, source, input.now);
      const contentKey = contentKeyForSource(source.key);
      const existing = await transaction.query<{ count: number } & Record<string, unknown>>(
        'SELECT count(*)::integer AS count FROM governed_content_revisions WHERE content_key = $1',
        [contentKey],
      );
      if (Number(existing.rows[0]?.count ?? 0) > 0) {
        throw new DomainError('conflict', 'Use a new revision for existing content');
      }
      const document = protectedDocument({
        slug: input.slug,
        title: input.title,
        summary: input.summary,
        body: input.body,
        platformDrafts: platformDrafts({
          title: input.title,
          summary: input.summary,
          body: input.body,
          sourceTitle: fact.fact.sourceTitle,
        }),
      });
      const slugClaim = await transaction.query<{ content_key: string } & Record<string, unknown>>(
        'SELECT content_key FROM governed_content_slug_claims WHERE slug = $1',
        [document.slug],
      );
      if (slugClaim.rows[0] !== undefined && slugClaim.rows[0].content_key !== contentKey) {
        throw new DomainError('conflict', 'This public slug belongs to another article');
      }
      const result = await this.insertRevision(transaction, {
        fact: fact.fact,
        source,
        contentKey,
        version: 1,
        revisionKind: 'human',
        document,
        actorPersonId: input.actorPersonId,
        now: input.now,
      });
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'governed_content.draft.create',
        resourceId: result.id,
        correlationId: input.correlationId,
        now: input.now,
        metadata: { sourceId: input.sourceId },
      });
      return { revisionId: result.id, documentDigest: result.digest };
    });
  }

  async reviseDraft(input: {
    readonly revisionId: string;
    readonly expectedDocumentDigest: string;
    readonly slug: string;
    readonly title: string;
    readonly summary: string;
    readonly body: string;
    readonly correction: boolean;
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<{ readonly revisionId: string; readonly documentDigest: string }> {
    assertDigest(input.expectedDocumentDigest);
    return this.database.transaction(async (transaction) => {
      await lockMutex(transaction);
      await this.employee(transaction, input.actorPersonId);
      const previous = await this.revision(transaction, input.revisionId);
      if (previous.document_sha256 !== input.expectedDocumentDigest) {
        throw new DomainError('conflict', 'Draft changed; reload the exact revision');
      }
      if (assertGovernedContentSlug(input.slug) !== previous.slug) {
        throw new DomainError('invalid_transition', 'Article slug is immutable across revisions');
      }
      const source = { key: previous.source_brief_key, version: previous.source_brief_version };
      const fact = await this.fact(transaction, source, input.now);
      if (fact.fact.sourceDigest !== previous.source_claim_digest) {
        throw new DomainError('conflict', 'Approved source fact digest changed');
      }
      const latest = await transaction.query<{ version: number } & Record<string, unknown>>(
        'SELECT max(version)::integer AS version FROM governed_content_revisions WHERE content_key = $1',
        [previous.content_key],
      );
      if (Number(latest.rows[0]?.version ?? 0) !== previous.version) {
        throw new DomainError('conflict', 'A newer immutable revision already exists');
      }
      const document = protectedDocument({
        slug: input.slug,
        title: input.title,
        summary: input.summary,
        body: input.body,
        platformDrafts: platformDrafts({
          title: input.title,
          summary: input.summary,
          body: input.body,
          sourceTitle: fact.fact.sourceTitle,
        }),
      });
      const result = await this.insertRevision(transaction, {
        fact: fact.fact,
        source,
        contentKey: previous.content_key,
        version: previous.version + 1,
        previousRevisionId: previous.id,
        revisionKind: input.correction ? 'correction' : 'human',
        document,
        actorPersonId: input.actorPersonId,
        now: input.now,
      });
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: input.correction
          ? 'governed_content.correction.create'
          : 'governed_content.revision.create',
        resourceId: result.id,
        correlationId: input.correlationId,
        now: input.now,
        metadata: { previousRevisionId: previous.id },
      });
      return { revisionId: result.id, documentDigest: result.digest };
    });
  }

  async readDraft(input: {
    readonly revisionId: string;
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<GovernedContentDraftView> {
    return this.database.transaction(async (transaction) => {
      await lockMutex(transaction);
      const employee = await this.employee(transaction, input.actorPersonId);
      const row = await this.revision(transaction, input.revisionId);
      if (employee.role !== 'hq_owner') {
        const assignment = await transaction.query<Record<string, unknown>>(
          `SELECT id FROM governed_content_review_assignments
           WHERE revision_id = $1 AND assigned_to_person_id = $2 LIMIT 1`,
          [row.id, input.actorPersonId],
        );
        if (assignment.rows[0] === undefined) {
          throw new DomainError(
            'not_authorized',
            'Draft content requires an exact review assignment',
          );
        }
      }
      const fact = await this.fact(
        transaction,
        { key: row.source_brief_key, version: row.source_brief_version },
        input.now,
      );
      if (fact.fact.sourceDigest !== row.source_claim_digest) {
        throw new DomainError('conflict', 'Draft source digest integrity check failed');
      }
      const metadata = await this.metadata(transaction, row, input.now);
      const document = this.decryptDocument(row);
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'governed_content.draft.read',
        resourceId: row.id,
        correlationId: input.correlationId,
        now: input.now,
        metadata: { exactDigest: row.document_sha256 },
      });
      return {
        ...metadata,
        document,
        source: {
          title: fact.fact.sourceTitle,
          url: fact.fact.sourceUrl,
          publishedAt: fact.fact.sourcePublishedAt,
          reviewedAt: fact.fact.reviewedAt,
        },
      };
    });
  }

  async assignReview(input: {
    readonly revisionId: string;
    readonly reviewRole: GovernedContentReviewRole;
    readonly expectedDocumentDigest: string;
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<void> {
    assertDigest(input.expectedDocumentDigest);
    if (!governedContentReviewRoles.includes(input.reviewRole)) {
      throw new DomainError('invalid_input', 'Invalid content review role');
    }
    await this.database.transaction(async (transaction) => {
      await lockMutex(transaction);
      const employee = await this.employee(
        transaction,
        input.actorPersonId,
        input.reviewRole === 'final_human',
      );
      const row = await this.revision(transaction, input.revisionId);
      if (row.document_sha256 !== input.expectedDocumentDigest) {
        throw new DomainError('conflict', 'Review assignment digest does not match the revision');
      }
      const existing = await transaction.query<
        { assigned_to_person_id: string } & Record<string, unknown>
      >(
        `SELECT assigned_to_person_id FROM governed_content_review_assignments
         WHERE revision_id = $1 AND review_role = $2`,
        [row.id, input.reviewRole],
      );
      if (existing.rows[0] !== undefined) {
        if (existing.rows[0].assigned_to_person_id === input.actorPersonId) return;
        throw new DomainError('conflict', 'This exact review role is already assigned');
      }
      await transaction.query(
        `INSERT INTO governed_content_review_assignments(
           id, revision_id, review_role, employee_assignment_id, assigned_to_person_id,
           assigned_by_person_id, document_sha256, assigned_at
         ) VALUES ($1,$2,$3,$4,$5,$5,$6,$7)`,
        [
          this.ids.next('content_assignment'),
          row.id,
          input.reviewRole,
          employee.id,
          input.actorPersonId,
          row.document_sha256,
          input.now.toISOString(),
        ],
      );
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'governed_content.review.assign',
        resourceId: row.id,
        correlationId: input.correlationId,
        now: input.now,
        metadata: { role: input.reviewRole },
      });
    });
  }

  async review(input: {
    readonly revisionId: string;
    readonly reviewRole: GovernedContentReviewRole;
    readonly decision: GovernedContentReviewDecision;
    readonly reason: string;
    readonly expectedDocumentDigest: string;
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<void> {
    assertDigest(input.expectedDocumentDigest);
    const reason = minimizeRestrictedInput(input.reason, 500, 'reject');
    if (reason.status !== 'accepted' || reason.detected.length > 0 || reason.minimized.length < 3) {
      throw new DomainError(
        'restricted_input',
        'Review reason must not contain personal or secret data',
      );
    }
    await this.database.transaction(async (transaction) => {
      await lockMutex(transaction);
      await this.employee(transaction, input.actorPersonId, input.reviewRole === 'final_human');
      const row = await this.revision(transaction, input.revisionId);
      if (row.document_sha256 !== input.expectedDocumentDigest) {
        throw new DomainError('conflict', 'Review digest does not match the revision');
      }
      const assignment = await transaction.query<
        { id: string; assigned_to_person_id: string; document_sha256: string } & Record<
          string,
          unknown
        >
      >(
        `SELECT id, assigned_to_person_id, document_sha256
         FROM governed_content_review_assignments
         WHERE revision_id = $1 AND review_role = $2 FOR UPDATE`,
        [row.id, input.reviewRole],
      );
      const assigned = assignment.rows[0];
      if (
        assigned === undefined ||
        assigned.assigned_to_person_id !== input.actorPersonId ||
        assigned.document_sha256 !== row.document_sha256
      ) {
        throw new DomainError('not_authorized', 'Review requires the exact active assignment');
      }
      const existing = await transaction.query<Record<string, unknown>>(
        'SELECT id FROM governed_content_review_events WHERE assignment_id = $1',
        [assigned.id],
      );
      if (existing.rows[0] !== undefined) throw new DomainError('conflict', 'Review is immutable');
      await transaction.query(
        `INSERT INTO governed_content_review_events(
           id, assignment_id, revision_id, review_role, actor_person_id, decision,
           reviewed_document_sha256, reason, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          this.ids.next('content_review'),
          assigned.id,
          row.id,
          input.reviewRole,
          input.actorPersonId,
          input.decision,
          row.document_sha256,
          reason.minimized,
          input.now.toISOString(),
        ],
      );
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: 'governed_content.review.record',
        resourceId: row.id,
        correlationId: input.correlationId,
        now: input.now,
        metadata: { role: input.reviewRole, decision: input.decision },
      });
    });
  }

  async generateDailyDrafts(input: {
    readonly scheduleDate: string;
    readonly now: Date;
    readonly limit?: number;
    readonly requestedByPersonId?: string;
    readonly correlationId?: string;
  }): Promise<readonly string[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.scheduleDate)) {
      throw new DomainError('invalid_input', 'Invalid content generation schedule date');
    }
    if ((input.requestedByPersonId === undefined) !== (input.correlationId === undefined)) {
      throw new DomainError('invalid_input', 'Manual generation authority evidence is incomplete');
    }
    const limit = Math.min(Math.max(input.limit ?? 5, 1), 25);
    return this.database.transaction(async (transaction) => {
      await lockMutex(transaction);
      if (input.requestedByPersonId !== undefined) {
        await this.employee(transaction, input.requestedByPersonId);
      }
      const facts = await transaction.query<FactRow>(
        `SELECT brief.brief_key, brief.version, brief.region_code, brief.title, brief.summary,
                brief.safe_actions, brief.source_title, brief.source_url,
                brief.source_published_at, brief.reviewed_at, brief.expires_at
         FROM member_scam_guidance_briefs brief
         LEFT JOIN governed_content_generation_runs run
           ON run.source_brief_key = brief.brief_key AND run.source_brief_version = brief.version
         LEFT JOIN governed_content_revisions existing_revision
           ON existing_revision.source_brief_key = brief.brief_key
          AND existing_revision.source_brief_version = brief.version
         WHERE run.id IS NULL AND existing_revision.id IS NULL AND brief.source_kind = 'public_official'
           AND brief.review_state = 'approved' AND brief.publication_state = 'in_app_only'
           AND brief.automation_generated = false AND brief.external_delivery_permitted = false
           AND brief.expires_at > $1
         ORDER BY brief.region_code, brief.brief_key, brief.version DESC LIMIT $2`,
        [input.now.toISOString(), limit],
      );
      const generated: string[] = [];
      for (const row of facts.rows) {
        const fact = factFromRow(row);
        const contentKey = contentKeyForSource(row.brief_key);
        const existing = await transaction.query<
          { id: string; version: number; slug: string } & Record<string, unknown>
        >(
          `SELECT id, version, slug FROM governed_content_revisions
           WHERE content_key = $1 ORDER BY version DESC LIMIT 1`,
          [contentKey],
        );
        const previous = existing.rows[0];
        const version = (previous?.version ?? 0) + 1;
        const generatedDocument = buildDeterministicGovernedDraft(fact);
        let document: GovernedContentDocument =
          previous === undefined
            ? generatedDocument
            : { ...generatedDocument, slug: previous.slug };
        if (previous === undefined) {
          const slugClaim = await transaction.query<
            { content_key: string } & Record<string, unknown>
          >('SELECT content_key FROM governed_content_slug_claims WHERE slug = $1', [
            document.slug,
          ]);
          if (slugClaim.rows[0] !== undefined && slugClaim.rows[0].content_key !== contentKey) {
            document = { ...document, slug: disambiguatedSlug(document.slug, fact.sourceDigest) };
          }
        }
        const inserted = await this.insertRevision(transaction, {
          fact,
          source: { key: row.brief_key, version: row.version },
          contentKey,
          version,
          ...(previous === undefined ? {} : { previousRevisionId: previous.id }),
          revisionKind: 'deterministic',
          document,
          createdByService: 'governed_content.daily_generator',
          now: input.now,
        });
        await transaction.query(
          `INSERT INTO governed_content_generation_runs(
             id, schedule_date, source_brief_key, source_brief_version, source_claim_digest,
             resulting_revision_id, generator_version, customer_data_accessed,
             external_fetch_performed, provider_action_performed, publication_performed, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,'structured-template-v1',false,false,false,false,$7)`,
          [
            this.ids.next('content_generation'),
            input.scheduleDate,
            row.brief_key,
            row.version,
            fact.sourceDigest,
            inserted.id,
            input.now.toISOString(),
          ],
        );
        if (input.requestedByPersonId !== undefined && input.correlationId !== undefined) {
          await writeAudit(transaction, this.ids, {
            actorPersonId: input.requestedByPersonId,
            action: 'governed_content.generation.request',
            resourceId: inserted.id,
            correlationId: input.correlationId,
            now: input.now,
            metadata: { scheduleDate: input.scheduleDate, customerDataAccessed: false },
          });
        }
        generated.push(inserted.id);
      }
      return generated;
    });
  }

  async authorizePublication(input: {
    readonly revisionId: string;
    readonly action: 'publish' | 'unpublish' | 'retract';
    readonly expectedDocumentDigest: string;
    readonly idempotencyKey: string;
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<{ readonly intentId: string; readonly replay: boolean }> {
    assertDigest(input.expectedDocumentDigest);
    if (input.idempotencyKey.length < 16 || input.idempotencyKey.length > 200) {
      throw new DomainError('invalid_input', 'A bounded publication Idempotency-Key is required');
    }
    return this.database.transaction(async (transaction) => {
      await lockMutex(transaction);
      await this.employee(transaction, input.actorPersonId, true);
      const row = await this.revision(transaction, input.revisionId);
      if (row.document_sha256 !== input.expectedDocumentDigest) {
        throw new DomainError('conflict', 'Publication digest does not match the exact revision');
      }
      const requestDigest = sha256(
        JSON.stringify({
          action: input.action,
          revisionId: row.id,
          slug: row.slug,
          documentDigest: row.document_sha256,
          actorPersonId: input.actorPersonId,
        }),
      );
      const keyDigest = sha256(input.idempotencyKey);
      const existing = await transaction.query<IntentRow>(
        `SELECT id, action, revision_id, slug, exact_document_sha256, request_sha256,
                authorized_by_person_id, authorized_at
         FROM governed_content_publication_intents WHERE idempotency_key_sha256 = $1`,
        [keyDigest],
      );
      if (existing.rows[0] !== undefined) {
        if (existing.rows[0].request_sha256 !== requestDigest) {
          throw new DomainError('conflict', 'Publication Idempotency-Key was reused');
        }
        return { intentId: existing.rows[0].id, replay: true };
      }
      if (input.action === 'publish') {
        const metadata = await this.metadata(transaction, row, input.now);
        if (!metadata.publicationEligible) {
          throw new DomainError(
            'invalid_transition',
            `Publication blocked: ${metadata.blockers.join(', ')}`,
          );
        }
      } else {
        const latest = await transaction.query<
          { action: string; revision_id: string; exact_document_sha256: string } & Record<
            string,
            unknown
          >
        >(
          `SELECT action, revision_id, exact_document_sha256
           FROM governed_content_publication_events
           WHERE slug = $1 ORDER BY sequence DESC LIMIT 1`,
          [row.slug],
        );
        if (
          latest.rows[0]?.action !== 'publish' ||
          latest.rows[0].revision_id !== row.id ||
          latest.rows[0].exact_document_sha256 !== row.document_sha256
        ) {
          throw new DomainError(
            'invalid_transition',
            'Only the exact current public revision can be removed',
          );
        }
      }
      const intentId = this.ids.next('content_intent');
      await transaction.query(
        `INSERT INTO governed_content_publication_intents(
           id, action, revision_id, slug, exact_document_sha256, request_sha256,
           idempotency_key_sha256, authorized_by_person_id, authorization_kind, authorized_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'recent_hq_mfa',$9)`,
        [
          intentId,
          input.action,
          row.id,
          row.slug,
          row.document_sha256,
          requestDigest,
          keyDigest,
          input.actorPersonId,
          input.now.toISOString(),
        ],
      );
      await writeAudit(transaction, this.ids, {
        actorPersonId: input.actorPersonId,
        action: `governed_content.${input.action}.authorize`,
        resourceId: row.id,
        correlationId: input.correlationId,
        now: input.now,
        metadata: { exactDigest: row.document_sha256 },
      });
      return { intentId, replay: false };
    });
  }

  async reconcilePublicationIntent(input: {
    readonly intentId: string;
    readonly now: Date;
  }): Promise<{
    readonly revisionId: string;
    readonly documentDigest: string;
    readonly action: 'publish' | 'unpublish' | 'retract';
    readonly replay: boolean;
  }> {
    assertStableId(input.intentId, 'publication intent ID');
    return this.database.transaction(async (transaction) => {
      await lockMutex(transaction);
      const result = await transaction.query<IntentRow>(
        `SELECT id, action, revision_id, slug, exact_document_sha256, request_sha256,
                authorized_by_person_id, authorized_at
         FROM governed_content_publication_intents WHERE id = $1 FOR UPDATE`,
        [input.intentId],
      );
      const intent = result.rows[0];
      if (intent === undefined)
        throw new DomainError('not_found', 'Publication intent was not found');
      const completed = await transaction.query<Record<string, unknown>>(
        'SELECT id FROM governed_content_publication_events WHERE intent_id = $1',
        [intent.id],
      );
      if (completed.rows[0] !== undefined) {
        return {
          revisionId: intent.revision_id,
          documentDigest: intent.exact_document_sha256,
          action: intent.action,
          replay: true,
        };
      }
      await this.employee(transaction, intent.authorized_by_person_id, true);
      const row = await this.revision(transaction, intent.revision_id);
      if (
        row.document_sha256 !== intent.exact_document_sha256 ||
        row.slug !== intent.slug ||
        asDate(row.expires_at, 'content revision expiry') <= input.now
      ) {
        throw new DomainError('conflict', 'Authorized publication intent is no longer valid');
      }
      let publicFields: readonly unknown[];
      if (intent.action === 'publish') {
        const metadata = await this.metadata(transaction, row, input.now);
        if (!metadata.publicationEligible) {
          throw new DomainError(
            'invalid_transition',
            `Publication blocked: ${metadata.blockers.join(', ')}`,
          );
        }
        const source = await this.fact(
          transaction,
          { key: row.source_brief_key, version: row.source_brief_version },
          input.now,
        );
        if (source.fact.sourceDigest !== row.source_claim_digest) {
          throw new DomainError('conflict', 'Authorized source digest no longer matches');
        }
        const document = this.decryptDocument(row);
        publicFields = [
          document.title,
          document.summary,
          document.body,
          source.fact.sourceTitle,
          source.fact.sourceUrl,
          source.fact.sourcePublishedAt.toISOString(),
          source.fact.reviewedAt.toISOString(),
        ];
      } else {
        publicFields = [null, null, null, null, null, null, null];
      }
      const nextSequence = await transaction.query<{ sequence: number } & Record<string, unknown>>(
        `SELECT (coalesce(max(sequence), 0) + 1)::integer AS sequence
         FROM governed_content_publication_events WHERE slug = $1`,
        [row.slug],
      );
      await transaction.query(
        `INSERT INTO governed_content_publication_events(
           id, intent_id, sequence, action, revision_id, slug, exact_document_sha256,
           title, summary, body, source_title, source_url, source_published_at,
           reviewed_at, expires_at, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          this.ids.next('content_publication'),
          intent.id,
          nextSequence.rows[0]?.sequence ?? 1,
          intent.action,
          row.id,
          row.slug,
          row.document_sha256,
          ...publicFields,
          row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at),
          input.now.toISOString(),
        ],
      );
      return {
        revisionId: row.id,
        documentDigest: row.document_sha256,
        action: intent.action,
        replay: false,
      };
    });
  }

  async publicArticles(now: Date): Promise<readonly PublicLearnArticleSummaryView[]> {
    const result = await this.database.query<
      {
        slug: string;
        title: string;
        summary: string;
        exact_document_sha256: string;
        occurred_at: unknown;
        expires_at: unknown;
        source_title: string;
        source_url: string;
        source_published_at: unknown;
        reviewed_at: unknown;
      } & Record<string, unknown>
    >(
      `SELECT latest.slug, latest.title, latest.summary,
              latest.exact_document_sha256, latest.occurred_at, latest.expires_at,
              latest.source_title, latest.source_url, latest.source_published_at, latest.reviewed_at
       FROM (
         SELECT DISTINCT ON (slug) * FROM governed_content_publication_events
         ORDER BY slug, sequence DESC
       ) latest
       WHERE latest.action = 'publish' AND latest.expires_at > $1
       ORDER BY latest.occurred_at DESC, latest.slug LIMIT 200`,
      [now.toISOString()],
    );
    return result.rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      documentDigest: row.exact_document_sha256,
      publishedAt: asDate(row.occurred_at, 'public content publication'),
      expiresAt: asDate(row.expires_at, 'public content expiry'),
      source: {
        title: row.source_title,
        url: row.source_url,
        publishedAt: asDate(row.source_published_at, 'public source publication'),
        reviewedAt: asDate(row.reviewed_at, 'public source review'),
      },
    }));
  }

  async publicArticle(slug: string, now: Date): Promise<PublicLearnArticleView> {
    const normalizedSlug = assertGovernedContentSlug(slug);
    const result = await this.database.query<
      {
        action: 'publish' | 'unpublish' | 'retract';
        slug: string;
        title: string | null;
        summary: string | null;
        body: string | null;
        exact_document_sha256: string;
        occurred_at: unknown;
        expires_at: unknown;
        source_title: string | null;
        source_url: string | null;
        source_published_at: unknown | null;
        reviewed_at: unknown | null;
      } & Record<string, unknown>
    >(
      `SELECT action, slug, title, summary, body, exact_document_sha256, occurred_at,
              expires_at, source_title, source_url, source_published_at, reviewed_at
       FROM governed_content_publication_events
       WHERE slug = $1 ORDER BY sequence DESC LIMIT 1`,
      [normalizedSlug],
    );
    const row = result.rows[0];
    if (
      row === undefined ||
      row.action !== 'publish' ||
      asDate(row.expires_at, 'public content expiry') <= now ||
      row.title === null ||
      row.summary === null ||
      row.body === null ||
      row.source_title === null ||
      row.source_url === null ||
      row.source_published_at === null ||
      row.reviewed_at === null
    ) {
      throw new DomainError('not_found', 'Learn article was not found');
    }
    return {
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      body: row.body,
      documentDigest: row.exact_document_sha256,
      publishedAt: asDate(row.occurred_at, 'public content publication'),
      expiresAt: asDate(row.expires_at, 'public content expiry'),
      source: {
        title: row.source_title,
        url: row.source_url,
        publishedAt: asDate(row.source_published_at, 'public source publication'),
        reviewedAt: asDate(row.reviewed_at, 'public source review'),
      },
    };
  }
}
