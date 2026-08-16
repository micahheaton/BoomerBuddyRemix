import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@boomerbuddy/observability';
import {
  CheckRepository,
  createPGliteDatabase,
  runMigrations,
  seedDemoData,
  type Database,
} from '@boomerbuddy/persistence';
import { testArtifactProtection } from '@boomerbuddy/testkit';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app';
import {
  browserHeaders,
  createMutableClock,
  customerOrigin,
  login,
  testConfig,
} from '../integration/support';

interface PersistentApp {
  readonly app: FastifyInstance;
  readonly database: Database;
}

describe('one-shot local demo bootstrap', () => {
  const clock = createMutableClock();
  let directory: string | undefined;
  let current: PersistentApp | undefined;

  afterEach(async () => {
    await current?.app.close();
    await current?.database.close();
    current = undefined;
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  async function open(): Promise<PersistentApp> {
    if (directory === undefined) directory = await mkdtemp(join(tmpdir(), 'boomerbuddy-seed-'));
    const database = await createPGliteDatabase(directory);
    const base = testConfig();
    const app = await buildApp({
      config: {
        ...base,
        database: {
          driver: 'pglite',
          path: directory,
          runMigrations: true,
          seedDemo: true,
        },
      },
      database,
      closeDatabase: false,
      now: clock.now,
      logger: createLogger({ level: 'error', sink: () => undefined, clock: clock.now }),
    });
    current = { app, database };
    return current;
  }

  async function closeCurrent(): Promise<void> {
    if (current === undefined) return;
    await current.app.close();
    await current.database.close();
    current = undefined;
  }

  async function authoritySnapshot(database: Database) {
    const result = await database.query<
      {
        identity_status: string;
        consent_state: string;
        relationship_state: string;
        membership_status: string;
        invitation_state: string;
        grant_revoked: boolean;
        subscription_lifecycle: string;
        subscription_verified: boolean;
        shared_check_state: string;
        shared_artifact_state: string;
        private_check_state: string;
        private_artifact_state: string;
        share_count: number;
        marker_count: number;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT status FROM identities WHERE id = 'identity-trusted-terry') AS identity_status,
         (SELECT state FROM consent_current_projections
          WHERE household_id = 'household-sunrise'
            AND consent_id = 'consent-sunrise-pat-circle')
           AS consent_state,
         (SELECT state FROM trusted_circle_relationships
          WHERE household_id = 'household-sunrise'
            AND id = 'relationship-sunrise-pat-terry') AS relationship_state,
         (SELECT status FROM household_memberships
          WHERE household_id = 'household-sunrise'
            AND person_id = 'person-trusted-terry') AS membership_status,
         (SELECT state FROM invitations WHERE id = 'invitation-restart-proof') AS invitation_state,
         (SELECT revoked_at IS NOT NULL FROM entitlement_grants
          WHERE household_id = 'household-harbor' AND id = 'grant-local-harbor')
           AS grant_revoked,
         (SELECT lifecycle FROM commerce_subscriptions
          WHERE household_id = 'household-harbor' AND id = 'subscription-local-harbor')
           AS subscription_lifecycle,
         (SELECT source_verified FROM commerce_subscriptions
          WHERE household_id = 'household-harbor' AND id = 'subscription-local-harbor')
           AS subscription_verified,
         (SELECT state FROM analyses WHERE id = 'analysis-seed-sunrise-shared')
           AS shared_check_state,
         (SELECT state FROM artifacts WHERE id = 'artifact-seed-sunrise-shared')
           AS shared_artifact_state,
         (SELECT state FROM analyses WHERE id = 'analysis-seed-sunrise-private')
           AS private_check_state,
         (SELECT state FROM artifacts WHERE id = 'artifact-seed-sunrise-private')
           AS private_artifact_state,
         (SELECT count(*)::int FROM check_shares
          WHERE analysis_id = 'analysis-seed-sunrise-shared') AS share_count,
         (SELECT count(*)::int FROM local_demo_bootstraps
          WHERE bootstrap_key = 'run1-v1') AS marker_count`,
    );
    return result.rows[0];
  }

  it('never resurrects mutable authority or deleted content across two persistent restarts', async () => {
    const first = await open();
    const pat = await login(first.app, 'protected-pat');

    const invitation = await first.app.inject({
      method: 'POST',
      url: '/v1/family/invitations',
      headers: browserHeaders(pat.cookie as string),
      payload: { inviteeDisplayName: 'Restart proof', permissions: ['view_shared_checks'] },
    });
    expect(invitation.statusCode).toBe(201);
    const generatedInvitationId = String(invitation.json().invitation.id);
    await first.database.query(
      `UPDATE invitations SET id = 'invitation-restart-proof'
       WHERE id = $1`,
      [generatedInvitationId],
    );
    const cancel = await first.app.inject({
      method: 'DELETE',
      url: '/v1/family/invitations/invitation-restart-proof',
      headers: browserHeaders(pat.cookie as string),
    });
    expect(cancel.statusCode).toBe(200);

    const deleted = await first.app.inject({
      method: 'DELETE',
      url: '/v1/checks/analysis-seed-sunrise-shared',
      headers: browserHeaders(pat.cookie as string),
    });
    expect(deleted.statusCode).toBe(200);
    await first.database.query(
      `UPDATE artifacts SET delete_after = $1::timestamptz
       WHERE id = 'artifact-seed-sunrise-private'`,
      [new Date(clock.now().getTime() - 1_000).toISOString()],
    );
    const checks = new CheckRepository(first.database, testArtifactProtection());
    await expect(checks.purgeDue({ now: clock.now() })).resolves.toContain(
      'analysis-seed-sunrise-private',
    );

    const revokedRelationship = await first.app.inject({
      method: 'DELETE',
      url: '/v1/family/relationships/relationship-sunrise-pat-terry',
      headers: browserHeaders(pat.cookie as string),
    });
    expect(revokedRelationship.statusCode).toBe(200);
    await first.database.query(
      `UPDATE identities SET status = 'disabled' WHERE id = 'identity-trusted-terry'`,
    );
    await first.database.query(
      `UPDATE entitlement_grants SET revoked_at = $1
       WHERE household_id = 'household-harbor' AND id = 'grant-local-harbor'`,
      [clock.now().toISOString()],
    );
    await first.database.query(
      `UPDATE commerce_subscriptions
       SET lifecycle = 'expired', source_verified = false, updated_at = $1
       WHERE household_id = 'household-harbor' AND id = 'subscription-local-harbor'`,
      [clock.now().toISOString()],
    );
    const before = await authoritySnapshot(first.database);
    expect(before).toMatchObject({
      identity_status: 'disabled',
      consent_state: 'withdrawn',
      relationship_state: 'withdrawn',
      membership_status: 'active',
      invitation_state: 'withdrawn',
      grant_revoked: true,
      subscription_lifecycle: 'expired',
      subscription_verified: false,
      shared_check_state: 'deleted',
      shared_artifact_state: 'deleted',
      private_check_state: 'deleted',
      private_artifact_state: 'deleted',
      share_count: 0,
      marker_count: 1,
    });

    await closeCurrent();
    const second = await open();
    expect(await authoritySnapshot(second.database)).toEqual(before);
    const disabledLogin = await second.app.inject({
      method: 'POST',
      url: '/v1/dev/sessions/customer',
      headers: { origin: customerOrigin },
      payload: { personaId: 'trusted-terry' },
    });
    expect(disabledLogin.statusCode).toBe(404);

    await closeCurrent();
    const third = await open();
    expect(await authoritySnapshot(third.database)).toEqual(before);
    expect(
      await third.database.query(
        `SELECT 1 FROM local_demo_bootstraps WHERE bootstrap_key = 'run1-v1'`,
      ),
    ).toMatchObject({ rowCount: 1 });
  }, 60_000);

  it('refuses to overlay fixtures onto an unmarked non-empty database', async () => {
    const database = await createPGliteDatabase(':memory:');
    try {
      await runMigrations(database);
      await database.query(
        `INSERT INTO persons(id, display_name, created_at)
         VALUES ('person-existing','Existing Person',$1)`,
        [clock.now().toISOString()],
      );
      await expect(seedDemoData(database, testArtifactProtection(), clock.now())).rejects.toThrow(
        'requires an empty local database',
      );
      const existing = await database.query<{ display_name: string }>(
        `SELECT display_name FROM persons WHERE id = 'person-existing'`,
      );
      expect(existing.rows[0]?.display_name).toBe('Existing Person');
      expect(await database.query(`SELECT 1 FROM local_demo_bootstraps`)).toMatchObject({
        rowCount: 0,
      });
    } finally {
      await database.close();
    }
  });
});
