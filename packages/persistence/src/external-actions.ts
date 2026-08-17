import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { DomainError } from '@boomerbuddy/domain';

import type { Database, SqlExecutor } from './database';
import type { OperationalEventContext } from './events';
import { asDate, randomIdFactory, type IdFactory } from './values';

export type ExternalActionClass = 'email' | 'sms' | 'refund' | 'credit' | 'paid_tool';
export type ExternalActionScopeKind = 'company' | 'household' | 'organization';
export type ExternalActionOriginKind = 'durable_job' | 'outbox_event';
export type ExternalActionState =
  | 'pending'
  | 'in_flight'
  | 'retry_wait'
  | 'outcome_unknown'
  | 'succeeded'
  | 'failed_terminal'
  | 'canceled';
export type ExternalActionEffectState =
  'not_dispatched' | 'unknown' | 'accepted' | 'confirmed_no_effect';
export type ExternalActionBudgetMagnitudeKind =
  'provider_cost' | 'refund_principal' | 'credit_principal';
export type ExternalActionReconciliationEvidenceKind =
  'provider_query' | 'provider_webhook' | 'operator_review';
export type ExternalActionReconciliationOutcomeKind =
  'confirmed_succeeded' | 'confirmed_no_effect' | 'still_unknown' | 'canceled';

declare const dispatchCapabilityBrand: unique symbol;
declare const exposureCapabilityBrand: unique symbol;
declare const originLeaseCapabilityBrand: unique symbol;
declare const reconciliationCapabilityBrand: unique symbol;

export interface ExternalActionOriginLeaseCapability {
  readonly [originLeaseCapabilityBrand]: true;
  readonly expiresAt: Date;
  readonly issuedAt: Date;
  readonly originId: string;
  readonly originKind: ExternalActionOriginKind;
  readonly scopeId: string;
  readonly scopeKind: ExternalActionScopeKind;
  readonly workerId: string;
}

export interface ExternalActionExposureCapability {
  readonly [exposureCapabilityBrand]: true;
  readonly actionClass: ExternalActionClass;
  readonly authorizationId: string;
  readonly budgetMagnitudeKind: ExternalActionBudgetMagnitudeKind;
  readonly budgetReservationId: string;
  readonly costSourceKey: string;
  readonly costSourceVersion: string;
  readonly evidenceLevel: 'local_fixture';
  readonly expiresAt: Date;
  readonly financialExposureUpperBoundCents: number;
  readonly operationId: string;
  readonly providerCapabilityRuleId: string;
  readonly providerCapabilityRuleVersion: number;
  readonly providerIdempotencyKey?: string;
  readonly providerIdempotencyKeyDerivationVersion?: string;
  readonly providerKey: string;
  readonly providerAccountDigest: string;
  readonly providerSupportsIdempotency: boolean;
  readonly token: string;
}

export interface ExternalActionDispatchCapability {
  readonly [dispatchCapabilityBrand]: true;
  readonly attempt: number;
  readonly budgetReservationId: string;
  readonly dispatchBy: Date;
  readonly expiresAt: Date;
  readonly operationId: string;
  readonly scopeId: string;
  readonly scopeKind: ExternalActionScopeKind;
  readonly token: string;
  readonly workerId: string;
}

export interface ExternalActionReconciliationCapability {
  readonly [reconciliationCapabilityBrand]: true;
  readonly actorPersonId: string;
  readonly authorizationId: string;
  readonly budgetReservationId: string;
  readonly expiresAt: Date;
  readonly operationId: string;
  readonly requestedOutcome: ExternalActionReconciliationOutcomeKind;
  readonly scopeId: string;
  readonly scopeKind: ExternalActionScopeKind;
  readonly token: string;
}

export interface ExternalAction {
  readonly actionClass: ExternalActionClass;
  readonly attempts: number;
  readonly automationActionKey: string;
  readonly automationToolKey: string;
  readonly budgetEnvelopeDigest: string;
  readonly budgetMagnitudeKind: ExternalActionBudgetMagnitudeKind;
  readonly budgetReservationId: string;
  readonly correlationId: string;
  readonly costCurrency: 'USD';
  readonly costSourceKey: string;
  readonly costSourceVersion: string;
  readonly financialExposureUpperBoundCents: number;
  readonly createdAt: Date;
  readonly effectState: ExternalActionEffectState;
  readonly exposureAuthorizationId: string;
  readonly exposureEvidenceLevel: 'local_fixture';
  readonly intentFingerprint: string;
  readonly maxAttempts: number;
  readonly nextAttemptAt: Date;
  readonly operationId: string;
  readonly originId: string;
  readonly originKind: ExternalActionOriginKind;
  readonly providerIdempotencyKey?: string;
  readonly providerIdempotencyKeyDerivationVersion?: string;
  readonly providerCapabilityRuleId: string;
  readonly providerCapabilityRuleVersion: number;
  readonly providerKey: string;
  readonly providerAccountDigest: string;
  readonly providerNormalizedOutcome?: 'accepted';
  readonly providerResponseId?: string;
  readonly providerResponseState?: string;
  readonly providerSupportsIdempotency: boolean;
  readonly registeredByPersonId: string;
  readonly retrySuppressed: boolean;
  readonly scopeId: string;
  readonly scopeKind: ExternalActionScopeKind;
  readonly state: ExternalActionState;
  readonly updatedAt: Date;
}

export interface RegisterExternalActionInput {
  readonly actionClass: ExternalActionClass;
  readonly automationActionKey: string;
  readonly automationToolKey: string;
  readonly budgetReservationId: string;
  readonly context: OperationalEventContext;
  readonly exposureAuthority: ExternalActionExposureCapability;
  /** A caller-produced keyed-HMAC/base64url fingerprint. No destination, message, or payload is stored. */
  readonly intentFingerprint: string;
  readonly maxAttempts: number;
  readonly operationId: string;
  readonly originId: string;
  readonly originKind: ExternalActionOriginKind;
  readonly providerKey: string;
  readonly scopeId: string;
  readonly scopeKind: ExternalActionScopeKind;
}

export interface ExternalActionCostEvidence {
  readonly actualFinancialExposureCents: number;
  readonly budgetMagnitudeKind: ExternalActionBudgetMagnitudeKind;
  readonly currency: 'USD';
  readonly digest: string;
  readonly evidenceLevel: 'local_fixture';
  readonly reference: string;
  readonly sourceKey: string;
  readonly sourceVersion: string;
}

export interface ExternalActionReconciliationEvidence {
  readonly digest: string;
  readonly kind: ExternalActionReconciliationEvidenceKind;
  readonly observedAt: Date;
  readonly providerAccountDigest: string;
  readonly providerKey: string;
  readonly reference: string;
}

interface ControlRow extends Record<string, unknown> {
  readonly kill_switch: boolean;
  readonly version: number;
}

interface ReservationRow extends Record<string, unknown> {
  readonly action_key: string;
  readonly agent_key: string;
  readonly control_version: number | null;
  readonly data_classes: unknown;
  readonly envelope_digest: string;
  readonly estimated_cost_cents: number;
  readonly execution_authorization_expires_at: unknown | null;
  readonly execution_rechecked_at: unknown | null;
  readonly expires_at: unknown;
  readonly id: string;
  readonly operation_key: string;
  readonly policy_id: string;
  readonly policy_version: number;
  readonly state: string;
  readonly tool_key: string;
}

interface PolicyRow extends Record<string, unknown> {
  readonly enabled: boolean;
  readonly id: string;
  readonly version: number;
}

interface AllocationRow extends Record<string, unknown> {
  readonly cap_id: string;
  readonly cap_version: number;
  readonly period_start: unknown;
  readonly reserved_cents: number;
}

interface CapRow extends Record<string, unknown> {
  readonly id: string;
  readonly scope_key: string;
  readonly scope_kind: string;
  readonly version: number;
}

interface ExternalActionRow extends Record<string, unknown> {
  readonly action_class: ExternalActionClass;
  readonly attempts: number;
  readonly automation_action_key: string;
  readonly automation_tool_key: string;
  readonly budget_envelope_digest: string;
  readonly budget_reservation_id: string;
  readonly budget_magnitude_kind: ExternalActionBudgetMagnitudeKind;
  readonly correlation_id: string;
  readonly cost_currency: 'USD';
  readonly cost_source_key: string;
  readonly cost_source_version: string;
  readonly financial_exposure_upper_bound_cents: number;
  readonly created_at: unknown;
  readonly effect_state: ExternalActionEffectState;
  readonly exposure_authorization_id: string;
  readonly exposure_evidence_level: 'local_fixture';
  readonly intent_fingerprint: string;
  readonly lease_expires_at: unknown | null;
  readonly lease_owner: string | null;
  readonly max_attempts: number;
  readonly next_attempt_at: unknown;
  readonly operation_id: string;
  readonly origin_id: string;
  readonly origin_kind: ExternalActionOriginKind;
  readonly provider_idempotency_key: string | null;
  readonly provider_idempotency_key_derivation_version: string | null;
  readonly provider_capability_rule_id: string;
  readonly provider_capability_rule_version: number;
  readonly provider_account_digest: string;
  readonly provider_key: string;
  readonly provider_normalized_outcome: 'accepted' | null;
  readonly provider_response_id: string | null;
  readonly provider_response_state: string | null;
  readonly provider_supports_idempotency: boolean;
  readonly registered_by_person_id: string;
  readonly retry_suppressed: boolean;
  readonly scope_id: string;
  readonly scope_kind: ExternalActionScopeKind;
  readonly state: ExternalActionState;
  readonly transition_capability_digest: string | null;
  readonly transition_capability_expires_at: unknown | null;
  readonly updated_at: unknown;
}

interface ReconciliationAuthorizationRow extends Record<string, unknown> {
  readonly actor_person_id: string;
  readonly audience: 'hq';
  readonly budget_reservation_id: string;
  readonly capability_digest: string;
  readonly expires_at: unknown;
  readonly id: string;
  readonly operation_id: string;
  readonly requested_outcome: ExternalActionReconciliationOutcomeKind;
  readonly scope_id: string;
  readonly scope_kind: ExternalActionScopeKind;
  readonly used_at: unknown | null;
}

