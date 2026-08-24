import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  closeWorkerHealthServer,
  createWorkerHealthServer,
  resolveReplitWorkerHealthPort,
} from '../../apps/worker/src/health-server';

const listenOnLoopback = async () => {
  const server = createWorkerHealthServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${address.port}`, server };
};

describe('Replit worker liveness listener', () => {
  it('is enabled only for deployments and selects a valid provider or fallback port', () => {
    expect(resolveReplitWorkerHealthPort({})).toBeUndefined();
    expect(resolveReplitWorkerHealthPort({ REPLIT_DEPLOYMENT: '0', PORT: '4173' })).toBeUndefined();
    expect(resolveReplitWorkerHealthPort({ REPLIT_DEPLOYMENT: '1' })).toBe(3000);
    expect(resolveReplitWorkerHealthPort({ REPLIT_DEPLOYMENT: '1', PORT: '4173' })).toBe(4173);

    for (const port of ['', '0', '1.5', '65536', 'not-a-port']) {
      expect(() => resolveReplitWorkerHealthPort({ REPLIT_DEPLOYMENT: '1', PORT: port })).toThrow(
        'requires a valid PORT',
      );
    }
  });

  it('serves only a static, non-sensitive liveness surface', async () => {
    const { origin, server } = await listenOnLoopback();
    try {
      for (const path of ['/', '/health/live']) {
        const response = await fetch(`${origin}${path}`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'ok' });
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.has('access-control-allow-origin')).toBe(false);
      }

      const head = await fetch(`${origin}/health/live`, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');

      for (const path of ['/health/ready', '/metrics', '/v1/jobs']) {
        const response = await fetch(`${origin}${path}`);
        expect(response.status).toBe(404);
      }

      const mutation = await fetch(`${origin}/health/live`, { method: 'POST' });
      expect(mutation.status).toBe(405);
      expect(mutation.headers.get('allow')).toBe('GET, HEAD');
      expect(await mutation.json()).toEqual({ status: 'method_not_allowed' });
    } finally {
      await closeWorkerHealthServer(server);
    }
  });
});
