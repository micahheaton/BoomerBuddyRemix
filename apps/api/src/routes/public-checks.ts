import { assertAuthorized } from '@boomerbuddy/authorization';
import {
  createCheckResponseSchema,
  createPublicCheckContextRequestSchema,
  createPublicCheckContextResponseSchema,
  createPublicCheckRequestSchema,
  createPublicCheckResponseSchema,
  publicCheckResultParamsSchema,
  savePublicCheckRequestSchema,
} from '@boomerbuddy/contracts';
import { analyzePreparedCheck, LocalUnknownProvider, prepareCheckInput } from '@boomerbuddy/fraud';
import type { PublicCheckRepository } from '@boomerbuddy/persistence';
import type { FastifyInstance } from 'fastify';
import { assertMutationOrigin, authenticate, correlationId, selectedHousehold } from '../auth';
import type { ApiContext } from '../context';
import { checkDto, decisionFromAssessment } from '../mappers';

export function registerPublicCheckRoutes(
  app: FastifyInstance,
  context: ApiContext,
  publicChecks: PublicCheckRepository,
): void {
  app.post('/v1/public/check-contexts', async (request, reply) => {
    const now = context.now();
    const body = createPublicCheckContextRequestSchema.parse(request.body ?? {});
    const clientKey = publicChecks.clientKeyForNetworkAddress(request.ip);
    const grant = await publicChecks.createContext({
      attribution: body.attribution,
      clientKey,
      now,
    });
    return reply.code(201).send(
      createPublicCheckContextResponseSchema.parse({
        context: {
          token: grant.token,
          continuityProof: grant.continuityProof,
          expiresAt: grant.expiresAt.toISOString(),
          remainingChecks: grant.remainingChecks,
        },
      }),
    );
  });

  app.post('/v1/public/checks', async (request, reply) => {
    const now = context.now();
    const body = createPublicCheckRequestSchema.parse(request.body);
    const clientKey = publicChecks.clientKeyForNetworkAddress(request.ip);
    const leaseId = await publicChecks.acquireAnalysisLease({ clientKey, now });
    try {
      const interaction = await publicChecks.consumeContext({
        token: body.contextToken,
        ...(body.continuityProof === undefined ? {} : { continuityProof: body.continuityProof }),
        clientKey,
        now,
      });
      const prepared = prepareCheckInput({ kind: body.kind, content: body.content });
      const assessment = await analyzePreparedCheck(prepared, {
        provider: new LocalUnknownProvider(),
        now,
      });
      const decision = decisionFromAssessment(assessment);
      const grant = await publicChecks.createResult({
        kind: prepared.kind,
        redactedContent: prepared.redactedContent,
        decision,
        inputSafety: {
          redactions: prepared.redactions,
          flags: prepared.safetyFlags,
        },
        interaction,
        now,
      });
      await publicChecks.recordCompleted(interaction, now);
      return reply.code(201).send(
        createPublicCheckResponseSchema.parse({
          result: {
            id: grant.id,
            kind: prepared.kind,
            risk: assessment.risk,
            evidenceSufficiency: assessment.confidence,
            calibration: assessment.calibration,
            summary: decision.summary,
            actions: decision.actions,
            inputSafety: assessment.inputSafety,
            expiresAt: grant.expiresAt.toISOString(),
            conversionGrant: {
              token: grant.conversionToken,
              expiresAt: grant.expiresAt.toISOString(),
              semanticsVersion: 'single-success-retry-v1',
              singleSuccessfulConversion: true,
              retryableWithSameCredentialOwnerAndConsent: true,
              oneTime: true,
            },
          },
        }),
      );
    } finally {
      await publicChecks.releaseAnalysisLease({ leaseId, clientKey });
    }
  });

  app.post('/v1/public/checks/:resultId/save', async (request, reply) => {
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      now,
    );
    assertMutationOrigin(request, context.config, auth);
    const household = selectedHousehold(auth, request);
    const { resultId } = publicCheckResultParamsSchema.parse(request.params);
    const body = savePublicCheckRequestSchema.parse(request.body);
    const saved = await publicChecks.saveAsOwnedCheck({
      resultId,
      conversionToken: body.conversionToken,
      saveConsent: body.saveConsent,
      consentVersion: body.consentVersion,
      householdId: household.householdId,
      actorPersonId: auth.principal.personId,
      audience: auth.audience,
      correlationId: correlationId(request),
      now,
      authorizeKind: (kind) => {
        assertAuthorized({
          principal: auth.principal,
          action: 'check:create',
          resource: {
            kind: 'check_collection',
            householdId: household.householdId,
            scope: { kind: 'create', artifactKind: kind },
          },
        });
      },
      checks: context.repositories.checks,
    });
    return reply.code(saved.created ? 201 : 200).send(
      createCheckResponseSchema.parse({
        check: checkDto(saved.check, auth.principal.personId),
      }),
    );
  });
}
