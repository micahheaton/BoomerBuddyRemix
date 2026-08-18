import cookie from '@fastify/cookie';
import { DomainError } from '@boomerbuddy/domain';
import type { SessionRepository } from '@boomerbuddy/persistence';
import { createDevSession } from '@boomerbuddy/security';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  registerEditorialIntelligenceRoutes,
  type EditorialRouteServices,
} from '../../apps/api/src/routes/editorial-intelligence';
import { hqOrigin, testConfig } from './support';

const now = new Date('2026-08-17T12:00:00.000Z');

function ownerAuthentication(): {
  readonly sessions: SessionRepository;
  readonly headers: Readonly<Record<string, string>>;
} {
  const config = testConfig();
  const token = createDevSession(
    {
      issuer: 'boomerbuddy-dev',
      subject: 'person-hq-heidi',
      sessionId: 'session-editorial-route-owner',
      audience: 'hq',
      issuedAt: Math.floor(now.getTime() / 1_000) - 60,
      expiresAt: Math.floor(now.getTime() / 1_000) + 3_600,
    },
    config.secrets.session,
  );
  const sessions = {
    resolve: vi.fn().mockResolvedValue({
      principal: {
        sessionId: 'session-editorial-route-owner',
        personId: 'person-hq-heidi',
        audience: 'hq',
        issuer: 'boomerbuddy-dev',
        roles: ['hq_owner'],
        householdMemberships: [],
        employeeScopes: [
          {
            employeeAssignmentId: 'employee-hq-heidi',
            organizationKind: 'internal',
            role: 'hq_owner',
            status: 'active',
          },
        ],
        supportCaseScopes: [],
        restrictedAccessScopes: [],
        expiresAt: new Date(now.getTime() + 3_600_000),
      },
      displayName: 'Heidi HQ Owner',
      issuer: 'boomerbuddy-dev',
      householdCapabilities: [],
    }),
  } as unknown as SessionRepository;
  return {
    sessions,
    headers: { cookie: `bb_hq_session=${token}`, origin: hqOrigin },
  };
}

function boardFixture() {
  return {
    generatedAt: now,
    sources: [
      {
        sourceVersionId: 'editorial_source_fixture',
        sourceKey: 'source_official_fixture',
        version: 1,
        sourceClass: 'government' as const,
        state: 'approved_local' as const,
        reviewDueAt: new Date('2026-08-24T12:00:00.000Z'),
        evidenceTier: 'local_simulation' as const,
        externalFetchPerformed: false as const,
      },
    ],
    stories: [],
    content: [
      {
        contentVersionId: 'editorial_content_fixture',
        contentKey: 'content_review_fixture',
        version: 1,
        product: 'urgent_alert' as const,
        state: 'under_review' as const,
        assignedRole: 'skeptical' as const,
        contentReadable: true,
        expiresAt: new Date('2026-08-22T12:00:00.000Z'),
        unsupportedStatistics: false,
        unverifiedUrgency: false,
        evidenceTier: 'local_simulation' as const,
      },
    ],
    corrections: [
      {
        correctionId: 'editorial_correction_fixture',
        originalContentVersionId: 'editorial_content_original',
        replacementContentVersionId: 'editorial_content_fixture',
        disposition: 'correction' as const,
        reasonCode: 'newer.immutable.version',
        recordedAt: now,
        evidenceTier: 'local_simulation' as const,
      },
    ],
    calendar: [
      {
        calendarEventId: 'editorial_calendar_fixture',
        contentVersionId: 'editorial_content_fixture',
        state: 'internal_review_planned' as const,
        plannedFor: new Date('2026-08-18T12:00:00.000Z'),
        evidenceTier: 'local_simulation' as const,
        externalActionEnabled: false as const,
      },
    ],
    preferences: {
      grantedLocalFixtures: 0,
      withdrawnLocalFixtures: 1,
      externalDeliveryEnabled: false as const,
    },
  };
}

describe('isolated editorial intelligence route', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function appFor(input: {
    readonly production?: boolean;
    readonly sessions?: SessionRepository;
    readonly board: ReturnType<typeof vi.fn>;
  }) {
    const app = Fastify();
    apps.push(app);
    await app.register(cookie);
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ZodError) return reply.code(400).send({ code: 'invalid_response' });
      if (error instanceof DomainError) {
        const status =
          error.code === 'not_found'
            ? 404
            : error.code === 'not_authenticated'
              ? 401
              : error.code === 'not_authorized'
                ? 403
                : 400;
        return reply.code(status).send({ code: error.code });
      }
      return reply.code(500).send({ code: 'internal_error' });
    });
    const config = testConfig();
    registerEditorialIntelligenceRoutes(app, {
      config: input.production ? { ...config, environment: 'production' } : config,
      sessions: input.sessions ?? ({} as SessionRepository),
      editorial: { board: input.board } as EditorialRouteServices['editorial'],
      now: () => now,
    });
    await app.ready();
    return app;
  }

  it('returns a private content-free local projection to an authenticated HQ identity', async () => {
    const auth = ownerAuthentication();
    const board = vi.fn().mockResolvedValue(boardFixture());
    const app = await appFor({ sessions: auth.sessions, board });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/hq/editorial',
      headers: auth.headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store, max-age=0');
    expect(response.headers.vary).toContain('Cookie');
    expect(response.json()).toMatchObject({
      projection: 'owner_global_or_exact_assigned_editorial_metadata',
      contentIncluded: false,
      evidenceTier: 'local_simulation',
      capabilities: {
        externalFetch: false,
        generation: false,
        providerProcessing: false,
        publication: false,
        outboundDelivery: false,
      },
      preferences: { withdrawnLocalFixtures: 1, externalDeliveryEnabled: false },
    });
    expect(response.body).not.toMatch(/draftText|encrypted|sha256|destination|https?:\/\//u);
    expect(board).toHaveBeenCalledWith(
      expect.objectContaining({ actorPersonId: 'person-hq-heidi', now }),
    );
  });

  it('refuses production before repository access', async () => {
    const board = vi.fn();
    const app = await appFor({ production: true, board });
    const response = await app.inject({ method: 'GET', url: '/v1/hq/editorial' });
    expect(response.statusCode).toBe(404);
    expect(board).not.toHaveBeenCalled();
  });

  it('rejects repository metadata that attempts to smuggle a raw source locator', async () => {
    const auth = ownerAuthentication();
    const fixture = boardFixture();
    const board = vi.fn().mockResolvedValue({
      ...fixture,
      sources: [{ ...fixture.sources[0], sourceUrl: 'https://example.invalid/source' }],
    });
    const app = await appFor({ sessions: auth.sessions, board });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/hq/editorial',
      headers: auth.headers,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: 'invalid_response' });
    expect(response.body).not.toContain('example.invalid');
  });
});
