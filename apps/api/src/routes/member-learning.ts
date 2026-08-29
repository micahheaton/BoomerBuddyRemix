import { assertAuthorized } from '@boomerbuddy/authorization';
import {
  answerMemberLearningLessonRequestSchema,
  answerMemberLearningLessonResponseSchema,
  answerWeeklyRehearsalRequestSchema,
  answerWeeklyRehearsalResponseSchema,
  completeWeeklyRehearsalRequestSchema,
  memberLearningFeedItemKeySchema,
  memberLearningLessonKeySchema,
  memberLearningOperationKeySchema,
  memberLearningResponseSchema,
  startMemberLearningLessonRequestSchema,
  updateMemberLearningFeedItemRequestSchema,
  updateMemberLearningPreferencesRequestSchema,
} from '@boomerbuddy/contracts';
import { DomainError } from '@boomerbuddy/domain';
import type { MemberLearningSnapshot } from '@boomerbuddy/persistence';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { assertMutationOrigin, authenticate, correlationId, selectedHousehold } from '../auth';
import type { ApiContext } from '../context';

const lessonParamsSchema = z.object({ lessonKey: memberLearningLessonKeySchema }).strict();
const feedParamsSchema = z.object({ itemKey: memberLearningFeedItemKeySchema }).strict();
const privateCacheControl = 'private, no-store, max-age=0';

function memberLearningDto(snapshot: MemberLearningSnapshot) {
  return memberLearningResponseSchema.parse({
    curriculum: {
      version: snapshot.curriculum.version,
      completedCount: snapshot.curriculum.completedCount,
      totalCount: snapshot.curriculum.totalCount,
      resume: snapshot.curriculum.resume,
      lessons: snapshot.curriculum.lessons.map(({ lesson, progress }) => ({
        key: lesson.key,
        version: lesson.version,
        order: lesson.order,
        title: lesson.title,
        objective: lesson.objective,
        estimatedMinutes: lesson.estimatedMinutes,
        scenario: lesson.scenario,
        options: lesson.options.map((option) => ({ ...option })),
        takeaway: lesson.takeaway,
        sources: lesson.sources.map((source) => ({ ...source })),
        progress: {
          state: progress.state,
          attemptCount: progress.attemptCount,
          reviewCount: progress.reviewCount,
          priorVersionCompleted: progress.priorVersionCompleted,
          ...(progress.startedAt === undefined
            ? {}
            : { startedAt: progress.startedAt.toISOString() }),
          ...(progress.completedAt === undefined
            ? {}
            : { completedAt: progress.completedAt.toISOString() }),
          ...(progress.lastReviewedAt === undefined
            ? {}
            : { lastReviewedAt: progress.lastReviewedAt.toISOString() }),
          ...(progress.reviewDueAt === undefined
            ? {}
            : { reviewDueAt: progress.reviewDueAt.toISOString() }),
          ...(progress.updatedAt === undefined
            ? {}
            : { updatedAt: progress.updatedAt.toISOString() }),
        },
      })),
    },
    guidance: {
      requestedRegion: snapshot.guidance.requestedRegion,
      resolvedRegion: snapshot.guidance.resolvedRegion,
      state: snapshot.guidance.state,
      briefs: snapshot.guidance.briefs.map((brief) => ({
        key: brief.key,
        version: brief.version,
        region: brief.region,
        title: brief.title,
        summary: brief.summary,
        safeActions: [...brief.safeActions],
        source: {
          title: brief.source.title,
          url: brief.source.url,
          publishedAt: brief.source.publishedAt.toISOString(),
        },
        publishedAt: brief.publishedAt.toISOString(),
        reviewedAt: brief.reviewedAt.toISOString(),
        expiresAt: brief.expiresAt.toISOString(),
        freshness: brief.freshness,
      })),
      curated: true,
      liveMonitoring: false,
      exhaustive: false,
      externalFetch: false,
      ...(snapshot.guidance.staleMessage === undefined
        ? {}
        : { staleMessage: snapshot.guidance.staleMessage }),
    },
    preferences: {
      coarseRegion: snapshot.preferences.coarseRegion,
      weeklyRehearsalEnabled: snapshot.preferences.weeklyRehearsalEnabled,
      ...(snapshot.preferences.weeklyRehearsalEnabledAt === undefined
        ? {}
        : {
            weeklyRehearsalEnabledAt: snapshot.preferences.weeklyRehearsalEnabledAt.toISOString(),
          }),
      ...(snapshot.preferences.lastRehearsedAt === undefined
        ? {}
        : { lastRehearsedAt: snapshot.preferences.lastRehearsedAt.toISOString() }),
      ...(snapshot.preferences.nextRehearsalAt === undefined
        ? {}
        : { nextRehearsalAt: snapshot.preferences.nextRehearsalAt.toISOString() }),
      ...(snapshot.preferences.updatedAt === undefined
        ? {}
        : { updatedAt: snapshot.preferences.updatedAt.toISOString() }),
    },
    weeklyRehearsal:
      snapshot.weeklyRehearsal === null
        ? null
        : {
            key: snapshot.weeklyRehearsal.rehearsal.key,
            version: snapshot.weeklyRehearsal.rehearsal.version,
            occurrenceVersion: snapshot.weeklyRehearsal.occurrenceVersion,
            title: snapshot.weeklyRehearsal.rehearsal.title,
            estimatedMinutes: snapshot.weeklyRehearsal.rehearsal.estimatedMinutes,
            scenario: snapshot.weeklyRehearsal.rehearsal.scenario,
            prompt: snapshot.weeklyRehearsal.rehearsal.prompt,
            options: snapshot.weeklyRehearsal.rehearsal.options.map((option) => ({ ...option })),
            takeaway: snapshot.weeklyRehearsal.rehearsal.takeaway,
            source: { ...snapshot.weeklyRehearsal.rehearsal.source },
            reviewedAt: snapshot.weeklyRehearsal.rehearsal.reviewedAt.toISOString(),
            dueAt: snapshot.weeklyRehearsal.dueAt.toISOString(),
          },
    feed: {
      items: snapshot.feed.items.map((item) => ({
        key: item.key,
        version: item.version,
        kind: item.kind,
        state: item.state,
        title: item.title,
        summary: item.summary,
        action: item.action,
        ...(item.lessonKey === undefined ? {} : { lessonKey: item.lessonKey }),
        ...(item.dueAt === undefined ? {} : { dueAt: item.dueAt.toISOString() }),
        createdAt: item.createdAt.toISOString(),
      })),
      unreadCount: snapshot.feed.unreadCount,
      delivery: 'in_app_only',
      externalDelivery: 'disabled',
    },
    contentBoundary: 'repository_curated_in_app_only',
  });
}

