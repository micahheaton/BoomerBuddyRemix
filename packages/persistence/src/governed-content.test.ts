import { createSeededTestDatabase } from '@boomerbuddy/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database } from './database';
import { GovernedContentRepository } from './governed-content';
import type { IdFactory } from './values';

const now = new Date('2026-08-28T12:00:00.000Z');
const owner = 'person-hq-heidi';
const reviewer = 'person-hq-riley';

function sequentialIds(): IdFactory {
  let sequence = 0;
  return { next: (prefix) => `${prefix}_governed_test_${++sequence}` };
}

function repository(database: Database): GovernedContentRepository {
  return new GovernedContentRepository(
    database,
    { encryptionKey: Buffer.alloc(32, 43), encryptionKeyVersion: 1 },
    sequentialIds(),
  );
}

describe('governed first-party content repository', () => {
  let database: Database | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it('generates encrypted drafts without publication and publishes only an exact approved revision', async () => {
    database = await createSeededTestDatabase(now);
    const content = repository(database);
    const candidates = await database.query<
      { count: number; approved_count: number; fetched_count: number } & Record<string, unknown>
    >(
      `SELECT count(*)::integer AS count,
              count(*) FILTER (WHERE claim_import_permitted)::integer AS approved_count,
              count(*) FILTER (WHERE external_fetch_performed)::integer AS fetched_count
       FROM governed_content_source_candidates`,
    );
    expect(candidates.rows[0]).toEqual({ count: 8, approved_count: 0, fetched_count: 0 });
    const generated = await content.generateDailyDrafts({
      scheduleDate: '2026-08-28',
      now,
      limit: 1,
    });
    expect(generated).toHaveLength(1);
    const revisionId = generated[0] as string;
    const evidence = await database.query<
      {
        encrypted_document: string;
        customer_data_accessed: boolean;
        external_fetch_performed: boolean;
        provider_action_performed: boolean;
        publication_performed: boolean;
      } & Record<string, unknown>
    >(
      `SELECT revision.encrypted_document, run.customer_data_accessed,
              run.external_fetch_performed, run.provider_action_performed, run.publication_performed
       FROM governed_content_revisions revision
       JOIN governed_content_generation_runs run ON run.resulting_revision_id = revision.id
       WHERE revision.id = $1`,
      [revisionId],
    );
    expect(evidence.rows[0]).toMatchObject({
      customer_data_accessed: false,
      external_fetch_performed: false,
      provider_action_performed: false,
      publication_performed: false,
    });
    expect(evidence.rows[0]?.encrypted_document).not.toContain('Pause before');
    await expect(content.publicArticles(now)).resolves.toEqual([]);

    const ownerDraft = await content.readDraft({
      revisionId,
      actorPersonId: owner,
      correlationId: 'correlation-governed-owner-read',
      now,
    });
    const board = await content.board({
      actorPersonId: owner,
      correlationId: 'correlation-governed-slug-board',
      now,
    });
    const otherSource = board.facts.find((fact) => fact.sourceId !== ownerDraft.sourceId);
    expect(otherSource).toBeDefined();
    await expect(
      content.createDraft({
        sourceId: otherSource?.sourceId ?? '',
        slug: ownerDraft.slug,
        title: 'A separate reviewed article',
        summary: 'This distinct source cannot take over an existing public article address.',
        body: 'Pause and verify the request through a contact method you already trust.',
        actorPersonId: owner,
        correlationId: 'correlation-governed-slug-conflict',
        now,
      }),
    ).rejects.toThrow('belongs to another article');
    await expect(
      content.readDraft({
        revisionId,
        actorPersonId: reviewer,
        correlationId: 'correlation-governed-unassigned-read',
        now,
      }),
    ).rejects.toThrow('exact review assignment');

    for (const role of ['skeptical', 'accessibility', 'privacy_rights'] as const) {
      await content.assignReview({
        revisionId,
        reviewRole: role,
        expectedDocumentDigest: ownerDraft.documentDigest,
        actorPersonId: reviewer,
        correlationId: `correlation-governed-assign-${role}`,
        now,
      });
      await content.review({
        revisionId,
        reviewRole: role,
        decision: 'approve',
        reason: `Approved exact ${role} review.`,
        expectedDocumentDigest: ownerDraft.documentDigest,
        actorPersonId: reviewer,
        correlationId: `correlation-governed-review-${role}`,
        now,
      });
    }
    await content.assignReview({
      revisionId,
      reviewRole: 'final_human',
      expectedDocumentDigest: ownerDraft.documentDigest,
      actorPersonId: owner,
      correlationId: 'correlation-governed-assign-final',
      now,
    });
    await content.review({
      revisionId,
      reviewRole: 'final_human',
      decision: 'approve',
      reason: 'Approved exact final human review.',
      expectedDocumentDigest: ownerDraft.documentDigest,
      actorPersonId: owner,
      correlationId: 'correlation-governed-review-final',
      now,
    });
    const approved = await content.readDraft({
      revisionId,
      actorPersonId: owner,
      correlationId: 'correlation-governed-approved-read',
      now,
    });
    expect(approved.publicationEligible).toBe(true);

    const authorization = await content.authorizePublication({
      revisionId,
      action: 'publish',
      expectedDocumentDigest: approved.documentDigest,
      idempotencyKey: 'governed-content:publish:10000000-0000-4000-8000-000000000001',
      actorPersonId: owner,
      correlationId: 'correlation-governed-publish',
      now,
    });
    await database.query(
      "UPDATE employee_assignments SET status = 'suspended' WHERE person_id = $1 AND role = 'hq_owner'",
      [owner],
    );
    await expect(
      content.reconcilePublicationIntent({
        intentId: authorization.intentId,
        now,
      }),
    ).rejects.toThrow('active HQ owner');
    await database.query(
      "UPDATE employee_assignments SET status = 'active' WHERE person_id = $1 AND role = 'hq_owner'",
      [owner],
    );
    const reconciled = await content.reconcilePublicationIntent({
      intentId: authorization.intentId,
      now,
    });
    expect(reconciled).toMatchObject({ action: 'publish', replay: false });
    const article = await content.publicArticle(approved.slug, now);
    expect(article).toMatchObject({
      slug: approved.slug,
      documentDigest: approved.documentDigest,
      title: approved.document.title,
    });
    expect(article.body).toBe(approved.document.body);
    await expect(
      content.publicArticle(approved.slug, new Date(approved.expiresAt.getTime() + 1)),
    ).rejects.toThrow('not found');
    await expect(
      content.reconcilePublicationIntent({ intentId: authorization.intentId, now }),
    ).resolves.toMatchObject({ replay: true });
    await expect(
      content.authorizePublication({
        revisionId,
        action: 'retract',
        expectedDocumentDigest: approved.documentDigest,
        idempotencyKey: 'governed-content:publish:10000000-0000-4000-8000-000000000001',
        actorPersonId: owner,
        correlationId: 'correlation-governed-key-reuse',
        now,
      }),
    ).rejects.toThrow('reused');
    const removal = await content.authorizePublication({
      revisionId,
      action: 'unpublish',
      expectedDocumentDigest: approved.documentDigest,
      idempotencyKey: 'governed-content:unpublish:10000000-0000-4000-8000-000000000003',
      actorPersonId: owner,
      correlationId: 'correlation-governed-unpublish',
      now: new Date(now.getTime() + 1_000),
    });
    await content.reconcilePublicationIntent({
      intentId: removal.intentId,
      now: new Date(now.getTime() + 1_000),
    });
    await expect(
      content.publicArticle(approved.slug, new Date(now.getTime() + 1_000)),
    ).rejects.toThrow('not found');
    const republish = await content.authorizePublication({
      revisionId,
      action: 'publish',
      expectedDocumentDigest: approved.documentDigest,
      idempotencyKey: 'governed-content:publish:10000000-0000-4000-8000-000000000004',
      actorPersonId: owner,
      correlationId: 'correlation-governed-republish',
      now: new Date(now.getTime() + 2_000),
    });
    await content.reconcilePublicationIntent({
      intentId: republish.intentId,
      now: new Date(now.getTime() + 2_000),
    });
    const retraction = await content.authorizePublication({
      revisionId,
      action: 'retract',
      expectedDocumentDigest: approved.documentDigest,
      idempotencyKey: 'governed-content:retract:10000000-0000-4000-8000-000000000005',
      actorPersonId: owner,
      correlationId: 'correlation-governed-retract',
      now: new Date(now.getTime() + 3_000),
    });
    await content.reconcilePublicationIntent({
      intentId: retraction.intentId,
      now: new Date(now.getTime() + 3_000),
    });
    await expect(
      content.publicArticle(approved.slug, new Date(now.getTime() + 3_000)),
    ).rejects.toThrow('not found');
  });

  it('keeps corrections as new revisions and uses append-only unpublish events', async () => {
    database = await createSeededTestDatabase(now);
    const content = repository(database);
    const [revisionId] = await content.generateDailyDrafts({
      scheduleDate: '2026-08-28',
      now,
      limit: 1,
    });
    const original = await content.readDraft({
      revisionId: revisionId as string,
      actorPersonId: owner,
      correlationId: 'correlation-governed-correction-read',
      now,
    });
    const correction = await content.reviseDraft({
      revisionId: original.revisionId,
      expectedDocumentDigest: original.documentDigest,
      slug: original.slug,
      title: `${original.document.title} - corrected`,
      summary: original.document.summary,
      body: `${original.document.body}\n\nCorrection: wording clarified before publication.`,
      correction: true,
      actorPersonId: owner,
      correlationId: 'correlation-governed-correction-create',
      now,
    });
    const corrected = await content.readDraft({
      revisionId: correction.revisionId,
      actorPersonId: owner,
      correlationId: 'correlation-governed-correction-open',
      now,
    });
    expect(corrected).toMatchObject({
      version: original.version + 1,
      previousRevisionId: original.revisionId,
      revisionKind: 'correction',
      publicationEligible: false,
    });
    expect(corrected.documentDigest).not.toBe(original.documentDigest);
    await expect(
      content.reviseDraft({
        revisionId: corrected.revisionId,
        expectedDocumentDigest: corrected.documentDigest,
        slug: 'moved-correction-address',
        title: corrected.document.title,
        summary: corrected.document.summary,
        body: corrected.document.body,
        correction: true,
        actorPersonId: owner,
        correlationId: 'correlation-governed-slug-change',
        now,
      }),
    ).rejects.toThrow('slug is immutable');
    await expect(
      database.query(
        `INSERT INTO governed_content_revisions(
           id, content_key, version, previous_revision_id, revision_kind,
           source_brief_key, source_brief_version, source_claim_digest, slug,
           document_sha256, encrypted_document, encryption_key_version,
           created_by_person_id, created_by_service, expires_at, created_at
         )
         SELECT 'content_revision_lineage_attack', content_key, version + 1, id, 'correction',
                source_brief_key, source_brief_version, source_claim_digest, 'moved-correction-address',
                document_sha256, encrypted_document, encryption_key_version,
                created_by_person_id, created_by_service, expires_at, created_at
         FROM governed_content_revisions WHERE id = $1`,
        [corrected.revisionId],
      ),
    ).rejects.toThrow('slug is immutable');
    await expect(
      content.authorizePublication({
        revisionId: corrected.revisionId,
        action: 'publish',
        expectedDocumentDigest: corrected.documentDigest,
        idempotencyKey: 'governed-content:publish:10000000-0000-4000-8000-000000000002',
        actorPersonId: owner,
        correlationId: 'correlation-governed-unreviewed-correction',
        now,
      }),
    ).rejects.toThrow('Publication blocked');
    await expect(
      database.query('UPDATE governed_content_revisions SET slug = $1 WHERE id = $2', [
        'mutated',
        corrected.revisionId,
      ]),
    ).rejects.toThrow('immutable');
  });

  it('rejects customer identifiers and secrets from human-authored drafts', async () => {
    database = await createSeededTestDatabase(now);
    const content = repository(database);
    const board = await content.board({
      actorPersonId: owner,
      correlationId: 'correlation-governed-board',
      now,
    });
    await expect(
      content.createDraft({
        sourceId: board.facts[0]?.sourceId ?? '',
        slug: 'safe-looking-title',
        title: 'Call this person',
        summary: 'Send the private account information to the reviewer.',
        body: 'The customer email is member@example.com and the code is 102345.',
        actorPersonId: owner,
        correlationId: 'correlation-governed-pii-reject',
        now,
      }),
    ).rejects.toThrow('restricted or personal data');
  });
});
