import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

import { loadConfig, loadEnvironmentFile } from '@boomerbuddy/config';
import {
  foundingHouseholdBenefitKeys,
  type FoundingHouseholdBenefitKey,
} from '@boomerbuddy/domain';
import { createPostgresDatabase, FoundingHouseholdRepository } from '@boomerbuddy/persistence';

const requiredArguments = [
  '--operation-id',
  '--confirm-operation-id',
  '--benefit-key',
  '--max-households',
  '--invitation-ttl-days',
  '--access-duration-days',
  '--program-ends-at',
  '--sponsorship-starts-at',
  '--sponsorship-ends-at',
  '--privacy-policy-version',
  '--confirm-production',
] as const;

function parseArguments(): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  const argumentsList = process.argv.slice(2);
  if (argumentsList.length % 2 !== 0) throw new TypeError('Every CLI option requires one value');
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (
      name === undefined ||
      value === undefined ||
      !requiredArguments.includes(name as (typeof requiredArguments)[number])
    ) {
      throw new TypeError(`Unknown production bootstrap option: ${name ?? 'missing'}`);
    }
    if (value.startsWith('--') || values.has(name)) {
      throw new TypeError(`Invalid or repeated production bootstrap option: ${name}`);
    }
    values.set(name, value);
  }
  for (const name of requiredArguments) {
    if (!values.has(name)) throw new TypeError(`Missing required ${name} value`);
  }
  return values;
}

function value(argumentsMap: ReadonlyMap<string, string>, name: string): string {
  const result = argumentsMap.get(name);
  if (result === undefined) throw new TypeError(`Missing required ${name} value`);
  return result;
}

function positiveInteger(argumentsMap: ReadonlyMap<string, string>, name: string): number {
  const raw = value(argumentsMap, name);
  if (!/^[1-9][0-9]{0,8}$/u.test(raw)) throw new TypeError(`${name} must be a positive integer`);
  return Number(raw);
}

function timestamp(argumentsMap: ReadonlyMap<string, string>, name: string): Date {
  const result = new Date(value(argumentsMap, name));
  if (!Number.isFinite(result.getTime())) throw new TypeError(`${name} must be an ISO timestamp`);
  return result;
}

const argumentsMap = parseArguments();
if (value(argumentsMap, '--confirm-production') !== 'FOUNDING_HOUSEHOLD_PRODUCTION') {
  throw new TypeError('--confirm-production must equal FOUNDING_HOUSEHOLD_PRODUCTION');
}
const operationId = value(argumentsMap, '--operation-id');
if (value(argumentsMap, '--confirm-operation-id') !== operationId) {
  throw new TypeError('--confirm-operation-id must exactly match --operation-id');
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(operationId)) {
  throw new TypeError('--operation-id must be a lowercase UUID v4');
}
const benefitKey = value(argumentsMap, '--benefit-key');
if (!foundingHouseholdBenefitKeys.includes(benefitKey as FoundingHouseholdBenefitKey)) {
  throw new TypeError('--benefit-key must name a code-owned Founding Household benefit');
}

if (existsSync('.env')) loadEnvironmentFile();
const config = loadConfig();
if (
  config.environment !== 'production' ||
  config.database.driver !== 'postgres' ||
  config.identity.clerk === undefined ||
  config.identity.founderPersonId === undefined
) {
  throw new TypeError('Founding Household bootstrap requires complete production configuration');
}

const database = await createPostgresDatabase(config.database.url);
try {
  const repository = new FoundingHouseholdRepository(
    database,
    config.secrets.fingerprintKey,
    1,
    config.identity.founderPersonId,
    'production',
  );
  const result = await repository.bootstrapProductionProgram({
    access: {
      actorPersonId: config.identity.founderPersonId,
      correlationId: `founding-production-bootstrap-${randomUUID()}`,
    },
    operationKey: `founding-policy:${operationId}`,
    benefitKey: benefitKey as FoundingHouseholdBenefitKey,
    maxHouseholds: positiveInteger(argumentsMap, '--max-households'),
    invitationTtlDays: positiveInteger(argumentsMap, '--invitation-ttl-days'),
    accessDurationDays: positiveInteger(argumentsMap, '--access-duration-days'),
    programEndsAt: timestamp(argumentsMap, '--program-ends-at'),
    sponsorshipPrivacyPolicyVersion: value(argumentsMap, '--privacy-policy-version'),
    sponsorshipStartsAt: timestamp(argumentsMap, '--sponsorship-starts-at'),
    sponsorshipEndsAt: timestamp(argumentsMap, '--sponsorship-ends-at'),
    now: new Date(),
  });
  process.stdout.write(
    `${JSON.stringify({
      status: result.reused ? 'exact_replay' : 'created',
      environment: 'production',
      founderPersonId: config.identity.founderPersonId,
      sponsorOrganizationId: result.sponsorOrganizationId,
      sponsorshipId: result.sponsorshipId,
      planVersionId: result.planVersionId,
      backingEvidenceTier: result.backingEvidenceTier,
      policyRevision: result.policy.revision,
      policyState: result.policy.state,
      benefitKey: result.policy.benefitKey,
      maxHouseholds: result.policy.maxHouseholds,
    })}\n`,
  );
} finally {
  await database.close();
}
