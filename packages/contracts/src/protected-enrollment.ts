import { protectedSelfEnrollmentConsentVersion } from '@boomerbuddy/domain';
import { z } from 'zod';

import { opaqueIdSchema } from './common';

const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const uuidSuffix = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

export const protectedSelfEnrollmentOperationKeySchema = z
  .string()
  .regex(
    new RegExp(`^protected-self-(?:enroll|withdraw):${uuidSuffix}$`, 'u'),
    'Expected an action-bound protected-self UUID idempotency key',
  );

export const protectedSelfEnrollmentConsentVersionSchema = z.literal(
  protectedSelfEnrollmentConsentVersion,
);

const protectedSelfConsentDocumentSchema = z
  .object({
    version: z.string().min(1).max(120),
    text: z.string().min(1).max(4_000),
    digest: sha256HexSchema,
  })
  .strict();

export const protectedSelfEnrollmentStatusResponseSchema = z
  .object({
    householdId: opaqueIdSchema,
    personId: opaqueIdSchema,
    enrollment: z
      .object({
        state: z.enum(['not_enrolled', 'enrolled']),
        effectiveAccess: z.boolean(),
        consentVersion: z.string().min(1).max(120).optional(),
      })
      .strict()
      .superRefine((value, context) => {
        if ((value.state === 'enrolled') !== (value.consentVersion !== undefined)) {
          context.addIssue({
            code: 'custom',
            message: 'An enrolled protected adult requires one consent version',
            path: ['consentVersion'],
          });
        }
        if (value.state === 'not_enrolled' && value.effectiveAccess) {
          context.addIssue({
            code: 'custom',
            message: 'Effective protected access requires enrollment',
            path: ['effectiveAccess'],
          });
        }
      }),
    eligibility: z.enum([
      'available',
      'already_enrolled',
      'entitlement_inactive',
      'allowance_exhausted',
      'allowance_usage_unknown',
    ]),
    withdrawalAvailable: z.boolean(),
    consent: z
      .object({
        version: protectedSelfEnrollmentConsentVersionSchema,
        disclosure: protectedSelfConsentDocumentSchema,
        policy: protectedSelfConsentDocumentSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.enrollment.state === 'enrolled') !== value.withdrawalAvailable) {
      context.addIssue({
        code: 'custom',
        message: 'Withdrawal must remain available for an accepted enrollment',
        path: ['withdrawalAvailable'],
      });
    }
    if ((value.eligibility === 'already_enrolled') !== (value.enrollment.state === 'enrolled')) {
      context.addIssue({
        code: 'custom',
        message: 'Enrollment eligibility does not match the current state',
        path: ['eligibility'],
      });
    }
  });

export const enrollProtectedSelfRequestSchema = z
  .object({
    consentVersion: protectedSelfEnrollmentConsentVersionSchema,
    disclosureVersion: z.string().min(1).max(120),
    disclosureDigest: sha256HexSchema,
    policyVersion: z.string().min(1).max(120),
    policyDigest: sha256HexSchema,
    consentAccepted: z.literal(true),
  })
  .strict();

export const withdrawProtectedSelfRequestSchema = z
  .object({ withdrawalAcknowledged: z.literal(true) })
  .strict();

export const enrollProtectedSelfResponseSchema = z
  .object({
    state: z.literal('enrolled'),
    consentVersion: z.string().min(1).max(120),
    changed: z.boolean(),
    reused: z.boolean(),
  })
  .strict();

export const withdrawProtectedSelfResponseSchema = z
  .object({
    state: z.literal('not_enrolled'),
    changed: z.boolean(),
    reused: z.boolean(),
  })
  .strict();

export type ProtectedSelfEnrollmentStatusResponse = z.infer<
  typeof protectedSelfEnrollmentStatusResponseSchema
>;
export type EnrollProtectedSelfRequest = z.infer<typeof enrollProtectedSelfRequestSchema>;
export type EnrollProtectedSelfResponse = z.infer<typeof enrollProtectedSelfResponseSchema>;
export type WithdrawProtectedSelfResponse = z.infer<typeof withdrawProtectedSelfResponseSchema>;
