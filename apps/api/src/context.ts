import type { AppConfig } from '@boomerbuddy/config';
import type { Logger } from '@boomerbuddy/observability';
import {
  CheckRepository,
  CommerceOperationsRepository,
  EntitlementRepository,
  FamilyRepository,
  HqRepository,
  OrientationRepository,
  SessionRepository,
  type Database,
} from '@boomerbuddy/persistence';

export interface ApiRepositories {
  readonly checks: CheckRepository;
  readonly commerce: CommerceOperationsRepository;
  readonly entitlements: EntitlementRepository;
  readonly family: FamilyRepository;
  readonly hq: HqRepository;
  readonly orientation: OrientationRepository;
  readonly sessions: SessionRepository;
}

export interface ApiContext {
  readonly config: AppConfig;
  readonly database: Database;
  readonly repositories: ApiRepositories;
  readonly logger: Logger;
  readonly now: () => Date;
}

export function createRepositories(database: Database, config: AppConfig): ApiRepositories {
  return {
    checks: new CheckRepository(database, {
      encryptionKey: config.secrets.artifactEncryptionKey,
      encryptionKeyVersion: 1,
      fingerprintKey: config.secrets.fingerprintKey,
      fingerprintKeyVersion: 1,
    }),
    commerce: new CommerceOperationsRepository(database, config.secrets.fingerprintKey, 1),
    entitlements: new EntitlementRepository(database),
    family: new FamilyRepository(database, config.secrets.fingerprintKey, 1),
    hq: new HqRepository(database),
    orientation: new OrientationRepository(database, config.secrets.safeWordPepper),
    sessions: new SessionRepository(database),
  };
}
