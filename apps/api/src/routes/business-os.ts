import { assertAuthorized, type Action } from '@boomerbuddy/authorization';
import {
  createOpportunityRequestSchema,
  automationGlobalControlResponseSchema,
  creditUnionTargetsQuerySchema,
  creditUnionTargetsResponseSchema,
  evaluateAutomationRequestSchema,
  evaluateAutomationResponseSchema,
  opportunityQueueResponseSchema,
  ownerAttentionResponseSchema,
  ownerBriefResponseSchema,
  putAutonomyPolicyRequestSchema,
  putAutomationGlobalControlRequestSchema,
  setOpportunityNextActionRequestSchema,
  transitionOpportunityRequestSchema,
} from '@boomerbuddy/contracts';
import { DomainError } from '@boomerbuddy/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { assertMutationOrigin, authenticate, correlationId } from '../auth';
import type { ApiContext } from '../context';

const opportunityParamsSchema = z.object({
  opportunityId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{2,199}$/u),
});

async function authorizeBusinessOs(
  request: FastifyRequest,
  context: ApiContext,
  action: Extract<Action, 'hq:business_os:read' | 'hq:business_os:manage'>,
) {
  const auth = await authenticate(
    request,
    context.repositories.sessions,
    context.config,
    ['hq'],
    context.now(),
  );
  assertAuthorized({ principal: auth.principal, action, resource: { kind: 'hq' } });
  if (action === 'hq:business_os:manage') {
    assertMutationOrigin(request, context.config, auth);
  }
  return auth;
}

function operationalContext(request: FastifyRequest, personId: string, now: Date) {
  return {
    actorPersonId: personId,
    audience: 'hq' as const,
    correlationId: correlationId(request),
    now,
  };
}

