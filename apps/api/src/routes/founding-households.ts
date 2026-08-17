import { assertAuthorized, type Action } from '@boomerbuddy/authorization';
import {
  acceptFoundingHouseholdInvitationRequestSchema,
  acceptFoundingHouseholdInvitationResponseSchema,
  configureFoundingHouseholdPolicyRequestSchema,
  configureFoundingHouseholdPolicyResponseSchema,
  createFoundingHouseholdInvitationResponseSchema,
  foundingHouseholdFounderConsoleResponseSchema,
  foundingHouseholdEnrollmentParamsSchema,
  foundingHouseholdInvitationParamsSchema,
  foundingHouseholdInvitationPreviewRequestSchema,
  foundingHouseholdInvitationPreviewResponseSchema,
  foundingHouseholdMemberStatusResponseSchema,
  foundingHouseholdOperationKeySchema,
  offboardFoundingHouseholdResponseSchema,
  revokeFoundingHouseholdInvitationResponseSchema,
} from '@boomerbuddy/contracts';
import { DomainError } from '@boomerbuddy/domain';
import {
  foundingHouseholdProtectedDocuments,
  foundingHouseholdProtectedDisclosureText,
  foundingHouseholdProtectedPolicyText,
  foundingHouseholdServiceDocuments,
  foundingHouseholdServiceDisclosureText,
  foundingHouseholdServicePolicyText,
  type FoundingHouseholdEnrollmentRecord,
  type FoundingHouseholdInvitationRecord,
  type FoundingHouseholdPolicyRecord,
} from '@boomerbuddy/persistence';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  assertMutationOrigin,
  authenticate,
  correlationId,
  selectedHousehold,
  type AuthContext,
} from '../auth';
import type { ApiContext } from '../context';

function policyDto(policy: FoundingHouseholdPolicyRecord) {
  return {
    revision: policy.revision,
    state: policy.state,
    ...(policy.benefitKey === undefined ? {} : { benefitKey: policy.benefitKey }),
    ...(policy.maxHouseholds === undefined ? {} : { maxHouseholds: policy.maxHouseholds }),
    ...(policy.invitationTtlDays === undefined
      ? {}
      : { invitationTtlDays: policy.invitationTtlDays }),
    ...(policy.accessDurationDays === undefined
      ? {}
      : { accessDurationDays: policy.accessDurationDays }),
    ...(policy.programEndsAt === undefined
      ? {}
      : { programEndsAt: policy.programEndsAt.toISOString() }),
    changedAt: policy.changedAt.toISOString(),
  };
}

function invitationDto(invitation: FoundingHouseholdInvitationRecord) {
  return {
    id: invitation.id,
    policyRevision: invitation.policyRevision,
    benefitKey: invitation.benefitKey,
    state: invitation.state,
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

function enrollmentDto(enrollment: FoundingHouseholdEnrollmentRecord) {
  return {
    id: enrollment.id,
    householdId: enrollment.householdId,
    invitationId: enrollment.invitationId,
    benefitKey: enrollment.benefitKey,
    state: enrollment.state,
    ledgerState: enrollment.ledgerState,
    ...(enrollment.accessAttentionCode === undefined
      ? {}
      : { accessAttentionCode: enrollment.accessAttentionCode }),
    serviceConsentState: enrollment.serviceConsentState,
    startsAt: enrollment.startsAt.toISOString(),
    endsAt: enrollment.endsAt.toISOString(),
    effectiveEndsAt: enrollment.effectiveEndsAt.toISOString(),
    paymentState: enrollment.paymentState,
    evidenceTier: enrollment.evidenceTier,
    researchConsent: enrollment.researchConsent,
    marketingConsent: enrollment.marketingConsent,
    followUpConsent: enrollment.followUpConsent,
    funnel: enrollment.funnel.map((milestone) => ({
      stage: milestone.stage,
      state: milestone.state,
      evidenceSource: milestone.evidenceSource,
    })),
  };
}

async function authorizeFounder(
  request: FastifyRequest,
  context: ApiContext,
  action: Extract<Action, 'hq:founding_households:read' | 'hq:founding_households:manage'>,
) {
  const auth = await authenticate(
    request,
    context.repositories.sessions,
    context.config,
    ['hq'],
    context.now(),
  );
  assertAuthorized({
    principal: auth.principal,
    action,
    resource: {
      kind: 'founding_household_program',
      ...(context.config.identity.founderPersonId === undefined
        ? {}
        : { configuredFounderPersonId: context.config.identity.founderPersonId }),
    },
  });
  if (action === 'hq:founding_households:manage') {
    assertMutationOrigin(request, context.config, auth);
  }
  return auth;
}

async function authorizeMember(
  request: FastifyRequest,
  context: ApiContext,
  action: Extract<
    Action,
    'founding_household:view' | 'founding_household:accept' | 'founding_household:offboard'
  >,
  scope: 'status' | 'invitation',
): Promise<{ readonly auth: AuthContext; readonly householdId: string }> {
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
    action,
    resource: {
      kind: 'founding_household',
      householdId: household.householdId,
      scope:
        scope === 'status' ? { kind: 'status' } : { kind: 'invitation', credentialPresented: true },
    },
  });
  return { auth, householdId: household.householdId };
}

