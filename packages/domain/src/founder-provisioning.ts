export const founderProvisioningStatuses = [
  'not_started',
  'founder_in_progress',
  'ready_for_test',
  'test_proven',
  'ready_for_live_review',
  'blocked',
] as const;

export type FounderProvisioningStatus = (typeof founderProvisioningStatuses)[number];

export const founderProvisioningEvidenceTiers = [
  'repository_review',
  'founder_report',
  'local_simulation',
  'provider_test',
  'deployed_staging',
  'human_validation',
  'professional_review',
  'live_production',
] as const;

export type FounderProvisioningEvidenceTier = (typeof founderProvisioningEvidenceTiers)[number];

export const founderProvisioningEvidenceKinds = [
  'baseline_reconciliation',
  'setup_started',
  'configuration_ready',
  'verification_passed',
  'verification_failed',
  'blocker_recorded',
  'blocker_cleared',
  'configuration_revoked',
  'evidence_invalidated',
  'provider_unavailable',
  'account_removed',
  'live_review_packet_complete',
] as const;

export type FounderProvisioningEvidenceKind = (typeof founderProvisioningEvidenceKinds)[number];

export const founderProvisioningEvidenceResults = [
  'reported',
  'passed',
  'failed',
  'blocked',
  'invalidated',
] as const;

export type FounderProvisioningEvidenceResult = (typeof founderProvisioningEvidenceResults)[number];

export const founderProvisioningBlockerCodes = [
  'founder_account_required',
  'founder_credential_required',
  'founder_cost_decision_required',
  'provider_verification_pending',
  'adapter_not_implemented',
  'legal_review_required',
  'professional_review_required',
  'security_review_required',
  'external_evidence_required',
  'technical_failure',
] as const;

export type FounderProvisioningBlockerCode = (typeof founderProvisioningBlockerCodes)[number];

export const founderProvisioningWorkstreamKeys = [
  'company_git',
  'replit',
  'dns_edge',
  'managed_postgresql',
  'object_storage',
  'managed_identity',
  'kms_secrets',
  'stripe',
  'stripe_tax',
  'twilio',
  'transactional_email',
  'feedback_mailbox',
  'support_mailbox',
  'sentry',
  'posthog',
  'apple_developer',
  'google_play',
  'expo_eas',
  'enrichment',
  'dependency_security',
  'backup_recovery',
  'accounting',
  'legal_professional',
] as const;

export type FounderProvisioningWorkstreamKey = (typeof founderProvisioningWorkstreamKeys)[number];

export type FounderProvisioningAdapterState =
  | 'implemented_disabled'
  | 'test_configurable'
  | 'not_implemented'
  | 'external_only'
  | 'provider_managed';

export type FounderProvisioningCostCeiling =
  'founder_decision_required' | 'zero_until_approved' | 'included_in_parent_workstream';

export interface FounderProvisioningManualStep {
  readonly code: string;
  readonly instruction: string;
  readonly requiredBefore:
    'founder_in_progress' | 'ready_for_test' | 'test_proven' | 'ready_for_live_review';
}

export interface FounderProvisioningCatalogueEntry {
  readonly key: FounderProvisioningWorkstreamKey;
  readonly definitionVersion: 1;
  readonly displayOrder: number;
  readonly provider: string;
  readonly purpose: string;
  readonly accountOwner: string;
  readonly initialStatus: FounderProvisioningStatus;
  readonly adapterState: FounderProvisioningAdapterState;
  readonly manualSteps: readonly FounderProvisioningManualStep[];
  readonly requiredIdentifierNames: readonly string[];
  readonly configurationEnvironmentNames: readonly string[];
  readonly secretEnvironmentNames: readonly string[];
  readonly verificationTest: string;
  readonly allowedProofTiers: readonly FounderProvisioningEvidenceTier[];
  readonly monthlyCostCeiling: FounderProvisioningCostCeiling;
  readonly recoveryOwner: string;
  readonly exportTermination: string;
  readonly nextFounderAction: string;
}

const step = (
  code: string,
  instruction: string,
  requiredBefore: FounderProvisioningManualStep['requiredBefore'],
): FounderProvisioningManualStep => ({ code, instruction, requiredBefore });

const stripeConfigurationNames = [
  'BB_STRIPE_MODE',
  'BB_STRIPE_TEST_ACCOUNT_ID',
  'BB_STRIPE_TEST_FOUNDING_PRODUCT_ID',
  'BB_STRIPE_TEST_FOUNDING_MONTHLY_PRICE_ID',
  'BB_STRIPE_TEST_CANCEL_ONLY_PORTAL_CONFIGURATION_ID',
  'BB_STRIPE_LIVE_ACCOUNT_ID',
  'BB_STRIPE_LIVE_FOUNDING_PRODUCT_ID',
  'BB_STRIPE_LIVE_FOUNDING_MONTHLY_PRICE_ID',
  'BB_STRIPE_LIVE_CANCEL_ONLY_PORTAL_CONFIGURATION_ID',
] as const;

const stripeSecretNames = [
  'BB_STRIPE_TEST_API_KEY',
  'BB_STRIPE_TEST_WEBHOOK_SECRET',
  'BB_STRIPE_LIVE_API_KEY',
  'BB_STRIPE_LIVE_WEBHOOK_SECRET',
] as const;

const runtimeConfigurationNames = [
  'NODE_ENV',
  'BB_API_HOST',
  'BB_API_PORT',
  'BB_TRUSTED_PROXY_HOPS',
  'BB_DATABASE_DRIVER',
  'BB_PGLITE_PATH',
  'BB_RUN_MIGRATIONS',
  'BB_SEED_DEMO',
  'BB_ALLOW_DEV_IDENTITY',
  'BB_FOUNDER_PERSON_ID',
  'BB_CUSTOMER_ORIGINS',
  'BB_HQ_ORIGINS',
  'BB_LOG_LEVEL',
  'BB_WORKER_ID',
  'BB_WORKER_POLL_MS',
  'BB_WORKER_LEASE_MS',
  'BB_WORKER_HEARTBEAT_MS',
  'BB_WORKER_SHUTDOWN_MS',
  'BB_WORKER_BATCH_SIZE',
  'BB_WORKER_RETRY_BASE_MS',
  'BB_WORKER_RETRY_MAX_MS',
  'NEXT_PUBLIC_API_URL',
  'EXPO_PUBLIC_API_URL',
  ...stripeConfigurationNames,
] as const;

