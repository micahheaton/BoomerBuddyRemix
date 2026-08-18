import {
  browserSessionResponseSchema,
  devSessionRequestSchema,
  mobileSessionResponseSchema,
} from '@boomerbuddy/contracts';
import { DomainError, type Audience } from '@boomerbuddy/domain';
import { createDevSession } from '@boomerbuddy/security';
import '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  assertMutationOrigin,
  assertTrustedOrigin,
  authenticate,
  clerkSessionCookieName,
  customerCookieName,
  hqCookieName,
  principalDto,
} from '../auth';
import type { ApiContext } from '../context';

const sessionLifetimeSeconds = 8 * 60 * 60;

function ensurePersonaAudience(personaId: string, audience: Audience): void {
  const hqPersona = personaId.startsWith('hq-');
  if ((audience === 'hq') !== hqPersona) {
    throw new DomainError('not_found', 'Development persona is unavailable for this application');
  }
}

async function issueSession(
  request: FastifyRequest,
  reply: FastifyReply,
  context: ApiContext,
  audience: Audience,
) {
  if (
    !context.config.identity.allowDevelopmentIssuer ||
    context.config.environment === 'production'
  ) {
    throw new DomainError('not_found', 'Development identity is unavailable');
  }
  if (audience === 'hq') assertTrustedOrigin(request, context.config, 'hq');
  else if (audience === 'customer') assertTrustedOrigin(request, context.config, 'customer');
  else if (request.headers.origin !== undefined)
    assertTrustedOrigin(request, context.config, 'customer');
  const body = devSessionRequestSchema.parse(request.body);
  ensurePersonaAudience(body.personaId, audience);
  const persona = await context.repositories.sessions.findDevPersona(body.personaId);
  if (persona === null) throw new DomainError('not_found', 'Development persona is unavailable');
  const issuedAt = context.now();
  const expiresAt = new Date(issuedAt.getTime() + sessionLifetimeSeconds * 1_000);
  const sessionId = await context.repositories.sessions.create({
    personId: persona.personId,
    audience,
    issuedAt,
    expiresAt,
  });
  const token = createDevSession(
    {
      issuer: 'boomerbuddy-dev',
      subject: persona.personId,
      sessionId,
      audience,
      issuedAt: Math.floor(issuedAt.getTime() / 1_000),
      expiresAt: Math.floor(expiresAt.getTime() / 1_000),
    },
    context.config.secrets.session,
  );
  const resolved = await context.repositories.sessions.resolve(sessionId, audience, issuedAt);
  if (resolved === null) throw new Error('Issued session could not be resolved');
  const principal = principalDto(resolved);
  if (audience === 'mobile') {
    return reply.code(201).send(mobileSessionResponseSchema.parse({ principal, token }));
  }
  reply.setCookie(audience === 'hq' ? hqCookieName : customerCookieName, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: false,
    path: '/',
    maxAge: sessionLifetimeSeconds,
  });
  return reply.code(201).send(browserSessionResponseSchema.parse({ principal }));
}

export function registerSessionRoutes(app: FastifyInstance, context: ApiContext): void {
  app.post('/v1/dev/sessions/customer', (request, reply) =>
    issueSession(request, reply, context, 'customer'),
  );
  app.post('/v1/dev/sessions/hq', (request, reply) => issueSession(request, reply, context, 'hq'));
  app.post('/v1/dev/sessions/mobile', (request, reply) =>
    issueSession(request, reply, context, 'mobile'),
  );

  app.get('/v1/me', async (request) => {
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile', 'hq'],
      context.now(),
    );
    return { principal: principalDto(auth.resolved) };
  });

  app.delete('/v1/sessions/current', async (request, reply) => {
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile', 'hq'],
      now,
    );
    assertMutationOrigin(request, context.config, auth);
    await context.repositories.sessions.revoke(auth.resolved.principal.sessionId, now);
    if (context.config.environment === 'production') {
      reply.clearCookie(clerkSessionCookieName, {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
      });
    } else {
      if (auth.audience === 'customer') reply.clearCookie(customerCookieName, { path: '/' });
      if (auth.audience === 'hq') reply.clearCookie(hqCookieName, { path: '/' });
    }
    return reply.code(204).send();
  });
}
