import { assertAuthorized } from '@boomerbuddy/authorization';
import {
  checkDetailResponseSchema,
  checkListQuerySchema,
  checkListResponseSchema,
  checkShareListResponseSchema,
  acknowledgeCheckShareResponseSchema,
  closeCheckShareRequestSchema,
  closeCheckShareResponseSchema,
  createCheckRequestSchema,
  createCheckResponseSchema,
  deleteCheckResponseSchema,
  opaqueIdSchema,
  shareCheckRequestSchema,
  shareCheckResponseSchema,
} from '@boomerbuddy/contracts';
import { DomainError, ids } from '@boomerbuddy/domain';
import { analyzePreparedCheck, LocalUnknownProvider, prepareCheckInput } from '@boomerbuddy/fraud';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertMutationOrigin, authenticate, correlationId, selectedHousehold } from '../auth';
import type { ApiContext } from '../context';
import { checkDto, decisionFromAssessment } from '../mappers';

const checkParamsSchema = z.object({ checkId: opaqueIdSchema });
const checkShareParamsSchema = z.object({
  checkId: opaqueIdSchema,
  sharedWithPersonId: opaqueIdSchema,
});

function shareLifecycleDto(share: {
  readonly checkId: string;
  readonly sharedWithPersonId: string;
  readonly sharedWithDisplayName: string;
  readonly state: 'shared' | 'acknowledged' | 'closed';
  readonly sharedAt: Date;
  readonly acknowledgedAt?: Date;
  readonly closedAt?: Date;
  readonly closureReason?: 'safer_action_completed' | 'no_longer_needs_help';
}) {
  return {
    checkId: share.checkId,
    sharedWithPersonId: share.sharedWithPersonId,
    sharedWithDisplayName: share.sharedWithDisplayName,
    state: share.state,
    sharedAt: share.sharedAt.toISOString(),
    ...(share.acknowledgedAt === undefined
      ? {}
      : { acknowledgedAt: share.acknowledgedAt.toISOString() }),
    ...(share.closedAt === undefined ? {} : { closedAt: share.closedAt.toISOString() }),
    ...(share.closureReason === undefined ? {} : { closureReason: share.closureReason }),
  };
}

