import {
  createPGliteDatabase,
  FamilyRepository,
  runMigrations,
  seedDemoData,
  SessionRepository,
  type Database,
} from '@boomerbuddy/persistence';
import { afterEach, describe, expect, it } from 'vitest';

interface AuthorityHarness {
  readonly database: Database;
  readonly clock: { readonly now: () => Date };
  readonly close: () => Promise<void>;
}

async function createAuthorityHarness(): Promise<AuthorityHarness> {
  const now = new Date('2026-08-15T12:00:00.000Z');
  const database = await createPGliteDatabase(':memory:');
  await runMigrations(database);
  await seedDemoData(
    database,
    {
      encryptionKey: Buffer.alloc(32, 7),
      encryptionKeyVersion: 1,
      fingerprintKey: Buffer.alloc(32, 11),
      fingerprintKeyVersion: 1,
    },
    now,
  );
  return {
    database,
    clock: { now: () => new Date(now) },
    close: () => database.close(),
  };
}

describe('authority and consent persistence', () => {
  let harness: AuthorityHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('projects support eligibility, case assignment, and restricted grant as separate scopes', async () => {
    harness = await createAuthorityHarness();
    const now = harness.clock.now();
    const grantExpiry = new Date(now.getTime() + 60 * 60 * 1_000);
    const sessionExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
    await harness.database.query(
      `INSERT INTO persons(id, display_name, created_at)
       VALUES ('person-hq-support','Support Specialist',$1)`,
      [now.toISOString()],
    );
    await harness.database.query(
      `INSERT INTO identities(id, person_id, issuer, subject, status, created_at)
       VALUES ('identity-hq-support','person-hq-support','boomerbuddy-dev',
         'hq-support','active',$1)`,
      [now.toISOString()],
    );
    await harness.database.query(
      `INSERT INTO employee_assignments(
         id, person_id, organization_id, role, status, created_at
       ) VALUES ('employee-hq-support','person-hq-support','organization-boomerbuddy',
         'hq_support','active',$1)`,
      [now.toISOString()],
    );
    await harness.database.query(
      `INSERT INTO sessions(
         id, person_id, audience, issuer, identity_id, identity_subject,
         provider_session_id, issued_at, last_verified_at, expires_at, created_at
       ) VALUES (
         'session-hq-support','person-hq-support','hq','boomerbuddy-dev',
         'identity-hq-support','hq-support','session-hq-support',$1,$1,$2,$1
       )`,
      [now.toISOString(), sessionExpiry.toISOString()],
    );
    await harness.database.query(
      `INSERT INTO support_cases(
         household_id, id, purpose, status, opened_by_person_id, opened_at
       ) VALUES ('household-sunrise','support-case-exact','Resolve explicit customer request',
         'open','person-owner-alice',$1)`,
      [now.toISOString()],
    );
    await harness.database.query(
      `INSERT INTO support_case_assignments(
         household_id, case_id, employee_assignment_id, status, assigned_at
       ) VALUES ('household-sunrise','support-case-exact','employee-hq-support','active',$1)`,
      [now.toISOString()],
    );
    await harness.database.query(
      `INSERT INTO restricted_access_grants(
         household_id, id, case_id, employee_assignment_id, resource_type,
         resource_id, purpose, assurance, status, granted_by_person_id,
         granted_at, expires_at
       ) VALUES
         ('household-sunrise','restricted-grant-exact','support-case-exact',
          'employee-hq-support','artifact','artifact-exact','Inspect customer-selected artifact',
          'step_up_verified','active','person-owner-alice',$1,$2),
         ('household-sunrise','restricted-grant-message','support-case-exact',
          'employee-hq-support','messaging_inbound','message-event-exact','customer_support',
          'step_up_verified','active','person-owner-alice',$1,$2)`,
      [now.toISOString(), grantExpiry.toISOString()],
    );

    const sessions = new SessionRepository(harness.database);
    const active = await sessions.resolve('session-hq-support', 'hq', now);
    expect(active?.principal.employeeScopes).toEqual([
      expect.objectContaining({
        employeeAssignmentId: 'employee-hq-support',
        role: 'hq_support',
        status: 'active',
      }),
    ]);
    expect(active?.principal.supportCaseScopes).toEqual([
      expect.objectContaining({
        caseId: 'support-case-exact',
        householdId: 'household-sunrise',
        employeeAssignmentId: 'employee-hq-support',
      }),
    ]);
    expect(active?.principal.restrictedAccessScopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          grantId: 'restricted-grant-exact',
          caseId: 'support-case-exact',
          resourceType: 'artifact',
          resourceId: 'artifact-exact',
        }),
        expect.objectContaining({
          grantId: 'restricted-grant-message',
          caseId: 'support-case-exact',
          purpose: 'customer_support',
          resourceType: 'messaging_inbound',
          resourceId: 'message-event-exact',
        }),
      ]),
    );
    expect(active?.principal.restrictedAccessScopes).toHaveLength(2);

    const afterGrantExpiry = await sessions.resolve(
      'session-hq-support',
      'hq',
      new Date(grantExpiry.getTime() + 1),
    );
    expect(afterGrantExpiry?.principal.supportCaseScopes).toHaveLength(1);
    expect(afterGrantExpiry?.principal.restrictedAccessScopes).toEqual([]);

    await harness.database.query(
      `UPDATE support_case_assignments
       SET status = 'ended', ended_at = $1
       WHERE household_id = 'household-sunrise' AND case_id = 'support-case-exact'
         AND employee_assignment_id = 'employee-hq-support'`,
      [now.toISOString()],
    );
    const afterAssignmentEnds = await sessions.resolve('session-hq-support', 'hq', now);
    expect(afterAssignmentEnds?.principal.supportCaseScopes).toEqual([]);
    expect(afterAssignmentEnds?.principal.restrictedAccessScopes).toEqual([]);
  });

  it('rejects mutation or deletion of recorded consent evidence', async () => {
    harness = await createAuthorityHarness();
    await expect(
      harness.database.query(
        `UPDATE consent_evidence SET source_interaction = 'tampered'
         WHERE household_id = 'household-sunrise'
           AND id = 'evidence-sunrise-pat-terry'`,
      ),
    ).rejects.toThrow('consent evidence is append-only');
    await expect(
      harness.database.query(
        `DELETE FROM consent_evidence
         WHERE household_id = 'household-sunrise'
           AND id = 'evidence-sunrise-pat-terry'`,
      ),
    ).rejects.toThrow('consent evidence is append-only');
  });

  it('requires verified issuer and subject binding outside development', async () => {
    harness = await createAuthorityHarness();
    const now = harness.clock.now();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
    await harness.database.query(
      `INSERT INTO identities(id, person_id, issuer, subject, status, created_at) VALUES
         ('identity-pat-verified','person-protected-pat','verified-idp','pat-verified','active',$1),
         ('identity-jordan-verified','person-trusted-jordan','verified-idp',
          'jordan-verified','active',$1)`,
      [now.toISOString()],
    );
    await harness.database.query(
      `INSERT INTO sessions(
         id, person_id, audience, issuer, identity_id, identity_subject,
         provider_session_id, issued_at, last_verified_at, expires_at, created_at
       ) VALUES
         ('session-pat-verified','person-protected-pat','customer','verified-idp',
          'identity-pat-verified','pat-verified','session-pat-verified',$1,$1,$2,$1),
         ('session-jordan-verified','person-trusted-jordan','customer','verified-idp',
          'identity-jordan-verified','jordan-verified','session-jordan-verified',$1,$1,$2,$1)`,
      [now.toISOString(), expiresAt.toISOString()],
    );
    const family = new FamilyRepository(harness.database, Buffer.alloc(32, 11), 1);
    const base = {
      householdId: 'household-sunrise',
      invitedByPersonId: 'person-protected-pat',
      protectedPersonId: 'person-protected-pat',
      inviteeDisplayName: 'Jordan Verified',
      permissions: ['view_shared_checks'] as const,
      audience: 'customer' as const,
      sessionId: 'session-pat-verified',
      correlationId: 'correlation-verified-invitation',
      now,
    };
    await expect(
      family.createInvitation({
        ...base,
        actorIssuer: 'boomerbuddy-dev',
        intendedIdentity: { issuer: 'boomerbuddy-dev', subject: 'trusted-jordan' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      family.createInvitation({ ...base, actorIssuer: 'verified-idp' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });

    const created = await family.createInvitation({
      ...base,
      actorIssuer: 'verified-idp',
      intendedIdentity: { issuer: 'verified-idp', subject: 'jordan-verified' },
    });
    expect(created.invitation.identityBindingState).toBe('verified_identity');
    const credential = await family.validateInvitationCredential(
      created.invitation.id,
      created.localInviteCode,
      now,
    );
    expect(credential).toMatchObject({
      identityBindingState: 'verified_identity',
      invitedPersonId: 'person-trusted-jordan',
    });
    const accepted = await family.acceptInvitation({
      invitationId: created.invitation.id,
      localInviteCode: created.localInviteCode,
      previewVersion: credential!.consentVersion,
      acceptingPersonId: 'person-trusted-jordan',
      audience: 'customer',
      actorIssuer: 'verified-idp',
      sessionId: 'session-jordan-verified',
      correlationId: 'correlation-verified-acceptance',
      now,
    });
    expect(accepted).toMatchObject({
      protectedPersonId: 'person-protected-pat',
      trustedPersonId: 'person-trusted-jordan',
      state: 'active',
    });
    const identity = await harness.database.query<{
      accepted_identity_issuer: string;
      accepted_identity_subject: string;
    }>(
      `SELECT accepted_identity_issuer, accepted_identity_subject
       FROM invitations WHERE id = $1`,
      [created.invitation.id],
    );
    expect(identity.rows[0]).toEqual({
      accepted_identity_issuer: 'verified-idp',
      accepted_identity_subject: 'jordan-verified',
    });
  });
});
