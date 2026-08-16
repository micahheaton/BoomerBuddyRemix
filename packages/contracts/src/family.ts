import { z } from 'zod';
import { isoDateTimeSchema, opaqueIdSchema } from './common';

export const trustedCirclePermissionSchema = z.enum([
  'view_shared_checks',
  'receive_escalations',
  'help_with_orientation',
]);

export const run1InvitablePermissionSchema = z.literal('view_shared_checks');

export const familyMemberSchema = z.object({
  membershipId: opaqueIdSchema,
  personId: opaqueIdSchema,
  displayName: z.string().min(1).max(120),
  role: z.enum(['household_owner', 'protected_member', 'trusted_circle']),
  isProtectedMember: z.boolean(),
  status: z.enum(['active', 'revoked']),
  permissions: z.array(trustedCirclePermissionSchema),
});

export const invitationSchema = z.object({
  id: opaqueIdSchema,
  protectedPersonId: opaqueIdSchema,
  inviteeDisplayName: z.string().min(1).max(120),
  permissions: z.array(trustedCirclePermissionSchema),
  state: z.enum(['pending', 'accepted', 'expired', 'revoked']),
  expiresAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});

export const trustedRelationshipSchema = z.object({
  id: opaqueIdSchema,
  protectedPersonId: opaqueIdSchema,
  trustedPersonId: opaqueIdSchema,
  trustedDisplayName: z.string().min(1).max(120),
  permissions: z.array(trustedCirclePermissionSchema),
  state: z.enum(['active', 'revoked']),
  consentVersion: z.string().min(1).max(40),
  createdAt: isoDateTimeSchema,
});

export const familyResponseSchema = z.object({
  household: z.object({ id: opaqueIdSchema, name: z.string().min(1).max(120) }),
  members: z.array(familyMemberSchema),
  relationships: z.array(trustedRelationshipSchema),
  invitations: z.array(invitationSchema),
});

export const createInvitationRequestSchema = z
  .object({
    inviteeDisplayName: z.string().trim().min(1).max(120),
    permissions: z.array(run1InvitablePermissionSchema).length(1),
  })
  .strict();

export const createInvitationResponseSchema = z.object({
  invitation: invitationSchema,
  localInviteCode: z.string().min(24),
  delivery: z.literal('local_only'),
});

export const invitationCredentialRequestSchema = z
  .object({ localInviteCode: z.string().min(24) })
  .strict();
export const invitationPreviewResponseSchema = z.object({
  invitation: z.object({
    id: opaqueIdSchema,
    household: z.object({ id: opaqueIdSchema, name: z.string().min(1).max(120) }),
    protectedPerson: z.object({ id: opaqueIdSchema, displayName: z.string().min(1).max(120) }),
    permissions: z.array(trustedCirclePermissionSchema),
    state: z.literal('pending'),
    expiresAt: isoDateTimeSchema,
    previewVersion: z.string().min(1).max(40),
  }),
});
export const acceptInvitationRequestSchema = invitationCredentialRequestSchema.extend({
  previewVersion: z.string().min(1).max(40),
});
export const acceptInvitationResponseSchema = z.object({
  relationship: trustedRelationshipSchema,
  householdId: opaqueIdSchema,
});
export const revokeRelationshipResponseSchema = z.object({
  id: opaqueIdSchema,
  state: z.literal('revoked'),
  revokedAt: isoDateTimeSchema,
});
export const revokeInvitationResponseSchema = z.object({
  id: opaqueIdSchema,
  state: z.literal('revoked'),
  revokedAt: isoDateTimeSchema,
});

export type TrustedCirclePermissionDto = z.infer<typeof trustedCirclePermissionSchema>;
export type FamilyResponse = z.infer<typeof familyResponseSchema>;
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;
export type CreateInvitationResponse = z.infer<typeof createInvitationResponseSchema>;
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;
export type InvitationPreviewResponse = z.infer<typeof invitationPreviewResponseSchema>;
