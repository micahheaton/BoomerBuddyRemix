import { randomUUID } from 'node:crypto';
import {
  createPostgresDatabase,
  DurableJobRepository,
  runMigrations,
} from '@boomerbuddy/persistence';

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.trim() === '') {
  throw new TypeError('DATABASE_URL is required for real PostgreSQL verification');
}
const database = await createPostgresDatabase(connectionString);
try {
  const first = await runMigrations(database);
  const second = await runMigrations(database);
  if (first.length === 0 || second.length !== 0) {
    throw new Error('PostgreSQL migrations were not forward-only and idempotent');
  }
  const jobs = new DurableJobRepository(database);
  const suffix = randomUUID();
  const now = new Date();
  await jobs.enqueue({
    type: 'ci.postgres_lock',
    payload: { fixture: suffix },
    idempotencyKey: `postgres-lock-${suffix}`,
    scheduledAt: now,
    correlationId: `postgres-lock-${suffix}`,
    maxAttempts: 3,
  });
  const claims = await Promise.all([
    jobs.claim({
      workerId: `postgres-worker-one-${suffix}`,
      jobTypes: ['ci.postgres_lock'],
      limit: 1,
      leaseDurationMs: 5_000,
      now,
    }),
    jobs.claim({
      workerId: `postgres-worker-two-${suffix}`,
      jobTypes: ['ci.postgres_lock'],
      limit: 1,
      leaseDurationMs: 5_000,
      now,
    }),
  ]);
  if (claims[0].length + claims[1].length !== 1) {
    throw new Error('PostgreSQL SKIP LOCKED claim did not produce one owner');
  }
  process.stdout.write('PostgreSQL migrations and competing-worker lease claim passed.\n');
} finally {
  await database.close();
}
