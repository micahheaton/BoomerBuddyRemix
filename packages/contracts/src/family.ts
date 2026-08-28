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
  membershipKind: z.literal('member'),
  isAdministrator: z.boolean(),
  isProtectedMember: z.boolean(),
  status: z.enum(['active', 'revoked']),
});

export const invitationSchema = z.object({
  id: opaqueIdSchema,
  protectedPersonId: opaqueIdSchema,
  inviteeDisplayName: z.string().min(1).max(120),
  permissions: z.array(trustedCirclePermissionSchema),
  state: z.enum(['pending', 'accepted', 'expired', 'revoked', 'withdrawn']),
  identityBindingState: z.enum(['development_unbound', 'verified_identity']),
  expiresAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});

export const householdMemberInvitationSchema = z.object({
  id: opaqueIdSchema,
  inviteeDisplayName: z.string().min(1).max(120),
  state: z.enum(['pending', 'accepted', 'revoked', 'expired']),
  identityBindingState: z.literal('verified_identity'),
  access: z.literal('neutral_membership_only'),
  expiresAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});

export const trustedRelationshipSchema = z.object({
  id: opaqueIdSchema,
  protectedPersonId: opaqueIdSchema,
  trustedPersonId: opaqueIdSchema,
  trustedDisplayName: z.string().min(1).max(120),
  permissions: z.array(trustedCirclePermissionSchema),
  state: z.enum(['active', 'withdrawn', 'relinquished', 'suspended', 'revoked']),
  consentVersion: z.string().min(1).max(40),
  createdAt: isoDateTimeSchema,
  endedAction: z.enum(['withdraw', 'relinquish', 'suspend', 'legacy_revoke']).optional(),
  endedAt: isoDateTimeSchema.optional(),
});

export const familyResponseSchema = z.object({
  household: z.object({ id: opaqueIdSchema, name: z.string().min(1).max(120) }),
  members: z.array(familyMemberSchema),
  relationships: z.array(trustedRelationshipSchema),
  invitations: z.array(invitationSchema),
  memberInvitations: z.array(householdMemberInvitationSchema),
});

export const recipientConnectionCodeSchema = z
  .string()
  .trim()
  .min(32)
  .max(600)
  .regex(/^[A-Za-z0-9._-]+$/u);

export const createRecipientConnectionCodeResponseSchema = z.object({
  recipientConnectionCode: recipientConnectionCodeSchema,
  expiresAt: isoDateTimeSchema,
  delivery: z.literal('manual_only'),
});

export const createHouseholdMemberInvitationRequestSchema = z
  .object({ recipientConnectionCode: recipientConnectionCodeSchema })
  .strict();

export const householdMemberInvitationCredentialSchema = z
  .string()
  .trim()
  .min(32)
  .max(600)
  .regex(/^[A-Za-z0-9._-]+$/u);

export const createHouseholdMemberInvitationResponseSchema = z.object({
  invitation: householdMemberInvitationSchema,
  credential: z.literal('invitee_connection_code'),
  delivery: z.literal('recipient_manual_only'),
  reused: z.boolean(),
});

export const householdMemberInvitationCredentialRequestSchema = z
  .object({ invitationCredential: householdMemberInvitationCredentialSchema })
  .strict();

export const householdMemberInvitationPreviewResponseSchema = z.object({
  invitation: z.object({
    id: opaqueIdSchema,
    household: z.object({ id: opaqueIdSchema, name: z.string().min(1).max(120) }),
    invitedBy: z.object({ displayName: z.string().min(1).max(120) }),
    inviteeDisplayName: z.string().min(1).max(120),
    access: z.literal('neutral_membership_only'),
    state: z.literal('pending'),
    identityBindingState: z.literal('verified_identity'),
    expiresAt: isoDateTimeSchema,
    previewVersion: z.string().min(1).max(80),
  }),
});

export const acceptHouseholdMemberInvitationRequestSchema =
  householdMemberInvitationCredentialRequestSchema.extend({
    previewVersion: z.string().min(1).max(80),
  });

export const acceptHouseholdMemberInvitationResponseSchema = z.object({
  membership: z.object({
    membershipId: opaqueIdSchema,
    householdId: opaqueIdSchema,
    membershipKind: z.literal('member'),
    status: z.literal('active'),
  }),
  reused: z.boolean(),
});

export const revokeHouseholdMemberInvitationResponseSchema = z.object({
  id: opaqueIdSchema,
  state: z.literal('revoked'),
  endedAt: isoDateTimeSchema,
});

export const revokeHouseholdMemberResponseSchema = z.object({
  membershipId: opaqueIdSchema,
  state: z.literal('revoked'),
  endedAt: isoDateTimeSchema,
});

export const createInvitationRequestSchema = z
  .object({
    inviteeDisplayName: z.string().trim().min(1).max(120).optional(),
    recipientConnectionCode: recipientConnectionCodeSchema.optional(),
    permissions: z.array(run1InvitablePermissionSchema).length(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.inviteeDisplayName === undefined) ===
      (value.recipientConnectionCode === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Provide exactly one invitation recipient',
      });
    }
  });

export const createInvitationResponseSchema = z.discriminatedUnion('delivery', [
  z
    .object({
      invitation: invitationSchema,
      localInviteCode: z.string().min(24),
      credential: z.literal('local_invite_code'),
      delivery: z.literal('local_only'),
      reused: z.literal(false),
    })
    .strict(),
  z
    .object({
      invitation: invitationSchema,
      credential: z.literal('invitee_connection_code'),
      delivery: z.literal('recipient_manual_only'),
      reused: z.boolean(),
    })
    .strict(),
]);

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
    identityBindingState: z.enum(['development_unbound', 'verified_identity']),
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
  reused: z.boolean(),
});
export const revokeRelationshipResponseSchema = z.object({
  id: opaqueIdSchema,
  state: z.enum(['withdrawn', 'relinquished', 'suspended']),
  endedAt: isoDateTimeSchema,
});
export const revokeInvitationResponseSchema = z.object({
  id: opaqueIdSchema,
  state: z.enum(['withdrawn', 'revoked']),
  endedAt: isoDateTimeSchema,
});

export type TrustedCirclePermissionDto = z.infer<typeof trustedCirclePermissionSchema>;
export type FamilyResponse = z.infer<typeof familyResponseSchema>;
export type CreateRecipientConnectionCodeResponse = z.infer<
  typeof createRecipientConnectionCodeResponseSchema
>;
export type HouseholdMemberInvitationDto = z.infer<typeof householdMemberInvitationSchema>;
export type CreateHouseholdMemberInvitationRequest = z.infer<
  typeof createHouseholdMemberInvitationRequestSchema
>;
export type CreateHouseholdMemberInvitationResponse = z.infer<
  typeof createHouseholdMemberInvitationResponseSchema
>;
export type HouseholdMemberInvitationPreviewResponse = z.infer<
  typeof householdMemberInvitationPreviewResponseSchema
>;
export type AcceptHouseholdMemberInvitationRequest = z.infer<
  typeof acceptHouseholdMemberInvitationRequestSchema
>;
export type AcceptHouseholdMemberInvitationResponse = z.infer<
  typeof acceptHouseholdMemberInvitationResponseSchema
>;
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;
export type CreateInvitationResponse = z.infer<typeof createInvitationResponseSchema>;
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;
export type InvitationPreviewResponse = z.infer<typeof invitationPreviewResponseSchema>;
