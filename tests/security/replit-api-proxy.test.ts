import { describe, expect, it, vi } from 'vitest';
import { proxyBrowserApi } from '../../apps/web/src/lib/server-api-proxy';

const production = {
  NODE_ENV: 'production',
  BB_API_INTERNAL_ORIGIN: 'https://api.example.invalid',
  BB_PUBLIC_ORIGIN: 'https://customer.example.invalid',
};

describe('Replit browser-to-API proxy', () => {
  it('forwards only bounded headers, the Clerk cookie, and the configured origin', async () => {
    const fetchImplementation = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      expect(request.toString()).toBe('https://api.example.invalid/v1/checks?limit=1');
      const headers = new Headers(init?.headers);
      expect(headers.get('origin')).toBe('https://customer.example.invalid');
      expect(headers.get('cookie')).toBe('__session=synthetic.clerk.session');
      expect(headers.get('x-bb-household-id')).toBe('household-1');
      expect(headers.get('authorization')).toBeNull();
      expect(headers.get('x-forwarded-for')).toBeNull();
      return Response.json({ ok: true });
    });
    const response = await proxyBrowserApi({
      audience: 'customer',
      environment: production,
      fetchImplementation,
      path: ['v1', 'checks'],
      request: new Request('https://customer.example.invalid/api/v1/checks?limit=1', {
        headers: {
          Authorization: 'Bearer attacker-controlled',
          Cookie: 'unrelated=value; __session=synthetic.clerk.session; theme=dark',
          Origin: 'https://customer.example.invalid',
          'X-BB-Household-Id': 'household-1',
          'X-Forwarded-For': '203.0.113.7',
        },
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('rejects cross-origin mutation, oversized bodies, and unsafe paths before upstream access', async () => {
    const fetchImplementation = vi.fn(async () => Response.json({ unexpected: true }));
    const crossOrigin = await proxyBrowserApi({
      audience: 'customer',
      environment: production,
      fetchImplementation,
      path: ['v1', 'checks'],
      request: new Request('https://customer.example.invalid/api/v1/checks', {
        body: '{}',
        headers: { Origin: 'https://attacker.example.invalid' },
        method: 'POST',
      }),
    });
    expect(crossOrigin.status).toBe(403);

    const oversized = await proxyBrowserApi({
      audience: 'customer',
      environment: production,
      fetchImplementation,
      path: ['v1', 'checks'],
      request: new Request('https://customer.example.invalid/api/v1/checks', {
        body: 'x',
        headers: {
          'Content-Length': '1048577',
          Origin: 'https://customer.example.invalid',
        },
        method: 'POST',
      }),
    });
    expect(oversized.status).toBe(413);

    const unsafePath = await proxyBrowserApi({
      audience: 'customer',
      environment: production,
      fetchImplementation,
      path: ['..', 'admin'],
      request: new Request('https://customer.example.invalid/api/../admin'),
    });
    expect(unsafePath.status).toBe(503);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects duplicate Clerk session cookies and never forwards unrelated cookies', async () => {
    const fetchImplementation = vi.fn(async () => Response.json({ unexpected: true }));
    const response = await proxyBrowserApi({
      audience: 'customer',
      environment: production,
      fetchImplementation,
      path: ['v1', 'me'],
      request: new Request('https://customer.example.invalid/api/v1/me', {
        headers: { Cookie: '__session=first.token; __session=second.token' },
      }),
    });
    expect(response.status).toBe(401);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('refuses incomplete or insecure production upstream configuration', async () => {
    const fetchImplementation = vi.fn(async () => Response.json({ unexpected: true }));
    for (const environment of [
      { ...production, BB_API_INTERNAL_ORIGIN: 'http://api.example.invalid' },
      { ...production, BB_PUBLIC_ORIGIN: undefined },
      { ...production, BB_API_INTERNAL_ORIGIN: 'https://user:secret@api.example.invalid' },
    ]) {
      const response = await proxyBrowserApi({
        audience: 'hq',
        environment,
        fetchImplementation,
        path: ['v1', 'hq', 'status'],
        request: new Request('https://hq.example.invalid/api/v1/hq/status'),
      });
      expect(response.status).toBe(503);
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