interface OriginLeaseRow extends Record<string, unknown> {
  readonly aggregate_id?: string;
  readonly aggregate_type?: string;
  readonly dead_lettered_at?: unknown | null;
  readonly household_id: string | null;
  readonly lease_expires_at: unknown | null;
  readonly lease_owner: string | null;
  readonly processed_at?: unknown | null;
  readonly state?: string;
}

interface ExposureAuthorizationRow extends Record<string, unknown> {
  readonly action_class: ExternalActionClass;
  readonly authorized_by_person_id: string;
  readonly budget_magnitude_kind: ExternalActionBudgetMagnitudeKind;
  readonly budget_reservation_id: string;
  readonly capability_digest: string;
  readonly cost_source_key: string;
  readonly cost_source_version: string;
  readonly evidence_level: 'local_fixture';
  readonly expires_at: unknown;
  readonly financial_exposure_upper_bound_cents: number;
  readonly id: string;
  readonly operation_id: string;
  readonly provider_key: string;
  readonly provider_account_digest: string;
  readonly provider_capability_rule_id: string;
  readonly provider_capability_rule_version: number;
  readonly provider_idempotency_key: string | null;
  readonly provider_idempotency_key_derivation_version: string | null;
  readonly provider_supports_idempotency: boolean;
  readonly used_at: unknown | null;
}

type AttemptEventKind =
  | 'claimed'
  | 'provider_accepted'
  | 'outcome_unknown'
  | 'lease_expired_unknown'
  | 'reconciliation_confirmed_success'
  | 'reconciliation_confirmed_no_effect'
  | 'reconciliation_still_unknown'
  | 'reconciliation_canceled'
  | 'retry_exhausted';

const stableKey = /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/u;
const fingerprint = /^[A-Za-z0-9_-]{43}$/u;
const hexDigest = /^[a-f0-9]{64}$/u;
const actionClasses = new Set<ExternalActionClass>([
  'email',
  'sms',
  'refund',
  'credit',
  'paid_tool',
]);

export type ExternalActionAuthorityClock = (
  transaction: SqlExecutor,
  observedAt: Date,
) => Promise<Date>;

const databaseAuthorityClock: ExternalActionAuthorityClock = async (transaction) => {
  const result = await transaction.query<{ authority_now: unknown } & Record<string, unknown>>(
    'SELECT clock_timestamp() AS authority_now',
  );
  return asDate(result.rows[0]?.authority_now, 'external action database authority time');
};

function assertStableKey(value: string, field: string, minimum: number, maximum: number): void {
  if (value.length < minimum || value.length > maximum || !stableKey.test(value)) {
    throw new DomainError('invalid_input', `External action ${field} is invalid`);
  }
}

function assertFiniteDate(value: Date, field: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DomainError('invalid_input', `External action ${field} is invalid`);
  }
}

function assertScope(scopeKind: ExternalActionScopeKind, scopeId: string): void {
  if (!['company', 'household', 'organization'].includes(scopeKind)) {
    throw new DomainError('invalid_input', 'External action scope is invalid');
  }
  assertStableKey(scopeId, 'scope ID', 2, 200);
  if (scopeKind === 'company' && scopeId !== 'global') {
    throw new DomainError('invalid_input', 'External action company scope is invalid');
  }
}

function assertRegistration(input: RegisterExternalActionInput): void {
  assertStableKey(input.operationId, 'operation ID', 8, 200);
  assertStableKey(input.budgetReservationId, 'budget reservation ID', 8, 200);
  assertStableKey(input.automationActionKey, 'automation action key', 2, 80);
  assertStableKey(input.automationToolKey, 'automation tool key', 2, 80);
  assertStableKey(input.providerKey, 'provider key', 2, 80);
  assertStableKey(input.exposureAuthority.costSourceKey, 'cost source key', 2, 80);
  assertStableKey(input.exposureAuthority.costSourceVersion, 'cost source version', 2, 80);
  assertStableKey(input.originId, 'origin ID', 2, 200);
  assertScope(input.scopeKind, input.scopeId);
  if (input.context.audience !== 'hq' || input.context.actorPersonId === undefined) {
    throw new DomainError('not_authorized', 'External action registration requires an HQ actor');
  }
  if (!actionClasses.has(input.actionClass)) {
    throw new DomainError('invalid_input', 'External action class is invalid');
  }
  if (!fingerprint.test(input.intentFingerprint)) {
    throw new DomainError('invalid_input', 'External action intent fingerprint is invalid');
  }
  if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 5) {
    throw new DomainError('invalid_input', 'External action retry cap must be between 1 and 5');
  }
  assertStableKey(input.exposureAuthority.providerCapabilityRuleId, 'provider rule ID', 8, 200);
  if (input.exposureAuthority.providerSupportsIdempotency) {
    if (
      input.exposureAuthority.providerIdempotencyKey === undefined ||
      input.exposureAuthority.providerIdempotencyKeyDerivationVersion === undefined
    ) {
      throw new DomainError('conflict', 'Reviewed provider idempotency authority is unavailable');
    }
    assertStableKey(
      input.exposureAuthority.providerIdempotencyKey,
      'provider idempotency key',
      8,
      200,
    );
    assertStableKey(
      input.exposureAuthority.providerIdempotencyKeyDerivationVersion,
      'provider idempotency key derivation version',
      2,
      80,
    );
  } else if (
    input.exposureAuthority.providerIdempotencyKey !== undefined ||
    input.exposureAuthority.providerIdempotencyKeyDerivationVersion !== undefined
  ) {
    throw new DomainError('conflict', 'Reviewed provider idempotency authority is invalid');
  }
}

function assertWorkerId(workerId: string): void {
  assertStableKey(workerId, 'worker ID', 2, 100);
}

function outboxScopeMatches(
  row: OriginLeaseRow,
  scopeKind: ExternalActionScopeKind,
  scopeId: string,
): boolean {
  if (scopeKind === 'household') return row.household_id === scopeId;
  return row.aggregate_type === scopeKind && row.aggregate_id === scopeId;
}

async function lockAndValidateOriginLease(
  transaction: SqlExecutor,
  input: {
    readonly originId: string;
    readonly originKind: ExternalActionOriginKind;
    readonly scopeId: string;
    readonly scopeKind: ExternalActionScopeKind;
    readonly workerId: string;
  },
  authorityNow: Date,
): Promise<Date> {
  const selected =
    input.originKind === 'durable_job'
      ? await transaction.query<OriginLeaseRow>(
          `SELECT state, household_id, lease_owner, lease_expires_at
           FROM durable_jobs WHERE id = $1 FOR UPDATE`,
          [input.originId],
        )
      : await transaction.query<OriginLeaseRow>(
          `SELECT aggregate_type, aggregate_id, household_id, processed_at, dead_lettered_at,
                  lease_owner, lease_expires_at
           FROM outbox_events WHERE id = $1 FOR UPDATE`,
          [input.originId],
        );
  const row = selected.rows[0];
  const scopeMatches =
    row !== undefined &&
    (input.originKind === 'durable_job'
      ? input.scopeKind === 'household' && row.household_id === input.scopeId
      : outboxScopeMatches(row, input.scopeKind, input.scopeId));
  const lifecycleMatches =
    row !== undefined &&
    (input.originKind === 'durable_job'
      ? row.state === 'running'
      : row.processed_at === null && row.dead_lettered_at === null);
  if (
    row === undefined ||
    !scopeMatches ||
    !lifecycleMatches ||
    row.lease_owner !== input.workerId ||
    row.lease_expires_at === null
  ) {
    throw new DomainError('conflict', 'External action origin authority is unavailable');
  }
  const expiresAt = asDate(row.lease_expires_at, 'external action origin lease expiry');
  if (expiresAt <= authorityNow) {
    throw new DomainError('conflict', 'External action origin authority is unavailable');
  }
  return expiresAt;
}

function assertProviderEvidence(providerResponseId: string, providerResponseState: string): void {
  assertStableKey(providerResponseId, 'provider response ID', 2, 200);
  assertStableKey(providerResponseState, 'provider response state', 2, 80);
}

function assertErrorCode(errorCode: string): void {
  assertStableKey(errorCode, 'error code', 2, 80);
}

function assertRetryAt(now: Date, retryAt: Date): void {
  assertFiniteDate(now, 'current time');
  assertFiniteDate(retryAt, 'retry time');
  const delay = retryAt.getTime() - now.getTime();
  if (delay < 0 || delay > 24 * 60 * 60_000) {
    throw new DomainError('invalid_input', 'External action retry must be within 24 hours');
  }
}

function assertCostEvidence(evidence: ExternalActionCostEvidence): void {
  if (
    !Number.isSafeInteger(evidence.actualFinancialExposureCents) ||
    evidence.actualFinancialExposureCents < 0 ||
    evidence.currency !== 'USD' ||
    evidence.evidenceLevel !== 'local_fixture' ||
    !fingerprint.test(evidence.digest)
  ) {
    throw new DomainError('invalid_input', 'External action cost evidence is invalid');
  }
  assertStableKey(evidence.reference, 'cost evidence reference', 2, 200);
  assertStableKey(evidence.sourceKey, 'cost source key', 2, 80);
  assertStableKey(evidence.sourceVersion, 'cost source version', 2, 80);
}

function magnitudeKindForAction(
  actionClass: ExternalActionClass,
): ExternalActionBudgetMagnitudeKind {
  return actionClass === 'refund'
    ? 'refund_principal'
    : actionClass === 'credit'
      ? 'credit_principal'
      : 'provider_cost';
}

function assertMagnitudeEvidenceForAction(
  row: ExternalActionRow,
  evidence: ExternalActionCostEvidence,
): void {
  if (
    evidence.budgetMagnitudeKind !== row.budget_magnitude_kind ||
    ((row.action_class === 'refund' || row.action_class === 'credit') &&
      evidence.actualFinancialExposureCents <= 0)
  ) {
    throw new DomainError(
      'conflict',
      'External action financial exposure evidence does not match its envelope',
    );
  }
}

function newCapabilityToken(): string {
  return randomBytes(32).toString('base64url');
}

function capabilityDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function deriveProviderIdempotencyKey(input: {
  readonly actionClass: ExternalActionClass;
  readonly derivationVersion: string;
  readonly operationId: string;
  readonly providerAccountDigest: string;
  readonly providerKey: string;
}): string {
  const digest = createHash('sha256')
    .update(
      [
        input.derivationVersion,
        input.providerKey,
        input.providerAccountDigest,
        input.actionClass,
        input.operationId,
      ].join('\u0000'),
    )
    .digest('base64url');
  return `bb:${input.derivationVersion}:${digest}`;
}

function secureDigestMatches(token: string, expected: string): boolean {
  if (!fingerprint.test(token) || !hexDigest.test(expected)) return false;
  const actual = Buffer.from(capabilityDigest(token), 'hex');
  const stored = Buffer.from(expected, 'hex');
  return actual.length === stored.length && timingSafeEqual(actual, stored);
}

function mapExternalAction(row: ExternalActionRow): ExternalAction {
  return {
    actionClass: row.action_class,
    attempts: row.attempts,
    automationActionKey: row.automation_action_key,
    automationToolKey: row.automation_tool_key,
    budgetEnvelopeDigest: row.budget_envelope_digest,
    budgetMagnitudeKind: row.budget_magnitude_kind,
    budgetReservationId: row.budget_reservation_id,
    correlationId: row.correlation_id,
    costCurrency: row.cost_currency,
    costSourceKey: row.cost_source_key,
    costSourceVersion: row.cost_source_version,
    financialExposureUpperBoundCents: row.financial_exposure_upper_bound_cents,
    createdAt: asDate(row.created_at, 'external action created at'),
    effectState: row.effect_state,
    exposureAuthorizationId: row.exposure_authorization_id,
    exposureEvidenceLevel: row.exposure_evidence_level,
    intentFingerprint: row.intent_fingerprint,
    maxAttempts: row.max_attempts,
    nextAttemptAt: asDate(row.next_attempt_at, 'external action next attempt'),
    operationId: row.operation_id,
    originId: row.origin_id,
    originKind: row.origin_kind,
    ...(row.provider_idempotency_key === null
      ? {}
      : { providerIdempotencyKey: row.provider_idempotency_key }),
    ...(row.provider_idempotency_key_derivation_version === null
      ? {}
      : {
          providerIdempotencyKeyDerivationVersion: row.provider_idempotency_key_derivation_version,
        }),
    providerCapabilityRuleId: row.provider_capability_rule_id,
    providerCapabilityRuleVersion: row.provider_capability_rule_version,
    providerKey: row.provider_key,
    providerAccountDigest: row.provider_account_digest,
    ...(row.provider_normalized_outcome === null
      ? {}
      : { providerNormalizedOutcome: row.provider_normalized_outcome }),
    ...(row.provider_response_id === null ? {} : { providerResponseId: row.provider_response_id }),
    ...(row.provider_response_state === null
      ? {}
      : { providerResponseState: row.provider_response_state }),
    providerSupportsIdempotency: row.provider_supports_idempotency,
    registeredByPersonId: row.registered_by_person_id,
    retrySuppressed: row.retry_suppressed,
    scopeId: row.scope_id,
    scopeKind: row.scope_kind,
    state: row.state,
    updatedAt: asDate(row.updated_at, 'external action updated at'),
  };
}

const projection = `
  SELECT operation_id, budget_reservation_id, exposure_authorization_id,
         budget_envelope_digest,
         automation_action_key, automation_tool_key, financial_exposure_upper_bound_cents,
         budget_magnitude_kind,
         cost_currency, cost_source_key, cost_source_version, exposure_evidence_level,
         scope_kind, scope_id,
         origin_kind, origin_id, registered_by_person_id, action_class, provider_key,
         provider_account_digest,
         provider_capability_rule_id, provider_capability_rule_version,
         provider_supports_idempotency, provider_idempotency_key,
         provider_idempotency_key_derivation_version, intent_fingerprint,
         state, effect_state, retry_suppressed, attempts, max_attempts, next_attempt_at, lease_owner,
         lease_expires_at, transition_capability_digest, transition_capability_expires_at,
         provider_response_id, provider_response_state, provider_normalized_outcome,
         correlation_id, created_at, updated_at
  FROM external_actions
`;

