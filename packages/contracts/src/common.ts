import { z } from 'zod';

export const opaqueIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/, 'Expected an opaque identifier');

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const audienceSchema = z.enum(['customer', 'mobile', 'hq']);
export const roleSchema = z.enum([
  'household_administrator',
  'protected_member',
  'trusted_circle',
  'payer',
  'billing_manager',
  'hq_owner',
  'hq_reviewer',
  'hq_support',
]);

export const capabilitySchema = z.enum([
  'check:text',
  'check:url',
  'history:read',
  'family:manage',
  'orientation:use',
]);

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(500),
    requestId: z.string().min(1).max(128),
    details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const providerStateSchema = z.enum(['mock', 'unknown', 'unavailable', 'verified']);

export const apiPaths = {
  live: '/health/live',
  ready: '/health/ready',
  publicConfig: '/v1/public/config',
  publicCheckContexts: '/v1/public/check-contexts',
  publicChecks: '/v1/public/checks',
  customerSession: '/v1/dev/sessions/customer',
  hqSession: '/v1/dev/sessions/hq',
  mobileSession: '/v1/dev/sessions/mobile',
  currentSession: '/v1/sessions/current',
  me: '/v1/me',
  checks: '/v1/checks',
  family: '/v1/family',
  orientation: '/v1/orientation',
  entitlements: '/v1/entitlements',
  hqOverview: '/v1/hq/overview',
  hqHouseholds: '/v1/hq/households',
  hqChecks: '/v1/hq/checks',
  hqProviderHealth: '/v1/hq/provider-health',
  hqAudit: '/v1/hq/audit',
  hqRevenue: '/v1/hq/revenue',
} as const;
