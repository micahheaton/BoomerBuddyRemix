import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadConfig, loadEnvironmentFile } from '@boomerbuddy/config';
import { createPostgresDatabase, ProductionIdentityRepository } from '@boomerbuddy/persistence';

if (existsSync('.env')) loadEnvironmentFile();
const config = loadConfig();
if (
  config.environment !== 'production' ||
  config.database.driver !== 'postgres' ||
  config.identity.clerk === undefined ||
  config.identity.founderPersonId === undefined
) {
  throw new TypeError('Founder bootstrap requires complete production configuration');
}

const database = await createPostgresDatabase(config.database.url);
try {
  const repository = new ProductionIdentityRepository(database);
  const result = await repository.bootstrapFounder({
    issuer: config.identity.clerk.hq.issuer,
    subject: config.identity.clerk.founderSubject,
    founderPersonId: config.identity.founderPersonId,
    correlationId: `founder-bootstrap-${randomUUID()}`,
    now: new Date(),
  });
  process.stdout.write(
    `${JSON.stringify({
      status: result.reused ? 'exact_replay' : 'created',
      founderPersonId: result.personId,
      identityId: result.identityId,
      organizationId: result.organizationId,
      employeeAssignmentId: result.employeeAssignmentId,
      evidence: 'production-founder-v1',
    })}\n`,
  );
} finally {
  await database.close();
}
