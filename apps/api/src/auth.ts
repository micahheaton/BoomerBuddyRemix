import { assertAuthorized, type Principal } from '@boomerbuddy/authorization';
import type { AppConfig } from '@boomerbuddy/config';
import type { PrincipalDto } from '@boomerbuddy/contracts';
import { DomainError, ids, type Audience } from '@boomerbuddy/domain';
import { verifyDevSession } from '@boomerbuddy/security';
import type { ResolvedSession, SessionRepository } from '@boomerbuddy/persistence';
import '@fastify/cookie';
import type { FastifyRequest } from 'fastify';

export const customerCookieName = 'bb_customer_session';
export const hqCookieName = 'bb_hq_session';

interface Credential {
  readonly audience: Audience;
  readonly token: string;
  readonly transport: 'cookie' | 'bearer';
}

export interface AuthContext {
  readonly audience: Audience;
  readonly transport: Credential['transport'];
  readonly resolved: ResolvedSession;
  readonly principal: Principal;
}

function bearerToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (authorization === undefined) return undefined;
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(authorization);
  if (match?.[1] === undefined)
    throw new DomainError('not_authenticated', 'Authentication is required');
  return match[1];
}

function matchingOriginAudience(
  request: FastifyRequest,
  config: AppConfig,
): 'customer' | 'hq' | undefined {
  const origin = request.headers.origin;
  if (origin === undefined || Array.isArray(origin)) return undefined;
  if (config.identity.customerOrigins.includes(origin)) return 'customer';
  if (config.identity.hqOrigins.includes(origin)) return 'hq';
  return undefined;
}

function credential(
  request: FastifyRequest,
  config: AppConfig,
  allowedAudiences: readonly Audience[],
): Credential {
  const customer = request.cookies[customerCookieName];
  const hq = request.cookies[hqCookieName];
  const bearer = bearerToken(request);
  if (bearer !== undefined && (customer !== undefined || hq !== undefined)) {
    throw new DomainError('not_authenticated', 'Conflicting credentials are not accepted');
  }
  if (bearer !== undefined) return { audience: 'mobile', token: bearer, transport: 'bearer' };

  if (customer !== undefined && hq !== undefined) {
    const routeAudience =
      allowedAudiences.includes('hq') && !allowedAudiences.includes('customer')
        ? 'hq'
        : allowedAudiences.includes('customer') && !allowedAudiences.includes('hq')
          ? 'customer'
          : matchingOriginAudience(request, config);
    if (routeAudience === 'customer') {
      return { audience: 'customer', token: customer, transport: 'cookie' };
    }
    if (routeAudience === 'hq') return { audience: 'hq', token: hq, transport: 'cookie' };
    throw new DomainError(
      'not_authenticated',
      'A trusted application origin must select the session',
    );
  }
  if (customer === undefined && hq === undefined) {
    throw new DomainError('not_authenticated', 'Authentication is required');
  }
  const mixedBrowserRoute =
    allowedAudiences.includes('customer') && allowedAudiences.includes('hq');
  if (customer !== undefined) {
    if (
      mixedBrowserRoute &&
      request.headers.origin !== undefined &&
      matchingOriginAudience(request, config) !== 'customer'
    ) {
      throw new DomainError('not_authenticated', 'Authentication is required for this application');
    }
    return { audience: 'customer', token: customer, transport: 'cookie' };
  }
  if (hq !== undefined) {
    if (
      mixedBrowserRoute &&
      request.headers.origin !== undefined &&
      matchingOriginAudience(request, config) !== 'hq'
    ) {
      throw new DomainError('not_authenticated', 'Authentication is required for this application');
    }
    return { audience: 'hq', token: hq, transport: 'cookie' };
  }
  throw new DomainError('not_authenticated', 'Authentication is required');
}

export function toAuthorizationPrincipal(resolved: ResolvedSession): Principal {
  const principal = resolved.principal;
  return {
    personId: principal.personId,
    sessionId: principal.sessionId,
    audience: principal.audience,
    roles: principal.roles,
    households: principal.householdMemberships.map((membership) => ({
      householdId: membership.householdId,
      role: membership.role,
      isProtectedMember: membership.isProtectedMember,
      permissions: membership.permissions,
      capabilities: membership.capabilities,
      status: membership.status,
    })),
    organizations: principal.employeeScopes,
  };
}

