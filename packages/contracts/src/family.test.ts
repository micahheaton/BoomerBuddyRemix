import { describe, expect, it } from 'vitest';
import {
  acceptHouseholdMemberInvitationRequestSchema,
  createHouseholdMemberInvitationRequestSchema,
  createHouseholdMemberInvitationResponseSchema,
  createInvitationRequestSchema,
  createInvitationResponseSchema,
  householdMemberInvitationPreviewResponseSchema,
} from './family';

describe('family production invitation contracts', () => {
  it('accepts exactly one local label or opaque recipient connection code', () => {
    const recipientConnectionCode = `recipient_code_test.${'x'.repeat(32)}`;
    expect(
      createInvitationRequestSchema.parse({
        permissions: ['view_shared_checks'],
        recipientConnectionCode,
      }),
    ).toMatchObject({ recipientConnectionCode });
    expect(
      createInvitationRequestSchema.parse({
        inviteeDisplayName: 'Trusted person',
        permissions: ['view_shared_checks'],
      }),
    ).toMatchObject({ inviteeDisplayName: 'Trusted person' });

    for (const recipientConnectionCode of [
      'person@example.test',
      'subject with spaces',
      '../identity',
      'x'.repeat(601),
    ]) {
      expect(
        createInvitationRequestSchema.safeParse({
          permissions: ['view_shared_checks'],
          recipientConnectionCode,
        }).success,
      ).toBe(false);
    }
    for (const payload of [
      { permissions: ['view_shared_checks'] },
      {
        inviteeDisplayName: 'Trusted person',
        recipientConnectionCode,
        permissions: ['view_shared_checks'],
      },
      {
        inviteeDisplayName: 'Trusted person',
        intendedCustomerSubject: 'user_provider_subject',
        permissions: ['view_shared_checks'],
      },
    ]) {
      expect(createInvitationRequestSchema.safeParse(payload).success).toBe(false);
    }
  });

  it('distinguishes production manual delivery from the local-only fixture', () => {
    const invitation = {
      id: 'invitation-test-identity',
      protectedPersonId: 'person-protected',
      inviteeDisplayName: 'Trusted person',
      permissions: ['view_shared_checks'],
      state: 'pending',
      identityBindingState: 'verified_identity',
      expiresAt: '2026-08-24T12:00:00.000Z',
      createdAt: '2026-08-17T12:00:00.000Z',
    };

    expect(
      createInvitationResponseSchema.parse({
        invitation,
        credential: 'invitee_connection_code',
        delivery: 'recipient_manual_only',
        reused: false,
      }).delivery,
    ).toBe('recipient_manual_only');
    expect(
      createInvitationResponseSchema.parse({
        invitation: { ...invitation, identityBindingState: 'development_unbound' },
        localInviteCode: `invitation-test-identity.${'x'.repeat(32)}`,
        credential: 'local_invite_code',
        delivery: 'local_only',
        reused: false,
      }).delivery,
    ).toBe('local_only');
    expect(
      createInvitationResponseSchema.safeParse({
        invitation,
        localInviteCode: `invitation-test-identity.${'x'.repeat(32)}`,
        credential: 'invitee_connection_code',
        delivery: 'recipient_manual_only',
        reused: false,
      }).success,
    ).toBe(false);
    expect(
      createInvitationResponseSchema.safeParse({
        invitation,
        localInviteCode: `invitation-test-identity.${'x'.repeat(32)}`,
        delivery: 'automatic_message',
      }).success,
    ).toBe(false);
  });

  it('keeps neutral household membership separate from protected and Trusted Circle authority', () => {
    const recipientConnectionCode = `recipient_code_test.${'x'.repeat(32)}`;
    expect(createHouseholdMemberInvitationRequestSchema.parse({ recipientConnectionCode })).toEqual(
      { recipientConnectionCode },
    );
    expect(
      createHouseholdMemberInvitationRequestSchema.safeParse({
        recipientConnectionCode,
        permissions: ['view_shared_checks'],
      }).success,
    ).toBe(false);

    const invitation = {
      id: 'member-invitation-test',
      inviteeDisplayName: 'Invited adult',
      state: 'pending',
      identityBindingState: 'verified_identity',
      access: 'neutral_membership_only',
      expiresAt: '2026-08-24T12:00:00.000Z',
      createdAt: '2026-08-17T12:00:00.000Z',
    };
    const invitationCredential = `member-invitation-test.${'y'.repeat(32)}`;
    expect(
      createHouseholdMemberInvitationResponseSchema.parse({
        invitation,
        credential: 'invitee_connection_code',
        delivery: 'recipient_manual_only',
        reused: false,
      }).invitation.access,
    ).toBe('neutral_membership_only');
    expect(
      createHouseholdMemberInvitationResponseSchema.safeParse({
        invitation,
        credential: 'invitee_connection_code',
        delivery: 'automatic_message',
        reused: false,
      }).success,
    ).toBe(false);

    const preview = householdMemberInvitationPreviewResponseSchema.parse({
      invitation: {
        id: invitation.id,
        household: { id: 'household-test', name: 'Test household' },
        invitedBy: { displayName: 'Household organizer' },
        inviteeDisplayName: invitation.inviteeDisplayName,
        access: 'neutral_membership_only',
        state: 'pending',
        identityBindingState: 'verified_identity',
        expiresAt: invitation.expiresAt,
        previewVersion: 'neutral-household-member-v1-test',
      },
    });
    expect(
      acceptHouseholdMemberInvitationRequestSchema.parse({
        invitationCredential,
        previewVersion: preview.invitation.previewVersion,
      }),
    ).toEqual({
      invitationCredential,
      previewVersion: preview.invitation.previewVersion,
    });
  });
});
