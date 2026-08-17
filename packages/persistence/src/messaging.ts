import { createHash } from 'node:crypto';

import { DomainError } from '@boomerbuddy/domain';
import {
  decryptField,
  encryptField,
  fingerprintMinimized,
  parseEncryptedField,
  redactSensitiveInput,
  serializeEncryptedField,
} from '@boomerbuddy/security';

import {
  evaluateLocalMessagingEligibility,
  messagingFrequencyPolicyVersion,
  messagingPurposes,
  messagingTemplates,
  type MessagingEligibilityDenial,
  type MessagingPurpose,
  type MessagingTemplateKey,
} from '../../domain/src/messaging';
import type { Database, SqlExecutor } from './database';
import { asDate, randomIdFactory, type IdFactory } from './values';

export interface MessagingProtection {
  readonly encryptionKey: Uint8Array;
  readonly encryptionKeyVersion: number;
  readonly fingerprintKey: Uint8Array;
  readonly fingerprintKeyVersion: number;
}

export interface LocalMessagingDestination {
  readonly id: string;
  readonly personId: string;
  readonly timeZone?: string;
  readonly locale: string;
  readonly jurisdiction: 'US';
  readonly evidenceTier: 'local_simulation';
  readonly createdAt: Date;
}

export interface LocalMessagingConsentDocuments {
  readonly disclosureVersion: 'sms-purpose-local-v1';
  readonly disclosureDigest: string;
  readonly policyVersion: 'messaging-local-consent-v1';
  readonly policyDigest: string;
}

const localDisclosure =
  'I choose whether BoomerBuddy may use the selected SMS purpose for my current local fixture destination. Each purpose is separate. I can withdraw at any time, including after household access changes. This local simulation sends no message.';
const localPolicy =
  'BoomerBuddy Run 3 local messaging is recipient-originated, purpose-limited, append-only, quiet-hour and frequency bounded, provider-free, and never evidence of Twilio or production delivery.';

export const localMessagingConsentDocuments: LocalMessagingConsentDocuments = {
  disclosureVersion: 'sms-purpose-local-v1',
  disclosureDigest: createHash('sha256').update(localDisclosure).digest('hex'),
  policyVersion: 'messaging-local-consent-v1',
  policyDigest: createHash('sha256').update(localPolicy).digest('hex'),
};

export type LocalMessagingIntentState = 'queued' | 'local_simulated' | 'governance_blocked';

export type LocalMessagingBlockedReason =
  | MessagingEligibilityDenial
  | 'recipient_unavailable'
  | 'destination_unavailable'
  | 'consent_unavailable'
  | 'suppressed'
  | 'scope_unavailable';

export interface LocalMessagingDispatchResult {
  readonly intentId: string;
  readonly state: LocalMessagingIntentState;
  readonly blockedReason?: LocalMessagingBlockedReason;
  readonly evidenceTier: 'local_simulation';
  readonly providerNetworkPermitted: false;
}

export interface LocalInboundMessagingResult {
  readonly eventKey: string;
  readonly duplicate: boolean;
  readonly effect:
    | 'suppressed'
    | 'already_suppressed'
    | 'restart_recorded'
    | 'help_observed_no_reply'
    | 'support_case_linked'
    | 'support_content_discarded';
  readonly evidenceTier: 'local_simulation';
}

export interface LocalMessagingStatus {
  readonly destinationId: string;
  readonly channel: 'sms';
  readonly evidenceTier: 'local_simulation';
  readonly timeZoneKnown: boolean;
  readonly consents: readonly {
    readonly purpose: MessagingPurpose;
    readonly state: 'not_granted' | 'active' | 'withdrawn';
    readonly suppressed: boolean;
  }[];
}

export interface LocalMessagingIntentStatus extends LocalMessagingDispatchResult {
  readonly purpose: MessagingPurpose;
  readonly templateKey: MessagingTemplateKey;
  readonly scheduledAt: Date;
  readonly deliveryEvidenceRecorded: boolean;
}

export interface LocalMessagingSupportMetadata {
  readonly eventKey: string;
  readonly householdId: string;
  readonly supportCaseId: string;
  readonly contentState: 'encrypted_minimized' | 'discarded_unsafe' | 'payload_erased';
  readonly effect: 'support_case_linked' | 'support_content_discarded';
  readonly observedAt: Date;
  readonly retentionDeadline?: Date;
  readonly evidenceTier: 'local_simulation';
}

export type MessagingAuthorityClock = (executor: SqlExecutor, observedAt: Date) => Promise<Date>;

const defaultAuthorityClock: MessagingAuthorityClock = async (executor) => {
  const result = await executor.query<{ authority_now: unknown } & Record<string, unknown>>(
    'SELECT clock_timestamp() AS authority_now',
  );
  return asDate(result.rows[0]?.authority_now, 'messaging authority time');
};

const stableId = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,199}$/u;
const localDestination = /^\+120255501\d{2}$/u;
const localePattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/u;

interface DestinationRow extends Record<string, unknown> {
  readonly id: string;
  readonly person_id: string;
  readonly encrypted_destination: string;
  readonly encryption_key_version: number;
  readonly time_zone: string | null;
  readonly locale: string;
  readonly jurisdiction: 'US';
  readonly created_at: unknown;
  readonly latest_action: 'register' | 'retire';
}

interface ConsentChainRow extends Record<string, unknown> {
  readonly current_evidence_id: string | null;
  readonly revision: number;
  readonly action: 'grant' | 'withdraw' | null;
}

interface SuppressionChainRow extends Record<string, unknown> {
  readonly current_evidence_id: string | null;
  readonly revision: number;
  readonly action: 'suppress' | 'restart_request' | 'reactivate' | null;
}

interface IntentRow extends Record<string, unknown> {
  readonly id: string;
  readonly household_id: string;
  readonly recipient_person_id: string;
  readonly destination_id: string;
  readonly purpose: MessagingPurpose;
  readonly template_key: MessagingTemplateKey;
  readonly scope_kind: 'household' | 'support_case';
  readonly scope_id: string;
  readonly state: LocalMessagingIntentState;
  readonly blocked_reason: LocalMessagingBlockedReason | null;
  readonly scheduled_at: unknown;
}

interface InboundRow extends Record<string, unknown> {
  readonly event_key: string;
  readonly destination_id: string;
  readonly person_id: string;
  readonly classification: 'stop' | 'start' | 'help' | 'support';
  readonly household_id: string | null;
  readonly support_case_id: string | null;
  readonly content_state: 'none' | 'encrypted_minimized' | 'discarded_unsafe';
  readonly effect: LocalInboundMessagingResult['effect'];
  readonly content_fingerprint: string | null;
}

interface FrequencyRow extends Record<string, unknown> {
  readonly purpose: MessagingPurpose | 'all';
  readonly period_kind: 'daily' | 'weekly';
  readonly window_key: string;
  readonly committed_count: number;
}

