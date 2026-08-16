import { z } from 'zod';
import {
  audienceSchema,
  capabilitySchema,
  isoDateTimeSchema,
  opaqueIdSchema,
  roleSchema,
} from './common';

export const devPersonaIdSchema = z.enum([
  'owner-alice',
  'protected-pat',
  'trusted-terry',
  'trusted-jordan',
  'owner-bob',
  'protected-olivia',
  'hq-heidi',
  'hq-riley',
]);

export const devSessionRequestSchema = z.object({ personaId: devPersonaIdSchema }).strict();

export const principalSchema = z.object({
  sessionId: opaqueIdSchema,
  personId: opaqueIdSchema,
  displayName: z.string().min(1).max(120),
  audience: audienceSchema,
  roles: z.array(roleSchema),
  households: z.array(
    z.object({
      id: opaqueIdSchema,
      membershipKind: z.literal('member'),
      isAdministrator: z.boolean(),
      isProtectedMember: z.boolean(),
      trustedCircleGrants: z.array(
        z.object({
          relationshipId: opaqueIdSchema,
          protectedPersonId: opaqueIdSchema,
          permissions: z.array(
            z.enum(['view_shared_checks', 'receive_escalations', 'help_with_orientation']),
          ),
        }),
      ),
      isPayer: z.boolean(),
      isBillingManager: z.boolean(),
      capabilities: z.array(capabilitySchema),
    }),
  ),
  expiresAt: isoDateTimeSchema,
});

export const browserSessionResponseSchema = z.object({
  principal: principalSchema,
});

export const mobileSessionResponseSchema = browserSessionResponseSchema.extend({
  token: z.string().min(32),
});

export const meResponseSchema = z.object({ principal: principalSchema });

export type DevPersonaId = z.infer<typeof devPersonaIdSchema>;
export type DevSessionRequest = z.infer<typeof devSessionRequestSchema>;
export type PrincipalDto = z.infer<typeof principalSchema>;
export type BrowserSessionResponse = z.infer<typeof browserSessionResponseSchema>;
export type MobileSessionResponse = z.infer<typeof mobileSessionResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
