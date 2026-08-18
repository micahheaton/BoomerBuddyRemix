import { describe, expect, it } from 'vitest';
import { createInvitationRequestSchema, createInvitationResponseSchema } from './family';

describe('family production invitation contracts', () => {
  it('accepts only a bounded opaque intended customer subject', () => {
    expect(
      createInvitationRequestSchema.parse({
        inviteeDisplayName: 'Trusted person',
        permissions: ['view_shared_checks'],
        intendedCustomerSubject: 'user_2abcDEF123',
      }),
    ).toMatchObject({ intendedCustomerSubject: 'user_2abcDEF123' });

    for (const intendedCustomerSubject of [
      'person@example.test',
      'subject with spaces',
      '../identity',
      'x'.repeat(201),
    ]) {
      expect(
        createInvitationRequestSchema.safeParse({
          inviteeDisplayName: 'Trusted person',
          permissions: ['view_shared_checks'],
          intendedCustomerSubject,
        }).success,
      ).toBe(false);
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
        localInviteCode: `invitation-test-identity.${'x'.repeat(32)}`,
        delivery: 'recipient_manual_only',
      }).delivery,
    ).toBe('recipient_manual_only');
    expect(
      createInvitationResponseSchema.safeParse({
        invitation,
        localInviteCode: `invitation-test-identity.${'x'.repeat(32)}`,
        delivery: 'automatic_message',
      }).success,
    ).toBe(false);
  });
});
