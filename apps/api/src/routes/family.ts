import { assertAuthorized } from '@boomerbuddy/authorization';
import {
  acceptInvitationRequestSchema,
  acceptInvitationResponseSchema,
  createInvitationRequestSchema,
  createInvitationResponseSchema,
  familyResponseSchema,
  invitationCredentialRequestSchema,
  invitationPreviewResponseSchema,
  opaqueIdSchema,
  revokeInvitationResponseSchema,
  revokeRelationshipResponseSchema,
} from '@boomerbuddy/contracts';
import { DomainError, ids } from '@boomerbuddy/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertMutationOrigin, authenticate, correlationId, selectedHousehold } from '../auth';
import type { ApiContext } from '../context';
import { familyDto, relationshipDto } from '../mappers';

const invitationParamsSchema = z.object({ invitationId: opaqueIdSchema });
const relationshipParamsSchema = z.object({ relationshipId: opaqueIdSchema });

export function registerFamilyRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get('/v1/family', async (request) => {
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      context.now(),
    );
    const household = selectedHousehold(auth, request);
    assertAuthorized({
      principal: auth.principal,
      action: 'family:view',
      resource: {
        kind: 'family',
        householdId: household.householdId,
        scope: household.isAdministrator
          ? { kind: 'roster' }
          : { kind: 'subject_relationships', subjectPersonId: auth.principal.personId },
      },
    });
    const family = await context.repositories.family.list(
      household.householdId,
      auth.principal.personId,
      context.now(),
    );
    if (family === null) throw new DomainError('not_found', 'Family information is unavailable');
    return familyResponseSchema.parse(familyDto(family));
  });

  app.post('/v1/family/invitations', async (request, reply) => {
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
    const body = createInvitationRequestSchema.parse(request.body);
    assertAuthorized({
      principal: auth.principal,
      action: 'family:invite',
      resource: {
        kind: 'family',
        householdId: household.householdId,
        scope: {
          kind: 'subject_invitation',
          protectedPersonId: auth.principal.personId,
        },
      },
    });
    const result = await context.repositories.family.createInvitation({
      householdId: household.householdId,
      invitedByPersonId: auth.principal.personId,
      protectedPersonId: auth.principal.personId,
      inviteeDisplayName: body.inviteeDisplayName,
      permissions: body.permissions,
      audience: auth.audience,
      actorIssuer: auth.resolved.principal.issuer,
      sessionId: auth.principal.sessionId,
      correlationId: correlationId(request),
      now,
    });
    return reply.code(201).send(
      createInvitationResponseSchema.parse({
        invitation: {
          ...result.invitation,
          permissions: [...result.invitation.permissions],
          expiresAt: result.invitation.expiresAt.toISOString(),
          createdAt: result.invitation.createdAt.toISOString(),
        },
        localInviteCode: result.localInviteCode,
        delivery: 'local_only',
      }),
    );
  });

  app.post('/v1/family/invitations/:invitationId/preview', async (request) => {
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      now,
    );
    assertMutationOrigin(request, context.config, auth);
    const { invitationId } = invitationParamsSchema.parse(request.params);
    const body = invitationCredentialRequestSchema.parse(request.body);
    const preview = await context.repositories.family.previewInvitationCredential(
      invitationId,
      body.localInviteCode,
      now,
    );
    if (preview === null)
      throw new DomainError('not_found', 'Invitation is invalid or unavailable');
    assertAuthorized({
      principal: auth.principal,
      action: 'family:accept_invitation',
      resource: {
        kind: 'invitation',
        householdId: ids.household(preview.household.id),
        identityBindingState: preview.identityBindingState,
        ...(preview.invitedPersonId === undefined
          ? {}
          : { invitedPersonId: ids.person(preview.invitedPersonId) }),
        credentialPresented: true,
      },
    });
    return invitationPreviewResponseSchema.parse({
      invitation: {
        ...preview,
        permissions: [...preview.permissions],
        expiresAt: preview.expiresAt.toISOString(),
      },
    });
  });

  app.post('/v1/family/invitations/:invitationId/accept', async (request, reply) => {
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      now,
    );
    assertMutationOrigin(request, context.config, auth);
    const { invitationId } = invitationParamsSchema.parse(request.params);
    const body = acceptInvitationRequestSchema.parse(request.body);
    const invitation = await context.repositories.family.validateInvitationCredential(
      invitationId,
      body.localInviteCode,
      now,
    );
    if (invitation === null)
      throw new DomainError('not_found', 'Invitation is invalid or unavailable');
    assertAuthorized({
      principal: auth.principal,
      action: 'family:accept_invitation',
      resource: {
        kind: 'invitation',
        householdId: ids.household(invitation.householdId),
        identityBindingState: invitation.identityBindingState,
        ...(invitation.invitedPersonId === undefined
          ? {}
          : { invitedPersonId: ids.person(invitation.invitedPersonId) }),
        credentialPresented: true,
      },
    });
    const relationship = await context.repositories.family.acceptInvitation({
      invitationId,
      localInviteCode: body.localInviteCode,
      previewVersion: body.previewVersion,
      acceptingPersonId: auth.principal.personId,
      audience: auth.audience,
      actorIssuer: auth.resolved.principal.issuer,
      sessionId: auth.principal.sessionId,
      correlationId: correlationId(request),
      now,
    });
    return reply.code(201).send(
      acceptInvitationResponseSchema.parse({
        relationship: relationshipDto(relationship),
        householdId: invitation.householdId,
      }),
    );
  });

  app.delete('/v1/family/invitations/:invitationId', async (request, reply) => {
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
    const { invitationId } = invitationParamsSchema.parse(request.params);
    const invitation = await context.repositories.family.invitationForCancellation(
      household.householdId,
      invitationId,
      now,
    );
    if (invitation === null || invitation.state !== 'pending') {
      throw new DomainError('not_found', 'Invitation is invalid or unavailable');
    }
    const protectedPersonId = ids.person(invitation.protectedPersonId);
    assertAuthorized({
      principal: auth.principal,
      action: 'family:revoke_invitation',
      resource: {
        kind: 'family',
        householdId: household.householdId,
        scope: { kind: 'subject_invitation', protectedPersonId },
      },
    });
    const revoked = await context.repositories.family.revokeInvitation({
      invitationId,
      householdId: household.householdId,
      protectedPersonId,
      actorPersonId: auth.principal.personId,
      audience: auth.audience,
      actorIssuer: auth.resolved.principal.issuer,
      sessionId: auth.principal.sessionId,
      correlationId: correlationId(request),
      now,
    });
    if (revoked === null)
      throw new DomainError('not_found', 'Invitation is invalid or unavailable');
    return reply.send(
      revokeInvitationResponseSchema.parse({
        id: invitationId,
        state: revoked,
        endedAt: now.toISOString(),
      }),
    );
  });

  app.delete('/v1/family/relationships/:relationshipId', async (request, reply) => {
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
    const { relationshipId } = relationshipParamsSchema.parse(request.params);
    const relationship = await context.repositories.family.relationshipForRevocation(
      household.householdId,
      relationshipId,
    );
    if (relationship === null) {
      throw new DomainError('not_found', 'Trusted Circle relationship is unavailable');
    }
    const protectedPersonId = ids.person(relationship.protectedPersonId);
    const trustedPersonId = ids.person(relationship.trustedPersonId);
    assertAuthorized({
      principal: auth.principal,
      action: 'family:revoke',
      resource: {
        kind: 'family',
        householdId: household.householdId,
        scope: {
          kind: 'pairwise_relationship',
          relationshipId: ids.relationship(relationship.id),
          protectedPersonId,
          trustedPersonId,
        },
      },
    });
    const revoked = await context.repositories.family.revokeRelationship({
      relationshipId,
      householdId: household.householdId,
      protectedPersonId,
      trustedPersonId,
      actorPersonId: auth.principal.personId,
      audience: auth.audience,
      actorIssuer: auth.resolved.principal.issuer,
      sessionId: auth.principal.sessionId,
      correlationId: correlationId(request),
      now,
    });
    if (revoked === null)
      throw new DomainError('not_found', 'Trusted Circle relationship is unavailable');
    return reply.send(
      revokeRelationshipResponseSchema.parse({
        id: relationshipId,
        state: revoked,
        endedAt: now.toISOString(),
      }),
    );
  });
}
