import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSeededTestDatabase } from '@boomerbuddy/testkit';

import type { Database } from './database';
import {
  EditorialIntelligenceRepository,
  editorialReviewRoles,
  type EditorialProductKind,
  type EditorialReviewRole,
} from './editorial-intelligence';
import type { IdFactory } from './values';

const now = new Date('2026-08-17T12:00:00.000Z');
const founderPersonId = 'person-hq-heidi';
const reviewerPersonId = 'person-hq-riley';
const founderEmployeeId = 'employee-hq-heidi';
const reviewerEmployeeId = 'employee-hq-riley';
const safeDraft =
  'Pause and verify an unexpected request through a contact method you already trust.';

function afterDays(days: number): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sequentialIds(): IdFactory {
  let sequence = 0;
  return { next: (prefix) => `${prefix}_editorial_test_${++sequence}` };
}

function repositoryFor(database: Database): EditorialIntelligenceRepository {
  return new EditorialIntelligenceRepository(
    database,
    {
      encryptionKey: Buffer.alloc(32, 29),
      encryptionKeyVersion: 1,
      founderPersonId,
    },
    sequentialIds(),
    async (_transaction, observedAt) => new Date(observedAt),
  );
}

async function approvedSource(
  repository: EditorialIntelligenceRepository,
  suffix: string,
  overrides: {
    readonly jurisdiction?: string;
    readonly locale?: string;
    readonly intendedProducts?: readonly EditorialProductKind[];
    readonly reviewDueAt?: Date;
    readonly expiresAt?: Date;
  } = {},
): Promise<string> {
  const sourceVersionId = await repository.createSourceVersion({
    actorPersonId: founderPersonId,
    correlationId: `correlation:source:${suffix}`,
    sourceKey: `source_${suffix}`,
    version: 1,
    publisherKey: `publisher.${suffix}`,
    originHost: `${suffix}.example.gov`,
    pathPrefix: `/${suffix}`,
    sourceClass: 'government',
    jurisdiction: overrides.jurisdiction ?? 'US',
    locale: overrides.locale ?? 'en-US',
    intendedProducts: overrides.intendedProducts ?? ['urgent_alert', 'daily_tip'],
    authorityReasonCode: 'official.local.fixture',
    retentionPolicyVersion: 'editorial.local.v1',
    effectiveAt: now,
    reviewDueAt: overrides.reviewDueAt ?? afterDays(7),
    expiresAt: overrides.expiresAt ?? afterDays(30),
    now,
  });
  for (const role of ['primary_source', 'domain', 'rights', 'security'] as const) {
    await repository.reviewSource({
      sourceVersionId,
      actorPersonId: reviewerPersonId,
      role,
      decision: 'approve',
      reasonCode: 'reviewed.local.fixture',
      correlationId: `correlation:source:${suffix}:${role}`,
      now,
    });
  }
  await repository.reviewSource({
    sourceVersionId,
    actorPersonId: founderPersonId,
    role: 'final_source',
    decision: 'approve',
    reasonCode: 'owner.local.approval',
    correlationId: `correlation:source:${suffix}:final`,
    now,
  });
  return sourceVersionId;
}

async function evidenceFixture(
  repository: EditorialIntelligenceRepository,
  suffix: string,
  overrides: {
    readonly source?: Parameters<typeof approvedSource>[2];
    readonly artifactExpiresAt?: Date;
    readonly claimJurisdiction?: string;
    readonly claimValidFrom?: Date;
    readonly claimValidThrough?: Date;
    readonly claimExpiresAt?: Date;
  } = {},
): Promise<{
  readonly sourceVersionId: string;
  readonly artifactId: string;
  readonly claimId: string;
}> {
  const sourceVersionId = await approvedSource(repository, suffix, overrides.source);
  const artifactId = await repository.recordLocalArtifact({
    sourceVersionId,
    artifactKey: `artifact_${suffix}`,
    locatorSha256: sha256(`locator:${suffix}`),
    contentSha256: sha256(`content:${suffix}`),
    sourcePublishedAt: afterDays(-1),
    expiresAt: overrides.artifactExpiresAt ?? afterDays(14),
    actorPersonId: reviewerPersonId,
    correlationId: `correlation:artifact:${suffix}`,
    now,
  });
  const claimId = await repository.recordClaim({
    claimKey: `claim_${suffix}`,
    version: 1,
    artifactReceiptId: artifactId,
    artifactSpanSha256: sha256(`span:${suffix}`),
    subjectCode: 'unexpected.request',
    predicateCode: 'requires.independent.verification',
    scopeCode: 'consumer.safety',
    jurisdiction: overrides.claimJurisdiction ?? overrides.source?.jurisdiction ?? 'US',
    uncertainty: 'strong',
    validFrom: overrides.claimValidFrom ?? now,
    validThrough: overrides.claimValidThrough ?? afterDays(7),
    expiresAt: overrides.claimExpiresAt ?? afterDays(7),
    actorPersonId: reviewerPersonId,
    correlationId: `correlation:claim:${suffix}`,
    now,
  });
  return { sourceVersionId, artifactId, claimId };
}

async function draftFixture(
  repository: EditorialIntelligenceRepository,
  suffix: string,
  version = 1,
): Promise<string> {
  const evidence = await evidenceFixture(repository, `${suffix}${version}`);
  return repository.createDraft({
    contentKey: `content_${suffix}`,
    version,
    productKind: 'urgent_alert',
    audience: 'customer',
    locale: 'en-US',
    jurisdiction: 'US',
    urgency: 'time_sensitive',
    draftText: `${safeDraft} Fixture ${suffix} version ${version}.`,
    unsupportedStatistics: false,
    unverifiedUrgency: false,
    expiresAt: afterDays(5),
    sourceVersionIds: [evidence.sourceVersionId],
    claimVersionIds: [evidence.claimId],
    actorPersonId: founderPersonId,
    correlationId: `correlation:draft:${suffix}:${version}`,
    now,
  });
}

async function assign(
  repository: EditorialIntelligenceRepository,
  contentVersionId: string,
  role: EditorialReviewRole,
): Promise<void> {
  await repository.assignReview({
    contentVersionId,
    role,
    reviewerEmployeeAssignmentId: role === 'final_human' ? founderEmployeeId : reviewerEmployeeId,
    actorPersonId: founderPersonId,
    reasonCode: 'owner.review.assignment',
    correlationId: `correlation:assignment:${role}`,
    now,
  });
}