export function registerBusinessOsRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get('/v1/hq/business-os/owner-brief', async (request) => {
    await authorizeBusinessOs(request, context, 'hq:business_os:read');
    const now = context.now();
    const metrics = await context.repositories.businessOs.ownerBrief(now);
    return ownerBriefResponseSchema.parse({
      generatedAt: now.toISOString(),
      metrics,
      dataState: 'local_or_imported_evidence',
    });
  });

  app.get('/v1/hq/business-os/credit-unions', async (request) => {
    await authorizeBusinessOs(request, context, 'hq:business_os:read');
    const query = creditUnionTargetsQuerySchema.parse(request.query);
    const [targets, brief] = await Promise.all([
      context.repositories.businessOs.creditUnionTargets({
        limit: query.limit,
        minimumFitScore: query.minimumFitScore,
        ...(query.memberSegment === undefined ? {} : { memberSegment: query.memberSegment }),
      }),
      context.repositories.businessOs.ownerBrief(context.now()),
    ]);
    return creditUnionTargetsResponseSchema.parse({
      targets: targets.map((target) => ({
        ...target,
        evidenceState: 'official_fixed_snapshot' as const,
        intentClaimed: false as const,
      })),
      dataState: brief.creditUnionUniverse > 0 ? 'official_fixed_snapshot' : 'unavailable',
      limitation: 'Fit is explainable segmentation, not buyer intent.',
    });
  });

  app.get('/v1/hq/business-os/opportunities', async (request) => {
    await authorizeBusinessOs(request, context, 'hq:business_os:read');
    return opportunityQueueResponseSchema.parse({
      opportunities: await context.repositories.businessOs.opportunityQueue(context.now()),
      consequentialOutreachAutomatic: false,
    });
  });

  app.post('/v1/hq/business-os/opportunities', async (request, reply) => {
    const auth = await authorizeBusinessOs(request, context, 'hq:business_os:manage');
    const body = createOpportunityRequestSchema.parse(request.body);
    try {
      const id = await context.repositories.businessOs.createOpportunity({
        organizationId: body.organizationId,
        name: body.name,
        ...(body.ownerPersonId === undefined ? {} : { ownerPersonId: body.ownerPersonId }),
        ...(body.amountMinor === undefined ? {} : { amountMinor: body.amountMinor }),
        ...(body.currency === undefined ? {} : { currency: body.currency }),
        ...(body.useCase === undefined ? {} : { useCase: body.useCase }),
        context: operationalContext(request, auth.principal.personId, context.now()),
      });
      return reply.code(201).send({ opportunity: { id }, outreachSent: false });
    } catch (error) {
      if (error instanceof Error && /foreign key|organization/iu.test(error.message)) {
        throw new DomainError('not_found', 'Organization is unavailable');
      }
      throw error;
    }
  });

  app.post(
    '/v1/hq/business-os/opportunities/:opportunityId/transitions',
    async (request, reply) => {
      const auth = await authorizeBusinessOs(request, context, 'hq:business_os:manage');
      const { opportunityId } = opportunityParamsSchema.parse(request.params);
      const body = transitionOpportunityRequestSchema.parse(request.body);
      try {
        await context.repositories.businessOs.transitionOpportunity({
          opportunityId,
          nextStage: body.nextStage,
          reason: body.reason,
          context: operationalContext(request, auth.principal.personId, context.now()),
        });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Invalid opportunity transition')) {
          throw new DomainError('invalid_transition', 'Opportunity transition is not allowed');
        }
        if (error instanceof Error && error.message === 'Opportunity not found') {
          throw new DomainError('not_found', 'Opportunity is unavailable');
        }
        throw error;
      }
      return reply.code(204).send();
    },
  );

  app.put('/v1/hq/business-os/opportunities/:opportunityId/next-action', async (request, reply) => {
    const auth = await authorizeBusinessOs(request, context, 'hq:business_os:manage');
    const { opportunityId } = opportunityParamsSchema.parse(request.params);
    const body = setOpportunityNextActionRequestSchema.parse(request.body);
    try {
      await context.repositories.businessOs.setOpportunityNextAction({
        opportunityId,
        nextAction: body.nextAction,
        nextActionAt: new Date(body.nextActionAt),
        context: operationalContext(request, auth.principal.personId, context.now()),
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Opportunity not found') {
        throw new DomainError('not_found', 'Opportunity is unavailable');
      }
      throw error;
    }
    return reply.code(204).send();
  });

  app.get('/v1/hq/business-os/attention', async (request) => {
    await authorizeBusinessOs(request, context, 'hq:business_os:read');
    const items = await context.repositories.businessOs.ownerAttention();
    return ownerAttentionResponseSchema.parse({
      items: items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        ...(item.deadline === undefined ? {} : { deadline: item.deadline.toISOString() }),
      })),
    });
  });

  app.put('/v1/hq/business-os/autonomy/policies', async (request, reply) => {
    const auth = await authorizeBusinessOs(request, context, 'hq:business_os:manage');
    const policy = putAutonomyPolicyRequestSchema.parse(request.body);
    let id: string;
    try {
      id = await context.repositories.businessOs.putAutomationPolicy({
        policy,
        approvedByPersonId: auth.principal.personId,
        correlationId: correlationId(request),
        now: context.now(),
      });
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('autonomous execution')) {
        throw new DomainError('invalid_input', error.message);
      }
      throw error;
    }
    return reply.code(200).send({ policy: { id }, actionExecuted: false });
  });

  app.get('/v1/hq/business-os/autonomy/global-control', async (request) => {
    await authorizeBusinessOs(request, context, 'hq:business_os:read');
    const control = await context.repositories.businessOs.globalAutomationControl();
    return automationGlobalControlResponseSchema.parse({
      ...control,
      updatedAt: control.updatedAt.toISOString(),
    });
  });

  app.put('/v1/hq/business-os/autonomy/global-control', async (request) => {
    const auth = await authorizeBusinessOs(request, context, 'hq:business_os:manage');
    const body = putAutomationGlobalControlRequestSchema.parse(request.body);
    const now = context.now();
    await context.repositories.businessOs.setGlobalAutomationKillSwitch({
      killSwitch: body.killSwitch,
      updatedByPersonId: auth.principal.personId,
      correlationId: correlationId(request),
      now,
    });
    return automationGlobalControlResponseSchema.parse({
      killSwitch: body.killSwitch,
      updatedAt: now.toISOString(),
      updatedByPersonId: auth.principal.personId,
    });
  });

  app.post('/v1/hq/business-os/autonomy/evaluate', async (request) => {
    await authorizeBusinessOs(request, context, 'hq:business_os:manage');
    const body = evaluateAutomationRequestSchema.parse(request.body);
    const control = await context.repositories.businessOs.globalAutomationControl();
    return evaluateAutomationResponseSchema.parse(
      await context.repositories.businessOs.evaluateAutomation({
        request: body,
        globalKillSwitch: control.killSwitch,
        now: context.now(),
      }),
    );
  });
}
