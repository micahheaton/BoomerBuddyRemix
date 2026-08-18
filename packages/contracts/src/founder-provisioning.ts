import {
  founderProvisioningBlockerCodes,
  founderProvisioningEvidenceKinds,
  founderProvisioningEvidenceResults,
  founderProvisioningEvidenceTiers,
  founderProvisioningStatuses,
  founderProvisioningWorkstreamKeys,
} from '@boomerbuddy/domain';
import { z } from 'zod';

import { isoDateTimeSchema, opaqueIdSchema } from './common';

export const founderProvisioningStatusSchema = z.enum(founderProvisioningStatuses);
export const founderProvisioningEvidenceTierSchema = z.enum(founderProvisioningEvidenceTiers);
export const founderProvisioningEvidenceKindSchema = z.enum(founderProvisioningEvidenceKinds);
export const founderProvisioningEvidenceResultSchema = z.enum(founderProvisioningEvidenceResults);
export const founderProvisioningBlockerCodeSchema = z.enum(founderProvisioningBlockerCodes);
export const founderProvisioningWorkstreamKeySchema = z.enum(founderProvisioningWorkstreamKeys);
export const founderProvisioningManifestDigestSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, 'Expected a SHA-256 base64url digest');
const founderProvisioningOperationKeyPattern = new RegExp(
  `^provisioning:(?:${founderProvisioningWorkstreamKeys.join('|')}):[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
  'u',
);
export const founderProvisioningOperationKeySchema = z
  .string()
  .regex(
    founderProvisioningOperationKeyPattern,
    'Expected a workstream-bound provisioning UUID idempotency key',
  );

const environmentNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/);
const catalogueCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{2,63}$/);

export const founderProvisioningTransitionRequestSchema = z
  .object({
    toStatus: founderProvisioningStatusSchema,
    evidence: z
      .object({
        tier: founderProvisioningEvidenceTierSchema,
        kind: founderProvisioningEvidenceKindSchema,
        result: founderProvisioningEvidenceResultSchema,
        blockerCode: founderProvisioningBlockerCodeSchema.optional(),
        manifestDigest: founderProvisioningManifestDigestSchema.optional(),
        observedAt: isoDateTimeSchema,
      })
      .strict(),
  })
  .strict();

export const founderProvisioningLatestEvidenceSchema = z
  .object({
    tier: founderProvisioningEvidenceTierSchema,
    kind: founderProvisioningEvidenceKindSchema,
    result: founderProvisioningEvidenceResultSchema,
    blockerCode: founderProvisioningBlockerCodeSchema.optional(),
    manifestDigest: founderProvisioningManifestDigestSchema.optional(),
    observedAt: isoDateTimeSchema,
    recordedAt: isoDateTimeSchema,
  })
  .strict();

export const founderProvisioningRegisterEntrySchema = z
  .object({
    key: founderProvisioningWorkstreamKeySchema,
    definitionVersion: z.literal(1),
    displayOrder: z.number().int().positive(),
    provider: z.string().min(1).max(160),
    purpose: z.string().min(1).max(500),
    accountOwner: z.string().min(1).max(160),
    status: founderProvisioningStatusSchema,
    version: z.number().int().positive(),
    adapterState: z.enum([
      'implemented_disabled',
      'test_configurable',
      'not_implemented',
      'external_only',
      'provider_managed',
    ]),
    manualSteps: z
      .array(
        z
          .object({
            code: catalogueCodeSchema,
            instruction: z.string().min(1).max(500),
            requiredBefore: z.enum([
              'founder_in_progress',
              'ready_for_test',
              'test_proven',
              'ready_for_live_review',
            ]),
          })
          .strict(),
      )
      .min(1),
    requiredIdentifierNames: z.array(catalogueCodeSchema).min(1),
    configurationEnvironmentNames: z.array(environmentNameSchema),
    secretEnvironmentNames: z.array(environmentNameSchema),
    verificationTest: z.string().min(1).max(500),
    allowedProofTiers: z.array(founderProvisioningEvidenceTierSchema).min(1),
    monthlyCostCeiling: z.enum([
      'founder_decision_required',
      'zero_until_approved',
      'included_in_parent_workstream',
    ]),
    recoveryOwner: z.string().min(1).max(240),
    exportTermination: z.string().min(1).max(500),
    nextFounderAction: z.string().min(1).max(500),
    latestEvidence: founderProvisioningLatestEvidenceSchema,
  })
  .strict();

export const founderProvisioningRegisterResponseSchema = z
  .object({
    authority: z.literal('configured_founder_only'),
    catalogueVersion: z.literal(1),
    evidenceBoundary: z.literal('names_digests_enums_only'),
    externalActionExecuted: z.literal(false),
    workstreams: z.array(founderProvisioningRegisterEntrySchema).length(23),
  })
  .strict();

export const founderProvisioningTransitionResponseSchema = z
  .object({
    workstreamKey: founderProvisioningWorkstreamKeySchema,
    status: founderProvisioningStatusSchema,
    version: z.number().int().positive(),
    evidenceId: opaqueIdSchema,
    reused: z.boolean(),
    externalActionExecuted: z.literal(false),
  })
  .strict();

export type FounderProvisioningTransitionRequest = z.infer<
  typeof founderProvisioningTransitionRequestSchema
>;
export type FounderProvisioningRegisterResponse = z.infer<
  typeof founderProvisioningRegisterResponseSchema
>;
export type FounderProvisioningRegisterEntry = z.infer<
  typeof founderProvisioningRegisterEntrySchema
>;
export type FounderProvisioningTransitionResponse = z.infer<
  typeof founderProvisioningTransitionResponseSchema
>;