function assertProtection(protection: MessagingProtection): void {
  if (protection.encryptionKey.byteLength !== 32 || protection.fingerprintKey.byteLength < 32) {
    throw new TypeError('Messaging encryption and fingerprint keys are invalid');
  }
  if (
    !Number.isSafeInteger(protection.encryptionKeyVersion) ||
    protection.encryptionKeyVersion < 1 ||
    !Number.isSafeInteger(protection.fingerprintKeyVersion) ||
    protection.fingerprintKeyVersion < 1
  ) {
    throw new TypeError('Messaging key versions are invalid');
  }
}

function assertFiniteDate(value: Date, label: string): void {
  if (!Number.isFinite(value.getTime()))
    throw new DomainError('invalid_input', `${label} is invalid`);
}

function assertStableId(value: string, label: string): void {
  if (!stableId.test(value)) throw new DomainError('invalid_input', `${label} is invalid`);
}

function assertTimeZone(value: string | undefined): void {
  if (value === undefined) return;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
  } catch {
    throw new DomainError('invalid_input', 'Messaging timezone is invalid');
  }
}

function purposeIndex(purpose: MessagingPurpose): number {
  return messagingPurposes.indexOf(purpose);
}

async function activeDestination(
  executor: SqlExecutor,
  destinationId: string,
  personId: string,
  lock = false,
): Promise<DestinationRow | undefined> {
  const result = await executor.query<DestinationRow>(
    `SELECT destination.id, destination.person_id, destination.encrypted_destination,
            destination.encryption_key_version, destination.time_zone,
            destination.locale, destination.jurisdiction, destination.created_at,
            latest.action AS latest_action
     FROM messaging_destinations destination
     JOIN LATERAL (
       SELECT event.action FROM messaging_destination_events event
       WHERE event.destination_id = destination.id
       ORDER BY event.sequence DESC LIMIT 1
     ) latest ON true
     WHERE destination.id = $1 AND destination.person_id = $2
       AND latest.action = 'register'
     ${lock ? 'FOR UPDATE OF destination' : ''}`,
    [destinationId, personId],
  );
  return result.rows[0];
}

async function lockConsentChain(
  executor: SqlExecutor,
  personId: string,
  destinationId: string,
  purpose: MessagingPurpose,
): Promise<ConsentChainRow> {
  const result = await executor.query<ConsentChainRow>(
    `SELECT chain.current_evidence_id, chain.revision, evidence.action
     FROM messaging_consent_chains chain
     LEFT JOIN messaging_consent_evidence evidence ON evidence.id = chain.current_evidence_id
     WHERE chain.person_id = $1 AND chain.destination_id = $2 AND chain.purpose = $3
     FOR UPDATE OF chain`,
    [personId, destinationId, purpose],
  );
  const row = result.rows[0];
  if (row === undefined)
    throw new DomainError('not_found', 'Messaging consent scope is unavailable');
  return row;
}

async function lockSuppressionChain(
  executor: SqlExecutor,
  personId: string,
  purpose: MessagingPurpose,
): Promise<SuppressionChainRow> {
  const result = await executor.query<SuppressionChainRow>(
    `SELECT chain.current_evidence_id, chain.revision, evidence.action
     FROM messaging_suppression_chains chain
     LEFT JOIN messaging_suppression_evidence evidence ON evidence.id = chain.current_evidence_id
     WHERE chain.person_id = $1 AND chain.purpose = $2
     FOR UPDATE OF chain`,
    [personId, purpose],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new DomainError('not_found', 'Messaging suppression scope is unavailable');
  }
  return row;
}

function stateResult(row: IntentRow): LocalMessagingDispatchResult {
  return {
    intentId: row.id,
    state: row.state,
    ...(row.blocked_reason === null ? {} : { blockedReason: row.blocked_reason }),
    evidenceTier: 'local_simulation',
    providerNetworkPermitted: false,
  };
}

export class MessagingRepository {
  constructor(
    private readonly database: Database,
    private readonly protection: MessagingProtection,
    private readonly ids: IdFactory = randomIdFactory,
    private readonly runtimeEnvironment: 'local' | 'production' = 'production',
    private readonly authorityClock: MessagingAuthorityClock = defaultAuthorityClock,
  ) {
    assertProtection(protection);
  }

  private assertLocal(): void {
    if (this.runtimeEnvironment !== 'local') {
      throw new DomainError('not_authorized', 'Messaging local simulation is unavailable');
    }
  }

  private async authorityNow(executor: SqlExecutor, observedAt: Date): Promise<Date> {
    assertFiniteDate(observedAt, 'Messaging observation time');
    const authorityNow = await this.authorityClock(executor, observedAt);
    assertFiniteDate(authorityNow, 'Messaging authority time');
    return authorityNow;
  }

  private async advanceConsent(
    executor: SqlExecutor,
    input: {
      readonly action: 'grant' | 'withdraw';
      readonly destinationId: string;
      readonly now: Date;
      readonly personId: string;
      readonly purpose: MessagingPurpose;
      readonly sourceSurface: 'member_web' | 'mobile_app' | 'local_fixture';
    },
  ): Promise<{ readonly evidenceId: string; readonly changed: boolean }> {
    const chain = await lockConsentChain(
      executor,
      input.personId,
      input.destinationId,
      input.purpose,
    );
    if (chain.action === input.action) {
      return { evidenceId: chain.current_evidence_id!, changed: false };
    }
    const evidenceId = this.ids.next('messaging-consent');
    await executor.query(
      `INSERT INTO messaging_consent_evidence(
         id, person_id, destination_id, purpose, actor_person_id, channel, action,
         disclosure_version, disclosure_digest, policy_version, policy_digest,
         source_surface, evidence_tier, effective_at, recorded_at, supersedes_evidence_id
       ) VALUES ($1,$2,$3,$4,$2,'sms',$5,$6,$7,$8,$9,$10,'local_simulation',$11,$11,$12)`,
      [
        evidenceId,
        input.personId,
        input.destinationId,
        input.purpose,
        input.action,
        localMessagingConsentDocuments.disclosureVersion,
        localMessagingConsentDocuments.disclosureDigest,
        localMessagingConsentDocuments.policyVersion,
        localMessagingConsentDocuments.policyDigest,
        input.sourceSurface,
        input.now.toISOString(),
        chain.current_evidence_id,
      ],
    );
    await executor.query(
      `UPDATE messaging_consent_chains
       SET current_evidence_id = $4, revision = revision + 1, updated_at = $5
       WHERE person_id = $1 AND destination_id = $2 AND purpose = $3`,
      [input.personId, input.destinationId, input.purpose, evidenceId, input.now.toISOString()],
    );
    return { evidenceId, changed: true };
  }

