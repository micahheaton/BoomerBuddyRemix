/**
 * Parse one public browser origin and return the canonical WHATWG origin string.
 *
 * Production browser security controls must agree on the exact same string. Returning
 * `undefined` for unsafe values makes paths, query/fragment delimiters, credentials,
 * wildcards, remote development HTTP, and production loopback fail closed. Benign URL
 * equivalents such as a root slash, default port, host casing, and IDN spelling are
 * normalized once before Clerk and the browser/API proxy consume them.
 * This module intentionally has no Node-only imports so Next middleware can run it at
 * the edge.
 */
function hasRejectedRawOriginCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint <= 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      character === '\\'
    ) {
      return true;
    }
  }
  return false;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname) ||
    hostname === '[::1]' ||
    /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/u.test(hostname)
  );
}

export function canonicalPublicOrigin(
  value: string | undefined,
  production: boolean,
): string | undefined {
  if (
    value === undefined ||
    value.length === 0 ||
    value.length > 2_048 ||
    hasRejectedRawOriginCharacter(value) ||
    !/^https?:\/\/[^/?#]+\/?$/iu.test(value) ||
    value.includes('%')
  ) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  const hostname = url.hostname.toLowerCase();
  const loopback = isLoopbackHostname(hostname);
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    (production && url.protocol !== 'https:') ||
    (!production && url.protocol === 'http:' && !loopback) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    hostname === '' ||
    hostname.includes('*') ||
    hostname.endsWith('.') ||
    (production && loopback)
  ) {
    return undefined;
  }

  return url.origin;
}

export interface CanonicalPublicRequestOriginInput {
  readonly deployment: string | undefined;
  readonly forwarded: string | null;
  readonly forwardedHost: string | null;
  readonly forwardedPort: string | null;
  readonly forwardedProto: string | null;
  readonly host: string | null;
  readonly port: string | undefined;
  readonly url: string;
}

function canonicalHttpsAuthority(authority: string | null): string | undefined {
  return authority === null ? undefined : canonicalPublicOrigin(`https://${authority}`, true);
}

/**
 * Require raw Host and proxy-derived authority metadata to select the same configured HTTPS
 * origin. Next can retain its internal listener authority in the framework URL, so that URL is
 * checked only for valid credential-free structure. A raw RFC 7239 Forwarded header is rejected.
 * X-Forwarded-Host and X-Forwarded-Proto must appear together. X-Forwarded-Port may be absent or
 * exact. A published Replit app may instead report its server-owned internal PORT; accept only that
 * canonical value when REPLIT_DEPLOYMENT=1 and the configured browser origin uses default HTTPS.
 */
export function isCanonicalPublicRequestOrigin(
  input: CanonicalPublicRequestOriginInput,
  configuredOrigin: string | undefined,
): boolean {
  const expectedOrigin = canonicalPublicOrigin(configuredOrigin, true);
  if (expectedOrigin === undefined || input.forwarded !== null) return false;

  let requestUrl: URL;
  try {
    requestUrl = new URL(input.url);
  } catch {
    return false;
  }
  if (
    (requestUrl.protocol !== 'https:' && requestUrl.protocol !== 'http:') ||
    requestUrl.hostname === '' ||
    requestUrl.username !== '' ||
    requestUrl.password !== '' ||
    canonicalHttpsAuthority(input.host) !== expectedOrigin
  ) {
    return false;
  }

  const forwardedAuthority = [input.forwardedHost, input.forwardedPort, input.forwardedProto];
  if (forwardedAuthority.every((value) => value === null)) return true;
  if (input.forwardedHost === null || input.forwardedProto === null) return false;

  const expectedPort = new URL(expectedOrigin).port || '443';
  const replitInternalPort =
    input.deployment === '1' && expectedPort === '443' && isCanonicalPort(input.port)
      ? input.port
      : undefined;
  return (
    input.forwardedProto === 'https' &&
    (input.forwardedPort === null ||
      input.forwardedPort === expectedPort ||
      (replitInternalPort !== undefined && input.forwardedPort === replitInternalPort)) &&
    canonicalHttpsAuthority(input.forwardedHost) === expectedOrigin
  );
}

export interface ReplitLoopbackHealthCheckInput {
  readonly deployment: string | undefined;
  readonly forwarded: string | null;
  readonly forwardedFor: string | null;
  readonly forwardedHost: string | null;
  readonly forwardedPort: string | null;
  readonly forwardedProto: string | null;
  readonly host: string | null;
  readonly method: string;
  readonly port: string | undefined;
  readonly url: string;
}

function isCanonicalPort(value: string | undefined): value is string {
  if (value === undefined || !/^[1-9]\d{0,4}$/u.test(value)) return false;
  const port = Number(value);
  return Number.isInteger(port) && port <= 65_535 && String(port) === value;
}

function exactIpv4LoopbackAuthorityPort(value: string | null): string | null {
  if (value === null) return null;
  const port = /^127\.0\.0\.1:([1-9]\d{0,4})$/u.exec(value)?.[1];
  return isCanonicalPort(port) ? port : null;
}

function isLoopbackForwardedFor(value: string | null): boolean {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

/** Match only the observed direct Replit Autoscale homepage probe. */
export function isExactReplitLoopbackHealthCheck(input: ReplitLoopbackHealthCheckInput): boolean {
  if (
    input.deployment !== '1' ||
    !isCanonicalPort(input.port) ||
    (input.method !== 'GET' && input.method !== 'HEAD') ||
    input.forwarded !== null
  ) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return false;
  }

  const mappedPort = exactIpv4LoopbackAuthorityPort(input.host);
  if (mappedPort === null) return false;

  const mappedAuthority = `127.0.0.1:${mappedPort}`;
  const forwardedHeadersAbsent =
    input.forwardedFor === null &&
    input.forwardedHost === null &&
    input.forwardedPort === null &&
    input.forwardedProto === null;
  const forwardedHeadersExact =
    input.forwardedHost === mappedAuthority &&
    input.forwardedPort === input.port &&
    input.forwardedProto === 'http' &&
    isLoopbackForwardedFor(input.forwardedFor);

  return (
    input.host === mappedAuthority &&
    (forwardedHeadersAbsent || forwardedHeadersExact) &&
    url.protocol === 'http:' &&
    url.username === '' &&
    url.password === '' &&
    url.hostname === 'localhost' &&
    url.port === input.port &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''
  );
}

export function replitLoopbackLivenessResponse(method: string): Response {
  return new Response(method === 'HEAD' ? null : 'ok\n', {
    status: 200,
    headers: {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'content-type': 'text/plain; charset=utf-8',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    },
  });
}