const runtimeSecretNames = [
  'DATABASE_URL',
  'BB_SESSION_SECRET',
  'BB_ARTIFACT_KEY_BASE64',
  'BB_FINGERPRINT_KEY_BASE64',
  'BB_SAFE_WORD_PEPPER',
  ...stripeSecretNames,
] as const;

export const founderProvisioningCatalogue: readonly FounderProvisioningCatalogueEntry[] = [
  {
    key: 'company_git',
    definitionVersion: 1,
    displayOrder: 10,
    provider: 'Company Git host',
    purpose: 'Canonical source, protected release history, and CI evidence outside Replit.',
    accountOwner: 'Founder/company',
    initialStatus: 'not_started',
    adapterState: 'external_only',
    manualSteps: [
      step(
        'secure_account',
        'Create or confirm the company account, MFA, and recovery owner.',
        'founder_in_progress',
      ),
      step(
        'create_private_repository',
        'Create the private canonical repository and record its safe organization and repository names.',
        'ready_for_test',
      ),
      step(
        'protect_release_history',
        'Protect the default branch and frozen release-tag policy.',
        'ready_for_test',
      ),
      step(
        'independent_clone',
        'Clone the frozen tag independently and retain the clean verification manifest.',
        'test_proven',
      ),
      step(
        'review_recovery',
        'Review repository export, mirror, and account-recovery procedures.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'organization',
      'repository_slug',
      'default_branch',
      'release_tag_policy',
    ],
    configurationEnvironmentNames: [],
    secretEnvironmentNames: [],
    verificationTest:
      'Independent clean clone of the frozen tag plus branch, CI, and recovery review.',
    allowedProofTiers: ['deployed_staging'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder plus independent recovery owner',
    exportTermination:
      'Repository mirror or bundle and release artifacts verified outside the host.',
    nextFounderAction:
      'Create or confirm the company-controlled private repository and recovery owners.',
  },
  {
    key: 'replit',
    definitionVersion: 1,
    displayOrder: 20,
    provider: 'Replit',
    purpose: 'Development cockpit and candidate API, worker, web, and HQ hosting.',
    accountOwner: 'Founder/company',
    initialStatus: 'founder_in_progress',
    adapterState: 'provider_managed',
    manualSteps: [
      step(
        'secure_workspace',
        'Confirm company workspace custody, MFA, billing owner, and recovery owner.',
        'founder_in_progress',
      ),
      step(
        'import_frozen_tag',
        'Import only the frozen canonical Git tag into the staging project.',
        'ready_for_test',
      ),
      step(
        'configure_names_only',
        'Enter required configuration and secret values only in Replit Secrets under the listed names.',
        'ready_for_test',
      ),
      step(
        'deploy_staging',
        'Create separate bounded staging API, worker, web, and HQ deployments.',
        'test_proven',
      ),
      step(
        'run_rollback_drill',
        'Retain health, proxy, worker, browser, restart, and rollback evidence.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'workspace_id',
      'project_ids',
      'deployment_ids',
      'plan',
      'region',
      'release_tag',
    ],
    configurationEnvironmentNames: runtimeConfigurationNames,
    secretEnvironmentNames: runtimeSecretNames,
    verificationTest:
      'Locked build, staging health/browser/proxy/worker/restart, and rollback drill.',
    allowedProofTiers: ['deployed_staging'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder plus recovery owner',
    exportTermination:
      'Canonical Git, database/object export, names-only environment manifest, and stop/delete procedure.',
    nextFounderAction:
      'Confirm company workspace custody and its monthly ceiling before any paid staging use.',
  },
  {
    key: 'dns_edge',
    definitionVersion: 1,
    displayOrder: 30,
    provider: 'Domain registrar and DNS/edge provider',
    purpose: 'boomerbuddy.net custody, reversible staging routing, TLS, WAF, and proxy truth.',
    accountOwner: 'Founder/company',
    initialStatus: 'founder_in_progress',
    adapterState: 'external_only',
    manualSteps: [
      step(
        'confirm_custody',
        'Confirm registrar and DNS account custody, MFA, recovery contacts, and transfer controls.',
        'founder_in_progress',
      ),
      step(
        'export_zone',
        'Export current records and retain the pre-change rollback manifest.',
        'ready_for_test',
      ),
      step(
        'create_staging_records',
        'After the explicit DNS gate, create only reversible staging host records.',
        'test_proven',
      ),
      step(
        'verify_edge',
        'Verify TLS, proxy-hop configuration, body limits, WAF behavior, and rollback timing.',
        'test_proven',
      ),
      step(
        'review_termination',
        'Review record export, nameserver rollback, and registrar transfer procedure.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'registrar',
      'zone_id',
      'account_id',
      'nameservers',
      'recovery_contacts',
    ],
    configurationEnvironmentNames: [
      'BB_TRUSTED_PROXY_HOPS',
      'BB_CUSTOMER_ORIGINS',
      'BB_HQ_ORIGINS',
      'NEXT_PUBLIC_API_URL',
      'EXPO_PUBLIC_API_URL',
    ],
    secretEnvironmentNames: [],
    verificationTest:
      'Zone export plus reversible staging hostname, TLS, proxy, WAF, and rollback proof.',
    allowedProofTiers: ['deployed_staging'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder plus registrar recovery owner',
    exportTermination:
      'Zone export, prior-record manifest, and registrar transfer/unlock procedure.',
    nextFounderAction:
      'Confirm registrar/DNS custody and export the existing zone without changing records.',
  },
  {
    key: 'managed_postgresql',
    definitionVersion: 1,
    displayOrder: 40,
    provider: 'Managed PostgreSQL',
    purpose: 'Canonical customer, consent, commerce, job, and audit truth.',
    accountOwner: 'Founder/company',
    initialStatus: 'not_started',
    adapterState: 'test_configurable',
    manualSteps: [
      step(
        'select_provider_region',
        'Select a standard PostgreSQL provider and approved region.',
        'founder_in_progress',
      ),
      step(
        'create_roles',
        'Create separate migration, runtime, and backup roles with least privilege.',
        'ready_for_test',
      ),
      step(
        'store_database_url',
        'Store DATABASE_URL only in the approved secret manager.',
        'ready_for_test',
      ),
      step(
        'run_postgres_suite',
        'Run clean migrations, concurrency, pool/direct, lease, and failure tests.',
        'test_proven',
      ),
      step(
        'restore_independently',
        'Restore an export into independent PostgreSQL and reconcile rows and projections.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'project_id',
      'database_id',
      'branch_id',
      'region',
      'role_names',
      'backup_policy',
    ],
    configurationEnvironmentNames: ['BB_DATABASE_DRIVER', 'BB_RUN_MIGRATIONS'],
    secretEnvironmentNames: ['DATABASE_URL'],
    verificationTest:
      'Clean migrations, real-PostgreSQL concurrency, least privilege, backup, restore, and reconciliation.',
    allowedProofTiers: ['deployed_staging'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder plus database recovery owner',
    exportTermination:
      'Logical export, provider snapshot/PITR, and restore to independent PostgreSQL.',
    nextFounderAction: 'Choose the founder-owned provider, region, ceiling, and recovery owner.',
  },
  {
    key: 'object_storage',
    definitionVersion: 1,
    displayOrder: 50,
    provider: 'Private S3-compatible object storage',
    purpose: 'Feedback media and encrypted retained objects with private lifecycle controls.',
    accountOwner: 'Founder/company',
    initialStatus: 'not_started',
    adapterState: 'not_implemented',
    manualSteps: [
      step(
        'select_private_storage',
        'Select a private S3-compatible provider, region, and cost ceiling.',
        'founder_in_progress',
      ),
      step(
        'define_buckets',
        'Define private quarantine/media buckets, encryption, lifecycle, and CORS policy.',
        'ready_for_test',
      ),
      step(
        'wait_for_adapter_names',
        'Do not create application credentials until the reviewed adapter defines exact names and scopes.',
        'ready_for_test',
      ),
      step(
        'test_synthetic_media',
        'With the adapter present, prove upload, quarantine, read denial, delete, export, and restore using synthetic files.',
        'test_proven',
      ),
      step(
        'review_exit',
        'Review inventory/checksum export, replica, key rotation, and termination procedure.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'provider',
      'region',
      'bucket_ids',
      'encryption_key_references',
      'lifecycle_policy',
      'cors_policy',
    ],
    configurationEnvironmentNames: [],
    secretEnvironmentNames: [],
    verificationTest:
      'Synthetic upload/quarantine/read/tenant denial/delete/export/restore after an adapter exists.',
    allowedProofTiers: ['deployed_staging'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder plus storage recovery owner',
    exportTermination:
      'Inventory with checksums, encrypted export/replica, lifecycle, and termination procedure.',
    nextFounderAction: 'Select a private provider and region; do not invent adapter credentials.',
  },
  {
    key: 'managed_identity',
    definitionVersion: 1,
    displayOrder: 60,
    provider: 'Managed customer identity',
    purpose: 'Customer/HQ authentication, MFA, recovery, issuer, audience, and assurance truth.',
    accountOwner: 'Founder/company',
    initialStatus: 'not_started',
    adapterState: 'not_implemented',
    manualSteps: [
      step(
        'select_identity_provider',
        'Select a managed identity provider, region, terms, and recovery owner.',
        'founder_in_progress',
      ),
      step(
        'create_separate_apps',
        'Create separate customer and HQ applications, issuers, audiences, callbacks, and logout URLs.',
        'ready_for_test',
      ),
      step(
        'define_assurance',
        'Configure MFA, step-up, revocation, invitation binding, and recovery policy.',
        'ready_for_test',
      ),
      step(
        'wait_for_identity_adapter',
        'Keep production refused until the reviewed adapter defines exact configuration names.',
        'ready_for_test',
      ),
      step(
        'run_identity_suite',
        'Prove audience separation, MFA/step-up, invitation binding, revocation, recovery, and outage behavior.',
        'test_proven',
      ),
    ],
    requiredIdentifierNames: [
      'provider_tenant',
      'customer_application',
      'hq_application',
      'issuer',
      'audiences',
      'callback_urls',
      'assurance_policy',
    ],
    configurationEnvironmentNames: [],
    secretEnvironmentNames: [],
    verificationTest:
      'Managed customer/HQ separation, MFA/step-up, invite binding, revocation, recovery, and outage proof.',
    allowedProofTiers: ['deployed_staging'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder plus independent identity recovery owner',
    exportTermination:
      'Identity mapping export, key rotation, break-glass, and tenant termination procedure.',
    nextFounderAction:
      'Choose a provider and assurance policy; production remains refused without an adapter.',
  },
  {
    key: 'kms_secrets',
    definitionVersion: 1,
    displayOrder: 70,
    provider: 'KMS and managed secret system',
    purpose:
      'Company custody and rotation of keys, peppers, session signing, and provider credentials.',
    accountOwner: 'Founder/company',
    initialStatus: 'not_started',
    adapterState: 'not_implemented',
    manualSteps: [
      step(
        'select_kms',
        'Select a managed KMS/secret system, region, billing ceiling, and recovery owner.',
        'founder_in_progress',
      ),
      step(
        'define_key_separation',
        'Create separate aliases, versions, grants, rotation, disable, and recovery policies.',
        'ready_for_test',
      ),
      step(
        'keep_raw_keys_nonproduction',
        'Treat current raw environment key names as local-only and not KMS evidence.',
        'ready_for_test',
      ),
      step(
        'implement_kms_adapter',
        'Keep production refused until managed key references replace raw key material.',
        'test_proven',
      ),
      step(
        'run_rotation_recovery',
        'Prove denial, rotation, old-version read, revocation, restart, and recovery.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'kms_project',
      'key_aliases',
      'key_versions',
      'secret_names',
      'rotation_policy',
      'recovery_policy',
    ],
    configurationEnvironmentNames: [],
    secretEnvironmentNames: [],
    verificationTest:
      'Managed encrypt/decrypt/sign, denial, rotation, old-version read, revocation, restart, and recovery.',
    allowedProofTiers: ['deployed_staging'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder plus security recovery owner',
    exportTermination:
      'Encrypted backup/reference inventory plus rotate, revoke, and terminate procedure.',
    nextFounderAction:
      'Select the founder-owned managed KMS/secret system; raw env keys remain non-production.',
  },
  {
    key: 'stripe',
    definitionVersion: 1,
    displayOrder: 80,
    provider: 'Stripe',
    purpose: 'Authentic test-mode payment truth and later founder-gated first-dollar activation.',
    accountOwner: 'Founder/company',
    initialStatus: 'founder_in_progress',
    adapterState: 'test_configurable',
    manualSteps: [
      step(
        'secure_stripe_account',
        'Confirm company account custody, MFA, billing/admin roles, and recovery owner.',
        'founder_in_progress',
      ),
      step(
        'create_test_resources',
        'In test mode create the Founding Household product, price, signed webhook, and cancel-only portal configuration.',
        'ready_for_test',
      ),
      step(
        'store_test_names',
        'Store test values only in the approved secret manager under the listed TEST names.',
        'ready_for_test',
      ),
      step(
        'run_test_runbook',
        'Run signed test Checkout, invoice, cancel, grace, recovery, refund, dispute, reorder, outage, and reconciliation evidence.',
        'test_proven',
      ),
      step(
        'retain_live_gate',
        'Keep all LIVE names unset until professional and explicit founder activation gates pass.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'account_id',
      'test_product_id',
      'test_price_id',
      'test_webhook_endpoint_id',
      'api_version',
      'cancel_only_portal_configuration_id',
      'tax_decision',
    ],
    configurationEnvironmentNames: stripeConfigurationNames,
    secretEnvironmentNames: stripeSecretNames,
    verificationTest:
      'Authentic signed test Checkout/invoice/cancel/grace/recovery/refund/dispute/reorder/outage/reconciliation lineage.',
    allowedProofTiers: ['provider_test', 'deployed_staging'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder plus billing/admin recovery owner',
    exportTermination:
      'Stripe exports, webhook/key rotation, Checkout/portal disable, and account closure steps.',
    nextFounderAction:
      'Create the exact test resources and load values through the secret manager only.',
  },
  {
    key: 'stripe_tax',
    definitionVersion: 1,
    displayOrder: 90,
    provider: 'Stripe Tax and qualified tax review',
    purpose: 'Test tax configuration and live registration decision.',
    accountOwner: 'Founder plus qualified adviser',
    initialStatus: 'blocked',
    adapterState: 'external_only',
    manualSteps: [
      step(
        'engage_tax_adviser',
        'Engage a qualified adviser for business location, jurisdiction, registration, and product-code decisions.',
        'founder_in_progress',
      ),
      step(
        'record_tax_decision',
        'Retain the signed decision/version outside the repository without taxpayer secrets.',
        'ready_for_test',
      ),
      step(
        'configure_test_tax',
        'Configure only the adviser-approved test settings.',
        'test_proven',
      ),
      step(
        'review_live_registration',
        'Complete the live registration and filing-owner review before live review.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'business_location_decision',
      'jurisdictions',
      'registrations',
      'product_tax_codes',
      'decision_version',
    ],
    configurationEnvironmentNames: [],
    secretEnvironmentNames: [],
    verificationTest: 'Adviser-reviewed test Checkout/tax result and documented live gate.',
    allowedProofTiers: ['professional_review', 'provider_test'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder',
    exportTermination: 'Tax configuration/export and registration/termination procedure.',
    nextFounderAction: 'Engage a qualified tax adviser; no live tax configuration is authorized.',
  },
  {
    key: 'twilio',
    definitionVersion: 1,
    displayOrder: 100,
    provider: 'Twilio',
    purpose: 'Consent-aware service SMS/voice and reconciled delivery truth.',
    accountOwner: 'Founder/company',
    initialStatus: 'founder_in_progress',
    adapterState: 'not_implemented',
    manualSteps: [
      step(
        'secure_twilio',
        'Confirm account/subaccount custody, MFA, billing ceiling, and recovery owner.',
        'founder_in_progress',
      ),
      step(
        'finish_toll_free',
        'Complete toll-free verification and record safe service/webhook identifier names.',
        'ready_for_test',
      ),
      step(
        'wait_for_twilio_adapter',
        'Do not create app credentials until the reviewed adapter defines exact names and signature policy.',
        'ready_for_test',
      ),
      step(
        'test_designated_recipient',
        'Using only a designated test recipient, prove signature, HELP/STOP, consent, quiet hours, delivery, failure, and reconciliation.',
        'test_proven',
      ),
      step(
        'review_number_exit',
        'Review message/consent export, number port/release, key rotation, and disable procedure.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'account_id',
      'subaccount_id',
      'verified_number_id',
      'messaging_service_id',
      'webhook_ids',
      'status_callback_ids',
    ],
    configurationEnvironmentNames: [],
    secretEnvironmentNames: [],
    verificationTest:
      'Designated test recipient only: signature, HELP/STOP, consent/suppression, quiet hours, and outcome reconciliation.',
    allowedProofTiers: ['provider_test', 'deployed_staging'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder plus communications recovery owner',
    exportTermination:
      'Message/consent export, number port/release, key rotation, and service disable.',
    nextFounderAction: 'Finish toll-free verification; do not paste or invent adapter credentials.',
  },
  {
    key: 'transactional_email',
    definitionVersion: 1,
    displayOrder: 110,
    provider: 'Transactional email provider',
    purpose: 'Account, support, lifecycle, and feedback email separated from marketing.',
    accountOwner: 'Founder/company',
    initialStatus: 'not_started',
    adapterState: 'not_implemented',
    manualSteps: [
      step(
        'select_email_provider',
        'Select an approved transactional provider, region, terms, and ceiling.',
        'founder_in_progress',
      ),
      step(
        'separate_streams',
        'Create transactional server/stream and verified domain separate from marketing.',
        'ready_for_test',
      ),
      step(
        'wait_for_email_adapter',
        'Do not create app credentials until the reviewed adapter defines exact token/signature names.',
        'ready_for_test',
      ),
      step(
        'test_inbox_only',
        'Using only a test inbox, prove domain/signature, bounce/suppression, inbound feedback, and reconciliation.',
        'test_proven',
      ),
      step(
        'review_email_exit',
        'Review suppression/event export, domain/key rotation, stream disable, and termination.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'provider_account_id',
      'server_id',
      'stream_id',
      'verified_domains',
      'inbound_route_id',
      'webhook_ids',
    ],
    configurationEnvironmentNames: [],
    secretEnvironmentNames: [],
    verificationTest:
      'Test inbox only: domain/signature, bounce/suppression, inbound feedback, and outcome reconciliation.',
    allowedProofTiers: ['provider_test', 'deployed_staging'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder plus email recovery owner',
    exportTermination:
      'Suppression/event export, domain/key rotation, stream disable, and termination.',
    nextFounderAction: 'Select a transactional provider and keep it separate from marketing.',
  },
  {
    key: 'feedback_mailbox',
    definitionVersion: 1,
    displayOrder: 120,
    provider: 'feedback@boomerbuddy.net',
    purpose: 'Customer feedback intake identity and bounded routing.',
    accountOwner: 'Founder/company',
    initialStatus: 'not_started',
    adapterState: 'not_implemented',
    manualSteps: [
      step(
        'create_feedback_mailbox',
        'Create the mailbox or alias and assign a recovery owner.',
        'founder_in_progress',
      ),
      step(
        'define_retention_route',
        'Define retention, inbound route, accountable owner, and deletion procedure.',
        'ready_for_test',
      ),
      step(
        'wait_for_feedback_adapter',
        'Keep inbound automation disabled until the normalized adapter is reviewed.',
        'ready_for_test',
      ),
      step(
        'test_synthetic_feedback',
        'Send synthetic feedback and prove minimization, redaction, receipt, and close-loop routing.',
        'test_proven',
      ),
      step(
        'review_mailbox_exit',
        'Review mailbox export, route disable, retention, and deletion.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'mailbox_or_alias',
      'routing_owner',
      'retention_policy',
      'inbound_route_id',
    ],
    configurationEnvironmentNames: [],
    secretEnvironmentNames: [],
    verificationTest:
      'Synthetic feedback minimization/redaction, receipt, and close-loop routing with no raw content in logs.',
    allowedProofTiers: ['provider_test', 'deployed_staging'],
    monthlyCostCeiling: 'included_in_parent_workstream',
    recoveryOwner: 'Founder plus support recovery owner',
    exportTermination: 'Mailbox export, route disable, retention, and deletion procedure.',
    nextFounderAction:
      'Create the alias/mailbox and assign its accountable routing and recovery owners.',
  },
  {
    key: 'support_mailbox',
    definitionVersion: 1,
    displayOrder: 130,
    provider: 'support@boomerbuddy.net',
    purpose: 'Customer support identity, routing, and escalation.',
    accountOwner: 'Founder/company',
    initialStatus: 'founder_in_progress',
    adapterState: 'not_implemented',
    manualSteps: [
      step(
        'confirm_support_mailbox',
        'Confirm mailbox/alias existence, custody, routing owner, backup, and recovery.',
        'founder_in_progress',
      ),
      step(
        'set_support_hours',
        'Record truthful stated hours and escalation/on-call ownership.',
        'ready_for_test',
      ),
      step(
        'wait_for_support_adapter',
        'Keep external intake disabled until the reviewed adapter is implemented.',
        'ready_for_test',
      ),
      step(
        'test_synthetic_case',
        'Route a synthetic request into one exact assigned support queue and prove audit/privacy behavior.',
        'test_proven',
      ),
      step(
        'review_support_exit',
        'Review mailbox/case export, routing failover, and termination.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: ['mailbox_or_alias', 'routing_owner', 'backup_owner', 'stated_hours'],
    configurationEnvironmentNames: [],
    secretEnvironmentNames: [],
    verificationTest:
      'Synthetic request into one exact assigned support queue with response audit and privacy behavior.',
    allowedProofTiers: ['provider_test', 'deployed_staging'],
    monthlyCostCeiling: 'included_in_parent_workstream',
    recoveryOwner: 'Founder plus support backup',
    exportTermination: 'Mailbox/case export, routing failover, and termination.',
    nextFounderAction:
      'Confirm the mailbox, routing owner, backup, and truthful stated support hours.',
  },
  {
    key: 'sentry',
    definitionVersion: 1,
    displayOrder: 140,
    provider: 'Sentry or approved error monitor',
    purpose: 'Redacted errors, release attribution, and accountable alert routing.',
    accountOwner: 'Founder/company',
    initialStatus: 'not_started',
    adapterState: 'not_implemented',
    manualSteps: [
      step(
        'create_error_monitor',
        'Create the company project, approved region, retention, sampling, and recovery owner.',
        'founder_in_progress',
      ),
      step(
        'define_scrubbing',
        'Define release/environment naming, scrub rules, and alert routing.',
        'ready_for_test',
      ),
      step(
        'wait_for_sentry_adapter',
        'Do not create app tokens until the reviewed adapter defines exact names and data policy.',
        'ready_for_test',
      ),
      step(
        'test_redacted_error',
        'Generate a synthetic redacted error and prove alert receipt plus content/secret denial.',
        'test_proven',
      ),
      step(
        'review_monitor_exit',
        'Review event/config export, scrub/retention, DSN revoke, and project termination.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'organization_id',
      'project_id',
      'region',
      'release_naming',
      'retention_policy',
      'sampling_policy',
    ],
    configurationEnvironmentNames: [],
    secretEnvironmentNames: [],
    verificationTest:
      'Synthetic redacted error, release attribution, alert receipt, secret/content denial, and outage behavior.',
    allowedProofTiers: ['provider_test', 'deployed_staging'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder plus incident backup',
    exportTermination:
      'Event/config export, scrub/retention review, credential revoke, and project termination.',
    nextFounderAction:
      'Create the company project only after region, retention, ceiling, and data policy are approved.',
  },
  {
    key: 'posthog',
    definitionVersion: 1,
    displayOrder: 150,
    provider: 'PostHog or approved analytics',
    purpose: 'Privacy-minimized funnel and feature evidence.',
    accountOwner: 'Founder/company',
    initialStatus: 'not_started',
    adapterState: 'not_implemented',
    manualSteps: [
      step(
        'create_analytics_project',
        'Create the company project with approved region, retention, and ceiling.',
        'founder_in_progress',
      ),
      step(
        'approve_event_dictionary',
        'Approve the content-free event dictionary, opt-out, deletion, and export policy.',
        'ready_for_test',
      ),
      step(
        'wait_for_analytics_adapter',
        'Do not create server credentials until the reviewed adapter defines exact names.',
        'ready_for_test',
      ),
      step(
        'test_synthetic_funnel',
        'Run a synthetic Founding Household funnel and prove no raw content or unnecessary PII.',
        'test_proven',
      ),
      step(
        'review_analytics_exit',
        'Review schema/event export, deletion, restrictions, key revoke, and termination.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'project_id',
      'host',
      'region',
      'event_dictionary_version',
      'retention_policy',
    ],
    configurationEnvironmentNames: [],
    secretEnvironmentNames: [],
    verificationTest:
      'Synthetic Founding Household funnel with no raw content/PII plus opt-out, deletion, and export.',
    allowedProofTiers: ['provider_test', 'deployed_staging'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder plus product-data recovery owner',
    exportTermination:
      'Event/schema export, deletion/restriction, credential revoke, and project termination.',
    nextFounderAction:
      'Approve region, retention, event dictionary, and ceiling before account creation.',
  },
  {
    key: 'apple_developer',
    definitionVersion: 1,
    displayOrder: 160,
    provider: 'Apple Developer and App Store Connect',
    purpose:
      'iOS signing, internal testing, and later distribution without blocking web Customer #1.',
    accountOwner: 'Founder/company',
    initialStatus: 'founder_in_progress',
    adapterState: 'provider_managed',
    manualSteps: [
      step(
        'complete_apple_entity',
        'Complete the company legal entity, account roles, MFA, and signing recovery owner.',
        'founder_in_progress',
      ),
      step(
        'record_apple_ids',
        'Record only safe team, bundle, and App Store Connect application identifiers.',
        'ready_for_test',
      ),
      step(
        'store_signing_provider_side',
        'Keep signing credentials only in approved Apple/EAS credential managers.',
        'ready_for_test',
      ),
      step(
        'run_internal_ios_build',
        'Run a permitted internal build on supported devices; do not submit it.',
        'test_proven',
      ),
      step(
        'review_ios_exit',
        'Review credential recovery where allowed, app transfer, update disable, and termination.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'legal_entity',
      'team_id',
      'bundle_id',
      'app_store_connect_app_id',
      'roles',
    ],
    configurationEnvironmentNames: [],
    secretEnvironmentNames: [],
    verificationTest:
      'Permitted internal iOS build on supported devices covering share, deep-link, media, and accessibility; no submission.',
    allowedProofTiers: ['provider_test', 'human_validation'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder plus signing recovery owner',
    exportTermination:
      'Signing credential recovery where allowed plus app transfer and termination plan.',
    nextFounderAction:
      'Complete the company account and recovery path without delaying the web-first path.',
  },
  {
    key: 'google_play',
    definitionVersion: 1,
    displayOrder: 170,
    provider: 'Google Play Console',
    purpose:
      'Android signing, internal testing, and later distribution without blocking web Customer #1.',
    accountOwner: 'Founder/company',
    initialStatus: 'founder_in_progress',
    adapterState: 'provider_managed',
    manualSteps: [
      step(
        'complete_google_entity',
        'Complete the company legal entity, account roles, MFA, and signing recovery owner.',
        'founder_in_progress',
      ),
      step(
        'record_google_ids',
        'Record only safe developer, package, and application identifiers.',
        'ready_for_test',
      ),
      step(
        'store_play_signing',
        'Keep Play/EAS signing credentials only in approved credential managers.',
        'ready_for_test',
      ),
      step(
        'run_internal_android_build',
        'Run a permitted internal build on supported devices; do not submit a production track.',
        'test_proven',
      ),
      step(
        'review_android_exit',
        'Review upload-key recovery, app transfer, update disable, and termination.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: ['legal_entity', 'developer_id', 'package_name', 'app_id', 'roles'],
    configurationEnvironmentNames: [],
    secretEnvironmentNames: [],
    verificationTest:
      'Permitted internal Android build on supported devices; no production-track submission.',
    allowedProofTiers: ['provider_test', 'human_validation'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder plus signing recovery owner',
    exportTermination: 'Upload-key recovery plus app transfer/export and termination plan.',
    nextFounderAction:
      'Complete the company account and recovery path without delaying the web-first path.',
  },
  {
    key: 'expo_eas',
    definitionVersion: 1,
    displayOrder: 180,
    provider: 'Expo and EAS',
    purpose: 'Native build/update and internal distribution tooling.',
    accountOwner: 'Founder/company',
    initialStatus: 'not_started',
    adapterState: 'provider_managed',
    manualSteps: [
      step(
        'create_expo_project',
        'Create or transfer the company Expo owner/project and assign recovery.',
        'founder_in_progress',
      ),
      step(
        'record_expo_ids',
        'Record safe owner, project, slug, bundle/package, and build-profile names.',
        'ready_for_test',
      ),
      step(
        'store_expo_credentials',
        'Keep tokens and signing credentials only in the approved provider manager.',
        'ready_for_test',
      ),
      step(
        'build_frozen_commit',
        'Produce reproducible internal iOS/Android builds tied to the frozen commit.',
        'test_proven',
      ),
      step(
        'review_expo_exit',
        'Review project transfer/export, credential recovery, update disable, and termination.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'owner',
      'project_id',
      'slug',
      'bundle_id',
      'package_name',
      'build_profiles',
    ],
    configurationEnvironmentNames: ['EXPO_PUBLIC_API_URL'],
    secretEnvironmentNames: [],
    verificationTest:
      'Reproducible internal iOS/Android builds tied to the frozen commit and device matrix.',
    allowedProofTiers: ['provider_test', 'human_validation'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder plus mobile recovery owner',
    exportTermination:
      'Project transfer/export, credential recovery, update disable, and termination.',
    nextFounderAction:
      'Provision only when the Apple/Google internal-build path is ready; web does not wait.',
  },
  {
    key: 'enrichment',
    definitionVersion: 1,
    displayOrder: 190,
    provider: 'Apollo or approved enrichment provider',
    purpose: 'B2B discovery/enrichment only after separate founder, legal, and privacy approval.',
    accountOwner: 'Founder/company',
    initialStatus: 'blocked',
    adapterState: 'not_implemented',
    manualSteps: [
      step(
        'retain_real_use_block',
        'Keep all real enrichment and outreach disabled.',
        'founder_in_progress',
      ),
      step(
        'approve_data_purpose',
        'Obtain separate founder/legal/privacy approval for purpose, sources, suppression, deletion, and opt-out.',
        'ready_for_test',
      ),
      step(
        'define_adapter_names',
        'Define exact least-privilege adapter names only after approval.',
        'ready_for_test',
      ),
      step(
        'run_bounded_provider_test',
        'Run only the separately approved bounded provider test; offline fixtures are not provider proof.',
        'test_proven',
      ),
      step(
        'review_enrichment_exit',
        'Review data/export/deletion/opt-out and provider termination before live review.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'workspace_id',
      'approved_source_ids',
      'data_purpose_policy_version',
      'suppression_policy_version',
    ],
    configurationEnvironmentNames: [],
    secretEnvironmentNames: [],
    verificationTest:
      'Separately approved bounded provider test; real outreach remains a separate gate.',
    allowedProofTiers: ['professional_review', 'provider_test'],
    monthlyCostCeiling: 'zero_until_approved',
    recoveryOwner: 'Founder',
    exportTermination:
      'Data export/deletion/opt-out and provider termination procedure before use.',
    nextFounderAction:
      'Take no provider action unless a separate founder/legal/privacy gate authorizes it.',
  },
  {
    key: 'dependency_security',
    definitionVersion: 1,
    displayOrder: 200,
    provider: 'Dependency and security scanning',
    purpose:
      'Fresh advisories, reachability, SBOM, licenses, package/image provenance, and adjudication.',
    accountOwner: 'Company CI/security owner',
    initialStatus: 'blocked',
    adapterState: 'external_only',
    manualSteps: [
      step(
        'provision_company_ci',
        'Provision a company-controlled runner/registry with MFA, recovery, and a cost ceiling.',
        'founder_in_progress',
      ),
      step(
        'configure_private_credentials',
        'Store registry/CI credentials only in the company secret manager.',
        'ready_for_test',
      ),
      step(
        'run_fresh_scans',
        'Run fresh advisory, reachability, SBOM/license, package provenance, and OCI image scans.',
        'test_proven',
      ),
      step(
        'retain_adjudication',
        'Retain the redacted adjudication mapped to commit and image digests.',
        'test_proven',
      ),
      step(
        'review_exit',
        'Review artifact retention/export and runner/credential termination.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'registry',
      'runner_id',
      'report_artifact_ids',
      'commit_digest',
      'image_digest',
    ],
    configurationEnvironmentNames: [],
    secretEnvironmentNames: [],
    verificationTest:
      'Fresh audit and adjudication, clean candidate SBOM/licenses/provenance, and image scan with zero applicable unresolved Critical/High.',
    allowedProofTiers: ['deployed_staging', 'professional_review'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder plus security backup',
    exportTermination:
      'Retained redacted adjudication/SBOM, restricted raw artifact, and tool exit.',
    nextFounderAction:
      'Authorize a company-controlled CI/security ceiling and retain credentials outside prompts/source.',
  },
  {
    key: 'backup_recovery',
    definitionVersion: 1,
    displayOrder: 210,
    provider: 'Independent backup and recovery store',
    purpose: 'Independent source, PostgreSQL, object, configuration, and evidence custody.',
    accountOwner: 'Founder/company',
    initialStatus: 'not_started',
    adapterState: 'external_only',
    manualSteps: [
      step(
        'select_independent_store',
        'Select an account and region independent of the primary hosts, with recovery ownership.',
        'founder_in_progress',
      ),
      step(
        'set_backup_policy',
        'Set schedule, retention, immutability, encryption, and destruction policy.',
        'ready_for_test',
      ),
      step(
        'store_backup_credentials',
        'Store backup credentials and KMS references only in the approved secret system.',
        'ready_for_test',
      ),
      step(
        'run_timed_restore',
        'Perform a timed source/database/object/config restore with checksums and reconciliation.',
        'test_proven',
      ),
      step(
        'review_destruction',
        'Review full export/restore plus termination and destruction-certificate procedure.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'account_id',
      'storage_id',
      'region',
      'schedule',
      'retention_policy',
      'immutable_setting',
    ],
    configurationEnvironmentNames: [],
    secretEnvironmentNames: [],
    verificationTest:
      'Timed restore into independent systems with checksums and row/projection reconciliation.',
    allowedProofTiers: ['deployed_staging'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder plus independent recovery owner',
    exportTermination:
      'Full export/restore plus provider termination and destruction-certificate process.',
    nextFounderAction:
      'Choose a recovery store independent of the primary hosting/database accounts.',
  },
  {
    key: 'accounting',
    definitionVersion: 1,
    displayOrder: 220,
    provider: 'Accounting and bookkeeping system',
    purpose: 'External financial system of record for credits, refunds, tax evidence, and close.',
    accountOwner: 'Founder/company and accountant',
    initialStatus: 'blocked',
    adapterState: 'external_only',
    manualSteps: [
      step(
        'select_accountant_system',
        'Select the external accountant/system, owner, backup, ceiling, and close cadence.',
        'founder_in_progress',
      ),
      step(
        'define_chart_policy',
        'Approve chart, refund/credit, retention, and reconciliation policy.',
        'ready_for_test',
      ),
      step(
        'test_exports',
        'Have the accountant review synthetic/test commerce exports and reconciliation.',
        'test_proven',
      ),
      step(
        'review_financial_exit',
        'Review provider export, retention, access recovery, and termination.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'provider_account_id',
      'chart_policy_version',
      'accountant_owner',
      'close_cadence',
    ],
    configurationEnvironmentNames: [],
    secretEnvironmentNames: [],
    verificationTest:
      'Accountant-reviewed test exports and reconciliation; HQ remains subordinate.',
    allowedProofTiers: ['professional_review'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder plus accountant recovery owner',
    exportTermination: 'Provider export, retention, access recovery, and termination.',
    nextFounderAction: 'Select the external accountant/system; do not rebuild it in HQ.',
  },
  {
    key: 'legal_professional',
    definitionVersion: 1,
    displayOrder: 230,
    provider: 'Legal, privacy, tax, communications, and security reviewers',
    purpose:
      'Qualified decisions for terms, privacy, beta, communications, media, tax, and claims.',
    accountOwner: 'Founder plus qualified reviewers',
    initialStatus: 'blocked',
    adapterState: 'external_only',
    manualSteps: [
      step(
        'engage_reviewers',
        'Engage qualified reviewers with defined scope, jurisdiction, owner, and ceiling.',
        'founder_in_progress',
      ),
      step(
        'prepare_versioned_packet',
        'Prepare the versioned product, policy, claims, consent, media, communications, and tax review packet.',
        'ready_for_test',
      ),
      step(
        'retain_signed_decisions',
        'Retain signed decisions mapped to product/version/jurisdiction outside the repository.',
        'test_proven',
      ),
      step(
        'map_conditions',
        'Map every condition, expiry, and supersession requirement into the activation checklist.',
        'ready_for_live_review',
      ),
    ],
    requiredIdentifierNames: [
      'reviewer_or_engagement_ids',
      'decision_version',
      'effective_date',
      'jurisdictions',
    ],
    configurationEnvironmentNames: [],
    secretEnvironmentNames: [],
    verificationTest:
      'Signed retained professional decisions mapped to product, policy version, jurisdiction, conditions, and expiry.',
    allowedProofTiers: ['professional_review'],
    monthlyCostCeiling: 'founder_decision_required',
    recoveryOwner: 'Founder',
    exportTermination:
      'Controlled decision/evidence archive with retention and supersession history.',
    nextFounderAction: 'Engage qualified reviewers; agent output cannot satisfy this workstream.',
  },
] as const;

export interface FounderProvisioningTransitionEvidence {
  readonly tier: FounderProvisioningEvidenceTier;
  readonly kind: FounderProvisioningEvidenceKind;
  readonly result: FounderProvisioningEvidenceResult;
  readonly blockerCode?: FounderProvisioningBlockerCode;
  readonly manifestDigest?: string;
}

export const founderProvisioningEvidenceClockSkewMs = 5 * 60 * 1_000;
export const founderProvisioningProofFreshnessMs = 24 * 60 * 60 * 1_000;

export function assertFounderProvisioningEvidenceChronology(input: {
  readonly currentStatusOccurredAt: Date;
  readonly evidenceObservedAt: Date;
  readonly recordedAt: Date;
  readonly toStatus: FounderProvisioningStatus;
}): void {
  const currentStatusOccurredAt = input.currentStatusOccurredAt.getTime();
  const evidenceObservedAt = input.evidenceObservedAt.getTime();
  const recordedAt = input.recordedAt.getTime();
  if (
    [currentStatusOccurredAt, evidenceObservedAt, recordedAt].some((value) => Number.isNaN(value))
  ) {
    throw new TypeError('Provisioning evidence chronology requires valid timestamps');
  }
  if (currentStatusOccurredAt > recordedAt) {
    throw new TypeError('Provisioning status chronology is later than database recording time');
  }
  if (evidenceObservedAt > recordedAt + founderProvisioningEvidenceClockSkewMs) {
    throw new TypeError('Provisioning evidence cannot be future-dated');
  }
  if (
    (input.toStatus === 'test_proven' || input.toStatus === 'ready_for_live_review') &&
    evidenceObservedAt < recordedAt - founderProvisioningProofFreshnessMs
  ) {
    throw new TypeError('Provisioning external proof is older than the 24-hour freshness bound');
  }
  if (evidenceObservedAt < currentStatusOccurredAt) {
    throw new TypeError('Provisioning evidence predates the current status gate');
  }
}

const upwardOrder: readonly Exclude<FounderProvisioningStatus, 'blocked'>[] = [
  'not_started',
  'founder_in_progress',
  'ready_for_test',
  'test_proven',
  'ready_for_live_review',
];

const invalidationKinds: readonly FounderProvisioningEvidenceKind[] = [
  'configuration_revoked',
  'evidence_invalidated',
  'provider_unavailable',
  'account_removed',
];

function requireEvidence(
  evidence: FounderProvisioningTransitionEvidence,
  expectedKind: FounderProvisioningEvidenceKind,
  expectedResults: readonly FounderProvisioningEvidenceResult[],
): void {
  if (evidence.kind !== expectedKind || !expectedResults.includes(evidence.result)) {
    throw new TypeError(`Provisioning transition requires ${expectedKind} evidence`);
  }
}

function requireManifest(evidence: FounderProvisioningTransitionEvidence): void {
  if (evidence.manifestDigest === undefined) {
    throw new TypeError('Provisioning transition requires a retained manifest digest');
  }
}

export function assertFounderProvisioningTransition(input: {
  readonly workstream: FounderProvisioningCatalogueEntry;
  readonly from: FounderProvisioningStatus;
  readonly to: FounderProvisioningStatus;
  readonly evidence: FounderProvisioningTransitionEvidence;
}): void {
  const { evidence, from, to, workstream } = input;
  if (from === to) throw new TypeError('Provisioning status transitions cannot be no-ops');

  if (to === 'blocked') {
    if (
      !['blocker_recorded', 'verification_failed', 'provider_unavailable'].includes(
        evidence.kind,
      ) ||
      !['blocked', 'failed'].includes(evidence.result) ||
      evidence.blockerCode === undefined
    ) {
      throw new TypeError('Blocked provisioning status requires structured blocker evidence');
    }
    return;
  }

  if (from === 'blocked') {
    if (to === 'not_started') {
      requireEvidence(evidence, 'account_removed', ['reported', 'invalidated']);
      return;
    }
    if (to !== 'founder_in_progress') {
      throw new TypeError('A blocked provisioning workstream must return through founder progress');
    }
    requireEvidence(evidence, 'blocker_cleared', ['reported', 'passed']);
    return;
  }

  const fromIndex = upwardOrder.indexOf(from);
  const toIndex = upwardOrder.indexOf(to);
  if (fromIndex < 0 || toIndex < 0) throw new TypeError('Unsupported provisioning status');

  if (toIndex < fromIndex) {
    if (
      !invalidationKinds.includes(evidence.kind) ||
      !['failed', 'invalidated', 'reported'].includes(evidence.result)
    ) {
      throw new TypeError('Provisioning status downgrade requires invalidation evidence');
    }
    return;
  }
  if (toIndex !== fromIndex + 1) {
    throw new TypeError('Provisioning status cannot skip an evidence gate');
  }

  if (to === 'founder_in_progress') {
    requireEvidence(evidence, 'setup_started', ['reported']);
    return;
  }
  if (to === 'ready_for_test') {
    requireEvidence(evidence, 'configuration_ready', ['passed']);
    requireManifest(evidence);
    return;
  }
  if (to === 'test_proven') {
    requireEvidence(evidence, 'verification_passed', ['passed']);
    requireManifest(evidence);
    if (
      ['repository_review', 'founder_report', 'local_simulation', 'live_production'].includes(
        evidence.tier,
      ) ||
      !workstream.allowedProofTiers.includes(evidence.tier)
    ) {
      throw new TypeError('Provisioning test proof requires an allowed external evidence tier');
    }
    return;
  }
  if (to === 'ready_for_live_review') {
    requireEvidence(evidence, 'live_review_packet_complete', ['passed']);
    requireManifest(evidence);
    if (!['deployed_staging', 'human_validation', 'professional_review'].includes(evidence.tier)) {
      throw new TypeError('Live review requires deployed, human, or professional packet evidence');
    }
  }
}

export function founderProvisioningEntry(
  key: FounderProvisioningWorkstreamKey,
): FounderProvisioningCatalogueEntry {
  const entry = founderProvisioningCatalogue.find((candidate) => candidate.key === key);
  if (entry === undefined) throw new TypeError(`Unknown founder provisioning workstream: ${key}`);
  return entry;
}
