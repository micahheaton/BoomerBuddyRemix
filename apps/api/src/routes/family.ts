import { assertAuthorized } from '@boomerbuddy/authorization';
import {
  acceptHouseholdMemberInvitationRequestSchema,
  acceptHouseholdMemberInvitationResponseSchema,
  acceptInvitationRequestSchema,
  acceptInvitationResponseSchema,
  createHouseholdMemberInvitationRequestSchema,
  createHouseholdMemberInvitationResponseSchema,
  createInvitationRequestSchema,
  createInvitationResponseSchema,
  createRecipientConnectionCodeResponseSchema,
  familyResponseSchema,
  householdMemberInvitationCredentialRequestSchema,
  householdMemberInvitationPreviewResponseSchema,
  invitationCredentialRequestSchema,
  invitationPreviewResponseSchema,
  opaqueIdSchema,
  revokeHouseholdMemberInvitationResponseSchema,
  revokeHouseholdMemberResponseSchema,
  revokeInvitationResponseSchema,
  revokeRelationshipResponseSchema,
} from '@boomerbuddy/contracts';
import { DomainError, ids } from '@boomerbuddy/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  assertMutationOrigin,
  assertRecentCustomerAuthentication,
  authenticate,
  correlationId,
  selectedHousehold,
} from '../auth';
import type { ApiContext } from '../context';
import { familyDto, relationshipDto } from '../mappers';

const invitationParamsSchema = z.object({ invitationId: opaqueIdSchema });
const membershipParamsSchema = z.object({ membershipId: opaqueIdSchema });
const relationshipParamsSchema = z.object({ relationshipId: opaqueIdSchema });

