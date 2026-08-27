import { afterEach, describe, expect, it } from 'vitest';
import { TrustedCircleAttentionRepository } from '@boomerbuddy/persistence';
import {
  bearerHeaders,
  browserHeaders,
  createApiHarness,
  customerOrigin,
  hqOrigin,
  login,
  type ApiHarness,
} from './support';

const attentionUrl = '/v1/trusted-circle/attention';

describe('Trusted Circle in-app attention', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('returns a content-free pending acknowledgement only to the exact recipient', async () => {
    harness = await createApiHarness();
    const terry = await login(harness.app, 'trusted-terry');
    const mobileTerry = await login(harness.app, 'trusted-terry', 'mobile');
    const alice = await login(harness.app, 'owner-alice');
    const bob = await login(harness.app, 'owner-bob');
    const jordan = await login(harness.app, 'trusted-jordan');
    const heidi = await login(harness.app, 'hq-heidi', 'hq');

    const exactRecipient = await harness.app.inject({
      method: 'GET',
      url: attentionUrl,
      headers: browserHeaders(terry.cookie as string),
    });
    expect(exactRecipient.statusCode, exactRecipient.body).toBe(200);
    expect(exactRecipient.headers['cache-control']).toBe('private, no-store, max-age=0');
    expect(exactRecipient.json()).toEqual({
      pendingAcknowledgementCount: 1,
      pendingAcknowledgements: [
        {
          checkId: 'analysis-seed-sunrise-shared',
          attentionKind: 'shared_check_needs_acknowledgement',
          sharedAt: '2026-08-15T12:00:00.000Z',
        },
      ],
      page: { limit: 20, hasMore: false },
    });
    expect(Object.keys(exactRecipient.json().pendingAcknowledgements[0]).sort()).toEqual([
      'attentionKind',
      'checkId',
      'sharedAt',
    ]);
    expect(exactRecipient.body).not.toMatch(
      /Synthetic bank alert|Pat Protected|person-protected-pat|household-sunrise|summary|evidence|actions/iu,
    );

    const mobileRecipient = await harness.app.inject({
      method: 'GET',
      url: attentionUrl,
      headers: bearerHeaders(mobileTerry.token as string),
    });
    expect(mobileRecipient.statusCode, mobileRecipient.body).toBe(200);
    expect(mobileRecipient.json()).toEqual(exactRecipient.json());

    for (const session of [alice, bob]) {
      const otherMember = await harness.app.inject({
        method: 'GET',
        url: attentionUrl,
        headers: browserHeaders(session.cookie as string),
      });
      expect(otherMember.statusCode, otherMember.body).toBe(200);
      expect(otherMember.json()).toEqual({
        pendingAcknowledgementCount: 0,
        pendingAcknowledgements: [],
        page: { limit: 20, hasMore: false },
      });
    }

    const crossHousehold = await harness.app.inject({
      method: 'GET',
      url: attentionUrl,
      headers: {
        ...browserHeaders(bob.cookie as string),
        'x-bb-household-id': 'household-sunrise',
      },
    });
    expect(crossHousehold.statusCode, crossHousehold.body).toBe(403);
    expect(crossHousehold.body).not.toContain('analysis-seed-sunrise-shared');

    const unassigned = await harness.app.inject({
      method: 'GET',
      url: attentionUrl,
      headers: browserHeaders(jordan.cookie as string),
    });
    expect(unassigned.statusCode, unassigned.body).toBe(403);

    const wrongAudience = await harness.app.inject({
      method: 'GET',
      url: attentionUrl,
      headers: browserHeaders(heidi.cookie as string, hqOrigin),
    });
    expect(wrongAudience.statusCode, wrongAudience.body).toBe(401);
    expect(wrongAudience.body).not.toContain('analysis-seed-sunrise-shared');
  }, 20_000);

  it('removes attention immediately when the exact recipient relinquishes the relationship', async () => {
    harness = await createApiHarness();
    const terry = await login(harness.app, 'trusted-terry');
    const headers = browserHeaders(terry.cookie as string, customerOrigin);

    const before = await harness.app.inject({ method: 'GET', url: attentionUrl, headers });
    expect(before.json().pendingAcknowledgementCount).toBe(1);

    const relinquished = await harness.app.inject({
      method: 'DELETE',
      url: '/v1/family/relationships/relationship-sunrise-pat-terry',
      headers,
    });
    expect(relinquished.statusCode, relinquished.body).toBe(200);
    expect(relinquished.json().state).toBe('relinquished');

    const after = await harness.app.inject({ method: 'GET', url: attentionUrl, headers });
    expect(after.statusCode, after.body).toBe(200);
    expect(after.json()).toEqual({
      pendingAcknowledgementCount: 0,
      pendingAcknowledgements: [],
      page: { limit: 20, hasMore: false },
    });
  }, 20_000);

  it('removes an acknowledged share from pending attention', async () => {
    harness = await createApiHarness();
    const terry = await login(harness.app, 'trusted-terry');
    const headers = browserHeaders(terry.cookie as string);

    const acknowledged = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks/analysis-seed-sunrise-shared/share-acknowledgement',
      headers,
      payload: {},
    });
    expect(acknowledged.statusCode, acknowledged.body).toBe(200);

    const attention = await harness.app.inject({ method: 'GET', url: attentionUrl, headers });
    expect(attention.statusCode, attention.body).toBe(200);
    expect(attention.json()).toEqual({
      pendingAcknowledgementCount: 0,
      pendingAcknowledgements: [],
      page: { limit: 20, hasMore: false },
    });
  }, 20_000);

  it('fails closed when a stale share remains after recipient membership revocation', async () => {
    harness = await createApiHarness();
    const terry = await login(harness.app, 'trusted-terry');
    const headers = browserHeaders(terry.cookie as string);

    await harness.database.query(
      `UPDATE household_memberships
       SET status = 'revoked', revoked_at = $1
       WHERE household_id = 'household-sunrise' AND person_id = 'person-trusted-terry'`,
      [harness.clock.now().toISOString()],
    );
    const retainedShare = await harness.database.query<{ readonly count: number }>(
      `SELECT count(*)::integer AS count FROM check_shares
       WHERE household_id = 'household-sunrise'
         AND shared_with_person_id = 'person-trusted-terry'`,
    );
    expect(retainedShare.rows[0]?.count).toBe(1);
    const directAttention = await new TrustedCircleAttentionRepository(
      harness.database,
    ).pendingAcknowledgements({
      householdId: 'household-sunrise',
      recipientPersonId: 'person-trusted-terry',
      now: harness.clock.now(),
    });
    expect(directAttention).toEqual({
      pendingAcknowledgementCount: 0,
      pendingAcknowledgements: [],
      hasMore: false,
    });

    const staleSession = await harness.app.inject({ method: 'GET', url: attentionUrl, headers });
    expect(staleSession.statusCode).toBe(403);
    expect(staleSession.body).not.toContain('analysis-seed-sunrise-shared');
  }, 20_000);

  it('caps the list at twenty while preserving the exact pending count', async () => {
    harness = await createApiHarness();
    const terry = await login(harness.app, 'trusted-terry');
    const now = harness.clock.now().toISOString();
    const deleteAfter = new Date(harness.clock.now().getTime() + 30 * 24 * 60 * 60 * 1_000);

    await harness.database.transaction(async (transaction) => {
      for (let index = 0; index < 25; index += 1) {
        const artifactId = `artifact-attention-${index}`;
        const analysisId = `analysis-attention-${index}`;
        await transaction.query(
          `INSERT INTO artifacts(
             household_id, id, owner_person_id, kind, encrypted_content, input_fingerprint,
             encryption_key_version, fingerprint_key_version, state, delete_after, created_at
           ) VALUES (
             'household-sunrise',$1,'person-protected-pat','text',$2,$3,1,1,'active',$4,$5
           )`,
          [
            artifactId,
            `synthetic-encrypted-${index}`,
            `synthetic-fingerprint-${index}`,
            deleteAfter,
            now,
          ],
        );
        await transaction.query(
          `INSERT INTO analyses(
             household_id, id, artifact_id, requested_by, risk, evidence_sufficiency,
             calibration, summary, evidence, actions, provider_name, provider_state,
             provider_version, ruleset_version, state, created_at
           ) VALUES (
             'household-sunrise',$1,$2,'person-protected-pat','unknown','limited',
             'not_calibrated',$3,'[]'::jsonb,'[]'::jsonb,'test','mock','test','test',
             'completed',$4
           )`,
          [analysisId, artifactId, `raw-attention-marker-${index}`, now],
        );
        await transaction.query(
          `INSERT INTO check_shares(
             household_id, analysis_id, relationship_id, shared_with_person_id,
             shared_by_person_id, created_at
           ) VALUES (
             'household-sunrise',$1,'relationship-sunrise-pat-terry',
             'person-trusted-terry','person-protected-pat',$2
           )`,
          [analysisId, now],
        );
      }
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: attentionUrl,
      headers: browserHeaders(terry.cookie as string),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().pendingAcknowledgementCount).toBe(26);
    expect(response.json().pendingAcknowledgements).toHaveLength(20);
    expect(response.json().page).toEqual({ limit: 20, hasMore: true });
    expect(response.body).not.toContain('raw-attention-marker');
    for (const item of response.json().pendingAcknowledgements) {
      expect(Object.keys(item).sort()).toEqual(['attentionKind', 'checkId', 'sharedAt']);
    }
  }, 30_000);
});
