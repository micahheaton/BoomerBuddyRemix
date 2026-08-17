import cookie from '@fastify/cookie';
import { DomainError } from '@boomerbuddy/domain';
import type { SessionRepository } from '@boomerbuddy/persistence';
import { createDevSession } from '@boomerbuddy/security';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerFeedbackRoutes,
  type FeedbackRouteServices,
} from '../../apps/api/src/routes/feedback';
import { hqOrigin, testConfig } from './support';

describe('isolated feedback route boundary', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function appFor(input: {
    readonly production?: boolean;
    readonly createAnonymous: ReturnType<typeof vi.fn>;
    readonly sessions?: SessionRepository;
    readonly roleScopedMetadata?: ReturnType<typeof vi.fn>;
    readonly readAssignedMinimizedText?: ReturnType<typeof vi.fn>;
  }) {
    const app = Fastify({ trustProxy: false });
    apps.push(app);
    await app.register(cookie);
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ZodError) return reply.code(400).send({ code: 'invalid_request' });
      if (error instanceof DomainError) {
        return reply.code(error.code === 'not_found' ? 404 : 400).send({ code: error.code });
      }
      return reply.code(500).send({ code: 'internal_error' });
    });
    const config = testConfig();
    const feedback = {
      createAnonymous: input.createAnonymous,
      createAuthenticated: vi.fn(),
      convertSupportCase: vi.fn(),
      withdrawAuthenticatedConsent: vi.fn(),
      roleScopedMetadata: input.roleScopedMetadata ?? vi.fn(),
      claimForReview: vi.fn(),
      readAssignedMinimizedText: input.readAssignedMinimizedText ?? vi.fn(),
    } as unknown as FeedbackRouteServices['feedback'];
    registerFeedbackRoutes(app, {
      config: input.production ? { ...config, environment: 'production' } : config,
      sessions: input.sessions ?? ({} as SessionRepository),
      feedback,
      now: () => new Date('2026-08-17T12:00:00.000Z'),
    });
    await app.ready();
    return app;
  }

  function hqAuthentication() {
    const now = new Date('2026-08-17T12:00:00.000Z');
    const config = testConfig();
    const token = createDevSession(
      {
        issuer: 'boomerbuddy-dev',
        subject: 'person-hq-heidi',
        sessionId: 'session-feedback-route-hq',
        audience: 'hq',
        issuedAt: Math.floor(now.getTime() / 1_000) - 60,
        expiresAt: Math.floor(now.getTime() / 1_000) + 3_600,
      },
      config.secrets.session,
    );
    const sessions = {
      resolve: vi.fn().mockResolvedValue({
        principal: {
          sessionId: 'session-feedback-route-hq',
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

  it('returns only local/no-effect intake truth and passes the current network separately', async () => {
    const createAnonymous = vi.fn().mockResolvedValue({
      id: 'feedback-route-local',
      status: 'queued_unassigned',
      redactionStatus: 'minimized_clean',
      queue: 'new_feedback',
      evidenceTier: 'local_simulation',
      retainedUntil: new Date('2026-08-17T13:00:00.000Z'),
      reused: false,
    });
    const app = await appFor({ createAnonymous });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/public/feedback',
      remoteAddress: '192.0.2.123',
      headers: { 'x-forwarded-for': '198.51.100.250' },
      payload: {
        operationKey: 'feedback:00000000-0000-4000-8000-000000000001',
        text: 'The primary action was difficult to find.',
        feedbackType: 'product_feedback',
        source: { surface: 'web_feedback_form', deviceClass: 'desktop' },
        link: { permitted: false },
        followUp: { granted: false },
        researchRetention: { granted: false },
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      feedback: {
        id: 'feedback-route-local',
        status: 'queued_unassigned',
        redactionStatus: 'minimized_clean',
        queue: 'new_feedback',
        evidenceTier: 'local_simulation',
        retainedUntil: '2026-08-17T13:00:00.000Z',
        reused: false,
      },
      mediaAccepted: false,
      providerProcessed: false,
      externalActionExecuted: false,
    });
    expect(createAnonymous).toHaveBeenCalledWith(
      expect.objectContaining({ networkAddress: '192.0.2.123' }),
    );
    expect(JSON.stringify(createAnonymous.mock.calls)).not.toContain('campaign');
  });

  it('canonicalizes equivalent IPv6 only after Fastify resolves the trusted peer boundary', async () => {
    const createAnonymous = vi.fn().mockResolvedValue({
      id: 'feedback-route-ipv6',
      status: 'queued_unassigned',
      redactionStatus: 'minimized_clean',
      queue: 'new_feedback',
      evidenceTier: 'local_simulation',
      reused: false,
    });
    const app = await appFor({ createAnonymous });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/public/feedback',
      remoteAddress: '2001:0DB8:0:0:0:0:0:1',
      payload: {
        operationKey: 'feedback:00000000-0000-4000-8000-000000000004',
        text: 'The primary action was difficult to find.',
        feedbackType: 'product_feedback',
        source: { surface: 'web_feedback_form', deviceClass: 'desktop' },
        link: { permitted: false },
        followUp: { granted: false },
        researchRetention: { granted: false },
      },
    });
    expect(response.statusCode).toBe(201);
    expect(createAnonymous).toHaveBeenCalledWith(
      expect.objectContaining({ networkAddress: '2001:db8::1' }),
    );
  });

  it('collapses a framework-resolved IPv4-mapped address to dotted IPv4', async () => {
    const createAnonymous = vi.fn().mockResolvedValue({
      id: 'feedback-route-mapped-ipv4',
      status: 'queued_unassigned',
      redactionStatus: 'minimized_clean',
      queue: 'new_feedback',
      evidenceTier: 'local_simulation',
      reused: false,
    });
    const app = await appFor({ createAnonymous });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/public/feedback',
      remoteAddress: '::ffff:192.0.2.123',
      payload: {
        operationKey: 'feedback:00000000-0000-4000-8000-000000000005',
        text: 'The primary action was difficult to find.',
        feedbackType: 'product_feedback',
        source: { surface: 'web_feedback_form', deviceClass: 'desktop' },
        link: { permitted: false },
        followUp: { granted: false },
        researchRetention: { granted: false },
      },
    });
    expect(response.statusCode).toBe(201);
    expect(createAnonymous).toHaveBeenCalledWith(
      expect.objectContaining({ networkAddress: '192.0.2.123' }),
    );
  });

  it('marks HQ metadata and minimized content as private no-store responses', async () => {
    const auth = hqAuthentication();
    const roleScopedMetadata = vi.fn().mockResolvedValue([]);
    const readAssignedMinimizedText = vi.fn().mockResolvedValue({
      feedbackId: 'feedback-route-local',
      minimizedText: 'Minimized local feedback.',
      redactionStatus: 'minimized_clean',
      evidenceTier: 'local_simulation',
      contentBoundary: 'assigned_minimized_text',
      externalActionExecuted: false,
    });
    const app = await appFor({
      createAnonymous: vi.fn(),
      sessions: auth.sessions,
      roleScopedMetadata,
      readAssignedMinimizedText,
    });
    for (const url of ['/v1/hq/feedback', '/v1/hq/feedback/feedback-route-local/content']) {
      const response = await app.inject({ method: 'GET', url, headers: auth.headers });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers['cache-control'], url).toBe('private, no-store, max-age=0');
      expect(response.headers.pragma, url).toBe('no-cache');
      expect(response.headers.expires, url).toBe('0');
    }
  });

  it('rejects covert anonymous association/media fields before repository use', async () => {
    const createAnonymous = vi.fn();
    const app = await appFor({ createAnonymous });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/public/feedback',
      payload: {
        operationKey: 'feedback:00000000-0000-4000-8000-000000000002',
        text: 'The primary action was difficult to find.',
        feedbackType: 'product_feedback',
        source: { surface: 'web_feedback_form', deviceClass: 'desktop' },
        link: { permitted: false },
        followUp: { granted: false },
        researchRetention: { granted: false },
        attachmentIds: ['media-must-stay-disabled'],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(createAnonymous).not.toHaveBeenCalled();
  });

  it('fails closed in production even when a repository adapter is present', async () => {
    const createAnonymous = vi.fn();
    const app = await appFor({ production: true, createAnonymous });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/public/feedback',
      payload: {
        operationKey: 'feedback:00000000-0000-4000-8000-000000000003',
        text: 'The primary action was difficult to find.',
        feedbackType: 'product_feedback',
        source: { surface: 'web_feedback_form', deviceClass: 'desktop' },
        link: { permitted: false },
        followUp: { granted: false },
        researchRetention: { granted: false },
      },
    });
    expect(response.statusCode).toBe(404);
    expect(createAnonymous).not.toHaveBeenCalled();
  });

  it('publishes the code-owned adapter disablement without provider claims', async () => {
    const app = await appFor({ createAnonymous: vi.fn() });
    const response = await app.inject({ method: 'GET', url: '/v1/feedback/adapters' });
    const body = response.json<{
      evidenceTier: string;
      adapters: Array<{ key: string; state: string; externalEffect: boolean }>;
    }>();
    expect(response.statusCode).toBe(200);
    expect(body.evidenceTier).toBe('local_simulation');
    for (const key of [
      'attachment',
      'audio',
      'image',
      'video',
      'screen_recording',
      'inbound_email',
      'transcription',
      'external_model',
    ]) {
      expect(body.adapters.find((adapter) => adapter.key === key)).toMatchObject({
        state: 'structurally_disabled',
        externalEffect: false,
      });
    }
  });
});
