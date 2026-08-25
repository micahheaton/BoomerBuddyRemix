import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isExactReplitHqHealthCheck,
  replitHqLivenessResponse,
  type ReplitHqHealthCheckInput,
} from '../../apps/hq/src/lib/replit-health-check';

const root = process.cwd();
const exactRequest: ReplitHqHealthCheckInput = {
  deployment: '1',
  forwarded: null,
  forwardedFor: '127.0.0.1',
  forwardedHost: '127.0.0.1:1104',
  forwardedPort: '3000',
  forwardedProto: 'http',
  host: '127.0.0.1:1104',
  method: 'GET',
  port: '3000',
  url: 'http://localhost:3000/',
};

describe('Replit HQ Autoscale liveness boundary', () => {
  it.each(['GET', 'HEAD'])('accepts only the exact direct loopback %s probe', (method) => {
    expect(isExactReplitHqHealthCheck({ ...exactRequest, method })).toBe(true);
  });

  it('accepts the direct Replit probe when x-forwarded headers are absent', () => {
    expect(
      isExactReplitHqHealthCheck({
        ...exactRequest,
        forwardedFor: null,
        forwardedHost: null,
        forwardedPort: null,
        forwardedProto: null,
      }),
    ).toBe(true);
  });

  it.each(['forwardedFor', 'forwardedHost', 'forwardedPort', 'forwardedProto'] as const)(
    'rejects a mixed forwarded-header shape with only %s absent',
    (header) => {
      expect(isExactReplitHqHealthCheck({ ...exactRequest, [header]: null })).toBe(false);
    },
  );

  it.each(['1104', '2208', '3000'])(
    'accepts canonical mapped loopback port %s independently of the listener',
    (mappedPort) => {
      const mappedAuthority = `127.0.0.1:${mappedPort}`;
      expect(
        isExactReplitHqHealthCheck({
          ...exactRequest,
          host: mappedAuthority,
          forwardedHost: mappedAuthority,
        }),
      ).toBe(true);
    },
  );

  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
    'accepts the Next-derived %s loopback peer',
    (forwardedFor) => {
      expect(isExactReplitHqHealthCheck({ ...exactRequest, forwardedFor })).toBe(true);
    },
  );

  const rejected: Array<[string, Partial<ReplitHqHealthCheckInput>]> = [
    ['missing deployment marker', { deployment: undefined }],
    ['different deployment marker', { deployment: '0' }],
    ['missing port', { port: undefined }],
    ['zero listener port', { port: '0' }],
    ['leading-zero listener port', { port: '03000' }],
    ['out-of-range port', { port: '65536' }],
    ['mismatched configured port', { port: '3001' }],
    ['missing host', { host: null }],
    ['hostname-only host', { host: '127.0.0.1' }],
    ['zero mapped host port', { host: '127.0.0.1:0' }],
    ['leading-zero mapped host port', { host: '127.0.0.1:01104' }],
    ['out-of-range mapped host port', { host: '127.0.0.1:65536' }],
    ['localhost host', { host: 'localhost:1104' }],
    ['different host port', { host: '127.0.0.1:1105' }],
    ['mutation method', { method: 'POST' }],
    ['preflight method', { method: 'OPTIONS' }],
    ['HTTPS URL', { url: 'https://localhost:3000/' }],
    ['un-normalized URL hostname', { url: 'http://127.0.0.1:3000/' }],
    ['different URL hostname', { url: 'http://localhost.example:3000/' }],
    ['mapped port used as URL port', { url: 'http://localhost:1104/' }],
    ['different URL port', { url: 'http://localhost:3001/' }],
    ['operator path', { url: 'http://localhost:3000/system' }],
    ['query string', { url: 'http://localhost:3000/?probe=1' }],
    ['credentials', { url: 'http://probe@localhost:3000/' }],
    ['malformed URL', { url: 'not a URL' }],
    ['Forwarded header', { forwarded: 'for=127.0.0.1' }],
    ['non-loopback forwarded client', { forwardedFor: '192.0.2.10' }],
    ['different forwarded host', { forwardedHost: 'boomerbuddy-hq.replit.app' }],
    ['mapped forwarded port', { forwardedPort: '1104' }],
    ['different forwarded port', { forwardedPort: '443' }],
    ['different forwarded protocol', { forwardedProto: 'https' }],
  ];

  it.each(rejected)('rejects %s', (_name, override) => {
    expect(isExactReplitHqHealthCheck({ ...exactRequest, ...override })).toBe(false);
  });

  it.each(['GET', 'HEAD'])('returns content-free no-store liveness for %s', async (method) => {
    const response = replitHqLivenessResponse(method);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(method === 'HEAD' ? '' : 'ok\n');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
  });

  it('keeps identity configuration and every non-probe HQ request behind Clerk', async () => {
    const source = await readFile(join(root, 'apps/hq/src/proxy.ts'), 'utf8');
    const missingIdentityCheck = source.indexOf(
      '!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY',
    );
    const livenessCheck = source.indexOf('isExactReplitHqHealthCheck({');
    const clerkBoundary = source.indexOf('return productionClerkMiddleware(request, event)');

    expect(missingIdentityCheck).toBeGreaterThan(-1);
    expect(livenessCheck).toBeGreaterThan(missingIdentityCheck);
    expect(clerkBoundary).toBeGreaterThan(livenessCheck);
    expect(source).toContain("const isPublicRoute = createRouteMatcher(['/sign-in(.*)'])");
    expect(source).toContain('if (!isPublicRoute(request)) await auth.protect()');
    expect(source).toContain("request.headers.get('host')");
    expect(source).toContain("request.headers.get('x-forwarded-for')");
  });
});