function privateResponse(reply: FastifyReply): void {
  void reply.header('Cache-Control', privateCacheControl);
}

function memberLearningOperationKey(
  request: FastifyRequest,
  action:
    | 'lesson-start'
    | 'lesson-answer'
    | 'preferences-update'
    | 'weekly-rehearsal-complete'
    | 'feed-item-update',
): string {
  const parsed = memberLearningOperationKeySchema.safeParse(request.headers['idempotency-key']);
  if (!parsed.success || !parsed.data.startsWith(`member-learning:${action}:`)) {
    throw new DomainError(
      'invalid_input',
      `One action-bound member-learning ${action} Idempotency-Key header is required`,
    );
  }
  return parsed.data;
}

async function memberLearningScope(request: FastifyRequest, context: ApiContext) {
  const auth = await authenticate(
    request,
    context.repositories.sessions,
    context.config,
    ['customer', 'mobile'],
    context.now(),
  );
  const household = selectedHousehold(auth, request);
  return { auth, household, householdId: household.householdId, personId: auth.principal.personId };
}

function authorizeMemberLearning(
  scope: Awaited<ReturnType<typeof memberLearningScope>>,
  action: 'orientation:view' | 'orientation:update',
): void {
  assertAuthorized({
    principal: scope.auth.principal,
    action,
    resource: {
      kind: 'orientation',
      householdId: scope.householdId,
      subjectPersonId: scope.personId,
    },
  });
  if (!scope.household.capabilities.includes('orientation:use')) {
    throw new DomainError('not_authorized', 'Member learning is unavailable for this access');
  }
}