async function lockControl(transaction: SqlExecutor): Promise<ControlRow> {
  const result = await transaction.query<ControlRow>(
    `SELECT kill_switch, version FROM automation_global_control
     WHERE control_key = 'global' FOR UPDATE`,
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('Global automation control is unavailable');
  return row;
}

async function lockInternalOwnerAuthority(
  transaction: SqlExecutor,
  personId: string,
): Promise<boolean> {
  const selected = await transaction.query(
    `SELECT employee.id
     FROM employee_assignments employee
     JOIN organizations organization ON organization.id = employee.organization_id
     WHERE employee.person_id = $1
       AND employee.role = 'hq_owner' AND employee.status = 'active'
       AND organization.kind = 'internal'
     ORDER BY employee.id LIMIT 1
     FOR UPDATE OF employee, organization`,
    [personId],
  );
  return selected.rows[0] !== undefined;
}

async function lockReservation(
  transaction: SqlExecutor,
  budgetReservationId: string,
): Promise<ReservationRow> {
  const result = await transaction.query<ReservationRow>(
    `SELECT id, operation_key, envelope_digest, policy_id, policy_version, agent_key,
            action_key, tool_key, data_classes, state, expires_at, execution_rechecked_at,
            execution_authorization_expires_at, control_version, estimated_cost_cents
     FROM automation_budget_reservations WHERE id = $1 FOR UPDATE`,
    [budgetReservationId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new DomainError('conflict', 'External action authority is unavailable');
  }
  return row;
}

async function lockScopedAction(
  transaction: SqlExecutor,
  input: {
    readonly budgetReservationId: string;
    readonly operationId: string;
    readonly scopeId: string;
    readonly scopeKind: ExternalActionScopeKind;
  },
): Promise<ExternalActionRow> {
  const selected = await transaction.query<ExternalActionRow>(
    `${projection}
     WHERE operation_id = $1 AND budget_reservation_id = $2
       AND scope_kind = $3 AND scope_id = $4
     FOR UPDATE`,
    [input.operationId, input.budgetReservationId, input.scopeKind, input.scopeId],
  );
  const row = selected.rows[0];
  if (row === undefined) {
    throw new DomainError('conflict', 'External action scope is unavailable');
  }
  return row;
}

async function assertCurrentDispatchAuthority(
  transaction: SqlExecutor,
  input: {
    readonly budgetReservationId: string;
    readonly now: Date;
    readonly operationId: string;
  },
): Promise<{
  readonly authorizationExpiresAt: Date;
  readonly control: ControlRow;
  readonly recheckedAt: Date;
  readonly reservation: ReservationRow;
}> {
  const control = await lockControl(transaction);
  const reservation = await lockReservation(transaction, input.budgetReservationId);
  const policyResult = await transaction.query<PolicyRow>(
    'SELECT id, version, enabled FROM autonomy_policies WHERE id = $1 FOR UPDATE',
    [reservation.policy_id],
  );
  const allocations = await transaction.query<AllocationRow>(
    `SELECT cap_id, cap_version, period_start, reserved_cents
     FROM automation_budget_reservation_allocations
     WHERE reservation_id = $1 ORDER BY cap_id`,
    [reservation.id],
  );
  const caps = await transaction.query<CapRow>(
    `SELECT id, version, scope_kind, scope_key FROM automation_budget_caps
     WHERE enabled = true AND (
       (scope_kind = 'company' AND scope_key = 'global') OR
       (scope_kind = 'agent' AND scope_key = $1) OR
       (scope_kind = 'action' AND scope_key = $2) OR
       (scope_kind = 'tool' AND scope_key = $3) OR
       (scope_kind = 'policy' AND scope_key = $4)
     ) ORDER BY id FOR UPDATE`,
    [reservation.agent_key, reservation.action_key, reservation.tool_key, reservation.policy_id],
  );
  for (const allocation of allocations.rows) {
    const window = await transaction.query(
      `SELECT cap_id FROM automation_budget_windows
       WHERE cap_id = $1 AND period_start = $2 AND reserved_cents >= $3 FOR UPDATE`,
      [
        allocation.cap_id,
        asDate(allocation.period_start, 'budget period').toISOString(),
        allocation.reserved_cents,
      ],
    );
    if (window.rows[0] === undefined) {
      throw new DomainError('conflict', 'External action authority is unavailable');
    }
  }
  const policy = policyResult.rows[0];
  const allocationVersions = new Map(
    allocations.rows.map((allocation) => [allocation.cap_id, allocation.cap_version]),
  );
  const capEnvelopeCurrent =
    caps.rows.length === allocations.rows.length &&
    caps.rows.every((cap) => allocationVersions.get(cap.id) === cap.version);
  const recheckedAt =
    reservation.execution_rechecked_at === null
      ? undefined
      : asDate(reservation.execution_rechecked_at, 'automation recheck time');
  const authorizationExpiresAt =
    reservation.execution_authorization_expires_at === null
      ? undefined
      : asDate(reservation.execution_authorization_expires_at, 'automation authorization expiry');
  if (
    control.kill_switch ||
    reservation.state !== 'reserved' ||
    reservation.operation_key !== input.operationId ||
    asDate(reservation.expires_at, 'automation reservation expiry') <= input.now ||
    reservation.control_version !== control.version ||
    policy === undefined ||
    !policy.enabled ||
    policy.id !== reservation.policy_id ||
    policy.version !== reservation.policy_version ||
    !capEnvelopeCurrent ||
    recheckedAt === undefined ||
    authorizationExpiresAt === undefined ||
    recheckedAt > input.now ||
    authorizationExpiresAt < input.now
  ) {
    throw new DomainError('conflict', 'External action authority is unavailable');
  }
  return { authorizationExpiresAt, control, recheckedAt, reservation };
}

async function recordAttempt(
  transaction: SqlExecutor,
  ids: IdFactory,
  input: {
    readonly attempt: number;
    readonly acceptanceRule?: { readonly id: string; readonly version: number };
    readonly budgetAuthorizationExpiresAt?: Date;
    readonly budgetControlVersion?: number;
    readonly budgetRecheckedAt?: Date;
    readonly budgetReservationId?: string;
    readonly errorCode?: string;
    readonly costEvidence?: ExternalActionCostEvidence;
    readonly eventKind: AttemptEventKind;
    readonly now: Date;
    readonly operationId: string;
    readonly providerNormalizedOutcome?: 'accepted';
    readonly providerResponseId?: string;
    readonly providerResponseState?: string;
    readonly reconciliationActorPersonId?: string;
    readonly reconciliationAudience?: 'hq';
    readonly reconciliationAuthorizationId?: string;
    readonly reconciliationEvidence?: ExternalActionReconciliationEvidence;
    readonly transitionCapabilityDigest?: string;
    readonly workerId: string;
  },
): Promise<void> {
  await transaction.query(
    `INSERT INTO external_action_attempts(
       id, operation_id, attempt, event_kind, worker_id, transition_capability_digest,
       budget_reservation_id, budget_control_version, budget_rechecked_at,
       budget_authorization_expires_at, provider_response_id, provider_response_state,
       provider_normalized_outcome, acceptance_rule_id, acceptance_rule_version,
       error_code, actual_financial_exposure_cents,
       budget_magnitude_kind, cost_currency,
       cost_source_key, cost_source_version, cost_evidence_level,
       cost_evidence_reference, cost_evidence_digest,
       reconciliation_evidence_kind,
       reconciliation_evidence_reference, reconciliation_evidence_digest,
       reconciliation_evidence_observed_at, reconciliation_provider_key,
       reconciliation_provider_account_digest, reconciliation_authorization_id,
       reconciliation_actor_person_id, reconciliation_audience, occurred_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
     )`,
    [
      ids.next('external-action-attempt'),
      input.operationId,
      input.attempt,
      input.eventKind,
      input.workerId,
      input.transitionCapabilityDigest ?? null,
      input.budgetReservationId ?? null,
      input.budgetControlVersion ?? null,
      input.budgetRecheckedAt?.toISOString() ?? null,
      input.budgetAuthorizationExpiresAt?.toISOString() ?? null,
      input.providerResponseId ?? null,
      input.providerResponseState ?? null,
      input.providerNormalizedOutcome ?? null,
      input.acceptanceRule?.id ?? null,
      input.acceptanceRule?.version ?? null,
      input.errorCode ?? null,
      input.costEvidence?.actualFinancialExposureCents ?? null,
      input.costEvidence?.budgetMagnitudeKind ?? null,
      input.costEvidence?.currency ?? null,
      input.costEvidence?.sourceKey ?? null,
      input.costEvidence?.sourceVersion ?? null,
      input.costEvidence?.evidenceLevel ?? null,
      input.costEvidence?.reference ?? null,
      input.costEvidence?.digest ?? null,
      input.reconciliationEvidence?.kind ?? null,
      input.reconciliationEvidence?.reference ?? null,
      input.reconciliationEvidence?.digest ?? null,
      input.reconciliationEvidence?.observedAt.toISOString() ?? null,
      input.reconciliationEvidence?.providerKey ?? null,
      input.reconciliationEvidence?.providerAccountDigest ?? null,
      input.reconciliationAuthorizationId ?? null,
      input.reconciliationActorPersonId ?? null,
      input.reconciliationAudience ?? null,
      input.now.toISOString(),
    ],
  );
}

interface AcceptanceRuleSnapshot extends Record<string, unknown> {
  readonly id: string;
  readonly provider_response_state: string;
  readonly version: number;
}

interface ReviewedProviderRuleRow extends AcceptanceRuleSnapshot {
  readonly idempotency_key_derivation_version: string | null;
  readonly provider_account_digest: string;
  readonly provider_key: string;
  readonly provider_supports_idempotency: boolean;
}

async function lockCurrentDispatchAcceptanceRule(
  transaction: SqlExecutor,
  row: ExternalActionRow,
): Promise<AcceptanceRuleSnapshot> {
  const selected = await transaction.query<AcceptanceRuleSnapshot>(
    `SELECT id, version, provider_response_state
     FROM external_action_provider_acceptance_rules
     WHERE id = $1 AND version = $2
       AND provider_key = $3 AND provider_account_digest = $4 AND action_class = $5
       AND normalized_outcome = 'accepted' AND enabled = true
     ORDER BY id FOR UPDATE`,
    [
      row.provider_capability_rule_id,
      row.provider_capability_rule_version,
      row.provider_key,
      row.provider_account_digest,
      row.action_class,
    ],
  );
  if (selected.rows.length !== 1) {
    throw new DomainError(
      'conflict',
      'External action dispatch requires one reviewed provider acceptance mapping',
    );
  }
  return selected.rows[0]!;
}

async function getDispatchAcceptanceRule(
  transaction: SqlExecutor,
  operationId: string,
  attempt: number,
): Promise<AcceptanceRuleSnapshot> {
  const selected = await transaction.query<AcceptanceRuleSnapshot>(
    `SELECT rule.rule_id AS id, rule.version, rule.provider_response_state
     FROM external_action_attempts claim
     JOIN external_action_provider_acceptance_rule_versions rule
       ON rule.rule_id = claim.acceptance_rule_id
      AND rule.version = claim.acceptance_rule_version
     WHERE claim.operation_id = $1 AND claim.attempt = $2
       AND claim.event_kind = 'claimed'
     ORDER BY claim.occurred_at DESC, claim.id DESC
     LIMIT 1`,
    [operationId, attempt],
  );
  const rule = selected.rows[0];
  if (rule === undefined) {
    throw new DomainError('conflict', 'External action dispatch normalization is unavailable');
  }
  return rule;
}

function sameRegistration(
  row: ExternalActionRow,
  input: RegisterExternalActionInput,
  envelopeDigest: string,
): boolean {
  return (
    row.budget_reservation_id === input.budgetReservationId &&
    row.exposure_authorization_id === input.exposureAuthority.authorizationId &&
    row.budget_envelope_digest === envelopeDigest &&
    row.automation_action_key === input.automationActionKey &&
    row.automation_tool_key === input.automationToolKey &&
    row.financial_exposure_upper_bound_cents >= 0 &&
    row.budget_magnitude_kind === magnitudeKindForAction(input.actionClass) &&
    row.cost_currency === 'USD' &&
    row.cost_source_key === input.exposureAuthority.costSourceKey &&
    row.cost_source_version === input.exposureAuthority.costSourceVersion &&
    row.exposure_evidence_level === input.exposureAuthority.evidenceLevel &&
    row.scope_kind === input.scopeKind &&
    row.scope_id === input.scopeId &&
    row.origin_kind === input.originKind &&
    row.origin_id === input.originId &&
    row.registered_by_person_id === input.context.actorPersonId &&
    row.action_class === input.actionClass &&
    row.provider_key === input.providerKey &&
    row.provider_account_digest === input.exposureAuthority.providerAccountDigest &&
    row.provider_capability_rule_id === input.exposureAuthority.providerCapabilityRuleId &&
    row.provider_capability_rule_version ===
      input.exposureAuthority.providerCapabilityRuleVersion &&
    row.provider_supports_idempotency === input.exposureAuthority.providerSupportsIdempotency &&
    row.provider_idempotency_key === (input.exposureAuthority.providerIdempotencyKey ?? null) &&
    row.provider_idempotency_key_derivation_version ===
      (input.exposureAuthority.providerIdempotencyKeyDerivationVersion ?? null) &&
    row.intent_fingerprint === input.intentFingerprint &&
    row.max_attempts === input.maxAttempts
  );
}

function assertDispatchCapability(
  row: ExternalActionRow,
  capability: ExternalActionDispatchCapability,
  now: Date,
): void {
  const expiresAt = asDate(
    row.transition_capability_expires_at,
    'external action transition capability expiry',
  );
  if (
    row.state !== 'in_flight' ||
    row.attempts !== capability.attempt ||
    row.lease_owner !== capability.workerId ||
    row.operation_id !== capability.operationId ||
    row.budget_reservation_id !== capability.budgetReservationId ||
    row.scope_kind !== capability.scopeKind ||
    row.scope_id !== capability.scopeId ||
    row.transition_capability_digest === null ||
    !secureDigestMatches(capability.token, row.transition_capability_digest) ||
    expiresAt < now
  ) {
    throw new DomainError('conflict', 'External action transition authority is unavailable');
  }
}

export class ExternalActionRepository {
  constructor(
    private readonly database: Database,
    private readonly ids: IdFactory = randomIdFactory,
    private readonly founderPersonId?: string,
    /** @internal Deterministic transaction clock seam for isolated repository tests only. */
    private readonly authorityClock: ExternalActionAuthorityClock = databaseAuthorityClock,
  ) {}

  async putProviderAcceptanceRule(input: {
    readonly actionClass: ExternalActionClass;
    readonly context: OperationalEventContext;
    readonly enabled: boolean;
    readonly idempotencyKeyDerivationVersion?: string;
    readonly providerAccountDigest: string;
    readonly providerKey: string;
    readonly providerResponseState: string;
    readonly providerSupportsIdempotency: boolean;
  }): Promise<string> {
    if (
      input.context.audience !== 'hq' ||
      input.context.actorPersonId === undefined ||
      this.founderPersonId === undefined ||
      input.context.actorPersonId !== this.founderPersonId
    ) {
      throw new DomainError('not_authorized', 'Provider outcome review requires the founder');
    }
    assertStableKey(input.providerKey, 'provider key', 2, 80);
    assertStableKey(input.providerResponseState, 'provider response state', 2, 80);
    if (!fingerprint.test(input.providerAccountDigest)) {
      throw new DomainError('invalid_input', 'External action provider account digest is invalid');
    }
    if (input.providerSupportsIdempotency) {
      if (input.idempotencyKeyDerivationVersion === undefined) {
        throw new DomainError(
          'invalid_input',
          'Reviewed idempotent provider metadata requires a key derivation version',
        );
      }
      assertStableKey(
        input.idempotencyKeyDerivationVersion,
        'provider idempotency key derivation version',
        2,
        80,
      );
    } else if (input.idempotencyKeyDerivationVersion !== undefined) {
      throw new DomainError(
        'invalid_input',
        'Non-idempotent provider metadata cannot advertise key derivation',
      );
    }
    if (!actionClasses.has(input.actionClass)) {
      throw new DomainError('invalid_input', 'External action class is invalid');
    }
    return this.database.transaction(async (transaction) => {
      const control = await lockControl(transaction);
      const authorityNow = await this.authorityClock(transaction, input.context.now);
      if (!control.kill_switch) {
        throw new DomainError(
          'conflict',
          'Engage the global automation stop before reviewing provider outcomes',
        );
      }
      const owner = await lockInternalOwnerAuthority(transaction, input.context.actorPersonId!);
      if (!owner) {
        throw new DomainError('not_authorized', 'Provider outcome review requires the founder');
      }
      const existing = await transaction.query<
        { id: string; version: number } & Record<string, unknown>
      >(
        `SELECT id, version FROM external_action_provider_acceptance_rules
         WHERE provider_key = $1 AND provider_account_digest = $2
           AND action_class = $3 AND provider_response_state = $4
         FOR UPDATE`,
        [
          input.providerKey,
          input.providerAccountDigest,
          input.actionClass,
          input.providerResponseState,
        ],
      );
      const current = existing.rows[0];
      const ruleId = current?.id ?? this.ids.next('external-action-acceptance-rule');
      const version = (current?.version ?? 0) + 1;
      if (current === undefined) {
        await transaction.query(
          `INSERT INTO external_action_provider_acceptance_rules(
             id, provider_key, provider_account_digest, action_class,
             provider_response_state, normalized_outcome, provider_supports_idempotency,
             idempotency_key_derivation_version,
             enabled, version, reviewed_by_person_id, reviewed_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,'accepted',$6,$7,$8,$9,$10,$11,$11)`,
          [
            ruleId,
            input.providerKey,
            input.providerAccountDigest,
            input.actionClass,
            input.providerResponseState,
            input.providerSupportsIdempotency,
            input.idempotencyKeyDerivationVersion ?? null,
            input.enabled,
            version,
            input.context.actorPersonId,
            authorityNow.toISOString(),
          ],
        );
      } else {
        await transaction.query(
          `UPDATE external_action_provider_acceptance_rules
           SET provider_supports_idempotency = $2,
               idempotency_key_derivation_version = $3,
               enabled = $4, version = $5, reviewed_by_person_id = $6,
               reviewed_at = $7, updated_at = $7 WHERE id = $1`,
          [
            ruleId,
            input.providerSupportsIdempotency,
            input.idempotencyKeyDerivationVersion ?? null,
            input.enabled,
            version,
            input.context.actorPersonId,
            authorityNow.toISOString(),
          ],
        );
      }
      await transaction.query(
        `INSERT INTO external_action_provider_acceptance_rule_versions(
           id, rule_id, provider_key, provider_account_digest, action_class,
           provider_response_state, normalized_outcome, provider_supports_idempotency,
           idempotency_key_derivation_version,
           enabled, version, reviewed_by_person_id, recorded_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'accepted',$7,$8,$9,$10,$11,$12)`,
        [
          this.ids.next('external-action-acceptance-rule-version'),
          ruleId,
          input.providerKey,
          input.providerAccountDigest,
          input.actionClass,
          input.providerResponseState,
          input.providerSupportsIdempotency,
          input.idempotencyKeyDerivationVersion ?? null,
          input.enabled,
          version,
          input.context.actorPersonId,
          authorityNow.toISOString(),
        ],
      );
      return ruleId;
    });
  }

  async authorizeLocalFixtureExposure(input: {
    readonly actionClass: ExternalActionClass;
    readonly budgetReservationId: string;
    readonly context: OperationalEventContext;
    readonly costSourceKey: string;
    readonly costSourceVersion: string;
    readonly operationId: string;
    readonly providerAccountDigest: string;
    readonly providerKey: string;
  }): Promise<ExternalActionExposureCapability> {
    if (
      input.context.audience !== 'hq' ||
      input.context.actorPersonId === undefined ||
      this.founderPersonId === undefined ||
      input.context.actorPersonId !== this.founderPersonId
    ) {
      throw new DomainError(
        'not_authorized',
        'Local fixture exposure authorization requires the founder',
      );
    }
    assertStableKey(input.operationId, 'operation ID', 8, 200);
    assertStableKey(input.budgetReservationId, 'budget reservation ID', 8, 200);
    assertStableKey(input.providerKey, 'provider key', 2, 80);
    if (!fingerprint.test(input.providerAccountDigest)) {
      throw new DomainError('invalid_input', 'External action provider account digest is invalid');
    }
    assertStableKey(input.costSourceKey, 'cost source key', 2, 80);
    assertStableKey(input.costSourceVersion, 'cost source version', 2, 80);
    if (!actionClasses.has(input.actionClass)) {
      throw new DomainError('invalid_input', 'External action class is invalid');
    }
    const token = newCapabilityToken();
    const authorizationId = this.ids.next('external-action-exposure-authorization');
    const authority = await this.database.transaction(async (transaction) => {
      await lockControl(transaction);
      const authorityNow = await this.authorityClock(transaction, input.context.now);
      const reservation = await lockReservation(transaction, input.budgetReservationId);
      const owner = await lockInternalOwnerAuthority(transaction, input.context.actorPersonId!);
      const reservationExpiresAt = asDate(reservation.expires_at, 'automation reservation expiry');
      if (
        !owner ||
        reservation.state !== 'reserved' ||
        reservation.operation_key !== input.operationId ||
        reservationExpiresAt <= authorityNow ||
        ((input.actionClass === 'refund' || input.actionClass === 'credit') &&
          reservation.estimated_cost_cents <= 0)
      ) {
        throw new DomainError('conflict', 'External action budget envelope is unavailable');
      }
      const expiresAt = new Date(
        Math.min(reservationExpiresAt.getTime(), authorityNow.getTime() + 5 * 60_000),
      );
      const budgetMagnitudeKind = magnitudeKindForAction(input.actionClass);
      const providerRules = await transaction.query<ReviewedProviderRuleRow>(
        `SELECT id, version, provider_key, provider_account_digest,
                provider_response_state, provider_supports_idempotency,
                idempotency_key_derivation_version
         FROM external_action_provider_acceptance_rules
         WHERE provider_key = $1 AND provider_account_digest = $2
           AND action_class = $3 AND normalized_outcome = 'accepted' AND enabled = true
         ORDER BY id FOR UPDATE`,
        [input.providerKey, input.providerAccountDigest, input.actionClass],
      );
      if (providerRules.rows.length !== 1) {
        throw new DomainError(
          'conflict',
          'Local fixture exposure requires one reviewed provider/account/action rule',
        );
      }
      const providerRule = providerRules.rows[0]!;
      const providerIdempotencyKeyDerivationVersion =
        providerRule.idempotency_key_derivation_version;
      if (
        providerRule.provider_supports_idempotency &&
        providerIdempotencyKeyDerivationVersion === null
      ) {
        throw new DomainError('conflict', 'Reviewed provider idempotency metadata is invalid');
      }
      const providerIdempotencyKey = providerRule.provider_supports_idempotency
        ? deriveProviderIdempotencyKey({
            actionClass: input.actionClass,
            derivationVersion: providerIdempotencyKeyDerivationVersion!,
            operationId: input.operationId,
            providerAccountDigest: input.providerAccountDigest,
            providerKey: input.providerKey,
          })
        : null;
      await transaction.query(
        `INSERT INTO external_action_exposure_authorizations(
           id, budget_reservation_id, operation_id, action_class, provider_key,
           provider_account_digest,
           provider_capability_rule_id, provider_capability_rule_version,
           provider_supports_idempotency, provider_idempotency_key,
           provider_idempotency_key_derivation_version,
           financial_exposure_upper_bound_cents, budget_magnitude_kind, cost_currency,
           cost_source_key, cost_source_version, evidence_level, capability_digest,
           authorized_by_person_id, created_at, expires_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'USD',$14,$15,
           'local_fixture',$16,$17,$18,$19
         )`,
        [
          authorizationId,
          input.budgetReservationId,
          input.operationId,
          input.actionClass,
          input.providerKey,
          input.providerAccountDigest,
          providerRule.id,
          providerRule.version,
          providerRule.provider_supports_idempotency,
          providerIdempotencyKey,
          providerIdempotencyKeyDerivationVersion,
          reservation.estimated_cost_cents,
          budgetMagnitudeKind,
          input.costSourceKey,
          input.costSourceVersion,
          capabilityDigest(token),
          input.context.actorPersonId,
          authorityNow.toISOString(),
          expiresAt.toISOString(),
        ],
      );
      return {
        budgetMagnitudeKind,
        expiresAt,
        financialExposureUpperBoundCents: reservation.estimated_cost_cents,
        providerCapabilityRuleId: providerRule.id,
        providerCapabilityRuleVersion: providerRule.version,
        providerIdempotencyKey,
        providerIdempotencyKeyDerivationVersion,
        providerSupportsIdempotency: providerRule.provider_supports_idempotency,
      };
    });
    return {
      actionClass: input.actionClass,
      authorizationId,
      budgetMagnitudeKind: authority.budgetMagnitudeKind,
      budgetReservationId: input.budgetReservationId,
      costSourceKey: input.costSourceKey,
      costSourceVersion: input.costSourceVersion,
      evidenceLevel: 'local_fixture',
      expiresAt: authority.expiresAt,
      financialExposureUpperBoundCents: authority.financialExposureUpperBoundCents,
      operationId: input.operationId,
      providerCapabilityRuleId: authority.providerCapabilityRuleId,
      providerCapabilityRuleVersion: authority.providerCapabilityRuleVersion,
      ...(authority.providerIdempotencyKey === null
        ? {}
        : { providerIdempotencyKey: authority.providerIdempotencyKey }),
      ...(authority.providerIdempotencyKeyDerivationVersion === null
        ? {}
        : {
            providerIdempotencyKeyDerivationVersion:
              authority.providerIdempotencyKeyDerivationVersion,
          }),
      providerAccountDigest: input.providerAccountDigest,
      providerKey: input.providerKey,
      providerSupportsIdempotency: authority.providerSupportsIdempotency,
      token,
    } as ExternalActionExposureCapability;
  }

  async register(input: RegisterExternalActionInput): Promise<ExternalAction> {
    assertRegistration(input);
    return this.database.transaction(async (transaction) => {
      await lockControl(transaction);
      const authorityNow = await this.authorityClock(transaction, input.context.now);
      const reservation = await lockReservation(transaction, input.budgetReservationId);
      const owner = await lockInternalOwnerAuthority(transaction, input.context.actorPersonId!);
      const exposure = await transaction.query<ExposureAuthorizationRow>(
        `SELECT * FROM external_action_exposure_authorizations
         WHERE id = $1 AND budget_reservation_id = $2 AND operation_id = $3
         FOR UPDATE`,
        [input.exposureAuthority.authorizationId, input.budgetReservationId, input.operationId],
      );
      const exposureAuthority = exposure.rows[0];
      const existing = await transaction.query<ExternalActionRow>(
        `${projection} WHERE operation_id = $1 FOR UPDATE`,
        [input.operationId],
      );
      const prior = existing.rows[0];
      if (
        !owner ||
        exposureAuthority === undefined ||
        exposureAuthority.authorized_by_person_id !== input.context.actorPersonId ||
        exposureAuthority.action_class !== input.actionClass ||
        exposureAuthority.provider_key !== input.providerKey ||
        exposureAuthority.provider_account_digest !==
          input.exposureAuthority.providerAccountDigest ||
        exposureAuthority.provider_capability_rule_id !==
          input.exposureAuthority.providerCapabilityRuleId ||
        exposureAuthority.provider_capability_rule_version !==
          input.exposureAuthority.providerCapabilityRuleVersion ||
        exposureAuthority.provider_supports_idempotency !==
          input.exposureAuthority.providerSupportsIdempotency ||
        exposureAuthority.provider_idempotency_key !==
          (input.exposureAuthority.providerIdempotencyKey ?? null) ||
        exposureAuthority.provider_idempotency_key_derivation_version !==
          (input.exposureAuthority.providerIdempotencyKeyDerivationVersion ?? null) ||
        exposureAuthority.financial_exposure_upper_bound_cents !==
          reservation.estimated_cost_cents ||
        exposureAuthority.budget_magnitude_kind !== magnitudeKindForAction(input.actionClass) ||
        exposureAuthority.cost_source_key !== input.exposureAuthority.costSourceKey ||
        exposureAuthority.cost_source_version !== input.exposureAuthority.costSourceVersion ||
        exposureAuthority.evidence_level !== 'local_fixture' ||
        !secureDigestMatches(input.exposureAuthority.token, exposureAuthority.capability_digest) ||
        asDate(exposureAuthority.expires_at, 'exposure authorization expiry') <= authorityNow ||
        (exposureAuthority.used_at !== null && prior === undefined) ||
        reservation.operation_key !== input.operationId ||
        reservation.action_key !== input.automationActionKey ||
        reservation.tool_key !== input.automationToolKey ||
        reservation.state !== 'reserved' ||
        ((input.actionClass === 'refund' || input.actionClass === 'credit') &&
          reservation.estimated_cost_cents <= 0) ||
        asDate(reservation.expires_at, 'automation reservation expiry') <= authorityNow
      ) {
        throw new DomainError('conflict', 'External action budget envelope is unavailable');
      }
      if (prior !== undefined) {
        if (!sameRegistration(prior, input, reservation.envelope_digest)) {
          throw new DomainError('conflict', 'External action operation ID has conflicting intent');
        }
        return mapExternalAction(prior);
      }
      await transaction.query(
        `INSERT INTO external_actions(
           operation_id, budget_reservation_id, exposure_authorization_id,
           budget_envelope_digest,
           automation_action_key, automation_tool_key, financial_exposure_upper_bound_cents,
           budget_magnitude_kind, cost_currency, cost_source_key, cost_source_version,
           exposure_evidence_level,
           scope_kind, scope_id,
           origin_kind, origin_id, registered_by_person_id, registration_audience,
           action_class, provider_key, provider_account_digest,
           provider_capability_rule_id, provider_capability_rule_version,
           provider_supports_idempotency, provider_idempotency_key,
           provider_idempotency_key_derivation_version,
           intent_fingerprint, state, effect_state,
           retry_suppressed, attempts, max_attempts, next_attempt_at, correlation_id, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,'USD',$9,$10,'local_fixture',$11,$12,$13,$14,$15,'hq',
           $16,$17,$18,$19,$20,$21,$22,$23,$24,'pending','not_dispatched',false,0,
           $25,$26,$27,$26,$26
         )`,
        [
          input.operationId,
          input.budgetReservationId,
          input.exposureAuthority.authorizationId,
          reservation.envelope_digest,
          input.automationActionKey,
          input.automationToolKey,
          reservation.estimated_cost_cents,
          magnitudeKindForAction(input.actionClass),
          input.exposureAuthority.costSourceKey,
          input.exposureAuthority.costSourceVersion,
          input.scopeKind,
          input.scopeId,
          input.originKind,
          input.originId,
          input.context.actorPersonId,
          input.actionClass,
          input.providerKey,
          input.exposureAuthority.providerAccountDigest,
          input.exposureAuthority.providerCapabilityRuleId,
          input.exposureAuthority.providerCapabilityRuleVersion,
          input.exposureAuthority.providerSupportsIdempotency,
          input.exposureAuthority.providerIdempotencyKey ?? null,
          input.exposureAuthority.providerIdempotencyKeyDerivationVersion ?? null,
          input.intentFingerprint,
          input.maxAttempts,
          authorityNow.toISOString(),
          input.context.correlationId,
        ],
      );
      const inserted = await transaction.query<ExternalActionRow>(
        `${projection} WHERE operation_id = $1`,
        [input.operationId],
      );
      return mapExternalAction(inserted.rows[0]!);
    });
  }

  async find(input: {
    readonly operationId: string;
    readonly scopeId: string;
    readonly scopeKind: ExternalActionScopeKind;
  }): Promise<ExternalAction | null> {
    assertStableKey(input.operationId, 'operation ID', 8, 200);
    assertScope(input.scopeKind, input.scopeId);
    const selected = await this.database.query<ExternalActionRow>(
      `${projection} WHERE operation_id = $1 AND scope_kind = $2 AND scope_id = $3`,
      [input.operationId, input.scopeKind, input.scopeId],
    );
    const row = selected.rows[0];
    return row === undefined ? null : mapExternalAction(row);
  }

  async authorizeOriginLease(input: {
    readonly now: Date;
    readonly originId: string;
    readonly originKind: ExternalActionOriginKind;
    readonly scopeId: string;
    readonly scopeKind: ExternalActionScopeKind;
    readonly workerId: string;
  }): Promise<ExternalActionOriginLeaseCapability> {
    assertFiniteDate(input.now, 'origin authority observation time');
    assertStableKey(input.originId, 'origin ID', 2, 200);
    assertScope(input.scopeKind, input.scopeId);
    assertWorkerId(input.workerId);
    const result = await this.database.transaction(async (transaction) => {
      await lockControl(transaction);
      const authorityNow = await this.authorityClock(transaction, input.now);
      const expiresAt = await lockAndValidateOriginLease(transaction, input, authorityNow);
      return { authorityNow, expiresAt };
    });
    return {
      expiresAt: result.expiresAt,
      issuedAt: result.authorityNow,
      originId: input.originId,
      originKind: input.originKind,
      scopeId: input.scopeId,
      scopeKind: input.scopeKind,
      workerId: input.workerId,
    } as ExternalActionOriginLeaseCapability;
  }

  async claimForDispatch(input: {
    readonly budgetReservationId: string;
    readonly leaseMs?: number;
    readonly now: Date;
    readonly operationId: string;
    readonly originAuthority: ExternalActionOriginLeaseCapability;
    readonly scopeId: string;
    readonly scopeKind: ExternalActionScopeKind;
  }): Promise<ExternalActionDispatchCapability> {
    assertStableKey(input.operationId, 'operation ID', 8, 200);
    assertStableKey(input.budgetReservationId, 'budget reservation ID', 8, 200);
    assertScope(input.scopeKind, input.scopeId);
    assertWorkerId(input.originAuthority.workerId);
    assertFiniteDate(input.now, 'claim time');
    const leaseMs = input.leaseMs ?? 30_000;
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 120_000) {
      throw new DomainError(
        'invalid_input',
        'External action lease must be between 1 and 120 seconds',
      );
    }
    const token = newCapabilityToken();
    const digest = capabilityDigest(token);
    const preflight = await this.database.query<ExternalActionRow>(
      `${projection}
       WHERE operation_id = $1 AND budget_reservation_id = $2
         AND scope_kind = $3 AND scope_id = $4`,
      [input.operationId, input.budgetReservationId, input.scopeKind, input.scopeId],
    );
    if (preflight.rows[0]?.state === 'in_flight') {
      const expired = await this.database.transaction(async (transaction) => {
        await lockControl(transaction);
        const authorityNow = await this.authorityClock(transaction, input.now);
        await lockReservation(transaction, input.budgetReservationId);
        await lockAndValidateOriginLease(
          transaction,
          {
            originId: input.originAuthority.originId,
            originKind: input.originAuthority.originKind,
            scopeId: input.originAuthority.scopeId,
            scopeKind: input.originAuthority.scopeKind,
            workerId: input.originAuthority.workerId,
          },
          authorityNow,
        );
        const row = await lockScopedAction(transaction, input);
        if (
          row.origin_id !== input.originAuthority.originId ||
          row.origin_kind !== input.originAuthority.originKind ||
          row.scope_id !== input.originAuthority.scopeId ||
          row.scope_kind !== input.originAuthority.scopeKind ||
          input.scopeId !== input.originAuthority.scopeId ||
          input.scopeKind !== input.originAuthority.scopeKind ||
          input.originAuthority.expiresAt <= authorityNow ||
          input.originAuthority.issuedAt > authorityNow
        ) {
          throw new DomainError('conflict', 'External action origin authority is unavailable');
        }
        if (
          row.state !== 'in_flight' ||
          asDate(row.lease_expires_at, 'external action lease expiry') > authorityNow
        ) {
          return false;
        }
        await transaction.query(
          `UPDATE external_actions
           SET state = 'outcome_unknown', effect_state = 'unknown', lease_owner = NULL,
               lease_expires_at = NULL, transition_capability_digest = NULL,
               transition_capability_expires_at = NULL, updated_at = $2
           WHERE operation_id = $1`,
          [row.operation_id, authorityNow.toISOString()],
        );
        await recordAttempt(transaction, this.ids, {
          attempt: row.attempts,
          budgetReservationId: row.budget_reservation_id,
          errorCode: 'lease_expired_after_possible_dispatch',
          eventKind: 'lease_expired_unknown',
          now: authorityNow,
          operationId: row.operation_id,
          workerId: input.originAuthority.workerId,
        });
        return true;
      });
      throw new DomainError(
        'conflict',
        expired
          ? 'Expired external action lease requires reconciliation before retry'
          : 'External action is already claimed',
      );
    }
    const result = await this.database.transaction(async (transaction) => {
      await lockControl(transaction);
      const authorityNow = await this.authorityClock(transaction, input.now);
      const authorityInput = { ...input, now: authorityNow };
      const authority = await assertCurrentDispatchAuthority(transaction, authorityInput);
      await lockAndValidateOriginLease(
        transaction,
        {
          originId: input.originAuthority.originId,
          originKind: input.originAuthority.originKind,
          scopeId: input.originAuthority.scopeId,
          scopeKind: input.originAuthority.scopeKind,
          workerId: input.originAuthority.workerId,
        },
        authorityNow,
      );
      const row = await lockScopedAction(transaction, input);
      if (
        row.origin_id !== input.originAuthority.originId ||
        row.origin_kind !== input.originAuthority.originKind ||
        row.scope_id !== input.originAuthority.scopeId ||
        row.scope_kind !== input.originAuthority.scopeKind ||
        input.scopeId !== input.originAuthority.scopeId ||
        input.scopeKind !== input.originAuthority.scopeKind ||
        input.originAuthority.expiresAt <= authorityNow ||
        input.originAuthority.issuedAt > authorityNow
      ) {
        throw new DomainError('conflict', 'External action origin authority is unavailable');
      }
      if (row.state === 'in_flight') {
        throw new DomainError('conflict', 'External action is already claimed');
      }
      if (row.state !== 'pending' && row.state !== 'retry_wait') {
        throw new DomainError('conflict', 'External action is not claimable');
      }
      if (asDate(row.next_attempt_at, 'external action next attempt') > authorityNow) {
        throw new DomainError('conflict', 'External action retry is not due');
      }
      if (row.attempts >= row.max_attempts) {
        await transaction.query(
          `UPDATE external_actions
           SET state = 'failed_terminal', updated_at = $2 WHERE operation_id = $1`,
          [row.operation_id, authorityNow.toISOString()],
        );
        await recordAttempt(transaction, this.ids, {
          attempt: row.attempts,
          errorCode: 'retry_cap_exhausted',
          eventKind: 'retry_exhausted',
          now: authorityNow,
          operationId: row.operation_id,
          workerId: input.originAuthority.workerId,
        });
        return { kind: 'exhausted' as const };
      }
      const acceptanceRule = await lockCurrentDispatchAcceptanceRule(transaction, row);
      const attempt = row.attempts + 1;
      const expiresAt = new Date(authorityNow.getTime() + leaseMs);
      if (expiresAt <= authorityNow) {
        throw new DomainError('conflict', 'External action authority is unavailable');
      }
      await transaction.query(
        `UPDATE external_actions
         SET state = 'in_flight', effect_state = 'unknown', attempts = $2,
             lease_owner = $3, lease_expires_at = $4,
             transition_capability_digest = $5, transition_capability_expires_at = $4,
             updated_at = $6
         WHERE operation_id = $1`,
        [
          row.operation_id,
          attempt,
          input.originAuthority.workerId,
          expiresAt.toISOString(),
          digest,
          authorityNow.toISOString(),
        ],
      );
      await recordAttempt(transaction, this.ids, {
        acceptanceRule,
        attempt,
        budgetAuthorizationExpiresAt: authority.authorizationExpiresAt,
        budgetControlVersion: authority.control.version,
        budgetRecheckedAt: authority.recheckedAt,
        budgetReservationId: authority.reservation.id,
        eventKind: 'claimed',
        now: authorityNow,
        operationId: row.operation_id,
        transitionCapabilityDigest: digest,
        workerId: input.originAuthority.workerId,
      });
      return {
        attempt,
        dispatchBy: authority.authorizationExpiresAt,
        expiresAt,
        kind: 'claimed' as const,
      };
    });
    if (result.kind === 'exhausted') {
      throw new DomainError('conflict', 'External action retry cap is exhausted');
    }
    return {
      attempt: result.attempt,
      budgetReservationId: input.budgetReservationId,
      dispatchBy: result.dispatchBy,
      expiresAt: result.expiresAt,
      operationId: input.operationId,
      scopeId: input.scopeId,
      scopeKind: input.scopeKind,
      token,
      workerId: input.originAuthority.workerId,
    } as ExternalActionDispatchCapability;
  }

  async recordProviderAccepted(input: {
    readonly capability: ExternalActionDispatchCapability;
    readonly costEvidence: ExternalActionCostEvidence;
    readonly now: Date;
    readonly providerResponseId: string;
    readonly providerResponseState: string;
  }): Promise<void> {
    assertProviderEvidence(input.providerResponseId, input.providerResponseState);
    assertCostEvidence(input.costEvidence);
    await this.database.transaction(async (transaction) => {
      await lockControl(transaction);
      const authorityNow = await this.authorityClock(transaction, input.now);
      await lockReservation(transaction, input.capability.budgetReservationId);
      const row = await lockScopedAction(transaction, input.capability);
      assertDispatchCapability(row, input.capability, authorityNow);
      assertMagnitudeEvidenceForAction(row, input.costEvidence);
      if (
        input.costEvidence.sourceKey !== row.cost_source_key ||
        input.costEvidence.sourceVersion !== row.cost_source_version
      ) {
        throw new DomainError(
          'conflict',
          'External action cost source does not match its envelope',
        );
      }
      const acceptanceRule = await getDispatchAcceptanceRule(
        transaction,
        row.operation_id,
        row.attempts,
      );
      if (acceptanceRule.provider_response_state !== input.providerResponseState) {
        throw new DomainError('conflict', 'Provider response is not a reviewed accepted outcome');
      }
      await transaction.query(
        `UPDATE external_actions
         SET state = 'succeeded', effect_state = 'accepted', lease_owner = NULL,
             lease_expires_at = NULL, transition_capability_digest = NULL,
             transition_capability_expires_at = NULL, provider_response_id = $2,
             provider_response_state = $3, provider_normalized_outcome = 'accepted',
             updated_at = $4 WHERE operation_id = $1`,
        [
          row.operation_id,
          input.providerResponseId,
          input.providerResponseState,
          authorityNow.toISOString(),
        ],
      );
      await recordAttempt(transaction, this.ids, {
        acceptanceRule,
        attempt: row.attempts,
        budgetReservationId: row.budget_reservation_id,
        costEvidence: input.costEvidence,
        eventKind: 'provider_accepted',
        now: authorityNow,
        operationId: row.operation_id,
        providerNormalizedOutcome: 'accepted',
        providerResponseId: input.providerResponseId,
        providerResponseState: input.providerResponseState,
        workerId: input.capability.workerId,
      });
    });
  }

  async recordOutcomeUnknown(input: {
    readonly capability: ExternalActionDispatchCapability;
    readonly errorCode: string;
    readonly now: Date;
  }): Promise<void> {
    assertErrorCode(input.errorCode);
    await this.database.transaction(async (transaction) => {
      await lockControl(transaction);
      const authorityNow = await this.authorityClock(transaction, input.now);
      await lockReservation(transaction, input.capability.budgetReservationId);
      const row = await lockScopedAction(transaction, input.capability);
      assertDispatchCapability(row, input.capability, authorityNow);
      await transaction.query(
        `UPDATE external_actions
         SET state = 'outcome_unknown', effect_state = 'unknown', lease_owner = NULL,
             lease_expires_at = NULL, transition_capability_digest = NULL,
             transition_capability_expires_at = NULL, updated_at = $2
         WHERE operation_id = $1`,
        [row.operation_id, authorityNow.toISOString()],
      );
      await recordAttempt(transaction, this.ids, {
        attempt: row.attempts,
        budgetReservationId: row.budget_reservation_id,
        errorCode: input.errorCode,
        eventKind: 'outcome_unknown',
        now: authorityNow,
        operationId: row.operation_id,
        workerId: input.capability.workerId,
      });
    });
  }

  async authorizeReconciliation(input: {
    readonly budgetReservationId: string;
    readonly context: OperationalEventContext;
    readonly operationId: string;
    readonly requestedOutcome: ExternalActionReconciliationOutcomeKind;
    readonly scopeId: string;
    readonly scopeKind: ExternalActionScopeKind;
  }): Promise<ExternalActionReconciliationCapability> {
    if (input.context.audience !== 'hq' || input.context.actorPersonId === undefined) {
      throw new DomainError(
        'not_authorized',
        'External action reconciliation requires an HQ owner',
      );
    }
    assertScope(input.scopeKind, input.scopeId);
    const token = newCapabilityToken();
    const digest = capabilityDigest(token);
    const authorizationId = this.ids.next('external-action-reconciliation-authorization');
    const expiresAt = await this.database.transaction(async (transaction) => {
      await lockControl(transaction);
      const authorityNow = await this.authorityClock(transaction, input.context.now);
      const authorityExpiresAt = new Date(authorityNow.getTime() + 5 * 60_000);
      await lockReservation(transaction, input.budgetReservationId);
      const owner = await lockInternalOwnerAuthority(transaction, input.context.actorPersonId!);
      if (!owner) {
        throw new DomainError(
          'not_authorized',
          'External action reconciliation requires an HQ owner',
        );
      }
      const row = await lockScopedAction(transaction, input);
      if (row.state !== 'outcome_unknown') {
        throw new DomainError('conflict', 'External action does not require reconciliation');
      }
      await transaction.query(
        `INSERT INTO external_action_reconciliation_authorizations(
           id, operation_id, budget_reservation_id, scope_kind, scope_id,
           requested_outcome, capability_digest, actor_person_id, audience,
           created_at, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'hq',$9,$10)`,
        [
          authorizationId,
          input.operationId,
          input.budgetReservationId,
          input.scopeKind,
          input.scopeId,
          input.requestedOutcome,
          digest,
          input.context.actorPersonId,
          authorityNow.toISOString(),
          authorityExpiresAt.toISOString(),
        ],
      );
      return authorityExpiresAt;
    });
    return {
      actorPersonId: input.context.actorPersonId,
      authorizationId,
      budgetReservationId: input.budgetReservationId,
      expiresAt,
      operationId: input.operationId,
      requestedOutcome: input.requestedOutcome,
      scopeId: input.scopeId,
      scopeKind: input.scopeKind,
      token,
    } as ExternalActionReconciliationCapability;
  }

  async reconcileUnknown(input: {
    readonly capability: ExternalActionReconciliationCapability;
    readonly evidence: ExternalActionReconciliationEvidence;
    readonly now: Date;
    readonly outcome:
      | {
          readonly costEvidence: ExternalActionCostEvidence;
          readonly kind: 'confirmed_succeeded';
          readonly providerResponseId: string;
          readonly providerResponseState: string;
        }
      | { readonly kind: 'confirmed_no_effect'; readonly retryAt: Date }
      | { readonly errorCode: string; readonly kind: 'still_unknown' }
      | { readonly kind: 'canceled' };
  }): Promise<ExternalAction> {
    assertStableKey(input.evidence.reference, 'reconciliation evidence reference', 2, 200);
    assertStableKey(input.evidence.providerKey, 'reconciliation provider key', 2, 80);
    if (!fingerprint.test(input.evidence.digest)) {
      throw new DomainError('invalid_input', 'Reconciliation evidence digest is invalid');
    }
    if (!fingerprint.test(input.evidence.providerAccountDigest)) {
      throw new DomainError('invalid_input', 'Reconciliation provider account digest is invalid');
    }
    assertFiniteDate(input.evidence.observedAt, 'reconciliation evidence time');
    if (input.outcome.kind === 'confirmed_succeeded') {
      assertProviderEvidence(input.outcome.providerResponseId, input.outcome.providerResponseState);
      assertCostEvidence(input.outcome.costEvidence);
    } else if (input.outcome.kind === 'confirmed_no_effect') {
      assertFiniteDate(input.outcome.retryAt, 'reconciliation retry time');
    } else if (input.outcome.kind === 'still_unknown') {
      assertErrorCode(input.outcome.errorCode);
    }
    return this.database.transaction(async (transaction) => {
      await lockControl(transaction);
      const authorityNow = await this.authorityClock(transaction, input.now);
      if (input.evidence.observedAt > authorityNow) {
        throw new DomainError('invalid_input', 'Reconciliation evidence cannot be future-dated');
      }
      if (input.outcome.kind === 'confirmed_no_effect') {
        assertRetryAt(authorityNow, input.outcome.retryAt);
      }
      await lockReservation(transaction, input.capability.budgetReservationId);
      const authorization = await transaction.query<ReconciliationAuthorizationRow>(
        `SELECT * FROM external_action_reconciliation_authorizations
         WHERE id = $1 FOR UPDATE`,
        [input.capability.authorizationId],
      );
      const authority = authorization.rows[0];
      const activeOwner =
        authority === undefined
          ? false
          : await lockInternalOwnerAuthority(transaction, authority.actor_person_id);
      const row = await lockScopedAction(transaction, input.capability);
      if (
        authority === undefined ||
        !activeOwner ||
        authority.used_at !== null ||
        authority.operation_id !== row.operation_id ||
        authority.budget_reservation_id !== row.budget_reservation_id ||
        authority.scope_kind !== row.scope_kind ||
        authority.scope_id !== row.scope_id ||
        authority.requested_outcome !== input.outcome.kind ||
        authority.actor_person_id !== input.capability.actorPersonId ||
        authority.audience !== 'hq' ||
        !secureDigestMatches(input.capability.token, authority.capability_digest) ||
        asDate(authority.expires_at, 'reconciliation authorization expiry') < authorityNow
      ) {
        throw new DomainError('conflict', 'Reconciliation authority is unavailable');
      }
      if (row.state !== 'outcome_unknown') {
        throw new DomainError('conflict', 'External action does not require reconciliation');
      }
      if (
        input.evidence.providerKey !== row.provider_key ||
        input.evidence.providerAccountDigest !== row.provider_account_digest
      ) {
        throw new DomainError('conflict', 'Reconciliation evidence provider scope is unavailable');
      }
      const unknown = await transaction.query<{ occurred_at: unknown } & Record<string, unknown>>(
        `SELECT occurred_at FROM external_action_attempts
         WHERE operation_id = $1
           AND event_kind IN ('outcome_unknown', 'lease_expired_unknown')
         ORDER BY occurred_at DESC, id DESC LIMIT 1`,
        [row.operation_id],
      );
      const unknownAt = unknown.rows[0]?.occurred_at;
      if (
        unknownAt === undefined ||
        input.evidence.observedAt < asDate(unknownAt, 'external action unknown transition')
      ) {
        throw new DomainError(
          'conflict',
          'Reconciliation evidence predates the unknown outcome being reconciled',
        );
      }
      if (input.evidence.kind === 'operator_review') {
        if (input.outcome.kind === 'confirmed_succeeded') {
          throw new DomainError('conflict', 'Operator review cannot normalize provider acceptance');
        }
        if (
          input.outcome.kind === 'confirmed_no_effect' &&
          (!row.provider_supports_idempotency ||
            row.action_class === 'refund' ||
            row.action_class === 'credit' ||
            row.action_class === 'paid_tool')
        ) {
          throw new DomainError(
            'conflict',
            'Operator review cannot rearm this action without an explicit reviewed policy',
          );
        }
      }
      let state: ExternalActionState = 'outcome_unknown';
      let effectState: ExternalActionEffectState = 'unknown';
      let eventKind: AttemptEventKind = 'reconciliation_still_unknown';
      let providerResponseId: string | null = null;
      let providerResponseState: string | null = null;
      let providerNormalizedOutcome: 'accepted' | null = null;
      let normalizedByRule: { readonly id: string; readonly version: number } | undefined;
      let errorCode: string | undefined;
      let nextAttemptAt = row.next_attempt_at;
      let retrySuppressed = row.retry_suppressed;
      if (input.outcome.kind === 'confirmed_succeeded') {
        if (input.evidence.kind === 'operator_review') {
          throw new DomainError('conflict', 'Provider evidence is required for accepted outcome');
        }
        if (
          input.outcome.costEvidence.sourceKey !== row.cost_source_key ||
          input.outcome.costEvidence.sourceVersion !== row.cost_source_version
        ) {
          throw new DomainError(
            'conflict',
            'External action cost source does not match its envelope',
          );
        }
        assertMagnitudeEvidenceForAction(row, input.outcome.costEvidence);
        const acceptanceRule = await getDispatchAcceptanceRule(
          transaction,
          row.operation_id,
          row.attempts,
        );
        if (acceptanceRule.provider_response_state !== input.outcome.providerResponseState) {
          throw new DomainError('conflict', 'Provider response is not a reviewed accepted outcome');
        }
        state = 'succeeded';
        effectState = 'accepted';
        eventKind = 'reconciliation_confirmed_success';
        providerResponseId = input.outcome.providerResponseId;
        providerResponseState = input.outcome.providerResponseState;
        providerNormalizedOutcome = 'accepted';
        normalizedByRule = acceptanceRule;
        retrySuppressed = false;
      } else if (input.outcome.kind === 'confirmed_no_effect') {
        state = row.attempts >= row.max_attempts ? 'failed_terminal' : 'retry_wait';
        effectState = 'confirmed_no_effect';
        eventKind = 'reconciliation_confirmed_no_effect';
        nextAttemptAt = input.outcome.retryAt.toISOString();
        retrySuppressed = false;
      } else if (input.outcome.kind === 'canceled') {
        eventKind = 'reconciliation_canceled';
        retrySuppressed = true;
      } else {
        errorCode = input.outcome.errorCode;
      }
      const updated = await transaction.query<ExternalActionRow>(
        `UPDATE external_actions
         SET state = $2, effect_state = $3, next_attempt_at = $4,
             provider_response_id = $5, provider_response_state = $6,
             provider_normalized_outcome = $7, retry_suppressed = $8, updated_at = $9
         WHERE operation_id = $1
         RETURNING operation_id, budget_reservation_id, exposure_authorization_id,
           budget_envelope_digest,
           automation_action_key, automation_tool_key, financial_exposure_upper_bound_cents,
           budget_magnitude_kind,
           cost_currency, cost_source_key, cost_source_version, exposure_evidence_level,
           scope_kind, scope_id,
           origin_kind, origin_id, registered_by_person_id, action_class, provider_key,
           provider_account_digest,
           provider_capability_rule_id, provider_capability_rule_version,
           provider_supports_idempotency, provider_idempotency_key,
           provider_idempotency_key_derivation_version, intent_fingerprint,
           state, effect_state, retry_suppressed, attempts, max_attempts, next_attempt_at, lease_owner,
           lease_expires_at, transition_capability_digest, transition_capability_expires_at,
           provider_response_id, provider_response_state, provider_normalized_outcome,
           correlation_id, created_at, updated_at`,
        [
          row.operation_id,
          state,
          effectState,
          nextAttemptAt,
          providerResponseId,
          providerResponseState,
          providerNormalizedOutcome,
          retrySuppressed,
          authorityNow.toISOString(),
        ],
      );
      await transaction.query(
        `UPDATE external_action_reconciliation_authorizations
         SET used_at = $2 WHERE id = $1`,
        [authority.id, authorityNow.toISOString()],
      );
      await recordAttempt(transaction, this.ids, {
        ...(normalizedByRule === undefined ? {} : { acceptanceRule: normalizedByRule }),
        attempt: row.attempts,
        budgetReservationId: row.budget_reservation_id,
        ...(input.outcome.kind === 'confirmed_succeeded'
          ? { costEvidence: input.outcome.costEvidence }
          : {}),
        ...(errorCode === undefined ? {} : { errorCode }),
        eventKind,
        now: authorityNow,
        operationId: row.operation_id,
        ...(providerResponseId === null
          ? {}
          : {
              providerNormalizedOutcome: 'accepted' as const,
              providerResponseId,
              providerResponseState: providerResponseState!,
            }),
        reconciliationActorPersonId: authority.actor_person_id,
        reconciliationAudience: 'hq',
        reconciliationAuthorizationId: authority.id,
        reconciliationEvidence: input.evidence,
        workerId: authority.actor_person_id,
      });
      return mapExternalAction(updated.rows[0]!);
    });
  }
}
