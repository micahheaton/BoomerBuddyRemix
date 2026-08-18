import type { AppConfig } from '@boomerbuddy/config';
import {
  assignedFeedbackContentResponseSchema,
  createAnonymousFeedbackRequestSchema,
  createAuthenticatedFeedbackRequestSchema,
  feedbackAdapterResponseSchema,
  feedbackConsentWithdrawalParamsSchema,
  feedbackConsentWithdrawalResponseSchema,
  feedbackIntakeResponseSchema,
  feedbackReviewClaimResponseSchema,
  feedbackReviewParamsSchema,
  hqFeedbackQueueResponseSchema,
  supportFeedbackConversionParamsSchema,
  supportFeedbackConversionRequestSchema,
  type CreateAnonymousFeedbackRequest,
  type CreateAuthenticatedFeedbackRequest,
  type SupportFeedbackConversionRequest,
} from '@boomerbuddy/contracts';
import {
  DomainError,
  canonicalFeedbackNetworkAddress,
  feedbackAdapterRegistry,
  feedbackEvidenceTierForEnvironment,
  type FeedbackEvidenceTier,
} from '@boomerbuddy/domain';
import type { SessionRepository } from '@boomerbuddy/persistence';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { assertMutationOrigin, authenticate, correlationId, selectedHousehold } from '../auth';

interface FeedbackRouteRepository {
  createAuthenticated(input: {
    readonly householdId: string;
    readonly actorPersonId: string;
    readonly request: CreateAuthenticatedFeedbackRequest;
    readonly correlationId: string;
    readonly evidenceTier: FeedbackEvidenceTier;
    readonly now: Date;
  }): Promise<{
    readonly id: string;
    readonly status: string;
    readonly redactionStatus: string;
    readonly queue: string;
    readonly evidenceTier: FeedbackEvidenceTier;
    readonly retainedUntil?: Date;
    readonly reused: boolean;
  }>;
  createAnonymous(input: {
    readonly networkAddress: string;
    readonly request: CreateAnonymousFeedbackRequest;
    readonly correlationId: string;
    readonly evidenceTier: 'local_simulation';
    readonly now: Date;
  }): Promise<{
    readonly id: string;
    readonly status: string;
    readonly redactionStatus: string;
    readonly queue: string;
    readonly evidenceTier: FeedbackEvidenceTier;
    readonly retainedUntil?: Date;
    readonly reused: boolean;
  }>;
  convertSupportCase(input: {
    readonly householdId: string;
    readonly supportCaseId: string;
    readonly actorPersonId: string;
    readonly request: SupportFeedbackConversionRequest;
    readonly correlationId: string;
    readonly evidenceTier: 'local_simulation';
    readonly now: Date;
  }): Promise<{
    readonly id: string;
    readonly status: string;
    readonly redactionStatus: string;
    readonly queue: string;
    readonly evidenceTier: FeedbackEvidenceTier;
    readonly retainedUntil?: Date;
    readonly reused: boolean;
  }>;
  withdrawAuthenticatedConsent(input: {
    readonly feedbackId: string;
    readonly householdId: string;
    readonly actorPersonId: string;
    readonly purpose: 'follow_up' | 'research_retention' | 'object_linkage';
    readonly correlationId: string;
    readonly evidenceTier: FeedbackEvidenceTier;
    readonly now: Date;
  }): Promise<{
    readonly withdrawn: boolean;
    readonly activeStoreCiphertextErased: boolean;
  }>;
  roleScopedMetadata(input: {
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly evidenceTier: FeedbackEvidenceTier;
    readonly now: Date;
  }): Promise<readonly FeedbackQueueItemLike[]>;
  claimForReview(input: {
    readonly feedbackId: string;
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly evidenceTier: FeedbackEvidenceTier;
    readonly now: Date;
  }): Promise<{
    readonly feedbackId: string;
    readonly queue: string;
    readonly assignmentVersion: number;
    readonly humanReviewRequired: boolean;
    readonly reused: boolean;
    readonly evidenceTier: FeedbackEvidenceTier;
    readonly externalActionExecuted: false;
  }>;
  readAssignedMinimizedText(input: {
    readonly feedbackId: string;
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly evidenceTier: FeedbackEvidenceTier;
    readonly now: Date;
  }): Promise<{
    readonly feedbackId: string;
    readonly minimizedText: string;
    readonly redactionStatus: 'minimized_clean' | 'minimized_redacted';
    readonly evidenceTier: FeedbackEvidenceTier;
    readonly contentBoundary: 'assigned_minimized_text';
    readonly externalActionExecuted: false;
  }>;
}

