import { z } from 'zod';
import { isoDateTimeSchema, opaqueIdSchema } from './common';

export const familySafeWordTargetParamsSchema = z
  .object({ protectedPersonId: opaqueIdSchema })
  .strict();

export const familySafeWordVerifyRequestSchema = z
  .object({ phrase: z.string().min(8).max(128) })
  .strict();

export const familySafeWordVerifyResponseSchema = z
  .object({ result: z.enum(['verified', 'not_verified']) })
  .strict();

export const familySafeWordLifecycleRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('replace'), phrase: z.string().min(8).max(128) }).strict(),
  z.object({ action: z.literal('disable') }).strict(),
]);

export const familySafeWordStatusResponseSchema = z
  .object({
    state: z.enum(['configured', 'disabled']),
    updatedAt: isoDateTimeSchema.optional(),
  })
  .strict();

export const familySafeWordLifecycleResponseSchema = familySafeWordStatusResponseSchema.extend({
  changed: z.boolean(),
});

export type FamilySafeWordVerifyRequest = z.infer<typeof familySafeWordVerifyRequestSchema>;
export type FamilySafeWordVerifyResponse = z.infer<typeof familySafeWordVerifyResponseSchema>;
export type FamilySafeWordLifecycleRequest = z.infer<typeof familySafeWordLifecycleRequestSchema>;
export type FamilySafeWordStatusResponse = z.infer<typeof familySafeWordStatusResponseSchema>;
export type FamilySafeWordLifecycleResponse = z.infer<typeof familySafeWordLifecycleResponseSchema>;
