import { verifyToken } from '@clerk/backend';

export type ProductionIdentityAudience = 'customer' | 'mobile' | 'hq';

export const mobileClerkJwtTemplate = 'boomerbuddy-mobile' as const;
export const mobileClerkAudience = 'boomerbuddy-mobile' as const;
export const mobileClerkSurface = 'mobile' as const;
export const mobileClerkMaximumLifetimeSeconds = 60;

export interface ClerkIdentityRealm {
  readonly issuer: string;
  readonly audience: string;
  readonly jwtKey: string;
  readonly authorizedParties: readonly string[];
  readonly mobileAuthorizedParties?: readonly string[];
  readonly maxSecondFactorAgeSeconds?: number;
}

export type IdentityTokenVerificationInput =
  | {
      readonly token: string;
      readonly audience: 'customer' | 'hq';
      readonly origin: string;
      readonly realm: ClerkIdentityRealm;
      readonly now: Date;
    }
  | {
      readonly token: string;
      readonly audience: 'mobile';
      readonly realm: ClerkIdentityRealm;
      readonly now: Date;
    };

export interface VerifiedIdentityToken {
  readonly issuer: string;
  readonly subject: string;
  readonly providerSessionId: string;
  readonly audience: ProductionIdentityAudience;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly authorizedParty?: string;
  readonly firstFactorAgeSeconds?: number;
  readonly secondFactorAgeSeconds?: number;
  readonly reverificationId?: string;
}

export interface IdentityTokenVerifier {
  verify(input: IdentityTokenVerificationInput): Promise<VerifiedIdentityToken>;
}

interface ClerkVerificationOptions {
  readonly audience?: string;
  readonly authorizedParties?: string[];
  readonly clockSkewInMs: number;
  readonly jwtKey: string;
}

type ClerkVerifyToken = (token: string, options: ClerkVerificationOptions) => Promise<unknown>;

const boundedClaim = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,511}$/u;
const clockSkewSeconds = 5;

export class IdentityTokenVerificationError extends Error {
  constructor() {
    super('Identity token verification failed');
    this.name = 'IdentityTokenVerificationError';
  }
}

function fail(): never {
  throw new IdentityTokenVerificationError();
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}

function boundedString(value: unknown): string {
  if (typeof value !== 'string' || !boundedClaim.test(value)) fail();
  return value;
}

function boundedText(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 2_048 ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  ) {
    fail();
  }
  return value;
}

function numericDate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function matchesAudience(value: unknown, expected: string): boolean {
  return (
    value === expected ||
    (Array.isArray(value) &&
      value.length > 0 &&
      value.every((entry) => typeof entry === 'string') &&
      value.includes(expected))
  );
}

function hqSecondFactorAgeSeconds(claims: Record<string, unknown>, maximum: number): number {
  const factorAges = claims.fva;
  if (
    !Array.isArray(factorAges) ||
    factorAges.length !== 2 ||
    factorAges.some((age) => typeof age !== 'number' || !Number.isSafeInteger(age) || age < 0)
  ) {
    fail();
  }
  const secondFactorSeconds = (factorAges[1] as number) * 60;
  if (secondFactorSeconds > maximum) fail();
  return secondFactorSeconds;
}

interface CustomerFactorAges {
  readonly firstFactorAgeSeconds: number;
  readonly secondFactorAgeSeconds?: number;
}

function effectiveFactorAgeSeconds(minutes: number, elapsedSinceIssueSeconds: number) {
  const seconds = minutes * 60 + elapsedSinceIssueSeconds;
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

function customerFactorAges(
  claims: Record<string, unknown>,
  elapsedSinceIssueSeconds: number,
): CustomerFactorAges | undefined {
  const factorAges = claims.fva;
  if (
    !Array.isArray(factorAges) ||
    factorAges.length !== 2 ||
    factorAges.some((age) => typeof age !== 'number' || !Number.isSafeInteger(age) || age < -1)
  ) {
    return undefined;
  }
  const firstFactorMinutes = factorAges[0] as number;
  const secondFactorMinutes = factorAges[1] as number;
  if (firstFactorMinutes < 0) return undefined;
  const firstFactorAgeSeconds = effectiveFactorAgeSeconds(
    firstFactorMinutes,
    elapsedSinceIssueSeconds,
  );
  if (firstFactorAgeSeconds === undefined) return undefined;
  if (secondFactorMinutes < 0) return { firstFactorAgeSeconds };
  const secondFactorAgeSeconds = effectiveFactorAgeSeconds(
    secondFactorMinutes,
    elapsedSinceIssueSeconds,
  );
  return secondFactorAgeSeconds === undefined
    ? undefined
    : { firstFactorAgeSeconds, secondFactorAgeSeconds };
}

function optionalReverificationId(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 512 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u.test(value)
  ) {
    return undefined;
  }
  return value;
}

