import { createHash } from 'node:crypto';
import { DomainError } from '@boomerbuddy/domain';
import type { Database } from './database';
import { asDate, jsonParameter, jsonValue, randomIdFactory, type IdFactory } from './values';

export interface KnowledgeContent {
  readonly title: string;
  readonly summary: string;
  readonly defensiveActions: readonly string[];
}

export interface KnowledgeReviewInput {
  readonly reviewerReference: string;
  readonly reviewKind: 'source' | 'domain' | 'editorial' | 'rights';
  readonly decision: 'approve' | 'changes_requested' | 'reject';
  readonly notes: string;
  readonly reviewedAt: Date;
}

export interface StoredKnowledgeAsset {
  readonly id: string;
  readonly assetKey: string;
  readonly version: number;
  readonly locale: string;
  readonly jurisdiction: string;
  readonly lifecycle: 'draft' | 'active' | 'retired';
  readonly reviewState: 'authored' | 'source_verified' | 'independently_reviewed';
  readonly sourcePublisher: string;
  readonly sourceUrl: string;
  readonly sourceRetrievedAt: Date;
  readonly rightsBasis: string;
  readonly authoringVersion: string;
  readonly content: KnowledgeContent;
  readonly contentSha256: string;
  readonly createdAt: Date;
}

interface KnowledgeRow extends Record<string, unknown> {
  readonly id: string;
  readonly asset_key: string;
  readonly version: number;
  readonly locale: string;
  readonly jurisdiction: string;
  readonly lifecycle: StoredKnowledgeAsset['lifecycle'];
  readonly review_state: StoredKnowledgeAsset['reviewState'];
  readonly source_publisher: string;
  readonly source_url: string;
  readonly source_retrieved_at: unknown;
  readonly rights_basis: string;
  readonly authoring_version: string;
  readonly content: unknown;
  readonly content_sha256: string;
  readonly created_at: unknown;
}

function normalizedContent(content: KnowledgeContent): KnowledgeContent {
  const value = {
    title: content.title.trim(),
    summary: content.summary.trim(),
    defensiveActions: content.defensiveActions.map((action) => action.trim()),
  };
  if (
    value.title.length < 1 ||
    value.title.length > 160 ||
    value.summary.length < 1 ||
    value.summary.length > 1_000 ||
    value.defensiveActions.length < 1 ||
    value.defensiveActions.length > 10 ||
    value.defensiveActions.some((action) => action.length < 1 || action.length > 300)
  ) {
    throw new DomainError('invalid_input', 'Knowledge content is outside governed bounds');
  }
  return value;
}

function contentSerialization(content: KnowledgeContent): string {
  return JSON.stringify({
    title: content.title,
    summary: content.summary,
    defensiveActions: [...content.defensiveActions],
  });
}

function contentHash(content: KnowledgeContent): string {
  return `sha256:${createHash('sha256').update(contentSerialization(content)).digest('hex')}`;
}

function mapAsset(row: KnowledgeRow): StoredKnowledgeAsset {
  const parsed = jsonValue(row.content);
  if (typeof parsed !== 'object' || parsed === null)
    throw new TypeError('Invalid knowledge content');
  const content = parsed as Partial<KnowledgeContent>;
  if (
    typeof content.title !== 'string' ||
    typeof content.summary !== 'string' ||
    !Array.isArray(content.defensiveActions) ||
    content.defensiveActions.some((action) => typeof action !== 'string')
  ) {
    throw new TypeError('Invalid knowledge content');
  }
  const normalized = normalizedContent(content as KnowledgeContent);
  if (row.content_sha256 !== contentHash(normalized)) {
    throw new TypeError('Knowledge content checksum mismatch');
  }
  return {
    id: row.id,
    assetKey: row.asset_key,
    version: row.version,
    locale: row.locale,
    jurisdiction: row.jurisdiction,
    lifecycle: row.lifecycle,
    reviewState: row.review_state,
    sourcePublisher: row.source_publisher,
    sourceUrl: row.source_url,
    sourceRetrievedAt: asDate(row.source_retrieved_at, 'knowledge source retrieval'),
    rightsBasis: row.rights_basis,
    authoringVersion: row.authoring_version,
    content: normalized,
    contentSha256: row.content_sha256,
    createdAt: asDate(row.created_at, 'knowledge creation'),
  };
}

function validateActiveReviews(reviews: readonly KnowledgeReviewInput[]): void {
  const approvals = reviews.filter((review) => review.decision === 'approve');
  const kinds = new Set(approvals.map((review) => review.reviewKind));
  const reviewers = new Set(approvals.map((review) => review.reviewerReference));
  if (!kinds.has('source') || !kinds.has('domain') || !kinds.has('rights') || reviewers.size < 2) {
    throw new DomainError(
      'invalid_input',
      'Active knowledge requires source, domain, and rights approvals from independent reviewers',
    );
  }
}

export class KnowledgeRepository {
  constructor(
    private readonly database: Database,
    private readonly idFactory: IdFactory = randomIdFactory,
  ) {}