  private async advanceSuppression(
    executor: SqlExecutor,
    input: {
      readonly action: 'suppress' | 'restart_request' | 'reactivate';
      readonly now: Date;
      readonly personId: string;
      readonly purpose: MessagingPurpose;
      readonly source:
        'recipient_stop' | 'recipient_start' | 'recipient_settings' | 'consent_withdrawal';
    },
  ): Promise<boolean> {
    const chain = await lockSuppressionChain(executor, input.personId, input.purpose);
    if (chain.action === input.action) return false;
    const evidenceId = this.ids.next('messaging-suppression');
    await executor.query(
      `INSERT INTO messaging_suppression_evidence(
         id, person_id, purpose, actor_person_id, action, source, evidence_tier,
         effective_at, recorded_at, supersedes_evidence_id
       ) VALUES ($1,$2,$3,$2,$4,$5,'local_simulation',$6,$6,$7)`,
      [
        evidenceId,
        input.personId,
        input.purpose,
        input.action,
        input.source,
        input.now.toISOString(),
        chain.current_evidence_id,
      ],
    );
    await executor.query(
      `UPDATE messaging_suppression_chains
       SET current_evidence_id = $3, revision = revision + 1, updated_at = $4
       WHERE person_id = $1 AND purpose = $2`,
      [input.personId, input.purpose, evidenceId, input.now.toISOString()],
    );
    return true;
  }

  async registerLocalDestination(input: {
    readonly actorPersonId: string;
    readonly destination: string;
    readonly jurisdiction: 'US';
    readonly locale: string;
    readonly now: Date;
    readonly personId: string;
    readonly timeZone?: string;
  }): Promise<LocalMessagingDestination> {
    this.assertLocal();
    if (
      input.actorPersonId !== input.personId ||
      !localDestination.test(input.destination) ||
      !localePattern.test(input.locale) ||
      input.jurisdiction !== 'US'
    ) {
      throw new DomainError('invalid_input', 'Messaging destination evidence is invalid');
    }
    assertTimeZone(input.timeZone);
    const destinationId = this.ids.next('messaging-destination');
    const fingerprint = fingerprintMinimized(input.destination, this.protection.fingerprintKey, {
      tenantId: input.personId,
      purpose: 'messaging-sms-destination',
      keyVersion: this.protection.fingerprintKeyVersion,
    });
    const encrypted = encryptField(input.destination, this.protection.encryptionKey, {
      tenantId: input.personId,
      resourceId: destinationId,
      field: 'sms_destination',
      schemaVersion: 1,
      keyVersion: this.protection.encryptionKeyVersion,
    });
    return this.database.transaction(async (transaction) => {
      const now = await this.authorityNow(transaction, input.now);
      const person = await transaction.query('SELECT 1 FROM persons WHERE id = $1 FOR UPDATE', [
        input.personId,
      ]);
      if (person.rowCount !== 1)
        throw new DomainError('not_found', 'Messaging person is unavailable');
      const duplicate = await transaction.query(
        'SELECT 1 FROM messaging_destinations WHERE destination_fingerprint = $1',
        [fingerprint.value],
      );
      if (duplicate.rowCount > 0) {
        throw new DomainError('conflict', 'Messaging destination evidence already exists');
      }
      const active = await transaction.query<{ id: string } & Record<string, unknown>>(
        `SELECT destination.id FROM messaging_destinations destination
         JOIN LATERAL (
           SELECT event.action FROM messaging_destination_events event
           WHERE event.destination_id = destination.id
           ORDER BY event.sequence DESC LIMIT 1
         ) latest ON true
         WHERE destination.person_id = $1 AND latest.action = 'register'
         ORDER BY destination.id FOR UPDATE OF destination`,
        [input.personId],
      );
      for (const prior of active.rows) {
        await transaction.query(
          `INSERT INTO messaging_destination_events(
             id, destination_id, person_id, actor_person_id, action, evidence_tier, occurred_at
           ) VALUES ($1,$2,$3,$3,'retire','local_simulation',$4)`,
          [
            this.ids.next('messaging-destination-event'),
            prior.id,
            input.personId,
            now.toISOString(),
          ],
        );
        for (const purpose of messagingPurposes) {
          const chain = await lockConsentChain(transaction, input.personId, prior.id, purpose);
          if (chain.action === 'grant') {
            await this.advanceConsent(transaction, {
              action: 'withdraw',
              destinationId: prior.id,
              now,
              personId: input.personId,
              purpose,
              sourceSurface: 'local_fixture',
            });
          }
        }
      }
      await transaction.query(
        `INSERT INTO messaging_destinations(
           id, person_id, actor_person_id, channel, encrypted_destination,
           destination_fingerprint, encryption_key_version, fingerprint_key_version,
           time_zone, locale, jurisdiction, verification_state, evidence_tier, created_at
         ) VALUES ($1,$2,$2,'sms',$3,$4,$5,$6,$7,$8,'US','local_fixture','local_simulation',$9)`,
        [
          destinationId,
          input.personId,
          serializeEncryptedField(encrypted),
          fingerprint.value,
          this.protection.encryptionKeyVersion,
          this.protection.fingerprintKeyVersion,
          input.timeZone ?? null,
          input.locale,
          now.toISOString(),
        ],
      );
      await transaction.query(
        `INSERT INTO messaging_destination_events(
           id, destination_id, person_id, actor_person_id, action, evidence_tier, occurred_at
         ) VALUES ($1,$2,$3,$3,'register','local_simulation',$4)`,
        [
          this.ids.next('messaging-destination-event'),
          destinationId,
          input.personId,
          now.toISOString(),
        ],
      );
      for (const purpose of messagingPurposes) {
        await transaction.query(
          `INSERT INTO messaging_consent_chains(
             person_id, destination_id, purpose, current_evidence_id, revision, updated_at
           ) VALUES ($1,$2,$3,NULL,0,$4)`,
          [input.personId, destinationId, purpose, now.toISOString()],
        );
        await transaction.query(
          `INSERT INTO messaging_suppression_chains(
             person_id, purpose, current_evidence_id, revision, updated_at
           ) VALUES ($1,$2,NULL,0,$3)
           ON CONFLICT (person_id, purpose) DO NOTHING`,
          [input.personId, purpose, now.toISOString()],
        );
      }
      return {
        id: destinationId,
        personId: input.personId,
        ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
        locale: input.locale,
        jurisdiction: 'US',
        evidenceTier: 'local_simulation',
        createdAt: now,
      };
    });
  }

