import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  ClerkSessionTokenVerifier,
  IdentityTokenVerificationError,
  type ClerkIdentityRealm,
} from './clerk-session';

const now = new Date('2026-08-17T12:00:00.000Z');
const nowSeconds = Math.floor(now.getTime() / 1_000);
const customerRealm: ClerkIdentityRealm = {
  issuer: 'https://customer.clerk.test',
  audience: 'boomerbuddy-customer',
  jwtKey: 'customer-public-key',
  authorizedParties: ['https://customer.test'],
};
const hqRealm: ClerkIdentityRealm = {
  issuer: 'https://hq.clerk.test',
  audience: 'boomerbuddy-hq',
  jwtKey: 'hq-public-key',
  authorizedParties: ['https://hq.test'],
  maxSecondFactorAgeSeconds: 600,
};

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: customerRealm.issuer,
    sub: 'user_customer_123',
    sid: 'sess_customer_123',
    aud: customerRealm.audience,
    azp: customerRealm.authorizedParties[0],
    iat: nowSeconds - 30,
    nbf: nowSeconds - 30,
    exp: nowSeconds + 60,
    sts: 'active',
    ...overrides,
  };
}

function input(
  realm: ClerkIdentityRealm = customerRealm,
  audience: 'customer' | 'hq' = 'customer',
) {
  return {
    token: 'synthetic.jwt.signature',
    audience,
    origin: realm.authorizedParties[0] as string,
    realm,
    now,
  } as const;
}