export function registerMemberLearningRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get('/v1/member-learning', async (request, reply) => {
    const scope = await memberLearningScope(request, context);
    authorizeMemberLearning(scope, 'orientation:view');
    const snapshot = await context.repositories.memberLearning.getSnapshot({
      householdId: scope.householdId,
      personId: scope.personId,
      now: context.now(),
    });
    privateResponse(reply);
    return memberLearningDto(snapshot);
  });

  app.post('/v1/member-learning/lessons/:lessonKey/start', async (request, reply) => {
    const scope = await memberLearningScope(request, context);
    authorizeMemberLearning(scope, 'orientation:update');
    assertMutationOrigin(request, context.config, scope.auth);
    const { lessonKey } = lessonParamsSchema.parse(request.params);
    const body = startMemberLearningLessonRequestSchema.parse(request.body);
    const snapshot = await context.repositories.memberLearning.startLesson({
      householdId: scope.householdId,
      personId: scope.personId,
      lessonKey,
      lessonVersion: body.lessonVersion,
      idempotencyKey: memberLearningOperationKey(request, 'lesson-start'),
      audience: scope.auth.audience,
      correlationId: correlationId(request),
      now: context.now(),
    });
    privateResponse(reply);
    return memberLearningDto(snapshot);
  });

  app.post('/v1/member-learning/lessons/:lessonKey/answer', async (request, reply) => {
    const scope = await memberLearningScope(request, context);
    authorizeMemberLearning(scope, 'orientation:update');
    assertMutationOrigin(request, context.config, scope.auth);
    const { lessonKey } = lessonParamsSchema.parse(request.params);
    const body = answerMemberLearningLessonRequestSchema.parse(request.body);
    const result = await context.repositories.memberLearning.answerLesson({
      householdId: scope.householdId,
      personId: scope.personId,
      lessonKey,
      lessonVersion: body.lessonVersion,
      optionKey: body.optionKey,
      idempotencyKey: memberLearningOperationKey(request, 'lesson-answer'),
      audience: scope.auth.audience,
      correlationId: correlationId(request),
      now: context.now(),
    });
    privateResponse(reply);
    return answerMemberLearningLessonResponseSchema.parse({
      correct: result.correct,
      feedback: result.feedback,
      learning: memberLearningDto(result.snapshot),
    });
  });

  app.put('/v1/member-learning/preferences', async (request, reply) => {
    const scope = await memberLearningScope(request, context);
    authorizeMemberLearning(scope, 'orientation:update');
    assertMutationOrigin(request, context.config, scope.auth);
    const body = updateMemberLearningPreferencesRequestSchema.parse(request.body);
    const snapshot = await context.repositories.memberLearning.updatePreferences({
      householdId: scope.householdId,
      personId: scope.personId,
      coarseRegion: body.coarseRegion,
      weeklyRehearsalEnabled: body.weeklyRehearsalEnabled,
      idempotencyKey: memberLearningOperationKey(request, 'preferences-update'),
      audience: scope.auth.audience,
      correlationId: correlationId(request),
      now: context.now(),
    });
    privateResponse(reply);
    return memberLearningDto(snapshot);
  });

  app.post('/v1/member-learning/rehearsal/answer', async (request, reply) => {
    const scope = await memberLearningScope(request, context);
    authorizeMemberLearning(scope, 'orientation:update');
    assertMutationOrigin(request, context.config, scope.auth);
    const body = answerWeeklyRehearsalRequestSchema.parse(request.body);
    const result = await context.repositories.memberLearning.answerWeeklyRehearsal({
      householdId: scope.householdId,
      personId: scope.personId,
      rehearsalKey: body.rehearsalKey,
      rehearsalVersion: body.rehearsalVersion,
      occurrenceVersion: body.occurrenceVersion,
      optionKey: body.optionKey,
      idempotencyKey: memberLearningOperationKey(request, 'weekly-rehearsal-complete'),
      audience: scope.auth.audience,
      correlationId: correlationId(request),
      now: context.now(),
    });
    privateResponse(reply);
    return answerWeeklyRehearsalResponseSchema.parse({
      saferChoice: result.saferChoice,
      feedback: result.feedback,
      learning: memberLearningDto(result.snapshot),
    });
  });

  app.post('/v1/member-learning/rehearsal/complete', async (request, reply) => {
    const scope = await memberLearningScope(request, context);
    authorizeMemberLearning(scope, 'orientation:update');
    assertMutationOrigin(request, context.config, scope.auth);
    completeWeeklyRehearsalRequestSchema.parse(request.body);
    memberLearningOperationKey(request, 'weekly-rehearsal-complete');
    privateResponse(reply);
    throw new DomainError(
      'invalid_transition',
      'Weekly rehearsals now require a response. Refresh or update BoomerBuddy and answer the current two-minute scenario.',
    );
  });

  app.put('/v1/member-learning/feed/:itemKey', async (request, reply) => {
    const scope = await memberLearningScope(request, context);
    authorizeMemberLearning(scope, 'orientation:update');
    assertMutationOrigin(request, context.config, scope.auth);
    const { itemKey } = feedParamsSchema.parse(request.params);
    const body = updateMemberLearningFeedItemRequestSchema.parse(request.body);
    const snapshot = await context.repositories.memberLearning.updateFeedItem({
      householdId: scope.householdId,
      personId: scope.personId,
      itemKey,
      itemVersion: body.itemVersion,
      state: body.state,
      idempotencyKey: memberLearningOperationKey(request, 'feed-item-update'),
      audience: scope.auth.audience,
      correlationId: correlationId(request),
      now: context.now(),
    });
    privateResponse(reply);
    return memberLearningDto(snapshot);
  });
}
