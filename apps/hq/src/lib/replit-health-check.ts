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

  const authority = `127.0.0.1:${input.port}`;
  const normalizedLoopbackHostname = url.hostname === 'localhost';
  const forwardedLoopback =
    input.forwardedFor === '127.0.0.1' ||
    input.forwardedFor === '::1' ||
    input.forwardedFor === '::ffff:127.0.0.1';
  return (
    input.host === authority &&
    input.forwardedHost === authority &&
    input.forwardedPort === input.port &&
    input.forwardedProto === 'http' &&
    forwardedLoopback &&
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