function idempotencyKey(request: FastifyRequest): string {
  const raw = request.headers['idempotency-key'];
  if (raw === undefined || Array.isArray(raw)) {
    throw new DomainError('invalid_input', 'One action-bound Idempotency-Key header is required');
  }
  const parsed = foundingHouseholdOperationKeySchema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError('invalid_input', 'One action-bound Idempotency-Key header is required');
  }
  return parsed.data;
}

function memberAccess(auth: AuthContext, request: FastifyRequest) {
  if (auth.audience !== 'customer' && auth.audience !== 'mobile') {
    throw new DomainError('not_authenticated', 'A customer or mobile session is required');
  }
  return {
    actorPersonId: auth.principal.personId,
    actorIssuer: auth.resolved.principal.issuer,
    sessionId: auth.principal.sessionId,
    audience: auth.audience,
    correlationId: correlationId(request),
  };
}

function setPrivateNoStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'private, no-store, max-age=0');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
}

export function registerFoundingHouseholdRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get('/v1/hq/founding-households', async (request, reply) => {
    setPrivateNoStore(reply);
    const auth = await authorizeFounder(request, context, 'hq:founding_households:read');
    const record = await context.repositories.foundingHouseholds.founderConsole({
      access: {
        actorPersonId: auth.principal.personId,
        correlationId: correlationId(request),
      },
      now: context.now(),
    });
    return foundingHouseholdFounderConsoleResponseSchema.parse({
      authority: 'configured_founder_active_internal_owner',
      evidenceTier: 'local_simulation',
      productionIdentityReady: false,
      paymentCollected: false,
      externalActionExecuted: false,
      policy: policyDto(record.policy),
      capacity: record.capacity,
      invitations: record.invitations.map(invitationDto),
      enrollments: record.enrollments.map(enrollmentDto),
    });
  });

  app.post('/v1/hq/founding-households/policy', async (request, reply) => {
    setPrivateNoStore(reply);
    const auth = await authorizeFounder(request, context, 'hq:founding_households:manage');
    const body = configureFoundingHouseholdPolicyRequestSchema.parse(request.body);
    const current = context.now();
    const result = await context.repositories.foundingHouseholds.configurePolicy({
      access: {
        actorPersonId: auth.principal.personId,
        correlationId: correlationId(request),
      },
      operationKey: idempotencyKey(request),
      expectedRevision: body.expectedRevision,
      state: body.state,
      ...(body.state === 'active'
        ? {
            benefitKey: body.benefitKey,
            maxHouseholds: body.maxHouseholds,
            invitationTtlDays: body.invitationTtlDays,
            accessDurationDays: body.accessDurationDays,
            programEndsAt: new Date(body.programEndsAt),
          }
        : {}),
      now: current,
    });
    return configureFoundingHouseholdPolicyResponseSchema.parse({
      ...result,
      policy: policyDto(result.policy),
    });
  });

  app.post('/v1/hq/founding-households/invitations', async (request, reply) => {
    setPrivateNoStore(reply);
    const auth = await authorizeFounder(request, context, 'hq:founding_households:manage');
    const result = await context.repositories.foundingHouseholds.createInvitation({
      access: {
        actorPersonId: auth.principal.personId,
        correlationId: correlationId(request),
      },
      operationKey: idempotencyKey(request),
      now: context.now(),
    });
    return reply.code(result.reused ? 200 : 201).send(
      createFoundingHouseholdInvitationResponseSchema.parse({
        ...result,
        invitation: invitationDto(result.invitation),
      }),
    );
  });

  app.post(
    '/v1/hq/founding-households/invitations/:invitationId/revoke',
    async (request, reply) => {
      setPrivateNoStore(reply);
      const auth = await authorizeFounder(request, context, 'hq:founding_households:manage');
      const { invitationId } = foundingHouseholdInvitationParamsSchema.parse(request.params);
      const result = await context.repositories.foundingHouseholds.revokeInvitation({
        access: {
          actorPersonId: auth.principal.personId,
          correlationId: correlationId(request),
        },
        invitationId,
        operationKey: idempotencyKey(request),
        now: context.now(),
      });
      return revokeFoundingHouseholdInvitationResponseSchema.parse({
        ...result,
        invitation: invitationDto(result.invitation),
      });
    },
  );

  app.post(
    '/v1/hq/founding-households/enrollments/:householdId/offboard',
    async (request, reply) => {
      setPrivateNoStore(reply);
      const auth = await authorizeFounder(request, context, 'hq:founding_households:manage');
      const { householdId } = foundingHouseholdEnrollmentParamsSchema.parse(request.params);
      const result = await context.repositories.foundingHouseholds.offboard({
        access: {
          actorPersonId: auth.principal.personId,
          correlationId: correlationId(request),
        },
        authority: 'founder',
        householdId,
        operationKey: idempotencyKey(request),
        now: context.now(),
      });
      return offboardFoundingHouseholdResponseSchema.parse({
        ...result,
        enrollment: enrollmentDto(result.enrollment),
      });
    },
  );

  app.get('/v1/founding-households', async (request, reply) => {
    setPrivateNoStore(reply);
    const { auth, householdId } = await authorizeMember(
      request,
      context,
      'founding_household:view',
      'status',
    );
    const enrollment = await context.repositories.foundingHouseholds.memberStatus({
      access: memberAccess(auth, request),
      householdId,
      now: context.now(),
    });
    return foundingHouseholdMemberStatusResponseSchema.parse({
      enrollment: enrollment === null ? null : enrollmentDto(enrollment),
      managedIdentityBlocker: true,
      evidenceTier: 'local_simulation',
    });
  });

  app.post('/v1/founding-households/invitations/:invitationId/preview', async (request, reply) => {
    setPrivateNoStore(reply);
    const { auth, householdId } = await authorizeMember(
      request,
      context,
      'founding_household:view',
      'invitation',
    );
    assertMutationOrigin(request, context.config, auth);
    const { invitationId } = foundingHouseholdInvitationParamsSchema.parse(request.params);
    const body = foundingHouseholdInvitationPreviewRequestSchema.parse(request.body);
    if (body.householdId !== householdId) {
      throw new DomainError('not_authorized', 'Invitation preview is outside this household');
    }
    const result = await context.repositories.foundingHouseholds.previewInvitation({
      access: memberAccess(auth, request),
      householdId,
      invitationId,
      localInvitationCredential: body.localInvitationCredential,
      now: context.now(),
    });
    return foundingHouseholdInvitationPreviewResponseSchema.parse({
      invitationId: result.invitation.id,
      householdId: result.householdId,
      benefit: {
        key: result.benefit.key,
        displayName: result.benefit.displayName,
        protectedMemberLimit: result.benefit.protectedMemberLimit,
        trustedCircleLimit: result.benefit.trustedCircleLimit,
      },
      invitationExpiresAt: result.invitation.expiresAt.toISOString(),
      accessEndsAtIfAcceptedNow: result.accessEndsAtIfAcceptedNow.toISOString(),
      serviceConsentVersion: foundingHouseholdServiceDocuments.disclosureVersion,
      serviceDisclosureText: foundingHouseholdServiceDisclosureText,
      serviceDisclosureDigest: foundingHouseholdServiceDocuments.disclosureDigest,
      servicePolicyText: foundingHouseholdServicePolicyText,
      servicePolicyDigest: foundingHouseholdServiceDocuments.policyDigest,
      protectedEnrollmentConsentVersion: foundingHouseholdProtectedDocuments.disclosureVersion,
      protectedEnrollmentDisclosureText: foundingHouseholdProtectedDisclosureText,
      protectedEnrollmentDisclosureDigest: foundingHouseholdProtectedDocuments.disclosureDigest,
      protectedEnrollmentPolicyText: foundingHouseholdProtectedPolicyText,
      protectedEnrollmentPolicyDigest: foundingHouseholdProtectedDocuments.policyDigest,
      researchConsentRequested: false,
      marketingConsentRequested: false,
      followUpConsentRequested: false,
      paymentRequired: false,
      evidenceTier: 'local_simulation',
    });
  });

  app.post('/v1/founding-households/invitations/:invitationId/accept', async (request, reply) => {
    setPrivateNoStore(reply);
    const { auth, householdId } = await authorizeMember(
      request,
      context,
      'founding_household:accept',
      'invitation',
    );
    assertMutationOrigin(request, context.config, auth);
    const { invitationId } = foundingHouseholdInvitationParamsSchema.parse(request.params);
    const body = acceptFoundingHouseholdInvitationRequestSchema.parse(request.body);
    if (body.householdId !== householdId) {
      throw new DomainError('not_authorized', 'Invitation acceptance is outside this household');
    }
    const result = await context.repositories.foundingHouseholds.acceptInvitation({
      access: memberAccess(auth, request),
      householdId,
      invitationId,
      localInvitationCredential: body.localInvitationCredential,
      operationKey: idempotencyKey(request),
      serviceConsentVersion: body.serviceConsentVersion,
      serviceDisclosureDigest: body.serviceDisclosureDigest,
      servicePolicyDigest: body.servicePolicyDigest,
      protectedEnrollmentConsentVersion: body.protectedEnrollmentConsentVersion,
      protectedEnrollmentDisclosureDigest: body.protectedEnrollmentDisclosureDigest,
      protectedEnrollmentPolicyDigest: body.protectedEnrollmentPolicyDigest,
      now: context.now(),
    });
    return reply.code(result.reused ? 200 : 201).send(
      acceptFoundingHouseholdInvitationResponseSchema.parse({
        ...result,
        enrollment: enrollmentDto(result.enrollment),
      }),
    );
  });

  app.post('/v1/founding-households/offboard', async (request, reply) => {
    setPrivateNoStore(reply);
    const { auth, householdId } = await authorizeMember(
      request,
      context,
      'founding_household:offboard',
      'status',
    );
    assertMutationOrigin(request, context.config, auth);
    const result = await context.repositories.foundingHouseholds.offboard({
      access: memberAccess(auth, request),
      authority: 'household',
      householdId,
      operationKey: idempotencyKey(request),
      now: context.now(),
    });
    return offboardFoundingHouseholdResponseSchema.parse({
      ...result,
      enrollment: enrollmentDto(result.enrollment),
    });
  });
}
