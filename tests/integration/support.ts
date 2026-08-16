import type { AppConfig } from '@boomerbuddy/config';
import type { DevPersonaId } from '@boomerbuddy/contracts';
import { createLogger } from '@boomerbuddy/observability';
import { createPGliteDatabase, type Database } from '@boomerbuddy/persistence';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api/src/app';

export const customerOrigin = 'http://127.0.0.1:3100';
export const hqOrigin = 'http://127.0.0.1:3101';

export interface MutableClock {
  readonly now: () => Date;
  readonly set: (value: Date) => void;
  readonly advance: (milliseconds: number) => void;
}

export function createMutableClock(initial = new Date('2026-08-15T12:00:00.000Z')): MutableClock {
  let current = new Date(initial);
  return {
    now: () => new Date(current),
    set: (value) => {
      current = new Date(value);
    },
    advance: (milliseconds) => {
      current = new Date(current.getTime() + milliseconds);
    },
  };
}

export function testConfig(): AppConfig {
  return {
    environment: 'test',
    api: { host: '127.0.0.1', port: 4100 },
    database: {
      driver: 'pglite',
      path: ':memory:',
      runMigrations: true,
      seedDemo: true,
    },
    identity: {
      allowDevelopmentIssuer: true,
      customerOrigins: [customerOrigin],
      hqOrigins: [hqOrigin],
    },
    secrets: {
      session: Buffer.from('test-session-secret-32-bytes-long-value', 'utf8'),
      artifactEncryptionKey: Buffer.alloc(32, 7),
      fingerprintKey: Buffer.alloc(32, 11),
      safeWordPepper: Buffer.from('test-safe-word-pepper-value', 'utf8'),
    },
    commerce: { stripe: { mode: 'disabled' } },
    logLevel: 'error',
  };
}

export interface ApiHarness {
  readonly app: FastifyInstance;
  readonly database: Database;
  readonly clock: MutableClock;
  readonly close: () => Promise<void>;
}

export async function createApiHarness(
  clock = createMutableClock(),
  options: { readonly retentionSweepIntervalMs?: number } = {},
): Promise<ApiHarness> {
  const config = testConfig();
  const database = await createPGliteDatabase(':memory:');
  const app = await buildApp({
    config,
    database,
    closeDatabase: false,
    now: clock.now,
    logger: createLogger({ level: 'error', sink: () => undefined, clock: clock.now }),
    ...options,
  });
  return {
    app,
    database,
    clock,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}

export interface LoginResult {
  readonly cookie?: string;
  readonly token?: string;
  readonly body: Record<string, unknown>;
}

export async function login(
  app: FastifyInstance,
  personaId: DevPersonaId,
  audience: 'customer' | 'hq' | 'mobile' = 'customer',
): Promise<LoginResult> {
  const origin = audience === 'hq' ? hqOrigin : customerOrigin;
  const response = await app.inject({
    method: 'POST',
    url: `/v1/dev/sessions/${audience}`,
    headers: { origin },
    payload: { personaId },
  });
  if (response.statusCode !== 201) {
    throw new Error(`Login failed (${response.statusCode}): ${response.body}`);
  }
  const body = response.json<Record<string, unknown>>();
  if (audience === 'mobile') return { token: String(body.token), body };
  const setCookie = response.headers['set-cookie'];
  const cookieValue = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (cookieValue === undefined) throw new Error('Browser login did not set a cookie');
  const parsedCookie = cookieValue.split(';', 1)[0];
  if (parsedCookie === undefined) throw new Error('Browser login returned an invalid cookie');
  return { cookie: parsedCookie, body };
}

export function browserHeaders(cookie: string, origin = customerOrigin) {
  return { cookie, origin };
}

export function bearerHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}