interface FeedbackQueueItemLike {
  readonly id: string;
  readonly identityMode: 'authenticated' | 'anonymous' | 'support_conversion';
  readonly householdId?: string;
  readonly sourceSurface:
    | 'web_feedback_form'
    | 'in_app_contextual'
    | 'mobile_app'
    | 'post_check'
    | 'orientation'
    | 'cancellation'
    | 'refund'
    | 'support_conversion';
  readonly feedbackType:
    | 'product_feedback'
    | 'bug_report'
    | 'safety_concern'
    | 'accessibility_issue'
    | 'support_request'
    | 'pricing_feedback'
    | 'feature_request'
    | 'cancellation_reason'
    | 'refund_feedback'
    | 'research_response';
  readonly status: string;
  readonly severity: string;
  readonly classification: string;
  readonly queue: string;
  readonly routingState: 'unassigned' | 'assigned';
  readonly redactionStatus: string;
  readonly duplicateOfFeedbackId?: string;
  readonly clusterId?: string;
  readonly resultingActionType?: 'issue' | 'experiment' | 'content' | 'support_action';
  readonly resultingActionId?: string;
  readonly closeLoopState: string;
  readonly followUpConsented: boolean;
  readonly researchRetentionConsented: boolean;
  readonly evidenceTier: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly routedAt: Date;
  readonly assignedAt?: Date;
  readonly contentReadAuthorized: boolean;
  readonly selfClaimAvailable: boolean;
}

export interface FeedbackRouteServices {
  readonly config: AppConfig;
  readonly sessions: SessionRepository;
  readonly feedback: FeedbackRouteRepository;
  readonly now: () => Date;
}

function assertNonProductionOnly(config: AppConfig): void {
  if (config.environment === 'production') {
    throw new DomainError(
      'not_found',
      'Feedback intake is unavailable until the founder activation gates are complete',
    );
  }
}

function assertProductionFounder(
  config: AppConfig,
  principal: { readonly personId: string; readonly roles: readonly string[] },
): void {
  if (
    config.environment === 'production' &&
    (config.identity.founderPersonId === undefined ||
      principal.personId !== config.identity.founderPersonId ||
      !principal.roles.includes('hq_owner'))
  ) {
    throw new DomainError('not_authorized', 'Production feedback review requires the founder role');
  }
}

function setPrivateNoStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'private, no-store, max-age=0');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
}

function intakeResponse(
  result: Awaited<ReturnType<FeedbackRouteRepository['createAuthenticated']>>,
) {
  return feedbackIntakeResponseSchema.parse({
    feedback: {
      id: result.id,
      status: result.status,
      redactionStatus: result.redactionStatus,
      queue: result.queue,
      evidenceTier: result.evidenceTier,
      ...(result.retainedUntil === undefined
        ? {}
        : { retainedUntil: result.retainedUntil.toISOString() }),
      reused: result.reused,
    },
    mediaAccepted: false,
    providerProcessed: false,
    externalActionExecuted: false,
  });
}

