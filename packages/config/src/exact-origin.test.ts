import { describe, expect, it } from 'vitest';
import { canonicalPublicOrigin, isCanonicalPublicRequestOrigin } from './exact-origin';

describe('exact production origin', () => {
  it.each([
    ['https://app.boomerbuddy.net', 'https://app.boomerbuddy.net'],
    ['https://APP.boomerbuddy.net', 'https://app.boomerbuddy.net'],
    ['https://app.boomerbuddy.net/', 'https://app.boomerbuddy.net'],
    ['https://app.boomerbuddy.net:443', 'https://app.boomerbuddy.net'],
    ['https://api.example.invalid:8443', 'https://api.example.invalid:8443'],
    ['https://b\u00fccher.example', 'https://xn--bcher-kva.example'],
  ])('canonicalizes a safe production origin: %s', (origin, canonical) => {
    expect(canonicalPublicOrigin(origin, true)).toBe(canonical);
  });

  it.each([
    undefined,
    '',
    ' https://app.boomerbuddy.net',
    'https://app.boomerbuddy.net ',
    'https://app.\nboomerbuddy.net',
    'https://app.\tboomerbuddy.net',
    'https://app.\u007fboomerbuddy.net',
    'https://app.boomerbuddy.net\\',
    'http://app.boomerbuddy.net',
    'https://app.boomerbuddy.net/member',
    'https://app.boomerbuddy.net?return=member',
    'https://app.boomerbuddy.net#member',
    'https://user@app.boomerbuddy.net',
    'https://user:secret@app.boomerbuddy.net',
    'https://app.boomerbuddy.net.',
    'https://localhost',
    'https://preview.localhost',
    'https://127.0.0.1',
    'https://127.0.0.2',
    'https://127.255.255.254',
    'https://[::1]',
    'https://[::ffff:127.0.0.1]',
    'https://*.boomerbuddy.net',
    'https://app%2eboomerbuddy.net',
    'ftp://app.boomerbuddy.net',
    'not a URL',
  ])('rejects a missing, local, unsafe, or non-origin value: %s', (origin) => {
    expect(canonicalPublicOrigin(origin, true)).toBeUndefined();
  });

  it.each([
    ['http://localhost', 'http://localhost'],
    ['http://localhost:3000/', 'http://localhost:3000'],
    ['http://127.0.0.1:3001', 'http://127.0.0.1:3001'],
    ['http://127.0.0.2:3001', 'http://127.0.0.2:3001'],
    ['http://[::1]:4000', 'http://[::1]:4000'],
    ['http://[::ffff:127.0.0.1]:4000', 'http://[::ffff:7f00:1]:4000'],
    ['https://preview.example.invalid', 'https://preview.example.invalid'],
  ])('allows only loopback HTTP during development: %s', (origin, canonical) => {
    expect(canonicalPublicOrigin(origin, false)).toBe(canonical);
  });

  it('rejects remote development HTTP', () => {
    expect(canonicalPublicOrigin('http://preview.example.invalid', false)).toBeUndefined();
  });

  it('rejects an overlong value before URL parsing', () => {
    expect(canonicalPublicOrigin(`https://${'a'.repeat(2_048)}.example`, true)).toBeUndefined();
  });

  const canonicalRequest = {
    forwarded: null,
    forwardedHost: null,
    forwardedPort: null,
    forwardedProto: null,
    host: 'app.boomerbuddy.net',
    url: 'https://app.boomerbuddy.net/sign-in/client-trust',
  } as const;

  it('accepts only one canonical request authority with a supported proxy tuple', () => {
    expect(
      isCanonicalPublicRequestOrigin(canonicalRequest, 'https://APP.boomerbuddy.net:443/'),
    ).toBe(true);
    expect(
      isCanonicalPublicRequestOrigin(
        {
          ...canonicalRequest,
          forwardedHost: 'APP.boomerbuddy.net:443',
          forwardedPort: '443',
          forwardedProto: 'https',
          host: 'APP.boomerbuddy.net:443',
          url: 'https://APP.boomerbuddy.net:443/sign-in/sso-callback?state=fixture',
        },
        'https://app.boomerbuddy.net',
      ),
    ).toBe(true);
    expect(
      isCanonicalPublicRequestOrigin(
        {
          ...canonicalRequest,
          forwardedHost: 'app.boomerbuddy.net',
          forwardedProto: 'https',
        },
        'https://app.boomerbuddy.net',
      ),
    ).toBe(true);
    expect(
      isCanonicalPublicRequestOrigin(
        {
          ...canonicalRequest,
          forwardedHost: 'customer.example.invalid:8443',
          forwardedPort: '8443',
          forwardedProto: 'https',
          host: 'customer.example.invalid:8443',
          url: 'https://customer.example.invalid:8443/sign-in/client-trust',
        },
        'https://customer.example.invalid:8443',
      ),
    ).toBe(true);
  });

  it.each([
    ['attacker raw Host', { host: 'attacker.invalid' }],
    ['customer/HQ crossed Host', { host: 'hq.boomerbuddy.net' }],
    ['raw Forwarded header', { forwarded: 'host=app.boomerbuddy.net;proto=https' }],
    ['partial forwarded Host', { forwardedHost: 'app.boomerbuddy.net' }],
    ['partial forwarded protocol', { forwardedProto: 'https' }],
    ['partial forwarded port', { forwardedPort: '443' }],
    [
      'attacker forwarded Host',
      {
        forwardedHost: 'attacker.invalid',
        forwardedPort: '443',
        forwardedProto: 'https',
      },
    ],
    [
      'wrong forwarded protocol',
      {
        forwardedHost: 'app.boomerbuddy.net',
        forwardedPort: '443',
        forwardedProto: 'http',
      },
    ],
    [
      'noncanonical forwarded protocol casing',
      {
        forwardedHost: 'app.boomerbuddy.net',
        forwardedPort: '443',
        forwardedProto: 'HTTPS',
      },
    ],
    [
      'wrong forwarded port',
      {
        forwardedHost: 'app.boomerbuddy.net',
        forwardedPort: '80',
        forwardedProto: 'https',
      },
    ],
    [
      'noncanonical forwarded port',
      {
        forwardedHost: 'app.boomerbuddy.net',
        forwardedPort: '0443',
        forwardedProto: 'https',
      },
    ],
    [
      'duplicate forwarded Host',
      {
        forwardedHost: 'app.boomerbuddy.net, attacker.invalid',
        forwardedPort: '443',
        forwardedProto: 'https',
      },
    ],
    ['missing Host', { host: null }],
    ['malformed framework URL', { url: 'not a URL' }],
    ['non-HTTP framework URL', { url: 'data:text/plain,not-a-request' }],
    ['credentialed framework URL', { url: 'https://user@app.boomerbuddy.net/sign-in' }],
  ])('rejects %s before authentication', (_name, override) => {
    expect(
      isCanonicalPublicRequestOrigin(
        { ...canonicalRequest, ...override },
        'https://app.boomerbuddy.net',
      ),
    ).toBe(false);
  });
});
