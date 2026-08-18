import { createHash, createHmac, randomBytes } from 'node:crypto';
import { DomainError } from '@boomerbuddy/domain';
import {
  assertReferralProgramDefinition,
  boundedSettlementCredit,
  decideReferralQualification,
  type ReferralLedgerEntryKind,
  type ReferralProgramDefinition,
  type ReferralProgramState,
  type ReferralProgramVariant,
  type ReferralQualificationMilestone,
  type ReferralRecipientEventKind,
} from '../../domain/src/referral-credits';
import type { Database, SqlExecutor } from './database';
import { enqueueDurableJobWithExecutor } from './jobs';
import { asDate, randomIdFactory, type IdFactory } from './values';

const referralOperationKey =
  /^referral:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const hmacValue = /^[A-Za-z0-9_-]{43}$/u;
const stableReference = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{2,199}$/u;
const stableReason = /^[a-z][a-z0-9_]{2,79}$/u;

export interface ReferralCreditProtection {
  readonly hmacKey: string | Uint8Array;
  readonly keyVersion: number;
}

export type ReferralAuthorityClock = (executor: SqlExecutor) => Promise<Date>;

export interface ReferralLedgerEntry {
  readonly id: string;
  readonly attributionId: string;
  readonly programKey: string;
  readonly programVersion: number;
  readonly receivingPersonId: string;
  readonly receivingHouseholdId: string;
  readonly sequence: number;
  readonly kind: ReferralLedgerEntryKind;
  readonly amountMinor: number;
  readonly currency: 'USD';
  readonly canonicalOfferKey: string;
  readonly sourceReference: string;
  readonly sourceEvidenceDigest: string;
  readonly reasonCode: string;
  readonly idempotencyKey: string;
  readonly auditCorrelationId: string;
  readonly availableAt?: Date;
  readonly expiresAt?: Date;
  readonly evidenceTier: 'local_simulation';
  readonly providerCreditApplied: false;
  readonly externalActionExecuted: false;
  readonly createdAt: Date;
}

export interface ReferralMutationResult {
  readonly attributionId: string;
  readonly state: 'opened' | 'identity_bound' | 'qualified' | 'denied' | 'financial_recorded';
  readonly ledgerEntries: readonly ReferralLedgerEntry[];
  readonly evidenceTier: 'local_simulation';
  readonly programActive: false;
  readonly providerCreditApplied: false;
  readonly messageSent: false;
  readonly externalActionExecuted: false;
  readonly reused: boolean;
}

export interface IssueReferralSimulationResult {
  readonly attributionId: string;
  readonly attributionToken?: string;
  readonly expiresAt: Date;
  readonly evidenceTier: 'local_simulation';
  readonly programActive: false;
  readonly creditPromised: false;
  readonly messageSent: false;
  readonly providerCreditApplied: false;
  readonly externalActionExecuted: false;
  readonly reused: boolean;
}

export interface ReferralHqQueueItem {
  readonly attributionId: string;
  readonly programKey: string;
  readonly programVersion: number;
  readonly programState: ReferralProgramState;
  readonly attributionState: 'share_created' | 'opened' | 'identity_bound' | 'stopped' | 'expired';
  readonly qualificationState: 'not_evaluated' | 'qualified' | 'denied' | 'held';
  readonly balanceMinor: number;
  readonly reservedGrossMinor: number;
  readonly earnedGrossMinor: number;
  readonly reversedGrossMinor: number;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly evidenceTier: 'local_simulation';
  readonly contentIncluded: false;
  readonly contactIncluded: false;
  readonly recipientIdentityIncluded: false;
  readonly paymentIdentityIncluded: false;
  readonly providerCreditApplied: false;
  readonly externalActionExecuted: false;
}

interface ProgramRow extends Record<string, unknown> {
  readonly program_key: string;
  readonly program_version: number;
  readonly lifecycle_state: ReferralProgramState;
  readonly variant: ReferralProgramVariant;
  readonly effective_at: unknown;
  readonly expires_at: unknown;
  readonly qualification_milestone: ReferralQualificationMilestone;
  readonly qualified_credit_minor: number;
  readonly paid_credit_total_minor: number;
  readonly currency: 'USD';
  readonly eligible_offer_key: string;
  readonly maximum_participants: number;
  readonly maximum_referrals_per_referrer: number;
  readonly maximum_credit_per_referral_minor: number;
  readonly maximum_credit_per_referrer_minor: number;
  readonly maximum_credit_per_household_minor: number;
  readonly maximum_program_liability_minor: number;
  readonly attribution_ttl_seconds: number;
  readonly settlement_hold_seconds: number;
  readonly credit_expiry_seconds: number;
  readonly terms_version: string;
  readonly privacy_version: string;
  readonly definition_digest: string;
  readonly program_execution_enabled: boolean;
}

interface AttributionRow extends Record<string, unknown> {
  readonly id: string;
  readonly program_key: string;
  readonly program_version: number;
  readonly token_hmac: string;
  readonly referrer_person_id: string;
  readonly referrer_household_id: string;
  readonly referrer_payment_identity_hmac: string | null;
  readonly operation_key: string;
  readonly request_digest: string;
  readonly issued_at: unknown;
  readonly expires_at: unknown;
}

interface AttributionEventRow extends Record<string, unknown> {
  readonly id: string;
  readonly attribution_id: string;
  readonly event_kind: string;
  readonly recipient_person_id: string | null;
  readonly recipient_household_id: string | null;
  readonly recipient_payment_identity_hmac: string | null;
  readonly operation_key: string;
  readonly evidence_reference: string;
  readonly evidence_digest: string;
}

interface RecipientEventRow extends Record<string, unknown> {
  readonly id: string;
  readonly attribution_id: string;
  readonly event_kind: ReferralRecipientEventKind;
  readonly server_event_reference: string;
  readonly server_event_digest: string;
}

interface DecisionRow extends Record<string, unknown> {
  readonly id: string;
  readonly attribution_id: string;
  readonly recipient_event_id: string;
  readonly decision: 'qualified' | 'denied' | 'held';
}

interface FinancialRow extends Record<string, unknown> {
  readonly id: string;
  readonly attribution_id: string;
  readonly event_kind: 'settlement' | 'refund' | 'dispute' | 'cancellation' | 'failed_payment';
  readonly parent_financial_event_id: string | null;
  readonly source_event_hmac: string;
  readonly principal_minor: number;
  readonly recorded_at: unknown;
}

interface LedgerRow extends Record<string, unknown> {
  readonly id: string;
  readonly attribution_id: string;
  readonly program_key: string;
  readonly program_version: number;
  readonly receiving_person_id: string;
  readonly receiving_household_id: string;
  readonly sequence: number;
  readonly entry_kind: ReferralLedgerEntryKind;
  readonly amount_minor: number;
  readonly currency: 'USD';
  readonly canonical_offer_key: string;
  readonly source_reference: string;
  readonly source_evidence_digest: string;
  readonly reason_code: string;
  readonly idempotency_key: string;
  readonly audit_correlation_id: string;
  readonly available_at: unknown | null;
  readonly expires_at: unknown | null;
  readonly created_at: unknown;
}

