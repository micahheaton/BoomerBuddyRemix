import { assertAuthorized } from '@boomerbuddy/authorization';
import {
  localMessagingConsentResponseSchema,
  localMessagingDestinationRequestSchema,
  localMessagingDestinationResponseSchema,
  localMessagingStatusSchema,
  localMessagingSupportMetadataResponseSchema,
  localMessagingSupportReadRequestSchema,
  localMessagingSupportReadResponseSchema,
  opaqueIdSchema,
  selfMessagingConsentRequestSchema,
} from '@boomerbuddy/contracts';
import { DomainError } from '@boomerbuddy/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { assertMutationOrigin, authenticate } from '../auth';
import type { ApiContext } from '../context';

const destinationParamsSchema = z.object({ destinationId: opaqueIdSchema }).strict();
const consentParamsSchema = z
  .object({ destinationId: opaqueIdSchema, action: z.enum(['grant', 'withdraw']) })
  .strict();
const supportParamsSchema = z.object({ eventKey: opaqueIdSchema }).strict();
const supportQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

function assertLocalOnly(context: ApiContext): void {
  if (context.config.environment === 'production') {
    throw new DomainError(
      'not_found',
      'Messaging is unavailable until the provider, consent, and founder activation gates pass',
    );
  }
}

function setPrivateNoStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'private, no-store, max-age=0');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
  reply.header('Vary', 'Cookie, Authorization');
}

export function registerMessagingRoutes(app: FastifyInstance, context: ApiContext): void {
  app.post('/v1/messaging/local/destinations', async (request, reply) => {
    setPrivateNoStore(reply);
    assertLocalOnly(context);
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      now,
    );
    assertMutationOrigin(request, context.config, auth);
    const body = localMessagingDestinationRequestSchema.parse(request.body);
    const destination = await context.repositories.messaging.registerLocalDestination({
      actorPersonId: auth.principal.personId,
      personId: auth.principal.personId,
      destination: body.localFixtureDestination,
      timeZone: body.timeZone,
      locale: body.locale,
      jurisdiction: body.jurisdiction,
      now,
    });
    const status = await context.repositories.messaging.status({
      personId: auth.principal.personId,
      destinationId: destination.id,
    });
    return reply.code(201).send(
      localMessagingDestinationResponseSchema.parse({
        destination: {
          id: destination.id,
          locale: destination.locale,
          jurisdiction: destination.jurisdiction,
          timeZoneKnown: destination.timeZone !== undefined,
          evidenceTier: destination.evidenceTier,
          createdAt: destination.createdAt.toISOString(),
        },
        status,
        providerNetworkPermitted: false,
      }),
    );
  });

  app.get('/v1/messaging/local/destinations/:destinationId', async (request, reply) => {
    setPrivateNoStore(reply);
    assertLocalOnly(context);
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      context.now(),
    );
    const { destinationId } = destinationParamsSchema.parse(request.params);
    return localMessagingStatusSchema.parse(
      await context.repositories.messaging.status({
        personId: auth.principal.personId,
        destinationId,
      }),
    );
  });

  app.post(
    '/v1/messaging/local/destinations/:destinationId/consents/:action',
    async (request, reply) => {
      setPrivateNoStore(reply);
      assertLocalOnly(context);
      const now = context.now();
      const auth = await authenticate(
        request,
        context.repositories.sessions,
        context.config,
        ['customer', 'mobile'],
        now,
      );
      assertMutationOrigin(request, context.config, auth);
      const { destinationId, action } = consentParamsSchema.parse(request.params);
      const body = selfMessagingConsentRequestSchema.parse(request.body);
      const sourceSurface = auth.audience === 'mobile' ? 'mobile_app' : 'member_web';
      const consentEvidenceId = await (action === 'grant'
        ? context.repositories.messaging.grantConsent({
            actorPersonId: auth.principal.personId,
            personId: auth.principal.personId,
            destinationId,
            purpose: body.purpose,
            sourceSurface,
            now,
          })
        : context.repositories.messaging.withdrawConsent({
            actorPersonId: auth.principal.personId,
            personId: auth.principal.personId,
            destinationId,
            purpose: body.purpose,
            sourceSurface,
            now,
          }));
      const status = await context.repositories.messaging.status({
        personId: auth.principal.personId,
        destinationId,
      });
      return localMessagingConsentResponseSchema.parse({
        consentEvidenceId,
        action,
        status,
        providerNetworkPermitted: false,
      });
    },
  );

  app.get('/v1/hq/messaging/support', async (request, reply) => {
    setPrivateNoStore(reply);
    assertLocalOnly(context);
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['hq'],
      now,
    );
    if (!auth.principal.roles.includes('hq_support')) {
      throw new DomainError('not_authorized', 'Assigned messaging support is unavailable');
    }
    const { limit } = supportQuerySchema.parse(request.query);
    const items = await context.repositories.messaging.listAssignedSupportMetadata({
      employeePersonId: auth.principal.personId,
      limit,
      now,
    });
    return localMessagingSupportMetadataResponseSchema.parse({
      items: items.map((item) => ({
        ...item,
        observedAt: item.observedAt.toISOString(),
        ...(item.retentionDeadline === undefined
          ? {}
          : { retentionDeadline: item.retentionDeadline.toISOString() }),
      })),
      contentIncluded: false,
      evidenceTier: 'local_simulation',
    });
  });

  app.post('/v1/hq/messaging/support/:eventKey/read', async (request, reply) => {
    setPrivateNoStore(reply);
    assertLocalOnly(context);
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['hq'],
      now,
    );
    assertMutationOrigin(request, context.config, auth);
    const { eventKey } = supportParamsSchema.parse(request.params);
    const { restrictedAccessGrantId } = localMessagingSupportReadRequestSchema.parse(request.body);
    const access = auth.principal.restrictedAccess.find(
      (scope) =>
        scope.grantId === restrictedAccessGrantId &&
        scope.resourceType === 'messaging_inbound' &&
        scope.resourceId === eventKey,
    );
    if (access === undefined) {
      throw new DomainError('not_authorized', 'Messaging support content is unavailable');
    }
    assertAuthorized({
      principal: auth.principal,
      action: 'hq:restricted_resource:read',
      resource: {
        kind: 'restricted_customer_resource',
        householdId: access.householdId,
        caseId: access.caseId,
        resourceType: 'messaging_inbound',
        resourceId: eventKey,
      },
    });
    const minimizedMessage = await context.repositories.messaging.readAssignedSupportMessage({
      employeePersonId: auth.principal.personId,
      eventKey,
      restrictedAccessGrantId,
      now,
    });
    return localMessagingSupportReadResponseSchema.parse({
      eventKey,
      minimizedMessage,
      evidenceTier: 'local_simulation',
      contentBoundary: 'exact_assignee_minimized_support_message',
    });
  });
}
