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
export const clerkSessionCookieName = '__session';

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
  readonly assurance:
    | {
        readonly kind: 'development';
      }
    | {
        readonly kind: 'clerk';
        readonly firstFactorAgeSeconds?: number;
        readonly secondFactorAgeSeconds?: number;
        readonly reverificationId?: string;
      };
}

export const customerBillingSecondFactorMaximumAgeSeconds = 10 * 60;
export const customerSensitiveChangeMaximumAgeSeconds = 10 * 60;

export function assertRecentCustomerAuthentication(auth: AuthContext): void {
  if (auth.audience !== 'customer' && auth.audience !== 'mobile') {
    throw new DomainError('not_authorized', 'A customer identity confirmation is required');
  }
  if (auth.assurance.kind === 'development') return;
  const firstFactorAge = auth.assurance.firstFactorAgeSeconds;
  if (
    firstFactorAge === undefined ||
    !Number.isSafeInteger(firstFactorAge) ||
    firstFactorAge < 0 ||
    firstFactorAge >= customerSensitiveChangeMaximumAgeSeconds
  ) {
    throw new DomainError('not_authorized', 'Sign in again before changing household access', {
      action: 'sign_in_again',
      reason: 'recent_authentication_required',
    });
  }
}

export function assertRecentHqMfa(auth: AuthContext, config: AppConfig): void {
  if (auth.audience !== 'hq') {
    throw new DomainError('not_authorized', 'HQ controls require HQ authentication');
  }
  if (auth.assurance.kind === 'development') {
    if (config.environment === 'production') {
      throw new DomainError('not_authorized', 'Production HQ controls require recent MFA');
    }
    return;
  }
  const maximumAge = config.identity.clerk?.hq.maxSecondFactorAgeSeconds ?? 10 * 60;
  const firstFactorAge = auth.assurance.firstFactorAgeSeconds;
  const secondFactorAge = auth.assurance.secondFactorAgeSeconds;
  if (
    firstFactorAge === undefined ||
    secondFactorAge === undefined ||
    !Number.isSafeInteger(firstFactorAge) ||
    !Number.isSafeInteger(secondFactorAge) ||
    firstFactorAge < 0 ||
    secondFactorAge < 0 ||
    firstFactorAge >= maximumAge ||
    secondFactorAge >= maximumAge
  ) {
    throw new DomainError('not_authorized', 'HQ controls require recent MFA');
  }
}

export type CustomerBillingReverificationEvidence =
  | { readonly kind: 'development' }
  | {
      readonly kind: 'clerk';
      readonly reverificationId: string;
      readonly factorLevel: 'multi_factor';
      readonly effectiveFactorAgeSeconds: number;
    };

export function customerBillingReverificationEvidence(
  auth: AuthContext,
): CustomerBillingReverificationEvidence | undefined {
  if (auth.audience !== 'customer') return undefined;
  if (auth.assurance.kind === 'development') return { kind: 'development' };
  const reverificationId = auth.assurance.reverificationId;
  if (reverificationId === undefined || reverificationId.length === 0) return undefined;
  const firstFactorAge = auth.assurance.firstFactorAgeSeconds;
  const secondFactorAge = auth.assurance.secondFactorAgeSeconds;
  return firstFactorAge !== undefined &&
    secondFactorAge !== undefined &&
    Number.isSafeInteger(firstFactorAge) &&
    Number.isSafeInteger(secondFactorAge) &&
    firstFactorAge >= 0 &&
    secondFactorAge >= 0 &&
    firstFactorAge < customerBillingSecondFactorMaximumAgeSeconds &&
    secondFactorAge < customerBillingSecondFactorMaximumAgeSeconds
    ? {
        kind: 'clerk',
        reverificationId,
        factorLevel: 'multi_factor',
        effectiveFactorAgeSeconds: Math.max(firstFactorAge, secondFactorAge),
      }
    : undefined;
}

