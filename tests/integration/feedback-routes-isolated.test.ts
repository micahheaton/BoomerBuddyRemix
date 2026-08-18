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
import { customerOrigin, hqOrigin, testConfig } from './support';

describe('isolated feedback route boundary', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function appFor(input: {
    readonly production?: boolean;
    readonly createAnonymous: ReturnType<typeof vi.fn>;
    readonly createAuthenticated?: ReturnType<typeof vi.fn>;
    readonly withdrawAuthenticatedConsent?: ReturnType<typeof vi.fn>;
    readonly convertSupportCase?: ReturnType<typeof vi.fn>;
    readonly sessions?: SessionRepository;
    readonly roleScopedMetadata?: ReturnType<typeof vi.fn>;
    readonly claimForReview?: ReturnType<typeof vi.fn>;
    readonly readAssignedMinimizedText?: ReturnType<typeof vi.fn>;
  }) {
    const app = Fastify({ trustProxy: false });
    apps.push(app);
    await app.register(cookie);
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ZodError) return reply.code(400).send({ code: 'invalid_request' });
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
    const runtimeConfig = input.production
      ? {
          ...config,
          environment: 'production' as const,
          identity: {
            ...config.identity,
            allowDevelopmentIssuer: false,
            founderPersonId: 'person-feedback-founder',
            clerk: {
              customer: {
                issuer: 'https://customer.identity.test',
                audience: 'boomerbuddy-customer',
                jwtKey: 'test-customer-jwt-key',
                authorizedParties: [customerOrigin],
              },
              hq: {
                issuer: 'https://hq.identity.test',
                audience: 'boomerbuddy-hq',
                jwtKey: 'test-hq-jwt-key',
                authorizedParties: [hqOrigin],
                maxSecondFactorAgeSeconds: 300,
              },
              founderSubject: 'founder-feedback-subject',
            },
          },
        }
      : config;
    const feedback = {
      createAnonymous: input.createAnonymous,
      createAuthenticated: input.createAuthenticated ?? vi.fn(),
      convertSupportCase: input.convertSupportCase ?? vi.fn(),
      withdrawAuthenticatedConsent: input.withdrawAuthenticatedConsent ?? vi.fn(),
      roleScopedMetadata: input.roleScopedMetadata ?? vi.fn(),
      claimForReview: input.claimForReview ?? vi.fn(),
      readAssignedMinimizedText: input.readAssignedMinimizedText ?? vi.fn(),
    } as unknown as FeedbackRouteServices['feedback'];
    registerFeedbackRoutes(app, {
      config: runtimeConfig,
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

  function productionAuthentication(input: {
    readonly audience: 'customer' | 'hq';
    readonly roles?: readonly ('hq_owner' | 'hq_reviewer' | 'hq_support')[];
    readonly personId?: string;
  }) {
    const now = new Date('2026-08-17T12:00:00.000Z');
    const isHq = input.audience === 'hq';
    const issuer = isHq ? 'https://hq.identity.test' : 'https://customer.identity.test';
    const subject = isHq ? 'founder-feedback-subject' : 'customer-feedback-subject';
    const personId =
      input.personId ?? (isHq ? 'person-feedback-founder' : 'person-feedback-customer');
    const identityId = isHq ? 'identity-feedback-founder' : 'identity-feedback-customer';
    const providerSessionId = isHq
      ? 'provider-session-feedback-founder'
      : 'provider-session-feedback-customer';
    const roles = input.roles ?? (isHq ? ['hq_owner'] : []);
    const resolved = {
      principal: {
        sessionId: isHq ? 'session-feedback-founder' : 'session-feedback-customer',
        personId,
        audience: input.audience,
        issuer,
        roles,
        householdMemberships: isHq
          ? []
          : [
              {
                householdId: 'household-feedback-customer',
                membershipId: 'membership-feedback-customer',
                membershipKind: 'member',
                status: 'active',
                isAdministrator: true,
                isProtectedMember: false,
                trustedCircleGrants: [],
                isPayer: false,
                isBillingManager: false,
                capabilities: [],
              },
            ],
        employeeScopes: isHq
          ? roles.map((role) => ({
              employeeAssignmentId: `employee-${role}`,
              organizationKind: 'internal',
              role,
              status: 'active',
            }))
          : [],
        supportCaseScopes: [],
        restrictedAccessScopes: [],
        expiresAt: new Date(now.getTime() + 3_600_000),
      },
      displayName: isHq ? 'Feedback Founder' : 'Feedback Customer',
      issuer,
      identityId,
      identitySubject: subject,
      providerSessionId,
      householdCapabilities: [],
    };
    const sessions = {
      verifyProductionToken: vi.fn().mockResolvedValue({
        issuer,
        subject,
        providerSessionId,
        audience: input.audience,
        issuedAt: new Date(now.getTime() - 60_000),
        expiresAt: new Date(now.getTime() + 3_600_000),
        authorizedParty: isHq ? hqOrigin : customerOrigin,
      }),
      resolveProductionIdentity: vi.fn().mockResolvedValue({
        identityId,
        issuer,
        subject,
        personId,
        displayName: resolved.displayName,
      }),
      resolveProviderSession: vi.fn().mockResolvedValue(resolved),
    } as unknown as SessionRepository;
    return {
      sessions,
      headers: {
        cookie: '__session=production-feedback-session-token',
        origin: isHq ? hqOrigin : customerOrigin,
      },
    };
  }

  function authenticatedPayload(operationKey: string) {
    return {
      operationKey,
      text: 'The primary action was difficult to find.',
      feedbackType: 'product_feedback',
      source: { surface: 'in_app_contextual', deviceClass: 'desktop' },
      link: { permitted: false },
      followUp: {
        granted: true,
        purpose: 'feedback_follow_up',
        consentVersion: 'feedback-follow-up-v1',
        channelClass: 'in_app',
      },
      researchRetention: { granted: false },
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

  it('accepts only authenticated customer text as live production evidence and permits withdrawal', async () => {
    const auth = productionAuthentication({ audience: 'customer' });
    const createAuthenticated = vi.fn().mockResolvedValue({
      id: 'feedback-route-production',
      status: 'queued_unassigned',
      redactionStatus: 'minimized_clean',
      queue: 'new_feedback',
      evidenceTier: 'live_production',
      retainedUntil: new Date('2026-08-17T13:00:00.000Z'),
      reused: false,
    });
    const withdrawAuthenticatedConsent = vi.fn().mockResolvedValue({
      withdrawn: true,
      activeStoreCiphertextErased: true,
    });
    const app = await appFor({
      production: true,
      createAnonymous: vi.fn(),
      createAuthenticated,
      withdrawAuthenticatedConsent,
      sessions: auth.sessions,
    });
    const intake = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: auth.headers,
      payload: authenticatedPayload('feedback:00000000-0000-4000-8000-000000000101'),
    });
    expect(intake.statusCode).toBe(201);
    expect(intake.json()).toMatchObject({
      feedback: {
        id: 'feedback-route-production',
        evidenceTier: 'live_production',
      },
      mediaAccepted: false,
      providerProcessed: false,
      externalActionExecuted: false,
    });
    expect(createAuthenticated).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: 'household-feedback-customer',
        actorPersonId: 'person-feedback-customer',
        evidenceTier: 'live_production',
      }),
    );

    const withdrawal = await app.inject({
      method: 'POST',
      url: '/v1/feedback/feedback-route-production/consents/follow_up/withdraw',
      headers: auth.headers,
    });
    expect(withdrawal.statusCode).toBe(200);
    expect(withdrawal.json()).toEqual({
      feedbackId: 'feedback-route-production',
      purpose: 'follow_up',
      withdrawn: true,
      activeStoreCiphertextErased: true,
      externalActionExecuted: false,
    });
    expect(withdrawAuthenticatedConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        feedbackId: 'feedback-route-production',
        householdId: 'household-feedback-customer',
        actorPersonId: 'person-feedback-customer',
        evidenceTier: 'live_production',
      }),
    );
  });

  it('rejects a guessed production household before authenticated feedback reaches persistence', async () => {
    const auth = productionAuthentication({ audience: 'customer' });
    const createAuthenticated = vi.fn();
    const app = await appFor({
      production: true,
      createAnonymous: vi.fn(),
      createAuthenticated,
      sessions: auth.sessions,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: { ...auth.headers, 'x-bb-household-id': 'household-feedback-guessed' },
      payload: authenticatedPayload('feedback:00000000-0000-4000-8000-000000000102'),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: 'not_authorized' });
    expect(createAuthenticated).not.toHaveBeenCalled();
  });

  it('keeps production support conversion disabled before authentication or repository use', async () => {
    const convertSupportCase = vi.fn();
    const app = await appFor({
      production: true,
      createAnonymous: vi.fn(),
      convertSupportCase,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/hq/households/household-feedback/support-cases/support-case-feedback/feedback',
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(convertSupportCase).not.toHaveBeenCalled();
  });

  it('limits production HQ feedback queue, claim, and content to the verified founder role', async () => {
    const founder = productionAuthentication({ audience: 'hq', roles: ['hq_owner'] });
    const roleScopedMetadata = vi.fn().mockResolvedValue([]);
    const claimForReview = vi.fn().mockResolvedValue({
      feedbackId: 'feedback-route-production',
      queue: 'new_feedback',
      routingState: 'assigned',
      assignmentVersion: 2,
      humanReviewRequired: true,
      reused: false,
      evidenceTier: 'live_production',
      externalActionExecuted: false,
    });
    const readAssignedMinimizedText = vi.fn().mockResolvedValue({
      feedbackId: 'feedback-route-production',
      minimizedText: 'Minimized production feedback.',
      redactionStatus: 'minimized_clean',
      evidenceTier: 'live_production',
      contentBoundary: 'assigned_minimized_text',
      externalActionExecuted: false,
    });
    const app = await appFor({
      production: true,
      createAnonymous: vi.fn(),
      sessions: founder.sessions,
      roleScopedMetadata,
      claimForReview,
      readAssignedMinimizedText,
    });
    const queue = await app.inject({
      method: 'GET',
      url: '/v1/hq/feedback',
      headers: founder.headers,
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.headers['cache-control']).toBe('private, no-store, max-age=0');
    expect(roleScopedMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        actorPersonId: 'person-feedback-founder',
        evidenceTier: 'live_production',
      }),
    );

    const claim = await app.inject({
      method: 'POST',
      url: '/v1/hq/feedback/feedback-route-production/claim',
      headers: founder.headers,
    });
    expect(claim.statusCode, claim.body).toBe(200);
    expect(claim.json()).toMatchObject({ evidenceTier: 'live_production' });
    expect(claimForReview).toHaveBeenCalledWith(
      expect.objectContaining({ evidenceTier: 'live_production' }),
    );

    const content = await app.inject({
      method: 'GET',
      url: '/v1/hq/feedback/feedback-route-production/content',
      headers: founder.headers,
    });
    expect(content.statusCode).toBe(200);
    expect(content.headers['cache-control']).toBe('private, no-store, max-age=0');
    expect(content.json()).toMatchObject({ evidenceTier: 'live_production' });
    expect(readAssignedMinimizedText).toHaveBeenCalledWith(
      expect.objectContaining({ evidenceTier: 'live_production' }),
    );

    const reviewer = productionAuthentication({ audience: 'hq', roles: ['hq_reviewer'] });
    const reviewerMetadata = vi.fn();
    const reviewerApp = await appFor({
      production: true,
      createAnonymous: vi.fn(),
      sessions: reviewer.sessions,
      roleScopedMetadata: reviewerMetadata,
    });
    const denied = await reviewerApp.inject({
      method: 'GET',
      url: '/v1/hq/feedback',
      headers: reviewer.headers,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ code: 'not_authorized' });
    expect(reviewerMetadata).not.toHaveBeenCalled();

    const otherOwner = productionAuthentication({
      audience: 'hq',
      roles: ['hq_owner'],
      personId: 'person-feedback-other-owner',
    });
    const otherOwnerMetadata = vi.fn();
    const otherOwnerApp = await appFor({
      production: true,
      createAnonymous: vi.fn(),
      sessions: otherOwner.sessions,
      roleScopedMetadata: otherOwnerMetadata,
    });
    const otherOwnerDenied = await otherOwnerApp.inject({
      method: 'GET',
      url: '/v1/hq/feedback',
      headers: otherOwner.headers,
    });
    expect(otherOwnerDenied.statusCode).toBe(403);
    expect(otherOwnerDenied.json()).toEqual({ code: 'not_authorized' });
    expect(otherOwnerMetadata).not.toHaveBeenCalled();
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

  it('publishes live runtime evidence in production without enabling disabled adapters', async () => {
    const app = await appFor({ production: true, createAnonymous: vi.fn() });
    const response = await app.inject({ method: 'GET', url: '/v1/feedback/adapters' });
    const body = response.json<{
      evidenceTier: string;
      adapters: Array<{ key: string; state: string; externalEffect: boolean }>;
    }>();
    expect(response.statusCode).toBe(200);
    expect(body.evidenceTier).toBe('live_production');
    expect(body.adapters.find((adapter) => adapter.key === 'authenticated_text')).toMatchObject({
      state: 'production_enabled',
      externalEffect: false,
    });
    for (const key of ['anonymous_text', 'support_conversion']) {
      expect(body.adapters.find((adapter) => adapter.key === key)).toMatchObject({
        state: 'local_only_enabled',
        externalEffect: false,
      });
    }
    expect(body.adapters.filter((adapter) => adapter.state === 'production_enabled')).toHaveLength(
      1,
    );
  });
});