const programProjection = `
  SELECT program_key, program_version, lifecycle_state, variant, effective_at, expires_at,
         qualification_milestone, qualified_credit_minor, paid_credit_total_minor, currency,
         eligible_offer_key, maximum_participants, maximum_referrals_per_referrer,
         maximum_credit_per_referral_minor, maximum_credit_per_referrer_minor,
         maximum_credit_per_household_minor, maximum_program_liability_minor,
         attribution_ttl_seconds, settlement_hold_seconds, credit_expiry_seconds,
         terms_version, privacy_version, definition_digest, program_execution_enabled
  FROM run3_referral_program_versions
`;

const attributionProjection = `
  SELECT id, program_key, program_version, token_hmac, referrer_person_id,
         referrer_household_id, referrer_payment_identity_hmac, operation_key,
         request_digest, issued_at, expires_at
  FROM run3_referral_attributions
`;

const ledgerProjection = `
  SELECT id, attribution_id, program_key, program_version, receiving_person_id,
         receiving_household_id, sequence, entry_kind, amount_minor, currency, canonical_offer_key,
         source_reference, source_evidence_digest, reason_code, idempotency_key,
         audit_correlation_id, available_at, expires_at, created_at
  FROM run3_referral_credit_entries AS ledger_entry
`;

const databaseAuthorityClock: ReferralAuthorityClock = async (executor) => {
  const result = await executor.query<
    { readonly authority_now: unknown } & Record<string, unknown>
  >('SELECT transaction_timestamp() AS authority_now');
  return asDate(result.rows[0]?.authority_now, 'authority_now');
};

function canonicalValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function hmac(key: string | Uint8Array, purpose: string, value: string): string {
  return createHmac('sha256', key).update(`${purpose}\u0000${value}`).digest('base64url');
}

