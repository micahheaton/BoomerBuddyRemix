import { describe, expect, it, vi } from 'vitest';
import {
  ClerkSessionTokenVerifier,
  mobileClerkAudience,
  mobileClerkMaximumLifetimeSeconds,
  mobileClerkSurface,
  type ClerkIdentityRealm,
  type IdentityTokenVerificationInput,
} from './clerk-session';

const nowSeconds = 1_800_000_000;
const realm: ClerkIdentityRealm = {
  issuer: 'https://customer.clerk.accounts.dev',
  audience: 'boomerbuddy-customer',
  authorizedParties: ['https://app.boomerbuddy.net'],
  jwtKey: 'test-public-key',
};

function input(): IdentityTokenVerificationInput {
  return {
    token: 'valid.mobile.clerk.jwt',
    audience: 'mobile',
    realm,
    now: new Date(nowSeconds * 1_000),
  };
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: realm.issuer,
    sub: 'user_customer_one',
    jti: 'jwt_mobile_one',
    aud: mobileClerkAudience,
    bb_surface: mobileClerkSurface,
    iat: nowSeconds - 30,
    nbf: nowSeconds - 35,
    exp: nowSeconds + 30,
    ...overrides,
  };
}

describe('Clerk mobile customer token boundary', () => {
  it('verifies the dedicated short-lived template without browser authorized parties', async () => {
    const verifyClerkToken = vi.fn(async (token: string, options: unknown) => {
      void token;
      void options;
      return claims();
    });
    const verified = await new ClerkSessionTokenVerifier(verifyClerkToken).verify(input());

    expect(verifyClerkToken).toHaveBeenCalledWith(
      input().token,
      expect.objectContaining({
        audience: mobileClerkAudience,
        jwtKey: realm.jwtKey,
      }),
    );
    expect(verifyClerkToken.mock.calls[0]?.[1]).not.toHaveProperty('authorizedParties');
    expect(verified).toMatchObject({
      issuer: realm.issuer,
      subject: 'user_customer_one',
      providerSessionId: 'jwt_mobile_one',
      audience: 'mobile',
    });
    expect(verified).not.toHaveProperty('authorizedParty');
  });

  it.each([
    ['browser authorized party', { azp: 'https://app.boomerbuddy.net' }],
    ['wrong audience', { aud: 'boomerbuddy-customer' }],
    ['array audience', { aud: [mobileClerkAudience] }],
    ['missing surface', { bb_surface: undefined }],
    ['wrong surface', { bb_surface: 'web' }],
    ['missing token id', { jti: undefined }],
    [
      'lifetime above the template maximum',
      { iat: nowSeconds - 30, exp: nowSeconds + mobileClerkMaximumLifetimeSeconds },
    ],
    ['impersonation', { act: { sub: 'user_actor' } }],
  ])('rejects %s', async (_name, overrides) => {
    await expect(
      new ClerkSessionTokenVerifier(async () => claims(overrides)).verify(input()),
    ).rejects.toThrow('Identity token verification failed');
  });

  it('accepts a token whose exact issued-to-expiry lifetime is the maximum', async () => {
    await expect(
      new ClerkSessionTokenVerifier(async () =>
        claims({ iat: nowSeconds - 30, exp: nowSeconds + 30 }),
      ).verify(input()),
    ).resolves.toMatchObject({ audience: 'mobile' });
  });
});