export function registerFeedbackRoutes(
  app: FastifyInstance,
  services: FeedbackRouteServices,
): void {
  app.get('/v1/feedback/adapters', () =>
    feedbackAdapterResponseSchema.parse({
      adapters: feedbackAdapterRegistry,
      evidenceTier: feedbackEvidenceTierForEnvironment(services.config.environment),
    }),
  );

  app.post('/v1/public/feedback', async (request, reply) => {
    assertNonProductionOnly(services.config);
    const now = services.now();
    const body = createAnonymousFeedbackRequestSchema.parse(request.body);
    const result = await services.feedback.createAnonymous({
      // Fastify resolves request.ip through the app's configured trustProxy boundary.
      // Canonicalization happens only after that resolution and is repeated by persistence.
      networkAddress: canonicalFeedbackNetworkAddress(request.ip),
      request: body,
      correlationId: correlationId(request),
      evidenceTier: 'local_simulation',
      now,
    });
    return reply.code(result.reused ? 200 : 201).send(intakeResponse(result));
  });

  app.post('/v1/feedback', async (request, reply) => {
    const now = services.now();
    const evidenceTier = feedbackEvidenceTierForEnvironment(services.config.environment);
    const auth = await authenticate(
      request,
      services.sessions,
      services.config,
      ['customer', 'mobile'],
      now,
    );
    assertMutationOrigin(request, services.config, auth);
    const household = selectedHousehold(auth, request);
    const body = createAuthenticatedFeedbackRequestSchema.parse(request.body);
    const result = await services.feedback.createAuthenticated({
      householdId: household.householdId,
      actorPersonId: auth.principal.personId,
      request: body,
      correlationId: correlationId(request),
      evidenceTier,
      now,
    });
    return reply.code(result.reused ? 200 : 201).send(intakeResponse(result));
  });

  app.post('/v1/feedback/:feedbackId/consents/:purpose/withdraw', async (request) => {
    const now = services.now();
    const evidenceTier = feedbackEvidenceTierForEnvironment(services.config.environment);
    const auth = await authenticate(
      request,
      services.sessions,
      services.config,
      ['customer', 'mobile'],
      now,
    );
    assertMutationOrigin(request, services.config, auth);
    const household = selectedHousehold(auth, request);
    const params = feedbackConsentWithdrawalParamsSchema.parse(request.params);
    const result = await services.feedback.withdrawAuthenticatedConsent({
      feedbackId: params.feedbackId,
      householdId: household.householdId,
      actorPersonId: auth.principal.personId,
      purpose: params.purpose,
      correlationId: correlationId(request),
      evidenceTier,
      now,
    });
    return feedbackConsentWithdrawalResponseSchema.parse({
      feedbackId: params.feedbackId,
      purpose: params.purpose,
      withdrawn: result.withdrawn,
      activeStoreCiphertextErased: result.activeStoreCiphertextErased,
      externalActionExecuted: false,
    });
  });

  app.post(
    '/v1/hq/households/:householdId/support-cases/:supportCaseId/feedback',
    async (request, reply) => {
      assertNonProductionOnly(services.config);
      const now = services.now();
      const auth = await authenticate(request, services.sessions, services.config, ['hq'], now);
      assertMutationOrigin(request, services.config, auth);
      const params = supportFeedbackConversionParamsSchema.parse(request.params);
      const body = supportFeedbackConversionRequestSchema.parse(request.body);
      const result = await services.feedback.convertSupportCase({
        householdId: params.householdId,
        supportCaseId: params.supportCaseId,
        actorPersonId: auth.principal.personId,
        request: body,
        correlationId: correlationId(request),
        evidenceTier: 'local_simulation',
        now,
      });
      return reply.code(result.reused ? 200 : 201).send(intakeResponse(result));
    },
  );

  app.get('/v1/hq/feedback', async (request, reply) => {
    setPrivateNoStore(reply);
    const now = services.now();
    const evidenceTier = feedbackEvidenceTierForEnvironment(services.config.environment);
    const auth = await authenticate(request, services.sessions, services.config, ['hq'], now);
    assertProductionFounder(services.config, auth.principal);
    const feedback = await services.feedback.roleScopedMetadata({
      actorPersonId: auth.principal.personId,
      correlationId: correlationId(request),
      evidenceTier,
      now,
    });
    return hqFeedbackQueueResponseSchema.parse({
      projection: 'owner_global_or_exact_assigned_feedback_metadata',
      contentIncluded: false,
      externalActionExecuted: false,
      feedback: feedback.map((item) => ({
        ...item,
        createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
        routedAt: item.routedAt instanceof Date ? item.routedAt.toISOString() : item.routedAt,
        ...(item.assignedAt === undefined
          ? {}
          : {
              assignedAt:
                item.assignedAt instanceof Date ? item.assignedAt.toISOString() : item.assignedAt,
            }),
      })),
    });
  });

  app.post('/v1/hq/feedback/:feedbackId/claim', async (request) => {
    const now = services.now();
    const evidenceTier = feedbackEvidenceTierForEnvironment(services.config.environment);
    const auth = await authenticate(request, services.sessions, services.config, ['hq'], now);
    assertProductionFounder(services.config, auth.principal);
    assertMutationOrigin(request, services.config, auth);
    const params = feedbackReviewParamsSchema.parse(request.params);
    const result = await services.feedback.claimForReview({
      feedbackId: params.feedbackId,
      actorPersonId: auth.principal.personId,
      correlationId: correlationId(request),
      evidenceTier,
      now,
    });
    return feedbackReviewClaimResponseSchema.parse(result);
  });

  app.get('/v1/hq/feedback/:feedbackId/content', async (request, reply) => {
    setPrivateNoStore(reply);
    const now = services.now();
    const evidenceTier = feedbackEvidenceTierForEnvironment(services.config.environment);
    const auth = await authenticate(request, services.sessions, services.config, ['hq'], now);
    assertProductionFounder(services.config, auth.principal);
    const params = feedbackReviewParamsSchema.parse(request.params);
    const result = await services.feedback.readAssignedMinimizedText({
      feedbackId: params.feedbackId,
      actorPersonId: auth.principal.personId,
      correlationId: correlationId(request),
      evidenceTier,
      now,
    });
    return assignedFeedbackContentResponseSchema.parse(result);
  });
}
