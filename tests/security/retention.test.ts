import { CheckRepository } from '@boomerbuddy/persistence';
import { afterEach, describe, expect, it } from 'vitest';
import {
  browserHeaders,
  createApiHarness,
  login,
  testConfig,
  type ApiHarness,
} from '../integration/support';

describe('content-destroying Check retention', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('fails closed before a due purge and scrubs findings for both deletion paths', async () => {
    harness = await createApiHarness();
    const pat = await login(harness.app, 'protected-pat');
    const headers = browserHeaders(pat.cookie as string);
    const create = async (content: string) => {
      const response = await harness!.app.inject({
        method: 'POST',
        url: '/v1/checks',
        headers,
        payload: { kind: 'text', content },
      });
      expect(response.statusCode).toBe(201);
      return String(response.json().check.id);
    };
    const userDeletedId = await create('A local user deletion example with urgency.');
    const dueId = await create('A local due retention example with urgency.');
    for (const checkId of [userDeletedId, dueId]) {
      const shared = await harness.app.inject({
        method: 'POST',
        url: `/v1/checks/${checkId}/shares`,
        headers,
        payload: { sharedWithPersonId: 'person-trusted-terry' },
      });
      expect(shared.statusCode).toBe(201);
    }
    const marker = 'DISTINCTIVE_INCIDENT_CONTEXT_8472';
    await harness.database.query(
      `UPDATE analyses SET summary = $2::text,
         evidence = jsonb_build_array(jsonb_build_object('marker',$2::text)),
         actions = jsonb_build_array(jsonb_build_object('detail',$2::text))
       WHERE id IN ($1,$3)`,
      [userDeletedId, marker, dueId],
    );
    const userDeleted = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/checks/${userDeletedId}`,
      headers,
    });
    expect(userDeleted.statusCode).toBe(200);

    await harness.database.query(
      `UPDATE artifacts SET delete_after = $2
       WHERE household_id = 'household-sunrise'
         AND id = (SELECT artifact_id FROM analyses
                   WHERE household_id = 'household-sunrise' AND id = $1)`,
      [dueId, new Date(harness.clock.now().getTime() - 1).toISOString()],
    );
    const hiddenDetail = await harness.app.inject({
      method: 'GET',
      url: `/v1/checks/${dueId}`,
      headers,
    });
    const hiddenList = await harness.app.inject({
      method: 'GET',
      url: '/v1/checks',
      headers,
    });
    expect(hiddenDetail.statusCode).toBe(404);
    expect(hiddenList.json().checks.map((check: { id: string }) => check.id)).not.toContain(dueId);

    const config = testConfig();
    const repository = new CheckRepository(harness.database, {
      encryptionKey: config.secrets.artifactEncryptionKey,
      encryptionKeyVersion: 1,
      fingerprintKey: config.secrets.fingerprintKey,
      fingerprintKeyVersion: 1,
    });
    await expect(
      repository.share({
        checkId: dueId,
        householdId: 'household-sunrise',
        ownerPersonId: 'person-protected-pat',
        sharedWithPersonId: 'person-trusted-terry',
        audience: 'customer',
        correlationId: 'correlation-expired-share',
        now: harness.clock.now(),
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });
    await expect(repository.purgeDue({ now: harness.clock.now(), limit: 100 })).resolves.toEqual([
      dueId,
    ]);
    await expect(repository.purgeDue({ now: harness.clock.now(), limit: 100 })).resolves.toEqual(
      [],
    );

    const rows = await harness.database.query<{
      id: string;
      artifact_state: string;
      encrypted_content: string | null;
      input_fingerprint: string | null;
      analysis_state: string;
      risk: string;
      evidence_sufficiency: string;
      summary: string;
      evidence: unknown;
      actions: unknown;
      provider_state: string;
      shares: number;
    }>(
      `SELECT a.id, r.state AS artifact_state, r.encrypted_content, r.input_fingerprint,
              a.state AS analysis_state, a.risk, a.evidence_sufficiency, a.summary,
              a.evidence, a.actions, a.provider_state,
              (SELECT count(*)::int FROM check_shares s
               WHERE s.household_id = a.household_id AND s.analysis_id = a.id) AS shares
       FROM analyses a
       JOIN artifacts r ON r.household_id = a.household_id AND r.id = a.artifact_id
       WHERE a.id IN ($1,$2) ORDER BY a.id`,
      [userDeletedId, dueId],
    );
    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) {
      expect(row).toMatchObject({
        artifact_state: 'deleted',
        encrypted_content: null,
        input_fingerprint: null,
        analysis_state: 'deleted',
        risk: 'unknown',
        evidence_sufficiency: 'limited',
        summary: 'Deleted',
        evidence: [],
        actions: [],
        provider_state: 'unavailable',
        shares: 0,
      });
    }
    const proofs = await harness.database.query<{ serialized: string }>(
      `SELECT coalesce(string_agg(metadata::text, ' '),'') || ' ' ||
              coalesce((SELECT string_agg(payload::text, ' ') FROM outbox_events
                        WHERE aggregate_id IN ($1,$2)),'') AS serialized
       FROM audit_events WHERE resource_id IN ($1,$2)`,
      [userDeletedId, dueId],
    );
    expect(proofs.rows[0]?.serialized).not.toContain(marker);
  }, 30_000);

  it('periodically drains more than one bounded batch without waiting for restart', async () => {
    harness = await createApiHarness(undefined, { retentionSweepIntervalMs: 20 });
    const dueAt = new Date(harness.clock.now().getTime() - 1).toISOString();
    const createdAt = new Date(harness.clock.now().getTime() - 31 * 86_400_000).toISOString();
    await harness.database.query(
      `INSERT INTO artifacts(
           household_id, id, owner_person_id, kind, encrypted_content, input_fingerprint,
           encryption_key_version, fingerprint_key_version, state, delete_after, created_at
         ) SELECT 'household-sunrise', 'artifact-retention-bulk-' || n::text,
             'person-protected-pat', 'text', 'bulk-ciphertext-marker',
             'bulk-fingerprint-marker', 1, 1, 'active', $1, $2
           FROM generate_series(1,101) AS n`,
      [dueAt, createdAt],
    );
    await harness.database.query(
      `INSERT INTO analyses(
           household_id, id, artifact_id, requested_by, risk, evidence_sufficiency,
           calibration, summary, evidence, actions, provider_name, provider_state,
           provider_version, ruleset_version, state, created_at
         ) SELECT 'household-sunrise', 'analysis-retention-bulk-' || n::text,
             'artifact-retention-bulk-' || n::text, 'person-protected-pat', 'caution',
             'limited', 'not_calibrated', 'bulk-content-marker',
             '[{"marker":"bulk-content-marker"}]'::jsonb,
             '[{"detail":"bulk-content-marker"}]'::jsonb,
             'local-unknown', 'mock', 'run1', 'run1', 'completed', $1
           FROM generate_series(1,101) AS n`,
      [createdAt],
    );

    let active = 101;
    for (let attempt = 0; attempt < 200 && active > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const count = await harness.database.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM artifacts
           WHERE id LIKE 'artifact-retention-bulk-%' AND state = 'active'`,
      );
      active = count.rows[0]?.count ?? active;
    }
    expect(active).toBe(0);
    const tombstones = await harness.database.query<{
      total: number;
      scrubbed_artifacts: number;
      scrubbed_analyses: number;
      audit_proofs: number;
      outbox_proofs: number;
    }>(
      `SELECT
           (SELECT count(*)::int FROM artifacts
            WHERE id LIKE 'artifact-retention-bulk-%') AS total,
           (SELECT count(*)::int FROM artifacts
            WHERE id LIKE 'artifact-retention-bulk-%' AND state = 'deleted'
              AND encrypted_content IS NULL AND input_fingerprint IS NULL) AS scrubbed_artifacts,
           (SELECT count(*)::int FROM analyses
            WHERE id LIKE 'analysis-retention-bulk-%' AND state = 'deleted'
              AND summary = 'Deleted' AND evidence = '[]'::jsonb AND actions = '[]'::jsonb)
             AS scrubbed_analyses,
           (SELECT count(*)::int FROM audit_events
            WHERE action = 'check.retention_deleted'
              AND resource_id LIKE 'analysis-retention-bulk-%') AS audit_proofs,
           (SELECT count(*)::int FROM outbox_events
            WHERE event_type = 'check.retention_deleted.v1'
              AND aggregate_id LIKE 'analysis-retention-bulk-%') AS outbox_proofs`,
    );
    expect(tombstones.rows[0]).toEqual({
      total: 101,
      scrubbed_artifacts: 101,
      scrubbed_analyses: 101,
      audit_proofs: 101,
      outbox_proofs: 101,
    });
    const serialized = await harness.database.query<{ payloads: string }>(
      `SELECT string_agg(payload::text, ' ') AS payloads FROM outbox_events
         WHERE aggregate_id LIKE 'analysis-retention-bulk-%'`,
    );
    expect(serialized.rows[0]?.payloads).not.toContain('bulk-content-marker');
  }, 30_000);
});
