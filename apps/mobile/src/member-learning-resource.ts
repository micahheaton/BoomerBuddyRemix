import {
  answerMemberLearningLessonResponseSchema,
  answerWeeklyRehearsalResponseSchema,
  memberLearningResponseSchema,
  type MemberLearningFeedItemDto,
  type MemberLearningLessonDto,
  type MemberLearningPreferencesDto,
  type MemberLearningResponse,
  type MemberWeeklyRehearsalDto,
} from '@boomerbuddy/contracts';
import { MobileCustomerError, mobileRequest } from './api';

export type MemberLearningAnswerResponse = Readonly<{
  correct: boolean;
  feedback: string;
  learning: MemberLearningResponse;
}>;

function householdHeaders(householdId: string, idempotencyKey?: string): Record<string, string> {
  return {
    'X-BB-Household-Id': householdId,
    ...(idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey }),
  };
}

function parseLearningResponse(value: unknown): MemberLearningResponse {
  const parsed = memberLearningResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new MobileCustomerError(
      'BoomerBuddy received an unexpected learning response. Please try again.',
    );
  }
  return parsed.data;
}

export async function loadMemberLearning(
  householdId: string,
  signal?: AbortSignal,
): Promise<MemberLearningResponse> {
  const response = await mobileRequest<unknown>('/v1/member-learning', {
    headers: householdHeaders(householdId),
    ...(signal === undefined ? {} : { signal }),
  });
  return parseLearningResponse(response);
}

export async function startMemberLearningLesson(
  householdId: string,
  lesson: Pick<MemberLearningLessonDto, 'key' | 'version'>,
  idempotencyKey: string,
): Promise<MemberLearningResponse> {
  const response = await mobileRequest<unknown>(
    `/v1/member-learning/lessons/${encodeURIComponent(lesson.key)}/start`,
    {
      method: 'POST',
      headers: householdHeaders(householdId, idempotencyKey),
      body: JSON.stringify({ lessonVersion: lesson.version }),
    },
  );
  return parseLearningResponse(response);
}

export async function answerMemberLearningLesson(
  householdId: string,
  lesson: Pick<MemberLearningLessonDto, 'key' | 'version'>,
  optionKey: string,
  idempotencyKey: string,
): Promise<MemberLearningAnswerResponse> {
  const response = await mobileRequest<unknown>(
    `/v1/member-learning/lessons/${encodeURIComponent(lesson.key)}/answer`,
    {
      method: 'POST',
      headers: householdHeaders(householdId, idempotencyKey),
      body: JSON.stringify({ lessonVersion: lesson.version, optionKey }),
    },
  );
  const parsed = answerMemberLearningLessonResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new MobileCustomerError(
      'BoomerBuddy received an unexpected lesson response. Please try again.',
    );
  }
  return parsed.data;
}

export async function updateMemberLearningPreferences(
  householdId: string,
  preferences: Pick<MemberLearningPreferencesDto, 'coarseRegion' | 'weeklyRehearsalEnabled'>,
  idempotencyKey: string,
): Promise<MemberLearningResponse> {
  const response = await mobileRequest<unknown>('/v1/member-learning/preferences', {
    method: 'PUT',
    headers: householdHeaders(householdId, idempotencyKey),
    body: JSON.stringify(preferences),
  });
  return parseLearningResponse(response);
}

export async function answerMemberWeeklyRehearsal(
  householdId: string,
  rehearsal: Pick<MemberWeeklyRehearsalDto, 'key' | 'version' | 'occurrenceVersion'>,
  optionKey: string,
  idempotencyKey: string,
): Promise<Readonly<{ saferChoice: boolean; feedback: string; learning: MemberLearningResponse }>> {
  const response = await mobileRequest<unknown>('/v1/member-learning/rehearsal/answer', {
    method: 'POST',
    headers: householdHeaders(householdId, idempotencyKey),
    body: JSON.stringify({
      rehearsalKey: rehearsal.key,
      rehearsalVersion: rehearsal.version,
      occurrenceVersion: rehearsal.occurrenceVersion,
      optionKey,
    }),
  });
  const parsed = answerWeeklyRehearsalResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new MobileCustomerError(
      'BoomerBuddy received an unexpected weekly practice response. Please try again.',
    );
  }
  return parsed.data;
}

export async function updateMemberLearningFeedItem(
  householdId: string,
  item: Pick<MemberLearningFeedItemDto, 'key' | 'version'>,
  state: 'read' | 'dismissed',
  idempotencyKey: string,
): Promise<MemberLearningResponse> {
  const response = await mobileRequest<unknown>(
    `/v1/member-learning/feed/${encodeURIComponent(item.key)}`,
    {
      method: 'PUT',
      headers: householdHeaders(householdId, idempotencyKey),
      body: JSON.stringify({ itemVersion: item.version, state }),
    },
  );
  return parseLearningResponse(response);
}
