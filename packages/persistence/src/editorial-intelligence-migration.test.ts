import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSeededTestDatabase } from '@boomerbuddy/testkit';

import type { Database } from './database';
import { EditorialIntelligenceRepository } from './editorial-intelligence';

const now = new Date('2026-08-17T12:00:00.000Z');
const later = new Date('2026-09-17T12:00:00.000Z');
const digest = 'a'.repeat(64);

function repositoryFor(database: Database): EditorialIntelligenceRepository {
  let sequence = 0;
  return new EditorialIntelligenceRepository(
    database,
    {
      encryptionKey: Buffer.alloc(32, 31),
      encryptionKeyVersion: 1,
      founderPersonId: 'person-hq-heidi',
    },
    { next: (prefix) => `${prefix}_migration_test_${++sequence}` },
    async (_transaction, observedAt) => new Date(observedAt),
  );
}

describe('editorial intelligence migration', () => {
  let database: Database;
  let dateNowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(now.getTime());
    database = await createSeededTestDatabase(now);
  });

  afterEach(async () => {
    await database.close();
    dateNowSpy.mockRestore();
  });

  it('installs append-only governance tables without raw locator, plaintext, or destination columns', async () => {
    const tables = await database.query<{ table_name: string } & Record<string, unknown>>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'editorial_%'
       ORDER BY table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        'editorial_source_versions',
        'editorial_source_review_events',
        'editorial_artifact_receipts',
        'editorial_claim_versions',
        'editorial_story_relationship_events',
        'editorial_content_versions',
        'editorial_content_payloads',
        'editorial_content_source_links',
        'editorial_content_claim_links',
        'editorial_assignment_events',
        'editorial_review_events',
        'editorial_content_state_events',
        'editorial_correction_events',
        'editorial_calendar_events',
        'editorial_preference_events',
      ]),
    );
    const forbiddenColumns = await database.query<
      { table_name: string; column_name: string } & Record<string, unknown>
    >(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name LIKE 'editorial_%'
         AND column_name IN (
           'url', 'canonical_url', 'raw_url', 'destination', 'recipient',
           'raw_content', 'normalized_content', 'draft_text', 'body_text'
         )`,
    );
    expect(forbiddenColumns.rows).toEqual([]);

    const provenanceColumns = await database.query<
      { table_name: string; column_name: string } & Record<string, unknown>
    >(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND (
         (table_name = 'editorial_claim_versions' AND column_name = 'employee_assignment_id')
         OR (table_name = 'editorial_review_events' AND column_name = 'assignment_event_id')
       ) ORDER BY table_name, column_name`,
    );
    expect(provenanceColumns.rows).toEqual([
      { table_name: 'editorial_claim_versions', column_name: 'employee_assignment_id' },
      { table_name: 'editorial_review_events', column_name: 'assignment_event_id' },
    ]);

    const constraints = await database.query<{ definition: string } & Record<string, unknown>>(
      `SELECT pg_get_constraintdef(constraint_row.oid) AS definition
       FROM pg_constraint constraint_row
       WHERE constraint_row.conrelid IN (
         'editorial_source_versions'::regclass,
         'editorial_artifact_receipts'::regclass,
         'editorial_claim_versions'::regclass,
         'editorial_content_versions'::regclass,
         'editorial_calendar_events'::regclass,
         'editorial_preference_events'::regclass
       )`,
    );
    const definitions = constraints.rows.map((row) => row.definition).join('\n');
    expect(definitions).toContain('external_fetch_enabled = false');
    expect(definitions).toContain('provider_processed = false');
    expect(definitions).toContain('raw_artifact_stored = false');
    expect(definitions).toContain('raw_claim_stored = false');
    expect(definitions).toContain('publication_enabled = false');
    expect(definitions).toContain('outbound_delivery_enabled = false');
    expect(definitions).toContain('external_action_enabled = false');
    expect(definitions).toContain('external_delivery_enabled = false');

    const authorityFunctions = await database.query<
      { function_name: string; definition: string } & Record<string, unknown>
    >(
      `SELECT routine.proname AS function_name, pg_get_functiondef(routine.oid) AS definition
       FROM pg_proc routine
       WHERE routine.proname IN (
         'editorial_database_authority_time',
         'editorial_content_has_current_final_approval',
         'validate_editorial_claim_version',
         'validate_editorial_correction_event',
         'validate_editorial_story_relationship_event',
         'editorial_content_has_current_approvals',
         'require_complete_editorial_content_version'
       )`,
    );
    const authorityDefinition = authorityFunctions.rows
      .map((row) => `${row.function_name}\n${row.definition}`)
      .join('\n');
    expect(authorityDefinition).toContain('artifact.expires_at <= evaluated_at');
    expect(authorityDefinition).toContain('source.intended_products ? content.product_kind');
    expect(authorityDefinition).toContain('source.locale <> NEW.locale');
    expect(authorityDefinition).toContain('source.jurisdiction <> NEW.jurisdiction');
    expect(authorityDefinition).toContain('NEW.valid_through > artifact.expires_at');
    expect(authorityDefinition).toContain('NEW.expires_at > source.review_due_at');
    expect(authorityDefinition).toContain("date_trunc('milliseconds', transaction_timestamp())");
    expect(authorityDefinition).toContain('clock_timestamp()');
    expect(authorityDefinition).toContain('final_review.assignment_event_id');
    expect(authorityDefinition).toContain('replacement.product_kind <> original.product_kind');
    expect(authorityDefinition).toContain("NEW.relationship = 'corroborates'");
  });

  it('rejects direct attempts to enable fetch, provider, publication, or delivery stages', async () => {
    await expect(
      database.query(
        `INSERT INTO editorial_source_versions(
           id, source_key, version, publisher_key, origin_host, path_prefix, source_class,
           jurisdiction, locale, intended_products, authority_reason_code,
           retention_policy_version, lifecycle, effective_at, review_due_at, expires_at,
           evidence_tier, external_fetch_enabled, created_by_person_id, created_at
         ) VALUES (
           'source_invalid_product','source_invalid_product',1,'publisher.local',
           'local.example.gov','/local','government','US','en-US',
           '["unreviewed_product"]'::jsonb,'official.local.fixture','editorial.local.v1',
           'proposed',$1,$2,$3,'local_simulation',false,'person-hq-heidi',$1
         )`,
        [now.toISOString(), later.toISOString(), later.toISOString()],
      ),
    ).rejects.toThrow();

    await expect(
      database.query(
        `INSERT INTO editorial_source_versions(
           id, source_key, version, publisher_key, origin_host, path_prefix, source_class,
           jurisdiction, locale, intended_products, authority_reason_code,
           retention_policy_version, lifecycle, effective_at, review_due_at, expires_at,
           evidence_tier, external_fetch_enabled, created_by_person_id, created_at
         ) VALUES (
           'source_external_on','source_external_on',1,'publisher.local','local.example.gov','/local',
           'government','US','en-US','["urgent_alert"]'::jsonb,'official.local.fixture',
           'editorial.local.v1','proposed',$1,$2,$3,'local_simulation',true,
           'person-hq-heidi',$1
         )`,
        [now.toISOString(), later.toISOString(), later.toISOString()],
      ),
    ).rejects.toThrow();

    await expect(
      database.query(
        `INSERT INTO editorial_content_versions(
           id, content_key, version, product_kind, audience, channel, locale, jurisdiction,
           urgency, body_sha256, unsupported_statistics, unverified_urgency, expires_at,
           evidence_tier, provider_processed, publication_enabled, outbound_delivery_enabled,
           external_action_executed, created_by_person_id, created_at
         ) VALUES (
           'content_external_on','content_external_on',1,'urgent_alert','customer',
           'internal_review_only','en-US','US','routine',$1,false,false,$2,
           'local_simulation',true,true,true,true,'person-hq-heidi',$3
         )`,
        [digest, later.toISOString(), now.toISOString()],
      ),
    ).rejects.toThrow();

    await expect(
      database.query(
        `INSERT INTO editorial_preference_events(
           id, subject_person_id, actor_person_id, product_kind, channel, sequence, state,
           consent_version, locale, timezone_name, quiet_hours_start, quiet_hours_end,
           frequency, expires_at, source_surface, evidence_tier, external_delivery_enabled,
           occurred_at
         ) VALUES (
           'preference_external_on','person-owner-alice','person-owner-alice','urgent_alert',
           'in_app',1,'granted','editorial-preference-local-fixture-v1','en-US',
           'America/Los_Angeles',1320,420,'urgent_only',$2,'local_fixture',
           'local_simulation',true,$1
         )`,
        [now.toISOString(), later.toISOString()],
      ),
    ).rejects.toThrow();
  });

  it('rejects mutation or deletion of recorded evidence', async () => {
    const repository = repositoryFor(database);
    const sourceVersionId = await repository.createSourceVersion({
      actorPersonId: 'person-hq-heidi',
      correlationId: 'correlation:migration:append-only',
      sourceKey: 'source_append_only',
      version: 1,
      publisherKey: 'publisher.append',
      originHost: 'append.example.gov',
      pathPrefix: '/append',
      sourceClass: 'government',
      jurisdiction: 'US',
      locale: 'en-US',
      intendedProducts: ['urgent_alert'],
      authorityReasonCode: 'official.local.fixture',
      retentionPolicyVersion: 'editorial.local.v1',
      effectiveAt: now,
      reviewDueAt: new Date('2026-08-24T12:00:00.000Z'),
      expiresAt: later,
      now,
    });
    await expect(
      database.query('UPDATE editorial_source_versions SET lifecycle = $1 WHERE id = $2', [
        'retired',
        sourceVersionId,
      ]),
    ).rejects.toThrow('append-only');
    await expect(
      database.query('DELETE FROM editorial_source_versions WHERE id = $1', [sourceVersionId]),
    ).rejects.toThrow('append-only');
  });

  it('rejects incomplete content aggregates and hard-disables legacy publication', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.query(
          `INSERT INTO editorial_content_versions(
             id, content_key, version, product_kind, audience, channel, locale, jurisdiction,
             urgency, body_sha256, unsupported_statistics, unverified_urgency, expires_at,
             evidence_tier, provider_processed, publication_enabled, outbound_delivery_enabled,
             external_action_executed, created_by_person_id, created_at
           ) VALUES (
             'content_incomplete','content_incomplete',1,'urgent_alert','customer',
             'internal_review_only','en-US','US','routine',$1,false,false,$2,
             'local_simulation',false,false,false,false,'person-hq-heidi',$3
           )`,
          [digest, later.toISOString(), now.toISOString()],
        );
      }),
    ).rejects.toThrow('requires payload, source, claim, and initial-state evidence');

    await expect(
      database.query(
        `INSERT INTO governed_content_items(
           id, content_kind, title, review_state, claim_flags,
           created_by_person_id, approved_by_person_id, created_at, approved_at, published_at
         ) VALUES (
           'legacy_publication_blocked','alert','Synthetic local fixture','approved','[]'::jsonb,
           'person-hq-heidi','person-hq-heidi',$1,$1,$1
         )`,
        [now.toISOString()],
      ),
    ).rejects.toThrow();
    const retained = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM governed_content_items WHERE id = 'legacy_publication_blocked'",
    );
    expect(retained.rows[0]?.count).toBe(0);
  });
});
