import { describe, expect, it } from 'vitest';
import {
  buildInvitationHandoffPath,
  invitationHandoffAnchor,
  readInvitationHandoff,
} from './invitation-handoff';

describe('invitation handoff links', () => {
  it('carries only an opaque invitation ID to the correct review section', () => {
    expect(buildInvitationHandoffPath('trusted-circle', 'invitation_test-123')).toBe(
      '/member/family?trustedInvitation=invitation_test-123#accept-trusted-invitation',
    );
    expect(buildInvitationHandoffPath('member', 'member_invitation-456')).toBe(
      '/member/family?memberInvitation=member_invitation-456#accept-member-invitation',
    );
    expect(invitationHandoffAnchor('trusted-circle')).toBe('accept-trusted-invitation');
  });

  it('parses one valid handoff and rejects any additional parameter carried in the URL', () => {
    expect(readInvitationHandoff('?trustedInvitation=invitation_test-123')).toEqual({
      invitationId: 'invitation_test-123',
      kind: 'trusted-circle',
    });
    for (const extra of [
      'connectionCode=must-never-be-consumed',
      'recipientConnectionCode=must-never-be-consumed',
      'code=must-never-be-consumed',
      'utm_source=unexpected',
    ]) {
      expect(
        readInvitationHandoff(`?trustedInvitation=invitation_test-123&${extra}`),
      ).toBeUndefined();
    }
  });

  it('fails closed for invalid, duplicate, ambiguous, or oversized handoffs', () => {
    expect(readInvitationHandoff('?trustedInvitation=bad%20id')).toBeUndefined();
    expect(
      readInvitationHandoff('?trustedInvitation=one-id&trustedInvitation=second-id'),
    ).toBeUndefined();
    expect(
      readInvitationHandoff('?trustedInvitation=trusted-id&memberInvitation=member-id'),
    ).toBeUndefined();
    expect(readInvitationHandoff(`?trustedInvitation=${'a'.repeat(513)}`)).toBeUndefined();
    expect(() => buildInvitationHandoffPath('member', 'bad id')).toThrow(TypeError);
  });
});