export function registerCheckRoutes(app: FastifyInstance, context: ApiContext): void {
  app.post('/v1/checks', async (request, reply) => {
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
    const body = createCheckRequestSchema.parse(request.body);
    assertAuthorized({
      principal: auth.principal,
      action: 'check:create',
      resource: {
        kind: 'check_collection',
        householdId: household.householdId,
        scope: { kind: 'create', artifactKind: body.kind },
      },
    });
    const prepared = prepareCheckInput(body);
    const assessment = await analyzePreparedCheck(prepared, {
      provider: new LocalUnknownProvider(),
      now,
    });
    const check = await context.repositories.checks.create({
      householdId: household.householdId,
      actorPersonId: auth.principal.personId,
      audience: auth.audience,
      kind: body.kind,
      content: prepared.redactedContent,
      decision: decisionFromAssessment(assessment),
      correlationId: correlationId(request),
      now,
    });
    return reply
      .code(201)
      .send(createCheckResponseSchema.parse({ check: checkDto(check, auth.principal.personId) }));
  });

  app.get('/v1/checks', async (request) => {
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      now,
    );
    const household = selectedHousehold(auth, request);
    const includeOwned = household.isProtectedMember;
    const includeExplicitlyShared = household.trustedCircleGrants.some((grant) =>
      grant.permissions.includes('view_shared_checks'),
    );
    assertAuthorized({
      principal: auth.principal,
      action: 'check:list',
      resource: {
        kind: 'check_collection',
        householdId: household.householdId,
        scope: {
          kind: 'list',
          ownerPersonId: auth.principal.personId,
          includeOwned,
          includeExplicitlyShared,
        },
      },
    });
    const page = checkListQuerySchema.parse(request.query);
    const scope = {
      householdIds: [household.householdId],
      actorPersonId: auth.principal.personId,
      includeOwned,
      includeExplicitlyShared,
    } as const;
    const [checks, total] = await Promise.all([
      context.repositories.checks.listVisible({ ...scope, ...page, now }),
      context.repositories.checks.countVisible({ ...scope, now }),
    ]);
    return checkListResponseSchema.parse({
      checks: checks.map((check) => checkDto(check, auth.principal.personId)),
      total,
      page: {
        ...page,
        hasMore: page.offset + checks.length < total,
      },
    });
  });

  app.get('/v1/checks/:checkId', async (request) => {
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      now,
    );
    const household = selectedHousehold(auth, request);
    const { checkId } = checkParamsSchema.parse(request.params);
    const check = await context.repositories.checks.findVisible({
      checkId,
      householdIds: [household.householdId],
      actorPersonId: auth.principal.personId,
      now,
    });
    if (check === null) throw new DomainError('not_found', 'Check is unavailable');
    assertAuthorized({
      principal: auth.principal,
      action: 'check:read',
      resource: {
        kind: 'check',
        householdId: ids.household(check.householdId),
        ownerPersonId: ids.person(check.ownerPersonId),
        ...(check.ownerPersonId === auth.principal.personId
          ? {}
          : { sharedWithPersonIds: [auth.principal.personId] }),
      },
    });
    return checkDetailResponseSchema.parse({
      check: checkDto(check, auth.principal.personId),
    });
  });

  app.delete('/v1/checks/:checkId', async (request, reply) => {
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
    const { checkId } = checkParamsSchema.parse(request.params);
    const check = await context.repositories.checks.findVisible({
      checkId,
      householdIds: [household.householdId],
      actorPersonId: auth.principal.personId,
      now,
    });
    if (check === null) throw new DomainError('not_found', 'Check is unavailable');
    assertAuthorized({
      principal: auth.principal,
      action: 'check:delete',
      resource: {
        kind: 'check',
        householdId: ids.household(check.householdId),
        ownerPersonId: ids.person(check.ownerPersonId),
      },
    });
    const deleted = await context.repositories.checks.deleteOwned({
      checkId,
      householdIds: [household.householdId],
      actorPersonId: auth.principal.personId,
      audience: auth.audience,
      correlationId: correlationId(request),
      now,
    });
    if (deleted === null) throw new DomainError('not_found', 'Check is unavailable');
    return reply.send(
      deleteCheckResponseSchema.parse({
        id: checkId,
        state: 'deleted',
        deletedAt: now.toISOString(),
      }),
    );
  });

  app.post('/v1/checks/:checkId/shares', async (request, reply) => {
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
    const { checkId } = checkParamsSchema.parse(request.params);
    const body = shareCheckRequestSchema.parse(request.body);
    const check = await context.repositories.checks.findVisible({
      checkId,
      householdIds: [household.householdId],
      actorPersonId: auth.principal.personId,
      now,
    });
    if (check === null) throw new DomainError('not_found', 'Check is unavailable');
    assertAuthorized({
      principal: auth.principal,
      action: 'check:share',
      resource: {
        kind: 'check',
        householdId: ids.household(check.householdId),
        ownerPersonId: ids.person(check.ownerPersonId),
      },
    });
    const share = await context.repositories.checks.share({
      checkId,
      householdId: household.householdId,
      ownerPersonId: auth.principal.personId,
      sharedWithPersonId: body.sharedWithPersonId,
      audience: auth.audience,
      correlationId: correlationId(request),
      now,
    });
    return reply.code(201).send(
      shareCheckResponseSchema.parse({
        checkId,
        sharedWithPersonId: body.sharedWithPersonId,
        state: 'active',
        lifecycle: shareLifecycleDto(share),
      }),
    );
  });

  app.get('/v1/checks/:checkId/shares', async (request) => {
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      now,
    );
    const household = selectedHousehold(auth, request);
    const { checkId } = checkParamsSchema.parse(request.params);
    const check = await context.repositories.checks.findVisible({
      checkId,
      householdIds: [household.householdId],
      actorPersonId: auth.principal.personId,
      now,
    });
    if (check === null) throw new DomainError('not_found', 'Check is unavailable');
    assertAuthorized({
      principal: auth.principal,
      action: 'check:read',
      resource: {
        kind: 'check',
        householdId: ids.household(check.householdId),
        ownerPersonId: ids.person(check.ownerPersonId),
        ...(check.ownerPersonId === auth.principal.personId
          ? {}
          : { sharedWithPersonIds: [auth.principal.personId] }),
      },
    });
    const shares = await context.repositories.checks.listShares({
      householdId: household.householdId,
      checkId,
      actorPersonId: auth.principal.personId,
    });
    return checkShareListResponseSchema.parse({ shares: shares.map(shareLifecycleDto) });
  });

  app.post('/v1/checks/:checkId/share-acknowledgement', async (request) => {
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      now,
    );
    assertMutationOrigin(request, context.config, auth);
    z.object({})
      .strict()
      .parse(request.body ?? {});
    const household = selectedHousehold(auth, request);
    const { checkId } = checkParamsSchema.parse(request.params);
    const check = await context.repositories.checks.findVisible({
      checkId,
      householdIds: [household.householdId],
      actorPersonId: auth.principal.personId,
      now,
    });
    if (check === null || check.ownerPersonId === auth.principal.personId) {
      throw new DomainError('not_found', 'Shared Check is unavailable');
    }
    assertAuthorized({
      principal: auth.principal,
      action: 'check:read',
      resource: {
        kind: 'check',
        householdId: ids.household(check.householdId),
        ownerPersonId: ids.person(check.ownerPersonId),
        sharedWithPersonIds: [auth.principal.personId],
      },
    });
    const share = await context.repositories.checks.acknowledgeShare({
      householdId: household.householdId,
      checkId,
      trustedPersonId: auth.principal.personId,
      audience: auth.audience,
      correlationId: correlationId(request),
      now,
    });
    if (share === null) throw new DomainError('not_found', 'Shared Check is unavailable');
    return acknowledgeCheckShareResponseSchema.parse({ share: shareLifecycleDto(share) });
  });

  app.post('/v1/checks/:checkId/shares/:sharedWithPersonId/closure', async (request) => {
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
    const { checkId, sharedWithPersonId } = checkShareParamsSchema.parse(request.params);
    const body = closeCheckShareRequestSchema.parse(request.body);
    const check = await context.repositories.checks.findVisible({
      checkId,
      householdIds: [household.householdId],
      actorPersonId: auth.principal.personId,
      now,
    });
    if (check === null || check.ownerPersonId !== auth.principal.personId) {
      throw new DomainError('not_found', 'Shared Check is unavailable');
    }
    assertAuthorized({
      principal: auth.principal,
      action: 'check:share',
      resource: {
        kind: 'check',
        householdId: ids.household(check.householdId),
        ownerPersonId: ids.person(check.ownerPersonId),
      },
    });
    const share = await context.repositories.checks.closeShare({
      householdId: household.householdId,
      checkId,
      ownerPersonId: auth.principal.personId,
      sharedWithPersonId,
      resolution: body.resolution,
      audience: auth.audience,
      correlationId: correlationId(request),
      now,
    });
    if (share === null) throw new DomainError('not_found', 'Shared Check is unavailable');
    return closeCheckShareResponseSchema.parse({ share: shareLifecycleDto(share) });
  });
}