/**
 * Thin defensive adapter around Clerk's supported verifier. Clerk owns JWT parsing,
 * signature validation, key handling, audience validation, and authorized-party validation;
 * BoomerBuddy then enforces its exact realm and session semantics without consuming any
 * provider authorization metadata.
 */
export class ClerkSessionTokenVerifier implements IdentityTokenVerifier {
  constructor(
    private readonly verifyClerkToken: ClerkVerifyToken = (token, options) =>
      verifyToken(token, options),
  ) {}

  async verify(input: IdentityTokenVerificationInput): Promise<VerifiedIdentityToken> {
    const mobile = input.audience === 'mobile';
    if (input.token.length < 16 || input.token.length > 8_192) {
      fail();
    }
    if (!mobile && !input.realm.authorizedParties.includes(input.origin)) {
      fail();
    }
    let rawClaims: unknown;
    try {
      rawClaims = await this.verifyClerkToken(input.token, {
        ...(mobile
          ? { audience: mobileClerkAudience }
          : input.audience === 'hq'
            ? { audience: input.realm.audience }
            : {}),
        ...(mobile ? {} : { authorizedParties: [...input.realm.authorizedParties] }),
        clockSkewInMs: clockSkewSeconds * 1_000,
        jwtKey: input.realm.jwtKey,
      });
    } catch {
      fail();
    }
    const claims = record(rawClaims);
    const issuer = boundedText(claims.iss);
    const subject = boundedString(claims.sub);
    const providerSessionId = boundedString(mobile ? claims.jti : claims.sid);
    const authorizedParty = claims.azp === undefined ? undefined : boundedText(claims.azp);
    const issuedAtSeconds = numericDate(claims.iat);
    const notBeforeSeconds = numericDate(claims.nbf);
    const expiresAtSeconds = numericDate(claims.exp);
    const nowSeconds = Math.floor(input.now.getTime() / 1_000);
    const audienceMatches = mobile
      ? claims.aud === mobileClerkAudience
      : claims.aud === undefined
        ? input.audience === 'customer'
        : matchesAudience(claims.aud, input.realm.audience);
    const browserPartyMatches = mobile
      ? authorizedParty === undefined ||
        (input.realm.mobileAuthorizedParties ?? []).includes(authorizedParty)
      : authorizedParty === input.origin && input.realm.authorizedParties.includes(authorizedParty);
    const mobileClaimsMatch =
      !mobile ||
      (claims.bb_surface === mobileClerkSurface &&
        expiresAtSeconds - issuedAtSeconds <= mobileClerkMaximumLifetimeSeconds);
    if (
      Number.isNaN(input.now.getTime()) ||
      issuer !== input.realm.issuer ||
      !browserPartyMatches ||
      !mobileClaimsMatch ||
      !audienceMatches ||
      claims.act !== undefined ||
      claims.sts === 'pending' ||
      (claims.sts !== undefined && claims.sts !== 'active') ||
      issuedAtSeconds > nowSeconds + clockSkewSeconds ||
      notBeforeSeconds > nowSeconds + clockSkewSeconds ||
      expiresAtSeconds <= nowSeconds ||
      notBeforeSeconds > expiresAtSeconds ||
      issuedAtSeconds > expiresAtSeconds
    ) {
      fail();
    }

    const hqMaximum = input.realm.maxSecondFactorAgeSeconds;
    const elapsedSinceIssueSeconds = Math.max(0, nowSeconds - issuedAtSeconds);
    const customerFactors =
      input.audience === 'customer'
        ? customerFactorAges(claims, elapsedSinceIssueSeconds)
        : undefined;
    const firstFactorAgeSeconds = customerFactors?.firstFactorAgeSeconds;
    const secondFactorAgeSeconds =
      input.audience === 'hq'
        ? hqSecondFactorAgeSeconds(
            claims,
            hqMaximum === undefined || hqMaximum < 0 ? fail() : hqMaximum,
          )
        : customerFactors?.secondFactorAgeSeconds;
    const reverificationId =
      input.audience === 'customer'
        ? optionalReverificationId(claims.reverification_id)
        : undefined;
    if (input.audience === 'hq' && nowSeconds - issuedAtSeconds > (hqMaximum as number)) {
      fail();
    }

    return {
      issuer,
      subject,
      providerSessionId,
      audience: input.audience,
      issuedAt: new Date(issuedAtSeconds * 1_000),
      expiresAt: new Date(expiresAtSeconds * 1_000),
      ...(authorizedParty === undefined ? {} : { authorizedParty }),
      ...(firstFactorAgeSeconds === undefined ? {} : { firstFactorAgeSeconds }),
      ...(secondFactorAgeSeconds === undefined ? {} : { secondFactorAgeSeconds }),
      ...(reverificationId === undefined ? {} : { reverificationId }),
    };
  }
}