  async grantConsent(input: {
    readonly actorPersonId: string;
    readonly destinationId: string;
    readonly now: Date;
    readonly personId: string;
    readonly purpose: MessagingPurpose;
    readonly sourceSurface: 'member_web' | 'mobile_app' | 'local_fixture';
  }): Promise<string> {
    this.assertLocal();
    if (input.actorPersonId !== input.personId || purposeIndex(input.purpose) < 0) {
      throw new DomainError('not_authorized', 'Messaging consent belongs to its recipient');
    }
    return this.database.transaction(async (transaction) => {
      const now = await this.authorityNow(transaction, input.now);
      if (
        (await activeDestination(transaction, input.destinationId, input.personId, true)) ===
        undefined
      ) {
        throw new DomainError('conflict', 'Messaging destination is not current');
      }
      const consent = await this.advanceConsent(transaction, {
        action: 'grant',
        destinationId: input.destinationId,
        now,
        personId: input.personId,
        purpose: input.purpose,
        sourceSurface: input.sourceSurface,
      });
      const suppression = await lockSuppressionChain(transaction, input.personId, input.purpose);
      if (suppression.action === 'restart_request') {
        await this.advanceSuppression(transaction, {
          action: 'reactivate',
          now,
          personId: input.personId,
          purpose: input.purpose,
          source: 'recipient_settings',
        });
      }
      return consent.evidenceId;
    });
  }

  async withdrawConsent(input: {
    readonly actorPersonId: string;
    readonly destinationId: string;
    readonly now: Date;
    readonly personId: string;
    readonly purpose: MessagingPurpose;
    readonly sourceSurface: 'member_web' | 'mobile_app' | 'local_fixture';
  }): Promise<string> {
    this.assertLocal();
    if (input.actorPersonId !== input.personId || purposeIndex(input.purpose) < 0) {
      throw new DomainError('not_authorized', 'Messaging withdrawal belongs to its recipient');
    }
    return this.database.transaction(async (transaction) => {
      const now = await this.authorityNow(transaction, input.now);
      const destination = await transaction.query(
        `SELECT 1 FROM messaging_destinations
         WHERE id = $1 AND person_id = $2 FOR UPDATE`,
        [input.destinationId, input.personId],
      );
      if (destination.rowCount !== 1) {
        throw new DomainError('not_found', 'Messaging destination is unavailable');
      }
      const consent = await this.advanceConsent(transaction, {
        action: 'withdraw',
        destinationId: input.destinationId,
        now,
        personId: input.personId,
        purpose: input.purpose,
        sourceSurface: input.sourceSurface,
      });
      const suppression = await lockSuppressionChain(transaction, input.personId, input.purpose);
      if (suppression.action !== 'suppress') {
        await this.advanceSuppression(transaction, {
          action: 'suppress',
          now,
          personId: input.personId,
          purpose: input.purpose,
          source: 'consent_withdrawal',
        });
      }
      return consent.evidenceId;
    });
  }

  async status(input: {
    readonly personId: string;
    readonly destinationId: string;
  }): Promise<LocalMessagingStatus> {
    this.assertLocal();
    const destination = await activeDestination(this.database, input.destinationId, input.personId);
    if (destination === undefined)
      throw new DomainError('not_found', 'Messaging status is unavailable');
    const consents = await Promise.all(
      messagingPurposes.map(async (purpose) => {
        const consent = await this.database.query<
          { action: 'grant' | 'withdraw' | null } & Record<string, unknown>
        >(
          `SELECT evidence.action FROM messaging_consent_chains chain
           LEFT JOIN messaging_consent_evidence evidence ON evidence.id = chain.current_evidence_id
           WHERE chain.person_id = $1 AND chain.destination_id = $2 AND chain.purpose = $3`,
          [input.personId, input.destinationId, purpose],
        );
        const suppression = await this.database.query<
          {
            action: 'suppress' | 'restart_request' | 'reactivate' | null;
          } & Record<string, unknown>
        >(
          `SELECT evidence.action FROM messaging_suppression_chains chain
           LEFT JOIN messaging_suppression_evidence evidence ON evidence.id = chain.current_evidence_id
           WHERE chain.person_id = $1 AND chain.purpose = $2`,
          [input.personId, purpose],
        );
        const action = consent.rows[0]?.action ?? null;
        const suppressionAction = suppression.rows[0]?.action ?? null;
        return {
          purpose,
          state:
            action === null
              ? ('not_granted' as const)
              : action === 'grant'
                ? ('active' as const)
                : ('withdrawn' as const),
          suppressed: suppressionAction === 'suppress' || suppressionAction === 'restart_request',
        };
      }),
    );
    return {
      destinationId: destination.id,
      channel: 'sms',
      evidenceTier: 'local_simulation',
      timeZoneKnown: destination.time_zone !== null,
      consents,
    };
  }

  async createIntent(input: {
    readonly destinationId: string;
    readonly householdId: string;
    readonly intentId?: string;
    readonly now: Date;
    readonly purpose: MessagingPurpose;
    readonly recipientPersonId: string;
    readonly scheduledAt: Date;
    readonly scope: { readonly kind: 'household' | 'support_case'; readonly id: string };
    readonly templateKey: MessagingTemplateKey;
  }): Promise<string> {
    this.assertLocal();
    assertFiniteDate(input.scheduledAt, 'Messaging schedule');
    const intentId = input.intentId ?? this.ids.next('messaging-intent');
    assertStableId(intentId, 'Messaging intent ID');
    const template = messagingTemplates[input.templateKey];
    if (template.purpose !== input.purpose) {
      throw new DomainError('invalid_input', 'Messaging template purpose is invalid');
    }
    if (
      (input.purpose === 'customer_care' && input.scope.kind !== 'support_case') ||
      (input.purpose !== 'customer_care' && input.scope.kind !== 'household') ||
      (input.scope.kind === 'household' && input.scope.id !== input.householdId)
    ) {
      throw new DomainError('invalid_input', 'Messaging scope is invalid');
    }
    return this.database.transaction(async (transaction) => {
      const now = await this.authorityNow(transaction, input.now);
      const destination = await transaction.query(
        `SELECT 1 FROM messaging_destinations
         WHERE id = $1 AND person_id = $2 FOR UPDATE`,
        [input.destinationId, input.recipientPersonId],
      );
      if (destination.rowCount !== 1) {
        throw new DomainError('not_found', 'Messaging destination is unavailable');
      }
      if (input.scope.kind === 'support_case') {
        const supportCase = await transaction.query(
          `SELECT 1 FROM support_cases support_case
           WHERE support_case.household_id = $1 AND support_case.id = $2
             AND support_case.opened_by_person_id = $3 AND support_case.status = 'open'`,
          [input.householdId, input.scope.id, input.recipientPersonId],
        );
        if (supportCase.rowCount !== 1) {
          throw new DomainError('conflict', 'Messaging support scope is unavailable');
        }
      }
      await transaction.query(
        `INSERT INTO messaging_intents(
           id, household_id, recipient_person_id, destination_id, purpose, channel,
           template_key, template_version, template_digest, urgency, scope_kind, scope_id,
           state, blocked_reason, evidence_tier, transport_kind, provider_network_permitted,
           external_action_operation_id, scheduled_at, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,'sms',$6,1,$7,'non_urgent',$8,$9,
           'queued',NULL,'local_simulation','none',false,NULL,$10,$11,$11
         )
         ON CONFLICT (id) DO NOTHING`,
        [
          intentId,
          input.householdId,
          input.recipientPersonId,
          input.destinationId,
          input.purpose,
          template.key,
          template.digest,
          input.scope.kind,
          input.scope.id,
          input.scheduledAt.toISOString(),
          now.toISOString(),
        ],
      );
      const existing = await transaction.query<IntentRow>(
        `SELECT id, household_id, recipient_person_id, destination_id, purpose,
                template_key, scope_kind, scope_id, state, blocked_reason, scheduled_at
         FROM messaging_intents WHERE id = $1`,
        [intentId],
      );
      const row = existing.rows[0];
      if (
        row === undefined ||
        row.household_id !== input.householdId ||
        row.recipient_person_id !== input.recipientPersonId ||
        row.destination_id !== input.destinationId ||
        row.purpose !== input.purpose ||
        row.template_key !== input.templateKey ||
        row.scope_kind !== input.scope.kind ||
        row.scope_id !== input.scope.id ||
        asDate(row.scheduled_at, 'messaging intent schedule').getTime() !==
          input.scheduledAt.getTime()
      ) {
        throw new DomainError('conflict', 'Messaging intent conflicts with its first evidence');
      }
      return intentId;
    });
  }