function derivedOperationKey(seed: string, label: string): string {
  const bytes = createHash('sha256').update(`${seed}\u0000${label}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `referral:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertEnvelope(input: {
  readonly operationKey: string;
  readonly correlationId: string;
}): void {
  if (
    !referralOperationKey.test(input.operationKey) ||
    !stableReference.test(input.correlationId)
  ) {
    throw new DomainError('invalid_input', 'Invalid referral operation envelope');
  }
}

function assertHmac(value: string | undefined, field: string): void {
  if (value !== undefined && !hmacValue.test(value)) {
    throw new DomainError('invalid_input', `Invalid purpose-specific ${field} HMAC`);
  }
}

function mapProgram(row: ProgramRow): ReferralProgramDefinition {
  return {
    programKey: row.program_key,
    version: row.program_version,
    state: row.lifecycle_state,
    variant: row.variant,
    effectiveAt: asDate(row.effective_at, 'effective_at'),
    expiresAt: asDate(row.expires_at, 'expires_at'),
    qualificationMilestone: row.qualification_milestone,
    qualifiedCreditMinor: row.qualified_credit_minor,
    paidCreditTotalMinor: row.paid_credit_total_minor,
    currency: row.currency,
    eligibleOfferKey: row.eligible_offer_key,
    maximumParticipants: row.maximum_participants,
    maximumReferralsPerReferrer: row.maximum_referrals_per_referrer,
    maximumCreditPerReferralMinor: row.maximum_credit_per_referral_minor,
    maximumCreditPerReferrerMinor: row.maximum_credit_per_referrer_minor,
    maximumCreditPerHouseholdMinor: row.maximum_credit_per_household_minor,
    maximumProgramLiabilityMinor: row.maximum_program_liability_minor,
    attributionTtlSeconds: row.attribution_ttl_seconds,
    settlementHoldSeconds: row.settlement_hold_seconds,
    creditExpirySeconds: row.credit_expiry_seconds,
    termsVersion: row.terms_version,
    privacyVersion: row.privacy_version,
    externalActionEnabled: false,
  };
}

function mapLedger(row: LedgerRow): ReferralLedgerEntry {
  return {
    id: row.id,
    attributionId: row.attribution_id,
    programKey: row.program_key,
    programVersion: row.program_version,
    receivingPersonId: row.receiving_person_id,
    receivingHouseholdId: row.receiving_household_id,
    sequence: row.sequence,
    kind: row.entry_kind,
    amountMinor: row.amount_minor,
    currency: row.currency,
    canonicalOfferKey: row.canonical_offer_key,
    sourceReference: row.source_reference,
    sourceEvidenceDigest: row.source_evidence_digest,
    reasonCode: row.reason_code,
    idempotencyKey: row.idempotency_key,
    auditCorrelationId: row.audit_correlation_id,
    ...(row.available_at === null ? {} : { availableAt: asDate(row.available_at, 'available_at') }),
    ...(row.expires_at === null ? {} : { expiresAt: asDate(row.expires_at, 'expires_at') }),
    evidenceTier: 'local_simulation',
    providerCreditApplied: false,
    externalActionExecuted: false,
    createdAt: asDate(row.created_at, 'created_at'),
  };
}

function mutationResult(
  attributionId: string,
  state: ReferralMutationResult['state'],
  entries: readonly ReferralLedgerEntry[],
  reused: boolean,
): ReferralMutationResult {
  return {
    attributionId,
    state,
    ledgerEntries: entries,
    evidenceTier: 'local_simulation',
    programActive: false,
    providerCreditApplied: false,
    messageSent: false,
    externalActionExecuted: false,
    reused,
  };
}

export class ReferralCreditRepository {
  constructor(
    private readonly database: Database,
    private readonly protection: ReferralCreditProtection,
    private readonly ids: IdFactory = randomIdFactory,
    private readonly authorityClock: ReferralAuthorityClock = databaseAuthorityClock,
  ) {
    const keyLength =
      typeof protection.hmacKey === 'string'
        ? Buffer.byteLength(protection.hmacKey)
        : protection.hmacKey.byteLength;
    if (
      keyLength < 32 ||
      !Number.isSafeInteger(protection.keyVersion) ||
      protection.keyVersion < 1
    ) {
      throw new TypeError('Referral HMAC protection requires a versioned 256-bit key');
    }
  }

  async createProgram(
    definition: ReferralProgramDefinition,
  ): Promise<{ readonly definitionDigest: string; readonly reused: boolean }> {
    assertReferralProgramDefinition(definition);
    const definitionDigest = sha256(canonicalJson(definition));
    return this.database.transaction(async (transaction) => {
      const now = await this.authorityClock(transaction);
      const inserted = await transaction.query(
        `INSERT INTO run3_referral_program_versions(
           program_key, program_version, lifecycle_state, variant, attribution_rule,
           effective_at, expires_at, qualification_milestone, qualified_credit_minor,
           paid_credit_total_minor, currency, eligible_offer_key, maximum_participants,
           maximum_referrals_per_referrer, maximum_credit_per_referral_minor,
           maximum_credit_per_referrer_minor, maximum_credit_per_household_minor,
           maximum_program_liability_minor, attribution_ttl_seconds, settlement_hold_seconds,
           credit_expiry_seconds, terms_version, privacy_version, definition_digest,
           evidence_tier, program_execution_enabled, provider_execution_enabled, created_at
         ) VALUES (
           $1,$2,$3,$4,'first_identity_bound_touch',$5,$6,$7,$8,$9,$10,$11,$12,$13,
           $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,'local_simulation',false,false,$24
         ) ON CONFLICT (program_key, program_version) DO NOTHING`,
        [
          definition.programKey,
          definition.version,
          definition.state,
          definition.variant,
          definition.effectiveAt.toISOString(),
          definition.expiresAt.toISOString(),
          definition.qualificationMilestone,
          definition.qualifiedCreditMinor,
          definition.paidCreditTotalMinor,
          definition.currency,
          definition.eligibleOfferKey,
          definition.maximumParticipants,
          definition.maximumReferralsPerReferrer,
          definition.maximumCreditPerReferralMinor,
          definition.maximumCreditPerReferrerMinor,
          definition.maximumCreditPerHouseholdMinor,
          definition.maximumProgramLiabilityMinor,
          definition.attributionTtlSeconds,
          definition.settlementHoldSeconds,
          definition.creditExpirySeconds,
          definition.termsVersion,
          definition.privacyVersion,
          definitionDigest,
          now.toISOString(),
        ],
      );
      const existing = await transaction.query<ProgramRow>(
        `${programProjection} WHERE program_key = $1 AND program_version = $2`,
        [definition.programKey, definition.version],
      );
      const row = existing.rows[0];
      if (row === undefined || row.definition_digest !== definitionDigest) {
        throw new DomainError('conflict', 'Referral program version has conflicting evidence');
      }
      return { definitionDigest, reused: inserted.rowCount === 0 };
    });
  }

  async issueSimulation(input: {
    readonly programKey: string;
    readonly programVersion: number;
    readonly referrerPersonId: string;
    readonly referrerHouseholdId: string;
    readonly referrerPaymentIdentityHmac?: string;
    readonly operationKey: string;
    readonly correlationId: string;
    readonly simulation: true;
  }): Promise<IssueReferralSimulationResult> {
    assertEnvelope(input);
    assertHmac(input.referrerPaymentIdentityHmac, 'payment identity');
    if (input.simulation !== true) {
      throw new DomainError('restricted_input', 'Referral issuance is local simulation only');
    }
    const requestDigest = hmac(
      this.protection.hmacKey,
      'referral-issuance-request-v1',
      canonicalJson(input),
    );
    return this.database.transaction(async (transaction) => {
      const prior = await transaction.query<AttributionRow>(
        `${attributionProjection} WHERE operation_key = $1 FOR UPDATE`,
        [input.operationKey],
      );
      const existing = prior.rows[0];
      if (existing !== undefined) {
        if (
          existing.request_digest !== requestDigest ||
          existing.program_key !== input.programKey ||
          existing.program_version !== input.programVersion ||
          existing.referrer_person_id !== input.referrerPersonId ||
          existing.referrer_household_id !== input.referrerHouseholdId
        ) {
          throw new DomainError('conflict', 'Referral issuance operation has conflicting evidence');
        }
        return {
          attributionId: existing.id,
          expiresAt: asDate(existing.expires_at, 'expires_at'),
          evidenceTier: 'local_simulation',
          programActive: false,
          creditPromised: false,
          messageSent: false,
          providerCreditApplied: false,
          externalActionExecuted: false,
          reused: true,
        };
      }
      const program = await this.requireProgram(
        transaction,
        input.programKey,
        input.programVersion,
        true,
      );
      const now = await this.authorityClock(transaction);
      const expiresAt = new Date(now.getTime() + program.attribution_ttl_seconds * 1_000);
      const attributionId = this.ids.next('referral-attribution');
      const token = randomBytes(32).toString('base64url');
      const tokenDigest = hmac(this.protection.hmacKey, 'referral-attribution-token-v1', token);
      await transaction.query(
        `INSERT INTO run3_referral_attributions(
           id, program_key, program_version, token_hmac, token_key_version,
           referrer_person_id, referrer_household_id, referrer_payment_identity_hmac,
           operation_key, request_digest, issued_at, expires_at, evidence_tier,
           program_active, message_sent, external_action_executed
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'local_simulation',false,false,false)`,
        [
          attributionId,
          input.programKey,
          input.programVersion,
          tokenDigest,
          this.protection.keyVersion,
          input.referrerPersonId,
          input.referrerHouseholdId,
          input.referrerPaymentIdentityHmac ?? null,
          input.operationKey,
          requestDigest,
          now.toISOString(),
          expiresAt.toISOString(),
        ],
      );
      await transaction.query(
        `INSERT INTO run3_referral_attribution_events(
           id, attribution_id, program_key, program_version, sequence, event_kind,
           recipient_person_id, recipient_household_id, recipient_payment_identity_hmac,
           terms_version, privacy_version, operation_key, evidence_reference,
           evidence_digest, evidence_tier, occurred_at
         ) VALUES ($1,$2,$3,$4,1,'share_created',NULL,NULL,NULL,NULL,NULL,$5,$2,$6,
           'local_simulation',$7)`,
        [
          this.ids.next('referral-event'),
          attributionId,
          input.programKey,
          input.programVersion,
          input.operationKey,
          requestDigest,
          now.toISOString(),
        ],
      );
      return {
        attributionId,
        attributionToken: token,
        expiresAt,
        evidenceTier: 'local_simulation',
        programActive: false,
        creditPromised: false,
        messageSent: false,
        providerCreditApplied: false,
        externalActionExecuted: false,
        reused: false,
      };
    });
  }

  async openSimulation(input: {
    readonly attributionToken: string;
    readonly evidenceReference: string;
    readonly evidenceDigest: string;
    readonly operationKey: string;
    readonly correlationId: string;
    readonly simulation: true;
  }): Promise<ReferralMutationResult> {
    this.assertEvidenceEnvelope(input);
    return this.database.transaction(async (transaction) => {
      const attribution = await this.requireAttributionByToken(transaction, input.attributionToken);
      const existing = await transaction.query<AttributionEventRow>(
        `SELECT id, attribution_id, event_kind, recipient_person_id, recipient_household_id,
                recipient_payment_identity_hmac, operation_key, evidence_reference, evidence_digest
         FROM run3_referral_attribution_events WHERE operation_key = $1 FOR UPDATE`,
        [input.operationKey],
      );
      const prior = existing.rows[0];
      if (prior !== undefined) {
        if (
          prior.attribution_id !== attribution.id ||
          prior.event_kind !== 'invitation_opened' ||
          prior.evidence_reference !== input.evidenceReference ||
          prior.evidence_digest !== input.evidenceDigest
        ) {
          throw new DomainError('conflict', 'Referral open operation has conflicting evidence');
        }
        return mutationResult(attribution.id, 'opened', [], true);
      }
      const now = await this.authorityClock(transaction);
      const sequence = await this.nextEventSequence(transaction, attribution.id);
      await transaction.query(
        `INSERT INTO run3_referral_attribution_events(
           id, attribution_id, program_key, program_version, sequence, event_kind,
           recipient_person_id, recipient_household_id, recipient_payment_identity_hmac,
           terms_version, privacy_version, operation_key, evidence_reference,
           evidence_digest, evidence_tier, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,'invitation_opened',NULL,NULL,NULL,NULL,NULL,$6,$7,$8,
           'local_simulation',$9)`,
        [
          this.ids.next('referral-event'),
          attribution.id,
          attribution.program_key,
          attribution.program_version,
          sequence,
          input.operationKey,
          input.evidenceReference,
          input.evidenceDigest,
          now.toISOString(),
        ],
      );
      return mutationResult(attribution.id, 'opened', [], false);
    });
  }

  async bindSimulation(input: {
    readonly attributionToken: string;
    readonly recipientPersonId: string;
    readonly recipientHouseholdId: string;
    readonly recipientPaymentIdentityHmac?: string;
    readonly termsVersion: string;
    readonly privacyVersion: string;
    readonly evidenceReference: string;
    readonly evidenceDigest: string;
    readonly operationKey: string;
    readonly correlationId: string;
    readonly simulation: true;
  }): Promise<ReferralMutationResult> {
    this.assertEvidenceEnvelope(input);
    assertHmac(input.recipientPaymentIdentityHmac, 'payment identity');
    return this.database.transaction(async (transaction) => {
      const attribution = await this.requireAttributionByToken(transaction, input.attributionToken);
      const existing = await transaction.query<AttributionEventRow>(
        `SELECT id, attribution_id, event_kind, recipient_person_id, recipient_household_id,
                recipient_payment_identity_hmac, operation_key, evidence_reference, evidence_digest
         FROM run3_referral_attribution_events WHERE operation_key = $1 FOR UPDATE`,
        [input.operationKey],
      );
      const prior = existing.rows[0];
      if (prior !== undefined) {
        if (
          prior.attribution_id !== attribution.id ||
          prior.event_kind !== 'identity_bound' ||
          prior.recipient_person_id !== input.recipientPersonId ||
          prior.recipient_household_id !== input.recipientHouseholdId ||
          prior.recipient_payment_identity_hmac !== (input.recipientPaymentIdentityHmac ?? null) ||
          prior.evidence_reference !== input.evidenceReference ||
          prior.evidence_digest !== input.evidenceDigest
        ) {
          throw new DomainError('conflict', 'Referral binding operation has conflicting evidence');
        }
        return mutationResult(attribution.id, 'identity_bound', [], true);
      }
      const now = await this.authorityClock(transaction);
      const sequence = await this.nextEventSequence(transaction, attribution.id);
      await transaction.query(
        `INSERT INTO run3_referral_attribution_events(
           id, attribution_id, program_key, program_version, sequence, event_kind,
           recipient_person_id, recipient_household_id, recipient_payment_identity_hmac,
           terms_version, privacy_version, operation_key, evidence_reference,
           evidence_digest, evidence_tier, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,'identity_bound',$6,$7,$8,$9,$10,$11,$12,$13,
           'local_simulation',$14)`,
        [
          this.ids.next('referral-event'),
          attribution.id,
          attribution.program_key,
          attribution.program_version,
          sequence,
          input.recipientPersonId,
          input.recipientHouseholdId,
          input.recipientPaymentIdentityHmac ?? null,
          input.termsVersion,
          input.privacyVersion,
          input.operationKey,
          input.evidenceReference,
          input.evidenceDigest,
          now.toISOString(),
        ],
      );
      return mutationResult(attribution.id, 'identity_bound', [], false);
    });
  }

  async qualifyFromServerEvent(input: {
    readonly attributionId: string;
    readonly recipientPersonId: string;
    readonly recipientHouseholdId: string;
    readonly eventKind: ReferralRecipientEventKind;
    readonly serverEventReference: string;
    readonly serverEventDigest: string;
    readonly serverGenerated: true;
    readonly occurredAt: Date;
    readonly operationKey: string;
    readonly correlationId: string;
  }): Promise<ReferralMutationResult> {
    assertEnvelope(input);
    assertHmac(input.serverEventDigest, 'server event');
    if (
      input.serverGenerated !== true ||
      !stableReference.test(input.serverEventReference) ||
      !Number.isFinite(input.occurredAt.getTime())
    ) {
      throw new DomainError('invalid_input', 'Invalid referral server qualification evidence');
    }
    return this.database.transaction(async (transaction) => {
      const priorEvents = await transaction.query<RecipientEventRow>(
        `SELECT id, attribution_id, event_kind, server_event_reference, server_event_digest
         FROM run3_referral_recipient_events WHERE operation_key = $1 FOR UPDATE`,
        [input.operationKey],
      );
      const priorEvent = priorEvents.rows[0];
      if (priorEvent !== undefined) {
        if (
          priorEvent.attribution_id !== input.attributionId ||
          priorEvent.event_kind !== input.eventKind ||
          priorEvent.server_event_reference !== input.serverEventReference ||
          priorEvent.server_event_digest !== input.serverEventDigest
        ) {
          throw new DomainError(
            'conflict',
            'Referral qualification operation has conflicting evidence',
          );
        }
        const decisions = await transaction.query<DecisionRow>(
          `SELECT id, attribution_id, recipient_event_id, decision
           FROM run3_referral_qualification_decisions WHERE recipient_event_id = $1`,
          [priorEvent.id],
        );
        const decision = decisions.rows[0];
        if (decision === undefined) throw new Error('Referral qualification receipt is incomplete');
        const entries = await this.ledgerBySource(transaction, decision.id);
        return mutationResult(
          input.attributionId,
          decision.decision === 'qualified' ? 'qualified' : 'denied',
          entries,
          true,
        );
      }
      const attribution = await this.requireAttribution(transaction, input.attributionId, true);
      const programRow = await this.requireProgram(
        transaction,
        attribution.program_key,
        attribution.program_version,
        true,
      );
      const program = mapProgram(programRow);
      const bound = await transaction.query<AttributionEventRow>(
        `SELECT id, attribution_id, event_kind, recipient_person_id, recipient_household_id,
                recipient_payment_identity_hmac, operation_key, evidence_reference, evidence_digest
         FROM run3_referral_attribution_events
         WHERE attribution_id = $1 AND event_kind = 'identity_bound' FOR UPDATE`,
        [input.attributionId],
      );
      const binding = bound.rows[0];
      if (
        binding === undefined ||
        binding.recipient_person_id !== input.recipientPersonId ||
        binding.recipient_household_id !== input.recipientHouseholdId
      ) {
        throw new DomainError('not_authorized', 'Referral recipient evidence is unavailable');
      }
      const decision = decideReferralQualification({
        definition: program,
        recipientEventKind: input.eventKind,
        occurredAt: input.occurredAt,
      });
      const recipientEventId = this.ids.next('referral-recipient-event');
      await transaction.query(
        `INSERT INTO run3_referral_recipient_events(
           id, attribution_id, recipient_person_id, recipient_household_id, event_kind,
           server_event_reference, server_event_digest, operation_key, server_generated,
           evidence_tier, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,'local_simulation',$9)`,
        [
          recipientEventId,
          input.attributionId,
          input.recipientPersonId,
          input.recipientHouseholdId,
          input.eventKind,
          input.serverEventReference,
          input.serverEventDigest,
          input.operationKey,
          input.occurredAt.toISOString(),
        ],
      );
      const authorityNow = await this.authorityClock(transaction);
      const decisionId = this.ids.next('referral-decision');
      await transaction.query(
        `INSERT INTO run3_referral_qualification_decisions(
           id, attribution_id, recipient_event_id, decision, reason_code,
           policy_definition_digest, operation_key, evidence_tier,
           external_action_executed, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'local_simulation',false,$8)`,
        [
          decisionId,
          input.attributionId,
          recipientEventId,
          decision.decision,
          decision.reasonCode,
          programRow.definition_digest,
          input.operationKey,
          authorityNow.toISOString(),
        ],
      );
      const entries: ReferralLedgerEntry[] = [];
      if (decision.decision === 'qualified' && program.qualifiedCreditMinor > 0) {
        entries.push(
          await this.insertLedger(transaction, attribution, programRow, {
            kind: 'reserved',
            amountMinor: program.qualifiedCreditMinor,
            sourceType: 'qualification',
            sourceReference: decisionId,
            sourceEvidenceDigest: input.serverEventDigest,
            reasonCode: 'exact_server_milestone',
            idempotencyKey: derivedOperationKey(input.operationKey, 'qualified-reservation'),
            auditCorrelationId: input.correlationId,
            expiresAt: new Date(authorityNow.getTime() + program.creditExpirySeconds * 1_000),
            createdAt: authorityNow,
          }),
        );
      }
      await this.enqueueLocalEvaluation(
        transaction,
        attribution,
        'qualification_recorded',
        authorityNow,
        input.correlationId,
        recipientEventId,
      );
      return mutationResult(
        input.attributionId,
        decision.decision === 'qualified' ? 'qualified' : 'denied',
        entries,
        false,
      );
    });
  }

  async recordFinancialEvent(input: {
    readonly attributionId: string;
    readonly eventKind: FinancialRow['event_kind'];
    readonly parentFinancialEventId?: string;
    readonly subscriptionReferenceHmac: string;
    readonly invoiceReferenceHmac: string;
    readonly lineReferenceHmac: string;
    readonly canonicalOfferKey: string;
    readonly currency: 'USD';
    readonly principalMinor: number;
    readonly sourceAuthenticated: true;
    readonly providerExecutionRequested: false;
    readonly occurredAt: Date;
    readonly operationKey: string;
    readonly correlationId: string;
  }): Promise<ReferralMutationResult> {
    assertEnvelope(input);
    for (const [field, value] of [
      ['subscription reference', input.subscriptionReferenceHmac],
      ['invoice reference', input.invoiceReferenceHmac],
      ['line reference', input.lineReferenceHmac],
    ] as const) {
      assertHmac(value, field);
    }
    if (
      input.sourceAuthenticated !== true ||
      input.providerExecutionRequested !== false ||
      !Number.isSafeInteger(input.principalMinor) ||
      input.principalMinor < 1 ||
      !Number.isFinite(input.occurredAt.getTime()) ||
      !stableReason.test(input.canonicalOfferKey) ||
      (input.eventKind === 'settlement') === (input.parentFinancialEventId !== undefined)
    ) {
      throw new DomainError('invalid_input', 'Invalid referral financial evidence');
    }
    const sourceDigest = hmac(
      this.protection.hmacKey,
      'referral-financial-event-v1',
      canonicalJson(input),
    );
    return this.database.transaction(async (transaction) => {
      const priorEvents = await transaction.query<FinancialRow>(
        `SELECT id, attribution_id, event_kind, parent_financial_event_id,
                source_event_hmac, principal_minor, recorded_at
         FROM run3_referral_financial_events WHERE operation_key = $1 FOR UPDATE`,
        [input.operationKey],
      );
      const prior = priorEvents.rows[0];
      if (prior !== undefined) {
        if (
          prior.attribution_id !== input.attributionId ||
          prior.event_kind !== input.eventKind ||
          prior.source_event_hmac !== sourceDigest
        ) {
          throw new DomainError(
            'conflict',
            'Referral financial operation has conflicting evidence',
          );
        }
        return mutationResult(
          input.attributionId,
          'financial_recorded',
          await this.ledgerBySource(transaction, prior.id),
          true,
        );
      }
      const attribution = await this.requireAttribution(transaction, input.attributionId, true);
      const program = await this.requireProgram(
        transaction,
        attribution.program_key,
        attribution.program_version,
        true,
      );
      const authorityNow = await this.authorityClock(transaction);
      const financialId = this.ids.next('referral-financial');
      await transaction.query(
        `INSERT INTO run3_referral_financial_events(
           id, attribution_id, event_kind, parent_financial_event_id, source_event_hmac,
           subscription_reference_hmac, invoice_reference_hmac, line_reference_hmac,
           canonical_offer_key, currency, principal_minor, source_authenticated,
           evidence_tier, provider_execution_requested, provider_credit_applied,
           external_action_executed, operation_key, occurred_at, recorded_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,'local_simulation',
           false,false,false,$12,$13,$14)`,
        [
          financialId,
          input.attributionId,
          input.eventKind,
          input.parentFinancialEventId ?? null,
          sourceDigest,
          input.subscriptionReferenceHmac,
          input.invoiceReferenceHmac,
          input.lineReferenceHmac,
          input.canonicalOfferKey,
          input.currency,
          input.principalMinor,
          input.operationKey,
          input.occurredAt.toISOString(),
          authorityNow.toISOString(),
        ],
      );
      const entries: ReferralLedgerEntry[] = [];
      if (input.eventKind === 'settlement') {
        const reserved = await this.positiveEntryWithRemaining(
          transaction,
          input.attributionId,
          'reserved',
        );
        if (reserved !== undefined && reserved.remainingMinor > 0) {
          entries.push(
            await this.insertLedger(transaction, attribution, program, {
              kind: 'reversed',
              amountMinor: reserved.remainingMinor,
              sourceType: 'financial',
              sourceReference: financialId,
              sourceEvidenceDigest: sourceDigest,
              sourceEntryId: reserved.entry.id,
              reasonCode: 'reservation_superseded_by_settlement',
              idempotencyKey: derivedOperationKey(
                input.operationKey,
                'settlement-reservation-reversal',
              ),
              auditCorrelationId: input.correlationId,
              createdAt: authorityNow,
            }),
          );
        }
        const earnedAmount = boundedSettlementCredit({
          paidCreditTotalMinor: program.paid_credit_total_minor,
          currentNetCreditMinor: 0,
          canonicalSettledPrincipalMinor: input.principalMinor,
        });
        if (earnedAmount > 0) {
          const availableAt = new Date(
            authorityNow.getTime() + program.settlement_hold_seconds * 1_000,
          );
          entries.push(
            await this.insertLedger(transaction, attribution, program, {
              kind: 'earned',
              amountMinor: earnedAmount,
              sourceType: 'financial',
              sourceReference: financialId,
              sourceEvidenceDigest: sourceDigest,
              reasonCode: 'eligible_paid_settlement',
              idempotencyKey: derivedOperationKey(input.operationKey, 'settlement-earned'),
              auditCorrelationId: input.correlationId,
              availableAt,
              expiresAt: new Date(availableAt.getTime() + program.credit_expiry_seconds * 1_000),
              createdAt: authorityNow,
            }),
          );
        }
      } else {
        const parent = await transaction.query<FinancialRow>(
          `SELECT id, attribution_id, event_kind, parent_financial_event_id,
                  source_event_hmac, principal_minor, recorded_at
           FROM run3_referral_financial_events WHERE id = $1`,
          [input.parentFinancialEventId],
        );
        const settlement = parent.rows[0];
        if (settlement === undefined) throw new Error('Referral settlement parent disappeared');
        const earned = await this.positiveEntryWithRemaining(
          transaction,
          input.attributionId,
          'earned',
          settlement.id,
        );
        if (earned === undefined) {
          throw new DomainError(
            'invalid_transition',
            'Referral reversal has no earned source balance',
          );
        }
        const reversalAmount =
          input.eventKind === 'refund' || input.eventKind === 'dispute'
            ? await this.expectedRefundOrDisputeReversal(
                transaction,
                earned,
                settlement,
                financialId,
                input.principalMinor,
              )
            : earned.remainingMinor;
        if (reversalAmount > 0) {
          entries.push(
            await this.insertLedger(transaction, attribution, program, {
              kind: 'reversed',
              amountMinor: reversalAmount,
              sourceType: 'financial',
              sourceReference: financialId,
              sourceEvidenceDigest: sourceDigest,
              sourceEntryId: earned.entry.id,
              reasonCode: `authenticated_${input.eventKind}`,
              idempotencyKey: derivedOperationKey(
                input.operationKey,
                `${input.eventKind}-reversal`,
              ),
              auditCorrelationId: input.correlationId,
              createdAt: authorityNow,
            }),
          );
        }
      }
      await this.enqueueLocalEvaluation(
        transaction,
        attribution,
        'financial_reconciled',
        authorityNow,
        input.correlationId,
        financialId,
      );
      return mutationResult(input.attributionId, 'financial_recorded', entries, false);
    });
  }

  async appendReviewedCorrection(
    input: {
      readonly attributionId: string;
      readonly amountMinor: number;
      readonly reviewerPersonId: string;
      readonly reviewerAssignmentId: string;
      readonly evidenceReference: string;
      readonly evidenceDigest: string;
      readonly reasonCode: string;
      readonly operationKey: string;
      readonly correlationId: string;
    } & (
      | { readonly kind: 'correction_debit'; readonly targetEntryId: string }
      | { readonly kind: 'correction_credit'; readonly targetEntryId?: never }
    ),
  ): Promise<ReferralLedgerEntry> {
    assertEnvelope(input);
    assertHmac(input.evidenceDigest, 'correction evidence');
    if (
      !Number.isSafeInteger(input.amountMinor) ||
      input.amountMinor < 1 ||
      !stableReference.test(input.evidenceReference) ||
      !stableReason.test(input.reasonCode)
    ) {
      throw new DomainError('invalid_input', 'Invalid reviewed referral correction');
    }
    return this.database.transaction(async (transaction) => {
      const existing = await transaction.query<
        {
          readonly id: string;
          readonly attribution_id: string;
          readonly correction_kind: 'correction_debit' | 'correction_credit';
          readonly authorized_amount_minor: number;
          readonly target_entry_id: string | null;
          readonly evidence_digest: string;
          readonly reason_code: string;
        } & Record<string, unknown>
      >(
        `SELECT id, attribution_id, correction_kind, authorized_amount_minor, target_entry_id,
                evidence_digest, reason_code
         FROM run3_referral_correction_reviews
         WHERE operation_key = $1 FOR UPDATE`,
        [input.operationKey],
      );
      const prior = existing.rows[0];
      if (prior !== undefined) {
        if (
          prior.attribution_id !== input.attributionId ||
          prior.correction_kind !== input.kind ||
          prior.authorized_amount_minor !== input.amountMinor ||
          prior.target_entry_id !== (input.targetEntryId ?? null) ||
          prior.evidence_digest !== input.evidenceDigest ||
          prior.reason_code !== input.reasonCode
        ) {
          throw new DomainError(
            'conflict',
            'Referral correction operation has conflicting evidence',
          );
        }
        const entries = await this.ledgerBySource(transaction, prior.id);
        const entry = entries[0];
        if (entry === undefined) throw new Error('Referral correction receipt is incomplete');
        return entry;
      }
      const attribution = await this.requireAttribution(transaction, input.attributionId, true);
      const program = await this.requireProgram(
        transaction,
        attribution.program_key,
        attribution.program_version,
        true,
      );
      const now = await this.authorityClock(transaction);
      const reviewId = this.ids.next('referral-correction-review');
      await transaction.query(
        `INSERT INTO run3_referral_correction_reviews(
           id, attribution_id, correction_kind, authorized_amount_minor,
           target_entry_id,
           reviewer_person_id, reviewer_assignment_id, evidence_reference, evidence_digest,
           reason_code, operation_key, evidence_tier, external_action_executed, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'local_simulation',false,$12)`,
        [
          reviewId,
          input.attributionId,
          input.kind,
          input.amountMinor,
          input.targetEntryId ?? null,
          input.reviewerPersonId,
          input.reviewerAssignmentId,
          input.evidenceReference,
          input.evidenceDigest,
          input.reasonCode,
          input.operationKey,
          now.toISOString(),
        ],
      );
      return this.insertLedger(transaction, attribution, program, {
        kind: input.kind,
        amountMinor: input.amountMinor,
        sourceType: 'reviewed_correction',
        sourceReference: reviewId,
        sourceEvidenceDigest: input.evidenceDigest,
        ...(input.kind === 'correction_debit' ? { sourceEntryId: input.targetEntryId } : {}),
        reasonCode: input.reasonCode,
        idempotencyKey: derivedOperationKey(input.operationKey, 'reviewed-correction-ledger'),
        auditCorrelationId: input.correlationId,
        ...(input.kind === 'correction_credit'
          ? {
              availableAt: now,
              expiresAt: new Date(now.getTime() + program.credit_expiry_seconds * 1_000),
            }
          : {}),
        createdAt: now,
      });
    });
  }

  async expireDue(limit: number): Promise<readonly ReferralLedgerEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new DomainError('invalid_input', 'Referral expiry limit is invalid');
    }
    return this.database.transaction(async (transaction) => {
      const now = await this.authorityClock(transaction);
      const due = await transaction.query<LedgerRow>(
        `${ledgerProjection}
         WHERE entry_kind IN ('reserved','earned','correction_credit')
           AND expires_at <= $1
           AND NOT EXISTS (
             SELECT 1 FROM run3_referral_credit_entries expiry
             WHERE expiry.entry_kind = 'expired' AND expiry.source_entry_id = ledger_entry.id
           )
           AND amount_minor > COALESCE((
             SELECT sum(debit.amount_minor) FROM run3_referral_credit_entries debit
             WHERE debit.source_entry_id = ledger_entry.id
               AND debit.entry_kind IN ('expired','reversed','correction_debit')
           ), 0)
         ORDER BY expires_at, id LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [now.toISOString(), limit],
      );
      const expired: ReferralLedgerEntry[] = [];
      for (const row of due.rows) {
        const amount = await this.remainingForSourceEntry(transaction, row.id);
        if (amount < 1) continue;
        const attribution = await this.requireAttribution(transaction, row.attribution_id, false);
        const program = await this.requireProgram(
          transaction,
          attribution.program_key,
          attribution.program_version,
          false,
        );
        expired.push(
          await this.insertLedger(transaction, attribution, program, {
            kind: 'expired',
            amountMinor: amount,
            sourceType: 'expiry',
            sourceReference: row.id,
            sourceEvidenceDigest: row.source_evidence_digest,
            sourceEntryId: row.id,
            reasonCode: 'disclosed_credit_expiration',
            idempotencyKey: derivedOperationKey(row.id, 'credit-expiry'),
            auditCorrelationId: `referral.expiry:${row.id}`,
            createdAt: now,
          }),
        );
      }
      return expired;
    });
  }

  async ledger(attributionId: string): Promise<readonly ReferralLedgerEntry[]> {
    const result = await this.database.query<LedgerRow>(
      `${ledgerProjection} WHERE attribution_id = $1 ORDER BY sequence`,
      [attributionId],
    );
    return result.rows.map(mapLedger);
  }

  async balance(attributionId: string): Promise<number> {
    return this.netBalance(this.database, attributionId);
  }

  async localHqQueue(input: {
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly limit: number;
  }): Promise<readonly ReferralHqQueueItem[]> {
    if (
      !stableReference.test(input.actorPersonId) ||
      !stableReference.test(input.correlationId) ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    ) {
      throw new DomainError('invalid_input', 'Invalid referral HQ queue request');
    }
    return this.database.transaction(async (transaction) => {
      const authority = await transaction.query(
        `SELECT 1
         FROM employee_assignments employee
         JOIN organizations organization ON organization.id = employee.organization_id
         WHERE employee.person_id = $1 AND employee.status = 'active'
           AND employee.role IN ('hq_owner','hq_reviewer')
           AND organization.kind = 'internal'
         FOR UPDATE OF employee, organization`,
        [input.actorPersonId],
      );
      if (authority.rowCount === 0) {
        throw new DomainError('not_authorized', 'Referral HQ queue is unavailable');
      }
      const result = await transaction.query<
        {
          readonly attribution_id: string;
          readonly program_key: string;
          readonly program_version: number;
          readonly program_state: ReferralProgramState;
          readonly last_event_kind: string;
          readonly qualification_state: 'not_evaluated' | 'qualified' | 'denied' | 'held';
          readonly balance_minor: number;
          readonly reserved_gross_minor: number;
          readonly earned_gross_minor: number;
          readonly reversed_gross_minor: number;
          readonly issued_at: unknown;
          readonly expires_at: unknown;
        } & Record<string, unknown>
      >(
        `SELECT attribution.id AS attribution_id, attribution.program_key,
                attribution.program_version, program.lifecycle_state AS program_state,
                COALESCE((
                  SELECT event.event_kind FROM run3_referral_attribution_events event
                  WHERE event.attribution_id = attribution.id
                  ORDER BY event.sequence DESC LIMIT 1
                ), 'share_created') AS last_event_kind,
                COALESCE(decision.decision, 'not_evaluated') AS qualification_state,
                COALESCE(sum(CASE WHEN ledger.entry_kind IN (
                  'expired','reversed','correction_debit'
                ) THEN -ledger.amount_minor ELSE ledger.amount_minor END), 0)::int AS balance_minor,
                COALESCE(sum(ledger.amount_minor) FILTER (
                  WHERE ledger.entry_kind = 'reserved'
                ), 0)::int AS reserved_gross_minor,
                COALESCE(sum(ledger.amount_minor) FILTER (
                  WHERE ledger.entry_kind = 'earned'
                ), 0)::int AS earned_gross_minor,
                COALESCE(sum(ledger.amount_minor) FILTER (
                  WHERE ledger.entry_kind = 'reversed'
                ), 0)::int AS reversed_gross_minor,
                attribution.issued_at, attribution.expires_at
         FROM run3_referral_attributions attribution
         JOIN run3_referral_program_versions program
           ON program.program_key = attribution.program_key
          AND program.program_version = attribution.program_version
         LEFT JOIN run3_referral_qualification_decisions decision
           ON decision.attribution_id = attribution.id
         LEFT JOIN run3_referral_credit_entries ledger
           ON ledger.attribution_id = attribution.id
         GROUP BY attribution.id, attribution.program_key, attribution.program_version,
                  program.lifecycle_state, decision.decision, attribution.issued_at,
                  attribution.expires_at
         ORDER BY attribution.issued_at DESC, attribution.id
         LIMIT $1`,
        [input.limit],
      );
      return result.rows.map((row): ReferralHqQueueItem => {
        const state =
          row.last_event_kind === 'invitation_opened'
            ? 'opened'
            : row.last_event_kind === 'identity_bound'
              ? 'identity_bound'
              : row.last_event_kind === 'stopped'
                ? 'stopped'
                : row.last_event_kind === 'expired'
                  ? 'expired'
                  : 'share_created';
        return {
          attributionId: row.attribution_id,
          programKey: row.program_key,
          programVersion: row.program_version,
          programState: row.program_state,
          attributionState: state,
          qualificationState: row.qualification_state,
          balanceMinor: row.balance_minor,
          reservedGrossMinor: row.reserved_gross_minor,
          earnedGrossMinor: row.earned_gross_minor,
          reversedGrossMinor: row.reversed_gross_minor,
          issuedAt: asDate(row.issued_at, 'issued_at'),
          expiresAt: asDate(row.expires_at, 'expires_at'),
          evidenceTier: 'local_simulation',
          contentIncluded: false,
          contactIncluded: false,
          recipientIdentityIncluded: false,
          paymentIdentityIncluded: false,
          providerCreditApplied: false,
          externalActionExecuted: false,
        };
      });
    });
  }

  private assertEvidenceEnvelope(input: {
    readonly operationKey: string;
    readonly correlationId: string;
    readonly evidenceReference: string;
    readonly evidenceDigest: string;
    readonly simulation: true;
  }): void {
    assertEnvelope(input);
    assertHmac(input.evidenceDigest, 'evidence');
    if (input.simulation !== true || !stableReference.test(input.evidenceReference)) {
      throw new DomainError('restricted_input', 'Referral evidence is local simulation only');
    }
  }

  private async requireProgram(
    executor: SqlExecutor,
    programKey: string,
    programVersion: number,
    lock: boolean,
  ): Promise<ProgramRow> {
    const result = await executor.query<ProgramRow>(
      `${programProjection} WHERE program_key = $1 AND program_version = $2${lock ? ' FOR UPDATE' : ''}`,
      [programKey, programVersion],
    );
    const row = result.rows[0];
    if (row === undefined) throw new DomainError('not_found', 'Referral program is unavailable');
    return row;
  }

  private async requireAttribution(
    executor: SqlExecutor,
    attributionId: string,
    lock: boolean,
  ): Promise<AttributionRow> {
    const result = await executor.query<AttributionRow>(
      `${attributionProjection} WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [attributionId],
    );
    const row = result.rows[0];
    if (row === undefined)
      throw new DomainError('not_found', 'Referral attribution is unavailable');
    return row;
  }

  private async requireAttributionByToken(
    executor: SqlExecutor,
    token: string,
  ): Promise<AttributionRow> {
    if (!hmacValue.test(token)) {
      throw new DomainError('not_found', 'Referral attribution is unavailable');
    }
    const tokenDigest = hmac(this.protection.hmacKey, 'referral-attribution-token-v1', token);
    const result = await executor.query<AttributionRow>(
      `${attributionProjection} WHERE token_hmac = $1 FOR UPDATE`,
      [tokenDigest],
    );
    const row = result.rows[0];
    if (row === undefined)
      throw new DomainError('not_found', 'Referral attribution is unavailable');
    return row;
  }

  private async nextEventSequence(executor: SqlExecutor, attributionId: string): Promise<number> {
    const result = await executor.query<
      { readonly next_sequence: number } & Record<string, unknown>
    >(
      `SELECT (COALESCE(max(sequence), 0) + 1)::int AS next_sequence
       FROM run3_referral_attribution_events WHERE attribution_id = $1`,
      [attributionId],
    );
    return result.rows[0]?.next_sequence ?? 1;
  }

  private async insertLedger(
    executor: SqlExecutor,
    attribution: AttributionRow,
    program: ProgramRow,
    input: {
      readonly kind: ReferralLedgerEntryKind;
      readonly amountMinor: number;
      readonly sourceType: 'qualification' | 'financial' | 'expiry' | 'reviewed_correction';
      readonly sourceReference: string;
      readonly sourceEvidenceDigest: string;
      readonly sourceEntryId?: string;
      readonly reasonCode: string;
      readonly idempotencyKey: string;
      readonly auditCorrelationId: string;
      readonly availableAt?: Date;
      readonly expiresAt?: Date;
      readonly createdAt: Date;
    },
  ): Promise<ReferralLedgerEntry> {
    const id = this.ids.next('referral-ledger');
    const sequenceResult = await executor.query<
      { readonly next_sequence: number } & Record<string, unknown>
    >(
      `SELECT (COALESCE(max(sequence), 0) + 1)::int AS next_sequence
       FROM run3_referral_credit_entries WHERE attribution_id = $1`,
      [attribution.id],
    );
    const sequence = sequenceResult.rows[0]?.next_sequence ?? 1;
    await executor.query(
      `INSERT INTO run3_referral_credit_entries(
         id, attribution_id, program_key, program_version, receiving_person_id,
         receiving_household_id, sequence, entry_kind, amount_minor, currency, canonical_offer_key,
         source_type, source_reference, source_evidence_digest, source_entry_id, reason_code,
         idempotency_key, audit_correlation_id, available_at, expires_at, evidence_tier,
         provider_credit_applied, external_action_executed, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
         'local_simulation',false,false,$21)`,
      [
        id,
        attribution.id,
        attribution.program_key,
        attribution.program_version,
        attribution.referrer_person_id,
        attribution.referrer_household_id,
        sequence,
        input.kind,
        input.amountMinor,
        program.currency,
        program.eligible_offer_key,
        input.sourceType,
        input.sourceReference,
        input.sourceEvidenceDigest,
        input.sourceEntryId ?? null,
        input.reasonCode,
        input.idempotencyKey,
        input.auditCorrelationId,
        input.availableAt?.toISOString() ?? null,
        input.expiresAt?.toISOString() ?? null,
        input.createdAt.toISOString(),
      ],
    );
    const result = await executor.query<LedgerRow>(`${ledgerProjection} WHERE id = $1`, [id]);
    const row = result.rows[0];
    if (row === undefined) throw new Error('Referral ledger entry did not persist');
    return mapLedger(row);
  }

  private async ledgerBySource(
    executor: SqlExecutor,
    sourceReference: string,
  ): Promise<readonly ReferralLedgerEntry[]> {
    const result = await executor.query<LedgerRow>(
      `${ledgerProjection} WHERE source_reference = $1 ORDER BY sequence`,
      [sourceReference],
    );
    return result.rows.map(mapLedger);
  }

  private async positiveEntryWithRemaining(
    executor: SqlExecutor,
    attributionId: string,
    kind: 'reserved' | 'earned' | 'correction_credit',
    sourceReference?: string,
  ): Promise<{ readonly entry: ReferralLedgerEntry; readonly remainingMinor: number } | undefined> {
    const result = await executor.query<LedgerRow>(
      `${ledgerProjection}
       WHERE attribution_id = $1 AND entry_kind = $2
         ${sourceReference === undefined ? '' : 'AND source_reference = $3'}
       ORDER BY sequence LIMIT 1 FOR UPDATE`,
      sourceReference === undefined
        ? [attributionId, kind]
        : [attributionId, kind, sourceReference],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      entry: mapLedger(row),
      remainingMinor: await this.remainingForSourceEntry(executor, row.id),
    };
  }

  private async remainingForSourceEntry(
    executor: SqlExecutor,
    sourceEntryId: string,
  ): Promise<number> {
    const source = await executor.query<
      { readonly amount_minor: number } & Record<string, unknown>
    >(
      `SELECT amount_minor FROM run3_referral_credit_entries
       WHERE id = $1 AND entry_kind IN ('reserved','earned','correction_credit')
       FOR UPDATE`,
      [sourceEntryId],
    );
    const amount = source.rows[0]?.amount_minor;
    if (amount === undefined) return 0;
    const debits = await executor.query<{ readonly debit_minor: number } & Record<string, unknown>>(
      `SELECT COALESCE(sum(amount_minor), 0)::int AS debit_minor
       FROM run3_referral_credit_entries
       WHERE source_entry_id = $1
         AND entry_kind IN ('expired','reversed','correction_debit')`,
      [sourceEntryId],
    );
    return amount - (debits.rows[0]?.debit_minor ?? 0);
  }

  private async expectedRefundOrDisputeReversal(
    executor: SqlExecutor,
    source: { readonly entry: ReferralLedgerEntry; readonly remainingMinor: number },
    settlement: FinancialRow,
    currentFinancialEventId: string,
    newPrincipalMinor: number,
  ): Promise<number> {
    const processed = await executor.query<
      { readonly principal_minor: number } & Record<string, unknown>
    >(
      `SELECT COALESCE(sum(principal_minor), 0)::int AS principal_minor
       FROM run3_referral_financial_events
       WHERE parent_financial_event_id = $1
         AND event_kind IN ('refund','dispute') AND id <> $2`,
      [settlement.id, currentFinancialEventId],
    );
    const debits = await executor.query<{ readonly debit_minor: number } & Record<string, unknown>>(
      `SELECT COALESCE(sum(ledger.amount_minor), 0)::int AS debit_minor
       FROM run3_referral_credit_entries ledger
       JOIN run3_referral_financial_events financial
         ON financial.id = ledger.source_reference
       WHERE ledger.source_entry_id = $1 AND ledger.entry_kind = 'reversed'
         AND financial.parent_financial_event_id = $2
         AND financial.event_kind IN ('refund','dispute') AND financial.id <> $3`,
      [source.entry.id, settlement.id, currentFinancialEventId],
    );
    const priorDebit = debits.rows[0]?.debit_minor ?? 0;
    const priorPrincipal = processed.rows[0]?.principal_minor ?? 0;
    const cumulativeTarget = Math.min(
      source.entry.amountMinor,
      Math.floor(
        (source.entry.amountMinor * (priorPrincipal + newPrincipalMinor)) /
          settlement.principal_minor,
      ),
    );
    return Math.min(source.remainingMinor, Math.max(0, cumulativeTarget - priorDebit));
  }

  private async netBalance(executor: SqlExecutor, attributionId: string): Promise<number> {
    const result = await executor.query<
      { readonly balance_minor: number } & Record<string, unknown>
    >(
      `SELECT COALESCE(sum(CASE WHEN entry_kind IN (
         'expired','reversed','correction_debit'
       ) THEN -amount_minor ELSE amount_minor END), 0)::int AS balance_minor
       FROM run3_referral_credit_entries WHERE attribution_id = $1`,
      [attributionId],
    );
    return result.rows[0]?.balance_minor ?? 0;
  }

  private async enqueueLocalEvaluation(
    executor: SqlExecutor,
    attribution: AttributionRow,
    step: 'qualification_recorded' | 'financial_reconciled' | 'credit_expiry_due',
    now: Date,
    correlationId: string,
    sourceId: string,
  ): Promise<void> {
    const enqueued = await enqueueDurableJobWithExecutor(executor, this.ids, {
      type: 'referral.credit.evaluate',
      version: 1,
      classification: 'internal',
      payload: {
        attributionId: attribution.id,
        programKey: attribution.program_key,
        programVersion: attribution.program_version,
        step,
        localOnly: true,
      },
      idempotencyKey: `referral.evaluate:${sourceId}`,
      deduplicationKey: `referral.evaluate:${sourceId}`,
      scheduledAt: now,
      maxAttempts: 3,
      correlationId,
    });
    await executor.query(
      `INSERT INTO run3_referral_processing_jobs(
         id, attribution_id, processing_step, durable_job_id, receipt_state,
         evidence_tier, provider_processed, provider_credit_applied,
         external_action_executed, created_at
       ) VALUES ($1,$2,$3,$4,'queued_not_run','local_simulation',false,false,false,$5)`,
      [
        this.ids.next('referral-processing'),
        attribution.id,
        step,
        enqueued.job.id,
        now.toISOString(),
      ],
    );
  }
}
