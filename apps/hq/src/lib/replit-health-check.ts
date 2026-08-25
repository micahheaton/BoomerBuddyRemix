export type ReplitHqHealthCheckInput = {
  deployment: string | undefined;
  forwarded: string | null;
  forwardedFor: string | null;
  forwardedHost: string | null;
  forwardedPort: string | null;
  forwardedProto: string | null;
  host: string | null;
  method: string;
  port: string | undefined;
  url: string;
};

function canonicalPort(value: string | undefined): value is string {
  if (value === undefined || !/^[1-9]\d{0,4}$/u.test(value)) return false;
  const port = Number(value);
  return Number.isInteger(port) && port <= 65_535 && String(port) === value;
}

function exactIpv4LoopbackAuthorityPort(value: string | null): string | null {
  if (value === null) return null;
  const port = /^127\.0\.0\.1:([1-9]\d{0,4})$/u.exec(value)?.[1];
  return canonicalPort(port) ? port : null;
}

function isLoopbackForwardedFor(value: string | null): boolean {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

export function isExactReplitHqHealthCheck(input: ReplitHqHealthCheckInput): boolean {
  if (
    input.deployment !== '1' ||
    !canonicalPort(input.port) ||
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
  const normalizedLoopbackHostname = url.hostname === 'localhost';
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
    normalizedLoopbackHostname &&
    url.port === input.port &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''
  );
}

export function replitHqLivenessResponse(method: string): Response {
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