function rateLimited(reply: FastifyReply, requestId: string, now: Date, message: string) {
  const nextHour = (Math.floor(now.getTime() / 3_600_000) + 1) * 3_600_000;
  void reply.header('Cache-Control', 'private, no-store, max-age=0');
  void reply.header(
    'Retry-After',
    String(Math.max(1, Math.ceil((nextHour - now.getTime()) / 1_000))),
  );
  return reply.code(429).send({
    error: { code: 'rate_limited', message, requestId },
  });
}

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
          : household.isProtectedMember || household.trustedCircleGrants.length > 0
            ? { kind: 'subject_relationships', subjectPersonId: auth.principal.personId }
            : { kind: 'self_membership', memberPersonId: auth.principal.personId },
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

  app.post('/v1/family/recipient-connection-codes', async (request, reply) => {
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      now,
    );
    assertMutationOrigin(request, context.config, auth);
    assertRecentCustomerAuthentication(auth);
    z.object({})
      .strict()
      .parse(request.body ?? {});
    if (context.config.environment !== 'production') {
      throw new DomainError(
        'invalid_input',
        'Recipient connection codes are unavailable in local development',
      );
    }
    const allowed = await context.repositories.family.consumeRecipientCodeRateLimit({
      personId: auth.principal.personId,
      action: 'recipient_code_generation',
      maximumPerHour: 5,
      now,
    });
    if (!allowed) {
      return rateLimited(
        reply,
        request.id,
        now,
        'Trusted Circle connection-code requests are temporarily limited',
      );
    }
    const result = await context.repositories.family.createRecipientConnectionCode({
      identityId: auth.resolved.identityId,
      personId: auth.principal.personId,
      actorIssuer: auth.resolved.issuer,
      actorSubject: auth.resolved.identitySubject,
      audience: auth.audience,
      correlationId: correlationId(request),
      now,
    });
    return reply.code(201).send(
      createRecipientConnectionCodeResponseSchema.parse({
        recipientConnectionCode: result.recipientConnectionCode,
        expiresAt: result.expiresAt.toISOString(),
        delivery: 'manual_only',
      }),
    );
  });

  app.post('/v1/family/member-invitations', async (request, reply) => {
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      now,
    );
    assertMutationOrigin(request, context.config, auth);
    assertRecentCustomerAuthentication(auth);
    const household = selectedHousehold(auth, request);
    const body = createHouseholdMemberInvitationRequestSchema.parse(request.body);
    if (context.config.environment !== 'production') {
      throw new DomainError(
        'invalid_input',
        'Household member invitations require verified production identities',
      );
    }
    assertAuthorized({
      principal: auth.principal,
      action: 'family:invite_member',
      resource: {
        kind: 'family',
        householdId: household.householdId,
        scope: { kind: 'member_invitation' },
      },
    });
    const allowed = await context.repositories.family.consumeRecipientCodeRateLimit({
      personId: auth.principal.personId,
      action: 'recipient_code_lookup',
      maximumPerHour: 20,
      now,
    });
    if (!allowed) {
      return rateLimited(
        reply,
        request.id,
        now,
        'Household member invitation requests are temporarily limited',
      );
    }
    const result = await context.repositories.family.createHouseholdMemberInvitation({
      householdId: household.householdId,
      invitedByPersonId: auth.principal.personId,
      actorIdentityId: auth.resolved.identityId,
      actorIssuer: auth.resolved.issuer,
      actorSubject: auth.resolved.identitySubject,
      recipientConnectionCode: body.recipientConnectionCode,
      audience: auth.audience,
      correlationId: correlationId(request),
      now,
    });
    return reply.code(result.reused ? 200 : 201).send(
      createHouseholdMemberInvitationResponseSchema.parse({
        invitation: {
          ...result.invitation,
          expiresAt: result.invitation.expiresAt.toISOString(),
          createdAt: result.invitation.createdAt.toISOString(),
        },
        credential: 'invitee_connection_code',
        delivery: 'recipient_manual_only',
        reused: result.reused,
      }),
    );
  });

  app.post('/v1/family/member-invitations/:invitationId/preview', async (request) => {
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
    const body = householdMemberInvitationCredentialRequestSchema.parse(request.body);
    const preview = await context.repositories.family.previewHouseholdMemberInvitationCredential(
      invitationId,
      body.invitationCredential,
      now,
    );
    if (preview === null) {
      throw new DomainError('not_found', 'Household invitation is invalid or unavailable');
    }
    if (preview.intendedPersonId !== auth.principal.personId) {
      throw new DomainError('not_found', 'Household invitation is invalid or unavailable');
    }
    assertAuthorized({
      principal: auth.principal,
      action: 'family:accept_invitation',
      resource: {
        kind: 'invitation',
        householdId: ids.household(preview.household.id),
        identityBindingState: 'verified_identity',
        invitedPersonId: ids.person(preview.intendedPersonId),
        credentialPresented: true,
      },
    });
    return householdMemberInvitationPreviewResponseSchema.parse({
      invitation: {
        id: preview.id,
        household: preview.household,
        invitedBy: preview.invitedBy,
        inviteeDisplayName: preview.inviteeDisplayName,
        access: preview.access,
        state: preview.state,
        identityBindingState: preview.identityBindingState,
        expiresAt: preview.expiresAt.toISOString(),
        previewVersion: preview.previewVersion,
      },
    });
  });

  app.post('/v1/family/member-invitations/:invitationId/accept', async (request, reply) => {
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      now,
    );
    assertMutationOrigin(request, context.config, auth);
    assertRecentCustomerAuthentication(auth);
    const { invitationId } = invitationParamsSchema.parse(request.params);
    const body = acceptHouseholdMemberInvitationRequestSchema.parse(request.body);
    const invitation =
      await context.repositories.family.validateHouseholdMemberInvitationCredential(
        invitationId,
        body.invitationCredential,
        now,
      );
    if (invitation === null) {
      throw new DomainError('not_found', 'Household invitation is invalid or unavailable');
    }
    if (invitation.intendedPersonId !== auth.principal.personId) {
      throw new DomainError('not_found', 'Household invitation is invalid or unavailable');
    }
    assertAuthorized({
      principal: auth.principal,
      action: 'family:accept_invitation',
      resource: {
        kind: 'invitation',
        householdId: ids.household(invitation.householdId),
        identityBindingState: 'verified_identity',
        invitedPersonId: ids.person(invitation.intendedPersonId),
        credentialPresented: true,
      },
    });
    const result = await context.repositories.family.acceptHouseholdMemberInvitation({
      invitationId,
      invitationCredential: body.invitationCredential,
      previewVersion: body.previewVersion,
      acceptingIdentityId: auth.resolved.identityId,
      acceptingPersonId: auth.principal.personId,
      actorIssuer: auth.resolved.issuer,
      actorSubject: auth.resolved.identitySubject,
      audience: auth.audience,
      correlationId: correlationId(request),
      now,
    });
    return reply.code(result.reused ? 200 : 201).send(
      acceptHouseholdMemberInvitationResponseSchema.parse({
        membership: {
          membershipId: result.membershipId,
          householdId: result.householdId,
          membershipKind: result.membershipKind,
          status: result.status,
        },
        reused: result.reused,
      }),
    );
  });

  app.delete('/v1/family/member-invitations/:invitationId', async (request, reply) => {
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      now,
    );
    assertMutationOrigin(request, context.config, auth);
    assertRecentCustomerAuthentication(auth);
    const household = selectedHousehold(auth, request);
    const { invitationId } = invitationParamsSchema.parse(request.params);
    const invitation = await context.repositories.family.householdMemberInvitationForCancellation(
      household.householdId,
      invitationId,
      now,
    );
    if (invitation === null) {
      throw new DomainError('not_found', 'Household invitation is invalid or unavailable');
    }
    assertAuthorized({
      principal: auth.principal,
      action: 'family:revoke_member_invitation',
      resource: {
        kind: 'family',
        householdId: household.householdId,
        scope: { kind: 'member_invitation' },
      },
    });
    const state = await context.repositories.family.revokeHouseholdMemberInvitation({
      invitationId,
      householdId: household.householdId,
      actorPersonId: auth.principal.personId,
      actorIdentityId: auth.resolved.identityId,
      actorIssuer: auth.resolved.issuer,
      actorSubject: auth.resolved.identitySubject,
      audience: auth.audience,
      correlationId: correlationId(request),
      now,
    });
    if (state === null) {
      throw new DomainError('not_found', 'Household invitation is invalid or unavailable');
    }
    return reply.send(
      revokeHouseholdMemberInvitationResponseSchema.parse({
        id: invitation.id,
        state,
        endedAt: now.toISOString(),
      }),
    );
  });

  app.delete('/v1/family/members/:membershipId', async (request, reply) => {
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      now,
    );
    assertMutationOrigin(request, context.config, auth);
    assertRecentCustomerAuthentication(auth);
    const household = selectedHousehold(auth, request);
    const { membershipId } = membershipParamsSchema.parse(request.params);
    const membership = await context.repositories.family.neutralMembershipForRevocation(
      household.householdId,
      membershipId,
    );
    if (membership === null) {
      throw new DomainError('not_found', 'Household membership is unavailable');
    }
    assertAuthorized({
      principal: auth.principal,
      action: 'family:revoke_member',
      resource: {
        kind: 'family',
        householdId: household.householdId,
        scope: {
          kind: 'member_membership',
          membershipId: membership.membershipId,
          memberPersonId: ids.person(membership.memberPersonId),
        },
      },
    });
    const state = await context.repositories.family.revokeNeutralMembership({
      membershipId: membership.membershipId,
      householdId: household.householdId,
      memberPersonId: membership.memberPersonId,
      actorPersonId: auth.principal.personId,
      actorIdentityId: auth.resolved.identityId,
      actorIssuer: auth.resolved.issuer,
      actorSubject: auth.resolved.identitySubject,
      audience: auth.audience,
      correlationId: correlationId(request),
      now,
    });
    if (state === null) {
      throw new DomainError('not_found', 'Household membership is unavailable');
    }
    return reply.send(
      revokeHouseholdMemberResponseSchema.parse({
        membershipId: membership.membershipId,
        state,
        endedAt: now.toISOString(),
      }),
    );
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
    assertRecentCustomerAuthentication(auth);
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
    if (context.config.environment === 'production') {
      const allowed = await context.repositories.family.consumeRecipientCodeRateLimit({
        personId: auth.principal.personId,
        action: 'recipient_code_lookup',
        maximumPerHour: 20,
        now,
      });
      if (!allowed) {
        return rateLimited(
          reply,
          request.id,
          now,
          'Trusted Circle invitation requests are temporarily limited',
        );
      }
    }
    const result = await context.repositories.family.createInvitation({
      householdId: household.householdId,
      invitedByPersonId: auth.principal.personId,
      protectedPersonId: auth.principal.personId,
      ...(body.inviteeDisplayName === undefined
        ? {}
        : { inviteeDisplayName: body.inviteeDisplayName }),
      ...(body.recipientConnectionCode === undefined
        ? {}
        : { recipientConnectionCode: body.recipientConnectionCode }),
      permissions: body.permissions,
      audience: auth.audience,
      actorIssuer: auth.resolved.principal.issuer,
      sessionId: auth.principal.sessionId,
      correlationId: correlationId(request),
      now,
    });
    return reply.code(result.reused ? 200 : 201).send(
      createInvitationResponseSchema.parse({
        invitation: {
          ...result.invitation,
          permissions: [...result.invitation.permissions],
          expiresAt: result.invitation.expiresAt.toISOString(),
          createdAt: result.invitation.createdAt.toISOString(),
        },
        ...(result.delivery === 'local_only'
          ? {
              localInviteCode: result.localInviteCode,
              credential: 'local_invite_code' as const,
              delivery: 'local_only' as const,
              reused: false as const,
            }
          : {
              credential: 'invitee_connection_code' as const,
              delivery: 'recipient_manual_only' as const,
              reused: result.reused,
            }),
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
    assertRecentCustomerAuthentication(auth);
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
    const result = await context.repositories.family.acceptInvitation({
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
    return reply.code(result.reused ? 200 : 201).send(
      acceptInvitationResponseSchema.parse({
        relationship: relationshipDto(result.relationship),
        householdId: invitation.householdId,
        reused: result.reused,
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
    assertRecentCustomerAuthentication(auth);
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
    assertRecentCustomerAuthentication(auth);
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