export function customerBillingReverificationHint() {
  return {
    clerk_error: {
      type: 'forbidden',
      reason: 'reverification-error',
      metadata: { reverification: 'strict_mfa' },
    },
  } as const;
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

function exactProductionClerkCookie(request: FastifyRequest): string | undefined {
  const raw = request.headers.cookie;
  if (raw === undefined || Array.isArray(raw)) return undefined;
  const pairs = raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  if (pairs.length !== 1) return undefined;
  const separator = pairs[0]?.indexOf('=') ?? -1;
  if (separator < 1 || pairs[0]?.slice(0, separator) !== clerkSessionCookieName) {
    return undefined;
  }
  const value = pairs[0].slice(separator + 1);
  return value.length === 0 ? undefined : value;
}

function credential(
  request: FastifyRequest,
  config: AppConfig,
  allowedAudiences: readonly Audience[],
): Credential {
  const customer = request.cookies[customerCookieName];
  const hq = request.cookies[hqCookieName];
  const clerk = request.cookies[clerkSessionCookieName];
  const bearer = bearerToken(request);
  if (config.environment === 'production') {
    if (bearer !== undefined) {
      if (
        request.headers.origin !== undefined ||
        request.headers.cookie !== undefined ||
        customer !== undefined ||
        hq !== undefined ||
        clerk !== undefined
      ) {
        throw new DomainError('not_authenticated', 'Authentication is required');
      }
      return { audience: 'mobile', token: bearer, transport: 'bearer' };
    }
    const exactClerk = exactProductionClerkCookie(request);
    if (customer !== undefined || hq !== undefined || clerk === undefined || exactClerk !== clerk) {
      throw new DomainError('not_authenticated', 'Authentication is required');
    }
    const audience = matchingOriginAudience(request, config);
    if (audience === undefined) {
      throw new DomainError(
        'not_authenticated',
        'A trusted application origin must select the session',
      );
    }
    return { audience, token: exactClerk, transport: 'cookie' };
  }
  if (clerk !== undefined) {
    throw new DomainError('not_authenticated', 'Authentication is required');
  }
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
      membershipKind: membership.membershipKind,
      isAdministrator: membership.isAdministrator,
      isProtectedMember: membership.isProtectedMember,
      trustedCircleGrants: membership.trustedCircleGrants,
      isPayer: membership.isPayer,
      isBillingManager: membership.isBillingManager,
      capabilities: membership.capabilities,
      status: membership.status,
    })),
    organizations: principal.employeeScopes,
    supportCases: principal.supportCaseScopes,
    restrictedAccess: principal.restrictedAccessScopes,
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
        membershipKind: membership.membershipKind,
        isAdministrator: membership.isAdministrator,
        isProtectedMember: membership.isProtectedMember,
        trustedCircleGrants: membership.trustedCircleGrants.map((grant) => ({
          relationshipId: grant.relationshipId,
          protectedPersonId: grant.protectedPersonId,
          permissions: [...grant.permissions],
        })),
        isPayer: membership.isPayer,
        isBillingManager: membership.isBillingManager,
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
  if (config.environment === 'production') {
    if (config.identity.clerk === undefined) {
      throw new DomainError('not_authenticated', 'Session is invalid or expired');
    }
    const realm =
      selected.audience === 'hq' ? config.identity.clerk.hq : config.identity.clerk.customer;
    let verification;
    try {
      verification = await repository.verifyProductionToken(
        selected.audience === 'mobile'
          ? {
              token: selected.token,
              audience: 'mobile',
              realm,
              now,
            }
          : {
              token: selected.token,
              audience: selected.audience,
              origin: originFor(request),
              realm,
              now,
            },
      );
    } catch {
      throw new DomainError('not_authenticated', 'Session is invalid or expired');
    }
    if (
      verification.audience !== selected.audience ||
      verification.issuer !== realm.issuer ||
      (selected.audience === 'mobile'
        ? verification.authorizedParty !== undefined &&
          !(config.identity.clerk.customer.mobileAuthorizedParties ?? []).includes(
            verification.authorizedParty,
          )
        : verification.authorizedParty !== originFor(request))
    ) {
      throw new DomainError('not_authenticated', 'Session is invalid or expired');
    }
    const identity = await repository.resolveProductionIdentity({
      audience: selected.audience === 'mobile' ? 'customer' : selected.audience,
      issuer: verification.issuer,
      subject: verification.subject,
      now,
    });
    if (identity === null) {
      throw new DomainError('not_authenticated', 'Session is invalid or expired');
    }
    const resolved = await repository.resolveProviderSession({
      identityId: identity.identityId,
      personId: identity.personId,
      issuer: verification.issuer,
      subject: verification.subject,
      providerSessionId: verification.providerSessionId,
      audience: selected.audience,
      issuedAt: verification.issuedAt,
      expiresAt: verification.expiresAt,
      now,
    });
    if (
      resolved === null ||
      resolved.identityId !== identity.identityId ||
      resolved.identitySubject !== verification.subject ||
      resolved.providerSessionId !== verification.providerSessionId ||
      resolved.principal.personId !== identity.personId ||
      resolved.principal.issuer !== verification.issuer
    ) {
      throw new DomainError('not_authenticated', 'Session is invalid or expired');
    }
    return {
      audience: selected.audience,
      transport: selected.transport,
      resolved,
      principal: toAuthorizationPrincipal(resolved),
      assurance: {
        kind: 'clerk',
        ...(verification.firstFactorAgeSeconds === undefined
          ? {}
          : { firstFactorAgeSeconds: verification.firstFactorAgeSeconds }),
        ...(verification.secondFactorAgeSeconds === undefined
          ? {}
          : { secondFactorAgeSeconds: verification.secondFactorAgeSeconds }),
        ...(verification.reverificationId === undefined
          ? {}
          : { reverificationId: verification.reverificationId }),
      },
    };
  }
  const verification = verifyDevSession(selected.token, config.secrets.session, {
    audience: selected.audience,
    now,
    production: false,
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
    assurance: { kind: 'development' },
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
