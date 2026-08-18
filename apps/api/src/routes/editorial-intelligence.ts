import type { AppConfig } from '@boomerbuddy/config';
import { DomainError } from '@boomerbuddy/domain';
import type { SessionRepository } from '@boomerbuddy/persistence';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { editorialBoardResponseSchema } from '../../../../packages/contracts/src/editorial-intelligence';
import type { EditorialBoard } from '../../../../packages/persistence/src/editorial-intelligence';
import { authenticate, correlationId } from '../auth';

interface EditorialRouteRepository {
  board(input: {
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<EditorialBoard>;
}

export interface EditorialRouteServices {
  readonly config: AppConfig;
  readonly sessions: SessionRepository;
  readonly editorial: EditorialRouteRepository;
  readonly now: () => Date;
}

function assertLocalOnly(config: AppConfig): void {
  if (config.environment === 'production') {
    throw new DomainError(
      'not_found',
      'Editorial intelligence is unavailable until the founder activation gates are complete',
    );
  }
}

function setPrivateNoStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'private, no-store, max-age=0');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
  reply.header('Vary', 'Cookie');
}

export function registerEditorialIntelligenceRoutes(
  app: FastifyInstance,
  services: EditorialRouteServices,
): void {
  app.get('/v1/hq/editorial', async (request, reply) => {
    setPrivateNoStore(reply);
    assertLocalOnly(services.config);
    const now = services.now();
    const auth = await authenticate(request, services.sessions, services.config, ['hq'], now);
    const board = await services.editorial.board({
      actorPersonId: auth.principal.personId,
      correlationId: correlationId(request),
      now,
    });
    return editorialBoardResponseSchema.parse({
      projection: 'owner_global_or_exact_assigned_editorial_metadata',
      contentIncluded: false,
      generatedAt: board.generatedAt.toISOString(),
      evidenceTier: 'local_simulation',
      capabilities: {
        externalFetch: false,
        externalModel: false,
        generation: false,
        providerProcessing: false,
        publication: false,
        outboundDelivery: false,
        transcription: false,
      },
      sources: board.sources.map((source) => ({
        ...source,
        reviewDueAt: source.reviewDueAt.toISOString(),
      })),
      stories: board.stories,
      content: board.content.map((content) => ({
        ...content,
        expiresAt: content.expiresAt.toISOString(),
      })),
      corrections: board.corrections.map((correction) => ({
        ...correction,
        recordedAt: correction.recordedAt.toISOString(),
      })),
      calendar: board.calendar.map((calendar) => ({
        ...calendar,
        plannedFor: calendar.plannedFor.toISOString(),
      })),
      preferences: board.preferences,
    });
  });
}