async function approveDraft(
  repository: EditorialIntelligenceRepository,
  contentVersionId: string,
): Promise<void> {
  for (const role of editorialReviewRoles) await assign(repository, contentVersionId, role);
  await repository.transitionContent({
    contentVersionId,
    toState: 'under_review',
    actorPersonId: reviewerPersonId,
    reasonCode: 'assigned.review.started',
    correlationId: `correlation:approval:start:${contentVersionId}`,
    now,
  });
  for (const role of editorialReviewRoles.filter((candidate) => candidate !== 'final_human')) {
    await repository.reviewDraft({
      contentVersionId,
      role,
      decision: 'approve',
      actorPersonId: reviewerPersonId,
      reasonCode: 'review.role.approved',
      correlationId: `correlation:approval:${contentVersionId}:${role}`,
      now,
    });
  }
  await repository.reviewDraft({
    contentVersionId,
    role: 'final_human',
    decision: 'approve',
    actorPersonId: founderPersonId,
    reasonCode: 'owner.final.approved',
    correlationId: `correlation:approval:${contentVersionId}:final`,
    now,
  });
}

describe('editorial intelligence persistence', () => {
  let database: Database;
  let repository: EditorialIntelligenceRepository;
  let dateNowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(now.getTime());
    database = await createSeededTestDatabase(now);
    repository = repositoryFor(database);
  });

  afterEach(async () => {
    await database.close();
    dateNowSpy.mockRestore();
  });

  it('runs exact-assignment review to internal approval without any external action', async () => {
    const contentVersionId = await draftFixture(repository, 'reviewed');
    for (const role of editorialReviewRoles) await assign(repository, contentVersionId, role);
    await repository.transitionContent({
      contentVersionId,
      toState: 'under_review',
      actorPersonId: reviewerPersonId,
      reasonCode: 'assigned.review.started',
      correlationId: 'correlation:review:start',
      now,
    });

    const reviewerBoard = await repository.board({
      actorPersonId: reviewerPersonId,
      correlationId: 'correlation:board:reviewer',
      now,
    });
    expect(reviewerBoard.sources).toEqual([]);
    expect(reviewerBoard.stories).toEqual([]);
    expect(reviewerBoard.content).toHaveLength(6);
    expect(JSON.stringify(reviewerBoard)).not.toContain(safeDraft);

    await expect(
      repository.readAssignedDraft({
        contentVersionId,
        actorPersonId: reviewerPersonId,
        correlationId: 'correlation:draft:read',
        now,
      }),
    ).resolves.toMatchObject({
      draftText: `${safeDraft} Fixture reviewed version 1.`,
      evidenceTier: 'local_simulation',
      providerProcessed: false,
      publicationEligible: false,
      externalActionExecuted: false,
    });

    for (const role of editorialReviewRoles.filter((candidate) => candidate !== 'final_human')) {
      await repository.reviewDraft({
        contentVersionId,
        role,
        decision: 'approve',
        actorPersonId: reviewerPersonId,
        reasonCode: 'review.role.approved',
        correlationId: `correlation:review:${role}`,
        now,
      });
    }
    await repository.reviewDraft({
      contentVersionId,
      role: 'final_human',
      decision: 'approve',
      actorPersonId: founderPersonId,
      reasonCode: 'owner.final.approved',
      correlationId: 'correlation:review:final',
      now,
    });

    const facts = await database.query<
      {
        state: string;
        provider_processed: boolean;
        publication_enabled: boolean;
        outbound_delivery_enabled: boolean;
        external_action_executed: boolean;
        editorial_jobs: number;
        editorial_outbox: number;
      } & Record<string, unknown>
    >(
      `SELECT state.to_state AS state, content.provider_processed,
              content.publication_enabled, content.outbound_delivery_enabled,
              content.external_action_executed,
              (SELECT count(*)::int FROM durable_jobs WHERE job_type LIKE 'editorial.%') AS editorial_jobs,
              (SELECT count(*)::int FROM outbox_events WHERE event_type LIKE 'editorial.%') AS editorial_outbox
       FROM editorial_content_versions content
       JOIN LATERAL (
         SELECT to_state FROM editorial_content_state_events
         WHERE content_version_id = content.id ORDER BY sequence DESC LIMIT 1
       ) state ON true
       WHERE content.id = $1`,
      [contentVersionId],
    );
    expect(facts.rows[0]).toEqual({
      state: 'approved_internal',
      provider_processed: false,
      publication_enabled: false,
      outbound_delivery_enabled: false,
      external_action_executed: false,
      editorial_jobs: 0,
      editorial_outbox: 0,
    });
    const audits = await database.query<{ metadata_text: string } & Record<string, unknown>>(
      `SELECT metadata::text AS metadata_text FROM audit_events
       WHERE action LIKE 'editorial.%'`,
    );
    expect(audits.rows.map((row) => row.metadata_text).join(' ')).not.toContain(safeDraft);
  }, 30_000);

  it('keeps draft reads exact-assignment-only and fails closed after withdrawal or suspension', async () => {
    const contentVersionId = await draftFixture(repository, 'scoped');
    await assign(repository, contentVersionId, 'fraud_analysis');

    await expect(
      repository.readAssignedDraft({
        contentVersionId,
        actorPersonId: 'person-hq-sam',
        correlationId: 'correlation:read:support',
        now,
      }),
    ).rejects.toThrow('unavailable');
    await expect(
      repository.board({
        actorPersonId: 'person-hq-sam',
        correlationId: 'correlation:board:support',
        now,
      }),
    ).rejects.toThrow('current internal authority');

    await repository.withdrawReviewAssignment({
      contentVersionId,
      role: 'fraud_analysis',
      actorPersonId: founderPersonId,
      reasonCode: 'review.assignment.withdrawn',
      correlationId: 'correlation:assignment:withdraw',
      now,
    });
    await expect(
      repository.readAssignedDraft({
        contentVersionId,
        actorPersonId: reviewerPersonId,
        correlationId: 'correlation:read:withdrawn',
        now,
      }),
    ).rejects.toThrow('unavailable');

    await assign(repository, contentVersionId, 'fraud_analysis');
    await database.query("UPDATE employee_assignments SET status = 'suspended' WHERE id = $1", [
      reviewerEmployeeId,
    ]);
    await expect(
      repository.readAssignedDraft({
        contentVersionId,
        actorPersonId: reviewerPersonId,
        correlationId: 'correlation:read:suspended',
        now,
      }),
    ).rejects.toThrow('unavailable');
  }, 30_000);

  it('invalidates approvals when reviewer authority or the exact final assignment changes', async () => {
    const contentVersionId = await draftFixture(repository, 'revokedapproval');
    for (const role of editorialReviewRoles) await assign(repository, contentVersionId, role);
    await repository.transitionContent({
      contentVersionId,
      toState: 'under_review',
      actorPersonId: reviewerPersonId,
      reasonCode: 'assigned.review.started',
      correlationId: 'correlation:revoked:start',
      now,
    });
    for (const role of editorialReviewRoles.filter((candidate) => candidate !== 'final_human')) {
      await repository.reviewDraft({
        contentVersionId,
        role,
        decision: 'approve',
        actorPersonId: reviewerPersonId,
        reasonCode: 'review.role.approved',
        correlationId: `correlation:revoked:${role}`,
        now,
      });
    }

    await database.query("UPDATE employee_assignments SET status = 'suspended' WHERE id = $1", [
      reviewerEmployeeId,
    ]);
    await expect(
      repository.reviewDraft({
        contentVersionId,
        role: 'final_human',
        decision: 'approve',
        actorPersonId: founderPersonId,
        reasonCode: 'owner.final.approved',
        correlationId: 'correlation:revoked:suspended-final',
        now,
      }),
    ).rejects.toThrow('complete current independent evidence');
    await database.query("UPDATE employee_assignments SET status = 'active' WHERE id = $1", [
      reviewerEmployeeId,
    ]);

    await repository.withdrawReviewAssignment({
      contentVersionId,
      role: 'fraud_analysis',
      actorPersonId: founderPersonId,
      reasonCode: 'owner.prerequisite.withdrawn',
      correlationId: 'correlation:revoked:withdraw-prerequisite',
      now,
    });
    await assign(repository, contentVersionId, 'fraud_analysis');
    await expect(
      repository.reviewDraft({
        contentVersionId,
        role: 'final_human',
        decision: 'approve',
        actorPersonId: founderPersonId,
        reasonCode: 'owner.final.approved',
        correlationId: 'correlation:revoked:revived-prerequisite',
        now,
      }),
    ).rejects.toThrow('complete current independent evidence');
    await repository.reviewDraft({
      contentVersionId,
      role: 'fraud_analysis',
      decision: 'approve',
      actorPersonId: reviewerPersonId,
      reasonCode: 'review.role.reapproved',
      correlationId: 'correlation:revoked:reapprove-prerequisite',
      now,
    });

    const finalEvidence = await database.query<
      { body_sha256: string; assignment_event_id: string } & Record<string, unknown>
    >(
      `SELECT content.body_sha256, assignment.id AS assignment_event_id
       FROM editorial_content_versions content
       JOIN LATERAL (
         SELECT id FROM editorial_assignment_events
         WHERE content_version_id = content.id AND review_role = 'final_human'
         ORDER BY sequence DESC LIMIT 1
       ) assignment ON true
       WHERE content.id = $1`,
      [contentVersionId],
    );
    await database.query(
      `INSERT INTO editorial_review_events(
         id, content_version_id, review_role, sequence, assignment_event_id,
         employee_assignment_id, actor_person_id, decision, reviewed_body_sha256,
         reason_code, evidence_tier, occurred_at
       ) VALUES (
         'editorial_review_revoked_final',$1,'final_human',1,$2,$3,$4,'approve',$5,
         'owner.final.approved','local_simulation',clock_timestamp()
       )`,
      [
        contentVersionId,
        finalEvidence.rows[0]?.assignment_event_id,
        founderEmployeeId,
        founderPersonId,
        finalEvidence.rows[0]?.body_sha256,
      ],
    );
    await repository.withdrawReviewAssignment({
      contentVersionId,
      role: 'final_human',
      actorPersonId: founderPersonId,
      reasonCode: 'owner.final.withdrawn',
      correlationId: 'correlation:revoked:withdraw-final',
      now,
    });
    const approveState = (id: string) =>
      database.query(
        `INSERT INTO editorial_content_state_events(
           id, content_version_id, sequence, to_state, actor_person_id, service_key,
           reason_code, evidence_tier, occurred_at
         ) VALUES ($1,$2,3,'approved_internal',$3,NULL,
           'hostile.assignment.revival','local_simulation',clock_timestamp())`,
        [id, contentVersionId, founderPersonId],
      );
    await expect(approveState('editorial_state_revoked_final')).rejects.toThrow(
      'exact current final human evidence',
    );

    await assign(repository, contentVersionId, 'final_human');
    await expect(approveState('editorial_state_reassigned_final')).rejects.toThrow(
      'exact current final human evidence',
    );
    const state = await database.query<{ to_state: string }>(
      `SELECT to_state FROM editorial_content_state_events
       WHERE content_version_id = $1 ORDER BY sequence DESC LIMIT 1`,
      [contentVersionId],
    );
    expect(state.rows[0]?.to_state).toBe('under_review');
  }, 30_000);

  it('rejects same-person skeptical/final approval and stale source evidence', async () => {
    const contentVersionId = await draftFixture(repository, 'independence');
    for (const role of editorialReviewRoles) {
      await repository.assignReview({
        contentVersionId,
        role,
        reviewerEmployeeAssignmentId:
          role === 'skeptical' || role === 'final_human' ? founderEmployeeId : reviewerEmployeeId,
        actorPersonId: founderPersonId,
        reasonCode: 'owner.review.assignment',
        correlationId: `correlation:independence:assignment:${role}`,
        now,
      });
    }
    await repository.transitionContent({
      contentVersionId,
      toState: 'under_review',
      actorPersonId: reviewerPersonId,
      reasonCode: 'assigned.review.started',
      correlationId: 'correlation:independence:start',
      now,
    });
    for (const role of editorialReviewRoles.filter((candidate) => candidate !== 'final_human')) {
      await repository.reviewDraft({
        contentVersionId,
        role,
        decision: 'approve',
        actorPersonId: role === 'skeptical' ? founderPersonId : reviewerPersonId,
        reasonCode: 'review.role.approved',
        correlationId: `correlation:independence:review:${role}`,
        now,
      });
    }
    await expect(
      repository.reviewDraft({
        contentVersionId,
        role: 'final_human',
        decision: 'approve',
        actorPersonId: founderPersonId,
        reasonCode: 'owner.final.approved',
        correlationId: 'correlation:independence:final',
        now,
      }),
    ).rejects.toThrow('complete current independent evidence');

    await repository.withdrawReviewAssignment({
      contentVersionId,
      role: 'skeptical',
      actorPersonId: founderPersonId,
      reasonCode: 'independence.reassignment',
      correlationId: 'correlation:independence:withdraw',
      now,
    });
    await assign(repository, contentVersionId, 'skeptical');
    await repository.reviewDraft({
      contentVersionId,
      role: 'skeptical',
      decision: 'approve',
      actorPersonId: reviewerPersonId,
      reasonCode: 'independent.skeptical.approval',
      correlationId: 'correlation:independence:skeptical',
      now,
    });
    dateNowSpy.mockReturnValue(afterDays(8).getTime());
    await expect(
      repository.reviewDraft({
        contentVersionId,
        role: 'final_human',
        decision: 'approve',
        actorPersonId: founderPersonId,
        reasonCode: 'owner.final.approved',
        correlationId: 'correlation:stale-source:final',
        now: afterDays(8),
      }),
    ).rejects.toThrow('complete current independent evidence');

    const state = await database.query<{ state: string; final_reviews: number }>(
      `SELECT latest.to_state AS state,
              (SELECT count(*)::int FROM editorial_review_events
               WHERE content_version_id = $1 AND review_role = 'final_human') AS final_reviews
       FROM editorial_content_state_events latest
       WHERE latest.content_version_id = $1
       ORDER BY latest.sequence DESC LIMIT 1`,
      [contentVersionId],
    );
    expect(state.rows[0]).toEqual({ state: 'under_review', final_reviews: 0 });
  }, 30_000);

  it('rejects raw locators and restricted draft input before persisting anything', async () => {
    const base = {
      contentKey: 'content_restricted',
      version: 1,
      productKind: 'daily_tip' as const,
      audience: 'customer' as const,
      locale: 'en-US',
      jurisdiction: 'US',
      urgency: 'routine' as const,
      unsupportedStatistics: false,
      unverifiedUrgency: false,
      expiresAt: afterDays(5),
      sourceVersionIds: ['source_version_placeholder'],
      claimVersionIds: ['claim_version_placeholder'],
      actorPersonId: founderPersonId,
      correlationId: 'correlation:draft:restricted',
      now,
    };
    await expect(
      repository.createDraft({ ...base, draftText: 'Read https://example.org/private now.' }),
    ).rejects.toThrow('raw locators');
    await expect(
      repository.createDraft({ ...base, draftText: 'Use card 4242 4242 4242 4242.' }),
    ).rejects.toThrow('restricted input');
    const count = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM editorial_content_versions WHERE content_key = 'content_restricted'",
    );
    expect(count.rows[0]?.count).toBe(0);
  });

  it('binds every draft source to the exact product, locale, and jurisdiction', async () => {
    const attempts = [
      {
        suffix: 'wrongproduct',
        source: { intendedProducts: ['daily_tip'] as const },
        locale: 'en-US',
        jurisdiction: 'US',
      },
      {
        suffix: 'wronglocale',
        source: { locale: 'fr-FR' },
        locale: 'en-US',
        jurisdiction: 'US',
      },
      {
        suffix: 'wrongjurisdiction',
        source: { jurisdiction: 'CA' },
        locale: 'en-US',
        jurisdiction: 'US',
      },
    ] as const;

    for (const attempt of attempts) {
      const evidence = await evidenceFixture(repository, attempt.suffix, {
        source: attempt.source,
      });
      await expect(
        repository.createDraft({
          contentKey: `content_${attempt.suffix}`,
          version: 1,
          productKind: 'urgent_alert',
          audience: 'customer',
          locale: attempt.locale,
          jurisdiction: attempt.jurisdiction,
          urgency: 'time_sensitive',
          draftText: `${safeDraft} Hostile ${attempt.suffix} fixture.`,
          unsupportedStatistics: false,
          unverifiedUrgency: false,
          expiresAt: afterDays(5),
          sourceVersionIds: [evidence.sourceVersionId],
          claimVersionIds: [evidence.claimId],
          actorPersonId: founderPersonId,
          correlationId: `correlation:draft:${attempt.suffix}`,
          now,
        }),
      ).rejects.toThrow(/source scope is incompatible/iu);
    }

    const directEvidence = await evidenceFixture(repository, 'directscope', {
      source: { intendedProducts: ['daily_tip'] },
    });
    await expect(
      database.transaction(async (transaction) => {
        await transaction.query(
          `INSERT INTO editorial_content_versions(
             id, content_key, version, product_kind, audience, channel, locale, jurisdiction,
             urgency, body_sha256, unsupported_statistics, unverified_urgency, expires_at,
             evidence_tier, provider_processed, publication_enabled, outbound_delivery_enabled,
             external_action_executed, created_by_person_id, created_at
           ) VALUES (
             'editorial_content_direct_scope','content_direct_scope',1,'urgent_alert','customer',
             'internal_review_only','en-US','US','time_sensitive',$1,false,false,$2,
             'local_simulation',false,false,false,false,$3,$4
           )`,
          [
            sha256('direct-scope-body'),
            afterDays(5).toISOString(),
            founderPersonId,
            now.toISOString(),
          ],
        );
        await transaction.query(
          `INSERT INTO editorial_content_payloads(
             content_version_id, payload_state, encrypted_text, encryption_key_version, created_at
           ) VALUES ($1,'encrypted_local_draft',$2,1,$3)`,
          ['editorial_content_direct_scope', 'e'.repeat(64), now.toISOString()],
        );
        await transaction.query(
          `INSERT INTO editorial_content_source_links(content_version_id, source_version_id)
           VALUES ($1,$2)`,
          ['editorial_content_direct_scope', directEvidence.sourceVersionId],
        );
        await transaction.query(
          `INSERT INTO editorial_content_claim_links(content_version_id, claim_version_id)
           VALUES ($1,$2)`,
          ['editorial_content_direct_scope', directEvidence.claimId],
        );
        await transaction.query(
          `INSERT INTO editorial_content_state_events(
             id, content_version_id, sequence, to_state, actor_person_id, service_key,
             reason_code, evidence_tier, occurred_at
           ) VALUES (
             'editorial_state_direct_scope',$1,1,'draft',NULL,'editorial.local_repository',
             'project_authored_local_draft','local_simulation',$2
           )`,
          ['editorial_content_direct_scope', now.toISOString()],
        );
      }),
    ).rejects.toThrow(/source scope is incompatible/iu);

    const drafts = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM editorial_content_versions
       WHERE content_key IN (
         'content_wrongproduct','content_wronglocale','content_wrongjurisdiction','content_direct_scope'
       )`,
    );
    expect(drafts.rows[0]?.count).toBe(0);
  }, 30_000);

  it('rejects stale, overlong, backdated, and jurisdiction-mismatched claim authority', async () => {
    const sourceVersionId = await approvedSource(repository, 'claimauthority');
    const artifactId = await repository.recordLocalArtifact({
      sourceVersionId,
      artifactKey: 'artifact_claimauthority',
      locatorSha256: sha256('claimauthority-locator'),
      contentSha256: sha256('claimauthority-content'),
      expiresAt: afterDays(2),
      actorPersonId: reviewerPersonId,
      correlationId: 'correlation:artifact:claimauthority',
      now,
    });
    const claimBase = {
      version: 1,
      artifactReceiptId: artifactId,
      artifactSpanSha256: sha256('claimauthority-span'),
      subjectCode: 'unexpected.request',
      predicateCode: 'requires.independent.verification',
      scopeCode: 'consumer.safety',
      jurisdiction: 'US',
      uncertainty: 'strong' as const,
      validFrom: now,
      validThrough: afterDays(1),
      expiresAt: afterDays(1),
      actorPersonId: reviewerPersonId,
      correlationId: 'correlation:claim:authority',
      now,
    };

    await expect(
      repository.recordClaim({
        ...claimBase,
        claimKey: 'claim_exceeds_artifact',
        validThrough: afterDays(3),
        expiresAt: afterDays(3),
      }),
    ).rejects.toThrow(/artifact and source authority/iu);
    await expect(
      repository.recordClaim({
        ...claimBase,
        claimKey: 'claim_predates_authority',
        validFrom: afterDays(-1),
      }),
    ).rejects.toThrow(/artifact and source authority/iu);
    await expect(
      repository.recordClaim({
        ...claimBase,
        claimKey: 'claim_wrong_jurisdiction',
        jurisdiction: 'CA',
      }),
    ).rejects.toThrow(/artifact and source authority/iu);

    const longArtifactId = await repository.recordLocalArtifact({
      sourceVersionId,
      artifactKey: 'artifact_claimauthority_long',
      locatorSha256: sha256('claimauthority-long-locator'),
      contentSha256: sha256('claimauthority-long-content'),
      expiresAt: afterDays(14),
      actorPersonId: reviewerPersonId,
      correlationId: 'correlation:artifact:claimauthority:long',
      now,
    });
    await expect(
      repository.recordClaim({
        ...claimBase,
        claimKey: 'claim_exceeds_source_review',
        artifactReceiptId: longArtifactId,
        validThrough: afterDays(8),
        expiresAt: afterDays(8),
      }),
    ).rejects.toThrow(/artifact and source authority/iu);

    dateNowSpy.mockReturnValue(afterDays(3).getTime());
    await expect(
      database.query(
        `INSERT INTO editorial_claim_versions(
           id, claim_key, version, artifact_receipt_id, artifact_span_sha256,
           subject_code, predicate_code, scope_code, jurisdiction, uncertainty,
           valid_from, valid_through, expires_at, raw_claim_stored, model_generated,
           evidence_tier, employee_assignment_id, created_by_person_id, created_at
         ) VALUES (
           'editorial_claim_direct_expired_artifact','claim_direct_expired_artifact',1,$1,$2,
           'unexpected.request','requires.independent.verification','consumer.safety','US','strong',
           $3,$4,$4,false,false,'local_simulation',$5,$6,$3
         )`,
        [
          artifactId,
          sha256('direct-expired-artifact-span'),
          afterDays(3).toISOString(),
          afterDays(4).toISOString(),
          reviewerEmployeeId,
          reviewerPersonId,
        ],
      ),
    ).rejects.toThrow(/artifact and source authority/iu);

    const claims = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM editorial_claim_versions
       WHERE claim_key IN (
         'claim_exceeds_artifact','claim_predates_authority','claim_wrong_jurisdiction',
         'claim_exceeds_source_review','claim_direct_expired_artifact'
       )`,
    );
    expect(claims.rows[0]?.count).toBe(0);
  }, 30_000);

  it('rejects backdated direct-DML artifact, claim, review, and approval authority', async () => {
    const evidence = await evidenceFixture(repository, 'authorityclock');
    const contentVersionId = await repository.createDraft({
      contentKey: 'content_authorityclock',
      version: 1,
      productKind: 'urgent_alert',
      audience: 'customer',
      locale: 'en-US',
      jurisdiction: 'US',
      urgency: 'time_sensitive',
      draftText: `${safeDraft} Database authority clock fixture.`,
      unsupportedStatistics: false,
      unverifiedUrgency: false,
      expiresAt: afterDays(5),
      sourceVersionIds: [evidence.sourceVersionId],
      claimVersionIds: [evidence.claimId],
      actorPersonId: founderPersonId,
      correlationId: 'correlation:authorityclock:draft',
      now,
    });
    for (const role of editorialReviewRoles) await assign(repository, contentVersionId, role);
    await repository.transitionContent({
      contentVersionId,
      toState: 'under_review',
      actorPersonId: reviewerPersonId,
      reasonCode: 'assigned.review.started',
      correlationId: 'correlation:authorityclock:start',
      now,
    });
    for (const role of editorialReviewRoles.filter((candidate) => candidate !== 'final_human')) {
      await repository.reviewDraft({
        contentVersionId,
        role,
        decision: 'approve',
        actorPersonId: reviewerPersonId,
        reasonCode: 'review.role.approved',
        correlationId: `correlation:authorityclock:${role}`,
        now,
      });
    }
    const finalEvidence = await database.query<
      { body_sha256: string; assignment_event_id: string } & Record<string, unknown>
    >(
      `SELECT content.body_sha256, assignment.id AS assignment_event_id
       FROM editorial_content_versions content
       JOIN LATERAL (
         SELECT id FROM editorial_assignment_events
         WHERE content_version_id = content.id AND review_role = 'final_human'
         ORDER BY sequence DESC LIMIT 1
       ) assignment ON true
       WHERE content.id = $1`,
      [contentVersionId],
    );

    dateNowSpy.mockReturnValue(afterDays(1).getTime());
    await expect(
      database.query(
        `INSERT INTO editorial_artifact_receipts(
           id, source_version_id, artifact_key, locator_sha256, content_sha256,
           source_published_at, observed_at, expires_at, parser_version,
           employee_assignment_id, actor_person_id, evidence_tier, receipt_kind,
           external_fetch_performed, provider_processed, raw_artifact_stored,
           normalized_content_stored, created_at
         ) VALUES (
           'editorial_artifact_backdated',$1,'artifact_backdated',$2,$3,NULL,$4,$5,
           'local-fixture-metadata-v1',$6,$7,'local_simulation','local_fixture',
           false,false,false,false,$4
         )`,
        [
          evidence.sourceVersionId,
          sha256('backdated-locator'),
          sha256('backdated-content'),
          now.toISOString(),
          afterDays(2).toISOString(),
          reviewerEmployeeId,
          reviewerPersonId,
        ],
      ),
    ).rejects.toThrow(/current database transaction/iu);
    await expect(
      database.query(
        `INSERT INTO editorial_claim_versions(
           id, claim_key, version, artifact_receipt_id, artifact_span_sha256,
           subject_code, predicate_code, scope_code, jurisdiction, uncertainty,
           valid_from, valid_through, expires_at, raw_claim_stored, model_generated,
           evidence_tier, employee_assignment_id, created_by_person_id, created_at
         ) VALUES (
           'editorial_claim_backdated','claim_backdated',1,$1,$2,
           'unexpected.request','requires.independent.verification','consumer.safety','US','strong',
           $3,$4,$4,false,false,'local_simulation',$5,$6,$3
         )`,
        [
          evidence.artifactId,
          sha256('backdated-span'),
          now.toISOString(),
          afterDays(2).toISOString(),
          reviewerEmployeeId,
          reviewerPersonId,
        ],
      ),
    ).rejects.toThrow(/current database transaction/iu);
    await expect(
      database.query(
        `INSERT INTO editorial_review_events(
           id, content_version_id, review_role, sequence, assignment_event_id,
           employee_assignment_id, actor_person_id, decision, reviewed_body_sha256,
           reason_code, evidence_tier, occurred_at
         ) VALUES (
           'editorial_review_backdated_final',$1,'final_human',1,$2,$3,$4,'approve',$5,
           'owner.final.approved','local_simulation',$6
         )`,
        [
          contentVersionId,
          finalEvidence.rows[0]?.assignment_event_id,
          founderEmployeeId,
          founderPersonId,
          finalEvidence.rows[0]?.body_sha256,
          now.toISOString(),
        ],
      ),
    ).rejects.toThrow(/current database transaction/iu);

    await database.query(
      `INSERT INTO editorial_review_events(
         id, content_version_id, review_role, sequence, assignment_event_id,
         employee_assignment_id, actor_person_id, decision, reviewed_body_sha256,
         reason_code, evidence_tier, occurred_at
       ) VALUES (
         'editorial_review_current_final',$1,'final_human',1,$2,$3,$4,'approve',$5,
         'owner.final.approved','local_simulation',clock_timestamp()
       )`,
      [
        contentVersionId,
        finalEvidence.rows[0]?.assignment_event_id,
        founderEmployeeId,
        founderPersonId,
        finalEvidence.rows[0]?.body_sha256,
      ],
    );
    await expect(
      database.query(
        `INSERT INTO editorial_content_state_events(
           id, content_version_id, sequence, to_state, actor_person_id, service_key,
           reason_code, evidence_tier, occurred_at
         ) VALUES (
           'editorial_state_backdated_approval',$1,3,'approved_internal',$2,NULL,
           'hostile.backdated.approval','local_simulation',$3
         )`,
        [contentVersionId, founderPersonId, now.toISOString()],
      ),
    ).rejects.toThrow(/current database transaction/iu);
  }, 30_000);

  it('requires an exact current internal assignment for direct-DML claim authorship', async () => {
    const evidence = await evidenceFixture(repository, 'claimauthor');
    const insertClaim = (
      id: string,
      claimKey: string,
      employeeAssignmentId: string,
      personId: string,
    ) =>
      database.query(
        `INSERT INTO editorial_claim_versions(
           id, claim_key, version, artifact_receipt_id, artifact_span_sha256,
           subject_code, predicate_code, scope_code, jurisdiction, uncertainty,
           valid_from, valid_through, expires_at, raw_claim_stored, model_generated,
           evidence_tier, employee_assignment_id, created_by_person_id, created_at
         ) VALUES (
           $1,$2,1,$3,$4,'unexpected.request','requires.independent.verification',
           'consumer.safety','US','strong',clock_timestamp(),
           clock_timestamp() + interval '1 day',clock_timestamp() + interval '1 day',
           false,false,'local_simulation',$5,$6,clock_timestamp()
         )`,
        [
          id,
          claimKey,
          evidence.artifactId,
          sha256(`claim-author:${id}`),
          employeeAssignmentId,
          personId,
        ],
      );

    await expect(
      insertClaim(
        'editorial_claim_support_author',
        'claim_support_author',
        'employee-hq-sam',
        'person-hq-sam',
      ),
    ).rejects.toThrow(/current internal review authority/iu);
    await expect(
      insertClaim(
        'editorial_claim_mismatched_author',
        'claim_mismatched_author',
        founderEmployeeId,
        reviewerPersonId,
      ),
    ).rejects.toThrow(/current internal review authority/iu);

    await database.query("UPDATE employee_assignments SET status = 'suspended' WHERE id = $1", [
      reviewerEmployeeId,
    ]);
    await expect(
      insertClaim(
        'editorial_claim_suspended_author',
        'claim_suspended_author',
        reviewerEmployeeId,
        reviewerPersonId,
      ),
    ).rejects.toThrow(/current internal review authority/iu);
    await database.query("UPDATE employee_assignments SET status = 'active' WHERE id = $1", [
      reviewerEmployeeId,
    ]);

    const claims = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM editorial_claim_versions
       WHERE claim_key IN ('claim_support_author','claim_mismatched_author','claim_suspended_author')`,
    );
    expect(claims.rows[0]?.count).toBe(0);
  }, 30_000);

  it('blocks premature source use, self-corroboration, and non-independent final source review', async () => {
    const pendingSource = await repository.createSourceVersion({
      actorPersonId: founderPersonId,
      correlationId: 'correlation:source:pending',
      sourceKey: 'source_pending',
      version: 1,
      publisherKey: 'publisher.pending',
      originHost: 'pending.example.gov',
      pathPrefix: '/pending',
      sourceClass: 'government',
      jurisdiction: 'US',
      locale: 'en-US',
      intendedProducts: ['urgent_alert'],
      authorityReasonCode: 'official.local.fixture',
      retentionPolicyVersion: 'editorial.local.v1',
      effectiveAt: now,
      reviewDueAt: afterDays(7),
      expiresAt: afterDays(30),
      now,
    });
    await expect(
      repository.recordLocalArtifact({
        sourceVersionId: pendingSource,
        artifactKey: 'artifact_premature',
        locatorSha256: sha256('premature-locator'),
        contentSha256: sha256('premature-content'),
        expiresAt: afterDays(14),
        actorPersonId: reviewerPersonId,
        correlationId: 'correlation:artifact:premature',
        now,
      }),
    ).rejects.toThrow('current approved source');

    for (const role of ['primary_source', 'domain', 'rights', 'security'] as const) {
      await repository.reviewSource({
        sourceVersionId: pendingSource,
        actorPersonId: role === 'primary_source' ? founderPersonId : reviewerPersonId,
        role,
        decision: 'approve',
        reasonCode: 'reviewed.local.fixture',
        correlationId: `correlation:source:pending:${role}`,
        now,
      });
    }
    await expect(
      repository.reviewSource({
        sourceVersionId: pendingSource,
        actorPersonId: founderPersonId,
        role: 'final_source',
        decision: 'approve',
        reasonCode: 'owner.local.approval',
        correlationId: 'correlation:source:pending:final',
        now,
      }),
    ).rejects.toThrow('independent prerequisite approvals');

    const evidence = await evidenceFixture(repository, 'selfcorroboration');
    const secondArtifact = await repository.recordLocalArtifact({
      sourceVersionId: evidence.sourceVersionId,
      artifactKey: 'artifact_selfcorroboration_second',
      locatorSha256: sha256('selfcorroboration-locator-two'),
      contentSha256: sha256('selfcorroboration-content-two'),
      expiresAt: afterDays(14),
      actorPersonId: reviewerPersonId,
      correlationId: 'correlation:artifact:selfcorroboration:two',
      now,
    });
    await expect(
      repository.recordStoryRelationship({
        relationshipKey: 'relationship_selfcorroboration',
        leftArtifactId: evidence.artifactId,
        rightArtifactId: secondArtifact,
        relationship: 'corroborates',
        decision: 'confirmed',
        confidence: 'strong',
        reasonCode: 'claimed.independent.support',
        actorPersonId: reviewerPersonId,
        correlationId: 'correlation:relationship:selfcorroboration',
        now,
      }),
    ).rejects.toThrow('cannot independently corroborate itself');

    const syndicatedLeft = await evidenceFixture(repository, 'syndicatedleft');
    const syndicatedRight = await evidenceFixture(repository, 'syndicatedright');
    await repository.recordStoryRelationship({
      relationshipKey: 'relationship_syndicated_pair',
      leftArtifactId: syndicatedLeft.artifactId,
      rightArtifactId: syndicatedRight.artifactId,
      relationship: 'syndication',
      decision: 'confirmed',
      confidence: 'strong',
      reasonCode: 'shared.origin.confirmed',
      actorPersonId: reviewerPersonId,
      correlationId: 'correlation:relationship:syndicated',
      now,
    });
    await expect(
      repository.recordStoryRelationship({
        relationshipKey: 'relationship_false_independence',
        leftArtifactId: syndicatedLeft.artifactId,
        rightArtifactId: syndicatedRight.artifactId,
        relationship: 'corroborates',
        decision: 'confirmed',
        confidence: 'strong',
        reasonCode: 'claimed.independent.support',
        actorPersonId: reviewerPersonId,
        correlationId: 'correlation:relationship:false-independence',
        now,
      }),
    ).rejects.toThrow('conflicts with confirmed duplicate or syndicated evidence');
  }, 30_000);

  it('makes duplicate conflicts order-independent and blocks only drafts linking both endpoints', async () => {
    const left = await evidenceFixture(repository, 'reverseleft');
    const right = await evidenceFixture(repository, 'reverseright');
    await repository.recordStoryRelationship({
      relationshipKey: 'relationship_reverse_corroboration',
      leftArtifactId: left.artifactId,
      rightArtifactId: right.artifactId,
      relationship: 'corroborates',
      decision: 'confirmed',
      confidence: 'strong',
      reasonCode: 'claimed.independent.support',
      actorPersonId: reviewerPersonId,
      correlationId: 'correlation:relationship:reverse:corroboration',
      now,
    });
    await expect(
      repository.recordStoryRelationship({
        relationshipKey: 'relationship_reverse_syndication',
        leftArtifactId: right.artifactId,
        rightArtifactId: left.artifactId,
        relationship: 'syndication',
        decision: 'confirmed',
        confidence: 'strong',
        reasonCode: 'shared.origin.confirmed',
        actorPersonId: reviewerPersonId,
        correlationId: 'correlation:relationship:reverse:blocked',
        now,
      }),
    ).rejects.toThrow('conflicts with confirmed duplicate or syndicated evidence');

    await repository.recordStoryRelationship({
      relationshipKey: 'relationship_reverse_corroboration',
      leftArtifactId: left.artifactId,
      rightArtifactId: right.artifactId,
      relationship: 'corroborates',
      decision: 'rejected',
      confidence: 'strong',
      reasonCode: 'shared.origin.reclassified',
      actorPersonId: reviewerPersonId,
      correlationId: 'correlation:relationship:reverse:rejected',
      now,
    });
    await expect(
      repository.recordStoryRelationship({
        relationshipKey: 'relationship_reverse_syndication',
        leftArtifactId: right.artifactId,
        rightArtifactId: left.artifactId,
        relationship: 'syndication',
        decision: 'confirmed',
        confidence: 'strong',
        reasonCode: 'shared.origin.confirmed',
        actorPersonId: reviewerPersonId,
        correlationId: 'correlation:relationship:reverse:confirmed',
        now,
      }),
    ).resolves.toMatch(/^editorial_relationship_/u);

    const duplicateDraftId = await repository.createDraft({
      contentKey: 'content_duplicate_authority',
      version: 1,
      productKind: 'urgent_alert',
      audience: 'customer',
      locale: 'en-US',
      jurisdiction: 'US',
      urgency: 'time_sensitive',
      draftText: `${safeDraft} Duplicate endpoint fixture.`,
      unsupportedStatistics: false,
      unverifiedUrgency: false,
      expiresAt: afterDays(5),
      sourceVersionIds: [left.sourceVersionId, right.sourceVersionId],
      claimVersionIds: [left.claimId, right.claimId],
      actorPersonId: founderPersonId,
      correlationId: 'correlation:duplicate:draft:both',
      now,
    });
    for (const role of editorialReviewRoles) await assign(repository, duplicateDraftId, role);
    await repository.transitionContent({
      contentVersionId: duplicateDraftId,
      toState: 'under_review',
      actorPersonId: reviewerPersonId,
      reasonCode: 'assigned.review.started',
      correlationId: 'correlation:duplicate:start',
      now,
    });
    for (const role of editorialReviewRoles.filter((candidate) => candidate !== 'final_human')) {
      await repository.reviewDraft({
        contentVersionId: duplicateDraftId,
        role,
        decision: 'approve',
        actorPersonId: reviewerPersonId,
        reasonCode: 'review.role.approved',
        correlationId: `correlation:duplicate:${role}`,
        now,
      });
    }
    await expect(
      repository.reviewDraft({
        contentVersionId: duplicateDraftId,
        role: 'final_human',
        decision: 'approve',
        actorPersonId: founderPersonId,
        reasonCode: 'owner.final.approved',
        correlationId: 'correlation:duplicate:final',
        now,
      }),
    ).rejects.toThrow('complete current independent evidence');

    const singleEndpointId = await repository.createDraft({
      contentKey: 'content_single_duplicate_endpoint',
      version: 1,
      productKind: 'urgent_alert',
      audience: 'customer',
      locale: 'en-US',
      jurisdiction: 'US',
      urgency: 'routine',
      draftText: `${safeDraft} Single endpoint control fixture.`,
      unsupportedStatistics: false,
      unverifiedUrgency: false,
      expiresAt: afterDays(5),
      sourceVersionIds: [left.sourceVersionId],
      claimVersionIds: [left.claimId],
      actorPersonId: founderPersonId,
      correlationId: 'correlation:duplicate:draft:single',
      now,
    });
    await expect(approveDraft(repository, singleEndpointId)).resolves.toBeUndefined();
  }, 30_000);

  it('requires correction replacements to preserve scope and current approved evidence', async () => {
    const originalId = await draftFixture(repository, 'correctionguard', 1);
    const mismatchEvidence = await evidenceFixture(repository, 'correctionguardmismatch');
    const mismatchId = await repository.createDraft({
      contentKey: 'content_correctionguard',
      version: 2,
      productKind: 'daily_tip',
      audience: 'customer',
      locale: 'en-US',
      jurisdiction: 'US',
      urgency: 'routine',
      draftText: `${safeDraft} Scope-mismatched correction candidate.`,
      unsupportedStatistics: false,
      unverifiedUrgency: false,
      expiresAt: afterDays(5),
      sourceVersionIds: [mismatchEvidence.sourceVersionId],
      claimVersionIds: [mismatchEvidence.claimId],
      actorPersonId: founderPersonId,
      correlationId: 'correlation:correctionguard:mismatch',
      now,
    });
    const insertCorrection = (
      id: string,
      replacementContentVersionId: string,
      sequence: number,
      occurredAt?: Date,
    ) =>
      database.query(
        `INSERT INTO editorial_correction_events(
           id, original_content_version_id, replacement_content_version_id, sequence,
           disposition, reason_code, actor_person_id, evidence_tier,
           external_action_executed, occurred_at
         ) VALUES (
           $1,$2,$3,$4,'correction','hostile.correction.candidate',$5,
           'local_simulation',false,COALESCE($6::timestamptz,clock_timestamp())
         )`,
        [
          id,
          originalId,
          replacementContentVersionId,
          sequence,
          founderPersonId,
          occurredAt?.toISOString() ?? null,
        ],
      );

    await expect(
      insertCorrection('editorial_correction_scope_mismatch', mismatchId, 1),
    ).rejects.toThrow(/replacement scope must match/iu);

    const replacementId = await draftFixture(repository, 'correctionguard', 3);
    await expect(
      insertCorrection('editorial_correction_unapproved', replacementId, 1),
    ).rejects.toThrow(/requires current approved evidence/iu);
    await approveDraft(repository, replacementId);
    await expect(
      repository.recordCorrection({
        originalContentVersionId: originalId,
        replacementContentVersionId: replacementId,
        disposition: 'correction',
        reasonCode: 'newer.approved.version',
        actorPersonId: founderPersonId,
        correlationId: 'correlation:correctionguard:positive',
        now,
      }),
    ).resolves.toMatch(/^editorial_correction_/u);

    dateNowSpy.mockReturnValue(afterDays(8).getTime());
    await expect(
      insertCorrection('editorial_correction_backdated', replacementId, 2, now),
    ).rejects.toThrow(/current database transaction/iu);
    await expect(insertCorrection('editorial_correction_stale', replacementId, 2)).rejects.toThrow(
      /requires current approved evidence/iu,
    );

    dateNowSpy.mockReturnValue(now.getTime());
    await draftFixture(repository, 'correctionguard', 4);
    await expect(
      insertCorrection('editorial_correction_superseded', replacementId, 2),
    ).rejects.toThrow(/requires current approved evidence/iu);
  }, 30_000);

  it('retains immutable correction history and exposes only local queue metadata', async () => {
    const originalId = await draftFixture(repository, 'correctable', 1);
    const replacementId = await draftFixture(repository, 'correctable', 2);
    await approveDraft(repository, replacementId);
    await repository.planInternalReview({
      contentVersionId: replacementId,
      state: 'internal_review_planned',
      plannedFor: afterDays(1),
      reasonCode: 'owner.local.review.plan',
      actorPersonId: founderPersonId,
      correlationId: 'correlation:calendar:plan',
      now,
    });
    await repository.recordCorrection({
      originalContentVersionId: originalId,
      replacementContentVersionId: replacementId,
      disposition: 'correction',
      reasonCode: 'newer.immutable.version',
      actorPersonId: founderPersonId,
      correlationId: 'correlation:correction',
      now,
    });
    await repository.recordLocalPreference({
      actorPersonId: 'person-owner-alice',
      productKind: 'urgent_alert',
      channel: 'in_app',
      state: 'granted',
      locale: 'en-US',
      timezoneName: 'America/Los_Angeles',
      quietHoursStart: 1320,
      quietHoursEnd: 420,
      frequency: 'urgent_only',
      expiresAt: afterDays(30),
      correlationId: 'correlation:preference:grant',
      now,
    });
    await repository.recordLocalPreference({
      actorPersonId: 'person-owner-alice',
      productKind: 'urgent_alert',
      channel: 'in_app',
      state: 'withdrawn',
      correlationId: 'correlation:preference:withdraw',
      now,
    });

    const board = await repository.board({
      actorPersonId: founderPersonId,
      correlationId: 'correlation:board:owner',
      now,
    });
    expect(board.corrections).toEqual([
      expect.objectContaining({
        originalContentVersionId: originalId,
        replacementContentVersionId: replacementId,
        disposition: 'correction',
        evidenceTier: 'local_simulation',
      }),
    ]);
    expect(board.calendar).toEqual([
      expect.objectContaining({
        contentVersionId: replacementId,
        state: 'internal_review_planned',
        externalActionEnabled: false,
      }),
    ]);
    expect(board.preferences).toEqual({
      grantedLocalFixtures: 0,
      withdrawnLocalFixtures: 1,
      externalDeliveryEnabled: false,
    });
    expect(JSON.stringify(board)).not.toMatch(
      /draftText|encrypted|sha256|destination|https?:\/\//u,
    );

    const retained = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM editorial_content_versions
       WHERE id IN ($1,$2)`,
      [originalId, replacementId],
    );
    expect(retained.rows[0]?.count).toBe(2);
  }, 30_000);
});