export function principalDto(resolved: ResolvedSession): PrincipalDto {
  const principal = resolved.principal;
  return {
    sessionId: principal.sessionId,
    personId: principal.personId,
    displayName: resolved.displayName,
    audience: principal.audience,
    roles: [...principal.roles],
    households: principal.householdMemberships
      .filter((membership) => membership.status === 'active')
      .map((membership) => ({
        id: membership.householdId,
        role: membership.role,
        isProtectedMember: membership.isProtectedMember,
        permissions: [...membership.permissions],
        capabilities: [...membership.capabilities],
      })),
    expiresAt: principal.expiresAt.toISOString(),
  };
}

export async function authenticate(
  request: FastifyRequest,
  repository: SessionRepository,
  config: AppConfig,
  allowedAudiences: readonly Audience[],
  now: Date,
): Promise<AuthContext> {
  const selected = credential(request, config, allowedAudiences);
  if (!allowedAudiences.includes(selected.audience)) {
    throw new DomainError('not_authenticated', 'Authentication is required for this application');
  }
  if (selected.transport === 'cookie') {
    assertTrustedOrigin(request, config, selected.audience === 'hq' ? 'hq' : 'customer');
  }
  const verification = verifyDevSession(selected.token, config.secrets.session, {
    audience: selected.audience,
    now,
    production: config.environment === 'production',
  });
  if (!verification.valid)
    throw new DomainError('not_authenticated', 'Session is invalid or expired');
  const resolved = await repository.resolve(verification.claims.sessionId, selected.audience, now);
  if (
    resolved === null ||
    resolved.principal.personId !== verification.claims.subject ||
    resolved.principal.issuer !== verification.claims.issuer
  ) {
    throw new DomainError('not_authenticated', 'Session is invalid or expired');
  }
  return {
    audience: selected.audience,
    transport: selected.transport,
    resolved,
    principal: toAuthorizationPrincipal(resolved),
  };
}

export function selectedHousehold(auth: AuthContext, request: FastifyRequest) {
  const raw = request.headers['x-bb-household-id'];
  if (Array.isArray(raw)) throw new DomainError('invalid_input', 'Choose one household');
  const active = auth.principal.households.filter((membership) => membership.status === 'active');
  if (raw !== undefined) {
    let householdId;
    try {
      householdId = ids.household(raw);
    } catch {
      throw new DomainError('invalid_input', 'Household selection is invalid');
    }
    const selected = active.find((membership) => membership.householdId === householdId);
    if (selected === undefined)
      throw new DomainError('not_authorized', 'Household access is not permitted');
    return selected;
  }
  if (active.length === 0) {
    throw new DomainError('not_authorized', 'Household access is not permitted');
  }
  if (active.length > 1) {
    throw new DomainError('conflict', 'Choose a household using the x-bb-household-id header');
  }
  return active[0] as (typeof active)[number];
}

export function correlationId(request: FastifyRequest) {
  try {
    return ids.correlation(request.id);
  } catch {
    const digest = createHash('sha256').update(request.id).digest('hex').slice(0, 32);
    return ids.correlation(`correlation-${digest}`);
  }
}

function originFor(request: FastifyRequest): string {
  const origin = request.headers.origin;
  if (origin === undefined || Array.isArray(origin)) {
    throw new DomainError('not_authorized', 'A trusted application origin is required');
  }
  return origin;
}

export function assertTrustedOrigin(
  request: FastifyRequest,
  config: AppConfig,
  audience: 'customer' | 'hq',
): void {
  const allowed = audience === 'hq' ? config.identity.hqOrigins : config.identity.customerOrigins;
  if (!allowed.includes(originFor(request))) {
    throw new DomainError('not_authorized', 'The application origin is not trusted');
  }
}

export function assertMutationOrigin(
  request: FastifyRequest,
  config: AppConfig,
  auth: AuthContext,
): void {
  if (auth.transport === 'bearer') return;
  assertTrustedOrigin(request, config, auth.audience === 'hq' ? 'hq' : 'customer');
}

export function authorize(input: Parameters<typeof assertAuthorized>[0]): void {
  assertAuthorized(input);
}
import { createHash } from 'node:crypto';
