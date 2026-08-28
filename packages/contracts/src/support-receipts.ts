import {
  supportReceiptActions,
  supportReceiptCategories,
  supportReceiptImpacts,
  supportReceiptResolutionCodes,
  supportReceiptStates,
} from '@boomerbuddy/domain';
import { z } from 'zod';

import { isoDateTimeSchema, opaqueIdSchema } from './common';

export const supportReceiptCategorySchema = z.enum(supportReceiptCategories);
export const supportReceiptImpactSchema = z.enum(supportReceiptImpacts);
export const supportReceiptStateSchema = z.enum(supportReceiptStates);
export const supportReceiptActionSchema = z.enum(supportReceiptActions);
export const supportReceiptResolutionCodeSchema = z.enum(supportReceiptResolutionCodes);
export const supportReceiptCodeSchema = z
  .string()
  .regex(/^support_receipt_[A-Za-z0-9_-]{32}$/u)
  .max(64);

const scopedOperationKey = (kind: 'create' | 'withdraw' | 'transition') =>
  z
    .string()
    .regex(
      new RegExp(
        `^support-receipt:${kind}:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
        'u',
      ),
      `Expected a support-receipt ${kind} UUID idempotency key`,
    );

export const supportReceiptCreateOperationKeySchema = scopedOperationKey('create');
export const supportReceiptWithdrawalOperationKeySchema = scopedOperationKey('withdraw');
export const supportReceiptTransitionOperationKeySchema = scopedOperationKey('transition');

export const createSupportReceiptRequestSchema = z
  .object({
    category: supportReceiptCategorySchema,
    impact: supportReceiptImpactSchema,
  })
  .strict();

export const withdrawSupportReceiptRequestSchema = z
  .object({ receiptCode: supportReceiptCodeSchema })
  .strict();

export const transitionSupportReceiptRequestSchema = z
  .object({
    receiptCode: supportReceiptCodeSchema,
    action: z.enum(['acknowledge', 'start_review', 'resolve']),
    resolutionCode: supportReceiptResolutionCodeSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.action === 'resolve') !== (value.resolutionCode !== undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Resolution evidence must be present only for resolution',
      });
    }
  });

const supportReceiptRecordShape = {
  receiptCode: supportReceiptCodeSchema,
  category: supportReceiptCategorySchema,
  impact: supportReceiptImpactSchema,
  state: supportReceiptStateSchema,
  resolutionCode: supportReceiptResolutionCodeSchema.optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
} as const;

function validateResolutionState(
  value: { readonly state: string; readonly resolutionCode?: string | undefined },
  context: z.RefinementCtx,
): void {
  if ((value.state === 'resolved') !== (value.resolutionCode !== undefined)) {
    context.addIssue({
      code: 'custom',
      message: 'Resolution evidence must match the terminal resolved state',
    });
  }
}

export const supportReceiptRecordSchema = z
  .object(supportReceiptRecordShape)
  .strict()
  .superRefine(validateResolutionState);

export const hqSupportReceiptRecordSchema = z
  .object({ householdId: opaqueIdSchema, ...supportReceiptRecordShape })
  .strict()
  .superRefine(validateResolutionState);

const contentFreeBoundaryShape = {
  contentIncluded: z.literal(false),
  outboundMessage: z.literal('not_sent'),
  providerAction: z.literal('none'),
} as const;

export const supportReceiptListResponseSchema = z
  .object({
    receipts: z.array(supportReceiptRecordSchema),
    truncated: z.boolean(),
    nextOffset: z.number().int().min(0).max(10_000).nullable(),
    ...contentFreeBoundaryShape,
  })
  .strict()
  .refine((response) => response.truncated || response.nextOffset === null, {
    message: 'A complete support receipt page cannot include a next offset',
    path: ['nextOffset'],
  });

export const supportReceiptMutationResponseSchema = z
  .object({
    receipt: supportReceiptRecordSchema,
    reused: z.boolean(),
    ...contentFreeBoundaryShape,
  })
  .strict();

export const hqSupportReceiptListResponseSchema = z
  .object({
    projection: z.literal('content_free_support_receipts'),
    receipts: z.array(hqSupportReceiptRecordSchema),
    truncated: z.boolean(),
    nextOffset: z.number().int().min(0).max(10_000).nullable(),
    ...contentFreeBoundaryShape,
  })
  .strict()
  .refine((response) => response.truncated || response.nextOffset === null, {
    message: 'A complete support receipt page cannot include a next offset',
    path: ['nextOffset'],
  });

export const hqSupportReceiptTransitionResponseSchema = z
  .object({
    receipt: hqSupportReceiptRecordSchema,
    reused: z.boolean(),
    ...contentFreeBoundaryShape,
  })
  .strict();

export type CreateSupportReceiptRequest = z.infer<typeof createSupportReceiptRequestSchema>;
export type WithdrawSupportReceiptRequest = z.infer<typeof withdrawSupportReceiptRequestSchema>;
export type TransitionSupportReceiptRequest = z.infer<typeof transitionSupportReceiptRequestSchema>;
export type SupportReceiptRecordDto = z.infer<typeof supportReceiptRecordSchema>;
export type HqSupportReceiptRecordDto = z.infer<typeof hqSupportReceiptRecordSchema>;
