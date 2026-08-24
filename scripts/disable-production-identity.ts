import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadConfig, loadEnvironmentFile } from '@boomerbuddy/config';
import { createPostgresDatabase, ProductionIdentityRepository } from '@boomerbuddy/persistence';

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new TypeError(`Missing required ${name} value`);
  }
  return value;
}

if (existsSync('.env')) loadEnvironmentFile();
const config = loadConfig();
if (
  config.environment !== 'production' ||
  config.database.driver !== 'postgres' ||
  config.identity.clerk === undefined ||
  config.identity.founderPersonId === undefined
) {
  throw new TypeError('Identity disable requires complete production configuration');
}
const audience = argument('--audience');
if (audience !== 'customer' && audience !== 'hq') {
  throw new TypeError('--audience must be customer or hq');
}
const subject = argument('--subject');
if (argument('--confirm-subject') !== subject) {
  throw new TypeError('--confirm-subject must exactly match --subject');
}
if (audience === 'hq' && subject === config.identity.clerk.founderSubject) {
  throw new TypeError('The founder identity requires the reviewed recovery procedure');
}

const database = await createPostgresDatabase(config.database.url, {
  poolMax: config.database.poolMax,
});
try {
  const result = await new ProductionIdentityRepository(database).disableIdentity({
    issuer:
      audience === 'customer'
        ? config.identity.clerk.customer.issuer
        : config.identity.clerk.hq.issuer,
    subject,
    founderPersonId: config.identity.founderPersonId,
    correlationId: `identity-disable-${randomUUID()}`,
    now: new Date(),
  });
  process.stdout.write(
    `${JSON.stringify({
      status: result.reused ? 'already_disabled' : 'disabled',
      identityId: result.identityId,
      personId: result.personId,
      revokedSessionCount: result.revokedSessionCount,
      clerkUserDisableStillRequired: true,
    })}\n`,
  );
} finally {
  await database.close();
}