  async createVersion(input: {
    readonly assetKey: string;
    readonly version: number;
    readonly locale: string;
    readonly jurisdiction: string;
    readonly lifecycle: StoredKnowledgeAsset['lifecycle'];
    readonly reviewState: StoredKnowledgeAsset['reviewState'];
    readonly sourcePublisher: string;
    readonly sourceUrl: string;
    readonly sourceRetrievedAt: Date;
    readonly rightsBasis: string;
    readonly authoringVersion: string;
    readonly content: KnowledgeContent;
    readonly reviews?: readonly KnowledgeReviewInput[];
    readonly now: Date;
  }): Promise<StoredKnowledgeAsset> {
    if (
      !/^knowledge_[a-z0-9_]+$/u.test(input.assetKey) ||
      !Number.isSafeInteger(input.version) ||
      input.version < 1
    ) {
      throw new DomainError('invalid_input', 'Knowledge asset identity is invalid');
    }
    let source: URL;
    try {
      source = new URL(input.sourceUrl);
    } catch {
      throw new DomainError('invalid_input', 'Knowledge source URL is invalid');
    }
    if (source.protocol !== 'https:') {
      throw new DomainError('invalid_input', 'Knowledge source must use HTTPS');
    }
    const reviews = input.reviews ?? [];
    if (input.lifecycle === 'active') {
      if (input.reviewState !== 'independently_reviewed') {
        throw new DomainError('invalid_input', 'Active knowledge must be independently reviewed');
      }
      validateActiveReviews(reviews);
    }
    const content = normalizedContent(input.content);
    const id = this.idFactory.next('knowledge_asset');
    const hash = contentHash(content);
    await this.database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO knowledge_assets(
           id, asset_key, version, locale, jurisdiction, lifecycle, review_state,
           source_publisher, source_url, source_retrieved_at, rights_basis, authoring_version,
           v1_runtime_import, content, content_sha256, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13::jsonb,$14,$15)`,
        [
          id,
          input.assetKey,
          input.version,
          input.locale,
          input.jurisdiction,
          input.lifecycle,
          input.reviewState,
          input.sourcePublisher,
          source.toString(),
          input.sourceRetrievedAt.toISOString(),
          input.rightsBasis,
          input.authoringVersion,
          jsonParameter(content),
          hash,
          input.now.toISOString(),
        ],
      );
      for (const review of reviews) {
        await transaction.query(
          `INSERT INTO knowledge_asset_reviews(
             id, knowledge_asset_id, reviewer_reference, review_kind, decision, notes, reviewed_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            this.idFactory.next('knowledge_review'),
            id,
            review.reviewerReference,
            review.reviewKind,
            review.decision,
            review.notes,
            review.reviewedAt.toISOString(),
          ],
        );
      }
    });
    return {
      id,
      assetKey: input.assetKey,
      version: input.version,
      locale: input.locale,
      jurisdiction: input.jurisdiction,
      lifecycle: input.lifecycle,
      reviewState: input.reviewState,
      sourcePublisher: input.sourcePublisher,
      sourceUrl: source.toString(),
      sourceRetrievedAt: input.sourceRetrievedAt,
      rightsBasis: input.rightsBasis,
      authoringVersion: input.authoringVersion,
      content,
      contentSha256: hash,
      createdAt: input.now,
    };
  }

  async recordReview(knowledgeAssetId: string, review: KnowledgeReviewInput): Promise<string> {
    const id = this.idFactory.next('knowledge_review');
    await this.database.query(
      `INSERT INTO knowledge_asset_reviews(
         id, knowledge_asset_id, reviewer_reference, review_kind, decision, notes, reviewed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        knowledgeAssetId,
        review.reviewerReference,
        review.reviewKind,
        review.decision,
        review.notes,
        review.reviewedAt.toISOString(),
      ],
    );
    return id;
  }

  async listRuntimeEligible(input: {
    readonly locale: string;
    readonly jurisdiction: string;
    readonly limit?: number;
  }): Promise<readonly StoredKnowledgeAsset[]> {
    const result = await this.database.query<KnowledgeRow>(
      `SELECT k.* FROM knowledge_assets k
       WHERE k.locale = $1 AND k.jurisdiction = $2
         AND k.lifecycle = 'active' AND k.review_state = 'independently_reviewed'
         AND k.v1_runtime_import = false
         AND EXISTS (
           SELECT 1 FROM knowledge_asset_reviews r
           WHERE r.knowledge_asset_id = k.id AND r.review_kind = 'source'
             AND r.decision = 'approve'
         )
         AND EXISTS (
           SELECT 1 FROM knowledge_asset_reviews r
           WHERE r.knowledge_asset_id = k.id AND r.review_kind = 'domain'
             AND r.decision = 'approve'
         )
         AND EXISTS (
           SELECT 1 FROM knowledge_asset_reviews r
           WHERE r.knowledge_asset_id = k.id AND r.review_kind = 'rights'
             AND r.decision = 'approve'
         )
         AND (
           SELECT count(DISTINCT r.reviewer_reference)
           FROM knowledge_asset_reviews r
           WHERE r.knowledge_asset_id = k.id AND r.decision = 'approve'
         ) >= 2
       ORDER BY k.asset_key, k.version DESC
       LIMIT $3`,
      [input.locale, input.jurisdiction, Math.max(1, Math.min(input.limit ?? 50, 100))],
    );
    const latest = new Map<string, StoredKnowledgeAsset>();
    for (const row of result.rows) {
      if (!latest.has(row.asset_key)) latest.set(row.asset_key, mapAsset(row));
    }
    return [...latest.values()];
  }

  async listAllVersions(assetKey: string): Promise<readonly StoredKnowledgeAsset[]> {
    const result = await this.database.query<KnowledgeRow>(
      `SELECT * FROM knowledge_assets WHERE asset_key = $1 ORDER BY version DESC`,
      [assetKey],
    );
    return result.rows.map(mapAsset);
  }
}