describe('ClerkSessionTokenVerifier', () => {
  it('uses Clerk to validate an actual RS256 signature and rejects tampering', async () => {
    const liveNow = new Date();
    const liveNowSeconds = Math.floor(liveNow.getTime() / 1_000);
    const keys = generateKeyPairSync('rsa', { modulusLength: 2_048 });
    const realm: ClerkIdentityRealm = {
      ...customerRealm,
      jwtKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    };
    const header = Buffer.from(
      JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'fixture' }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: realm.issuer,
        sub: 'user_signed_fixture',
        sid: 'sess_signed_fixture',
        azp: realm.authorizedParties[0],
        iat: liveNowSeconds - 5,
        nbf: liveNowSeconds - 5,
        exp: liveNowSeconds + 60,
        sts: 'active',
      }),
    ).toString('base64url');
    const signingInput = `${header}.${payload}`;
    const signature = sign('RSA-SHA256', Buffer.from(signingInput), keys.privateKey).toString(
      'base64url',
    );
    const token = `${signingInput}.${signature}`;
    await expect(
      new ClerkSessionTokenVerifier().verify({
        token,
        audience: 'customer',
        origin: realm.authorizedParties[0] as string,
        realm,
        now: liveNow,
      }),
    ).resolves.toMatchObject({
      issuer: realm.issuer,
      subject: 'user_signed_fixture',
      providerSessionId: 'sess_signed_fixture',
    });

    const tamperedPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
        sub: 'user_tampered_fixture',
      }),
    ).toString('base64url');
    await expect(
      new ClerkSessionTokenVerifier().verify({
        token: `${header}.${tamperedPayload}.${signature}`,
        audience: 'customer',
        origin: realm.authorizedParties[0] as string,
        realm,
        now: liveNow,
      }),
    ).rejects.toBeInstanceOf(IdentityTokenVerificationError);
  });

  it('binds customer verification to its exact key and authorized party without requiring aud', async () => {
    const dependency = vi.fn(async () => claims({ admin: true, roles: ['hq_owner'] }));
    const verified = await new ClerkSessionTokenVerifier(dependency).verify(input());
    expect(dependency).toHaveBeenCalledWith('synthetic.jwt.signature', {
      authorizedParties: ['https://customer.test'],
      clockSkewInMs: 5_000,
      jwtKey: customerRealm.jwtKey,
    });
    expect(verified).toEqual({
      issuer: customerRealm.issuer,
      subject: 'user_customer_123',
      providerSessionId: 'sess_customer_123',
      audience: 'customer',
      issuedAt: new Date((nowSeconds - 30) * 1_000),
      expiresAt: new Date((nowSeconds + 60) * 1_000),
      authorizedParty: 'https://customer.test',
    });
    expect(verified).not.toHaveProperty('roles');
    expect(verified).not.toHaveProperty('admin');
  });

  it('accepts an absent customer audience but rejects an absent HQ audience', async () => {
    await expect(
      new ClerkSessionTokenVerifier(async () => claims({ aud: undefined })).verify(input()),
    ).resolves.toMatchObject({ audience: 'customer' });

    const hqClaims = claims({
      iss: hqRealm.issuer,
      aud: undefined,
      azp: hqRealm.authorizedParties[0],
      fva: [0, 0],
    });
    const dependency = vi.fn(async () => hqClaims);
    await expect(
      new ClerkSessionTokenVerifier(dependency).verify(input(hqRealm, 'hq')),
    ).rejects.toBeInstanceOf(IdentityTokenVerificationError);
    expect(dependency).toHaveBeenCalledWith('synthetic.jwt.signature', {
      audience: hqRealm.audience,
      authorizedParties: ['https://hq.test'],
      clockSkewInMs: 5_000,
      jwtKey: hqRealm.jwtKey,
    });
  });

  it.each([
    ['wrong issuer', { iss: hqRealm.issuer }],
    ['wrong audience', { aud: hqRealm.audience }],
    ['wrong authorized party', { azp: 'https://evil.test' }],
    ['expired', { exp: nowSeconds }],
    ['future not-before', { nbf: nowSeconds + 6 }],
    ['missing subject', { sub: undefined }],
    ['missing session id', { sid: undefined }],
    ['pending session', { sts: 'pending' }],
    ['actor session', { act: { sub: 'user_actor' } }],
  ])('rejects %s claims after Clerk verification', async (_name, overrides) => {
    const verifier = new ClerkSessionTokenVerifier(async () => claims(overrides));
    await expect(verifier.verify(input())).rejects.toBeInstanceOf(IdentityTokenVerificationError);
  });

  it('rejects a signature error without exposing provider details', async () => {
    const verifier = new ClerkSessionTokenVerifier(async () => {
      throw new Error('bad signature for secret token value');
    });
    await expect(verifier.verify(input())).rejects.toEqual(new IdentityTokenVerificationError());
  });

  it('requires a recent nonnegative HQ second factor and bounded token age', async () => {
    const validClaims = claims({
      iss: hqRealm.issuer,
      aud: hqRealm.audience,
      azp: hqRealm.authorizedParties[0],
      fva: [1, 2],
    });
    await expect(
      new ClerkSessionTokenVerifier(async () => validClaims).verify(input(hqRealm, 'hq')),
    ).resolves.toMatchObject({ secondFactorAgeSeconds: 120 });

    for (const invalid of [
      { ...validClaims, fva: [1, -1] },
      { ...validClaims, fva: [1, 11] },
      { ...validClaims, fva: undefined },
      { ...validClaims, iat: nowSeconds - 601 },
    ]) {
      await expect(
        new ClerkSessionTokenVerifier(async () => invalid).verify(input(hqRealm, 'hq')),
      ).rejects.toBeInstanceOf(IdentityTokenVerificationError);
    }
  });

  it('prevents swapping customer and HQ realm claims', async () => {
    const verifier = new ClerkSessionTokenVerifier(async () =>
      claims({
        iss: customerRealm.issuer,
        aud: customerRealm.audience,
        azp: customerRealm.authorizedParties[0],
        fva: [0, 0],
      }),
    );
    await expect(verifier.verify(input(hqRealm, 'hq'))).rejects.toBeInstanceOf(
      IdentityTokenVerificationError,
    );
  });
});
