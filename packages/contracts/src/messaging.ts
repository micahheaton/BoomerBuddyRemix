import { z } from 'zod';
import { isoDateTimeSchema, opaqueIdSchema } from './common';

export const messagingPurposeSchema = z.enum(['customer_care', 'account_service', 'fraud_safety']);
export const messagingEvidenceTierSchema = z.literal('local_simulation');
export const messagingChannelSchema = z.literal('sms');

export const localMessagingDestinationRequestSchema = z
  .object({
    localFixtureDestination: z.string().regex(/^\+120255501\d{2}$/u),
    timeZone: z.string().min(1).max(80),
    locale: z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/u),
    jurisdiction: z.literal('US'),
  })
  .strict();

export const localMessagingConsentRequestSchema = z
  .object({
    destinationId: opaqueIdSchema,
    purpose: messagingPurposeSchema,
    disclosureVersion: z.literal('sms-purpose-local-v1'),
    policyVersion: z.literal('messaging-local-consent-v1'),
    sourceSurface: z.enum(['member_web', 'mobile_app', 'local_fixture']),
  })
  .strict();

export const selfMessagingConsentRequestSchema = z
  .object({
    purpose: messagingPurposeSchema,
    disclosureVersion: z.literal('sms-purpose-local-v1'),
    policyVersion: z.literal('messaging-local-consent-v1'),
  })
  .strict();

export const localInboundMessagingFixtureSchema = z
  .object({
    eventKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,199}$/u),
    destinationId: opaqueIdSchema,
    classification: z.enum(['stop', 'start', 'help', 'support']),
    supportCaseId: opaqueIdSchema.optional(),
    messageText: z.string().min(1).max(1_600).optional(),
    evidenceTier: messagingEvidenceTierSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const hasSupportFields = value.supportCaseId !== undefined || value.messageText !== undefined;
    if (value.classification === 'support' && !hasSupportFields) {
      context.addIssue({
        code: 'custom',
        message: 'Support fixtures require a case and bounded message text',
      });
    }
    if (
      value.classification === 'support' &&
      (value.supportCaseId === undefined || value.messageText === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Support fixtures require both support fields',
      });
    }
    if (value.classification !== 'support' && hasSupportFields) {
      context.addIssue({
        code: 'custom',
        message: 'Control fixtures cannot contain message content or a support case',
      });
    }
  });

export const localMessagingStatusSchema = z.object({
  destinationId: opaqueIdSchema,
  channel: messagingChannelSchema,
  evidenceTier: messagingEvidenceTierSchema,
  timeZoneKnown: z.boolean(),
  consents: z.array(
    z.object({
      purpose: messagingPurposeSchema,
      state: z.enum(['not_granted', 'active', 'withdrawn']),
      suppressed: z.boolean(),
    }),
  ),
});

export const localMessagingDestinationResponseSchema = z
  .object({
    destination: z.object({
      id: opaqueIdSchema,
      locale: z.string().min(1).max(80),
      jurisdiction: z.literal('US'),
      timeZoneKnown: z.boolean(),
      evidenceTier: messagingEvidenceTierSchema,
      createdAt: isoDateTimeSchema,
    }),
    status: localMessagingStatusSchema,
    providerNetworkPermitted: z.literal(false),
  })
  .strict();

export const localMessagingConsentResponseSchema = z
  .object({
    consentEvidenceId: opaqueIdSchema,
    action: z.enum(['grant', 'withdraw']),
    status: localMessagingStatusSchema,
    providerNetworkPermitted: z.literal(false),
  })
  .strict();

export const localMessagingSupportMetadataResponseSchema = z
  .object({
    items: z.array(
      z.object({
        eventKey: opaqueIdSchema,
        householdId: opaqueIdSchema,
        supportCaseId: opaqueIdSchema,
        contentState: z.enum(['encrypted_minimized', 'discarded_unsafe', 'payload_erased']),
        effect: z.enum(['support_case_linked', 'support_content_discarded']),
        observedAt: isoDateTimeSchema,
        retentionDeadline: isoDateTimeSchema.optional(),
        evidenceTier: messagingEvidenceTierSchema,
      }),
    ),
    contentIncluded: z.literal(false),
    evidenceTier: messagingEvidenceTierSchema,
  })
  .strict();

export const localMessagingSupportReadRequestSchema = z
  .object({ restrictedAccessGrantId: opaqueIdSchema })
  .strict();

export const localMessagingSupportReadResponseSchema = z
  .object({
    eventKey: opaqueIdSchema,
    minimizedMessage: z.string().min(1).max(1_600),
    evidenceTier: messagingEvidenceTierSchema,
    contentBoundary: z.literal('exact_assignee_minimized_support_message'),
  })
  .strict();

const localInvitationShareInputSchema = z
  .object({
    invitationId: opaqueIdSchema,
    localInviteCode: z
      .string()
      .min(24)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/u),
    expiresAt: isoDateTimeSchema,
    surface: z.enum(['native_share_sheet', 'sms_composer', 'email_composer', 'copy_text']),
  })
  .strict();

export interface UserInitiatedInvitationShareDraft {
  readonly surface: 'native_share_sheet' | 'sms_composer' | 'email_composer' | 'copy_text';
  readonly deliveryAuthority: 'user_device_only';
  readonly requiresUserGesture: true;
  readonly automaticSendPermitted: false;
  readonly contactUploadPermitted: false;
  readonly draftText: string;
}

export function buildUserInitiatedInvitationShareDraft(input: {
  readonly invitationId: string;
  readonly localInviteCode: string;
  readonly expiresAt: string;
  readonly surface: UserInitiatedInvitationShareDraft['surface'];
}): UserInitiatedInvitationShareDraft {
  const value = localInvitationShareInputSchema.parse(input);
  return {
    surface: value.surface,
    deliveryAuthority: 'user_device_only',
    requiresUserGesture: true,
    automaticSendPermitted: false,
    contactUploadPermitted: false,
    draftText: [
      'BoomerBuddy local invitation.',
      'You must sign in, review the invitation, and choose whether to accept. Opening it grants no access or messaging consent.',
      `Invitation ID: ${value.invitationId}`,
      `One-time code: ${value.localInviteCode}`,
      `Expires: ${value.expiresAt}`,
      'Share only with the intended person. Do not forward.',
    ].join('\n'),
  };
}

export type MessagingPurposeDto = z.infer<typeof messagingPurposeSchema>;
export type LocalMessagingDestinationResponse = z.infer<
  typeof localMessagingDestinationResponseSchema
>;
export type LocalMessagingConsentResponse = z.infer<typeof localMessagingConsentResponseSchema>;
export type LocalMessagingStatusResponse = z.infer<typeof localMessagingStatusSchema>;
export type LocalMessagingSupportMetadataResponse = z.infer<
  typeof localMessagingSupportMetadataResponseSchema
>;
export type LocalMessagingSupportReadResponse = z.infer<
  typeof localMessagingSupportReadResponseSchema
>;
export type LocalInboundMessagingFixture = z.infer<typeof localInboundMessagingFixtureSchema>;
