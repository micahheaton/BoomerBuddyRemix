import type { AppConfig } from '@boomerbuddy/config';
import type { Logger } from '@boomerbuddy/observability';
import {
  BusinessOsRepository,
  CheckRepository,
  CommerceOperationsRepository,
  CommerceRuntimeRepository,
  DurableJobRepository,
  EntitlementRepository,
  FamilyRepository,
  HqRepository,
  KnowledgeRepository,
  OrientationRepository,
  PublicCheckRepository,
  SessionRepository,
  type Database,
} from '@boomerbuddy/persistence';

export interface ApiRepositories {
  readonly checks: CheckRepository;
  readonly businessOs: BusinessOsRepository;
  readonly commerce: CommerceOperationsRepository;
  readonly commerceRuntime: CommerceRuntimeRepository;
  readonly jobs: DurableJobRepository;
  readonly entitlements: EntitlementRepository;
  readonly family: FamilyRepository;
  readonly hq: HqRepository;
  readonly knowledge: KnowledgeRepository;
  readonly orientation: OrientationRepository;
  readonly publicChecks: PublicCheckRepository;
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
    businessOs: new BusinessOsRepository(database),
    checks: new CheckRepository(database, {
      encryptionKey: config.secrets.artifactEncryptionKey,
      encryptionKeyVersion: 1,
      fingerprintKey: config.secrets.fingerprintKey,
      fingerprintKeyVersion: 1,
    }),
    commerce: new CommerceOperationsRepository(database, config.secrets.fingerprintKey, 1),
    commerceRuntime: new CommerceRuntimeRepository(database),
    jobs: new DurableJobRepository(database),
    entitlements: new EntitlementRepository(database),
    family: new FamilyRepository(database, config.secrets.fingerprintKey, 1),
    hq: new HqRepository(database),
    knowledge: new KnowledgeRepository(database),
    orientation: new OrientationRepository(database, config.secrets.safeWordPepper),
    publicChecks: new PublicCheckRepository(database, {
      encryptionKey: config.secrets.artifactEncryptionKey,
      encryptionKeyVersion: 1,
      hmacKey: config.secrets.fingerprintKey,
      hmacKeyVersion: 1,
    }),
    sessions: new SessionRepository(database),
  };
}