  async intentStatus(input: {
    readonly intentId: string;
    readonly recipientPersonId: string;
  }): Promise<LocalMessagingIntentStatus> {
    this.assertLocal();
    assertStableId(input.intentId, 'Messaging intent ID');
    assertStableId(input.recipientPersonId, 'Messaging recipient ID');
    const result = await this.database.query<
      IntentRow & { readonly delivery_evidence_recorded: boolean }
    >(
      `SELECT intent.id, intent.household_id, intent.recipient_person_id,
              intent.destination_id, intent.purpose, intent.template_key,
              intent.scope_kind, intent.scope_id, intent.state,
              intent.blocked_reason, intent.scheduled_at,
              EXISTS (
                SELECT 1 FROM messaging_delivery_events delivery
                WHERE delivery.intent_id = intent.id
              ) AS delivery_evidence_recorded
       FROM messaging_intents intent
       WHERE intent.id = $1 AND intent.recipient_person_id = $2`,
      [input.intentId, input.recipientPersonId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new DomainError('not_found', 'Messaging intent is unavailable');
    return {
      ...stateResult(row),
      purpose: row.purpose,
      templateKey: row.template_key,
      scheduledAt: asDate(row.scheduled_at, 'messaging intent schedule'),
      deliveryEvidenceRecorded: row.delivery_evidence_recorded,
    };
  }

  private async scopeAvailable(executor: SqlExecutor, row: IntentRow): Promise<boolean> {
    if (row.scope_kind === 'household') return row.scope_id === row.household_id;
    const result = await executor.query(
      `SELECT 1 FROM support_cases support_case
       WHERE support_case.household_id = $1 AND support_case.id = $2
         AND support_case.opened_by_person_id = $3 AND support_case.status = 'open'
         AND EXISTS (
           SELECT 1 FROM support_case_assignments assignment
           JOIN employee_assignments employee ON employee.id = assignment.employee_assignment_id
           JOIN organizations organization ON organization.id = employee.organization_id
           WHERE assignment.household_id = support_case.household_id
             AND assignment.case_id = support_case.id AND assignment.status = 'active'
             AND employee.status = 'active' AND employee.role = 'hq_support'
             AND organization.kind = 'internal'
         )`,
      [row.household_id, row.scope_id, row.recipient_person_id],
    );
    return result.rowCount === 1;
  }

  private async finalizeIntent(
    executor: SqlExecutor,
    input: {
      readonly jobId: string;
      readonly now: Date;
      readonly row: IntentRow;
      readonly blockedReason?: LocalMessagingBlockedReason;
    },
  ): Promise<LocalMessagingDispatchResult> {
    const state = input.blockedReason === undefined ? 'local_simulated' : 'governance_blocked';
    const updated = await executor.query<IntentRow>(
      `UPDATE messaging_intents
       SET state = $2, blocked_reason = $3, updated_at = $4
       WHERE id = $1 AND state = 'queued'
       RETURNING id, household_id, recipient_person_id, destination_id, purpose,
         template_key, scope_kind, scope_id, state, blocked_reason, scheduled_at`,
      [input.row.id, state, input.blockedReason ?? null, input.now.toISOString()],
    );
    const row = updated.rows[0];
    if (row === undefined)
      throw new DomainError('conflict', 'Messaging intent transition was lost');
    await executor.query(
      `INSERT INTO messaging_delivery_events(
         id, intent_id, job_id, event_kind, blocked_reason, evidence_tier,
         provider_network_permitted, observed_at
       ) VALUES ($1,$2,$3,$4,$5,'local_simulation',false,$6)`,
      [
        this.ids.next('messaging-delivery'),
        row.id,
        input.jobId,
        state,
        input.blockedReason ?? null,
        input.now.toISOString(),
      ],
    );
    return stateResult(row);
  }

  async dispatchLocalSimulation(input: {
    readonly intentId: string;
    readonly jobId: string;
    readonly now: Date;
  }): Promise<LocalMessagingDispatchResult> {
    this.assertLocal();
    assertStableId(input.intentId, 'Messaging intent ID');
    assertStableId(input.jobId, 'Messaging job ID');
    return this.database.transaction(async (transaction) => {
      const now = await this.authorityNow(transaction, input.now);
      const intents = await transaction.query<IntentRow>(
        `SELECT id, household_id, recipient_person_id, destination_id, purpose,
                template_key, scope_kind, scope_id, state, blocked_reason, scheduled_at
         FROM messaging_intents WHERE id = $1 FOR UPDATE`,
        [input.intentId],
      );
      const row = intents.rows[0];
      if (row === undefined) throw new DomainError('not_found', 'Messaging intent is unavailable');
      if (row.state !== 'queued') return stateResult(row);
      if (asDate(row.scheduled_at, 'messaging intent schedule') > now) {
        throw new DomainError('conflict', 'Messaging intent is not due');
      }
      const control = await transaction.query<{ kill_switch: boolean } & Record<string, unknown>>(
        `SELECT kill_switch FROM messaging_local_control
         WHERE id = 'local-simulation' AND provider_network_permitted = false
           AND evidence_tier = 'local_simulation' FOR UPDATE`,
      );
      const killSwitch = control.rows[0]?.kill_switch;
      if (killSwitch === undefined) {
        return this.finalizeIntent(transaction, {
          jobId: input.jobId,
          now,
          row,
          blockedReason: 'global_stop',
        });
      }
      const membership = await transaction.query(
        `SELECT 1 FROM household_memberships
         WHERE household_id = $1 AND person_id = $2 AND status = 'active'`,
        [row.household_id, row.recipient_person_id],
      );
      if (membership.rowCount !== 1) {
        return this.finalizeIntent(transaction, {
          jobId: input.jobId,
          now,
          row,
          blockedReason: 'recipient_unavailable',
        });
      }
      const destination = await activeDestination(
        transaction,
        row.destination_id,
        row.recipient_person_id,
        true,
      );
      if (destination === undefined) {
        return this.finalizeIntent(transaction, {
          jobId: input.jobId,
          now,
          row,
          blockedReason: 'destination_unavailable',
        });
      }
      const consent = await lockConsentChain(
        transaction,
        row.recipient_person_id,
        row.destination_id,
        row.purpose,
      );
      if (consent.action !== 'grant') {
        return this.finalizeIntent(transaction, {
          jobId: input.jobId,
          now,
          row,
          blockedReason: 'consent_unavailable',
        });
      }
      const suppression = await lockSuppressionChain(
        transaction,
        row.recipient_person_id,
        row.purpose,
      );
      if (suppression.action === 'suppress' || suppression.action === 'restart_request') {
        return this.finalizeIntent(transaction, {
          jobId: input.jobId,
          now,
          row,
          blockedReason: 'suppressed',
        });
      }
      if (!(await this.scopeAvailable(transaction, row))) {
        return this.finalizeIntent(transaction, {
          jobId: input.jobId,
          now,
          row,
          blockedReason: 'scope_unavailable',
        });
      }
      const initialEligibility = evaluateLocalMessagingEligibility({
        at: now,
        counts: { purposeDaily: 0, purposeWeekly: 0, globalDaily: 0, globalWeekly: 0 },
        globalStop: killSwitch,
        purpose: row.purpose,
        templateKey: row.template_key,
        ...(destination.time_zone === null ? {} : { timeZone: destination.time_zone }),
      });
      if (!initialEligibility.allowed) {
        return this.finalizeIntent(transaction, {
          jobId: input.jobId,
          now,
          row,
          blockedReason: initialEligibility.reason,
        });
      }
      const windows = [
        [row.purpose, 'daily', initialEligibility.dailyWindowKey],
        [row.purpose, 'weekly', initialEligibility.weeklyWindowKey],
        ['all', 'daily', initialEligibility.dailyWindowKey],
        ['all', 'weekly', initialEligibility.weeklyWindowKey],
      ] as const;
      for (const [purpose, period, key] of windows) {
        await transaction.query(
          `INSERT INTO messaging_frequency_windows(
             person_id, purpose, period_kind, window_key, committed_count,
             policy_version, evidence_tier, updated_at
           ) VALUES ($1,$2,$3,$4,0,$5,'local_simulation',$6)
           ON CONFLICT (person_id, purpose, period_kind, window_key) DO NOTHING`,
          [
            row.recipient_person_id,
            purpose,
            period,
            key,
            messagingFrequencyPolicyVersion,
            now.toISOString(),
          ],
        );
      }
      const frequencies = await transaction.query<FrequencyRow>(
        `SELECT purpose, period_kind, window_key, committed_count
         FROM messaging_frequency_windows
         WHERE person_id = $1 AND (
           (purpose = $2 AND period_kind = 'daily' AND window_key = $3)
           OR (purpose = $2 AND period_kind = 'weekly' AND window_key = $4)
           OR (purpose = 'all' AND period_kind = 'daily' AND window_key = $3)
           OR (purpose = 'all' AND period_kind = 'weekly' AND window_key = $4)
         )
         ORDER BY purpose, period_kind FOR UPDATE`,
        [
          row.recipient_person_id,
          row.purpose,
          initialEligibility.dailyWindowKey,
          initialEligibility.weeklyWindowKey,
        ],
      );
      const count = (purpose: MessagingPurpose | 'all', period: 'daily' | 'weekly'): number =>
        frequencies.rows.find(
          (frequency) => frequency.purpose === purpose && frequency.period_kind === period,
        )?.committed_count ?? 0;
      const eligibility = evaluateLocalMessagingEligibility({
        at: now,
        counts: {
          purposeDaily: count(row.purpose, 'daily'),
          purposeWeekly: count(row.purpose, 'weekly'),
          globalDaily: count('all', 'daily'),
          globalWeekly: count('all', 'weekly'),
        },
        globalStop: killSwitch,
        purpose: row.purpose,
        templateKey: row.template_key,
        ...(destination.time_zone === null ? {} : { timeZone: destination.time_zone }),
      });
      if (!eligibility.allowed) {
        return this.finalizeIntent(transaction, {
          jobId: input.jobId,
          now,
          row,
          blockedReason: eligibility.reason,
        });
      }
      for (const [purpose, period, key] of windows) {
        await transaction.query(
          `UPDATE messaging_frequency_windows
           SET committed_count = committed_count + 1, updated_at = $5
           WHERE person_id = $1 AND purpose = $2 AND period_kind = $3 AND window_key = $4`,
          [row.recipient_person_id, purpose, period, key, now.toISOString()],
        );
      }
      return this.finalizeIntent(transaction, { jobId: input.jobId, now, row });
    });
  }

  async recordInboundLocalFixture(input: {
    readonly classification: 'stop' | 'start' | 'help' | 'support';
    readonly destinationId: string;
    readonly eventKey: string;
    readonly messageText?: string;
    readonly now: Date;
    readonly observedAt: Date;
    readonly personId: string;
    readonly supportCase?: { readonly householdId: string; readonly id: string };
  }): Promise<LocalInboundMessagingResult> {
    this.assertLocal();
    assertStableId(input.eventKey, 'Messaging inbound event key');
    assertFiniteDate(input.observedAt, 'Messaging inbound observation time');
    const support = input.classification === 'support';
    if (
      (support && (input.messageText === undefined || input.supportCase === undefined)) ||
      (!support && (input.messageText !== undefined || input.supportCase !== undefined)) ||
      (input.messageText !== undefined && Buffer.byteLength(input.messageText, 'utf8') > 1_600)
    ) {
      throw new DomainError('invalid_input', 'Messaging inbound fixture is invalid');
    }
    const minimized = support ? redactSensitiveInput(input.messageText!, 1_600) : undefined;
    const accepted = minimized?.status === 'accepted';
    const contentFingerprint =
      accepted && minimized !== undefined
        ? fingerprintMinimized(minimized.minimized, this.protection.fingerprintKey, {
            tenantId: input.personId,
            purpose: 'messaging-inbound-content',
            keyVersion: this.protection.fingerprintKeyVersion,
          }).value
        : null;
    return this.database.transaction(async (transaction) => {
      const now = await this.authorityNow(transaction, input.now);
      if (input.observedAt > now) {
        throw new DomainError('invalid_input', 'Messaging inbound evidence cannot be future-dated');
      }
      const destination = await transaction.query<
        { readonly latest_action: 'register' | 'retire' } & Record<string, unknown>
      >(
        `SELECT latest.action AS latest_action
         FROM messaging_destinations destination
         JOIN LATERAL (
           SELECT event.action FROM messaging_destination_events event
           WHERE event.destination_id = destination.id
           ORDER BY event.sequence DESC LIMIT 1
         ) latest ON true
         WHERE destination.id = $1 AND destination.person_id = $2
         FOR UPDATE OF destination`,
        [input.destinationId, input.personId],
      );
      if (destination.rowCount !== 1) {
        throw new DomainError('not_found', 'Messaging inbound destination is unavailable');
      }
      if (input.classification !== 'stop' && destination.rows[0]?.latest_action !== 'register') {
        throw new DomainError('conflict', 'Messaging inbound destination is not current');
      }
      const existing = await transaction.query<InboundRow>(
        `SELECT event.event_key, event.destination_id, event.person_id, event.classification,
                event.household_id, event.support_case_id, event.content_state,
                effect.effect, payload.content_fingerprint
         FROM messaging_inbound_events event
         JOIN messaging_inbound_effects effect ON effect.event_key = event.event_key
         LEFT JOIN messaging_inbound_payloads payload ON payload.event_key = event.event_key
         WHERE event.event_key = $1`,
        [input.eventKey],
      );
      const prior = existing.rows[0];
      const expectedContentState = !support
        ? 'none'
        : accepted
          ? 'encrypted_minimized'
          : 'discarded_unsafe';
      if (prior !== undefined) {
        if (
          prior.destination_id !== input.destinationId ||
          prior.person_id !== input.personId ||
          prior.classification !== input.classification ||
          prior.household_id !== (input.supportCase?.householdId ?? null) ||
          prior.support_case_id !== (input.supportCase?.id ?? null) ||
          prior.content_state !== expectedContentState ||
          prior.content_fingerprint !== contentFingerprint
        ) {
          throw new DomainError(
            'conflict',
            'Messaging inbound key conflicts with its first evidence',
          );
        }
        return {
          eventKey: prior.event_key,
          duplicate: true,
          effect: prior.effect,
          evidenceTier: 'local_simulation',
        };
      }
      await transaction.query(
        `INSERT INTO messaging_inbound_events(
           event_key, destination_id, person_id, classification, household_id,
           support_case_id, content_state, evidence_tier, observed_at, recorded_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'local_simulation',$8,$9)`,
        [
          input.eventKey,
          input.destinationId,
          input.personId,
          input.classification,
          input.supportCase?.householdId ?? null,
          input.supportCase?.id ?? null,
          expectedContentState,
          input.observedAt.toISOString(),
          now.toISOString(),
        ],
      );
      let effect: LocalInboundMessagingResult['effect'];
      if (input.classification === 'stop') {
        let changed = false;
        for (const purpose of messagingPurposes) {
          const chain = await lockSuppressionChain(transaction, input.personId, purpose);
          if (chain.action !== 'suppress') {
            changed =
              (await this.advanceSuppression(transaction, {
                action: 'suppress',
                now,
                personId: input.personId,
                purpose,
                source: 'recipient_stop',
              })) || changed;
          }
        }
        effect = changed ? 'suppressed' : 'already_suppressed';
      } else if (input.classification === 'start') {
        for (const purpose of messagingPurposes) {
          const chain = await lockSuppressionChain(transaction, input.personId, purpose);
          if (chain.action === 'suppress') {
            await this.advanceSuppression(transaction, {
              action: 'restart_request',
              now,
              personId: input.personId,
              purpose,
              source: 'recipient_start',
            });
          }
        }
        effect = 'restart_recorded';
      } else if (input.classification === 'help') {
        effect = 'help_observed_no_reply';
      } else if (accepted && minimized !== undefined) {
        const encrypted = encryptField(minimized.minimized, this.protection.encryptionKey, {
          tenantId: input.supportCase!.householdId,
          resourceId: input.eventKey,
          field: 'minimized_support_message',
          schemaVersion: 1,
          keyVersion: this.protection.encryptionKeyVersion,
        });
        await transaction.query(
          `INSERT INTO messaging_inbound_payloads(
             event_key, payload_state, encrypted_text, encryption_key_version,
             content_fingerprint, fingerprint_key_version, detected_classes,
             retention_deadline, created_at, erased_at
           ) VALUES ($1,'encrypted_minimized',$2,$3,$4,$5,$6::jsonb,$7,$8,NULL)`,
          [
            input.eventKey,
            serializeEncryptedField(encrypted),
            this.protection.encryptionKeyVersion,
            contentFingerprint,
            this.protection.fingerprintKeyVersion,
            JSON.stringify(minimized.detected),
            new Date(now.getTime() + 60 * 60_000).toISOString(),
            now.toISOString(),
          ],
        );
        effect = 'support_case_linked';
      } else {
        await transaction.query(
          `INSERT INTO messaging_inbound_payloads(
             event_key, payload_state, encrypted_text, encryption_key_version,
             content_fingerprint, fingerprint_key_version, detected_classes,
             retention_deadline, created_at, erased_at
           ) VALUES ($1,'discarded_unsafe',NULL,NULL,NULL,NULL,$2::jsonb,NULL,$3,NULL)`,
          [input.eventKey, JSON.stringify(minimized?.detected ?? []), now.toISOString()],
        );
        effect = 'support_content_discarded';
      }
      await transaction.query(
        `INSERT INTO messaging_inbound_effects(
           id, event_key, effect, evidence_tier, observed_at
         ) VALUES ($1,$2,$3,'local_simulation',$4)`,
        [this.ids.next('messaging-inbound-effect'), input.eventKey, effect, now.toISOString()],
      );
      return {
        eventKey: input.eventKey,
        duplicate: false,
        effect,
        evidenceTier: 'local_simulation',
      };
    });
  }

  async readAssignedSupportMessage(input: {
    readonly employeePersonId: string;
    readonly eventKey: string;
    readonly now: Date;
    readonly restrictedAccessGrantId: string;
  }): Promise<string> {
    this.assertLocal();
    assertStableId(input.eventKey, 'Messaging inbound event key');
    return this.database.transaction(async (transaction) => {
      const now = await this.authorityNow(transaction, input.now);
      const result = await transaction.query<
        {
          readonly household_id: string;
          readonly employee_assignment_id: string;
          readonly encrypted_text: string;
          readonly encryption_key_version: number;
          readonly retention_deadline: unknown;
        } & Record<string, unknown>
      >(
        `SELECT event.household_id, assignment.employee_assignment_id,
                payload.encrypted_text, payload.encryption_key_version,
                payload.retention_deadline
         FROM messaging_inbound_events event
         JOIN messaging_inbound_payloads payload ON payload.event_key = event.event_key
         JOIN support_cases support_case
           ON support_case.household_id = event.household_id
          AND support_case.id = event.support_case_id
         JOIN support_case_assignments assignment
           ON assignment.household_id = support_case.household_id
          AND assignment.case_id = support_case.id
         JOIN employee_assignments employee ON employee.id = assignment.employee_assignment_id
         JOIN organizations organization ON organization.id = employee.organization_id
         JOIN restricted_access_grants access
           ON access.household_id = event.household_id
          AND access.case_id = event.support_case_id
          AND access.employee_assignment_id = assignment.employee_assignment_id
         WHERE event.event_key = $1 AND event.classification = 'support'
           AND payload.payload_state = 'encrypted_minimized'
           AND payload.retention_deadline > $4
           AND support_case.status = 'open'
           AND support_case.opened_by_person_id = event.person_id
           AND support_case.opened_at <= $4
           AND employee.person_id = $2 AND employee.status = 'active'
           AND employee.role = 'hq_support' AND organization.kind = 'internal'
           AND employee.created_at <= $4 AND organization.created_at <= $4
           AND assignment.status = 'active' AND assignment.assigned_at <= $4
           AND access.id = $3 AND access.resource_type = 'messaging_inbound'
           AND access.resource_id = event.event_key
           AND access.purpose = 'customer_support' AND access.status = 'active'
           AND access.assurance = 'step_up_verified'
           AND access.granted_at <= $4 AND access.expires_at > $4
         FOR UPDATE OF support_case, payload, assignment, employee, organization, access`,
        [input.eventKey, input.employeePersonId, input.restrictedAccessGrantId, now.toISOString()],
      );
      const row = result.rows[0];
      if (
        row === undefined ||
        row.encryption_key_version !== this.protection.encryptionKeyVersion
      ) {
        throw new DomainError('not_authorized', 'Messaging support content is unavailable');
      }
      let plaintext: string;
      try {
        plaintext = decryptField(
          parseEncryptedField(row.encrypted_text),
          this.protection.encryptionKey,
          {
            tenantId: row.household_id,
            resourceId: input.eventKey,
            field: 'minimized_support_message',
            schemaVersion: 1,
            keyVersion: row.encryption_key_version,
          },
        ).toString('utf8');
      } catch {
        throw new DomainError('conflict', 'Messaging support content is unreadable');
      }
      await transaction.query(
        `INSERT INTO messaging_content_access_evidence(
           id, event_key, household_id, employee_assignment_id,
           restricted_access_grant_id, purpose, evidence_tier, observed_at
         ) VALUES ($1,$2,$3,$4,$5,'customer_support','local_simulation',$6)`,
        [
          this.ids.next('messaging-content-access'),
          input.eventKey,
          row.household_id,
          row.employee_assignment_id,
          input.restrictedAccessGrantId,
          now.toISOString(),
        ],
      );
      return plaintext;
    });
  }

  async listAssignedSupportMetadata(input: {
    readonly employeePersonId: string;
    readonly limit: number;
    readonly now: Date;
  }): Promise<readonly LocalMessagingSupportMetadata[]> {
    this.assertLocal();
    assertStableId(input.employeePersonId, 'Messaging employee ID');
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new DomainError('invalid_input', 'Messaging support metadata limit is invalid');
    }
    const now = await this.authorityNow(this.database, input.now);
    const result = await this.database.query<
      {
        readonly event_key: string;
        readonly household_id: string;
        readonly support_case_id: string;
        readonly payload_state: LocalMessagingSupportMetadata['contentState'];
        readonly effect: LocalMessagingSupportMetadata['effect'];
        readonly observed_at: unknown;
        readonly retention_deadline: unknown | null;
      } & Record<string, unknown>
    >(
      `SELECT event.event_key, event.household_id, event.support_case_id,
              payload.payload_state, effect.effect, event.observed_at,
              payload.retention_deadline
       FROM messaging_inbound_events event
       JOIN messaging_inbound_payloads payload ON payload.event_key = event.event_key
       JOIN messaging_inbound_effects effect ON effect.event_key = event.event_key
       JOIN support_cases support_case
         ON support_case.household_id = event.household_id
        AND support_case.id = event.support_case_id
       JOIN support_case_assignments assignment
         ON assignment.household_id = support_case.household_id
        AND assignment.case_id = support_case.id
       JOIN employee_assignments employee ON employee.id = assignment.employee_assignment_id
       JOIN organizations organization ON organization.id = employee.organization_id
       WHERE event.classification = 'support' AND support_case.status = 'open'
         AND assignment.status = 'active' AND employee.person_id = $1
         AND employee.status = 'active' AND employee.role = 'hq_support'
         AND organization.kind = 'internal' AND event.observed_at <= $2
       ORDER BY event.observed_at DESC, event.event_key DESC LIMIT $3`,
      [input.employeePersonId, now.toISOString(), input.limit],
    );
    return result.rows.map((row) => ({
      eventKey: row.event_key,
      householdId: row.household_id,
      supportCaseId: row.support_case_id,
      contentState: row.payload_state,
      effect: row.effect,
      observedAt: asDate(row.observed_at, 'messaging inbound observation'),
      ...(row.retention_deadline === null
        ? {}
        : {
            retentionDeadline: asDate(
              row.retention_deadline,
              'messaging support retention deadline',
            ),
          }),
      evidenceTier: 'local_simulation',
    }));
  }

  async purgeExpiredSupportContent(input: {
    readonly limit: number;
    readonly now: Date;
  }): Promise<readonly string[]> {
    this.assertLocal();
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) {
      throw new DomainError('invalid_input', 'Messaging purge limit is invalid');
    }
    return this.database.transaction(async (transaction) => {
      const now = await this.authorityNow(transaction, input.now);
      const due = await transaction.query<{ event_key: string } & Record<string, unknown>>(
        `SELECT event_key FROM messaging_inbound_payloads
         WHERE payload_state = 'encrypted_minimized' AND retention_deadline <= $1
         ORDER BY retention_deadline, event_key LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [now.toISOString(), input.limit],
      );
      for (const row of due.rows) {
        await transaction.query(
          `INSERT INTO messaging_payload_erasure_evidence(
             id, event_key, reason, evidence_tier, erased_at
           ) VALUES ($1,$2,'retention_expired','local_simulation',$3)`,
          [this.ids.next('messaging-erasure'), row.event_key, now.toISOString()],
        );
        await transaction.query(
          `UPDATE messaging_inbound_payloads
           SET payload_state = 'payload_erased', encrypted_text = NULL,
               encryption_key_version = NULL, content_fingerprint = NULL,
               fingerprint_key_version = NULL, erased_at = $2
           WHERE event_key = $1 AND payload_state = 'encrypted_minimized'`,
          [row.event_key, now.toISOString()],
        );
      }
      return due.rows.map((row) => row.event_key);
    });
  }
}
