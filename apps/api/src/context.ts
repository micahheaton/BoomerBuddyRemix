import type { AppConfig } from '@boomerbuddy/config';
import type { Logger } from '@boomerbuddy/observability';
import type { IdentityTokenVerifier } from '@boomerbuddy/security';
import {
  AccessIntentRepository,
  AutomationBudgetRepository,
  BillingAuthorityRepository,
  BusinessOsRepository,
  CheckRepository,
  CommerceOperationsRepository,
  CommerceRuntimeRepository,
  DurableJobRepository,
  EditorialIntelligenceRepository,
  EntitlementRepository,
  FamilyRepository,
  FamilySafeWordRepository,
  FeedbackRepository,
  FounderProvisioningRepository,
  FoundingHouseholdRepository,
  GovernedContentRepository,
  HqRepository,
  KnowledgeRepository,
  MemberLearningRepository,
  MessagingRepository,
  OrientationRepository,
  PublicCheckRepository,
  ProductionIdentityRepository,
  ReferralCreditRepository,
  SessionRepository,
  SupportReceiptRepository,
  TrustedCircleAttentionRepository,
  type Database,
} from '@boomerbuddy/persistence';

export interface ApiRepositories {
  readonly accessIntents: AccessIntentRepository;
  readonly automationBudget: AutomationBudgetRepository;
  readonly billingAuthority: BillingAuthorityRepository;
  readonly checks: CheckRepository;
  readonly businessOs: BusinessOsRepository;
  readonly commerce: CommerceOperationsRepository;
  readonly commerceRuntime: CommerceRuntimeRepository;
  readonly jobs: DurableJobRepository;
  readonly entitlements: EntitlementRepository;
  readonly editorial: EditorialIntelligenceRepository;
  readonly family: FamilyRepository;
  readonly familySafeWords: FamilySafeWordRepository;
  readonly feedback: FeedbackRepository;
  readonly founderProvisioning: FounderProvisioningRepository;
  readonly foundingHouseholds: FoundingHouseholdRepository;
  readonly governedContent: GovernedContentRepository;
  readonly hq: HqRepository;
  readonly knowledge: KnowledgeRepository;
  readonly memberLearning: MemberLearningRepository;
  readonly messaging: MessagingRepository;
  readonly orientation: OrientationRepository;
  readonly publicChecks: PublicCheckRepository;
  readonly referrals: ReferralCreditRepository;
  readonly sessions: SessionRepository;
  readonly supportReceipts: SupportReceiptRepository;
  readonly trustedCircleAttention: TrustedCircleAttentionRepository;
  readonly productionIdentities: ProductionIdentityRepository;
}

export interface ApiContext {
  readonly config: AppConfig;
  readonly database: Database;
  readonly repositories: ApiRepositories;
  readonly logger: Logger;
  readonly now: () => Date;
  readonly identityTokenVerifier?: IdentityTokenVerifier;
}

export function createRepositories(
  database: Database,
  config: AppConfig,
  identityTokenVerifier?: IdentityTokenVerifier,
): ApiRepositories {
  const entitlementRuntimeEnvironment =
    config.environment === 'production' ? ('production' as const) : ('local' as const);
  const configuredFounderPersonId =
    config.identity.founderPersonId ?? 'founder-identity-unconfigured';
  return {
    accessIntents: new AccessIntentRepository(
      database,
      config.secrets.fingerprintKey,
      config.environment === 'production' ? 500 : 5,
      500,
    ),
    automationBudget: new AutomationBudgetRepository(
      database,
      undefined,
      config.identity.founderPersonId,
    ),
    billingAuthority: new BillingAuthorityRepository(database, config.identity.founderPersonId),
    businessOs: new BusinessOsRepository(database, undefined, config.identity.founderPersonId),
    checks: new CheckRepository(
      database,
      {
        encryptionKey: config.secrets.artifactEncryptionKey,
        encryptionKeyVersion: 1,
        fingerprintKey: config.secrets.fingerprintKey,
        fingerprintKeyVersion: 1,
      },
      undefined,
      entitlementRuntimeEnvironment,
    ),
    commerce: new CommerceOperationsRepository(
      database,
      config.secrets.fingerprintKey,
      1,
      undefined,
      entitlementRuntimeEnvironment,
    ),
    commerceRuntime: new CommerceRuntimeRepository(database),
    jobs: new DurableJobRepository(database),
    entitlements: new EntitlementRepository(database, undefined, entitlementRuntimeEnvironment),
    editorial: new EditorialIntelligenceRepository(database, {
      encryptionKey: config.secrets.artifactEncryptionKey,
      encryptionKeyVersion: 1,
      founderPersonId: configuredFounderPersonId,
    }),
    family: new FamilyRepository(
      database,
      config.secrets.fingerprintKey,
      1,
      undefined,
      entitlementRuntimeEnvironment,
    ),
    familySafeWords: new FamilySafeWordRepository(
      database,
      config.secrets.safeWordPepper,
      undefined,
      entitlementRuntimeEnvironment,
    ),
    feedback: new FeedbackRepository(database, {
      encryptionKey: config.secrets.artifactEncryptionKey,
      encryptionKeyVersion: 1,
      fingerprintKey: config.secrets.fingerprintKey,
      fingerprintKeyVersion: 1,
    }),
    founderProvisioning: new FounderProvisioningRepository(
      database,
      config.identity.founderPersonId,
    ),
    foundingHouseholds: new FoundingHouseholdRepository(
      database,
      config.secrets.fingerprintKey,
      1,
      config.identity.founderPersonId,
      config.environment === 'production' ? 'production' : 'local',
    ),
    governedContent: new GovernedContentRepository(database, {
      encryptionKey: config.secrets.artifactEncryptionKey,
      encryptionKeyVersion: 1,
    }),
    hq: new HqRepository(database, undefined, entitlementRuntimeEnvironment),
    knowledge: new KnowledgeRepository(database),
    memberLearning: new MemberLearningRepository(
      database,
      undefined,
      entitlementRuntimeEnvironment,
    ),
    messaging: new MessagingRepository(
      database,
      {
        encryptionKey: config.secrets.artifactEncryptionKey,
        encryptionKeyVersion: 1,
        fingerprintKey: config.secrets.fingerprintKey,
        fingerprintKeyVersion: 1,
      },
      undefined,
      entitlementRuntimeEnvironment,
    ),
    orientation: new OrientationRepository(
      database,
      config.secrets.safeWordPepper,
      undefined,
      entitlementRuntimeEnvironment,
    ),
    publicChecks: new PublicCheckRepository(database, {
      encryptionKey: config.secrets.artifactEncryptionKey,
      encryptionKeyVersion: 1,
      hmacKey: config.secrets.fingerprintKey,
      hmacKeyVersion: 1,
    }),
    referrals: new ReferralCreditRepository(database, {
      hmacKey: config.secrets.fingerprintKey,
      keyVersion: 1,
    }),
    productionIdentities: new ProductionIdentityRepository(database),
    sessions: new SessionRepository(
      database,
      undefined,
      entitlementRuntimeEnvironment,
      identityTokenVerifier,
    ),
    supportReceipts: new SupportReceiptRepository(database, config.secrets.fingerprintKey),
    trustedCircleAttention: new TrustedCircleAttentionRepository(database),
  };
}
