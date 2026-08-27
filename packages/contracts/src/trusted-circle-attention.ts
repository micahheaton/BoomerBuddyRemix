import { z } from 'zod';
import { isoDateTimeSchema, opaqueIdSchema } from './common';

export const trustedCircleAttentionLimit = 20;

export const trustedCirclePendingAcknowledgementSchema = z
  .object({
    checkId: opaqueIdSchema,
    attentionKind: z.literal('shared_check_needs_acknowledgement'),
    sharedAt: isoDateTimeSchema,
  })
  .strict();

export const trustedCircleAttentionResponseSchema = z
  .object({
    pendingAcknowledgementCount: z.number().int().nonnegative(),
    pendingAcknowledgements: z
      .array(trustedCirclePendingAcknowledgementSchema)
      .max(trustedCircleAttentionLimit),
    page: z
      .object({
        limit: z.literal(trustedCircleAttentionLimit),
        hasMore: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.pendingAcknowledgementCount < value.pendingAcknowledgements.length) {
      context.addIssue({
        code: 'custom',
        message: 'Pending acknowledgement count cannot be smaller than the bounded list',
      });
    }
    if (
      value.page.hasMore !==
      value.pendingAcknowledgementCount > value.pendingAcknowledgements.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Attention pagination evidence does not match the pending count',
      });
    }
  });

export type TrustedCirclePendingAcknowledgement = z.infer<
  typeof trustedCirclePendingAcknowledgementSchema
>;
export type TrustedCircleAttentionResponse = z.infer<typeof trustedCircleAttentionResponseSchema>;
