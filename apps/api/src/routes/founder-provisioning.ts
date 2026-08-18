import { assertAuthorized, type Action } from '@boomerbuddy/authorization';
import {
  founderProvisioningOperationKeySchema,
  founderProvisioningRegisterResponseSchema,
  founderProvisioningTransitionRequestSchema,
  founderProvisioningTransitionResponseSchema,
  founderProvisioningWorkstreamKeySchema,
} from '@boomerbuddy/contracts';
import { DomainError } from '@boomerbuddy/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { assertMutationOrigin, authenticate, correlationId } from '../auth';
import type { ApiContext } from '../context';

const provisioningParamsSchema = z
  .object({ workstreamKey: founderProvisioningWorkstreamKeySchema })
  .strict();

async function authorizeFounderProvisioning(
  request: FastifyRequest,
  context: ApiContext,
  action: Extract<Action, 'hq:founder_provisioning:read' | 'hq:founder_provisioning:manage'>,
) {
  const auth = await authenticate(
    request,
    context.repositories.sessions,
    context.config,
    ['hq'],
    context.now(),
  );
  const configuredFounderPersonId = context.config.identity.founderPersonId;
  assertAuthorized({
    principal: auth.principal,
    action,
    resource: {
      kind: 'founder_provisioning',
      ...(configuredFounderPersonId === undefined ? {} : { configuredFounderPersonId }),
    },
  });
  if (action === 'hq:founder_provisioning:manage') {
    assertMutationOrigin(request, context.config, auth);
  }
  return auth;
}

function idempotencyKey(request: FastifyRequest): string {
  const raw = request.headers['idempotency-key'];
  if (raw === undefined || Array.isArray(raw)) {
    throw new DomainError(
      'invalid_input',
      'One valid Idempotency-Key header is required for a provisioning transition',
    );
  }
  const parsed = founderProvisioningOperationKeySchema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError(
      'invalid_input',
      'One valid Idempotency-Key header is required for a provisioning transition',
    );
  }
  return parsed.data;
}

export function registerFounderProvisioningRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get('/v1/hq/provisioning', async (request) => {
    const auth = await authorizeFounderProvisioning(
      request,
      context,
      'hq:founder_provisioning:read',
    );
    const workstreams = await context.repositories.founderProvisioning.register({
      actorPersonId: auth.principal.personId,
      correlationId: correlationId(request),
    });
    return founderProvisioningRegisterResponseSchema.parse({
      authority: 'configured_founder_only',
      catalogueVersion: 1,
      evidenceBoundary: 'names_digests_enums_only',
      externalActionExecuted: false,
      workstreams: workstreams.map(({ catalogue, latestEvidence, status, version }) => ({
        key: catalogue.key,
        definitionVersion: catalogue.definitionVersion,
        displayOrder: catalogue.displayOrder,
        provider: catalogue.provider,
        purpose: catalogue.purpose,
        accountOwner: catalogue.accountOwner,
        status,
        version,
        adapterState: catalogue.adapterState,
        manualSteps: catalogue.manualSteps,
        requiredIdentifierNames: catalogue.requiredIdentifierNames,
        configurationEnvironmentNames: catalogue.configurationEnvironmentNames,
        secretEnvironmentNames: catalogue.secretEnvironmentNames,
        verificationTest: catalogue.verificationTest,
        allowedProofTiers: catalogue.allowedProofTiers,
        monthlyCostCeiling: catalogue.monthlyCostCeiling,
        recoveryOwner: catalogue.recoveryOwner,
        exportTermination: catalogue.exportTermination,
        nextFounderAction: catalogue.nextFounderAction,
        latestEvidence: {
          ...latestEvidence,
          observedAt: latestEvidence.observedAt.toISOString(),
          recordedAt: latestEvidence.recordedAt.toISOString(),
        },
      })),
    });
  });

  app.post('/v1/hq/provisioning/:workstreamKey/transitions', async (request, reply) => {
    const auth = await authorizeFounderProvisioning(
      request,
      context,
      'hq:founder_provisioning:manage',
    );
    const { workstreamKey } = provisioningParamsSchema.parse(request.params);
    const body = founderProvisioningTransitionRequestSchema.parse(request.body);
    const evidence = {
      tier: body.evidence.tier,
      kind: body.evidence.kind,
      result: body.evidence.result,
      ...(body.evidence.blockerCode === undefined
        ? {}
        : { blockerCode: body.evidence.blockerCode }),
      ...(body.evidence.manifestDigest === undefined
        ? {}
        : { manifestDigest: body.evidence.manifestDigest }),
      observedAt: new Date(body.evidence.observedAt),
    };
    const result = await context.repositories.founderProvisioning.transition({
      access: {
        actorPersonId: auth.principal.personId,
        correlationId: correlationId(request),
      },
      workstreamKey,
      operationKey: idempotencyKey(request),
      toStatus: body.toStatus,
      evidence,
    });
    return reply.code(200).send(founderProvisioningTransitionResponseSchema.parse(result));
  });
}
