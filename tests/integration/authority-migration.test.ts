import { readFile } from 'node:fs/promises';
import { createPGliteDatabase, migrationDirectory } from '@boomerbuddy/persistence';
import { describe, expect, it } from 'vitest';

describe('Run 2 authority migration', () => {
  it('migrates populated Run 1 authority and pending invitation data forward', async () => {
    const database = await createPGliteDatabase(':memory:');
    try {
      const directory = await migrationDirectory();
      await database.exec(await readFile(`${directory}/0001_initial.sql`, 'utf8'));
      const now = '2026-08-15T12:00:00.000Z';
      await database.query(
        `INSERT INTO persons(id, display_name, created_at) VALUES
           ('person-owner','Owner',$1),
           ('person-protected','Protected',$1),
           ('person-trusted','Trusted',$1)`,
        [now],
      );
      await database.query(
        `INSERT INTO households(id, name, created_at)
         VALUES ('household-migrated','Migrated household',$1)`,
        [now],
      );
      await database.query(
        `INSERT INTO household_memberships(
           household_id, id, person_id, role, status, permissions, created_at
         ) VALUES
           ('household-migrated','membership-owner','person-owner',
            'household_owner','active','[]'::jsonb,$1),
           ('household-migrated','membership-protected','person-protected',
            'protected_member','active','[]'::jsonb,$1),
           ('household-migrated','membership-trusted','person-trusted',
            'trusted_circle','active','["view_shared_checks"]'::jsonb,$1)`,
        [now],
      );
      await database.query(
        `INSERT INTO consents(
           household_id, id, protected_person_id, granted_by_person_id, purpose,
           consent_version, state, granted_at
         ) VALUES
           ('household-migrated','consent-invitation-legacy','person-protected',
            'person-protected','trusted_circle','legacy-invitation-v1','active',$1),
           ('household-migrated','consent-relationship-legacy','person-protected',
            'person-protected','trusted_circle','legacy-relationship-v1','active',$1)`,
        [now],
      );
      await database.query(
        `INSERT INTO invitations(
           household_id, id, invited_by_person_id, protected_person_id, consent_id,
           invitee_display_name, invite_code_fingerprint, fingerprint_key_version,
           permissions, state, expires_at, created_at
         ) VALUES ('household-migrated','invitation-legacy','person-protected',
           'person-protected','consent-invitation-legacy','Trusted','legacy-fingerprint',1,
           '["view_shared_checks"]'::jsonb,'pending','2026-08-20T12:00:00.000Z',$1)`,
        [now],
      );
      await database.query(
        `INSERT INTO trusted_circle_relationships(
           household_id, id, protected_person_id, trusted_person_id, permissions,
           consent_id, consent_version, state, created_at
         ) VALUES ('household-migrated','relationship-legacy','person-protected',
           'person-trusted','["view_shared_checks"]'::jsonb,'consent-relationship-legacy',
           'legacy-relationship-v1','active',$1)`,
        [now],
      );

      await database.exec(await readFile(`${directory}/0002_run2_authority_consent.sql`, 'utf8'));

      const facts = await database.query<{
        member_kinds: number;
        administrators: number;
        billing_authorities: number;
        canonical_consents: number;
        invitation_evidence: number;
        relationship_evidence: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM household_memberships
            WHERE household_id = 'household-migrated' AND membership_kind = 'member')
              AS member_kinds,
           (SELECT count(*)::int FROM household_administrator_assignments
            WHERE household_id = 'household-migrated' AND person_id = 'person-owner'
              AND status = 'active') AS administrators,
           (SELECT count(*)::int FROM household_billing_authorities
            WHERE household_id = 'household-migrated' AND person_id = 'person-owner'
              AND status = 'active') AS billing_authorities,
           (SELECT count(*)::int FROM consents
            WHERE household_id = 'household-migrated'
              AND purpose = 'trusted_circle_relationship') AS canonical_consents,
           (SELECT count(*)::int FROM invitations invitation
            JOIN consent_current_projections projection
              ON projection.household_id = invitation.household_id
             AND projection.consent_id = invitation.consent_id
             AND projection.latest_evidence_id = invitation.latest_consent_evidence_id
            WHERE invitation.id = 'invitation-legacy'
              AND invitation.identity_binding_state = 'development_unbound'
              AND projection.state = 'proposed') AS invitation_evidence,
           (SELECT count(*)::int FROM trusted_circle_relationships relationship
            JOIN consent_current_projections projection
              ON projection.household_id = relationship.household_id
             AND projection.consent_id = relationship.consent_id
             AND projection.latest_evidence_id = relationship.latest_consent_evidence_id
            WHERE relationship.id = 'relationship-legacy'
              AND projection.state = 'active') AS relationship_evidence`,
      );
      expect(facts.rows[0]).toEqual({
        member_kinds: 3,
        administrators: 1,
        billing_authorities: 1,
        canonical_consents: 2,
        invitation_evidence: 1,
        relationship_evidence: 1,
      });
      await expect(
        database.query(
          `UPDATE invitations
           SET identity_binding_state = 'verified_identity',
               intended_identity_issuer = 'verified-idp',
               intended_identity_subject = 'trusted-subject'
           WHERE household_id = 'household-migrated' AND id = 'invitation-legacy'`,
        ),
      ).rejects.toThrow('invitation lifecycle changes require new consent evidence');
      await expect(
        database.query(
          `INSERT INTO invitations(
             household_id, id, invited_by_person_id, protected_person_id, consent_id,
             latest_consent_evidence_id, invitee_display_name, invite_code_fingerprint,
             fingerprint_key_version, permissions, state, identity_binding_state,
             intended_identity_issuer, intended_identity_subject, expires_at, created_at
           ) SELECT household_id, 'invitation-dev-bound', invited_by_person_id,
               protected_person_id, consent_id, latest_consent_evidence_id,
               invitee_display_name, 'dev-bound-fingerprint', fingerprint_key_version,
               permissions, 'pending', 'verified_identity', 'boomerbuddy-dev',
               'trusted-subject', expires_at, created_at
             FROM invitations WHERE id = 'invitation-legacy'`,
        ),
      ).rejects.toThrow('invitations_identity_binding_check');
      await database.query(
        `INSERT INTO invitations(
           household_id, id, invited_by_person_id, protected_person_id, consent_id,
           latest_consent_evidence_id, invitee_display_name, invite_code_fingerprint,
           fingerprint_key_version, permissions, state, identity_binding_state,
           intended_identity_issuer, intended_identity_subject, expires_at, created_at
         ) SELECT household_id, 'invitation-verified-bound', invited_by_person_id,
             protected_person_id, consent_id, latest_consent_evidence_id,
             invitee_display_name, 'verified-bound-fingerprint', fingerprint_key_version,
             permissions, 'pending', 'verified_identity', 'verified-idp',
             'trusted-subject', expires_at, created_at
           FROM invitations WHERE id = 'invitation-legacy'`,
      );
      const verifiedBinding = await database.query<{
        identity_binding_state: string;
        intended_identity_issuer: string;
        intended_identity_subject: string;
      }>(
        `SELECT identity_binding_state, intended_identity_issuer, intended_identity_subject
         FROM invitations WHERE id = 'invitation-verified-bound'`,
      );
      expect(verifiedBinding.rows[0]).toEqual({
        identity_binding_state: 'verified_identity',
        intended_identity_issuer: 'verified-idp',
        intended_identity_subject: 'trusted-subject',
      });
    } finally {
      await database.close();
    }
  });
});
